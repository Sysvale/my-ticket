import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLOR_ERROR, DEFAULT_TAGS, LIMITS, PRUNE_AFTER_MS, TAG_COLORS,
  createTag, defaultDefs, defsOf, deleteTag, editTag, emptyTags, exportTags, importTags,
  moveTag, normalizeColor, normalizeTags, pruneTagAssign, resetAssign, restoreDefaults, tagsOfTicket, toggleTag,
} from '../extension/src/tags.js';

const DAY = 24 * 3600_000;
const names = (tags) => defsOf(tags).map((d) => d.name);
const idsOf = (tags, ticket) => tagsOfTicket(tags, ticket).map((x) => x.def.id);

test('sem mexer em nada valem os padrões: quatro etapas e uma etiqueta', () => {
  const tags = emptyTags();
  assert.equal(tags.defs, null);
  assert.deepEqual(names(tags), ['Em andamento', 'PR em review', 'Em homologação/suporte', 'Aguardando retorno', 'Cliente avisado']);
  assert.deepEqual(defsOf(tags).map((d) => d.stage), [true, true, true, true, false]);
  // os padrões são cópias: mexer nelas não estraga a lista de fábrica
  defsOf(tags)[0].name = 'outro';
  assert.equal(DEFAULT_TAGS[0].name, 'Em andamento');
  assert.ok(defaultDefs().every((d) => TAG_COLORS.includes(d.color)));
});

test('etapa é uma por ticket: marcar outra troca a anterior; clicar na atual tira', () => {
  const tags = emptyTags();
  assert.equal(toggleTag(tags, 159919, 'pr-review', 1000), true);
  assert.deepEqual(idsOf(tags, 159919), ['pr-review']);
  toggleTag(tags, 159919, 'homologacao', 2000);
  assert.deepEqual(idsOf(tags, 159919), ['homologacao']); // trocou, não somou
  assert.equal(tags.assign[159919][0].at, 2000); // guarda desde quando
  toggleTag(tags, 159919, 'homologacao', 3000);
  assert.deepEqual(tags.assign, {}); // tirou; sem lixo de ticket vazio
});

test('etiquetas somam, e convivem com uma etapa (etapa primeiro na lista)', () => {
  const tags = emptyTags();
  toggleTag(tags, 7, 'avisado', 1);
  toggleTag(tags, 7, 'aguardando', 2);
  toggleTag(tags, 7, 'pr-review', 3); // troca 'aguardando' por 'pr-review', mantém a etiqueta
  assert.deepEqual(idsOf(tags, 7), ['pr-review', 'avisado']);
});

test('marcar tag que não existe ou em ticket inválido não faz nada', () => {
  const tags = emptyTags();
  assert.equal(toggleTag(tags, 7, 'fantasma', 1), false);
  assert.equal(toggleTag(tags, 'abc', 'avisado', 1), false);
  assert.equal(tags.defs, null); // nem materializou os padrões à toa
  assert.deepEqual(tags.assign, {});
});

test('criar tag: valida nome vazio, longo, repetido (sem acento/maiúscula) e limite', () => {
  const tags = emptyTags();
  assert.match(createTag(tags, { name: '   ' }).error, /Informe um nome/);
  assert.match(createTag(tags, { name: 'x'.repeat(LIMITS.name + 1) }).error, /até 24 caracteres/);
  assert.match(createTag(tags, { name: 'pr EM review' }).error, /Já existe/);
  assert.match(createTag(tags, { name: 'em homologacao/suporte' }).error, /Já existe/); // sem acento
  assert.equal(tags.defs, null); // erro não grava nada

  const ok = createTag(tags, { name: '  Dev   review ', stage: false, color: 'pink' });
  assert.equal(ok.ok, true);
  assert.deepEqual(defsOf(tags).at(-1), { id: ok.id, name: 'Dev review', color: 'pink', stage: false });
  assert.equal(defsOf(tags).length, DEFAULT_TAGS.length + 1);

  // sem cor: a primeira da paleta que nenhuma tag usa ainda; cor escolhida e inválida é erro, não some em silêncio
  const used = new Set(defsOf(tags).map((d) => d.color));
  const expected = TAG_COLORS.find((c) => !used.has(c));
  assert.equal(createTag(tags, { name: 'Outra', color: 'laranja-neon' }).error, COLOR_ERROR);
  assert.equal(defsOf(tags).some((d) => d.name === 'Outra'), false);
  createTag(tags, { name: 'Outra' });
  assert.equal(defsOf(tags).at(-1).color, expected);
  assert.ok(!['blue', 'purple', 'amber', 'teal', 'green'].includes(expected)); // as cores dos padrões já estão em uso

  while (defsOf(tags).length < LIMITS.tags) assert.equal(createTag(tags, { name: `t${defsOf(tags).length}` }).ok, true);
  assert.match(createTag(tags, { name: 'a mais' }).error, /limite é de 30/);
});

