import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLE, buildEntry, clip, donutModel, formatSpan, normalizeLogs, parseActorRef } from '../extension/src/timeshare.js';

const MIN = 60_000;
const T0 = Date.parse('2026-09-01T10:00:00'); // as datas do GLPI são "sem fuso" e entram como horário local
const at = (m) => T0 + m * MIN;
const pad = (n) => String(n).padStart(2, '0');
const fmt = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// linhas do log como o GLPI devolve (tudo texto, `id` crescente)
let rowId = 0;
const base = (m, over) => ({ id: String(++rowId), itemtype: 'Ticket', items_id: 1, itemtype_link: '', linked_action: '0', user_name: 'Fulano (1)', date_mod: fmt(at(m)), id_search_option: 0, old_value: '', new_value: '', ...over });
const statusRow = (m, from, to) => base(m, { id_search_option: 12, old_value: String(from), new_value: String(to) });
const actorRow = (m, op, type, name, id) => base(m, {
  itemtype_link: type,
  linked_action: op === 'add' ? '15' : '16',
  old_value: op === 'add' ? '' : `${name} (${id})`,
  new_value: op === 'add' ? `${name} (${id})` : '',
});
const asObject = (rows) => Object.fromEntries(rows.map((r) => [r.id, r])); // o GLPI indexa o _logs pelo id da linha
const A = (type, id, role) => ({ type, id, role });
const entry = ({ rows, actors, now, status = 2, hide = false }) => buildEntry({
  id: 1, ticket: { date: fmt(at(0)), status, date_mod: fmt(at(now)) }, logs: asObject(rows), actorsNow: actors, now: at(now), hideContent: hide,
});
const min = (ms) => Math.round(ms / MIN);
const slice = (m, key) => m.slices.find((s) => s.key === key);
const sum = (m) => m.slices.reduce((s, x) => s + x.ms, 0);
const reset = () => { rowId = 0; };

test('parseActorRef separa o nome do id, inclusive em equipes "Pai / Filho" e sem id', () => {
  assert.deepEqual(parseActorRef('Analista A (12)'), { name: 'Analista A', id: 12 });
  assert.deepEqual(parseActorRef('Sysvale / Suporte N2 (9)'), { name: 'Sysvale / Suporte N2', id: 9 });
  assert.deepEqual(parseActorRef('Nome (com parênteses) (7)'), { name: 'Nome (com parênteses)', id: 7 });
  assert.deepEqual(parseActorRef('cortado sem id'), { name: 'cortado sem id', id: null });
  assert.deepEqual(parseActorRef(undefined), { name: '', id: null });
});

test('normalizeLogs aceita objeto ou lista, ordena e ignora o que não é status nem pessoa/equipe', () => {
  reset();
  const rows = [
    actorRow(30, 'add', 'Group', 'Suporte', 9),
    statusRow(10, 1, 2),
    base(11, { id_search_option: 3, old_value: 'a', new_value: 'b' }), // outro campo
    base(12, { itemtype_link: 'Supplier', linked_action: '15', new_value: 'Fornecedor (4)' }), // fornecedor não é pessoa nem equipe
    statusRow(14, 'x', 3), // status ilegível
    base(15, { id_search_option: 12, old_value: '', new_value: '2' }), // sem valor antigo
    base(16, { date_mod: 'lixo', id_search_option: 12, old_value: '1', new_value: '2' }), // data ilegível
    null,
    'texto',
  ];
  for (const input of [rows, asObject(rows.filter(Boolean).filter((r) => typeof r === 'object'))]) {
    const n = normalizeLogs(input);
    assert.deepEqual(n.status.map((s) => [s.from, s.to]), [[1, 2]]);
    assert.deepEqual(n.moves.map((m) => [m.op, m.type, m.name, m.id]), [['add', 'Group', 'Suporte', 9]]);
  }
  assert.deepEqual(normalizeLogs(null), { status: [], moves: [] });
});

test('clip recorta o intervalo; "até" nulo vale até o limite', () => {
  assert.deepEqual(clip(0, 10, 2, 8), [2, 8]);
  assert.deepEqual(clip(5, null, 0, 9), [5, 9]);
  assert.equal(clip(0, 5, 5, 9), null);
  assert.equal(clip(10, 12, 0, 9), null);
});

