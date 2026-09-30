// As garantias de privacidade e segurança do README e do CLAUDE.md, como verificação automática (e não só como
// convenção). Varre o código da extensão e quebra se alguém introduzir o que elas proíbem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXT = join(ROOT, 'extension');
const listed = (suffix) => readdirSync(EXT, { recursive: true })
  .map((p) => String(p).replaceAll('\\', '/'))
  .filter((p) => p.endsWith(suffix))
  .sort();
const read = (p) => readFileSync(join(EXT, p), 'utf8');

const JS = listed('.js');
const HTML = listed('.html');
const CSS = listed('.css');

// Linhas de código: as regras citam o que proíbem nos próprios comentários, e isso não conta.
const codeLines = (text) => text.split(/\r?\n/)
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => !/^\s*(\/\/|\/\*|\*)/.test(line));

// Quem casa com `pattern` em código (não em comentário), no formato arquivo:linha.
function scan(files, pattern, { allow = [], source = read } = {}) {
  const hits = [];
  for (const file of files) {
    if (allow.includes(file)) continue;
    for (const { line, n } of codeLines(source(file))) if (pattern.test(line)) hits.push(`${file}:${n}: ${line.trim()}`);
  }
  return hits;
}

// O detector precisa enxergar a violação, senão uma regra quebrada passaria para sempre em silêncio.
test('o detector acha a violação em código e ignora a menção em comentário', () => {
  const fake = { 'a.js': 'el.innerHTML = x;\n// innerHTML é proibido\n * innerHTML', 'b.js': 'const ok = 1;' };
  const hits = scan(['a.js', 'b.js'], /\binnerHTML\b/, { source: (f) => fake[f] });
  assert.deepEqual(hits, ['a.js:1: el.innerHTML = x;']);
  assert.deepEqual(scan(['a.js'], /\binnerHTML\b/, { allow: ['a.js'], source: (f) => fake[f] }), []);
});

test('há código a varrer (senão as verificações abaixo passariam por não ver nada)', () => {
  assert.ok(JS.length >= 15, `só ${JS.length} arquivos .js`);
  assert.ok(JS.includes('src/glpi.js') && JS.includes('background.js'));
  assert.ok(HTML.length >= 4 && CSS.length >= 1);
});

test('sem console.*: nada do ticket ou do token vai parar num log', () => {
  assert.deepEqual(scan(JS, /\bconsole\s*\./), []);
});

test('texto do GLPI e nome de tag nunca viram HTML: sem innerHTML, eval ou new Function', () => {
  assert.deepEqual(scan(JS, /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b|document\.write\s*\(|\beval\s*\(|new\s+Function\s*\(/), []);
});

test('um único ponto de rede: só src/glpi.js usa fetch, XHR, WebSocket ou similares', () => {
  const network = /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|\bimportScripts\b|\bsendBeacon\b/;
  assert.deepEqual(scan(JS, network, { allow: ['src/glpi.js'] }), []);
  assert.match(read('src/glpi.js'), network, 'glpi.js deixou de ser o ponto de rede? revise esta regra');
});

test('tags e dados nunca sincronizam com a conta Google nem ficam em storage da página', () => {
  assert.deepEqual(scan(JS, /storage\.sync\b|\blocalStorage\b|\bsessionStorage\b|document\.cookie/), []);
});

test('nenhuma URL http:// no código: só https', () => {
  assert.deepEqual(scan(JS, /http:\/\//), []);
});

test('HTML sem script inline, sem handler on*= e sem recurso remoto', () => {
  for (const file of HTML) {
    const html = read(file);
    for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) {
      assert.match(tag, /\ssrc="[^"]+"/, `${file}: <script> sem src: ${tag}`);
      assert.doesNotMatch(tag, /\ssrc="\s*(?:https?:)?\/\//i, `${file}: <script> remoto: ${tag}`);
    }
    assert.doesNotMatch(html, /<script\b[^>]*>\s*[^\s<]/i, `${file}: script inline`);
    assert.doesNotMatch(html, /<[a-z][^>]*\son[a-z]+\s*=/i, `${file}: handler inline (onclick=...)`);
    assert.doesNotMatch(html, /\b(?:src|href|action)\s*=\s*["']\s*(?:https?:)?\/\//i, `${file}: recurso remoto`);
  }
});

test('CSS sem recurso remoto (@import ou url() para fora)', () => {
  for (const file of CSS) assert.doesNotMatch(read(file), /@import\s+(?:url\()?["']?\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\//i, file);
});

test('manifest: só as permissões que o produto usa, host só opcional e https, sem superfícies extras', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'notifications', 'offscreen', 'storage']);
  assert.equal(manifest.host_permissions, undefined, 'host_permissions dá acesso sem perguntar: só optional_host_permissions');
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  for (const key of ['content_scripts', 'web_accessible_resources', 'externally_connectable', 'content_security_policy', 'optional_permissions', 'devtools_page', 'sandbox']) {
    assert.equal(manifest[key], undefined, `${key} abre uma superfície nova: confirme que é intencional e ajuste este teste`);
  }
});

test('sem dependências: a raiz e a extensão não têm nenhuma (o ESLint fica isolado em tools/lint/)', () => {
  const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(root[key], undefined, `package.json da raiz tem ${key}: o lint é o único que pode ter, em tools/lint/`);
  }
  const shipped = readdirSync(EXT, { recursive: true }).map((p) => String(p).replaceAll('\\', '/'));
  assert.deepEqual(shipped.filter((p) => /(^|\/)(node_modules|package\.json|package-lock\.json)(\/|$)/.test(p)), [], 'o que vai para o Chrome não leva dependências');
});

test('o .gitignore barra o que guarda credencial', () => {
  const ignored = readFileSync(join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  for (const entry of ['.env', '*.pem', 'node_modules/']) assert.ok(ignored.includes(entry), `.gitignore sem ${entry}`);
});
