// GLPI simulado (HTTPS local) para o teste ponta a ponta. Responde ao subconjunto da API REST legada
// que a extensão usa: initSession, getFullSession, getGlpiConfig, search/Ticket, Ticket/:id,
// Ticket/:id/ITILFollowup, Ticket/:id/ITILSolution e User/:id. Só para testes: dados fictícios.
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const TOKENS = { app: 'APP-TOKEN-DEMO', user: 'USER-TOKEN-DEMO' };
const SESSION = 'SESSION-DEMO-1';

const pad = (n) => String(n).padStart(2, '0');
export const fmt = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

export function makeWorld() {
  const world = {
    me: { id: 7, name: 'Igor Carvalho', login: 'igor' },
    users: {
      20: { firstname: 'Analista', realname: 'A' },
      21: { firstname: 'Analista', realname: 'B' },
      22: { firstname: 'Ana Paula', realname: 'Ribeiro' },
    },
    tickets: {},
    followups: {},
    solutions: {},
    entities: {},
    extra: {},
    roles: { assigned: [], observer: [], requester: [] },
    requests: [], // caminhos chamados pela extensão (para conferir no teste)
    urls: [], // URLs completas (com a query), para provar que nada de tag vai ao GLPI
    methods: new Set(), // métodos HTTP vistos (a extensão só deve ler)
    loginOk: 0,
    loginBad: 0,
    clock: Date.now() - 20 * 60_000, // relógio do GLPI simulado: cada alteração avança 1 min
    nextFollowup: 100,
    failTickets: new Set(), // ids que respondem HTTP 500 em Ticket/:id (ticket com defeito no GLPI)
    redirectTo: null, // se definido, toda chamada da API responde 302 para esse endereço
  };

  world.touch = (id) => {
    world.clock += 60_000;
    world.tickets[id].date_mod = fmt(world.clock);
  };
  world.reply = (id, uid, html) => {
    world.touch(id);
    world.followups[id].push({ id: world.nextFollowup++, users_id: uid, content: html, date_creation: fmt(world.clock), is_private: 0 });
  };
  world.addTicket = (id, name, o = {}) => {
    world.tickets[id] = {
      id, name, content: '', status: 2, priority: 3,
      date: fmt(Date.now() - 3 * 3_600_000), date_mod: fmt(Date.now() - 25 * 60_000), time_to_resolve: null, ...o,
    };
    world.followups[id] ??= [];
    world.solutions[id] ??= [];
  };
  return world;
}

// Cenário base: 3 tickets, cada um chegando por um caminho diferente.
export function demoWorld() {
  const w = makeWorld();
  const t0 = Date.now();
  w.addTicket(159919, 'Relatório mensal não gera no processamento (fila parada há horas)', {
    priority: 4,
    content: '&lt;p&gt;O relatório mensals de Município Beta não gera desde ontem à noite.&lt;/p&gt;&lt;p&gt;A fila do processamento está parada.&lt;/p&gt;',
    time_to_resolve: fmt(t0 + 5 * 3_600_000),
  });
  w.addTicket(159885, 'Bloqueio de agenda não libera fila do processamento', { priority: 5 });
  w.addTicket(159321, 'Atualização cadastral não persiste', { status: 4 });
  w.entities = { 159919: 'Município Beta', 159885: 'Município Gama�', 159321: 'Município Alfa', 159930: 'Município Alfa' };
  w.extra = { 159919: 'Em análise', 159885: 'Em análise', 159321: '' };
  w.roles = { assigned: [159919], observer: [159885], requester: [] }; // 159321 só entra se for acompanhado à mão
  w.followups[159919] = [
    { id: 10, users_id: 21, content: '&lt;p&gt;Recebi o chamado e vou analisar os logs.&lt;/p&gt;', date_creation: fmt(t0 - 2 * 3_600_000), is_private: 0 },
  ];
  return w;
}

