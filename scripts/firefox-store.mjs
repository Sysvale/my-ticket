// Envia um zip ao addons.mozilla.org (AMO) pela API v5 (https://mozilla.github.io/addons-server/topics/api/): upload,
// validação e criação da versão no canal listado. Sem dependências: só fetch e node:crypto.
// Autentica com uma chave de API da AMO (JWT HS256 de 60 s, gerado a cada execução), que pode ser revogada a qualquer momento.
//
//   node scripts/firefox-store.mjs dist/my-ticket-firefox-0.1.3.zip --expect-version 0.1.3 [--dry-run]
//
// Variáveis de ambiente (nunca impressas): AMO_JWT_ISSUER ("user:123:45") e AMO_JWT_SECRET.
//
// A API só adiciona versões a um add-on que já existe: a primeira versão é sempre enviada pelo site
// (guia-publish.md, seção 10). Depois de enviada, a versão passa pela revisão da Mozilla; ela é publicada sozinha ao ser aprovada.
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GECKO } from './firefox-manifest.mjs';

const API = 'https://addons.mozilla.org/api/v5';
const ISSUER = /^user:\d+:\d+$/;

// O que vai para uma mensagem de erro nunca leva token nem segredo, nem a resposta inteira.
function safe(text, max = 600) {
  return String(text)
    .replace(/JWT\s+\S+/gi, 'JWT ***')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '***')
    .slice(0, max);
}

function detailOf(data, text) {
  if (data?.detail) return data.detail;
  if (data && typeof data === 'object') return JSON.stringify(data);
  return text;
}

async function call(fetchImpl, url, init, what, timeoutMs = 60_000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  let text;
  try {
    res = await fetchImpl(url, { ...init, signal: ctl.signal });
    text = await res.text();
  } catch (e) {
    throw new Error(`${what}: sem resposta (${safe(e?.name === 'AbortError' ? 'tempo esgotado' : (e?.message ?? e))})`, { cause: e });
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* resposta que não é JSON */ }
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status} — ${safe(detailOf(data, text))}`);
  return data ?? {};
}

const b64url = (v) => Buffer.from(v).toString('base64url');

// Token de 60 s, assinado com HS256: https://mozilla.github.io/addons-server/topics/api/auth.html
export function makeJwt({ issuer, secret }, { now = Date.now, jti = randomUUID } = {}) {
  if (!ISSUER.test(String(issuer ?? ''))) throw new Error('AMO_JWT_ISSUER inválido: use o "JWT issuer" da página de chaves da API (formato user:<número>:<número>)');
  if (!secret) throw new Error('AMO_JWT_SECRET vazio');
  const iat = Math.floor(now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: issuer, jti: jti(), iat, exp: iat + 60 }));
  const signature = createHmac('sha256', secret).update(`${head}.${claims}`).digest('base64url');
  return `${head}.${claims}.${signature}`;
}

const auth = (token) => ({ Authorization: `JWT ${token}` });

export async function uploadPackage({ token, zip, name, fetchImpl = globalThis.fetch }) {
  const form = new FormData();
  form.append('channel', 'listed');
  form.append('upload', new Blob([zip], { type: 'application/zip' }), name);
  return call(fetchImpl, `${API}/addons/upload/`, { method: 'POST', headers: auth(token), body: form }, 'enviar o pacote', 300_000);
}

// A AMO valida o pacote de forma assíncrona: consulta até "processed" e confere se é "valid".
export async function waitValidation({ token, upload, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxPolls = 30, pollMs = 10_000 }) {
  let current = upload;
  for (let i = 0; !current.processed; i += 1) {
    if (i >= maxPolls) throw new Error(`validar o pacote: a AMO não terminou depois de ${maxPolls} consultas`);
    await sleep(pollMs);
    current = await call(fetchImpl, `${API}/addons/upload/${encodeURIComponent(upload.uuid)}/`, { method: 'GET', headers: auth(token) }, 'consultar a validação');
  }
  if (!current.valid) {
    const errors = (current.validation?.messages ?? []).filter((m) => m.type === 'error').map((m) => m.message ?? m.id);
    throw new Error(`validar o pacote: a AMO recusou (${safe(errors.join('; ') || 'sem detalhe')})`);
  }
  return current;
}

export async function createVersion({ token, addonId, uploadUuid, fetchImpl = globalThis.fetch }) {
  return call(fetchImpl, `${API}/addons/addon/${encodeURIComponent(addonId)}/versions/`, {
    method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ upload: uploadUuid }),
  }, 'criar a versão');
}

export function readZipVersion(zipPath) {
  try {
    const manifest = JSON.parse(execFileSync('unzip', ['-p', zipPath, 'manifest.json'], { encoding: 'utf8' }));
    if (typeof manifest.version === 'string') return manifest.version;
  } catch { /* cai no erro abaixo */ }
  throw new Error(`o zip ${zipPath} não tem um manifest.json válido na raiz`);
}

// Confere o zip, envia, espera a validação e cria a versão. Nada vai à rede se a versão do zip não for a esperada.
export async function publishPackage({
  zipPath, expectVersion, issuer, secret, addonId = GECKO.id,
  fetchImpl = globalThis.fetch, sleep, log = console.log, dryRun = false, maskToken = () => {},
}) {
  const version = readZipVersion(zipPath);
  if (expectVersion && version !== expectVersion) throw new Error(`o zip é da versão ${version}, mas se esperava a ${expectVersion}`);
  const token = makeJwt({ issuer, secret });
  if (dryRun) {
    log(`dry-run: enviaria a versão ${version} (canal listado) do add-on ${addonId}. Nada foi enviado.`);
    return { dryRun: true, version };
  }
  maskToken(token);
  log(`Enviando a versão ${version}...`);
  const upload = await uploadPackage({ token, zip: readFileSync(zipPath), name: basename(zipPath), fetchImpl });
  await waitValidation({ token, upload, fetchImpl, sleep });
  log('Pacote validado pela AMO. Criando a versão...');
  // O token vale 60 s: depois da espera da validação, gera outro.
  const fresh = makeJwt({ issuer, secret });
  maskToken(fresh);
  const created = await createVersion({ token: fresh, addonId, uploadUuid: upload.uuid, fetchImpl });
  log(`Versão ${created.version ?? version} enviada à AMO (id ${created.id ?? '?'}). Fica em revisão e é publicada sozinha ao ser aprovada.`);
  return { version, created };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : undefined; };
  const zipPath = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--expect-version');
  const missing = ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET'].filter((k) => !process.env[k]);
  try {
    if (!zipPath) throw new Error('uso: node scripts/firefox-store.mjs <arquivo.zip> [--expect-version X.Y.Z] [--dry-run]');
    if (missing.length) throw new Error(`faltam as variáveis de ambiente: ${missing.join(', ')}`);
    await publishPackage({
      zipPath,
      expectVersion: flag('--expect-version'),
      issuer: process.env.AMO_JWT_ISSUER,
      secret: process.env.AMO_JWT_SECRET,
      dryRun: args.includes('--dry-run'),
      // o JWT é derivado (o GitHub não o conhece como segredo): pede ao Actions para mascará-lo nos logs
      maskToken: (t) => { if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${t}`); },
    });
  } catch (e) {
    console.error(`ERRO: ${safe(e.message)}`);
    process.exit(1);
  }
}
