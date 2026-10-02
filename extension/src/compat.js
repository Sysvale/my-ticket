// Diferenças entre Chrome/Edge e Firefox que o resto do código precisa conhecer (puro: recebe o que precisa).

// As páginas da extensão no Firefox vivem em moz-extension://; no Chrome e no Edge, em chrome-extension://.
// Não usa o objeto `browser`: o Chrome mais novo também passou a expô-lo.
export const isFirefox = (runtime = globalThis.chrome?.runtime) =>
  String(runtime?.getURL?.('') ?? '').startsWith('moz-extension:');

const BASIC_KEYS = ['type', 'title', 'message', 'iconUrl'];

// O Firefox só aceita type, title, message e iconUrl em notifications.create(): qualquer outra propriedade
// (buttons, priority, silent, requireInteraction, contextMessage) faz a criação falhar. Sem botões, clicar no
// aviso já abre o ticket e marca como lido; sem contextMessage, a entidade vai numa segunda linha da mensagem
// (vazia com "ocultar conteúdo", então nada a mais aparece nesse modo).
export function notificationOptionsFor(opts, { firefox = false } = {}) {
  if (!firefox) return opts;
  const out = {};
  for (const key of BASIC_KEYS) if (opts[key] !== undefined) out[key] = opts[key];
  if (opts.contextMessage) out.message = `${opts.message}\n${opts.contextMessage}`;
  return out;
}

// A descrição das sugestões da barra de endereços é XML no Chrome/Edge (precisa escapar &, < e >); no Firefox é texto
// puro, e escapar mostraria "&amp;" na tela.
export function omniboxText(text, { firefox = false } = {}) {
  const s = String(text ?? '');
  return firefox ? s : s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
