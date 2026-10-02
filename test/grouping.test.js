import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_LABEL,
  GROUP_MODES,
  groupTickets,
  isSectionOpen,
  normalizeGroupBy,
  normalizeSections,
  withSectionOpen,
} from '../extension/src/grouping.js';

const mod = (d) => `2026-09-${String(d).padStart(2, '0')} 10:00:00`;
const T = (id, o = {}) => ({ id, title: `T${id}`, status: 2, priority: 3, dateMod: mod(10), ...o });
const ms = (t) => Date.parse(t.dateMod.replace(' ', 'T'));

function ctxFor({ unread = [], lastAt = {}, stage = {}, stages = [{ id: 'andamento', name: 'Em andamento' }, { id: 'review', name: 'PR em review' }] } = {}) {
  return { isUnread: (t) => unread.includes(t.id), lastEventAt: (t) => lastAt[t.id] ?? 0, modMs: ms, stageOf: (t) => stages.find((s) => s.id === stage[t.id]) ?? null, stages };
}
const ids = (section) => section.tickets.map((t) => t.id);
const shape = (sections) => sections.map((s) => [s.id, s.title, ids(s)]);

const TICKETS = [
  T(1, { status: 1, priority: 6, dateMod: mod(5) }),
  T(2, { status: 2, priority: 4, dateMod: mod(20) }),
  T(3, { status: 2, priority: 4, dateMod: mod(25) }),
  T(4, { status: 4, priority: 2, dateMod: mod(15) }),
  T(5, { status: 5, priority: 3, dateMod: mod(2) }),
  T(6, { status: 6, priority: 1, dateMod: mod(1) }),
  T(7, { status: 3, priority: 5, dateMod: mod(12) }),
];

test('modos e rótulos', () => {
  assert.deepEqual(GROUP_MODES, ['padrao', 'status', 'prioridade', 'etapa']);
  for (const m of GROUP_MODES) assert.ok(GROUP_LABEL[m]);
  for (const ok of GROUP_MODES) assert.equal(normalizeGroupBy(ok), ok);
  for (const lixo of [undefined, null, 'x', 3, {}, 'STATUS']) assert.equal(normalizeGroupBy(lixo), 'padrao');
});

test('padrão: Novidades no topo (pela última novidade), depois Acompanhando e Encerrados (fechado de início)', () => {
  const out = groupTickets(TICKETS, 'padrao', ctxFor({ unread: [4, 7], lastAt: { 4: 100, 7: 200 } }));
  assert.deepEqual(shape(out), [
    ['news', 'Novidades', [7, 4]], // a novidade mais recente primeiro
    ['padrao:acompanhando', 'Acompanhando', [3, 2, 1]], // atualização mais recente primeiro
    ['padrao:encerrados', 'Encerrados', [5, 6]],
  ]);
  assert.deepEqual(out.map((s) => s.open), [true, true, false]);
});

test('sem novidades não há seção Novidades, e o mais recente de atualização vem primeiro em cada grupo', () => {
  const out = groupTickets(TICKETS, 'padrao', ctxFor());
  assert.deepEqual(out.map((s) => s.id), ['padrao:acompanhando', 'padrao:encerrados']);
  assert.deepEqual(ids(out[0]), [3, 2, 4, 7, 1].sort((a, b) => ms(TICKETS.find((t) => t.id === b)) - ms(TICKETS.find((t) => t.id === a))));
  assert.equal(ids(out[0])[0], 3); // o de dateMod mais novo
});

test('status: na ordem do fluxo, sem grupo vazio, resolvido e fechado fechados de início', () => {
  const out = groupTickets([...TICKETS, T(8, { status: null }), T(9, { status: 99 })], 'status', ctxFor({ unread: [2] }));
  assert.deepEqual(shape(out), [
    ['news', 'Novidades', [2]],
    ['status:1', 'Novo', [1]],
    ['status:2', 'Em atendimento', [3]], // o #2 está em Novidades e não se repete
    ['status:3', 'Planejado', [7]],
    ['status:4', 'Pendente', [4]],
    ['status:5', 'Resolvido', [5]],
    ['status:6', 'Fechado', [6]],
    ['status:none', 'Sem status', [9, 8]], // empate de data: o id maior primeiro
  ]);
  assert.deepEqual(out.map((s) => s.open), [true, true, true, true, true, false, false, true]);
});

test('prioridade: da mais alta para a mais baixa, e "Sem prioridade" por último', () => {
  const out = groupTickets([...TICKETS, T(8, { priority: null }), T(9, { priority: 0 })], 'prioridade', ctxFor());
  assert.deepEqual(shape(out), [
    ['prioridade:6', 'Crítica', [1]],
    ['prioridade:5', 'Muito alta', [7]],
    ['prioridade:4', 'Alta', [3, 2]],
    ['prioridade:3', 'Média', [5]],
    ['prioridade:2', 'Baixa', [4]],
    ['prioridade:1', 'Muito baixa', [6]],
    ['prioridade:none', 'Sem prioridade', [9, 8]],
  ]);
  assert.ok(out.every((s) => s.open)); // aqui nada começa fechado
});

