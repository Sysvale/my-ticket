import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIELD, GlpiError, buildSearchQuery, createClient } from '../extension/src/glpi.js';

const res = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

const CFG = { baseUrl: 'https://glpi.test/', appToken: 'APP', userToken: 'UT' };

test('buildSearchQuery monta criteria com links e forcedisplay', () => {
  const q = buildSearchQuery({
    criteria: [
      { field: FIELD.TECH, value: 7 },
      { field: FIELD.STATUS, value: 'notold' },
    ],
    forcedisplay: [1, 2],
    range: '0-9',
  });
  assert.equal(
    q,
    'criteria[0][field]=5&criteria[0][searchtype]=equals&criteria[0][value]=7' +
      '&criteria[1][link]=AND&criteria[1][field]=12&criteria[1][searchtype]=equals&criteria[1][value]=notold' +
      '&forcedisplay[0]=1&forcedisplay[1]=2&range=0-9',
  );
});

test('cliente inicia sessão com user_token e renova ao receber 401', async () => {
  const calls = [];
  let logins = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const path = url.split('/apirest.php/')[1];
    if (path === 'initSession') {
      logins += 1;
      return res(200, { session_token: `S${logins}` });
    }
    if (init.headers['Session-Token'] === 'S1') return res(401, ['ERROR_SESSION_TOKEN_INVALID', 'expirou']);
    return res(200, { session: { glpiID: '7', glpifriendlyname: 'Igor C' } });
  };
  const api = createClient({ ...CFG, fetchImpl });
  assert.deepEqual(await api.me(), { id: 7, name: 'Igor C' });
  assert.equal(logins, 2);
  assert.equal(calls[0].url, 'https://glpi.test/apirest.php/initSession');
  assert.equal(calls[0].headers.Authorization, 'user_token UT');
  assert.equal(calls[0].headers['App-Token'], 'APP');
});

test('requisições paralelas compartilham um único login', async () => {
  let logins = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/initSession')) {
      logins += 1;
      await new Promise((r) => setTimeout(r, 5));
      return res(200, { session_token: 'S' });
    }
    return res(200, { id: 1 });
  };
  const api = createClient({ ...CFG, fetchImpl });
  await Promise.all([api.ticket(1), api.ticket(2), api.ticket(3)]);
  assert.equal(logins, 1);
});

test('sessão em cache (sessionStore) evita novo login', async () => {
  let logins = 0;
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/initSession')) logins += 1;
    assert.equal(init.headers['Session-Token'], 'CACHED');
    return res(200, { id: 1 });
  };
  const sessionStore = { get: async () => 'CACHED', set: async () => {} };
  await createClient({ ...CFG, fetchImpl, sessionStore }).ticket(1);
  assert.equal(logins, 0);
});

test('erros da API viram GlpiError com code e status', async () => {
  const bad = async () => res(401, ['ERROR_GLPI_LOGIN', 'Erro no login']);
  await assert.rejects(createClient({ ...CFG, fetchImpl: bad }).me(), (e) => {
    assert.ok(e instanceof GlpiError);
    assert.equal(e.status, 401);
    assert.equal(e.code, 'ERROR_GLPI_LOGIN');
    assert.equal(e.message, 'Erro no login');
    return true;
  });
  const down = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(createClient({ ...CFG, fetchImpl: down }).me(), (e) => e.code === 'NETWORK');
});

test('searchTickets normaliza as linhas (HTML, arrays, ids numéricos)', async () => {
  let url;
  const fetchImpl = async (u) => {
    if (u.endsWith('/initSession')) return res(200, { session_token: 'S' });
    url = u;
    return res(206, {
      totalcount: 1,
      count: 1,
      data: [
        {
          1: 'Erro &amp; falha',
          2: 159919,
          19: '2026-09-29 10:05:00',
          80: 'Município Beta &gt; Saúde',
          90001: ['Devolvido'],
        },
      ],
    });
  };
  const api = createClient({ ...CFG, fetchImpl });
  const rows = await api.searchTickets({ criteria: [{ field: FIELD.ID, value: 159919 }], extraField: 90001 });
  assert.deepEqual(rows, [
    { id: 159919, title: 'Erro & falha', dateMod: '2026-09-29 10:05:00', entity: 'Município Beta > Saúde', extra: 'Devolvido' },
  ]);
  assert.match(url, /forcedisplay\[4\]=90001/);
});

