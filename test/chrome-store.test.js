import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accessToken, fetchStatus, parseServiceAccount, publishItem, publishPackage, readZipVersion, uploadPackage,
} from '../scripts/chrome-store.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLISHER = 'pub-123';
const ITEM = 'phbofombfpjafeneiikpjhnhnjedbced';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = { client_email: 'ci@projeto.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const SECRET_TOKEN = 'ya29.TOKEN-SECRETO-QUE-NAO-PODE-VAZAR';
const b64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

// fetch falso que grava as chamadas e responde por "método URL"
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const key = `${init.method ?? 'GET'} ${String(url).replace('https://chromewebstore.googleapis.com', '')}`;
    const route = routes[key] ?? routes[`${init.method ?? 'GET'} ${String(url)}`];
    if (!route) throw new Error(`rota não prevista: ${key}`);
    return typeof route === 'function' ? route(init) : route;
  };
  return { impl, calls };
}

const TOKEN_URL = 'POST https://oauth2.googleapis.com/token';
const base = `/v2/publishers/${PUBLISHER}/items/${ITEM}`;
const noSleep = async () => {};

test('o token de acesso vem de um JWT RS256 válido, com o escopo da loja e sem expor a chave', async () => {
  const f = fakeFetch({ [TOKEN_URL]: json({ access_token: SECRET_TOKEN, expires_in: 3600 }) });
  const token = await accessToken(KEY, { fetchImpl: f.impl, now: () => 1_700_000_000_000 });
  assert.equal(token, SECRET_TOKEN);
  const body = new URLSearchParams(f.calls[0].body);
  assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [h, p, s] = body.get('assertion').split('.');
  assert.deepEqual(JSON.parse(b64(h)), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(b64(p)), {
    iss: KEY.client_email, scope: 'https://www.googleapis.com/auth/chromewebstore',
    aud: 'https://oauth2.googleapis.com/token', iat: 1_700_000_000, exp: 1_700_003_600,
  });
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s, 'base64url')), 'assinatura inválida');
  assert.doesNotMatch(f.calls[0].body, /BEGIN PRIVATE KEY/);
});

test('falha ao obter o token: o erro explica, sem repetir a chave', async () => {
  const f = fakeFetch({ [TOKEN_URL]: json({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }, 400) });
  await assert.rejects(accessToken(KEY, { fetchImpl: f.impl }), (e) => {
    assert.match(e.message, /token de acesso.*400.*invalid_grant/s);
    assert.doesNotMatch(e.message, /PRIVATE KEY/);
    return true;
  });
});

test('upload: POST do zip cru em /upload/v2/.../:upload com o token, e devolve o estado', async () => {
  const f = fakeFetch({ [`POST /upload${base}:upload`]: json({ itemId: ITEM, crxVersion: '0.1.2', uploadState: 'SUCCEEDED' }) });
  const zip = Buffer.from('PK-conteudo-do-zip');
  const r = await uploadPackage({ token: SECRET_TOKEN, publisherId: PUBLISHER, itemId: ITEM, zip, fetchImpl: f.impl, sleep: noSleep });
  assert.equal(r.uploadState, 'SUCCEEDED');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].headers.Authorization, `Bearer ${SECRET_TOKEN}`);
  assert.deepEqual(f.calls[0].body, zip);
});

test('upload em andamento: consulta o status até concluir', async () => {
  let polls = 0;
  const f = fakeFetch({
    [`POST /upload${base}:upload`]: json({ itemId: ITEM, uploadState: 'IN_PROGRESS' }),
    [`GET ${base}:fetchStatus`]: () => json({ lastAsyncUploadState: ++polls < 3 ? 'IN_PROGRESS' : 'SUCCEEDED' }),
  });
  const r = await uploadPackage({ token: 't', publisherId: PUBLISHER, itemId: ITEM, zip: Buffer.from('x'), fetchImpl: f.impl, sleep: noSleep });
  assert.equal(r.uploadState, 'SUCCEEDED');
  assert.equal(polls, 3);
});

