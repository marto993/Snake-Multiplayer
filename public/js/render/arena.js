/*
 * arena.js — renderizador bioluminiscente de la arena (window.Arena).
 *
 * Dibuja canvas#game en coordenadas lógicas de 600 x 600, con el backing store
 * escalado por devicePixelRatio. Sin shadowBlur por frame: todo brillo sale de
 * sprites cacheados con globalCompositeOperation 'lighter'. Sin allocations
 * grandes por frame (buffers Float32Array reutilizados, pools de efectos).
 *
 * Depende de window.Particles (public/js/fx/particles.js), que se carga antes.
 * Especificación: docs/VISUAL_SPEC.md, secciones 2.3 y 5.
 *
 * API pública:
 *   Arena.init(canvasEl)
 *   Arena.setConfig({ segmentSize, width: 600, height: 600 })
 *   Arena.render(state, nowMs)
 *   Arena.renderIdle(nowMs, { snakesPreview: [{ id, name, color, isMe }], caption })
 *   Arena.onFoodEaten(e) / onHit(e) / onBlock(e) / onPortal(e) / onProjectileFired(e)
 *   Arena.onProjectileExpired(e) / onConsumablePicked(e) / onRoundStart() / onRoundEnd({ winnerId })
 *   Arena.shake(intensity, ms)
 *   Arena.bioColor(hex) -> { slot, body, core, deep, text }
 *   Arena.stats() -> { quality, particles, frameMs, avgFrameMs, renderMs }   (diagnóstico)
 *   Arena.setQuality(q)                                                       (diagnóstico)
 */
