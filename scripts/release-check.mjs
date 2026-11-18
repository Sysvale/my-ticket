// Confere se a tag de release bate com a versão da extensão antes de gerar qualquer pacote.
// As lojas não aceitam a mesma versão duas vezes: tag, manifest.json e package.json precisam concordar.
//
//   node scripts/release-check.mjs v0.1.2     (sai com 1 e explica o que está errado)
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function checkRelease(tag, { manifest, pkg }) {
  const erros = [];
  if (!/^v\d+\.\d+\.\d+$/.test(String(tag ?? ''))) {
    erros.push(`a tag ${JSON.stringify(tag)} fora do formato vX.Y.Z (ex.: v0.1.2); pré-lançamentos e 4 números não são usados`);
    return erros;
  }
  if (tag.slice(1) !== manifest.version) {
    erros.push(`a tag ${tag} não bate com a versão do extension/manifest.json (${manifest.version}); suba a versão antes de criar a tag`);
  }
  if (pkg.version !== manifest.version) {
    erros.push(`o package.json (${pkg.version}) e o extension/manifest.json (${manifest.version}) têm versões diferentes`);
  }
  return erros;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
  const erros = checkRelease(process.argv[2], { manifest: read('extension/manifest.json'), pkg: read('package.json') });
  if (erros.length) {
    for (const e of erros) console.error(`ERRO: ${e}`);
    process.exit(1);
  }
  console.log(`Versão ${process.argv[2]} confere com o manifest.json e o package.json.`);
}
