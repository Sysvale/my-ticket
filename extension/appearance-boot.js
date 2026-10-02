// Aplica a aparência escolhida nas Opções (tema e neon) em <html>. Carregado por popup, opções e guia; o ui.css lê
// `data-theme` e `data-neon`. Acompanha a mudança na hora (storage) e a troca de tema do sistema.
import { getAppearance } from './src/store.js';
import { normalizeAppearance, rootAttributes } from './src/appearance.js';

const media = window.matchMedia('(prefers-color-scheme: dark)');
let current = normalizeAppearance(null);

function apply() {
  const attrs = rootAttributes(current, media.matches);
  const root = document.documentElement;
  if (attrs.theme) root.dataset.theme = attrs.theme;
  else delete root.dataset.theme;
  if (attrs.neon) root.dataset.neon = '';
  else delete root.dataset.neon;
}

media.addEventListener('change', apply);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.appearance) return;
  current = normalizeAppearance(changes.appearance.newValue);
  apply();
});
getAppearance().then((a) => {
  current = a;
  apply();
});
