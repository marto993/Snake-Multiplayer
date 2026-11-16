/*
 * backdrop.js: fondo vivo bioluminiscente (window.Backdrop).
 *
 * Canvas #backdrop a pantalla completa, detrás de toda la experiencia. Dibuja el abismo:
 * degradado vertical, cáusticas desde la superficie, haces de luz, siluetas lejanas de
 * medusas, plancton en tres profundidades con parallax, estela del puntero, pulsos y la
 * capa coral de tensión. Los ambientes interpolan sus parámetros en 1200 ms.
 *
 * API pública (contrato + extensiones marcadas):
 *   Backdrop.init(canvasEl)
 *   Backdrop.setMood(name, opts)            name: intro|calm|lobby|room|game|tension|celebration
 *                                           opts.color (extensión): color del campeón en celebration
 *   Backdrop.pulse(color, strength)
 *   Backdrop.descend(dir)                   (extensión) empuje del plancton: +1 hacia arriba (bajar), -1 hacia abajo
 *   Backdrop.burst(x, y, opts)              (extensión) ráfaga de partículas en coordenadas de viewport
 *   Backdrop.beginIntro(variant)            (extensión, la usa Scenes) 'full' | 'short' | 'reduced'
 *   Backdrop.skipIntro()                    (extensión, la usa Scenes)
 *   Backdrop.introCreatureX()               (extensión, la usa Scenes) x de la cabeza de la criatura de la intro
 *   Backdrop.mood()                         (extensión) ambiente actual
 *   Backdrop.stats()                        (diagnóstico) { mood, fps, costMs, plankton, fx, res, running }
 *
 * Sin dependencias. Sin allocations por frame en el bucle de dibujo.
 */
