const test = require('node:test');
const assert = require('node:assert/strict');
const Snake = require('../public/snakeClass.js');

const make = () => new Snake('a', 'Ana', 12, 600, 600, 60, 120, 1, 0, '#fff', 54);

test('reset con largo 3 arma el cuerpo detrás de la cabeza', () => {
  const s = make();
  s.scoreLeftToGrow = 4;
  s.moveQueue = [{ x: 0, y: 1 }];
  s.activeConsumable = { type: 'immunity', endTime: Date.now() + 5000 };
  s.reset(60, 120, 1, 0, 3);
  assert.deepEqual(s.segments, [{ x: 60, y: 120 }, { x: 48, y: 120 }, { x: 36, y: 120 }]);
  assert.deepEqual(s.targetSegments, s.segments);
  assert.deepEqual(s.renderSegments, s.segments);
  assert.equal(s.score, 3);
  assert.equal(s.scoreLeftToGrow, 0);
  assert.deepEqual(s.moveQueue, []);
  assert.equal(s.activeConsumable, null);
  assert.deepEqual(s.direction, { x: 1, y: 0 });
});

test('mirando hacia abajo, el cuerpo queda arriba', () => {
  const s = make();
  s.reset(60, 120, 0, 1, 3);
  assert.deepEqual(s.segments, [{ x: 60, y: 120 }, { x: 60, y: 108 }, { x: 60, y: 96 }]);
});

test('sin largo se comporta como hoy (1 segmento)', () => {
  const s = make();
  s.reset(60, 120);
  assert.deepEqual(s.segments, [{ x: 60, y: 120 }]);
  assert.equal(s.score, 1);
});

test('los tres arrays no comparten objetos', () => {
  const s = make();
  s.reset(60, 120, 1, 0, 3);
  s.renderSegments[0].x = 999;
  s.targetSegments[1].x = 999;
  assert.equal(s.segments[0].x, 60);
  assert.equal(s.segments[1].x, 48);
});
