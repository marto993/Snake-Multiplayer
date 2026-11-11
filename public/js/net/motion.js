/*
 * motion.js — línea de tiempo de los frames del servidor (window.Motion).
 *
 * El servidor manda un gameLogicFrame por paso (cada gameSpeed ms). Perseguir cada posición
 * nueva con un lerp por cuadro daba un tirón por paso: rápido al llegar el frame, lento al
 * final, y más marcado cuantos más Hz tiene el monitor. En su lugar, el cliente guarda los
 * últimos frames con la hora del servidor y dibuja un instante del pasado (un paso más un
 * margen por jitter), interpolando en línea recta entre los dos frames que lo rodean. La
 * velocidad visible queda constante.
 *
 * Si el frame siguiente se atrasa, extrapola hasta medio paso: cada segmento sigue hacia
 * donde estaba el anterior (exacto para el cuerpo) y la cabeza sigue en su dirección.
 *
 * Los portales se interpolan por el lado corto: el segmento sale por un borde y, cuando su
 * centro lo cruza, entra por el opuesto. La arena corta el trazo ahí (arena.js, computeRuns).
 *
 * Sin DOM: también corre en Node (require('./public/js/net/motion.js').Motion).
 *
 * API:
 *   Motion.createTimeline({ tickMs }) -> timeline
 *     .push(frame, recvNow)  frame: { t (hora del servidor), ... }; recvNow: performance.now() al llegar
 *     .seed(frame)           estado sin hora (gameStart): queda un paso antes del primer push
 *     .setTick(ms)           duración nominal del paso (config.gameSpeed)
 *     .sample(now, out)      -> out { a, b, f, e, rt } o null si todavía no hay frames
 *                            a: frame alcanzado; b: el siguiente (null si hay que extrapolar)
 *                            f: avance de a hacia b (0..1); e: pasos extrapolados desde a (0..0,5)
 *     .sampleLatest(out)     como sample, pero parado en el último frame (fin de ronda)
 *     .drain(fn)             fn(frame) por cada frame que el último sample ya alcanzó, una sola vez
 *     .clear()               descarta los frames; conserva los estimadores de reloj
 *     .stats()               { offset, jitter, tick, delay, frames }   (diagnóstico)
 *   Motion.snakeAt(a, b, f, cell, period, out) -> n        segmentos interpolados en out
 *   Motion.snakeAhead(a, dir, e, cell, period, out) -> n   segmentos extrapolados en out
 *   Motion.projectileAt(pa, pb, f, cell, out)              out.x, out.y
 *
 * `out` es un array de { x, y } que se reutiliza entre cuadros. `period` es el ancho de la
 * arena en múltiplos de celda (el envoltorio de los portales); 0 desactiva el envoltorio.
 */
