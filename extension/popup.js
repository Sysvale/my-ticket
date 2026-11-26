import {
  getAppearance,
  getConfig,
  getState,
  getTags,
  getUi,
  getUser,
  isConfigured,
  isPaused,
  markAllRead,
  markRead,
  setPaused,
  setUi,
  unreadEvents,
  updateTags,
  updateUser,
} from './src/store.js';
import {
  PRIORITY,
  SOURCE_LABEL,
  STATUS,
  describeEvent,
  failedLabel,
  formatDateTime,
  isUnderBase,
  parseGlpiDate,
  parseTicketId,
  ticketUrl,
  timeAgo,
} from './src/format.js';
import {
  DEFAULT_FILTERS,
  NO_EXTRA,
  NO_TAG,
  activeFilterCount,
  applyFilters,
  filterOptions,
  sanitizeFilters,
} from './src/filters.js';
import { h, tagColor } from './src/dom.js';
import { GROUP_LABEL, GROUP_MODES, groupTickets, isSectionOpen, normalizeGroupBy, withSectionOpen } from './src/grouping.js';
import { isPinned, splitPinned, summaryText, togglePin } from './src/pins.js';
import { closePickers, createPicker } from './src/picker-ui.js';
import { LIMITS, createTag, defsOf, tagsOfTicket, toggleTag } from './src/tags.js';
import { donutModel, formatSpan } from './src/timeshare.js';
import { staleLevel, staleText } from './src/stale.js';

const $ = (sel) => document.querySelector(sel);

const chip = (text, tone = '', title, style) => h('span', { class: `chip ${tone}`.trim(), title, style }, text);
const isDone = (t) => t.status != null && t.status >= 5;
const modMs = (t) => parseGlpiDate(t.dateMod) || 0;
const openTicket = (id) => chrome.runtime.sendMessage({ type: 'open', id });
const openOptions = () => chrome.runtime.openOptionsPage();

// A mesma página serve ao popup e ao painel lateral (side_panel.default_path traz "?panel"). Só o Chrome/Edge têm o painel.
const inPanel = location.search === '?panel';
if (inPanel) document.body.classList.add('panel');

// Popup → painel: abre o painel na janela atual e lembra a escolha (o ícone passa a abri-lo). O open() tem de vir
// logo do clique. Painel → popup: lembra a escolha, abre o popup e fecha o painel; o ícone volta a abrir o popup.
const surfaceBtn = $('#surface');
if (chrome.sidePanel) {
  const label = inPanel ? 'Voltar ao popup' : 'Abrir no painel lateral';
  surfaceBtn.title = label;
  surfaceBtn.setAttribute('aria-label', label);
  surfaceBtn.hidden = false;
  surfaceBtn.addEventListener('click', async () => {
    if (!inPanel) await chrome.sidePanel.open({ windowId: (await chrome.windows.getCurrent()).id });
    await chrome.storage.local.set({ surface: inPanel ? 'popup' : 'panel' });
    if (inPanel) {
      // O background só religa o popup depois do onChanged: faz aqui mesmo, senão o openPopup() abriria nada.
      await chrome.action.setPopup({ popup: 'popup.html' });
      await chrome.action.openPopup?.().catch(() => {}); // Chrome 127+; antes disso o popup só abre no próximo clique
    }
    window.close();
  });
}

// ---------- estado da tela ----------
let data = null; // { cfg, state, user, tags } do storage
let ui = null; // { filters, panelOpen }: fonte da verdade enquanto o popup está aberto
let saveTimer;
let qTimer;

let openId = null; // ticket aberto na tela de detalhes (null = tela da lista)
let detail = null; // { state: 'loading' | 'ok' | 'error', data?, error? } dos detalhes ao vivo
let newSince = 0; // eventos com `at` maior que isso eram novos quando os detalhes foram abertos
let listScroll = 0;
let copied = false;
let share = null; // gráfico de tempo por atribuído do ticket aberto: { id, state, entry?, error?, includeUnknown, fetchedAt }
let openTagsId = null; // ticket com o painel de tags aberto (na lista ou nos detalhes)
let tagDraft = { id: null, name: '', stage: false, error: '' }; // nova tag em digitação: sobrevive aos repintes

const saveUi = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushUi, 200);
};

// Grava já o que estava esperando o atraso. O popup fecha ao menor clique fora dele, e sem isto o último
// filtro escolhido se perdia se ele fechasse dentro dos 200 ms.
function flushUi() {
  if (saveTimer == null) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  setUi(ui);
}
window.addEventListener('pagehide', flushUi);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushUi(); });

function setFilter(patch) {
  ui.filters = { ...ui.filters, ...patch };
  saveUi();
  paint();
}

function clearFilters() {
  ui.filters = { ...DEFAULT_FILTERS };
  $('#q').value = '';
  saveUi();
  paint();
}

// ---------- tags ----------
// Etapa mostra desde quando ("PR em review · há 2 d"); etiqueta, só o nome.
const tagChip = ({ def, at }) => {
  const { cls, style } = tagColor(def.color);
  return chip(
    def.stage ? `${def.name} · ${timeAgo(at)}` : def.name,
    `tag ${cls}`,
    def.stage ? `Etapa desde ${formatDateTime(at)}` : `Etiqueta marcada em ${formatDateTime(at)}`,
    style,
  );
};
const draftFor = (id) => (tagDraft.id === id ? tagDraft : { id, name: '', stage: false, error: '' });
const toggleTagFor = (ticketId, tagId) => updateTags((t) => toggleTag(t, ticketId, tagId, Date.now()));
const openTagsManager = () => chrome.tabs.create({ url: chrome.runtime.getURL('options.html#tags') });

