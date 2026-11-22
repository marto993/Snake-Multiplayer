const test = require('node:test');
const assert = require('node:assert/strict');
const { wrapDelta, sweep, touchedAlong, wrapPoint, cellIndex } = require('../game/geometry');

test('wrapDelta: por el lado corto, y sin envolver con period 0', () => {
  assert.equal(wrapDelta(590, 600), -10);
  assert.equal(wrapDelta(-590, 600), 10);
  assert.equal(wrapDelta(200, 600), 200);
  assert.equal(wrapDelta(590, 0), 590);
});

test('sweep: distancia al tramo y fracción del recorrido', () => {
  const mid = sweep(0, 0, 12, 0, 6, 5, 0, 0);
  assert.equal(mid.d2, 25);
  assert.equal(mid.t, 0.5);
  const behind = sweep(0, 0, 12, 0, -3, 4, 0, 0);
  assert.deepEqual(behind, { d2: 25, t: 0 });
  const ahead = sweep(0, 0, 12, 0, 15, 4, 0, 0);
  assert.deepEqual(ahead, { d2: 25, t: 1 });
});

test('sweep cruza el borde por el portal', () => {
  // La cabeza sale por la derecha (590 → 602) y la comida está en el borde izquierdo
  const c = sweep(590, 100, 12, 0, 1, 100, 600, 600);
  assert.ok(c.d2 < 1e-9);
});

test('touchedAlong: lo que toca el tramo, en orden de contacto', () => {
  const items = [{ x: 30, y: 0 }, { x: 10, y: 2 }, { x: 20, y: 20 }, { x: 0, y: 9 }];
  assert.deepEqual(touchedAlong({ x: 0, y: 0 }, { x: 36, y: 0 }, items, 10, 600, 600), [3, 1, 0]);
});

test('una cabeza en diagonal come lo que pasa a su lado, sin alinearse con una fila', () => {
  // Paso de 45°: de (100, 100) a (108.5, 108.5); comida a 9 px del recorrido
  const food = [{ x: 110.5, y: 98.5 }];
  assert.deepEqual(touchedAlong({ x: 100, y: 100 }, { x: 8.5, y: 8.5 }, food, 10.2, 600, 600), [0]);
  assert.deepEqual(touchedAlong({ x: 100, y: 100 }, { x: 8.5, y: 8.5 }, [{ x: 115, y: 95 }], 10.2, 600, 600), []);
});

test('wrapPoint: pasa al borde opuesto cuando el centro cruza, conservando la posición exacta', () => {
  const cases = [
    [{ x: -6.5, y: 100 }, { x: 593.5, y: 100 }, { x: 'left', y: null }],
    [{ x: 594.2, y: 100 }, { x: -5.8, y: 100 }, { x: 'right', y: null }],
    [{ x: 100, y: -7 }, { x: 100, y: 593 }, { x: null, y: 'top' }],
    [{ x: 100, y: 600 }, { x: 100, y: 0 }, { x: null, y: 'bottom' }],
    [{ x: 595, y: 595 }, { x: -5, y: -5 }, { x: 'right', y: 'bottom' }],
    [{ x: -5.9, y: 593.9 }, { x: -5.9, y: 593.9 }, { x: null, y: null }]
  ];
  for (const [p, after, out] of cases) {
    assert.deepEqual(wrapPoint(p, 12, 600, 600), out);
    assert.ok(Math.abs(p.x - after.x) < 1e-9 && Math.abs(p.y - after.y) < 1e-9, JSON.stringify(p));
  }
});

test('en la grilla, wrapPoint se comporta como los portales de antes', () => {
  const right = { x: 600, y: 0 };
  wrapPoint(right, 12, 600, 600);
  assert.deepEqual(right, { x: 0, y: 0 });
  const left = { x: -12, y: 0 };
  wrapPoint(left, 12, 600, 600);
  assert.deepEqual(left, { x: 588, y: 0 });
});

test('cellIndex: por el centro y siempre dentro de la grilla', () => {
  assert.equal(cellIndex(120, 12, 50), 10);
  assert.equal(cellIndex(125.9, 12, 50), 10);
  assert.equal(cellIndex(126.1, 12, 50), 11);
  assert.equal(cellIndex(-5.9, 12, 50) + 0, 0);
  assert.equal(cellIndex(593.9, 12, 50), 49);
});
