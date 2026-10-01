// Configuração do ESLint. O ESLint mora em tools/lint/ (a raiz do projeto não tem dependências), então o
// @eslint/js é resolvido a partir de lá. Rodar: npm run lint:install (uma vez) e npm run lint.
import { createRequire } from 'node:module';

const js = createRequire(new URL('./tools/lint/package.json', import.meta.url))('@eslint/js');

// Globais escritos à mão (em vez do pacote `globals`, que seria mais uma dependência). Uma API nova que ainda não
// esteja aqui falha como `no-undef` na primeira vez em que for usada: é só acrescentá-la à lista certa.
const readonly = (names) => Object.fromEntries(names.map((name) => [name, 'readonly']));

// Páginas e service worker da extensão (Chrome).
const EXTENSION = readonly([
  'chrome', 'window', 'document', 'navigator', 'location', 'history', 'CustomEvent', 'Audio', 'Blob', 'URL', 'URLSearchParams',
  'CSS', 'confirm', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'fetch', 'AbortController', 'TextEncoder',
  'crypto', 'structuredClone',
]);

// Testes e scripts (Node). `chrome` aparece porque os testes o simulam em globalThis.
const NODE = readonly([
  'chrome', 'process', 'Buffer', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
  'fetch', 'URL', 'URLSearchParams', 'AbortController', 'TextEncoder', 'TextDecoder', 'crypto', 'structuredClone', 'WebSocket',
  'performance', 'navigator',
]);

export default [
  { ignores: ['coverage/**', 'docs/**', 'dist/**'] }, // saídas geradas (dist/firefox é cópia de extension/); node_modules já é ignorado por padrão
  { linterOptions: { reportUnusedDisableDirectives: 'error' } }, // um eslint-disable que não serve mais é erro
  js.configs.recommended,
  {
    // Além das regras recomendadas: correção e segurança, que o código já cumpre (então só travam o que vier).
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-throw-literal': 'error',
    },
  },
  {
    files: ['extension/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: EXTENSION },
    // só no código que vai para o Chrome: os testes usam `javascript:` de propósito, como entrada maliciosa
    rules: { 'no-script-url': 'error' },
  },
  {
    files: ['test/**/*.js', 'scripts/**/*.{js,mjs}', 'eslint.config.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: NODE },
  },
];