test('etapa: na ordem das Opções, só as que têm ticket, e "Sem etapa" no fim', () => {
  const out = groupTickets(TICKETS, 'etapa', ctxFor({ stage: { 1: 'review', 2: 'andamento', 3: 'review' } }));
  assert.deepEqual(shape(out), [
    ['etapa:andamento', 'Em andamento', [2]],
    ['etapa:review', 'PR em review', [3, 1]],
    ['etapa:none', 'Sem etapa', [4, 7, 5, 6]], // o de atualização mais recente primeiro
  ]);
  // sem nenhuma etapa criada: tudo em "Sem etapa"
  assert.deepEqual(shape(groupTickets(TICKETS, 'etapa', ctxFor({ stages: [] }))).map((s) => s[0]), ['etapa:none']);
  // uma etapa apagada (que o ticket ainda aponta) não some com o ticket
  const orphan = { isUnread: () => false, lastEventAt: () => 0, modMs: ms, stageOf: () => ({ id: 'apagada', name: 'x' }), stages: [{ id: 'andamento', name: 'Em andamento' }] };
  assert.equal(ids(groupTickets(TICKETS, 'etapa', orphan).at(-1)).length, TICKETS.length);
});

test('o nome de uma etapa (texto da pessoa) chega intacto, para quem desenha usar só textContent', () => {
  const stages = [{ id: 'x', name: '<img src=x onerror=alert(1)> & "etapa"' }];
  const out = groupTickets([T(1)], 'etapa', ctxFor({ stages, stage: { 1: 'x' } }));
  assert.equal(out[0].title, '<img src=x onerror=alert(1)> & "etapa"');
});

test('lista vazia não gera seção; modo desconhecido cai no padrão; os ids de seção não se misturam entre modos', () => {
  assert.deepEqual(groupTickets([], 'status', ctxFor()), []);
  assert.equal(groupTickets(TICKETS, 'lixo', ctxFor())[0].id, 'padrao:acompanhando');
  const all = GROUP_MODES.flatMap((m) => groupTickets(TICKETS, m, ctxFor({ stage: { 2: 'andamento' } })).map((s) => s.id));
  assert.equal(new Set(all).size, all.length);
});

test('a lista recebida não é alterada', () => {
  const copy = JSON.stringify(TICKETS);
  groupTickets(TICKETS, 'status', ctxFor({ unread: [1] }));
  assert.equal(JSON.stringify(TICKETS), copy);
});

test('normalizeSections guarda só booleanos com chave curta, no máximo 200', () => {
  assert.deepEqual(normalizeSections({ 'status:5': true, 'news': false, a: 'sim', b: 1, c: null, [`${'x'.repeat(81)}`]: true }), { 'status:5': true, news: false });
  for (const lixo of [null, undefined, 'x', 5, [], [true]]) assert.deepEqual(normalizeSections(lixo), {}, JSON.stringify(lixo));
  const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, true]));
  assert.equal(Object.keys(normalizeSections(many)).length, 200);
});

test('isSectionOpen / withSectionOpen: a escolha da pessoa vale; voltar ao padrão apaga a escolha', () => {
  const closedByDefault = { id: 'padrao:encerrados', open: false };
  const openByDefault = { id: 'news', open: true };
  assert.equal(isSectionOpen(closedByDefault, {}), false);
  assert.equal(isSectionOpen(closedByDefault, undefined), false);
  assert.equal(isSectionOpen(closedByDefault, { 'padrao:encerrados': true }), true);
  assert.equal(isSectionOpen(openByDefault, { news: false }), false);
  assert.equal(isSectionOpen(openByDefault, { news: 'sim' }), true); // lixo ignorado

  let o = withSectionOpen({}, closedByDefault, true);
  assert.deepEqual(o, { 'padrao:encerrados': true });
  o = withSectionOpen(o, openByDefault, false);
  assert.deepEqual(o, { 'padrao:encerrados': true, news: false });
  o = withSectionOpen(o, closedByDefault, false); // voltou ao padrão
  assert.deepEqual(o, { news: false });
  const original = { news: false };
  withSectionOpen(original, closedByDefault, true);
  assert.deepEqual(original, { news: false }); // não altera o recebido
});

test('withSectionOpen não passa de 200 escolhas', () => {
  const full = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, false]));
  const out = withSectionOpen(full, { id: 'novo', open: true }, false);
  assert.equal(Object.keys(out).length, 200);
  assert.equal('novo' in out, false);
  assert.equal(withSectionOpen(full, { id: 'k5', open: true }, true).k5, undefined); // voltar ao padrão ainda funciona
});
