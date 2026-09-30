import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isConfigured, mergeConfig } from '../extension/src/store.js';

test('config antiga, sem o campo de som, ganha o som padrão (ligado, suave, 60%)', () => {
  const cfg = mergeConfig({ baseUrl: 'https://x.test', appToken: 'a', userToken: 'b', hideContent: true });
  assert.deepEqual(cfg.sound, { enabled: true, name: 'chime', volume: 0.6 });
  assert.equal(cfg.hideContent, true);
});

test('config salva com som parcial mantém o que foi escolhido e completa o resto', () => {
  const cfg = mergeConfig({ sound: { name: 'alert', volume: 0.3 } });
  assert.deepEqual(cfg.sound, { enabled: true, name: 'alert', volume: 0.3 });
  const off = mergeConfig({ sound: { enabled: false } });
  assert.deepEqual(off.sound, { enabled: false, name: 'chime', volume: 0.6 });
});

test('mergeConfig não altera o objeto de padrões e completa papéis e avisos parciais', () => {
  const before = JSON.stringify(DEFAULT_CONFIG);
  const cfg = mergeConfig({ roles: { assigned: false }, notify: { extra: false }, sound: { volume: 0 } });
  assert.equal(JSON.stringify(DEFAULT_CONFIG), before);
  assert.deepEqual(cfg.roles, { assigned: false, observer: true, requester: true });
  assert.equal(cfg.notify.extra, false);
  assert.equal(cfg.notify.followup, true);
  assert.equal(cfg.sound.volume, 0); // 0 é um valor válido (mudo), não "ausente"
});

test('sem endereço ou sem tokens a extensão não está configurada', () => {
  assert.equal(isConfigured(mergeConfig({})), false);
  assert.equal(isConfigured(mergeConfig({ baseUrl: 'https://glpi.exemplo.com', appToken: 'a', userToken: 'b' })), true);
  assert.equal(isConfigured(mergeConfig({ appToken: 'a', userToken: 'b' })), false); // não há endereço padrão
  assert.equal(isConfigured(mergeConfig({ baseUrl: 'https://glpi.exemplo.com', appToken: 'a' })), false);
});
