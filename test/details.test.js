import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTicketDetails } from '../extension/src/details.js';
import { GlpiError } from '../extension/src/glpi.js';

const USERS = { 20: 'Analista A', 22: 'Ana Paula' };

const fakeApi = (over = {}) => ({
  ticket: async () => ({
    id: 1,
    name: 'Relat&#243;rio &amp; mensal',
    content: '&lt;p&gt;Linha 1&lt;/p&gt;&lt;p&gt;Linha 2&lt;br /&gt;Linha 3&lt;/p&gt;',
    status: 4,
    priority: 4,
    date: '2026-09-29 08:00:00',
    date_mod: '2026-09-29 10:05:03',
    time_to_resolve: '2026-09-30 18:00:00',
  }),
  followups: async () => [
    { id: 12, users_id: 20, content: '&lt;p&gt;Segue o log&lt;/p&gt;', date_creation: '2026-09-29 10:00:00', is_private: 0 },
    { id: 11, users_id: 7, content: 'Vou olhar', date_creation: '2026-09-29 09:00:00', is_private: 1 },
  ],
  solutions: async () => [{ id: 3, users_id: 22, content: '&lt;p&gt;Reiniciado&lt;/p&gt;', date_creation: '2026-09-29 10:30:00' }],
  userName: async (uid) => {
    if (!USERS[uid]) throw new GlpiError('sem direito', { status: 403 });
    return USERS[uid];
  },
  ...over,
});

test('monta título, descrição com quebras de linha e a conversa em ordem do mais novo ao mais antigo', async () => {
  const d = await fetchTicketDetails({ api: fakeApi(), id: 1, meId: 7 });
  assert.equal(d.title, 'Relatório & mensal');
  assert.equal(d.description, 'Linha 1\nLinha 2\nLinha 3');
  assert.equal(d.status, 4);
  assert.equal(d.opened, '2026-09-29 08:00:00');
  assert.equal(d.due, '2026-09-30 18:00:00');
  assert.equal(d.hidden, false);

  assert.deepEqual(d.timeline.map((m) => [m.kind, m.id, m.author, m.text]), [
    ['solution', 3, 'Ana Paula', 'Reiniciado'],
    ['followup', 12, 'Analista A', 'Segue o log'],
    ['followup', 11, 'Você', 'Vou olhar'],
  ]);
  assert.deepEqual(d.timeline.map((m) => m.mine), [false, false, true]);
  assert.deepEqual(d.timeline.map((m) => m.private), [false, false, true]);
  assert.equal(d.truncated, false);
});

test('com ocultar conteúdo, nenhum texto livre volta (autor, data e tipo continuam)', async () => {
  const d = await fetchTicketDetails({ api: fakeApi(), id: 1, meId: 7, hideContent: true });
  assert.equal(d.hidden, true);
  assert.equal(d.description, '');
  assert.ok(d.timeline.every((m) => m.text === ''));
  assert.deepEqual(d.timeline.map((m) => m.author), ['Ana Paula', 'Analista A', 'Você']);
  assert.doesNotMatch(JSON.stringify(d), /Segue o log|Reiniciado|Vou olhar|Linha 1/);
});

test('usuário que não dá para consultar vira "Usuário #id"; erro de rede aborta', async () => {
  const api = fakeApi({ followups: async () => [{ id: 1, users_id: 99, content: 'x', date_creation: '2026-09-29 09:00:00' }], solutions: async () => [] });
  const d = await fetchTicketDetails({ api, id: 1, meId: 7 });
  assert.equal(d.timeline[0].author, 'Usuário #99');

  const offline = fakeApi({ userName: async () => { throw new GlpiError('Sem conexão com o GLPI', { code: 'NETWORK' }); } });
  await assert.rejects(fetchTicketDetails({ api: offline, id: 1, meId: 7 }), (e) => e.code === 'NETWORK');
});

test('usa o cache de nomes recebido sem alterá-lo', async () => {
  let lookups = 0;
  const api = fakeApi({ userName: async (uid) => { lookups += 1; return USERS[uid]; } });
  const users = { 20: 'Analista A (cache)' };
  const d = await fetchTicketDetails({ api, id: 1, meId: 7, users });
  assert.equal(d.timeline.find((m) => m.id === 12).author, 'Analista A (cache)');
  assert.equal(lookups, 1); // só a Ana Paula (solução) precisou ser consultada
  assert.deepEqual(users, { 20: 'Analista A (cache)' }); // cache do chamador intacto
});

test('avisa quando há mais acompanhamentos do que o limite mostrado', async () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, users_id: 20, content: 'x', date_creation: `2026-09-29 09:${String(i).padStart(2, '0')}:00` }));
  const d = await fetchTicketDetails({ api: fakeApi({ followups: async () => many, solutions: async () => [] }), id: 1, meId: 7 });
  assert.equal(d.truncated, true);
  assert.equal(d.timeline.length, 10);
});

test('sem prazo (SLA) no GLPI, due vem nulo; erro do ticket propaga', async () => {
  const api = fakeApi({ ticket: async () => ({ id: 1, name: 'x', content: '', status: 2, date: '2026-09-29 08:00:00', date_mod: '2026-09-29 08:00:00', time_to_resolve: null }) });
  assert.equal((await fetchTicketDetails({ api, id: 1, meId: 7 })).due, null);

  const missing = fakeApi({ ticket: async () => { throw new GlpiError('não encontrado', { status: 404 }); } });
  await assert.rejects(fetchTicketDetails({ api: missing, id: 1, meId: 7 }), (e) => e.status === 404);
});
