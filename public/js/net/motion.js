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
 * El servidor no emite exactamente cada gameSpeed ms, pero la serpiente avanza una celda por
 * paso igual. Interpolar con las horas reales cambiaría la velocidad visible en cada paso (a
 * 42 ms, 3 ms de diferencia son 7 %), así que cada frame se ubica a un paso del anterior y
 * solo se corre un 10 % hacia su hora real. La hora real (frame.raw) se usa para el reloj.
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
 *     .push(frame, recvNow)  frame: { t (hora del servidor), ... }; recvNow: performance.now() al llegar.
 *                            Deja la hora real en frame.raw y la suavizada en frame.t
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
 *   Motion.leadFor(snake, e, serverT) -> e                  cuánto extrapolar esa serpiente (0 si está anclada)
 *   Motion.projectileAt(pa, pb, f, cell, out)              out.x, out.y
 *
 * `out` es un array de { x, y } que se reutiliza entre cuadros. `period` es el tamaño de la
 * arena (el envoltorio de los portales): un número si es cuadrada, o { x, y } con el ancho y el
 * alto; 0 desactiva el envoltorio.
 */
(function (global) {
  'use strict';

  const MAX_FRAMES = 8;        // ~650 ms a 12 pasos por segundo
  const MAX_AHEAD = 0.5;       // extrapolación máxima, en pasos
  const OFFSET_RISE = 0.01;    // el reloj sube despacio (deriva, cambio de ruta)...
  const OFFSET_FALL = 0.25;    // ...y baja rápido, pero sin saltar: un salto adelantaría el render de golpe
  const JITTER_EASE = 0.1;
  const TICK_EASE = 0.1;
  const TIME_EASE = 0.1;       // cuánto se corre la hora suavizada de un frame hacia la real
  const STALE_MS = 300;        // eventos más viejos que esto se descartan (pestaña en segundo plano)
  const SNAP_STEPS = 1.5;      // un salto de más de 1,5 celdas no se interpola (reaparición)
  const SLEW = 0.05;           // el atraso del render se corrige a lo sumo 5 % del tiempo real

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
    const raw = frame.t;
    const lag = recvNow - raw;
    if (!this.hasOffset) {
      this.offset = lag;
      this.hasOffset = true;
    } else {
      this.offset += (lag - this.offset) * (lag < this.offset ? OFFSET_FALL : OFFSET_RISE);
    }
    const late = lag - this.offset;
    this.jitter += ((late > 0 ? late : 0) - this.jitter) * JITTER_EASE;

    const frames = this.frames;
    const last = frames.length ? frames[frames.length - 1] : null;
    if (last) {
      if (raw <= last.raw) return false; // repetido o fuera de orden
      const dt = raw - last.raw;
      if (dt < this.tick * 3) {
        this.tick += (dt - this.tick) * TICK_EASE;
        const expected = last.t + this.tick;
        frame.t = expected + (raw - expected) * TIME_EASE;
      }
      // Un hueco de más de 3 pasos (pestaña dormida, servidor trabado): queda la hora real
    } else if (this.pendingSeed) {
      this.pendingSeed.t = this.pendingSeed.raw = raw - this.tick;
      frames.push(this.pendingSeed);
      this.pendingSeed = null;
    }
    frame.raw = raw;
    frame.done = false;
    frames.push(frame);
    if (frames.length > MAX_FRAMES) frames.splice(0, frames.length - MAX_FRAMES);
    return true;
  };

  Timeline.prototype.delay = function () {
    let margin = 4 + 2 * this.jitter;
    if (margin > 60) margin = 60;
    return this.tick + margin;
  };

  Timeline.prototype.sample = function (now, out) {
    const frames = this.frames, n = frames.length;
    if (!n || !this.hasOffset) return null;
    // Cada frame que llega mueve offset y delay unos milisegundos. Aplicarlo de golpe da un
    // tirón; se reparte de a poco, sin que el render cambie de velocidad más de un 5 %.
    const target = this.offset + this.delay();
    if (this.lag === null) this.lag = target;
    else {
      const maxStep = (now - this.lastNow) * SLEW;
      const d = target - this.lag;
      this.lag += d > maxStep ? maxStep : d < -maxStep ? -maxStep : d;
    }
    this.lastNow = now;
    let rt = now - this.lag;
    if (rt < this.lastRt) rt = this.lastRt;
    this.lastRt = rt;
    out.rt = rt;

    if (rt <= frames[0].t) {
      out.a = frames[0]; out.b = null; out.f = 0; out.e = 0;
      return out;
    }
    let i = n - 1;
    while (i > 0 && frames[i].t > rt) i--;
    const a = frames[i];
    if (i === n - 1) {
      const e = (rt - a.t) / this.tick;
      out.a = a; out.b = null; out.f = 0; out.e = e > MAX_AHEAD ? MAX_AHEAD : e;
    } else {
      const b = frames[i + 1];
      out.a = a; out.b = b; out.f = (rt - a.t) / (b.t - a.t); out.e = 0;
    }
    return out;
  };

  Timeline.prototype.drain = function (fn) {
    const rt = this.lastRt, frames = this.frames;
    for (let i = 0; i < frames.length; i++) {
      const fr = frames[i];
      if (fr.t > rt) break;
      if (fr.done) continue;
      fr.done = true;
      if (fr.t >= rt - STALE_MS) fn(fr);
    }
  };

  // Salta al último frame (fin de ronda): lo congelado coincide con el estado final y el
  // drain siguiente despacha todo lo pendiente.
  Timeline.prototype.sampleLatest = function (out) {
    const n = this.frames.length;
    if (!n) return null;
    const a = this.frames[n - 1];
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
      const half = period / 2;
      if (d > half) d -= period;
      else if (d < -half) d += period;
    }
    return d;
  }

  // El segmento pasa al borde opuesto cuando su centro cruza el borde
  function wrapPos(p, cell, period) {
    if (period > 0) {
      const c = p + cell / 2;
      if (c < 0) p += period;
      else if (c >= period) p -= period;
    }
    return p;
  }

  function setPoint(out, i, x, y) {
    let o = out[i];
    if (!o) o = out[i] = { x: 0, y: 0 };
    o.x = x;
    o.y = y;
  }

  // Período de cada eje para la serpiente en curso (lo fija setPeriod al empezar cada llamada)
  let PX = 0, PY = 0;
  function setPeriod(period) {
    if (period && typeof period === 'object') { PX = +period.x || 0; PY = +period.y || 0; }
    else { PX = +period || 0; PY = PX; }
  }

  function step(out, i, sx, sy, tx, ty, f, cell) {
    const dx = wrapDelta(tx - sx, PX), dy = wrapDelta(ty - sy, PY);
    const snap = cell * SNAP_STEPS;
    if (dx > snap || dx < -snap || dy > snap || dy < -snap) setPoint(out, i, tx, ty);
    else setPoint(out, i, wrapPos(sx + dx * f, cell, PX), wrapPos(sy + dy * f, cell, PY));
  }

  function copyInto(src, out) {
    const n = src ? src.length : 0;
    for (let i = 0; i < n; i++) setPoint(out, i, src[i].x, src[i].y);
    out.length = n;
    return n;
  }

  // Segmento i de a hacia b. Si b creció, la cola nueva nace quieta sobre la última de a.
  // Si b se achicó (disparo o impacto), los segmentos que sobran siguen el cuerpo hasta el
  // instante de b, donde desaparecen junto con el efecto.
  function snakeAt(a, b, f, cell, period, out) {
    const na = a ? a.length : 0, nb = b ? b.length : 0;
    if (!na) return copyInto(b, out);
    if (!nb) return copyInto(a, out);
    const n = na > nb ? na : nb;
    setPeriod(period);
    for (let i = 0; i < n; i++) {
      const s = i < na ? a[i] : a[na - 1];
      const t = i < nb ? b[i] : a[i - 1];
      step(out, i, s.x, s.y, t.x, t.y, f, cell);
    }
    out.length = n;
    return n;
  }

  function snakeAhead(a, dir, e, cell, period, out) {
    const n = a ? a.length : 0;
    if (!n) { out.length = 0; return 0; }
    const dx = dir ? dir.x : 0, dy = dir ? dir.y : 0;
    const head = a[0];
    setPeriod(period);
    step(out, 0, head.x, head.y, head.x + dx * cell, head.y + dy * cell, e, cell);
    for (let i = 1; i < n; i++) step(out, i, a[i].x, a[i].y, a[i - 1].x, a[i - 1].y, e, cell);
    out.length = n;
    return n;
  }

  // La extrapolación supone que la serpiente avanza en cada paso. Anclada (quieta en el servidor hasta
  // anchoredUntil), no: si un frame llega tarde se adelantaría media celda y volvería atrás.
  function leadFor(snake, e, serverT) {
    return snake && snake.anchoredUntil > serverT ? 0 : e;
  }

  // Proyectil nuevo: arranca donde se creó (una celda antes de su primera posición).
  // Proyectil que ya no está: sigue de largo hasta el instante del impacto o la salida.
  function projectileAt(pa, pb, f, cell, out) {
    const p = pb || pa;
    const d = p.direction || { x: 0, y: 0 };
    let sx, sy, tx, ty;
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
    leadFor: leadFor,
    projectileAt: projectileAt
  };
})(typeof window !== 'undefined' ? window : this);
