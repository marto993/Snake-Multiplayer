/*
 * Niveles de dificultad: la sala solo elige el nivel y todo lo demás sale de esta tabla.
 * Valores de docs/MOTION_SPEC.md, sección "Dificultad fija".
 */
'use strict';

const ARENA = 600;
const SEGMENT = 12;
const CELLS = ARENA / SEGMENT; // 50 celdas por lado

const DEFAULT_DIFFICULTY = 'medium';

// crossSeconds: lo que tarda la serpiente en cruzar la arena de lado a lado
// projectileCells: celdas que avanza un disparo por paso
// foodExtra: comida en la arena = jugadores + foodExtra
// shieldEvery / shieldLasts: cada cuántos segundos aparece el escudo y cuánto dura (s)
const LEVELS = {
  easy:   { crossSeconds: 3.5, projectileCells: 2, foodExtra: 8, shieldEvery: 6,  shieldLasts: 7 },
  medium: { crossSeconds: 2.7, projectileCells: 2, foodExtra: 5, shieldEvery: 10, shieldLasts: 5 },
  hard:   { crossSeconds: 2.1, projectileCells: 3, foodExtra: 3, shieldEvery: 15, shieldLasts: 3 }
};

function buildRoomConfig(difficulty, opts) {
  const key = typeof difficulty === 'string' && Object.prototype.hasOwnProperty.call(LEVELS, difficulty)
    ? difficulty
    : DEFAULT_DIFFICULTY;
  const level = LEVELS[key];
  return {
    difficulty: key,
    maxPlayers: 8,
    minPlayers: 2,
    maxRounds: 3,
    gameSpeed: Math.round(level.crossSeconds * 1000 / CELLS),
    canvasWidth: ARENA,
    canvasHeight: ARENA,
    segmentSize: SEGMENT,
    startLength: 3,
    attacksEnabled: true,
    roundTime: opts.roundTime,
    projectileCells: level.projectileCells,
    foodExtra: level.foodExtra,
    consumables: {
      immunity: { enabled: true, spawnInterval: level.shieldEvery, duration: level.shieldLasts }
    }
  };
}

module.exports = { buildRoomConfig, DEFAULT_DIFFICULTY };
