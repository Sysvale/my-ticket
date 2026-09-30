// Seção "Tags dos tickets" das Opções: criar, renomear, recolorir, mudar o tipo, reordenar, apagar, restaurar
// os padrões e exportar/importar. Diferente do resto da página, aqui cada mudança vale na hora (sem "Salvar").
// Tudo fica em chrome.storage.local (chave `tags`): nunca vai ao GLPI nem sincroniza.
import { getTags, updateTags } from './src/store.js';
import {
  COLOR_ERROR, COLOR_LABEL, LIMITS, TAG_COLORS,
  createTag, defsOf, deleteTag, editTag, exportTags, importTags, moveTag, restoreDefaults,
} from './src/tags.js';
import { h, tagColor } from './src/dom.js';
import { isHex, normalizeHex } from './src/color.js';
import { toast } from './src/toast.js';

const $ = (id) => document.getElementById(id);
const colorOptions = () => TAG_COLORS.map((c) => h('option', { value: c }, COLOR_LABEL[c]));
const say = (kind, title, text) => toast({ id: 'tags', kind, title, text });

const CUSTOM = 'custom';
const DEFAULT_CUSTOM = '#6366f1'; // ponto de partida ao escolher "Personalizada…"

// Seletor de cor: a paleta, mais "Personalizada…" (hexadecimal digitado, ou o seletor de cores do navegador).
// `commit(cor)` recebe sempre uma cor válida (nome da paleta ou #rrggbb); sem `commit` (formulário de nova tag) o
// valor só fica guardado, e `get()` devolve o que foi escolhido, ou null se o campo de hexadecimal está com algo
// inválido (mesmo sem a pessoa ter confirmado com Enter/Tab). O hex digitado é validado antes de virar CSS.
function colorControl({ value, label, commit }) {
  let current = value;
  const select = h('select', { 'aria-label': label }, ...colorOptions(), h('option', { value: CUSTOM }, 'Personalizada…'));
  const text = h('input', { type: 'text', class: 'hex', maxlength: '7', placeholder: '#rrggbb', spellcheck: 'false', 'aria-label': `${label}: hexadecimal` });
  const picker = h('input', { type: 'color', 'aria-label': `${label}: escolher no seletor de cores` });
  const show = () => {
    const custom = isHex(current);
    select.value = custom ? CUSTOM : current;
    text.hidden = !custom;
    picker.hidden = !custom;
    if (custom) {
      text.value = current;
      picker.value = current;
    }
    text.setAttribute('aria-invalid', 'false');
  };
  // o que vale agora: lê o campo de hexadecimal na hora, sem esperar o "change" (Enter no formulário não o dispara)
  const read = () => {
    if (text.hidden) return current;
    const hex = normalizeHex(text.value);
    if (hex) current = hex;
    return hex;
  };
  const choose = (next) => { current = next; show(); commit?.(current); };

  select.addEventListener('change', () => choose(select.value === CUSTOM ? (isHex(current) ? current : DEFAULT_CUSTOM) : select.value));
  text.addEventListener('change', () => {
    const hex = normalizeHex(text.value);
    if (hex) return choose(hex);
    say('bad', 'Cor inválida', COLOR_ERROR);
    text.value = current; // desfaz o que foi digitado
    return undefined;
  });
  text.addEventListener('input', () => text.setAttribute('aria-invalid', String(!normalizeHex(text.value)))); // avisa enquanto digita
  picker.addEventListener('input', () => { text.value = picker.value; text.setAttribute('aria-invalid', 'false'); }); // prévia, sem gravar
  picker.addEventListener('change', () => choose(picker.value));
  show();
  return { element: h('span', { class: 'colorctl' }, select, text, picker), get: read };
}

const newColor = colorControl({ value: TAG_COLORS[0], label: 'Cor da nova tag' });
$('tag-new-color').replaceWith(newColor.element);
newColor.element.id = 'tag-new-color';

// Roda a alteração no storage. `mutate` devolve { ok, error } (ou um booleano); em erro nada é gravado.
async function change(mutate) {
  let outcome;
  await updateTags((t) => {
    outcome = mutate(t);
    if (outcome === false || outcome?.ok === false) return false;
    return undefined;
  });
  render(await getTags()); // também desfaz o que foi digitado de inválido
  return outcome;
}

async function edit(id, patch) {
  const r = await change((t) => editTag(t, id, patch));
  if (r.ok) say('ok', 'Tag salva');
  else say('bad', 'Não foi possível salvar a tag', r.error);
}

