import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPoll, scrubState } from '../extension/src/poller.js';
import { FIELD, GlpiError } from '../extension/src/glpi.js';
import { mergeConfig } from '../extension/src/store.js';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const row = (id, over = {}) => ({
  id,
  title: `Ticket ${id}`,
  dateMod: '2026-09-29 10:00',
  entity: 'Município Alfa',
  extra: '',
  ...over,
});
const ticket = (id, over = {}) => ({
  id,
  name: `Ticket ${id}`,
  status: 2,
  priority: 3,
  date_mod: '2026-09-29 10:00:03',
  ...over,
});

function makeWorld() {
  return {
    me: { id: 7, name: 'Igor' },
    roles: { assigned: [], observer: [], requester: [] },
    all: [],
    tickets: {},
    followups: {},
    solutions: {},
    users: { 20: 'Analista A' },
    calls: { ticket: 0, followups: 0 },
  };
}

function fakeApi(w) {
  const desc = (list) => [...(list ?? [])].sort((a, b) => b.id - a.id);
  const roleOf = { [FIELD.TECH]: 'assigned', [FIELD.WATCHER]: 'observer', [FIELD.REQUESTER]: 'requester' };
  return {
    me: async () => w.me,
    searchTickets: async ({ criteria }) => {
      const first = criteria[0];
      if (first.field !== FIELD.ID) (w.searchedAs ??= new Set()).add(Number(first.value));
      if (first.field === FIELD.ID) {
        const wanted = criteria.map((c) => Number(c.value));
        return w.all.filter((r) => wanted.includes(r.id));
      }
      return w.roles[roleOf[first.field]];
    },
    ticket: async (id) => {
      w.calls.ticket += 1;
      if (w.fail?.[id]) throw w.fail[id];
      if (!w.tickets[id]) throw new GlpiError('não encontrado', { status: 404, code: 'ERROR_ITEM_NOT_FOUND' });
      return w.tickets[id];
    },
    followups: async (id) => {
      w.calls.followups += 1;
      return desc(w.followups[id]);
    },
    solutions: async (id) => desc(w.solutions[id]),
    userName: async (uid) => {
      if (!w.users[uid]) throw new GlpiError('sem direito', { status: 403 });
      return w.users[uid];
    },
  };
}

const poll = (w, { state, watched = {}, cfg = {}, now = 1_000_000 } = {}) =>
  runPoll({ cfg: mergeConfig(cfg), state, watched, api: fakeApi(w), clock: () => now });

// Mundo com o ticket 1 atribuído a mim e um acompanhamento antigo.
function baseWorld() {
  const w = makeWorld();
  w.roles.assigned = [row(1)];
  w.tickets[1] = ticket(1);
  w.followups[1] = [{ id: 10, users_id: 20, content: '&lt;p&gt;antigo&lt;/p&gt;' }];
  return w;
}

test('primeira rodada faz baseline silencioso', async () => {
  const w = baseWorld();
  const r = await poll(w);
  assert.deepEqual(r.notifications, []);
  assert.equal(r.state.initialized, true);
  assert.equal(r.state.tickets[1].lastFollowupId, 10);
  assert.deepEqual(r.state.tickets[1].sources, ['assigned']);
  assert.equal(r.state.lastRun.ok, true);
});

test('sem mudança no date_mod não chama a API por ticket', async () => {
  const w = baseWorld();
  const r1 = await poll(w);
  const before = { ...w.calls };
  await poll(w, { state: r1.state });
  assert.deepEqual(w.calls, before);
});

test('novo acompanhamento de outra pessoa gera notificação limpa', async () => {
  const w = baseWorld();
  const r1 = await poll(w);
  w.roles.assigned = [row(1, { dateMod: '2026-09-29 10:05' })];
  w.followups[1].push({
    id: 11,
    users_id: 20,
    content: '&lt;p&gt;Segue o &lt;b&gt;log&lt;/b&gt; &amp;amp; print&lt;/p&gt;',
  });
  const r2 = await poll(w, { state: r1.state });
  assert.equal(r2.notifications.length, 1);
  assert.equal(r2.notifications[0].title, '#1 Ticket 1');
  assert.equal(r2.notifications[0].message, 'Analista A: Segue o log & print');
  assert.equal(r2.notifications[0].context, 'Município Alfa');
  assert.equal(r2.state.tickets[1].lastFollowupId, 11);
  // rodar de novo não repete o aviso
  const r3 = await poll(w, { state: r2.state });
  assert.deepEqual(r3.notifications, []);
});

