import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STALE, LIMITS, normalizeStale, staleLevel, staleText } from '../extension/src/stale.js';

const HOUR = 3600_000;
const NOW = Date.parse('2026-10-05T12:00:00');
const fmt = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const ago = (hours, extra = {}) => ({ id: 1, status: 2, dateMod: fmt(NOW - hours * HOUR), ...extra });
const ON = { ...DEFAULT_STALE };

test('o padrão é ligado, âmbar em 48 h e vermelho em 5 dias (120 h)', () => {
  assert.deepEqual(DEFAULT_STALE, { enabled: true, amberHours: 48, redHours: 120 });
  assert.deepEqual(LIMITS, { min: 1, max: 8760 });
});

test('normalizeStale: completa o que falta, arredonda e limita às horas válidas', () => {
  assert.deepEqual(normalizeStale(undefined), ON);
  assert.deepEqual(normalizeStale(null), ON);
  assert.deepEqual(normalizeStale({ amberHours: 24.4, redHours: '72' }), { enabled: true, amberHours: 24, redHours: 72 });
  assert.deepEqual(normalizeStale({ enabled: false }), { enabled: false, amberHours: 48, redHours: 120 });
  assert.equal(normalizeStale({ amberHours: 0 }).amberHours, 1);
  assert.equal(normalizeStale({ amberHours: -5 }).amberHours, 1);
  assert.equal(normalizeStale({ redHours: 999999 }).redHours, 8760);
});

test('normalizeStale: lixo vira o padrão e o vermelho fica sempre depois do amarelo', () => {
  for (const lixo of [5, 'x', [], { amberHours: 'abc', redHours: NaN, enabled: 'sim' }]) assert.deepEqual(normalizeStale(lixo), ON, JSON.stringify(lixo));
  assert.deepEqual(normalizeStale({ amberHours: 100, redHours: 50 }), { enabled: true, amberHours: 100, redHours: 101 });
  assert.deepEqual(normalizeStale({ amberHours: 100, redHours: 100 }), { enabled: true, amberHours: 100, redHours: 101 });
  assert.deepEqual(normalizeStale({ amberHours: 9999, redHours: 9999 }), { enabled: true, amberHours: 8759, redHours: 8760 });
  const a = normalizeStale(null);
  a.amberHours = 1; // devolve sempre um objeto novo
  assert.equal(normalizeStale(null).amberHours, 48);
});

test('staleLevel: nos limites exatos já destaca, e um minuto antes não', () => {
  assert.equal(staleLevel(ago(47), NOW, ON), null);
  assert.equal(staleLevel({ ...ago(0), dateMod: fmt(NOW - 48 * HOUR + 60_000) }, NOW, ON), null); // 47 h 59 min
  assert.equal(staleLevel(ago(48), NOW, ON), 'amber');
  assert.equal(staleLevel(ago(119), NOW, ON), 'amber');
  assert.equal(staleLevel(ago(120), NOW, ON), 'red');
  assert.equal(staleLevel(ago(24 * 90), NOW, ON), 'red');
  assert.equal(staleLevel(ago(0), NOW, ON), null);
});

test('staleLevel usa os limites configurados', () => {
  const cfg = { enabled: true, amberHours: 4, redHours: 8 };
  assert.equal(staleLevel(ago(3), NOW, cfg), null);
  assert.equal(staleLevel(ago(5), NOW, cfg), 'amber');
  assert.equal(staleLevel(ago(9), NOW, cfg), 'red');
});

test('staleLevel: só ticket em aberto e legível; desligado nunca destaca', () => {
  for (const status of [1, 2, 3, 4]) assert.equal(staleLevel(ago(200, { status }), NOW, ON), 'red', `status ${status}`);
  for (const status of [5, 6, null, undefined, 0, 9]) assert.equal(staleLevel(ago(200, { status }), NOW, ON), null, `status ${status}`);
  assert.equal(staleLevel(ago(200, { unavailable: true }), NOW, ON), null); // sem acesso: não se sabe
  assert.equal(staleLevel(ago(200, { readError: true }), NOW, ON), null); // a data guardada pode estar velha por causa do erro
  assert.equal(staleLevel(ago(200), NOW, { ...ON, enabled: false }), null);
  assert.equal(staleLevel(ago(200), NOW, undefined), null);
});

test('staleLevel: sem data, com data ilegível ou no futuro (relógio diferente) não destaca nem quebra', () => {
  assert.equal(staleLevel({ id: 1, status: 2 }, NOW, ON), null);
  assert.equal(staleLevel({ id: 1, status: 2, dateMod: 'lixo' }, NOW, ON), null);
  assert.equal(staleLevel({ id: 1, status: 2, dateMod: fmt(NOW + 5 * HOUR) }, NOW, ON), null);
  assert.equal(staleLevel(null, NOW, ON), null);
});

test('staleText diz há quanto tempo está parado, no mesmo formato da rosca', () => {
  assert.equal(staleText(ago(50), NOW), 'parado há 2 d 2 h');
  assert.equal(staleText(ago(48), NOW), 'parado há 2 d');
  assert.equal(staleText(ago(24 * 5 + 3), NOW), 'parado há 5 d 3 h');
});
