/*
 * Niveles de dificultad: la sala solo elige el nivel y todo lo demás sale de esta tabla.
 * Valores de docs/MOTION_SPEC.md, sección "Dificultad fija". La partida es una sola, de roundTime segundos.
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
  easy:   { crossSeconds: 3.5, projectileCells: 3, foodExtra: 24, shieldEvery: 6,  shieldLasts: 5 },
  medium: { crossSeconds: 3.3, projectileCells: 3, foodExtra: 20, shieldEvery: 8, shieldLasts: 4 },
  hard:   { crossSeconds: 3.0, projectileCells: 3, foodExtra: 18,  shieldEvery: 10, shieldLasts: 3 }
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
