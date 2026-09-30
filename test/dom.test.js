import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagColor } from '../extension/src/dom.js';
import { TAG_COLORS } from '../extension/src/tags.js';
import { THEME_BG, contrast } from '../extension/src/color.js';

test('tagColor: cada cor da paleta vira a sua classe, sem estilo inline', () => {
  for (const c of TAG_COLORS) assert.deepEqual(tagColor(c), { cls: `tag-${c}`, style: undefined });
});

test('tagColor: hexadecimal vira classe personalizada e variáveis com o contraste ajustado para cada tema', () => {
  const { cls, style } = tagColor('#ffff00');
  assert.equal(cls, 'tag-custom');
  const vars = Object.fromEntries(style.split(';').map((p) => p.split(':')));
  assert.deepEqual(Object.keys(vars), ['--c-raw', '--c-light', '--c-dark']);
  assert.equal(vars['--c-raw'], '#ffff00'); // a cor exata, para a bolinha das Opções
  assert.ok(contrast(vars['--c-light'], THEME_BG.light) >= 4.5);
  assert.ok(contrast(vars['--c-dark'], THEME_BG.dark) >= 4.5);
  for (const v of Object.values(vars)) assert.match(v, /^#[0-9a-f]{6}$/); // só #rrggbb entra no estilo
});

test('tagColor: fallback para cinza, sem estilo, com qualquer coisa que não seja paleta nem #rrggbb', () => {
  for (const bad of ['#12345', '#ABCDEF', 'abc', 'red;', 'rgb(0,0,0)', '#fff;background:url(//evil)', '"><script>', 'javascript:alert(1)', '', null, undefined, 42, {}]) {
    const r = tagColor(bad);
    assert.equal(r.cls, 'tag-gray', String(bad));
    assert.equal(r.style, undefined, String(bad));
  }
});
