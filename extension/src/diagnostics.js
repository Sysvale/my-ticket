// Verificações do "Guia de notificações": o que precisa estar certo para os avisos aparecerem.
// Puro (recebe os fatos já coletados), para poder ser testado em Node.
import { failedLabel, isSecureUrl, timeAgo } from './format.js';
import { SOUNDS, normalizeSoundConfig } from './sounds.js';
import { isConfigured } from './store.js';

export const NOTIFY_LABEL = {
  followup: 'respostas',
  solution: 'soluções',
  status: 'mudanças de status',
  extra: 'Status extra',
  new: 'tickets novos',
};

// Passos no Windows: não dá para detectar daqui, então viram checklist manual.
export const WINDOWS_STEPS = [
  'Configurações do Windows → Sistema → Notificações: a chave “Notificações” precisa estar ligada.',
  'Na mesma tela, na lista de apps, “Google Chrome” precisa estar ligado, com “Mostrar banners de notificação” ativo.',
  'Desligue o Assistente de foco / Não Perturbe (ele também liga sozinho em tela cheia e ao compartilhar a tela).',
  'Abra a Central de Notificações (Win + N): se os avisos estiverem lá, só os banners estão desligados.',
  'Em máquina gerenciada pela empresa, confira também chrome://policy.',
];

const item = (id, level, title, detail, fix) => ({ id, level, title, detail, fix });