function toggleTagsPanel(id) {
  openTagsId = openTagsId === id ? null : id;
  paint();
}

// Cria a tag e já marca no ticket. Erro (nome vazio, repetido...) fica na tela; sucesso repinta pelo storage.
async function submitNewTag(ticketId) {
  const draft = draftFor(ticketId);
  let outcome;
  await updateTags((t) => {
    outcome = createTag(t, { name: draft.name, stage: draft.stage });
    if (!outcome.ok) return false; // nada a gravar
    toggleTag(t, ticketId, outcome.id, Date.now());
  });
  tagDraft = outcome.ok ? { id: null, name: '', stage: false, error: '' } : { ...draft, error: outcome.error };
  if (!outcome.ok) paint();
}

// Painel dentro do card (ou dos detalhes): marcar/desmarcar e criar. Cada controle tem um data-focus para o
// foco do teclado voltar ao mesmo lugar quando a tela é recriada.
function tagPanel(ticketId) {
  const defs = defsOf(data.tags);
  const mine = new Set((data.tags.assign[String(ticketId)] ?? []).map((e) => e.tag));
  const group = (title, list) => (list.length
    ? h('div', { class: 'tp-group' },
      h('span', { class: 'tp-label' }, title),
      h('div', { class: 'tp-opts' }, list.map((d) => h('button', {
        class: `tagopt ${tagColor(d.color).cls}`,
        style: tagColor(d.color).style,
        type: 'button',
        'aria-pressed': String(mine.has(d.id)),
        'data-focus': `tag:${ticketId}:${d.id}`,
        onclick: () => toggleTagFor(ticketId, d.id),
      }, d.name))))
    : null);

  const draft = draftFor(ticketId);
  const name = h('input', {
    type: 'text',
    class: 'tp-name',
    maxlength: String(LIMITS.name),
    placeholder: 'Nova tag',
    autocomplete: 'off',
    'aria-label': 'Nome da nova tag',
    'data-focus': `newtag:${ticketId}`,
    oninput: (ev) => { tagDraft = { ...draftFor(ticketId), name: ev.target.value, error: '' }; },
  });
  name.value = draft.name;
  const kind = h('select', {
    'aria-label': 'Tipo da nova tag',
    'data-focus': `newkind:${ticketId}`,
    onchange: (ev) => { tagDraft = { ...draftFor(ticketId), stage: ev.target.value === 'stage' }; },
  }, h('option', { value: 'label' }, 'Etiqueta'), h('option', { value: 'stage' }, 'Etapa'));
  kind.value = draft.stage ? 'stage' : 'label';

  return h('div', { class: 'tagpanel', role: 'group', 'aria-label': `Tags do ticket ${ticketId}` },
    group('Etapa (uma por ticket)', defs.filter((d) => d.stage)),
    group('Etiquetas (quantas quiser)', defs.filter((d) => !d.stage)),
    h('form', { class: 'tp-new', onsubmit: (ev) => { ev.preventDefault(); submitNewTag(ticketId); } },
      name, kind, h('button', { class: 'btn', type: 'submit' }, 'Criar')),
    draft.error ? h('p', { class: 'tp-error', role: 'alert' }, draft.error) : null,
    h('div', { class: 'tp-foot' },
      h('span', { class: 'muted' }, 'Só neste navegador: não vão ao GLPI.'),
      h('button', { class: 'btn link', type: 'button', onclick: openTagsManager }, 'Gerenciar tags…')));
}

const tagsButton = (id) => h('button', {
  class: 'btn link',
  type: 'button',
  'data-focus': `tagsbtn:${id}`,
  'aria-expanded': String(openTagsId === id),
  onclick: () => toggleTagsPanel(id),
}, 'Tags');

// Fixar mantém o ticket no topo da lista, mesmo com filtros (src/pins.js). Sem limite de quantidade.
const pinButton = (t, pinned) => h('button', {
  class: 'btn link',
  type: 'button',
  'data-focus': `pin:${t.id}`,
  'aria-pressed': String(pinned),
  title: pinned ? 'Tirar este ticket do topo da lista' : 'Manter este ticket no topo da lista, mesmo com filtros',
  onclick: () => updateUser((u) => { togglePin(u, t.id); }),
}, pinned ? 'Desafixar' : 'Fixar');

// ---------- cards da lista ----------
// Ticket em aberto sem movimentação há muito tempo (src/stale.js): borda âmbar/vermelha no card e o texto "parado há …".
// Usa o dateMod que já está no cache: nenhuma consulta ao GLPI. Com a opção desligada nas Opções, devolve null.
function staleInfo(t) {
  const now = Date.now();
  const level = staleLevel(t, now, data.appearance?.stale);
  return level ? { level, tone: level === 'red' ? 'danger' : 'warn', text: staleText(t, now) } : null;
}

