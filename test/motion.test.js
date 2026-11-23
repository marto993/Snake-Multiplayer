const test = require('node:test');
const assert = require('node:assert/strict');
const { Motion } = require('../public/js/net/motion.js');

const CELL = 12;
const TICK = 83;
const LAG = 20;                 // demora fija de red en los tests unitarios
const DELAY = TICK + 4;         // paso + margen mínimo, con jitter 0

// Frames del servidor con hora t, recibidos LAG ms después
function timelineWith(times, extra = () => ({})) {
  const tl = Motion.createTimeline({ tickMs: TICK });
  const frames = times.map((t, i) => ({ t, ...extra(i) }));
  frames.forEach(fr => tl.push(fr, fr.t + LAG));
  return { tl, frames };
}

// `now` del cliente para que el render caiga en la hora del servidor rt
const nowFor = rt => rt + LAG + DELAY;

// PRNG determinístico (mulberry32)
function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Serpiente de 3 que avanza una celda por paso hacia la derecha, dibujada a `hz` cuadros por
// segundo. El servidor emite cada `tick` ms, con un desvío de stampOf(k) ms en la hora de cada
// frame; el frame llega lagOf(k) ms después. El reloj del cliente está corrido 7 s del servidor. Devuelve la velocidad visible
// de la cabeza (px/s) entre cuadros consecutivos, después de medio segundo de arranque:
// media, desvío relativo y el peor cuadro (desvío máximo respecto de la media).
function headSpeeds({ hz, lagOf, tick = TICK, stampOf = () => 0, seconds = 4 }) {
  const CLOCK = 7000;
  const T0 = 1000;
  const tl = Motion.createTimeline({ tickMs: tick });
  const s = {};
  const out = [];
  const arrivals = [];
  for (let k = 0; k * tick < seconds * 1000; k++) {
    const t = T0 + k * tick + stampOf(k);
    arrivals.push({ t, k, at: t + lagOf(k) });
  }
  arrivals.sort((p, q) => p.at - q.at);
  const heads = [];
  let next = 0;
  for (let now = T0; now < T0 + seconds * 1000; now += 1000 / hz) {
    while (next < arrivals.length && arrivals[next].at <= now) {
      const { t, k, at } = arrivals[next++];
      const snake = [0, 1, 2].map(i => ({ x: (k - i) * CELL, y: 0 }));
      tl.push({ t, snake }, at + CLOCK);
    }
    if (!tl.sample(now + CLOCK, s)) continue;
    if (s.b) Motion.snakeAt(s.a.snake, s.b.snake, s.f, CELL, 0, out);
    else Motion.snakeAhead(s.a.snake, { x: 1, y: 0 }, s.e, CELL, 0, out);
    heads.push([now, out[0].x]);
  }
  const speeds = [];
  for (let i = 1; i < heads.length; i++) {
    if (heads[i][0] < T0 + 500) continue;
    speeds.push((heads[i][1] - heads[i - 1][1]) / (heads[i][0] - heads[i - 1][0]) * 1000);
  }
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const sd = Math.sqrt(speeds.reduce((a, b) => a + (b - mean) ** 2, 0) / speeds.length);
  const maxDev = Math.max(...speeds.map(v => Math.abs(v / mean - 1)));
  return { mean, variation: sd / mean, maxDev };
}

const NOMINAL = CELL / TICK * 1000; // 144,6 px/s

for (const hz of [60, 144]) {
  test(`velocidad constante a ${hz} Hz`, () => {
    const r = headSpeeds({ hz, lagOf: () => 30 });
    assert.ok(Math.abs(r.mean - NOMINAL) < 1, `media ${r.mean}`);
    assert.ok(r.variation < 0.01, `variación ${r.variation}`);
  });
}

test('velocidad pareja con jitter de red de hasta 30 ms', () => {
  const rand = rng(7);
  const lags = [];
  const r = headSpeeds({ hz: 60, lagOf: k => (lags[k] ??= 30 + rand() * 30) });
  assert.ok(Math.abs(r.mean - NOMINAL) < 2, `media ${r.mean}`);
  assert.ok(r.variation < 0.05, `variación ${r.variation}`);
  assert.ok(r.maxDev < 0.1, `peor cuadro a ${r.maxDev} de la media`);
});

