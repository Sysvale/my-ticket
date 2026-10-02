import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_APPEARANCE, THEMES, normalizeAppearance, rootAttributes } from '../extension/src/appearance.js';

test('o padrão segue o sistema e vem sem neon (quem já usa não vê mudança)', () => {
  assert.deepEqual(DEFAULT_APPEARANCE, { theme: 'auto', neon: false });
  assert.deepEqual(THEMES, ['auto', 'light', 'dark']);
});

test('normalizeAppearance aceita o válido e troca lixo pelo padrão, sempre devolvendo um objeto novo', () => {
  assert.deepEqual(normalizeAppearance({ theme: 'dark', neon: true }), { theme: 'dark', neon: true });
  assert.deepEqual(normalizeAppearance({ theme: 'light' }), { theme: 'light', neon: false });
  for (const lixo of [null, undefined, 5, 'dark', [], { theme: 'roxo' }, { theme: 3, neon: 'true' }, { neon: 1 }]) {
    assert.deepEqual(normalizeAppearance(lixo), { theme: 'auto', neon: false }, JSON.stringify(lixo));
  }
  const a = normalizeAppearance(null);
  a.neon = true;
  assert.equal(normalizeAppearance(null).neon, false);
  assert.throws(() => { DEFAULT_APPEARANCE.neon = true; }, TypeError); // os padrões não deixam ser alterados
});

test('rootAttributes: o tema só vira atributo quando a pessoa escolheu', () => {
  assert.equal(rootAttributes({ theme: 'auto' }, true).theme, null);
  assert.equal(rootAttributes({ theme: 'auto' }, false).theme, null);
  assert.equal(rootAttributes({ theme: 'light' }, true).theme, 'light');
  assert.equal(rootAttributes({ theme: 'dark' }, false).theme, 'dark');
});

test('rootAttributes: o neon só liga com o tema escuro em uso', () => {
  const neon = (theme, systemDark) => rootAttributes({ theme, neon: true }, systemDark).neon;
  assert.equal(neon('auto', true), true); // automático com o sistema escuro
  assert.equal(neon('auto', false), false); // automático com o sistema claro
  assert.equal(neon('dark', false), true); // escuro escolhido, mesmo com o sistema claro
  assert.equal(neon('light', true), false); // claro escolhido, mesmo com o sistema escuro
  assert.equal(rootAttributes({ theme: 'dark', neon: false }, true).neon, false); // desligado
});

test('rootAttributes tolera lixo', () => {
  assert.deepEqual(rootAttributes(null, true), { theme: null, neon: false });
  assert.deepEqual(rootAttributes({ theme: 'x', neon: true }, true), { theme: null, neon: true });
});
