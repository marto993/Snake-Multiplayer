const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRoomConfig } = require('../game/difficulty');

const levels = ['easy', 'medium', 'hard'].map(d => buildRoomConfig(d, { roundTime: 60 }));

test('nivel medio por defecto y ante valores desconocidos', () => {
  for (const v of [undefined, null, '', 'banana', 42, {}, 'toString', '__proto__']) {
    assert.equal(buildRoomConfig(v, { roundTime: 60 }).difficulty, 'medium');
  }
});

test('valores por nivel', () => {
  assert.deepEqual(levels.map(c => c.difficulty), ['easy', 'medium', 'hard']);
  assert.deepEqual(levels.map(c => c.gameSpeed), [70, 66, 60]);
  assert.deepEqual(levels.map(c => c.projectileCells), [3, 3, 3]);
  assert.deepEqual(levels.map(c => c.foodExtra), [24, 20, 18]);
  assert.deepEqual(levels.map(c => c.turnDegrees), [40, 40, 40]);
  assert.deepEqual(levels.map(c => c.consumables.immunity), [
    { enabled: true, spawnInterval: 6, duration: 5 },
    { enabled: true, spawnInterval: 8, duration: 4 },
    { enabled: true, spawnInterval: 10, duration: 3 }
  ]);
});

test('valores fijos en todos los niveles', () => {
  for (const c of levels) {
    assert.equal(c.maxPlayers, 8);
    assert.equal(c.minPlayers, 2);
    assert.equal(c.canvasWidth, 600);
    assert.equal(c.canvasHeight, 600);
    assert.equal(c.segmentSize, 12);
    assert.equal(c.startLength, 3);
    assert.equal(c.attacksEnabled, true);
  }
});

test('roundTime viene de afuera (override ROUND_TIME)', () => {
  assert.equal(buildRoomConfig('hard', { roundTime: 10 }).roundTime, 10);
});

test('cada llamada devuelve un objeto nuevo', () => {
  const a = buildRoomConfig('easy', { roundTime: 60 });
  a.consumables.immunity.duration = 99;
  assert.equal(buildRoomConfig('easy', { roundTime: 60 }).consumables.immunity.duration, 5);
});