test('minhas próprias respostas são ignoradas (a menos que notifyOwn)', async () => {
  const w = baseWorld();
  const r1 = await poll(w);
  w.roles.assigned = [row(1, { dateMod: '2026-09-29 10:05' })];
  w.followups[1].push({ id: 12, users_id: 7, content: 'minha resposta' });
  const quiet = await poll(w, { state: r1.state });
  assert.deepEqual(quiet.notifications, []);
  assert.equal(quiet.state.tickets[1].lastFollowupId, 12); // avança mesmo assim

  const loud = await poll(w, { state: r1.state, cfg: { notifyOwn: true } });
  assert.equal(loud.notifications[0].message, 'Você: minha resposta');
});

test('mudança de Status extra é detectada pelo search, sem buscar o ticket', async () => {
  const w = baseWorld();
  const r1 = await poll(w);
  const before = { ...w.calls };
  w.roles.assigned = [row(1, { extra: 'Devolvido' })]; // mesmo dateMod
  const r2 = await poll(w, { state: r1.state });
  assert.equal(r2.notifications[0].message, 'Status extra: — → Devolvido');
  assert.deepEqual(w.calls, before);
  assert.equal(r2.state.tickets[1].extra, 'Devolvido');
});

test('ticket resolvido sai da busca: avisa status e solução, mantém 2 dias', async () => {
  const w = baseWorld();
  const r1 = await poll(w);
  w.roles.assigned = []; // resolvido => fora do filtro "em aberto"
  w.tickets[1] = ticket(1, { status: 5, date_mod: '2026-09-29 11:00:00' });
  w.solutions[1] = [{ id: 3, users_id: 20, content: 'Serviço reiniciado' }];
  const r2 = await poll(w, { state: r1.state, now: 2_000_000 });
  assert.equal(r2.notifications.length, 1);
  assert.equal(r2.notifications[0].message, 'Analista A propôs solução: Serviço reiniciado  (+1)');
  assert.equal(r2.state.tickets[1].status, 5);
  assert.equal(r2.state.tickets[1].doneSince, 2_000_000);

  const calls = { ...w.calls };
  const r3 = await poll(w, { state: r2.state, now: 2_000_000 + DAY });
  assert.deepEqual(w.calls, calls); // encerrado e fora do radar: não consulta mais
  assert.ok(r3.state.tickets[1]);

  const r4 = await poll(w, { state: r3.state, now: 2_000_000 + 3 * DAY });
  assert.equal(r4.state.tickets[1], undefined);
});

test('ticket que segue aberto mas saiu do radar é descartado em silêncio', async () => {
  const w = baseWorld();
  const r1 = await poll(w);
  w.roles.assigned = []; // desatribuído
  const r2 = await poll(w, { state: r1.state });
  assert.equal(r2.state.tickets[1], undefined);
  assert.deepEqual(r2.notifications, []);
});

test('ticket novo no radar avisa; ticket manual não', async () => {
  const w = baseWorld();
  const r1 = await poll(w);

  w.roles.assigned = [row(1), row(2)];
  w.tickets[2] = ticket(2);
  w.all = [row(3)];
  w.tickets[3] = ticket(3);
  const r2 = await poll(w, { state: r1.state, watched: { 3: { addedAt: 1 } } });
  assert.equal(r2.notifications.length, 1);
  assert.equal(r2.notifications[0].title, '#2 Ticket 2');
  assert.equal(r2.notifications[0].message, 'Novo no seu radar: atribuído a você');
  assert.deepEqual(r2.state.tickets[3].sources, ['manual']);
});

