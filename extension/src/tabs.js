// Abas da página de Opções: lógica pura (qual aba abrir, como o teclado navega). O DOM fica em options-tabs.js.
export const TABS = ['conexao', 'avisos', 'aparencia', 'tags', 'dados'];
export const DEFAULT_TAB = 'conexao';

// Abas que fazem parte do formulário e valem com "Salvar". Aparência, Tags e Dados locais agem na hora, sem a barra de salvar.
export const FORM_TABS = new Set(['conexao', 'avisos']);

// "#tags" -> 'tags'. Qualquer outra coisa (vazio, lixo, "#outra") -> null, para quem chamou escolher a aba padrão.
export function tabFromHash(hash) {
  const id = String(hash ?? '').replace(/^#/, '');
  return TABS.includes(id) ? id : null;
}

// Setas, Home e End movem entre as abas (circular). Outra tecla -> null.
export function tabAfterKey(current, key) {
  const i = TABS.indexOf(current);
  if (i < 0) return null;
  switch (key) {
    case 'ArrowRight': return TABS[(i + 1) % TABS.length];
    case 'ArrowLeft': return TABS[(i - 1 + TABS.length) % TABS.length];
    case 'Home': return TABS[0];
    case 'End': return TABS.at(-1);
    default: return null;
  }
}
