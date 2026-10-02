// Seletor com busca e, se quiser, várias escolhas: o DOM em cima da lógica pura de picker.js.
// Faz o papel de um <select> que não aguenta lista grande: o botão mostra o que está escolhido e, ao abrir, uma busca
// filtra as opções. A lista abre num espaço `slot` fixo, dentro do fluxo (não flutua por cima), então o popup da
// extensão nunca a corta. Só um seletor fica aberto por vez. Padrão ARIA "combobox com listbox": o foco fica na busca e
// a opção ativa é indicada por aria-activedescendant. Nada vai por innerHTML: só h() e textContent.

import { h } from './dom.js';
import { initialIndex, searchOptions, stepIndex, statusText, summarize, toggleValue } from './picker.js';

let current = null; // o seletor aberto, se houver
export const closePickers = () => current?.close();

// Uma opção é { value, label, dot?, all? }; `all` marca a opção "sem escolha" dos seletores de escolha única.
// host: elemento que recebe o botão. slot: onde a lista aparece. all: texto sem escolha (ex.: "Qualquer tag").
// many(n): texto com várias escolhas (ex.: "3 tags"). onChange recebe o novo valor: lista (multiple) ou texto.
export function createPicker({ host, slot, id, label, multiple = false, all, many = (n) => `${n} escolhidas`, searchLabel, emptyLabel, onChange }) {
  const uid = `pk-${id}`;
  let options = [];
  let selected = [];
  let query = '';
  let shown = [];
  let active = -1;
  let open = false;
  let sig = '';

  const text = h('span', { class: 'pk-text', id: `${uid}-text` });
  const trigger = h('button', {
    type: 'button',
    class: 'pk-btn',
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    'aria-controls': `${uid}-pop`,
    'aria-labelledby': `${uid}-name ${uid}-text`,
    onclick: () => (open ? close({ restoreFocus: true }) : openPop()),
    onkeydown: (ev) => {
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      ev.preventDefault();
      if (!open) openPop();
    },
  }, text, h('span', { class: 'pk-caret', 'aria-hidden': 'true' }));
  host.classList.add('pk-field');
  host.replaceChildren(h('span', { class: 'sr', id: `${uid}-name` }, label), trigger);

  const status = h('span', { class: 'pk-status', 'aria-live': 'polite' });
  const input = h('input', {
    type: 'search',
    class: 'pk-search',
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'true',
    'aria-controls': `${uid}-list`,
    'aria-label': searchLabel,
    placeholder: `${searchLabel}…`,
    autocomplete: 'off',
    spellcheck: 'false',
    oninput: () => {
      query = input.value;
      rerender();
      active = shown.length ? 0 : -1; // a primeira que casa já fica pronta para o Enter
      syncActive(true);
      renderStatus();
    },
    onkeydown: (ev) => {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        active = stepIndex(active, ev.key === 'ArrowDown' ? 1 : -1, shown.length);
        syncActive(true);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        if (shown[active]) choose(shown[active].value);
      } else if (ev.key === 'Escape') {
        ev.preventDefault(); // o Esc de um campo de busca apagaria o texto; aqui ele só fecha
        ev.stopPropagation(); // e não deve fechar também o painel de tags ou a tela de detalhes
        close({ restoreFocus: true });
      }
    },
  });
  const list = h('ul', { class: 'pk-list', role: 'listbox', id: `${uid}-list`, 'aria-label': label, 'aria-multiselectable': multiple ? 'true' : null });
  const empty = h('p', { class: 'pk-empty', hidden: true }, emptyLabel);
  const foot = multiple
    ? h('div', { class: 'pk-foot' },
      h('button', { class: 'btn link', type: 'button', onclick: () => onChange([]) }, 'Limpar seleção'),
      h('button', { class: 'btn link', type: 'button', onclick: () => close({ restoreFocus: true }) }, 'Concluir'))
    : null;
  const pop = h('div', { class: 'pk-pop', id: `${uid}-pop` },
    h('div', { class: 'pk-head' }, h('span', { class: 'pk-title' }, label), status),
    input, list, empty, foot);

  // Clicar numa opção, na barra de rolagem ou num botão não pode tirar o foco da busca (senão o foco "saindo" fecharia a lista).
  pop.addEventListener('mousedown', (ev) => { if (ev.target !== input) ev.preventDefault(); });
  // Fecha quando o foco vai para fora do botão e da lista (Tab, clique em qualquer outro lugar).
  const leaves = (ev) => {
    const to = ev.relatedTarget;
    if (!to || !(pop.contains(to) || to === trigger)) close();
  };
  pop.addEventListener('focusout', leaves);
  trigger.addEventListener('focusout', leaves);

  function item(o, i) {
    return h('li', {
      class: 'pk-opt',
      role: 'option',
      id: `${uid}-o${i}`,
      'aria-selected': String(selected.includes(o.value)),
      'data-value': o.value,
      onmousemove: () => {
        if (active === i) return;
        active = i;
        syncActive(false);
      },
      onclick: () => choose(o.value),
    },
    multiple ? h('span', { class: 'pk-box', 'aria-hidden': 'true' }) : null,
    o.dot ? h('span', { class: `tag-dot ${o.dot.cls}`, style: o.dot.style, 'aria-hidden': 'true' }) : null,
    h('span', { class: 'pk-label', title: o.label }, o.label));
  }

  // Refaz a lista de opções (mudou o que existe ou a busca), mantendo a rolagem.
  function rerender() {
    const top = list.scrollTop;
    shown = searchOptions(options, query);
    list.replaceChildren(...shown.map(item));
    list.scrollTop = top;
    empty.hidden = shown.length > 0;
  }

  function syncActive(scroll) {
    [...list.children].forEach((li, i) => li.classList.toggle('is-active', i === active));
    const li = list.children[active];
    if (li) {
      input.setAttribute('aria-activedescendant', li.id);
      if (scroll) li.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function renderStatus() {
    // a opção "sem escolha" (`all: true`, ex.: "Todas as entidades") não entra na contagem
    status.textContent = statusText({
      shown: shown.filter((o) => !o.all).length,
      total: options.filter((o) => !o.all).length,
      selected: selected.length,
      multiple,
      searching: query.trim() !== '',
    });
  }

  function renderTrigger() {
    const s = summarize(options, selected, { all, many });
    text.textContent = s.text;
    if (s.labels.length > 1) trigger.title = s.labels.join(', '); // o botão só cabe a contagem: o tooltip diz quais
    else trigger.removeAttribute('title');
  }

  function choose(value) {
    if (multiple) {
      onChange(toggleValue(selected, value));
    } else {
      close({ restoreFocus: true });
      onChange(value);
    }
  }

  function openPop() {
    if (open) return;
    current?.close();
    open = true;
    current = picker;
    query = '';
    input.value = '';
    trigger.setAttribute('aria-expanded', 'true');
    host.classList.add('is-open');
    slot.replaceChildren(pop);
    rerender();
    active = initialIndex(shown, selected);
    syncActive(true);
    renderStatus();
    input.focus();
  }

  function close({ restoreFocus = false } = {}) {
    if (!open) return;
    open = false; // antes de tirar a lista da tela: sair dela dispara o focusout, que chamaria close() de novo
    if (current === picker) current = null;
    pop.remove();
    trigger.setAttribute('aria-expanded', 'false');
    host.classList.remove('is-open');
    if (restoreFocus) trigger.focus();
  }

  // `value`: lista (multiple) ou texto. Chamado a cada repintura da tela, então não mexe no que a pessoa está fazendo:
  // a lista aberta, o texto da busca e a opção ativa continuam como estão.
  function update({ options: next, value, visible = true }) {
    const nextSig = next.map((o) => `${o.value}\u0001${o.label}\u0001${o.dot?.cls ?? ''}\u0001${o.dot?.style ?? ''}`).join('\u0002');
    const changed = nextSig !== sig;
    sig = nextSig;
    options = next;
    selected = (Array.isArray(value) ? value : [value]).filter((v) => next.some((o) => o.value === v));
    host.hidden = !visible;
    if (!visible) close();
    renderTrigger();
    if (!open) return;
    if (changed) {
      const keep = shown[active]?.value;
      rerender();
      active = Math.max(0, shown.findIndex((o) => o.value === keep));
      if (!shown.length) active = -1;
    } else {
      [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(selected.includes(shown[i].value))));
    }
    syncActive(false);
    renderStatus();
  }

  const picker = { update, close, isOpen: () => open };
  return picker;
}
