/*
 * Bots: deciden hacia dónde girar y cuándo disparar, una vez por paso del servidor, con lo mismo
 * que ve un jugador en pantalla (posiciones, rumbos y efectos; no el rumbo que pidió cada rival).
 * Juegan con las mismas reglas: el giro máximo, la pausa entre tiros y el costo de disparar los
 * sigue aplicando el servidor. Lo que cambia entre niveles es la reacción, la puntería y cuánto
 * piensan (SKILLS).
 * No modifica el mundo: el game loop aplica la decisión. Lo único que cambia es la memoria del bot.
 */
'use strict';

const { wrapDelta, wrapPoint } = require('./geometry');
const { fanDirections } = require('./projectiles');

const TAU = Math.PI * 2;
// Alcances del servidor (index.js), en celdas: los bots cuentan con los mismos
const EAT_REACH = 0.85;
const PICKUP_REACH = 0.9;
const HIT_REACH = 0.7;

// thinkEvery / delay: cada cuántos pasos decide y cuántos tarda en aplicarlo. Es la reacción: un
//   paso son 60 a 70 ms, y una persona tarda unos 250 ms.
// aimError / steerError: error de puntería y de rumbo, en grados (desvío típico)
// depth / width: cuántas comidas encadena al planear y entre cuántas elige en cada eslabón
// foodNoise: cuánto se equivoca al valorar la comida (0 = nada)
// contest: deja la comida a la que un rival llega antes
// aim: gira a propósito para disparar (0 = solo dispara a lo que le queda enfrente)
// range: hasta qué distancia dispara (px)
// minShot: ganancia mínima esperada para disparar, en segmentos
// shotPause: pausa mínima propia entre tiros (ms), además de la del servidor
// fireChance: probabilidad de animarse a un disparo que le conviene
// powers: cuánto le interesan los consumibles
// dodge: probabilidad de esquivar un disparo que ve venir
// breakShield: gasta un disparo en romper un escudo si el corte siguiente lo vale
//
// El extremo no reacciona al instante ni tira sin pausa: con la eliminación, reacción 0, puntería
// perfecta y 5 tiros por segundo dejaban fuera a un difícil a los 4 s. Así le sigue ganando casi
// siempre, pero en unos 35 s (docs/GAMEPLAY_SPEC.md, etapa 5).
const SKILLS = {
  easy: {
    thinkEvery: 4, delay: 6, aimError: 14, steerError: 22, depth: 1, width: 6, foodNoise: 0.9,
    contest: false, aim: 0, range: 150, minShot: 2, shotPause: 2000, fireChance: 0.2,
    powers: 0.1, dodge: 0, breakShield: false
  },
  medium: {
    thinkEvery: 2, delay: 4, aimError: 6, steerError: 8, depth: 2, width: 6, foodNoise: 0.35,
    contest: false, aim: 0.25, range: 260, minShot: 3, shotPause: 800, fireChance: 0.6,
    powers: 0.7, dodge: 0.15, breakShield: false
  },
  hard: {
    thinkEvery: 2, delay: 3, aimError: 3.5, steerError: 3, depth: 3, width: 7, foodNoise: 0.15,
    contest: true, aim: 0.55, range: 380, minShot: 2.5, shotPause: 400, fireChance: 0.85,
    powers: 1, dodge: 0.4, breakShield: false
  },
  extreme: {
    thinkEvery: 1, delay: 2, aimError: 1.5, steerError: 0, depth: 4, width: 8, foodNoise: 0,
    contest: true, aim: 1, range: 900, minShot: 0.8, shotPause: 800, fireChance: 1,
    powers: 1, dodge: 1, breakShield: true
  }
};

const DEFAULT_LEVEL = 'medium';
const DISCOUNT = 0.965;       // por paso: un punto a 20 pasos (1,3 s) vale la mitad que uno ya
const PLAN_TICKS = 3;         // el plan de comida se rehace cada tantos pasos (o si el objetivo ya no está)
const LOOK_AHEAD = 10;        // pasos hacia adelante al esquivar y al adelantar una cabeza
const MAX_REACH_STEPS = 90;   // tope al simular el camino a una comida
// Eliminación (docs/GAMEPLAY_SPEC.md, etapa 5), en segmentos: dejar fuera a un rival saca a un
// competidor de la partida; quedar fuera es lo peor que puede pasar
const KILL_VALUE = 8;
const DEATH_COST = 20;
// Si mi cuerpo está en la línea más allá del blanco (la cola que todavía no cruzó un portal queda
// adelante, en la misma fila), un tiro que le erra me da a mí: probabilidad de que eso pase
const MISS_RISK = 0.5;

