// Tags personalizadas dos tickets: lógica pura (sem DOM nem chrome.*), testada em Node.
// Ficam só neste navegador (chrome.storage.local, chave `tags`): nunca vão ao GLPI e nunca são sincronizadas.
//
//   tags = { v: 1, defs: [{ id, name, color, stage }] | null, assign: { [ticketId]: [{ tag, at }] } }
//
// `defs: null` = a pessoa ainda não mexeu: valem os padrões. A primeira alteração grava a lista inteira, e assim
// um padrão apagado não volta sozinho. Etapa (`stage: true`): só uma por ticket, marcar outra troca a anterior.
// Etiqueta (`stage: false`): várias por ticket. Cada marcação guarda quando foi feita (`at`).
//
// As funções que alteram recebem o objeto `tags` e o mudam no lugar; devolvem `{ ok, ... }` ou um booleano de
// "mudou algo" (o `updateTags` do store não grava quando nada mudou).
import { normalizeText } from './filters.js';
import { normalizeHex } from './color.js';

// Cores da paleta: nomes, não hex, para o CSS cuidar do contraste nos temas claro e escuro.
export const TAG_COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'teal', 'pink', 'gray'];
export const COLOR_LABEL = {
  blue: 'Azul', green: 'Verde', amber: 'Âmbar', red: 'Vermelho', purple: 'Roxo', teal: 'Turquesa', pink: 'Rosa', gray: 'Cinza',
};

export const LIMITS = { tags: 30, name: 24, perTicket: 12, importBytes: 1_000_000 };
export const PRUNE_AFTER_MS = 60 * 24 * 3600_000; // tag de ticket que saiu do radar só é apagada depois de 60 dias
export const EXPORT_APP = 'myticket-tags';
export const COLOR_ERROR = 'Cor inválida. Escolha uma da lista ou use um hexadecimal, como #7c3aed.';

// Cor da tag: nome da paleta ou hexadecimal (#rrggbb, normalizado em minúsculas). Outra coisa -> null.
export function normalizeColor(input) {
  return TAG_COLORS.includes(input) ? input : normalizeHex(input);
}

export const DEFAULT_TAGS = Object.freeze([
  { id: 'andamento', name: 'Em andamento', color: 'blue', stage: true },
  { id: 'pr-review', name: 'PR em review', color: 'purple', stage: true },
  { id: 'homologacao', name: 'Em homologação/suporte', color: 'amber', stage: true },
  { id: 'aguardando', name: 'Aguardando retorno', color: 'teal', stage: true },
  { id: 'avisado', name: 'Cliente avisado', color: 'green', stage: false },
].map((t) => Object.freeze(t)));

export const defaultDefs = () => DEFAULT_TAGS.map((t) => ({ ...t }));
export const emptyTags = () => ({ v: 1, defs: null, assign: {} });
export const defsOf = (tags) => tags.defs ?? defaultDefs();

const cleanName = (name) => String(name ?? '').replace(/\s+/g, ' ').trim();
const nameKey = (name) => normalizeText(cleanName(name));
const isId = (id) => typeof id === 'string' && /^[\w-]{1,32}$/.test(id);
const isTicketId = (id) => /^\d{1,9}$/.test(String(id));
const finiteAt = (at) => (Number.isFinite(Number(at)) && Number(at) >= 0 ? Number(at) : 0);

// Só etapa por ticket: se houver duas, fica a mais recente.
function enforceStages(tags) {
  const stage = new Set(defsOf(tags).filter((d) => d.stage).map((d) => d.id));
  for (const list of Object.values(tags.assign)) {
    const stages = list.filter((e) => stage.has(e.tag));
    if (stages.length < 2) continue;
    const keep = stages.reduce((a, b) => (b.at >= a.at ? b : a));
    for (let i = list.length - 1; i >= 0; i -= 1) if (stage.has(list[i].tag) && list[i] !== keep) list.splice(i, 1);
  }
}