test('upload recusado (FAILED) e upload que nunca termina viram erro', async () => {
  const failed = fakeFetch({ [`POST /upload${base}:upload`]: json({ uploadState: 'FAILED' }) });
  await assert.rejects(uploadPackage({ token: 't', publisherId: PUBLISHER, itemId: ITEM, zip: Buffer.from('x'), fetchImpl: failed.impl, sleep: noSleep }), /FAILED/);
  const stuck = fakeFetch({
    [`POST /upload${base}:upload`]: json({ uploadState: 'IN_PROGRESS' }),
    [`GET ${base}:fetchStatus`]: json({ lastAsyncUploadState: 'IN_PROGRESS' }),
  });
  await assert.rejects(uploadPackage({ token: 't', publisherId: PUBLISHER, itemId: ITEM, zip: Buffer.from('x'), fetchImpl: stuck.impl, sleep: noSleep, maxPolls: 3 }), /não terminou/);
});

test('upload de versão repetida: o erro da loja aparece, sem o token', async () => {
  const f = fakeFetch({ [`POST /upload${base}:upload`]: json({ error: { code: 400, message: 'Version must be increased' } }, 400) });
  await assert.rejects(uploadPackage({ token: SECRET_TOKEN, publisherId: PUBLISHER, itemId: ITEM, zip: Buffer.from('x'), fetchImpl: f.impl, sleep: noSleep }), (e) => {
    assert.match(e.message, /400.*Version must be increased/s);
    assert.doesNotMatch(e.message, new RegExp(SECRET_TOKEN));
    return true;
  });
});

test('publicação: corpo JSON com publishType (padrão STAGED_PUBLISH) e devolve o estado', async () => {
  const f = fakeFetch({ [`POST ${base}:publish`]: json({ itemId: ITEM, state: 'PENDING_REVIEW', warningInfo: { warnings: [{ reason: 'X', description: 'aviso' }] } }) });
  const r = await publishItem({ token: 't', publisherId: PUBLISHER, itemId: ITEM, fetchImpl: f.impl });
  assert.equal(r.state, 'PENDING_REVIEW');
  assert.deepEqual(JSON.parse(f.calls[0].body), { publishType: 'STAGED_PUBLISH' });
  assert.equal(f.calls[0].headers['Content-Type'], 'application/json');
  const d = fakeFetch({ [`POST ${base}:publish`]: json({ state: 'PENDING_REVIEW' }) });
  await publishItem({ token: 't', publisherId: PUBLISHER, itemId: ITEM, publishType: 'DEFAULT_PUBLISH', fetchImpl: d.impl });
  assert.equal(JSON.parse(d.calls[0].body).publishType, 'DEFAULT_PUBLISH');
  await assert.rejects(publishItem({ token: 't', publisherId: PUBLISHER, itemId: ITEM, publishType: 'QUALQUER', fetchImpl: d.impl }), /publishType/);
});

test('fetchStatus lê o estado da revisão submetida', async () => {
  const f = fakeFetch({ [`GET ${base}:fetchStatus`]: json({ submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '0.1.2' }] } }) });
  const s = await fetchStatus({ token: 't', publisherId: PUBLISHER, itemId: ITEM, fetchImpl: f.impl });
  assert.equal(s.submittedItemRevisionStatus.state, 'PENDING_REVIEW');
});

test('ids fora do formato são recusados antes de qualquer chamada (nada de caminho injetado na URL)', async () => {
  const f = fakeFetch({});
  for (const bad of [{ publisherId: '../x' }, { publisherId: '' }, { itemId: 'abc' }, { itemId: `${ITEM}/:publish` }]) {
    await assert.rejects(publishItem({ token: 't', publisherId: PUBLISHER, itemId: ITEM, ...bad, fetchImpl: f.impl }), /id/i);
  }
  assert.equal(f.calls.length, 0);
});

