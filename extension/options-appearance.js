// Aba "Aparência" das Opções: tema, efeito neon e destaque de tickets parados. Age na hora, sem "Salvar". Quem aplica o resultado nas páginas é o
// appearance-boot.js (que ouve o storage), então aqui só se lê e se grava.
import { getAppearance, updateAppearance } from './src/store.js';
import { THEMES } from './src/appearance.js';
import { normalizeStale } from './src/stale.js';
import { formatSpan } from './src/timeshare.js';

const $ = (id) => document.getElementById(id);
const radios = () => [...document.querySelectorAll('input[name="theme"]')];

const HOUR = 3600_000;
const span = (hours) => formatSpan(hours * HOUR);
let notice = ''; // aviso de valor corrigido: guardado aqui porque o storage repreenche os campos logo depois de gravar

function fill(a) {
  for (const r of radios()) r.checked = r.value === a.theme;
  $('neon').checked = a.neon;
  fillStale(a.stale);
}

function fillStale(stale) {
  $('stale-enabled').checked = stale.enabled;
  $('stale-amber').value = String(stale.amberHours);
  $('stale-red').value = String(stale.redHours);
  $('stale-sample-amber').textContent = `parado há ${span(stale.amberHours)}`;
  $('stale-sample-red').textContent = `parado há ${span(stale.redHours)}`;
  const base = stale.enabled
    ? `Amarelo a partir de ${span(stale.amberHours)} e vermelho a partir de ${span(stale.redHours)} sem movimentação.`
    : 'Desligado: nenhum ticket é destacado.';
  $('stale-hint').textContent = notice ? `${base} ${notice}` : base;
}

for (const r of radios()) {
  r.addEventListener('change', () => {
    if (r.checked && THEMES.includes(r.value)) updateAppearance((a) => { a.theme = r.value; });
  });
}
$('neon').addEventListener('change', (ev) => updateAppearance((a) => { a.neon = ev.target.checked; }));

$('stale-enabled').addEventListener('change', (ev) => {
  notice = '';
  updateAppearance((a) => { a.stale.enabled = ev.target.checked; });
});
// Ao terminar de digitar um limite, grava já corrigido (1 a 8760 horas, vermelho depois do amarelo) e mostra o que valeu.
for (const id of ['stale-amber', 'stale-red']) {
  $(id).addEventListener('change', async () => {
    const wanted = { amberHours: Number($('stale-amber').value), redHours: Number($('stale-red').value) };
    const saved = await updateAppearance((a) => { a.stale = normalizeStale({ ...a.stale, ...wanted }); });
    const corrected = saved.stale.amberHours !== wanted.amberHours || saved.stale.redHours !== wanted.redHours;
    notice = corrected ? '(Ajustei os valores: de 1 a 8760 horas, e o vermelho precisa vir depois do amarelo.)' : '';
    fillStale(saved.stale);
  });
}

// o mesmo valor também chega por aqui quando outra janela (ou "Apagar dados") muda a aparência
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'appearance' in changes) getAppearance().then(fill);
});
getAppearance().then(fill);