test('apagar um padrão não o traz de volta sozinho; "restaurar" devolve só os que faltam', () => {
  const tags = emptyTags();
  toggleTag(tags, 5, 'avisado', 1);
  assert.equal(deleteTag(tags, 'avisado'), true);
  assert.deepEqual(tags.assign, {}); // as marcações dessa tag saem junto
  assert.ok(!names(tags).includes('Cliente avisado'));
  // vale depois de gravar e ler de volta (é isso que o storage faz)
  const reloaded = normalizeTags(JSON.parse(JSON.stringify(tags)));
  assert.ok(!names(reloaded).includes('Cliente avisado'));

  editTag(reloaded, 'andamento', { name: 'Trabalhando' }); // renomeado continua sendo o mesmo padrão
  assert.equal(restoreDefaults(reloaded), 1);
  assert.deepEqual(names(reloaded).sort(), ['Aguardando retorno', 'Cliente avisado', 'Em homologação/suporte', 'PR em review', 'Trabalhando']);
  assert.equal(restoreDefaults(reloaded), 0);
});

test('editar: renomear, recolorir e mudar o tipo; nome repetido é recusado', () => {
  const tags = emptyTags();
  assert.deepEqual(editTag(tags, 'pr-review', { name: 'Em review', color: 'red' }), { ok: true });
  assert.deepEqual(defsOf(tags).find((d) => d.id === 'pr-review'), { id: 'pr-review', name: 'Em review', color: 'red', stage: true });
  assert.match(editTag(tags, 'pr-review', { name: 'cliente avisado' }).error, /Já existe/);
  assert.equal(editTag(tags, 'pr-review', { name: 'Em review' }).ok, true); // o próprio nome não conta como repetido
  assert.match(editTag(tags, 'fantasma', { name: 'x' }).error, /não encontrada/);
  assert.equal(defsOf(tags).find((d) => d.id === 'pr-review').name, 'Em review');
});

test('etiqueta que vira etapa: tickets com duas etapas ficam só com a mais recente', () => {
  const tags = emptyTags();
  toggleTag(tags, 9, 'avisado', 100); // etiqueta
  toggleTag(tags, 9, 'pr-review', 50); // etapa
  editTag(tags, 'avisado', { stage: true });
  assert.deepEqual(idsOf(tags, 9), ['avisado']); // a mais recente (100) fica
});

test('reordenar: sobe e desce, e não sai da lista', () => {
  const tags = emptyTags();
  assert.equal(moveTag(tags, 'pr-review', -1), true);
  assert.deepEqual(defsOf(tags).slice(0, 2).map((d) => d.id), ['pr-review', 'andamento']);
  assert.equal(moveTag(tags, 'pr-review', -1), false); // já é o primeiro
  assert.equal(moveTag(tags, 'avisado', 1), false); // já é o último
});