test('search sem resultados devolve lista vazia', async () => {
  const fetchImpl = async (u) =>
    u.endsWith('/initSession') ? res(200, { session_token: 'S' }) : res(200, { totalcount: 0, count: 0 });
  const rows = await createClient({ ...CFG, fetchImpl }).searchTickets({ criteria: [{ field: 2, value: 1 }] });
  assert.deepEqual(rows, []);
});

test('followups: 404 vira lista vazia; solutions tolera 403', async () => {
  const fetchImpl = async (u) => {
    if (u.endsWith('/initSession')) return res(200, { session_token: 'S' });
    if (u.includes('ITILFollowup')) return res(404, ['ERROR_ITEM_NOT_FOUND', 'não achou']);
    return res(403, ['ERROR_RIGHT_MISSING', 'sem direito']);
  };
  const api = createClient({ ...CFG, fetchImpl });
  assert.deepEqual(await api.followups(1), []);
  assert.deepEqual(await api.solutions(1), []);
});

test('cliente recusa URL sem https e não envia nenhuma requisição', () => {
  let sent = 0;
  const fetchImpl = async () => {
    sent += 1;
    return res(200, {});
  };
  for (const baseUrl of ['http://glpi.test', 'http://localhost:8080', 'glpi.test', '']) {
    assert.throws(
      () => createClient({ ...CFG, baseUrl, fetchImpl }),
      (e) => e instanceof GlpiError && e.code === 'INSECURE_URL' && /https/.test(e.message),
    );
  }
  assert.equal(sent, 0);
});

test('o cliente só usa GET (nunca escreve no GLPI)', async () => {
  const methods = new Set();
  const fetchImpl = async (url, init) => {
    methods.add(init.method);
    if (url.endsWith('/initSession')) return res(200, { session_token: 'S' });
    if (url.includes('getFullSession')) return res(200, { session: { glpiID: 7 } });
    return res(200, []);
  };
  const api = createClient({ ...CFG, fetchImpl });
  await api.me();
  await api.ticket(1).catch(() => {});
  await api.followups(1);
  await api.solutions(1);
  await api.searchTickets({ criteria: [{ field: 2, value: 1 }] });
  assert.deepEqual([...methods], ['GET']);
});

test('redirecionamento nunca é seguido: erro claro e nenhuma segunda requisição', async () => {
  for (const redirect of [
    { ok: false, status: 302, type: 'basic' }, // Node e outros ambientes
    { ok: false, status: 0, type: 'opaqueredirect' }, // navegador com redirect: 'manual'
  ]) {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push({ url, redirect: init.redirect });
      return { ...redirect, text: async () => '' };
    };
    await assert.rejects(createClient({ ...CFG, fetchImpl }).me(), (e) => {
      assert.ok(e instanceof GlpiError);
      assert.equal(e.code, 'REDIRECT');
      assert.match(e.message, /redirecionou/);
      return true;
    });
    assert.equal(seen.length, 1); // não tentou de novo nem foi atrás do destino
    assert.equal(seen[0].redirect, 'manual'); // é isso que impede o fetch de repassar os tokens
  }
});

test('redirecionamento no meio do uso (depois do login) também vira erro de URL', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/initSession')) return res(200, { session_token: 'S' });
    return { ok: false, status: 301, type: 'basic', text: async () => '' };
  };
  await assert.rejects(createClient({ ...CFG, fetchImpl }).ticket(1), (e) => e.code === 'REDIRECT');
});

test('o limite de tempo vale também para a leitura do corpo da resposta', async () => {
  // cabeçalhos chegam, mas o corpo nunca termina: só termina quando o AbortSignal dispara
  const fetchImpl = async (_url, init) => ({
    ok: true,
    status: 200,
    type: 'basic',
    text: () => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('abortado')));
    }),
  });
  // sem o limite cobrindo o corpo, a chamada nunca termina: a corrida transforma o travamento em falha clara
  let guard;
  const outcome = await Promise.race([
    createClient({ ...CFG, fetchImpl, timeoutMs: 40 }).me().then(() => 'resolveu', (e) => e.code),
    new Promise((resolve) => { guard = setTimeout(() => resolve('PENDURADO: o limite não cobriu o corpo'), 1000); }),
  ]);
  clearTimeout(guard);
  assert.equal(outcome, 'NETWORK');
});
