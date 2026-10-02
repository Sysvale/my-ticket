// Cliente mínimo da API REST legada do GLPI (/apirest.php). Somente leitura.
import { HTTPS_ONLY_MESSAGE, htmlToText, isSecureUrl } from './format.js';

// Search options do Ticket. Os de usuário/status são os padrões do GLPI;
// o Status extra é do plugin Fields e varia por instância (vem da config).
export const FIELD = {
  TITLE: 1,
  ID: 2,
  REQUESTER: 4,
  TECH: 5,
  STATUS: 12,
  DATE_MOD: 19,
  WATCHER: 66,
  ENTITY: 80,
};

const REDIRECT_MESSAGE =
  'O GLPI redirecionou o pedido para outro endereço. Confira a URL nas Opções: use o endereço exato do GLPI, com https://.';

export class GlpiError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = 'GlpiError';
    this.status = status;
    this.code = code;
  }
}

export function buildSearchQuery({ criteria, forcedisplay = [], range = '0-199' }) {
  const q = [];
  criteria.forEach((c, i) => {
    if (i > 0) q.push(`criteria[${i}][link]=${c.link || 'AND'}`);
    q.push(
      `criteria[${i}][field]=${c.field}`,
      `criteria[${i}][searchtype]=${c.searchtype || 'equals'}`,
      `criteria[${i}][value]=${encodeURIComponent(c.value)}`,
    );
  });
  forcedisplay.forEach((f, i) => q.push(`forcedisplay[${i}]=${f}`));
  q.push(`range=${range}`);
  return q.join('&');
}

const flat = (v) => (Array.isArray(v) ? v.join(', ') : (v ?? ''));

