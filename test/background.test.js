// Carrega o service worker de verdade, com uma API chrome.* simulada, e exercita os ouvintes.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const L = {}; // ouvintes registrados pelo background.js
const stored = {}; // conteúdo de chrome.storage.local
const calls = { create: [], clear: [], tabsCreate: [], openPopup: 0, storageSet: [], offscreen: [], messages: [], windowUpdates: [], alarmCreate: [], alarmClear: [], badge: [], title: [], cleared: 0 };
let lastWindow = { id: 5, focused: false }; // janela do Chrome mais recente (fora de foco)
let openContexts = []; // páginas offscreen "abertas"
let failOffscreen = false;
let permissionLevel = 'granted';
const noop = { addListener() {} };

globalThis.chrome = {
  runtime: {
    getURL: (p) => `chrome-extension://x/${p}`,
    onMessage: { addListener: (fn) => { L.onMessage = fn; } },
    getContexts: async () => openContexts,
    sendMessage: async (m) => { calls.messages.push(m); },
    onInstalled: noop,
    onStartup: noop,
  },
  notifications: {
    create: async (id, opts) => { calls.create.push({ id, opts }); },
    clear: (id) => { calls.clear.push(id); },
    getAll: async () => ({}),
    getPermissionLevel: async () => permissionLevel,
    onClicked: { addListener: (fn) => { L.onClicked = fn; } },
    onButtonClicked: { addListener: (fn) => { L.onButton = fn; } },
  },
  tabs: { query: async () => [], create: async (o) => { calls.tabsCreate.push(o); }, update: async () => {}, onUpdated: { addListener: (fn) => { L.onUpdated = fn; } } },
  windows: {
    getLastFocused: async () => lastWindow,
    update: async (id, info) => { calls.windowUpdates.push({ id, info }); },
  },
  alarms: {
    get: async () => undefined,
    create: async (name, info) => { calls.alarmCreate.push({ name, info }); },
    clear: async (name) => { calls.alarmClear.push(name); },
    onAlarm: noop,
  },
  action: {
    setBadgeText: async ({ text }) => { calls.badge.push(text); },
    setBadgeBackgroundColor: async () => {},
    setTitle: async ({ title }) => { calls.title.push(title); },
    openPopup: async () => { calls.openPopup += 1; },
  },
  storage: {
    local: {
      get: async (k) => Object.fromEntries([].concat(k).filter((key) => key in stored).map((key) => [key, stored[key]])),
      set: async (o) => { calls.storageSet.push(o); },
      clear: async () => { calls.cleared += 1; },
    },
    session: { get: async () => ({}), set: async () => {}, remove: async () => {}, clear: async () => {} },
    onChanged: { addListener: (fn) => { L.onChanged = fn; } },
  },
  permissions: { remove: async () => true },
  offscreen: {
    createDocument: async (o) => {
      if (failOffscreen) throw new Error('boom');
      calls.offscreen.push(o);
    },
  },
};

await import('../extension/background.js');

const reset = () => {
  calls.create.length = 0;
  calls.clear.length = 0;
  calls.tabsCreate.length = 0;
  calls.storageSet.length = 0;
  calls.openPopup = 0;
  calls.offscreen.length = 0;
  calls.messages.length = 0;
  calls.windowUpdates.length = 0;
  calls.alarmCreate.length = 0;
  calls.alarmClear.length = 0;
  calls.badge.length = 0;
  calls.title.length = 0;
  calls.cleared = 0;
  lastWindow = { id: 5, focused: false };
  openContexts = [];
  failOffscreen = false;
  permissionLevel = 'granted';
  for (const k of Object.keys(stored)) delete stored[k];
};

// Envia uma mensagem ao background avançando o relógio (os exemplos esperam 1 s entre si).
async function send(msg) {
  mock.timers.enable({ apis: ['setTimeout'] });
  let response;
  const done = new Promise((resolve) => {
    L.onMessage(msg, {}, (r) => { response = r; resolve(); });
  });
  for (let i = 0; i < 30 && !response; i += 1) {
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(1000);
  }
  await done;
  mock.timers.reset();
  return response;
}