test('normalizeTags aceita lixo: nunca lança e devolve algo dentro dos limites', () => {
  for (const junk of [null, undefined, 5, 'x', [], { defs: 'x' }, { assign: [] }]) {
    const n = normalizeTags(junk);
    assert.equal(n.defs, null);
    assert.deepEqual(n.assign, {});
  }
  const n = normalizeTags({
    defs: [
      { id: 'a', name: 'A' }, // cor e tipo ausentes
      { id: 'a', name: 'Repetida' }, // id repetido
      { id: 'b', name: 'a' }, // nome repetido (sem maiúscula)
      { id: '../x', name: 'id ruim' },
      { id: 'c', name: '' },
      { id: 'd', name: 'D'.repeat(80), color: 'xyz', stage: 1 },
    ],
    assign: {
      10: [{ tag: 'a', at: 5 }, { tag: 'a', at: 6 }, { tag: 'fantasma', at: 1 }, { tag: 'd', at: 'lixo' }],
      abc: [{ tag: 'a', at: 1 }],
      11: 'não é lista',
      12: [{ tag: 'fantasma' }],
    },
  });
  assert.deepEqual(n.defs.map((d) => d.id), ['a', 'd']);
  assert.deepEqual(n.defs[0], { id: 'a', name: 'A', color: 'gray', stage: false });
  assert.equal(n.defs[1].name.length, LIMITS.name);
  assert.equal(n.defs[1].color, 'gray');
  assert.deepEqual(n.assign, { 10: [{ tag: 'a', at: 5 }, { tag: 'd', at: 0 }] });
});

test('limpeza: tickets que saíram do cache só perdem as tags depois de 60 dias', () => {
  const now = 1_000 * DAY;
  const tags = emptyTags();
  toggleTag(tags, 1, 'avisado', now - 10 * DAY); // ainda no cache
  toggleTag(tags, 2, 'avisado', now - 10 * DAY); // saiu, mas faz pouco tempo
  toggleTag(tags, 3, 'avisado', now - PRUNE_AFTER_MS - DAY); // saiu há mais de 60 dias
  toggleTag(tags, 4, 'avisado', now - PRUNE_AFTER_MS - 5 * DAY);
  toggleTag(tags, 4, 'pr-review', now - 5 * DAY); // tem marcação recente: fica
  const changed = pruneTagAssign(tags, { 1: {} }, now);
  assert.equal(changed, true);
  assert.deepEqual(Object.keys(tags.assign).sort(), ['1', '2', '4']);
  assert.equal(pruneTagAssign(tags, { 1: {} }, now), false); // nada mais a limpar
});

test('trocar de conta ou de GLPI limpa as marcações, mas mantém as tags criadas', () => {
  const tags = emptyTags();
  createTag(tags, { name: 'Minha tag' });
  toggleTag(tags, 1, 'avisado', 1);
  assert.equal(resetAssign(tags), true);
  assert.deepEqual(tags.assign, {});
  assert.ok(names(tags).includes('Minha tag'));
  assert.equal(resetAssign(tags), false);
});

test('exportar e importar: volta igual; arquivo inválido não altera nada', () => {
  const a = emptyTags();
  createTag(a, { name: 'Dev review', stage: false, color: 'pink' });
  toggleTag(a, 159919, 'pr-review', 1234);
  toggleTag(a, 159919, 'avisado', 1235);
  const file = exportTags(a, new Date('2026-09-30T12:00:00Z'));
  const parsed = JSON.parse(file);
  assert.equal(parsed.app, 'myticket-tags');
  assert.equal(parsed.exportedAt, '2026-09-30T12:00:00.000Z');
  assert.doesNotMatch(file, /token|senha|password/i); // só tags e números de ticket

  const b = emptyTags();
  const r = importTags(b, file);
  assert.deepEqual(r, { ok: true, tags: DEFAULT_TAGS.length + 1, tickets: 1 });
  assert.deepEqual(b, normalizeTags(JSON.parse(JSON.stringify(a))));

  const before = JSON.stringify(b);
  for (const bad of ['não é json', '{}', JSON.stringify({ app: 'outro', version: 1, defs: [] }),
    JSON.stringify({ app: 'myticket-tags', version: 2, defs: [] }), JSON.stringify({ app: 'myticket-tags', version: 1 }),
    'x'.repeat(LIMITS.importBytes + 1), null]) {
    assert.equal(importTags(b, bad).ok, false);
  }
  assert.equal(JSON.stringify(b), before);
});

