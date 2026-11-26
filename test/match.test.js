const test = require('node:test');
const assert = require('node:assert/strict');
const { matchResult, matchOver, frenzyFoodTarget, crownHolder } = require('../game/match');

const p = (id, length, color = '#fff') => ({
  id, name: 'n' + id, color, segments: Array.from({ length }, (_, i) => ({ x: i * 12, y: 0 }))
});

test('clasificación de la más larga a la más corta', () => {
  const r = matchResult([p('a', 4), p('b', 9), p('c', 6)]);
  assert.deepEqual(r.ranking.map(e => [e.id, e.length]), [['b', 9], ['c', 6], ['a', 4]]);
  assert.deepEqual(r.ranking[0], { id: 'b', name: 'nb', color: '#fff', length: 9 });
});

test('gana la más larga', () => {
  assert.deepEqual(matchResult([p('a', 4), p('b', 9)]).winners, ['b']);
});

test('si empatan en el largo máximo, ganan todas las empatadas', () => {
  const r = matchResult([p('a', 9), p('b', 3), p('c', 9)]);
  assert.deepEqual(r.winners, ['a', 'c']);
  // en el empate se respeta el orden de la sala
  assert.deepEqual(r.ranking.map(e => e.id), ['a', 'c', 'b']);
});

test('sala vacía: sin clasificación ni ganadores', () => {
  assert.deepEqual(matchResult([]), { ranking: [], winners: [] });
});

test('una serpiente sin segmentos cuenta como largo 0', () => {
  const r = matchResult([{ id: 'a', name: 'na', color: '#fff', segments: null }, p('b', 1)]);
  assert.deepEqual(r.ranking.map(e => [e.id, e.length]), [['b', 1], ['a', 0]]);
});

// Eliminación: la eliminada queda sin segmentos, con gameover y la hora del paso en que cayó
const out = (id, at, extra) => Object.assign({ id, name: 'n' + id, color: '#fff', segments: [], gameover: true, eliminatedAt: at }, extra);

test('las vivas van primero y las eliminadas después, de la última en caer a la primera', () => {
  const r = matchResult([out('a', 1000), p('b', 5), out('c', 3000), p('d', 9), out('e', 2000)]);
  assert.deepEqual(r.ranking.map(e => e.id), ['d', 'b', 'c', 'e', 'a']);
  assert.deepEqual(r.ranking[2], { id: 'c', name: 'nc', color: '#fff', length: 0, eliminated: true });
  assert.equal('eliminated' in r.ranking[0], false);
});

test('con una sola viva, gana ella aunque sea más corta que lo que fueron las otras', () => {
  assert.deepEqual(matchResult([out('a', 1000), p('b', 2)]).winners, ['b']);
});

test('si las últimas caen en el mismo paso, ganan las dos', () => {
  const r = matchResult([out('a', 1000), out('b', 5000), out('c', 5000)]);
  assert.deepEqual(r.winners, ['b', 'c']);
  assert.deepEqual(r.ranking.map(e => e.id), ['b', 'c', 'a']);
});

test('matchOver: termina con una o ninguna viva', () => {
  assert.equal(matchOver([p('a', 3), p('b', 3)]), false);
  assert.equal(matchOver([p('a', 3), out('b', 1)]), true);
  assert.equal(matchOver([out('a', 1), out('b', 1)]), true);
  assert.equal(matchOver([p('a', 3), p('b', 3), out('c', 1)]), false);
});

test('matchOver: con bots, termina cuando no queda ninguna persona viva', () => {
  const bot = (id, length) => Object.assign(p(id, length), { bot: 'medium' });
  assert.equal(matchOver([out('yo', 1), bot('b1', 5), bot('b2', 5)]), true);
  assert.equal(matchOver([p('yo', 3), bot('b1', 5), bot('b2', 5)]), false);
  assert.equal(matchOver([out('yo', 1), p('otra', 3), bot('b1', 5)]), false);
});

test('frenesí: la comida base sube un 50 %', () => {
  assert.equal(frenzyFoodTarget(2, 20, 0.5), 33);
  assert.equal(frenzyFoodTarget(8, 18, 0.5), 39);
});

// Corona: la serpiente más larga; en un empate la conserva quien ya la tenía
test('corona: la lleva la más larga', () => {
  assert.equal(crownHolder([p('a', 3), p('b', 7), p('c', 5)], null), 'b');
});

test('corona: en un empate la conserva quien ya la tenía', () => {
  assert.equal(crownHolder([p('a', 7), p('b', 7)], 'b'), 'b');
});

test('corona: en un empate entre quienes no la tenían, no la lleva nadie', () => {
  assert.equal(crownHolder([p('a', 7), p('b', 7), p('c', 4)], 'c'), null);
  assert.equal(crownHolder([p('a', 3), p('b', 3)], null), null);
});

test('corona: sala vacía o serpientes eliminadas', () => {
  assert.equal(crownHolder([], null), null);
  const out = Object.assign(p('a', 9), { gameover: true });
  assert.equal(crownHolder([out, p('b', 4)], null), 'b');
});
