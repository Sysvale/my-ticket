// Agrupar a lista do popup em seções retráteis (sanfona): lógica pura, sem DOM nem chrome.*.
// Modos: o padrão de sempre (Novidades / Acompanhando / Encerrados), ou por status, prioridade ou etapa (tag pessoal).
// Regras: "Novidades" fica sempre no topo, em qualquer modo, e os tickets com novidade não se repetem nos grupos; dentro
// de cada grupo vem primeiro o de atualização mais recente. Grupo vazio não aparece. Os fixados não passam por aqui.
import { PRIORITY, STATUS } from './format.js';

export const GROUP_MODES = ['padrao', 'status', 'prioridade', 'etapa'];
// Os textos já dizem o que a opção faz (o <select> do painel de filtros não tem rótulo visível).
export const GROUP_LABEL = {
  padrao: 'Agrupar: padrão',
  status: 'Agrupar por status',
  prioridade: 'Agrupar por prioridade',
  etapa: 'Agrupar por etapa',
};

export const normalizeGroupBy = (value) => (GROUP_MODES.includes(value) ? value : 'padrao');

const MAX_OVERRIDES = 200;

// O que a pessoa abriu ou fechou à mão: { [id da seção]: aberta? }. Só booleanos, chaves curtas, no máximo 200.
export function normalizeSections(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'boolean' && key.length <= 80 && Object.keys(out).length < MAX_OVERRIDES) out[key] = value;
  }
  return out;
}

// A seção está aberta? O que a pessoa escolheu vale; sem escolha, vale o padrão da seção.
export const isSectionOpen = (section, overrides) =>
  typeof overrides?.[section.id] === 'boolean' ? overrides[section.id] : section.open;

// Devolve as escolhas com esta seção aberta ou fechada. Voltar ao padrão apaga a escolha (não guarda o que é óbvio).
export function withSectionOpen(overrides, section, open) {
  const next = { ...normalizeSections(overrides) };
  if (open === section.open) delete next[section.id];
  else if (Object.keys(next).length < MAX_OVERRIDES || section.id in next) next[section.id] = open;
  return next;
}

const isDone = (t) => t.status != null && t.status >= 5;

// `ctx`: isUnread(t), lastEventAt(t), modMs(t), stageOf(t) -> { id, name } | null, stages -> [{ id, name }] na ordem das Opções.
// Devolve [{ id, title, tickets, open }]; `id` é a chave da escolha da pessoa (muda de modo para modo, menos "news").
export function groupTickets(tickets, mode, ctx) {
  const m = normalizeGroupBy(mode);
  const byRecent = (a, b) => ctx.modMs(b) - ctx.modMs(a) || b.id - a.id;
  const news = tickets.filter(ctx.isUnread).sort((a, b) => ctx.lastEventAt(b) - ctx.lastEventAt(a) || b.id - a.id);
  const rest = tickets.filter((t) => !ctx.isUnread(t));
  const sections = [];
  if (news.length) sections.push({ id: 'news', title: 'Novidades', tickets: news, open: true });
  const add = (key, title, list, open = true) => {
    if (list.length) sections.push({ id: `${m}:${key}`, title, tickets: [...list].sort(byRecent), open });
  };

  if (m === 'padrao') {
    add('acompanhando', 'Acompanhando', rest.filter((t) => !isDone(t)));
    add('encerrados', 'Encerrados', rest.filter(isDone), false);
  } else if (m === 'status') {
    for (const s of Object.keys(STATUS).map(Number)) add(String(s), STATUS[s].label, rest.filter((t) => t.status === s), s < 5);
    add('none', 'Sem status', rest.filter((t) => !STATUS[t.status]));
  } else if (m === 'prioridade') {
    for (const p of Object.keys(PRIORITY).map(Number).sort((a, b) => b - a)) add(String(p), PRIORITY[p], rest.filter((t) => t.priority === p));
    add('none', 'Sem prioridade', rest.filter((t) => !PRIORITY[t.priority]));
  } else {
    const known = new Set(ctx.stages.map((s) => s.id));
    for (const s of ctx.stages) add(s.id, s.name, rest.filter((t) => ctx.stageOf(t)?.id === s.id));
    add('none', 'Sem etapa', rest.filter((t) => !known.has(ctx.stageOf(t)?.id)));
  }
  return sections;
}
