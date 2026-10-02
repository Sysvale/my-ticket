import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEME_BG, contrast, luminance, mix, themed } from '../extension/src/color.js';

const css = readFileSync(new URL('../extension/ui.css', import.meta.url), 'utf8');

// Declarações `--nome: valor` de um bloco, em objeto.
const vars = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
// Corpo do primeiro bloco `seletor { ... }` (sem blocos aninhados).
const block = (selector) => {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0, `bloco não encontrado: ${selector}`);
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
};

const bySystem = vars(block(':root:not([data-theme="light"])'));
const forced = vars(block(':root[data-theme="dark"]'));
const neon = vars(block(':root[data-neon]'));

test('o escuro escolhido nas Opções tem as mesmas cores do escuro do sistema', () => {
  assert.ok(Object.keys(bySystem).length >= 14);
  assert.deepEqual(forced, bySystem);
});

test('todo @media escuro do ui.css respeita o "claro" escolhido nas Opções', () => {
  const dark = [...css.matchAll(/@media \(prefers-color-scheme: dark\)\s*\{\s*([^{]+)\{/g)];
  assert.ok(dark.length >= 2);
  for (const m of dark) assert.match(m[1], /:not\(\[data-theme="light"\]\)/, `sem o guarda do tema claro: ${m[1].trim()}`);
});

test('as cores do neon são legíveis sobre o fundo do card e sobre o chip tingido', () => {
  const surface = neon['--surface'];
  for (const name of ['--text', '--muted', '--accent', '--ok', '--warn', '--danger', '--info', '--tag-purple', '--tag-teal', '--tag-pink']) {
    const c = neon[name];
    assert.ok(contrast(c, surface) >= 4.5, `${name} sobre o card: ${contrast(c, surface).toFixed(2)}`);
    assert.ok(contrast(c, neon['--bg']) >= 4.5, `${name} sobre o fundo`);
    assert.ok(contrast(c, mix(surface, c, 0.14)) >= 4.5, `${name} sobre o chip tingido`);
  }
  assert.ok(contrast(neon['--on-accent'], neon['--accent']) >= 4.5, 'texto do botão principal');
});

test('o fundo do neon é mais escuro que o escuro de antes: a cor de tag calculada para o antigo nunca fica pior', () => {
  assert.equal(THEME_BG.dark, bySystem['--surface']); // src/color.js calcula contra este fundo
  assert.ok(luminance(neon['--surface']) <= luminance(THEME_BG.dark));
  for (const hex of ['#ffff00', '#000080', '#7c3aed', '#ff0000', '#00ff00', '#123456']) {
    const text = themed(hex).dark;
    const old = THEME_BG.dark;
    assert.ok(contrast(text, neon['--surface']) >= contrast(text, old), `${hex} sobre o card`);
    assert.ok(contrast(text, neon['--surface']) >= 4.5, `${hex} sobre o card (mínimo)`);
    // o chip é tingido com a própria cor da tag: aqui só se afirma que o neon não piora o escuro de antes
    assert.ok(contrast(text, mix(neon['--surface'], text, 0.14)) >= contrast(text, mix(old, text, 0.14)), `${hex} sobre o chip tingido`);
  }
});

test('o neon não troca o claro: só existe sob data-neon', () => {
  const start = css.indexOf('efeito neon (Opções');
  const end = css.indexOf('/* ---------- ', start); // a próxima seção, se houver
  const rules = [...css.slice(start, end < 0 ? undefined : end).matchAll(/^([^\n{]+)\{/gm)].map((m) => m[1].trim()).filter((r) => r && !r.startsWith('/*') && !r.startsWith('@'));
  assert.ok(rules.length > 10);
  for (const r of rules) assert.match(r, /\[data-neon\]/, r);
});
