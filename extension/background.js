// Service worker (MV3): polling via chrome.alarms, notificações e badge.
// Não guarda nada em memória entre execuções: todo estado fica em chrome.storage.
import { createClient, GlpiError } from './src/glpi.js';
import { discover, runPoll, scrubState } from './src/poller.js';
import { sampleNotifications } from './src/samples.js';
import { fetchTicketDetails } from './src/details.js';
import { normalizeSoundConfig, playFile } from './src/sounds.js';
import { normalizeAttention } from './src/attention.js';
import { isFirefox, notificationOptionsFor } from './src/compat.js';
import { failedLabel, isUnderBase, normalizeBaseUrl, parseTicketId, ticketUrl } from './src/format.js';
import {
  getConfig,
  getState,
  getUser,
  isConfigured,
  isPaused,
  markRead,
  mergeConfig,
  pruneUser,
  resetUser,
  sessionStore,
  setState,
  unreadTicketCount,
  updateTags,
  updateUser,
} from './src/store.js';
import { pruneTagAssign, resetAssign } from './src/tags.js';

const ALARM = 'poll';
const ICON = 'icons/icon128.png';
let running = null;
let wiping = false;

function friendly(e) {
  if (e instanceof GlpiError && e.code === 'NETWORK') {
    return 'Sem conexão com o GLPI. Confira a VPN/rede e a permissão do site nas opções.';
  }
  return e instanceof GlpiError ? e.message : String(e?.message ?? e);
}

async function ensureAlarm(force = false) {
  const [cfg, user] = await Promise.all([getConfig(), getUser()]);
  if (isPaused(user)) {
    await chrome.alarms.clear(ALARM); // pausado: nem acorda o service worker
    return;
  }
  const existing = await chrome.alarms.get(ALARM);
  if (!force && existing?.periodInMinutes === cfg.pollMinutes) return;
  await chrome.alarms.create(ALARM, { delayInMinutes: 0.1, periodInMinutes: cfg.pollMinutes });
}

