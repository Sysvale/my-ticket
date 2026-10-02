// O mesmo background.js, mas num chrome.* que imita o Firefox: páginas em moz-extension://, sem página offscreen,
// sem getPermissionLevel e sem o evento de botões. Fica num arquivo próprio porque o import carrega o módulo uma vez
// só por processo (background.test.js simula o Chrome).
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const L = {};
const stored = {};
const created = [];
const omniDefault = [];
const tabsCreated = [];
const audios = [];
let nextId = 0;
const noop = { addListener() {} };

globalThis.Audio = class {
  constructor(src) { this.src = src; this.volume = 1; this.played = false; audios.push(this); }
  async play() { this.played = true; }
};

// Sem offscreen, sem notifications.getPermissionLevel, sem notifications.onButtonClicked.
globalThis.chrome = {
  runtime: {
    getURL: (p) => `moz-extension://x/${p}`,
    onMessage: { addListener: (fn) => { L.onMessage = fn; } },
    sendMessage: async () => {},
    onInstalled: noop,
    onStartup: noop,
  },
  notifications: {
    create: async (id, opts) => {
      // o Firefox rejeita qualquer propriedade fora deste conjunto
      const extra = Object.keys(opts).filter((k) => !['type', 'title', 'message', 'iconUrl'].includes(k));
      if (extra.length) throw new Error(`Property "${extra[0]}" is unsupported by Firefox`);
      created.push({ id: id ?? `n${nextId++}`, opts });
    },
    clear: () => {},
    getAll: async () => ({}),
    onClicked: { addListener: (fn) => { L.onClicked = fn; } },
  },
  omnibox: {
    setDefaultSuggestion: (s) => { omniDefault.push(s); },
    onInputChanged: { addListener: (fn) => { L.omniChanged = fn; } },
    onInputEntered: { addListener: (fn) => { L.omniEntered = fn; } },
  },
  tabs: { query: async () => [], create: async (o) => { tabsCreated.push(o); }, update: async () => {}, onUpdated: noop },
  windows: { getLastFocused: async () => ({ id: 1, focused: true }), update: async () => {} },
  alarms: { get: async () => undefined, create: async () => {}, clear: async () => {}, onAlarm: noop },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
  storage: {
    local: {
      get: async (k) => Object.fromEntries([].concat(k).filter((key) => key in stored).map((key) => [key, stored[key]])),
      set: async (o) => { Object.assign(stored, o); },
      clear: async () => {},
    },
    session: { get: async () => ({}), set: async () => {}, remove: async () => {}, clear: async () => {} },
    onChanged: noop,
  },
  permissions: { remove: async () => true },
};

await import('../extension/background.js');

async function send(msg) {
  mock.timers.enable({ apis: ['setTimeout'] });
  let response;
  const done = new Promise((resolve) => { L.onMessage(msg, {}, (r) => { response = r; resolve(); }); });
  for (let i = 0; i < 30 && !response; i += 1) {
    await new Promise((r) => setImmediate(r));
    mock.timers.tick(1000);
  }
  await done;
  mock.timers.reset();
  return response;
}

test('carrega sem os recursos que o Firefox não tem (offscreen, getPermissionLevel, onButtonClicked)', () => {
  assert.equal(typeof L.onMessage, 'function');
  assert.equal(typeof L.onClicked, 'function');
});

test('exemplos de notificação: os 7 são criados só com as opções que o Firefox aceita', async () => {
  created.length = 0;
  const r = await send({ type: 'demo-notifications', hideContent: false, sound: { enabled: false, name: 'chime', volume: 0.6 } });
  // sem getPermissionLevel não há como saber: segue como permitido
  assert.deepEqual(r, { ok: true, count: 7, permission: 'granted' });
  assert.equal(created.length, 7);
  assert.ok(created.every((c) => Object.keys(c.opts).every((k) => ['type', 'title', 'message', 'iconUrl'].includes(k))));
  assert.equal(created[0].opts.message, 'Analista A: Segue o log do erro e o print da tela de relatórios.\nMunicípio Beta');
  assert.equal(created[6].opts.message, '7 tickets com novidades');
});

test('"ocultar conteúdo" no Firefox: a entidade não aparece em lugar nenhum', async () => {
  created.length = 0;
  await send({ type: 'demo-notifications', hideContent: true, sound: { enabled: false, name: 'chime', volume: 0.6 } });
  assert.doesNotMatch(JSON.stringify(created.map((c) => c.opts)), /Município Beta|Município Gama�|Município Alfa/);
  assert.equal(created[0].opts.message, 'Analista A respondeu');
});

test('som: sem página offscreen, o próprio background toca o arquivo (uma vez por rodada)', async () => {
  created.length = 0;
  audios.length = 0;
  await send({ type: 'demo-notifications', hideContent: false, sound: { enabled: true, name: 'double', volume: 0.5 } });
  assert.equal(audios.length, 1);
  assert.equal(audios[0].src, 'moz-extension://x/sounds/double.wav');
  assert.equal(audios[0].volume, 0.5);
  assert.equal(audios[0].played, true);
});

test('botão "Ouvir" toca mesmo com o som desligado na tela', async () => {
  audios.length = 0;
  const r = await send({ type: 'play-sound', sound: { enabled: false, name: 'alert', volume: 0.8 } });
  assert.deepEqual(r, { ok: true });
  assert.equal(audios.length, 1);
  assert.equal(audios[0].src, 'moz-extension://x/sounds/alert.wav');
});

test('som desligado ou volume 0: não toca nada', async () => {
  audios.length = 0;
  await send({ type: 'demo-notifications', hideContent: false, sound: { enabled: false, name: 'chime', volume: 0.6 } });
  await send({ type: 'demo-notifications', hideContent: false, sound: { enabled: true, name: 'chime', volume: 0 } });
  assert.equal(audios.length, 0);
});

test('barra de endereços no Firefox: a descrição da sugestão é texto puro (sem escapar & e <)', async () => {
  stored.config = { baseUrl: 'https://glpi.test', appToken: 'a', userToken: 'b' };
  stored.state = { tickets: { 7: { id: 7, title: 'Agenda & fila <urgente>', entity: 'Município Beta', dateMod: '2026-09-29 10:00:00' } } };
  let list;
  await L.omniChanged('agenda', (l) => { list = l; });
  assert.deepEqual(list, [{ content: '7', description: '#7 — Agenda & fila <urgente>' }]);
  assert.equal(omniDefault.at(-1).description, 'Digite o número do ticket, um link ou parte do título');
  await L.omniEntered('7', 'newForegroundTab');
  assert.deepEqual(tabsCreated, [{ url: 'https://glpi.test/front/ticket.form.php?id=7' }]);
});