test('ticket manual inacessível fica marcado; não-manual é descartado', async () => {
  const w = makeWorld();
  const r = await poll(w, { watched: { 99: { addedAt: 1 } } });
  assert.equal(r.state.tickets[99].unavailable, true);
  assert.deepEqual(r.notifications, []);

  const w2 = baseWorld();
  const r1 = await poll(w2);
  delete w2.tickets[1]; // sumiu para o usuário
  w2.roles.assigned = [row(1, { dateMod: '2026-09-29 12:00' })];
  const r2 = await poll(w2, { state: r1.state });
  assert.equal(r2.state.tickets[1], undefined);
});

test('tipos de aviso desligados não geram notificação', async () => {
  const w = baseWorld();
  const cfg = { notify: { followup: false } };
  const r1 = await poll(w, { cfg });
  w.roles.assigned = [row(1, { dateMod: '2026-09-29 10:05' })];
  w.followups[1].push({ id: 11, users_id: 20, content: 'oi' });
  const r2 = await poll(w, { state: r1.state, cfg });
  assert.deepEqual(r2.notifications, []);
  assert.equal(r2.state.tickets[1].lastFollowupId, 11);
});

test('varredura completa a cada 15 min pega mudança sem alteração de date_mod', async () => {
  const w = baseWorld();
  const r1 = await poll(w, { now: 1_000_000 });
  w.followups[1].push({ id: 11, users_id: 20, content: 'chegou sem mexer no date_mod' });
  const early = await poll(w, { state: r1.state, now: 1_000_000 + 5 * MIN });
  assert.deepEqual(early.notifications, []);
  const late = await poll(w, { state: r1.state, now: 1_000_000 + 16 * MIN });
  assert.equal(late.notifications.length, 1);
});

test('mudança de status sem followup gera aviso de status', async () => {
  const w = baseWorld();
  const r1 = await poll(w);
  w.roles.assigned = [row(1, { dateMod: '2026-09-29 10:30' })];
  w.tickets[1] = ticket(1, { status: 4 });
  const r2 = await poll(w, { state: r1.state });
  assert.equal(r2.notifications[0].message, 'Status: Em atendimento → Pendente');
});

test('ocultar conteúdo: notificação sem título nem texto e cache sem o texto', async () => {
  const w = baseWorld();
  w.roles.assigned = [row(1, { title: 'Paciente João da Silva não consegue agendar' })];
  w.tickets[1] = ticket(1, { name: 'Paciente João da Silva não consegue agendar' });
  const cfg = { hideContent: true };
  const r1 = await poll(w, { cfg });
  w.roles.assigned = [row(1, { title: 'Paciente João da Silva não consegue agendar', dateMod: '2026-09-29 10:05' })];
  w.followups[1].push({ id: 11, users_id: 20, content: '&lt;p&gt;CPF 123.456.789-00, prontuário 55&lt;/p&gt;' });
  w.solutions[1] = [{ id: 4, users_id: 20, content: 'Corrigi o cadastro de João' }];
  const r2 = await poll(w, { state: r1.state, cfg });

  assert.equal(r2.notifications.length, 1);
  const n = r2.notifications[0];
  assert.equal(n.title, 'Ticket #1');
  assert.equal(n.message, 'Analista A respondeu  (+1)');
  assert.equal(n.context, ''); // a entidade identifica o cliente: também fica de fora
  const dump = JSON.stringify(n) + JSON.stringify(r2.state);
  assert.doesNotMatch(dump, /123\.456|prontuário|Corrigi/);
  assert.doesNotMatch(JSON.stringify(n), /João/); // título do ticket fora da notificação
  // o evento continua existindo (o ticket aparece com novidade), só sem texto
  assert.deepEqual(r2.state.tickets[1].events.map((e) => [e.type, e.text]), [
    ['solution', ''],
    ['followup', ''],
  ]);
});

test('ocultar conteúdo desligado: notificação traz título e texto', async () => {
  const w = baseWorld();
  const r1 = await poll(w);
  w.roles.assigned = [row(1, { dateMod: '2026-09-29 10:05' })];
  w.followups[1].push({ id: 11, users_id: 20, content: 'texto visível' });
  const r2 = await poll(w, { state: r1.state });
  assert.equal(r2.notifications[0].title, '#1 Ticket 1');
  assert.equal(r2.notifications[0].message, 'Analista A: texto visível');
});