test('nivel difícil (42 ms): pareja aunque el servidor no emita a intervalos exactos', () => {
  const rand = rng(11);
  const stamps = [];
  const lags = [];
  const r = headSpeeds({
    hz: 60,
    tick: 42,
    stampOf: k => (stamps[k] ??= (rand() - 0.5) * 10), // ±5 ms: desvío de ~3 ms
    lagOf: k => (lags[k] ??= 30 + rand() * 15)
  });
  const nominal = CELL / 42 * 1000;
  assert.ok(Math.abs(r.mean - nominal) < 3, `media ${r.mean}`);
  assert.ok(r.variation < 0.05, `variación ${r.variation}`);
  assert.ok(r.maxDev < 0.1, `peor cuadro a ${r.maxDev} de la media`);
});

test('interpola entre los dos frames que rodean el instante dibujado', () => {
  const { tl, frames } = timelineWith([1000, 1083]);
  const s = tl.sample(nowFor(1041.5), {});
  assert.equal(s.a, frames[0]);
  assert.equal(s.b, frames[1]);
  assert.equal(s.f, 0.5);
  assert.equal(s.e, 0);
});

test('sin frame siguiente extrapola, como mucho medio paso', () => {
  const { tl, frames } = timelineWith([1000, 1083]);
  const s = tl.sample(nowFor(5000), {});
  assert.equal(s.a, frames[1]);
  assert.equal(s.b, null);
  assert.equal(s.e, 0.5);
});

test('el estado inicial queda un paso antes del primer frame', () => {
  const tl = Motion.createTimeline({ tickMs: TICK });
  const seed = { name: 'inicio' };
  tl.seed(seed);
  const first = { t: 2000 };
  tl.push(first, 2000 + LAG);
  const s = tl.sample(nowFor(1958.5), {});
  assert.equal(s.a, seed);
  assert.equal(s.b, first);
  assert.equal(s.f, 0.5);
});

test('el instante dibujado no retrocede cuando llega un frame muy atrasado', () => {
  const { tl } = timelineWith([1000, 1083, 1166]);
  const s = {};
  const before = tl.sample(nowFor(1100), s).rt;
  // 200 ms tarde: el jitter sube de golpe y agranda el margen unos 40 ms
  tl.push({ t: 1249 }, 1249 + LAG + 200);
  const after = tl.sample(nowFor(1100) + 16, s).rt;
  assert.ok(after >= before, `${after} < ${before}`);
});

