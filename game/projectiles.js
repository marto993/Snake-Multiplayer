/*
 * Trayectoria de un proyectil en un paso del servidor. Avanza `cells` celdas de a una y en
 * cada celda revisa los bordes y los cuerpos, para no atravesar nada cuando va rápido.
 * No modifica nada: el game loop aplica el resultado.
 */
'use strict';

// -> { outcome: 'alive', x, y }                         recorrió todas las celdas
//    { outcome: 'expired', x, y }                       salió de la arena; x, y: última celda adentro
//    { outcome: 'hit' | 'block', x, y, player, segmentIndex }   tocó un cuerpo ('block' con escudo)
function traceProjectile(projectile, cells, bounds, players) {
  const { cell, width, height } = bounds;
  const dx = projectile.direction.x * cell;
  const dy = projectile.direction.y * cell;
  let x = projectile.x;
  let y = projectile.y;

  for (let step = 0; step < cells; step++) {
    const nx = x + dx;
    const ny = y + dy;

    if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
      // Acotada por si el disparo nació en el borde, mirando hacia afuera
      return {
        outcome: 'expired',
        x: Math.max(0, Math.min(width - cell, x)),
        y: Math.max(0, Math.min(height - cell, y))
      };
    }

    for (const player of players) {
      if (player.gameover || !player.segments) continue;
      const segmentIndex = player.segments.findIndex(s => s.x === nx && s.y === ny);
      if (segmentIndex !== -1) {
        return { outcome: player.hasImmunity() ? 'block' : 'hit', x: nx, y: ny, player, segmentIndex };
      }
    }

    x = nx;
    y = ny;
  }

  return { outcome: 'alive', x, y };
}

module.exports = { traceProjectile };
