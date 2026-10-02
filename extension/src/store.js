// Acesso ao chrome.storage. Três chaves, com donos diferentes para evitar corrida:
//   config  -> escrita pela página de opções
//   user    -> escrita pela UI (tickets manuais, "lido em", fixados)
//   state   -> escrita só pelo poller (cache de tickets, eventos)
//   appearance -> escrita pela aba "Aparência" das Opções (tema, neon)
// O session_token do GLPI fica em storage.session (some ao fechar o navegador).
import { mergeFilters } from './filters.js';
import { emptyState } from './poller.js';
import { normalizeTags } from './tags.js';
import { normalizeAppearance } from './appearance.js';
import { prunePinned } from './pins.js';
import { normalizeGroupBy, normalizeSections } from './grouping.js';

export const DEFAULT_CONFIG = {
  baseUrl: '', // cada pessoa informa o endereço do seu GLPI nas Opções
  appToken: '',
  userToken: '',
  pollMinutes: 2,
  roles: { assigned: true, observer: true, requester: true },
  notify: { followup: true, solution: true, status: true, extra: true, new: true },
  notifyOwn: false,
  hideContent: false, // notificações sem título/texto e sem guardar o texto das respostas
  sound: { enabled: true, name: 'chime', volume: 0.6 }, // aviso sonoro (tocado pela página offscreen)
  attention: { flash: true, sticky: false }, // piscar na barra de tarefas / aviso que não some sozinho
  extraField: 90001, // search option do Status extra (plugin Fields)
};

export function mergeConfig(c = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...c,
    roles: { ...DEFAULT_CONFIG.roles, ...c.roles },
    notify: { ...DEFAULT_CONFIG.notify, ...c.notify },
    sound: { ...DEFAULT_CONFIG.sound, ...c.sound },
    attention: { ...DEFAULT_CONFIG.attention, ...c.attention },
  };
}

export const isConfigured = (cfg) => Boolean(cfg.baseUrl && cfg.appToken && cfg.userToken);

export async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  return mergeConfig(config);
}

export const setConfig = (config) => chrome.storage.local.set({ config });

export async function getState() {
  const { state } = await chrome.storage.local.get('state');
  return { ...emptyState(), ...state };
}

export const setState = (state) => chrome.storage.local.set({ state });

export async function getUser() {
  const { user } = await chrome.storage.local.get('user');
  return { watched: {}, readAt: {}, pinned: [], ...user };
}

// Gravar `user` (ou `tags`) é ler → alterar → gravar, e o popup, as Opções e o service worker fazem isso ao mesmo
// tempo (ex.: "acompanhar" no popup × "lido" ao abrir a aba no GLPI): sem serializar, uma grava por cima da outra.
// A fila serializa dentro de um contexto e o Web Locks (navigator.locks), entre popup, opções e service worker.
// Uma fila/trava por chave: gravar `tags` não espera gravar `user`.
const queues = {};
function serialized(name, fn) {
  const inContext = (queues[name] ?? Promise.resolve())
    .then(() => (globalThis.navigator?.locks ? navigator.locks.request(`myticket:${name}`, fn) : fn()));
  queues[name] = inContext.catch(() => {}); // uma falha não trava quem vem depois
  return inContext;
}

// `mutate` altera o objeto; se devolver `false`, nada mudou e nada é gravado (não acorda quem ouve o storage).
export function updateUser(mutate) {
  return serialized('user', async () => {
    const user = await getUser();
    if (mutate(user) === false) return user;
    await chrome.storage.local.set({ user });
    return user;
  });
}

// Tags personalizadas (src/tags.js). Só neste navegador: chrome.storage.local, nunca storage.sync, nunca o GLPI.
// Escritas pelo popup e pelas Opções; o background só limpa (marcações de tickets antigos, troca de conta).
export async function getTags() {
  const { tags } = await chrome.storage.local.get('tags');
  return normalizeTags(tags);
}

