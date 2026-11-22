const test = require('node:test');
const assert = require('node:assert/strict');
const Snake = require('../public/snakeClass.js');

const make = () => new Snake('a', 'Ana', 12, 600, 600, 60, 120, 1, 0, '#fff', 54);

test('reset con largo 3 arma el cuerpo detrás de la cabeza', () => {
  const s = make();
  s.scoreLeftToGrow = 4;
  s.steerTo(Math.PI / 2);
  s.activeConsumable = { type: 'immunity', endTime: Date.now() + 5000 };
  s.reset(60, 120, 1, 0, 3);
  assert.deepEqual(s.segments, [{ x: 60, y: 120 }, { x: 48, y: 120 }, { x: 36, y: 120 }]);
  assert.deepEqual(s.targetSegments, s.segments);
  assert.deepEqual(s.renderSegments, s.segments);
  assert.equal(s.score, 3);
  assert.equal(s.scoreLeftToGrow, 0);
  assert.equal(s.targetHeading, s.heading);
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

// Giro libre
const DEG = Math.PI / 180;
const turning = (deg = 40) => {
  const s = make();
  s.turnRate = deg * DEG;
  s.reset(300, 300, 1, 0, 3);
  return s;
};
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('gira hacia el rumbo pedido como mucho turnRate por paso y llega exacto', () => {
  const s = turning(40);
  s.steerTo(90 * DEG);
  const headings = [];
  for (let i = 0; i < 4; i++) { s.moveLogic(); headings.push(Math.round(s.heading / DEG)); }
  assert.deepEqual(headings, [40, 80, 90, 90]);
  assert.deepEqual(s.direction, { x: 0, y: 1 });
});

test('gira por el lado corto', () => {
  const s = turning(40);
  s.steerTo(-60 * DEG);
  s.moveLogic();
  near(s.heading, -40 * DEG);
  s.steerTo(170 * DEG);   // desde -40°: el lado corto pasa por -180°
  s.moveLogic();
  near(s.heading, -80 * DEG);
});

test('pedir el rumbo opuesto hace una vuelta en U por la derecha de la serpiente', () => {
  const s = turning(40);
  s.steerTo(Math.PI);
  const ticks = [];
  while (Math.abs(s.heading - Math.PI) > 1e-9 && ticks.length < 10) { s.moveLogic(); ticks.push(Math.round(s.heading / DEG)); }
  assert.deepEqual(ticks, [40, 80, 120, 160, 180]);
});

test('cada paso avanza una celda en el rumbo actual, redondeado a 0,1 px', () => {
  const s = turning(45);
  s.steerTo(45 * DEG);
  s.moveLogic();
  assert.deepEqual(s.segments[0], { x: 308.5, y: 308.5 });
  const [a, b] = s.segments;
  near(Math.hypot(a.x - b.x, a.y - b.y), 12, 0.08);
  assert.equal(s.segments.length, 3);
});

test('en los ejes el vector queda exacto', () => {
  const s = turning(90);
  for (const [deg, dir] of [[90, { x: 0, y: 1 }], [180, { x: -1, y: 0 }], [-90, { x: 0, y: -1 }], [0, { x: 1, y: 0 }]]) {
    s.steerTo(deg * DEG);
    s.moveLogic();
    assert.deepEqual(s.direction, dir);
  }
});

test('las flechas (newMove de clientes viejos) piden ese rumbo, sin rechazar la vuelta', () => {
  const s = turning(40);
  assert.equal(s.changeDirection({ x: -1, y: 0 }), true);
  near(s.targetHeading, Math.PI);
  assert.equal(s.changeDirection({ x: 0, y: 0 }), false);
});

test('ignora rumbos inválidos', () => {
  const s = turning(40);
  for (const v of [NaN, Infinity, '1', null, undefined, {}]) assert.equal(s.steerTo(v), false);
  assert.equal(s.targetHeading, 0);
});
