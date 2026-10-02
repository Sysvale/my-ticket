// Tickets parados: lógica pura, sem DOM nem chrome.*. Um ticket em aberto sem nenhuma movimentação há muito tempo ganha um
// destaque discreto (âmbar e, mais tarde, vermelho). Usa o `dateMod` que a extensão já guarda do GLPI: nenhuma consulta.
// A configuração fica em `appearance.stale` (escrita só pela aba "Aparência" das Opções).
import { parseGlpiDate } from './format.js';
import { formatSpan } from './timeshare.js';

const HOUR = 3600_000;
export const LIMITS = Object.freeze({ min: 1, max: 8760 }); // de 1 hora a 1 ano
export const DEFAULT_STALE = Object.freeze({ enabled: true, amberHours: 48, redHours: 120 });

const toHours = (v, fallback) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(LIMITS.max, Math.max(LIMITS.min, n)) : fallback;
};

// O que estiver gravado pode ser lixo: devolve sempre um objeto novo e válido. Horas inteiras entre 1 e 8760, e o
// vermelho sempre depois do amarelo (se não, passa a 1 hora depois dele).
export function normalizeStale(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const amberHours = Math.min(LIMITS.max - 1, toHours(r.amberHours, DEFAULT_STALE.amberHours));
  const redHours = Math.max(amberHours + 1, toHours(r.redHours, DEFAULT_STALE.redHours));
  return { enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_STALE.enabled, amberHours, redHours };
}

// 'red' | 'amber' | null. Só vale para ticket em aberto (status 1 a 4), legível e com data de atualização: resolvido,
// fechado, sem acesso ou com erro de leitura (a data guardada pode estar velha por causa do erro) não são destacados.
export function staleLevel(ticket, now, stale) {
  if (!stale?.enabled || !ticket || ticket.unavailable || ticket.readError) return null;
  if (!(ticket.status >= 1 && ticket.status <= 4)) return null;
  const mod = parseGlpiDate(ticket.dateMod);
  if (!Number.isFinite(mod)) return null;
  const age = now - mod;
  if (age >= stale.redHours * HOUR) return 'red';
  if (age >= stale.amberHours * HOUR) return 'amber';
  return null;
}

// "parado há 3 d 2 h": o tempo desde a última atualização, no mesmo formato da rosca.
export const staleText = (ticket, now) => `parado há ${formatSpan(now - parseGlpiDate(ticket.dateMod))}`;
