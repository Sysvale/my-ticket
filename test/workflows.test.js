// Os workflows do GitHub Actions seguem as regras de segurança do projeto, verificadas aqui e não só combinadas:
// toda action fixada pelo SHA do commit e só as oficiais (actions/*): uma action de terceiros no workflow de release
// receberia o GITHUB_TOKEN com permissão de escrita (e, no futuro, as credenciais das lojas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const DIR = join(fileURLToPath(new URL('..', import.meta.url)), '.github', 'workflows');
const files = readdirSync(DIR).filter((f) => f.endsWith('.yml'));
const read = (f) => readFileSync(join(DIR, f), 'utf8');

test('há workflows a verificar, inclusive o de release', () => {
  assert.ok(files.includes('tests.yml') && files.includes('seguranca.yml') && files.includes('release.yml'), files.join());
});

test('toda action é oficial (actions/*) e está fixada pelo SHA de 40 caracteres', () => {
  for (const f of files) {
    for (const [, uses] of read(f).matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) {
      assert.match(uses, /^actions\/[\w.-]+@[0-9a-f]{40}$/, `${f}: "${uses}" precisa ser actions/<nome>@<sha de 40 caracteres>`);
    }
  }
});

test('release: só dispara por tag vX.Y.Z, não usa pull_request_target e só escreve no passo que cria a Release', () => {
  const yml = read('release.yml');
  assert.match(yml, /tags:\s*\[\s*'v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'\s*\]/);
  assert.doesNotMatch(yml, /pull_request_target|workflow_run|branches:/);
  assert.match(yml, /^permissions:\s*\n\s+contents: read/m, 'permissão padrão do workflow deve ser só leitura');
  // o token só é entregue como variável de ambiente em UM passo: o que cria a Release
  assert.equal((yml.match(/GH_TOKEN:/g) ?? []).length, 1);
  assert.doesNotMatch(yml, /secrets\./, 'a primeira etapa do release não usa segredo nenhum');
});

test('release: confere a versão e a main antes de testar, e anexa os zips', () => {
  const yml = read('release.yml');
  const order = ['release-check.mjs', 'npm test', 'build:chrome', 'build:firefox:zip', 'gh release create'].map((s) => yml.indexOf(s));
  assert.ok(order.every((i) => i > -1), `faltou algum passo: ${order.join()}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'ordem dos passos');
  assert.match(yml, /merge-base --is-ancestor/, 'a tag precisa estar na main');
  assert.match(yml, /--verify-tag/);
});