async function updateBadge() {
  const [cfg, state, user] = await Promise.all([getConfig(), getState(), getUser()]);
  let text;
  let color = '#dc2626';
  let title;
  if (!isConfigured(cfg)) {
    text = '!';
    color = '#b45309';
    title = 'MyTicket — configure a URL e os tokens nas opções';
  } else if (isPaused(user)) {
    const n = unreadTicketCount(state, user);
    text = 'II';
    color = '#6b7280';
    title = `MyTicket — sincronização pausada${n ? ` · ${n} ticket(s) com novidades` : ''}`;
  } else if (state.lastRun && !state.lastRun.ok) {
    text = '!';
    color = '#6b7280';
    title = `MyTicket — erro: ${state.lastRun.error}`;
  } else {
    const n = unreadTicketCount(state, user);
    text = n ? String(n) : '';
    title = n ? `MyTicket — ${n} ticket(s) com novidades` : 'MyTicket — tudo em dia';
    const failed = failedLabel(state.lastRun?.failed);
    if (failed) title += ` · ${failed}`;
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setTitle({ title });
}

function poll() {
  if (wiping) return Promise.resolve();
  if (running) return running;
  running = (async () => {
    const cfg = await getConfig();
    const state = await getState();
    if (!isConfigured(cfg)) return;
    try {
      const user = await getUser();
      if (isPaused(user)) return; // pausado pela pessoa: nenhuma requisição ao GLPI, nem pelo "Atualizar agora"
      const api = createClient({ ...cfg, sessionStore });
      const result = await runPoll({ cfg, state, watched: user.watched, api });
      await setState(result.state);
      await updateUser((u) => pruneUser(u, result.state, result.expired)); // só grava se houver o que tirar
      await updateTags((t) => pruneTagAssign(t, result.state.tickets)); // marcações de tickets que sumiram há mais de 60 dias
      if (result.reset) {
        // outra conta ou outro GLPI: os números de ticket (acompanhados, "lido em", tags) eram do lugar anterior
        await updateUser(resetUser);
        await updateTags(resetAssign);
      }
      await notify(result.notifications, cfg);
    } catch (e) {
      await setState({ ...state, lastRun: { ok: false, at: Date.now(), error: friendly(e) } });
    }
  })().finally(async () => {
    running = null;
    await updateBadge();
  });
  return running;
}

// Opções do toast: as mesmas para os avisos reais e para os exemplos das Opções.
// `silent` desliga o som padrão do sistema (quando o som da extensão está ligado, para não tocar dois).
const toastOptions = (n, silent = false, sticky = false) => ({
  type: 'basic',
  iconUrl: chrome.runtime.getURL(ICON),
  title: n.title,
  message: n.message,
  contextMessage: n.context || undefined,
  priority: 1,
  silent,
  requireInteraction: sticky,
  buttons: [{ title: 'Abrir' }, { title: 'Marcar como lido' }],
});
const summaryOptions = (count, silent = false) => ({
  type: 'basic',
  iconUrl: chrome.runtime.getURL(ICON),
  title: 'MyTicket',
  message: `${count} tickets com novidades`,
  silent,
});

// Todo aviso nasce aqui: o Firefox só aceita parte das opções (veja src/compat.js).
const showNotification = (id, opts) => chrome.notifications.create(id, notificationOptionsFor(opts, { firefox: isFirefox() }));

// Som: a página offscreen toca (o service worker não tem áudio). Se ela ainda não existe, a URL já
// leva o pedido; se já existe (fecha sozinha após ~30 s sem áudio), o pedido vai por mensagem.
// No Firefox não há offscreen, mas o background é uma página com áudio: toca direto.
let offscreenCreating = null;
async function playSound(sound, { force = false } = {}) {
  const s = normalizeSoundConfig(sound);
  if ((!s.enabled && !force) || s.volume <= 0) return;
  try {
    if (!chrome.offscreen?.createDocument) {
      await playFile(s.name, s.volume, { url: (p) => chrome.runtime.getURL(p) });
      return;
    }
    const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (open.length) {
      await chrome.runtime.sendMessage({ target: 'offscreen', type: 'play', sound: s.name, volume: s.volume });
      return;
    }
    offscreenCreating ??= chrome.offscreen
      .createDocument({
        url: `offscreen.html?${new URLSearchParams({ sound: s.name, volume: String(s.volume) })}`,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Tocar o aviso sonoro quando chegar uma notificação',
      })
      .finally(() => { offscreenCreating = null; });
    await offscreenCreating;
  } catch {
    /* o som é opcional: uma falha aqui nunca pode impedir a notificação */
  }
}

// Pisca o Chrome na barra de tarefas (só se a janela não estiver em foco). Independe do banner do Windows.
async function flashTaskbar() {
  try {
    const win = await chrome.windows.getLastFocused();
    if (win && !win.focused) await chrome.windows.update(win.id, { drawAttention: true });
  } catch {
    /* sem janela aberta (Chrome só em segundo plano): nada a piscar */
  }
}

async function notify(items, cfg) {
  if (!items.length) return;
  const sound = normalizeSoundConfig(cfg.sound);
  const attention = normalizeAttention(cfg.attention);
  await playSound(sound); // uma vez por rodada, mesmo com vários tickets
  if (items.length > 5) {
    await showNotification(`summary:${Date.now()}`, summaryOptions(items.length, sound.enabled));
  } else {
    for (const n of items) {
      await showNotification(`t:${n.ticketId}:${Date.now()}`, toastOptions(n, sound.enabled, attention.sticky));
    }
  }
  if (attention.flash) await flashTaskbar();
}

// Dispara uma notificação de cada tipo (dados fictícios, id "demo:") para a pessoa ver como o
// sistema as mostra. Espaçadas em 1 s, porque o Windows só exibe alguns toasts ao mesmo tempo.
async function demoNotifications(hideContent, sound, attention) {
  const samples = sampleNotifications({ hideContent });
  // "denied" = a pessoa (ou o sistema) desativou as notificações desta extensão: create() dá certo mas nada aparece
  // (o Firefox não tem getPermissionLevel: sem como saber, segue como permitido)
  const permission = (await Promise.resolve(chrome.notifications.getPermissionLevel?.()).catch(() => undefined)) ?? 'granted';
  await playSound(sound);
  for (const [i, n] of samples.entries()) {
    const opts = n.summary
      ? summaryOptions(n.count, sound.enabled)
      : { ...toastOptions(n, sound.enabled, attention.sticky), title: `Exemplo · ${n.title}` };
    await showNotification(`demo:${n.key}:${Date.now()}`, opts);
    if (i < samples.length - 1) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (attention.flash) await flashTaskbar();
  return { count: samples.length, permission };
}

async function openTicket(id) {
  const cfg = await getConfig();
  let existing;
  try {
    const tabs = await chrome.tabs.query({ url: `${cfg.baseUrl}/front/ticket.form.php*` });
    existing = tabs.find((t) => parseTicketId(t.url) === id);
  } catch {
    existing = undefined;
  }
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: ticketUrl(cfg.baseUrl, id) });
  }
  await markRead(id);
}

