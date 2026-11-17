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
  toList,
} from '../extension/src/filters.js';

const t = (id, o = {}) => ({ id, title: 'Titulo', entity: 'Município Alfa', status: 2, priority: 3, extra: '', sources: ['assigned'], ...o });

const TICKETS = [
  t(1, { title: 'Relatório mensal não gera', entity: 'Município Alfa', priority: 4, extra: 'Em análise' }),
  t(2, { title: 'Bloqueio de agenda', entity: 'Município Beta', status: 4, priority: 5, extra: 'Devolvido', sources: ['observer'] }),
  t(3, { title: 'Exportação integração', entity: 'Município Alfa', status: 5, priority: 3, sources: ['requester', 'manual'] }),
  t(4, { title: 'Sem acesso', entity: '', status: null, priority: null, sources: ['manual'] }),
  t(5, { title: 'Erro de login', entity: 'Município Gama', status: 1, priority: 1 }),
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
  assert.deepEqual(ids({ entity: 'Município Alfa' }), [1, 3]);
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
  assert.deepEqual(ids({ q: 'MENSAL' }), [1]);
  assert.deepEqual(ids({ q: 'nao gera' }), [1]);
  assert.deepEqual(ids({ q: '#2' }), [2]);
  assert.deepEqual(ids({ q: 'municipio beta' }), [2]); // entidade
  assert.deepEqual(ids({ q: 'devolvido' }), [2]); // Status extra
  assert.deepEqual(ids({ q: 'municipio alfa relatorio' }), [1]);
  assert.deepEqual(ids({ q: 'municipio alfa agenda' }), []);
  assert.deepEqual(ids({ q: '   ' }), [1, 2, 3, 4, 5]);
});

test('filtros combinam com E', () => {
  assert.deepEqual(ids({ entity: 'Município Alfa', status: 'open' }), [1]);
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
    entities: ['Município Alfa', 'Município Beta', 'Município Gama'],
    extra: ['Devolvido', 'Em análise'],
    hasNoExtra: true,
  });
});

test('sanitizeFilters volta para "todos" quando o valor salvo não existe mais', () => {
  const options = filterOptions(TICKETS);
  assert.equal(sanitizeFilters({ entity: 'Jales' }, options).entity, 'all');
  assert.equal(sanitizeFilters({ entity: 'Município Alfa' }, options).entity, 'Município Alfa');
  assert.equal(sanitizeFilters({ extra: 'Fechado' }, options).extra, 'all');
  assert.equal(sanitizeFilters({ extra: NO_EXTRA }, options).extra, NO_EXTRA);
  assert.equal(sanitizeFilters({ extra: NO_EXTRA }, { ...options, hasNoExtra: false }).extra, 'all');
});

test('mergeFilters tolera lixo salvo e completa com os padrões', () => {
  assert.deepEqual(mergeFilters(null), DEFAULT_FILTERS);
  assert.deepEqual(mergeFilters('x'), DEFAULT_FILTERS);
  assert.deepEqual(mergeFilters({ q: 'a' }), { ...DEFAULT_FILTERS, q: 'a' });
});

test('mergeFilters devolve sempre uma lista de tags nova: mexer nela não altera os padrões', () => {
  const a = mergeFilters(null);
  a.tag.push('x');
  assert.deepEqual(DEFAULT_FILTERS.tag, []);
  assert.deepEqual(mergeFilters(null).tag, []);
  assert.throws(() => DEFAULT_FILTERS.tag.push('x')); // e os padrões não deixam ser alterados
});

test('toList aceita lista e o formato antigo (texto), sem repetidos, vazios nem "all"', () => {
  assert.deepEqual(toList(['a', 'b', 'a']), ['a', 'b']);
  assert.deepEqual(toList('a'), ['a']);
  assert.deepEqual(toList('all'), []);
  assert.deepEqual(toList(['all', '', 'a', 3, null, {}]), ['a']);
  for (const lixo of [undefined, null, 5, {}, true]) assert.deepEqual(toList(lixo), []);
});

test('um filtro de tag salvo como texto por uma versão antiga continua valendo', () => {
  assert.deepEqual(mergeFilters({ tag: 'all' }).tag, []);
  assert.deepEqual(mergeFilters({ tag: 'avisado' }).tag, ['avisado']);
  assert.deepEqual(mergeFilters({ tag: NO_TAG }).tag, [NO_TAG]);
});

// ---------- tags (as tags vêm do storage, não do ticket: entram por tagsOf) ----------
const PR = { id: 'pr-review', name: 'PR em review' };
const AVISADO = { id: 'avisado', name: 'Cliente avisado' };
const TAGGED = { 1: [PR, AVISADO], 2: [AVISADO], 5: [PR] };
const tagsOf = (x) => TAGGED[x.id] ?? [];
const idsTag = (f) => applyFilters(TICKETS, { ...DEFAULT_FILTERS, ...f }, undefined, tagsOf).map((x) => x.id);