test('formatSpan: minutos, horas e dias, sem exagero de casas', () => {
  assert.equal(formatSpan(10_000), 'menos de 1 min');
  assert.equal(formatSpan(45 * MIN), '45 min');
  assert.equal(formatSpan(60 * MIN), '1 h');
  assert.equal(formatSpan(200 * MIN), '3 h 20 min');
  assert.equal(formatSpan(24 * 60 * MIN), '1 d');
  assert.equal(formatSpan((2 * 24 * 60 + 5 * 60 + 40) * MIN), '2 d 5 h');
  assert.equal(formatSpan(-5), 'menos de 1 min');
});

// ---------- o papel só é conhecido de quem está no ticket agora ----------
test('buildEntry: papel só nos intervalos ainda abertos de quem está agora; o resto fica desconhecido (0)', () => {
  reset();
  const e = entry({
    now: 420,
    rows: [actorRow(0, 'add', 'User', 'Ana Lima', 5), actorRow(60, 'add', 'User', 'Analista A', 12), actorRow(180, 'del', 'User', 'Analista A', 12), actorRow(300, 'add', 'User', 'Analista A', 12)],
    actors: [A('User', 5, ROLE.REQUESTER), A('User', 12, ROLE.ASSIGNED)],
  });
  const analistaA = e.actors.find((a) => a.id === 12);
  assert.deepEqual(analistaA.segs.map((s) => s[2]), [0, ROLE.ASSIGNED]); // a 1ª passagem já acabou: papel desconhecido
  assert.equal(analistaA.name, 'Analista A');
  assert.equal(e.actors.find((a) => a.id === 5).segs[0][2], ROLE.REQUESTER);
});

test('buildEntry: quem está agora mas o log não mostra a entrada vale desde a abertura; saída sem entrada também', () => {
  reset();
  const e = entry({ now: 100, rows: [actorRow(40, 'del', 'User', 'Pedro Alves', 9)], actors: [A('Group', 3, ROLE.ASSIGNED)] });
  assert.deepEqual(e.actors.find((a) => a.id === 3).segs, [[at(0), null, ROLE.ASSIGNED]]);
  assert.deepEqual(e.actors.find((a) => a.id === 9).segs, [[at(0), at(40), 0]]);
});

test('buildEntry: quem tem dois papéis ao mesmo tempo não permite dizer qual intervalo era de qual: fica desconhecido', () => {
  reset();
  const e = entry({ now: 100, rows: [actorRow(0, 'add', 'User', 'Ana Lima', 5), actorRow(30, 'add', 'User', 'Ana Lima', 5)], actors: [A('User', 5, ROLE.REQUESTER), A('User', 5, ROLE.ASSIGNED)] });
  assert.ok(e.actors.find((a) => a.id === 5).segs.every((s) => s[2] === 0));
});

test('buildEntry com ocultar conteúdo não leva nome nenhum', () => {
  reset();
  const e = entry({ now: 100, hide: true, rows: [actorRow(10, 'add', 'User', 'Analista A', 12)], actors: [A('User', 12, ROLE.ASSIGNED)] });
  assert.doesNotMatch(JSON.stringify(e), /Analista|Analista/);
  const m = donutModel(e, { now: at(100) });
  assert.ok(slice(m, 'User:12').label === 'Pessoa #12');
});

