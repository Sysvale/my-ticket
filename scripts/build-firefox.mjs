// Gera a pasta que o Firefox carrega: uma cópia de extension/ com o manifest do Firefox (scripts/firefox-manifest.mjs).
// Chrome e Edge continuam carregando extension/ como está. Sem dependências.
//
//   npm run build:firefox                         -> dist/firefox
//   npm run build:firefox -- --out <pasta>        -> outra pasta (ex.: no disco do Windows, no WSL)
//   npm run build:firefox -- --zip                -> dist/my-ticket-firefox-<versão>.zip (o que se envia ao addons.mozilla.org)
//   npm run build:firefox -- --zip --out <arquivo>
//
// Depois: about:debugging#/runtime/this-firefox -> "Carregar extensão temporária" -> manifest.json da pasta gerada.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toFirefoxManifest } from './firefox-manifest.mjs';
import { zipDir } from './build-chrome.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'extension');

// A pasta de saída é apagada e refeita. Só aceita apagar o que está vazio ou é uma saída anterior (tem manifest.json),
// e nunca extension/ nem nada dentro dela.
export function buildFirefox(outDir, { src = SRC } = {}) {
  const out = resolve(outDir);
  if (out === src || out.startsWith(src + sep)) throw new Error('A saída não pode ser a própria pasta extension/.');
  if (existsSync(out) && readdirSync(out).length && !existsSync(join(out, 'manifest.json'))) {
    throw new Error(`${out} não está vazia e não parece uma saída anterior (sem manifest.json): não vou apagá-la.`);
  }
  const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(src, out, { recursive: true });
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(toFirefoxManifest(manifest), null, 2)}\n`);
  return out;
}

// O .zip para o addons.mozilla.org: o conteúdo de extension/ com o manifest do Firefox, montado numa pasta temporária.
export function buildFirefoxZip(outFile, { src = SRC } = {}) {
  const out = resolve(outFile);
  if (out === src || out.startsWith(src + sep)) throw new Error('O zip não pode ser gravado dentro de extension/.');
  const work = mkdtempSync(join(tmpdir(), 'myticket-ffzip-'));
  try {
    buildFirefox(join(work, 'ext'), { src });
    zipDir(join(work, 'ext'), out);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const zip = process.argv.includes('--zip');
  const version = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8')).version;
  const target = i > -1 ? process.argv[i + 1] : zip ? join(ROOT, 'dist', `my-ticket-firefox-${version}.zip`) : join(ROOT, 'dist', 'firefox');
  if (!target) {
    console.error('Faltou o caminho depois de --out.');
    process.exit(1);
  }
  try {
    if (zip) {
      console.log(`Gerado: ${buildFirefoxZip(target)} (versão ${version})`);
      console.log('Envie em https://addons.mozilla.org/developers/ (veja guia-publish.md).');
    } else {
      console.log(`Gerado em: ${buildFirefox(target)}`);
      console.log('No Firefox: about:debugging#/runtime/this-firefox → Carregar extensão temporária → manifest.json desta pasta.');
    }
  } catch (e) {
    console.error(`ERRO: ${e.message}`);
    process.exit(1);
  }
}