test('exemplos de notificação: uma de cada tipo, com id "demo:" e o mesmo formato das reais', async () => {
  reset();
  const r = await send({ type: 'demo-notifications', hideContent: false });
  assert.deepEqual(r, { ok: true, count: 7, permission: 'granted' });
  assert.equal(calls.create.length, 7);
  assert.ok(calls.create.every((c) => c.id.startsWith('demo:')));

  const tickets = calls.create.slice(0, 6);
  assert.ok(tickets.every((c) => c.opts.title.startsWith('Exemplo · #100')));
  assert.ok(tickets.every((c) => c.opts.buttons.length === 2 && c.opts.priority === 1));
  assert.equal(tickets[0].opts.message, 'Analista A: Segue o log do erro e o print da tela de relatórios.');
  assert.equal(tickets[0].opts.contextMessage, 'Município Beta');

  const summary = calls.create[6];
  assert.equal(summary.opts.title, 'MyTicket');
  assert.equal(summary.opts.message, '7 tickets com novidades');
  assert.equal(summary.opts.buttons, undefined);
});

test('exemplos respeitam "ocultar conteúdo"', async () => {
  reset();
  await send({ type: 'demo-notifications', hideContent: true });
  const dump = JSON.stringify(calls.create.map((c) => c.opts));
  assert.doesNotMatch(dump, /processamento|log do erro|Perfil liberado|reproduzir/);
  assert.equal(calls.create[0].opts.title, 'Exemplo · Ticket #1001');
  assert.equal(calls.create[0].opts.message, 'Analista A respondeu');
  assert.ok(calls.create.every((c) => c.opts.contextMessage === undefined)); // sem entidade no aviso
});

test('clicar num exemplo só fecha a notificação (não abre ticket nenhum)', async () => {
  reset();
  await L.onClicked('demo:followup:1790000000000');
  await L.onButton('demo:followup:1790000000000', 0);
  assert.deepEqual(calls.clear, ['demo:followup:1790000000000', 'demo:followup:1790000000000']);
  assert.equal(calls.tabsCreate.length, 0);
  assert.equal(calls.storageSet.length, 0);
});

test('clicar no resumo não trata o timestamp como número de ticket (abre o popup)', async () => {
  reset();
  await L.onClicked('summary:1790709000000');
  assert.equal(calls.tabsCreate.length, 0);
  assert.equal(calls.openPopup, 1);
  assert.deepEqual(calls.clear, ['summary:1790709000000']);
});

test('clicar num aviso real abre o ticket certo e marca como lido', async () => {
  reset();
  stored.config = { baseUrl: 'https://glpi.test', appToken: 'a', userToken: 'b' };
  await L.onClicked('t:159919:1790709000000');
  assert.deepEqual(calls.tabsCreate, [{ url: 'https://glpi.test/front/ticket.form.php?id=159919' }]);
  const user = calls.storageSet.find((o) => o.user)?.user;
  assert.ok(user.readAt[159919] > 0);
});

test('botão "Marcar como lido" só marca, sem abrir o ticket', async () => {
  reset();
  await L.onButton('t:159919:1790709000000', 1);
  assert.equal(calls.tabsCreate.length, 0);
  assert.ok(calls.storageSet.find((o) => o.user).user.readAt[159919] > 0);
  assert.deepEqual(calls.clear, ['t:159919:1790709000000']);
});

const SOUND_ON = { enabled: true, name: 'chime', volume: 0.6 };
const SOUND_OFF = { ...SOUND_ON, enabled: false };

test('exemplos tocam o som uma vez e silenciam o som padrão do sistema', async () => {
  reset();
  await send({ type: 'demo-notifications', hideContent: false, sound: SOUND_ON });
  assert.equal(calls.offscreen.length, 1); // uma vez, não uma por notificação
  const doc = calls.offscreen[0];
  assert.deepEqual(doc.reasons, ['AUDIO_PLAYBACK']);
  assert.equal(doc.url, 'offscreen.html?sound=chime&volume=0.6');
  assert.equal(calls.create.length, 7);
  assert.ok(calls.create.every((c) => c.opts.silent === true));
});

