import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildChrome, checkManifest } from '../scripts/build-chrome.mjs';

const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

test('o manifest atual cumpre os requisitos da Chrome Web Store', () => {
  assert.deepEqual(checkManifest(manifest), []);
});

test('checkManifest aponta descrição longa, versão ruim e ícone faltando', () => {
  const erros = checkManifest({ manifest_version: 2, version: 'x', name: '', description: 'a'.repeat(133), icons: {} });
  assert.equal(erros.length, 7);
});

test('buildChrome gera um zip com manifest.json na raiz e sem arquivos de dev', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mt-zip-'));
  const { out, version } = buildChrome(join(dir, 'x.zip'));
  assert.equal(version, manifest.version);
  const lista = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' }).split('\n');
  assert.ok(lista.includes('manifest.json'));
  assert.ok(lista.includes('icons/icon128.png'));
  assert.ok(!lista.some((f) => /test|node_modules|\.git/.test(f)));
});

test('buildChrome recusa gravar dentro de extension/', () => {
  assert.throws(() => buildChrome(new URL('../extension/x.zip', import.meta.url).pathname), /dentro de extension/);
});
