import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFirefox, notificationOptionsFor } from '../extension/src/compat.js';

const runtime = (prefix) => ({ getURL: (p) => `${prefix}://abc/${p}` });

test('isFirefox: só as páginas moz-extension:// são do Firefox (Chrome e Edge usam chrome-extension://)', () => {
  assert.equal(isFirefox(runtime('moz-extension')), true);
  assert.equal(isFirefox(runtime('chrome-extension')), false);
  assert.equal(isFirefox(undefined), false);
  assert.equal(isFirefox({}), false);
});

const TOAST = {
  type: 'basic',
  iconUrl: 'x://i.png',
  title: '#1 Título',
  message: 'Analista A: oi',
  contextMessage: 'Município Alfa',
  priority: 1,
  silent: true,
  requireInteraction: true,
  buttons: [{ title: 'Abrir' }, { title: 'Marcar como lido' }],
};

test('Chrome/Edge: as opções seguem intactas (botões, aviso fixo, silêncio)', () => {
  assert.equal(notificationOptionsFor(TOAST, { firefox: false }), TOAST);
  assert.equal(notificationOptionsFor(TOAST), TOAST);
});

test('Firefox: só type, title, message e iconUrl (o resto faria a criação falhar)', () => {
  const out = notificationOptionsFor(TOAST, { firefox: true });
  assert.deepEqual(Object.keys(out).sort(), ['iconUrl', 'message', 'title', 'type']);
  assert.equal(out.title, '#1 Título');
  assert.equal(out.iconUrl, 'x://i.png');
});

test('Firefox: a entidade (contextMessage) vai para uma segunda linha da mensagem', () => {
  assert.equal(notificationOptionsFor(TOAST, { firefox: true }).message, 'Analista A: oi\nMunicípio Alfa');
});

test('Firefox: sem entidade (ex.: "ocultar conteúdo"), a mensagem não ganha nada', () => {
  const hidden = { ...TOAST, contextMessage: undefined };
  assert.equal(notificationOptionsFor(hidden, { firefox: true }).message, 'Analista A: oi');
  assert.equal(notificationOptionsFor({ ...TOAST, contextMessage: '' }, { firefox: true }).message, 'Analista A: oi');
});

test('Firefox: não altera o objeto original', () => {
  const copy = structuredClone(TOAST);
  notificationOptionsFor(TOAST, { firefox: true });
  assert.deepEqual(TOAST, copy);
});
