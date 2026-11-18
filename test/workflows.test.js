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

const split = (yml) => {
  const i = yml.indexOf('\n  chrome-web-store:');
  assert.ok(i > -1, 'job chrome-web-store ausente');
  return { release: yml.slice(0, i), chrome: yml.slice(i) };
};

test('release: só dispara por tag vX.Y.Z, não usa pull_request_target e só escreve no job que cria a Release', () => {
  const yml = read('release.yml');
  const { release, chrome } = split(yml);
  assert.match(yml, /tags:\s*\[\s*'v\[0-9\]\+\.\[0-9\]\+\.\[0-9\]\+'\s*\]/);
  assert.doesNotMatch(yml, /pull_request_target|workflow_run|branches:/);
  assert.match(yml, /^permissions:\s*\n\s+contents: read/m, 'permissão padrão do workflow deve ser só leitura');
  assert.match(release, /contents: write/);
  assert.doesNotMatch(chrome, /contents: write/, 'o job que fala com a loja nunca escreve no repositório');
  // no job da Release o token só é entregue como variável de ambiente em UM passo: o que cria a Release
  assert.equal((release.match(/GH_TOKEN:/g) ?? []).length, 1);
  assert.doesNotMatch(release, /secrets\./, 'o job da Release não usa segredo nenhum');
});

test('release: confere a versão e a main antes de testar, e anexa os zips', () => {
  const yml = read('release.yml');
  const order = ['release-check.mjs', 'npm test', 'build:chrome', 'build:firefox:zip', 'gh release create'].map((s) => yml.indexOf(s));
  assert.ok(order.every((i) => i > -1), `faltou algum passo: ${order.join()}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'ordem dos passos');
  assert.match(yml, /merge-base --is-ancestor/, 'a tag precisa estar na main');
  assert.match(yml, /--verify-tag/);
});

test('chrome-web-store: só depois da Release, atrás de um interruptor e de um environment com aprovação, com segredos CWS_* apenas', () => {
  const { chrome } = split(read('release.yml'));
  assert.match(chrome, /needs: release/);
  assert.match(chrome, /if: \$\{\{ vars\.PUBLICAR_CHROME == 'true' \}\}/, 'sem o interruptor a pipeline não envia nada');
  assert.match(chrome, /environment: chrome-web-store/, 'os segredos e a aprovação moram no environment');
  const used = [...chrome.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(used, ['CWS_EXTENSION_ID', 'CWS_PUBLISHER_ID', 'CWS_SERVICE_ACCOUNT_JSON']);
  assert.doesNotMatch(chrome, /secrets\.GITHUB_TOKEN|secrets: inherit/);
});

test('chrome-web-store: envia o zip DA RELEASE, conferido pelo SHA-256, e exige que a versão do zip seja a da tag', () => {
  const { chrome } = split(read('release.yml'));
  const order = ['gh release download', 'sha256sum --check', 'chrome-store.mjs'].map((s) => chrome.indexOf(s));
  assert.ok(order.every((i) => i > -1), `faltou algum passo: ${order.join()}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'ordem dos passos');
  assert.match(chrome, /--expect-version "\$\{TAG#v\}"/);
  assert.doesNotMatch(chrome, /npm run build|upload-artifact/, 'não gera outro pacote: usa o da Release');
});
