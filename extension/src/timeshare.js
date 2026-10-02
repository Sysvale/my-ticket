// Tempo de um ticket por pessoa/equipe atribuída (gráfico de rosca). Puro: sem DOM nem chrome.*.
// Só roda quando a pessoa pede (botão "Gerar gráfico de tempo" nos detalhes do ticket): cada geração custa 3 consultas
// ao GLPI e nada fica guardado. Não há leitura em segundo plano.
//
// O que o log do GLPI diz (conferido num GLPI 10.0.18):
//  - pessoa ou equipe que entrou/saiu do ticket: linked_action 15 (entrou) e 16 (saiu), itemtype_link User ou Group,
//    valor "Nome (id)". A linha NÃO diz o papel (requerente, atribuído ou observador);
//  - mudança de status: id_search_option 12, valores numéricos (1 a 6).
// O papel só se conhece de quem está no ticket AGORA (Ticket_User/Group_Ticket têm `type`). Quem já saiu fica com papel
// 0 (desconhecido): o tempo dele vira uma fatia à parte, e a pessoa escolhe se conta como atribuição. Nada é chutado.
import { parseGlpiDate, STATUS } from './format.js';

export const ROLE = { REQUESTER: 1, ASSIGNED: 2, OBSERVER: 3 };

const STATUS_OPTION = 12;
const LOG_ADD = 15;
const LOG_DEL = 16;
const MIN = 60_000;

// "Analista A (12)" -> { name: 'Analista A', id: 12 }. O GLPI corta o valor em 180 caracteres: sem o id, id = null.
export function parseActorRef(value) {
  const s = String(value ?? '').trim();
  const m = s.match(/^([\s\S]*?)\s*\((\d+)\)$/);
  return m ? { name: m[1].trim(), id: Number(m[2]) } : { name: s, id: null };
}

const byTime = (a, b) => a.at - b.at || a.id - b.id;

// As linhas cruas do log (lista ou objeto indexado por id) viram dois fluxos ordenados: status e entradas/saídas.
export function normalizeLogs(logs) {
  const rows = Array.isArray(logs) ? logs : Object.values(logs ?? {});
  const status = [];
  const moves = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const at = parseGlpiDate(r.date_mod);
    if (!Number.isFinite(at)) continue;
    const action = Number(r.linked_action) || 0;
    const id = Number(r.id) || 0;
    if (action === 0 && Number(r.id_search_option) === STATUS_OPTION) {
      if (r.old_value === '' || r.new_value === '') continue;
      const from = Number(r.old_value);
      const to = Number(r.new_value);
      if (STATUS[from] && STATUS[to]) status.push({ at, id, from, to });
    } else if ((action === LOG_ADD || action === LOG_DEL) && (r.itemtype_link === 'User' || r.itemtype_link === 'Group')) {
      const ref = parseActorRef(action === LOG_ADD ? r.new_value : r.old_value);
      moves.push({ at, id, op: action === LOG_ADD ? 'add' : 'del', type: r.itemtype_link, ...ref });
    }
  }
  return { status: status.sort(byTime), moves: moves.sort(byTime) };
}

const actorKey = (type, id, name) => `${type}:${id ?? `?${name}`}`;

