import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVersion, makeJwt, publishPackage, readZipVersion, uploadPackage, waitValidation } from '../scripts/firefox-store.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ISSUER = 'user:123:45';
const SECRET = 'segredo-da-amo-que-nao-pode-vazar';
const b64 = (s) => Buffer.from(s, 'base64url').toString('utf8');
const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const noSleep = async () => {};

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const key = `${init.method ?? 'GET'} ${String(url).replace('https://addons.mozilla.org/api/v5', '')}`;
    const route = routes[key];
    if (!route) throw new Error(`rota não prevista: ${key}`);
    return typeof route === 'function' ? route(init) : route;
  };
  return { impl, calls };
}

function makeZip(version) {
  const dir = mkdtempSync(join(tmpdir(), 'ffstore-'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, version }));
  const zip = join(dir, `my-ticket-firefox-${version}.zip`);
  execFileSync('zip', ['-q', '-j', zip, join(dir, 'manifest.json')]);
  return zip;
}

test('o JWT é HS256, de 60 s, com iss/jti/iat/exp, e a assinatura confere', () => {
  const t = makeJwt({ issuer: ISSUER, secret: SECRET }, { now: () => 1_700_000_000_000, jti: () => 'abc' });
  const [h, p, s] = t.split('.');
  assert.deepEqual(JSON.parse(b64(h)), { alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(b64(p)), { iss: ISSUER, jti: 'abc', iat: 1_700_000_000, exp: 1_700_000_060 });
  assert.equal(s, createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url'));
  assert.doesNotMatch(t, new RegExp(SECRET));
});

test('o JWT recusa issuer fora do formato e segredo vazio', () => {
  assert.throws(() => makeJwt({ issuer: 'qualquer', secret: SECRET }), /AMO_JWT_ISSUER inválido/);
  assert.throws(() => makeJwt({ issuer: ISSUER, secret: '' }), /AMO_JWT_SECRET vazio/);
});

test('o upload vai ao canal listado, com o arquivo e o cabeçalho JWT', async () => {
  const f = fakeFetch({ 'POST /addons/upload/': json({ uuid: 'u-1', processed: false }, 201) });
  const r = await uploadPackage({ token: 'TOKEN', zip: Buffer.from('zip'), name: 'a.zip', fetchImpl: f.impl });
  assert.equal(r.uuid, 'u-1');
  assert.equal(f.calls[0].headers.Authorization, 'JWT TOKEN');
  assert.equal(f.calls[0].body.get('channel'), 'listed');
  assert.equal(f.calls[0].body.get('upload').name, 'a.zip');
});

test('a validação espera "processed" e aceita pacote válido', async () => {
  let n = 0;
  const f = fakeFetch({ 'GET /addons/upload/u-1/': () => json(++n < 2 ? { uuid: 'u-1', processed: false } : { uuid: 'u-1', processed: true, valid: true }) });
  const r = await waitValidation({ token: 'T', upload: { uuid: 'u-1', processed: false }, fetchImpl: f.impl, sleep: noSleep });
  assert.equal(r.valid, true);
  assert.equal(f.calls.length, 2);
});

test('a validação recusada mostra os erros da AMO; desistir depois de muitas consultas também é erro', async () => {
  const bad = { uuid: 'u-1', processed: true, valid: false, validation: { messages: [{ type: 'error', message: 'Versão já existe' }, { type: 'warning', message: 'ruído' }] } };
  await assert.rejects(waitValidation({ token: 'T', upload: bad, fetchImpl: fakeFetch({}).impl }), /recusou \(Versão já existe\)/);
  const f = fakeFetch({ 'GET /addons/upload/u-1/': json({ uuid: 'u-1', processed: false }) });
  await assert.rejects(waitValidation({ token: 'T', upload: { uuid: 'u-1', processed: false }, fetchImpl: f.impl, sleep: noSleep, maxPolls: 2 }), /não terminou depois de 2/);
});

test('a versão é criada no add-on pelo GUID (codificado), com o uuid do upload', async () => {
  const f = fakeFetch({ 'POST /addons/addon/myticket%40sysvale.com/versions/': json({ id: 9, version: '0.1.3' }, 201) });
  const v = await createVersion({ token: 'T', addonId: 'myticket@sysvale.com', uploadUuid: 'u-1', fetchImpl: f.impl });
  assert.equal(v.id, 9);
  assert.deepEqual(JSON.parse(f.calls[0].body), { upload: 'u-1' });
});

test('erro HTTP da AMO: a mensagem explica e não vaza o token', async () => {
  const f = fakeFetch({ 'POST /addons/upload/': json({ detail: 'Invalid JWT eyJhbGciOi.eyJpc3MiOi.assinatura' }, 401) });
  await assert.rejects(uploadPackage({ token: 'T', zip: Buffer.from('x'), name: 'a.zip', fetchImpl: f.impl }), (e) => {
    assert.match(e.message, /enviar o pacote: HTTP 401/);
    assert.doesNotMatch(e.message, /eyJ/);
    return true;
  });
});

test('publishPackage: fluxo completo, máscara dos tokens e versão conferida', async () => {
  const zip = makeZip('0.1.3');
  const masked = [];
  const f = fakeFetch({
    'POST /addons/upload/': json({ uuid: 'u-1', processed: true, valid: true }, 201),
    'POST /addons/addon/myticket%40sysvale.com/versions/': json({ id: 9, version: '0.1.3' }, 201),
  });
  const logs = [];
  const r = await publishPackage({ zipPath: zip, expectVersion: '0.1.3', issuer: ISSUER, secret: SECRET, fetchImpl: f.impl, sleep: noSleep, log: (m) => logs.push(m), maskToken: (t) => masked.push(t) });
  assert.equal(r.version, '0.1.3');
  assert.equal(masked.length, 2, 'cada JWT gerado é mascarado');
  assert.ok(logs.every((l) => !l.includes(SECRET) && !masked.some((t) => l.includes(t))));
});

test('publishPackage: versão do zip diferente da esperada não toca a rede; dry-run também não', async () => {
  const zip = makeZip('0.1.3');
  const f = fakeFetch({});
  await assert.rejects(publishPackage({ zipPath: zip, expectVersion: '0.1.4', issuer: ISSUER, secret: SECRET, fetchImpl: f.impl }), /versão 0\.1\.3, mas se esperava a 0\.1\.4/);
  const r = await publishPackage({ zipPath: zip, expectVersion: '0.1.3', issuer: ISSUER, secret: SECRET, fetchImpl: f.impl, dryRun: true, log: () => {} });
  assert.equal(r.dryRun, true);
  assert.equal(f.calls.length, 0);
});

test('readZipVersion lê o manifest da raiz e recusa zip sem ele', () => {
  assert.equal(readZipVersion(makeZip('1.2.3')), '1.2.3');
  assert.throws(() => readZipVersion('/nao/existe.zip'), /manifest\.json válido/);
});

test('a linha de comando falha com mensagem clara sem argumentos ou sem variáveis, e não imprime segredo', () => {
  const run = (args, env) => spawnSync('node', [join(ROOT, 'scripts/firefox-store.mjs'), ...args], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  assert.match(run([], {}).stderr, /uso: node scripts\/firefox-store\.mjs/);
  assert.match(run([makeZip('0.1.3')], {}).stderr, /faltam as variáveis de ambiente: AMO_JWT_ISSUER, AMO_JWT_SECRET/);
  const r = run([makeZip('0.1.3'), '--dry-run'], { AMO_JWT_ISSUER: ISSUER, AMO_JWT_SECRET: SECRET });
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(SECRET));
});
