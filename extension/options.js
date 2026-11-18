import { getConfig, setConfig } from './src/store.js';
import { HTTPS_ONLY_MESSAGE, isSecureUrl, normalizeBaseUrl, parseEnv } from './src/format.js';
import { SOUNDS } from './src/sounds.js';
import { demoResultText } from './src/diagnostics.js';
import { toast } from './src/toast.js';
import { selectTab } from './options-tabs.js';

const $ = (id) => document.getElementById(id);

// A versão que está instalada: a do manifest, lida em tempo de execução (nunca escrita à mão).
$('version').textContent = chrome.runtime.getManifest().version;

const ROLES = ['assigned', 'observer', 'requester'];
const NOTIFY = ['followup', 'solution', 'status', 'extra', 'new'];

$('sound-name').replaceChildren(...Object.entries(SOUNDS).map(([value, s]) => {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = s.label;
  return option;
}));

function setVolume(percent) {
  $('sound-volume').value = String(percent);
  $('sound-volume-out').textContent = `${percent}%`;
}

const readAttention = () => ({ flash: $('attn-flash').checked, sticky: $('attn-sticky').checked });

const readSound = () => ({
  enabled: $('sound-enabled').checked,
  name: $('sound-name').value,
  volume: Number($('sound-volume').value) / 100,
});

function fill(cfg) {
  $('baseUrl').value = cfg.baseUrl;
  $('appToken').value = cfg.appToken;
  $('userToken').value = cfg.userToken;
  $('pollMinutes').value = String(cfg.pollMinutes);
  $('extraField').value = cfg.extraField || '';
  $('notifyOwn').checked = cfg.notifyOwn;
  $('hideContent').checked = cfg.hideContent;
  $('attn-flash').checked = cfg.attention.flash;
  $('attn-sticky').checked = cfg.attention.sticky;
  $('sound-enabled').checked = cfg.sound.enabled;
  $('sound-name').value = cfg.sound.name;
  setVolume(Math.round(cfg.sound.volume * 100));
  for (const r of ROLES) $(`role-${r}`).checked = cfg.roles[r];
  for (const n of NOTIFY) $(`n-${n}`).checked = cfg.notify[n];
}

function read() {
  return {
    baseUrl: normalizeBaseUrl($('baseUrl').value),
    appToken: $('appToken').value.trim(),
    userToken: $('userToken').value.trim(),
    pollMinutes: Number($('pollMinutes').value),
    extraField: Number($('extraField').value) || 0,
    notifyOwn: $('notifyOwn').checked,
    hideContent: $('hideContent').checked,
    sound: readSound(),
    attention: readAttention(),
    roles: Object.fromEntries(ROLES.map((r) => [r, $(`role-${r}`).checked])),
    notify: Object.fromEntries(NOTIFY.map((n) => [n, $(`n-${n}`).checked])),
  };
}

// Devolve a config validada ou chama `fail(mensagem)` e devolve null. Recusa http://.
// Por padrão o erro vai para a caixa de resultado do formulário (Testar conexão).
function validated(fail = (msg) => show(msg, 'bad')) {
  const cfg = read();
  if (!cfg.baseUrl) {
    fail('Informe a URL do GLPI.');
    return null;
  }
  if (!isSecureUrl(cfg.baseUrl)) {
    fail(HTTPS_ONLY_MESSAGE);
    return null;
  }
  return cfg;
}

// Pede permissão de rede só para o host do GLPI informado (precisa de clique do usuário).
async function ensureHostPermission(baseUrl) {
  try {
    return await chrome.permissions.request({ origins: [`${new URL(baseUrl).origin}/*`] });
  } catch {
    return false;
  }
}

function show(text, kind, el = $('result')) {
  el.hidden = !text;
  el.className = `result ${kind ?? ''}`.trim();
  el.replaceChildren(...(Array.isArray(text) ? text : [text]).map((line) => {
    const p = document.createElement('div');
    p.textContent = line;
    return p;
  }));
}

// "Testar conexão" e o resultado dele só fazem sentido na aba Conexão
document.addEventListener('tabchange', (ev) => {
  $('test').hidden = ev.detail !== 'conexao';
  if (ev.detail !== 'conexao') show('');
});

$('import').addEventListener('click', () => $('envFile').click());
$('envFile').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  const env = parseEnv(await file.text());
  if (env.GLPI_TOKEN) $('userToken').value = env.GLPI_TOKEN;
  if (env.GLPI_APP_TOKEN) $('appToken').value = env.GLPI_APP_TOKEN;
  if (env.GLPI_BASE_URL) $('baseUrl').value = env.GLPI_BASE_URL;
  const found = ['GLPI_TOKEN', 'GLPI_APP_TOKEN'].filter((k) => env[k]).length;
  show(found === 2 ? 'Tokens importados. Clique em “Testar conexão” e depois em “Salvar”.'
    : 'O arquivo não tem GLPI_TOKEN e GLPI_APP_TOKEN.', found === 2 ? 'ok' : 'bad');
});

