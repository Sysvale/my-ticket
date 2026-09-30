// Aviso rápido (toast) no canto da tela, para dar retorno de uma ação (ex.: Salvar nas Opções).
// Só DOM e textContent: nada do que é exibido passa por innerHTML. O DOM só é tocado quando toast() é chamado.
// As classes são .snack/.snacks, e não .toast, que no ui.css é a simulação do toast do Windows no Guia.

const GLYPH = { ok: '✓', bad: '!', info: 'i' };
const DURATION = { ok: 4000, info: 4000, bad: 9000 }; // erro fica mais tempo: a pessoa precisa ler e agir
const MIN_LEFT_MS = 1500; // depois de tirar o mouse, sempre sobra um tempo para terminar de ler
const LEAVE_MS = 180; // mesmo tempo da transição de saída no ui.css

function host() {
  let el = document.getElementById('snacks');
  if (!el) {
    el = document.createElement('div');
    el.id = 'snacks';
    el.className = 'snacks';
    document.body.append(el);
  }
  return el;
}

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

// kind: 'ok' | 'bad' | 'info'. Com `id`, um aviso novo substitui o anterior de mesmo id
// (clicar em Salvar duas vezes não empilha dois avisos). Devolve a função que fecha o aviso.
export function toast({ id, kind = 'ok', title, text = '', duration = DURATION[kind] ?? DURATION.info }) {
  const root = host();
  if (id) [...root.children].find((c) => c.dataset.id === id)?.remove();

  const el = node('div', `snack ${kind}${text ? '' : ' solo'}`); // "solo": só o título, alinhado ao centro
  el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  if (id) el.dataset.id = id;

  const ico = node('span', 'ico', GLYPH[kind] ?? GLYPH.info);
  ico.setAttribute('aria-hidden', 'true');
  const body = node('div', 'body');
  body.append(node('strong', '', title));
  if (text) body.append(node('span', 'msg', text));
  const close = node('button', 'x', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fechar aviso');
  el.append(ico, body, close);

  let left = duration;
  let startedAt = 0;
  let timer = null;
  let gone = false;

  function dismiss() {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    el.classList.add('leaving');
    setTimeout(() => el.remove(), LEAVE_MS);
  }
  const run = () => {
    startedAt = Date.now();
    timer = setTimeout(dismiss, left);
  };
  // Com o mouse ou o foco em cima, o tempo para de correr: dá para ler com calma.
  const pause = () => {
    if (gone || timer == null) return;
    clearTimeout(timer);
    timer = null;
    left -= Date.now() - startedAt;
  };
  const resume = () => {
    if (gone || timer != null) return;
    left = Math.max(left, MIN_LEFT_MS);
    run();
  };

  close.addEventListener('click', dismiss);
  el.addEventListener('mouseenter', pause);
  el.addEventListener('mouseleave', resume);
  el.addEventListener('focusin', pause);
  el.addEventListener('focusout', resume);

  root.append(el);
  run();
  return dismiss;
}