test('com o som desligado, não toca nada e o sistema mantém o som dele', async () => {
  reset();
  await send({ type: 'demo-notifications', hideContent: false, sound: SOUND_OFF });
  assert.equal(calls.offscreen.length, 0);
  assert.equal(calls.messages.length, 0);
  assert.ok(calls.create.every((c) => c.opts.silent === false));
});

test('sem som na mensagem, usa a configuração salva (padrão: ligado, suave, 60%)', async () => {
  reset();
  await send({ type: 'demo-notifications', hideContent: false });
  assert.equal(calls.offscreen[0].url, 'offscreen.html?sound=chime&volume=0.6');
});

test('página offscreen já aberta: o pedido vai por mensagem, sem criar outra', async () => {
  reset();
  openContexts = [{ contextType: 'OFFSCREEN_DOCUMENT' }];
  await send({ type: 'play-sound', sound: { enabled: true, name: 'alert', volume: 0.3 } });
  assert.equal(calls.offscreen.length, 0);
  assert.deepEqual(calls.messages, [{ target: 'offscreen', type: 'play', sound: 'alert', volume: 0.3 }]);
});

test('botão "Ouvir" toca mesmo com o som desligado na tela, mas não com volume 0', async () => {
  reset();
  await send({ type: 'play-sound', sound: { enabled: false, name: 'double', volume: 0.5 } });
  assert.equal(calls.offscreen[0].url, 'offscreen.html?sound=double&volume=0.5');

  reset();
  await send({ type: 'play-sound', sound: { enabled: true, name: 'double', volume: 0 } });
  assert.equal(calls.offscreen.length, 0);
});

test('falha ao criar a página de som nunca impede as notificações', async () => {
  reset();
  failOffscreen = true;
  const r = await send({ type: 'demo-notifications', hideContent: false, sound: SOUND_ON });
  assert.deepEqual(r, { ok: true, count: 7, permission: 'granted' });
  assert.equal(calls.create.length, 7);
});

test('som desconhecido ou volume fora da faixa é corrigido antes de tocar', async () => {
  reset();
  await send({ type: 'play-sound', sound: { enabled: true, name: 'inexistente', volume: 9 } });
  assert.equal(calls.offscreen[0].url, 'offscreen.html?sound=chime&volume=1');
});

test('exemplos avisam quando o Chrome informa que as notificações da extensão estão desativadas', async () => {
  reset();
  permissionLevel = 'denied';
  const r = await send({ type: 'demo-notifications', hideContent: false, sound: SOUND_OFF });
  assert.deepEqual(r, { ok: true, count: 7, permission: 'denied' });
  assert.equal(calls.create.length, 7); // ainda tenta criar; quem esconde é o Chrome/Windows
});

// ---------- detalhes de um ticket (tela aberta do popup) ----------
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });

function fakeGlpi() {
  const paths = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const path = url.replace('https://glpi.test/apirest.php/', '');
    paths.push(path);
    if (path === 'initSession') return jsonRes(200, { session_token: 'S' });
    if (path === 'getFullSession') return jsonRes(200, { session: { glpiID: 7, glpifriendlyname: 'Igor' } });
    if (path.startsWith('search/Ticket')) return jsonRes(200, { totalcount: 0, count: 0 });
    if (path === 'Ticket/159919') {
      return jsonRes(200, { id: 159919, name: 'Relatório mensal', content: '&lt;p&gt;Não gera&lt;/p&gt;', status: 2, priority: 4, date: '2026-09-29 08:00:00', date_mod: '2026-09-29 10:00:00', time_to_resolve: null });
    }
    if (path.startsWith('Ticket/159919/ITILFollowup')) {
      return jsonRes(200, [{ id: 5, users_id: 20, content: '&lt;p&gt;Segue o log&lt;/p&gt;', date_creation: '2026-09-29 10:00:00', is_private: 0 }]);
    }
    if (path.startsWith('Ticket/159919/ITILSolution')) return jsonRes(200, []);
    if (path === 'User/20') return jsonRes(200, { firstname: 'Analista', realname: 'A' });
    return jsonRes(404, ['ERROR_ITEM_NOT_FOUND', 'não encontrado']);
  };
  return { paths, restore: () => { globalThis.fetch = original; } };
}

