// Lógica de polling sem efeitos colaterais: recebe config, estado e um cliente
// da API e devolve o novo estado + as notificações a disparar.
import { FIELD, GlpiError } from './glpi.js';
import { describeEvent, htmlToText, statusLabel } from './format.js';
import { makeNameResolver } from './users.js';

const ROLE_FIELD = { assigned: FIELD.TECH, observer: FIELD.WATCHER, requester: FIELD.REQUESTER };
const FULL_REFRESH_MS = 15 * 60_000; // rede de segurança caso o date_mod não mude
const KEEP_DONE_MS = 2 * 24 * 3600_000; // resolvidos ficam visíveis por 2 dias
const MAX_EVENTS = 20;
const ID_CHUNK = 25;
const CONCURRENCY = 4;

const SOURCE_TEXT = {
  assigned: 'atribuído a você',
  observer: 'você é observador',
  requester: 'aberto por você',
};

// `fp` e `baseUrl` dizem de quem é este cache (veja credentialFingerprint): trocar de conta ou de GLPI o descarta.
export const emptyState = () => ({ me: null, fp: null, baseUrl: '', users: {}, tickets: {}, initialized: false, lastRun: null });

const blankTicket = (id) => ({
  id,
  title: `Ticket #${id}`,
  entity: '',
  status: null,
  priority: null,
  dateMod: null,
  rowDateMod: null,
  extra: '',
  sources: [],
  lastFollowupId: 0,
  lastSolutionId: 0,
  checkedAt: 0,
  events: [],
});

const maxId = (list) => list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0);
const ascending = (list) => [...list].sort((a, b) => a.id - b.id);

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

// Erro de UM ticket (o GLPI respondeu 500, ou algo que não é um ticket): não pode derrubar a rodada.
// O que atinge todos os tickets continua abortando: rede fora, token/sessão (401), limite (429), gateway (502-504).
const isItemError = (e) => e instanceof GlpiError && (e.status === 500 || (e.status === undefined && !e.code));

// Impressão digital de quem está conectado (URL + token), para saber se o cache ainda é desta conta.
// Só o hash fica guardado; o token já está em `config`, então isto não expõe nada a mais.
export async function credentialFingerprint(cfg) {
  const bytes = new TextEncoder().encode(`${cfg.baseUrl}\n${cfg.userToken}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Descobre os tickets do radar: um search por papel (atribuído/observador/
// requerente, só em aberto) + um search por lote de IDs acompanhados à mão.
export async function discover({ cfg, api, meId, watchedIds = [] }) {
  const found = new Map();
  const add = (row, source) => {
    const cur = found.get(row.id) ?? { row, sources: new Set() };
    cur.sources.add(source);
    found.set(row.id, cur);
  };
  const jobs = [];
  for (const [role, field] of Object.entries(ROLE_FIELD)) {
    if (!cfg.roles[role]) continue;
    jobs.push(
      api
        .searchTickets({
          criteria: [
            { field, value: meId },
            { field: FIELD.STATUS, value: 'notold' },
          ],
          extraField: cfg.extraField,
        })
        .then((rows) => rows.forEach((r) => add(r, role))),
    );
  }
  for (const part of chunks(watchedIds, ID_CHUNK)) {
    jobs.push(
      api
        .searchTickets({
          criteria: part.map((id, i) => ({ field: FIELD.ID, value: id, link: i ? 'OR' : undefined })),
          extraField: cfg.extraField,
        })
        .then((rows) => rows.forEach((r) => add(r, 'manual'))),
    );
  }
  await Promise.all(jobs);
  return found;
}

const HEADLINE_ORDER = ['followup', 'solution', 'extra', 'status', 'new'];

export function headline(events) {
  for (const type of HEADLINE_ORDER) {
    const e = [...events].reverse().find((x) => x.type === type);
    if (e) return e;
  }
  return events.at(-1);
}

// Apaga o texto livre (acompanhamentos e soluções) já guardado no cache.
export function scrubState(state) {
  for (const t of Object.values(state.tickets ?? {})) {
    for (const e of t.events ?? []) {
      if (e.type === 'followup' || e.type === 'solution') e.text = '';
    }
  }
  return state;
}

export function toNotification(alert, { hideContent = false } = {}) {
  const main = headline(alert.events);
  const extra = alert.events.length > 1 ? `  (+${alert.events.length - 1})` : '';
  return {
    ticketId: alert.ticketId,
    title: (hideContent ? `Ticket #${alert.ticketId}` : `#${alert.ticketId} ${alert.title}`).slice(0, 90),
    message: `${describeEvent(main)}${extra}`.slice(0, 250),
    context: hideContent ? '' : alert.entity || '', // a entidade também identifica o cliente
  };
}

