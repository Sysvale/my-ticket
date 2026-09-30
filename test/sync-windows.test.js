// Roda o scripts/sync-windows.sh de verdade, contra pastas temporárias (nunca toca o C:\ real).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/sync-windows.sh', import.meta.url));
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;
const opts = { skip: !hasBash && 'precisa do bash' };

// Uma "C:\Users" de mentira com as pastas dadas.
function fakeUsers(names) {
  const dir = mkdtempSync(join(tmpdir(), 'myticket-users-'));
  for (const n of names) mkdirSync(join(dir, n));
  return dir;
}
const run = (env, extra = {}) =>
  spawnSync('bash', [SCRIPT], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, encoding: 'utf8', ...extra });
const DEFAULTS = ['All Users', 'Default', 'Default User', 'Public', 'Todos os Usuários', 'Usuário Padrão'];

test('sync-windows: sem cmd.exe, usa a única pasta de usuário de verdade em C:\\Users', opts, () => {
  const users = fakeUsers([...DEFAULTS, 'Fulana']);
  try {
    const r = run({ MYTICKET_USERS_DIR: users });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(users, 'Fulana', 'MyTicket', 'extension', 'manifest.json')));
  } finally {
    rmSync(users, { recursive: true, force: true });
  }
});

test('sync-windows: com mais de um usuário (ou nenhum) não adivinha e explica o que fazer', opts, () => {
  for (const names of [[...DEFAULTS, 'Ana', 'Beto'], DEFAULTS]) {
    const users = fakeUsers(names);
    try {
      const r = run({ MYTICKET_USERS_DIR: users });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /MYTICKET_WIN_USER/);
      assert.equal(existsSync(join(users, 'Ana', 'MyTicket')), false);
    } finally {
      rmSync(users, { recursive: true, force: true });
    }
  }
});

test('sync-windows: MYTICKET_WIN_USER e MYTICKET_WIN_DIR dispensam a detecção', opts, () => {
  const users = fakeUsers(['Ana', 'Beto']);
  const dest = mkdtempSync(join(tmpdir(), 'myticket-dest-'));
  try {
    assert.equal(run({ MYTICKET_USERS_DIR: users, MYTICKET_WIN_USER: 'Beto' }).status, 0);
    assert.ok(existsSync(join(users, 'Beto', 'MyTicket', 'extension', 'manifest.json')));
    assert.equal(run({ MYTICKET_USERS_DIR: users, MYTICKET_WIN_DIR: dest }).status, 0);
    assert.ok(existsSync(join(dest, 'extension', 'background.js')));
  } finally {
    rmSync(users, { recursive: true, force: true });
    rmSync(dest, { recursive: true, force: true });
  }
});

test('sync-windows: arquivo que não existe mais na origem some da cópia (com e sem rsync)', opts, () => {
  // PATH só com o necessário e sem rsync, para exercitar o caminho de cópia simples
  const bin = mkdtempSync(join(tmpdir(), 'myticket-bin-'));
  for (const tool of ['mkdir', 'find', 'cp', 'basename', 'dirname', 'tr', 'cat']) {
    symlinkSync(execFileSync('which', [tool], { encoding: 'utf8' }).trim(), join(bin, tool));
  }
  const withRsync = spawnSync('bash', ['-c', 'command -v rsync'], { encoding: 'utf8' }).status === 0;

  for (const mode of withRsync ? ['rsync', 'cp'] : ['cp']) {
    const dest = mkdtempSync(join(tmpdir(), 'myticket-dest-'));
    try {
      mkdirSync(join(dest, 'extension', 'src'), { recursive: true });
      writeFileSync(join(dest, 'extension', 'src', 'velho.js'), '// removido da origem');
      const r = mode === 'rsync'
        ? run({ MYTICKET_WIN_DIR: dest })
        : spawnSync(execFileSync('which', ['bash'], { encoding: 'utf8' }).trim(), [SCRIPT], {
          env: { PATH: bin, MYTICKET_WIN_DIR: dest }, encoding: 'utf8',
        });
      assert.equal(r.status, 0, `${mode}: ${r.stderr}`);
      assert.equal(existsSync(join(dest, 'extension', 'src', 'velho.js')), false, `${mode}: arquivo antigo ficou na cópia`);
      assert.match(readFileSync(join(dest, 'extension', 'manifest.json'), 'utf8'), /"MyTicket"/);
    } finally {
      rmSync(dest, { recursive: true, force: true });
    }
  }
  rmSync(bin, { recursive: true, force: true });
});