// ---------- a rosca ----------
test('rosca: fila no início, passagens somadas e dois atribuídos juntos dividem em partes iguais', () => {
  reset();
  const rows = [actorRow(0, 'add', 'User', 'Ana Lima', 5), actorRow(60, 'add', 'User', 'Analista A', 12), actorRow(180, 'del', 'User', 'Analista A', 12), actorRow(180, 'add', 'User', 'João Reis', 7), actorRow(300, 'add', 'User', 'Analista A', 12)];
  const actors = [A('User', 5, ROLE.REQUESTER), A('User', 7, ROLE.ASSIGNED), A('User', 12, ROLE.ASSIGNED)];
  const e = entry({ rows, actors, now: 420 });

  // padrão: a 1ª passagem da Analista acabou e o GLPI não guardou o papel dela: fatia à parte, avisando
  const strict = donutModel(e, { now: at(420) });
  assert.equal(min(strict.window.totalMs), 420);
  assert.equal(sum(strict), strict.window.totalMs);
  assert.equal(min(slice(strict, 'queue').ms), 60);
  assert.equal(min(slice(strict, 'unknown').ms), 120);
  assert.equal(min(slice(strict, 'User:7').ms), 180); // 120 sozinho + 60 (metade do trecho dividido)
  assert.equal(min(slice(strict, 'User:12').ms), 60); // só a metade do trecho dividido
  assert.equal(slice(strict, 'User:5'), undefined); // o requerente não entra
  assert.equal(strict.uncertain, true);

  // contando quem saiu como atribuição: a passagem anterior da Analista entra e as passagens dela se somam
  const loose = donutModel(e, { now: at(420), includeUnknown: true });
  assert.equal(sum(loose), loose.window.totalMs);
  assert.equal(slice(loose, 'unknown'), undefined);
  assert.equal(min(slice(loose, 'User:12').ms), 180); // 120 + 60
  assert.equal(min(slice(loose, 'User:7').ms), 180);
  assert.equal(min(slice(loose, 'queue').ms), 60);
  assert.equal(loose.uncertain, false);
  assert.equal(loose.includesUnknown, true);
});

test('rosca: o técnico com o ticket aberto vai até agora, e o que já acabou não cresce', () => {
  reset();
  const rows = [actorRow(0, 'add', 'User', 'Analista A', 12)];
  const e = entry({ rows, actors: [A('User', 12, ROLE.ASSIGNED)], now: 100 });
  const a = donutModel(e, { now: at(100) });
  const b = donutModel(e, { now: at(160) }); // 60 min depois, sem nova consulta
  assert.equal(min(slice(a, 'User:12').ms), 100);
  assert.equal(min(slice(b, 'User:12').ms), 160);
  assert.equal(slice(b, 'User:12').open, true);
  assert.equal(slice(b, 'User:12').pct, 1);
});

test('rosca: ticket encerrado termina na SOLUÇÃO, não no fechamento automático dias depois', () => {
  reset();
  const rows = [actorRow(30, 'add', 'User', 'Analista A', 12), statusRow(1, 1, 2), statusRow(240, 2, 5), statusRow(1440, 5, 6)];
  const e = entry({ rows, actors: [A('User', 12, ROLE.ASSIGNED)], now: 3000, status: 6 });
  const m = donutModel(e, { now: at(3000) });
  assert.equal(min(m.window.totalMs), 240);
  assert.equal(m.window.done, true);
  assert.equal(min(slice(m, 'queue').ms), 30);
  assert.equal(min(slice(m, 'User:12').ms), 210);
  assert.equal(slice(m, 'User:12').open, false); // encerrado: nada "em andamento"
  assert.equal(sum(m), m.window.totalMs);
});

test('rosca: ticket reaberto segue a linha do tempo contínua até a última solução', () => {
  reset();
  const rows = [actorRow(20, 'add', 'User', 'Analista A', 12), statusRow(100, 2, 5), statusRow(160, 5, 2), statusRow(400, 2, 5)];
  const e = entry({ rows, actors: [A('User', 12, ROLE.ASSIGNED)], now: 900, status: 5 });
  const m = donutModel(e, { now: at(900) });
  assert.equal(min(m.window.totalMs), 400);
  assert.equal(min(slice(m, 'User:12').ms), 380);
  assert.equal(min(slice(m, 'queue').ms), 20);
});

test('rosca: pessoa antes de equipe — com técnico atribuído, a equipe que continua no ticket não divide o tempo', () => {
  reset();
  const rows = [actorRow(0, 'add', 'Group', 'Sysvale / Suporte N2', 9), actorRow(120, 'add', 'User', 'João Reis', 7)];
  const e = entry({ rows, actors: [A('Group', 9, ROLE.ASSIGNED), A('User', 7, ROLE.ASSIGNED)], now: 300 });
  const m = donutModel(e, { now: at(300) });
  assert.equal(min(slice(m, 'Group:9').ms), 120);
  assert.equal(slice(m, 'Group:9').kind, 'group');
  assert.equal(min(slice(m, 'User:7').ms), 180);
  assert.equal(sum(m), m.window.totalMs);
});