test('parseServiceAccount aceita o JSON da chave e recusa o resto sem imprimir o conteúdo', () => {
  assert.deepEqual(parseServiceAccount(JSON.stringify(KEY)), KEY);
  for (const bad of ['', 'não é json', '{}', JSON.stringify({ client_email: 'a@b.c' })]) {
    assert.throws(() => parseServiceAccount(bad), (e) => {
      assert.match(e.message, /CWS_SERVICE_ACCOUNT_JSON/);
      assert.doesNotMatch(e.message, /não é json/);
      return true;
    });
  }
});

function zipWith(version) {
  const dir = mkdtempSync(join(tmpdir(), 'cws-'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'X', version }));
  execFileSync('zip', ['-q', '-X', 'x.zip', 'manifest.json'], { cwd: dir });
  return join(dir, 'x.zip');
}

test('a versão é lida de dentro do zip e precisa bater com a esperada', async () => {
  const zip = zipWith('0.1.2');
  assert.equal(readZipVersion(zip), '0.1.2');
  const f = fakeFetch({});
  await assert.rejects(publishPackage({ zipPath: zip, expectVersion: '0.1.3', publisherId: PUBLISHER, itemId: ITEM, serviceAccount: KEY, fetchImpl: f.impl }), /0\.1\.2.*0\.1\.3/s);
  assert.equal(f.calls.length, 0, 'nada vai à rede se a versão não bate');
});

test('fluxo completo: token, upload, publicação e status, nesta ordem', async () => {
  const f = fakeFetch({
    [TOKEN_URL]: json({ access_token: SECRET_TOKEN }),
    [`POST /upload${base}:upload`]: json({ uploadState: 'SUCCEEDED', crxVersion: '0.1.2' }),
    [`POST ${base}:publish`]: json({ state: 'PENDING_REVIEW' }),
    [`GET ${base}:fetchStatus`]: json({ submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } }),
  });
  const logs = [];
  const r = await publishPackage({ zipPath: zipWith('0.1.2'), expectVersion: '0.1.2', publisherId: PUBLISHER, itemId: ITEM, serviceAccount: KEY, fetchImpl: f.impl, sleep: noSleep, log: (m) => logs.push(m) });
  assert.deepEqual(f.calls.map((c) => `${c.method} ${c.url.replace('https://chromewebstore.googleapis.com', '')}`), [
    'POST https://oauth2.googleapis.com/token', `POST /upload${base}:upload`, `POST ${base}:publish`, `GET ${base}:fetchStatus`,
  ]);
  assert.equal(r.state, 'PENDING_REVIEW');
  assert.ok(logs.length > 0);
  assert.ok(!logs.join('\n').includes(SECRET_TOKEN), 'o token nunca vai para o log');
});

test('dry-run: valida tudo e não faz nenhuma chamada de rede', async () => {
  const f = fakeFetch({});
  const r = await publishPackage({ zipPath: zipWith('0.1.2'), expectVersion: '0.1.2', publisherId: PUBLISHER, itemId: ITEM, serviceAccount: KEY, fetchImpl: f.impl, dryRun: true, log: () => {} });
  assert.equal(r.dryRun, true);
  assert.equal(f.calls.length, 0);
});

test('CLI: sem as variáveis de ambiente sai com 1 e diz quais faltam (sem imprimir valores)', () => {
  const r = spawnSync('node', ['scripts/chrome-store.mjs', zipWith('0.1.2'), '--dry-run'], { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /CWS_PUBLISHER_ID/);
  assert.match(r.stderr, /CWS_EXTENSION_ID/);
  assert.match(r.stderr, /CWS_SERVICE_ACCOUNT_JSON/);
});

test('CLI: --dry-run com tudo configurado sai com 0', () => {
  const r = spawnSync('node', ['scripts/chrome-store.mjs', zipWith('0.1.2'), '--dry-run', '--expect-version', '0.1.2'], {
    cwd: ROOT, encoding: 'utf8',
    env: { PATH: process.env.PATH, CWS_PUBLISHER_ID: PUBLISHER, CWS_EXTENSION_ID: ITEM, CWS_SERVICE_ACCOUNT_JSON: JSON.stringify(KEY) },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /dry-run/i);
  assert.doesNotMatch(r.stdout + r.stderr, /PRIVATE KEY/);
});