async function remove(def) {
  if (!confirm(`Apagar a tag “${def.name}”?\n\nEla sai de todos os tickets em que está marcada.`)) return;
  await change((t) => deleteTag(t, def.id));
  say('ok', 'Tag apagada');
}

function row(def, index, total) {
  return h('li', { class: 'tag-row' },
    h('span', {
      class: `tag-dot ${tagColor(def.color).cls}`,
      style: tagColor(def.color).style,
      title: def.stage ? 'Etapa' : 'Etiqueta',
      role: 'img',
      'aria-label': `Cor: ${COLOR_LABEL[def.color] ?? def.color}`,
    }),
    h('input', {
      type: 'text', value: def.name, maxlength: String(LIMITS.name), 'aria-label': `Nome da tag ${def.name}`,
      onchange: (ev) => edit(def.id, { name: ev.target.value }),
    }),
    (() => {
      const kind = h('select', { 'aria-label': `Tipo da tag ${def.name}`, onchange: (ev) => edit(def.id, { stage: ev.target.value === 'stage' }) },
        h('option', { value: 'label' }, 'Etiqueta'), h('option', { value: 'stage' }, 'Etapa'));
      kind.value = def.stage ? 'stage' : 'label';
      return kind;
    })(),
    colorControl({ value: def.color, label: `Cor da tag ${def.name}`, commit: (color) => edit(def.id, { color }) }).element,
    h('button', { class: 'icon', type: 'button', title: 'Subir', 'aria-label': `Subir ${def.name}`, disabled: index === 0, onclick: () => change((t) => moveTag(t, def.id, -1)) }, '↑'),
    h('button', { class: 'icon', type: 'button', title: 'Descer', 'aria-label': `Descer ${def.name}`, disabled: index === total - 1, onclick: () => change((t) => moveTag(t, def.id, 1)) }, '↓'),
    h('button', { class: 'icon', type: 'button', title: 'Apagar', 'aria-label': `Apagar ${def.name}`, onclick: () => remove(def) }, '✕'));
}

function render(tags) {
  const defs = defsOf(tags);
  const tickets = Object.keys(tags.assign).length;
  $('tags-list').replaceChildren(...(defs.length
    ? defs.map((d, i) => row(d, i, defs.length))
    : [h('li', { class: 'note' }, 'Nenhuma tag. Crie uma abaixo ou restaure as padrão.')]));
  $('tags-restore').title = `${defs.length} de ${LIMITS.tags} tags · ${tickets} ticket(s) com marcação`;
}

$('tag-new').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = $('tag-new-name');
  const color = newColor.get();
  if (color === null) { // hexadecimal inválido no campo: não cria a tag com outra cor em silêncio
    say('bad', 'Cor inválida', COLOR_ERROR);
    newColor.element.querySelector('input.hex').focus();
    return;
  }
  const r = await change((t) => createTag(t, {
    name: name.value, stage: $('tag-new-kind').value === 'stage', color,
  }));
  if (r.ok) {
    name.value = '';
    say('ok', 'Tag criada');
  } else {
    say('bad', 'Não foi possível criar a tag', r.error);
    name.focus();
  }
});

$('tags-restore').addEventListener('click', async () => {
  let added = 0;
  await change((t) => { added = restoreDefaults(t); return added > 0 ? undefined : false; });
  if (added) say('ok', `${added} tag(s) padrão devolvida(s)`);
  else say('info', 'Nenhuma tag padrão para restaurar');
});

// Baixa um arquivo com as tags (defs e marcações). Só números de ticket e nomes de tag: nenhum token.
$('tags-export').addEventListener('click', async () => {
  const blob = new Blob([exportTags(await getTags())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: `myticket-tags-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say('ok', 'Tags exportadas', 'Guarde o arquivo: é ele que recupera as tags se elas se perderem.');
});

$('tags-import').addEventListener('click', () => $('tags-file').click());
$('tags-file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  if (!confirm('Importar este arquivo substitui as suas tags atuais e as marcações nos tickets.\n\nContinuar?')) return;
  const text = await file.text();
  const r = await change((t) => importTags(t, text));
  if (r.ok) say('ok', 'Tags importadas', `${r.tags} tag(s), ${r.tickets} ticket(s) com marcação.`);
  else say('bad', 'Não foi possível importar', r.error);
});

// Mudança vinda de fora (popup, apagar dados): atualiza a lista, sem atrapalhar quem está digitando nela.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.tags && !$('tags-list').contains(document.activeElement)) getTags().then(render);
});

getTags().then(render);
