// Filtros do painel: lógica pura (sem DOM nem chrome.*), testada em Node.

export const NO_EXTRA = '__none__'; // "sem Status extra"
export const NO_TAG = '__none__'; // "sem nenhuma tag"

export const DEFAULT_FILTERS = Object.freeze({
  q: '',
  unread: false,
  status: 'all', // all | open | done | 1..4
  role: 'all', // all | assigned | observer | requester | manual
  entity: 'all',
  extra: 'all', // all | NO_EXTRA | <valor>
  priority: 'all', // all | high (>=4) | medium (3) | low (<=2)
  tag: 'all', // all | NO_TAG | <id da tag>
});

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });

// Minúsculas e sem acento, para "nao gera" achar "não gera".
export const normalizeText = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function mergeFilters(saved) {
  return { ...DEFAULT_FILTERS, ...(saved && typeof saved === 'object' ? saved : {}) };
}

// Valores disponíveis nos selects, tirados dos próprios tickets.
export function filterOptions(tickets) {
  const entities = new Set();
  const extra = new Set();
  let hasNoExtra = false;
  for (const t of tickets) {
    if (t.entity) entities.add(t.entity);
    if (t.extra) extra.add(t.extra);
    else hasNoExtra = true;
  }
  return {
    entities: [...entities].sort(collator.compare),
    extra: [...extra].sort(collator.compare),
    hasNoExtra,
  };
}

// Um filtro salvo pode apontar para uma entidade/valor que não existe mais: volta para "todos".
export function sanitizeFilters(filters, options) {
  const f = mergeFilters(filters);
  if (f.entity !== 'all' && !options.entities.includes(f.entity)) f.entity = 'all';
  if (f.extra === NO_EXTRA) {
    if (!options.hasNoExtra) f.extra = 'all';
  } else if (f.extra !== 'all' && !options.extra.includes(f.extra)) {
    f.extra = 'all';
  }
  // tag apagada desde que o filtro foi salvo: volta para "todas" (`options.tags` = ids das tags que existem)
  if (options.tags && f.tag !== 'all' && f.tag !== NO_TAG && !options.tags.includes(f.tag)) f.tag = 'all';
  return f;
}

// `tagsOf(t)` devolve as tags do ticket como [{ id, name }] (vem do storage, não do ticket).
export function matches(t, filters, isUnread = () => false, tagsOf = () => []) {
  const f = mergeFilters(filters);
  if (f.unread && !isUnread(t)) return false;

  if (f.status !== 'all') {
    if (f.status === 'open') {
      if (t.status == null || t.status >= 5) return false;
    } else if (f.status === 'done') {
      if (!(t.status >= 5)) return false;
    } else if (t.status !== Number(f.status)) {
      return false;
    }
  }
  if (f.role !== 'all' && !(t.sources ?? []).includes(f.role)) return false;
  if (f.entity !== 'all' && t.entity !== f.entity) return false;
  if (f.extra !== 'all') {
    if (f.extra === NO_EXTRA) {
      if (t.extra) return false;
    } else if (t.extra !== f.extra) {
      return false;
    }
  }
  if (f.priority !== 'all') {
    const p = t.priority ?? 0;
    if (f.priority === 'high' && p < 4) return false;
    if (f.priority === 'medium' && p !== 3) return false;
    if (f.priority === 'low' && !(p > 0 && p <= 2)) return false;
  }

  const tags = f.tag !== 'all' || f.q.trim() ? tagsOf(t) : [];
  if (f.tag === NO_TAG) {
    if (tags.length) return false;
  } else if (f.tag !== 'all' && !tags.some((d) => d.id === f.tag)) {
    return false;
  }

  const words = normalizeText(f.q).split(/\s+/).map((w) => w.replace(/^#/, '')).filter(Boolean);
  if (words.length) {
    const hay = normalizeText(`${t.id} ${t.title} ${t.entity} ${t.extra} ${tags.map((d) => d.name).join(' ')}`);
    if (!words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

export const applyFilters = (tickets, filters, isUnread, tagsOf) => tickets.filter((t) => matches(t, filters, isUnread, tagsOf));

// Quantos filtros estão ligados. `panelOnly` ignora a busca e "Novidades", que têm controle próprio
// fora do painel (o contador do botão "Filtros" só conta o que está dentro dele).
export function activeFilterCount(filters, { panelOnly = false } = {}) {
  const f = mergeFilters(filters);
  let n = 0;
  if (!panelOnly && f.q.trim()) n += 1;
  if (!panelOnly && f.unread) n += 1;
  for (const k of ['status', 'role', 'entity', 'extra', 'priority', 'tag']) if (f[k] !== DEFAULT_FILTERS[k]) n += 1;
  return n;
}
