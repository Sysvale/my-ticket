import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleNotifications } from '../extension/src/samples.js';

const byKey = (list) => Object.fromEntries(list.map((n) => [n.key, n]));

test('exemplos cobrem cada tipo de notificação, com o formato das reais', () => {
  const s = byKey(sampleNotifications());
  assert.deepEqual(Object.keys(s), ['followup', 'solution', 'extra', 'status', 'new', 'multi', 'summary']);

  assert.equal(s.followup.title, '#1001 Relatório mensal não gera no processamento');
  assert.equal(s.followup.message, 'Analista A: Segue o log do erro e o print da tela de relatórios.');
  assert.equal(s.followup.context, 'Município Beta');
  assert.equal(s.solution.message, 'Ana Paula Ribeiro propôs solução: Perfil liberado. Pode testar e confirmar?');
  assert.equal(s.extra.message, 'Status extra: Em análise → Devolvido');
  assert.equal(s.status.message, 'Status: Em atendimento → Pendente');
  assert.equal(s.new.message, 'Novo no seu radar: atribuído a você');
  // vários eventos no mesmo ticket: a resposta vence o status e o "(+1)" avisa do outro
  assert.equal(s.multi.message, 'Analista B: Consegui reproduzir. Estou subindo a correção agora.  (+1)');
  assert.equal(s.summary.message, '7 tickets com novidades');
  assert.equal(s.summary.summary, true);
});

test('com ocultar conteúdo, os exemplos não trazem título nem texto', () => {
  const list = sampleNotifications({ hideContent: true });
  const s = byKey(list);
  assert.equal(s.followup.title, 'Ticket #1001');
  assert.equal(s.followup.message, 'Analista A respondeu');
  assert.equal(s.solution.message, 'Ana Paula Ribeiro propôs uma solução');
  assert.equal(s.multi.message, 'Analista B respondeu  (+1)');
  const dump = JSON.stringify(list);
  assert.doesNotMatch(dump, /processamento|log do erro|Perfil liberado|reproduzir|Duplicidade/);
  assert.doesNotMatch(dump, /Município Beta|Município Gama�|Município Alfa/); // a entidade também fica de fora
  assert.ok(list.every((n) => !n.context));
  // eventos que não são texto livre continuam iguais
  assert.equal(s.extra.message, 'Status extra: Em análise → Devolvido');
});

test('ids de exemplo são fictícios e distintos', () => {
  const ids = sampleNotifications().filter((n) => !n.summary).map((n) => n.ticketId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id >= 1001 && id <= 1006));
});
