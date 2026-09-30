import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAttention } from '../extension/src/attention.js';
import { mergeConfig } from '../extension/src/store.js';

test('normalizeAttention: pisca por padrão e só fixa quando pedido', () => {
  assert.deepEqual(normalizeAttention(undefined), { flash: true, sticky: false });
  assert.deepEqual(normalizeAttention({}), { flash: true, sticky: false });
  assert.deepEqual(normalizeAttention({ flash: false, sticky: true }), { flash: false, sticky: true });
  assert.deepEqual(normalizeAttention({ flash: 0, sticky: 1 }), { flash: true, sticky: true }); // só `false` desliga o pisca
});

test('config antiga, sem o campo, ganha os padrões de atenção', () => {
  assert.deepEqual(mergeConfig({ appToken: 'a' }).attention, { flash: true, sticky: false });
  assert.deepEqual(mergeConfig({ attention: { sticky: true } }).attention, { flash: true, sticky: true });
});
