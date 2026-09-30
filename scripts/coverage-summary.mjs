// Resume o lcov.info do coverage nativo do Node em markdown (comentário do PR e resumo do job). Sem dependências.
//   node scripts/coverage-summary.mjs coverage/lcov.info [pasta-do-código]
// TEST_OUTCOME (success | failure | cancelled | skipped), se definido, abre o texto com o resultado dos testes.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MARKER = '<!-- myticket-coverage -->'; // como o workflow acha o comentário para atualizá-lo em vez de repetir

const METRICS = [
  ['lines', 'Linhas', 'LF', 'LH'],
  ['branches', 'Branches', 'BRF', 'BRH'],
  ['functions', 'Funções', 'FNF', 'FNH'],
];
const OUTCOME_TEXT = {
  success: '✅ Testes passaram.',
  failure: '❌ Testes falharam: veja o log do job.',
  cancelled: '⚠️ Execução cancelada.',
  skipped: '⚠️ Testes não rodaram.',
};

const blank = () => Object.fromEntries(METRICS.map(([key]) => [key, { found: 0, hit: 0 }]));

// Um registro por arquivo (SF ... end_of_record), com os totais que o próprio lcov já traz.
export function parseLcov(text) {
  const files = [];
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    const cut = line.indexOf(':');
    const tag = cut < 0 ? line : line.slice(0, cut);
    const value = cut < 0 ? '' : line.slice(cut + 1);
    if (tag === 'SF') {
      cur = { file: value.replaceAll('\\', '/'), ...blank() };
    } else if (tag === 'end_of_record') {
      if (cur) files.push(cur);
      cur = null;
    } else if (cur) {
      for (const [key, , found, hit] of METRICS) {
        if (tag === found) cur[key].found = Number(value) || 0;
        if (tag === hit) cur[key].hit = Number(value) || 0;
      }
    }
  }
  return files;
}

export function totals(files) {
  const sum = blank();
  for (const f of files) for (const [key] of METRICS) {
    sum[key].found += f[key].found;
    sum[key].hit += f[key].hit;
  }
  return sum;
}

// "94,8%"; sem nada para cobrir (ex.: arquivo sem branches) vira "—", não 100%.
export const percent = ({ found, hit }) => (found ? `${(Math.round((hit / found) * 1000) / 10).toFixed(1).replace('.', ',')}%` : '—');
const ratio = ({ found, hit }) => `${hit} / ${found}`;
const ratioOf = ({ found, hit }) => (found ? hit / found : 1);

// `all` = todos os .js do código; o que não está no lcov nunca foi carregado por um teste.
export function untestedFiles(files, all) {
  const covered = new Set(files.map((f) => f.file));
  return all.filter((f) => !covered.has(f)).sort();
}

export function listSources(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map((p) => String(p).replaceAll('\\', '/'))
    .filter((p) => p.endsWith('.js'))
    .map((p) => `${dir.replace(/\/+$/, '')}/${p}`);
}

export function toMarkdown(files, { outcome, all = [] } = {}) {
  const out = [MARKER, '## Testes unitários e coverage', ''];
  if (OUTCOME_TEXT[outcome]) out.push(OUTCOME_TEXT[outcome], '');

  if (!files.length) {
    out.push('Nenhum coverage foi gerado (os testes falharam antes de terminar?).');
    return `${out.join('\n')}\n`;
  }

  const sum = totals(files);
  out.push('| Métrica | Cobertura | Cobertos / total |', '|---|---:|---:|');
  for (const [key, label] of METRICS) out.push(`| ${label} | **${percent(sum[key])}** | ${ratio(sum[key])} |`);

  // pior cobertura de linhas primeiro: é onde o olhar precisa ir
  const rows = [...files].sort((a, b) => ratioOf(a.lines) - ratioOf(b.lines) || a.file.localeCompare(b.file));
  out.push('', `<details><summary>Por arquivo (${rows.length})</summary>`, '',
    '| Arquivo | Linhas | Branches | Funções |', '|---|---:|---:|---:|');
  for (const f of rows) out.push(`| \`${f.file}\` | ${percent(f.lines)} | ${percent(f.branches)} | ${percent(f.functions)} |`);
  out.push('', '</details>');

  const missing = untestedFiles(files, all);
  out.push('', '> O coverage nativo do Node só conta os arquivos que algum teste carrega, então o percentual acima não inclui os outros.');
  if (missing.length) {
    out.push(`> Sem cobertura unitária (a interface é exercitada pelo e2e, \`npm run e2e\`, que não roda aqui): ${missing.map((f) => `\`${f}\``).join(', ')}.`);
  }
  return `${out.join('\n')}\n`;
}

// Só roda como script (não ao ser importado pelos testes).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [lcovPath, sourceDir = 'extension'] = process.argv.slice(2);
  if (!lcovPath) {
    process.stderr.write('uso: node scripts/coverage-summary.mjs <lcov.info> [pasta-do-código]\n');
    process.exit(2);
  }
  const files = existsSync(lcovPath) ? parseLcov(readFileSync(lcovPath, 'utf8')) : [];
  process.stdout.write(toMarkdown(files, { outcome: process.env.TEST_OUTCOME, all: listSources(sourceDir) }));
}