(function (global) {
  'use strict';

  var W = 600, H = 600, HALF_W = 300, HALF_H = 300;
  var TAU = Math.PI * 2;
  var BG_HEX = '#020A12';
  var BG_RGB = [2, 10, 18];

  var FONT_UI = '"Recursive", "Segoe UI", system-ui, sans-serif';
  var FONT_DISPLAY = '"Fraunces", "Iowan Old Style", Georgia, serif';

  // ---------------------------------------------------------------------------
  // Curvas (sección 3.2)
  // ---------------------------------------------------------------------------
  function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }
  function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
  function easeOutBack(t) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function easeOutCubic(t) { var u = 1 - t; return 1 - u * u * u; }
  function smoothstep(a, b, x) { var t = (x - a) / (b - a); t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }
  function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  // ---------------------------------------------------------------------------
  // Preferencias del usuario
  // ---------------------------------------------------------------------------
  var reducedMotion = false;
  var coarsePointer = false;
  var highContrast = false;

  function watchMedia(query, fn) {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    var mq;
    try { mq = window.matchMedia(query); } catch (err) { return; }
    fn(mq.matches);
    var handler = function (ev) { fn(ev.matches); };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  }

  // ---------------------------------------------------------------------------
  // Colores de jugador (sección 2.3)
  // ---------------------------------------------------------------------------
  var BIO_PLAYER = {
    '#00ff41': { slot: 0, body: '#7DFF6A', core: '#E5FDE1', deep: '#0B4B01', text: '#ABECA1' },
    '#ff0080': { slot: 1, body: '#FF5FC8', core: '#FEF1F8', deep: '#6E0051', text: '#FEC3E5' },
    '#00ffff': { slot: 2, body: '#3FE9FF', core: '#E1FBFF', deep: '#00464E', text: '#6FEDFF' },
    '#ffff00': { slot: 3, body: '#FFE45C', core: '#FDF6D4', deep: '#483D01', text: '#ECD877' },
    '#ff4040': { slot: 4, body: '#FF5E5E', core: '#FEF2F1', deep: '#770213', text: '#FEC8C4' },
    '#8040ff': { slot: 5, body: '#A884FF', core: '#F5F3FF', deep: '#442879', text: '#DAD0FE' },
    '#40ff80': { slot: 6, body: '#3DFFB8', core: '#DCFFED', deep: '#004931', text: '#87F1C1' },
    '#ff8040': { slot: 7, body: '#FF9A4D', core: '#FFF2EB', deep: '#5F2E01', text: '#FFCBA9' },
    '#4080ff': { slot: 8, body: '#5C9DFF', core: '#F0F6FE', deep: '#0D3A7A', text: '#C1D9FE' },
    '#ff40ff': { slot: 9, body: '#E36BFF', core: '#FCF1FE', deep: '#610173', text: '#F3C4FF' },
    '#80ff40': { slot: 10, body: '#C3FF4A', core: '#EDFBDB', deep: '#314500', text: '#C3E68E' },
    '#ff4080': { slot: 11, body: '#FF7A9C', core: '#FFF1F3', deep: '#6E1533', text: '#FFC6D1' },
    '#4040ff': { slot: 12, body: '#7E7BFF', core: '#F3F4FE', deep: '#342C85', text: '#D0D4FE' },
    '#ffff80': { slot: 13, body: '#FFF3A8', core: '#FCF7D4', deep: '#463E06', text: '#E6DA8F' },
    '#80ffff': { slot: 14, body: '#A6FFF4', core: '#D7FFF9', deep: '#034742', text: '#92EBE0' },
    '#ff8080': { slot: 15, body: '#FFB0A0', core: '#FEF2F0', deep: '#5D2D24', text: '#FFC9BD' }
  };

  function parseHex(str) {
    var s = String(str || '').trim();
    if (s.charAt(0) === '#') s = s.slice(1);
    if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    var n = parseInt(s.slice(0, 6), 16);
    if (s.length < 6 || isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function toHex(r, g, b) {
    var v = ((1 << 24) | (Math.round(clamp(r, 0, 255)) << 16) | (Math.round(clamp(g, 0, 255)) << 8) | Math.round(clamp(b, 0, 255)));
    return '#' + v.toString(16).slice(1).toUpperCase();
  }

  function rgbToHue(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d === 0) return 0;
    var h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  }

  function hslHex(h, s, l) {
    s /= 100; l /= 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs((h / 60) % 2 - 1));
    var m = l - c / 2;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }

  var bioCache = new Map();

  function bioColor(hex) {
    if (hex && typeof hex === 'object' && hex.body) return hex;
    var raw = hex === undefined || hex === null ? '' : hex;
    var rec = bioCache.get(raw);
    if (rec) return rec;
    var key = String(raw).trim().toLowerCase();
    rec = BIO_PLAYER[key];
    if (!rec) {
      var rgb = parseHex(key);
      if (!rgb) {
        rec = BIO_PLAYER['#00ff41'];
      } else {
        var h = rgbToHue(rgb);
        var sum = 0;
        for (var i = 0; i < key.length; i++) sum += key.charCodeAt(i);
        rec = {
          slot: sum % 4,
          body: hslHex(h, 100, 68),
          core: hslHex(h, 100, 95),
          deep: hslHex(h, 100, 22),
          text: hslHex(h, 100, 84)
        };
      }
      bioCache.set(key, rec);
    }
    bioCache.set(raw, rec);
    return rec;
  }

  // Datos de render por color (rampas, sprites). Se crean una vez por color.
  var DIM_LEVELS = 8; // 0 = alpha 1, 7 = alpha 0,3
  function dimAlpha(level) { return 1 - level * (0.7 / (DIM_LEVELS - 1)); }
  function dimLevel(a) { return clamp(Math.round((1 - a) / (0.7 / (DIM_LEVELS - 1))), 0, DIM_LEVELS - 1); }

  var paints = new Map();

  function mixRgb(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function rgbStr(c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; }
  function rgbaStr(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')'; }

  function paintFor(hexOrRec) {
    var rec = bioColor(hexOrRec);
    var p = paints.get(rec);
    if (p) return p;
    var body = parseHex(rec.body) || [125, 255, 106];
    var core = parseHex(rec.core) || [229, 253, 225];
    var deep = parseHex(rec.deep) || [11, 75, 1];
    p = {
      rec: rec,
      slot: rec.slot | 0,
      body: rec.body,
      core: rec.core,
      deep: rec.deep,
      text: rec.text,
      bodyRgb: body,
      coreRgb: core,
      deepRgb: deep,
      lure: rgbaStr(body, 0.8),
      ramps: new Array(DIM_LEVELS),
      inners: new Array(DIM_LEVELS),
      mids: new Array(DIM_LEVELS),
      heads: new Array(DIM_LEVELS),
      glowBody: Particles.glowSprite(rec.body, false),
      glowBodyBig: Particles.glowSprite(rec.body, true),
      glowCore: Particles.glowSprite(rec.core, false),
      glowDeep: Particles.glowSprite(rec.deep, false)
    };
    paints.set(rec, p);
    return p;
  }

  // Rampa de cuerpo (5.3): mix(body, deep, smoothstep(0.15, 1, t) * 0.85); alpha 1 hasta
  // t = 0,7 y luego baja a 0,35. Se precalcula opaca, mezclando contra el fondo (el
  // atenuado de fin de ronda usa los niveles de DIM_LEVELS). Además de la rampa de la
  // membrana (borde luminoso) hay una rampa interior más oscura: el cuerpo se lee como
  // tejido translúcido con borde de luz, no como un tubo de neón macizo.
  function rampFor(p, level) {
    var r = p.ramps[level];
    if (r) return r;
    r = new Array(32);
    var inner = new Array(32);
    var mid = new Array(32);
    var under = mixRgb(BG_RGB, p.bodyRgb, 0.1);
    var am = dimAlpha(level);
    for (var i = 0; i < 32; i++) {
      var t = i / 31;
      var c = mixRgb(p.bodyRgb, p.deepRgb, smoothstep(0.15, 1, t) * 0.85);
      var a = t <= 0.7 ? 1 : 1 - ((t - 0.7) / 0.3) * 0.65;
      a *= am;
      r[i] = rgbStr(mixRgb(under, c, a));
      var cm = mixRgb(c, p.deepRgb, 0.28 + 0.12 * t);
      mid[i] = rgbStr(mixRgb(under, cm, a));
      var ci = mixRgb(c, p.deepRgb, 0.56 + 0.18 * t);
      inner[i] = rgbStr(mixRgb(under, ci, a));
    }
    p.ramps[level] = r;
    p.mids[level] = mid;
    p.inners[level] = inner;
    p.heads[level] = r[0];
    return r;
  }

  // ---------------------------------------------------------------------------
  // Estado del módulo
  // ---------------------------------------------------------------------------
  var canvas = null, ctx = null;
  var cssSize = 600;      // tamaño CSS del canvas (lado)
  var dprEff = 1;         // devicePixelRatio efectivo
  var K = 1;              // px del backing store por px lógico
  var arenaScale = 1;     // cssSize / 600
  var s = 20;             // segmentSize
  var resizeObs = null, resizeTimer = 0;
  var textEpoch = 1;      // se incrementa al cargar fuentes o cambiar de escala
  var fontsReady = false;

  var quality = 2;
  var qualityLockUntil = 0;
  var ftBuf = new Float32Array(90), ftIdx = 0, ftCount = 0, ftSum = 0;
  var lastNow = 0, frameDt = 16, lastRenderMs = 0, frameNo = 0;
  var animT = 0;          // reloj de animación (se ralentiza en el congelamiento)
  var timeScale = 1;

  var particles = null;
  var mode = 'none';      // 'game' | 'idle'
  var lastState = null;
  var lastGameRenderT = -1e9;
  var myId = null;

  // ---------------------------------------------------------------------------
  // Canvas auxiliares
  // ---------------------------------------------------------------------------
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  // Fondo abisal + grilla de puntos (cacheado a resolución del backing store).
  // La grilla se hornea en el mismo caché: con alpha 0,07 su orden respecto de
  // las cáusticas aditivas es visualmente equivalente y ahorra un drawImage por frame.
  var bgCanvas = null;
  var vignetteDark = null, vignetteCoral = null;
  var stripTop = null, stripBottom = null, stripLeft = null, stripRight = null;
  var causticCyan = null, causticCoral = null;
  var patCyan = null, patCoral = null;
  var patMatrix = null;
  var causticOff = new Float32Array(4); // ax, ay, bx, by
  var snowSprite = null;
  var pearlSprite = null, shieldSprite = null, violetSprite = null, pearlBig = null;
  var turquoiseSprite = null;

  function buildBackground() {
    var bw = canvas.width, bh = canvas.height;
    if (!bgCanvas) bgCanvas = makeCanvas(bw, bh);
    if (bgCanvas.width !== bw || bgCanvas.height !== bh) { bgCanvas.width = bw; bgCanvas.height = bh; }
    var g = bgCanvas.getContext('2d');
    g.setTransform(K, 0, 0, K, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = BG_HEX;
    g.fillRect(0, 0, W, H);
    var rg = g.createRadialGradient(300, 120, 0, 300, 120, 520);
    rg.addColorStop(0, 'rgba(7,37,54,0.55)');
    rg.addColorStop(1, 'rgba(7,37,54,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
    var lg = g.createLinearGradient(0, H * 0.65, 0, H);
    lg.addColorStop(0, 'rgba(1,5,9,0)');
    lg.addColorStop(1, 'rgba(1,5,9,0.6)');
    g.fillStyle = lg;
    g.fillRect(0, H * 0.65, W, H * 0.35);
    // grilla de puntos en cada esquina de celda (cada dos celdas con s = 8)
    var step = s < 10 ? s * 2 : s;
    g.fillStyle = 'rgba(79,216,255,0.07)';
    var rr = 0.6;
    for (var y = step; y < H; y += step) {
      for (var x = step; x < W; x += step) {
        g.beginPath();
        g.arc(x, y, rr, 0, TAU);
        g.fill();
      }
    }
  }

  function buildVignettes() {
    var size = 300;
    function vig(rgb, edgeAlpha) {
      var c = makeCanvas(size, size);
      var g = c.getContext('2d');
      var half = size / 2;
      var outer = Math.sqrt(2) * half;
      // transparente hasta el 55 % de la semidiagonal, color pleno en las esquinas
      var grad = g.createRadialGradient(half, half, outer * 0.55, half, half, outer);
      grad.addColorStop(0, 'rgba(' + rgb + ',0)');
      grad.addColorStop(1, 'rgba(' + rgb + ',' + edgeAlpha + ')');
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      return c;
    }
    vignetteDark = vig('1,5,9', 0.75);
    vignetteCoral = vig('255,77,109', 0.18);
  }

  function buildStrips() {
    var depth = 14;
    var len = W;
    function strip(horizontal, fromStart) {
      var cw = horizontal ? len * K : depth * K;
      var ch = horizontal ? depth * K : len * K;
      var c = makeCanvas(cw, ch);
      var g = c.getContext('2d');
      var grad = horizontal
        ? g.createLinearGradient(0, fromStart ? 0 : ch, 0, fromStart ? ch : 0)
        : g.createLinearGradient(fromStart ? 0 : cw, 0, fromStart ? cw : 0, 0);
      grad.addColorStop(0, 'rgba(31,242,210,1)');
      grad.addColorStop(0.35, 'rgba(31,242,210,0.35)');
      grad.addColorStop(1, 'rgba(31,242,210,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, cw, ch);
      return c;
    }
    stripTop = strip(true, true);
    stripBottom = strip(true, false);
    stripLeft = strip(false, true);
    stripRight = strip(false, false);
  }

  // Cáusticas (5.2): Voronoi de 12 puntos con distancia envolvente, venas entre celdas.
  function buildCaustics() {
    if (causticCyan) return;
    var N = 256, P = 12;
    var ptx = new Float32Array(P), pty = new Float32Array(P);
    for (var p = 0; p < P; p++) { ptx[p] = Math.random(); pty[p] = Math.random(); }
    var vals = new Float32Array(N * N);
    for (var y = 0; y < N; y++) {
      var v = (y + 0.5) / N;
      for (var x = 0; x < N; x++) {
        var u = (x + 0.5) / N;
        var f1 = 9, f2 = 9;
        for (p = 0; p < P; p++) {
          var dx = u - ptx[p]; if (dx < 0) dx = -dx; if (dx > 0.5) dx = 1 - dx;
          var dy = v - pty[p]; if (dy < 0) dy = -dy; if (dy > 0.5) dy = 1 - dy;
          var d = Math.sqrt(dx * dx + dy * dy);
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
        }
        var val = 1 - smoothstep(0, 0.06, f2 - f1);
        vals[y * N + x] = Math.pow(val, 1.5) * 0.9;
      }
    }
    function tinted(r, g, b) {
      var c = makeCanvas(N, N);
      var cx = c.getContext('2d');
      var img = cx.createImageData(N, N);
      var d = img.data;
      for (var i = 0, j = 0; i < N * N; i++, j += 4) {
        d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = Math.round(vals[i] * 255);
      }
      cx.putImageData(img, 0, 0);
      return c;
    }
    causticCyan = tinted(79, 216, 255);
    causticCoral = tinted(255, 77, 109);
  }

  function buildPatterns() {
    if (!ctx || !causticCyan) return;
    patCyan = ctx.createPattern(causticCyan, 'repeat');
    patCoral = ctx.createPattern(causticCoral, 'repeat');
    if (typeof DOMMatrix !== 'undefined') patMatrix = new DOMMatrix();
  }

  function buildSprites() {
    snowSprite = Particles.glowSprite('#9FE3F2', false);
    pearlSprite = Particles.glowSprite('#E8FBFF', false);
    pearlBig = Particles.glowSprite('#E8FBFF', true);
    shieldSprite = Particles.glowSprite('#9FF4FF', false);
    violetSprite = Particles.glowSprite('#B9A6FF', true);
    turquoiseSprite = Particles.glowSprite('#1FF2D2', true);
  }

  // ---------------------------------------------------------------------------
  // Texto en sprites (etiquetas, textos flotantes, contador, caption)
  // ---------------------------------------------------------------------------
  function fontUi(weight, px) { return weight + ' ' + px.toFixed(2) + 'px ' + FONT_UI; }

  // Devuelve un canvas con el texto centrado; c._w/c._h guardan su tamaño lógico.
  function textSprite(reuse, str, font, logicalPx, fill, outline, outlineCss) {
    var c = reuse || makeCanvas(2, 2);
    var g = c.getContext('2d');
    var devFont = font.replace(/[\d.]+px/, (logicalPx * K).toFixed(2) + 'px');
    g.font = devFont;
    var tw = g.measureText(str).width;
    var lwDev = outline ? outlineCss * dprEff : 0;
    var pad = Math.ceil(lwDev + 2 * K);
    var cw = Math.ceil(tw + pad * 2);
    var ch = Math.ceil(logicalPx * K * 1.4 + pad * 2);
    c.width = Math.max(2, cw);
    c.height = Math.max(2, ch);
    g = c.getContext('2d');
    g.font = devFont;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    var cx = c.width / 2, cy = c.height / 2;
    if (outline) {
      g.strokeStyle = outline;
      g.lineWidth = lwDev;
      g.strokeText(str, cx, cy);
    }
    g.fillStyle = fill;
    g.fillText(str, cx, cy);
    c._w = c.width / K;
    c._h = c.height / K;
    return c;
  }

  function labelPx() { return Math.max(11, 10 / Math.max(0.1, arenaScale)); }

  function truncateName(name) {
    var n = String(name == null ? '' : name);
    if (n.length > 12) n = n.slice(0, 12) + '…';
    return n;
  }

  var meLabel = null, meLabelEpoch = 0;
  function getMeLabel() {
    if (!meLabel || meLabelEpoch !== textEpoch) {
      meLabel = textSprite(meLabel, 'Tú', fontUi(700, 12), labelPx() * 1.08, '#C8FF3C', 'rgba(2,10,18,0.85)', 3);
      meLabelEpoch = textEpoch;
    }
    return meLabel;
  }

  // Pool de sprites de texto flotante
  var textPool = [];
  function takeTextCanvas() { return textPool.length ? textPool.pop() : null; }
  function releaseTextCanvas(c) { if (c && textPool.length < 24) textPool.push(c); }

  // Sprites del contador gigante: uno por número (10..1), cada número tiene su color fijo.
  var digitSprites = new Array(11);
  var digitEpoch = new Int32Array(11);
  function countdownColor(n) { return n >= 6 ? '#1FF2D2' : (n >= 4 ? '#FFB547' : '#FF4D6D'); }
  function countdownSize(n) { return n <= 3 ? 340 : 300; }
  function buildDigit(n) {
    var px = countdownSize(n);
    var kd = Math.min(K, 1.1) * 0.85; // resolución reducida: es un elemento suave de fondo
    var font = 'italic 300 ' + (px * kd).toFixed(1) + 'px ' + FONT_DISPLAY;
    var c = digitSprites[n] || makeCanvas(2, 2);
    var g = c.getContext('2d');
    g.font = font;
    var str = String(n);
    var tw = g.measureText(str).width;
    var pad = Math.ceil(48 * kd);
    c.width = Math.ceil(tw + pad * 2);
    c.height = Math.ceil(px * kd * 1.25 + pad * 2);
    g = c.getContext('2d');
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    var col = countdownColor(n);
    // El glow se hornea una sola vez en el sprite (no hay shadowBlur por frame).
    g.shadowColor = col;
    g.shadowBlur = 36 * kd;
    g.fillStyle = col;
    g.fillText(str, c.width / 2, c.height / 2);
    g.shadowBlur = 12 * kd;
    g.fillText(str, c.width / 2, c.height / 2);
    g.shadowBlur = 0;
    c._w = c.width / kd;
    c._h = c.height / kd;
    digitSprites[n] = c;
    digitEpoch[n] = textEpoch;
    return c;
  }
  function digitReady(n) { return digitSprites[n] && digitEpoch[n] === textEpoch; }

  // Sprites de comida (5.8): disco con contorno oscuro, degradado y dígito horneado, por valor.
  // Colores de verde menta a ámbar, sin el celeste de la nieve ni del escudo. Radios en px de la
  // arena (600), fijos: no dependen del tamaño de celda, para que la comida se lea a cualquier escala.
  var FOOD_COL = ['#7CFFB2', '#B8FF5A', '#E8F24A', '#FFD447', '#FFA347'];
  var FOOD_R = [4.0, 4.4, 4.8, 5.2, 5.6];
  var FOOD_GLOW = 1.9;         // radio del glow = FOOD_GLOW × r × (1 + 0,1 × valor)
  var foodOrbs = new Array(5);
  var foodGlows = new Array(5);
  var foodKey = '';            // '' fuerza la regeneración
  var foodKS = 0, foodKK = 0, foodKE = 0, foodKA = 0;
  function ensureFoodSprites() {
    if (foodKey !== '' && foodKS === s && foodKK === K && foodKE === textEpoch && foodKA === arenaScale) return;
    foodKey = 'ok';
    foodKS = s; foodKK = K; foodKE = textEpoch; foodKA = arenaScale;
    for (var v = 0; v < 5; v++) {
      var r = FOOD_R[v];
      var showDigit = 1.15 * r * arenaScale >= 7;
      var dev = r * K;
      var rim = Math.max(1.2, 1.3 * K); // contorno oscuro: lo separa del glow y de la nieve
      var size = Math.ceil((dev + rim) * 2 + 4);
      var c = foodOrbs[v] || makeCanvas(size, size);
      c.width = size; c.height = size;
      var g = c.getContext('2d');
      var cx = size / 2;
      g.fillStyle = 'rgba(2, 19, 28, 0.85)';
      g.beginPath();
      g.arc(cx, cx, dev + rim, 0, TAU);
      g.fill();
      var rgb = parseHex(FOOD_COL[v]);
      var grad = g.createRadialGradient(cx - dev * 0.25, cx - dev * 0.25, 0, cx, cx, dev);
      grad.addColorStop(0, '#E8FBFF');
      grad.addColorStop(0.45, rgbStr(mixRgb([232, 251, 255], rgb, 0.55)));
      grad.addColorStop(1, FOOD_COL[v]);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cx, dev, 0, TAU);
      g.fill();
      if (showDigit) {
        g.fillStyle = '#02131C';
        g.font = '700 ' + (1.15 * r * K).toFixed(2) + 'px ' + FONT_UI;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(v + 1), cx, cx + 0.04 * s * K);
      }
      c._r = size / 2 / K;
      foodOrbs[v] = c;
      foodGlows[v] = Particles.glowSprite(FOOD_COL[v], FOOD_GLOW * r * 1.5 > 24);
    }
  }

  // ---------------------------------------------------------------------------
  // Fuentes
  // ---------------------------------------------------------------------------
  function bumpText() { textEpoch++; }

  function loadFonts() {
    if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) { fontsReady = true; return; }
    var settled = false;
    var timer = setTimeout(function () { if (!settled) { settled = true; bumpText(); } }, 1500);
    Promise.all([
      document.fonts.load('italic 300 100px Fraunces'),
      document.fonts.load('600 16px Recursive'),
      document.fonts.load('700 16px Recursive')
    ]).then(function () {
      fontsReady = true;
      settled = true;
      clearTimeout(timer);
      bumpText();
    }, function () {
      settled = true;
      clearTimeout(timer);
      bumpText();
    });
    try {
      document.fonts.addEventListener('loadingdone', function () { fontsReady = true; bumpText(); });
    } catch (err) { /* sin soporte: ya se regeneró arriba */ }
  }

  // ---------------------------------------------------------------------------
  // Calidad adaptativa (5.17)
  // ---------------------------------------------------------------------------
  function snowCountFor(q) {
    var n = q === 2 ? 70 : (q === 1 ? 45 : 25);
    if (coarsePointer) n = Math.round(n * 0.6);
    return n;
  }
  function particleLimitFor(q) { return q === 2 ? 600 : (q === 1 ? 400 : 200); }
  function trailLenFor(q) { return q === 0 ? 5 : 10; }

  var qualityLocked = false;
  function setQuality(q, lock) {
    if (lock !== undefined) qualityLocked = !!lock;
    q = clamp(q | 0, 0, 2);
    var dprChange = (q === 0) !== (quality === 0);
    quality = q;
    if (particles) particles.setLimit(particleLimitFor(q));
    snowActive = snowCountFor(q);
    if (dprChange && canvas) applySize(true);
  }

  function trackFrame(dt) {
    // > 1 s: pestaña oculta o la escena no dibujaba la arena; no es lentitud real
    if (dt <= 0 || dt > 1000) return;
    if (dt > 100) dt = 100;
    if (ftCount < 90) { ftCount++; } else { ftSum -= ftBuf[ftIdx]; }
    ftBuf[ftIdx] = dt;
    ftSum += dt;
    ftIdx = (ftIdx + 1) % 90;
    var t = lastNow;
    if (!qualityLocked && ftCount >= 90 && t > qualityLockUntil && quality > 0 && ftSum / ftCount > 19) {
      setQuality(quality - 1);
      qualityLockUntil = t + 5000;
      ftCount = 0; ftSum = 0; ftIdx = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Tamaño / DPR
  // ---------------------------------------------------------------------------
  function measureCss() {
    if (!canvas) return cssSize;
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    if (!w || w < 10) return cssSize;
    if (h && h >= 10) w = Math.min(w, h);
    return w;
  }

  function applySize(force) {
    if (!canvas) return;
    var css = measureCss();
    var dprRaw = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    var dprMax = quality === 0 ? 1.5 : 2;
    var d = Math.min(dprRaw, dprMax);
    var target = Math.max(64, Math.round(css * d));
    if (!force && target === canvas.width && css === cssSize && d === dprEff) return;
    cssSize = css;
    dprEff = d;
    if (canvas.width !== target) canvas.width = target;
    if (canvas.height !== target) canvas.height = target;
    K = target / W;
    arenaScale = cssSize / W;
    lastDprRaw = dprRaw;
    buildBackground();
    buildStrips();
    buildPatterns();
    foodKey = '';
    bumpText();
    // cambiar el tamaño del backing store borra el canvas: redibujar algo enseguida
    if (inited) drawRestFrame();
  }
  var lastDprRaw = 1;

  function scheduleResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { resizeTimer = 0; applySize(false); }, 120);
  }

  // ---------------------------------------------------------------------------
  // Partículas ambientales: nieve marina (5.2)
  // ---------------------------------------------------------------------------
  var SNOW_MAX = 70;
  var snowX = new Float32Array(SNOW_MAX), snowY = new Float32Array(SNOW_MAX);
  var snowZ = new Float32Array(SNOW_MAX), snowPh = new Float32Array(SNOW_MAX);
  var snowW = new Float32Array(SNOW_MAX), snowDx = new Float32Array(SNOW_MAX);
  var snowRise = new Float32Array(SNOW_MAX), snowGlow = new Float32Array(SNOW_MAX);
  var snowPaint = new Array(SNOW_MAX);
  var snowActive = 70;
  var snowSpeed = 1; // multiplicador (cámara lenta)

  function initSnow() {
    for (var i = 0; i < SNOW_MAX; i++) {
      snowX[i] = Math.random() * W;
      snowY[i] = Math.random() * H;
      snowZ[i] = 0.3 + Math.random() * 0.7;
      snowPh[i] = Math.random() * TAU;
      snowW[i] = TAU / (6000 + Math.random() * 5000); // período de 6 a 11 s
      snowDx[i] = (Math.random() * 2 - 1) * 3;
      snowRise[i] = 2 + Math.random() * 4;
      snowGlow[i] = 0;
      snowPaint[i] = null;
    }
  }

  // Cabezas (y puntero) que encienden la nieve: se llenan al preparar las serpientes.
  var HEADS_MAX = 40;
  var headX = new Float32Array(HEADS_MAX), headY = new Float32Array(HEADS_MAX);
  var headR2 = new Float32Array(HEADS_MAX);
  var headPaint = new Array(HEADS_MAX);
  var headCount = 0;

  function pushHead(x, y, radius, paint) {
    if (headCount >= HEADS_MAX) return;
    headX[headCount] = x;
    headY[headCount] = y;
    headR2[headCount] = radius * radius;
    headPaint[headCount] = paint;
    headCount++;
  }

  function updateSnow(dtMs) {
    var dt = dtMs / 1000 * snowSpeed;
    var decay = dtMs / 900;
    for (var i = 0; i < snowActive; i++) {
      var x = snowX[i] + snowDx[i] * dt;
      var y = snowY[i] - snowRise[i] * snowZ[i] * dt;
      if (y < -6) { y = H + 6; x = Math.random() * W; }
      if (x < -6) x += W + 12; else if (x > W + 6) x -= W + 12;
      snowX[i] = x;
      snowY[i] = y;
      var g = snowGlow[i] - decay;
      if (g < 0) g = 0;
      // estela de dinoflagelados
      var sx = x + 4 * Math.sin(animT * snowW[i] + snowPh[i]);
      for (var h = 0; h < headCount; h++) {
        var dx = sx - headX[h], dy = y - headY[h];
        if (dx * dx + dy * dy < headR2[h]) { g = 1; snowPaint[i] = headPaint[h]; break; }
      }
      snowGlow[i] = g;
    }
  }

  // En partida (`inGame`) la nieve queda más chica y tenue: es fondo, no tiene que competir con la
  // comida ni con el escudo.
  function drawSnow(inGame) {
    var c = ctx;
    var sizeK = inGame ? 0.7 : 1, alphaK = inGame ? 0.55 : 1;
    c.globalCompositeOperation = 'lighter';
    for (var i = 0; i < snowActive; i++) {
      var z = snowZ[i];
      var x = snowX[i] + 4 * Math.sin(animT * snowW[i] + snowPh[i]);
      var y = snowY[i];
      var size = (0.6 + (z - 0.3) / 0.7 * 1.2) * sizeK;
      var a = (0.08 + (z - 0.3) / 0.7 * 0.27) * alphaK;
      var g = snowGlow[i];
      var R = size * 2.6;
      c.globalAlpha = a * (1 - g * 0.5);
      c.drawImage(snowSprite, x - R, y - R, R + R, R + R);
      if (g > 0.02 && snowPaint[i]) {
        var R2 = size * 6;
        c.globalAlpha = 0.8 * g;
        c.drawImage(snowPaint[i].glowBody, x - R2, y - R2, R2 + R2, R2 + R2);
        c.globalAlpha = 0.6 * g;
        c.drawImage(snowPaint[i].glowCore, x - R, y - R, R + R, R + R);
      }
    }
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Cáusticas, viñeta, membrana
  // ---------------------------------------------------------------------------
  var tensionLevel = 0;      // suavizado
  var tensionBumpT0 = -1e9;
  var countFade = 1;         // fundido de contador y tensión en el congelamiento

  function drawCausticLayer(pat, scale, ox, oy, alpha) {
    if (alpha <= 0.001 || !pat) return;
    if (patMatrix && pat.setTransform) {
      patMatrix.a = scale; patMatrix.b = 0; patMatrix.c = 0; patMatrix.d = scale;
      patMatrix.e = ox; patMatrix.f = oy;
      pat.setTransform(patMatrix);
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
  }

  function drawCaustics(dtMs, alphaMul) {
    if (quality === 0 || highContrast) return;
    var drift = (dtMs / 1000) * snowSpeed * (1 + 0.6 * tensionLevel);
    causticOff[0] = (causticOff[0] + 6 * drift) % (256 * 2.4);
    causticOff[1] = (causticOff[1] + 3 * drift) % (256 * 2.4);
    causticOff[2] = (causticOff[2] - 4 * drift) % (256 * 3.4);
    causticOff[3] = (causticOff[3] + 5 * drift) % (256 * 3.4);
    ctx.globalCompositeOperation = 'lighter';
    var coral = 0.6 * tensionLevel * countFade;
    drawCausticLayer(patCyan, 2.4, causticOff[0], causticOff[1], 0.055 * alphaMul * (1 - coral));
    if (coral > 0.01) drawCausticLayer(patCoral, 2.4, causticOff[0], causticOff[1], 0.055 * alphaMul * coral);
    if (quality === 2) {
      drawCausticLayer(patCyan, 3.4, causticOff[2], causticOff[3], 0.035 * alphaMul * (1 - coral));
      if (coral > 0.01) drawCausticLayer(patCoral, 3.4, causticOff[2], causticOff[3], 0.035 * alphaMul * coral);
    }
    ctx.globalAlpha = 1;
  }

  function drawMembrane(now) {
    var a = reducedMotion ? 0.10 : 0.10 + 0.02 * Math.sin(now * TAU / 6400);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a;
    ctx.drawImage(stripTop, 0, 0, W, 14);
    ctx.drawImage(stripBottom, 0, H - 14, W, 14);
    ctx.drawImage(stripLeft, 0, 0, 14, H);
    ctx.drawImage(stripRight, W - 14, 0, 14, H);
    ctx.globalAlpha = 1;
  }

  function drawVignette(now) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(vignetteDark, 0, 0, W, H);
    var bump = now - tensionBumpT0 < 400 ? 0.25 * (1 - (now - tensionBumpT0) / 400) : 0;
    if (tensionLevel <= 0.001) bump = 0;
    var ta = (tensionLevel + bump) * countFade;
    if (ta > 0.003) {
      ctx.globalAlpha = Math.min(1, ta);
      ctx.drawImage(vignetteCoral, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Sacudida y límite de destellos (5.12)
  // ---------------------------------------------------------------------------
  var shakeI = new Float32Array(4), shakeT0 = new Float64Array(4), shakeDur = new Float32Array(4);
  var shakeX = 0, shakeY = 0;

  function shake(intensity, ms) {
    if (reducedMotion) return;
    var I = +intensity || 0, d = +ms || 0;
    if (I <= 0 || d <= 0) return;
    var now = nowMs();
    var slot = 0, minRem = 1e9;
    for (var i = 0; i < 4; i++) {
      var t = (now - shakeT0[i]) / (shakeDur[i] || 1);
      var rem = t >= 1 ? 0 : shakeI[i] * (1 - t) * (1 - t);
      if (rem < minRem) { minRem = rem; slot = i; }
    }
    shakeI[slot] = I;
    shakeT0[slot] = now;
    shakeDur[slot] = d;
  }

  function computeShake(now) {
    var best = 0;
    for (var i = 0; i < 4; i++) {
      if (shakeI[i] <= 0) continue;
      var t = (now - shakeT0[i]) / shakeDur[i];
      if (t >= 1 || t < 0) { if (t >= 1) shakeI[i] = 0; continue; }
      var k = (1 - t) * (1 - t);
      var rem = shakeI[i] * k;
      if (rem > best) best = rem;
    }
    if (reducedMotion) best = 0;
    shakeX = best * Math.sin(now * 0.071);
    shakeY = best * Math.cos(now * 0.053);
  }

  var flashTimes = new Float64Array(3);
  var flashIdx = 0;
  function allowFlash(now) {
    var oldest = flashTimes[flashIdx];
    if (oldest !== 0 && now - oldest < 1000) return false;
    flashTimes[flashIdx] = now;
    flashIdx = (flashIdx + 1) % 3;
    return true;
  }
  function flashAlpha(a) { return Math.min(a, reducedMotion ? 0.25 : 0.7); }

  // ---------------------------------------------------------------------------
  // Pool de efectos de la arena
  // ---------------------------------------------------------------------------
  var FX_RING = 1, FX_FLASH = 2, FX_WAVE = 3, FX_COLUMN = 4, FX_FOUNTAIN = 5,
      FX_EDGE = 6, FX_PWAVE = 7, FX_DROP = 8, FX_TEXT = 9;
  var FX_MAX = 112;
  var fxPool = [];
  for (var fi = 0; fi < FX_MAX; fi++) {
    fxPool.push({
      on: false, type: 0, t0: 0, dur: 0, x: 0, y: 0, r0: 0, r1: 0, lw: 1, a: 1,
      color: '#FFFFFF', sprite: null, id: null, edge: 0, vx: 0, vy: 0, n: 0, paint: null, s: 20, rise: 0
    });
  }
  var fxCursor = 0;

  function fxSpawn(type, t0, dur) {
    var f = null;
    for (var i = 0; i < FX_MAX; i++) {
      var j = (fxCursor + i) % FX_MAX;
      if (!fxPool[j].on) { f = fxPool[j]; fxCursor = (j + 1) % FX_MAX; break; }
    }
    if (!f) {
      // lleno: reemplaza el más viejo
      var oldest = 0, ot = 1e18;
      for (var k = 0; k < FX_MAX; k++) if (fxPool[k].t0 < ot) { ot = fxPool[k].t0; oldest = k; }
      f = fxPool[oldest];
      if (f.type === FX_TEXT) releaseTextCanvas(f.sprite);
    }
    f.on = true; f.type = type; f.t0 = t0; f.dur = dur;
    f.x = 0; f.y = 0; f.r0 = 0; f.r1 = 0; f.lw = 1.5; f.a = 1; f.color = '#E8FBFF';
    f.sprite = null; f.id = null; f.edge = 0; f.vx = 0; f.vy = 0; f.n = 0; f.paint = null; f.s = s; f.rise = 0;
    return f;
  }

  function fxRing(x, y, r0, r1, dur, color, alpha, lw, delay) {
    var f = fxSpawn(FX_RING, nowMs() + (delay || 0), dur);
    f.x = x; f.y = y; f.r0 = r0; f.r1 = r1; f.color = color; f.a = alpha; f.lw = lw || 1.5;
    return f;
  }

  function fxFlash(x, y, radius, alpha, dur) {
    var now = nowMs();
    if (!allowFlash(now)) return;
    var f = fxSpawn(FX_FLASH, now, dur);
    f.x = x; f.y = y; f.r0 = radius; f.a = flashAlpha(alpha);
  }

  function fxText(x, y, str, color, px, rise, dur) {
    var f = fxSpawn(FX_TEXT, nowMs(), dur || 700);
    f.x = x; f.y = y; f.rise = rise === undefined ? 18 : rise;
    f.sprite = textSprite(takeTextCanvas(), str, fontUi(700, 12), px, color, 'rgba(2,10,18,0.85)', 3);
    return f;
  }

  function fxEdge(edge, pos, paint, dur, alpha) {
    var f = fxSpawn(FX_EDGE, nowMs(), dur || 600);
    f.edge = edge; f.x = pos; f.paint = paint; f.a = alpha === undefined ? 1 : alpha;
  }

  function edgeOf(x, y) {
    // borde más cercano a un punto: 0 arriba, 1 derecha, 2 abajo, 3 izquierda
    var dTop = y, dRight = W - x, dBottom = H - y, dLeft = x;
    var m = Math.min(dTop, dRight, dBottom, dLeft);
    if (m === dTop) return 0;
    if (m === dRight) return 1;
    if (m === dBottom) return 2;
    return 3;
  }

  function updateFx(now) {
    for (var i = 0; i < FX_MAX; i++) {
      var f = fxPool[i];
      if (!f.on) continue;
      var el = now - f.t0;
      if (el > f.dur) {
        if (f.type === FX_TEXT) releaseTextCanvas(f.sprite);
        f.on = false;
        continue;
      }
      if (f.type === FX_FOUNTAIN && el >= 0) {
        // fuente de plancton del ganador: 80 partículas repartidas en 1200 ms
        var total = scaleCount(80);
        var want = Math.min(total, Math.floor(total * el / 1200));
        var rec = snakeRecs.get(f.id);
        if (rec && rec.n > 0) {
          var hx = rec.x[0], hy = rec.y[0];
          while (f.n < want) {
            var p = f.n & 1 ? rec.paint.core : rec.paint.body;
            setBurst(1, p, 40, 140, 900, 1600, 1.2, 2.6, 'dot', -20, 0.97);
            BO.angle = -Math.PI / 2;
            BO.spread = 1.2;
            particles.burst(hx, hy, BO);
            f.n++;
          }
        } else {
          f.n = want;
        }
      }
    }
  }

  // Capas: 0 detrás de lo jugable (columna), 1 encima (anillos, destellos), 2 textos, 3 bordes
  function drawFxLayer(layer, now) {
    var c = ctx;
    for (var i = 0; i < FX_MAX; i++) {
      var f = fxPool[i];
      if (!f.on) continue;
      var el = now - f.t0;
      if (el < 0) continue;
      var t = el / f.dur;
      if (t > 1) continue;
      var type = f.type;
      if (layer === 0) {
        if (type !== FX_COLUMN) continue;
        var rec = snakeRecs.get(f.id);
        if (!rec || rec.n === 0) continue;
        var cx = rec.x[0];
        var ca = 0.35 * smoothstep(0, 500, el) * (1 - smoothstep(f.dur - 400, f.dur, el));
        var cw = 6 * f.s;
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = ca;
        drawColumn(cx, rec.y[0], cw, rec.paint);
      } else if (layer === 1) {
        if (type === FX_RING) {
          var rr = f.r0 + (f.r1 - f.r0) * easeOutCubic(t);
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = f.a * (1 - t);
          c.strokeStyle = f.color;
          c.lineWidth = f.lw;
          c.beginPath();
          c.arc(f.x, f.y, rr, 0, TAU);
          c.stroke();
        } else if (type === FX_FLASH) {
          var fr = f.r0;
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = f.a * (1 - t);
          c.drawImage(pearlBig, f.x - fr, f.y - fr, fr * 2, fr * 2);
        } else if (type === FX_WAVE) {
          var wr = 450 * easeOutExpo(t);
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = 0.25 * (1 - t * t);
          c.strokeStyle = '#1FF2D2';
          c.lineWidth = 40 + (2 - 40) * t;
          c.beginPath();
          c.arc(W / 2, H / 2, Math.max(0.5, wr), 0, TAU);
          c.stroke();
          c.globalAlpha = 0.18 * (1 - t);
          c.lineWidth = 2;
          c.strokeStyle = '#E8FBFF';
          c.beginPath();
          c.arc(W / 2, H / 2, Math.max(0.5, wr), 0, TAU);
          c.stroke();
        } else if (type === FX_DROP) {
          var dy = f.y + 14 * easeOutCubic(t);
          var dr = f.r0 * (1 - 0.4 * t);
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = 0.9 * (1 - t);
          var spr = f.paint ? f.paint.glowCore : pearlSprite;
          c.drawImage(spr, f.x - dr * 2.4, dy - dr * 2.4, dr * 4.8, dr * 4.8);
          if (f.paint) {
            c.globalAlpha = 0.6 * (1 - t);
            c.drawImage(f.paint.glowBody, f.x - dr * 4, dy - dr * 4, dr * 8, dr * 8);
          }
        }
      } else if (layer === 2) {
        if (type !== FX_TEXT || !f.sprite) continue;
        var ty = f.y - f.rise * easeOutCubic(t);
        var ta = t < 0.15 ? t / 0.15 : 1 - smoothstep(0.55, 1, t);
        c.globalCompositeOperation = 'source-over';
        c.globalAlpha = ta;
        var tw = f.sprite._w, th = f.sprite._h;
        var tx = clamp(f.x, tw / 2, W - tw / 2);
        c.drawImage(f.sprite, tx - tw / 2, ty - th / 2, tw, th);
      } else if (layer === 3) {
        if (type === FX_EDGE) {
          var ea = f.a * (1 - easeOutCubic(t)) * 0.9;
          var half = 3 * f.s;
          var spr2 = f.paint ? f.paint.glowBodyBig : turquoiseSprite;
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = ea;
          if (f.edge === 0) c.drawImage(spr2, f.x - half, -14, half * 2, 28);
          else if (f.edge === 2) c.drawImage(spr2, f.x - half, H - 14, half * 2, 28);
          else if (f.edge === 3) c.drawImage(spr2, -14, f.x - half, 28, half * 2);
          else c.drawImage(spr2, W - 14, f.x - half, 28, half * 2);
        } else if (type === FX_PWAVE) {
          var pe = easeOutExpo(t);
          var along = 1.6 * f.s * (0.35 + 0.65 * pe);
          var inward = 0.5 * f.s * (0.35 + 0.65 * pe) + 1;
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = 0.6 * (1 - t);
          c.strokeStyle = f.paint ? f.paint.body : '#1FF2D2';
          c.lineWidth = 2;
          c.beginPath();
          if (f.edge === 0 || f.edge === 2) c.ellipse(f.x, f.y, along, inward, 0, 0, TAU);
          else c.ellipse(f.x, f.y, inward, along, 0, 0, TAU);
          c.stroke();
          c.globalAlpha = 0.3 * (1 - t);
          var gs = f.paint ? f.paint.glowBody : turquoiseSprite;
          c.drawImage(gs, f.x - along, f.y - along, along * 2, along * 2);
        }
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  // Columna de luz del ganador: degradado vertical cacheado
  var columnSprite = null;
  function drawColumn(cx, headYv, width, paint) {
    if (!columnSprite) {
      columnSprite = makeCanvas(64, 256);
      var g = columnSprite.getContext('2d');
      var lg = g.createLinearGradient(0, 0, 0, 256);
      lg.addColorStop(0, 'rgba(232,251,255,0)');
      lg.addColorStop(0.55, 'rgba(232,251,255,0.55)');
      lg.addColorStop(0.92, 'rgba(232,251,255,1)');
      lg.addColorStop(1, 'rgba(232,251,255,0)');
      g.fillStyle = lg;
      g.fillRect(0, 0, 64, 256);
      // bordes horizontales suaves
      g.globalCompositeOperation = 'destination-in';
      var hg = g.createLinearGradient(0, 0, 64, 0);
      hg.addColorStop(0, 'rgba(0,0,0,0)');
      hg.addColorStop(0.5, 'rgba(0,0,0,1)');
      hg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = hg;
      g.fillRect(0, 0, 64, 256);
    }
    var bottom = headYv + 0.6 * s;
    var a = ctx.globalAlpha;
    // velo del color del ganador detrás de la columna perla
    ctx.globalAlpha = a * 0.55;
    ctx.drawImage(paint.glowBodyBig, cx - width * 0.9, -bottom * 0.15, width * 1.8, bottom * 1.3);
    ctx.globalAlpha = a;
    ctx.drawImage(columnSprite, cx - width / 2, -10, width, bottom + 10);
    ctx.globalAlpha = a * 0.8;
    ctx.drawImage(paint.glowBodyBig, cx - width, bottom - width, width * 2, width * 2);
    ctx.globalAlpha = a;
  }

  // ---------------------------------------------------------------------------
  // Opciones de ráfaga reutilizables (sin allocations por llamada)
  // ---------------------------------------------------------------------------
  var BO = { count: 0, color: '', speed: [0, 0], life: [0, 0], size: [0, 0], endSize: undefined,
             shape: 'dot', gravity: 0, drag: 0.9, angle: 0, spread: TAU, alpha: 1, glow: true, lineWidth: 1.5 };

  function scaleCount(n) { return reducedMotion ? Math.max(1, Math.round(n * 0.5)) : n; }

  function setBurst(count, color, sp0, sp1, l0, l1, z0, z1, shape, gravity, drag) {
    var f = s / 20;
    BO.count = count;
    BO.color = color;
    BO.speed[0] = sp0; BO.speed[1] = sp1;
    BO.life[0] = l0; BO.life[1] = l1;
    BO.size[0] = z0 * f; BO.size[1] = z1 * f;
    BO.endSize = undefined;
    BO.shape = shape;
    BO.gravity = gravity;
    BO.drag = drag;
    BO.angle = 0;
    BO.spread = TAU;
    BO.alpha = 1;
    BO.glow = true;
    BO.lineWidth = 1.5;
    return BO;
  }

  function burstNow(x, y) { if (particles && BO.count > 0) particles.burst(x, y, BO); }

  // ---------------------------------------------------------------------------
  // Registros por serpiente (buffers persistentes por id)
  // ---------------------------------------------------------------------------
  var snakeRecs = new Map();
  var MAX_RUNS = 32;

  function SnakeRec(id) {
    this.id = id;
    this.cap = 0;
    this.n = 0;
    this.rx = null; this.ry = null; this.x = null; this.y = null; this.nx = null; this.ny = null;
    this.runs = new Int32Array(MAX_RUNS * 2);
    this.runCount = 0;
    this.paint = null;
    this.colorKey = null;
    this.dirX = 1; this.dirY = 0;
    this.bulge = new Float64Array(3);
    this.bulgeN = 0;
    this.recoilT0 = -1e9;
    this.inflateT0 = -1e9;
    this.popT0 = -1e9;
    this.immune = false;
    this.immuneEnd = 0;
    this.label = null;
    this.labelKey = '';
    this.labelColor = '';
    this.labelEpoch = 0;
    this.seen = 0;
    this.lastSeenT = 0;
    this.alphaVis = 1;
    this.filament = 1;
    this.isMe = false;
    this.s = 20;
    this.name = '';
    this.anon = false;
    this.labelScale = 1;
    this.winner = false;
  }

  function ensureCap(rec, n) {
    if (rec.cap >= n) return;
    var cap = 64;
    while (cap < n) cap *= 2;
    rec.cap = cap;
    rec.rx = new Float32Array(cap); rec.ry = new Float32Array(cap);
    rec.x = new Float32Array(cap); rec.y = new Float32Array(cap);
    rec.nx = new Float32Array(cap); rec.ny = new Float32Array(cap);
  }

  function getRec(id) {
    var r = snakeRecs.get(id);
    if (!r) { r = new SnakeRec(id); snakeRecs.set(id, r); }
    return r;
  }

  // Radio del cuerpo r(t) = s * (0,46 - 0,22 * t^1,4), tabulado
  var RLUT = new Float32Array(64);
  for (var ri = 0; ri < 64; ri++) RLUT[ri] = 0.46 - 0.22 * Math.pow(ri / 63, 1.4);
  function radAt(t, ss) { return ss * RLUT[(t * 63 + 0.5) | 0]; }

  // Cortes en portales (5.5): un tramo nuevo cuando dos puntos consecutivos saltan > media arena
  function computeRuns(rec) {
    var n = rec.n, rx = rec.rx, ry = rec.ry, runs = rec.runs;
    var rc = 0;
    runs[0] = 0;
    for (var i = 0; i < n - 1; i++) {
      var dx = rx[i + 1] - rx[i], dy = ry[i + 1] - ry[i];
      if (dx > HALF_W || dx < -HALF_W || dy > HALF_H || dy < -HALF_H) {
        runs[rc * 2 + 1] = i;
        rc++;
        if (rc >= MAX_RUNS) { rec.n = i + 1; rec.runCount = rc; return; }
        runs[rc * 2] = i + 1;
      }
    }
    runs[rc * 2 + 1] = n - 1;
    rec.runCount = rc + 1;
  }

  // Normales por tramo y ondulación (5.4)
  function computeShape(rec, ss, wave) {
    var n = rec.n, rx = rec.rx, ry = rec.ry, x = rec.x, y = rec.y, nx = rec.nx, ny = rec.ny;
    var inv = 1 / Math.max(n - 1, 1);
    var amp = ss * 0.09;
    for (var r = 0; r < rec.runCount; r++) {
      var a = rec.runs[r * 2], b = rec.runs[r * 2 + 1];
      for (var i = a; i <= b; i++) {
        var p = i > a ? i - 1 : i;
        var q = i < b ? i + 1 : i;
        var tx = rx[p] - rx[q], ty = ry[p] - ry[q];
        var len = Math.sqrt(tx * tx + ty * ty);
        if (len < 1e-3) { tx = rec.dirX; ty = rec.dirY; len = 1; }
        tx /= len; ty /= len;
        nx[i] = -ty; ny[i] = tx;
        if (wave && i > 0) {
          var t = i * inv;
          var A = amp * smoothstep(0, 0.25, t);
          var off = A * Math.sin(animT * 0.006 - i * 0.9);
          x[i] = rx[i] + nx[i] * off;
          y[i] = ry[i] + ny[i] * off;
        } else {
          x[i] = rx[i];
          y[i] = ry[i];
        }
      }
    }
  }

  function computeDir(rec, fallbackX, fallbackY, ss) {
    var dx = 0, dy = 0, ok = false;
    if (rec.n >= 2 && rec.runs[1] >= 1) {
      dx = rec.rx[0] - rec.rx[1];
      dy = rec.ry[0] - rec.ry[1];
      var l = Math.sqrt(dx * dx + dy * dy);
      if (l > 0.2 * ss) { dx /= l; dy /= l; ok = true; }
    }
    if (!ok) {
      dx = fallbackX; dy = fallbackY;
      var l2 = Math.sqrt(dx * dx + dy * dy);
      if (l2 > 0) { dx /= l2; dy /= l2; ok = true; }
    }
    if (ok) { rec.dirX = dx; rec.dirY = dy; }
  }

  // ---------------------------------------------------------------------------
  // Trazos del cuerpo: curva suave por puntos medios (cuadráticas), por tramo
  // ---------------------------------------------------------------------------
  // Pieza q (relativa al tramo a..b, m = b - a): 0 = línea Q0->M01; 0<q<m = cuadrática
  // con control Qq hasta M(q,q+1); q = m = línea hasta Qm.
  function pathRange(c, X, Y, a, b, q0, q1) {
    var m = b - a;
    var i0 = a + q0;
    if (q0 === 0) c.moveTo(X[a], Y[a]);
    else c.moveTo((X[i0 - 1] + X[i0]) * 0.5, (Y[i0 - 1] + Y[i0]) * 0.5);
    for (var q = q0; q <= q1; q++) {
      var i = a + q;
      if (q === 0) {
        if (m === 0) { c.lineTo(X[a] + 0.01, Y[a]); }
        else c.lineTo((X[i] + X[i + 1]) * 0.5, (Y[i] + Y[i + 1]) * 0.5);
      } else if (q < m) {
        c.quadraticCurveTo(X[i], Y[i], (X[i] + X[i + 1]) * 0.5, (Y[i] + Y[i + 1]) * 0.5);
      } else {
        c.lineTo(X[i], Y[i]);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pasadas de dibujo de una criatura (5.4)
  // ---------------------------------------------------------------------------
  var haloBoostT0 = -1e9;

  function haloBoost(now) {
    var el = now - haloBoostT0;
    if (el < 0 || el > 600) return 1;
    return 1 + 0.6 * (1 - easeInOutSine(el / 600));
  }

  function passHalo(rec, ss, now) {
    var c = ctx, p = rec.paint, n = rec.n;
    if (n === 0) return;
    var inv = 1 / Math.max(n - 1, 1);
    // Q2: cada punto; Q1: cada 2 (alpha x1,5); Q0: cada 3 (alpha x1,9), para el raster por software
    var step = quality === 2 ? 1 : (quality === 1 ? 2 : 3);
    var mul = (step === 1 ? 1 : (step === 2 ? 1.5 : 1.9)) * (rec.isMe ? 1.25 : 1) * haloBoost(now) * rec.alphaVis;
    var big = 3.2 * ss * 0.46 > 24;
    var spr = big ? p.glowBodyBig : p.glowBody;
    var X = rec.x, Y = rec.y;
    for (var r = 0; r < rec.runCount; r++) {
      var a = rec.runs[r * 2], b = rec.runs[r * 2 + 1];
      for (var i = a; i <= b; i += step) {
        var t = i * inv;
        var R = 3.2 * radAt(t, ss);
        var al = 0.22 * (1 - 0.6 * t) * mul;
        c.globalAlpha = al > 1 ? 1 : al;
        c.drawImage(spr, X[i] - R, Y[i] - R, R + R, R + R);
      }
      // extremos de tramo que tocan un borde: la criatura atraviesa la membrana
      if (rec.runCount > 1) {
        if (r > 0) borderGlow(rec, a, a - 1, ss);
        if (r < rec.runCount - 1) borderGlow(rec, b, b + 1, ss);
      }
    }
  }

  function borderGlow(rec, i, j, ss) {
    var X = rec.rx, Y = rec.ry;
    var dx = X[j] - X[i], dy = Y[j] - Y[i];
    var bx = X[i], by = Y[i];
    if (dx > HALF_W || dx < -HALF_W) bx = X[i] < HALF_W ? 0 : W;
    else by = Y[i] < HALF_H ? 0 : H;
    var R = 1.8 * ss;
    ctx.globalAlpha = 0.35 * rec.alphaVis;
    ctx.drawImage(rec.paint.glowBodyBig, bx - R, by - R, R + R, R + R);
  }

  // Extremo de tramo cortado por un portal: punto sobre el borde (un poco afuera) en EXT.
  var EXT = new Float32Array(2);
  function edgeExt(rec, i, j) {
    var dx = rec.rx[j] - rec.rx[i];
    if (dx > HALF_W || dx < -HALF_W) {
      EXT[0] = rec.rx[i] < HALF_W ? -2 : W + 2;
      EXT[1] = rec.y[i];
    } else {
      EXT[0] = rec.x[i];
      EXT[1] = rec.ry[i] < HALF_H ? -2 : H + 2;
    }
  }

  // Prolonga hasta el borde los extremos de tramo cortados, con el ancho y estilo actuales.
  function strokeCutEnds(rec, r, a, b) {
    var c = ctx;
    if (rec.runCount < 2) return;
    if (r > 0) {
      edgeExt(rec, a, a - 1);
      c.beginPath();
      c.moveTo(EXT[0], EXT[1]);
      c.lineTo(rec.x[a], rec.y[a]);
      c.stroke();
    }
    if (r < rec.runCount - 1) {
      edgeExt(rec, b, b + 1);
      c.beginPath();
      c.moveTo(rec.x[b], rec.y[b]);
      c.lineTo(EXT[0], EXT[1]);
      c.stroke();
    }
  }

  function strokeCutEnds1(rec, i, j, atStart) {
    var c = ctx;
    edgeExt(rec, i, j);
    c.beginPath();
    if (atStart) { c.moveTo(EXT[0], EXT[1]); c.lineTo(rec.x[i], rec.y[i]); }
    else { c.moveTo(rec.x[i], rec.y[i]); c.lineTo(EXT[0], EXT[1]); }
    c.stroke();
  }

  function passImmunityMembrane(rec, ss, now) {
    if (!rec.immune || rec.n === 0) return;
    var c = ctx;
    var beat = Math.sin(now * 0.001 * 1.6 * TAU);
    c.strokeStyle = '#9FF4FF';
    c.globalAlpha = (0.10 + 0.05 * beat) * rec.alphaVis * bellBlink(rec);
    c.lineWidth = 2 * radAt(0, ss) + 0.5 * ss;
    for (var r = 0; r < rec.runCount; r++) {
      var a = rec.runs[r * 2], b = rec.runs[r * 2 + 1];
      c.beginPath();
      pathRange(c, rec.x, rec.y, a, b, 0, b - a);
      c.stroke();
      strokeCutEnds(rec, r, a, b);
    }
  }

  // Cuerpo: tramos troceados con extremos 'butt'. La curva por puntos medios es C1 en cada
  // unión de piezas, así que los trozos empalman sin huecos ni solapes (sin cuentas en las
  // uniones aunque cambie el color). Dos capas: membrana (rampa clara) e interior (oscura).
  function passBody(rec, ss) {
    var c = ctx, n = rec.n;
    if (n === 0) return;
    var level = dimLevel(rec.alphaVis);
    var ramp = rampFor(rec.paint, level);
    var inner = rec.paint.inners[level];
    var midR = rec.paint.mids[level];
    var inv = 1 / Math.max(n - 1, 1);
    var chunk = n > 48 ? Math.ceil(n / 24) : (n > 24 ? 2 : 1);
    var rim = Math.max(0.9, 0.075 * ss);
    var X = rec.x, Y = rec.y;
    for (var layer = 0; layer < 3; layer++) {
      var R = layer === 0 ? ramp : (layer === 1 ? midR : inner);
      var sub = layer === 0 ? 0 : (layer === 1 ? rim * 2 : rim * 4.5);
      for (var r = 0; r < rec.runCount; r++) {
        var a = rec.runs[r * 2], b = rec.runs[r * 2 + 1];
        var m = b - a;
        if (m === 0) {
          if (a === 0) continue; // la cabeza la dibuja passHead
          var t0 = a * inv;
          c.fillStyle = R[(t0 * 31 + 0.5) | 0];
          c.beginPath();
          c.arc(X[a], Y[a], Math.max(0.5, radAt(t0, ss) - sub * 0.5), 0, TAU);
          c.fill();
          continue;
        }
        if (rec.runCount > 1) {
          c.lineCap = 'butt';
          if (r > 0) {
            c.lineWidth = Math.max(0.6, 2 * radAt(a * inv, ss) - sub);
            c.strokeStyle = R[(a * inv * 31 + 0.5) | 0];
            edgeExt(rec, a, a - 1);
            c.beginPath(); c.moveTo(EXT[0], EXT[1]); c.lineTo(X[a], Y[a]); c.stroke();
          }
          if (r < rec.runCount - 1) {
            c.lineWidth = Math.max(0.6, 2 * radAt(b * inv, ss) - sub);
            c.strokeStyle = R[(b * inv * 31 + 0.5) | 0];
            edgeExt(rec, b, b + 1);
            c.beginPath(); c.moveTo(X[b], Y[b]); c.lineTo(EXT[0], EXT[1]); c.stroke();
          }
        }
        var q = 0;
        while (q <= m) {
          var q1 = q + chunk - 1;
          if (q1 > m) q1 = m;
          var tm = (a + (q + q1) * 0.5) * inv;
          c.lineCap = q1 === m ? 'round' : 'butt';
          c.lineWidth = Math.max(0.6, 2 * radAt(tm, ss) - sub);
          c.strokeStyle = R[(tm * 31 + 0.5) | 0];
          c.beginPath();
          pathRange(c, X, Y, a, b, q, q1);
          if (q1 < m) {
            // solape mínimo sobre el trozo siguiente: evita la costura del antialias
            var ie = a + q1;
            var ux = X[ie + 1] - X[ie], uy = Y[ie + 1] - Y[ie];
            var ul = Math.sqrt(ux * ux + uy * uy) || 1;
            c.lineTo((X[ie] + X[ie + 1]) * 0.5 + ux / ul * 0.7, (Y[ie] + Y[ie + 1]) * 0.5 + uy / ul * 0.7);
          }
          c.stroke();
          q = q1 + 1;
        }
      }
    }
    c.lineCap = 'round';
  }

  // Filamento interno: línea de luz que se afina y apaga hacia la cola, por grupos de
  // piezas con extremos 'butt' (empalmes C1: sin puntos más brillantes en modo aditivo).
  function passFilament(rec, ss) {
    var c = ctx, n = rec.n;
    if (n < 2 || rec.filament <= 0.01) return;
    var X = rec.x, Y = rec.y;
    var inv = 1 / Math.max(n - 1, 1);
    var g = n > 48 ? 3 : (n > 24 ? 2 : 1);
    var am = rec.filament * rec.alphaVis;
    c.strokeStyle = rec.paint.core;
    c.lineCap = 'butt';
    for (var r = 0; r < rec.runCount; r++) {
      var a = rec.runs[r * 2], b = rec.runs[r * 2 + 1];
      var m = b - a;
      if (m === 0) continue;
      for (var q = 0; q <= m; q += g) {
        var q1 = q + g - 1;
        if (q1 > m) q1 = m;
        var t = (a + (q + q1) * 0.5) * inv;
        c.lineWidth = Math.max(0.6, ss * (0.13 - 0.08 * t));
        c.globalAlpha = (0.55 - 0.45 * t) * am;
        c.beginPath();
        pathRange(c, X, Y, a, b, q, q1);
        c.stroke();
        if (q === 0 && r > 0) strokeCutEnds1(rec, a, a - 1, true);
        if (q1 === m && r < rec.runCount - 1) strokeCutEnds1(rec, b, b + 1, false);
      }
    }
    c.lineCap = 'round';
  }

  function passPhotophores(rec, ss, now) {
    var c = ctx, n = rec.n, p = rec.paint;
    if (n < 2) return;
    var inv = 1 / Math.max(n - 1, 1);
    var spr = p.glowCore;
    var dotR = Math.max(1, 0.09 * ss);
    var R = dotR * 3.2;
    var X = rec.x, Y = rec.y, NX = rec.nx, NY = rec.ny;
    var pattern = p.slot % 4;
    var sp = ss < 12 ? 2 : 1;
    var period = pattern === 0 ? 3 * sp : (pattern === 3 ? 5 * sp : 2 * sp);
    var phase0 = pattern === 3 ? 2 : 1;
    var av = rec.alphaVis;
    for (var i = phase0; i < n; i += period) {
      var t = i * inv;
      var rr = radAt(t, ss);
      var tw = 0.5 + 0.5 * Math.sin(animT * 0.004 + i * 1.7);
      c.globalAlpha = tw * av;
      var x = X[i], y = Y[i];
      if (pattern === 0) {
        var ox = NX[i] * 0.6 * rr, oy = NY[i] * 0.6 * rr;
        c.drawImage(spr, x + ox - R, y + oy - R, R + R, R + R);
        c.drawImage(spr, x - ox - R, y - oy - R, R + R, R + R);
      } else if (pattern === 1) {
        c.drawImage(spr, x - R, y - R, R + R, R + R);
      } else if (pattern === 2) {
        var side = ((i / period) | 0) & 1 ? 0.6 : -0.6;
        c.drawImage(spr, x + NX[i] * side * rr - R, y + NY[i] * side * rr - R, R + R, R + R);
      } else {
        // tres puntos en línea a lo largo del cuerpo
        var tx = NY[i] * 0.3 * ss, ty = -NX[i] * 0.3 * ss;
        c.drawImage(spr, x - R, y - R, R + R, R + R);
        c.drawImage(spr, x + tx - R, y + ty - R, R + R, R + R);
        c.drawImage(spr, x - tx - R, y - ty - R, R + R, R + R);
      }
    }
    // pulsos de luz que fluyen de la cabeza a la cola (vida en reposo, muy tenues)
    if (n > 4) {
      var gap = 7;
      var head0 = (animT * 0.008) % gap;
      for (var pp = head0; pp < n - 1; pp += gap) {
        var j0 = pp | 0, jf = pp - j0;
        var jx = X[j0 + 1] - X[j0], jy = Y[j0 + 1] - Y[j0];
        if (jx > HALF_W || jx < -HALF_W || jy > HALF_H || jy < -HALF_H) continue;
        var pt = pp * inv;
        var prr = radAt(pt, ss) * 1.6;
        c.globalAlpha = 0.32 * (1 - pt) * av * rec.filament;
        c.drawImage(p.glowCore, X[j0] + jx * jf - prr, Y[j0] + jy * jf - prr, prr * 2, prr * 2);
      }
    }
    // peristalsis: bultos luminosos que recorren el cuerpo a 22 segmentos por segundo
    for (var k = 0; k < rec.bulgeN; k++) {
      var pos = (now - rec.bulge[k]) * 0.022;
      if (pos > n - 1) {
        rec.bulge[k] = rec.bulge[rec.bulgeN - 1];
        rec.bulgeN--;
        k--;
        continue;
      }
      if (pos < 0) continue;
      var i0 = pos | 0, fr = pos - i0;
      var i1 = i0 + 1 < n ? i0 + 1 : i0;
      // no interpolar a través de un corte de portal
      var bx = X[i0], by = Y[i0];
      var jx = X[i1] - bx, jy = Y[i1] - by;
      if (jx < HALF_W && jx > -HALF_W && jy < HALF_H && jy > -HALF_H) { bx += jx * fr; by += jy * fr; }
      var br = radAt(pos * inv, ss) * 1.25;
      var fade = 1 - smoothstep(0.8, 1, pos * inv);
      c.globalAlpha = 0.55 * fade * av;
      c.drawImage(spr, bx - br * 2.2, by - br * 2.2, br * 4.4, br * 4.4);
      c.globalAlpha = 0.35 * fade * av;
      c.drawImage(p.glowBody, bx - br * 3, by - br * 3, br * 6, br * 6);
    }
  }

  function bellBlink(rec) {
    if (!rec.immune || !rec.immuneEnd) return 1;
    var left = rec.immuneEnd - Date.now();
    if (left > 1500 || left < -500) return 1;
    var on = Math.sin(nowMs() * 0.001 * 4 * TAU) > 0;
    return on ? 1 : 0.25;
  }

  function passHead(rec, ss, now) {
    var c = ctx, p = rec.paint;
    if (rec.n === 0) return;
    var dx = rec.dirX, dy = rec.dirY;
    var nxh = -dy, nyh = dx;
    var hx = rec.x[0], hy = rec.y[0];
    // retroceso visual al disparar
    var rel = now - rec.recoilT0;
    if (rel >= 0 && rel < 90) {
      var rk = 0.15 * ss * Math.sin(Math.PI * rel / 90);
      hx -= dx * rk; hy -= dy * rk;
    }
    var av = rec.alphaVis;
    var ang = Math.atan2(dy, dx);
    // glow de cabeza
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.6 * av;
    var gr = 1.0 * ss;
    c.drawImage(p.glowCore, hx - gr, hy - gr, gr * 2, gr * 2);
    // cabeza
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    rampFor(p, dimLevel(av));
    c.fillStyle = p.heads[dimLevel(av)];
    c.beginPath();
    c.ellipse(hx + dx * 0.08 * ss, hy + dy * 0.08 * ss, 0.56 * ss, 0.48 * ss, ang, 0, TAU);
    c.fill();
    // brillo interno de la cabeza
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.45 * av;
    var ir = 0.55 * ss;
    c.drawImage(p.glowCore, hx + dx * 0.05 * ss - ir, hy + dy * 0.05 * ss - ir, ir * 2, ir * 2);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = av < 1 ? 0.5 + 0.5 * av : 1;
    // ojos
    var ex = hx + dx * 0.18 * ss, ey = hy + dy * 0.18 * ss;
    if (ss >= 12) {
      var o = 0.22 * ss, sr = 0.12 * ss, pr = 0.07 * ss, pf = 0.03 * ss;
      c.fillStyle = '#E8FBFF';
      c.beginPath();
      c.arc(ex + nxh * o, ey + nyh * o, sr, 0, TAU);
      c.moveTo(ex - nxh * o + sr, ey - nyh * o);
      c.arc(ex - nxh * o, ey - nyh * o, sr, 0, TAU);
      c.fill();
      c.fillStyle = '#01060A';
      c.beginPath();
      c.arc(ex + nxh * o + dx * pf, ey + nyh * o + dy * pf, pr, 0, TAU);
      c.moveTo(ex - nxh * o + dx * pf + pr, ey - nyh * o + dy * pf);
      c.arc(ex - nxh * o + dx * pf, ey - nyh * o + dy * pf, pr, 0, TAU);
      c.fill();
      // señuelo
      var sw1 = Math.sin(animT * 0.003), sw2 = Math.sin(animT * 0.004 + 1);
      var lx0 = hx + dx * 0.3 * ss, ly0 = hy + dy * 0.3 * ss;
      var lcx = hx + dx * 0.7 * ss + nxh * 0.25 * ss * sw1, lcy = hy + dy * 0.7 * ss + nyh * 0.25 * ss * sw1;
      var lex = hx + dx * 0.85 * ss + nxh * 0.15 * ss * sw2, ley = hy + dy * 0.85 * ss + nyh * 0.15 * ss * sw2;
      c.strokeStyle = p.lure;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(lx0, ly0);
      c.quadraticCurveTo(lcx, lcy, lex, ley);
      c.stroke();
      c.globalCompositeOperation = 'lighter';
      var lr = 0.35 * ss;
      c.globalAlpha = 0.9 * av;
      c.drawImage(p.glowCore, lex - lr * 1.6, ley - lr * 1.6, lr * 3.2, lr * 3.2);
      c.globalAlpha = 0.5 * av;
      c.drawImage(p.glowBody, lex - lr * 2.6, ley - lr * 2.6, lr * 5.2, lr * 5.2);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = av;
      c.fillStyle = '#E8FBFF';
      c.beginPath();
      c.arc(lex, ley, Math.max(0.7, 0.08 * ss), 0, TAU);
      c.fill();
    } else {
      var o2 = 0.22 * ss;
      c.fillStyle = '#01060A';
      c.fillRect(ex + nxh * o2 - 0.5, ey + nyh * o2 - 0.5, 1, 1);
      c.fillRect(ex - nxh * o2 - 0.5, ey - nyh * o2 - 0.5, 1, 1);
    }
    c.globalAlpha = 1;
    drawBell(rec, ss, now, hx, hy, ang);
    // sonar del jugador propio (y sonar triple al empezar la ronda)
    if (rec.isMe && mode === 'game') {
      for (var k = 0; k < 3; k++) {
        var el = now - roundStartT - k * 200;
        if (el < 0 || el >= 700) continue;
        var tt = el / 700;
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = 0.5 * (1 - tt);
        c.strokeStyle = '#E8FBFF';
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(hx, hy, (0.5 + 3.5 * easeOutCubic(tt)) * ss, 0, TAU);
        c.stroke();
      }
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
    }
    if (rec.isMe) {
      var sp = (now - sonarBase) % 2400;
      if (sp >= 0 && sp < 900) {
        var st = sp / 900;
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = 0.35 * (1 - st);
        c.strokeStyle = '#E8FBFF';
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(hx, hy, (0.8 + 1.4 * easeOutCubic(st)) * ss, 0, TAU);
        c.stroke();
        c.globalCompositeOperation = 'source-over';
        c.globalAlpha = 1;
      }
    }
  }
  var sonarBase = 0;

  // Campana de medusa (5.7)
  function drawBell(rec, ss, now, hx, hy, ang) {
    var c = ctx;
    var popEl = now - rec.popT0;
    var popping = popEl >= 0 && popEl < 280;
    if (!rec.immune && !popping) return;
    var scale = 1, alpha = 1;
    var inf = now - rec.inflateT0;
    if (inf >= 0 && inf < 360) scale = Math.max(0, easeOutBack(inf / 360));
    if (popping) {
      var pt = popEl / 280;
      scale = 1 + 0.35 * easeOutCubic(pt);
      alpha = 1 - pt;
    } else {
      alpha = bellBlink(rec);
    }
    if (scale <= 0.01) return;
    var beat = reducedMotion ? 0 : Math.sin(now * 0.001 * 1.6 * TAU);
    var rx = 0.95 * ss * scale * (1 + 0.08 * beat);
    var ry = 0.95 * ss * scale * (1 - 0.08 * beat);
    var cosA = Math.cos(ang), sinA = Math.sin(ang);
    var bx = hx - cosA * 0.15 * ss, by = hy - sinA * 0.15 * ss;
    alpha *= rec.alphaVis;
    // glow suave
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.35 * alpha;
    var gr = 1.6 * ss * scale;
    c.drawImage(shieldSprite, bx - gr, by - gr, gr * 2, gr * 2);
    // campana: media elipse orientada hacia adelante (el borde abierto queda atrás)
    c.globalCompositeOperation = 'source-over';
    c.beginPath();
    c.ellipse(bx, by, rx, ry, ang, -Math.PI / 2, Math.PI / 2);
    c.globalAlpha = 0.18 * alpha;
    c.fillStyle = '#9FF4FF';
    c.fill();
    c.globalAlpha = 0.7 * alpha;
    c.strokeStyle = '#E8FBFF';
    c.lineWidth = 1.5;
    c.stroke();
    // borde interior más tenue: da volumen a la campana
    c.beginPath();
    c.ellipse(bx, by, rx * 0.72, ry * 0.8, ang, -Math.PI / 2 + 0.25, Math.PI / 2 - 0.25);
    c.globalAlpha = 0.3 * alpha;
    c.lineWidth = 1;
    c.stroke();
    // tentáculos cortos hacia atrás
    if (ss >= 12 && !popping) {
      c.globalAlpha = 0.35 * alpha;
      c.lineWidth = 1;
      c.strokeStyle = '#9FF4FF';
      c.beginPath();
      for (var k = -1; k <= 1; k++) {
        var ox = -sinA * k * ry * 0.7, oy = cosA * k * ry * 0.7;
        var sx0 = bx + ox, sy0 = by + oy;
        var sway = Math.sin(animT * 0.004 + k * 1.3) * 0.18 * ss;
        c.moveTo(sx0, sy0);
        c.quadraticCurveTo(sx0 - cosA * 0.45 * ss - sinA * sway, sy0 - sinA * 0.45 * ss + cosA * sway,
          sx0 - cosA * 0.8 * ss, sy0 - sinA * 0.8 * ss);
      }
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Etiquetas de nombre (5.6)
  // ---------------------------------------------------------------------------
  function ensureLabel(rec) {
    if (rec.label && rec.labelKey === rec.name && rec.labelColor === rec.paint.text && rec.labelEpoch === textEpoch) return rec.label;
    rec.label = textSprite(rec.label, truncateName(rec.name), fontUi(600, 12), labelPx(), rec.paint.text, 'rgba(2,10,18,0.85)', 3);
    rec.labelKey = rec.name;
    rec.labelColor = rec.paint.text;
    rec.labelEpoch = textEpoch;
    return rec.label;
  }

  // Desolapado: cada etiqueta dibujada en el frame reserva su rectángulo. Si la siguiente lo pisa,
  // prueba del otro lado de la cabeza; si tampoco entra, se omite en ese frame. Se dibujan en orden
  // de prioridad (propia, ganador, las más largas), así que las que se omiten son las menos relevantes.
  var LABEL_MAX = 64, LABEL_PAD = 2;
  var placedLabels = new Float32Array(LABEL_MAX * 4), placedLabelN = 0;
  var labelOrder = new Int32Array(LABEL_MAX);

  function resetLabelSlots() { placedLabelN = 0; }

  function labelHits(x0, y0, x1, y1) {
    for (var i = 0; i < placedLabelN; i++) {
      var o = i * 4;
      if (x0 < placedLabels[o + 2] && x1 > placedLabels[o] && y0 < placedLabels[o + 3] && y1 > placedLabels[o + 1]) return true;
    }
    return false;
  }

  function drawLabel(rec, ss, sprite, alpha, scale) {
    var c = ctx;
    var w = sprite._w * scale, h = sprite._h * scale;
    var hx = rec.x[0], hy = rec.y[0];
    var above = hy - (0.9 * ss + 8);
    var below = hy + 0.9 * ss + 8 + h * 0.2;
    var ly = above;
    if (ly - h / 2 < 16) ly = below;
    var lx = clamp(hx, w / 2 + 2, W - w / 2 - 2);
    var x0 = lx - w / 2 - LABEL_PAD, x1 = lx + w / 2 + LABEL_PAD;
    if (labelHits(x0, ly - h / 2 - LABEL_PAD, x1, ly + h / 2 + LABEL_PAD)) {
      var alt = ly === above ? below : above;
      if (alt - h / 2 < 2 || alt + h / 2 > H - 2 || labelHits(x0, alt - h / 2 - LABEL_PAD, x1, alt + h / 2 + LABEL_PAD)) return;
      ly = alt;
    }
    if (placedLabelN < LABEL_MAX) {
      var o = placedLabelN * 4;
      placedLabels[o] = x0; placedLabels[o + 1] = ly - h / 2 - LABEL_PAD;
      placedLabels[o + 2] = x1; placedLabels[o + 3] = ly + h / 2 + LABEL_PAD;
      placedLabelN++;
    }
    c.globalAlpha = alpha;
    c.drawImage(sprite, lx - w / 2, ly - h / 2, w, h);
  }

  // Índices de visRecs ordenados por prioridad de etiqueta (inserción sobre un array fijo, sin allocations)
  function labelPriority(rec) { return (rec.isMe ? 1e6 : 0) + (rec.winner ? 5e5 : 0) + rec.n; }
  function sortLabelOrder() {
    var n = Math.min(visCount, LABEL_MAX);
    for (var i = 0; i < n; i++) {
      var p = labelPriority(visRecs[i]);
      var j = i - 1;
      while (j >= 0 && labelPriority(visRecs[labelOrder[j]]) < p) { labelOrder[j + 1] = labelOrder[j]; j--; }
      labelOrder[j + 1] = i;
    }
    return n;
  }

  // ---------------------------------------------------------------------------
  // Comida, consumibles y proyectiles
  // ---------------------------------------------------------------------------
  var prevFoodKeys = new Float64Array(128), prevFoodN = 0;
  var curFoodKeys = new Float64Array(128);
  var spawnKey = new Float64Array(48), spawnT0 = new Float64Array(48), spawnN = 0;
  var lastFoodsRef = null;
  var foodsPrimed = false;
  var prevConsIds = [], curConsIds = [];
  var consSpawnId = new Array(16), consSpawnT0 = new Float64Array(16), consSpawnN = 0;
  var lastConsRef = null;
  var consPrimed = false;

  function addSpawn(key, now) {
    if (spawnN >= 48) { // descarta la más vieja
      for (var i = 1; i < 48; i++) { spawnKey[i - 1] = spawnKey[i]; spawnT0[i - 1] = spawnT0[i]; }
      spawnN = 47;
    }
    spawnKey[spawnN] = key;
    spawnT0[spawnN] = now;
    spawnN++;
  }

  function spawnScale(key, now) {
    for (var i = 0; i < spawnN; i++) {
      if (spawnKey[i] === key) {
        var el = now - spawnT0[i];
        if (el >= 450) {
          spawnKey[i] = spawnKey[spawnN - 1];
          spawnT0[i] = spawnT0[spawnN - 1];
          spawnN--;
          return 1;
        }
        return Math.max(0, easeOutBack(el / 450));
      }
    }
    return 1;
  }

  function detectFoodSpawns(foods, now) {
    if (foods === lastFoodsRef) return;
    lastFoodsRef = foods;
    var n = foods ? Math.min(foods.length, 128) : 0;
    for (var i = 0; i < n; i++) {
      var f = foods[i];
      var key = f.x * 1000 + f.y;
      curFoodKeys[i] = key;
      if (foodsPrimed) {
        var found = false;
        for (var j = 0; j < prevFoodN; j++) if (prevFoodKeys[j] === key) { found = true; break; }
        if (!found) {
          addSpawn(key, now);
          var half = s / 2;
          fxRing(f.x + half, f.y + half, 0.3 * s, 1.4 * s, 360, FOOD_COL[clamp((f.score | 0) - 1, 0, 4)], 0.7, 1.5, 0);
        }
      }
    }
    for (var k = 0; k < n; k++) prevFoodKeys[k] = curFoodKeys[k];
    prevFoodN = n;
    foodsPrimed = true;
  }

  function detectConsumableSpawns(cons, now) {
    if (cons === lastConsRef) return;
    lastConsRef = cons;
    var n = cons ? cons.length : 0;
    curConsIds.length = 0;
    for (var i = 0; i < n; i++) {
      var c = cons[i];
      var id = c.id !== undefined ? c.id : (c.x * 1000 + c.y);
      curConsIds.push(id);
      if (consPrimed && prevConsIds.indexOf(id) < 0) {
        if (consSpawnN >= 16) consSpawnN = 0;
        consSpawnId[consSpawnN] = id;
        consSpawnT0[consSpawnN] = now;
        consSpawnN++;
        var half = s / 2;
        fxRing(c.x + half, c.y + half, 0.3 * s, 1.8 * s, 420, '#9FF4FF', 0.7, 1.5, 0);
      }
    }
    var tmp = prevConsIds; prevConsIds = curConsIds; curConsIds = tmp;
    consPrimed = true;
  }

  function consSpawnScale(id, now) {
    for (var i = 0; i < consSpawnN; i++) {
      if (consSpawnId[i] === id) {
        var el = now - consSpawnT0[i];
        if (el >= 450) {
          consSpawnId[i] = consSpawnId[consSpawnN - 1];
          consSpawnT0[i] = consSpawnT0[consSpawnN - 1];
          consSpawnN--;
          return 1;
        }
        return Math.max(0, easeOutBack(el / 450));
      }
    }
    return 1;
  }

  function foodPhase(x, y) {
    return ((((x * 73856093) ^ (y * 19349663)) & 1023) / 1023) * TAU;
  }

  // Los restos (comida que suelta un corte) se desvanecen en sus últimos 2 s: `fade` lo calcula
  // SnakeGame.js con la hora del servidor del instante dibujado.
  function foodAlpha(f) {
    return f.fade === undefined ? 1 : f.fade;
  }

  function drawFoods(foods, now) {
    if (!foods || foods.length === 0) return;
    ensureFoodSprites();
    var c = ctx, half = s / 2, n = foods.length;
    var w = 0.8 * TAU / 1000;
    // glows
    c.globalCompositeOperation = 'lighter';
    for (var i = 0; i < n; i++) {
      var f = foods[i];
      var fa = foodAlpha(f);
      if (fa <= 0.01) continue;
      var v = clamp((f.score | 0) - 1, 0, 4);
      var ph = foodPhase(f.x, f.y);
      var sc = spawnScale(f.x * 1000 + f.y, now);
      if (sc <= 0.01) continue;
      var br = 1 + 0.06 * Math.sin(animT * w + ph);
      var cx = f.x + half, cy = f.y + half + 0.06 * s * Math.sin(animT * w * 0.9 + ph * 1.3);
      var r = FOOD_R[v];
      var R = FOOD_GLOW * r * (1 + 0.1 * (v + 1)) * br * sc;
      c.globalAlpha = 0.9 * fa;
      c.drawImage(foodGlows[v], cx - R, cy - R, R * 2, R * 2);
    }
    // discos (con contorno y dígito horneados)
    c.globalCompositeOperation = 'source-over';
    for (i = 0; i < n; i++) {
      f = foods[i];
      fa = foodAlpha(f);
      if (fa <= 0.01) continue;
      v = clamp((f.score | 0) - 1, 0, 4);
      ph = foodPhase(f.x, f.y);
      sc = spawnScale(f.x * 1000 + f.y, now);
      if (sc <= 0.01) continue;
      br = 1 + 0.06 * Math.sin(animT * w + ph);
      cx = f.x + half; cy = f.y + half + 0.06 * s * Math.sin(animT * w * 0.9 + ph * 1.3);
      var orb = foodOrbs[v];
      var hr = orb._r * br * sc;
      c.globalAlpha = fa;
      c.drawImage(orb, cx - hr, cy - hr, hr * 2, hr * 2);
    }
    // satélites y anillo exterior del 5
    c.globalCompositeOperation = 'lighter';
    var satR = Math.max(1, 0.06 * s) * 3;
    for (i = 0; i < n; i++) {
      f = foods[i];
      fa = foodAlpha(f);
      if (fa <= 0.01) continue;
      v = clamp((f.score | 0) - 1, 0, 4);
      ph = foodPhase(f.x, f.y);
      sc = spawnScale(f.x * 1000 + f.y, now);
      if (sc <= 0.01) continue;
      cx = f.x + half; cy = f.y + half + 0.06 * s * Math.sin(animT * w * 0.9 + ph * 1.3);
      r = FOOD_R[v] * sc;
      var orbit = 1.6 * r + 1.5;
      var count = v + 1;
      var base = animT * 0.0016 + ph;
      c.globalAlpha = 0.95 * fa;
      for (var k = 0; k < count; k++) {
        var a = base + k * TAU / count;
        c.drawImage(pearlSprite, cx + Math.cos(a) * orbit - satR, cy + Math.sin(a) * orbit - satR, satR * 2, satR * 2);
      }
      if (v === 4) {
        c.globalAlpha = 0.5 * fa;
        c.strokeStyle = FOOD_COL[4];
        c.lineWidth = 1;
        c.beginPath();
        c.arc(cx, cy, 2.2 * r + 1.5, 0, TAU);
        c.stroke();
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  // Escudo en el mapa (5.9): medusa violeta de tamaño fijo con un anillo que se expande cada 2 s,
  // para que se distinga de la comida y de la nieve a cualquier escala. Medidas en px de la arena.
  var CONS_BELL_W = 7.5, CONS_BELL_H = 9;   // semiancho y alto de la campana
  var CONS_SONAR_MS = 2000;
  function drawConsumables(cons, now) {
    if (!cons || cons.length === 0) return;
    var c = ctx, half = s / 2;
    for (var i = 0; i < cons.length; i++) {
      var it = cons[i];
      var id = it.id !== undefined ? it.id : (it.x * 1000 + it.y);
      var sc = consSpawnScale(id, now);
      if (sc <= 0.01) continue;
      var ph = foodPhase(it.x, it.y);
      var cx = it.x + half;
      var cy = it.y + half + 1.2 * Math.sin(animT * 0.0012 * TAU / 1.2 + ph) - 2;
      var beat = Math.sin(animT * 0.001 * 1.4 * TAU + ph);
      // sonar: un anillo que nace en la campana y se abre hasta 26 px mientras se apaga
      var st = ((animT + ph * 318) % CONS_SONAR_MS) / CONS_SONAR_MS;
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.6 * (1 - st) * (1 - st) * sc;
      c.strokeStyle = '#B9A6FF';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(cx, cy + 2, 9 + 17 * easeOutCubic(st), 0, TAU);
      c.stroke();
      // glows: violeta amplio y celeste cerca del núcleo
      var g2 = 20 * sc * (1 + 0.08 * Math.sin(animT * 0.001 * 0.7 * TAU + ph));
      c.globalAlpha = 0.5 + 0.1 * Math.sin(animT * 0.001 * 0.7 * TAU + ph);
      c.drawImage(violetSprite, cx - g2, cy - g2, g2 * 2, g2 * 2);
      var g1 = 12 * sc;
      c.globalAlpha = 0.35;
      c.drawImage(shieldSprite, cx - g1, cy - g1, g1 * 2, g1 * 2);
      // tentáculos
      c.globalCompositeOperation = 'source-over';
      var bw = CONS_BELL_W * sc * (1 + 0.06 * beat), bh = CONS_BELL_H * sc * (1 - 0.06 * beat);
      c.globalAlpha = 0.85;
      c.strokeStyle = '#D6CCFF';
      c.lineWidth = 1.2;
      c.beginPath();
      for (var k = 0; k < 3; k++) {
        var tx = cx + (k - 1) * bw * 0.55;
        var sway = Math.sin(animT * 0.004 + k) * 1.8 * sc;
        c.moveTo(tx, cy);
        c.quadraticCurveTo(tx + sway, cy + 4 * sc, tx - sway * 0.6, cy + 8 * sc);
      }
      c.stroke();
      // campana (sprite horneado con su degradado y su borde)
      var bell = ensureConsSprite();
      c.globalAlpha = 1;
      c.drawImage(bell, cx - bw * bell._sx, cy - bh * bell._sy, bw * 2 * bell._sx, bh * bell._sy * bell._hy);
      // núcleo
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.9;
      var nr = 4 * sc;
      c.drawImage(pearlSprite, cx - nr, cy - bh * 0.45 - nr, nr * 2, nr * 2);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  // Campana del escudo: media elipse con degradado violeta (#D9CCFF -> #9C82FF, alpha 0,75) y
  // borde #F3EEFF al 90 %, horneada en un sprite por escala.
  var consSprite = null, consKK = 0;
  function ensureConsSprite() {
    if (consSprite && consKK === K) return consSprite;
    consKK = K;
    var rx = CONS_BELL_W * K, ry = CONS_BELL_H * K;
    var pad = 2;
    var cw = Math.ceil(rx * 2 + pad * 2), ch = Math.ceil(ry + pad * 2);
    var cnv = consSprite || makeCanvas(cw, ch);
    cnv.width = cw; cnv.height = ch;
    var g = cnv.getContext('2d');
    var cx = cw / 2, base = ry + pad;
    var lg = g.createLinearGradient(0, pad, 0, base);
    lg.addColorStop(0, 'rgba(217,204,255,0.75)');
    lg.addColorStop(1, 'rgba(156,130,255,0.75)');
    g.beginPath();
    g.ellipse(cx, base, rx, ry, 0, Math.PI, TAU);
    g.closePath();
    g.fillStyle = lg;
    g.fill();
    g.strokeStyle = 'rgba(243,238,255,0.9)';
    g.lineWidth = Math.max(1, 1.2 * K);
    g.stroke();
    // factores para dibujarlo con el tamaño lógico de la campana
    cnv._sx = cw / (rx * 2);
    cnv._sy = (ry + pad) / ry;
    cnv._hy = ch / (ry + pad);
    consSprite = cnv;
    return cnv;
  }

  // Estelas de proyectiles por id
  var trails = new Map();
  var trailPool = [];
  function newTrail() {
    var t = trailPool.length ? trailPool.pop() : { buf: new Float32Array(20), n: 0, head: 0, paint: null, seen: 0, fadeT0: 0, color: '' };
    t.n = 0; t.head = 0; t.paint = null; t.seen = 0; t.fadeT0 = 0; t.color = '';
    return t;
  }

  var trailNow = 0, trailLen = 10;
  function trailSweep(tr, id) {
    if (tr.seen === frameNo) return;
    if (!tr.fadeT0) tr.fadeT0 = trailNow;
    if (trailNow - tr.fadeT0 > 300) {
      trails.delete(id);
      if (trailPool.length < 64) trailPool.push(tr);
      return;
    }
    drawTrail(tr, 1 - (trailNow - tr.fadeT0) / 300);
  }

  function drawTrail(tr, fade) {
    var c = ctx, L = tr.n;
    if (L < 2) return;
    c.strokeStyle = tr.paint.body;
    var w0 = 0.36 * s;
    var idx = tr.head;
    var px = tr.buf[idx * 2], py = tr.buf[idx * 2 + 1];
    for (var j = 1; j < L; j++) {
      idx = (idx - 1 + 10) % 10;
      var qx = tr.buf[idx * 2], qy = tr.buf[idx * 2 + 1];
      var k = 1 - j / (L - 1 || 1);
      c.globalAlpha = 0.7 * k * fade;
      c.lineWidth = Math.max(0.4, w0 * k);
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(qx, qy);
      c.stroke();
      px = qx; py = qy;
    }
  }

  function drawProjectiles(list, now) {
    var c = ctx, half = s / 2;
    trailNow = now;
    trailLen = trailLenFor(quality);
    var n = list ? list.length : 0;
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var p = list[i];
      var x = (p.renderX !== undefined ? p.renderX : p.x) + half;
      var y = (p.renderY !== undefined ? p.renderY : p.y) + half;
      var tr = trails.get(p.id);
      if (!tr) { tr = newTrail(); trails.set(p.id, tr); }
      if (tr.color !== p.color || !tr.paint) { tr.paint = paintFor(p.color); tr.color = p.color; }
      tr.seen = frameNo;
      tr.fadeT0 = 0;
      var hd = (tr.head + 1) % 10;
      tr.buf[hd * 2] = x; tr.buf[hd * 2 + 1] = y;
      tr.head = hd;
      if (tr.n < trailLen) tr.n++; else tr.n = trailLen;
      drawTrail(tr, 1);
    }
    trails.forEach(trailSweep);
    // halos
    var flick = 1 + 0.15 * Math.sin(now * 0.05);
    var R = 1.6 * s;
    for (i = 0; i < n; i++) {
      p = list[i];
      tr = trails.get(p.id);
      if (!tr) continue;
      x = tr.buf[tr.head * 2]; y = tr.buf[tr.head * 2 + 1];
      c.globalAlpha = Math.min(1, 0.8 * flick);
      c.drawImage(tr.paint.glowBody, x - R, y - R, R * 2, R * 2);
    }
    // núcleos: cápsula orientada (largo 0,9 s, ancho 0,36 s)
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.lineWidth = 0.36 * s;
    var hl = 0.27 * s;
    for (i = 0; i < n; i++) {
      p = list[i];
      tr = trails.get(p.id);
      if (!tr) continue;
      x = tr.buf[tr.head * 2]; y = tr.buf[tr.head * 2 + 1];
      var dx = p.direction ? p.direction.x : 1, dy = p.direction ? p.direction.y : 0;
      c.strokeStyle = tr.paint.core;
      c.beginPath();
      c.moveTo(x - dx * hl, y - dy * hl);
      c.lineTo(x + dx * hl, y + dy * hl);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  // Colas desprendidas (impactos)
  var TAIL_MAX = 8, TAIL_PTS = 96;
  var tails = [];
  for (var ti = 0; ti < TAIL_MAX; ti++) tails.push({ on: false, t0: 0, n: 0, bx: new Float32Array(TAIL_PTS), by: new Float32Array(TAIL_PTS), paint: null, vx: 0, vy: 0, t0n: 0, s: 20 });

  function spawnTail(rec, lost, now) {
    if (!rec || rec.n < 2 || lost <= 0) return;
    var slot = null, oldest = 1e18, oi = 0;
    for (var i = 0; i < TAIL_MAX; i++) {
      if (!tails[i].on) { slot = tails[i]; break; }
      if (tails[i].t0 < oldest) { oldest = tails[i].t0; oi = i; }
    }
    if (!slot) slot = tails[oi];
    var n = Math.min(lost, rec.n - 1, TAIL_PTS);
    var start = rec.n - n;
    // no copiar a través de un corte de portal: se corta en el primer salto
    var count = 0;
    for (var k = start; k < rec.n; k++) {
      if (count > 0) {
        var dx = rec.x[k] - slot.bx[count - 1], dy = rec.y[k] - slot.by[count - 1];
        if (dx > HALF_W || dx < -HALF_W || dy > HALF_H || dy < -HALF_H) break;
      }
      slot.bx[count] = rec.x[k];
      slot.by[count] = rec.y[k];
      count++;
    }
    slot.on = true;
    slot.t0 = now;
    slot.n = count;
    slot.paint = rec.paint;
    slot.vx = (Math.random() * 2 - 1) * 10;
    slot.vy = (Math.random() * 2 - 1) * 10 + 8;
    slot.t0n = start / Math.max(rec.n - 1, 1);
    slot.s = rec.s;
  }

  function drawTails(now) {
    var c = ctx;
    for (var i = 0; i < TAIL_MAX; i++) {
      var tl = tails[i];
      if (!tl.on) continue;
      var el = now - tl.t0;
      if (el > 900) { tl.on = false; continue; }
      var t = el / 900;
      var ox = tl.vx * el / 1000, oy = tl.vy * el / 1000;
      var fade = 1 - t;
      c.save();
      c.translate(ox, oy);
      c.globalCompositeOperation = 'lighter';
      var R = 2.4 * radAt(tl.t0n, tl.s);
      c.globalAlpha = 0.18 * fade;
      for (var k = 0; k < tl.n; k += 2) {
        c.drawImage(tl.paint.glowBody, tl.bx[k] - R, tl.by[k] - R, R * 2, R * 2);
      }
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 0.6 * fade;
      c.strokeStyle = tl.paint.deep;
      c.lineWidth = 2 * radAt(Math.min(1, tl.t0n + 0.1), tl.s) * (1 - 0.3 * t);
      c.beginPath();
      pathRange(c, tl.bx, tl.by, 0, tl.n - 1, 0, tl.n - 1);
      c.stroke();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.5 * fade;
      c.strokeStyle = tl.paint.body;
      c.lineWidth = Math.max(0.8, 0.12 * tl.s);
      c.stroke();
      c.restore();
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }


  // ---------------------------------------------------------------------------
  // Contador gigante de los últimos 10 segundos (5.13)
  // ---------------------------------------------------------------------------
  var countNum = 0, countT0 = -1e9;

  function prepareDigits(timeLeft) {
    // genera un sprite por frame antes de que haga falta (sin tirones en el momento tenso)
    if (timeLeft > 16) return;
    for (var n = 10; n >= 1; n--) {
      if (!digitReady(n)) { buildDigit(n); return; }
    }
  }

  function drawCountdown(state, now) {
    var tl = state.roundTimeLeft;
    var show = state.playing && tl >= 1 && tl <= 10;
    if (!show) { countNum = 0; return; }
    var n = Math.ceil(tl);
    if (n !== countNum) {
      countNum = n;
      countT0 = now;
      tensionBumpT0 = now;
    }
    if (!digitReady(n)) buildDigit(n);
    var spr = digitSprites[n];
    var base = n >= 6 ? 0.10 : (n >= 4 ? 0.14 : 0.20);
    var el = (now - countT0) / 450;
    var e = easeOutExpo(clamp01(el));
    var scale = reducedMotion ? 1 : 1.18 + (1 - 1.18) * e;
    var alpha = (base * 2 + (base - base * 2) * e) * countFade;
    var w = spr._w * scale, h = spr._h * scale;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.drawImage(spr, 300 - w / 2, 312 - h / 2, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------------------
  // Congelamiento de fin de ronda (5.14)
  // ---------------------------------------------------------------------------
  var freezeT0 = -1e9;
  var freezeWinner = null;
  var FREEZE_MS = 2400;
  var roundStartT = -1e9;

  function frozen(now) { return now - freezeT0 < FREEZE_MS; }

  // ---------------------------------------------------------------------------
  // Marco del frame
  // ---------------------------------------------------------------------------
  function frameBegin(now) {
    frameNo++;
    var dt;
    if (!lastNow) dt = 16;
    else dt = now - lastNow;
    if (dt > 250 || dt < 0) dt = 16;   // pestaña oculta o reloj extraño: no saltar
    trackFrame(now - lastNow);
    lastNow = now;
    if (dt > 50) dt = 50;
    frameDt = dt;
    // cámara lenta del congelamiento (400 ms para entrar, 400 ms para salir)
    var targetScale = (mode === 'game' && frozen(now)) ? 0.25 : 1;
    var stepK = clamp01(dt / 400) * 3;
    timeScale += (targetScale - timeScale) * (stepK > 1 ? 1 : stepK);
    snowSpeed = timeScale;
    animT += dt * timeScale;
    // dpr cambiado (pantalla distinta)
    var dprRaw = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (dprRaw !== lastDprRaw) { lastDprRaw = dprRaw; scheduleResize(); }
    return dt;
  }

  function beginDraw() {
    var c = ctx;
    c.setTransform(K, 0, 0, K, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }

  function drawBase(dt, causticMul) {
    var c = ctx;
    if (shakeX !== 0 || shakeY !== 0) {
      c.fillStyle = BG_HEX;
      c.fillRect(0, 0, W, H);
      c.setTransform(K, 0, 0, K, shakeX * K, shakeY * K);
    }
    c.drawImage(bgCanvas, 0, 0, W, H);
    drawCaustics(dt, causticMul);
    c.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------------------
  // Render de partida
  // ---------------------------------------------------------------------------
  var visRecs = new Array(32);
  var visCount = 0;
  var recSweepT = 0;

  function recSweep(rec, id) {
    if (lastNow - rec.lastSeenT > 15000) snakeRecs.delete(id);
  }

  function prepareSnakes(state, now) {
    visCount = 0;
    headCount = 0;
    var snakes = state.snakes;
    if (!snakes) return;
    var me = state.spectating ? null : state.myId;
    var wave = !reducedMotion && quality > 0;
    var meRec = null;
    var fr = frozen(now);
    for (var i = 0; i < snakes.length; i++) {
      var sn = snakes[i];
      if (!sn) continue;
      var rec = getRec(sn.id);
      rec.lastSeenT = now;
      rec.s = s;
      rec.name = sn.name;
      rec.isMe = me !== null && me !== undefined && sn.id === me;
      if (rec.colorKey !== sn.color || !rec.paint) { rec.paint = paintFor(sn.color); rec.colorKey = sn.color; }
      var ac = sn.activeConsumable;
      var imm = !!(ac && ac.type === 'immunity');
      if (imm && !rec.immune && now - rec.inflateT0 > 1000) rec.inflateT0 = now; // por si el evento no llegó
      rec.immune = imm;
      rec.immuneEnd = imm ? (ac.endTime || 0) : 0;
      if (sn.gameover) { rec.n = 0; continue; }
      var segs = sn.getRenderSegments ? sn.getRenderSegments() : sn.segments;
      var n = segs ? segs.length : 0;
      if (n === 0) { rec.n = 0; continue; }
      ensureCap(rec, n);
      var half = s / 2;
      for (var k = 0; k < n; k++) {
        rec.rx[k] = segs[k].x + half;
        rec.ry[k] = segs[k].y + half;
      }
      rec.n = n;
      computeRuns(rec);
      var d = sn.direction;
      computeDir(rec, d ? d.x : 0, d ? d.y : 0, s);
      computeShape(rec, s, wave);
      // fin de ronda: los que no ganaron se atenúan y pierden el filamento
      if (fr && freezeWinner !== undefined && freezeWinner !== null) {
        var et = easeInOutSine(clamp01((now - freezeT0) / 600));
        var win = freezeWinner !== null && sn.id === freezeWinner;
        rec.winner = win;
        rec.alphaVis = win ? 1 : 1 - 0.65 * et;
        rec.filament = win ? 1 : 1 - et;
        rec.labelScale = win ? 1 + 0.4 * easeOutCubic(clamp01((now - freezeT0) / 500)) : 1;
      } else {
        rec.alphaVis = 1; rec.filament = 1; rec.labelScale = 1; rec.winner = false;
      }
      if (rec.isMe) meRec = rec;
      else if (visCount < 31) visRecs[visCount++] = rec;
      // En partida las cabezas no encienden la nieve: esos destellos de color parecían comida
    }
    if (meRec) visRecs[visCount++] = meRec;
  }

  function drawCreatures(now, ssOf) {
    var c = ctx, i, rec;
    // 1. halos
    c.globalCompositeOperation = 'lighter';
    for (i = 0; i < visCount; i++) { rec = visRecs[i]; passHalo(rec, ssOf(rec), now); }
    // membrana de inmunidad
    for (i = 0; i < visCount; i++) { rec = visRecs[i]; if (rec.immune) passImmunityMembrane(rec, ssOf(rec), now); }
    // 2. cuerpos
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    for (i = 0; i < visCount; i++) { rec = visRecs[i]; passBody(rec, ssOf(rec)); }
    // 3. filamentos
    c.globalCompositeOperation = 'lighter';
    for (i = 0; i < visCount; i++) { rec = visRecs[i]; passFilament(rec, ssOf(rec)); }
    // 4. fotóforos
    for (i = 0; i < visCount; i++) { rec = visRecs[i]; passPhotophores(rec, ssOf(rec), now); }
    // 5. cabezas
    for (i = 0; i < visCount; i++) { rec = visRecs[i]; passHead(rec, ssOf(rec), now); }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  function ssGame() { return s; }

  function drawGameLabels(now) {
    var c = ctx;
    c.globalCompositeOperation = 'source-over';
    resetLabelSlots();
    var n = sortLabelOrder();
    for (var i = 0; i < n; i++) {
      var rec = visRecs[labelOrder[i]];
      if (rec.n === 0) continue;
      if (rec.isMe) {
        var el = now - roundStartT;
        if (el >= 0 && el < 2500) {
          var a = el < 200 ? el / 200 : 1 - smoothstep(2100, 2500, el);
          drawLabel(rec, s, getMeLabel(), a, rec.labelScale);
        } else if (rec.winner) {
          drawLabel(rec, s, getMeLabel(), 1, rec.labelScale);
        }
        continue;
      }
      drawLabel(rec, s, ensureLabel(rec), rec.winner ? 1 : 0.8 * (0.4 + 0.6 * rec.alphaVis), rec.labelScale);
    }
    c.globalAlpha = 1;
  }

  var renderStart = 0;

  function render(state, now) {
    if (!ctx || !state) return;
    if (typeof now !== 'number') now = nowMs();
    renderStart = nowMs();
    if (mode !== 'game') { mode = 'game'; }
    var dt = frameBegin(now);
    lastState = state;
    lastGameRenderT = now;
    myId = state.myId;

    // Tensión
    var tl = state.roundTimeLeft;
    var fr = frozen(now);
    var targetT = (state.playing && tl !== undefined && tl <= 10 && tl >= 0 && !fr) ? (10 - tl) / 10 : 0;
    tensionLevel += (targetT - tensionLevel) * clamp01(dt / 300);
    countFade = fr ? 1 - smoothstep(0, 800, now - freezeT0) : 1;
    if (state.playing && typeof tl === 'number') prepareDigits(tl);

    // Simulación
    particles.update(dt);
    updateFx(now);
    computeShake(now);
    detectFoodSpawns(state.foods, now);
    detectConsumableSpawns(state.consumables, now);
    prepareSnakes(state, now);
    updateSnow(dt);

    // Dibujo, en el orden de capas de 5.1
    beginDraw();
    drawBase(dt, 1);               // 1-4: sacudida, fondo (+grilla), cáusticas
    drawSnow(true);                // 5
    drawCountdown(state, now);     // 6
    drawFxLayer(0, now);           //   columna de luz del ganador (debajo de lo jugable)
    drawFoods(state.foods, now);   // 7
    drawConsumables(state.consumables, now); // 8
    drawProjectiles(state.projectiles, now); // 9
    drawTails(now);                //   colas desprendidas
    drawCreatures(now, ssGame);    // 10
    particles.draw(ctx);           // 11
    drawFxLayer(1, now);           //   anillos, destellos, ola
    drawGameLabels(now);           // 12
    drawFxLayer(2, now);           //   textos flotantes
    ctx.setTransform(K, 0, 0, K, 0, 0);
    drawFxLayer(3, now);           // 13: destellos de portal
    drawMembrane(now);             //     membrana de bordes
    drawVignette(now);             // 14

    if (now - recSweepT > 5000) { recSweepT = now; snakeRecs.forEach(recSweep); }
    lastRenderMs = nowMs() - renderStart;
  }

  // ---------------------------------------------------------------------------
  // Modo atracción (5.15)
  // ---------------------------------------------------------------------------
  var creatures = new Map();
  var creatureArr = [];
  var idleEpoch = 0;
  var sIdle = 18;
  var captionSprite = null, captionText = '', captionEpoch = 0;
  var pointerX = -1e4, pointerY = -1e4, pointerT = -1e9, pointerSpeed = 0;
  var ANON = [
    { id: '__anon0', name: '', color: '#00ffff' },
    { id: '__anon1', name: '', color: '#40ff80' },
    { id: '__anon2', name: '', color: '#8040ff' }
  ];

  function hash1(i, seed) {
    var v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    return (v - Math.floor(v)) * 2 - 1;
  }
  function noise1(x, seed) {
    var i = Math.floor(x), f = x - i;
    var u = f * f * (3 - 2 * f);
    return hash1(i, seed) * (1 - u) + hash1(i + 1, seed) * u;
  }

  function Creature(id) {
    this.id = id;
    this.rec = new SnakeRec(id);
    this.x = 300; this.y = 300;
    this.heading = 0;
    this.seed = Math.random() * 100;
    this.period = 3000 + Math.random() * 2000;
    this.hist = new Float32Array(20);
    this.dist = 0;
    this.hatchT0 = -1e9;
    this.seen = 0;
    this.anon = false;
    this.name = '';
    this.color = '';
    this.isMe = false;
  }

  function placeCreature(cr, x, y, heading, spacing) {
    cr.x = x; cr.y = y; cr.heading = heading;
    var cx = Math.cos(heading), cy = Math.sin(heading);
    for (var k = 0; k < 10; k++) {
      cr.hist[k * 2] = x - cx * spacing * (k + 1);
      cr.hist[k * 2 + 1] = y - cy * spacing * (k + 1);
    }
    cr.dist = 0;
  }

  // Si la criatura corresponde a una serpiente recién vista en partida, nace donde
  // quedó esa serpiente (continuidad entre ronda y sala). El resto del cuerpo se disuelve.
  function seedFromGame(cr, now) {
    if (now - lastGameRenderT > 4000) return false;
    var rec = snakeRecs.get(cr.id);
    if (!rec || rec.n === 0 || rec.lastSeenT < lastGameRenderT - 50) return false;
    var spacing = 0.8 * sIdle;
    var hx = clamp(rec.rx[0], 30, W - 30), hy = clamp(rec.ry[0], 30, H - 30);
    placeCreature(cr, hx, hy, Math.atan2(rec.dirY, rec.dirX), spacing);
    // historia desde el cuerpo real (mismo tramo)
    var limit = rec.runs[1];
    for (var k = 0; k < 10 && k + 1 <= limit; k++) {
      cr.hist[k * 2] = clamp(rec.rx[k + 1], 4, W - 4);
      cr.hist[k * 2 + 1] = clamp(rec.ry[k + 1], 4, H - 4);
    }
    // el resto del cuerpo se convierte en una nube de plancton que se dispersa
    var p = rec.paint;
    var stepJ = rec.n > 70 ? 3 : 2;
    for (var j = 11; j < rec.n && j < 160; j += stepJ) {
      var jx = rec.x[j] + (Math.random() - 0.5) * s, jy = rec.y[j] + (Math.random() - 0.5) * s;
      setBurst(1, (j & 2) ? p.body : p.core, 12, 46, 450, 1100, 0.9, 2.2, 'dot', -24, 0.94);
      particles.burst(jx, jy, BO);
    }
    return true;
  }

  function hatchCreature(cr, now) {
    var spacing = 0.8 * sIdle;
    placeCreature(cr, 80 + Math.random() * (W - 160), 80 + Math.random() * (H - 160), Math.random() * TAU, spacing * 0.2);
    cr.hatchT0 = now;
    var p = cr.rec.paint;
    fxRing(cr.x, cr.y, 0.3 * sIdle, 2.4 * sIdle, 700, p.core, 0.8, 1.5, 0);
    setBurst(scaleCount(20), p.body, 20, 80, 500, 1000, 1, 2.2, 'dot', -10, 0.92);
    particles.burst(cr.x, cr.y, BO);
  }

  function dissolveCreature(cr) {
    var rec = cr.rec, p = rec.paint;
    if (!p) return;
    for (var i = 0; i < rec.n; i++) {
      setBurst(scaleCount(3), (i & 1) ? p.core : p.body, 10, 40, 700, 900, 1, 2.2, 'dot', -30, 0.95);
      BO.angle = -Math.PI / 2;
      BO.spread = 1.6;
      particles.burst(rec.x[i], rec.y[i], BO);
    }
  }

  function syncCreatures(list, now) {
    idleEpoch++;
    var src = list && list.length ? list : ANON;
    var anon = !(list && list.length);
    for (var i = 0; i < src.length && i < 24; i++) {
      var it = src[i];
      if (!it || it.id === undefined || it.id === null) continue;
      var cr = creatures.get(it.id);
      var fresh = false;
      if (!cr) {
        cr = new Creature(it.id);
        creatures.set(it.id, cr);
        creatureArr.push(cr);
        fresh = true;
      }
      cr.seen = idleEpoch;
      cr.anon = anon;
      cr.name = it.name || '';
      cr.isMe = !!it.isMe;
      if (cr.color !== it.color || !cr.rec.paint) { cr.color = it.color; cr.rec.paint = paintFor(it.color); }
      if (fresh) {
        if (anon || !seedFromGame(cr, now)) hatchCreature(cr, now);
      } else if (modeSwitchedFromGame && !anon) {
        seedFromGame(cr, now);
      }
    }
    // los que ya no están se disuelven
    for (var k = creatureArr.length - 1; k >= 0; k--) {
      var c = creatureArr[k];
      if (c.seen !== idleEpoch) {
        dissolveCreature(c);
        creatures.delete(c.id);
        creatureArr.splice(k, 1);
      }
    }
  }

  function steerCreatures(dtMs) {
    var dt = dtMs / 1000 * timeScale;
    var spacing = 0.8 * sIdle;
    var speed = 38;
    for (var i = 0; i < creatureArr.length; i++) {
      var cr = creatureArr[i];
      var turn = noise1(animT / cr.period + cr.seed, cr.seed) * 1.5;
      cr.heading += turn * dt;
      var m = 40 + sIdle;
      if (cr.x < m || cr.x > W - m || cr.y < m || cr.y > H - m) {
        var desired = Math.atan2(H / 2 - cr.y, W / 2 - cr.x);
        var diff = desired - cr.heading;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        cr.heading += diff * clamp01(dt * 2.2);
      }
      var step = speed * dt;
      cr.x = clamp(cr.x + Math.cos(cr.heading) * step, 6, W - 6);
      cr.y = clamp(cr.y + Math.sin(cr.heading) * step, 6, H - 6);
      cr.dist += step;
      if (cr.dist >= spacing) {
        cr.dist -= spacing;
        cr.hist.copyWithin(2, 0, 18);
        cr.hist[0] = cr.x;
        cr.hist[1] = cr.y;
      }
    }
  }

  function prepareCreatures(now) {
    visCount = 0;
    headCount = 0;
    var meRec = null;
    var wave = !reducedMotion && quality > 0;
    for (var i = 0; i < creatureArr.length; i++) {
      var cr = creatureArr[i];
      var rec = cr.rec;
      var hatchEl = now - cr.hatchT0;
      var pts = 10;
      if (hatchEl >= 0 && hatchEl < 1200) pts = 2 + Math.round(8 * easeOutCubic(hatchEl / 1200));
      ensureCap(rec, 11);
      rec.rx[0] = cr.x; rec.ry[0] = cr.y;
      for (var k = 1; k < pts; k++) {
        rec.rx[k] = cr.hist[(k - 1) * 2];
        rec.ry[k] = cr.hist[(k - 1) * 2 + 1];
      }
      rec.n = pts;
      rec.s = sIdle;
      rec.name = cr.name;
      rec.isMe = cr.isMe;
      rec.immune = false;
      rec.alphaVis = cr.anon ? 0.5 : 1;
      rec.filament = 1;
      rec.labelScale = 1;
      rec.winner = false;
      computeRuns(rec);
      computeDir(rec, Math.cos(cr.heading), Math.sin(cr.heading), sIdle);
      computeShape(rec, sIdle, wave);
      if (rec.isMe) meRec = rec;
      else if (visCount < 31) visRecs[visCount++] = rec;
      pushHead(rec.x[0], rec.y[0], 3 * sIdle, rec.paint);
    }
    if (meRec) visRecs[visCount++] = meRec;
    // el puntero también enciende el plancton en la sala
    if (!reducedMotion && now - pointerT < 900 && pointerSpeed > 40) {
      pushHead(pointerX, pointerY, 46, pointerPaint());
    }
  }

  var pointerPaintRef = null;
  function pointerPaint() {
    if (!pointerPaintRef) pointerPaintRef = paintFor('#00ffff');
    return pointerPaintRef;
  }

  function ssIdle() { return sIdle; }

  function drawIdleLabels() {
    var c = ctx;
    c.globalCompositeOperation = 'source-over';
    resetLabelSlots();
    var n = sortLabelOrder();
    for (var i = 0; i < n; i++) {
      var rec = visRecs[labelOrder[i]];
      if (rec.n === 0) continue;
      var cr = creatures.get(rec.id);
      if (!cr || cr.anon) continue;
      if (rec.isMe) drawLabel(rec, sIdle, getMeLabel(), 1, 1);
      else drawLabel(rec, sIdle, ensureLabel(rec), 0.8, 1);
    }
    c.globalAlpha = 1;
  }

  function drawCaption(text) {
    if (!text) return;
    if (!captionSprite || text !== captionText || captionEpoch !== textEpoch) {
      captionSprite = textSprite(captionSprite, String(text), fontUi(500, 16), 16 / Math.max(0.5, arenaScale), '#A3C7D1', 'rgba(1,5,9,0.9)', 4);
      captionText = text;
      captionEpoch = textEpoch;
    }
    var w = captionSprite._w, h = captionSprite._h;
    if (w > W - 24) { h = h * (W - 24) / w; w = W - 24; }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(captionSprite, 300 - w / 2, H - 28 - h / 2, w, h);
  }

  var modeSwitchedFromGame = false;

  function renderIdle(now, opts) {
    if (!ctx) return;
    if (typeof now !== 'number') now = nowMs();
    renderStart = nowMs();
    modeSwitchedFromGame = mode === 'game';
    mode = 'idle';
    var dt = frameBegin(now);
    sIdle = clamp(s, 14, 22);
    tensionLevel += (0 - tensionLevel) * clamp01(dt / 300);
    countFade = 1;
    countNum = 0;

    syncCreatures(opts && opts.snakesPreview, now);
    modeSwitchedFromGame = false;
    steerCreatures(dt);
    particles.update(dt);
    updateFx(now);
    computeShake(now);
    prepareCreatures(now);
    updateSnow(dt);

    beginDraw();
    drawBase(dt, 0.7);
    drawSnow();
    drawCreatures(now, ssIdle);
    particles.draw(ctx);
    drawFxLayer(1, now);
    drawIdleLabels();
    drawFxLayer(2, now);
    ctx.setTransform(K, 0, 0, K, 0, 0);
    drawCaption(opts && opts.caption);
    drawFxLayer(3, now);
    drawMembrane(now);
    drawVignette(now);
    lastRenderMs = nowMs() - renderStart;
  }

  function onPointerMove(ev) {
    if (!canvas || mode !== 'idle') return;
    var r = canvas.getBoundingClientRect();
    if (!r.width) return;
    var x = (ev.clientX - r.left) / r.width * W;
    var y = (ev.clientY - r.top) / r.height * H;
    var t = nowMs();
    var dtp = t - pointerT;
    if (dtp > 0 && dtp < 200) {
      var dx = x - pointerX, dy = y - pointerY;
      pointerSpeed = Math.sqrt(dx * dx + dy * dy) / dtp * 1000 * arenaScale;
    } else {
      pointerSpeed = 0;
    }
    pointerX = x; pointerY = y; pointerT = t;
  }

  // ---------------------------------------------------------------------------
  // Hooks de eventos del servidor (5.12)
  // ---------------------------------------------------------------------------
  function isMe(id) {
    return !!(lastState && !lastState.spectating && id !== undefined && id !== null && id === lastState.myId);
  }

  function snakeColorById(id) {
    if (!lastState || !lastState.snakes) return null;
    var sn = lastState.snakes;
    for (var i = 0; i < sn.length; i++) if (sn[i] && sn[i].id === id) return sn[i].color;
    return null;
  }

  function backdropPulse(color, strength) {
    var B = global.Backdrop;
    if (B && typeof B.pulse === 'function') {
      try { B.pulse(color, strength); } catch (err) { /* el fondo vivo es opcional */ }
    }
  }

  function cellCenterX(x) { return (+x || 0) + s / 2; }
  function cellCenterY(y) { return (+y || 0) + s / 2; }

  function onFoodEaten(e) {
    if (!e || !particles) return;
    var v = clamp((e.score | 0) || 1, 1, 5);
    var col = FOOD_COL[v - 1];
    var cx = cellCenterX(e.x), cy = cellCenterY(e.y);
    setBurst(scaleCount(6 + 4 * v), col, 30, 70 + 20 * v, 380, 700, 1.2, 2.4, 'dot', -10, 0.9);
    burstNow(cx, cy);
    fxRing(cx, cy, 0.4 * s, 1.8 * s, 320, col, 0.7, 1.5, 0);
    var rec = snakeRecs.get(e.playerId);
    if (rec && rec.bulgeN < 3) rec.bulge[rec.bulgeN++] = nowMs();
    if (isMe(e.playerId)) fxText(cx, cy - 0.6 * s, '+' + v, col, labelPx() * 1.15, 18, 700);
  }

  function onHit(e) {
    if (!e || !particles) return;
    var now = nowMs();
    var cx = cellCenterX(e.x), cy = cellCenterY(e.y);
    var vp = paintFor(e.color || snakeColorById(e.targetId) || '#00ff41');
    var ap = paintFor(e.attackerColor || snakeColorById(e.attackerId) || '#4FD8FF');
    // segmentsLost llega en 0 cuando el disparo da en la cabeza de una serpiente de 1 segmento
    // (index.js, moveProjectiles): hay impacto pero no daño, así que no se muestra "−1"
    var lost = e.segmentsLost === undefined ? 1 : Math.max(0, e.segmentsLost | 0);
    var head = !!e.headshot;
    var total = Math.min(48, 10 + 5 * lost) + (head ? 12 : 0);
    total = scaleCount(total);
    var sparks = Math.round(total * 0.6);
    setBurst(sparks, vp.body, 60, 200, 500, 1000, 1.5, 3.2, 'spark', -20, 0.9);
    burstNow(cx, cy);
    setBurst(total - sparks, vp.body, 60, 200, 500, 1000, 1.5, 3.2, 'dot', -20, 0.9);
    burstNow(cx, cy);
    setBurst(scaleCount(6), ap.body, 80, 160, 250, 400, 1.2, 2.2, 'spark', 0, 0.9);
    burstNow(cx, cy);
    fxFlash(cx, cy, 2.5 * s, head ? 0.7 : 0.5, 160);
    if (head) {
      fxRing(cx, cy, 0.4 * s, 2.2 * s, 420, vp.body, 0.8, 2, 0);
      fxRing(cx, cy, 0.4 * s, 3.0 * s, 480, '#E8FBFF', 0.5, 1.5, 90);
      setBurst(scaleCount(10), vp.deep, 10, 40, 1200, 1800, 6, 14, 'ink', 0, 0.95);
      BO.alpha = 0.45;
      burstNow(cx, cy);
    }
    // cola desprendida: los últimos puntos de la víctima (todavía en su posición previa)
    var rec = snakeRecs.get(e.targetId);
    if (rec && rec.n > 1 && lost > 0) spawnTail(rec, lost, now);
    var tp = vp;
    var tx = cx, ty = cy - 0.7 * s;
    if (lost === 0) {
      fxText(tx, ty, 'Sin daño', tp.text, labelPx() * 1.05, 18, 800);
      if (isMe(e.targetId)) shake(3, 140);
      return;
    }
    fxText(tx, ty, '−' + lost, tp.text, labelPx() * 1.2, 22, 900);
    if (head) fxText(tx, ty - labelPx() * 1.25, 'cabeza', tp.text, Math.max(11, 10 / Math.max(0.1, arenaScale)), 22, 900);
    if (isMe(e.targetId)) {
      if (head) shake(10, 360); else shake(7, 280);
      backdropPulse('#FF4D6D', 0.25);
    } else if (isMe(e.attackerId)) {
      if (head) shake(4, 160); else shake(2.5, 120);
    }
  }

  function onBlock(e) {
    if (!e || !particles) return;
    var now = nowMs();
    var cx = cellCenterX(e.x), cy = cellCenterY(e.y);
    setBurst(scaleCount(14), '#9FF4FF', 40, 120, 500, 900, 1.5, 3.5, 'bubble', -40, 0.9);
    burstNow(cx, cy);
    fxRing(cx, cy, 0.4 * s, 2.0 * s, 380, '#9FF4FF', 0.8, 1.5, 0);
    fxRing(cx, cy, 0.4 * s, 2.8 * s, 420, '#9FF4FF', 0.5, 1.2, 80);
    var rec = snakeRecs.get(e.playerId);
    if (rec) rec.popT0 = now;
    if (isMe(e.playerId) || isMe(e.attackerId)) fxText(cx, cy - 0.8 * s, 'Bloqueado', '#9FF4FF', labelPx() * 1.05, 18, 900);
    if (isMe(e.playerId)) {
      shake(3, 140);
      backdropPulse('#9FF4FF', 0.15);
    }
  }

  function portalPoint(edge, cellX, cellY, out) {
    // out[0], out[1] = punto sobre el borde; out[2], out[3] = dirección hacia adentro
    if (edge === 3) { out[0] = 0; out[1] = cellY + s / 2; out[2] = 1; out[3] = 0; }
    else if (edge === 1) { out[0] = W; out[1] = cellY + s / 2; out[2] = -1; out[3] = 0; }
    else if (edge === 0) { out[0] = cellX + s / 2; out[1] = 0; out[2] = 0; out[3] = 1; }
    else { out[0] = cellX + s / 2; out[1] = H; out[2] = 0; out[3] = -1; }
  }
  var PP = new Float32Array(4);

  function portalSide(edge, cellX, cellY, paint) {
    portalPoint(edge, cellX, cellY, PP);
    var x = PP[0], y = PP[1], ix = PP[2], iy = PP[3];
    var f = fxSpawn(FX_PWAVE, nowMs(), 420);
    f.x = x; f.y = y; f.edge = edge; f.paint = paint;
    fxEdge(edge, (edge === 0 || edge === 2) ? x : y, paint, 600, 1);
    setBurst(scaleCount(6), paint.body, 30, 90, 350, 650, 1, 2, 'dot', 0, 0.9);
    BO.angle = Math.atan2(iy, ix);
    BO.spread = 1.6;
    burstNow(x + ix * 2, y + iy * 2);
  }

  function onPortal(e) {
    if (!e || !particles) return;
    var color = snakeColorById(e.playerId);
    var paint = paintFor(color || '#1FF2D2');
    var fx = e.fromX, fy = e.fromY, tx = e.toX, ty = e.toY;
    if (fx === undefined || tx === undefined) return;
    var fromEdge, toEdge;
    if (e.type === 'vertical') {
      fromEdge = fy < HALF_H ? 0 : 2;
      toEdge = ty < HALF_H ? 0 : 2;
    } else {
      fromEdge = fx < HALF_W ? 3 : 1;
      toEdge = tx < HALF_W ? 3 : 1;
    }
    portalSide(fromEdge, fx, fy, paint);
    portalSide(toEdge, tx, ty, paint);
  }

  function onProjectileFired(e) {
    if (!e || !particles) return;
    var now = nowMs();
    var paint = paintFor(e.color || snakeColorById(e.playerId) || '#4FD8FF');
    var dx = e.direction ? e.direction.x : 1, dy = e.direction ? e.direction.y : 0;
    var cx = cellCenterX(e.x), cy = cellCenterY(e.y);
    setBurst(scaleCount(6), paint.body, 80, 180, 180, 320, 1, 2, 'spark', 0, 0.88);
    BO.angle = Math.atan2(dy, dx);
    BO.spread = 0.9;
    burstNow(cx - dx * s * 0.4, cy - dy * s * 0.4);
    var rec = snakeRecs.get(e.playerId);
    if (rec && rec.n > 0) {
      rec.recoilT0 = now;
      var ti = rec.n - 1;
      var f = fxSpawn(FX_DROP, now, 500);
      f.x = rec.x[ti]; f.y = rec.y[ti]; f.r0 = 0.35 * s; f.paint = rec.paint;
      setBurst(scaleCount(4), rec.paint.body, 10, 40, 300, 500, 0.8, 1.4, 'dot', 30, 0.92);
      burstNow(f.x, f.y);
    }
    // recordar color por id (para el expirado)
    if (e.id !== undefined) {
      var tr = trails.get(e.id);
      if (!tr) { tr = newTrail(); tr.seen = frameNo; trails.set(e.id, tr); }
      tr.paint = paint; tr.color = e.color;
    }
    if (isMe(e.playerId)) shake(1.5, 80);
  }

  function onProjectileExpired(e) {
    if (!e || !particles) return;
    var tr = e.id !== undefined ? trails.get(e.id) : null;
    var paint = tr && tr.paint ? tr.paint : null;
    var col = paint ? paint.body : '#4FD8FF';
    var cx = cellCenterX(e.x), cy = cellCenterY(e.y);
    setBurst(scaleCount(7), col, 20, 60, 300, 500, 1, 2, 'dot', 0, 0.9);
    burstNow(cx, cy);
    fxRing(cx, cy, 0.3 * s, 1.0 * s, 240, col, 0.7, 1.5, 0);
    var edge = edgeOf(cx, cy);
    var dEdge = edge === 0 ? cy : (edge === 1 ? W - cx : (edge === 2 ? H - cy : cx));
    if (dEdge < 2 * s) fxEdge(edge, (edge === 0 || edge === 2) ? cx : cy, paint, 360, 0.7);
  }

  function onConsumablePicked(e) {
    if (!e || !particles) return;
    var now = nowMs();
    var rec = snakeRecs.get(e.playerId);
    var cx, cy;
    if (e.x !== undefined && e.y !== undefined) { cx = cellCenterX(e.x); cy = cellCenterY(e.y); }
    else if (rec && rec.n > 0) { cx = rec.x[0]; cy = rec.y[0]; }
    else return;
    fxRing(cx, cy, 0.5 * s, 2.4 * s, 420, '#9FF4FF', 0.8, 1.8, 0);
    var half = scaleCount(18) >> 1;
    setBurst(half, '#C9F8FF', 40, 120, 500, 900, 1.2, 2.6, 'dot', -30, 0.92);
    burstNow(cx, cy);
    setBurst(half, '#B9A6FF', 40, 120, 500, 900, 1.2, 2.6, 'dot', -30, 0.92);
    burstNow(cx, cy);
    if (rec) { rec.inflateT0 = now; rec.immune = true; }
    if (isMe(e.playerId)) backdropPulse('#9FF4FF', 0.2);
  }

  function onRoundStart() {
    var now = nowMs();
    freezeT0 = -1e9;
    freezeWinner = undefined;
    roundStartT = now;
    haloBoostT0 = now;
    sonarBase = now + 600;
    var f = fxSpawn(FX_WAVE, now, 800);
    f.x = 300; f.y = 300;
    // descartar colas desprendidas y estelas de la ronda anterior
    for (var i = 0; i < TAIL_MAX; i++) tails[i].on = false;
    trails.forEach(releaseTrail);
    trails.clear();
    foodsPrimed = false;
    lastFoodsRef = null;
    prevFoodN = 0;
    spawnN = 0;
    consPrimed = false;
    lastConsRef = null;
    prevConsIds.length = 0;
    consSpawnN = 0;
    countNum = 0;
    tensionLevel = 0;
    // el sonar triple del jugador propio lo dibuja passHead a partir de roundStartT
    // (en la primera ronda todavía no se conoce state.myId cuando llega este hook)
  }
  function releaseTrail(tr) { if (trailPool.length < 64) trailPool.push(tr); }

  function onRoundEnd(data) {
    var now = nowMs();
    var winnerId = data && data.winnerId !== undefined ? data.winnerId : null;
    freezeT0 = now;
    freezeWinner = winnerId;
    if (winnerId === null || winnerId === undefined) return;
    var rec = snakeRecs.get(winnerId);
    if (!rec) return;
    var col = fxSpawn(FX_COLUMN, now, FREEZE_MS + 400);
    col.id = winnerId; col.s = s;
    var fo = fxSpawn(FX_FOUNTAIN, now, 1300);
    fo.id = winnerId; fo.n = 0;
    if (isMe(winnerId)) backdropPulse('#C8FF3C', 0.5);
  }

  // ---------------------------------------------------------------------------
  // Init / config
  // ---------------------------------------------------------------------------
  var inited = false;

  function init(canvasEl) {
    if (!canvasEl || !canvasEl.getContext) return;
    if (inited && canvasEl === canvas) { applySize(false); return; }
    if (!global.Particles) { console.error('Arena: falta window.Particles (cargar js/fx/particles.js antes).'); return; }
    if (resizeObs) { try { resizeObs.disconnect(); } catch (err) { /* nada */ } }
    if (canvas && canvas !== canvasEl) canvas.removeEventListener('pointermove', onPointerMove);
    canvas = canvasEl;
    ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
    if (!canvas.style.width) canvas.style.width = '100%';
    if (!canvas.style.height) canvas.style.height = '100%';
    try {
      if (getComputedStyle(canvas).display === 'inline') canvas.style.display = 'block';
    } catch (err) { /* sin estilos computados */ }
    if (!inited) {
      watchMedia('(prefers-reduced-motion: reduce)', function (m) { reducedMotion = m; });
      watchMedia('(prefers-contrast: more)', function (m) { highContrast = m; });
      watchMedia('(pointer: coarse)', function (m) { coarsePointer = m; snowActive = snowCountFor(quality); });
      quality = coarsePointer ? 1 : 2;
      snowActive = snowCountFor(quality);
      particles = Particles.createSystem({ max: 600 });
      particles.setLimit(particleLimitFor(quality));
      buildCaustics();
      buildVignettes();
      buildSprites();
      initSnow();
      loadFonts();
    }
    applySize(true);
    canvas.addEventListener('pointermove', onPointerMove, { passive: true });
    if (typeof ResizeObserver !== 'undefined') {
      resizeObs = new ResizeObserver(scheduleResize);
      resizeObs.observe(canvas);
      if (canvas.parentElement) resizeObs.observe(canvas.parentElement);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', scheduleResize);
    }
    inited = true;
    // primer frame: nunca negro (fondo, nieve y viñeta; sin criaturas todavía)
    drawRestFrame();
  }

  function drawRestFrame() {
    if (!ctx || !bgCanvas) return;
    beginDraw();
    drawBase(16, 0.7);
    drawSnow();
    ctx.setTransform(K, 0, 0, K, 0, 0);
    drawMembrane(nowMs());
    drawVignette(nowMs());
  }

  function setConfig(cfg) {
    if (!cfg) return;
    var ns = +cfg.segmentSize || s;
    if (ns !== s) {
      s = ns;
      if (canvas) buildBackground();
      foodKey = '';
    }
  }

  function stats() {
    return {
      quality: quality,
      particles: particles ? particles.count() : 0,
      frameMs: frameDt,
      avgFrameMs: ftCount ? ftSum / ftCount : 0,
      renderMs: lastRenderMs,
      backing: canvas ? canvas.width : 0,
      reducedMotion: reducedMotion
    };
  }

  global.Arena = {
    init: init,
    setConfig: setConfig,
    render: render,
    renderIdle: renderIdle,
    onFoodEaten: onFoodEaten,
    onHit: onHit,
    onBlock: onBlock,
    onPortal: onPortal,
    onProjectileFired: onProjectileFired,
    onProjectileExpired: onProjectileExpired,
    onConsumablePicked: onConsumablePicked,
    onRoundStart: onRoundStart,
    onRoundEnd: onRoundEnd,
    shake: shake,
    bioColor: bioColor,
    stats: stats,
    setQuality: setQuality
  };
})(typeof window !== 'undefined' ? window : this);
