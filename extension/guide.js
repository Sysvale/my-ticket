import { getConfig, getState, getUser } from './src/store.js';
import { sampleNotifications } from './src/samples.js';
import { buildChecks, demoResultText, NOTIFY_LABEL } from './src/diagnostics.js';
import { isSecureUrl, timeAgo } from './src/format.js';

const $ = (sel) => document.querySelector(sel);

// DOM só com textContent: nada é interpretado como HTML.
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
}

// ---------- o que cada tipo de aviso significa ----------
const INFO = {
  followup: { label: 'Alguém respondeu', when: 'Outra pessoa escreve um acompanhamento num ticket do seu radar.' },
  solution: { label: 'Solução proposta', when: 'Alguém registra uma solução no ticket.' },
  extra: { label: 'Status extra mudou', when: 'O campo Status extra muda, por exemplo de “Em análise” para “Devolvido”.' },
  status: { label: 'Status do ticket mudou', when: 'O status muda sem resposta nova, por exemplo de Em atendimento para Pendente.' },
  new: { label: 'Ticket novo no radar', when: 'Um ticket passa a ser seu (atribuído, observador ou requerente).' },
  multi: { label: 'Vários eventos no mesmo ticket', when: 'Mais de um evento no mesmo ticket na mesma verificação: vira um aviso só, com “(+N)”.' },
  summary: { label: 'Muitos tickets de uma vez', when: 'Mais de 5 tickets com novidade na mesma verificação: um resumo no lugar dos avisos individuais.' },
};
// tipos que podem ser ligados/desligados nas Opções (multi e summary não têm interruptor próprio)
const TOGGLE = { followup: 'followup', solution: 'solution', extra: 'extra', status: 'status', new: 'new' };

// ---------- aviso de exemplo (aproximação do toast do Windows) ----------
const pin = (n) => h('span', { class: 'pin' }, String(n));

function toast(n, { annotate = false } = {}) {
  const title = h('div', { class: 't' }, annotate ? pin(1) : null, n.title);
  const message = h('div', { class: 'm' }, annotate ? pin(2) : null, n.message);
  const text = h('div', { class: 'txt' }, title, message,
    n.context ? h('div', { class: 'c' }, annotate ? pin(3) : null, n.context) : null);
  const open = h('span', {}, annotate ? pin(4) : null, 'Abrir');
  return h('div', { class: 'toast' },
    h('div', { class: 'app' },
      h('img', { src: 'icons/icon48.png', alt: '' }), h('span', {}, 'MyTicket · agora'), h('span', { class: 'x' }, '✕')),
    h('div', { class: 'body' }, h('img', { src: 'icons/icon128.png', alt: '' }), text),
    n.summary ? null : h('div', { class: 'btns' }, open, h('span', {}, 'Marcar como lido')));
}

// ---------- estado ----------
let cfg = null;

function renderGallery() {
  const hide = $('#g-hide').checked;
  const samples = sampleNotifications({ hideContent: hide });
  $('#anatomy').replaceChildren(toast(samples[0], { annotate: true }));

  $('#gallery').replaceChildren(...samples.map((n) => {
    const info = INFO[n.key];
    const flag = TOGGLE[n.key];
    const on = flag ? cfg.notify[flag] : null;
    return h('article', { class: 'case' },
      h('div', { class: 'case-head' },
        h('h3', {}, info.label),
        flag ? h('span', { class: `chip ${on ? 'ok' : 'danger'}` }, on ? 'ligado' : 'desligado nas Opções') : null),
      h('p', {}, info.when),
      h('div', { class: 'desk' }, toast(n)));
  }));
}

const ICON = { ok: '✓', bad: '✕', warn: '!', manual: 'i' };

