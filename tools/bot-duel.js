#!/usr/bin/env node
/*
 * Duelos de bots sin servidor ni red, para comparar los niveles con números:
 *
 *   node tools/bot-duel.js extreme hard            30 partidas de 2 minutos
 *   node tools/bot-duel.js extreme hard medium easy --games 50 --time 120 --difficulty hard
 *
 * Repite el paso del servidor (gameLogicLoop, en index.js) con las mismas funciones de game/, pero
 * con un reloj simulado: una partida de dos minutos tarda menos de un segundo. Si cambian las reglas
 * de ese paso, hay que cambiarlas también acá.
 */
'use strict';

const Snake = require('../public/snakeClass.js');
const { buildRoomConfig, consumableLimit } = require('../game/difficulty');
const { traceProjectile, fanDirections } = require('../game/projectiles');
const { touchedAlong, wrapPoint } = require('../game/geometry');
const { cutSnake, dropRemains } = require('../game/remains');
const { matchResult, matchOver, frenzyFoodTarget } = require('../game/match');
const { createBrain, stepBot, isBotLevel } = require('../game/bots');

const EAT_REACH = 0.85;
const PICKUP_REACH = 0.9;
const HIT_REACH = 0.7;

// Generador con semilla (mulberry32): la misma semilla repite la misma partida
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Una partida entera. levels: un nivel de bot por serpiente
// -> { ranking, winners, ending, seconds, players, thinkMs }; ending: 'time' | 'elimination'
function playMatch(levels, { seed = 1, time = 120, difficulty = 'medium' } = {}) {
  const rng = seeded(seed);
  const cfg = buildRoomConfig(difficulty, { roundTime: time });
  const { canvasWidth: w, canvasHeight: h, segmentSize: cell, gameSpeed } = cfg;
  const coord = max => Math.floor(rng() * (max / cell)) * cell;
  const newFood = () => ({ x: coord(w), y: coord(h), score: Math.floor(rng() * 5) + 1 });

  // El escudo se consulta sin hora en traceProjectile: el reloj simulado reemplaza a Date.now
  const realNow = Date.now;
  let now = 1000000;
  Date.now = () => now;
  try {
    const players = levels.map((level, i) => {
      const x = Math.floor(w * 0.1 / cell) * cell;
      const y = Math.floor((Math.floor(h * 0.2) + i * cell * 3) / cell) * cell;
      const snake = new Snake('bot' + i, level + i, cell, w, h, x, y, 1, 0, '#fff', gameSpeed);
      snake.turnRate = cfg.turnDegrees * Math.PI / 180;
      snake.reset(x, y, 1, 0, cfg.startLength);
      snake.level = level;
      snake.brain = createBrain(level, rng);
      snake.stats = { shots: 0, hits: 0, cut: 0, lost: 0, eaten: 0, peak: cfg.startLength, out: 0 };
      // Escudo al nacer, como en startGame: hasta guardUntil bloquea todo sin gastarse
      if (cfg.spawnShield > 0) snake.addEffect('immunity', cfg.spawnShield * 1000, now);
      return snake;
    });
    const byId = new Map(players.map(p => [p.id, p]));
    const guardUntil = now + (cfg.spawnShield || 0) * 1000;
    let foods = Array.from({ length: players.length + cfg.foodExtra }, newFood);
    const consumables = [];
    const spawn = type => {
      if (consumables.filter(c => c.type === type).length < consumableLimit(type, players.length)) {
        consumables.push({ type, x: coord(w), y: coord(h) });
      }
    };
    const types = Object.keys(cfg.consumables);
    types.forEach(type => { for (let i = 0; i < consumableLimit(type, players.length); i++) spawn(type); });
    const nextSpawn = Object.fromEntries(types.map(t => [t, now + cfg.consumables[t].spawnInterval * 1000]));
    let projectiles = [];
    let shotId = 0;
    const start = now;
    let thinkNs = 0n;
    let ticks = 0;
    let ending = 'time';

    while (now - start < time * 1000) {
      ticks++;
      now += gameSpeed;
      const timeLeft = Math.ceil(time - (now - start) / 1000);
      for (const type of types) {
        if (now >= nextSpawn[type]) { spawn(type); nextSpawn[type] += cfg.consumables[type].spawnInterval * 1000; }
      }

      // Bots
      const world = { players, foods, consumables, projectiles, config: cfg, now, timeLeft, guardUntil };
      const t0 = process.hrtime.bigint();
      const decisions = players.map(p => (p.gameover ? null : stepBot(p.brain, p, world)));
      thinkNs += process.hrtime.bigint() - t0;
      players.forEach((p, i) => {
        if (!decisions[i]) return;
        const { angle, fire } = decisions[i];
        if (angle !== null) p.steerTo(angle);
        if (!fire || p.segments.length < 2) return;
        const head = p.segments[0];
        const bx = head.x + p.direction.x * cell;
        const by = head.y + p.direction.y * cell;
        if (projectiles.some(q => q.playerId === p.id && (q.x - bx) ** 2 + (q.y - by) ** 2 < cell * cell)) return;
        if (!p.tryShot(now, cfg.shotCooldownMs)) return;
        p.segments.pop();
        p.updateTargets();
        p.stats.shots++;
        const dirs = p.hasEffect('fan', now) ? fanDirections(p.direction, cfg.fanDegrees) : [p.direction];
        for (const d of dirs) {
          projectiles.push({ id: 's' + shotId++, playerId: p.id, x: head.x + d.x * cell, y: head.y + d.y * cell, direction: { ...d } });
        }
      });

      foods = foods.filter(f => !f.expiresAt || f.expiresAt > now);
      if (timeLeft <= cfg.frenzy.lastSeconds &&
          foods.filter(f => !f.remains).length < frenzyFoodTarget(players.length, cfg.foodExtra, cfg.frenzy.foodBoost)) {
        foods.push(newFood());
      }

      const occupied = (x, y) => foods.some(f => (f.x - x) ** 2 + (f.y - y) ** 2 < (cell / 2) ** 2);
      projectiles = projectiles.filter(q => {
        const r = traceProjectile(q, cfg.projectileCells, { cell, width: w, height: h }, players, cell * HIT_REACH);
        if (r.outcome === 'alive') { q.x = r.x; q.y = r.y; return true; }
        if (r.outcome === 'block' && now >= guardUntil) r.player.useImmunity(now);
        if (r.outcome === 'hit') {
          const { kept, lost } = cutSnake(r.player.segments, cfg.hitDamage);
          foods.push(...dropRemains(lost, now, occupied));
          if (kept.length) {
            r.player.segments = kept;
            r.player.updateTargets();
          } else {
            r.player.eliminate(now);
            r.player.stats.out = 1;
          }
          r.player.stats.lost += lost.length;
          const shooter = byId.get(q.playerId);
          if (shooter !== r.player) { shooter.stats.hits++; shooter.stats.cut += lost.length; }
        }
        return false;
      });

      for (const p of players) {
        if (p.gameover) continue;
        const from = { ...p.segments[0] };
        p.moveLogic();
        const head = p.segments[0];
        const step = { x: head.x - from.x, y: head.y - from.y };
        wrapPoint(head, cell, w, h);
        head.x = Snake.round1(head.x);
        head.y = Snake.round1(head.y);
        const touched = touchedAlong(from, step, consumables, cell * PICKUP_REACH, w, h);
        if (touched.length) {
          const [item] = consumables.splice(touched[0], 1);
          p.addEffect(item.type, cfg.consumables[item.type].duration * 1000, now);
        }
        const reach = cell * (p.hasEffect('bigMouth', now) ? cfg.bigMouthReach : EAT_REACH);
        const eaten = touchedAlong(from, step, foods, reach, w, h).map(i => foods[i]);
        for (const food of eaten) {
          p.EatFood(food.score);
          p.stats.eaten += food.score;
          foods.splice(foods.indexOf(food), 1);
          if (!food.remains) foods.push(newFood());
        }
        p.stats.peak = Math.max(p.stats.peak, p.segments.length);
      }

      if (matchOver(players)) { ending = 'elimination'; break; }
    }

    const { ranking, winners } = matchResult(players);
    return {
      ranking, winners, ticks, ending, seconds: (now - start) / 1000,
      players: players.map(p => ({
        id: p.id, level: p.level, length: p.segments.length, ...p.stats,
        outAt: p.gameover ? (p.eliminatedAt - start) / 1000 : null   // segundos de partida al quedar fuera
      })),
      thinkMs: Number(thinkNs) / 1e6
    };
  } finally {
    Date.now = realNow;
  }
}

