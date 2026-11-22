/*
 * Niveles de dificultad: la sala solo elige el nivel y todo lo demás sale de esta tabla.
 * Valores de docs/MOTION_SPEC.md, sección "Dificultad fija". La partida es una sola, de roundTime segundos.
 */
'use strict';

// Arena apaisada de 16:9 (64 × 36 celdas): llena las pantallas anchas y se juega con el teléfono en
// horizontal. Tiene casi la misma superficie que la de 600 × 600 de antes (−8 %), así la comida y
// los tiempos de cada nivel siguen valiendo.
const ARENA_W = 768;
const ARENA_H = 432;
const SEGMENT = 12;
// Los niveles se ajustaron cruzando 50 celdas: el paso del servidor sale de esa referencia
const SPEED_CELLS = 50;

const DEFAULT_DIFFICULTY = 'medium';

// crossSeconds: lo que tarda la serpiente en recorrer 50 celdas (el lado de la arena cuadrada de antes)
// projectileCells: celdas que avanza un disparo por paso
// foodExtra: comida en la arena = jugadores + foodExtra
// shieldEvery / shieldLasts: cada cuántos segundos aparece el escudo y cuánto dura (s)
// turnDegrees: cuánto puede girar la serpiente por paso. Como avanza una celda por paso, fija
// el radio de giro: 40° da unos 17 px (1,4 cuerpos) y una vuelta en U de 5 pasos.
const LEVELS = {
  easy:   { crossSeconds: 3.5, projectileCells: 3, foodExtra: 24, shieldEvery: 6,  shieldLasts: 5, turnDegrees: 40 },
  medium: { crossSeconds: 3.3, projectileCells: 3, foodExtra: 20, shieldEvery: 8, shieldLasts: 4, turnDegrees: 40 },
  hard:   { crossSeconds: 3.0, projectileCells: 3, foodExtra: 18,  shieldEvery: 10, shieldLasts: 3, turnDegrees: 40 }
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
    gameSpeed: Math.round(level.crossSeconds * 1000 / SPEED_CELLS),
    canvasWidth: ARENA_W,
    canvasHeight: ARENA_H,
    segmentSize: SEGMENT,
    startLength: 3,
    attacksEnabled: true,
    roundTime: opts.roundTime,
    projectileCells: level.projectileCells,
    foodExtra: level.foodExtra,
    turnDegrees: level.turnDegrees,
    consumables: {
      immunity: { enabled: true, spawnInterval: level.shieldEvery, duration: level.shieldLasts }
    }
  };
}

module.exports = { buildRoomConfig, DEFAULT_DIFFICULTY };