function renderChecks(list) {
  $('#checks').replaceChildren(...list.map((c) => {
    const steps = Array.isArray(c.fix) ? h('ol', {}, c.fix.map((s) => h('li', {}, s))) : c.fix;
    const fixLabel = c.level === 'manual' ? 'O que conferir' : 'Como resolver';
    return h('li', { class: `check-row ${c.level}` },
      h('span', { class: 'ico', 'aria-hidden': 'true' }, ICON[c.level]),
      h('div', { class: 'body' },
        h('strong', {}, c.title),
        h('span', { class: 'sr' }, ` (${{ ok: 'ok', bad: 'problema', warn: 'atenção', manual: 'conferir manualmente' }[c.level]})`),
        h('p', {}, c.detail),
        c.fix && c.level !== 'ok'
          ? h('details', { open: c.level === 'bad' || c.level === 'manual' }, h('summary', {}, fixLabel), steps)
          : null));
  }));
}

function renderRules() {
  const every = cfg.pollMinutes;
  $('#rules').replaceChildren(...[
    `Um aviso por ticket a cada verificação (a cada ${every} min, configurável nas Opções). Vários eventos do mesmo ticket viram um só, com “(+N)”.`,
    'Mais de 5 tickets com novidade na mesma verificação: um único aviso-resumo.',
    'Só o que é novo desde a última verificação. Suas próprias respostas são ignoradas (a menos que você ligue a opção), e a primeira verificação é silenciosa: não avisa o histórico.',
    'Clicar no aviso ou em Abrir abre o ticket no GLPI (reaproveita a aba se já estiver aberta) e marca como lido. Marcar como lido só limpa o destaque.',
    'Normalmente o aviso some sozinho em alguns segundos e fica na Central de Notificações do Windows (Win + N). Ele não é fixo.',
    'Além do aviso: o ícone da extensão mostra quantos tickets têm novidade, e o ticket fica destacado no popup até você abri-lo ou marcar como lido.',
    'O som toca uma vez por verificação, mesmo com vários tickets. Com o som da extensão ligado, o som padrão do Windows para os avisos dela fica desativado.',
    'Com a sincronização pausada (botão de pausa no popup), nada é buscado nem avisado até você retomar; ao retomar, o que aconteceu nesse meio-tempo é buscado e avisado.',
    'Com “Ocultar conteúdo”, o aviso mostra só o número do ticket e quem respondeu, sem título, texto nem entidade.',
  ].map((t) => h('li', {}, t)));
}

async function collectAndRender() {
  cfg = await getConfig();
  const state = await getState();
  const user = await getUser();

  let permission;
  try { permission = await chrome.notifications.getPermissionLevel(); } catch { permission = undefined; }

  let hostGranted = null;
  if (cfg.baseUrl && isSecureUrl(cfg.baseUrl)) {
    try { hostGranted = await chrome.permissions.contains({ origins: [`${new URL(cfg.baseUrl).origin}/*`] }); } catch { hostGranted = null; }
  }

  renderChecks(buildChecks({ cfg, state, user, permission, hostGranted }));
  renderRules();
  $('#recheck-at').textContent = `Verificado ${timeAgo(Date.now())}.`;
}

// ---------- eventos ----------
$('#recheck').addEventListener('click', async () => {
  await collectAndRender();
  renderGallery();
});
$('#g-hide').addEventListener('change', renderGallery);

$('#g-demo').addEventListener('click', async () => {
  const btn = $('#g-demo');
  btn.disabled = true;
  $('#g-status').textContent = 'Enviando os exemplos, um por segundo…';
  try {
    const r = await chrome.runtime.sendMessage({ type: 'demo-notifications', hideContent: $('#g-hide').checked, sound: cfg.sound });
    $('#g-status').textContent = demoResultText(r);
  } catch {
    $('#g-status').textContent = 'Não foi possível falar com a extensão. Recarregue-a em chrome://extensions.';
  } finally {
    btn.disabled = false;
  }
});

$('#g-sound').addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'play-sound', sound: cfg.sound });
  } catch {
    $('#g-status').textContent = 'Não foi possível falar com a extensão. Recarregue-a em chrome://extensions.';
  }
});

collectAndRender().then(() => {
  $('#g-hide').checked = cfg.hideContent;
  renderGallery();
});
