import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKER, parseLcov, percent, toMarkdown, totals, untestedFiles } from '../scripts/coverage-summary.mjs';

const LCOV = `TN:
SF:extension/src/a.js
FNF:4
FNH:3
BRF:10
BRH:5
LF:20
LH:19
end_of_record
TN:
SF:extension/src/b.js
FNF:0
FNH:0
BRF:0
BRH:0
LF:10
LH:10
end_of_record
`;

test('parseLcov lê os totais de cada arquivo', () => {
  const files = parseLcov(LCOV);
  assert.deepEqual(files.map((f) => f.file), ['extension/src/a.js', 'extension/src/b.js']);
  assert.deepEqual(files[0].lines, { found: 20, hit: 19 });
  assert.deepEqual(files[0].branches, { found: 10, hit: 5 });
  assert.deepEqual(files[1].functions, { found: 0, hit: 0 });
});

test('parseLcov aceita Windows (CRLF, barras invertidas) e lixo sem quebrar', () => {
  const files = parseLcov('SF:extension\\src\\a.js\r\nLF:2\r\nLH:1\r\nend_of_record\r\nlixo sem dois pontos\r\nLF:9\r\n');
  assert.equal(files.length, 1);
  assert.equal(files[0].file, 'extension/src/a.js');
  assert.deepEqual(files[0].lines, { found: 2, hit: 1 }); // o LF solto depois do registro é ignorado
  assert.deepEqual(parseLcov(''), []);
});

test('percent: uma casa, vírgula, e "—" quando não há o que cobrir (não 100%)', () => {
  assert.equal(percent({ found: 20, hit: 19 }), '95,0%');
  assert.equal(percent({ found: 3, hit: 1 }), '33,3%');
  assert.equal(percent({ found: 0, hit: 0 }), '—');
});

test('totals soma tudo; untestedFiles aponta o que nenhum teste carregou', () => {
  const files = parseLcov(LCOV);
  assert.deepEqual(totals(files).lines, { found: 30, hit: 29 });
  assert.deepEqual(totals(files).branches, { found: 10, hit: 5 });
  assert.deepEqual(
    untestedFiles(files, ['extension/src/a.js', 'extension/popup.js', 'extension/guide.js']),
    ['extension/guide.js', 'extension/popup.js'],
  );
});

test('toMarkdown: marcador para atualizar o comentário, resultado dos testes, pior arquivo primeiro e aviso dos não carregados', () => {
  const md = toMarkdown(parseLcov(LCOV), { outcome: 'success', all: ['extension/src/a.js', 'extension/src/b.js', 'extension/popup.js'] });
  assert.ok(md.startsWith(`${MARKER}\n`));
  assert.match(md, /✅ Testes passaram\./);
  assert.match(md, /\| Linhas \| \*\*96,7%\*\* \| 29 \/ 30 \|/);
  assert.match(md, /\| Branches \| \*\*50,0%\*\* \| 5 \/ 10 \|/);
  assert.ok(md.indexOf('extension/src/a.js') < md.indexOf('extension/src/b.js'), 'a (95%) vem antes de b (100%)');
  assert.match(md, /Sem cobertura unitária .*`extension\/popup\.js`/);
  assert.doesNotMatch(md, /Sem cobertura unitária .*`extension\/src\/a\.js`/);
});

test('toMarkdown sem lcov (testes caíram antes) explica em vez de mostrar 0%; falha de teste é dita', () => {
  const md = toMarkdown([], { outcome: 'failure' });
  assert.match(md, /❌ Testes falharam/);
  assert.match(md, /Nenhum coverage foi gerado/);
  assert.doesNotMatch(md, /\| Linhas \|/);
  assert.doesNotMatch(toMarkdown(parseLcov(LCOV)), /Testes (passaram|falharam)/); // sem outcome, sem linha de resultado
});