// Hierarquia do card: as tags da pessoa são o destaque (chips coloridos, sempre na primeira linha). O que vem do GLPI
// (status, prioridade, Status extra, entidade, papel) vai numa linha de texto discreto logo abaixo. Só o que pede
// atenção (sem acesso, erro ao ler) continua sendo chip.
function metaLine(t, status, priorityTone, stale) {
  const items = [
    status ? h('span', { class: `m-item m-${status.tone}` }, h('span', { class: 'm-dot', 'aria-hidden': 'true' }), status.label) : null,
    stale ? h('span', { class: `m-item m-stale m-${stale.tone}`, title: `Sem movimentação desde ${formatDateTime(t.dateMod)}` }, stale.text) : null,
    t.priority ? h('span', { class: `m-item m-prio${priorityTone ? ` m-${priorityTone}` : ''}` }, PRIORITY[t.priority] ?? `P${t.priority}`) : null,
    t.extra ? h('span', { class: 'm-item', title: 'Status extra' }, `Extra: ${t.extra}`) : null,
    t.entity ? h('span', { class: 'm-item', title: 'Entidade' }, t.entity) : null,
    t.sources.length ? h('span', { class: 'm-item' }, t.sources.map((s) => SOURCE_LABEL[s] ?? s).join(', ')) : null,
  ].filter(Boolean);
  if (!items.length) return null;
  return h('p', { class: 'meta' }, items.flatMap((el, i) => (i ? [h('span', { class: 'm-sep', 'aria-hidden': 'true' }, '·'), el] : [el])));
}

function card(t, user) {
  const unread = unreadEvents(t, user.readAt);
  const last = t.events.at(-1);
  const status = STATUS[t.status];
  const priorityTone = t.priority >= 5 ? 'danger' : t.priority === 4 ? 'warn' : '';

  const chips = [
    ...tagsOfTicket(data.tags, t.id).map(tagChip),
    t.unavailable ? chip('sem acesso', 'danger') : null,
    t.readError ? chip('erro ao ler', 'warn', 'O GLPI deu erro ao ler este ticket. Nova tentativa na próxima verificação.') : null,
  ].filter(Boolean);

  const pinned = isPinned(user, t.id);
  const staleNow = staleInfo(t);
  const actions = [tagsButton(t.id), pinButton(t, pinned)];
  if (unread.length) {
    actions.push(
      h('button', { class: 'btn link', type: 'button', onclick: () => markRead(t.id) }, 'Marcar como lido'),
    );
  }
  if (t.sources.includes('manual')) {
    actions.push(
      h('button', {
        class: 'btn link',
        type: 'button',
        onclick: () => updateUser((u) => { delete u.watched[t.id]; }),
      }, 'Parar de acompanhar'),
    );
  }

  // O card não é um botão (não pode ter botões dentro): o título é o botão de verdade, e o CSS estende a
  // área clicável dele ao card inteiro. As ações ficam acima dele, como irmãs, e continuam clicáveis.
  return h('article', { class: `card${unread.length ? ' unread' : ''}${isDone(t) ? ' done' : ''}${pinned ? ' pinned' : ''}${staleNow ? ` stale-${staleNow.level}` : ''}` },
    h('div', { class: 'top' },
      h('button', {
        class: 'card-open',
        type: 'button',
        'data-ticket': String(t.id),
        title: t.title,
        'aria-label': `Ver detalhes do ticket ${t.id}: ${t.title}`,
        onclick: () => openDetail(t.id),
      },
      h('span', { class: 'id' }, `#${t.id}`),
      h('span', { class: 'title' }, t.title)),
      h('time', {}, timeAgo(t.dateMod)),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')),
  chips.length ? h('div', { class: 'chips' }, chips) : null,
  metaLine(t, status, priorityTone, staleNow),
  last ? h('p', { class: 'last' }, describeEvent(last)) : null,
  openTagsId === t.id ? tagPanel(t.id) : null,
  h('div', { class: 'actions' }, actions));
}

// Seção retrátil (sanfona). Se ela abre ou fecha é escolha da pessoa e fica guardada em ui.sections (por modo de
// agrupamento); sem escolha vale o padrão da seção. A lista é recriada a cada atualização, então o estado não pode
// ficar só no elemento.
function section(g, user) {
  return h('details', {
    open: isSectionOpen(g, ui.sections),
    ontoggle: (ev) => {
      // também dispara quando a seção nasce aberta: só grava se mudou em relação ao que está valendo
      if (ev.target.open === isSectionOpen(g, ui.sections)) return;
      ui.sections = withSectionOpen(ui.sections, g, ev.target.open);
      saveUi();
    },
  },
  h('summary', { 'data-focus': `sec:${g.id}` }, `${g.title} (${g.tickets.length})`),
  g.tickets.map((t) => card(t, user)));
}

// Os fixados aparecem sempre, com ou sem filtro. Com filtro ligado a seção diz isso e uma linha separa o resto, para não
// parecer que um fixado "passou" no filtro.
function pinnedSection(list, user, filtersOn) {
  return h('details', { class: 'pins', open: true },
    h('summary', {}, `Fixados (${list.length})`, filtersOn ? h('span', { class: 'pins-note' }, 'sempre visíveis, fora dos filtros') : null),
    list.map((t) => card(t, user)));
}

function empty(title, text, action) {
  return h('div', { class: 'empty' }, h('strong', {}, title), text,
    action ? h('div', {}, h('button', { class: 'btn primary', onclick: action.run }, action.label)) : null);
}

function renderList(cfg, state, user, all, visible) {
  const list = $('#list');
  list.replaceChildren();
  if (!isConfigured(cfg)) {
    list.append(empty('Configure o MyTicket', 'Informe a URL do GLPI e os tokens nas opções.',
      { label: 'Abrir opções', run: openOptions }));
    return;
  }
  if (!all.length) {
    if (isPaused(user) && !state.lastRun) {
      list.append(empty('Sincronização pausada', 'Retome para buscar seus tickets.', { label: 'Retomar', run: () => setPaused(false) }));
      return;
    }
    list.append(state.lastRun
      ? empty('Nada no radar por enquanto',
        'Tickets em que você é atribuído, observador ou requerente aparecem aqui. Você também pode acompanhar um ticket pelo número.')
      : empty('Buscando seus tickets…', 'A primeira busca leva alguns segundos.'));
    return;
  }
  const { pinned } = splitPinned(all, user.pinned);
  const pinnedIds = new Set(pinned.map((t) => t.id));
  const shown = visible.filter((t) => !pinnedIds.has(t.id));
  const filtersOn = activeFilterCount(ui.filters) > 0;
  if (!shown.length && !pinned.length) {
    list.append(empty('Nenhum ticket com esses filtros', 'Ajuste a busca ou limpe os filtros.',
      { label: 'Limpar filtros', run: clearFilters }));
    return;
  }
  const parts = [];
  if (pinned.length) parts.push(pinnedSection(pinned, user, filtersOn));
  if (pinned.length && filtersOn) {
    parts.push(h('div', { class: 'list-sep', role: 'separator' }, `Resultado dos filtros · ${shown.length} de ${all.length - pinned.length}`));
  }
  if (!shown.length) {
    if (filtersOn) {
      parts.push(empty('Nenhum outro ticket com esses filtros', 'Ajuste a busca ou limpe os filtros.',
        { label: 'Limpar filtros', run: clearFilters }));
    }
  } else {
    const stages = defsOf(data.tags).filter((d) => d.stage);
    const ctx = {
      isUnread: (t) => unreadEvents(t, user.readAt).length > 0,
      lastEventAt: (t) => t.events.at(-1)?.at ?? 0,
      modMs,
      stageOf: (t) => tagsOfTicket(data.tags, t.id).find((x) => x.def.stage)?.def ?? null,
      stages,
    };
    parts.push(...groupTickets(shown, ui.groupBy, ctx).map((g) => section(g, user)));
  }
  list.append(...parts.filter(Boolean));
}

// ---------- tempo por atribuído (rosca) ----------
// O GLPI só é consultado quando a pessoa clica em "Gerar" (ou "Atualizar"): 3 consultas por clique, nada é guardado e o
// polling nunca faz isso. Depois de gerado, o gráfico se recalcula sozinho a cada minuto (o técnico atual segue contando
// até agora) e ao marcar a opção de papel desconhecido, sem falar com o GLPI.
const pctFmt = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
const TONE = /^(\d|other|queue|unknown)$/;

async function generateShare(id) {
  share = { includeUnknown: false, ...(share?.id === id ? share : {}), id, state: 'loading', error: '', noRight: false };
  renderDetail();
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'ticket-time', id });
  } catch {
    res = { ok: false, error: 'Não foi possível falar com a extensão. Recarregue-a em chrome://extensions.' };
  }
  if (openId !== id || share?.id !== id) return; // a pessoa voltou ou abriu outro ticket enquanto carregava
  share = res?.ok
    ? { ...share, state: 'ok', entry: res.entry, fetchedAt: Date.now() }
    : { ...share, state: 'error', error: res?.error ?? 'Erro desconhecido.', noRight: Boolean(res?.noRight) };
  renderDetail();
}

