// Envia um zip à Chrome Web Store pela API v2 (https://developer.chrome.com/docs/webstore/api): upload, publicação e status.
// Sem dependências: só fetch e node:crypto. Autentica com uma conta de serviço do Google Cloud (JWT RS256), então não há
// refresh token de ninguém e a chave pode ser revogada a qualquer momento.
//
//   node scripts/chrome-store.mjs dist/my-ticket-0.1.2.zip --expect-version 0.1.2 [--publish-type STAGED_PUBLISH] [--dry-run]
//
// Variáveis de ambiente (nunca impressas):
//   CWS_PUBLISHER_ID, CWS_EXTENSION_ID, CWS_SERVICE_ACCOUNT_JSON (o JSON inteiro da chave da conta de serviço)
//
// A API não cria itens: a primeira versão é sempre enviada pelo Developer Dashboard (já foi feita).
import { createSign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://chromewebstore.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
// STAGED_PUBLISH: depois de aprovada, a versão fica "pronta" e quem manda clica em publicar no Dashboard.
// DEFAULT_PUBLISH: publica sozinha assim que for aprovada.
const PUBLISH_TYPES = ['STAGED_PUBLISH', 'DEFAULT_PUBLISH'];
const PUBLISHER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ITEM_ID = /^[a-p]{32}$/;

// O que vai para uma mensagem de erro nunca leva token, chave nem a resposta inteira.
function safe(text, max = 400) {
  return String(text)
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/ya29\.[\w.-]+/g, '***')
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '***')
    .slice(0, max);
}

