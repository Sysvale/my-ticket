// Helpers puros (sem chrome.*), compartilhados por background, popup, options e testes.

export const STATUS = {
  1: { label: 'Novo', tone: 'info' },
  2: { label: 'Em atendimento', tone: 'ok' },
  3: { label: 'Planejado', tone: 'ok' },
  4: { label: 'Pendente', tone: 'warn' },
  5: { label: 'Resolvido', tone: 'muted' },
  6: { label: 'Fechado', tone: 'muted' },
};

export const PRIORITY = {
  1: 'Muito baixa',
  2: 'Baixa',
  3: 'Média',
  4: 'Alta',
  5: 'Muito alta',
  6: 'Crítica',
};

export const SOURCE_LABEL = {
  assigned: 'atribuído',
  observer: 'observador',
  requester: 'requerente',
  manual: 'manual',
};

export const statusLabel = (s) => STATUS[s]?.label ?? (s == null ? '—' : `Status ${s}`);

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

// O GLPI devolve o conteúdo como HTML escapado (&lt;p&gt;...). Decodifica,
// tira as tags e devolve texto puro. O resultado só deve ir para textContent.
export function htmlToText(html, max = 160) {
  if (html == null || html === '') return '';
  let t = decodeEntities(html);
  t = t.replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '');
  t = decodeEntities(t).replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// Como htmlToText, mas preserva as quebras de linha (parágrafos, <br>, itens de lista).
export function htmlToParagraphs(html, max = 1200) {
  if (html == null || html === '') return '';
  let t = decodeEntities(html);
  t = t.replace(/<(?:br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  t = decodeEntities(t)
    .replace(/[ \t\r\f\v]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// Aceita "https://glpi.exemplo.com", "glpi.exemplo.com/", ".../apirest.php/initSession" etc.
export function normalizeBaseUrl(input) {
  let s = String(input ?? '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u;
  try {
    u = new URL(s);
  } catch {
    return '';
  }
  const path = u.pathname.replace(/\/(apirest\.php|front\/|index\.php|plugins\/).*$/i, '').replace(/\/+$/, '');
  return `${u.origin}${path}`;
}

// A URL está dentro do GLPI configurado? Compara a origem inteira e a fronteira do caminho:
// "https://glpi.exemplo.com.golpe.net/..." não é "https://glpi.exemplo.com", nem "/glpi-outro" é "/glpi".
export function isUnderBase(url, baseUrl) {
  try {
    const u = new URL(url);
    const b = new URL(baseUrl);
    if (u.origin !== b.origin) return false;
    const base = b.pathname.replace(/\/+$/, '');
    return u.pathname === base || u.pathname.startsWith(`${base}/`);
  } catch {
    return false;
  }
}

export const ticketUrl = (base, id) => `${base}/front/ticket.form.php?id=${id}`;

// Os tokens da API nunca podem trafegar sem criptografia: só https:// é aceito.
export const HTTPS_ONLY_MESSAGE =
  'Somente https:// é aceito na URL do GLPI: os tokens não podem trafegar sem criptografia.';
export const isSecureUrl = (url) => /^https:\/\//i.test(String(url ?? '').trim());

// "159919", "#159919" ou uma URL de ticket do GLPI. Qualquer outra coisa => null.
export function parseTicketId(input) {
  const s = String(input ?? '').trim();
  if (/^#?\d{1,9}$/.test(s)) return Number(s.replace('#', ''));
  const m =
    s.match(/ticket\.form\.php\?(?:[^#]*&)?id=(\d+)/i) ||
    s.match(/[?&]redirect=ticket_(\d+)/i) ||
    s.match(/\/Ticket\/(\d+)(?:[/?#]|$)/i);
  return m ? Number(m[1]) : null;
}

// Datas do GLPI vêm como "2026-09-29 10:05:03" no fuso do servidor.
export function parseGlpiDate(value) {
  if (typeof value === 'number') return value;
  return Date.parse(String(value ?? '').replace(' ', 'T'));
}

// "29/09/2026 10:05" (fuso do navegador, que costuma ser o do servidor do GLPI).
export function formatDateTime(value) {
  const ms = parseGlpiDate(value);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function timeAgo(value, now = Date.now()) {
  const t = parseGlpiDate(value);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

// "1 com erro de leitura (#123)": tickets que o GLPI não conseguiu ler na última verificação.
export function failedLabel(ids) {
  const n = ids?.length ?? 0;
  if (!n) return '';
  const shown = ids.slice(0, 3).map((id) => `#${id}`).join(', ');
  return `${n} com erro de leitura (${shown}${n > 3 ? '…' : ''})`;
}

export function describeEvent(e) {
  switch (e.type) {
    case 'followup':
      return e.text ? `${e.author || 'Alguém'}: ${e.text}` : `${e.author || 'Alguém'} respondeu`;
    case 'solution':
      return e.text
        ? `${e.author || 'Alguém'} propôs solução: ${e.text}`
        : `${e.author || 'Alguém'} propôs uma solução`;
    case 'status':
      return `Status: ${e.text}`;
    case 'extra':
      return `Status extra: ${e.text}`;
    default:
      return e.text ?? '';
  }
}

// Lê um arquivo .env (KEY=VALUE, com aspas e "export" opcionais).
export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