test('filtro por tag: uma tag, "sem tag" e combinação com os outros filtros', () => {
  assert.deepEqual(idsTag({ tag: ['pr-review'] }), [1, 5]);
  assert.deepEqual(idsTag({ tag: ['avisado'] }), [1, 2]);
  assert.deepEqual(idsTag({ tag: [NO_TAG] }), [3, 4]);
  assert.deepEqual(idsTag({ tag: ['pr-review'], entity: 'Município Gama' }), [5]);
  assert.deepEqual(idsTag({}), [1, 2, 3, 4, 5]);
  assert.deepEqual(idsTag({ tag: [] }), [1, 2, 3, 4, 5]);
  // o formato antigo (texto) também filtra
  assert.deepEqual(idsTag({ tag: 'pr-review' }), [1, 5]);
  // sem tagsOf (chamadas antigas) o filtro "sem tag" enxerga tudo sem tag, e uma tag específica nada
  assert.deepEqual(applyFilters(TICKETS, { ...DEFAULT_FILTERS, tag: ['pr-review'] }).map((x) => x.id), []);
});

test('várias tags: o ticket aparece se tiver QUALQUER uma delas', () => {
  assert.deepEqual(idsTag({ tag: ['pr-review', 'avisado'] }), [1, 2, 5]);
  assert.deepEqual(idsTag({ tag: ['avisado', 'pr-review'] }), [1, 2, 5]); // a ordem da seleção não importa
  assert.deepEqual(idsTag({ tag: ['pr-review', 'avisado', 'nao-existe'] }), [1, 2, 5]);
  assert.deepEqual(idsTag({ tag: ['nao-existe'] }), []);
});

test('"Sem tag" junto de outras tags soma os tickets sem nenhuma com os que têm uma das escolhidas', () => {
  assert.deepEqual(idsTag({ tag: [NO_TAG, 'pr-review'] }), [1, 3, 4, 5]);
  assert.deepEqual(idsTag({ tag: [NO_TAG, 'avisado'] }), [1, 2, 3, 4]);
});

test('várias tags combinam com os outros filtros por E', () => {
  assert.deepEqual(idsTag({ tag: ['pr-review', 'avisado'], entity: 'Município Alfa' }), [1]);
  assert.deepEqual(idsTag({ tag: ['pr-review', 'avisado'], status: 'open', q: 'login' }), [5]);
  assert.deepEqual(idsTag({ tag: [NO_TAG, 'avisado'], role: 'manual' }), [3, 4]);
});

test('a busca por texto também acha o nome da tag (sem acento)', () => {
  assert.deepEqual(idsTag({ q: 'cliente avisado' }), [1, 2]);
  assert.deepEqual(idsTag({ q: 'pr review' }), [1, 5]);
  assert.deepEqual(idsTag({ q: 'homologacao' }), []);
  assert.deepEqual(idsTag({ q: 'pr em review sem acesso' }), []); // todas as palavras precisam casar no mesmo ticket
});

test('tag entra na contagem de filtros (uma seleção múltipla conta como um só)', () => {
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, tag: ['pr-review'] }), 1);
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, tag: ['pr-review', 'avisado', NO_TAG] }), 1);
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, tag: [NO_TAG] }, { panelOnly: true }), 1);
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, tag: ['avisado'], entity: 'Município Alfa' }, { panelOnly: true }), 2);
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, tag: 'avisado' }), 1); // formato antigo
  assert.equal(activeFilterCount({ ...DEFAULT_FILTERS, tag: 'all' }), 0);
});

test('tags apagadas saem da seleção; as que ainda existem e "Sem tag" ficam', () => {
  const options = { entities: [], extra: [], hasNoExtra: false, tags: ['avisado'] };
  assert.deepEqual(sanitizeFilters({ tag: ['pr-review'] }, options).tag, []); // a tag foi apagada
  assert.deepEqual(sanitizeFilters({ tag: ['pr-review', 'avisado', NO_TAG] }, options).tag, ['avisado', NO_TAG]);
  assert.deepEqual(sanitizeFilters({ tag: 'avisado' }, options).tag, ['avisado']);
  assert.deepEqual(sanitizeFilters({ tag: [NO_TAG] }, options).tag, [NO_TAG]);
  // sem a lista de tags (chamadas antigas), nada é corrigido
  assert.deepEqual(sanitizeFilters({ tag: ['qualquer'] }, { entities: [], extra: [], hasNoExtra: false }).tag, ['qualquer']);
});