const shareModel = () => donutModel(share.entry, { now: Date.now(), includeUnknown: share.includeUnknown });

setInterval(() => {
  if (openId != null && share?.id === openId && share.state === 'ok' && !shareModel().window.done) renderDetail();
}, 60_000);

function donutView(model) {
  let acc = 0;
  const stops = model.slices.map((sl) => {
    const from = acc;
    acc += sl.pct * 100;
    return `var(--dn-${TONE.test(String(sl.tone)) ? sl.tone : 'other'}) ${from.toFixed(3)}% ${acc.toFixed(3)}%`;
  });
  const summary = model.slices.map((sl) => `${sl.label} ${pctFmt.format(sl.pct)}`).join('; ');
  return h('div', { class: 'dn' },
    h('div', { class: 'dn-chart', role: 'img', 'aria-label': `Distribuição do tempo do ticket: ${summary}` },
      h('div', { class: 'dn-ring', style: `background:conic-gradient(${stops.join(',')})` }),
      h('div', { class: 'dn-hole' }, h('strong', {}, formatSpan(model.window.totalMs)), h('span', {}, model.window.done ? 'até a solução' : 'até agora'))),
    h('ul', { class: 'dn-legend' }, model.slices.map((sl) => h('li', {},
      h('span', { class: `dn-sw dn-c-${TONE.test(String(sl.tone)) ? sl.tone : 'other'}`, 'aria-hidden': 'true' }),
      h('span', { class: 'dn-name', title: sl.label }, sl.label),
      h('span', { class: 'dn-pct' }, pctFmt.format(sl.pct)),
      h('span', { class: 'dn-val' }, formatSpan(sl.ms), sl.open ? h('span', { class: 'dn-live' }, ' · em andamento') : null)))));
}

