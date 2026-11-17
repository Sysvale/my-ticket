import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeEvent,
  failedLabel,
  formatDateTime,
  isUnderBase,
  htmlToParagraphs,
  htmlToText,
  isSecureUrl,
  normalizeBaseUrl,
  parseEnv,
  parseTicketId,
  timeAgo,
} from '../extension/src/format.js';

test('htmlToText decodifica HTML escapado, remove tags e trunca', () => {
  assert.equal(htmlToText('&lt;p&gt;Olá &lt;b&gt;mundo&lt;/b&gt;&lt;br /&gt;linha 2&lt;/p&gt;'), 'Olá mundo linha 2');
  assert.equal(htmlToText('&lt;p&gt;a &amp;amp; b&lt;/p&gt;'), 'a & b');
  assert.equal(htmlToText('x'.repeat(50), 10), 'xxxxxxxxx…');
  assert.equal(htmlToText(null), '');
  assert.equal(htmlToText('&#233;&#x41;'), 'éA');
});

test('normalizeBaseUrl aceita variações da URL do GLPI', () => {
  assert.equal(normalizeBaseUrl('https://glpi.exemplo.com/'), 'https://glpi.exemplo.com');
  assert.equal(normalizeBaseUrl('glpi.exemplo.com'), 'https://glpi.exemplo.com');
  assert.equal(normalizeBaseUrl('https://x.com/apirest.php/initSession'), 'https://x.com');
  assert.equal(normalizeBaseUrl('https://x.com/glpi/front/ticket.form.php?id=1'), 'https://x.com/glpi');
  assert.equal(normalizeBaseUrl('   '), '');
});

test('parseTicketId lê número, #número e URLs de ticket', () => {
  assert.equal(parseTicketId('159919'), 159919);
  assert.equal(parseTicketId(' #42 '), 42);
  assert.equal(parseTicketId('https://x.com/front/ticket.form.php?id=159919'), 159919);
  assert.equal(parseTicketId('https://x.com/front/ticket.form.php?forcetab=Ticket$1&id=7#a'), 7);
  assert.equal(parseTicketId('https://x.com/index.php?redirect=ticket_88'), 88);
  assert.equal(parseTicketId('https://x.com/Ticket/12'), 12);
  assert.equal(parseTicketId('https://x.com/front/computer.form.php?id=5'), null);
  assert.equal(parseTicketId('abc'), null);
});

test('parseEnv lê chaves com aspas, export e comentários', () => {
  const env = parseEnv('# c\nGLPI_TOKEN=abc\nexport GLPI_APP_TOKEN="d e f"\n\nX=\'1\'\n');
  assert.deepEqual(env, { GLPI_TOKEN: 'abc', GLPI_APP_TOKEN: 'd e f', X: '1' });
});

test('timeAgo formata datas do GLPI', () => {
  const now = Date.parse('2026-09-29T12:00:00');
  assert.equal(timeAgo('2026-09-29 11:59:40', now), 'agora');
  assert.equal(timeAgo('2026-09-29 11:30:00', now), 'há 30 min');
  assert.equal(timeAgo('2026-09-29 09:00:00', now), 'há 3 h');
  assert.equal(timeAgo('2026-09-26 12:00:00', now), 'há 3 d');
  assert.equal(timeAgo(null, now), '');
});

test('describeEvent resume cada tipo de evento', () => {
  assert.equal(describeEvent({ type: 'followup', author: 'Analista A', text: 'oi' }), 'Analista A: oi');
  assert.equal(describeEvent({ type: 'status', text: 'A → B' }), 'Status: A → B');
  assert.equal(describeEvent({ type: 'extra', text: 'x' }), 'Status extra: x');
});

test('describeEvent sem texto (conteúdo oculto) não mostra "(sem texto)"', () => {
  assert.equal(describeEvent({ type: 'followup', author: 'Analista A', text: '' }), 'Analista A respondeu');
  assert.equal(describeEvent({ type: 'followup', author: '', text: '' }), 'Alguém respondeu');
  assert.equal(describeEvent({ type: 'solution', author: 'Analista A', text: '' }), 'Analista A propôs uma solução');
  assert.equal(describeEvent({ type: 'solution', author: 'Analista A', text: 'reiniciei' }), 'Analista A propôs solução: reiniciei');
});