(function (global) {
  'use strict';

  if (global.Backdrop && global.Backdrop.__bio) return;

  var doc = global.document;
  var TAU = Math.PI * 2;

  function now() { return (global.performance && global.performance.now) ? global.performance.now() : Date.now(); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }
  function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
  function easeOutCubic(t) { var u = 1 - t; return 1 - u * u * u; }
  function easeInQuart(t) { return t * t * t * t; }
  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  function parseColor(c) {
    if (typeof c !== 'string') return null;
    c = c.trim();
    if (c.charAt(0) === '#') {
      var h = c.slice(1);
      if (h.length === 3 || h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      if (h.length >= 6) {
        var n = parseInt(h.slice(0, 6), 16);
        if (!isNaN(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }
      return null;
    }
    var m = c.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
    return null;
  }
  function rgba(rgb, a) { return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')'; }
  function mix(a, b, t) { return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]; }

  function makeCanvas(w, h) {
    var c = doc.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  // ---------------------------------------------------------------------------------------
  // Preferencias del dispositivo
  // ---------------------------------------------------------------------------------------
  var mqReduced = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var mqCoarse = global.matchMedia ? global.matchMedia('(pointer: coarse)') : null;
  var reduced = !!(mqReduced && mqReduced.matches);
  var coarse = !!(mqCoarse && mqCoarse.matches);
  function listenMQ(mq, fn) {
    if (!mq) return;
    if (mq.addEventListener) mq.addEventListener('change', fn); else if (mq.addListener) mq.addListener(fn);
  }
  listenMQ(mqReduced, function (e) { reduced = !!e.matches; });

  // ---------------------------------------------------------------------------------------
  // Ambientes
  // ---------------------------------------------------------------------------------------
  var K_R = 0, K_G = 1, K_B = 2, K_DENS = 3, K_SPEED = 4, K_BEAMS = 5, K_SIL1 = 6, K_SIL2 = 7,
      K_TRAIL = 8, K_CORAL = 9, K_CHAMP = 10, NK = 11;

  function moodVec(top, density, speed, beams, sils, trail, coral, champ) {
    var v = new Float32Array(NK), rgb = parseColor(top);
    v[K_R] = rgb[0]; v[K_G] = rgb[1]; v[K_B] = rgb[2];
    v[K_DENS] = density; v[K_SPEED] = speed; v[K_BEAMS] = beams;
    v[K_SIL1] = sils >= 1 ? 1 : 0; v[K_SIL2] = sils >= 2 ? 1 : 0;
    v[K_TRAIL] = trail; v[K_CORAL] = coral; v[K_CHAMP] = champ;
    return v;
  }

  var MOODS = {
    intro:       { v: moodVec('#06304A', 0.6, 1.0, 0.16, 2, 1, 0, 0),   fps: 60, res: 0.5 },
    calm:        { v: moodVec('#052538', 0.8, 0.8, 0.10, 2, 1, 0, 0),   fps: 60, res: 0.5 },
    lobby:       { v: moodVec('#041D2E', 1.0, 1.0, 0.07, 1, 1, 0, 0),   fps: 60, res: 0.5 },
    room:        { v: moodVec('#03141F', 0.8, 0.9, 0.04, 0, 1, 0, 0),   fps: 60, res: 0.5 },
    game:        { v: moodVec('#020C14', 0.45, 0.7, 0, 0, 0, 0, 0),     fps: 30, res: 0.35 },
    tension:     { v: moodVec('#1A0710', 0.45, 1.6, 0, 0, 0, 1, 0),     fps: 30, res: 0.35 },
    celebration: { v: moodVec('#04283A', 1.4, 2.5, 0.06, 0, 0, 0, 0.6), fps: 60, res: 0.5 }
  };
  var BLACK_VEC = moodVec('#010509', 0, 1.0, 0, 0, 1, 0, 0);
  var scratchVec = new Float32Array(NK);

  var cur = new Float32Array(NK), trFrom = new Float32Array(NK), trTo = new Float32Array(NK);
  cur.set(MOODS.intro.v);
  var trT0 = 0, trDur = 0, trActive = false;
  var moodName = null, targetFps = 60, res = 0.5;

  function transitionParams(vec, dur) {
    trFrom.set(cur);
    trTo.set(vec);
    if (!(dur > 0)) { cur.set(vec); trActive = false; return; }
    trT0 = now(); trDur = dur; trActive = true;
  }
  function stepTransition(t) {
    if (!trActive) return;
    var p = clamp((t - trT0) / trDur, 0, 1), e = easeInOutSine(p);
    for (var k = 0; k < NK; k++) cur[k] = trFrom[k] + (trTo[k] - trFrom[k]) * e;
    if (p >= 1) trActive = false;
  }

  // ---------------------------------------------------------------------------------------
  // Canvas y estado general
  // ---------------------------------------------------------------------------------------
  var canvas = null, ctx = null;
  var cssW = 1, cssH = 1, maxSide = 1;
  var running = false, rafId = 0, lastT = 0, lastDraw = 0;
  var resizeTimer = 0;
  var topStr = '#010509', topR = -1, topG = -1, topB = -1;

  // ---------------------------------------------------------------------------------------
  // Paleta y sprites
  // ---------------------------------------------------------------------------------------
  var C_TURQ = 0, C_CYAN = 1, C_LIME = 2, C_VIOLET = 3, C_PEARL = 4, C_CHAMP = 5, C_CORAL = 6, PAL_FIXED = 7, PAL_MAX = 20;
  var palKey = [], palRGB = [], palDot = [], palSoft = [];
  var pulseSprites = {}; var pulseSpriteKeys = [];

  function makeDotSprite(rgb) {
    var s = 32, c = makeCanvas(s, s), g = c.getContext('2d');
    var grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    var core = mix(rgb, [240, 255, 255], 0.55);
    grd.addColorStop(0, rgba(core, 1));
    grd.addColorStop(0.12, rgba(rgb, 0.95));
    grd.addColorStop(0.3, rgba(rgb, 0.42));
    grd.addColorStop(0.58, rgba(rgb, 0.11));
    grd.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    return c;
  }
  function makeSoftSprite(rgb) {
    var s = 64, c = makeCanvas(s, s), g = c.getContext('2d');
    var grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, rgba(rgb, 0.75));
    grd.addColorStop(0.45, rgba(rgb, 0.32));
    grd.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    return c;
  }
  function setPal(i, hex) {
    var rgb = parseColor(hex) || [31, 242, 210];
    palKey[i] = hex.toLowerCase();
    palRGB[i] = rgb;
    palDot[i] = makeDotSprite(rgb);
    palSoft[i] = makeSoftSprite(rgb);
  }
  function initPalette() {
    setPal(C_TURQ, '#1FF2D2'); setPal(C_CYAN, '#4FD8FF'); setPal(C_LIME, '#C8FF3C');
    setPal(C_VIOLET, '#A98BFF'); setPal(C_PEARL, '#E8FBFF'); setPal(C_CHAMP, '#C8FF3C');
    setPal(C_CORAL, '#FF4D6D');
  }
  function colorIndex(hex) {
    if (typeof hex !== 'string') return C_TURQ;
    var key = hex.toLowerCase();
    for (var i = 0; i < palKey.length; i++) if (palKey[i] === key && i !== C_CHAMP) return i;
    if (!parseColor(hex)) return C_TURQ;
    var idx = palKey.length < PAL_MAX ? palKey.length : PAL_FIXED + ((palKey.length) % (PAL_MAX - PAL_FIXED));
    setPal(idx, hex);
    return idx;
  }
  function setChampColor(rgbOrHex) {
    var rgb = typeof rgbOrHex === 'string' ? parseColor(rgbOrHex) : rgbOrHex;
    if (!rgb) return;
    var hex = '#' + ((1 << 24) | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]).toString(16).slice(1);
    palKey[C_CHAMP] = '#champ:' + hex;
    palRGB[C_CHAMP] = rgb;
    palDot[C_CHAMP] = makeDotSprite(rgb);
    palSoft[C_CHAMP] = makeSoftSprite(rgb);
  }

  function pulseSprite(hex) {
    var key = (hex || '#1FF2D2').toLowerCase();
    var spr = pulseSprites[key];
    if (spr) return spr;
    var rgb = parseColor(key) || [31, 242, 210];
    var s = 256, c = makeCanvas(s, s), g = c.getContext('2d');
    var grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, rgba(rgb, 0.22));
    grd.addColorStop(0.55, rgba(rgb, 0.5));
    grd.addColorStop(0.82, rgba(rgb, 1));
    grd.addColorStop(0.9, rgba(rgb, 0.55));
    grd.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    pulseSprites[key] = c;
    pulseSpriteKeys.push(key);
    if (pulseSpriteKeys.length > 12) delete pulseSprites[pulseSpriteKeys.shift()];
    return c;
  }

  // Cachés independientes del tamaño de pantalla (se dibujan estirados).
  var darkGrad = null, beamSprite = null, coralSprite = null, bellSprite = null, causticPattern = null, causticTile = null;

  function buildCaches() {
    // Degradado que hunde la mitad inferior en la negrura (#010509).
    darkGrad = makeCanvas(4, 256);
    var g = darkGrad.getContext('2d');
    var grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, 'rgba(1,5,9,0)');
    grd.addColorStop(0.16, 'rgba(1,5,9,0.22)');
    grd.addColorStop(0.4, 'rgba(1,5,9,0.86)');
    grd.addColorStop(1, 'rgba(1,5,9,1)');
    g.fillStyle = grd; g.fillRect(0, 0, 4, 256);

    // Haz de luz: azul abismo brillante arriba, 0 al 70 % del alto, bordes laterales suaves.
    beamSprite = makeCanvas(64, 512);
    g = beamSprite.getContext('2d');
    grd = g.createLinearGradient(0, 0, 64, 0);
    grd.addColorStop(0, 'rgba(42,111,219,0)');
    grd.addColorStop(0.3, 'rgba(42,111,219,0.55)');
    grd.addColorStop(0.5, 'rgba(70,140,235,1)');
    grd.addColorStop(0.7, 'rgba(42,111,219,0.55)');
    grd.addColorStop(1, 'rgba(42,111,219,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 512);
    g.globalCompositeOperation = 'destination-in';
    grd = g.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, 'rgba(0,0,0,1)');
    grd.addColorStop(0.35, 'rgba(0,0,0,0.45)');
    grd.addColorStop(0.7, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 512);

    // Capa coral de tensión: más intensa en los bordes.
    coralSprite = makeCanvas(256, 256);
    g = coralSprite.getContext('2d');
    grd = g.createRadialGradient(128, 128, 0, 128, 128, 182);
    grd.addColorStop(0, 'rgba(255,77,109,0.25)');
    grd.addColorStop(0.6, 'rgba(255,77,109,0.6)');
    grd.addColorStop(1, 'rgba(255,77,109,1)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);

    // Campana de medusa lejana.
    bellSprite = makeCanvas(256, 176);
    g = bellSprite.getContext('2d');
    g.beginPath();
    g.moveTo(8, 150);
    g.bezierCurveTo(8, -26, 248, -26, 248, 150);
    var sc = 9, w = 240 / sc;
    for (var i = 0; i < sc; i++) {
      var x0 = 248 - i * w;
      g.quadraticCurveTo(x0 - w / 2, 170, x0 - w, 150);
    }
    g.closePath();
    grd = g.createLinearGradient(0, 0, 0, 170);
    grd.addColorStop(0, 'rgba(18,70,98,1)');
    grd.addColorStop(0.7, 'rgba(14,58,82,0.85)');
    grd.addColorStop(1, 'rgba(14,58,82,0.45)');
    g.fillStyle = grd; g.fill();
    g.strokeStyle = 'rgba(46,122,156,0.55)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(40, 140); g.bezierCurveTo(44, 20, 212, 20, 216, 140); g.stroke();
    g.strokeStyle = 'rgba(46,122,156,0.25)'; g.lineWidth = 2;
    for (i = 1; i < 5; i++) {
      var cx = 128 + (i - 2.5) * 44;
      g.beginPath(); g.moveTo(128, 34); g.quadraticCurveTo(cx, 70, cx * 1.02 - 2, 146); g.stroke();
    }

    buildCaustics();
  }

  // Textura de cáusticas: venas de un Voronoi repetible (F2 - F1) con el dominio ondulado
  // (senos de frecuencia entera, así la textura sigue siendo repetible), teñida de cian.
  var CS = 256;
  function buildCaustics() {
    var S = CS, N = 14;
    var pts = new Float32Array(N * 2);
    for (var i = 0; i < N; i++) { pts[i * 2] = Math.random() * S; pts[i * 2 + 1] = Math.random() * S; }
    causticTile = makeCanvas(S, S);
    var g = causticTile.getContext('2d');
    var img = g.createImageData(S, S), d = img.data;
    var w = TAU / S;
    for (var y = 0; y < S; y++) {
      for (var x = 0; x < S; x++) {
        var wx = x + 9 * Math.sin(y * w * 2 + 1.3) + 4 * Math.sin(y * w * 5 + x * w * 1);
        var wy = y + 9 * Math.sin(x * w * 2 + 0.4) + 4 * Math.sin(x * w * 4 - y * w * 1);
        var f1 = 1e9, f2 = 1e9;
        for (var k = 0; k < N; k++) {
          var dx = Math.abs(wx - pts[k * 2]) % S; if (dx > S / 2) dx = S - dx;
          var dy = Math.abs(wy - pts[k * 2 + 1]) % S; if (dy > S / 2) dy = S - dy;
          var dd = dx * dx + dy * dy;
          if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
        }
        f1 = Math.sqrt(f1); f2 = Math.sqrt(f2);
        var v = 1 - smoothstep(0, 0.03, (f2 - f1) / S);
        v = Math.pow(v, 2.2) * 0.85;
        var o = (y * S + x) * 4;
        d[o] = 79; d[o + 1] = 216; d[o + 2] = 255; d[o + 3] = Math.round(v * 255);
      }
    }
    g.putImageData(img, 0, 0);
    causticPattern = null;
  }

  // ---------------------------------------------------------------------------------------
  // Plancton (tres profundidades)
  // ---------------------------------------------------------------------------------------
  var LAYER_BASE = [90, 50, 12];
  var LAYER_MAX = coarse ? [54, 28, 8] : [96, 52, 12];   // 160 en total (90 con pointer: coarse)
  var LAYER_START = [0, LAYER_MAX[0], LAYER_MAX[0] + LAYER_MAX[1]];
  var NP = LAYER_MAX[0] + LAYER_MAX[1] + LAYER_MAX[2];
  var LAYER_PARALLAX = [5, 13, 28];
  var LAYER_PUSH = [0.55, 1, 1.9];
  var pX = new Float32Array(NP), pY = new Float32Array(NP), pA = new Float32Array(NP), pS = new Float32Array(NP),
      pRise = new Float32Array(NP), pSwW = new Float32Array(NP), pSwP = new Float32Array(NP),
      pChamp = new Float32Array(NP), pFlash = new Float32Array(NP), pExc = new Float32Array(NP),
      pRank = new Float32Array(NP);
  var pCol = new Uint8Array(NP), pLayer = new Uint8Array(NP);
  var parX = new Float32Array(3), parY = new Float32Array(3);

  function pickPlanktonColor() {
    var r = Math.random();
    if (r < 0.7) return Math.random() < 0.55 ? C_TURQ : C_CYAN;
    if (r < 0.9) return C_LIME;
    return C_VIOLET;
  }
  function initPlankton() {
    for (var L = 0; L < 3; L++) {
      for (var k = 0; k < LAYER_MAX[L]; k++) {
        var i = LAYER_START[L] + k;
        pLayer[i] = L; pRank[i] = k;
        pX[i] = Math.random() * cssW; pY[i] = Math.random() * cssH;
        if (L === 0) { pS[i] = rand(0.6, 1.2); pA[i] = rand(0.15, 0.30); pRise[i] = rand(3, 6); }
        else if (L === 1) { pS[i] = rand(1.2, 2.2); pA[i] = rand(0.25, 0.50); pRise[i] = rand(6, 12); }
        else { pS[i] = rand(6, 16); pA[i] = rand(0.06, 0.12); pRise[i] = rand(10, 18); }
        pSwW[i] = TAU / rand(6000, 11000);
        pSwP[i] = Math.random() * TAU;
        pCol[i] = L === 2 ? (Math.random() < 0.6 ? C_TURQ : C_CYAN) : pickPlanktonColor();
        pChamp[i] = Math.random();
        pFlash[i] = -1; pExc[i] = 0;
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // Partículas de efecto (estela, ráfagas, intro). Pool fijo, reemplaza a la más vieja.
  // ---------------------------------------------------------------------------------------
  var FX_MAX = coarse ? 60 : 100;
  var fX = new Float32Array(FX_MAX), fY = new Float32Array(FX_MAX), fVX = new Float32Array(FX_MAX), fVY = new Float32Array(FX_MAX),
      fAge = new Float32Array(FX_MAX), fLife = new Float32Array(FX_MAX), fSize = new Float32Array(FX_MAX),
      fAlpha = new Float32Array(FX_MAX), fGrav = new Float32Array(FX_MAX), fDrag = new Float32Array(FX_MAX);
  var fCol = new Uint8Array(FX_MAX);
  var fxNext = 0;

  function fxEmit(x, y, vx, vy, life, size, col, grav, drag, alpha) {
    var i = fxNext;
    fxNext = (fxNext + 1) % FX_MAX;
    fX[i] = x; fY[i] = y; fVX[i] = vx; fVY[i] = vy; fAge[i] = 0; fLife[i] = life;
    fSize[i] = size; fCol[i] = col; fGrav[i] = grav; fDrag[i] = drag; fAlpha[i] = alpha;
  }
  function rangeVal(v, a, b) {
    if (v == null) return rand(a, b);
    if (typeof v === 'number') return v;
    if (v.length === 2) return rand(v[0], v[1]);
    return rand(a, b);
  }
  function burst(x, y, opts) {
    opts = opts || {};
    var count = opts.count == null ? 24 : opts.count;
    if (reduced) count = Math.ceil(count / 2);
    var col = colorIndex(opts.color || '#1FF2D2');
    var col2 = opts.color2 ? colorIndex(opts.color2) : col;
    var spread = opts.spread == null ? TAU : opts.spread;
    var angle = opts.angle == null ? 0 : opts.angle;
    var grav = opts.gravity == null ? -12 : opts.gravity;
    var drag = opts.drag == null ? 0.94 : opts.drag;
    for (var i = 0; i < count; i++) {
      var a = angle + (Math.random() - 0.5) * spread;
      var sp = rangeVal(opts.speed, 40, 140);
      fxEmit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rangeVal(opts.life, 700, 1400) / 1000,
        rangeVal(opts.size, 1.2, 3), (i % 3 === 2) ? col2 : col, grav, drag, opts.alpha == null ? 1 : opts.alpha);
    }
    ensureRunning();
  }

  // ---------------------------------------------------------------------------------------
  // Pulsos
  // ---------------------------------------------------------------------------------------
  var PULSES = 3;
  var puT0 = new Float64Array(PULSES), puStr = new Float32Array(PULSES), puSpr = new Array(PULSES), puOn = new Uint8Array(PULSES);
  function pulse(color, strength) {
    if (!canvas) return;
    var s = strength == null ? 0.3 : +strength;
    if (!(s > 0)) return;
    var slot = -1, oldest = Infinity;
    for (var i = 0; i < PULSES; i++) {
      if (!puOn[i]) { slot = i; break; }
      if (puT0[i] < oldest) { oldest = puT0[i]; slot = i; }
    }
    puOn[slot] = 1; puT0[slot] = now(); puStr[slot] = clamp(s, 0, 1.5); puSpr[slot] = pulseSprite(color || '#1FF2D2');
    ensureRunning();
  }

  // ---------------------------------------------------------------------------------------
  // Empuje de descenso
  // ---------------------------------------------------------------------------------------
  var pushT0 = -1e9, pushDir = 0;
  function descend(dir) {
    if (reduced) return;
    pushDir = dir < 0 ? -1 : 1;
    pushT0 = now();
  }
  function pushSpeed(t) {
    var e = t - pushT0;
    if (e < 0 || e > 900) return 0;
    return 60 * pushDir * (1 - easeOutExpo(e / 900));
  }

  // ---------------------------------------------------------------------------------------
  // Puntero (el momento firma: el agua reacciona)
  // ---------------------------------------------------------------------------------------
  var ptrX = -1e4, ptrY = -1e4, ptrHas = false, ptrSpeed = 0, ptrLastT = 0, ptrPrevX = 0, ptrPrevY = 0;
  var emitX = 0, emitY = 0, emitPending = false;
  var parTX = 0, parTY = 0;

  function onPointer(x, y) {
    var t = now();
    if (ptrHas) {
      var dt = Math.max(1, t - ptrLastT), dx = x - ptrPrevX, dy = y - ptrPrevY;
      var inst = Math.sqrt(dx * dx + dy * dy) / dt * 1000;
      ptrSpeed = ptrSpeed * 0.6 + inst * 0.4;
    } else {
      emitX = x; emitY = y;
    }
    ptrPrevX = x; ptrPrevY = y; ptrLastT = t;
    ptrX = x; ptrY = y; ptrHas = true; emitPending = true;
    parTX = cssW > 0 ? (x / cssW - 0.5) : 0;
    parTY = cssH > 0 ? (y / cssH - 0.5) : 0;
  }
  function bindPointer() {
    var opt = { passive: true };
    global.addEventListener('pointermove', function (e) { onPointer(e.clientX, e.clientY); }, opt);
    global.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse') { ptrHas = false; onPointer(e.clientX, e.clientY); }
    }, opt);
    global.addEventListener('touchmove', function (e) {
      if (e.touches && e.touches[0]) onPointer(e.touches[0].clientX, e.touches[0].clientY);
    }, opt);
    global.addEventListener('blur', function () { ptrSpeed = 0; });
  }

  // ---------------------------------------------------------------------------------------
  // Siluetas lejanas
  // ---------------------------------------------------------------------------------------
  var sils = [{ x: 0, y: 0, size: 160, ph: 0, vy: 0 }, { x: 0, y: 0, size: 140, ph: 1, vy: 0 }];
  function resetSil(s, initial) {
    s.size = rand(120, 220);
    s.x = rand(0.08, 0.92) * cssW;
    s.y = initial ? rand(0.25, 0.95) * cssH : cssH + s.size * 1.4;
    s.vy = (cssH + s.size * 2.6) / 60;
    s.ph = Math.random() * TAU;
  }

  // ---------------------------------------------------------------------------------------
  // Intro: destello, cascada en espiral y criatura de luz
  // ---------------------------------------------------------------------------------------
  var NSPARK = 49;
  var skX = new Float32Array(NSPARK), skY = new Float32Array(NSPARK), skD = new Float32Array(NSPARK),
      skS = new Float32Array(NSPARK);
  var skC = new Uint8Array(NSPARK);
  var introT0 = -1, introVariant = null, introCreatureOn = false;
  var CREATURE_N = 12, CREATURE_SPACING = 16, CREATURE_S = 20;
  var crX = new Float32Array(CREATURE_N), crY = new Float32Array(CREATURE_N);
  var crRamp = [], crHeadX = -1e4;
  (function buildCreatureRamp() {
    var body = [31, 242, 210], deep = [3, 70, 63];
    for (var i = 0; i < CREATURE_N; i++) {
      var t = i / (CREATURE_N - 1);
      var c = mix(body, deep, smoothstep(0.15, 1, t) * 0.85);
      crRamp.push(rgba(c, t < 0.7 ? 1 : (1 - (t - 0.7) / 0.3 * 0.65).toFixed(3)));
    }
  })();

  function buildSparks() {
    var ox = cssW * 0.4, oy = cssH * 0.55;
    var scale = clamp(Math.min(cssW, cssH) / 900, 0.45, 1.3);
    var rmax = 400 * scale;
    skX[0] = ox; skY[0] = oy; skD[0] = 150; skS[0] = 3.2; skC[0] = C_PEARL;
    for (var k = 1; k < NSPARK; k++) {
      var arm = k & 1, j = (k - 1) >> 1;          // dos brazos de 24 puntos
      var f = (j + 1) / 24;
      var ang = arm * Math.PI + f * TAU * 1.25 - 0.6;
      var r = 18 * scale + (rmax - 18 * scale) * Math.pow(f, 0.85);
      skX[k] = ox + Math.cos(ang) * r + rand(-10, 10) * scale;
      skY[k] = oy + Math.sin(ang) * r * 0.82 + rand(-10, 10) * scale;
      var dist = Math.sqrt((skX[k] - ox) * (skX[k] - ox) + (skY[k] - oy) * (skY[k] - oy));
      skD[k] = 400 + dist / (0.45 * scale) + rand(-60, 60);
      skS[k] = rand(1.6, 3.0);
      var rc = Math.random();
      skC[k] = rc < 0.7 ? (Math.random() < 0.55 ? C_TURQ : C_CYAN) : (rc < 0.9 ? C_LIME : C_VIOLET);
    }
  }

  function creatureHeadX(t) {
    var p = (t - introT0 - 900) / 1200;
    return -60 + (cssW + 60 + CREATURE_N * CREATURE_SPACING + 60) * p;
  }
  function creatureY(x) { return cssH * 0.35 + 40 * Math.sin(TAU * x / 420); }

  // Timeline (eventos programados por tiempo; se procesan en el frame)
  var evAt = [], evFn = [];
  function schedule(delay, fn) { evAt.push(now() + delay); evFn.push(fn); ensureRunning(); }
  function cancelTimeline() { evAt.length = 0; evFn.length = 0; }
  function runTimeline(t) {
    for (var i = 0; i < evAt.length; i++) {
      if (t >= evAt[i]) {
        var fn = evFn[i];
        evAt.splice(i, 1); evFn.splice(i, 1); i--;
        try { fn(); } catch (e) { /* nada */ }
      }
    }
  }

  function beginIntro(variant) {
    if (!canvas) return;
    variant = reduced ? 'reduced' : (variant || 'full');
    cancelTimeline();
    moodName = 'intro'; targetFps = 60; setRes(0.5);
    introVariant = variant;
    introT0 = now();
    if (variant === 'full') {
      scratchVec.set(BLACK_VEC);
      transitionParams(scratchVec, 0);
      buildSparks();
      introCreatureOn = true;
      schedule(400, function () {
        scratchVec.set(MOODS.intro.v); scratchVec[K_DENS] = 0; scratchVec[K_BEAMS] = 0;
        scratchVec[K_SIL1] = 0; scratchVec[K_SIL2] = 0;
        transitionParams(scratchVec, 1200);
      });
      schedule(2400, function () { transitionParams(MOODS.intro.v, 900); });
    } else if (variant === 'short') {
      scratchVec.set(BLACK_VEC); transitionParams(scratchVec, 0);
      introCreatureOn = false;
      transitionParams(MOODS.intro.v, 900);
    } else {
      introCreatureOn = false;
      scratchVec.set(BLACK_VEC); transitionParams(scratchVec, 0);
      transitionParams(MOODS.intro.v, 400);
    }
    ensureRunning();
  }
  function skipIntro() {
    if (introT0 < 0) return;
    cancelTimeline();
    if (moodName === 'intro') transitionParams(MOODS.intro.v, 500);
  }
  function introCreatureX() {
    if (!canvas || introT0 < 0 || !introCreatureOn) return null;
    var t = now() - introT0;
    if (t < 900) return -Infinity;
    if (t > 2400) return Infinity;
    return creatureHeadX(now());
  }

  // ---------------------------------------------------------------------------------------
  // Ambientes públicos
  // ---------------------------------------------------------------------------------------
  function setMood(name, opts) {
    var m = MOODS[name];
    if (!m) return;
    opts = opts || {};
    var color = opts.color ? parseColor(opts.color) : null;
    if (name === moodName && !(name === 'celebration' && color)) return;
    cancelTimeline();
    moodName = name;
    targetFps = m.fps;
    setRes(m.res);
    if (name === 'celebration') {
      setChampColor(color || [200, 255, 60]);
    }
    transitionParams(m.v, reduced ? 400 : 1200);
    if (name === 'celebration') scheduleCelebration();
    ensureRunning();
  }

  function scheduleCelebration() {
    var champHex = palRGB[C_CHAMP] ? '#' + ((1 << 24) | (palRGB[C_CHAMP][0] << 16) | (palRGB[C_CHAMP][1] << 8) | palRGB[C_CHAMP][2]).toString(16).slice(1) : '#C8FF3C';
    for (var i = 0; i < 6; i++) {
      (function (k) {
        schedule(250 + k * 500, function () {
          var bx = rand(0.12, 0.88) * cssW, by = rand(0.16, 0.72) * cssH;
          // destello local que se abre y se apaga, y la ráfaga de plancton del campeón
          fxEmit(bx, by, 0, 0, 0.75, 26, colorIndex(champHex), 0, 1, reduced ? 0.12 : 0.32);
          burst(bx, by, {
            count: 40, color: champHex, color2: '#E8FBFF', speed: [50, 210], life: [1100, 2000],
            size: [1.6, 3.8], gravity: -14, drag: 0.95
          });
        });
      })(i);
    }
    schedule(6000, function () {
      scratchVec.set(MOODS.celebration.v); scratchVec[K_DENS] = 1.0; scratchVec[K_SPEED] = 1.0;
      transitionParams(scratchVec, 1200);
    });
  }

  // ---------------------------------------------------------------------------------------
  // Tamaño
  // ---------------------------------------------------------------------------------------
  function setRes(r) {
    if (r === res && canvas && canvas.width === Math.max(1, Math.round(cssW * res))) return;
    res = r;
    applySize();
  }
  function applySize() {
    if (!canvas) return;
    var w = Math.max(1, global.innerWidth || doc.documentElement.clientWidth || 1);
    var h = Math.max(1, global.innerHeight || doc.documentElement.clientHeight || 1);
    if (cssW > 1 && cssH > 1 && (w !== cssW || h !== cssH)) {
      var sx = w / cssW, sy = h / cssH;
      for (var i = 0; i < NP; i++) { pX[i] *= sx; pY[i] *= sy; }
      sils[0].x *= sx; sils[1].x *= sx;
    }
    cssW = w; cssH = h; maxSide = Math.max(w, h);
    var bw = Math.max(1, Math.round(w * res)), bh = Math.max(1, Math.round(h * res));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    causticPattern = null;
    topR = -1;
  }
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { resizeTimer = 0; applySize(); ensureRunning(); }, 100);
  }

  // ---------------------------------------------------------------------------------------
  // Paso de simulación
  // ---------------------------------------------------------------------------------------
  function visibleCount(L) {
    var c = LAYER_BASE[L] * cur[K_DENS] * (coarse ? 0.6 : 1);
    return c > LAYER_MAX[L] ? LAYER_MAX[L] : c;
  }

  function step(t, dtMs) {
    var dt = dtMs / 1000;
    runTimeline(t);
    stepTransition(t);

    var speedMul = cur[K_SPEED] * (reduced ? 0.15 : 1);
    var push = pushSpeed(t);
    var trailOn = cur[K_TRAIL] > 0.5 && !reduced;
    var ptrActive = trailOn && ptrHas && (t - ptrLastT) < 160 && ptrSpeed > 40;
    var ptrFactor = ptrActive ? clamp(ptrSpeed / 1200, 0, 1) : 0;
    var excDecay = dt / 0.9;

    // Parallax suave hacia el puntero
    var k = clamp(dt * 2.2, 0, 1);
    for (var L = 0; L < 3; L++) {
      parX[L] += (-parTX * LAYER_PARALLAX[L] - parX[L]) * k;
      parY[L] += (-parTY * LAYER_PARALLAX[L] * 0.6 - parY[L]) * k;
    }

    // Criatura de la intro como "puntero virtual" que enciende el plancton
    var crOn = false;
    if (introCreatureOn && introT0 >= 0) {
      var it = t - introT0;
      if (it >= 900 && it <= 2500) {
        crOn = true;
        crHeadX = creatureHeadX(t);
        for (var c = 0; c < CREATURE_N; c++) {
          crX[c] = crHeadX - c * CREATURE_SPACING;
          crY[c] = creatureY(crX[c]);
        }
        // estela de plancton encendido
        if (crHeadX > -20 && crHeadX < cssW + 20) {
          var tx = crX[CREATURE_N - 1], ty = crY[CREATURE_N - 1];
          fxEmit(tx + rand(-4, 4), ty + rand(-4, 4), rand(-12, 12), rand(-14, 4), rand(0.9, 1.5), rand(1, 2.4),
            Math.random() < 0.8 ? C_TURQ : C_LIME, -6, 0.97, 0.9);
          fxEmit(crX[5] + rand(-6, 6), crY[5] + rand(-6, 6), rand(-10, 10), rand(-10, 6), rand(0.8, 1.3), rand(0.8, 1.8),
            C_CYAN, -6, 0.97, 0.7);
        }
      } else if (it > 2500) {
        introCreatureOn = false;
      }
    }

    for (var i = 0; i < NP; i++) {
      var Ly = pLayer[i];
      pY[i] -= (pRise[i] * speedMul + push * LAYER_PUSH[Ly]) * dt;
      if (pY[i] < -24) { pY[i] += cssH + 48; pX[i] = Math.random() * cssW; }
      else if (pY[i] > cssH + 24) { pY[i] -= cssH + 48; pX[i] = Math.random() * cssW; }

      if (Ly < 2) {
        if (pFlash[i] >= 0) {
          pFlash[i] += dtMs;
          if (pFlash[i] > 720) pFlash[i] = -1;
        } else if (!reduced && Math.random() < 0.03 * dt) {
          pFlash[i] = 0;
        }
      }
      if (pExc[i] > 0) { pExc[i] -= excDecay; if (pExc[i] < 0) pExc[i] = 0; }

      if (ptrFactor > 0 || crOn) {
        var px = pX[i] + parX[Ly], py = pY[i] + parY[Ly];
        if (ptrFactor > 0) {
          var dx = px - ptrX, dy = py - ptrY, d2 = dx * dx + dy * dy;
          if (d2 < 8100) {
            var e = ptrFactor * (1 - Math.sqrt(d2) / 90);
            if (e > pExc[i]) pExc[i] = e;
          }
        }
        if (crOn) {
          var cx = px - crHeadX, cy = py - crY[0], c2 = cx * cx + cy * cy;
          if (c2 < 12100) {
            var e2 = 1 - Math.sqrt(c2) / 110;
            if (e2 > pExc[i]) pExc[i] = e2;
          }
        }
      }
    }

    // Estela del puntero
    if (trailOn && emitPending && ptrHas) {
      var ex = ptrX - emitX, ey = ptrY - emitY, dist = Math.sqrt(ex * ex + ey * ey);
      var n = Math.min(4, Math.floor(dist / 7));
      if (n >= 1) {
        var inv = 1 / (dist || 1), nx = -ey * inv, ny = ex * inv;
        for (var j = 0; j < n; j++) {
          var f = (j + 1) / n, off = rand(-5, 5);
          var big = Math.random() < 0.12;
          fxEmit(emitX + ex * f + nx * off, emitY + ey * f + ny * off,
            nx * off * 2.2 + rand(-10, 10) + ex * inv * 6, ny * off * 2.2 + rand(-16, 4) + ey * inv * 6,
            rand(0.9, 1.4), big ? rand(2.4, 3.4) : rand(1, 2.2), Math.random() < 0.8 ? (Math.random() < 0.7 ? C_TURQ : C_CYAN) : C_LIME,
            -6, 0.95, big ? 0.55 : 0.95);
        }
        emitX = ptrX; emitY = ptrY;
      }
      if (dist < 7) emitPending = false;
    } else if (!trailOn) {
      emitX = ptrX; emitY = ptrY; emitPending = false;
    }

    // FX
    for (var q = 0; q < FX_MAX; q++) {
      if (fLife[q] <= 0) continue;
      fAge[q] += dt;
      if (fAge[q] >= fLife[q]) { fLife[q] = 0; continue; }
      var dr = Math.pow(fDrag[q], dt * 60);
      fVX[q] *= dr; fVY[q] = fVY[q] * dr + fGrav[q] * dt;
      fX[q] += fVX[q] * dt; fY[q] += fVY[q] * dt;
    }

    // Siluetas
    for (var s = 0; s < 2; s++) {
      var sl = sils[s];
      sl.y -= sl.vy * dt * (reduced ? 0.2 : 1);
      if (sl.y < -sl.size * 1.6) resetSil(sl, false);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Dibujo
  // ---------------------------------------------------------------------------------------
  var causticOff = new Float32Array(4);

  function draw(t, dtMs) {
    var g = ctx;
    g.setTransform(res, 0, 0, res, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;

    // 1. Color superior del ambiente
    var r = Math.round(cur[K_R]), gg = Math.round(cur[K_G]), b = Math.round(cur[K_B]);
    if (r !== topR || gg !== topG || b !== topB) {
      topR = r; topG = gg; topB = b;
      topStr = 'rgb(' + r + ',' + gg + ',' + b + ')';
    }
    g.fillStyle = topStr;
    g.fillRect(0, 0, cssW, cssH);

    var beams = cur[K_BEAMS];
    var speedMul = cur[K_SPEED] * (reduced ? 0.15 : 1);

    // 2. Cáusticas de la superficie (solo donde hay luz)
    if (beams > 0.005 && causticTile) {
      if (!causticPattern) causticPattern = g.createPattern(causticTile, 'repeat');
      var dts = dtMs / 1000 * (0.5 + 0.5 * speedMul);
      causticOff[0] = (causticOff[0] + 5 * dts) % CS; causticOff[1] = (causticOff[1] + 2.5 * dts) % CS;
      causticOff[2] = (causticOff[2] - 3.5 * dts + CS) % CS; causticOff[3] = (causticOff[3] + 3 * dts) % CS;
      var ca = clamp(beams / 0.16, 0, 1) * (0.85 + 0.15 * Math.sin(t / 2300));
      g.globalCompositeOperation = 'lighter';
      drawCausticLayer(g, 1.7, causticOff[0], causticOff[1], 0.07 * ca);
      drawCausticLayer(g, 2.45, causticOff[2], causticOff[3], 0.045 * ca);
      g.globalCompositeOperation = 'source-over';
    }

    // 3. Hundimiento hacia la negrura
    g.globalAlpha = 1;
    g.drawImage(darkGrad, 0, 0, cssW, cssH);

    // 4. Haces de luz
    if (beams > 0.005) {
      g.globalCompositeOperation = 'lighter';
      drawBeam(g, t, 0.2, 0.22, 11000, 0.0);
      drawBeam(g, t, 0.52, 0.3, 14000, 2.1);
      drawBeam(g, t, 0.8, 0.18, 9000, 4.2);
      g.setTransform(res, 0, 0, res, 0, 0);
      g.globalCompositeOperation = 'source-over';
    }

    // 5. Siluetas lejanas
    if (cur[K_SIL1] > 0.01) drawSil(g, t, sils[0], cur[K_SIL1]);
    if (cur[K_SIL2] > 0.01) drawSil(g, t, sils[1], cur[K_SIL2]);

    // 6. Plancton
    g.globalCompositeOperation = 'lighter';
    var champ = cur[K_CHAMP];
    for (var L = 0; L < 3; L++) {
      var vis = visibleCount(L);
      if (vis <= 0.01) continue;
      var start = LAYER_START[L], end = start + LAYER_MAX[L];
      var ox = parX[L], oy = parY[L];
      for (var i = start; i < end; i++) {
        var fade = vis - pRank[i];
        if (fade <= 0) continue;
        if (fade > 1) fade = 1;
        var col = (champ > 0.01 && pChamp[i] < champ) ? C_CHAMP : pCol[i];
        var x = pX[i] + ox + 6 * Math.sin(t * pSwW[i] + pSwP[i]);
        var y = pY[i] + oy;
        var a = pA[i], sz = pS[i];
        var ex = pExc[i];
        if (L === 2) {
          g.globalAlpha = a * fade * (1 + ex);
          var d2 = sz * (1 + 0.3 * ex);
          g.drawImage(palSoft[col], x - d2, y - d2, d2 * 2, d2 * 2);
          continue;
        }
        var fl = pFlash[i];
        if (fl >= 0) {
          var env = fl < 120 ? fl / 120 : 1 - (fl - 120) / 600;
          if (env < 0) env = 0;
          a = a + (1 - a) * env;
          sz = sz * (1 + 0.6 * env);
        }
        if (ex > 0) {
          if (0.9 * ex > a) a = 0.9 * ex;
          sz = sz * (1 + ex);
        }
        g.globalAlpha = a * fade;
        var d = sz * 6;
        g.drawImage(palDot[col], x - d * 0.5, y - d * 0.5, d, d);
      }
    }

    // 7. Intro: destellos en espiral y criatura
    if (introT0 >= 0 && introVariant === 'full') drawIntroSparks(g, t);
    if (introCreatureOn && t - introT0 >= 900) drawCreature(g, t);

    // 8. FX (estela y ráfagas)
    g.globalCompositeOperation = 'lighter';
    for (var q = 0; q < FX_MAX; q++) {
      if (fLife[q] <= 0) continue;
      var p = fAge[q] / fLife[q];
      var en = p < 0.1 ? p / 0.1 : 1 - easeInQuart((p - 0.1) / 0.9);
      g.globalAlpha = fAlpha[q] * en;
      var fd = fSize[q] * 6 * (1 - 0.35 * p);
      g.drawImage(palDot[fCol[q]], fX[q] - fd * 0.5, fY[q] - fd * 0.5, fd, fd);
    }

    // 9. Pulsos
    for (var k = 0; k < PULSES; k++) {
      if (!puOn[k]) continue;
      var pt = (t - puT0[k]) / 900;
      if (pt >= 1) { puOn[k] = 0; continue; }
      if (pt < 0) continue;
      var rad = 0.9 * maxSide * easeOutCubic(pt);
      var pa = puStr[k] * 0.35 * Math.pow(1 - pt, 1.3) * (reduced ? 0.6 : 1);
      if (rad < 1 || pa <= 0.002) continue;
      g.globalAlpha = clamp(pa, 0, 1);
      g.drawImage(puSpr[k], cssW * 0.5 - rad, cssH * 0.5 - rad, rad * 2, rad * 2);
    }

    // 10. Capa coral de tensión
    g.globalCompositeOperation = 'source-over';
    var coral = cur[K_CORAL];
    if (coral > 0.01) {
      var beat = reduced ? 0.85 : 0.72 + 0.28 * Math.sin(TAU * t / 1000);
      g.globalAlpha = 0.12 * coral * beat * 1.6;
      g.drawImage(coralSprite, 0, 0, cssW, cssH);
    }
    g.globalAlpha = 1;
  }

  function drawCausticLayer(g, scale, ox, oy, alpha) {
    if (alpha <= 0.001) return;
    g.save();
    g.globalAlpha = alpha;
    g.scale(scale, scale);
    g.translate(ox - CS, oy - CS);
    g.fillStyle = causticPattern;
    g.fillRect(0, 0, cssW / scale + CS * 2, (cssH * 0.42) / scale + CS);
    g.restore();
  }

  function drawBeam(g, t, cxF, wF, period, ph) {
    var w = cssW * (wF + 0.02 * Math.sin(TAU * t / period + ph));
    var h = cssH * 1.25;
    var a = cur[K_BEAMS] * (0.82 + 0.18 * Math.sin(TAU * t / (period * 0.7) + ph * 1.3));
    if (a <= 0.002 || w <= 1) return;
    g.setTransform(res, 0, 0, res, 0, 0);
    g.translate(cssW * cxF, -cssH * 0.08);
    g.rotate(12 * Math.PI / 180);
    g.globalAlpha = clamp(a, 0, 1);
    g.drawImage(beamSprite, -w * 0.5, 0, w, h);
  }

  function drawSil(g, t, s, f) {
    var size = s.size;
    var pulse = 0.98 + 0.06 * Math.sin(TAU * t / 4000 + s.ph);
    var bw = size, bh = size * 0.69 * pulse;
    var x = s.x + 10 * Math.sin(t / 7000 + s.ph), y = s.y;
    g.globalAlpha = 0.35 * f;
    g.drawImage(bellSprite, x - bw * 0.5, y - bh, bw, bh);
    // tentáculos
    g.strokeStyle = '#1B5674';
    g.lineWidth = Math.max(1, size * 0.011);
    g.lineCap = 'round';
    g.globalAlpha = 0.24 * f;
    var rimY = y - bh * 0.06;
    for (var k = 0; k < 6; k++) {
      var rx = x + (k - 2.5) * bw * 0.13;
      var len = size * (0.7 + 0.11 * ((k * 37) % 5));
      var sw = Math.sin(t / 1100 + k * 1.3 + s.ph) * size * 0.1;
      var sw2 = Math.sin(t / 760 + k * 2.1 + s.ph) * size * 0.07;
      var half = len * 0.5;
      g.beginPath();
      g.moveTo(rx, rimY);
      g.quadraticCurveTo(rx + sw * 0.7, rimY + half * 0.5, rx + sw * 0.25, rimY + half);
      g.quadraticCurveTo(rx - sw * 0.6 + sw2, rimY + half * 1.5, rx - sw * 0.15 + sw2 * 1.4, rimY + len);
      g.stroke();
    }
  }

  function drawIntroSparks(g, t) {
    var e = t - introT0;
    if (e > 4600) return;
    g.globalCompositeOperation = 'lighter';
    for (var k = 0; k < NSPARK; k++) {
      var le = e - skD[k];
      if (le < 0) continue;
      var a;
      if (le < 120) a = le / 120;
      else if (le < 1020) a = 1 - 0.65 * ((le - 120) / 900);
      else a = 0.35 * (1 - clamp((le - 1020) / 1600, 0, 1));
      if (a <= 0.004) continue;
      var sz = skS[k] * (1 + 0.8 * (le < 300 ? 1 - le / 300 : 0));
      var d = sz * 7;
      var y = skY[k] - le * 0.006;
      g.globalAlpha = a;
      g.drawImage(palDot[skC[k]], skX[k] - d * 0.5, y - d * 0.5, d, d);
    }
  }

  function drawCreature(g, t) {
    var s = CREATURE_S, n = CREATURE_N;
    if (crHeadX < -80 - n * CREATURE_SPACING || crX[n - 1] > cssW + 80) return;
    // halos
    g.globalCompositeOperation = 'lighter';
    var halo = palDot[C_TURQ];
    for (var i = 0; i < n; i++) {
      var tt = i / (n - 1);
      var rr = s * (0.46 - 0.22 * Math.pow(tt, 1.4));
      var hd = rr * 3.2 * 2 * 1.4;
      g.globalAlpha = 0.26 * (1 - 0.6 * tt);
      g.drawImage(halo, crX[i] - hd * 0.5, crY[i] - hd * 0.5, hd, hd);
    }
    // cuerpo
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.lineCap = 'round';
    for (i = 0; i < n - 1; i++) {
      var t0 = i / (n - 1);
      g.strokeStyle = crRamp[i];
      g.lineWidth = 2 * s * (0.46 - 0.22 * Math.pow(t0, 1.4));
      g.beginPath(); g.moveTo(crX[i], crY[i]); g.lineTo(crX[i + 1], crY[i + 1]); g.stroke();
    }
    // filamento
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.75;
    g.strokeStyle = '#E1FFF9';
    g.lineWidth = 0.22 * s;
    g.beginPath(); g.moveTo(crX[0], crY[0]);
    for (i = 1; i < n; i++) g.lineTo(crX[i], crY[i]);
    g.stroke();
    // fotóforos
    for (i = 2; i < n; i += 2) {
      var ph = 0.5 + 0.5 * Math.sin(t * 0.004 + i * 1.7);
      g.globalAlpha = ph;
      var pd = 0.09 * s * 8;
      g.drawImage(palDot[C_PEARL], crX[i] - pd * 0.5, crY[i] - pd * 0.5, pd, pd);
    }
    // cabeza: dirección
    var dx = crX[0] - crX[1], dy = crY[0] - crY[1], dl = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= dl; dy /= dl;
    var nx = -dy, ny = dx;
    var hx = crX[0] + dx * 0.08 * s, hy = crY[0] + dy * 0.08 * s;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = '#1FF2D2';
    g.beginPath();
    g.ellipse(hx, hy, 0.56 * s, 0.48 * s, Math.atan2(dy, dx), 0, TAU);
    g.fill();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.6;
    var cd = 2 * s;
    g.drawImage(palDot[C_PEARL], hx - cd * 0.5, hy - cd * 0.5, cd, cd);
    // ojos
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    for (var side = -1; side <= 1; side += 2) {
      var exx = crX[0] + dx * 0.18 * s + nx * 0.22 * s * side, eyy = crY[0] + dy * 0.18 * s + ny * 0.22 * s * side;
      g.fillStyle = '#E8FBFF';
      g.beginPath(); g.arc(exx, eyy, 0.12 * s, 0, TAU); g.fill();
      g.fillStyle = '#01060A';
      g.beginPath(); g.arc(exx + dx * 0.03 * s, eyy + dy * 0.03 * s, 0.07 * s, 0, TAU); g.fill();
    }
    // señuelo: nace sobre la cabeza y se curva hacia adelante (lado -normal = arriba al nadar a la derecha)
    var up = ny > 0 ? -1 : 1;
    var w1 = 0.25 * s * Math.sin(t * 0.003), w2 = 0.15 * s * Math.sin(t * 0.004 + 1);
    var sx = crX[0] + dx * 0.3 * s + nx * up * 0.3 * s, sy = crY[0] + dy * 0.3 * s + ny * up * 0.3 * s;
    var cx = crX[0] + dx * 0.7 * s + nx * (w1 + up * 0.9 * s), cy = crY[0] + dy * 0.7 * s + ny * (w1 + up * 0.9 * s);
    var lx = crX[0] + dx * 0.95 * s + nx * (w2 + up * 0.55 * s), ly = crY[0] + dy * 0.95 * s + ny * (w2 + up * 0.55 * s);
    g.strokeStyle = 'rgba(200,255,60,0.8)';
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(cx, cy, lx, ly); g.stroke();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 1;
    var ld = 0.35 * s * 2 * 2.2;
    g.drawImage(palDot[C_LIME], lx - ld * 0.5, ly - ld * 0.5, ld, ld);
    g.fillStyle = '#E8FBFF';
    g.beginPath(); g.arc(lx, ly, 0.08 * s + 0.4, 0, TAU); g.fill();
    g.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------------------------------
  // Bucle
  // ---------------------------------------------------------------------------------------
  function frame(t) {
    rafId = 0;
    if (!running || !canvas) return;
    rafId = global.requestAnimationFrame(frame);
    if (lastT === 0) { lastT = t; lastDraw = t - 1000; }
    var minFrame = targetFps <= 30 ? (1000 / 30) - 4 : 0;
    if (t - lastDraw < minFrame) return;
    var dt = t - lastT;
    if (dt > 50) dt = 50;
    if (dt < 0) dt = 0;
    lastT = t; lastDraw = t;
    var c0 = now();
    step(t, dt);
    draw(t, dt);
    var cost = now() - c0;
    statCost = statCost * 0.95 + cost * 0.05;
    statFps = statFps * 0.95 + (dt > 0 ? 1000 / dt : 60) * 0.05;
  }
  var statCost = 0, statFps = 60;
  function stats() {
    var live = 0;
    for (var q = 0; q < FX_MAX; q++) if (fLife[q] > 0) live++;
    var vis = 0;
    for (var L = 0; L < 3; L++) vis += Math.min(LAYER_MAX[L], Math.ceil(visibleCount(L)));
    return { mood: moodName, fps: Math.round(statFps), costMs: Math.round(statCost * 100) / 100, plankton: vis, fx: live, res: res, running: running };
  }
  function ensureRunning() {
    if (!canvas || running && rafId) return;
    if (doc.hidden) return;
    running = true;
    if (!rafId) { lastT = 0; rafId = global.requestAnimationFrame(frame); }
  }
  function stop() {
    running = false;
    if (rafId) { global.cancelAnimationFrame(rafId); rafId = 0; }
  }
  function onVisibility() {
    if (doc.hidden) stop();
    else { lastT = 0; ensureRunning(); }
  }

  // ---------------------------------------------------------------------------------------
  // init
  // ---------------------------------------------------------------------------------------
  var bound = false;
  function init(canvasEl) {
    var el = canvasEl || doc.getElementById('backdrop');
    if (!el) {
      if (!doc.body) return false;
      el = doc.createElement('canvas');
      el.id = 'backdrop';
      el.setAttribute('aria-hidden', 'true');
      doc.body.insertBefore(el, doc.body.firstChild);
    }
    if (el === canvas) return true;
    if (!el.getContext) return false;
    var c2 = el.getContext('2d', { alpha: false });
    if (!c2) return false;
    canvas = el; ctx = c2;
    try {
      var cs = global.getComputedStyle(el);
      if (cs.position !== 'fixed') {
        el.style.position = 'fixed'; el.style.left = '0'; el.style.top = '0';
        el.style.zIndex = '0'; el.style.pointerEvents = 'none';
      }
    } catch (e) { /* nada */ }
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.display = 'block';
    if (!palDot.length) initPalette();
    if (!darkGrad) buildCaches();
    applySize();
    initPlankton();
    resetSil(sils[0], true); resetSil(sils[1], true);
    if (!moodName) { moodName = 'intro'; cur.set(MOODS.intro.v); }
    if (!bound) {
      bound = true;
      global.addEventListener('resize', onResize, { passive: true });
      doc.addEventListener('visibilitychange', onVisibility);
      bindPointer();
    }
    ensureRunning();
    return true;
  }

  global.Backdrop = {
    __bio: true,
    init: init,
    setMood: setMood,
    pulse: pulse,
    descend: descend,
    burst: burst,
    beginIntro: beginIntro,
    skipIntro: skipIntro,
    introCreatureX: introCreatureX,
    mood: function () { return moodName; },
    stats: stats,
    isRunning: function () { return running; }
  };
})(window);