export function createClient({
  baseUrl,
  appToken,
  userToken,
  fetchImpl = (...a) => globalThis.fetch(...a),
  sessionStore = null,
  timeoutMs = 20000,
}) {
  // Última barreira: mesmo que uma config antiga/importada traga http://, nada é enviado.
  if (!isSecureUrl(baseUrl)) throw new GlpiError(HTTPS_ONLY_MESSAGE, { code: 'INSECURE_URL' });
  const root =`${baseUrl.replace(/\/+$/, '')}/apirest.php`;
  let session = null;
  let loginPromise = null;

  async function raw(method, path, headers = {}) {
    const ctl = new AbortController();
    // O limite vale para a resposta inteira, corpo incluído: um servidor que manda os cabeçalhos e
    // trava não pode deixar a verificação pendurada.
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res;
    let text;
    try {
      res = await fetchImpl(`${root}/${path}`, {
        method,
        headers: { 'App-Token': appToken, ...headers },
        signal: ctl.signal,
        // Nunca segue redirecionamento: o fetch repassaria App-Token e Session-Token ao novo destino
        // (outro host, ou até http://). No navegador o resultado é "opaqueredirect"; em outros
        // ambientes, a própria resposta 3xx.
        redirect: 'manual',
      });
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        throw new GlpiError(REDIRECT_MESSAGE, { code: 'REDIRECT' });
      }
      text = await res.text();
    } catch (e) {
      if (e instanceof GlpiError) throw e;
      throw new GlpiError('Sem conexão com o GLPI', { code: 'NETWORK' });
    } finally {
      clearTimeout(timer);
    }
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const isApiError = Array.isArray(data) && typeof data[0] === 'string';
      throw new GlpiError(isApiError ? data[1] || data[0] : `HTTP ${res.status}`, {
        status: res.status,
        code: isApiError ? data[0] : undefined,
      });
    }
    return data;
  }

  async function login() {
    const data = await raw('GET', 'initSession', { Authorization: `user_token ${userToken}` });
    if (!data?.session_token) {
      throw new GlpiError('Resposta inesperada do GLPI ao iniciar sessão (URL correta?)', { code: 'AUTH' });
    }
    session = data.session_token;
    await sessionStore?.set(session);
    return session;
  }

  async function ensureSession() {
    if (session) return session;
    session = (await sessionStore?.get()) || null;
    if (session) return session;
    loginPromise ??= login().finally(() => {
      loginPromise = null;
    });
    return loginPromise;
  }

  async function request(path, retried = false) {
    const used = await ensureSession();
    try {
      return await raw('GET', path, { 'Session-Token': used });
    } catch (e) {
      if (e instanceof GlpiError && e.status === 401 && !retried) {
        if (session === used) {
          session = null;
          await sessionStore?.set(null);
        }
        return request(path, true);
      }
      throw e;
    }
  }

  async function subitems(path, n, tolerated = [404]) {
    try {
      const data = await request(`${path}?sort=id&order=DESC&range=0-${n - 1}`);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      if (e instanceof GlpiError && tolerated.includes(e.status)) return [];
      throw e;
    }
  }

  return {
    async me() {
      const data = await request('getFullSession');
      const s = data?.session ?? {};
      if (!s.glpiID) throw new GlpiError('Não foi possível identificar o usuário do token', { code: 'AUTH' });
      return { id: Number(s.glpiID), name: s.glpifriendlyname || s.glpiname || '' };
    },

    async version() {
      const data = await request('getGlpiConfig');
      return data?.cfg_glpi?.version ?? null;
    },

    async ticket(id) {
      const data = await request(`Ticket/${id}`);
      if (!data || Array.isArray(data)) throw new GlpiError(`Resposta inesperada para o ticket #${id}`);
      return data;
    },

    // O ticket com o histórico (log) do GLPI, para o gráfico de tempo por atribuído. SÓ é chamado quando a pessoa pede o
    // gráfico: nunca pelo polling. `logs` é null quando o perfil não tem o direito "Logs" (o GLPI responde 200 com um
    // erro dentro de `_logs`) ou quando a instância não conhece `with_logs`. Sem os links HATEOAS, que só pesam.
    async ticketWithLogs(id) {
      const data = await request(`Ticket/${id}?with_logs=true&get_hateoas=false`);
      if (!data || Array.isArray(data)) throw new GlpiError(`Resposta inesperada para o ticket #${id}`);
      const { _logs, ...ticket } = data;
      const denied = _logs == null || (!Array.isArray(_logs) && typeof _logs === 'object' && 'error' in _logs && 'message' in _logs);
      if (denied) return { ticket, logs: null };
      return { ticket, logs: Array.isArray(_logs) ? _logs : Object.values(_logs) };
    },

    // Quem está no ticket agora, com o papel (1 requerente, 2 atribuído, 3 observador). O log diz quem entrou e saiu, mas
    // não em que papel: o papel só se sabe de quem ainda está aqui. Sem direito de leitura vira lista vazia.
    async ticketActors(id) {
      const read = async (sub, field, type) => {
        try {
          const rows = await request(`Ticket/${id}/${sub}?range=0-199&get_hateoas=false`);
          return (Array.isArray(rows) ? rows : []).map((r) => ({ type, id: Number(r[field]), role: Number(r.type) }));
        } catch (e) {
          if (e instanceof GlpiError && [400, 403, 404].includes(e.status)) return [];
          throw e;
        }
      };
      const [users, groups] = await Promise.all([read('Ticket_User', 'users_id', 'User'), read('Group_Ticket', 'groups_id', 'Group')]);
      return [...users, ...groups].filter((a) => Number.isInteger(a.id) && a.id > 0 && [1, 2, 3].includes(a.role));
    },

    followups: (id, n = 10) => subitems(`Ticket/${id}/ITILFollowup`, n),
    // Instâncias sem o item (GLPI antigo) ou sem direito de leitura viram lista vazia.
    solutions: (id, n = 3) => subitems(`Ticket/${id}/ITILSolution`, n, [400, 403, 404]),

    async userName(id) {
      const u = await request(`User/${id}`);
      const full = [u?.firstname, u?.realname].filter(Boolean).join(' ');
      return htmlToText(full || u?.name || '', 80);
    },

    async searchTickets({ criteria, extraField }) {
      const forcedisplay = [FIELD.TITLE, FIELD.ID, FIELD.DATE_MOD, FIELD.ENTITY, extraField].filter(Boolean);
      const data = await request(`search/Ticket?${buildSearchQuery({ criteria, forcedisplay })}`);
      const rows = Array.isArray(data?.data) ? data.data : Object.values(data?.data ?? {});
      return rows.map((r) => ({
        id: Number(r[FIELD.ID]),
        title: htmlToText(flat(r[FIELD.TITLE]), 200),
        dateMod: String(flat(r[FIELD.DATE_MOD])),
        entity: htmlToText(flat(r[FIELD.ENTITY]), 120),
        extra: extraField ? htmlToText(flat(r[extraField]), 80) : '',
      }));
    },
  };
}