(function (global) {
  'use strict';

  var MAX_FRAMES = 8;        // ~650 ms a 12 pasos por segundo
  var MAX_AHEAD = 0.5;       // extrapolación máxima, en pasos
  var OFFSET_RISE = 0.01;    // el reloj sube despacio (deriva, cambio de ruta)...
  var OFFSET_FALL = 0.25;    // ...y baja rápido, pero sin saltar: un salto adelantaría el render de golpe
  var JITTER_EASE = 0.1;
  var TICK_EASE = 0.1;
  var STALE_MS = 300;        // eventos más viejos que esto se descartan (pestaña en segundo plano)
  var SNAP_STEPS = 1.5;      // un salto de más de 1,5 celdas no se interpola (reaparición)
  var SLEW = 0.05;           // el atraso del render se corrige a lo sumo 5 % del tiempo real

  // ---------------------------------------------------------------------------
  // Línea de tiempo
  // ---------------------------------------------------------------------------
  function Timeline(opts) {
    this.tick = (opts && opts.tickMs) || 83;
    this.frames = [];
    this.offset = 0;          // recvNow - t de los frames más rápidos (suavizado)
    this.hasOffset = false;
    this.jitter = 0;          // atraso medio sobre ese mínimo
    this.lastRt = -Infinity;  // el render nunca retrocede
    this.lag = null;          // atraso del render respecto del reloj local (offset + delay, suavizado)
    this.lastNow = 0;
    this.pendingSeed = null;
  }

  Timeline.prototype.setTick = function (ms) {
    if (ms > 0) this.tick = ms;
  };

  Timeline.prototype.seed = function (frame) {
    frame.done = true; // el estado inicial no trae eventos
    this.pendingSeed = frame;
  };

  Timeline.prototype.push = function (frame, recvNow) {
    var lag = recvNow - frame.t;
    if (!this.hasOffset) {
      this.offset = lag;
      this.hasOffset = true;
    } else {
      this.offset += (lag - this.offset) * (lag < this.offset ? OFFSET_FALL : OFFSET_RISE);
    }
    var late = lag - this.offset;
    this.jitter += ((late > 0 ? late : 0) - this.jitter) * JITTER_EASE;

    var frames = this.frames;
    var last = frames.length ? frames[frames.length - 1] : null;
    if (last) {
      if (frame.t <= last.t) return false; // repetido o fuera de orden
      var dt = frame.t - last.t;
      if (dt < this.tick * 3) this.tick += (dt - this.tick) * TICK_EASE;
    } else if (this.pendingSeed) {
      this.pendingSeed.t = frame.t - this.tick;
      frames.push(this.pendingSeed);
      this.pendingSeed = null;
    }
    frame.done = false;
    frames.push(frame);
    if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
    return true;
  };

  Timeline.prototype.delay = function () {
    var margin = 4 + 2 * this.jitter;
    if (margin > 60) margin = 60;
    return this.tick + margin;
  };

  Timeline.prototype.sample = function (now, out) {
    var frames = this.frames, n = frames.length;
    if (!n || !this.hasOffset) return null;
    // Cada frame que llega mueve offset y delay unos milisegundos. Aplicarlo de golpe da un
    // tirón; se reparte de a poco, sin que el render cambie de velocidad más de un 5 %.
    var target = this.offset + this.delay();
    if (this.lag === null) this.lag = target;
    else {
      var maxStep = (now - this.lastNow) * SLEW;
      var d = target - this.lag;
      this.lag += d > maxStep ? maxStep : d < -maxStep ? -maxStep : d;
    }
    this.lastNow = now;
    var rt = now - this.lag;
    if (rt < this.lastRt) rt = this.lastRt;
    this.lastRt = rt;
    out.rt = rt;

    if (rt <= frames[0].t) {
      out.a = frames[0]; out.b = null; out.f = 0; out.e = 0;
      return out;
    }
    var i = n - 1;
    while (i > 0 && frames[i].t > rt) i--;
    var a = frames[i];
    if (i === n - 1) {
      var e = (rt - a.t) / this.tick;
      out.a = a; out.b = null; out.f = 0; out.e = e > MAX_AHEAD ? MAX_AHEAD : e;
    } else {
      var b = frames[i + 1];
      out.a = a; out.b = b; out.f = (rt - a.t) / (b.t - a.t); out.e = 0;
    }
    return out;
  };

  Timeline.prototype.drain = function (fn) {
    var rt = this.lastRt, frames = this.frames;
    for (var i = 0; i < frames.length; i++) {
      var fr = frames[i];
      if (fr.t > rt) break;
      if (fr.done) continue;
      fr.done = true;
      if (fr.t >= rt - STALE_MS) fn(fr);
    }
  };

  // Salta al último frame (fin de ronda): lo congelado coincide con el estado final y el
  // drain siguiente despacha todo lo pendiente.
  Timeline.prototype.sampleLatest = function (out) {
    var n = this.frames.length;
    if (!n) return null;
    var a = this.frames[n - 1];
    if (a.t > this.lastRt) this.lastRt = a.t;
    out.a = a; out.b = null; out.f = 0; out.e = 0; out.rt = this.lastRt;
    return out;
  };

  Timeline.prototype.clear = function () {
    this.frames.length = 0;
    this.pendingSeed = null;
    this.lastRt = -Infinity;
  };

  Timeline.prototype.stats = function () {
    return { offset: this.offset, jitter: this.jitter, tick: this.tick, delay: this.delay(), frames: this.frames.length };
  };

  // ---------------------------------------------------------------------------
  // Interpolación de serpientes y proyectiles
  // ---------------------------------------------------------------------------
  // Diferencia por el lado corto de la arena (los portales envuelven)
  function wrapDelta(d, period) {
    if (period > 0) {
      var half = period / 2;
      if (d > half) d -= period;
      else if (d < -half) d += period;
    }
    return d;
  }

  // El segmento pasa al borde opuesto cuando su centro cruza el borde
  function wrapPos(p, cell, period) {
    if (period > 0) {
      var c = p + cell / 2;
      if (c < 0) p += period;
      else if (c >= period) p -= period;
    }
    return p;
  }

  function setPoint(out, i, x, y) {
    var o = out[i];
    if (!o) o = out[i] = { x: 0, y: 0 };
    o.x = x;
    o.y = y;
  }

  function step(out, i, sx, sy, tx, ty, f, cell, period) {
    var dx = wrapDelta(tx - sx, period), dy = wrapDelta(ty - sy, period);
    var snap = cell * SNAP_STEPS;
    if (dx > snap || dx < -snap || dy > snap || dy < -snap) setPoint(out, i, tx, ty);
    else setPoint(out, i, wrapPos(sx + dx * f, cell, period), wrapPos(sy + dy * f, cell, period));
  }

  function copyInto(src, out) {
    var n = src ? src.length : 0;
    for (var i = 0; i < n; i++) setPoint(out, i, src[i].x, src[i].y);
    out.length = n;
    return n;
  }

  // Segmento i de a hacia b. Si b creció, la cola nueva nace quieta sobre la última de a.
  // Si b se achicó (disparo o impacto), los segmentos que sobran siguen el cuerpo hasta el
  // instante de b, donde desaparecen junto con el efecto.
  function snakeAt(a, b, f, cell, period, out) {
    var na = a ? a.length : 0, nb = b ? b.length : 0;
    if (!na) return copyInto(b, out);
    if (!nb) return copyInto(a, out);
    var n = na > nb ? na : nb;
    for (var i = 0; i < n; i++) {
      var s = i < na ? a[i] : a[na - 1];
      var t = i < nb ? b[i] : a[i - 1];
      step(out, i, s.x, s.y, t.x, t.y, f, cell, period);
    }
    out.length = n;
    return n;
  }

  function snakeAhead(a, dir, e, cell, period, out) {
    var n = a ? a.length : 0;
    if (!n) { out.length = 0; return 0; }
    var dx = dir ? dir.x : 0, dy = dir ? dir.y : 0;
    var head = a[0];
    step(out, 0, head.x, head.y, head.x + dx * cell, head.y + dy * cell, e, cell, period);
    for (var i = 1; i < n; i++) step(out, i, a[i].x, a[i].y, a[i - 1].x, a[i - 1].y, e, cell, period);
    out.length = n;
    return n;
  }

  // Proyectil nuevo: arranca donde se creó (una celda antes de su primera posición).
  // Proyectil que ya no está: sigue de largo hasta el instante del impacto o la salida.
  function projectileAt(pa, pb, f, cell, out) {
    var p = pb || pa;
    var d = p.direction || { x: 0, y: 0 };
    var sx, sy, tx, ty;
    if (pa && pb) { sx = pa.x; sy = pa.y; tx = pb.x; ty = pb.y; }
    else if (pb) { tx = pb.x; ty = pb.y; sx = tx - d.x * cell; sy = ty - d.y * cell; }
    else { sx = pa.x; sy = pa.y; tx = sx + d.x * cell; ty = sy + d.y * cell; }
    out.x = sx + (tx - sx) * f;
    out.y = sy + (ty - sy) * f;
    return out;
  }

  global.Motion = {
    createTimeline: function (opts) { return new Timeline(opts); },
    snakeAt: snakeAt,
    snakeAhead: snakeAhead,
    projectileAt: projectileAt
  };
})(typeof window !== 'undefined' ? window : this);
