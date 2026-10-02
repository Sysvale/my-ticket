// Teste ponta a ponta VISUAL: a extensão de verdade, num Chromium, falando com um GLPI simulado.
// Gera docs/e2e/index.html (ou E2E_OUT) com uma captura por passo, o elemento clicado destacado em
// vermelho e as verificações feitas. Sai com código 1 se alguma verificação falhar.
//
//   npm run e2e
//
// Requer Node >= 22 (WebSocket global), openssl e um Chromium (o do Playwright em ~/.cache/ms-playwright,
// ou CHROME_BIN). Variáveis: E2E_OUT (pasta do relatório), E2E_COPY_TO (copia o index.html para outra pasta).
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeGlpi, TOKENS } from './fake-glpi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = process.env.E2E_OUT ?? join(ROOT, 'docs/e2e');
const EXT_SRC = process.env.E2E_EXT_SRC ?? join(ROOT, 'extension'); // permite testar outra cópia da extensão
const PORT = Number(process.env.E2E_PORT ?? 9350);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const base = join(homedir(), '.cache/ms-playwright');
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) for (const sub of ['chrome-linux64', 'chrome-linux']) {
    const p = join(base, d, sub, 'chrome');
    if (existsSync(p)) return p;
  }
  throw new Error('Chromium não encontrado: defina CHROME_BIN ou rode "npx playwright install chromium".');
}

// ---------- CDP mínimo (sem dependências) ----------
const json = async (path) => (await fetch(`http://127.0.0.1:${PORT}${path}`)).json();

async function until(fn, label, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* ainda subindo */ }
    if (Date.now() - t0 > ms) throw new Error(`timeout esperando: ${label}`);
    await sleep(150);
  }
}

