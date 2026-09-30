import { isHex, themed } from './color.js';
import { TAG_COLORS } from './tags.js';

// Monta DOM só com textContent e atributos: nada do GLPI (nem nome de tag) passa por innerHTML.
// `on<evento>` com função vira addEventListener; false/null/undefined são ignorados (atributos e filhos).
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
}

// Classe (e, para cor em hexadecimal, as variáveis de cor) de uma tag. Só #rrggbb validado entra no style, e o
// contraste é ajustado por tema: --c-light e --c-dark são a cor escolhida, clareada ou escurecida até ficar legível
// em cada fundo; --c-raw é a cor exata (a bolinha das Opções). Quem usa faz: h('span', { class: `chip ${cls}`, style }).
export function tagColor(color) {
  if (isHex(color)) {
    const t = themed(color);
    return { cls: 'tag-custom', style: `--c-raw:${color};--c-light:${t.light};--c-dark:${t.dark}` };
  }
  return { cls: `tag-${TAG_COLORS.includes(color) ? color : 'gray'}`, style: undefined };
}
