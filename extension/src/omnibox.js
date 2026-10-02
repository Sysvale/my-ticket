// OmniBar: digitar "ticket 148270" na barra de endereços abre o ticket no GLPI. Lógica pura, sem chrome.*.
// Só usa o cache local do radar (nada de consulta ao GLPI): as sugestões saem dos tickets que a extensão já conhece.
import { normalizeText } from './filters.js';
import { parseGlpiDate, parseTicketId } from './format.js';

export const KEYWORD = 'ticket';
export const MAX_SUGGESTIONS = 5;

const modMs = (t) => parseGlpiDate(t.dateMod) || 0;
const clamp = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Sugestões para o que foi digitado depois da palavra-chave, a partir de `tickets` (o `state.tickets` do cache, objeto
// ou lista). Sem texto: os atualizados mais recentemente. Com texto: o número que começa igual vem primeiro, depois os
// que têm todas as palavras no número ou no título (sem diferenciar acento). Com "ocultar conteúdo" só o número vale e é
// só o número que aparece: nem o título entra na busca nem na sugestão.
export function suggestionsFor(text, tickets, { hideContent = false, max = MAX_SUGGESTIONS } = {}) {
  const words = normalizeText(text).split(/\s+/).map((w) => w.replace(/^#/, '')).filter(Boolean);
  const all = Object.values(tickets ?? {}).filter((t) => t && Number.isInteger(t.id));
  const rank = (t) => {
    const id = String(t.id);
    if (words.length === 1 && id === words[0]) return 0;
    if (words.length === 1 && id.startsWith(words[0])) return 1;
    return 2;
  };
  return all
    .filter((t) => {
      if (!words.length) return true;
      const hay = normalizeText(hideContent ? String(t.id) : `${t.id} ${t.title ?? ''} ${t.entity ?? ''}`);
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => rank(a) - rank(b) || modMs(b) - modMs(a) || b.id - a.id)
    .slice(0, max)
    .map((t) => ({
      id: t.id,
      content: String(t.id),
      label: hideContent || !t.title ? `Ticket #${t.id}` : `#${t.id} — ${clamp(String(t.title), 100)}`,
    }));
}

// O que fazer com o que foi digitado quando a pessoa aperta Enter: um número ou link de ticket vale como está; texto
// livre só abre se casar com UM único ticket do radar (com vários, abrir um deles seria chute). Sem resposta: null.
export function resolveInput(text, tickets, options = {}) {
  const id = parseTicketId(text);
  if (id) return id;
  if (!String(text ?? '').trim()) return null;
  const found = suggestionsFor(text, tickets, { ...options, max: 2 });
  return found.length === 1 ? found[0].id : null;
}
