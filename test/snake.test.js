const test = require('node:test');
const assert = require('node:assert/strict');
const Snake = require('../public/snakeClass.js');

const make = () => new Snake('a', 'Ana', 12, 600, 600, 60, 120, 1, 0, '#fff', 54);

test('reset con largo 3 arma el cuerpo detrás de la cabeza', () => {
  const s = make();
  s.scoreLeftToGrow = 4;
  s.steerTo(Math.PI / 2);
  s.addEffect('immunity', 5000, Date.now());
  s.reset(60, 120, 1, 0, 3);
  assert.deepEqual(s.segments, [{ x: 60, y: 120 }, { x: 48, y: 120 }, { x: 36, y: 120 }]);
  assert.deepEqual(s.targetSegments, s.segments);
  assert.deepEqual(s.renderSegments, s.segments);
  assert.equal(s.score, 3);
  assert.equal(s.scoreLeftToGrow, 0);
  assert.equal(s.targetHeading, s.heading);
  assert.deepEqual(s.effects, {});
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

test('eliminate: sin segmentos, sin efectos y con la hora en que cayó', () => {
  const s = make();
  s.reset(60, 120, 1, 0, 3);
  s.scoreLeftToGrow = 2;
  s.addEffect('fan', 5000, 1000);
  s.eliminate(4000);
  assert.equal(s.gameover, true);
  assert.equal(s.eliminatedAt, 4000);
  assert.deepEqual(s.segments, []);
  assert.deepEqual(s.targetSegments, []);
  assert.equal(s.score, 0);
  assert.equal(s.scoreLeftToGrow, 0);
  assert.deepEqual(s.effects, {});
  assert.equal(s.canAttack(), false);
});

test('reset vuelve a poner en juego a una eliminada', () => {
  const s = make();
  s.eliminate(4000);
  s.reset(60, 120, 1, 0, 3);
  assert.equal(s.gameover, false);
  assert.equal(s.eliminatedAt, null);
  assert.equal(s.segments.length, 3);
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

// Efectos acumulables: un vencimiento por tipo
test('efectos: cada uno vence por su cuenta', () => {
  const s = make();
  s.addEffect('immunity', 4000, 1000);
  s.addEffect('fan', 6000, 2000);
  assert.equal(s.hasEffect('immunity', 4999), true);
  assert.equal(s.hasEffect('fan', 4999), true);
  assert.equal(s.hasEffect('immunity', 5000), false);
  assert.equal(s.hasEffect('fan', 5000), true);
  assert.deepEqual(s.activeEffects(5000), { fan: 8000 });
  assert.deepEqual(s.effects, { fan: 8000 });
});

test('efectos: tomar otro del mismo tipo reinicia su tiempo, no suma', () => {
  const s = make();
  s.addEffect('fan', 6000, 0);
  s.addEffect('fan', 6000, 5000);
  assert.equal(s.effects.fan, 11000);
});

test('useImmunity quita solo el escudo', () => {
  const s = make();
  s.addEffect('immunity', 4000, 0);
  s.addEffect('fan', 6000, 0);
  assert.equal(s.hasImmunity(10), true);
  assert.equal(s.useImmunity(10), true);
  assert.equal(s.hasImmunity(10), false);
  assert.equal(s.hasEffect('fan', 10), true);
  assert.equal(s.useImmunity(10), false);
});

test('activeEffects devuelve una copia', () => {
  const s = make();
  s.addEffect('bigMouth', 6000, 0);
  const copy = s.activeEffects(0);
  copy.bigMouth = 1;
  assert.equal(s.effects.bigMouth, 6000);
});

test('pausa entre tiros: el siguiente sale recién a los cooldownMs', () => {
  const s = make();
  assert.equal(s.tryShot(1000, 200), true);
  assert.equal(s.tryShot(1170, 200), false);
  assert.equal(s.tryShot(1200, 200), true);
  s.reset(60, 120, 1, 0, 3);
  assert.equal(s.tryShot(0, 200), true);
});

test('pausa entre tiros: tolera unos ms de jitter de red sin pasar de 5 por segundo', () => {
  const s = make();
  assert.equal(s.tryShot(1000, 200), true);
  // llega 20 ms antes por el jitter: se acepta, y el siguiente se cuenta desde 1200
  assert.equal(s.tryShot(1180, 200), true);
  assert.equal(s.tryShot(1360, 200), false);
  assert.equal(s.tryShot(1380, 200), true);
  // demasiado temprano (más que la tolerancia): no
  const t = make();
  t.tryShot(0, 200);
  assert.equal(t.tryShot(170, 200), false);
});

test('pausa entre tiros: pidiendo sin parar, nunca más de 5 por segundo', () => {
  for (const every of [10, 90, 180, 190, 200, 210]) {
    const s = make();
    let shots = 0;
    for (let t = 0; t < 10000; t += every) if (s.tryShot(t, 200)) shots++;
    assert.ok(shots <= 51, `cada ${every} ms: ${shots} tiros en 10 s`);
  }
});
