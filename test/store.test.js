import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markRead, pruneUser, updateUser } from '../extension/src/store.js';

// chrome.storage.local simulado com latência, para expor gravações que se atropelam.
let db;
let writes;
const wait = () => new Promise((resolve) => setTimeout(resolve, 5));
globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => { await wait(); return key in db ? { [key]: structuredClone(db[key]) } : {}; },
      set: async (obj) => { await wait(); writes += 1; Object.assign(db, structuredClone(obj)); },
    },
  },
};
const fresh = () => { db = {}; writes = 0; };

test('gravações simultâneas do user não se perdem (popup e service worker ao mesmo tempo)', async () => {
  fresh();
  await Promise.all([
    updateUser((u) => { u.watched[1] = { addedAt: 1 }; }), // "acompanhar" no popup
    markRead(2), // "lido" ao abrir a aba
    updateUser((u) => { u.watched[3] = { addedAt: 3 }; }),
    markRead(4),
  ]);
  assert.deepEqual(Object.keys(db.user.watched).sort(), ['1', '3']);
  assert.deepEqual(Object.keys(db.user.readAt).sort(), ['2', '4']);
});

test('uma falha numa gravação não trava as seguintes', async () => {
  fresh();
  await assert.rejects(updateUser(() => { throw new Error('boom'); }), /boom/);
  await updateUser((u) => { u.watched[1] = {}; });
  assert.deepEqual(Object.keys(db.user.watched), ['1']);
});

test('mutate que devolve false não grava nada', async () => {
  fresh();
  await updateUser(() => false);
  assert.equal(writes, 0);
  await updateUser((u) => { u.watched[1] = {}; }); // sem retorno: grava
  assert.equal(writes, 1);
});

test('pruneUser tira acompanhados expirados e o "lido em" de tickets que saíram do cache', () => {
  const user = { watched: { 5: {}, 6: {} }, readAt: { 1: 10, 2: 20, 9: 90 } };
  const state = { tickets: { 1: {}, 2: {}, 6: {} } };
  assert.equal(pruneUser(user, state, [5]), true);
  assert.deepEqual(Object.keys(user.watched), ['6']);
  assert.deepEqual(Object.keys(user.readAt).sort(), ['1', '2']);
  // nada a tirar: false, para o updateUser não gravar à toa
  assert.equal(pruneUser(user, state, []), false);
  assert.equal(pruneUser({ watched: {}, readAt: {} }, { tickets: undefined }, []), false);
});

test('setPaused liga e desliga a pausa, guarda desde quando e não grava se nada mudou', async () => {
  const { setPaused, isPaused } = await import('../extension/src/store.js');
  fresh();
  assert.equal(isPaused(undefined), false);
  assert.equal(isPaused({}), false);

  await setPaused(true);
  assert.equal(writes, 1);
  assert.equal(isPaused(db.user), true);
  assert.ok(db.user.pausedAt > 0);

  await setPaused(true); // já estava pausado
  assert.equal(writes, 1);

  await setPaused(false);
  assert.equal(writes, 2);
  assert.equal(isPaused(db.user), false);
  assert.equal(db.user.pausedAt, null);

  await setPaused(false); // já estava ativo
  assert.equal(writes, 2);
});

test('pausar não apaga os tickets acompanhados nem o "lido em"', async () => {
  const { setPaused } = await import('../extension/src/store.js');
  fresh();
  await updateUser((u) => { u.watched[7] = { addedAt: 1 }; u.readAt[7] = 99; });
  await setPaused(true);
  await setPaused(false);
  assert.deepEqual(db.user.watched, { 7: { addedAt: 1 } });
  assert.deepEqual(db.user.readAt, { 7: 99 });
});

test('gravações simultâneas de tags não se perdem e não esperam as do user', async () => {
  const { getTags, updateTags } = await import('../extension/src/store.js');
  const { createTag, toggleTag, defsOf } = await import('../extension/src/tags.js');
  fresh();
  await Promise.all([
    updateTags((t) => { toggleTag(t, 1, 'avisado', 1); }),
    updateTags((t) => { toggleTag(t, 2, 'pr-review', 2); }),
    updateTags((t) => { createTag(t, { name: 'Minha tag' }); }),
    updateTags((t) => { toggleTag(t, 3, 'andamento', 3); }),
    updateUser((u) => { u.watched[9] = {}; }),
  ]);
  const tags = await getTags();
  assert.deepEqual(Object.keys(tags.assign).sort(), ['1', '2', '3']);
  assert.ok(defsOf(tags).some((d) => d.name === 'Minha tag'));
  assert.deepEqual(Object.keys(db.user.watched), ['9']);
});

test('updateTags não grava quando nada mudou; getTags aceita o que estiver no storage', async () => {
  const { getTags, updateTags } = await import('../extension/src/store.js');
  fresh();
  await updateTags(() => false);
  assert.equal(writes, 0);
  assert.equal((await getTags()).defs, null); // nunca mexeu: valem os padrões

  db.tags = { defs: 'lixo', assign: { 5: [{ tag: 'fantasma' }] } }; // storage corrompido
  const tags = await getTags();
  assert.equal(tags.defs, null);
  assert.deepEqual(tags.assign, {});
});