test('ligar ocultar conteúdo apaga o texto que já estava no cache', async () => {
  const w = baseWorld();
  const r1 = await poll(w);
  w.roles.assigned = [row(1, { dateMod: '2026-09-29 10:05' })];
  w.followups[1].push({ id: 11, users_id: 20, content: 'dado confidencial' });
  const r2 = await poll(w, { state: r1.state });
  assert.match(JSON.stringify(r2.state), /dado confidencial/);

  const r3 = await poll(w, { state: r2.state, cfg: { hideContent: true } });
  assert.doesNotMatch(JSON.stringify(r3.state), /dado confidencial/);
  assert.equal(r3.state.tickets[1].events.at(-1).type, 'followup'); // evento preservado
});

test('scrubState só limpa texto livre (followup/solução), não status nem Extra', () => {
  const state = {
    tickets: {
      1: {
        events: [
          { type: 'followup', text: 'a' },
          { type: 'solution', text: 'b' },
          { type: 'status', text: 'Novo → Pendente' },
          { type: 'extra', text: 'x → y' },
        ],
      },
    },
  };
  assert.deepEqual(scrubState(state).tickets[1].events.map((e) => e.text), ['', '', 'Novo → Pendente', 'x → y']);
});

// ---------- erro de um ticket não derruba a rodada ----------
const http500 = () => new GlpiError('HTTP 500', { status: 500 });

// Dois tickets no radar; depois os dois mudam e o ticket 1 passa a dar erro no GLPI.
async function twoTicketsWithTicket1Broken(error = http500()) {
  const w = baseWorld();
  w.roles.assigned = [row(1), row(2)];
  w.tickets[2] = ticket(2);
  w.followups[2] = [{ id: 20, users_id: 20, content: 'antigo' }];
  const r1 = await poll(w);
  w.roles.assigned = [row(1, { dateMod: '2026-09-29 10:05' }), row(2, { dateMod: '2026-09-29 10:05' })];
  w.followups[2].push({ id: 21, users_id: 20, content: 'resposta nova' });
  w.fail = { 1: error };
  const r2 = await poll(w, { state: r1.state });
  return { w, r1, r2 };
}

test('HTTP 500 em um ticket não derruba a rodada: os outros seguem e são avisados', async () => {
  const { r1, r2 } = await twoTicketsWithTicket1Broken();
  assert.equal(r2.state.lastRun.ok, true);
  assert.deepEqual(r2.state.lastRun.failed, [1]);
  assert.deepEqual(r2.notifications.map((n) => n.message), ['Analista A: resposta nova']);
  // o ticket com erro fica como estava (nada avança), só marcado para a tela
  assert.deepEqual(r2.state.tickets[1], { ...r1.state.tickets[1], readError: true });
  assert.equal(r2.state.tickets[2].lastFollowupId, 21);
});

test('o ticket com erro é tentado de novo a cada rodada e, ao voltar, avisa uma vez só', async () => {
  const { w, r2 } = await twoTicketsWithTicket1Broken();
  const again = await poll(w, { state: r2.state }); // continua dando erro
  assert.deepEqual(again.state.lastRun.failed, [1]);
  assert.deepEqual(again.notifications, []);

  delete w.fail; // o GLPI voltou
  w.followups[1].push({ id: 11, users_id: 20, content: 'chegou depois do erro' });
  const back = await poll(w, { state: again.state });
  assert.deepEqual(back.state.lastRun.failed, []);
  assert.equal(back.state.tickets[1].readError, undefined);
  assert.deepEqual(back.notifications.map((n) => n.message), ['Analista A: chegou depois do erro']);
  assert.deepEqual((await poll(w, { state: back.state })).notifications, []);
});

test('resposta que não é um ticket (sem status HTTP) também é isolada', async () => {
  const { r2 } = await twoTicketsWithTicket1Broken(new GlpiError('Resposta inesperada para o ticket #1'));
  assert.deepEqual(r2.state.lastRun.failed, [1]);
  assert.equal(r2.notifications.length, 1);
});