test('rosca: duas equipes ao mesmo tempo (sem pessoa) dividem igualmente', () => {
  reset();
  const rows = [actorRow(0, 'add', 'Group', 'Suporte N1', 8), actorRow(0, 'add', 'Group', 'Suporte N2', 9)];
  const e = entry({ rows, actors: [A('Group', 8, ROLE.ASSIGNED), A('Group', 9, ROLE.ASSIGNED)], now: 200 });
  const m = donutModel(e, { now: at(200) });
  assert.equal(min(slice(m, 'Group:8').ms), 100);
  assert.equal(min(slice(m, 'Group:9').ms), 100);
});

test('rosca: ninguém atribuído é 100% fila; observador e requerente não contam', () => {
  reset();
  const e = entry({ rows: [actorRow(0, 'add', 'User', 'Ana Lima', 5), actorRow(10, 'add', 'User', 'Rui Dias', 6)], actors: [A('User', 5, ROLE.REQUESTER), A('User', 6, ROLE.OBSERVER)], now: 100 });
  const m = donutModel(e, { now: at(100) });
  assert.deepEqual(m.slices.map((s) => [s.key, s.pct]), [['queue', 1]]);
  assert.equal(m.uncertain, false);
});

test('rosca: ticket recém-aberto (janela vazia) não gera fatia nem divide por zero', () => {
  reset();
  const e = entry({ rows: [], actors: [], now: 0 });
  const m = donutModel(e, { now: at(0) });
  assert.deepEqual(m.slices, []);
  assert.equal(m.window.totalMs, 0);
});

test('rosca: passou de 7 pessoas/equipes, o resto vira "Outros (n)" e a soma continua fechando', () => {
  reset();
  const rows = [];
  const actors = [];
  for (let i = 1; i <= 10; i += 1) {
    rows.push(actorRow((i - 1) * 10, 'add', 'User', `Pessoa ${i}`, 100 + i));
    if (i < 10) rows.push(actorRow(i * 10, 'del', 'User', `Pessoa ${i}`, 100 + i));
  }
  actors.push(A('User', 110, ROLE.ASSIGNED));
  const e = entry({ rows, actors, now: 200 });
  const m = donutModel(e, { now: at(200), includeUnknown: true });
  assert.equal(m.slices.filter((s) => s.kind === 'user').length, 7);
  const other = slice(m, 'other');
  assert.equal(other.label, 'Outros (3)');
  assert.equal(sum(m), m.window.totalMs);
  assert.deepEqual(m.slices.filter((s) => typeof s.tone === 'number').map((s) => s.tone), [1, 2, 3, 4, 5, 6, 7]);
});

test('rosca: a soma das fatias sempre fecha a janela inteira, em sequências aleatórias de entradas e saídas', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let round = 0; round < 200; round += 1) {
    reset();
    const rows = [];
    const present = new Set();
    for (let m = 0; m < 600; m += 5 + Math.floor(rnd() * 40)) {
      const id = 1 + Math.floor(rnd() * 5);
      const type = rnd() < 0.3 ? 'Group' : 'User';
      const key = `${type}:${id}`;
      if (present.has(key)) { present.delete(key); rows.push(actorRow(m, 'del', type, `N${id}`, id)); } else { present.add(key); rows.push(actorRow(m, 'add', type, `N${id}`, id)); }
      if (rnd() < 0.15) rows.push(statusRow(m, 2, 4));
    }
    const actors = [...present].map((k) => A(k.startsWith('Group') ? 'Group' : 'User', Number(k.split(':')[1]), rnd() < 0.6 ? ROLE.ASSIGNED : ROLE.OBSERVER));
    const e = entry({ rows, actors, now: 700 });
    for (const includeUnknown of [false, true]) {
      const m = donutModel(e, { now: at(700), includeUnknown });
      assert.equal(sum(m), m.window.totalMs, `rodada ${round}`);
      for (const s of m.slices) assert.ok(s.ms > 0 && s.pct > 0 && s.pct <= 1.0000001, `${round} ${s.key}`);
    }
  }
});