export async function runPoll({ cfg, state, watched = {}, api, clock = Date.now }) {
  const startedAt = clock();
  const next = structuredClone(state ?? emptyState());
  next.tickets ??= {};
  next.users ??= {};
  const hide = Boolean(cfg.hideContent);
  if (hide) scrubState(next); // texto que já estava no cache antes de ligar a opção
  let reset = false; // descartou o cache de outra conta/GLPI: quem chamou limpa o que depende dos números de ticket
  const fp = await credentialFingerprint(cfg);
  if (next.fp !== fp) {
    // Credenciais novas (ou primeira rodada depois desta versão): confere quem é o usuário antes de confiar no cache.
    const before = { meId: next.me?.id, baseUrl: next.baseUrl };
    next.me = await api.me();
    const otherAccount = before.meId != null && before.meId !== next.me.id;
    const otherSite = Boolean(before.baseUrl) && before.baseUrl !== cfg.baseUrl;
    if (otherAccount || otherSite) {
      // cache de outra conta ou de outro GLPI: descarta e volta a ser baseline silencioso
      next.users = {};
      next.tickets = {};
      next.initialized = false;
      reset = true;
    }
    next.fp = fp;
    next.baseUrl = cfg.baseUrl;
  }
  next.me ??= await api.me();
  const meId = next.me.id;
  const watchedIds = Object.keys(watched).map(Number);

  const found = await discover({ cfg, api, meId, watchedIds });
  const ids = [...new Set([...found.keys(), ...Object.keys(next.tickets).map(Number), ...watchedIds])];
  const alerts = [];
  const failed = []; // tickets que o GLPI não conseguiu ler nesta rodada
  const expired = []; // acompanhados à mão que ficaram encerrados por tempo demais: quem chamou deixa de acompanhar

  const nameOf = makeNameResolver({ api, meId, cache: next.users }); // rede fora: aborta a rodada

  await mapLimit(ids, CONCURRENCY, async (id) => {
    const hit = found.get(id);
    const prev = next.tickets[id];
    const manual = watchedIds.includes(id);
    const sources = [...(hit?.sources ?? [])];
    if (manual && !sources.includes('manual')) sources.push('manual');

    const vanished = !hit; // saiu das buscas (resolvido, desatribuído...) ou inacessível
    const wasOpen = !prev || prev.status == null || prev.status < 5;
    const settled = vanished && !wasOpen; // encerrado e fora do radar: só espera expirar
    // a varredura completa é só para o que está aberto: encerrado só é relido se o date_mod mudar (ex.: reaberto)
    const stale = !prev || (wasOpen && startedAt - (prev.checkedAt ?? 0) > FULL_REFRESH_MS);
    // Compara o date_mod do search com o do search anterior (formatos diferentes do /Ticket).
    const modChanged = !!prev && !!hit && hit.row.dateMod !== prev.rowDateMod;
    const refresh = !settled && (!prev || modChanged || stale || (vanished && !prev.unavailable));

    const events = [];
    const push = (type, author, text) => {
      if (cfg.notify[type]) events.push({ type, at: clock(), author, text });
    };

    // Status extra só existe no search e pode mudar sem mexer no date_mod do ticket.
    const extra = hit ? hit.row.extra : (prev?.extra ?? '');
    if (prev && hit && extra !== (prev.extra ?? '')) {
      push('extra', '', `${prev.extra || '—'} → ${extra || '—'}`);
    }
    if (!prev && next.initialized && hit && !sources.includes('manual')) {
      const why = sources.map((s) => SOURCE_TEXT[s]).filter(Boolean).join(', ');
      push('new', '', `Novo no seu radar: ${why}`);
    }

    let detail = null;
    let lastFollowupId = prev?.lastFollowupId ?? 0;
    let lastSolutionId = prev?.lastSolutionId ?? 0;

    if (refresh) {
      let fups;
      let sols;
      try {
        [detail, fups, sols] = await Promise.all([api.ticket(id), api.followups(id), api.solutions(id)]);
      } catch (e) {
        if (e instanceof GlpiError && (e.status === 403 || e.status === 404)) {
          if (manual) next.tickets[id] = { ...(prev ?? blankTicket(id)), sources, unavailable: true, checkedAt: startedAt };
          else delete next.tickets[id];
          return;
        }
        if (isItemError(e)) {
          // Mantém o que já se sabia do ticket (sem avançar nada) e tenta de novo na próxima rodada.
          failed.push(id);
          if (prev) next.tickets[id] = { ...prev, readError: true };
          return;
        }
        throw e;
      }
      // Primeira vez que vemos o ticket: baseline silencioso (não avisa o histórico).
      const baseF = prev ? prev.lastFollowupId : maxId(fups);
      const baseS = prev ? prev.lastSolutionId : maxId(sols);

      if (prev && prev.status != null && detail.status !== prev.status) {
        push('status', '', `${statusLabel(prev.status)} → ${statusLabel(detail.status)}`);
      }
      if (cfg.notify.solution) {
        for (const s of ascending(sols.filter((x) => x.id > baseS))) {
          if (cfg.notifyOwn || s.users_id !== meId) {
            push('solution', await nameOf(s.users_id), hide ? '' : htmlToText(s.content));
          }
        }
      }
      if (cfg.notify.followup) {
        for (const f of ascending(fups.filter((x) => x.id > baseF))) {
          if (cfg.notifyOwn || f.users_id !== meId) {
            push('followup', await nameOf(f.users_id), hide ? '' : htmlToText(f.content));
          }
        }
      }
      lastFollowupId = Math.max(baseF, maxId(fups));
      lastSolutionId = Math.max(baseS, maxId(sols));
    }

    const status = detail?.status ?? prev?.status ?? null;
    const t = {
      id,
      title: detail ? htmlToText(detail.name, 200) : prev?.title || hit?.row.title || `Ticket #${id}`,
      entity: hit?.row.entity ?? prev?.entity ?? '',
      status,
      priority: detail?.priority ?? prev?.priority ?? null,
      dateMod: detail?.date_mod ?? prev?.dateMod ?? null,
      rowDateMod: hit?.row.dateMod ?? prev?.rowDateMod ?? null,
      extra,
      sources,
      lastFollowupId,
      lastSolutionId,
      checkedAt: refresh ? startedAt : (prev?.checkedAt ?? startedAt),
      events: [...(prev?.events ?? []), ...events].slice(-MAX_EVENTS),
      unavailable: false,
    };
    const done = status != null && status >= 5;
    if (done) t.doneSince = prev?.doneSince ?? startedAt;

    const inRadar = !!hit || manual;
    if (!inRadar && !done) {
      delete next.tickets[id]; // continua aberto mas saiu do seu radar
      return;
    }
    if (done && startedAt - t.doneSince > KEEP_DONE_MS && (!inRadar || manual)) {
      delete next.tickets[id];
      if (manual) expired.push(id);
      return;
    }
    next.tickets[id] = t;
    if (events.length) alerts.push({ ticketId: id, title: t.title, entity: t.entity, events });
  });

  alerts.sort((a, b) => a.ticketId - b.ticketId);
  next.initialized = true;
  next.lastRun = { ok: true, at: clock(), count: Object.keys(next.tickets).length, ms: clock() - startedAt, failed: failed.sort((a, b) => a - b) };
  return {
    state: next,
    notifications: alerts.map((a) => toNotification(a, { hideContent: hide })),
    expired: expired.sort((a, b) => a - b),
    reset,
  };
}
