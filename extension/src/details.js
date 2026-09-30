// Detalhes de um ticket para a tela "aberta" do popup: busca ao vivo no GLPI, só quando pedido.
// Com "ocultar conteúdo", nenhum texto livre (descrição, acompanhamentos, soluções) é devolvido.
import { htmlToParagraphs, htmlToText, parseGlpiDate } from './format.js';
import { makeNameResolver } from './users.js';

const FOLLOWUP_LIMIT = 10;
const SOLUTION_LIMIT = 3;

export async function fetchTicketDetails({ api, id, meId, users = {}, hideContent = false }) {
  const [ticket, followups, solutions] = await Promise.all([
    api.ticket(id),
    api.followups(id, FOLLOWUP_LIMIT),
    api.solutions(id, SOLUTION_LIMIT),
  ]);

  const nameOf = makeNameResolver({ api, meId, cache: { ...users } }); // cópia: não altera o cache do poller
  const raw = [
    ...followups.map((f) => ({ kind: 'followup', id: f.id, uid: f.users_id, date: f.date_creation ?? f.date, body: f.content, private: Boolean(f.is_private) })),
    ...solutions.map((s) => ({ kind: 'solution', id: s.id, uid: s.users_id, date: s.date_creation ?? s.date, body: s.content, private: false })),
  ].sort((a, b) => (parseGlpiDate(b.date) || 0) - (parseGlpiDate(a.date) || 0) || b.id - a.id);

  const timeline = await Promise.all(raw.map(async (m) => ({
    kind: m.kind,
    id: m.id,
    author: await nameOf(m.uid),
    mine: m.uid === meId,
    date: m.date ?? null,
    private: m.private,
    text: hideContent ? '' : htmlToParagraphs(m.body, 700),
  })));

  return {
    id,
    title: htmlToText(ticket.name, 300),
    status: ticket.status ?? null,
    priority: ticket.priority ?? null,
    opened: ticket.date ?? null,
    updated: ticket.date_mod ?? null,
    due: ticket.time_to_resolve || null, // "solução até" (SLA), quando o GLPI tem
    description: hideContent ? '' : htmlToParagraphs(ticket.content, 1500),
    hidden: hideContent,
    timeline,
    truncated: followups.length >= FOLLOWUP_LIMIT, // há mais acompanhamentos além dos mostrados
  };
}