function main(argv) {
  const opts = { games: 30, time: 120, difficulty: 'medium', seed: 1 };
  const levels = [];
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    if (name && name in opts) {
      const value = argv[++i];
      opts[name] = name === 'difficulty' ? value : Number(value);
    } else if (isBotLevel(argv[i])) levels.push(argv[i]);
    else { console.error('No entiendo: ' + argv[i]); process.exit(1); }
  }
  if (levels.length < 2) {
    console.error('Uso: node tools/bot-duel.js <nivel> <nivel> [...] [--games 30] [--time 120] [--difficulty medium] [--seed 1]');
    process.exit(1);
  }

  // Cada serpiente de la lista es un competidor; el lugar de salida rota entre partidas
  const rows = levels.map((level, i) => ({ jugador: level + ' #' + (i + 1), ganadas: 0, fuera: 0, largo: 0, pico: 0, comido: 0, disparos: 0, aciertos: 0, cortó: 0, perdió: 0 }));
  let thinkMs = 0;
  let ticks = 0;
  let early = 0;
  let seconds = 0;
  for (let g = 0; g < opts.games; g++) {
    const order = levels.map((_, i) => (i + g) % levels.length);
    const match = playMatch(order.map(i => levels[i]), { seed: opts.seed + g, time: opts.time, difficulty: opts.difficulty });
    match.players.forEach((p, seat) => {
      const row = rows[order[seat]];
      if (match.winners.includes(p.id)) row.ganadas++;
      row.fuera += p.out;
      row.largo += p.length; row.pico += p.peak; row.comido += p.eaten; row.disparos += p.shots;
      row.aciertos += p.hits; row.cortó += p.cut; row.perdió += p.lost;
    });
    thinkMs += match.thinkMs;
    ticks += match.ticks;
    if (match.ending === 'elimination') early++;
    seconds += match.seconds;
  }
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (key === 'jugador' || key === 'ganadas' || key === 'fuera') continue;
      row[key] = Math.round(row[key] / opts.games * 10) / 10;
    }
    row.ganadas = `${row.ganadas} de ${opts.games}`;
    row.fuera = `${row.fuera} de ${opts.games}`;
  }
  console.table(rows);
  console.log(`Terminan antes de tiempo ${early} de ${opts.games}; duran ${(seconds / opts.games).toFixed(0)} s en promedio.`);
  console.log(`Pensar cuesta ${(thinkMs / ticks).toFixed(2)} ms por paso entre los ${levels.length} bots.`);
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { playMatch };
