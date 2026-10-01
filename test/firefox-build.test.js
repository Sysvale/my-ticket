// O manifest do Firefox é gerado a partir do do Chrome/Edge. Estes testes seguram as duas pontas: o que muda para o
// Firefox, e que o resto (permissões, nome, versão...) continua sendo o do manifest-base.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GECKO, toFirefoxManifest } from '../scripts/firefox-manifest.mjs';
import { buildFirefox } from '../scripts/build-firefox.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(ROOT, 'scripts', 'build-firefox.mjs');
const chrome = JSON.parse(readFileSync(join(ROOT, 'extension', 'manifest.json'), 'utf8'));
const tmp = () => mkdtempSync(join(tmpdir(), 'myticket-ff-'));

test('Firefox: background roda como script (o service worker não existe lá), e continua módulo', () => {
  const ff = toFirefoxManifest(chrome);
  assert.deepEqual(ff.background, { scripts: ['background.js'], type: 'module' });
  assert.equal(ff.background.service_worker, undefined);
});

test('Firefox: tem o ID do add-on (obrigatório no MV3) e declara que não coleta dados', () => {
  const ff = toFirefoxManifest(chrome);
  assert.deepEqual(ff.browser_specific_settings, { gecko: GECKO });
  assert.match(GECKO.id, /^\S+@\S+$/);
  assert.deepEqual(GECKO.data_collection_permissions, { required: ['none'] }, 'mudar isso tem de ser uma decisão, não um acidente');
});

test('Firefox: mesmas permissões do Chrome, menos o offscreen (que o Firefox não tem), e host só opcional', () => {
  const ff = toFirefoxManifest(chrome);
  assert.deepEqual(ff.permissions, chrome.permissions.filter((p) => p !== 'offscreen'));
  assert.ok(!ff.permissions.includes('offscreen'));
  assert.deepEqual(ff.optional_host_permissions, ['https://*/*']);
  assert.equal(ff.host_permissions, undefined);
});

test('Firefox: sem chaves só do Chrome (minimum_chrome_version) e o resto do manifest-base fica igual', () => {
  const ff = toFirefoxManifest(chrome);
  assert.equal(ff.minimum_chrome_version, undefined);
  for (const key of ['manifest_version', 'name', 'version', 'description', 'action', 'options_ui', 'icons', 'optional_host_permissions']) {
    assert.deepEqual(ff[key], chrome[key], key);
  }
  assert.deepEqual(Object.keys(ff).filter((k) => !(k in chrome)).sort(), ['browser_specific_settings']);
});

test('gerar não altera o manifest-base', () => {
  const copy = structuredClone(chrome);
  toFirefoxManifest(chrome);
  assert.deepEqual(chrome, copy);
});

test('sem background.service_worker no base, o gerador recusa em vez de gerar um manifest quebrado', () => {
  assert.throws(() => toFirefoxManifest({ ...chrome, background: { scripts: ['x.js'] } }), /service_worker/);
});

test('build: copia a extensão inteira e só o manifest muda', () => {
  const out = join(tmp(), 'firefox');
  try {
    buildFirefox(out);
    const list = (dir) => readdirSync(dir, { recursive: true }).map((p) => String(p).replaceAll('\\', '/')).sort();
    assert.deepEqual(list(out), list(join(ROOT, 'extension')));
    for (const f of ['background.js', 'src/compat.js', 'sounds/chime.wav']) {
      assert.deepEqual(readFileSync(join(out, f)), readFileSync(join(ROOT, 'extension', f)), f);
    }
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')), toFirefoxManifest(chrome));
  } finally {
    rmSync(join(out, '..'), { recursive: true, force: true });
  }
});

test('build: refaz uma saída anterior (arquivo que sumiu da origem some da saída)', () => {
  const base = tmp();
  const out = join(base, 'firefox');
  try {
    buildFirefox(out);
    writeFileSync(join(out, 'velho.js'), '// removido da origem');
    buildFirefox(out);
    assert.equal(existsSync(join(out, 'velho.js')), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('build: não apaga uma pasta que não é uma saída anterior, nem a própria extensão', () => {
  const base = tmp();
  try {
    writeFileSync(join(base, 'meus-documentos.txt'), 'importante');
    assert.throws(() => buildFirefox(base), /não vou apagá-la/);
    assert.ok(existsSync(join(base, 'meus-documentos.txt')));
    assert.throws(() => buildFirefox(join(ROOT, 'extension')), /própria pasta extension/);
    assert.throws(() => buildFirefox(join(ROOT, 'extension', 'src')), /própria pasta extension/);
    assert.ok(existsSync(join(ROOT, 'extension', 'manifest.json')));
    mkdirSync(join(base, 'vazia'));
    assert.doesNotThrow(() => buildFirefox(join(base, 'vazia'))); // vazia pode
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('CLI: --out escolhe a pasta; sem valor ou com pasta inválida sai com erro', () => {
  const base = tmp();
  try {
    const out = join(base, 'ff');
    const ok = execFileSync(process.execPath, [SCRIPT, '--out', out], { encoding: 'utf8' });
    assert.match(ok, /Gerado em:/);
    assert.ok(existsSync(join(out, 'manifest.json')));
    assert.notEqual(spawnSync(process.execPath, [SCRIPT, '--out'], { encoding: 'utf8' }).status, 0);
    assert.notEqual(spawnSync(process.execPath, [SCRIPT, '--out', join(ROOT, 'extension')], { encoding: 'utf8' }).status, 0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
