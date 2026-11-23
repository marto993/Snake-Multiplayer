/*
 * Trayectoria de un proyectil en un paso del servidor. Avanza `cells` tramos de una celda en
 * su dirección (un vector unitario, en cualquier ángulo) y en cada tramo busca el primer
 * cuerpo a menos de `hitRadius`, para no atravesar nada cuando va rápido. Antes de salir de la
 * arena revisa el tramo que llega al borde. Los proyectiles no pasan por los portales.
 * No modifica nada: el game loop aplica el resultado.
 */
'use strict';

const { sweep } = require('./geometry');

// -> { outcome: 'alive', x, y }                         recorrió todos los tramos
//    { outcome: 'expired', x, y }                       salió de la arena; x, y: último punto adentro
//    { outcome: 'hit' | 'block', x, y, player, segmentIndex }   tocó un cuerpo ('block' con escudo);
//                                                       x, y: el segmento tocado
// hitRadius: distancia entre centros a la que un proyectil toca un segmento (por defecto, 0,7 celdas)
function traceProjectile(projectile, cells, bounds, players, hitRadius) {
  const { cell, width, height } = bounds;
  const radius = hitRadius === undefined ? cell * 0.7 : hitRadius;
  const r2 = radius * radius;
  const dx = projectile.direction.x * cell;
  const dy = projectile.direction.y * cell;
  let x = projectile.x;
  let y = projectile.y;

  for (let step = 0; step < cells; step++) {
    const nx = x + dx;
    const ny = y + dy;

    // El primer segmento que toca en este tramo (el más cercano al inicio)
    let best = null;
    for (const player of players) {
      if (player.gameover || !player.segments) continue;
      const segs = player.segments;
      for (let i = 0; i < segs.length; i++) {
        const c = sweep(x, y, dx, dy, segs[i].x, segs[i].y, 0, 0);
        if (c.d2 >= r2) continue;
        if (!best || c.t < best.t || (c.t === best.t && c.d2 < best.d2)) {
          best = { t: c.t, d2: c.d2, player, segmentIndex: i };
        }
      }
    }
    if (best) {
      const seg = best.player.segments[best.segmentIndex];
      return {
        outcome: best.player.hasImmunity() ? 'block' : 'hit',
        x: seg.x,
        y: seg.y,
        player: best.player,
        segmentIndex: best.segmentIndex
      };
    }

    if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
      // Acotada por si el disparo nació en el borde, mirando hacia afuera
      return {
        outcome: 'expired',
        x: Math.max(0, Math.min(width - cell, x)),
        y: Math.max(0, Math.min(height - cell, y))
      };
    }

    x = nx;
    y = ny;
  }

  return { outcome: 'alive', x, y };
}

// Abanico: el rumbo de la cabeza y dos más abiertos `degrees` a cada lado, en ese orden
// (central, izquierda, derecha). Vectores unitarios redondeados a 4 decimales, como Snake.setHeading.
function fanDirections(direction, degrees) {
  const base = Math.atan2(direction.y, direction.x);
  const spread = degrees * Math.PI / 180;
  const unit = angle => ({
    x: Math.round(Math.cos(angle) * 10000) / 10000 || 0,
    y: Math.round(Math.sin(angle) * 10000) / 10000 || 0
  });
  return [{ x: direction.x, y: direction.y }, unit(base - spread), unit(base + spread)];
}

module.exports = { traceProjectile, fanDirections };
