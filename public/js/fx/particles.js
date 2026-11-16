/*
 * particles.js — sistema de partículas para canvas 2D (window.Particles).
 *
 * Pool preasignado en arrays tipados, tope duro, sin allocations en update/draw.
 * Brillo con sprites de glow cacheados y globalCompositeOperation 'lighter'
 * (nunca shadowBlur). Lo usan la arena (public/js/render/arena.js) y el fondo vivo.
 *
 * API:
 *   Particles.createSystem({ max }) -> sistema
 *     .burst(x, y, opts)   ráfaga (opts: count, color, speed, life, size, endSize,
 *                          spread, angle, gravity, drag, glow, shape, alpha, lineWidth)
 *     .emit(opts)          una partícula con x, y, vx, vy explícitos
 *     .update(dtMs)        integra (dt acotado a 50 ms)
 *     .draw(ctx)           dibuja en coordenadas del contexto actual
 *     .clear(), .count()
 *     .setLimit(n)         tope lógico (<= max); el pool no se realoca
 *   Particles.glowSprite(color, big)   sprite de glow cacheado (64 o 128 px)
 *   Particles.inkSprite(color)         sprite oscuro (tinta) cacheado
 *   Particles.SHAPES                   { dot, spark, ring, bubble, ink }
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  var SHAPES = { dot: 0, spark: 1, ring: 2, bubble: 3, ink: 4 };

  // ---------------------------------------------------------------------------
  // Utilidades de color y sprites (compartidas con la arena)
  // ---------------------------------------------------------------------------

  function makeCanvas(w, h) {
    if (typeof document !== 'undefined' && document.createElement) {
      var c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    return null;
  }

  function parseColor(str) {
    // Devuelve [r, g, b] para '#rgb', '#rrggbb' o 'rgb(a)(...)'.
    var s = String(str || '').trim();
    if (s.charAt(0) === '#') {
      var h = s.slice(1);
      if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
      var n = parseInt(h.slice(0, 6), 16);
      if (isNaN(n)) return [79, 216, 255];
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    var m = s.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      var p = m[1].split(',');
      return [parseFloat(p[0]) || 0, parseFloat(p[1]) || 0, parseFloat(p[2]) || 0];
    }
    return [79, 216, 255];
  }

  // Caché LRU de sprites: clave color|tamaño, máximo 64 entradas.
  var SPRITE_MAX = 64;
  var spriteCache = new Map();

  function cacheGet(key) {
    var c = spriteCache.get(key);
    if (c) {
      // refresco LRU
      spriteCache.delete(key);
      spriteCache.set(key, c);
    }
    return c;
  }

  function cachePut(key, c) {
    if (spriteCache.size >= SPRITE_MAX) {
      var oldest = spriteCache.keys().next().value;
      spriteCache.delete(oldest);
    }
    spriteCache.set(key, c);
  }

  function buildGlow(color, px) {
    var c = makeCanvas(px, px);
    if (!c) return null;
    var g = c.getContext('2d');
    var rgb = parseColor(color);
    var r = px / 2;
    var grad = g.createRadialGradient(r, r, 0, r, r, r);
    var base = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',';
    grad.addColorStop(0, base + '1)');
    grad.addColorStop(0.25, base + '0.45)');
    grad.addColorStop(0.55, base + '0.12)');
    grad.addColorStop(1, base + '0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, px, px);
    return c;
  }

  function buildInk(color, px) {
    var c = makeCanvas(px, px);
    if (!c) return null;
    var g = c.getContext('2d');
    var rgb = parseColor(color);
    var r = px / 2;
    var grad = g.createRadialGradient(r, r, 0, r, r, r);
    var base = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',';
    grad.addColorStop(0, base + '0.9)');
    grad.addColorStop(0.45, base + '0.55)');
    grad.addColorStop(0.8, base + '0.15)');
    grad.addColorStop(1, base + '0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, px, px);
    return c;
  }

  function glowSprite(color, big) {
    var px = big ? 128 : 64;
    var key = color + '|' + px;
    var c = cacheGet(key);
    if (!c) {
      c = buildGlow(color, px);
      cachePut(key, c);
    }
    return c;
  }

  function inkSprite(color) {
    var key = color + '|ink';
    var c = cacheGet(key);
    if (!c) {
      c = buildInk(color, 64);
      cachePut(key, c);
    }
    return c;
  }

  // Registro global de colores: string -> índice. Cada color guarda sus sprites
  // propios (no dependen del LRU, así nunca se regeneran en medio de un frame).
  var COLOR_MAX = 1024;
  var colorIndex = new Map();
  var colorStr = [];
  var colorGlow = [];
  var colorInk = [];

  function registerColor(color) {
    var key = color || '#1FF2D2';
    var idx = colorIndex.get(key);
    if (idx !== undefined) return idx;
    if (colorStr.length >= COLOR_MAX) return 0;
    idx = colorStr.length;
    colorIndex.set(key, idx);
    colorStr.push(key);
    colorGlow.push(null);
    colorInk.push(null);
    return idx;
  }

  function glowFor(idx) {
    var c = colorGlow[idx];
    if (!c) {
      c = buildGlow(colorStr[idx], 64);
      colorGlow[idx] = c;
    }
    return c;
  }

  function inkFor(idx) {
    var c = colorInk[idx];
    if (!c) {
      c = buildInk(colorStr[idx], 64);
      colorInk[idx] = c;
    }
    return c;
  }

  // ---------------------------------------------------------------------------
  // Muestreo de opciones (sin allocations: los rangos por defecto son constantes)
  // ---------------------------------------------------------------------------

  var D_SPEED = [40, 120];
  var D_LIFE = [400, 800];
  var D_SIZE = [1, 2.5];

  function sample(v, def) {
    if (v === undefined || v === null) v = def;
    if (typeof v === 'number') return v;
    var a = v[0], b = v[1];
    return a + Math.random() * (b - a);
  }

  function easeInQuart(t) { return t * t * t * t; }

  // ---------------------------------------------------------------------------
  // Sistema
  // ---------------------------------------------------------------------------

  function createSystem(options) {
    var max = Math.max(1, (options && options.max) | 0 || 600);
    var limit = max;

    var px = new Float32Array(max);
    var py = new Float32Array(max);
    var vx = new Float32Array(max);
    var vy = new Float32Array(max);
    var age = new Float32Array(max);
    var life = new Float32Array(max);
    var size0 = new Float32Array(max);
    var size1 = new Float32Array(max);
    var alpha = new Float32Array(max);
    var grav = new Float32Array(max);
    var drag = new Float32Array(max);
    var lw = new Float32Array(max);
    var shape = new Uint8Array(max);
    var blend = new Uint8Array(max); // 0 = 'lighter', 1 = 'source-over'
    var color = new Uint16Array(max);
    var alive = new Uint8Array(max);
    var birth = new Uint32Array(max);

    var active = 0;
    var cursor = 0;
    var serial = 1;

    function alloc() {
      var i, j;
      if (active < limit) {
        for (i = 0; i < max; i++) {
          j = cursor + i;
          if (j >= max) j -= max;
          if (!alive[j]) {
            cursor = j + 1 >= max ? 0 : j + 1;
            active++;
            alive[j] = 1;
            birth[j] = serial++;
            return j;
          }
        }
      }
      // Pool lleno (o tope lógico alcanzado): reemplaza la más vieja.
      var best = -1, bestBirth = 0xffffffff;
      for (i = 0; i < max; i++) {
        if (alive[i] && birth[i] < bestBirth) { bestBirth = birth[i]; best = i; }
      }
      if (best < 0) best = 0;
      if (!alive[best]) { alive[best] = 1; active++; }
      birth[best] = serial++;
      return best;
    }

    function setup(i, x, y, svx, svy, o, ci) {
      px[i] = x;
      py[i] = y;
      vx[i] = svx;
      vy[i] = svy;
      age[i] = 0;
      life[i] = Math.max(16, sample(o.life, D_LIFE));
      var s0 = sample(o.size, D_SIZE);
      size0[i] = s0;
      size1[i] = o.endSize !== undefined && o.endSize !== null ? sample(o.endSize, s0) : s0;
      alpha[i] = o.alpha !== undefined ? o.alpha : 1;
      grav[i] = o.gravity !== undefined ? o.gravity : -12;
      drag[i] = o.drag !== undefined ? o.drag : 0.92;
      lw[i] = o.lineWidth !== undefined ? o.lineWidth : 1.5;
      var sh = SHAPES[o.shape];
      if (sh === undefined) sh = 0;
      shape[i] = sh;
      blend[i] = (sh === 4 || o.glow === false) ? 1 : 0;
      color[i] = ci;
    }

    function burst(x, y, o) {
      o = o || {};
      var count = o.count !== undefined ? o.count | 0 : 12;
      if (count <= 0) return;
      var spread = o.spread !== undefined ? o.spread : TAU;
      var base = o.angle !== undefined ? o.angle : 0;
      // registrar color una sola vez por ráfaga
      var ci = registerColor(o.color || '#1FF2D2');
      for (var k = 0; k < count; k++) {
        var a = spread >= TAU ? Math.random() * TAU : base + (Math.random() - 0.5) * spread;
        var sp = sample(o.speed, D_SPEED);
        var i = alloc();
        setup(i, x, y, Math.cos(a) * sp, Math.sin(a) * sp, o, ci);
      }
    }

    function emit(o) {
      if (!o) return;
      var i = alloc();
      setup(i, o.x || 0, o.y || 0, o.vx || 0, o.vy || 0, o, registerColor(o.color || '#1FF2D2'));
    }

    function update(dtMs) {
      if (active === 0) return;
      var dms = dtMs > 50 ? 50 : (dtMs < 0 ? 0 : dtMs);
      var dt = dms / 1000;
      var f = dms / (1000 / 60);
      for (var i = 0; i < max; i++) {
        if (!alive[i]) continue;
        var a = age[i] + dms;
        if (a >= life[i]) {
          alive[i] = 0;
          active--;
          continue;
        }
        age[i] = a;
        var g = grav[i];
        if (g !== 0) vy[i] += g * dt;
        var d = drag[i];
        if (d !== 1) {
          var k = Math.pow(d, f);
          vx[i] *= k;
          vy[i] *= k;
        }
        px[i] += vx[i] * dt;
        py[i] += vy[i] * dt;
      }
    }

    function envelope(i) {
      var t = age[i] / life[i];
      var e = t < 0.1 ? t / 0.1 : 1 - easeInQuart((t - 0.1) / 0.9);
      return e * alpha[i];
    }

    function curSize(i) {
      var t = age[i] / life[i];
      var s0 = size0[i], s1 = size1[i];
      if (s0 === s1) return s0;
      var e = 1 - (1 - t) * (1 - t) * (1 - t);
      return s0 + (s1 - s0) * e;
    }

    function drawShape(ctx, sh, bl) {
      var lastColor = -1;
      var i, a, s, x, y, ci, spr, r;
      for (i = 0; i < max; i++) {
        if (!alive[i] || shape[i] !== sh || blend[i] !== bl) continue;
        a = envelope(i);
        if (a <= 0.004) continue;
        s = curSize(i);
        x = px[i];
        y = py[i];
        ci = color[i];
        if (sh === 0) {
          // dot: sprite de glow (o disco más ceñido si glow=false)
          spr = glowFor(ci);
          r = bl === 0 ? s * 3 : s * 1.8;
          ctx.globalAlpha = a > 1 ? 1 : a;
          ctx.drawImage(spr, x - r, y - r, r + r, r + r);
        } else if (sh === 4) {
          spr = inkFor(ci);
          r = s * 1.6;
          ctx.globalAlpha = a > 1 ? 1 : a;
          ctx.drawImage(spr, x - r, y - r, r + r, r + r);
        } else if (sh === 1) {
          // spark: línea a lo largo de la velocidad, largo = velocidad * 0,03
          if (ci !== lastColor) { ctx.strokeStyle = colorStr[ci]; lastColor = ci; }
          var lx = vx[i] * 0.03, ly = vy[i] * 0.03;
          if (lx * lx + ly * ly < 0.25) { lx = vx[i] >= 0 ? 0.5 : -0.5; ly = 0; }
          ctx.globalAlpha = a > 1 ? 1 : a;
          ctx.lineWidth = s * 0.7 > 0.6 ? s * 0.7 : 0.6;
          ctx.beginPath();
          ctx.moveTo(x - lx, y - ly);
          ctx.lineTo(x + lx, y + ly);
          ctx.stroke();
        } else if (sh === 2) {
          // ring: círculo trazado que crece de size a endSize
          if (ci !== lastColor) { ctx.strokeStyle = colorStr[ci]; lastColor = ci; }
          ctx.globalAlpha = a > 1 ? 1 : a;
          ctx.lineWidth = lw[i];
          ctx.beginPath();
          ctx.arc(x, y, s > 0.1 ? s : 0.1, 0, TAU);
          ctx.stroke();
        } else if (sh === 3) {
          // bubble: círculo trazado con un brillo de 1 px arriba a la izquierda
          if (ci !== lastColor) { ctx.strokeStyle = colorStr[ci]; lastColor = ci; }
          ctx.globalAlpha = a > 1 ? 1 : a;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, s, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = (a > 1 ? 1 : a) * 0.9;
          ctx.fillStyle = '#E8FBFF';
          ctx.fillRect(x - s * 0.55, y - s * 0.55, 1, 1);
        }
      }
    }

    function draw(ctx) {
      if (active === 0) return;
      var prevOp = ctx.globalCompositeOperation;
      var prevAlpha = ctx.globalAlpha;
      var prevCap = ctx.lineCap;
      ctx.lineCap = 'round';
      // Pasada opaca: tinta y partículas sin glow.
      ctx.globalCompositeOperation = 'source-over';
      drawShape(ctx, 4, 1);
      drawShape(ctx, 0, 1);
      drawShape(ctx, 1, 1);
      drawShape(ctx, 2, 1);
      drawShape(ctx, 3, 1);
      // Pasada aditiva: todo lo que brilla.
      ctx.globalCompositeOperation = 'lighter';
      drawShape(ctx, 0, 0);
      drawShape(ctx, 1, 0);
      drawShape(ctx, 2, 0);
      drawShape(ctx, 3, 0);
      ctx.globalCompositeOperation = prevOp;
      ctx.globalAlpha = prevAlpha;
      ctx.lineCap = prevCap;
    }

    function clear() {
      alive.fill(0);
      active = 0;
      cursor = 0;
    }

    function count() { return active; }

    function setLimit(n) {
      limit = Math.max(1, Math.min(max, n | 0));
      if (active > limit) {
        // descarta las más viejas hasta respetar el tope
        while (active > limit) {
          var best = -1, bestBirth = 0xffffffff;
          for (var i = 0; i < max; i++) {
            if (alive[i] && birth[i] < bestBirth) { bestBirth = birth[i]; best = i; }
          }
          if (best < 0) break;
          alive[best] = 0;
          active--;
        }
      }
    }

    return {
      emit: emit,
      burst: burst,
      update: update,
      draw: draw,
      clear: clear,
      count: count,
      setLimit: setLimit,
      max: max
    };
  }

  global.Particles = {
    createSystem: createSystem,
    glowSprite: glowSprite,
    inkSprite: inkSprite,
    parseColor: parseColor,
    SHAPES: SHAPES
  };
})(typeof window !== 'undefined' ? window : this);
