const test = require('node:test');
const assert = require('node:assert/strict');
const { cutSnake, cutAnchored, dropRemains, REMAINS_TTL_MS } = require('../game/remains');

const line = n => Array.from({ length: n }, (_, i) => ({ x: 120 - i * 12, y: 60 }));
const none = () => false;

test('impacto en la cabeza: pierde hasta 3 segmentos de la cola', () => {
  const { kept, lost } = cutSnake(line(6), 0);
  assert.deepEqual(kept, line(3));
  assert.deepEqual(lost, [{ x: 84, y: 60 }, { x: 72, y: 60 }, { x: 60, y: 60 }]);
});

test('impacto en la cabeza: siempre conserva la cabeza', () => {
  assert.deepEqual(cutSnake(line(2), 0), { kept: line(1), lost: [{ x: 108, y: 60 }] });
  assert.deepEqual(cutSnake(line(1), 0), { kept: line(1), lost: [] });
});

test('impacto en el cuerpo: pierde desde el segmento tocado hasta la cola', () => {
  const { kept, lost } = cutSnake(line(5), 2);
  assert.deepEqual(kept, line(2));
  assert.deepEqual(lost, [{ x: 96, y: 60 }, { x: 84, y: 60 }, { x: 72, y: 60 }]);
});

test('no modifica el array original', () => {
  const segs = line(5);
  cutSnake(segs, 2);
  assert.deepEqual(segs, line(5));
});

test('cada segmento perdido queda como comida de valor 1 que vence', () => {
  const foods = dropRemains([{ x: 96, y: 60 }, { x: 84, y: 60 }], 5000, none);
  assert.deepEqual(foods, [
    { x: 96, y: 60, score: 1, remains: true, expiresAt: 5000 + REMAINS_TTL_MS },
    { x: 84, y: 60, score: 1, remains: true, expiresAt: 5000 + REMAINS_TTL_MS }
  ]);
  assert.equal(REMAINS_TTL_MS, 10000);
});

test('dos segmentos en la misma celda dan una sola comida que suma', () => {
  const foods = dropRemains([{ x: 96, y: 60 }, { x: 96, y: 60 }, { x: 84, y: 60 }], 0, none);
  assert.deepEqual(foods.map(f => [f.x, f.score]), [[96, 2], [84, 1]]);
});

test('no apila sobre una celda que ya tiene comida', () => {
  const foods = dropRemains([{ x: 96, y: 60 }, { x: 84, y: 60 }], 0, (x, y) => x === 96 && y === 60);
  assert.deepEqual(foods.map(f => f.x), [84]);
});

test('un corte largo suelta como mucho 30 comidas y conserva el total', () => {
  const lost = Array.from({ length: 45 }, (_, i) => ({ x: (i % 50) * 12, y: 300 }));
  const foods = dropRemains(lost, 0, none);
  assert.equal(foods.length, 30);
  assert.equal(foods.reduce((a, f) => a + f.score, 0), 45);
  assert.ok(foods.every(f => f.score >= 1 && f.score <= 5));
  // repartidas a lo largo de todo el cuerpo cortado, no solo al principio
  assert.equal(foods[0].x, 0);
  assert.ok(foods[29].x >= 42 * 12);
});

test('el valor de cada resto no pasa de 5', () => {
  const lost = Array.from({ length: 200 }, (_, i) => ({ x: (i % 50) * 12, y: (i / 50 | 0) * 12 }));
  const foods = dropRemains(lost, 0, none);
  assert.equal(foods.length, 30);
  assert.ok(foods.every(f => f.score === 5));
});

test('anclada: un impacto le quita solo el último segmento', () => {
  const { kept, lost } = cutAnchored(line(5));
  assert.deepEqual(kept, line(4));
  assert.deepEqual(lost, [{ x: 72, y: 60 }]);
});

test('anclada con un solo segmento: no pierde nada', () => {
  const { kept, lost } = cutAnchored(line(1));
  assert.deepEqual(kept, line(1));
  assert.deepEqual(lost, []);
});