export function buildChecks({ cfg, state, user, permission, hostGranted, now = Date.now() }) {
  const out = [];

  // 1) O Chrome deixa a extensão notificar?
  if (permission === 'granted') {
    out.push(item('chrome', 'ok', 'Notificações da extensão no Chrome', 'Permitidas.'));
  } else if (permission === 'denied') {
    out.push(item('chrome', 'bad', 'Notificações da extensão no Chrome',
      'O Chrome informa que estão desativadas para esta extensão.',
      'Ative em Configurações do Windows → Sistema → Notificações → Google Chrome. Se a empresa gerencia o navegador, confira também chrome://policy.'));
  } else {
    out.push(item('chrome', 'warn', 'Notificações da extensão no Chrome', 'Não foi possível verificar.'));
  }

  // 2) Credenciais
  const configured = isConfigured(cfg);
  if (!configured) {
    out.push(item('conexao', 'bad', 'Conexão com o GLPI', 'Faltam a URL ou os tokens.',
      'Preencha em Opções → Conexão com o GLPI e clique em Salvar.'));
  } else if (!isSecureUrl(cfg.baseUrl)) {
    out.push(item('conexao', 'bad', 'Conexão com o GLPI', 'A URL precisa começar com https://.',
      'Corrija a URL em Opções → Conexão com o GLPI e clique em Salvar.'));
  } else {
    let host = cfg.baseUrl;
    try { host = new URL(cfg.baseUrl).host; } catch { /* mantém a URL como veio */ }
    out.push(item('conexao', 'ok', 'Conexão com o GLPI', `Configurada para ${host}.`));
  }

  // 3) O Chrome deixou a extensão falar com o site do GLPI?
  if (hostGranted === true) {
    out.push(item('acesso', 'ok', 'Acesso ao site do GLPI', 'Concedido pelo Chrome.'));
  } else if (hostGranted === false) {
    out.push(item('acesso', 'bad', 'Acesso ao site do GLPI',
      'O Chrome ainda não deu acesso ao site do GLPI; sem ele a extensão não consegue consultar os tickets.',
      'Abra as Opções, clique em Salvar e aceite o pedido de permissão do Chrome.'));
  } else {
    out.push(item('acesso', 'warn', 'Acesso ao site do GLPI', 'Será pedido ao salvar a conexão nas Opções.'));
  }

  // 4) A verificação está rodando?
  const run = state?.lastRun;
  const maxAgeMs = Math.max(cfg.pollMinutes * 3, 10) * 60_000;
  if (user?.paused) {
    const since = user.pausedAt ? ` ${timeAgo(user.pausedAt, now)}` : '';
    out.push(item('verificacao', 'warn', 'Verificação dos tickets', `A sincronização está pausada${since}: nada é buscado nem avisado.`,
      'Clique em “Retomar” no popup da extensão (botão de pausa, no alto).'));
  } else if (!run) {
    out.push(item('verificacao', 'warn', 'Verificação dos tickets', 'Ainda não houve nenhuma verificação.',
      configured ? 'Clique em “Atualizar agora” no popup da extensão.' : 'Configure a conexão primeiro.'));
  } else if (!run.ok) {
    out.push(item('verificacao', 'bad', 'Verificação dos tickets', `A última verificação falhou: ${run.error}`,
      'Confira a rede/VPN e clique em “Testar conexão” nas Opções.'));
  } else if (now - run.at > maxAgeMs) {
    out.push(item('verificacao', 'warn', 'Verificação dos tickets',
      `Última verificação ${timeAgo(run.at, now)}; era para rodar a cada ${cfg.pollMinutes} min.`,
      'O computador pode ter ficado em repouso ou o Chrome estava fechado. Clique em “Atualizar agora” no popup.'));
  } else if (run.failed?.length) {
    out.push(item('verificacao', 'warn', 'Verificação dos tickets',
      `Última verificação ${timeAgo(run.at, now)}, mas ${failedLabel(run.failed)}.`,
      'O GLPI respondeu com erro ao ler esses tickets. Abra-os no GLPI e, se o erro continuar, avise quem cuida do GLPI. A extensão tenta de novo a cada verificação e os demais tickets seguem sendo avisados.'));
  } else {
    out.push(item('verificacao', 'ok', 'Verificação dos tickets',
      `Última verificação ${timeAgo(run.at, now)} (${run.count} ticket(s)), a cada ${cfg.pollMinutes} min.`));
  }

  // 5) Algum tipo de aviso ligado?
  const on = Object.keys(NOTIFY_LABEL).filter((k) => cfg.notify?.[k]);
  if (!on.length) {
    out.push(item('tipos', 'bad', 'Tipos de aviso', 'Todos os tipos estão desligados.',
      'Ligue ao menos um em Opções → Avisar quando…'));
  } else {
    out.push(item('tipos', 'ok', 'Tipos de aviso', `Ligados: ${on.map((k) => NOTIFY_LABEL[k]).join(', ')}.`));
  }

  // 6) Som
  const sound = normalizeSoundConfig(cfg.sound);
  if (!sound.enabled) {
    out.push(item('som', 'ok', 'Aviso sonoro', 'Desligado; o Windows toca o som padrão dele, se estiver ativo.'));
  } else if (sound.volume <= 0) {
    out.push(item('som', 'warn', 'Aviso sonoro', 'Ligado, mas com o volume em 0%.', 'Aumente o volume em Opções → Som.'));
  } else {
    out.push(item('som', 'ok', 'Aviso sonoro',
      `Ligado: ${SOUNDS[sound.name].label}, volume ${Math.round(sound.volume * 100)}%. O volume final ainda depende do mixer do Windows.`));
  }

  // 7) Windows (manual)
  out.push(item('windows', 'manual', 'Windows', 'Não dá para verificar daqui. Confira estes pontos:', WINDOWS_STEPS));

  return out;
}

// Texto exibido depois de "Ver exemplos de notificação" (Opções e Guia usam o mesmo).
export function demoResultText(r) {
  if (!r?.ok) return `Não foi possível enviar: ${r?.error ?? 'erro desconhecido'}`;
  if (r.permission === 'denied') {
    return 'O Chrome informa que as notificações desta extensão estão desativadas. '
      + 'Ative em Configurações do Windows → Sistema → Notificações → Google Chrome.';
  }
  return `${r.count} exemplos enviados. Se nada apareceu, confira as notificações do Google Chrome no `
    + 'Windows (Configurações → Sistema → Notificações) e o modo Não Perturbe / Assistente de foco.';
}