$('test').addEventListener('click', async () => {
  const cfg = validated();
  if (!cfg) return;
  show('Testando…');
  if (!(await ensureHostPermission(cfg.baseUrl))) {
    return show('Sem permissão de acesso ao site do GLPI. Aceite o pedido do navegador.', 'bad');
  }
  const r = await chrome.runtime.sendMessage({ type: 'test', config: cfg });
  if (!r?.ok) return show(r?.error ?? 'Falha desconhecida.', 'bad');
  show([
    `Conectado como ${r.user.name || 'usuário'} (id ${r.user.id})${r.version ? ` · GLPI ${r.version}` : ''}.`,
    `Tickets em aberto no seu radar: ${r.counts.assigned} atribuído(s), ${r.counts.observer} como observador, ${r.counts.requester} aberto(s) por você.`,
  ], 'ok');
});

// Salvar avisa sempre, com um toast: o que só aparecia no fim da página passava despercebido.
const saveFailed = (text) => toast({ id: 'save', kind: 'bad', title: 'Não foi possível salvar', text });

$('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const cfg = validated((msg) => {
    saveFailed(msg);
    selectTab('conexao'); // o campo da URL mora nessa aba, e um campo escondido não recebe foco
    $('baseUrl').focus();
  });
  if (!cfg) return;
  if (!(await ensureHostPermission(cfg.baseUrl))) {
    selectTab('conexao');
    return saveFailed('Sem permissão de acesso ao site do GLPI. Aceite o pedido do navegador.');
  }
  try {
    await setConfig(cfg);
  } catch {
    return saveFailed('O navegador recusou gravar as configurações. Tente de novo.');
  }
  $('baseUrl').value = cfg.baseUrl;
  show('');
  toast({ id: 'save', kind: 'ok', title: 'Configurações salvas' });
  chrome.runtime.sendMessage({ type: 'poll-now' });
});

// Dispara uma notificação real de cada tipo, com dados fictícios (o trabalho é do background).
$('demo').addEventListener('click', async () => {
  const btn = $('demo');
  const status = $('demo-status');
  btn.disabled = true;
  status.textContent = 'Enviando os exemplos, um por segundo…';
  try {
    const r = await chrome.runtime.sendMessage({ type: 'demo-notifications', hideContent: $('hideContent').checked, sound: readSound(), attention: readAttention() });
    status.textContent = demoResultText(r);
  } catch {
    status.textContent = 'Não foi possível falar com a extensão. Recarregue-a em chrome://extensions.';
  } finally {
    btn.disabled = false;
  }
});

$('sound-volume').addEventListener('input', (ev) => setVolume(ev.target.value));

// Toca o som escolhido (mesmo desligado na tela) para a pessoa ouvir antes de salvar.
$('sound-test').addEventListener('click', async () => {
  const status = $('sound-status');
  status.textContent = '';
  try {
    await chrome.runtime.sendMessage({ type: 'play-sound', sound: readSound() });
  } catch {
    status.textContent = 'Não foi possível falar com a extensão. Recarregue-a em chrome://extensions.';
  }
});

// Apaga tudo o que a extensão guarda neste navegador (o trabalho pesado é do background,
// que espera o polling em andamento terminar para ele não regravar o cache).
$('wipe').addEventListener('click', async () => {
  const ok = confirm(
    'Apagar credenciais, preferências, tags personalizadas e todos os dados locais do MyTicket neste navegador?\n\n'
    + 'As suas tags e as marcações nos tickets serão perdidas (exporte antes em “Tags dos tickets”, se quiser guardá-las).\n'
    + 'Nada é alterado no GLPI.',
  );
  if (!ok) return;
  const r = await chrome.runtime.sendMessage({ type: 'wipe' });
  fill(await getConfig());
  show('', '', $('result')); // some qualquer mensagem antiga do formulário
  const target = $('wipe-result');
  if (r?.ok) {
    show([
      'Credenciais, tags e dados locais apagados deste navegador.',
      'O token continua válido no GLPI: para invalidá-lo, gere outro em Preferências → “Chave de acesso remoto”.',
    ], 'ok', target);
  } else {
    show('Não foi possível apagar os dados locais.', 'bad', target);
  }
});

getConfig().then(fill);
