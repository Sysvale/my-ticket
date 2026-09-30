import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SOUND,
  SOUNDS,
  clampVolume,
  normalizeSound,
  normalizeSoundConfig,
  soundFile,
} from '../extension/src/sounds.js';

const EXT = new URL('../extension/', import.meta.url);

test('cada som do catálogo é um WAV PCM mono de 16 bits, curto, e não é silêncio', () => {
  for (const [name, sound] of Object.entries(SOUNDS)) {
    const buf = readFileSync(new URL(sound.file, EXT));
    assert.equal(buf.toString('ascii', 0, 4), 'RIFF', name);
    assert.equal(buf.toString('ascii', 8, 12), 'WAVE', name);
    assert.equal(buf.readUInt16LE(20), 1, `${name}: PCM`);
    assert.equal(buf.readUInt16LE(22), 1, `${name}: mono`);
    assert.equal(buf.readUInt16LE(34), 16, `${name}: 16 bits`);
    const rate = buf.readUInt32LE(24);
    const dataLen = buf.readUInt32LE(40);
    const seconds = dataLen / (rate * 2);
    assert.ok(seconds >= 0.3 && seconds <= 1.5, `${name}: ${seconds.toFixed(2)}s`);
    assert.ok(buf.length < 100 * 1024, `${name}: arquivo pequeno`);

    let peak = 0;
    for (let i = 44; i + 1 < buf.length; i += 2) peak = Math.max(peak, Math.abs(buf.readInt16LE(i)));
    assert.ok(peak > 10000, `${name}: tem sinal (pico ${peak})`);
    assert.ok(peak < 32767, `${name}: sem clipping`);
  }
});

test('normalizeSound cai no padrão para nome desconhecido', () => {
  assert.equal(normalizeSound('double'), 'double');
  assert.equal(normalizeSound('nao-existe'), DEFAULT_SOUND);
  assert.equal(normalizeSound(undefined), DEFAULT_SOUND);
  assert.equal(normalizeSound('toString'), DEFAULT_SOUND); // não confunde com propriedades do Object
  assert.equal(soundFile('nao-existe'), SOUNDS[DEFAULT_SOUND].file);
});

test('clampVolume limita entre 0 e 1 e trata lixo como 0', () => {
  assert.equal(clampVolume(0.5), 0.5);
  assert.equal(clampVolume(2), 1);
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume('0.3'), 0.3);
  assert.equal(clampVolume('abc'), 0);
  assert.equal(clampVolume(undefined), 0);
});

test('normalizeSoundConfig completa e sanitiza', () => {
  assert.deepEqual(normalizeSoundConfig({ enabled: 1, name: 'alert', volume: 5 }), { enabled: true, name: 'alert', volume: 1 });
  assert.deepEqual(normalizeSoundConfig(undefined), { enabled: false, name: DEFAULT_SOUND, volume: 0.6 });
  assert.deepEqual(normalizeSoundConfig({ enabled: true, name: 'x', volume: 'lixo' }), { enabled: true, name: DEFAULT_SOUND, volume: 0 });
});