// `mutate` altera o objeto (funções de src/tags.js); se devolver `false`, nada mudou e nada é gravado.
export function updateTags(mutate) {
  return serialized('tags', async () => {
    const tags = await getTags();
    if (mutate(tags) === false) return tags;
    await chrome.storage.local.set({ tags });
    return tags;
  });
}

// Aparência (src/appearance.js): tema e neon. Escrita só pela aba "Aparência" das Opções; as demais páginas só leem.
export async function getAppearance() {
  const { appearance } = await chrome.storage.local.get('appearance');
  return normalizeAppearance(appearance);
}

// `mutate` altera o objeto; se devolver `false`, nada mudou e nada é gravado.
export function updateAppearance(mutate) {
  return serialized('appearance', async () => {
    const appearance = await getAppearance();
    if (mutate(appearance) === false) return appearance;
    await chrome.storage.local.set({ appearance });
    return appearance;
  });
}

export const isPaused = (user) => Boolean(user?.paused);

// Pausa pedida pela pessoa: o service worker não busca nada no GLPI (e o alarme é cancelado) até ela retomar.
// Fica em `user` (escrito pela interface); o background reage à mudança pelo storage.onChanged.
export const setPaused = (paused) =>
  updateUser((u) => {
    if (isPaused(u) === paused) return false; // já estava assim: não grava
    u.paused = paused;
    u.pausedAt = paused ? Date.now() : null;
  });

// Trocou de conta ou de GLPI: os tickets acompanhados, o "lido em" e os fixados eram de outro lugar. Devolve false se já
// estava vazio.
export function resetUser(user) {
  const had = Object.keys(user.watched).length + Object.keys(user.readAt).length + (user.pinned?.length ?? 0);
  user.watched = {};
  user.readAt = {};
  user.pinned = [];
  return had > 0;
}

// Tira do `user` o que não serve mais: tickets acompanhados que expiraram (`expired`, vindo do poller), o "lido em" e os
// fixados de tickets que já saíram do cache. Devolve false quando não havia nada a tirar.
export function pruneUser(user, state, expired = []) {
  let changed = false;
  for (const id of expired) {
    if (id in user.watched) {
      delete user.watched[id];
      changed = true;
    }
  }
  for (const id of Object.keys(user.readAt)) {
    if (!(id in (state.tickets ?? {}))) {
      delete user.readAt[id];
      changed = true;
    }
  }
  if (prunePinned(user, state)) changed = true;
  return changed;
}

// Estado da interface do popup (filtros, painel aberto, como a lista é agrupada e quais seções a pessoa abriu ou fechou).
// Só o popup escreve.
export async function getUi() {
  const { ui } = await chrome.storage.local.get('ui');
  return {
    filters: mergeFilters(ui?.filters),
    panelOpen: Boolean(ui?.panelOpen),
    groupBy: normalizeGroupBy(ui?.groupBy),
    sections: normalizeSections(ui?.sections),
  };
}

export const setUi = (ui) => chrome.storage.local.set({ ui });

export const markRead = (id) =>
  updateUser((u) => {
    u.readAt[id] = Date.now();
  });

export async function markAllRead() {
  const state = await getState();
  const now = Date.now();
  return updateUser((u) => {
    for (const id of Object.keys(state.tickets)) u.readAt[id] = now;
  });
}

export const unreadEvents = (ticket, readAt = {}) =>
  (ticket.events ?? []).filter((e) => e.at > (readAt[ticket.id] ?? 0));

export const unreadTicketCount = (state, user) =>
  Object.values(state.tickets ?? {}).filter((t) => unreadEvents(t, user.readAt).length > 0).length;

export const sessionStore = {
  async get() {
    try {
      return (await chrome.storage.session.get('sessionToken')).sessionToken ?? null;
    } catch {
      return null;
    }
  },
  async set(token) {
    try {
      if (token) await chrome.storage.session.set({ sessionToken: token });
      else await chrome.storage.session.remove('sessionToken');
    } catch {
      /* storage.session indisponível: só perde o cache da sessão */
    }
  },
};