function detailOf(data, text) {
  if (data?.error && typeof data.error === 'object') return data.error.message ?? JSON.stringify(data.error);
  if (data?.error) return [data.error, data.error_description].filter(Boolean).join(': ');
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

function assertIds({ publisherId, itemId }) {
  if (!PUBLISHER_ID.test(String(publisherId ?? ''))) throw new Error('id do publisher inválido (CWS_PUBLISHER_ID): use o ID de Configurações → Publisher no Dashboard');
  if (!ITEM_ID.test(String(itemId ?? ''))) throw new Error('id da extensão inválido (CWS_EXTENSION_ID): são 32 letras de a a p');
}

export function parseServiceAccount(raw) {
  let key;
  try { key = JSON.parse(String(raw ?? '')); } catch { key = null; }
  if (!key || typeof key.client_email !== 'string' || typeof key.private_key !== 'string' || !key.private_key.includes('PRIVATE KEY')) {
    throw new Error('CWS_SERVICE_ACCOUNT_JSON inválido: precisa ser o JSON da chave da conta de serviço (com client_email e private_key)');
  }
  return { client_email: key.client_email, private_key: key.private_key };
}

const b64url = (v) => Buffer.from(v).toString('base64url');

export async function accessToken(serviceAccount, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const iat = Math.floor(now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: serviceAccount.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(serviceAccount.private_key).toString('base64url');
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${signature}` });
  const data = await call(fetchImpl, TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
  }, 'obter o token de acesso');
  if (!data.access_token) throw new Error('obter o token de acesso: resposta sem access_token');
  return data.access_token;
}

const itemPath = ({ publisherId, itemId }) => `publishers/${publisherId}/items/${itemId}`;
const auth = (token) => ({ Authorization: `Bearer ${token}` });

export async function fetchStatus({ token, publisherId, itemId, fetchImpl = globalThis.fetch }) {
  assertIds({ publisherId, itemId });
  return call(fetchImpl, `${API}/v2/${itemPath({ publisherId, itemId })}:fetchStatus`, { method: 'GET', headers: auth(token) }, 'consultar o status');
}

export async function uploadPackage({ token, publisherId, itemId, zip, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxPolls = 30, pollMs = 10_000 }) {
  assertIds({ publisherId, itemId });
  const data = await call(fetchImpl, `${API}/upload/v2/${itemPath({ publisherId, itemId })}:upload`, {
    method: 'POST', headers: auth(token), body: zip,
  }, 'enviar o pacote', 300_000);
  if (data.uploadState === 'SUCCEEDED') return data;
  if (data.uploadState !== 'IN_PROGRESS') throw new Error(`enviar o pacote: a loja não aceitou (uploadState=${data.uploadState ?? 'ausente'})`);
  for (let i = 0; i < maxPolls; i += 1) {
    await sleep(pollMs);
    const { lastAsyncUploadState: state } = await fetchStatus({ token, publisherId, itemId, fetchImpl });
    if (state === 'SUCCEEDED') return { ...data, uploadState: 'SUCCEEDED' };
    if (state === 'FAILED') throw new Error('enviar o pacote: a loja recusou o upload (FAILED)');
  }
  throw new Error(`enviar o pacote: o upload não terminou depois de ${maxPolls} consultas`);
}

export async function publishItem({ token, publisherId, itemId, publishType = 'STAGED_PUBLISH', fetchImpl = globalThis.fetch }) {
  assertIds({ publisherId, itemId });
  if (!PUBLISH_TYPES.includes(publishType)) throw new Error(`publishType inválido: use ${PUBLISH_TYPES.join(' ou ')}`);
  return call(fetchImpl, `${API}/v2/${itemPath({ publisherId, itemId })}:publish`, {
    method: 'POST', headers: { ...auth(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ publishType }),
  }, 'enviar para revisão');
}

export function readZipVersion(zipPath) {
  try {
    const manifest = JSON.parse(execFileSync('unzip', ['-p', zipPath, 'manifest.json'], { encoding: 'utf8' }));
    if (typeof manifest.version === 'string') return manifest.version;
  } catch { /* cai no erro abaixo */ }
  throw new Error(`o zip ${zipPath} não tem um manifest.json válido na raiz`);
}

// Confere o zip, envia, submete à revisão e devolve o estado. Nada vai à rede se a versão do zip não for a esperada.
export async function publishPackage({
  zipPath, expectVersion, publisherId, itemId, serviceAccount, publishType = 'STAGED_PUBLISH',
  fetchImpl = globalThis.fetch, sleep, log = console.log, dryRun = false, maskToken = () => {},
}) {
  const version = readZipVersion(zipPath);
  if (expectVersion && version !== expectVersion) throw new Error(`o zip é da versão ${version}, mas se esperava a ${expectVersion}`);
  assertIds({ publisherId, itemId });
  if (!PUBLISH_TYPES.includes(publishType)) throw new Error(`publishType inválido: use ${PUBLISH_TYPES.join(' ou ')}`);
  if (dryRun) {
    log(`dry-run: enviaria a versão ${version} (${publishType}) da extensão ${itemId}. Nada foi enviado.`);
    return { dryRun: true, version };
  }
  const token = await accessToken(serviceAccount, { fetchImpl });
  maskToken(token);
  log(`Enviando a versão ${version}...`);
  await uploadPackage({ token, publisherId, itemId, zip: readFileSync(zipPath), fetchImpl, sleep });
  log('Pacote recebido pela loja. Enviando para revisão...');
  const published = await publishItem({ token, publisherId, itemId, publishType, fetchImpl });
  for (const w of published.warningInfo?.warnings ?? []) log(`Aviso da loja: ${safe(w.reason)} — ${safe(w.description)}`);
  const status = await fetchStatus({ token, publisherId, itemId, fetchImpl });
  log(`Estado: ${published.state} (revisão submetida: ${status.submittedItemRevisionStatus?.state ?? 'desconhecido'}).`);
  return { version, state: published.state, status };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i > -1 ? args[i + 1] : undefined; };
  const zipPath = args.find((a, i) => !a.startsWith('--') && !['--expect-version', '--publish-type'].includes(args[i - 1]));
  const missing = ['CWS_PUBLISHER_ID', 'CWS_EXTENSION_ID', 'CWS_SERVICE_ACCOUNT_JSON'].filter((k) => !process.env[k]);
  try {
    if (!zipPath) throw new Error('uso: node scripts/chrome-store.mjs <arquivo.zip> [--expect-version X.Y.Z] [--publish-type STAGED_PUBLISH|DEFAULT_PUBLISH] [--dry-run]');
    if (missing.length) throw new Error(`faltam as variáveis de ambiente: ${missing.join(', ')}`);
    await publishPackage({
      zipPath,
      expectVersion: flag('--expect-version'),
      publishType: flag('--publish-type') ?? 'STAGED_PUBLISH',
      publisherId: process.env.CWS_PUBLISHER_ID,
      itemId: process.env.CWS_EXTENSION_ID,
      serviceAccount: parseServiceAccount(process.env.CWS_SERVICE_ACCOUNT_JSON),
      dryRun: args.includes('--dry-run'),
      // o token de acesso é derivado (o GitHub não o conhece como segredo): pede ao Actions para mascará-lo nos logs
      maskToken: (t) => { if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${t}`); },
    });
  } catch (e) {
    console.error(`ERRO: ${safe(e.message)}`);
    process.exit(1);
  }
}