// O que o popup recebe do GLPI, já resumido: abertura, intervalos de status [status, de, até|null] e, por pessoa/equipe,
// intervalos [de, até|null, papel]. `até` null = ainda vale. `actorsNow` vem de Ticket_User/Group_Ticket: [{ type, id, role }].
// Com `hideContent` os nomes não saem daqui (o rótulo vira "Pessoa #id").
export function buildEntry({ id, ticket, logs, actorsNow = [], now, hideContent = false }) {
  const { status: changes, moves } = normalizeLogs(logs);
  const dated = [parseGlpiDate(ticket.date), changes[0]?.at, moves[0]?.at].filter(Number.isFinite);
  const created = dated.length ? Math.min(...dated) : now;
  const current = STATUS[Number(ticket.status)] ? Number(ticket.status) : null;

  // status: cada mudança fecha o intervalo anterior e abre o seguinte
  const statusSegs = [];
  let open = [changes.length ? changes[0].from : (current ?? 1), created, null];
  for (const c of changes) {
    const at = Math.max(c.at, open[1]); // relógio fora de ordem não gera intervalo negativo
    open[2] = at;
    statusSegs.push(open);
    open = [c.to, at, null];
  }
  statusSegs.push(open);
  // o log pode estar incompleto (limpeza de histórico do GLPI): o status de hoje é a verdade
  if (current != null && open[0] !== current) {
    const at = Math.max(parseGlpiDate(ticket.date_mod) || open[1], open[1]);
    open[2] = at;
    statusSegs.push([current, at, null]);
  }

  // pessoas e equipes: cada "entrou" abre um intervalo, cada "saiu" fecha um
  const byKey = new Map();
  const actor = (type, aid, name) => {
    const k = actorKey(type, aid, name);
    if (!byKey.has(k)) byKey.set(k, { k, type, id: aid, name: '', segs: [] });
    return byKey.get(k);
  };
  for (const m of moves) {
    const a = actor(m.type, m.id, m.name);
    if (m.name) a.name = m.name; // o último nome conhecido
    if (m.op === 'add') a.segs.push([m.at, null, 0]);
    else {
      const stillOpen = a.segs.find((s) => s[1] == null);
      if (stillOpen) stillOpen[1] = Math.max(m.at, stillOpen[0]);
      else a.segs.push([created, Math.max(m.at, created), 0]); // saiu sem registro de entrada: estava desde a abertura
    }
  }
  const rolesNow = new Map(); // quem está agora -> papéis que tem
  for (const n of actorsNow) {
    const a = actor(n.type, n.id, '');
    if (!a.segs.some((s) => s[1] == null)) a.segs.push([created, null, 0]); // está agora mas o log não mostra a entrada
    const k = actorKey(n.type, n.id);
    rolesNow.set(k, [...(rolesNow.get(k) ?? []), n.role]);
  }

  // Papel: só de quem está agora, e só nos intervalos ainda abertos. Quem tem dois papéis ao mesmo tempo (ex.: requerente
  // e atribuído) não permite dizer qual intervalo era de qual: fica desconhecido, e a pessoa decide se conta.
  const actors = [...byKey.values()].map((a) => {
    const roles = [...new Set(rolesNow.get(a.k) ?? [])];
    const role = roles.length === 1 ? roles[0] : 0;
    return {
      k: a.k,
      type: a.type,
      id: a.id,
      name: hideContent ? '' : a.name,
      segs: a.segs.map((s) => [s[0], s[1], s[1] == null ? role : 0]),
    };
  });

  return { id, created, status: current, statusSegs: statusSegs.filter((s) => s[2] == null || s[2] > s[1]), actors, fetchedAt: now };
}

// A interseção de [from, to) com [lo, hi]; `to` null vale "até hi". null quando não sobra nada.
export function clip(from, to, lo, hi) {
  const a = Math.max(from, lo);
  const b = Math.min(to ?? hi, hi);
  return b > a ? [a, b] : null;
}

// "menos de 1 min", "45 min", "3 h 20 min", "2 d 5 h". Arredonda para o minuto.
export function formatSpan(ms) {
  const min = Math.round(Math.max(0, ms) / MIN);
  if (min < 1) return 'menos de 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (min < 24 * 60) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(min / (24 * 60));
  const rest = Math.floor((min % (24 * 60)) / 60);
  return rest ? `${d} d ${rest} h` : `${d} d`;
}

const labelOf = (a) => {
  if (a.name) return a.name;
  const noun = a.type === 'Group' ? 'Equipe' : 'Pessoa';
  return a.id != null ? `${noun} #${a.id}` : noun;
};

