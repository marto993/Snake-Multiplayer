const test = require('node:test');
const assert = require('node:assert/strict');
const Snake = require('../public/snakeClass.js');
const { buildRoomConfig } = require('../game/difficulty');
const { traceProjectile } = require('../game/projectiles');
const { SKILLS, isBotLevel, botLevel, botName, createBrain, stepBot, stepsToReach, rayHit, makeRay } = require('../game/bots');
const { playMatch } = require('../tools/bot-duel');

const config = buildRoomConfig('medium', { roundTime: 120 });
const cell = config.segmentSize;

// Generador con semilla, para que cada prueba repita siempre los mismos casos
function seeded(seed) {
  let a = seed;
  return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; };
}

// Serpiente en línea recta: la cabeza en (x, y), el cuerpo detrás
function snake(id, x, y, length, angle = 0) {
  const s = new Snake(id, id, cell, config.canvasWidth, config.canvasHeight, x, y, 1, 0);
  s.turnRate = config.turnDegrees * Math.PI / 180;
  s.setHeading(angle);
  s.targetHeading = s.heading;
  s.segments = Array.from({ length }, (_, i) => ({ x: x - Math.cos(angle) * cell * i, y: y - Math.sin(angle) * cell * i }));
  s.updateTargets();
  return s;
}

const world = (players, extra = {}) => ({
  players, foods: [], consumables: [], projectiles: [], config, now: 1000000, timeLeft: 60, ...extra
});

test('niveles: los cuatro existen y lo desconocido cae en medio', () => {
  assert.deepEqual(Object.keys(SKILLS), ['easy', 'medium', 'hard', 'extreme']);
  assert.equal(botLevel('extreme'), 'extreme');
  for (const bad of [undefined, null, 'imposible', 'toString', 4, {}]) {
    assert.equal(isBotLevel(bad), false);
    assert.equal(botLevel(bad), 'medium');
  }
});

test('nombres: nunca repite uno que ya está en la sala', () => {
  const taken = ['vega'];
  for (let i = 0; i < 40; i++) {
    const name = botName(taken);
    assert.ok(!taken.some(t => t.toLowerCase() === name.toLowerCase()), name);
    taken.push(name);
  }
});

test('pasos hasta una comida: derecho, por el portal y detrás', () => {
  const me = snake('a', 120, 120, 3);
  assert.equal(stepsToReach(me, config, 240, 120, cell * 0.85), 10);
  // Por el borde izquierdo está a 10 celdas, no a 54
  const left = snake('a', 24, 120, 3, Math.PI);
  assert.ok(stepsToReach(left, config, config.canvasWidth - 96, 120, cell * 0.85) <= 11);
  const behind = stepsToReach(me, config, 24, 120, cell * 0.85);
  assert.ok(behind > 8 && behind < 20, String(behind));
});

// La cuenta de rayHit contra lo que pasa de verdad, paso a paso como en el servidor
test('predice el segmento que toca un disparo contra una serpiente que sigue derecho', () => {
  const rng = seeded(7);
  const bounds = { cell, width: config.canvasWidth, height: config.canvasHeight };
  let hits = 0;
  let exact = 0;
  for (let n = 0; n < 400; n++) {
    const angle = rng() * Math.PI * 2;
    const rival = snake('b', 250 + rng() * 260, 150 + rng() * 130, 12, angle);
    const from = { x: 40 + rng() * 680, y: 40 + rng() * 350 };
    const at = rival.segments[Math.floor(rng() * 8)];
    const aim = Math.atan2(at.y - from.y, at.x - from.x);
    const direction = { x: Math.cos(aim), y: Math.sin(aim) };
    const ahead = Array.from({ length: 10 }, (_, j) => ({
      x: rival.segments[0].x + Math.cos(angle) * cell * (j + 1), y: rival.segments[0].y + Math.sin(angle) * cell * (j + 1)
    }));
    const ctx = { speed: config.projectileCells * cell, radius: cell * 0.7 };
    const predicted = rayHit(makeRay(from.x, from.y, direction, config), rival.segments, ahead, ctx);

    const shot = { ...from, direction };
    let real = null;
    for (let s = 0; s < 25 && !real; s++) {
      const r = traceProjectile(shot, config.projectileCells, bounds, [rival], cell * 0.7);
      if (r.outcome === 'alive') { shot.x = r.x; shot.y = r.y; rival.moveLogic(); } else real = r;
    }
    if (real.outcome !== 'hit') { if (!predicted) exact++; hits++; continue; }
    hits++;
    if (predicted && Math.abs(predicted.index - real.segmentIndex) <= 1) exact++;
  }
  assert.ok(exact / hits > 0.95, `acertó ${exact} de ${hits}`);
});

test('el extremo dispara a un rival que tiene enfrente', () => {
  const me = snake('a', 120, 200, 6);
  const rival = snake('b', 300, 150, 20, -Math.PI / 2);   // sube: su cuerpo cruza la línea de tiro
  const { fire } = stepBot(createBrain('extreme', seeded(1)), me, world([me, rival]));
  assert.equal(fire, true);
});