async function attach(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else events.push(m);
  });
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const s = {
    send, events, close: () => ws.close(),
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception ?? r.result.exceptionDetails).slice(0, 400));
      return r.result?.result?.value;
    },
    waitFor: (expr, label, ms) => until(() => s.eval(expr), label, ms),
    async viewport(width, height) { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); },
    // O popup real tem a altura do conteúdo (até 600px): corta o espaço vazio da janela de teste.
    async png() {
      const fit = await s.eval("document.body.classList.contains('popup') ? Math.ceil(document.body.getBoundingClientRect().height) : 0");
      const params = { format: 'png' };
      if (fit) params.clip = { x: 0, y: 0, width: await s.eval('window.innerWidth'), height: fit, scale: 1 };
      return (await send('Page.captureScreenshot', params)).result.data;
    },
    async click(expr) { await s.eval(`(() => { const el = ${expr}; if (!el) throw new Error('elemento não encontrado'); el.click(); return true; })()`); },
    async type(selector, value) {
      await s.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    },
    async select(selector, value) {
      await s.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    },
    text: (selector) => s.eval(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? ''`),
  };
  return s;
}

const HL = (expr) => `(() => { const el = ${expr}; if (!el) return false; el.dataset.e2ePrev = el.style.outline || 'none'; el.style.outline = '3px solid #ff3b30'; el.style.outlineOffset = '2px'; el.scrollIntoView({ block: 'nearest' }); return true; })()`;
const UNHL = "(() => { document.querySelectorAll('[data-e2e-prev]').forEach((el) => { el.style.outline = el.dataset.e2ePrev === 'none' ? '' : el.dataset.e2ePrev; delete el.dataset.e2ePrev; }); return true; })()";
const STRAY = /\b(null|undefined|NaN)\b/g;
// o card abre pelo botão interno (o título), não pelo <article>
const cardButton = (id) => `${byText('.card', id)}?.querySelector('.card-open')`;
const byText = (selector, needle) => `[...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.includes(${JSON.stringify(needle)}))`;

// ---------- relatório ----------
const steps = [];
function newStep(title, text) {
  const step = { title, text, shots: [], checks: [], extra: '' };
  steps.push(step);
  return {
    step,
    // captura o que está na tela; `highlight` (expressão JS que devolve um elemento) ganha contorno vermelho
    async shot(session, caption, highlight) {
      if (highlight) await session.eval(HL(highlight));
      const data = await session.png();
      if (highlight) await session.eval(UNHL);
      step.shots.push({ caption, data });
    },
    check(label, ok, detail = '') { step.checks.push({ label, ok: Boolean(ok), detail: String(detail) }); return Boolean(ok); },
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function toastHtml(list) {
  return `<div class="toasts">${list.map(({ opts }) => `<div class="toast"><div class="app">MyTicket · agora</div>
    <div class="t">${esc(opts.title)}</div><div class="m">${esc(opts.message)}</div>${opts.contextMessage ? `<div class="c">${esc(opts.contextMessage)}</div>` : ''}
    ${opts.buttons ? `<div class="btns">${opts.buttons.map((b) => `<span>${esc(b.title)}</span>`).join('')}</div>` : ''}</div>`).join('')}</div>`;
}

function renderReport(meta) {
  const all = steps.flatMap((s) => s.checks);
  const failed = all.filter((c) => !c.ok);
  const body = steps.map((s, i) => `
    <section class="step">
      <h2><span class="n">${i + 1}</span> ${esc(s.title)}</h2>
      <p class="text">${esc(s.text)}</p>
      <div class="shots">${s.shots.map((sh) => `<figure><img alt="" src="data:image/png;base64,${sh.data}"><figcaption>${esc(sh.caption)}</figcaption></figure>`).join('')}</div>
      ${s.extra}
      <ul class="checks">${s.checks.map((c) => `<li class="${c.ok ? 'ok' : 'bad'}"><span class="ico">${c.ok ? '✓' : '✕'}</span><span><b>${esc(c.label)}</b>${c.detail ? `<small>${esc(c.detail)}</small>` : ''}</span></li>`).join('')}</ul>
    </section>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MyTicket — teste visual ponta a ponta</title>
<style>
:root{color-scheme:light dark;--bg:#f3f4f7;--card:#fff;--text:#1b2230;--muted:#667085;--border:#e2e5eb;--ok:#17805a;--bad:#c02d2d;--accent:#2f6fed}
@media(prefers-color-scheme:dark){:root{--bg:#12151b;--card:#1a1e26;--text:#e7eaf0;--muted:#98a2b3;--border:#2a303b;--ok:#4cc38a;--bad:#ff7a7a;--accent:#7ba4ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1080px;margin:0 auto;padding:28px 18px 56px}h1{margin:0 0 4px;font-size:24px}.lead{color:var(--muted);margin:0 0 16px}
.sum{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 6px}.pill{padding:5px 12px;border-radius:999px;font-weight:600;border:1px solid var(--border);background:var(--card)}
.pill.ok{color:var(--ok)}.pill.bad{color:var(--bad)}.meta{color:var(--muted);font-size:12.5px;margin:6px 0 4px}
.legend{display:inline-block;margin:8px 0 18px;padding:4px 10px;border-radius:8px;border:1px dashed #ff3b30;color:var(--muted);font-size:12.5px}
.step{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px;margin-bottom:16px}
.step h2{margin:0 0 4px;font-size:17px;display:flex;align-items:center;gap:10px}.n{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--accent);color:#fff;font-size:13px}
.text{margin:0 0 12px;color:var(--muted)}.shots{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:12px}
figure{margin:0}figure img{display:block;max-width:100%;border:1px solid var(--border);border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.12)}
figcaption{margin-top:6px;color:var(--muted);font-size:12.5px;max-width:420px}
.checks{list-style:none;margin:0;padding:0;display:grid;gap:6px}.checks li{display:grid;grid-template-columns:22px 1fr;gap:8px;align-items:start}
.checks small{display:block;color:var(--muted);font-weight:400;overflow-wrap:anywhere}.ico{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;color:#fff;font-size:12px;font-weight:700}
.ok .ico{background:var(--ok)}.bad .ico{background:var(--bad)}
.toasts{display:flex;flex-wrap:wrap;gap:12px;padding:14px;border-radius:12px;background:linear-gradient(135deg,#3b5bdb,#7048e8 55%,#c2255c 120%);margin:0 0 12px}
.toast{width:340px;padding:10px 13px;border-radius:10px;background:#2b2b2e;color:#f2f2f7;font:13px/1.35 "Segoe UI",system-ui,sans-serif}
.toast .app{color:#a4a4ab;font-size:11px;margin-bottom:6px}.toast .t{font-weight:600}.toast .m{color:#e6e6ea}.toast .c{color:#8f8f97;font-size:11px;margin-top:2px}
.toast .btns{display:flex;gap:6px;margin-top:9px}.toast .btns span{flex:1;text-align:center;background:#3b3b3f;border-radius:6px;padding:5px;font-size:12px}
.note{color:var(--muted);font-size:12.5px;margin:4px 0 0}
</style></head><body><main>
<h1>MyTicket · teste visual ponta a ponta</h1>
<p class="lead">A extensão de verdade, carregada num Chromium, conversando com um GLPI simulado (dados fictícios). Cada passo mostra o que apareceu na tela e o que foi verificado.</p>
<div class="sum"><span class="pill ${failed.length ? 'bad' : 'ok'}">${failed.length ? '✕ Há falhas' : '✓ Tudo passou'}</span><span class="pill">${all.length} verificações</span><span class="pill ok">${all.length - failed.length} ok</span><span class="pill ${failed.length ? 'bad' : ''}">${failed.length} falha(s)</span></div>
<div class="meta">${esc(meta.browser)} · MyTicket v${esc(meta.version)} · gerado em ${esc(meta.when)} · ${esc(meta.seconds)} s</div>
<div class="legend">Contorno vermelho = elemento em que o teste clicou ou que está sendo verificado</div>
${body}
<p class="note">Reexecute com <code>npm run e2e</code>. O aviso do Windows é desenhado pelo sistema e não aparece nas capturas; os quadros escuros acima mostram exatamente os textos que o Chrome recebeu.</p>
</main></body></html>`;
}

// ---------- execução ----------
const t0 = Date.now();
const work = mkdtempSync(join(tmpdir(), 'myticket-e2e-'));
let proc;
let glpi;
const report = {};

try {
  glpi = await startFakeGlpi();
  const { world } = glpi;

  // cópia da extensão com a permissão de acesso ao host simulado (o usuário concede isso na primeira vez)
  const extDir = join(work, 'extension');
  cpSync(EXT_SRC, extDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['https://127.0.0.1/*'];
  writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  proc = spawn(findChrome(), [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--mute-audio',
    '--ignore-certificate-errors', '--allow-insecure-localhost',
    `--user-data-dir=${join(work, 'profile')}`, `--load-extension=${extDir}`,
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    `--remote-debugging-port=${PORT}`, 'about:blank',
  ], { stdio: 'ignore' });

  const version = await until(async () => (await json('/json/version')).Browser, 'Chromium no ar', 20000);
  const found = await until(async () => {
    for (const t of (await json('/json')).filter((x) => x.type === 'service_worker')) {
      const c = await attach(t.webSocketDebuggerUrl);
      try { if ((await c.eval('chrome.runtime.getManifest().name')) === 'MyTicket') return { t, c }; } catch { /* outra extensão */ }
      c.close();
    }
    return null;
  }, 'service worker do MyTicket', 20000);
  const extId = new URL(found.t.url).host;
  const sw = found.c;
  await sw.send('Runtime.enable');
  const browser = await attach((await json('/json/version')).webSocketDebuggerUrl);

  // registra o que o Chrome recebe em chrome.notifications.create
  await sw.eval(`(() => { globalThis.__created = []; const n = chrome.notifications; const orig = n.create.bind(n); n.create = (...a) => { globalThis.__created.push({ id: a[0], opts: a[1] }); return orig(...a); }; return true; })()`);
  const created = async () => JSON.parse(await sw.eval('JSON.stringify(globalThis.__created)'));

  const openPage = async (url, w, h) => {
    const { result } = await browser.send('Target.createTarget', { url });
    const id = result.targetId;
    const target = await until(async () => (await json('/json')).find((t) => t.id === id), `abrir ${url}`);
    const s = await attach(target.webSocketDebuggerUrl);
    await s.send('Runtime.enable');
    await s.send('Page.enable');
    await s.viewport(w, h);
    await s.waitFor("document.readyState === 'complete'", `carregar ${url}`); // sem isto um eval cedo demais cai em about:blank
    return s;
  };

  // configuração como se a pessoa tivesse preenchido as Opções
  await sw.eval(`chrome.storage.local.set({
    config: { baseUrl: ${JSON.stringify(glpi.url)}, appToken: ${JSON.stringify(TOKENS.app)}, userToken: ${JSON.stringify(TOKENS.user)},
              sound: { enabled: true, name: 'chime', volume: 0.6 }, attention: { flash: true, sticky: false } },
    user: { watched: { 159321: { addedAt: Date.now() } }, readAt: {} },
  })`);
  await sleep(700);
  await sw.eval("chrome.alarms.clear('poll')"); // as verificações deste teste são disparadas por cliques, não pelo alarme

  const popup = await openPage(`chrome-extension://${extId}/popup.html`, 420, 600);
  await popup.waitFor("document.querySelector('#list .empty') !== null", 'popup carregado');

  // ---- 1. antes de tudo
  {
    const S = newStep('Extensão configurada, antes da primeira verificação',
      'O popup recém-aberto, com a URL do GLPI e os tokens já salvos (como depois de preencher as Opções). Ainda não buscou nenhum ticket.');
    await S.shot(popup, 'Popup: “Buscando seus tickets…”', "document.querySelector('#list .empty')");
    const m = await sw.eval('(() => { const m = chrome.runtime.getManifest(); return { name: m.name, version: m.version }; })()');
    S.check('Extensão MyTicket carregada no Chromium', m.name === 'MyTicket', `versão ${m.version}`);
    S.check('Notificações permitidas para a extensão', (await sw.eval('chrome.notifications.getPermissionLevel()')) === 'granted');
    S.check('Nenhuma notificação antes de buscar', (await created()).length === 0);
    report.version = m.version;
    report.browser = version;
  }

  // ---- 2. primeira verificação (baseline)
  {
    const S = newStep('Primeira verificação: lista os tickets sem avisar o histórico',
      'Clique em “Atualizar agora”. A extensão faz login no GLPI, busca os tickets em que você é atribuído/observador/requerente (mais o que você acompanha à mão) e guarda o estado atual. Como é a primeira vez, não avisa nada.');
    await popup.click("document.getElementById('refresh')");
    await popup.waitFor("!document.getElementById('refresh').disabled && document.querySelectorAll('.card').length === 3", 'lista com 3 tickets');
    await S.shot(popup, 'Depois de “Atualizar agora”: 3 tickets, nenhum com novidade', "document.getElementById('refresh')");
    const ids = (await popup.eval("[...document.querySelectorAll('.card .id')].map((e) => e.textContent)")).sort();
    S.check('3 tickets na lista', ids.length === 3, ids.join(', '));
    S.check('Chegaram por caminhos diferentes', ids.join() === '#159321,#159885,#159919', '#159919 atribuído · #159885 observador · #159321 acompanhado à mão');
    S.check('Nenhum ticket marcado como novidade', (await popup.eval("document.querySelectorAll('.card.unread').length")) === 0);
    S.check('Nenhuma notificação na primeira verificação', (await created()).length === 0);
    S.check('Login no GLPI com o token certo', world.loginOk >= 1 && world.loginBad === 0, `${world.loginOk} login(s) ok, ${world.loginBad} recusado(s)`);
    S.check('Buscas por papel e por ID feitas', world.requests.filter((p) => p === 'search/Ticket').length >= 4, `${world.requests.filter((p) => p === 'search/Ticket').length} buscas`);
    const st = await sw.eval("chrome.storage.local.get('state').then((r) => ({ ok: r.state.lastRun.ok, count: r.state.lastRun.count }))");
    S.check('Verificação registrada como bem-sucedida', st.ok === true && st.count === 3, `${st.count} ticket(s)`);
  }

  // ---- 3. chegam novidades
  {
    const S = newStep('Chegam novidades: respostas, mudança de Status extra e ticket novo',
      'No GLPI simulado: Analista responde no #159919, o Status extra do #159885 vira “Devolvido” (sem resposta nova) e um ticket novo, #159930, é atribuído a você. Clique em “Atualizar agora” de novo.');
    world.reply(159919, 20, '&lt;p&gt;Segue o log do erro e o print da tela de relatórios. O problema começou depois da atualização de ontem à noite.&lt;/p&gt;');
    world.extra[159885] = 'Devolvido';
    world.addTicket(159930, 'Duplicidade de cadastro individual por CNS', { status: 1 });
    world.roles.assigned.push(159930);
    await popup.click("document.getElementById('refresh')");
    await popup.waitFor("!document.getElementById('refresh').disabled && document.querySelectorAll('.card.unread').length === 3", '3 tickets com novidade');
    await S.shot(popup, 'Popup: seção “Novidades (3)” com os tickets destacados', "document.querySelector('#list details')");
    const list = await created();
    const byId = Object.fromEntries(list.map((c) => [c.id.split(':')[1], c.opts]));
    S.check('3 notificações criadas no Chrome (uma por ticket)', list.length === 3, list.map((c) => c.id.split(':').slice(0, 2).join(':')).join(', '));
    S.check('Resposta de Analista no #159919', byId[159919]?.message?.startsWith('Analista A: Segue o log do erro'), byId[159919]?.message);
    S.check('Mudança de Status extra no #159885', byId[159885]?.message === 'Status extra: Em análise → Devolvido', byId[159885]?.message);
    S.check('Ticket novo no radar (#159930)', byId[159930]?.message === 'Novo no seu radar: atribuído a você', byId[159930]?.message);
    S.check('Título traz o número e o título do ticket', byId[159919]?.title === '#159919 Relatório mensal não gera no processamento (fila parada há horas)', byId[159919]?.title);
    S.check('Entidade como contexto', byId[159919]?.contextMessage === 'Município Beta', byId[159919]?.contextMessage);
    S.check('Botões “Abrir” e “Marcar como lido”', JSON.stringify(byId[159919]?.buttons?.map((b) => b.title)) === '["Abrir","Marcar como lido"]');
    S.check('Som padrão do Windows silenciado (o da extensão toca)', list.every((c) => c.opts.silent === true));
    S.check('Contador no ícone da extensão', (await sw.eval('chrome.action.getBadgeText({})')) === '3', 'badge = 3');
    S.check('Página de som (offscreen) criada', (await sw.eval("chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length)")) === 1);
    S.extra = `<p class="note">O que o Chrome recebeu para exibir (o Windows desenha o banner):</p>${toastHtml(list)}`;
  }

  // ---- 4. busca e filtros
  {
    const S = newStep('Busca e filtros do popup',
      'Digitar “mensal” na busca e escolher a entidade “Município Gama�” no painel de filtros. Os filtros combinam com “E” e mostram “Mostrando X de Y”.');
    await popup.type('#q', 'mensal');
    await popup.waitFor("document.querySelectorAll('.card').length === 1", 'busca filtrando');
    await S.shot(popup, 'Busca por “mensal”: só o #159919', "document.getElementById('q')");
    S.check('Busca por texto acha só o ticket certo', (await popup.eval("[...document.querySelectorAll('.card .id')].map((e) => e.textContent).join()")) === '#159919');
    S.check('Resumo “Mostrando 1 de 4”', (await popup.text('#summary-text')) === 'Mostrando 1 de 4', await popup.text('#summary-text'));
    await popup.click("document.getElementById('f-clear')");
    await popup.click("document.getElementById('filters-toggle')");
    await popup.select('#f-entity', 'Município Gama�');
    await popup.waitFor("document.querySelectorAll('.card').length === 1", 'filtro por entidade');
    await S.shot(popup, 'Painel de filtros aberto, entidade = Município Gama�: só o #159885', "document.getElementById('f-entity')");
    S.check('Filtro por entidade', (await popup.eval("[...document.querySelectorAll('.card .id')].map((e) => e.textContent).join()")) === '#159885');
    S.check('Contador de filtros no botão', (await popup.text('#filters-count')) === '1');
    // o popup fecha ao menor clique fora: o filtro escolhido precisa ser gravado na hora, sem esperar o atraso de 200 ms
    const flushed = await popup.eval(`(async () => {
      const el = document.getElementById('f-entity');
      el.value = 'Município Alfa';
      el.dispatchEvent(new Event('change', { bubbles: true }));
      window.dispatchEvent(new Event('pagehide'));
      const { ui } = await chrome.storage.local.get('ui');
      return ui?.filters?.entity;
    })()`);
    S.check('Filtro escolhido é gravado na hora quando o popup fecha (pagehide)', flushed === 'Município Alfa', `gravado: ${flushed}`);
    await popup.click("document.getElementById('f-clear')");
    await popup.click("document.getElementById('filters-toggle')");
    await popup.waitFor("document.querySelectorAll('.card').length === 4", 'filtros limpos');
    S.check('Limpar filtros volta aos 4 tickets', (await popup.eval("document.querySelectorAll('.card').length")) === 4);
    // acessibilidade do card: um botão de verdade (o título), sem role=button com botões dentro
    S.check('Card sem role=button aninhado; cada card tem o seu botão',
      await popup.eval("document.querySelectorAll('.card[role], .card [role=button], .card[tabindex]').length === 0 && document.querySelectorAll('.card button.card-open').length === document.querySelectorAll('.card').length"));
    const hit = await popup.eval(`(() => {
      const card = document.querySelector('.card.unread');
      card.scrollIntoView({ block: 'center' });
      const at = (el) => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); };
      const action = card.querySelector('.actions button');
      return { chips: at(card.querySelector('.meta'))?.classList.contains('card-open'), action: !action || at(action) === action };
    })()`);
    S.check('Clicar em qualquer ponto do card (ex.: na linha de dados do GLPI) atinge o botão do card', hit.chips === true);
    // hierarquia: sem tags, o card não tem chip nenhum; status, prioridade, Extra, entidade e papel são texto discreto
    const hier = await popup.eval(`(() => {
      const card = document.querySelector('.card.unread');
      return { chips: card.querySelectorAll('.chip').length, hasRow: card.querySelector('.chips') !== null, meta: card.querySelector('.meta')?.textContent ?? '' };
    })()`);
    S.check('Card sem tags não tem chips coloridos nem linha de chips vazia', hier.chips === 0 && hier.hasRow === false, JSON.stringify(hier));
    S.check('Status, prioridade, Extra, entidade e papel ficam numa linha de texto discreto',
      ['Em atendimento', 'Alta', 'Extra: Em análise', 'Município Beta', 'atribuído'].every((x) => hier.meta.includes(x)), hier.meta);
    S.check('Botões de ação ficam acima da área clicável do card', hit.action === true);
  }

  // ---- 5. detalhes
  let glpiTab;
  {
    const S = newStep('Clicar no ticket abre os detalhes (não o GLPI)',
      'Clique no card do #159919. O popup troca para uma tela de detalhes com a conversa buscada ao vivo no GLPI e o botão “Abrir no GLPI ↗”.');
    await S.shot(popup, 'Antes: o card que será clicado', byText('.card', '#159919'));
    const tabsBefore = (await json('/json')).filter((t) => t.type === 'page').length;
    await popup.click(cardButton('#159919'));
    await popup.waitFor("!document.getElementById('detail').hidden && document.querySelectorAll('#detail .d-msg').length >= 2", 'conversa carregada');
    await S.shot(popup, 'Depois: detalhes do ticket e o botão que abre o GLPI', byText('#detail button', 'Abrir no GLPI'));
    await popup.eval("document.getElementById('detail').scrollTop = document.getElementById('detail').scrollHeight; true");
    await S.shot(popup, 'Rolando a tela: a conversa do ticket, buscada ao vivo no GLPI', byText('#detail .d-msg', 'Analista A'));
    await popup.eval("document.getElementById('detail').scrollTop = 0; true");
    const text = await popup.text('#detail');
    S.check('Clicar no card não abriu nenhuma aba', (await json('/json')).filter((t) => t.type === 'page').length === tabsBefore);
    S.check('Lista escondida, detalhes visíveis', await popup.eval("document.getElementById('list-view').hidden && !document.getElementById('detail').hidden"));
    S.check('Título completo do ticket', text.includes('Relatório mensal não gera no processamento (fila parada há horas)'));
    S.check('Botão “Abrir no GLPI ↗” presente', text.includes('Abrir no GLPI ↗'));
    S.check('Conversa ao vivo: resposta da Analista', text.includes('Analista A') && text.includes('Segue o log do erro'));
    S.check('Conversa ao vivo: resposta anterior do Analista', text.includes('Analista B') && text.includes('Recebi o chamado'));
    S.check('Informações: aberto em e solução até (SLA)', text.includes('Aberto em') && text.includes('Solução até'));
    S.check('Novidades detectadas marcadas como “novo”', text.includes('NOVIDADES DETECTADAS') && text.includes('novo'));
    S.check('Nenhum “null”/“undefined” perdido na tela', (text.match(STRAY) ?? []).length === 0, (text.match(STRAY) ?? []).join(','));
    S.check('Ao abrir os detalhes, o foco vai para “Voltar” (o teclado não se perde)', await popup.eval("document.activeElement?.classList.contains('back')"));
    S.check('Abrir os detalhes marcou o ticket como lido', (await sw.eval("chrome.action.getBadgeText({})")) === '2', 'badge caiu de 3 para 2');
  }

  // ---- 6. ticket sem novidades (regressão do "null")
  {
    const S = newStep('Ticket sem novidades detectadas (regressão do “null”)',
      'Voltar e abrir o #159321, que não tem nenhuma novidade detectada. Já apareceu um “null” solto nessa tela; agora a seção vazia simplesmente não aparece.');
    await popup.click(byText('#detail button', 'Voltar'));
    await popup.waitFor("!document.getElementById('list-view').hidden", 'voltou à lista');
    S.check('Ao voltar, o foco retorna ao card de onde saiu', (await popup.eval('document.activeElement?.dataset?.ticket')) === '159919');
    await popup.click(cardButton('#159321'));
    await popup.waitFor("!document.getElementById('detail').hidden && document.querySelector('#detail').innerText.includes('Ainda não há acompanhamentos')", 'detalhes do #159321');
    await S.shot(popup, 'Detalhes de um ticket sem novidades: sem seção vazia e sem “null”', "document.querySelector('#detail .d-info')");
    const text = await popup.text('#detail');
    S.check('Sem “null”/“undefined” na tela', (text.match(STRAY) ?? []).length === 0, (text.match(STRAY) ?? []).join(','));
    S.check('Seção “Novidades detectadas” omitida quando vazia', !text.includes('NOVIDADES DETECTADAS'));
    S.check('Papel exibido: acompanhado manualmente', text.includes('manual'));
    await popup.click(byText('#detail button', 'Voltar'));
    await popup.waitFor("!document.getElementById('list-view').hidden", 'voltou à lista');
    const listText = await popup.text('#list-view');
    S.check('Lista sem “null”/“undefined”', (listText.match(STRAY) ?? []).length === 0);
  }

  // ---- 7. abrir no GLPI
  {
    const S = newStep('“Abrir no GLPI ↗” leva ao ticket',
      'Dentro dos detalhes do #159919, clique no botão azul. A extensão abre (ou foca) a aba do ticket no GLPI.');
    await popup.click(cardButton('#159919'));
    await popup.waitFor("document.querySelectorAll('#detail .d-msg').length >= 2", 'detalhes do #159919');
    await S.shot(popup, 'O botão que será clicado', byText('#detail button', 'Abrir no GLPI'));
    await popup.click(byText('#detail button', 'Abrir no GLPI'));
    const target = await until(async () => (await json('/json')).find((t) => t.type === 'page' && t.url.includes('/front/ticket.form.php?id=159919')), 'aba do ticket', 10000);
    glpiTab = await attach(target.webSocketDebuggerUrl);
    await glpiTab.send('Runtime.enable');
    await glpiTab.viewport(900, 520);
    await glpiTab.waitFor("document.readyState === 'complete'", 'página do ticket');
    await S.shot(glpiTab, 'Nova aba: a página do ticket #159919 no GLPI (simulado)');
    S.check('Abriu a aba do ticket certo', target.url === `${glpi.url}/front/ticket.form.php?id=159919`, target.url);
    S.check('A página do ticket carregou', (await glpiTab.eval('document.title')).includes('Ticket #159919'), await glpiTab.eval('document.title'));
    glpiTab.close();
  }

  // ---- 8. privacidade
  {
    const S = newStep('Privacidade: “Ocultar conteúdo” ligado',
      'Com a opção ligada, nenhum texto de resposta, solução ou descrição chega à tela (nem é buscado para ela). Autor, data e tipo continuam.');
    await sw.eval("chrome.storage.local.get('config').then(({ config }) => chrome.storage.local.set({ config: { ...config, hideContent: true } }))");
    await sleep(500);
    await sw.eval("chrome.alarms.clear('poll')");
    await popup.click(byText('#detail button', 'Voltar'));
    await popup.waitFor("!document.getElementById('list-view').hidden", 'voltou à lista');
    await popup.click(cardButton('#159919'));
    await popup.waitFor("document.querySelectorAll('#detail .d-msg').length >= 2 && document.querySelector('#detail').innerText.includes('Conteúdo oculto')", 'detalhes ocultos');
    await S.shot(popup, 'Detalhes com conteúdo oculto: só autor, data e tipo', byText('#detail .muted', 'Conteúdo oculto'));
    const text = await popup.text('#detail');
    S.check('Aviso de conteúdo oculto exibido', text.includes('Conteúdo oculto'));
    S.check('Texto das respostas ausente da tela', !text.includes('Segue o log') && !text.includes('Recebi o chamado'));
    S.check('Descrição do ticket ausente da tela', !text.includes('relatório mensals'));
    S.check('Autores continuam visíveis', text.includes('Analista A') && text.includes('Analista B'));
    const stored = JSON.stringify(await sw.eval("chrome.storage.local.get('state')"));
    S.check('Texto da resposta apagado do cache local', !stored.includes('Segue o log do erro'));
    await sw.eval("chrome.storage.local.get('config').then(({ config }) => chrome.storage.local.set({ config: { ...config, hideContent: false } }))");
    await popup.click(byText('#detail button', 'Voltar'));
  }

  // ---- 9. guia
  {
    const S = newStep('Guia de notificações (verificação ao vivo)',
      'A página de ajuda da extensão confere o que precisa estar ligado para os avisos aparecerem.');
    const guide = await openPage(`chrome-extension://${extId}/guide.html`, 1040, 860);
    await guide.waitFor("document.querySelectorAll('#checks > li').length === 7 && document.querySelectorAll('#gallery article').length === 7", 'guia renderizado');
    await S.shot(guide, 'Guia: itens verificados neste navegador', "document.getElementById('checks')");
    const rows = await guide.eval("[...document.querySelectorAll('#checks > li')].map((li) => li.className.replace('check-row ', '') + '|' + li.querySelector('strong').textContent)");
    const lvl = (name) => rows.find((r) => r.endsWith(`|${name}`))?.split('|')[0];
    S.check('Notificações da extensão no Chrome: ok', lvl('Notificações da extensão no Chrome') === 'ok');
    S.check('Conexão com o GLPI: ok', lvl('Conexão com o GLPI') === 'ok');
    S.check('Acesso ao site do GLPI: ok', lvl('Acesso ao site do GLPI') === 'ok');
    S.check('Verificação dos tickets: ok', lvl('Verificação dos tickets') === 'ok');
    S.check('Windows: passos manuais listados', lvl('Windows') === 'manual');
    S.check('Seção “Só na Win + N?” presente', await guide.eval("document.getElementById('banner') !== null"));
    S.check('Sem texto perdido no guia', ((await guide.text('body')).match(STRAY) ?? []).length === 0);
    guide.close();
  }

  const optionsEvents = [];

  // ---- 9b. um ticket com erro no GLPI não derruba a verificação
  {
    const S = newStep('Um ticket com erro no GLPI não derruba a verificação',
      'O GLPI passa a responder HTTP 500 para o #159885 enquanto o #159919 recebe uma resposta nova. Só o ticket com defeito fica de fora: o outro ainda é avisado, e o popup, o ícone e o Guia mostram o que aconteceu.');
    const before = (await created()).length;
    world.failTickets.add(159885);
    world.touch(159885);
    world.reply(159919, 20, '&lt;p&gt;Consegui reproduzir aqui, segue o print atualizado.&lt;/p&gt;');
    await popup.click("document.getElementById('refresh')");
    await popup.waitFor("!document.getElementById('refresh').disabled && document.getElementById('status').innerText.includes('erro de leitura')", 'erro de leitura no rodapé');
    await S.shot(popup, 'Rodapé avisa o ticket com erro; o #159885 ganha o chip “erro ao ler”', byText('.card', '#159885'));
    const fresh = (await created()).slice(before);
    const run = await sw.eval("chrome.storage.local.get('state').then((r) => r.state.lastRun)");
    S.check('A verificação não falhou no todo', run.ok === true, JSON.stringify(run));
    S.check('Só o ticket com defeito ficou de fora', JSON.stringify(run.failed) === '[159885]', JSON.stringify(run.failed));
    S.check('O outro ticket ainda foi avisado', fresh.some((c) => c.opts.message?.startsWith('Analista A: Consegui reproduzir')), fresh.map((c) => c.opts.message).join(' | '));
    S.check('Rodapé lista o ticket e fica em tom de aviso', (await popup.text('#status')).includes('1 com erro de leitura (#159885)') && (await popup.eval("document.getElementById('status').className")) === 'warn');
    S.check('Card do ticket com erro tem o chip “erro ao ler”', await popup.eval(`${byText('.card', '#159885')}?.textContent.includes('erro ao ler')`));
    S.check('Os demais tickets continuam na lista', (await popup.eval("document.querySelectorAll('.card').length")) === 4);
    S.check('Título do ícone avisa do erro', (await sw.eval('chrome.action.getTitle({})')).includes('1 com erro de leitura'));
    const guide = await openPage(`chrome-extension://${extId}/guide.html`, 1040, 860);
    await guide.waitFor("document.querySelectorAll('#checks > li').length === 7", 'guia renderizado');
    S.check('Guia marca “Verificação dos tickets” como atenção', (await guide.eval("[...document.querySelectorAll('#checks > li')].find((li) => li.textContent.includes('Verificação dos tickets')).className")).includes('warn'));
    optionsEvents.push(...guide.events);
    guide.close();

    world.failTickets.clear();
    await popup.click("document.getElementById('refresh')");
    await popup.waitFor("!document.getElementById('refresh').disabled && !document.getElementById('status').innerText.includes('erro de leitura')", 'erro de leitura some');
    const after = await sw.eval("chrome.storage.local.get('state').then((r) => r.state.lastRun)");
    S.check('Quando o GLPI volta, o erro some sozinho', after.ok === true && after.failed.length === 0, JSON.stringify(after.failed));
    S.check('Chip “erro ao ler” some do card', !(await popup.eval(`${byText('.card', '#159885')}?.textContent.includes('erro ao ler')`)));
  }

  // ---- 9c. GLPI que redireciona
  {
    const S = newStep('GLPI que redireciona: a extensão não segue e não repassa os tokens',
      'O GLPI passa a responder 302 para outro endereço (como um proxy mal configurado). A extensão não vai atrás do redirecionamento, não manda App-Token nem Session-Token ao destino e mostra um erro que diz o que conferir.');
    world.redirectTo = `${glpi.url}/apirest.php/SEGUIU-O-REDIRECT`;
    const seen = world.requests.length;
    await popup.click("document.getElementById('refresh')");
    await popup.waitFor("!document.getElementById('refresh').disabled && document.getElementById('status').innerText.includes('redirecionou')", 'erro de redirecionamento');
    await S.shot(popup, 'Rodapé do popup com o erro de redirecionamento', "document.getElementById('status')");
    const run = await sw.eval("chrome.storage.local.get('state').then((r) => r.state.lastRun)");
    S.check('Verificação marcada como erro, com a causa', run.ok === false && /redirecionou/.test(run.error), run.error);
    S.check('O destino do redirecionamento nunca foi chamado', !world.requests.slice(seen).includes('SEGUIU-O-REDIRECT'), world.requests.slice(seen).join(','));
    S.check('Ícone mostra o “!” de erro', (await sw.eval('chrome.action.getBadgeText({})')) === '!');
    world.redirectTo = null;
    await popup.click("document.getElementById('refresh')");
    await popup.waitFor("!document.getElementById('refresh').disabled && !document.getElementById('status').innerText.includes('redirecionou')", 'volta ao normal');
    S.check('Sem o redirecionamento, a verificação volta ao normal', (await sw.eval("chrome.storage.local.get('state').then((r) => r.state.lastRun.ok)")) === true);
  }

  // ---- 9d. duas páginas gravando ao mesmo tempo
  {
    const S = newStep('Duas páginas da extensão gravando ao mesmo tempo não perdem dados',
      'O popup e outra página da extensão gravam 15 tickets acompanhados cada uma, ao mesmo tempo (o mesmo que acontece quando você acompanha um ticket no popup enquanto o service worker marca outro como lido). Nenhuma gravação pode se perder.');
    const pageB = await openPage(`chrome-extension://${extId}/guide.html`, 800, 600);
    const off = process.env.E2E_LOCKS_OFF === '1'; // só para provar que o teste enxerga a corrida: desliga o Web Locks
    const race = (base) => `(async () => {
      ${off ? "Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });" : ''}
      const { updateUser } = await import('./src/store.js');
      await Promise.all(Array.from({ length: 15 }, (_, i) => updateUser((u) => { u.watched[${base} + i] = { addedAt: 1 }; })));
      return true;
    })()`;
    S.check('Web Locks disponível nas páginas da extensão', (await popup.eval("typeof navigator.locks?.request")) === 'function' && (await pageB.eval("typeof navigator.locks?.request")) === 'function');
    await Promise.all([popup.eval(race(1000)), pageB.eval(race(2000))]);
    const kept = await sw.eval("chrome.storage.local.get('user').then(({ user }) => Object.keys(user.watched).filter((k) => Number(k) < 3000).length)");
    S.check('As 30 gravações (15 de cada página) foram todas mantidas', kept === 30, `${kept} de 30${off ? ' (Web Locks desligado de propósito)' : ''}`);
    await sw.eval("chrome.storage.local.get('user').then(({ user }) => { for (const k of Object.keys(user.watched)) if (Number(k) < 3000) delete user.watched[k]; return chrome.storage.local.set({ user }); })");
    optionsEvents.push(...pageB.events);
    pageB.close();
  }

  // ---- 9e. pausar a sincronização
  {
    const S = newStep('Pausar a sincronização',
      'Clique no botão de pausa do popup. Com a sincronização pausada, nada é buscado no GLPI nem avisado (nem pelo “Atualizar agora”), e o ícone e o popup deixam isso claro. Ao retomar, o que aconteceu nesse meio-tempo é buscado e avisado.');
    const before = (await created()).length;
    await sw.eval("chrome.alarms.create('poll', { periodInMinutes: 2 })"); // o teste começa sem alarme: recria para ver o cancelamento
    await popup.click("document.getElementById('pause')");
    await popup.waitFor("!document.getElementById('paused').hidden", 'aviso de pausa');
    await sw.waitFor("chrome.alarms.get('poll').then((a) => !a)", 'alarme cancelado');
    await sw.waitFor("chrome.action.getBadgeText({}).then((t) => t === 'II')", 'ícone pausado');
    await S.shot(popup, 'Popup pausado: aviso com “Retomar”, botão de pausa em destaque e atualizar desligado', "document.getElementById('paused')");

    world.reply(159919, 20, '&lt;p&gt;Chegou durante a pausa.&lt;/p&gt;');
    const seen = world.requests.length;
    const answer = await popup.eval("chrome.runtime.sendMessage({ type: 'poll-now' })");
    await sleep(800);
    S.check('“Atualizar agora” não busca nada enquanto pausado', answer?.ok === true && world.requests.length === seen, `${world.requests.length - seen} requisição(ões) ao GLPI`);
    S.check('Alarme de verificação cancelado', (await sw.eval("chrome.alarms.get('poll')")) == null);
    S.check('Ícone mostra “II”', (await sw.eval('chrome.action.getBadgeText({})')) === 'II');
    S.check('Título do ícone diz que está pausado', (await sw.eval('chrome.action.getTitle({})')).includes('sincronização pausada'));
    S.check('Botão de atualizar desligado', await popup.eval("document.getElementById('refresh').disabled"));
    S.check('Botão de pausa vira “Retomar”', (await popup.eval("document.getElementById('pause').getAttribute('aria-label')")) === 'Retomar sincronização');
    S.check('Rodapé diz “Pausado”', (await popup.text('#status')).startsWith('Pausado'), await popup.text('#status'));
    S.check('Nenhuma notificação durante a pausa', (await created()).length === before);

    const guide = await openPage(`chrome-extension://${extId}/guide.html`, 1040, 860);
    await guide.waitFor("document.querySelectorAll('#checks > li').length === 7", 'guia renderizado');
    S.check('Guia explica que a pausa é o motivo de não chegar aviso',
      await guide.eval("(() => { const li = [...document.querySelectorAll('#checks > li')].find((l) => l.textContent.includes('Verificação dos tickets')); return li.className.includes('warn') && li.textContent.includes('pausada'); })()"));
    optionsEvents.push(...guide.events);
    guide.close();

    await popup.click("document.getElementById('resume')");
    await popup.waitFor("document.getElementById('paused').hidden && !document.getElementById('refresh').disabled", 'retomou');
    await until(async () => (await created()).length > before, 'aviso do que chegou durante a pausa');
    S.check('Ao retomar, o que aconteceu durante a pausa é avisado', (await created()).slice(before).some((c) => c.opts.message?.includes('Chegou durante a pausa')));
    S.check('Alarme de verificação recriado', (await sw.eval("chrome.alarms.get('poll')")) != null);
    S.check('Ícone sai do “II”', (await sw.eval('chrome.action.getBadgeText({})')) !== 'II');
    await sw.eval("chrome.alarms.clear('poll')"); // o resto do teste segue sem alarme
  }

  // ---- 9f. tags personalizadas no popup
  {
    const S = newStep('Tags personalizadas nos tickets (só neste navegador)',
      'No card do #159919, o botão “Tags” abre um painel com as etapas e etiquetas padrão. Marcar uma etapa mostra desde quando; marcar outra troca a anterior; etiquetas somam. Dá para criar uma tag nova ali mesmo, filtrar por tag e achar pelo nome na busca. Nada disso vai ao GLPI.');
    const C = byText('.card', '#159919');
    const chipsOf = async () => JSON.parse(await popup.eval(`JSON.stringify([...${C}.querySelectorAll('.chip.tag')].map((c) => c.textContent))`));
    const tagsStore = () => sw.eval("chrome.storage.local.get('tags').then((r) => JSON.stringify(r.tags ?? null))").then(JSON.parse);
    const opt = (name) => `[...document.querySelectorAll('.tagpanel .tagopt')].find((b) => b.textContent === ${JSON.stringify(name)})`;
    const press = (name) => popup.eval(`(() => { const b = ${opt(name)}; b.focus(); b.click(); return true; })()`);

    await popup.click(`${C}?.querySelector('.actions button')`);
    await popup.waitFor("document.querySelector('.tagpanel') !== null", 'painel de tags');
    const opts = JSON.parse(await popup.eval("JSON.stringify([...document.querySelectorAll('.tagpanel .tagopt')].map((b) => b.textContent))"));
    S.check('Padrões: quatro etapas e uma etiqueta', JSON.stringify(opts) === JSON.stringify(['Em andamento', 'PR em review', 'Em homologação/suporte', 'Aguardando retorno', 'Cliente avisado']), opts.join(' | '));
    S.check('Painel separa “Etapa” e “Etiquetas”', (await popup.text('.tagpanel')).includes('ETAPA (UMA POR TICKET)') && (await popup.text('.tagpanel')).includes('ETIQUETAS (QUANTAS QUISER)'));
    S.check('Painel avisa que fica só no navegador', (await popup.text('.tagpanel')).includes('Só neste navegador: não vão ao GLPI'));
    await S.shot(popup, 'Painel de tags aberto dentro do card do #159919', "document.querySelector('.tagpanel')");

    await press('PR em review');
    await popup.waitFor(`${C}.querySelector('.chip.tag')?.textContent.startsWith('PR em review · ')`, 'etapa marcada');
    S.check('Etapa marcada aparece como chip com “desde quando”', (await chipsOf())[0].startsWith('PR em review · '), (await chipsOf()).join(' | '));
    S.check('Gravou no storage do navegador', (await tagsStore()).assign[159919]?.[0]?.tag === 'pr-review');
    // a cor da etapa marcada no painel é a da própria tag (já houve um bug em que tudo virava cinza)
    const paint = await popup.eval(`(() => { const probe = document.createElement('i'); probe.style.color = 'var(--tag-purple)'; document.body.append(probe); const want = getComputedStyle(probe).color; probe.remove(); return { got: getComputedStyle(${opt('PR em review')}).backgroundColor, want }; })()`);
    S.check('Etapa marcada no painel usa a cor da própria tag (roxo), não cinza', paint.got === paint.want, `${paint.got} × ${paint.want}`);

    await press('Em homologação/suporte');
    await popup.waitFor(`${C}.querySelector('.chip.tag')?.textContent.startsWith('Em homologação/suporte')`, 'etapa trocada');
    S.check('Marcar outra etapa troca a anterior (só uma por ticket)', (await chipsOf()).filter((c) => c.includes(' · ')).length === 1 && !(await chipsOf()).some((c) => c.startsWith('PR em review')), (await chipsOf()).join(' | '));

    await press('Cliente avisado');
    await popup.waitFor(`${C}.querySelectorAll('.chip.tag').length === 2`, 'etiqueta somada');
    S.check('Etiqueta soma à etapa, com a etapa primeiro', (await chipsOf())[0].startsWith('Em homologação/suporte') && (await chipsOf())[1] === 'Cliente avisado', (await chipsOf()).join(' | '));
    S.check('O foco do teclado continua no botão clicado depois de a lista ser recriada', (await popup.eval('document.activeElement?.dataset?.focus')) === 'tag:159919:avisado');

    // criar uma tag nova ali mesmo: já fica marcada no ticket
    await popup.type('.tagpanel .tp-name', 'Dev review');
    await popup.eval("document.querySelector('.tagpanel .tp-new').requestSubmit()");
    await popup.waitFor(`[...${C}.querySelectorAll('.chip.tag')].some((c) => c.textContent === 'Dev review')`, 'tag criada');
    const afterCreate = await tagsStore();
    S.check('Tag criada pela pessoa entra na lista e já vem marcada no ticket',
      afterCreate.defs.some((d) => d.name === 'Dev review' && d.stage === false) && afterCreate.assign[159919].length === 3);
    await popup.type('.tagpanel .tp-name', 'dev REVIEW');
    await popup.eval("document.querySelector('.tagpanel .tp-new').requestSubmit()");
    await popup.waitFor("document.querySelector('.tagpanel .tp-error') !== null", 'erro de nome repetido');
    S.check('Nome repetido (sem acento/maiúscula) é recusado com a explicação', (await popup.text('.tp-error')) === 'Já existe uma tag com esse nome.');
    S.check('…e nada foi criado', (await tagsStore()).defs.filter((d) => d.name.toLowerCase() === 'dev review').length === 1);
    await S.shot(popup, 'Chips no card (etapa com data + etiquetas) e o erro de nome repetido', `${C}`);

    // filtro e busca
    await popup.type('.tagpanel .tp-name', '');
    await popup.click("document.getElementById('filters-toggle')");
    await popup.select('#f-tag', 'avisado');
    await popup.waitFor("document.querySelectorAll('.card').length === 1", 'filtro por tag');
    S.check('Filtro por tag mostra só o ticket marcado', (await popup.eval("[...document.querySelectorAll('.card .id')].map((e) => e.textContent).join()")) === '#159919');
    await popup.select('#f-tag', '__none__');
    await popup.waitFor("document.querySelectorAll('.card').length === 3", 'filtro sem tag');
    S.check('“Sem tag” mostra os outros três', !(await popup.eval("[...document.querySelectorAll('.card .id')].map((e) => e.textContent).join()")).includes('159919'));
    await popup.click("document.getElementById('f-clear')");
    await popup.click("document.getElementById('filters-toggle')");
    await popup.type('#q', 'dev review');
    await popup.waitFor("document.querySelectorAll('.card').length === 1", 'busca pelo nome da tag');
    S.check('A busca por texto acha o nome da tag', (await popup.eval("document.querySelector('.card .id').textContent")) === '#159919');
    await popup.click("document.getElementById('f-clear')");
    await popup.waitFor("document.querySelectorAll('.card').length === 4", 'filtros limpos');

    // detalhes e Esc
    await popup.eval("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await popup.waitFor("document.querySelector('.tagpanel') === null", 'Esc fecha o painel');
    S.check('Esc fecha o painel e o foco volta ao botão “Tags”', (await popup.eval('document.activeElement?.dataset?.focus')) === 'tagsbtn:159919');
    await popup.click(cardButton('#159919'));
    await popup.waitFor("!document.getElementById('detail').hidden && document.querySelector('#detail .d-info') !== null", 'detalhes');
    S.check('Detalhes mostram as tags do ticket', (await popup.text('#detail .d-info')).includes('Tags') && (await popup.text('#detail .d-info')).includes('Em homologação/suporte'));
    await popup.click("document.querySelector('#detail .back')");
    await popup.waitFor("!document.getElementById('list-view').hidden", 'voltou à lista');

    // reabrir o popup (novo contexto): as tags vêm do storage, não da memória
    const again = await openPage(`chrome-extension://${extId}/popup.html`, 420, 600);
    await again.waitFor("document.querySelectorAll('.card').length === 4", 'popup reaberto');
    S.check('Reabrindo o popup, as tags continuam lá', await again.eval(`${C}.textContent.includes('Em homologação/suporte') && ${C}.textContent.includes('Cliente avisado')`));
    optionsEvents.push(...again.events);
    again.close();

    // nada do que foi digitado nas tags pode ter ido parar no GLPI
    const leaked = world.urls.filter((u) => /dev[ %20+]*review|homolog|avisado|andamento|aguardando/i.test(decodeURIComponent(u)));
    S.check('Nenhuma requisição ao GLPI carrega o texto das tags', leaked.length === 0, leaked.join(' | '));
  }

  // ---- 9g. gerenciar as tags nas Opções + informativo do que as apaga
  {
    const S = newStep('Gerenciar tags nas Opções, exportar/importar e o aviso de quando elas se perdem',
      'Em Opções → Tags dos tickets: renomear (a marcação nos tickets acompanha), recolorir, criar, apagar, restaurar os padrões, exportar e importar um arquivo. Logo abaixo, em “Dados locais”, o aviso explica o que apaga as tags.');
    const options = await openPage(`chrome-extension://${extId}/options.html#tags`, 900, 960);
    await options.waitFor("document.querySelectorAll('#tags-list .tag-row').length === 6", 'lista de tags (5 padrões + Dev review)');
    await options.eval('window.confirm = () => true; true');
    const rows = async () => JSON.parse(await options.eval("JSON.stringify([...document.querySelectorAll('#tags-list .tag-row input[type=text]')].map((i) => i.value))"));
    const store = () => sw.eval("chrome.storage.local.get('tags').then((r) => JSON.stringify(r.tags ?? null))").then(JSON.parse);
    const toastText = () => options.eval("document.querySelector('#snacks .snack')?.innerText ?? ''");
    await S.shot(options, 'Seção “Tags dos tickets”: lista editável, criar, restaurar, exportar e importar', "document.getElementById('tags')");

    // renomear: a marcação acompanha (mesmo id)
    const devId = (await store()).defs.find((d) => d.name === 'Dev review').id;
    await options.eval(`(() => { const i = [...document.querySelectorAll('#tags-list .tag-row input[type=text]')].find((x) => x.value === 'Dev review'); i.value = 'Code review'; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await options.waitFor("document.querySelector('#snacks .snack.ok') !== null", 'aviso de tag salva');
    S.check('Renomear avisa “Tag salva”', (await toastText()).includes('Tag salva'));
    const renamed = await store();
    S.check('A marcação no ticket acompanha o novo nome (mesmo id)', renamed.defs.find((d) => d.id === devId).name === 'Code review' && renamed.assign[159919].some((e) => e.tag === devId));
    // nome repetido: recusa e desfaz o que foi digitado
    await options.eval(`(() => { const i = [...document.querySelectorAll('#tags-list .tag-row input[type=text]')].find((x) => x.value === 'Code review'); i.value = 'pr em review'; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await options.waitFor("document.querySelector('#snacks .snack.bad') !== null", 'erro de nome repetido');
    S.check('Nome repetido: aviso de erro e o campo volta ao que era', (await toastText()).includes('Já existe') && (await rows()).includes('Code review') && !(await rows()).includes('pr em review'));
    // cor
    await options.eval(`(() => { const row = [...document.querySelectorAll('#tags-list .tag-row')].find((r) => r.querySelector('input').value === 'Code review'); const s = row.querySelectorAll('select')[1]; s.value = 'red'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await options.waitFor("[...document.querySelectorAll('#tags-list .tag-row')].some((r) => r.querySelector('input').value === 'Code review' && r.querySelector('.tag-dot').classList.contains('tag-red'))", 'cor trocada');
    S.check('Trocar a cor muda a bolinha na hora e grava', (await store()).defs.find((d) => d.id === devId).color === 'red');

    // cor em hexadecimal: "Personalizada…", digitar, e o que não for #rrggbb é recusado
    const rowOf = (name) => `[...document.querySelectorAll('#tags-list .tag-row')].find((r) => r.querySelector('input').value === ${JSON.stringify(name)})`;
    const colorOf = async () => (await store()).defs.find((d) => d.id === devId).color;
    const settled = async (hex) => { await until(async () => (await colorOf()) === hex, `cor ${hex} gravada`); await sleep(300); }; // a tela mostra o valor antes de o storage ter
    await options.eval(`(() => { const sel = ${rowOf('Code review')}.querySelectorAll('select')[1]; sel.value = 'custom'; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await options.waitFor(`${rowOf('Code review')}?.querySelector('input.hex')?.hidden === false`, 'campo de hexadecimal');
    await settled('#6366f1');
    S.check('“Personalizada…” mostra o campo de hexadecimal e o seletor de cores, e já grava uma cor válida', (await colorOf()) === '#6366f1' && await options.eval(`${rowOf('Code review')}.querySelector('input[type=color]').hidden === false`), await colorOf());
    const typeHex = (v) => options.eval(`(() => { const i = ${rowOf('Code review')}.querySelector('input.hex'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await typeHex('#FFFF00');
    await settled('#ffff00');
    S.check('Hexadecimal digitado é gravado normalizado, em minúsculas (#ffff00)', (await colorOf()) === '#ffff00');
    S.check('A bolinha das Opções mostra a cor exata escolhida (amarelo puro)', (await options.eval(`getComputedStyle(${rowOf('Code review')}.querySelector('.tag-dot')).backgroundColor`)) === 'rgb(255, 255, 0)');
    await typeHex('f80');
    await settled('#ff8800');
    S.check('O atalho de 3 dígitos (f80) vira #ff8800', (await colorOf()) === '#ff8800');
    await typeHex('#ffff00');
    await settled('#ffff00'); // e o aviso "Tag salva" dela não pode cobrir o de erro da próxima tentativa
    for (const bad of ['#12345', 'rgb(0,0,0)', '#fff;background:url(//evil.example/x)', 'amarelo', 'var(--danger)']) {
      await typeHex(bad);
      await sleep(250);
      S.check(`Recusa “${bad}”: aviso de erro, nada gravado e o campo volta ao que era`,
        (await toastText()).includes('Cor inválida') && (await colorOf()) === '#ffff00' && (await options.eval(`${rowOf('Code review')}.querySelector('input.hex').value`)) === '#ffff00');
    }
    S.check('Nada de CSS estranho foi parar no estilo da página', !(await options.eval("document.documentElement.outerHTML")).includes('evil.example'));

    // formulário de nova tag: hex inválido + Enter (que não dispara o "change") não cria a tag com outra cor em silêncio
    const countRows = () => options.eval("document.querySelectorAll('#tags-list .tag-row').length");
    const rowsBefore = await countRows();
    await options.type('#tag-new-name', 'Com cor ruim');
    await options.eval("(() => { const sel = document.querySelector('#tag-new-color select'); sel.value = 'custom'; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()");
    const hexField = (v) => options.eval(`(() => { const i = document.querySelector('#tag-new-color input.hex'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return i.getAttribute('aria-invalid'); })()`);
    S.check('Enquanto digita um hexadecimal inválido, o campo é marcado (aria-invalid) e fica com borda vermelha', (await hexField('#12zz')) === 'true' && (await options.eval("getComputedStyle(document.querySelector('#tag-new-color input.hex')).borderColor")) === 'rgb(192, 45, 45)');
    await options.eval("document.getElementById('tag-new').requestSubmit(); true"); // como o Enter: sem o evento "change"
    await options.waitFor("document.querySelector('#snacks .snack.bad') !== null", 'erro de cor no formulário');
    await sleep(250);
    S.check('Enter com hexadecimal inválido: aviso “Cor inválida”, nenhuma tag criada e o foco vai ao campo',
      (await toastText()).includes('Cor inválida') && (await countRows()) === rowsBefore && !(await store()).defs.some((d) => d.name === 'Com cor ruim') && (await options.eval("document.activeElement.classList.contains('hex')")));
    S.check('Corrigindo o hexadecimal, a marca de erro some', (await hexField('#00aa55')) === 'false');
    await options.eval("document.getElementById('tag-new').requestSubmit(); true");
    await options.waitFor("(document.querySelectorAll('#tags-list .tag-row').length) === " + (rowsBefore + 1), 'tag criada com o hexadecimal corrigido');
    S.check('…e a tag é criada com a cor digitada, mesmo sem ter confirmado o campo antes', (await store()).defs.find((d) => d.name === 'Com cor ruim')?.color === '#00aa55');
    await options.eval(`(() => { ${rowOf('Com cor ruim')}.querySelector('button[title=Apagar]').click(); return true; })()`);
    await options.waitFor(`document.querySelectorAll('#tags-list .tag-row').length === ${rowsBefore}`, 'tag de teste apagada');

    // storage com cor inválida (editado à mão ou corrompido): o popup desenha cinza, sem aplicar nada do que estava lá
    const original = await store();
    await sw.eval(`chrome.storage.local.get('tags').then(({ tags }) => { tags.defs.find((d) => d.id === ${JSON.stringify(devId)}).color = '#fff;background:url(//evil.example/x)'; return chrome.storage.local.set({ tags }); })`);
    // a leitura normaliza (a tag vira cinza); o popup nunca vê a cor inválida
    await popup.waitFor(`[...${byText('.card', '#159919')}.querySelectorAll('.chip.tag')].some((c) => c.textContent === 'Code review' && c.classList.contains('tag-gray'))`, 'chip cinza');
    S.check('Cor inválida no storage: o chip no popup cai para cinza, sem estilo inline',
      await popup.eval(`(() => { const c = [...${byText('.card', '#159919')}.querySelectorAll('.chip.tag')].find((x) => x.textContent === 'Code review'); return c.classList.contains('tag-gray') && !c.hasAttribute('style') && !document.documentElement.outerHTML.includes('evil.example'); })()`));
    await sw.eval(`chrome.storage.local.set({ tags: ${JSON.stringify(original)} })`);
    await popup.waitFor(`[...${byText('.card', '#159919')}.querySelectorAll('.chip.tag')].some((c) => c.textContent === 'Code review' && c.classList.contains('tag-custom'))`, 'cor restaurada');

    // contraste de verdade, medido no popup (chip de texto amarelo sobre o card), nos dois temas
    const C2 = byText('.card', '#159919');
    await popup.waitFor(`[...${C2}.querySelectorAll('.chip.tag')].some((c) => c.textContent === 'Code review' && c.classList.contains('tag-custom'))`, 'chip com cor personalizada no popup');
    const measure = () => popup.eval(`(() => {
      const chip = [...${C2}.querySelectorAll('.chip.tag')].find((c) => c.textContent === 'Code review');
      const nums = (s) => s.match(/[\\d.]+/g).slice(0, 3).map(Number);
      const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const fg = nums(getComputedStyle(chip).color);
      const bg = nums(getComputedStyle(${C2}).backgroundColor);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return { ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100, fg: getComputedStyle(chip).color, bg: getComputedStyle(${C2}).backgroundColor };
    })()`);
    const claro = await measure();
    S.check('Tema claro: amarelo puro (#ffff00) continua legível no chip (contraste ≥ 4,5, o texto foi escurecido)', claro.ratio >= 4.5 && claro.fg !== 'rgb(255, 255, 0)', JSON.stringify(claro));
    await popup.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await sleep(200);
    await typeHex('#000080'); // azul-marinho: invisível no tema escuro se não fosse ajustado
    await popup.waitFor(`[...${C2}.querySelectorAll('.chip.tag')].some((c) => c.textContent === 'Code review' && c.getAttribute('style')?.includes('#000080'))`, 'chip azul-marinho');
    const escuro = await measure();
    S.check('Tema escuro: azul-marinho (#000080) continua legível no chip (contraste ≥ 4,5, o texto foi clareado)', escuro.ratio >= 4.5 && escuro.fg !== 'rgb(0, 0, 128)', JSON.stringify(escuro));
    await popup.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await typeHex('#ffff00');
    await settled('#ffff00');
    await S.shot(options, 'Cor personalizada: campo hexadecimal, seletor do navegador e a bolinha com a cor exata', rowOf('Code review'));
    // criar (etapa) e apagar
    await options.type('#tag-new-name', 'Bloqueado');
    await options.select('#tag-new-kind', 'stage');
    await options.eval("document.getElementById('tag-new').requestSubmit()");
    await options.waitFor("document.querySelectorAll('#tags-list .tag-row').length === 7", 'tag criada');
    S.check('Criar uma tag pela seção', (await store()).defs.some((d) => d.name === 'Bloqueado' && d.stage === true));
    await options.eval(`(() => { const row = [...document.querySelectorAll('#tags-list .tag-row')].find((r) => r.querySelector('input').value === 'Bloqueado'); row.querySelector('button[title=Apagar]').click(); return true; })()`);
    await options.waitFor("document.querySelectorAll('#tags-list .tag-row').length === 6", 'tag apagada');
    S.check('Apagar uma tag a tira da lista', !(await store()).defs.some((d) => d.name === 'Bloqueado'));

    // exportar (captura o arquivo em vez de baixar)
    await options.eval(`(() => { window.__blobs = []; URL.createObjectURL = (b) => { window.__blobs.push(b); return 'blob:e2e'; }; HTMLAnchorElement.prototype.click = function () { window.__download = this.download; }; return true; })()`);
    await options.click("document.getElementById('tags-export')");
    await options.waitFor('window.__blobs.length === 1', 'arquivo exportado');
    const file = await options.eval('window.__blobs[0].text()');
    const parsed = JSON.parse(file);
    S.check('Exportar gera um JSON do MyTicket com as tags e as marcações', parsed.app === 'myticket-tags' && parsed.defs.some((d) => d.name === 'Code review') && parsed.assign[159919]?.length === 3);
    S.check('O arquivo só tem tags e números de ticket (nada de token ou credencial)', !/token|senha|password|glpi|https?:/i.test(file));
    S.check('O nome do arquivo leva a data', /^myticket-tags-\d{4}-\d{2}-\d{2}\.json$/.test(await options.eval('window.__download')));

    // importar: apaga uma tag padrão e recupera pelo arquivo
    await options.eval(`(() => { const row = [...document.querySelectorAll('#tags-list .tag-row')].find((r) => r.querySelector('input').value === 'Cliente avisado'); row.querySelector('button[title=Apagar]').click(); return true; })()`);
    await options.waitFor("document.querySelectorAll('#tags-list .tag-row').length === 5", 'padrão apagado');
    S.check('Apagar uma tag a tira também dos tickets', !(await store()).assign[159919].some((e) => e.tag === 'avisado'));
    const pick = (text) => options.eval(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], 'tags.json', { type: 'application/json' })); const i = document.getElementById('tags-file'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await pick(file);
    await options.waitFor("document.querySelectorAll('#tags-list .tag-row').length === 6 && document.querySelector('#snacks .snack.ok')?.innerText.includes('importadas')", 'importado');
    const imported = await store();
    S.check('Importar devolve a tag apagada e as marcações dos tickets', imported.defs.some((d) => d.name === 'Cliente avisado') && imported.assign[159919].length === 3);
    await pick('{"nada":"a ver"}');
    await options.waitFor("document.querySelector('#snacks .snack.bad') !== null", 'arquivo inválido');
    S.check('Arquivo inválido é recusado e não altera nada', (await toastText()).includes('não é um export') && JSON.stringify(await store()) === JSON.stringify(imported));
    // restaurar padrões
    await options.eval(`(() => { const row = [...document.querySelectorAll('#tags-list .tag-row')].find((r) => r.querySelector('input').value === 'Aguardando retorno'); row.querySelector('button[title=Apagar]').click(); return true; })()`);
    await options.waitFor("document.querySelectorAll('#tags-list .tag-row').length === 5", 'outro padrão apagado');
    await options.click("document.getElementById('tags-restore')");
    await options.waitFor("document.querySelectorAll('#tags-list .tag-row').length === 6", 'padrões restaurados');
    S.check('“Restaurar tags padrão” devolve só o que foi apagado', (await rows()).filter((n) => n === 'Aguardando retorno').length === 1);

    // o aviso de perda de dados, junto do botão que apaga tudo
    const loss = await options.text('#loss-info');
    await options.click("document.getElementById('tabbtn-dados')");
    await options.eval("document.getElementById('loss-info').scrollIntoView({ block: 'center' }); true");
    await S.shot(options, 'Em “Dados locais”, o aviso do que apaga as tags, ao lado do botão de apagar', "document.getElementById('loss-info')");
    for (const [label, needle] of [
      ['o botão “Apagar credenciais e dados locais”', 'Apagar credenciais e dados locais'],
      ['remover a extensão', 'remove a extensão'],
      ['carregar de outra pasta', 'outra pasta'],
      ['apagar/redefinir o perfil do Chrome, outro computador', 'perfil do Chrome'],
      ['trocar de conta ou de GLPI', 'troca a conta ou o GLPI'],
      ['60 dias sem voltar ao radar', '60 dias'],
      ['“Limpar dados de navegação” (não testado)', 'Limpar dados de navegação'],
      ['que sobrevivem a fechar o Chrome', 'sobrevivem'],
      ['como se proteger: exportar', 'Exportar tags'],
    ]) S.check(`Aviso de perda cita: ${label}`, loss.includes(needle));
    S.check('O aviso fica dentro de “Dados locais”, antes do botão de apagar',
      await options.eval("(() => { const b = document.getElementById('wipe'); const l = document.getElementById('loss-info'); return l.closest('.local-data') === b.closest('.local-data') && (l.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0; })()"));
    S.check('O texto do botão de apagar também cita as tags', (await options.text('.local-data > .note')).includes('as tags personalizadas'));
    S.check('Sem “null”/“undefined” na seção', ((await options.text('#tags')).match(STRAY) ?? []).length === 0);
    optionsEvents.push(...options.events);
    options.close();
  }

  // ---- 9h. abas das Opções
  {
    const S = newStep('Opções em abas: Conexão, Avisos, Aparência, Tags e Dados locais',
      'A página de Opções deixou de ser um arquivo comprido: cinco abas. Conexão e Avisos fazem parte do formulário (barra “Salvar” no pé da janela); Aparência, Tags e Dados locais agem na hora e não mostram a barra. O endereço guarda a aba, e “#tags” abre a aba certa.');
    const page = await openPage(`chrome-extension://${extId}/options.html`, 900, 760);
    await page.waitFor("document.body.dataset.tabs === 'ready'", 'abas montadas');
    const state = async () => JSON.parse(await page.eval(`JSON.stringify({
      selected: [...document.querySelectorAll('[role=tab]')].filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.id.replace('tabbtn-', '')),
      visible: [...document.querySelectorAll('[role=tabpanel]')].filter((p) => p.offsetParent !== null).map((p) => p.id.replace('tab-', '')),
      savebar: document.querySelector('.savebar').offsetParent !== null,
      test: document.getElementById('test').offsetParent !== null,
      hash: location.hash,
      tabbable: [...document.querySelectorAll('[role=tab]')].filter((b) => b.tabIndex === 0).map((b) => b.id.replace('tabbtn-', '')),
    })`));
    const tab = async (id) => { await page.click(`document.getElementById('tabbtn-${id}')`); await sleep(120); return state(); };

    const inicial = await state();
    S.check('Abre na aba “Conexão”, com a barra de salvar e o “Testar conexão”', JSON.stringify(inicial.selected) === '["conexao"]' && inicial.visible.join() === 'conexao' && inicial.savebar && inicial.test, JSON.stringify(inicial));
    S.check('São cinco abas, cada painel ligado à sua aba (ARIA)', await page.eval(`(() => { const tabs = [...document.querySelectorAll('[role=tab]')]; return tabs.length === 5 && tabs.every((b) => { const p = document.getElementById(b.getAttribute('aria-controls')); return p?.getAttribute('role') === 'tabpanel' && p.getAttribute('aria-labelledby') === b.id; }); })()`));
    S.check('Só a aba atual entra na ordem do Tab (as setas andam entre elas)', inicial.tabbable.join() === 'conexao');
    await S.shot(page, 'Aba “Conexão”: conexão com o GLPI, o que acompanhar e avançado', "document.getElementById('tabbtn-conexao')");

    const avisos = await tab('avisos');
    S.check('Aba “Avisos”: só o painel dela, com a barra de salvar; “Testar conexão” some', avisos.visible.join() === 'avisos' && avisos.savebar && !avisos.test && avisos.hash === '#avisos', JSON.stringify(avisos));
    S.check('O conteúdo certo está em cada aba', await page.eval("document.getElementById('tab-avisos').contains(document.getElementById('attn-sticky')) && document.getElementById('tab-avisos').contains(document.getElementById('hideContent')) && document.getElementById('tab-conexao').contains(document.getElementById('baseUrl')) && document.getElementById('tab-conexao').contains(document.getElementById('pollMinutes'))"));
    await S.shot(page, 'Aba “Avisos”: avisar quando, som, chamar a atenção e privacidade', "document.getElementById('tabbtn-avisos')");

    const tags = await tab('tags');
    S.check('Aba “Tags”: sem a barra de salvar (as tags salvam na hora)', tags.visible.join() === 'tags' && !tags.savebar && tags.hash === '#tags', JSON.stringify(tags));
    await S.shot(page, 'Aba “Tags”: gerenciar tags, sem a barra de salvar', "document.getElementById('tabbtn-tags')");

    const dados = await tab('dados');
    S.check('Aba “Dados locais”: sem a barra de salvar; o aviso de perda e o botão de apagar estão aqui', dados.visible.join() === 'dados' && !dados.savebar && await page.eval("!!document.getElementById('tab-dados').querySelector('#loss-info') && !!document.getElementById('tab-dados').querySelector('#wipe')"), JSON.stringify(dados));
    await S.shot(page, 'Aba “Dados locais”: o aviso de quando as tags se perdem e o botão de apagar', "document.getElementById('tabbtn-dados')");

    // teclado: setas e Home/End
    await page.eval("document.getElementById('tabbtn-dados').focus(); document.getElementById('tabbtn-dados').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); true");
    await sleep(120);
    S.check('Seta para a direita na última aba dá a volta para a primeira e leva o foco', (await state()).selected.join() === 'conexao' && (await page.eval('document.activeElement.id')) === 'tabbtn-conexao');
    await page.eval("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); true");
    await sleep(120);
    S.check('End vai para a última aba', (await state()).selected.join() === 'dados');

    // link interno (o “Exportar tags” do aviso) e voltar
    await page.eval("location.hash = '#tags'; true");
    await sleep(150);
    S.check('Mudar o # do endereço (ex.: link “Exportar tags”) troca de aba', (await state()).selected.join() === 'tags');
    page.close();

    // recarregar com o # mantém a aba; o popup abre a aba das tags
    const reopened = await openPage(`chrome-extension://${extId}/options.html#tags`, 900, 760);
    await reopened.waitFor("document.body.dataset.tabs === 'ready'", 'reaberto com #tags');
    S.check('Abrir com “#tags” já cai na aba Tags (é o que o “Gerenciar tags…” do popup usa)', await reopened.eval("document.getElementById('tabbtn-tags').getAttribute('aria-selected') === 'true' && document.getElementById('tab-tags').offsetParent !== null && document.querySelector('.savebar').offsetParent === null"));
    const junk = await openPage(`chrome-extension://${extId}/options.html#lixo`, 900, 760);
    await junk.waitFor("document.body.dataset.tabs === 'ready'", 'reaberto com #lixo');
    S.check('Endereço com # desconhecido cai na aba padrão', await junk.eval("document.getElementById('tabbtn-conexao').getAttribute('aria-selected') === 'true'"));
    S.check('Barra de salvar fica no pé da janela (sticky) nas abas do formulário', (await junk.eval("getComputedStyle(document.querySelector('.savebar')).position")) === 'sticky');
    optionsEvents.push(...reopened.events, ...junk.events);
    reopened.close();
    junk.close();
  }

  // ---- 9i. aparência: tema e efeito neon
  {
    const S = newStep('Aparência: tema e efeito neon (Opções → Aparência)',
      'Uma aba nova nas Opções, que age na hora (sem “Salvar”): tema Automático/Claro/Escuro e o interruptor do efeito neon. O neon só aparece com o tema escuro em uso e vale no popup, nas Opções e no Guia. Padrão: automático, neon desligado.');
    const dark = (page) => page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    const light = (page) => page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    const root = (page) => page.eval("JSON.stringify({ theme: document.documentElement.dataset.theme ?? null, neon: 'neon' in document.documentElement.dataset, bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(), accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() })").then(JSON.parse);
    const saved = (page) => page.eval("chrome.storage.local.get('appearance').then((r) => JSON.stringify(r.appearance ?? null))").then(JSON.parse);
    const options = await openPage(`chrome-extension://${extId}/options.html#aparencia`, 900, 900);
    await options.waitFor("document.body.dataset.tabs === 'ready'", 'abas montadas');
    await light(options);
    await sleep(150);
    const inicial = await options.eval(`JSON.stringify({
      panel: document.getElementById('tab-aparencia').offsetParent !== null,
      savebar: document.querySelector('.savebar').offsetParent !== null,
      radios: [...document.querySelectorAll('input[name=theme]')].map((r) => r.value + (r.checked ? '*' : '')),
      neon: document.getElementById('neon').checked,
      role: document.getElementById('neon').getAttribute('role'),
    })`).then(JSON.parse);
    S.check('A aba abre por “#aparencia”, sem a barra de salvar, com tema Automático e neon desligado',
      inicial.panel && !inicial.savebar && inicial.radios.join() === 'auto*,light,dark' && inicial.neon === false, JSON.stringify(inicial));
    S.check('O neon é um interruptor de verdade (role=switch) e o padrão não grava nada', inicial.role === 'switch' && (await saved(options)) === null);
    const base = await root(options);
    S.check('Padrão: nada em <html> (segue o sistema) e o claro de antes', base.theme === null && base.neon === false && base.bg === '#ffffff', JSON.stringify(base));

    // neon ligado com o sistema escuro
    await dark(options);
    await sleep(150);
    await options.click("document.getElementById('neon')");
    await options.waitFor("'neon' in document.documentElement.dataset", 'neon ligado');
    const neon = await root(options);
    S.check('Ligar o neon com o sistema escuro aplica na hora o fundo mais fundo e o ciano', neon.neon === true && neon.accent === '#22d3ee' && neon.bg === '#0a0e13', JSON.stringify(neon));
    const gravado = await saved(options);
    S.check('…e grava na chave “appearance” (tema automático)', gravado?.theme === 'auto' && gravado?.neon === true, JSON.stringify(gravado));
    await S.shot(options, 'Aba “Aparência” com o neon ligado (tema automático, sistema escuro): prévia das tags e do botão com brilho', "document.getElementById('appearance')");

    // o popup também acompanha, e o brilho está nas tags e no botão
    const pop = await openPage(`chrome-extension://${extId}/popup.html`, 420, 600);
    await dark(pop);
    await pop.waitFor("'neon' in document.documentElement.dataset && document.querySelector('.card') !== null", 'popup com neon');
    const glow = await pop.eval(`JSON.stringify({
      add: getComputedStyle(document.querySelector('form.add .btn.primary')).boxShadow !== 'none',
      tag: (() => { const c = document.querySelector('.chip.tag'); return c ? getComputedStyle(c).boxShadow !== 'none' : null; })(),
      plain: (() => { const c = document.querySelector('.chip:not(.tag):not(.ok):not(.warn):not(.danger):not(.info):not(.accent)'); return c ? getComputedStyle(c).boxShadow : 'none'; })(),
    })`).then(JSON.parse);
    S.check('No popup o botão principal e as tags têm brilho; o chip cinza continua liso', glow.add === true && glow.tag !== false && glow.plain === 'none', JSON.stringify(glow));
    await S.shot(pop, 'Popup com o neon ligado (escuro): ciano, brilho nas tags, no botão e no cartão com novidades', "document.querySelector('.card')");

    // tema Claro escolhido: vence o sistema escuro e o neon se apaga (só existe no escuro)
    await options.click("document.querySelector('input[name=theme][value=light]')");
    await options.waitFor("document.documentElement.dataset.theme === 'light'", 'tema claro');
    const claro = await root(options);
    S.check('Tema Claro escolhido vence o sistema escuro e apaga o neon', claro.theme === 'light' && claro.neon === false && claro.bg === '#ffffff', JSON.stringify(claro));
    S.check('…o popup aberto acompanha sem recarregar', await pop.waitFor("document.documentElement.dataset.theme === 'light' && !('neon' in document.documentElement.dataset)", 'popup claro').then(() => true));
    S.check('…e o interruptor continua ligado: a preferência não se perde', (await saved(options)).neon === true && (await options.eval("document.getElementById('neon').checked")) === true);

    // tema Escuro escolhido com o sistema claro: o neon volta
    await light(options);
    await options.click("document.querySelector('input[name=theme][value=dark]')");
    await options.waitFor("document.documentElement.dataset.theme === 'dark' && 'neon' in document.documentElement.dataset", 'escuro forçado');
    const escuro = await root(options);
    S.check('Tema Escuro escolhido vale mesmo com o sistema claro, e o neon volta', escuro.theme === 'dark' && escuro.neon === true && escuro.bg === '#0a0e13', JSON.stringify(escuro));
    await options.click("document.getElementById('neon')");
    await options.waitFor("!('neon' in document.documentElement.dataset)", 'neon desligado');
    const semNeon = await root(options);
    S.check('Desligar o neon volta ao escuro de antes (fundo #12151b, azul de antes)', semNeon.theme === 'dark' && semNeon.neon === false && semNeon.bg === '#12151b' && semNeon.accent === '#7ba4ff', JSON.stringify(semNeon));
    await S.shot(options, 'Tema Escuro escolhido, neon desligado: o escuro de antes', "document.getElementById('appearance')");

    // volta ao padrão para os passos seguintes
    await options.click("document.querySelector('input[name=theme][value=auto]')");
    await options.waitFor("document.documentElement.dataset.theme === undefined", 'automático');
    S.check('Voltar a Automático tira o atributo de <html>', (await root(options)).theme === null);
    optionsEvents.push(...options.events, ...pop.events);
    await light(pop);
    options.close();
    pop.close();
  }

  // ---- 10. opções: salvar avisa e grava
  {
    const S = newStep('Opções: “Salvar” mostra um aviso e grava a preferência',
      'Marca “Manter o aviso na tela até eu fechar” e clica em Salvar: um aviso aparece no canto da tela. Depois reabre a página para ver se a marcação ficou gravada. Por fim tenta salvar sem a URL, o que deve avisar o erro e levar o foco ao campo.');
    const url = `chrome-extension://${extId}/options.html#avisos`; // a opção "Manter o aviso" mora na aba Avisos
    const loaded = `document.getElementById('baseUrl').value === ${JSON.stringify(glpi.url)}`;
    const options = await openPage(url, 900, 720);
    await options.waitFor(loaded, 'opções preenchidas');
    S.check('Começa desmarcado (como salvo)', (await options.eval("document.getElementById('attn-sticky').checked")) === false);
    await options.click("document.getElementById('attn-sticky')");
    await S.shot(options, 'Marcado, ainda sem salvar', "document.getElementById('attn-sticky')");
    await options.click("document.querySelector('button[type=submit]')");
    await options.waitFor("document.querySelector('#snacks .snack.ok') !== null", 'aviso de salvo');
    await sleep(450); // deixa a animação de entrada terminar, para a captura mostrar o aviso já opaco
    await S.shot(options, 'Depois de clicar em Salvar: aviso no canto da tela', "document.querySelector('#snacks .snack')");
    const ok = await options.eval("(() => { const s = document.querySelector('#snacks .snack'); return { title: s.querySelector('strong').textContent, hasText: s.querySelector('.msg') !== null, role: s.getAttribute('role') }; })()");
    S.check('Aviso “Configurações salvas”, só com o título', ok.title === 'Configurações salvas' && !ok.hasText, ok.title);
    S.check('Aviso anunciado a leitores de tela (role=status)', ok.role === 'status');
    S.check('Preferência gravada no storage', (await sw.eval("chrome.storage.local.get('config').then((r) => r.config.attention.sticky)")) === true);
    // clicar de novo não empilha avisos
    await options.click("document.querySelector('button[type=submit]')");
    await sleep(400);
    S.check('Salvar duas vezes não empilha avisos', (await options.eval("document.querySelectorAll('#snacks .snack').length")) === 1);
    await options.click("document.querySelector('#snacks .snack .x')");
    await options.waitFor("document.querySelectorAll('#snacks .snack').length === 0", 'aviso fechado pelo ×');
    S.check('O × fecha o aviso', true);
    optionsEvents.push(...options.events);
    options.close();

    const again = await openPage(url, 900, 720);
    await again.waitFor(loaded, 'opções reabertas');
    S.check('Reabrindo a página, a marcação continua ligada', (await again.eval("document.getElementById('attn-sticky').checked")) === true);

    await again.type('#baseUrl', '');
    await again.click("document.querySelector('button[type=submit]')");
    await again.waitFor("document.querySelector('#snacks .snack.bad') !== null", 'aviso de erro');
    await sleep(450);
    await S.shot(again, 'Salvar sem a URL: aviso de erro e foco no campo', "document.querySelector('#snacks .snack')");
    const bad = await again.eval("(() => { const s = document.querySelector('#snacks .snack'); return { title: s.querySelector('strong').textContent, text: s.querySelector('.msg').textContent, role: s.getAttribute('role'), focus: document.activeElement.id }; })()");
    S.check('Aviso de erro com o motivo', bad.title === 'Não foi possível salvar' && bad.text === 'Informe a URL do GLPI.', `${bad.title} — ${bad.text}`);
    S.check('Erro anunciado com prioridade (role=alert)', bad.role === 'alert');
    S.check('Foco volta para o campo da URL', bad.focus === 'baseUrl', bad.focus);
    S.check('Salvar falhou estando em “Avisos”: a página foi para a aba “Conexão”, onde está o campo', (await again.eval("document.getElementById('tabbtn-conexao').getAttribute('aria-selected')")) === 'true');
    S.check('Nada foi gravado com a URL vazia', (await sw.eval("chrome.storage.local.get('config').then((r) => r.config.baseUrl)")) === glpi.url);
    S.check('Sem “null”/“undefined” nos avisos', ((await again.text('#snacks')).match(STRAY) ?? []).length === 0);
    optionsEvents.push(...again.events);
    again.close();
    await sw.eval("chrome.alarms.clear('poll')"); // salvar recria o alarme; este teste segue sem ele
  }

  // ---- 11. apagar dados locais limpa também as tags
  {
    const S = newStep('“Apagar credenciais e dados locais” limpa também as tags',
      'O botão da seção Dados locais manda o background apagar o storage local inteiro, que é onde ficam as tags. Conferimos que nenhuma chave sobrou.');
    const before = JSON.parse(await sw.eval("chrome.storage.local.get(null).then((r) => JSON.stringify(Object.keys(r)))"));
    S.check('Antes: as tags estão no storage local (e nunca em sync)', before.includes('tags') && (await sw.eval("chrome.storage.sync.get(null).then((r) => Object.keys(r).length)")) === 0, before.join(','));
    const answer = await popup.eval("chrome.runtime.sendMessage({ type: 'wipe' })");
    const after = JSON.parse(await sw.eval("chrome.storage.local.get(null).then((r) => JSON.stringify(Object.keys(r)))"));
    S.check('O apagar responde ok', answer?.ok === true);
    S.check('Depois: nem as tags, nem a configuração, nem nada restou', !after.includes('tags') && !after.includes('config') && !after.includes('user') && !after.includes('state'), after.join(',') || '(vazio)');
    S.check('Nada foi parar no storage sync (que sincroniza com a conta Google)', (await sw.eval("chrome.storage.sync.get(null).then((r) => Object.keys(r).length)")) === 0);
  }

  const pageErrors = [popup, sw, { events: optionsEvents }].flatMap((s) => s.events)
    .filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))
    .map((e) => JSON.stringify(e.params).slice(0, 200));
  {
    const S = newStep('Saúde geral', 'Erros de JavaScript no popup, nas Opções e no service worker durante todo o teste.');
    S.check('Nenhum erro de JavaScript', pageErrors.length === 0, pageErrors.join(' | '));
    S.check('Requisições ao GLPI somente de leitura (GET)', [...world.methods].every((m) => m === 'GET' || m === 'OPTIONS'),
      `métodos vistos: ${[...world.methods].join(', ')} · ${world.requests.length} requisições, ${new Set(world.requests).size} rotas distintas`);
  }
  popup.close(); sw.close(); browser.close();
} catch (e) {
  report.error = e;
  const S = newStep('Falha inesperada no teste', 'O teste parou antes de terminar.');
  S.check('Execução completa', false, String(e?.stack ?? e).slice(0, 600));
} finally {
  proc?.kill('SIGKILL');
  await glpi?.close();
  await sleep(300);
  rmSync(work, { recursive: true, force: true });
}

const html = renderReport({
  browser: report.browser ?? 'Chromium',
  version: report.version ?? '?',
  when: new Date().toLocaleString('pt-BR'),
  seconds: ((Date.now() - t0) / 1000).toFixed(0),
});
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'index.html'), html);
if (process.env.E2E_COPY_TO) {
  mkdirSync(process.env.E2E_COPY_TO, { recursive: true });
  writeFileSync(join(process.env.E2E_COPY_TO, 'index.html'), html);
}

const all = steps.flatMap((s) => s.checks);
const failed = all.filter((c) => !c.ok);
console.log(`\n${steps.length} passos · ${all.length} verificações · ${all.length - failed.length} ok · ${failed.length} falha(s)`);
for (const c of failed) console.log(`  ✕ ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
console.log(`Relatório: ${join(OUT, 'index.html')}`);
process.exit(failed.length ? 1 : 0);
