import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TAB, FORM_TABS, TABS, tabAfterKey, tabFromHash } from '../extension/src/tabs.js';

test('o link com # abre a aba certa; lixo cai na aba padrão (null)', () => {
  assert.deepEqual(TABS, ['conexao', 'avisos', 'tags', 'dados']);
  for (const id of TABS) assert.equal(tabFromHash(`#${id}`), id);
  assert.equal(tabFromHash('tags'), 'tags'); // sem o #
  for (const junk of ['', '#', '#outra', '#TAGS', '#tags ', undefined, null, 5, '#tags?x=1']) assert.equal(tabFromHash(junk), null);
  assert.equal(DEFAULT_TAB, 'conexao');
});

test('só as abas do formulário têm a barra de salvar (tags e dados locais agem na hora)', () => {
  assert.deepEqual([...FORM_TABS].sort(), ['avisos', 'conexao']);
  assert.ok(!FORM_TABS.has('tags') && !FORM_TABS.has('dados'));
});

test('teclado: setas andam em círculo, Home e End vão às pontas, o resto é ignorado', () => {
  assert.equal(tabAfterKey('conexao', 'ArrowRight'), 'avisos');
  assert.equal(tabAfterKey('dados', 'ArrowRight'), 'conexao'); // dá a volta
  assert.equal(tabAfterKey('conexao', 'ArrowLeft'), 'dados');
  assert.equal(tabAfterKey('tags', 'ArrowLeft'), 'avisos');
  assert.equal(tabAfterKey('tags', 'Home'), 'conexao');
  assert.equal(tabAfterKey('tags', 'End'), 'dados');
  assert.equal(tabAfterKey('tags', 'Enter'), null);
  assert.equal(tabAfterKey('inexistente', 'ArrowRight'), null);
});