test('no dispara si no hay a quién, si el blanco no lo vale o si no puede', () => {
  const me = snake('a', 120, 200, 6);
  const far = snake('b', 300, 400, 20, 0);
  assert.equal(stepBot(createBrain('extreme', seeded(1)), me, world([me, far])).fire, false);

  const shielded = snake('b', 300, 182, 4, -Math.PI / 2);
  shielded.addEffect('immunity', 5000, 1000000);
  assert.equal(stepBot(createBrain('extreme', seeded(1)), me, world([me, shielded])).fire, false);

  const single = snake('c', 120, 200, 1);
  const target = snake('b', 300, 150, 20, -Math.PI / 2);
  assert.equal(stepBot(createBrain('extreme', seeded(1)), single, world([single, target])).fire, false);

  me.lastShotAt = 1000000 - 50;   // dentro de la pausa entre tiros
  assert.equal(stepBot(createBrain('extreme', seeded(1)), me, world([me, target])).fire, false);
});

test('entre un rival que puede eliminar y uno largo, igual de a mano, va por el que elimina', () => {
  // Los dos vienen hacia la izquierda, uno arriba y otro abajo de su línea, a la misma distancia
  const me = snake('a', 300, 216, 8);
  const short = snake('b', 420, 150, 3, Math.PI);
  const long = snake('c', 420, 282, 20, Math.PI);
  const { angle } = stepBot(createBrain('extreme', seeded(1)), me, world([me, short, long]));
  assert.ok(angle < -0.05, `gira hacia ${angle.toFixed(2)} rad`);
  // Con los lugares cambiados, gira para el otro lado
  const short2 = snake('b', 420, 282, 3, Math.PI);
  const long2 = snake('c', 420, 150, 20, Math.PI);
  const other = stepBot(createBrain('extreme', seeded(1)), me, world([me, short2, long2]));
  assert.ok(other.angle > 0.05, `gira hacia ${other.angle.toFixed(2)} rad`);
});

test('va hacia la comida que tiene más cerca', () => {
  const me = snake('a', 300, 200, 3);
  const foods = [{ x: 300, y: 320, score: 3 }, { x: 700, y: 200, score: 3 }];
  const { angle } = stepBot(createBrain('extreme', seeded(1)), me, world([me], { foods }));
  assert.ok(Math.abs(angle - Math.PI / 2) < 0.01, String(angle));
});

test('el extremo esquiva un disparo que le daría en la cabeza', () => {
  const me = snake('a', 300, 200, 10);
  const foods = [{ x: 420, y: 200, score: 5 }];
  // Viene de arriba hacia donde va a estar la cabeza dentro de 5 pasos
  const projectiles = [{ id: 'p', playerId: 'b', x: 360, y: 20, direction: { x: 0, y: 1 } }];
  const { angle } = stepBot(createBrain('extreme', seeded(1)), me, world([me], { foods, projectiles }));
  assert.ok(Math.abs(angle) > 0.3, String(angle));
  const calm = stepBot(createBrain('extreme', seeded(1)), me, world([me], { foods }));
  assert.ok(Math.abs(calm.angle) < 0.01, String(calm.angle));
});

test('reacción: el fácil tarda varios pasos en decidir algo; el extremo, ninguno', () => {
  const me = snake('a', 300, 200, 3);
  const w = world([me], { foods: [{ x: 300, y: 320, score: 3 }] });
  const firstMove = level => {
    const brain = createBrain(level, seeded(3));
    for (let n = 1; n < 30; n++) if (stepBot(brain, me, w).angle !== null) return n;
    return Infinity;
  };
  assert.equal(firstMove('extreme'), 1);
  assert.ok(firstMove('easy') > SKILLS.easy.delay);
});

test('decidir no modifica el mundo', () => {
  const me = snake('a', 120, 200, 6);
  const rival = snake('b', 300, 150, 20, -Math.PI / 2);
  const w = world([me, rival], {
    foods: [{ x: 300, y: 320, score: 3 }], consumables: [{ id: 'c', type: 'fan', x: 60, y: 60 }],
    projectiles: [{ id: 'p', playerId: 'b', x: 360, y: 20, direction: { x: 0, y: 1 } }]
  });
  const before = JSON.stringify(w);
  for (const level of Object.keys(SKILLS)) {
    const brain = createBrain(level, seeded(5));
    for (let n = 0; n < 12; n++) stepBot(brain, me, w);
  }
  assert.equal(JSON.stringify(w), before);
});

test('cada nivel le gana al anterior casi siempre', () => {
  const order = ['easy', 'medium', 'hard', 'extreme'];
  for (let i = 1; i < order.length; i++) {
    let won = 0;
    for (let g = 0; g < 6; g++) {
      const levels = g % 2 ? [order[i], order[i - 1]] : [order[i - 1], order[i]];
      const { players, winners } = playMatch(levels, { seed: 40 + g, time: 60 });
      // Gana la última en pie o, si se acaba el tiempo, la más larga (un empate no cuenta)
      const strong = players.find(p => p.level === order[i]).id;
      if (winners.length === 1 && winners[0] === strong) won++;
    }
    assert.ok(won >= 4, `${order[i]} le ganó a ${order[i - 1]} ${won} de 6`);
  }
});

test('durante el escudo al nacer nadie queda fuera', () => {
  const guard = config.spawnShield;
  for (let g = 0; g < 8; g++) {
    const { players } = playMatch(['extreme', 'hard', 'hard'], { seed: 70 + g, time: 20 });
    for (const p of players) if (p.outAt !== null) assert.ok(p.outAt >= guard, `${p.level} quedó fuera a los ${p.outAt} s`);
  }
});

test('la misma semilla repite la misma partida', () => {
  const run = () => playMatch(['extreme', 'hard', 'easy'], { seed: 9, time: 20 }).ranking;
  assert.deepEqual(run(), run());
});
