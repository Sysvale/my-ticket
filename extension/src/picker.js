// Seletor com busca (e, opcionalmente, várias escolhas): lógica pura, sem DOM nem chrome.*, testada em Node.
// O DOM fica em picker-ui.js. Uma opção é { value, label, dot?, all? }: `dot` é a cor da tag ({ cls, style }) e `all` marca a opção "sem escolha".

import { normalizeText } from './filters.js';

// Opções cujo texto contém todas as palavras da busca, sem diferenciar acento nem maiúscula ("nao gera" acha "Não gera").
// Busca vazia devolve tudo, na ordem original.
export function searchOptions(options, query) {
  const words = normalizeText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return options;
  return options.filter((o) => {
    const hay = normalizeText(o.label);
    return words.every((w) => hay.includes(w));
  });
}

// Marca ou desmarca `value` numa seleção (lista), sem alterar a original e mantendo a ordem em que foram marcados.
export function toggleValue(selected, value) {
  return selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
}

// Próximo item ativo ao andar com as setas: dá a volta nas pontas. Sem itens, -1; sem item ativo ainda (-1), ↓ vai
// para o primeiro e ↑ para o último.
export function stepIndex(index, delta, length) {
  if (length <= 0) return -1;
  if (index < 0) return delta >= 0 ? 0 : length - 1;
  return (index + delta + length) % length;
}

// Qual item começa ativo ao abrir: o primeiro selecionado que aparece na lista, ou o primeiro.
export function initialIndex(options, selected) {
  const i = options.findIndex((o) => selected.includes(o.value));
  return i >= 0 ? i : options.length ? 0 : -1;
}

// Texto do botão fechado. Nada marcado = `all` ("Qualquer tag"); uma escolha mostra o nome dela; várias, a contagem
// (`many(n)`, ex.: "3 tags"). `selected` só traz valores que existem em `options` (o resto é ignorado).
export function summarize(options, selected, { all, many }) {
  const labels = options.filter((o) => selected.includes(o.value)).map((o) => o.label);
  if (!labels.length) return { text: all, labels };
  return { text: labels.length === 1 ? labels[0] : many(labels.length), labels };
}

// Texto de apoio do cabeçalho da lista (lido por leitores de tela quando muda). Escolha única, sem busca: nada a dizer.
export function statusText({ shown, total, selected, multiple, searching }) {
  if (searching) return shown ? `${shown} de ${total}` : 'Nenhum resultado';
  if (!multiple) return '';
  return selected ? `${selected} ${selected === 1 ? 'marcada' : 'marcadas'}` : `${total} ${total === 1 ? 'opção' : 'opções'}`;
}
