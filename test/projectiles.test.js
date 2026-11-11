const test = require('node:test');
const assert = require('node:assert/strict');
const { traceProjectile } = require('../game/projectiles');

const bounds = { cell: 12, width: 600, height: 600 };
const right = (x, y) => ({ x, y, direction: { x: 1, y: 0 } });
const snake = (id, segments, opts = {}) => ({ id, segments, gameover: !!opts.gameover, hasImmunity: () => !!opts.immune });

test('avanza todas las celdas si no toca nada', () => {
  assert.deepEqual(traceProjectile(right(120, 120), 2, bounds, []), { outcome: 'alive', x: 144, y: 120 });
});

test('pega en la celda intermedia', () => {
  const a = snake('a', [{ x: 132, y: 120 }]);
  const r = traceProjectile(right(120, 120), 2, bounds, [a]);
  assert.equal(r.outcome, 'hit');
  assert.equal(r.player, a);
  assert.deepEqual([r.x, r.y, r.segmentIndex], [132, 120, 0]);
});

test('pega en un segmento del cuerpo y devuelve su índice', () => {
  const a = snake('a', [{ x: 300, y: 300 }, { x: 144, y: 120 }]);
  const r = traceProjectile(right(120, 120), 2, bounds, [a]);
  assert.deepEqual([r.outcome, r.segmentIndex], ['hit', 1]);
});

test('el escudo bloquea', () => {
  const a = snake('a', [{ x: 132, y: 120 }], { immune: true });
  assert.equal(traceProjectile(right(120, 120), 3, bounds, [a]).outcome, 'block');
});

test('ignora serpientes eliminadas', () => {
  const a = snake('a', [{ x: 132, y: 120 }], { gameover: true });
  assert.equal(traceProjectile(right(120, 120), 2, bounds, [a]).outcome, 'alive');
});

test('sale por el borde en una celda intermedia: expira en la última celda adentro', () => {
  assert.deepEqual(traceProjectile(right(576, 120), 3, bounds, []), { outcome: 'expired', x: 588, y: 120 });
});

test('nace fuera de la arena: expira acotado al borde', () => {
  assert.deepEqual(traceProjectile(right(600, 120), 2, bounds, []), { outcome: 'expired', x: 588, y: 120 });
});

test('no modifica el proyectil', () => {
  const p = right(120, 120);
  traceProjectile(p, 3, bounds, []);
  assert.deepEqual(p, right(120, 120));
});
