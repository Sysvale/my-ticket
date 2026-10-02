import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPinned, normalizePinned, prunePinned, splitPinned, summaryText, togglePin } from '../extension/src/pins.js';

const T = (id) => ({ id, title: `T${id}` });
const TICKETS = [T(1), T(2), T(3), T(4), T(5)];
const ids = (list) => list.map((t) => t.id);

test('normalizePinned aceita só inteiros positivos, sem repetição, de qualquer lixo', () => {
  assert.deepEqual(normalizePinned([3, '4', 3, 0, -1, 1.5, 'x', null, undefined, {}, 7]), [3, 4, 7]);
  for (const lixo of [undefined, null, 'a', 5, {}, true]) assert.deepEqual(normalizePinned(lixo), []);
});

test('togglePin fixa e desafixa, mantendo a ordem em que foram fixados e sem limite', () => {
  const user = {};
  assert.equal(togglePin(user, 5), true);
  assert.equal(togglePin(user, 2), true);
  assert.equal(togglePin(user, '9'), true); // o id pode chegar como texto
  assert.deepEqual(user.pinned, [5, 2, 9]);
  assert.equal(togglePin(user, 2), false); // desafixa
  assert.deepEqual(user.pinned, [5, 9]);
  for (let i = 100; i < 150; i += 1) togglePin(user, i);
  assert.equal(user.pinned.length, 52); // sem limite de quantidade
  assert.equal(togglePin(user, 'abc'), false); // id inválido não entra
  assert.equal(togglePin(user, 0), false);
  assert.equal(user.pinned.length, 52);
});

test('isPinned olha a lista normalizada, mesmo com o campo ausente', () => {
  assert.equal(isPinned({ pinned: [1, 2] }, 2), true);
  assert.equal(isPinned({ pinned: [1, 2] }, '2'), true);
  assert.equal(isPinned({ pinned: [1, 2] }, 3), false);
  assert.equal(isPinned({}, 3), false);
  assert.equal(isPinned(undefined, 3), false);
});

test('splitPinned: fixados na ordem em que foram fixados, resto na ordem recebida, ignorando fixado que sumiu', () => {
  const { pinned, rest } = splitPinned(TICKETS, [4, 1, 99]);
  assert.deepEqual(ids(pinned), [4, 1]);
  assert.deepEqual(ids(rest), [2, 3, 5]);
  assert.deepEqual(ids(splitPinned(TICKETS, undefined).pinned), []);
  assert.deepEqual(ids(splitPinned(TICKETS, undefined).rest), [1, 2, 3, 4, 5]);
  assert.deepEqual(splitPinned([], [1]), { pinned: [], rest: [] });
});

test('prunePinned tira o que saiu do cache e diz se mudou algo', () => {
  const user = { pinned: [1, 2, 3] };
  assert.equal(prunePinned(user, { tickets: { 1: {}, 3: {} } }), true);
  assert.deepEqual(user.pinned, [1, 3]);
  assert.equal(prunePinned(user, { tickets: { 1: {}, 3: {} } }), false); // nada a tirar
  assert.equal(prunePinned({}, { tickets: {} }), false); // campo ausente
  const sujo = { pinned: ['2', 2, 'x'] };
  assert.equal(prunePinned(sujo, { tickets: { 2: {} } }), true);
  assert.deepEqual(sujo.pinned, [2]); // normaliza o que estiver gravado
  assert.equal(prunePinned({ pinned: [4] }, {}), true); // sem cache nenhum
});

test('summaryText: os fixados ficam de fora da conta dos filtros e o resumo avisa', () => {
  assert.equal(summaryText({ shown: 3, total: 12, pinned: 0 }), 'Mostrando 3 de 12');
  assert.equal(summaryText({ shown: 3, total: 10, pinned: 1 }), 'Mostrando 3 de 10 · 1 fixado à parte');
  assert.equal(summaryText({ shown: 0, total: 10, pinned: 2 }), 'Mostrando 0 de 10 · 2 fixados à parte');
});