// Estrellas de hasta 8 letras, para que entren en la lista de la sala junto al selector de nivel
const STAR_NAMES = [
  'Vega', 'Sirio', 'Rigel', 'Altair', 'Deneb', 'Antares', 'Mira', 'Polaris', 'Capella', 'Régulo',
  'Espiga', 'Arturo', 'Canopo', 'Procyon', 'Adhara', 'Alnitak', 'Shaula', 'Hadar'
];

function isBotLevel(level) {
  return typeof level === 'string' && Object.prototype.hasOwnProperty.call(SKILLS, level);
}

function botLevel(level) {
  return isBotLevel(level) ? level : DEFAULT_LEVEL;
}

// Un nombre de estrella que nadie use en la sala
function botName(taken, rng = Math.random) {
  const used = new Set(taken.map(name => String(name).toLowerCase()));
  const free = STAR_NAMES.filter(name => !used.has(name.toLowerCase()));
  if (free.length) return free[Math.floor(rng() * free.length)];
  for (let n = 2; ; n++) {
    const name = `${STAR_NAMES[n % STAR_NAMES.length]} ${n}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

// Memoria de un bot: se crea de nuevo al empezar cada partida
function createBrain(level, rng = Math.random) {
  return {
    level: botLevel(level),
    skill: SKILLS[botLevel(level)],
    rng,
    tick: Math.floor(rng() * 4),  // desfasa a los bots de un mismo nivel
    queue: [],                    // decisiones que esperan su tiempo de reacción
    lastShotAt: -Infinity,
    seenShots: new Map(),         // disparo -> si decidió esquivarlo
    plan: null,                   // comida hacia la que va: { target, value, until }
    foodBias: new Map(),          // comida -> error con que la valora (no cambia en cada paso)
    foodBiasUntil: 0
  };
}

// Un paso del bot -> { angle, fire }. angle: rumbo a pedir, o null si sigue igual.
// world: { players, foods, consumables, projectiles, config, now, timeLeft }
function stepBot(brain, me, world) {
  const { skill } = brain;
  brain.tick++;
  if (brain.tick % skill.thinkEvery === 0) {
    const decision = decide(brain, me, world);
    decision.at = brain.tick + skill.delay;
    brain.queue.push(decision);
  }
  let angle = null;
  let fire = false;
  while (brain.queue.length && brain.queue[0].at <= brain.tick) {
    const due = brain.queue.shift();
    angle = due.angle;
    fire = fire || due.fire;
  }
  // El tiro se decidió `delay` pasos atrás y la serpiente siguió girando: si ahora su cuerpo está en
  // la línea, se lo aguanta (con daño fijo, tirarse encima es de lo que más segmentos le costaba)
  if (fire && ownBodyInLine(me, world)) fire = false;
  return { angle, fire };
}

// Si el disparo que saldría ahora, en el rumbo de la cabeza (o alguno del abanico), toca el propio cuerpo
function ownBodyInLine(me, world) {
  const { config: cfg, now } = world;
  const cell = cfg.segmentSize;
  const head = me.segments[0];
  const ctx = { speed: cfg.projectileCells * cell, radius: cell * HIT_REACH };
  const directions = me.fanShots > 0 ? fanDirections(me.direction, cfg.fanDegrees) : [me.direction];
  return directions.some(d => rayHit(makeRay(head.x + d.x * cell, head.y + d.y * cell, d, cfg), me.segments, [], ctx));
}

// ---------------------------------------------------------------------------
// Geometría y movimiento
// ---------------------------------------------------------------------------

function normalize(a) {
  a %= TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

function gaussian(rng) {
  return (rng() + rng() + rng() + rng() - 2) * 1.7;
}

function rad(degrees) {
  return degrees * Math.PI / 180;
}

// Pasos que tarda en tocar un punto girando hacia él con el giro máximo (Infinity si no llega: un
// punto dentro del círculo de giro obliga a dar vueltas)
function stepsToReach(me, cfg, tx, ty, reach) {
  const { segmentSize: cell, canvasWidth: w, canvasHeight: h } = cfg;
  const r2 = reach * reach;
  let dx = wrapDelta(tx - me.segments[0].x, w);
  let dy = wrapDelta(ty - me.segments[0].y, h);
  let heading = me.heading;
  const limit = Math.min(MAX_REACH_STEPS, Math.ceil(Math.hypot(dx, dy) / cell) + 14);
  for (let step = 1; step <= limit; step++) {
    const delta = normalize(Math.atan2(dy, dx) - heading);
    heading += Math.abs(delta) <= me.turnRate ? delta : Math.sign(delta) * me.turnRate;
    const vx = Math.cos(heading) * cell;
    const vy = Math.sin(heading) * cell;
    // Contacto en el tramo, como touchedAlong
    let t = (dx * vx + dy * vy) / (cell * cell);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = dx - vx * t;
    const ey = dy - vy * t;
    if (ex * ex + ey * ey < r2) return step;
    dx -= vx;
    dy -= vy;
  }
  return Infinity;
}

// Cabezas futuras de una serpiente que pide `angle`: [posición tras 1 paso, tras 2, ...]
function futureHeads(snake, angle, steps, cfg) {
  const { segmentSize: cell, canvasWidth: w, canvasHeight: h } = cfg;
  const heads = [];
  let heading = snake.heading;
  let { x, y } = snake.segments[0];
  for (let i = 0; i < steps; i++) {
    const delta = normalize(angle - heading);
    heading += Math.abs(delta) <= snake.turnRate ? delta : Math.sign(delta) * snake.turnRate;
    const p = { x: x + Math.cos(heading) * cell, y: y + Math.sin(heading) * cell, heading };
    wrapPoint(p, cell, w, h);
    heads.push(p);
    x = p.x;
    y = p.y;
  }
  return heads;
}

// ---------------------------------------------------------------------------
// Disparos: qué toca un proyectil
// ---------------------------------------------------------------------------

/*
 * El cuerpo sigue el camino de la cabeza, así que lo que va a ocupar se sabe de antemano: si la
 * cabeza está hoy en path[0], el segmento k está en path[k], y dentro de `n` pasos el que esté en
 * path[k] será el k + n (hasta que pase la cola). Las posiciones que todavía no recorrió la cabeza
 * son una suposición (sigue derecho): `ahead` las guarda, ahead[0] es la del próximo paso.
 *
 * -> el primer punto que toca el rayo, o null:
 *    { index, steps, guess, x, y }  index: segmento tocado al llegar; steps: pasos de proyectil;
 *                                   guess: 0 si el punto ya es del cuerpo, n si es la cabeza de n pasos más
 */
function rayHit(ray, body, ahead, ctx) {
  const { speed, radius } = ctx;
  const r2 = radius * radius;
  const length = body.length;
  let best = null;

  const check = (p, k) => {
    const dx = p.x - ray.x;
    const dy = p.y - ray.y;
    const along = dx * ray.dx + dy * ray.dy;
    if (along < -radius || along - radius > ray.length) return;
    const perp = dx * ray.dy - dy * ray.dx;
    const gap = r2 - perp * perp;
    if (gap <= 0) return;
    const half = Math.sqrt(gap);
    const enter = Math.max(0, along - half);
    if (along + half < 0 || enter > ray.length || (best && enter >= best.enter)) return;
    // El proyectil se mueve antes que las serpientes: en su paso s las ve como tras s - 1 pasos
    const first = Math.max(1, Math.ceil(enter / speed));
    const last = Math.max(first, Math.ceil(Math.min(along + half, ray.length) / speed));
    for (let s = first; s <= last; s++) {
      const index = k + (s - 1);
      if (index < 0 || index >= length) continue;
      best = { index, steps: s, guess: k < 0 ? -k : 0, x: p.x, y: p.y, enter };
      return;
    }
  };

  for (let k = 0; k < length; k++) check(body[k], k);
  for (let j = 0; j < ahead.length; j++) check(ahead[j], -(j + 1));
  return best;
}

// Recorrido de un proyectil hasta el borde de la arena (los disparos no pasan por los portales)
function makeRay(x, y, direction, cfg) {
  let length = Infinity;
  if (direction.x > 1e-6) length = Math.min(length, (cfg.canvasWidth - x) / direction.x);
  else if (direction.x < -1e-6) length = Math.min(length, -x / direction.x);
  if (direction.y > 1e-6) length = Math.min(length, (cfg.canvasHeight - y) / direction.y);
  else if (direction.y < -1e-6) length = Math.min(length, -y / direction.y);
  return { x, y, dx: direction.x, dy: direction.y, length: Math.max(0, length) };
}

// Un impacto quita hitDamage segmentos de la cola, toque donde toque
function segmentsLost(length, cfg) {
  return Math.min(cfg.hitDamage, length);
}

// Si un impacto la deja fuera (contando lo que ya comió y todavía no creció)
function wouldEliminate(snake, cfg) {
  return snake.segments.length + snake.scoreLeftToGrow <= cfg.hitDamage;
}

// Cuánto valen los segmentos que pierde un rival: lo que baja él, lo que puedo comer de los restos
// y, si queda fuera, que deja de competir
function cutValue(me, rival, lost, at, world, ctx) {
  const mine = me.segments.length + me.scoreLeftToGrow;
  const theirs = rival.segments.length + rival.scoreLeftToGrow;
  const threat = theirs >= mine * 0.75 ? 1 : 0.45;
  const hurt = ctx.rivals.length === 1 ? 1 : 0.3 + 0.5 * threat;
  let collect = 0;
  if (ctx.ticksLeft > 25) {
    const d = distance(me.segments[0], at, world.config);
    collect = 0.6;
    for (const other of ctx.rivals) {
      if (distance(other.segments[0], at, world.config) < d) collect = Math.max(0.15, collect - 0.2);
    }
    if (d > 260) collect *= 0.6;
  }
  return lost * (hurt + collect) + (wouldEliminate(rival, world.config) ? KILL_VALUE : 0);
}

function distance(a, b, cfg) {
  return Math.hypot(wrapDelta(a.x - b.x, cfg.canvasWidth), wrapDelta(a.y - b.y, cfg.canvasHeight));
}

// Ganancia esperada de disparar en `direction` desde `head`, en segmentos (sin descontar el costo)
function shotValue(me, head, directions, world, ctx, skill) {
  const cell = world.config.segmentSize;
  const perRival = new Map();
  let self = 0;
  for (const direction of directions) {
    const ray = makeRay(head.x + direction.x * cell, head.y + direction.y * cell, direction, world.config);
    let best = null;
    let target = null;
    for (const rival of ctx.rivals) {
      const hit = rayHit(ray, rival.segments, ctx.ahead.get(rival.id), ctx);
      if (hit && (!best || hit.enter < best.enter)) { best = hit; target = rival; }
    }
    const own = rayHit(ray, me.segments, [], ctx);
    // Disparar cuesta uno antes de que el tiro vuelva: el impacto cae sobre lo que queda
    const left = me.segments.length - 1;
    const selfCost = own && !me.hasEffect('immunity', world.now)
      ? segmentsLost(left, world.config) + (left <= world.config.hitDamage ? DEATH_COST : 0)
      : 0;
    if (own && (!best || own.enter < best.enter)) {
      self = Math.max(self, selfCost);
      continue;
    }
    if (!best || best.enter > skill.range) continue;
    if (own) self = Math.max(self, selfCost * MISS_RISK);
    const lost = segmentsLost(target.segments.length, world.config);
    const sure = best.guess ? Math.max(0.1, 1 - 0.16 * best.guess) : 1;
    let value = cutValue(me, target, lost, best, world, ctx) * sure;
    const arrives = world.now + best.steps * ctx.tickMs;
    if (target.hasEffect('immunity', arrives)) {
      // El escudo bloquea y se gasta (el de nacer, ni eso): solo conviene si el tiro siguiente la deja fuera
      value = skill.breakShield && wouldEliminate(target, world.config) && arrives >= (world.guardUntil || 0) ? value * 0.3 : 0;
    }
    perRival.set(target.id, Math.max(value, perRival.get(target.id) || 0));
  }
  let total = 0;
  for (const value of perRival.values()) total += value;
  return total - self * 1.5;
}

// El mejor rumbo para disparar girando unos pasos -> { angle, turns, value } o null
function bestAim(me, world, ctx, skill) {
  const { segmentSize: cell } = world.config;
  const head = me.segments[0];
  let best = null;

  const consider = (rival, p, k) => {
    const d0 = Math.hypot(p.x - head.x, p.y - head.y);
    if (d0 > skill.range || d0 < cell * 1.5) return;
    let angle = Math.atan2(p.y - head.y, p.x - head.x);
    const turns = Math.ceil(Math.abs(normalize(angle - me.heading)) / me.turnRate - 1e-9);
    if (turns > 5) return;
    let from = head;
    if (turns > 0) {
      const heads = futureHeads(me, angle, turns, world.config);
      from = heads[turns - 1];
      // Un portal en el medio cambia todo el tiro
      if (Math.abs(from.x - head.x) > cell * 8 || Math.abs(from.y - head.y) > cell * 8) return;
      angle = Math.atan2(p.y - from.y, p.x - from.x);
      if (Math.abs(normalize(angle - from.heading)) > me.turnRate) return;
    }
    const d = Math.hypot(p.x - from.x, p.y - from.y) - cell;
    const steps = Math.max(1, Math.ceil(d / ctx.speed));
    const index = k + turns + steps - 1;
    const length = rival.segments.length;
    if (index < 0 || index >= length) return;
    const guess = k < 0 ? -k : 0;
    const sure = guess ? Math.max(0.1, 1 - 0.16 * guess) : 1;
    let value = cutValue(me, rival, segmentsLost(length, world.config), p, world, ctx) * sure;
    const arrives = world.now + (turns + steps) * ctx.tickMs;
    if (rival.hasEffect('immunity', arrives)) value *= skill.breakShield && wouldEliminate(rival, world.config) && arrives >= (world.guardUntil || 0) ? 0.3 : 0;
    value = (value - 1) * Math.pow(DISCOUNT, turns);
    if (!best || value > best.value) best = { angle, turns, value };
  };

  for (const rival of ctx.rivals) {
    const ahead = ctx.ahead.get(rival.id);
    for (let j = 0; j < Math.min(6, ahead.length); j++) consider(rival, ahead[j], -(j + 1));
    // Cualquier segmento quita lo mismo: los primeros uno por uno y del resto, salteado
    const n = rival.segments.length;
    for (let k = 0; k < n; k += k < 8 ? 1 : 3) consider(rival, rival.segments[k], k);
  }
  return best;
}

// ---------------------------------------------------------------------------
// Comida
// ---------------------------------------------------------------------------

// Lo que se puede comer o tomar, con su valor y los pasos que faltan para llegar
function listTargets(brain, me, world, ctx) {
  const { skill, rng } = brain;
  const { config: cfg, now } = world;
  const cell = cfg.segmentSize;
  const bigMouth = me.hasEffect('bigMouth', now);
  const reach = cell * (bigMouth ? cfg.bigMouthReach : EAT_REACH);
  const pending = me.scoreLeftToGrow;

  if (now > brain.foodBiasUntil) {
    brain.foodBias.clear();
    brain.foodBiasUntil = now + 2500;
  }
  const bias = item => {
    if (!skill.foodNoise) return 1;
    const key = item.x + ',' + item.y;
    let b = brain.foodBias.get(key);
    if (b === undefined) {
      b = Math.max(0.05, 1 + gaussian(rng) * skill.foodNoise);
      brain.foodBias.set(key, b);
    }
    return b;
  };

  const targets = [];
  const add = (item, value, itemReach) => {
    const steps = stepsToReach(me, cfg, item.x, item.y, itemReach);
    if (steps === Infinity) return;
    if (item.expiresAt && now + steps * ctx.tickMs > item.expiresAt) return;
    if (skill.contest) {
      for (const rival of ctx.rivals) {
        const theirs = distance(rival.segments[0], item, cfg) / cell;
        if (theirs + 1.5 < steps) { value *= 0.35; break; }
      }
    }
    if (value > 0) targets.push({ item, x: item.x, y: item.y, value, steps, reach: itemReach });
  };

  for (const food of world.foods) {
    // Lo comido crece de a un segmento por paso: cerca del final no todo llega a contar
    const usable = Math.min(food.score, ctx.ticksLeft - pending);
    if (usable > 0) add(food, usable * bias(food), reach);
  }

  if (skill.powers > 0 && ctx.ticksLeft > 40) {
    const canBeHurt = ctx.rivals.some(r => r.segments.length >= 2);
    for (const item of world.consumables) {
      const active = item.type === 'fan' ? me.fanShots > 1 : me.hasEffect(item.type, now + 1500);
      let value = 0;
      // Con pocos segmentos, el escudo es lo que separa de quedar fuera
      if (item.type === 'immunity') value = canBeHurt ? 2 + me.segments.length * 0.12 + (wouldEliminate(me, cfg) ? 4 : 0) : 0;
      else if (item.type === 'bigMouth') value = 6;
      else if (item.type === 'fan') value = canBeHurt ? 2 + longest(ctx.rivals) * 0.1 : 0;
      if (active) value *= 0.25;
      add(item, value * skill.powers * bias(item), cell * PICKUP_REACH);
    }
  }
  return targets;
}

function longest(snakes) {
  return snakes.reduce((max, s) => Math.max(max, s.segments.length), 0);
}

// Cadena de comidas con el mayor valor descontado -> { target, value } de la primera, o null
function planFood(me, targets, skill, cfg) {
  const { segmentSize: cell, canvasWidth: w, canvasHeight: h } = cfg;
  if (!targets.length) return null;
  const rate = t => t.value * Math.pow(DISCOUNT, t.steps);
  const pool = targets.toSorted((a, b) => rate(b) - rate(a)).slice(0, skill.width * 2);

  // Lo que suma seguir desde `from` (posición y rumbo de llegada) tras `time` pasos
  const used = new Set();
  const follow = (from, fromAngle, time, depth) => {
    if (depth === 0) return 0;
    const options = [];
    for (const t of pool) {
      if (used.has(t)) continue;
      const dx = wrapDelta(t.x - from.x, w);
      const dy = wrapDelta(t.y - from.y, h);
      const angle = Math.atan2(dy, dx);
      const turn = Math.abs(normalize(angle - fromAngle)) / me.turnRate;
      const steps = Math.max(1, (Math.hypot(dx, dy) - t.reach) / cell + turn * 0.45);
      options.push({ t, angle, time: time + steps, gain: t.value * Math.pow(DISCOUNT, time + steps) });
    }
    options.sort((a, b) => b.gain - a.gain);
    let best = 0;
    for (const o of options.slice(0, Math.max(2, skill.width - 4))) {
      used.add(o.t);
      best = Math.max(best, o.gain + follow(o.t, o.angle, o.time, depth - 1));
      used.delete(o.t);
    }
    return best;
  };

  let best = null;
  const head = me.segments[0];
  for (const t of pool.slice(0, skill.width)) {
    used.add(t);
    const value = rate(t) + follow(t, angleTo(head, t, cfg), t.steps, skill.depth - 1);
    used.delete(t);
    if (!best || value > best.value) best = { target: t, value };
  }
  return best;
}

// El plan vigente, o uno nuevo si venció o el objetivo ya no está en el mapa
function currentPlan(brain, me, world, ctx) {
  const old = brain.plan;
  if (old && brain.tick < old.until && (world.foods.includes(old.target.item) || world.consumables.includes(old.target.item))) {
    return old;
  }
  brain.plan = planFood(me, listTargets(brain, me, world, ctx), brain.skill, world.config);
  if (brain.plan) brain.plan.until = brain.tick + PLAN_TICKS;
  return brain.plan;
}

function angleTo(from, to, cfg) {
  return Math.atan2(wrapDelta(to.y - from.y, cfg.canvasHeight), wrapDelta(to.x - from.x, cfg.canvasWidth));
}

// ---------------------------------------------------------------------------
// Defensa
// ---------------------------------------------------------------------------

// Segmentos que pierdo por los disparos que vienen, si mi cabeza sigue el camino `heads`; quedar
// fuera cuesta mucho más que los segmentos
function incomingDamage(me, heads, threats, ctx, cfg) {
  let damage = 0;
  for (const ray of threats) {
    const hit = rayHit(ray, me.segments, heads, ctx);
    if (hit) damage += segmentsLost(me.segments.length, cfg);
  }
  return damage >= me.segments.length ? damage + DEATH_COST : damage;
}

// Rumbo final: el deseado, salvo que otro evite un disparo
function safest(brain, me, world, ctx, desired, urgency) {
  const { skill, rng } = brain;
  const { config: cfg, now } = world;
  if (!skill.dodge || me.hasEffect('immunity', now + 600)) return desired;

  // Los disparos que decidió esquivar (lo decide una sola vez por disparo)
  const alive = new Set();
  const threats = [];
  for (const p of world.projectiles) {
    if (p.playerId === me.id) continue;
    alive.add(p.id);
    if (!brain.seenShots.has(p.id)) brain.seenShots.set(p.id, rng() < skill.dodge);
    if (brain.seenShots.get(p.id)) threats.push(makeRay(p.x, p.y, p.direction, cfg));
  }
  for (const id of brain.seenShots.keys()) if (!alive.has(id)) brain.seenShots.delete(id);

  if (!threats.length) return desired;

  const cost = angle => incomingDamage(me, futureHeads(me, angle, LOOK_AHEAD, cfg), threats, ctx, cfg) * 2;
  const base = cost(desired);
  if (base === 0) return desired;
  let best = { angle: desired, cost: base };
  for (let i = -4; i <= 4; i++) {
    const angle = normalize(me.heading + i * me.turnRate);
    const detour = Math.abs(normalize(angle - desired)) / Math.PI * Math.max(1, urgency);
    const c = cost(angle) + detour;
    if (c < best.cost) best = { angle, cost: c };
  }
  return best.angle;
}

// ---------------------------------------------------------------------------
// Decisión
// ---------------------------------------------------------------------------

function decide(brain, me, world) {
  const { skill, rng } = brain;
  const { config: cfg, now } = world;
  const cell = cfg.segmentSize;
  const tickMs = cfg.gameSpeed;
  const rivals = world.players.filter(p => p.id !== me.id && !p.gameover && p.segments && p.segments.length);
  const ctx = {
    rivals,
    tickMs,
    speed: cfg.projectileCells * cell,
    radius: cell * HIT_REACH,
    ticksLeft: Math.max(0, world.timeLeft * 1000 / tickMs),
    ahead: new Map(rivals.map(r => [r.id, futureHeads(r, r.heading, LOOK_AHEAD, cfg)]))
  };

  // Comida
  const plan = currentPlan(brain, me, world, ctx);
  let angle = plan ? angleTo(me.segments[0], plan.target, cfg) : me.heading;
  let urgency = plan ? plan.target.value : 1;

  // Disparo: con el rumbo de ahora, o girando si un buen tiro vale el desvío
  let fire = false;
  const canShoot = cfg.attacksEnabled && me.segments.length >= 2 &&
    now - me.lastShotAt >= (cfg.shotCooldownMs || 0) && now - brain.lastShotAt >= skill.shotPause;
  if (canShoot) {
    const directions = me.fanShots > 0 ? fanDirections(me.direction, cfg.fanDegrees) : [me.direction];
    const aimError = skill.aimError ? rad(gaussian(rng) * skill.aimError) : 0;
    const felt = aimError
      ? directions.map(d => rotate(d, aimError))  // cree que apunta a otro lado: dispara de más o de menos
      : directions;
    const value = shotValue(me, me.segments[0], felt, world, ctx, skill) - 1;
    if (value >= skill.minShot && rng() < skill.fireChance) {
      fire = true;
      brain.lastShotAt = now;
    }
  }

  if (!fire && skill.aim > 0 && cfg.attacksEnabled && me.segments.length >= 3) {
    const aim = bestAim(me, world, ctx, skill);
    if (aim && aim.value > 0) {
      // Desviarse demora la comida unos pasos, a la ida y a la vuelta
      const delay = plan ? plan.value * (1 - Math.pow(DISCOUNT, aim.turns * 2)) : 0;
      if (aim.value * skill.aim > delay + 1) {
        angle = aim.angle + (skill.aimError ? rad(gaussian(rng) * skill.aimError) : 0);
        urgency = aim.value;
      }
    }
  }

  if (skill.steerError) angle += rad(gaussian(rng) * skill.steerError);
  angle = safest(brain, me, world, ctx, normalize(angle), urgency);
  return { angle: normalize(angle), fire };
}

function rotate(d, a) {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: d.x * cos - d.y * sin, y: d.x * sin + d.y * cos };
}

module.exports = {
  SKILLS, isBotLevel, botLevel, botName, createBrain, stepBot,
  // Expuestos para probarlos
  stepsToReach, rayHit, makeRay, planFood
};