function shareSection(t) {
  const s = share?.id === t.id ? share : null;
  const body = [];
  if (!s || s.state === 'idle') {
    body.push(
      h('p', { class: 'muted' }, 'Mostra quanto tempo o ticket ficou com cada pessoa ou equipe, desde a abertura. O GLPI só é consultado quando você clica.'),
      h('button', { class: 'btn', type: 'button', 'data-focus': 'share-gen', onclick: () => generateShare(t.id) }, 'Gerar gráfico de tempo'));
  } else if (s.state === 'loading') {
    body.push(h('p', { class: 'muted' }, 'Consultando o histórico no GLPI…'));
  } else if (s.state === 'error') {
    body.push(h('div', { class: 'd-error' },
      h('p', {}, s.error),
      h('button', { class: 'btn', type: 'button', 'data-focus': 'share-gen', onclick: () => generateShare(t.id) }, 'Tentar de novo')));
  } else {
    const model = shareModel();
    if (!model.slices.length) {
      body.push(h('p', { class: 'muted' }, 'O ticket acabou de ser aberto: ainda não há tempo para mostrar.'));
    } else {
      body.push(donutView(model),
        h('p', { class: 'dn-note' },
          `Da abertura (${formatDateTime(model.window.from)}) até ${model.window.done ? `a solução (${formatDateTime(model.window.to)})` : 'agora'}. `,
          'Dois atribuídos ao mesmo tempo dividem o tempo; pessoa vale mais que equipe.'));
      if (model.uncertain) {
        body.push(h('p', { class: 'dn-note warn', role: 'status' },
          `${formatSpan(model.unknownMs)} é de quem já saiu do ticket: o GLPI não guarda o papel de quem saiu, então não dá para saber se era atribuído.`));
      }
    }
    body.push(h('div', { class: 'dn-opts' },
      model.uncertain || share.includeUnknown
        ? h('label', {}, h('input', {
          type: 'checkbox',
          'data-focus': 'share-unknown',
          checked: share.includeUnknown ? '' : null,
          onchange: (ev) => { share = { ...share, includeUnknown: ev.target.checked }; renderDetail(); },
        }), 'Contar quem saiu do ticket como atribuído')
        : null,
      h('span', {},
        h('span', { class: 'muted' }, `Gerado às ${new Date(s.fetchedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · `),
        h('button', { class: 'btn link', type: 'button', 'data-focus': 'share-gen', title: 'Consulta o GLPI de novo', onclick: () => generateShare(t.id) }, 'Atualizar'))));
  }
  return h('div', { class: 'd-section' }, h('h3', {}, 'Tempo por atribuído'), body);
}

// ---------- tela de detalhes ----------
const infoRow = (label, value) => (value ? [h('dt', {}, label), h('dd', {}, value)] : []);

function message(m) {
  return h('article', { class: `d-msg ${m.kind}${m.mine ? ' mine' : ''}` },
    h('div', { class: 'meta' },
      h('span', { class: 'who' },
        m.author || 'Alguém',
        m.kind === 'solution' ? chip('solução', 'ok') : null,
        m.private ? chip('privado', 'warn') : null),
      h('span', { title: formatDateTime(m.date) }, timeAgo(m.date))),
    m.text ? h('div', { class: 'text' }, m.text) : null);
}

// Conteúdo buscado ao vivo no GLPI: descrição e conversa.
function liveSection() {
  if (!detail || detail.state === 'loading') return h('p', { class: 'muted' }, 'Carregando do GLPI…');
  if (detail.state === 'error') {
    return h('div', { class: 'd-error' },
      h('p', {}, detail.error),
      h('button', { class: 'btn', type: 'button', 'data-focus': 'retry', onclick: () => loadDetail(openId) }, 'Tentar de novo'));
  }
  const d = detail.data;
  return h('div', {},
    d.hidden
      ? h('p', { class: 'muted' }, 'Conteúdo oculto pela opção Privacidade. Abra o ticket no GLPI para ler os textos.')
      : (d.description ? h('details', { class: 'd-desc' }, h('summary', {}, 'Descrição'), h('div', { class: 'text' }, d.description)) : null),
    d.timeline.length ? d.timeline.map(message) : h('p', { class: 'muted' }, 'Ainda não há acompanhamentos.'),
    d.truncated ? h('p', { class: 'muted' }, 'Mostrando os mais recentes. O histórico completo está no GLPI.') : null);
}

const staleChip = (t) => {
  const info = staleInfo(t);
  return info ? chip(info.text, info.tone, `Sem movimentação desde ${formatDateTime(t.dateMod)}`) : null;
};

async function copyRef(t) {
  try {
    await navigator.clipboard.writeText(ticketUrl(data.cfg.baseUrl, t.id));
    copied = true;
  } catch {
    copied = false;
  }
  renderDetail();
  setTimeout(() => { copied = false; if (openId === t.id) renderDetail(); }, 1800);
}

async function stopWatching(id) {
  await updateUser((u) => { delete u.watched[id]; });
  closeDetail();
}