test('isSecureUrl aceita só https://', () => {
  assert.equal(isSecureUrl('https://glpi.exemplo.com'), true);
  assert.equal(isSecureUrl('HTTPS://glpi.exemplo.com'), true);
  assert.equal(isSecureUrl('http://glpi.exemplo.com'), false);
  assert.equal(isSecureUrl('http://localhost:8080'), false);
  assert.equal(isSecureUrl('ftp://x'), false);
  assert.equal(isSecureUrl('glpi.exemplo.com'), false);
  assert.equal(isSecureUrl(''), false);
  assert.equal(isSecureUrl(null), false);
  // a normalização não "conserta" http: o erro precisa aparecer para quem digitou
  assert.equal(isSecureUrl(normalizeBaseUrl('http://glpi.exemplo.com/')), false);
  assert.equal(isSecureUrl(normalizeBaseUrl('glpi.exemplo.com')), true);
});

test('htmlToParagraphs preserva quebras de linha de parágrafos, <br> e listas', () => {
  assert.equal(htmlToParagraphs('&lt;p&gt;Um&lt;/p&gt;&lt;p&gt;Dois&lt;br /&gt;Três&lt;/p&gt;'), 'Um\nDois\nTrês');
  assert.equal(htmlToParagraphs('&lt;ul&gt;&lt;li&gt;a&lt;/li&gt;&lt;li&gt;b&lt;/li&gt;&lt;/ul&gt;'), 'a\nb');
  // várias linhas em branco viram no máximo uma; espaços extras somem
  assert.equal(htmlToParagraphs('a&lt;br&gt;&lt;br&gt;&lt;br&gt;&lt;br&gt;   b   c'), 'a\n\nb c');
  assert.equal(htmlToParagraphs('x'.repeat(30), 10), 'xxxxxxxxx…');
  assert.equal(htmlToParagraphs(null), '');
  // não interpreta HTML: tags escritas como texto saem como texto simples, sem tag
  assert.equal(htmlToParagraphs('&lt;script&gt;alert(1)&lt;/script&gt;ok'), 'alert(1)ok');
});

test('formatDateTime formata no padrão brasileiro', () => {
  assert.equal(formatDateTime('2026-09-29 10:05:03'), '29/09/2026 10:05');
  assert.equal(formatDateTime('2026-01-02 03:04:00'), '02/01/2026 03:04');
  assert.equal(formatDateTime(null), '');
  assert.equal(formatDateTime('lixo'), '');
});

test('failedLabel resume os tickets que o GLPI não conseguiu ler', () => {
  assert.equal(failedLabel([]), '');
  assert.equal(failedLabel(undefined), '');
  assert.equal(failedLabel([159885]), '1 com erro de leitura (#159885)');
  assert.equal(failedLabel([1, 2, 3]), '3 com erro de leitura (#1, #2, #3)');
  assert.equal(failedLabel([1, 2, 3, 4, 5]), '5 com erro de leitura (#1, #2, #3…)');
});

test('isUnderBase compara a origem inteira e a fronteira do caminho', () => {
  const base = 'https://glpi.exemplo.com';
  assert.equal(isUnderBase('https://glpi.exemplo.com/front/ticket.form.php?id=7', base), true);
  assert.equal(isUnderBase('https://glpi.exemplo.com', base), true);
  // o que um simples startsWith deixaria passar
  assert.equal(isUnderBase('https://glpi.exemplo.com.golpe.net/front/ticket.form.php?id=7', base), false);
  assert.equal(isUnderBase('https://glpi.exemplo.com:8443/front/ticket.form.php?id=7', base), false);
  assert.equal(isUnderBase('http://glpi.exemplo.com/front/ticket.form.php?id=7', base), false);
  // GLPI instalado num subcaminho
  const sub = 'https://intra.exemplo.com/glpi';
  assert.equal(isUnderBase('https://intra.exemplo.com/glpi/front/ticket.form.php?id=7', sub), true);
  assert.equal(isUnderBase('https://intra.exemplo.com/glpi-outro/front/ticket.form.php?id=7', sub), false);
  assert.equal(isUnderBase('https://intra.exemplo.com/outro', sub), false);
  // lixo nunca lança
  assert.equal(isUnderBase(undefined, base), false);
  assert.equal(isUnderBase('não é url', base), false);
  assert.equal(isUnderBase('https://glpi.exemplo.com/x', ''), false);
});