test('ticket que dá erro na primeira vez não é guardado, e ao voltar não despeja o histórico', async () => {
  const w = baseWorld();
  const r1 = await poll(w);
  w.roles.assigned = [row(1), row(3)];
  w.tickets[3] = ticket(3);
  w.followups[3] = [{ id: 30, users_id: 20, content: 'histórico 1' }, { id: 31, users_id: 20, content: 'histórico 2' }];
  w.fail = { 3: http500() };
  const r2 = await poll(w, { state: r1.state });
  assert.deepEqual(r2.state.lastRun.failed, [3]);
  assert.equal(r2.state.tickets[3], undefined);
  assert.deepEqual(r2.notifications, []);

  delete w.fail;
  const r3 = await poll(w, { state: r2.state });
  assert.deepEqual(r3.notifications.map((n) => n.message), ['Novo no seu radar: atribuído a você']); // sem as respostas antigas
  assert.equal(r3.state.tickets[3].lastFollowupId, 31);
});

test('o que atinge todos os tickets continua abortando a rodada', async () => {
  const causes = [
    new GlpiError('token inválido', { status: 401 }),
    new GlpiError('muitas requisições', { status: 429 }),
    new GlpiError('gateway', { status: 502 }),
    new GlpiError('sem conexão', { code: 'NETWORK' }),
    new GlpiError('redirecionou', { code: 'REDIRECT' }),
  ];
  for (const cause of causes) {
    await assert.rejects(twoTicketsWithTicket1Broken(cause), (e) => e === cause, cause.message);
  }
});

// ---------- troca de conta / de GLPI ----------
test('trocar de conta descarta o cache e volta ao baseline silencioso', async () => {
  const w = baseWorld();
  const r1 = await poll(w, { cfg: { userToken: 'token-igor' } });
  assert.ok(r1.state.tickets[1]);

  w.me = { id: 8, name: 'Outra Pessoa' };
  w.roles.assigned = [row(5)];
  w.tickets[5] = ticket(5);
  w.followups[5] = [{ id: 50, users_id: 20, content: 'antigo' }];
  w.searchedAs = new Set();
  const r2 = await poll(w, { state: r1.state, cfg: { userToken: 'token-da-outra' } });
  assert.deepEqual([...w.searchedAs], [8]); // buscou os tickets da conta nova, não os da antiga
  assert.equal(r2.state.me.id, 8);
  assert.deepEqual(Object.keys(r2.state.tickets), ['5']); // nada do cache antigo
  assert.deepEqual(r2.notifications, []); // e sem despejar "ticket novo" de tudo
});

test('trocar de GLPI descarta o cache mesmo que o id de usuário seja o mesmo', async () => {
  const w = baseWorld();
  const r1 = await poll(w, { cfg: { baseUrl: 'https://glpi-a.test', userToken: 't' } });
  w.roles.assigned = [row(9)];
  w.tickets[9] = ticket(9);
  w.followups[9] = [];
  const r2 = await poll(w, { state: r1.state, cfg: { baseUrl: 'https://glpi-b.test', userToken: 't' } });
  assert.deepEqual(Object.keys(r2.state.tickets), ['9']);
  assert.equal(r2.state.baseUrl, 'https://glpi-b.test');
});

test('regerar o token da mesma conta mantém o cache e os eventos', async () => {
  const w = baseWorld();
  const r1 = await poll(w, { cfg: { userToken: 'antigo' } });
  w.roles.assigned = [row(1, { dateMod: '2026-09-29 10:05' })];
  w.followups[1].push({ id: 11, users_id: 20, content: 'nova' });
  const r2 = await poll(w, { state: r1.state, cfg: { userToken: 'antigo' } });
  assert.equal(r2.notifications.length, 1);

  const r3 = await poll(w, { state: r2.state, cfg: { userToken: 'regerado' } }); // mesmo usuário (id 7)
  assert.deepEqual(r3.notifications, []);
  assert.deepEqual(r3.state.tickets[1].events, r2.state.tickets[1].events); // o "novo" continua lá
  assert.equal(r3.state.initialized, true);
});

test('cache de uma versão anterior (sem impressão das credenciais) é adotado sem perder nada', async () => {
  const w = baseWorld();
  const r1 = await poll(w);
  const old = structuredClone(r1.state);
  delete old.fp;
  delete old.baseUrl;
  const r2 = await poll(w, { state: old });
  assert.deepEqual(Object.keys(r2.state.tickets), ['1']);
  assert.ok(r2.state.fp);
});