function renderDetail() {
  const el = $('#detail');
  const top = el.scrollTop;
  // A tela é recriada a cada atualização (ao carregar a conversa, a cada verificação, ao copiar): sem isto o foco
  // do teclado cairia no <body> toda vez. Cada botão tem um data-focus para achar o mesmo de novo.
  const focusKey = el.contains(document.activeElement) ? document.activeElement.dataset.focus : undefined;
  const { state } = data;
  const t = state.tickets?.[openId];
  const back = h('button', { class: 'btn link back', type: 'button', 'data-focus': 'back', onclick: closeDetail }, '← Voltar');

  if (!t) {
    el.replaceChildren(h('div', { class: 'd-bar' }, back), empty('Este ticket saiu da lista', 'Ele não está mais no seu radar.'));
    return;
  }

  const live = detail?.state === 'ok' ? detail.data : null;
  const status = STATUS[t.status];
  const title = live?.title || t.title;
  const news = [...t.events].reverse().slice(0, 6);

  // replaceChildren() escreve "null" como texto se receber null: seções vazias precisam ser filtradas
  el.replaceChildren(...[
    h('div', { class: 'd-bar' }, back, h('span', { class: 'chips-inline' }, status ? chip(status.label, status.tone) : null, staleChip(t))),
    h('div', { class: 'd-title' }, h('span', { class: 'id' }, `#${t.id}`), h('h2', {}, title)),
    h('div', { class: 'd-actions' },
      h('button', { class: 'btn primary big', type: 'button', 'data-focus': 'open', onclick: () => openTicket(t.id) }, 'Abrir no GLPI ↗'),
      h('button', { class: 'btn', type: 'button', 'data-focus': 'copy', title: 'Copia o link do ticket', onclick: () => copyRef(t) },
        copied ? 'Copiado ✓' : 'Copiar'),
      tagsButton(t.id),
      pinButton(t, isPinned(data.user, t.id)),
      t.sources.includes('manual')
        ? h('button', { class: 'btn link', type: 'button', 'data-focus': 'stop', onclick: () => stopWatching(t.id) }, 'Parar de acompanhar')
        : null),
    openTagsId === t.id ? tagPanel(t.id) : null,
    h('dl', { class: 'd-info' },
      ...[
        infoRow('Status', status?.label),
        infoRow('Prioridade', t.priority ? (PRIORITY[t.priority] ?? `P${t.priority}`) : ''),
        infoRow('Tags', (() => {
          const mine = tagsOfTicket(data.tags, t.id);
          return mine.length ? h('span', { class: 'chips-inline' }, mine.map(tagChip)) : '';
        })()),
        infoRow('Status extra', t.extra),
        infoRow('Entidade', t.entity),
        infoRow('Você é', t.sources.map((s) => SOURCE_LABEL[s] ?? s).join(', ')),
        infoRow('Aberto em', live?.opened ? formatDateTime(live.opened) : ''),
        infoRow('Atualizado', t.dateMod ? `${formatDateTime(t.dateMod)} (${timeAgo(t.dateMod)})` : ''),
        infoRow('Solução até', live?.due ? formatDateTime(live.due) : ''),
      ].flat()),
    news.length
      ? h('div', { class: 'd-section' },
        h('h3', {}, 'Novidades detectadas'),
        news.map((e) => h('div', { class: 'd-event' },
          h('span', { class: 'when' }, timeAgo(e.at)),
          h('span', { class: 'what' }, describeEvent(e)),
          e.at > newSince ? chip('novo', 'accent') : null)))
      : null,
    shareSection(t),
    h('div', { class: 'd-section' }, h('h3', {}, 'Conversa no GLPI'), liveSection()),
    detail?.state === 'ok'
      ? h('div', { class: 'd-actions' },
        h('button', { class: 'btn primary big', type: 'button', 'data-focus': 'open-end', onclick: () => openTicket(t.id) }, 'Ver o ticket completo no GLPI ↗'))
      : null,
  ].filter(Boolean));
  el.scrollTop = top;
  if (focusKey) el.querySelector(`[data-focus="${focusKey}"]`)?.focus({ preventScroll: true });
}

async function loadDetail(id) {
  detail = { state: 'loading' };
  renderDetail();
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'ticket-details', id });
  } catch {
    res = { ok: false, error: 'Não foi possível falar com a extensão. Recarregue-a em chrome://extensions.' };
  }
  if (openId !== id) return; // a pessoa voltou ou abriu outro ticket enquanto carregava
  detail = res?.ok ? { state: 'ok', data: res.details } : { state: 'error', error: res?.error ?? 'Erro desconhecido.' };
  renderDetail();
}

function openDetail(id) {
  listScroll = $('#list').scrollTop;
  newSince = data.user.readAt[id] ?? 0;
  openId = id;
  copied = false;
  if (share?.id !== id) share = null; // o gráfico é de um ticket só; abrir outro começa do zero (nada foi consultado)
  markRead(id); // abrir os detalhes conta como ler o ticket
  paint();
  $('#detail .back')?.focus(); // o card que tinha o foco saiu da tela: sem isto o teclado se perde
  loadDetail(id);
}

function closeDetail() {
  const id = openId;
  openId = null;
  detail = null;
  paint();
  $('#list').scrollTop = listScroll;
  document.querySelector(`.card-open[data-ticket="${id}"]`)?.focus({ preventScroll: true }); // volta para onde estava
}

// ---------- filtros ----------
const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos os status' },
  { value: 'open', label: 'Em aberto' },
  ...[1, 2, 3, 4].map((s) => ({ value: String(s), label: STATUS[s].label })),
  { value: 'done', label: 'Resolvidos e fechados' },
];
const ROLE_OPTIONS = [
  { value: 'all', label: 'Todos os papéis' },
  { value: 'assigned', label: 'Atribuído a mim' },
  { value: 'observer', label: 'Observador' },
  { value: 'requester', label: 'Requerente' },
  { value: 'manual', label: 'Acompanhado manualmente' },
];
const PRIORITY_OPTIONS = [
  { value: 'all', label: 'Qualquer prioridade' },
  { value: 'high', label: 'Alta ou mais' },
  { value: 'medium', label: 'Média' },
  { value: 'low', label: 'Baixa ou menos' },
];

// Só recria as <option> quando a lista muda, para não fechar um select aberto por causa de um refresh.
function setSelect(id, options, value, visible = true) {
  const select = $(`#${id}`);
  select.closest('label').hidden = !visible;
  const sig = options.map((o) => `${o.value}\u0001${o.label}`).join('\u0002');
  if (select.dataset.sig !== sig) {
    select.replaceChildren(...options.map((o) => h('option', { value: o.value }, o.label)));
    select.dataset.sig = sig;
  }
  if (select.value !== value) select.value = value;
}