test('importar sanitiza o conteúdo: limites, ids e nomes passam pela mesma normalização', () => {
  const tags = emptyTags();
  const evil = JSON.stringify({
    app: 'myticket-tags', version: 1,
    defs: [{ id: 'a', name: '<img src=x onerror=alert(1)>', color: 'red', stage: true }, ...Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, name: `T${i}` }))],
    assign: { 5: [{ tag: 'a', at: 1 }], '5; drop': [{ tag: 'a', at: 1 }] },
  });
  const r = importTags(tags, evil);
  assert.equal(r.ok, true);
  assert.equal(defsOf(tags).length, LIMITS.tags);
  assert.deepEqual(Object.keys(tags.assign), ['5']);
  // o nome entra como texto: a interface só usa textContent, então não há o que executar
  assert.equal(defsOf(tags)[0].name, '<img src=x onerror=alert(1)>'.slice(0, LIMITS.name));
});

// ---------- cor em hexadecimal ----------
test('normalizeColor aceita a paleta e hexadecimal (#rgb, #rrggbb, com ou sem #), sempre em #rrggbb minúsculo', () => {
  assert.equal(normalizeColor('purple'), 'purple');
  assert.equal(normalizeColor('#7C3AED'), '#7c3aed');
  assert.equal(normalizeColor('7c3aed'), '#7c3aed');
  assert.equal(normalizeColor('  #ABC '), '#aabbcc');
  assert.equal(normalizeColor('f80'), '#ff8800');
  for (const bad of ['', '#12345', '#1234567', '#ggg', 'rgb(0,0,0)', 'vermelho', 'orange', 'laranja', null, undefined, 7, '#fff;background:url(//x)', 'url(javascript:1)', '#fff" onload="x', 'var(--x)', '<b>']) {
    assert.equal(normalizeColor(bad), null, String(bad));
  }
});

test('criar e editar tag com cor em hexadecimal; hex inválido é erro e não grava nada', () => {
  const tags = emptyTags();
  const r = createTag(tags, { name: 'Laranja', color: '#FF8800', stage: false });
  assert.equal(r.ok, true);
  assert.equal(defsOf(tags).at(-1).color, '#ff8800');

  assert.equal(editTag(tags, 'pr-review', { color: 'F0F' }).ok, true);
  assert.equal(defsOf(tags).find((d) => d.id === 'pr-review').color, '#ff00ff');
  assert.equal(editTag(tags, 'pr-review', { color: 'blue' }).ok, true); // volta para a paleta
  assert.equal(defsOf(tags).find((d) => d.id === 'pr-review').color, 'blue');

  const before = JSON.stringify(tags);
  assert.equal(editTag(tags, 'pr-review', { color: '#zzz' }).error, COLOR_ERROR);
  assert.equal(editTag(tags, 'pr-review', { name: 'Outro nome', color: 'rgb(1,2,3)' }).error, COLOR_ERROR);
  assert.equal(createTag(tags, { name: 'Injeção', color: '#fff;background:url(//evil)' }).error, COLOR_ERROR);
  assert.equal(JSON.stringify(tags), before); // nem o nome novo entrou: a edição é tudo ou nada
});

test('o storage e o arquivo importado passam pela mesma validação: hex bom é normalizado, o resto vira cinza', () => {
  const n = normalizeTags({
    defs: [
      { id: 'a', name: 'A', color: '#AABBCC' },
      { id: 'b', name: 'B', color: 'abc' },
      { id: 'c', name: 'C', color: '#fff;background:url(//evil)' },
      { id: 'd', name: 'D', color: 'javascript:alert(1)' },
      { id: 'e', name: 'E', color: 'teal' },
    ],
  });
  assert.deepEqual(n.defs.map((d) => d.color), ['#aabbcc', '#aabbcc', 'gray', 'gray', 'teal']);
  const file = JSON.stringify({ app: 'myticket-tags', version: 1, defs: [{ id: 'x', name: 'X', color: '"><script>' }] });
  const t = emptyTags();
  assert.equal(importTags(t, file).ok, true);
  assert.equal(defsOf(t)[0].color, 'gray');
});
