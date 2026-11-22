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

// Giro libre: dirección en cualquier ángulo y contacto por distancia
const aim = (x, y, deg) => ({ x, y, direction: { x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) } });

test('en diagonal pega a un segmento que no está en ninguna fila del disparo', () => {
  const a = snake('a', [{ x: 300, y: 300 }, { x: 137, y: 135 }]);
  const r = traceProjectile(aim(120, 120, 45), 3, bounds, [a]);
  assert.deepEqual([r.outcome, r.segmentIndex, r.x, r.y], ['hit', 1, 137, 135]);
});

test('pega a lo que roza dentro del radio y no a lo que pasa más lejos', () => {
  const close = snake('a', [{ x: 138, y: 128 }]);   // 8 px al costado de la trayectoria
  const far = snake('b', [{ x: 138, y: 130 }]);     // 10 px
  assert.equal(traceProjectile(right(120, 120), 3, bounds, [close]).outcome, 'hit');
  assert.equal(traceProjectile(right(120, 120), 3, bounds, [far]).outcome, 'alive');
});

test('toca lo que queda entre dos puntos del tramo, no solo en los puntos', () => {
  const a = snake('a', [{ x: 126, y: 125 }]);   // a mitad del primer tramo, 5 px al costado
  const r = traceProjectile(right(120, 120), 1, bounds, [a]);
  assert.equal(r.outcome, 'hit');
});

test('entre dos cuerpos en el mismo tramo, pega al primero que encuentra', () => {
  const a = snake('a', [{ x: 130, y: 120 }]);   // en la trayectoria, a 10 px del inicio del tramo
  const b = snake('b', [{ x: 126, y: 124 }]);   // a 4 px al costado, a 6 px del inicio
  const r = traceProjectile(right(120, 120), 1, bounds, [a, b]);
  assert.equal(r.player, b);
});

test('pega a un segmento parado justo en el borde antes de expirar', () => {
  const a = snake('a', [{ x: 593, y: 120 }]);
  assert.equal(traceProjectile(right(588, 120), 3, bounds, [a]).outcome, 'hit');
});
