// Notificações de exemplo (uma de cada tipo) para a pessoa ver como aparecem no sistema.
// Usa o mesmo toNotification() das notificações reais; só os dados são fictícios.
import { toNotification } from './poller.js';

const ev = (type, author, text) => ({ type, at: 0, author, text });

export function sampleNotifications({ hideContent = false } = {}) {
  // mesma regra do poller: com "ocultar conteúdo" o texto livre nem chega a existir
  const t = (text) => (hideContent ? '' : text);
  const alerts = [
    {
      key: 'followup',
      ticketId: 1001,
      title: 'Relatório mensal não gera no processamento',
      entity: 'Município Alfa',
      events: [ev('followup', 'Analista A', t('Segue o log do erro e o print da tela de relatórios.'))],
    },
    {
      key: 'solution',
      ticketId: 1002,
      title: 'Liberar perfil de regulador para a equipe',
      entity: 'Município Beta',
      events: [ev('solution', 'Ana Paula Ribeiro', t('Perfil liberado. Pode testar e confirmar?'))],
    },
    {
      key: 'extra',
      ticketId: 1003,
      title: 'Bloqueio de agenda não libera fila',
      entity: 'Município Beta',
      events: [ev('extra', '', 'Em análise → Devolvido')],
    },
    {
      key: 'status',
      ticketId: 1004,
      title: 'Erro na exportação do integração',
      entity: 'Município Alfa',
      events: [ev('status', '', 'Em atendimento → Pendente')],
    },
    {
      key: 'new',
      ticketId: 1005,
      title: 'Duplicidade de cadastro individual por CNS',
      entity: 'Município Gama',
      events: [ev('new', '', 'Novo no seu radar: atribuído a você')],
    },
    {
      key: 'multi',
      ticketId: 1006,
      title: 'Cadastro individual não persiste',
      entity: 'Município Gama',
      events: [
        ev('status', '', 'Pendente → Em atendimento'),
        ev('followup', 'Analista B', t('Consegui reproduzir. Estou subindo a correção agora.')),
      ],
    },
  ];
  return [
    ...alerts.map((a) => ({ key: a.key, ...toNotification(a, { hideContent }) })),
    { key: 'summary', summary: true, count: 7, ticketId: 0, title: 'MyTicket', message: '7 tickets com novidades', context: '' },
  ];
}
