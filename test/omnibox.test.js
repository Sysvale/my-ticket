import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYWORD, MAX_SUGGESTIONS, resolveInput, suggestionsFor } from '../extension/src/omnibox.js';
import { omniboxText } from '../extension/src/compat.js';

const T = (id, title, o = {}) => ({ id, title, entity: 'Município Alfa', dateMod: '2026-09-29 10:00:00', ...o });
const TICKETS = {
  148270: T(148270, 'Relatório mensal não gera', { dateMod: '2026-09-29 10:00:00' }),
  148271: T(148271, 'Bloqueio de agenda', { dateMod: '2026-09-30 09:00:00', entity: 'Município Beta' }),
  159919: T(159919, 'Exportação integração & relatório <urgente>', { dateMod: '2026-09-28 08:00:00' }),
  100: T(100, 'Erro de login', { dateMod: '2026-10-01 12:00:00' }),
};
const ids = (list) => list.map((s) => s.id);

test('a palavra-chave é "ticket" (digita-se "ticket 148270")', () => {
  assert.equal(KEYWORD, 'ticket');
  assert.equal(MAX_SUGGESTIONS, 5);
});

test('sem texto: os atualizados mais recentemente primeiro', () => {
  assert.deepEqual(ids(suggestionsFor('', TICKETS)), [100, 148271, 148270, 159919]);
  assert.deepEqual(ids(suggestionsFor('   ', TICKETS, { max: 2 })), [100, 148271]);
});

test('número: o que começa igual vem primeiro, e o número exato antes de todos', () => {
  assert.deepEqual(ids(suggestionsFor('1482', TICKETS)), [148271, 148270]); // prefixo, mais recente primeiro
  assert.deepEqual(ids(suggestionsFor('100', TICKETS)), [100]);
  assert.deepEqual(ids(suggestionsFor('#148270', TICKETS)), [148270]);
  assert.deepEqual(ids(suggestionsFor('9', TICKETS)), [159919]); // não é prefixo de nenhum: acha onde aparece (só o 159919 tem 9)
});

test('palavras do título (sem diferenciar acento) e da entidade; todas precisam casar', () => {
  assert.deepEqual(ids(suggestionsFor('relatorio mensal', TICKETS)), [148270]);
  assert.deepEqual(ids(suggestionsFor('RELATÓRIO', TICKETS)), [148270, 159919]);
  assert.deepEqual(ids(suggestionsFor('municipio beta', TICKETS)), [148271]);
  assert.deepEqual(ids(suggestionsFor('mensal agenda', TICKETS)), []);
  assert.deepEqual(suggestionsFor('xyz', TICKETS), []);
});

test('o rótulo traz número e título (cortado) e o conteúdo é só o número', () => {
  const [s] = suggestionsFor('148270', TICKETS);
  assert.deepEqual(s, { id: 148270, content: '148270', label: '#148270 — Relatório mensal não gera' });
  const long = suggestionsFor('7', { 7: T(7, 'x'.repeat(300)) })[0];
  assert.equal(long.label.length, '#7 — '.length + 100);
  assert.ok(long.label.endsWith('…'));
});

test('ocultar conteúdo: só o número, e o título nem entra na busca', () => {
  const list = suggestionsFor('mensal', TICKETS, { hideContent: true });
  assert.deepEqual(list, []); // o título não é pesquisável
  const [s] = suggestionsFor('148270', TICKETS, { hideContent: true });
  assert.equal(s.label, 'Ticket #148270');
  assert.doesNotMatch(JSON.stringify(suggestionsFor('', TICKETS, { hideContent: true })), /Relatório|mensal|agenda|login/i);
});

test('limita a quantidade e aceita lista, objeto e entradas inválidas', () => {
  const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i + 1, T(i + 1, `Ticket ${i}`)]));
  assert.equal(suggestionsFor('', many).length, 5);
  assert.equal(suggestionsFor('', Object.values(many), { max: 3 }).length, 3);
  assert.deepEqual(suggestionsFor('a', null), []);
  assert.deepEqual(suggestionsFor('a', [null, {}, { id: 'x' }, { id: 3.5 }]), []);
  assert.deepEqual(ids(suggestionsFor('', [{ id: 9 }])), [9]); // sem título nem data
});

test('resolveInput: número, "#número" e link do GLPI valem como estão, mesmo fora do radar', () => {
  assert.equal(resolveInput('148270', TICKETS), 148270);
  assert.equal(resolveInput('#148270', TICKETS), 148270);
  assert.equal(resolveInput('555', TICKETS), 555); // não está no cache: abre direto no GLPI
  assert.equal(resolveInput('https://glpi.test/front/ticket.form.php?id=777', TICKETS), 777);
});

test('resolveInput: texto livre só abre se casar com UM ticket do radar', () => {
  assert.equal(resolveInput('mensal', TICKETS), 148270); // um só
  assert.equal(resolveInput('relatorio', TICKETS), null); // dois: abrir um deles seria chute
  assert.equal(resolveInput('nada disso', TICKETS), null);
  assert.equal(resolveInput('', TICKETS), null);
  assert.equal(resolveInput(undefined, TICKETS), null);
  assert.equal(resolveInput('mensal', TICKETS, { hideContent: true }), null); // ocultar conteúdo: o título não vale
});

test('omniboxText: XML no Chrome/Edge (escapa), texto puro no Firefox', () => {
  assert.equal(omniboxText('A & B <urgente>'), 'A &amp; B &lt;urgente&gt;');
  assert.equal(omniboxText('A & B <urgente>', { firefox: true }), 'A & B <urgente>');
  assert.equal(omniboxText(undefined), '');
  assert.equal(omniboxText('&lt;'), '&amp;lt;'); // escapa uma vez só por chamada, sem adivinhar o que já veio escapado
});
