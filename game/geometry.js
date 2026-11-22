/*
 * Geometría del movimiento libre: distancias en una arena que envuelve en los bordes y
 * contacto barrido (lo que toca un punto que se mueve en línea recta durante un paso).
 * Las posiciones son la esquina de una celda, como en el resto del servidor: entre dos
 * objetos del mismo tamaño, la distancia entre esquinas es la distancia entre centros.
 * Puro, sin efectos.
 */
'use strict';

// Diferencia por el lado corto de un eje que envuelve. period 0: el eje no envuelve.
function wrapDelta(d, period) {
  if (period > 0) {
    const half = period / 2;
    if (d > half) d -= period;
    else if (d < -half) d += period;
  }
  return d;
}

// Contacto entre un punto (px, py) y el tramo que arranca en (ax, ay) y avanza (vx, vy).
// -> { d2, t }: distancia al cuadrado al punto más cercano del tramo, y en qué fracción del
// tramo está (0 = al inicio, 1 = al final). w / h: ancho y alto de la arena si envuelve, o 0.
function sweep(ax, ay, vx, vy, px, py, w, h) {
  const dx = wrapDelta(px - ax, w);
  const dy = wrapDelta(py - ay, h);
  const len2 = vx * vx + vy * vy;
  let t = len2 > 0 ? (dx * vx + dy * vy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const ex = dx - vx * t;
  const ey = dy - vy * t;
  return { d2: ex * ex + ey * ey, t };
}

// Índices de `items` (con x, y) a menos de `radius` del tramo, en el orden en que los toca.
function touchedAlong(from, step, items, radius, w, h) {
  const r2 = radius * radius;
  const hits = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const c = sweep(from.x, from.y, step.x, step.y, it.x, it.y, w, h);
    if (c.d2 < r2) hits.push({ index: i, t: c.t });
  }
  hits.sort((a, b) => a.t - b.t);
  return hits.map(hit => hit.index);
}

// Portales: un objeto pasa al borde opuesto cuando su centro cruza el borde, igual que en el
// dibujo (motion.js). Modifica `p` y devuelve por dónde salió en cada eje.
// -> { x: 'left' | 'right' | null, y: 'top' | 'bottom' | null }
function wrapPoint(p, cell, width, height) {
  const half = cell / 2;
  const out = { x: null, y: null };
  if (p.x + half < 0) { p.x += width; out.x = 'left'; }
  else if (p.x + half >= width) { p.x -= width; out.x = 'right'; }
  if (p.y + half < 0) { p.y += height; out.y = 'top'; }
  else if (p.y + half >= height) { p.y -= height; out.y = 'bottom'; }
  return out;
}

// Celda de la grilla a la que pertenece una posición (por su centro), siempre dentro de la grilla
function cellIndex(v, cell, count) {
  const i = Math.round(v / cell) % count;
  return i < 0 ? i + count : i;
}

module.exports = { wrapDelta, sweep, touchedAlong, wrapPoint, cellIndex };
