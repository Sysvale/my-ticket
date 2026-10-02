import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialIndex, searchOptions, statusText, stepIndex, summarize, toggleValue } from '../extension/src/picker.js';

const OPTS = [
  { value: '__none__', label: 'Sem tag' },
  { value: 'pr', label: 'PR em review' },
  { value: 'cli', label: 'Cliente avisado' },
  { value: 'hom', label: 'Em homologação/suporte' },
  { value: 'nao', label: 'Não reproduzido' },
];
const values = (list) => list.map((o) => o.value);

test('searchOptions: busca vazia devolve tudo, na ordem original', () => {
  assert.equal(searchOptions(OPTS, ''), OPTS);
  assert.equal(searchOptions(OPTS, '   '), OPTS);
  assert.equal(searchOptions(OPTS, undefined), OPTS);
});

test('searchOptions: ignora acento e maiúscula e acha em qualquer parte do texto', () => {
  assert.deepEqual(values(searchOptions(OPTS, 'homologacao')), ['hom']);
  assert.deepEqual(values(searchOptions(OPTS, 'HOMOLOGAÇÃO')), ['hom']);
  assert.deepEqual(values(searchOptions(OPTS, 'nao repro')), ['nao']);
  assert.deepEqual(values(searchOptions(OPTS, 'view')), ['pr']);
  assert.deepEqual(values(searchOptions(OPTS, 'em')), ['__none__', 'pr', 'hom']); // "em" está em "Sem tag" também
});

test('searchOptions: várias palavras precisam estar todas no mesmo texto, em qualquer ordem', () => {
  assert.deepEqual(values(searchOptions(OPTS, 'review pr')), ['pr']);
  assert.deepEqual(values(searchOptions(OPTS, 'cliente review')), []);
  assert.deepEqual(searchOptions(OPTS, 'zzz'), []);
});

test('searchOptions: não interpreta a busca como expressão regular nem HTML', () => {
  assert.deepEqual(searchOptions(OPTS, '.*'), []);
  assert.deepEqual(searchOptions(OPTS, '(['), []);
  assert.deepEqual(searchOptions(OPTS, '<img src=x>'), []);
});

test('toggleValue: marca e desmarca sem alterar a lista original', () => {
  const a = ['x'];
  const b = toggleValue(a, 'y');
  assert.deepEqual(b, ['x', 'y']);
  assert.deepEqual(a, ['x']);
  assert.deepEqual(toggleValue(b, 'x'), ['y']);
  assert.deepEqual(toggleValue([], 'x'), ['x']);
  assert.deepEqual(toggleValue(['x'], 'x'), []);
});

test('stepIndex: dá a volta nas pontas e trata lista vazia e "nenhum ativo"', () => {
  assert.equal(stepIndex(0, 1, 3), 1);
  assert.equal(stepIndex(2, 1, 3), 0);
  assert.equal(stepIndex(0, -1, 3), 2);
  assert.equal(stepIndex(1, -1, 3), 0);
  assert.equal(stepIndex(-1, 1, 3), 0); // ↓ sem ativo: o primeiro
  assert.equal(stepIndex(-1, -1, 3), 2); // ↑ sem ativo: o último
  assert.equal(stepIndex(0, 1, 1), 0);
  assert.equal(stepIndex(0, 1, 0), -1);
  assert.equal(stepIndex(-1, -1, 0), -1);
});

test('initialIndex: começa no primeiro selecionado que aparece, senão no primeiro', () => {
  assert.equal(initialIndex(OPTS, ['cli', 'hom']), 2);
  assert.equal(initialIndex(OPTS, []), 0);
  assert.equal(initialIndex(OPTS, ['nao-existe']), 0);
  assert.equal(initialIndex([], ['cli']), -1);
});

test('summarize: nada marcado, uma escolha (o nome) e várias (a contagem)', () => {
  const text = { all: 'Qualquer tag', many: (n) => `${n} tags` };
  assert.deepEqual(summarize(OPTS, [], text), { text: 'Qualquer tag', labels: [] });
  assert.deepEqual(summarize(OPTS, ['pr'], text), { text: 'PR em review', labels: ['PR em review'] });
  const two = summarize(OPTS, ['pr', '__none__'], text);
  assert.equal(two.text, '2 tags');
  assert.deepEqual(two.labels, ['Sem tag', 'PR em review']); // na ordem da lista
  assert.equal(summarize(OPTS, ['sumiu'], text).text, 'Qualquer tag'); // valor que não existe mais é ignorado
});

test('statusText: o que é dito ao filtrar e ao marcar', () => {
  assert.equal(statusText({ shown: 3, total: 12, selected: 0, multiple: true, searching: true }), '3 de 12');
  assert.equal(statusText({ shown: 0, total: 12, selected: 0, multiple: true, searching: true }), 'Nenhum resultado');
  assert.equal(statusText({ shown: 12, total: 12, selected: 1, multiple: true, searching: false }), '1 marcada');
  assert.equal(statusText({ shown: 12, total: 12, selected: 3, multiple: true, searching: false }), '3 marcadas');
  assert.equal(statusText({ shown: 12, total: 12, selected: 0, multiple: true, searching: false }), '12 opções');
  assert.equal(statusText({ shown: 1, total: 1, selected: 0, multiple: true, searching: false }), '1 opção');
  assert.equal(statusText({ shown: 5, total: 5, selected: 1, multiple: false, searching: false }), '');
});
