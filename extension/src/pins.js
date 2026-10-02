// Tickets fixados no topo da lista: lógica pura, sem DOM nem chrome.*.
// Os ids ficam em `user.pinned`, na ordem em que foram fixados (o primeiro fixado fica no alto). Sem limite de quantidade.
// Escrito só pela interface, sempre por updateUser().

// Lista válida de ids (inteiros positivos, sem repetição), venha do storage como vier.
export function normalizePinned(list) {
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    const id = Number(v);
    if (Number.isInteger(id) && id > 0 && !out.includes(id)) out.push(id);
  }
  return out;
}

export const isPinned = (user, id) => normalizePinned(user?.pinned).includes(Number(id));

// Fixa se não estava fixado, desafixa se estava. Altera `user` e devolve o novo estado (true = agora fixado).
export function togglePin(user, id) {
  const n = Number(id);
  const list = normalizePinned(user.pinned);
  const at = list.indexOf(n);
  if (at >= 0) list.splice(at, 1);
  else if (Number.isInteger(n) && n > 0) list.push(n);
  user.pinned = list;
  return at < 0 && list.includes(n);
}

// Separa os fixados (na ordem em que foram fixados, só os que estão em `tickets`) do resto (na ordem recebida).
export function splitPinned(tickets, pinned) {
  const ids = normalizePinned(pinned);
  const byId = new Map(tickets.map((t) => [Number(t.id), t]));
  const fixed = ids.map((id) => byId.get(id)).filter(Boolean);
  const set = new Set(fixed.map((t) => Number(t.id)));
  return { pinned: fixed, rest: tickets.filter((t) => !set.has(Number(t.id))) };
}

// Tira dos fixados o que saiu do cache (ticket resolvido há dias, ou de outra conta). Devolve true se mudou algo.
export function prunePinned(user, state) {
  if (!Array.isArray(user.pinned)) return false;
  const kept = normalizePinned(user.pinned).filter((id) => String(id) in (state.tickets ?? {}));
  const changed = kept.length !== user.pinned.length || kept.some((id, i) => id !== user.pinned[i]);
  if (changed) user.pinned = kept;
  return changed;
}

// Texto do resumo "Mostrando X de Y" quando há fixados à parte: os fixados não entram na conta dos filtros.
export function summaryText({ shown, total, pinned }) {
  const base = `Mostrando ${shown} de ${total}`;
  return pinned ? `${base} · ${pinned} ${pinned === 1 ? 'fixado' : 'fixados'} à parte` : base;
}
