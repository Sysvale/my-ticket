import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FILTERS,
  NO_EXTRA,
  NO_TAG,
  activeFilterCount,
  applyFilters,
  filterOptions,
  mergeFilters,
  sanitizeFilters,
} from '../extension/src/filters.js';

const t = (id, o = {}) => ({ id, title: 'Titulo', entity: 'Município Beta', status: 2, priority: 3, extra: '', sources: ['assigned'], ...o });

const TICKETS = [
  t(1, { title: 'Relatório mensal não gera', entity: 'Município Beta', priority: 4, extra: 'Em análise' }),
  t(2, { title: 'Bloqueio de agenda', entity: 'Município Gama�', status: 4, priority: 5, extra: 'Devolvido', sources: ['observer'] }),
  t(3, { title: 'Exportação integração', entity: 'Município Beta', status: 5, priority: 3, sources: ['requester', 'manual'] }),
  t(4, { title: 'Sem acesso', entity: '', status: null, priority: null, sources: ['manual'] }),
  t(5, { title: 'Erro de login', entity: 'Município Alfa', status: 1, priority: 1 }),
];

const ids = (f, unread) => applyFilters(TICKETS, { ...DEFAULT_FILTERS, ...f }, unread).map((x) => x.id);

test('sem filtros, mostra tudo', () => {
  assert.deepEqual(ids({}), [1, 2, 3, 4, 5]);
});

test('status: em aberto, encerrados e status específico', () => {
  assert.deepEqual(ids({ status: 'open' }), [1, 2, 5]);
  assert.deepEqual(ids({ status: 'done' }), [3]);
  assert.deepEqual(ids({ status: '4' }), [2]);
  assert.deepEqual(ids({ status: '1' }), [5]);
});

test('papel, entidade e Status extra', () => {
  assert.deepEqual(ids({ role: 'assigned' }), [1, 5]);
  assert.deepEqual(ids({ role: 'observer' }), [2]);
  assert.deepEqual(ids({ role: 'requester' }), [3]);
  assert.deepEqual(ids({ role: 'manual' }), [3, 4]);
  assert.deepEqual(ids({ entity: 'Município Beta' }), [1, 3]);
  assert.deepEqual(ids({ extra: 'Devolvido' }), [2]);
  assert.deepEqual(ids({ extra: NO_EXTRA }), [3, 4, 5]);
});

test('prioridade: alta ou mais, média e baixa ou menos', () => {
  assert.deepEqual(ids({ priority: 'high' }), [1, 2]);
  assert.deepEqual(ids({ priority: 'medium' }), [3]);
  assert.deepEqual(ids({ priority: 'low' }), [5]);
});

test('só com novidades usa o callback de não lidos', () => {
  assert.deepEqual(ids({ unread: true }, (x) => x.id === 2), [2]);
  assert.deepEqual(ids({ unread: true }, () => false), []);
});

test('busca ignora acento e maiúsculas, aceita #número e várias palavras', () => {
  assert.deepEqual(ids({ q: 'mensal' }), [1]);
  assert.deepEqual(ids({ q: 'mensal' }), [1]);
  assert.deepEqual(ids({ q: 'nao gera' }), [1]);
  assert.deepEqual(ids({ q: '#2' }), [2]);
  assert.deepEqual(ids({ q: 'Município Gama' }), [2]); // entidade
  assert.deepEqual(ids({ q: 'devolvido' }), [2]); // Status extra
  assert.deepEqual(ids({ q: 'Município Beta relatorio' }), [1]);
  assert.deepEqual(ids({ q: 'Município Beta agenda' }), []);
  assert.deepEqual(ids({ q: '   ' }), [1, 2, 3, 4, 5]);
});

test('filtros combinam com E', () => {
  assert.deepEqual(ids({ entity: 'Município Beta', status: 'open' }), [1]);
  assert.deepEqual(ids({ role: 'assigned', priority: 'high', q: 'mensal' }), [1]);
  assert.deepEqual(ids({ role: 'manual', status: 'open' }), []);
});

test('ticket sem status (inacessível) só aparece com status "todos"', () => {
  assert.ok(ids({}).includes(4));
  for (const status of ['open', 'done', '1', '2']) assert.ok(!ids({ status }).includes(4));
});