// Entidade, Status extra e Tag podem ter listas longas: ficam num seletor com busca (src/picker-ui.js). A Tag aceita
// várias escolhas. Status, papel e prioridade têm poucas opções fixas e seguem como <select>.
const slot = $('#pk-slot');
const pickers = {
  entity: createPicker({
    slot, host: $('#f-entity'), id: 'entity', label: 'Entidade', all: 'Todas as entidades',
    searchLabel: 'Buscar entidade', emptyLabel: 'Nenhuma entidade encontrada',
    onChange: (entity) => setFilter({ entity }),
  }),
  extra: createPicker({
    slot, host: $('#f-extra'), id: 'extra', label: 'Status extra', all: 'Qualquer Status extra',
    searchLabel: 'Buscar Status extra', emptyLabel: 'Nenhum Status extra encontrado',
    onChange: (extra) => setFilter({ extra }),
  }),
  tag: createPicker({
    slot, host: $('#f-tag'), id: 'tag', label: 'Tag', multiple: true, all: 'Qualquer tag',
    many: (n) => `${n} tags`, searchLabel: 'Buscar tag', emptyLabel: 'Nenhuma tag encontrada',
    onChange: (tag) => setFilter({ tag }),
  }),
};

function renderControls(cfg, tickets, options, counts, isUnread) {
  const f = ui.filters;
  const show = isConfigured(cfg) && tickets.length > 0;
  $('#filters').hidden = !show;
  if (!show || !ui.panelOpen) closePickers(); // a lista aberta de um seletor sumiria junto com o painel
  if (!show) return;

  // não mexe no campo enquanto a pessoa digita nele
  if (document.activeElement !== $('#q') && $('#q').value !== f.q) $('#q').value = f.q;

  const news = tickets.filter(isUnread).length;
  const tog = $('#f-unread');
  tog.setAttribute('aria-pressed', String(f.unread));
  tog.textContent = news ? `Novidades (${news})` : 'Novidades';

  const panelCount = activeFilterCount(f, { panelOnly: true });
  $('#filters-count').hidden = !panelCount;
  $('#filters-count').textContent = String(panelCount);
  $('#filters-toggle').setAttribute('aria-expanded', String(ui.panelOpen));
  $('#filters-panel').hidden = !ui.panelOpen;

  setSelect('f-status', STATUS_OPTIONS, f.status);
  setSelect('f-role', ROLE_OPTIONS, f.role);
  setSelect('f-priority', PRIORITY_OPTIONS, f.priority);
  setSelect('f-group', GROUP_MODES.map((value) => ({ value, label: GROUP_LABEL[value] })), ui.groupBy);
  pickers.entity.update({
    options: [{ value: 'all', label: 'Todas as entidades', all: true }, ...options.entities.map((e) => ({ value: e, label: e }))],
    value: f.entity,
    visible: options.entities.length >= 2,
  });
  pickers.extra.update({
    options: [
      { value: 'all', label: 'Qualquer Status extra', all: true },
      ...options.extra.map((v) => ({ value: v, label: v })),
      ...(options.hasNoExtra ? [{ value: NO_EXTRA, label: 'Sem Status extra' }] : []),
    ],
    value: f.extra,
    visible: options.extra.length > 0,
  });

  const defs = defsOf(data.tags);
  pickers.tag.update({
    // sem "Qualquer tag" na lista: nada marcado já quer dizer qualquer uma
    options: [
      { value: NO_TAG, label: 'Sem tag' },
      ...defs.map((d) => {
        const { cls, style } = tagColor(d.color);
        return { value: d.id, label: d.name, dot: { cls, style } };
      }),
    ],
    value: f.tag,
    visible: defs.length > 0,
  });

  const active = activeFilterCount(f) > 0;
  $('#filter-summary').hidden = !active;
  $('#summary-text').textContent = summaryText(counts); // os fixados ficam de fora da conta dos filtros
}

// Botão de pausa, aviso "pausada" e botão de atualizar (que não faz nada enquanto pausado).
function renderPaused() {
  const paused = isPaused(data.user);
  const pause = $('#pause');
  const label = paused ? 'Retomar sincronização' : 'Pausar sincronização';
  pause.classList.toggle('is-paused', paused);
  pause.title = label;
  pause.setAttribute('aria-label', label);
  const refresh = $('#refresh');
  const refreshLabel = paused ? 'Retome a sincronização para atualizar' : 'Atualizar agora';
  refresh.disabled = paused;
  refresh.title = refreshLabel;
  refresh.setAttribute('aria-label', refreshLabel);
  $('#paused').hidden = !paused;
  if (paused) {
    const since = data.user.pausedAt ? ` ${timeAgo(data.user.pausedAt)}` : '';
    $('#paused-text').textContent = `Sincronização pausada${since}. Nada é buscado nem avisado até você retomar.`;
  }
}

// Repinta a tela atual (lista com filtros, ou detalhes) a partir do que já está em memória.
function paint() {
  if (!data || !ui) return;
  renderPaused();
  const inDetail = openId != null;
  if (inDetail) closePickers();
  $('#list-view').hidden = inDetail;
  $('#detail').hidden = !inDetail;
  if (inDetail) {
    renderDetail();
    return;
  }
  const { cfg, state, user } = data;
  const tickets = Object.values(state.tickets ?? {});
  const options = filterOptions(tickets);
  ui.filters = sanitizeFilters(ui.filters, { ...options, tags: defsOf(data.tags).map((d) => d.id) });
  const isUnread = (t) => unreadEvents(t, user.readAt).length > 0;
  const tagsOf = (t) => tagsOfTicket(data.tags, t.id).map((x) => x.def);
  const visible = applyFilters(tickets, ui.filters, isUnread, tagsOf);
  const pinnedIds = new Set(splitPinned(tickets, user.pinned).pinned.map((t) => t.id));
  renderControls(cfg, tickets, options, {
    shown: visible.filter((t) => !pinnedIds.has(t.id)).length,
    total: tickets.length - pinnedIds.size,
    pinned: pinnedIds.size,
  }, isUnread);
  // a lista é recriada a cada atualização: sem isto o foco do teclado (ex.: num botão de tag) cairia no <body>
  const list = $('#list');
  const focusKey = list.contains(document.activeElement) ? document.activeElement.dataset.focus : undefined;
  renderList(cfg, state, user, tickets, visible);
  if (focusKey) list.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}