// Aceita lixo vindo do storage ou de um arquivo importado e devolve sempre um objeto válido e dentro dos limites.
export function normalizeTags(raw) {
  const out = emptyTags();
  if (!raw || typeof raw !== 'object') return out;

  if (Array.isArray(raw.defs)) {
    const ids = new Set();
    const names = new Set();
    out.defs = [];
    for (const d of raw.defs) {
      const name = cleanName(d?.name).slice(0, LIMITS.name);
      if (!name || !isId(d?.id) || ids.has(d.id) || names.has(nameKey(name)) || out.defs.length >= LIMITS.tags) continue;
      ids.add(d.id);
      names.add(nameKey(name));
      out.defs.push({ id: d.id, name, color: normalizeColor(d.color) ?? 'gray', stage: Boolean(d.stage) });
    }
  }

  const known = new Set(defsOf(out).map((d) => d.id));
  const assign = raw.assign && typeof raw.assign === 'object' ? raw.assign : {};
  for (const [ticketId, list] of Object.entries(assign)) {
    if (!isTicketId(ticketId) || !Array.isArray(list)) continue;
    const seen = new Set();
    const kept = [];
    for (const e of list) {
      if (!known.has(e?.tag) || seen.has(e.tag) || kept.length >= LIMITS.perTicket) continue;
      seen.add(e.tag);
      kept.push({ tag: e.tag, at: finiteAt(e.at) });
    }
    if (kept.length) out.assign[String(Number(ticketId))] = kept;
  }
  enforceStages(out);
  return out;
}

// As tags de um ticket, com as etapas primeiro; cada item é { def, at }.
export function tagsOfTicket(tags, ticketId) {
  const defs = defsOf(tags);
  const order = new Map(defs.map((d, i) => [d.id, i]));
  return (tags.assign[String(ticketId)] ?? [])
    .map((e) => ({ def: defs.find((d) => d.id === e.tag), at: e.at }))
    .filter((x) => x.def)
    .sort((a, b) => Number(b.def.stage) - Number(a.def.stage) || order.get(a.def.id) - order.get(b.def.id));
}

// Materializa os padrões antes da primeira alteração (senão um padrão apagado voltaria).
const ensureDefs = (tags) => { tags.defs ??= defaultDefs(); return tags.defs; };

function checkName(tags, name, exceptId) {
  const clean = cleanName(name);
  if (!clean) return 'Informe um nome para a tag.';
  if (clean.length > LIMITS.name) return `O nome pode ter até ${LIMITS.name} caracteres.`;
  if (defsOf(tags).some((d) => d.id !== exceptId && nameKey(d.name) === nameKey(clean))) return 'Já existe uma tag com esse nome.';
  return null;
}

function newId(defs) {
  for (;;) {
    const id = `u${Math.random().toString(36).slice(2, 8)}`;
    if (!defs.some((d) => d.id === id)) return id;
  }
}

export function createTag(tags, { name, color, stage = false }) {
  const error = checkName(tags, name, null);
  if (error) return { ok: false, error };
  if (defsOf(tags).length >= LIMITS.tags) return { ok: false, error: `O limite é de ${LIMITS.tags} tags. Apague alguma para criar outra.` };
  // sem cor escolhida vale a automática; uma cor escolhida e inválida é erro (não some em silêncio)
  const chosen = color === undefined || color === null || color === '' ? null : normalizeColor(color);
  if (color !== undefined && color !== null && color !== '' && !chosen) return { ok: false, error: COLOR_ERROR };
  const defs = ensureDefs(tags);
  const id = newId(defs);
  // sem cor escolhida: a primeira da paleta que nenhuma tag usa (se todas estiverem em uso, cicla)
  const free = TAG_COLORS.find((c) => !defs.some((d) => d.color === c)) ?? TAG_COLORS[defs.length % TAG_COLORS.length];
  defs.push({ id, name: cleanName(name), color: chosen ?? free, stage: Boolean(stage) });
  return { ok: true, id };
}

// Altera nome, cor e/ou tipo de uma tag. Virar etapa tira as etapas repetidas dos tickets (fica a mais recente).
export function editTag(tags, id, patch) {
  const def = defsOf(tags).find((d) => d.id === id);
  if (!def) return { ok: false, error: 'Tag não encontrada.' };
  if (patch.name !== undefined) {
    const error = checkName(tags, patch.name, id);
    if (error) return { ok: false, error };
  }
  const color = patch.color === undefined ? undefined : normalizeColor(patch.color);
  if (patch.color !== undefined && !color) return { ok: false, error: COLOR_ERROR };
  const target = ensureDefs(tags).find((d) => d.id === id);
  if (patch.name !== undefined) target.name = cleanName(patch.name);
  if (color) target.color = color;
  if (patch.stage !== undefined) target.stage = Boolean(patch.stage);
  enforceStages(tags);
  return { ok: true };
}

