// Cores das tags: só valida o formato e calcula contraste (WCAG). Nada aqui toca DOM ou CSS.
// A cor que a pessoa digita vira CSS só depois de passar por normalizeHex: nunca texto livre.
const HEX3_OR_6 = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c);

// "#ABC", "abc", " 7C3AED " -> "#aabbcc" / "#7c3aed". Qualquer outra coisa (rgb(), nome, CSS...) -> null.
export function normalizeHex(input) {
  const m = HEX3_OR_6.exec(String(input ?? '').trim());
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return `#${h}`;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (v) => `#${v.map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')).join('')}`;

export function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Razão de contraste WCAG entre duas cores (1 a 21). Texto normal pede pelo menos 4,5.
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Mistura `a` com `b` (t = quanto de `b`), como o color-mix do CSS.
export function mix(a, b, t) {
  const [x, y] = [rgb(a), rgb(b)];
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

// Aproxima `hex` de preto (fundos claros) ou de branco (fundos escuros) até ter o contraste mínimo com TODOS os
// fundos dados (um fundo ou uma lista). Uma cor que já é legível não muda.
export function readableOn(hex, bgs, min = 4.5) {
  const list = [].concat(bgs);
  const ok = (c) => list.every((bg) => contrast(c, bg) >= min);
  if (ok(hex)) return hex;
  const target = luminance(list[0]) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  const base = rgb(hex);
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const mixed = toHex(base.map((v, i) => v + (target[i] - v) * t));
    if (ok(mixed)) return mixed;
  }
  return toHex(target);
}

// Fundo dos cards em cada tema (o --surface do ui.css) e a fração da cor da tag que tinge o fundo do chip (14%).
export const THEME_BG = Object.freeze({ light: '#f5f6f8', dark: '#1a1e26' });
export const CHIP_TINT = 0.14;

// A cor da tag legível em cada tema: contra o card e contra o fundo tingido do próprio chip.
export function themed(hex) {
  const one = (bg) => readableOn(hex, [bg, mix(bg, hex, CHIP_TINT)]);
  return { light: one(THEME_BG.light), dark: one(THEME_BG.dark) };
}
