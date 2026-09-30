import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChecks, demoResultText, WINDOWS_STEPS } from '../extension/src/diagnostics.js';
import { mergeConfig } from '../extension/src/store.js';

const NOW = Date.parse('2026-09-29T12:00:00Z');
const GOOD_CFG = mergeConfig({ baseUrl: 'https://glpi.exemplo.com', appToken: 'a', userToken: 'b' });
const GOOD_RUN = { ok: true, at: NOW - 60_000, count: 12, ms: 500 };

const run = (over = {}) =>
  buildChecks({
    cfg: GOOD_CFG,
    state: { lastRun: GOOD_RUN },
    permission: 'granted',
    hostGranted: true,
    now: NOW,
    ...over,
  });
const by = (list, id) => list.find((c) => c.id === id);
const levels = (list) => Object.fromEntries(list.map((c) => [c.id, c.level]));

test('tudo certo: só o item do Windows fica como verificação manual', () => {
  const list = run();
  assert.deepEqual(levels(list), {
    chrome: 'ok', conexao: 'ok', acesso: 'ok', verificacao: 'ok', tipos: 'ok', som: 'ok', windows: 'manual',
  });
  assert.match(by(list, 'verificacao').detail, /há 1 min.*12 ticket/);
  assert.match(by(list, 'conexao').detail, /glpi\.exemplo\.com/);
  assert.deepEqual(by(list, 'windows').fix, WINDOWS_STEPS);
});

test('permissão negada no Chrome é erro e explica como resolver', () => {
  const c = by(run({ permission: 'denied' }), 'chrome');
  assert.equal(c.level, 'bad');
  assert.match(c.fix, /Sistema → Notificações → Google Chrome/);
  assert.equal(by(run({ permission: undefined }), 'chrome').level, 'warn');
});

test('sem credenciais ou com http, a conexão é erro', () => {
  assert.equal(by(run({ cfg: mergeConfig({}) }), 'conexao').level, 'bad');
  const http = mergeConfig({ appToken: 'a', userToken: 'b', baseUrl: 'http://glpi.local' });
  const c = by(run({ cfg: http }), 'conexao');
  assert.equal(c.level, 'bad');
  assert.match(c.detail, /https/);
});

test('acesso ao site do GLPI: concedido, negado ou ainda não pedido', () => {
  assert.equal(by(run({ hostGranted: true }), 'acesso').level, 'ok');
  const denied = by(run({ hostGranted: false }), 'acesso');
  assert.equal(denied.level, 'bad');
  assert.match(denied.fix, /Salvar/);
  assert.equal(by(run({ hostGranted: null }), 'acesso').level, 'warn');
});

test('verificação: nunca rodou, falhou ou está atrasada', () => {
  assert.equal(by(run({ state: {} }), 'verificacao').level, 'warn');

  const failed = by(run({ state: { lastRun: { ok: false, at: NOW, error: 'Sem conexão com o GLPI' } } }), 'verificacao');
  assert.equal(failed.level, 'bad');
  assert.match(failed.detail, /Sem conexão com o GLPI/);

  // padrão: a cada 2 min => atrasada depois de 10 min
  const late = by(run({ state: { lastRun: { ok: true, at: NOW - 30 * 60_000, count: 3 } } }), 'verificacao');
  assert.equal(late.level, 'warn');
  assert.match(late.detail, /há 30 min/);
  assert.match(late.fix, /repouso/);
  const fine = by(run({ state: { lastRun: { ok: true, at: NOW - 9 * 60_000, count: 3 } } }), 'verificacao');
  assert.equal(fine.level, 'ok');
});

test('tipos de aviso: lista os ligados e acusa quando todos estão desligados', () => {
  const some = mergeConfig({ appToken: 'a', userToken: 'b', notify: { followup: true, solution: false, status: false, extra: true, new: false } });
  assert.match(by(run({ cfg: some }), 'tipos').detail, /respostas, Status extra/);
  const none = mergeConfig({ appToken: 'a', userToken: 'b', notify: { followup: false, solution: false, status: false, extra: false, new: false } });
  assert.equal(by(run({ cfg: none }), 'tipos').level, 'bad');
});

test('som: ligado, desligado e volume zero', () => {
  assert.match(by(run(), 'som').detail, /Suave.*60%/);
  const off = mergeConfig({ appToken: 'a', userToken: 'b', sound: { enabled: false } });
  assert.match(by(run({ cfg: off }), 'som').detail, /Desligado/);
  const mute = mergeConfig({ appToken: 'a', userToken: 'b', sound: { volume: 0 } });
  assert.equal(by(run({ cfg: mute }), 'som').level, 'warn');
});

test('demoResultText cobre sucesso, permissão negada e erro', () => {
  assert.match(demoResultText({ ok: true, count: 7, permission: 'granted' }), /^7 exemplos enviados\. Se nada apareceu/);
  assert.match(demoResultText({ ok: true, count: 7, permission: 'denied' }), /desativadas/);
  assert.equal(demoResultText({ ok: false, error: 'boom' }), 'Não foi possível enviar: boom');
  assert.equal(demoResultText(undefined), 'Não foi possível enviar: erro desconhecido');
});

test('verificação com tickets que o GLPI não leu: aviso que lista os tickets e diz que os outros seguem', () => {
  const c = by(run({ state: { lastRun: { ...GOOD_RUN, failed: [159885] } } }), 'verificacao');
  assert.equal(c.level, 'warn');
  assert.match(c.detail, /há 1 min, mas 1 com erro de leitura \(#159885\)/);
  assert.match(c.fix, /tenta de novo.*demais tickets seguem/);
  // lista vazia é o caso normal
  assert.equal(by(run({ state: { lastRun: { ...GOOD_RUN, failed: [] } } }), 'verificacao').level, 'ok');
});

test('sincronização pausada: a verificação vira aviso e diz como retomar, antes de qualquer outra coisa', () => {
  const c = by(run({ user: { paused: true, pausedAt: NOW - 2 * 3600_000 } }), 'verificacao');
  assert.equal(c.level, 'warn');
  assert.match(c.detail, /pausada há 2 h.*nada é buscado nem avisado/);
  assert.match(c.fix, /Retomar/);
  // mesmo que a última verificação tenha falhado, o motivo de não chegar aviso é a pausa
  const failedToo = by(run({ user: { paused: true }, state: { lastRun: { ok: false, at: NOW, error: 'x' } } }), 'verificacao');
  assert.match(failedToo.detail, /pausada/);
  // sem pausa, nada muda
  assert.equal(by(run({ user: { paused: false } }), 'verificacao').level, 'ok');
});