export function deleteTag(tags, id) {
  if (!defsOf(tags).some((d) => d.id === id)) return false;
  tags.defs = ensureDefs(tags).filter((d) => d.id !== id);
  for (const [ticketId, list] of Object.entries(tags.assign)) {
    const kept = list.filter((e) => e.tag !== id);
    if (kept.length) tags.assign[ticketId] = kept;
    else delete tags.assign[ticketId];
  }
  return true;
}

export function moveTag(tags, id, delta) {
  const defs = ensureDefs(tags);
  const from = defs.findIndex((d) => d.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= defs.length) return false;
  [defs[from], defs[to]] = [defs[to], defs[from]];
  return true;
}

// Devolve os padrões que foram apagados (os que a pessoa renomeou ou mexeu continuam como estão).
export function restoreDefaults(tags) {
  const defs = ensureDefs(tags);
  let added = 0;
  for (const d of DEFAULT_TAGS) {
    if (defs.length >= LIMITS.tags) break;
    if (defs.some((x) => x.id === d.id || nameKey(x.name) === nameKey(d.name))) continue;
    defs.push({ ...d });
    added += 1;
  }
  return added;
}

// Marca ou desmarca. Etapa nova troca a etapa que o ticket já tinha; clicar na etapa atual a tira.
export function toggleTag(tags, ticketId, tagId, now = Date.now()) {
  const def = defsOf(tags).find((d) => d.id === tagId);
  if (!def || !isTicketId(ticketId)) return false;
  ensureDefs(tags);
  const key = String(Number(ticketId));
  const list = tags.assign[key] ?? [];
  if (list.some((e) => e.tag === tagId)) {
    const kept = list.filter((e) => e.tag !== tagId);
    if (kept.length) tags.assign[key] = kept;
    else delete tags.assign[key];
    return true;
  }
  if (list.length >= LIMITS.perTicket) return false;
  const stage = new Set(tags.defs.filter((d) => d.stage).map((d) => d.id));
  const next = def.stage ? list.filter((e) => !stage.has(e.tag)) : list.slice();
  next.push({ tag: tagId, at: now });
  tags.assign[key] = next;
  return true;
}

// Tickets que o poller ainda guarda (`live`) mantêm as tags. Os que sumiram só perdem depois de 60 dias,
// para um ticket que sai do radar por um tempo, ou é reaberto, não perder a etapa.
export function pruneTagAssign(tags, live, now = Date.now()) {
  let changed = false;
  for (const [ticketId, list] of Object.entries(tags.assign)) {
    if (ticketId in (live ?? {})) continue;
    const newest = Math.max(0, ...list.map((e) => e.at));
    if (now - newest > PRUNE_AFTER_MS) {
      delete tags.assign[ticketId];
      changed = true;
    }
  }
  return changed;
}

// Trocou de conta ou de GLPI: os números de ticket deixam de valer, então as marcações saem (as tags criadas ficam).
export function resetAssign(tags) {
  if (!Object.keys(tags.assign).length) return false;
  tags.assign = {};
  return true;
}

// ---------- exportar / importar (a defesa contra perder tudo ao trocar de pasta ou reinstalar) ----------
export function exportTags(tags, now = new Date()) {
  return JSON.stringify({
    app: EXPORT_APP,
    version: 1,
    exportedAt: now.toISOString(),
    defs: defsOf(tags),
    assign: tags.assign,
  }, null, 2);
}

// Substitui as tags atuais pelas do arquivo (depois de normalizar). Não altera nada se o arquivo for inválido.
export function importTags(tags, text) {
  if (typeof text !== 'string' || text.length > LIMITS.importBytes) return { ok: false, error: 'Arquivo grande demais para ser um export de tags.' };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'O arquivo não é um JSON válido.' };
  }
  if (data?.app !== EXPORT_APP || data?.version !== 1 || !Array.isArray(data.defs)) {
    return { ok: false, error: 'Este arquivo não é um export de tags do MyTicket.' };
  }
  const next = normalizeTags({ defs: data.defs, assign: data.assign });
  tags.defs = next.defs;
  tags.assign = next.assign;
  return { ok: true, tags: next.defs.length, tickets: Object.keys(next.assign).length };
}