test('cache de uma versão anterior com usuário obsoleto é corrigido na primeira rodada', async () => {
  const w = baseWorld(); // a conta atual é a 7
  const stale = { me: { id: 99, name: 'Usuário antigo' }, users: {}, tickets: { 1: { id: 1, status: 2 } }, initialized: true, lastRun: null };
  w.searchedAs = new Set();
  const r = await poll(w, { state: stale });
  assert.deepEqual([...w.searchedAs], [7]);
  assert.equal(r.state.me.id, 7);
  assert.deepEqual(r.notifications, []);
});

// ---------- ticket acompanhado à mão que já está encerrado ----------
function closedManualWorld(status = 5) {
  const w = makeWorld();
  w.all = [row(5)];
  w.tickets[5] = ticket(5, { status });
  w.followups[5] = [];
  return w;
}
const watch5 = { 5: { addedAt: 1 } };

test('encerrado acompanhado à mão não é relido a cada 15 min; só se o date_mod mudar', async () => {
  const w = closedManualWorld();
  const r1 = await poll(w, { watched: watch5, now: 1_000_000 });
  assert.equal(r1.state.tickets[5].status, 5);
  const before = w.calls.ticket;

  const r2 = await poll(w, { state: r1.state, watched: watch5, now: 1_000_000 + 40 * MIN });
  assert.equal(w.calls.ticket, before); // sem a varredura completa

  // reaberto: o date_mod muda, então é relido e o status novo aparece
  w.all = [row(5, { dateMod: '2026-09-30 09:00' })];
  w.tickets[5] = ticket(5, { status: 2 });
  const r3 = await poll(w, { state: r2.state, watched: watch5, now: 1_000_000 + 41 * MIN });
  assert.equal(w.calls.ticket, before + 1);
  assert.equal(r3.notifications[0].message, 'Status: Resolvido → Em atendimento');
  assert.deepEqual(r3.expired, []);
});

test('o que está aberto continua com a varredura completa a cada 15 min', async () => {
  const w = closedManualWorld(2); // acompanhado à mão e em aberto
  const r1 = await poll(w, { watched: watch5, now: 1_000_000 });
  const before = w.calls.ticket;
  await poll(w, { state: r1.state, watched: watch5, now: 1_000_000 + 16 * MIN });
  assert.equal(w.calls.ticket, before + 1);
});

test('acompanhado à mão encerrado há mais de 2 dias sai do cache e pede para deixar de acompanhar', async () => {
  const w = closedManualWorld();
  const r1 = await poll(w, { watched: watch5, now: 1_000_000 });
  const soon = await poll(w, { state: r1.state, watched: watch5, now: 1_000_000 + 1 * DAY });
  assert.ok(soon.state.tickets[5]);
  assert.deepEqual(soon.expired, []);

  const late = await poll(w, { state: r1.state, watched: watch5, now: 1_000_000 + 3 * DAY });
  assert.equal(late.state.tickets[5], undefined);
  assert.deepEqual(late.expired, [5]);
});

test('reset avisa quando o cache de outra conta ou de outro GLPI foi descartado (e só então)', async () => {
  const w = baseWorld();
  const first = await poll(w, { cfg: { baseUrl: 'https://glpi-a.test', userToken: 'a' } });
  assert.equal(first.reset, false);

  const same = await poll(w, { state: first.state, cfg: { baseUrl: 'https://glpi-a.test', userToken: 'a' } });
  assert.equal(same.reset, false);

  const regenerated = await poll(w, { state: same.state, cfg: { baseUrl: 'https://glpi-a.test', userToken: 'novo-token' } }); // mesma conta
  assert.equal(regenerated.reset, false);

  const otherSite = await poll(w, { state: regenerated.state, cfg: { baseUrl: 'https://glpi-b.test', userToken: 'novo-token' } });
  assert.equal(otherSite.reset, true);

  w.me = { id: 8, name: 'Outra' };
  const otherAccount = await poll(w, { state: otherSite.state, cfg: { baseUrl: 'https://glpi-b.test', userToken: 'token-da-outra' } });
  assert.equal(otherAccount.reset, true);
});
