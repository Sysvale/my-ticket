// Gera o .zip que se envia à Chrome Web Store: só o conteúdo de extension/ (manifest.json na raiz do zip).
// Sem dependências; usa o `zip` do sistema.
//
//   npm run build:chrome                    -> dist/my-ticket-<versão>.zip
//   npm run build:chrome -- --out <arquivo> -> outro caminho
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'extension');

// Falha cedo com mensagem clara se o manifest não serve para a loja.
export function checkManifest(m) {
  const erros = [];
  if (m.manifest_version !== 3) erros.push('manifest_version deve ser 3');
  if (!/^\d+(\.\d+){0,3}$/.test(m.version || '')) erros.push('version deve ter até 4 números separados por ponto');
  if (!m.name || m.name.length > 75) erros.push('name é obrigatório (máx. 75 caracteres)');
  if (!m.description || m.description.length > 132) erros.push('description é obrigatória (máx. 132 caracteres)');
  for (const s of [16, 48, 128]) if (!m.icons?.[s]) erros.push(`falta o ícone de ${s}px`);
  return erros;
}

export function buildChrome(outFile, { src = SRC } = {}) {
  const out = resolve(outFile);
  if (out === src || out.startsWith(src + sep)) throw new Error('O zip não pode ser gravado dentro de extension/.');
  const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
  const erros = checkManifest(manifest);
  if (erros.length) throw new Error(`manifest.json inválido para a loja:\n - ${erros.join('\n - ')}`);
  for (const s of Object.values(manifest.icons)) {
    if (!existsSync(join(src, s))) throw new Error(`ícone ausente: ${s}`);
  }
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  // -X: sem atributos extras; -r: recursivo; ignora lixo de sistema.
  execFileSync('zip', ['-X', '-r', '-q', out, '.', '-x', '*.DS_Store', '-x', '*Thumbs.db'], { cwd: src });
  return { out, version: manifest.version };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const version = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8')).version;
  const target = i > -1 ? process.argv[i + 1] : join(ROOT, 'dist', `my-ticket-${version}.zip`);
  if (!target) {
    console.error('Faltou o caminho depois de --out.');
    process.exit(1);
  }
  try {
    const { out, version: v } = buildChrome(target);
    console.log(`Gerado: ${out} (versão ${v})`);
    console.log('Envie este arquivo em https://chrome.google.com/webstore/devconsole (veja guia-publish.md).');
  } catch (e) {
    console.error(`ERRO: ${e.message}`);
    process.exit(1);
  }
}