// Detalhes ao vivo para a tela de um ticket no popup (não grava nada no cache).
async function ticketDetails(id) {
  const cfg = await getConfig();
  if (!isConfigured(cfg)) return { ok: false, error: 'Configure a conexão com o GLPI nas Opções.' };
  try {
    const state = await getState();
    const api = createClient({ ...cfg, sessionStore });
    const meId = state.me?.id ?? (await api.me()).id;
    const details = await fetchTicketDetails({ api, id, meId, users: state.users, hideContent: cfg.hideContent });
    return { ok: true, details };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

async function testConnection(input) {
  const cfg = mergeConfig({ ...input, baseUrl: normalizeBaseUrl(input.baseUrl) });
  if (!isConfigured(cfg)) return { ok: false, error: 'Preencha a URL e os dois tokens.' };
  try {
    const api = createClient(cfg); // sem sessionStore: teste isolado
    const me = await api.me();
    const version = await api.version().catch(() => null);
    const found = await discover({ cfg, api, meId: me.id });
    const counts = { assigned: 0, observer: 0, requester: 0 };
    for (const { sources } of found.values()) for (const s of sources) counts[s] += 1;
    return { ok: true, user: me, version, counts };
  } catch (e) {
    return { ok: false, error: friendly(e) };
  }
}

// Ao ligar "ocultar conteúdo", limpa o texto que já estava no cache (depois do polling em curso,
// que pode ter gravado o estado com a configuração antiga).
async function scrubStoredState() {
  await running?.catch(() => {});
  await setState(scrubState(await getState()));
}

// Apaga tudo o que a extensão guarda neste navegador. Espera o polling em andamento terminar
// (senão ele regravaria o cache logo depois) e bloqueia novos enquanto apaga.
async function wipe() {
  wiping = true;
  try {
    await running?.catch(() => {});
    const { baseUrl } = await getConfig();
    await chrome.storage.local.clear();
    await chrome.storage.session.clear().catch(() => {});
    const shown = await chrome.notifications.getAll();
    await Promise.all(Object.keys(shown).map((nid) => chrome.notifications.clear(nid)));
    try {
      await chrome.permissions.remove({ origins: [`${new URL(baseUrl).origin}/*`] });
    } catch {
      /* permissão já ausente ou URL inválida: nada a retirar */
    }
    await updateBadge();
  } finally {
    wiping = false;
  }
}

// Só "t:<ticket>:<ts>" leva a um ticket; "summary:" e "demo:" não.
const notificationTicketId = (nid) => (nid.startsWith('t:') ? Number(nid.split(':')[1]) || null : null);

chrome.notifications.onClicked.addListener(async (nid) => {
  if (nid.startsWith('demo:')) return chrome.notifications.clear(nid);
  const id = notificationTicketId(nid);
  if (id) await openTicket(id);
  else await chrome.action.openPopup?.().catch(() => {});
  chrome.notifications.clear(nid);
});

// Os botões do aviso só existem no Chrome/Edge; no Firefox este evento não existe (ou nunca dispara).
chrome.notifications.onButtonClicked?.addListener(async (nid, button) => {
  if (nid.startsWith('demo:')) return chrome.notifications.clear(nid);
  const id = notificationTicketId(nid);
  if (id) await (button === 0 ? openTicket(id) : markRead(id));
  chrome.notifications.clear(nid);
});

// Abrir um ticket do GLPI em qualquer aba marca as novidades dele como lidas.
chrome.tabs.onUpdated.addListener(async (_tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url) return;
  const { baseUrl } = await getConfig();
  if (!baseUrl || !isUnderBase(tab.url, baseUrl)) return;
  const id = parseTicketId(tab.url);
  if (id) await markRead(id);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) poll();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.config) {
    const oldC = changes.config.oldValue ?? {};
    const newC = changes.config.newValue ?? {};
    if (oldC.baseUrl !== newC.baseUrl || oldC.appToken !== newC.appToken || oldC.userToken !== newC.userToken) {
      sessionStore.set(null); // credenciais mudaram: descarta a sessão em cache
    }
    if (newC.hideContent && !oldC.hideContent) scrubStoredState();
    ensureAlarm(true);
  }
  if (changes.user) {
    const was = isPaused(changes.user.oldValue);
    const now = isPaused(changes.user.newValue);
    if (was !== now) {
      ensureAlarm(true); // pausou: cancela o alarme; retomou: recria
      if (!now) poll(); // retomou: já busca o que aconteceu enquanto estava pausado
    }
  }
  if (changes.config || changes.state || changes.user) updateBadge();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'poll-now') {
    poll().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'test') {
    testConnection(msg.config).then(sendResponse);
    return true;
  }
  if (msg?.type === 'open') {
    openTicket(Number(msg.id)).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'demo-notifications') {
    // usa o som da tela de Opções (mesmo sem salvar); sem ele, o da configuração salva
    getConfig()
      .then((cfg) => demoNotifications(
        Boolean(msg.hideContent),
        normalizeSoundConfig(msg.sound ?? cfg.sound),
        normalizeAttention(msg.attention ?? cfg.attention),
      ))
      .then(
        ({ count, permission }) => sendResponse({ ok: true, count, permission }),
        (e) => sendResponse({ ok: false, error: String(e?.message ?? e) }),
      );
    return true;
  }
  if (msg?.type === 'ticket-details') {
    ticketDetails(Number(msg.id)).then(sendResponse);
    return true;
  }
  if (msg?.type === 'play-sound') {
    // botão "Ouvir": toca mesmo com o som desligado na tela
    playSound(msg.sound, { force: true }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'wipe') {
    wipe().then(
      () => sendResponse({ ok: true }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm(true);
  poll();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm(true);
  poll();
});

ensureAlarm();
updateBadge();