test('activeFilterCount conta filtros ligados', () => {
  assert.equal(activeFilterCount(DEFAULT_FILTERS), 0);
  assert.equal(activeFilterCount({ q: '   ' }), 0);
  assert.equal(activeFilterCount({ q: 'x', unread: true, status: 'open' }), 3);
  // o botão "Filtros" só conta o que está dentro do painel
  assert.equal(activeFilterCount({ q: 'x', unread: true, status: 'open', role: 'manual' }, { panelOnly: true }), 2);
});

test('filterOptions lista entidades e valores de Extra ordenados', () => {
  assert.deepEqual(filterOptions(TICKETS), {
    entities: ['Município Alfa', 'Município Beta', 'Município Gama�'],
    extra: ['Devolvido', 'Em análise'],
    hasNoExtra: true,
  });
});

test('sanitizeFilters volta para "todos" quando o valor salvo não existe mais', () => {
  const options = filterOptions(TICKETS);
  assert.equal(sanitizeFilters({ entity: 'Jales' }, options).entity, 'all');
  assert.equal(sanitizeFilters({ entity: 'Município Beta' }, options).entity, 'Município Beta');
  assert.equal(sanitizeFilters({ extra: 'Fechado' }, options).extra, 'all');
  assert.equal(sanitizeFilters({ extra: NO_EXTRA }, options).extra, NO_EXTRA);
  assert.equal(sanitizeFilters({ extra: NO_EXTRA }, { ...options, hasNoExtra: false }).extra, 'all');
});

test('mergeFilters tolera lixo salvo e completa com os padrões', () => {
  assert.deepEqual(mergeFilters(null), DEFAULT_FILTERS);
  assert.deepEqual(mergeFilters('x'), DEFAULT_FILTERS);
  assert.deepEqual(mergeFilters({ q: 'a' }), { ...DEFAULT_FILTERS, q: 'a' });
});

// ---------- tags (as tags vêm do storage, não do ticket: entram por tagsOf) ----------
const PR = { id: 'pr-review', name: 'PR em review' };
const AVISADO = { id: 'avisado', name: 'Cliente avisado' };
const TAGGED = { 1: [PR, AVISADO], 2: [AVISADO], 5: [PR] };
const tagsOf = (x) => TAGGED[x.id] ?? [];
const idsTag = (f) => applyFilters(TICKETS, { ...DEFAULT_FILTERS, ...f }, undefined, tagsOf).map((x) => x.id);

test('filtro por tag: uma tag, "sem tag" e combinação com os outros filtros', () => {
  assert.deepEqual(idsTag({ tag: 'pr-review' }), [1, 5]);
  assert.deepEqual(idsTag({ tag: 'avisado' }), [1, 2]);
  assert.deepEqual(idsTag({ tag: NO_TAG }), [3, 4]);
  assert.deepEqual(idsTag({ tag: 'pr-review', entity: 'Município Alfa' }), [5]);
  assert.deepEqual(idsTag({}), [1, 2, 3, 4, 5]);
  // sem tagsOf (chamadas antigas) o filtro "sem tag" enxerga tudo sem tag, e uma tag específica nada
  assert.deepEqual(applyFilters(TICKETS, { ...DEFAULT_FILTERS, tag: 'pr-review' }).map((x) => x.id), []);
});

test('a busca por texto também acha o nome da tag (sem acento)', () => {
  assert.deepEqual(idsTag({ q: 'cliente avisado' }), [1, 2]);
  assert.deepEqual(idsTag({ q: 'pr review' }), [1, 5]);
  assert.deepEqual(idsTag({ q: 'homologacao' }), []);
  assert.deepEqual(idsTag({ q: 'pr em review sem acesso' }), []); // todas as palavras precisam casar no mesmo ticket
});

test('tag entra na contagem de filtros e uma tag apagada volta para "todas"', () => {
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, tag: 'pr-review' }), 1);
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, tag: NO_TAG }, { panelOnly: true }), 1);
  const options = { entities: [], extra: [], hasNoExtra: false, tags: ['avisado'] };
  assert.equal(sanitizeFilters({ tag: 'pr-review' }, options).tag, 'all'); // a tag foi apagada
  assert.equal(sanitizeFilters({ tag: 'avisado' }, options).tag, 'avisado');
  assert.equal(sanitizeFilters({ tag: NO_TAG }, options).tag, NO_TAG);
  // sem a lista de tags (chamadas antigas), nada é corrigido
  assert.equal(sanitizeFilters({ tag: 'qualquer' }, { entities: [], extra: [], hasNoExtra: false }).tag, 'qualquer');
});
