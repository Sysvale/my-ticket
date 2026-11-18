import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkRelease } from '../scripts/release-check.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('tag igual à versão do manifest e do package.json: sem erros', () => {
  assert.deepEqual(checkRelease('v1.2.3', { manifest: { version: '1.2.3' }, pkg: { version: '1.2.3' } }), []);
});

test('tag diferente da versão do manifest é recusada', () => {
  const erros = checkRelease('v1.2.4', { manifest: { version: '1.2.3' }, pkg: { version: '1.2.3' } });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /1\.2\.4.*1\.2\.3/);
});

test('package.json fora de sincronia com o manifest é recusado', () => {
  const erros = checkRelease('v1.2.3', { manifest: { version: '1.2.3' }, pkg: { version: '1.2.2' } });
  assert.equal(erros.length, 1);
  assert.match(erros[0], /package\.json/);
});

test('tag fora do formato vX.Y.Z é recusada (inclusive pré-lançamento e versão de 4 números)', () => {
  for (const tag of ['1.2.3', 'v1.2', 'v1.2.3-rc1', 'v1.2.3.4', 'vx', '', 'v1.2.3; rm -rf /']) {
    const erros = checkRelease(tag, { manifest: { version: '1.2.3' }, pkg: { version: '1.2.3' } });
    assert.ok(erros.some((e) => /formato/.test(e)), `${JSON.stringify(tag)} deveria ser recusada por formato`);
  }
});

test('o CLI sai com 1 e explica quando a tag não bate com a versão atual, e com 0 quando bate', () => {
  const run = (tag) => spawnSync('node', ['scripts/release-check.mjs', tag], { cwd: ROOT, encoding: 'utf8' });
  const bad = run('v9.9.9');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /v9\.9\.9/);
  const ok = run(`v${manifest.version}`);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(pkg.version, manifest.version, 'package.json e manifest.json devem ter a mesma versão');
});
