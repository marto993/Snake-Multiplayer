const test = require('node:test');
const assert = require('node:assert/strict');
const { matchResult, frenzyFoodTarget } = require('../game/match');

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

test('frenesí: la comida base sube un 50 %', () => {
  assert.equal(frenzyFoodTarget(2, 20, 0.5), 33);
  assert.equal(frenzyFoodTarget(8, 18, 0.5), 39);
});