test('ticket-details sem configuração devolve um erro claro e não chama o GLPI', async () => {
  reset();
  const glpi = fakeGlpi();
  try {
    const r = await send({ type: 'ticket-details', id: 159919 });
    assert.equal(r.ok, false);
    assert.match(r.error, /Configure a conexão/);
    assert.equal(glpi.paths.length, 0);
  } finally { glpi.restore(); }
});

test('ticket-details busca descrição e conversa no GLPI e devolve pronto para a tela', async () => {
  reset();
  stored.config = { baseUrl: 'https://glpi.test', appToken: 'a', userToken: 'b' };
  stored.state = { me: { id: 7 }, users: {}, tickets: {} };
  const glpi = fakeGlpi();
  try {
    const r = await send({ type: 'ticket-details', id: 159919 });
    assert.equal(r.ok, true);
    assert.equal(r.details.title, 'Relatório mensal');
    assert.equal(r.details.description, 'Não gera');
    assert.deepEqual(r.details.timeline.map((m) => [m.kind, m.author, m.text]), [['followup', 'Analista A', 'Segue o log']]);
    // somente leitura: só GETs de consulta, e nada gravado no cache do poller
    assert.ok(glpi.paths.every((p) => p === 'initSession' || /^(Ticket|User)\//.test(p)));
    assert.equal(calls.storageSet.length, 0);
  } finally { glpi.restore(); }
});

test('ticket-details respeita ocultar conteúdo e traduz falhas do GLPI', async () => {
  reset();
  stored.config = { baseUrl: 'https://glpi.test', appToken: 'a', userToken: 'b', hideContent: true };
  stored.state = { me: { id: 7 }, users: {}, tickets: {} };
  const glpi = fakeGlpi();
  try {
    const ok = await send({ type: 'ticket-details', id: 159919 });
    assert.equal(ok.details.hidden, true);
    assert.doesNotMatch(JSON.stringify(ok), /Segue o log|Não gera/);

    const missing = await send({ type: 'ticket-details', id: 123 }); // 404 no GLPI
    assert.equal(missing.ok, false);
    assert.match(missing.error, /não encontrado/);
  } finally { glpi.restore(); }
});

// ---------- chamar a atenção sem depender do banner do Windows ----------
const ATTN_OFF = { flash: false, sticky: false };

test('piscar na barra de tarefas: pisca a janela do Chrome que não está em foco', async () => {
  reset();
  await send({ type: 'demo-notifications', hideContent: false, sound: SOUND_OFF, attention: { flash: true, sticky: false } });
  assert.deepEqual(calls.windowUpdates, [{ id: 5, info: { drawAttention: true } }]);
  assert.ok(calls.create.slice(0, 6).every((c) => c.opts.requireInteraction === false));
});

test('não pisca se a janela já está em foco, se a opção está desligada ou se não há janela', async () => {
  reset();
  lastWindow = { id: 5, focused: true };
  await send({ type: 'demo-notifications', hideContent: false, sound: SOUND_OFF, attention: { flash: true } });
  assert.equal(calls.windowUpdates.length, 0);

  reset();
  await send({ type: 'demo-notifications', hideContent: false, sound: SOUND_OFF, attention: ATTN_OFF });
  assert.equal(calls.windowUpdates.length, 0);

  reset();
  lastWindow = undefined; // Chrome só em segundo plano
  const r = await send({ type: 'demo-notifications', hideContent: false, sound: SOUND_OFF, attention: { flash: true } });
  assert.equal(r.ok, true);
  assert.equal(calls.create.length, 7);
});

test('aviso que não some sozinho: requireInteraction nos avisos (não no resumo)', async () => {
  reset();
  await send({ type: 'demo-notifications', hideContent: false, sound: SOUND_OFF, attention: { flash: false, sticky: true } });
  const toasts = calls.create.slice(0, 6);
  assert.ok(toasts.every((c) => c.opts.requireInteraction === true));
  assert.equal(calls.create[6].opts.requireInteraction, undefined); // resumo mantém o comportamento normal
});

test('sem atenção na mensagem, usa a configuração salva (padrão: pisca, não fixa)', async () => {
  reset();
  await send({ type: 'demo-notifications', hideContent: false, sound: SOUND_OFF });
  assert.equal(calls.windowUpdates.length, 1);
  assert.ok(calls.create.slice(0, 6).every((c) => c.opts.requireInteraction === false));
});

test('abrir um ticket do GLPI numa aba marca como lido; endereço parecido ou aba ainda carregando, não', async () => {
  reset();
  stored.config = { baseUrl: 'https://glpi.test', appToken: 'a', userToken: 'b' };
  const tab = (url) => ({ url });
  const marked = () => calls.storageSet.filter((s) => s.user).map((s) => Object.keys(s.user.readAt).join());

  await L.onUpdated(1, { status: 'complete' }, tab('https://glpi.test/front/ticket.form.php?id=77'));
  assert.deepEqual(marked(), ['77']);

  calls.storageSet.length = 0;
  await L.onUpdated(1, { status: 'complete' }, tab('https://glpi.test.golpe.example/front/ticket.form.php?id=78')); // prefixo igual, outro dono
  await L.onUpdated(1, { status: 'loading' }, tab('https://glpi.test/front/ticket.form.php?id=79')); // ainda carregando
  await L.onUpdated(1, { status: 'complete' }, tab('https://glpi.test/front/central.php')); // não é página de ticket
  await L.onUpdated(1, { status: 'complete' }, {}); // sem permissão de ver a URL
  assert.deepEqual(marked(), []);
});

// ---------- pausar a sincronização ----------
const flush = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setImmediate(r)); };
// O poll usa crypto.subtle (termina em outra thread): espera a condição em vez de contar voltas do event loop.
async function until(cond, label, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) assert.fail(`timeout esperando: ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
const CONFIGURED = { baseUrl: 'https://glpi.test', appToken: 'a', userToken: 'b' };

test('pausado: "atualizar agora" não faz nenhuma requisição ao GLPI; sem pausa, faz', async () => {
  reset();
  const glpi = fakeGlpi();
  try {
    stored.config = CONFIGURED;
    stored.user = { paused: true, pausedAt: 1 };
    const paused = await send({ type: 'poll-now' });
    assert.deepEqual(paused, { ok: true });
    assert.deepEqual(glpi.paths, []);

    stored.user = {}; // controle: sem pausa a mesma mensagem busca no GLPI
    await send({ type: 'poll-now' });
    assert.ok(glpi.paths.includes('initSession'), glpi.paths.join());
  } finally { glpi.restore(); }
});

test('pausar cancela o alarme; retomar recria o alarme e já busca o que aconteceu', async () => {
  reset();
  const glpi = fakeGlpi();
  try {
    stored.config = CONFIGURED;

    stored.user = { paused: true, pausedAt: 1 };
    L.onChanged({ user: { oldValue: {}, newValue: stored.user } }, 'local');
    await flush();
    assert.deepEqual(calls.alarmClear, ['poll']);
    assert.equal(calls.alarmCreate.length, 0);
    assert.deepEqual(glpi.paths, []);

    stored.user = { paused: false };
    L.onChanged({ user: { oldValue: { paused: true }, newValue: stored.user } }, 'local');
    await flush();
    assert.equal(calls.alarmCreate.length, 1);
    assert.equal(calls.alarmCreate[0].name, 'poll');
    assert.equal(calls.alarmCreate[0].info.periodInMinutes, 2);
    await until(() => glpi.paths.includes('initSession'), 'retomar deve buscar na hora');
    await until(() => calls.storageSet.some((o) => o.state), 'o poll terminar (não vazar para o próximo teste)');
  } finally { glpi.restore(); }
});

test('mudança do user que não é a pausa (ex.: "lido em") não mexe no alarme nem busca', async () => {
  reset();
  const glpi = fakeGlpi();
  try {
    stored.config = CONFIGURED;
    L.onChanged({ user: { oldValue: { paused: false }, newValue: { paused: false, readAt: { 1: 2 } } } }, 'local');
    await flush();
    assert.equal(calls.alarmClear.length + calls.alarmCreate.length, 0);
    assert.deepEqual(glpi.paths, []);
  } finally { glpi.restore(); }
});

test('ícone: pausado mostra "II" e o título diz que está pausado; retomado volta ao normal', async () => {
  reset();
  stored.config = CONFIGURED;
  stored.state = { me: { id: 7 }, users: {}, tickets: {}, lastRun: { ok: true, at: 1, count: 0 } };
  stored.user = { paused: true, pausedAt: 1 };
  L.onChanged({ user: { oldValue: {}, newValue: stored.user } }, 'local');
  await flush();
  assert.equal(calls.badge.at(-1), 'II');
  assert.match(calls.title.at(-1), /sincronização pausada/);

  calls.badge.length = 0;
  stored.user = {};
  // só o ícone é o assunto aqui: um oldValue "pausado" dispararia um poll em segundo plano, que vazaria para o próximo teste
  L.onChanged({ user: { oldValue: {}, newValue: {} } }, 'local');
  await flush();
  assert.equal(calls.badge.at(-1), ''); // sem novidades e sem erro: sem número
});

// ---------- tags: o que o background limpa, e o apagar dados ----------
const H = 3600_000;

test('depois de cada verificação, marcações de tickets que sumiram há mais de 60 dias saem; as recentes ficam', async () => {
  reset();
  const glpi = fakeGlpi();
  try {
    stored.config = CONFIGURED;
    stored.state = { me: { id: 7 }, users: {}, tickets: {}, initialized: true };
    stored.tags = { defs: null, assign: { 5: [{ tag: 'avisado', at: 1 }], 6: [{ tag: 'avisado', at: Date.now() - H }] } };
    await send({ type: 'poll-now' });
    const written = calls.storageSet.filter((o) => o.tags).at(-1)?.tags;
    assert.deepEqual(Object.keys(written.assign), ['6']);
  } finally { glpi.restore(); }
});

test('trocar de conta no GLPI: acompanhados, "lido em" e marcações saem; as tags criadas ficam', async () => {
  reset();
  const glpi = fakeGlpi();
  try {
    stored.config = CONFIGURED;
    stored.state = { me: { id: 99 }, users: {}, tickets: {}, initialized: true }; // o GLPI responde que o token é do usuário 7
    stored.user = { watched: { 5: { addedAt: 1 } }, readAt: { 5: 2 } };
    stored.tags = { defs: [{ id: 'mine', name: 'Minha', color: 'blue', stage: false }], assign: { 6: [{ tag: 'mine', at: Date.now() }] } };
    await send({ type: 'poll-now' });
    const user = calls.storageSet.filter((o) => o.user).at(-1)?.user;
    const tags = calls.storageSet.filter((o) => o.tags).at(-1)?.tags;
    assert.deepEqual(user.watched, {});
    assert.deepEqual(user.readAt, {});
    assert.deepEqual(tags.assign, {});
    assert.deepEqual(tags.defs.map((d) => d.name), ['Minha']);
  } finally { glpi.restore(); }
});

test('mesma conta: a verificação não mexe nos acompanhados nem nas tags', async () => {
  reset();
  const glpi = fakeGlpi();
  try {
    stored.config = CONFIGURED;
    stored.state = { me: { id: 7 }, users: {}, tickets: {}, initialized: true };
    stored.user = { watched: { 5: { addedAt: 1 } }, readAt: {} };
    stored.tags = { defs: null, assign: { 6: [{ tag: 'avisado', at: Date.now() }] } };
    await send({ type: 'poll-now' });
    assert.equal(calls.storageSet.filter((o) => o.tags).length, 0);
    assert.ok(!calls.storageSet.some((o) => o.user && Object.keys(o.user.watched).length === 0));
  } finally { glpi.restore(); }
});

test('"Apagar dados locais" limpa o storage local inteiro (é ele que guarda as tags)', async () => {
  reset();
  stored.config = CONFIGURED;
  const r = await send({ type: 'wipe' });
  assert.deepEqual(r, { ok: true });
  assert.equal(calls.cleared, 1);
});