test('los eventos salen una sola vez, cuando el render llega a su frame', () => {
  const tl = Motion.createTimeline({ tickMs: TICK });
  tl.seed({ ev: 'inicio' });
  ['a', 'b', 'c'].forEach((ev, i) => tl.push({ t: 1000 + i * TICK, ev }, 1000 + i * TICK + LAG));
  const seen = [];
  const take = fr => seen.push(fr.ev);
  tl.sample(nowFor(1100), {});
  tl.drain(take);
  tl.drain(take);
  assert.deepEqual(seen, ['a', 'b']);
  tl.sample(nowFor(1170), {});
  tl.drain(take);
  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('descarta eventos de más de 300 ms (pestaña en segundo plano)', () => {
  const { tl } = timelineWith([1000, 1083, 1166], i => ({ ev: i }));
  const seen = [];
  tl.sample(nowFor(1350), {});
  tl.drain(fr => seen.push(fr.ev));
  assert.deepEqual(seen, [1, 2]);
});

test('fin de ronda: salta al último frame y despacha lo pendiente', () => {
  const { tl, frames } = timelineWith([1000, 1083, 1166], i => ({ ev: 'abc'[i] }));
  const seen = [];
  tl.sample(nowFor(1010), {});
  tl.drain(fr => seen.push(fr.ev));
  const s = tl.sampleLatest({});
  assert.equal(s.a, frames[2]);
  assert.equal(s.b, null);
  tl.drain(fr => seen.push(fr.ev));
  assert.deepEqual(seen, ['a', 'b', 'c']);
});

test('portal: el segmento sale por un borde y entra por el opuesto', () => {
  const out = [];
  const a = [{ x: 588, y: 60 }];
  const b = [{ x: 0, y: 60 }];
  Motion.snakeAt(a, b, 0.25, CELL, 600, out);
  assert.deepEqual(out[0], { x: 591, y: 60 });
  Motion.snakeAt(a, b, 0.75, CELL, 600, out);
  assert.deepEqual(out[0], { x: -3, y: 60 });
});

test('al crecer, la cola nueva nace quieta sobre la última', () => {
  const out = [];
  const n = Motion.snakeAt(
    [{ x: 24, y: 0 }, { x: 12, y: 0 }],
    [{ x: 36, y: 0 }, { x: 24, y: 0 }, { x: 12, y: 0 }],
    0.5, CELL, 600, out);
  assert.equal(n, 3);
  assert.deepEqual(out, [{ x: 30, y: 0 }, { x: 18, y: 0 }, { x: 12, y: 0 }]);
});

test('al achicarse, los segmentos que sobran siguen el cuerpo hasta desaparecer', () => {
  const out = [];
  const n = Motion.snakeAt(
    [{ x: 48, y: 0 }, { x: 36, y: 0 }, { x: 24, y: 0 }, { x: 12, y: 0 }],
    [{ x: 60, y: 0 }, { x: 48, y: 0 }],
    0.5, CELL, 600, out);
  assert.equal(n, 4);
  assert.deepEqual(out, [{ x: 54, y: 0 }, { x: 42, y: 0 }, { x: 30, y: 0 }, { x: 18, y: 0 }]);
});

test('un salto de más de 1,5 celdas no se interpola (reaparición)', () => {
  const out = [];
  Motion.snakeAt([{ x: 0, y: 0 }], [{ x: 300, y: 240 }], 0.5, CELL, 600, out);
  assert.deepEqual(out, [{ x: 300, y: 240 }]);
});

test('extrapolación: la cabeza sigue su dirección y el cuerpo va hacia el segmento anterior', () => {
  const out = [];
  Motion.snakeAhead([{ x: 24, y: 0 }, { x: 12, y: 0 }], { x: 0, y: 1 }, 0.5, CELL, 600, out);
  assert.deepEqual(out, [{ x: 24, y: 6 }, { x: 18, y: 0 }]);
});

test('proyectiles: nacen una celda atrás y el que desaparece sigue de largo', () => {
  const out = {};
  Motion.projectileAt(null, { x: 120, y: 60, direction: { x: 1, y: 0 } }, 0.5, CELL, out);
  assert.deepEqual(out, { x: 114, y: 60 });
  Motion.projectileAt({ x: 120, y: 60, direction: { x: 0, y: -1 } }, null, 0.5, CELL, out);
  assert.deepEqual(out, { x: 120, y: 54 });
  Motion.projectileAt({ x: 120, y: 60 }, { x: 132, y: 60 }, 0.25, CELL, out);
  assert.deepEqual(out, { x: 123, y: 60 });
});

test('arena apaisada: cada eje envuelve con su propio período', () => {
  const out = [];
  // Sale por la derecha de una arena de 768 × 432: va por el lado corto en x
  Motion.snakeAt([{ x: 760, y: 200 }], [{ x: -4, y: 200 }], 0.5, CELL, { x: 768, y: 432 }, out);
  assert.ok(Math.abs(out[0].x - (-6)) < 1e-9 || Math.abs(out[0].x - 762) < 1e-9, JSON.stringify(out[0]));
  // Sale por abajo: envuelve con 432, no con 768
  Motion.snakeAt([{ x: 100, y: 424 }], [{ x: 100, y: -4 }], 0.5, CELL, { x: 768, y: 432 }, out);
  assert.ok(Math.abs(out[0].y - 426) < 1e-9 || Math.abs(out[0].y - (-6)) < 1e-9, JSON.stringify(out[0]));
  // Un salto real de media arena en y (432 / 2 = 216 < 300) no se confunde con un portal en x
  Motion.snakeAt([{ x: 100, y: 10 }], [{ x: 100, y: 22 }], 0.5, CELL, { x: 768, y: 432 }, out);
  assert.equal(out[0].y, 16);
});

test('una serpiente anclada no se extrapola aunque el frame llegue tarde', () => {
  // Anclada hasta 2000 (hora del servidor): quieta, no avanza media celda y vuelve
  assert.equal(Motion.leadFor({ anchoredUntil: 2000 }, 0.5, 1500), 0);
  // Ya suelta, o sin ancla: se extrapola como siempre
  assert.equal(Motion.leadFor({ anchoredUntil: 2000 }, 0.5, 2000), 0.5);
  assert.equal(Motion.leadFor({}, 0.4, 1500), 0.4);
});
