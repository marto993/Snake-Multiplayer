/*
 * Restos: cuando un disparo corta una serpiente, lo que pierde queda en el mapa como comida.
 * Un buen disparo se vuelve la forma más rápida de crecer, para quien disparó o para el que
 * llegue antes. Los restos vencen a los 10 s y, a diferencia de la comida base, no reaparecen
 * al comerlos.
 */
'use strict';

const REMAINS_TTL_MS = 10000;
const MAX_DROPS = 30;   // por corte: un corte muy largo reparte su valor en 30 comidas
const MAX_VALUE = 5;    // como la comida base

// Daño de un impacto. En la cabeza: pierde hasta 3 segmentos de la cola y conserva la cabeza.
// En el cuerpo: pierde desde el segmento tocado hasta la cola. No modifica `segments`.
function cutSnake(segments, segmentIndex) {
  if (segmentIndex === 0) {
    const removed = Math.min(3, segments.length - 1);
    const keep = segments.length - removed;
    return { kept: segments.slice(0, keep), lost: segments.slice(keep) };
  }
  return { kept: segments.slice(0, segmentIndex), lost: segments.slice(segmentIndex) };
}

// Daño de un impacto contra una serpiente anclada: pierde solo el último segmento (con uno solo, nada)
function cutAnchored(segments) {
  if (segments.length <= 1) return { kept: segments.slice(), lost: [] };
  return { kept: segments.slice(0, -1), lost: segments.slice(-1) };
}

// Comidas para los segmentos perdidos. Una por celda (dos segmentos en la misma celda suman),
// salteando las celdas que ya tienen comida. `occupied(x, y)` dice si una celda tiene comida.
function dropRemains(lost, now, occupied) {
  const byCell = new Map();
  for (const seg of lost) {
    const key = seg.x + ',' + seg.y;
    const cell = byCell.get(key);
    if (cell) cell.count++;
    else byCell.set(key, { x: seg.x, y: seg.y, count: 1 });
  }
  const cells = Array.from(byCell.values()).filter(c => !occupied(c.x, c.y));
  const expiresAt = now + REMAINS_TTL_MS;
  const food = (c, score) => ({ x: c.x, y: c.y, score: Math.min(MAX_VALUE, score), remains: true, expiresAt });

  if (cells.length <= MAX_DROPS) return cells.map(c => food(c, c.count));

  // Corte largo: 30 comidas repartidas a lo largo del cuerpo, con el valor total repartido
  const total = cells.reduce((sum, c) => sum + c.count, 0);
  const base = Math.floor(total / MAX_DROPS);
  const extra = total % MAX_DROPS;
  const foods = [];
  for (let i = 0; i < MAX_DROPS; i++) {
    const c = cells[Math.round(i * (cells.length - 1) / (MAX_DROPS - 1))];
    foods.push(food(c, base + (i < extra ? 1 : 0)));
  }
  return foods;
}

module.exports = { cutSnake, cutAnchored, dropRemains, REMAINS_TTL_MS };
