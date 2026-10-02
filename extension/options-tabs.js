// Abas da página de Opções (lógica pura em src/tabs.js). Conexão e Avisos fazem parte do formulário e valem com
// "Salvar"; Aparência, Tags e Dados locais agem na hora, então o formulário (com a barra de salvar) some nelas.
// O link "#tags" abre a aba Tags, e a aba escolhida vai para o endereço (recarregar mantém a aba).
import { DEFAULT_TAB, FORM_TABS, TABS, tabAfterKey, tabFromHash } from './src/tabs.js';

const $ = (id) => document.getElementById(id);
let current = null;

export function selectTab(id, { focus = false, updateHash = true } = {}) {
  const tab = TABS.includes(id) ? id : DEFAULT_TAB;
  current = tab;
  for (const t of TABS) {
    const on = t === tab;
    const button = $(`tabbtn-${t}`);
    button.setAttribute('aria-selected', String(on));
    button.tabIndex = on ? 0 : -1; // só a aba atual entra na ordem do Tab; as setas andam entre elas
    $(`tab-${t}`).hidden = !on;
  }
  // Conexão e Avisos são painéis dentro do formulário; para Aparência, Tags e Dados o formulário inteiro (e a barra de salvar) some.
  $('form').hidden = !FORM_TABS.has(tab);
  if (focus) $(`tabbtn-${tab}`).focus();
  if (updateHash && location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  document.dispatchEvent(new CustomEvent('tabchange', { detail: tab }));
}

for (const t of TABS) $(`tabbtn-${t}`).addEventListener('click', () => selectTab(t));

$('tabbtn-conexao').closest('[role="tablist"]').addEventListener('keydown', (ev) => {
  const next = tabAfterKey(current, ev.key);
  if (!next) return;
  ev.preventDefault();
  selectTab(next, { focus: true });
});

// links internos (ex.: "Exportar tags" no aviso de Dados locais) e o botão voltar
window.addEventListener('hashchange', () => {
  const id = tabFromHash(location.hash);
  if (id && id !== current) selectTab(id, { updateHash: false });
});

selectTab(tabFromHash(location.hash) ?? DEFAULT_TAB, { updateHash: false });
document.body.dataset.tabs = 'ready'; // marca de que as abas já foram montadas (os testes esperam por ela)