// ---------- rodapé, atalho da aba, carga ----------
function renderStatus(cfg, state, user) {
  const el = $('#status');
  el.className = '';
  if (!isConfigured(cfg)) {
    el.textContent = 'Sem credenciais configuradas';
  } else if (isPaused(user)) {
    el.textContent = state.lastRun ? `Pausado · última atualização ${timeAgo(state.lastRun.at)}` : 'Pausado';
  } else if (state.lastRun && !state.lastRun.ok) {
    el.className = 'error';
    el.textContent = `Erro: ${state.lastRun.error}`;
  } else if (state.lastRun) {
    const failed = failedLabel(state.lastRun.failed);
    if (failed) el.className = 'warn';
    el.textContent = `Atualizado ${timeAgo(state.lastRun.at)} · ${state.lastRun.count} ticket(s)${failed ? ` · ${failed}` : ''} · a cada ${cfg.pollMinutes} min`;
  } else {
    el.textContent = 'Aguardando a primeira busca…';
  }
}

async function renderHint(cfg, user) {
  const hint = $('#hint');
  hint.hidden = true;
  hint.replaceChildren();
  if (!isConfigured(cfg)) return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !isUnderBase(tab.url, cfg.baseUrl)) return;
    const id = parseTicketId(tab.url);
    if (!id || user.watched[id]) return;
    hint.append(h('button', { class: 'btn link', onclick: () => addWatch(id) }, `+ Acompanhar #${id} desta aba`));
    hint.hidden = false;
  } catch {
    /* sem permissão para ler a aba: sem atalho */
  }
}

async function addWatch(id) {
  await updateUser((u) => { u.watched[id] = { addedAt: Date.now() }; });
  chrome.runtime.sendMessage({ type: 'poll-now' });
}

async function load() {
  const [cfg, state, user, tags, appearance, saved] = await Promise.all([
    getConfig(),
    getState(),
    getUser(),
    getTags(),
    getAppearance(),
    ui ? null : getUi(),
  ]);
  data = { cfg, state, user, tags, appearance };
  if (!ui) ui = saved;
  paint();
  renderStatus(cfg, state, user);
  renderHint(cfg, user);
}

// ---------- eventos ----------
$('#add').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = $('#add-input');
  const id = parseTicketId(input.value);
  input.setCustomValidity(id ? '' : 'Informe o número do ticket ou o link dele');
  if (!id) return input.reportValidity();
  input.value = '';
  await addWatch(id);
});
$('#add-input').addEventListener('input', (ev) => ev.target.setCustomValidity(''));

$('#q').addEventListener('input', (ev) => {
  const q = ev.target.value;
  clearTimeout(qTimer);
  qTimer = setTimeout(() => setFilter({ q }), 120);
});
$('#q').addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && ev.target.value) {
    ev.preventDefault();
    ev.target.value = '';
    setFilter({ q: '' });
  }
});
$('#f-unread').addEventListener('click', () => setFilter({ unread: !ui.filters.unread }));
$('#filters-toggle').addEventListener('click', () => {
  ui.panelOpen = !ui.panelOpen;
  saveUi();
  paint();
});
for (const [id, key] of [['f-status', 'status'], ['f-role', 'role'], ['f-priority', 'priority']]) {
  $(`#${id}`).addEventListener('change', (ev) => setFilter({ [key]: ev.target.value }));
}
// Agrupar não é filtro: "Limpar filtros" não mexe nele e ele não conta no número do botão "Filtros".
$('#f-group').addEventListener('change', (ev) => {
  ui.groupBy = normalizeGroupBy(ev.target.value);
  saveUi();
  paint();
});
$('#f-clear').addEventListener('click', clearFilters);

// Esc fecha o painel de tags; sem painel aberto, volta da tela de detalhes para a lista
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (openTagsId != null) {
    ev.preventDefault();
    const id = openTagsId;
    openTagsId = null;
    paint();
    document.querySelector(`[data-focus="tagsbtn:${id}"]`)?.focus({ preventScroll: true });
  } else if (openId != null) {
    ev.preventDefault();
    closeDetail();
  }
});

$('#pause').addEventListener('click', () => setPaused(!isPaused(data?.user)));
$('#resume').addEventListener('click', () => setPaused(false));

$('#refresh').addEventListener('click', async (ev) => {
  if (isPaused(data?.user)) return;
  const btn = ev.currentTarget;
  btn.disabled = true;
  btn.classList.add('spin');
  try {
    await chrome.runtime.sendMessage({ type: 'poll-now' });
  } finally {
    btn.disabled = isPaused(data?.user);
    btn.classList.remove('spin');
  }
});
$('#read-all').addEventListener('click', () => markAllRead());
$('#settings').addEventListener('click', openOptions);

let timer;
chrome.storage.onChanged.addListener((changes) => {
  if (Object.keys(changes).every((k) => k === 'ui')) return; // eco da própria gravação dos filtros
  clearTimeout(timer);
  timer = setTimeout(load, 80);
});
load();
