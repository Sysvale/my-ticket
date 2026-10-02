// Aba "Aparência" das Opções: tema e efeito neon. Age na hora, sem "Salvar". Quem aplica o resultado nas páginas é o
// appearance-boot.js (que ouve o storage), então aqui só se lê e se grava.
import { getAppearance, updateAppearance } from './src/store.js';
import { THEMES } from './src/appearance.js';

const $ = (id) => document.getElementById(id);
const radios = () => [...document.querySelectorAll('input[name="theme"]')];

function fill(a) {
  for (const r of radios()) r.checked = r.value === a.theme;
  $('neon').checked = a.neon;
}

for (const r of radios()) {
  r.addEventListener('change', () => {
    if (r.checked && THEMES.includes(r.value)) updateAppearance((a) => { a.theme = r.value; });
  });
}
$('neon').addEventListener('change', (ev) => updateAppearance((a) => { a.neon = ev.target.checked; }));

// o mesmo valor também chega por aqui quando outra janela (ou "Apagar dados") muda a aparência
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'appearance' in changes) getAppearance().then(fill);
});
getAppearance().then(fill);