// A rosca: 100% do tempo, da abertura até a solução (ou até agora, se ainda está aberto), dividido por quem estava
// atribuído em cada instante. Varredura: os cortes são todas as bordas de intervalo, e cada trecho entre dois cortes tem
// dono único, então não sobra lacuna nem se conta tempo em dobro.
//  - dois ou mais atribuídos ao mesmo tempo dividem o trecho em partes iguais;
//  - pessoa antes de equipe: com técnico atribuído, a equipe que também está no ticket não divide o tempo com ele;
//  - sem ninguém atribuído: "Sem atribuição / Fila"; com alguém de papel desconhecido: "Papel desconhecido"
//    (a menos que `includeUnknown`, que conta esses vínculos como atribuição);
//  - passa de `maxSlices` pessoas/equipes: o resto vira "Outros (n)".
// A janela termina na PRIMEIRA entrada em resolvido/fechado da sequência final: um fechamento automático dias depois
// da solução não estica o gráfico. Reabrir e resolver de novo estende a janela (linha do tempo contínua).
export function donutModel(entry, { now, includeUnknown = false, maxSlices = 7 } = {}) {
  const segs = entry.statusSegs;
  let i = segs.length;
  while (i > 0 && segs[i - 1][0] >= 5) i -= 1;
  const done = i < segs.length;
  const from = entry.created;
  const to = done ? segs[i][1] : now;
  const empty = { window: { from, to: Math.max(from, to), totalMs: 0, done }, slices: [], uncertain: false, unknownMs: 0, includesUnknown: false };
  if (!(to > from)) return empty;

  const allowed = new Set(includeUnknown ? [ROLE.ASSIGNED, 0] : [ROLE.ASSIGNED]);
  const spans = [];
  for (const a of entry.actors) {
    for (const s of a.segs) {
      const c = clip(s[0], s[1], from, to);
      if (c) spans.push({ a, role: s[2], from: c[0], to: c[1], open: s[1] == null });
    }
  }
  const cuts = [...new Set([from, to, ...spans.flatMap((s) => [s.from, s.to])])].sort((x, y) => x - y);

  const acc = new Map(); // chave da pessoa/equipe -> ms
  const who = new Map();
  let queue = 0;
  let unknown = 0;
  let usedUnknown = false;
  for (let j = 0; j < cuts.length - 1; j += 1) {
    const [lo, hi] = [cuts[j], cuts[j + 1]];
    const len = hi - lo;
    const active = spans.filter((s) => s.from <= lo && s.to >= hi);
    const holders = new Map();
    for (const s of active) if (allowed.has(s.role)) holders.set(s.a.k, s);
    let owners = [...holders.values()].map((s) => s.a);
    if (owners.some((a) => a.type === 'User')) owners = owners.filter((a) => a.type === 'User');
    if (owners.length) {
      for (const a of owners) {
        acc.set(a.k, (acc.get(a.k) ?? 0) + len / owners.length);
        who.set(a.k, a);
        if (includeUnknown && holders.get(a.k).role === 0) usedUnknown = true;
      }
    } else if (active.some((s) => s.role === 0)) {
      unknown += len;
    } else {
      queue += len;
    }
  }

  // arredonda sem perder nem criar tempo: a diferença vai para a maior fatia
  const total = to - from;
  const ranked = [...acc].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v || (a.k < b.k ? -1 : 1));
  const people = ranked.slice(0, maxSlices).map(({ k, v }, n) => {
    const a = who.get(k);
    return { key: k, kind: a.type === 'Group' ? 'group' : 'user', label: labelOf(a), ms: Math.round(v), tone: n + 1, open: !done && spans.some((s) => s.a.k === k && s.open && allowed.has(s.role)) };
  });
  const rest = ranked.slice(maxSlices);
  const slices = [...people];
  if (rest.length) slices.push({ key: 'other', kind: 'other', label: `Outros (${rest.length})`, ms: Math.round(rest.reduce((s, r) => s + r.v, 0)), tone: 'other', open: false });
  if (queue) slices.push({ key: 'queue', kind: 'queue', label: 'Sem atribuição / Fila', ms: Math.round(queue), tone: 'queue', open: false });
  if (unknown) slices.push({ key: 'unknown', kind: 'unknown', label: 'Papel desconhecido', ms: Math.round(unknown), tone: 'unknown', open: false });
  const drift = total - slices.reduce((s, x) => s + x.ms, 0);
  if (slices.length) (slices.find((s) => s.kind === 'user' || s.kind === 'group') ?? slices[0]).ms += drift;
  for (const s of slices) s.pct = s.ms / total;
  return { window: { from, to, totalMs: total, done }, slices, uncertain: unknown > 0, unknownMs: Math.round(unknown), includesUnknown: usedUnknown };
}
