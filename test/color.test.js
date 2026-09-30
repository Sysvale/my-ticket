import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHIP_TINT, THEME_BG, contrast, isHex, luminance, mix, normalizeHex, readableOn, themed } from '../extension/src/color.js';

test('normalizeHex e isHex: só #rrggbb chega ao CSS', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex('123456'), '#123456');
  assert.equal(normalizeHex('#12345'), null);
  assert.equal(normalizeHex('#123456; x'), null);
  assert.equal(isHex('#aabbcc'), true);
  for (const no of ['#AABBCC', '#abc', 'aabbcc', 'red', '', null, undefined, 5]) assert.equal(isHex(no), false, String(no));
});

test('contraste WCAG: valores conhecidos', () => {
  assert.equal(luminance('#000000'), 0);
  assert.equal(luminance('#ffffff'), 1);
  assert.equal(Math.round(contrast('#000000', '#ffffff')), 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.ok(contrast('#767676', '#ffffff') >= 4.5 && contrast('#777777', '#ffffff') < 4.6); // o cinza clássico do limite
});

test('readableOn: cor já legível não muda; ilegível é escurecida (fundo claro) ou clareada (fundo escuro)', () => {
  assert.equal(readableOn('#1b2230', THEME_BG.light), '#1b2230'); // já legível
  const yellow = readableOn('#ffff00', THEME_BG.light);
  assert.notEqual(yellow, '#ffff00');
  assert.ok(contrast(yellow, THEME_BG.light) >= 4.5);
  assert.ok(luminance(yellow) < luminance('#ffff00')); // escureceu
  const navy = readableOn('#000080', THEME_BG.dark);
  assert.ok(contrast(navy, THEME_BG.dark) >= 4.5);
  assert.ok(luminance(navy) > luminance('#000080')); // clareou
});

test('qualquer cor fica legível nos dois temas (varredura de extremos e de 1500 cores)', () => {
  const samples = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#808080', '#f5f6f8', '#1a1e26', '#fefefe', '#010101'];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 1500; i += 1) samples.push(`#${[0, 0, 0].map(() => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join('')}`);
  for (const hex of samples) {
    const t = themed(hex);
    assert.match(t.light, /^#[0-9a-f]{6}$/);
    assert.match(t.dark, /^#[0-9a-f]{6}$/);
    // o texto do chip fica sobre o card E sobre o fundo do chip, tingido com a própria cor da tag
    for (const [tone, color] of [['claro', t.light], ['escuro', t.dark]]) {
      const bg = THEME_BG[tone === 'claro' ? 'light' : 'dark'];
      assert.ok(contrast(color, bg) >= 4.5, `${hex} no tema ${tone} sobre o card: ${color}`);
      assert.ok(contrast(color, mix(bg, hex, CHIP_TINT)) >= 4.5, `${hex} no tema ${tone} sobre o chip: ${color}`);
    }
    // botão marcado: fundo = a cor ajustada, texto = branco (tema claro) ou o azul-escuro do ui.css (tema escuro)
    assert.ok(contrast(t.light, '#ffffff') >= 4.5, `${hex}: texto branco sobre ${t.light}`);
    assert.ok(contrast(t.dark, '#0b1220') >= 4.5, `${hex}: texto escuro sobre ${t.dark}`);
  }
});

test('mix se comporta como o color-mix do CSS', () => {
  assert.equal(mix('#000000', '#ffffff', 0), '#000000');
  assert.equal(mix('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mix('#102030', '#102030', 0.14), '#102030');
});