function selfSignedCert() {
  const dir = mkdtempSync(join(tmpdir(), 'fake-glpi-'));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/k.pem`, '-out', `${dir}/c.pem`,
    '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { stdio: 'ignore' });
  const pair = { key: readFileSync(`${dir}/k.pem`), cert: readFileSync(`${dir}/c.pem`) };
  rmSync(dir, { recursive: true, force: true });
  return pair;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'App-Token, Session-Token, Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Private-Network': 'true',
};
const STATUS_LABEL = { 1: 'Novo', 2: 'Em atendimento', 3: 'Planejado', 4: 'Pendente', 5: 'Resolvido', 6: 'Fechado' };
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export async function startFakeGlpi(world = demoWorld()) {
  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify(body));
  };
  const rowFor = (id) => {
    const t = world.tickets[id];
    return { 1: t.name, 2: id, 19: t.date_mod, 80: world.entities[id] ?? '', 90001: world.extra[id] ?? '' };
  };

  const server = https.createServer(selfSignedCert(), (req, res) => {
    const url = new URL(req.url, 'https://127.0.0.1');
    world.methods.add(req.method);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    // página do ticket (destino do botão "Abrir no GLPI")
    if (url.pathname === '/front/ticket.form.php') {
      const t = world.tickets[Number(url.searchParams.get('id'))];
      res.writeHead(t ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(!t ? 'Ticket não encontrado' : `<!doctype html><meta charset="utf-8"><title>GLPI (simulado) — Ticket #${t.id}</title>
        <body style="font:15px system-ui;margin:0;background:#eef1f5;color:#1b2230">
        <div style="background:#1c3b6b;color:#fff;padding:14px 24px;font-weight:600">GLPI (simulado para o teste) · Central de serviços</div>
        <div style="max-width:760px;margin:24px auto;padding:20px 24px;background:#fff;border-radius:10px">
        <div style="color:#667085">Ticket #${t.id} · ${escapeHtml(STATUS_LABEL[t.status])} · ${escapeHtml(world.entities[t.id] ?? '')}</div>
        <h1 style="margin:6px 0 16px;font-size:22px">${escapeHtml(t.name)}</h1>
        ${world.followups[t.id].map((f) => `<div style="border-top:1px solid #e4e7ec;padding:10px 0"><b>${escapeHtml(world.users[f.users_id]?.firstname ?? 'Usuário')}</b>
          <span style="color:#667085">· ${escapeHtml(f.date_creation)}</span><div>${f.content.replace(/&lt;/g, '<').replace(/&gt;/g, '>')}</div></div>`).join('')}
        </div></body>`);
      return;
    }

    if (!url.pathname.startsWith('/apirest.php/')) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const path = decodeURIComponent(url.pathname.slice('/apirest.php/'.length));
    world.requests.push(path);
    world.urls.push(req.url);

    if (world.redirectTo && path !== 'SEGUIU-O-REDIRECT') {
      res.writeHead(302, { Location: world.redirectTo, ...CORS });
      res.end();
      return;
    }
    if (req.headers['app-token'] !== TOKENS.app) return json(res, 400, ['ERROR_WRONG_APP_TOKEN_PARAMETER', 'parâmetro app_token incorreto']);
    if (path === 'initSession') {
      if (req.headers.authorization === `user_token ${TOKENS.user}`) {
        world.loginOk += 1;
        return json(res, 200, { session_token: SESSION });
      }
      world.loginBad += 1;
      return json(res, 401, ['ERROR_GLPI_LOGIN', 'Erro no login']);
    }
    if (req.headers['session-token'] !== SESSION) return json(res, 401, ['ERROR_SESSION_TOKEN_INVALID', 'session_token incorreto']);

    if (path === 'getFullSession') {
      return json(res, 200, { session: { glpiID: world.me.id, glpifriendlyname: world.me.name, glpiname: world.me.login } });
    }
    if (path === 'getGlpiConfig') return json(res, 200, { cfg_glpi: { version: '10.0.18' } });

    if (path === 'search/Ticket') {
      const p = url.searchParams;
      const crit = [];
      for (let i = 0; p.has(`criteria[${i}][field]`); i += 1) {
        crit.push({ field: p.get(`criteria[${i}][field]`), value: p.get(`criteria[${i}][value]`) });
      }
      let ids;
      if (crit[0]?.field === '2') {
        ids = crit.filter((c) => c.field === '2').map((c) => Number(c.value));
      } else {
        const role = { 5: 'assigned', 66: 'observer', 4: 'requester' }[crit[0]?.field];
        ids = Number(crit[0]?.value) === world.me.id ? (world.roles[role] ?? []) : [];
        if (crit.some((c) => c.field === '12' && c.value === 'notold')) ids = ids.filter((id) => world.tickets[id]?.status < 5);
      }
      const rows = ids.filter((id) => world.tickets[id]).map(rowFor);
      return json(res, 200, rows.length ? { totalcount: rows.length, count: rows.length, data: rows } : { totalcount: 0, count: 0 });
    }

    let m;
    if ((m = path.match(/^Ticket\/(\d+)$/))) {
      if (world.failTickets.has(Number(m[1]))) return json(res, 500, ['ERROR_INTERNAL', 'Erro interno do servidor']);
      const t = world.tickets[Number(m[1])];
      return t ? json(res, 200, t) : json(res, 404, ['ERROR_ITEM_NOT_FOUND', 'Élément introuvable']);
    }
    if ((m = path.match(/^Ticket\/(\d+)\/(ITILFollowup|ITILSolution)$/))) {
      const id = Number(m[1]);
      if (!world.tickets[id]) return json(res, 404, ['ERROR_ITEM_NOT_FOUND', 'Élément introuvable']);
      const list = m[2] === 'ITILFollowup' ? world.followups[id] : world.solutions[id];
      return json(res, 200, [...list].sort((a, b) => b.id - a.id));
    }
    if ((m = path.match(/^User\/(\d+)$/))) {
      const u = world.users[Number(m[1])];
      return u ? json(res, 200, u) : json(res, 404, ['ERROR_ITEM_NOT_FOUND', 'Élément introuvable']);
    }
    return json(res, 404, ['ERROR_ITEM_NOT_FOUND', `rota não simulada: ${path}`]);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { world, port, url: `https://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
