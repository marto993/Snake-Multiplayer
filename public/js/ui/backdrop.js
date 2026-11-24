/*
 * backdrop.js: fondo vivo del espacio (window.Backdrop).
 *
 * Canvas #backdrop a pantalla completa, detrás de toda la experiencia. Cuenta un viaje que se
 * aleja de un planeta: el vacío teñido por el ambiente, una nebulosa tenue que deriva muy
 * lento, la Vía Láctea, estrellas y polvo en tres profundidades que derivan despacio hacia
 * abajo, el borde de un planeta con su atmósfera (grande en la intro, cada escena más lejos),
 * siluetas de criaturas enormes y lejanas, la estela de polvo estelar del puntero, pulsos y
 * la capa H-alfa de tensión. Los ambientes interpolan sus parámetros en 1200 ms.
 *
 * API pública (contrato + extensiones marcadas):
 *   Backdrop.init(canvasEl)
 *   Backdrop.setMood(name, opts)            name: intro|calm|lobby|room|game|tension|celebration
 *                                           opts.color (extensión): color del campeón en celebration
 *   Backdrop.pulse(color, strength)
 *   Backdrop.descend(dir)                   (extensión) empuje de las estrellas: +1 hacia abajo (alejarse), -1 hacia arriba (volver)
 *   Backdrop.burst(x, y, opts)              (extensión) ráfaga de partículas en coordenadas de viewport
 *   Backdrop.beginIntro(variant)            (extensión, la usa Scenes) 'full' | 'short' | 'reduced'
 *   Backdrop.skipIntro()                    (extensión, la usa Scenes)
 *   Backdrop.introCreatureX()               (extensión, la usa Scenes) x de la cabeza de la criatura de la intro
 *   Backdrop.mood()                         (extensión) ambiente actual
 *   Backdrop.stats()                        (diagnóstico) { mood, fps, costMs, stars, fx, res, running, buildMs }
 *
 * Sin dependencias. Sin allocations por frame en el bucle de dibujo: la nebulosa, la Vía
 * Láctea y los sprites se generan al iniciar o al cambiar el tamaño, y el planeta vive en un
 * canvas propio que se regenera solo cuando cambia su geometría (transiciones y resize).
 */
(function (global) {
  'use strict';

  if (global.Backdrop && global.Backdrop.__bio) return;

  const doc = global.document;
  const TAU = Math.PI * 2;

  function now() { return (global.performance && global.performance.now) ? global.performance.now() : Date.now(); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }
  function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
  function easeOutCubic(t) { const u = 1 - t; return 1 - u * u * u; }
  function easeInQuart(t) { return t * t * t * t; }
  function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
  function gauss() { return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(TAU * Math.random()); }

  function parseColor(c) {
    if (typeof c !== 'string') return null;
    c = c.trim();
    if (c.charAt(0) === '#') {
      let h = c.slice(1);
      if (h.length === 3 || h.length === 4) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      if (h.length >= 6) {
        const n = parseInt(h.slice(0, 6), 16);
        if (!isNaN(n)) return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }
      return null;
    }
    const m = c.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
    return null;
  }
  function rgba(rgb, a) { return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')'; }
  function mix(a, b, t) { return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]; }

  function makeCanvas(w, h) {
    const c = doc.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  // Ruido de valor suave sobre una tabla de 256 × 256 valores al azar (compartida; cada
  // generador la lee con su propio desplazamiento) y fbm. Solo para generar texturas.
  let noiseTab = null;
  function makeNoise() {
    if (!noiseTab) {
      noiseTab = new Float32Array(65536);
      for (let i = 0; i < 65536; i++) noiseTab[i] = Math.random();
    }
    const tab = noiseTab, ox = Math.floor(rand(0, 256)), oy = Math.floor(rand(0, 256));
    return function (x, y) {
      const fx = Math.floor(x), fy = Math.floor(y), xf = x - fx, yf = y - fy;
      const x0 = (fx + ox) & 255, y0 = ((fy + oy) & 255) << 8, x1 = (x0 + 1) & 255, y1 = (y0 + 256) & 65280;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = tab[y0 + x0], b = tab[y0 + x1], c = tab[y1 + x0], e = tab[y1 + x1];
      return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
    };
  }
  function fbm(n, x, y, oct) {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) { s += amp * n(x * f, y * f); norm += amp; amp *= 0.5; f *= 2.03; }
    return s / norm;
  }

  // ---------------------------------------------------------------------------------------
  // Preferencias del dispositivo
  // ---------------------------------------------------------------------------------------
  const mqReduced = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const mqCoarse = global.matchMedia ? global.matchMedia('(pointer: coarse)') : null;
  let reduced = !!(mqReduced && mqReduced.matches);
  const coarse = !!(mqCoarse && mqCoarse.matches);
  function listenMQ(mq, fn) {
    if (!mq) return;
    if (mq.addEventListener) mq.addEventListener('change', fn); else if (mq.addListener) mq.addListener(fn);
  }
  listenMQ(mqReduced, function (e) { reduced = !!e.matches; });

  // ---------------------------------------------------------------------------------------
  // Ambientes
  // ---------------------------------------------------------------------------------------
  const K_R = 0, K_G = 1, K_B = 2, K_DENS = 3, K_SPEED = 4, K_MW = 5, K_NEB = 6,
      K_PL_A = 7, K_PL_Y = 8, K_PL_R = 9, K_SIL1 = 10, K_SIL2 = 11, K_TRAIL = 12, K_HA = 13, K_CHAMP = 14, K_SKY = 15, NK = 16;

  // Planeta: [alpha, altura del horizonte en su punto más alto (fracción del alto), radio (× lado mayor)].
  // Cada escena está más lejos: el planeta se ve más chico, más curvo y más abajo.
  const PL_NEAR = [1, 0.76, 2.1], PL_MID = [1, 0.885, 1.3], PL_FAR = [0.95, 0.955, 0.85], PL_GONE = [0, 1.12, 0.6];

  function moodVec(o) {
    const v = new Float32Array(NK), rgb = parseColor(o.base), pl = o.planet || PL_GONE, sils = o.sils || 0;
    v[K_R] = rgb[0]; v[K_G] = rgb[1]; v[K_B] = rgb[2];
    v[K_DENS] = o.dens; v[K_SPEED] = o.speed; v[K_MW] = o.mw; v[K_NEB] = o.neb;
    v[K_PL_A] = pl[0]; v[K_PL_Y] = pl[1]; v[K_PL_R] = pl[2];
    v[K_SIL1] = sils >= 1 ? 1 : 0; v[K_SIL2] = sils >= 2 ? 1 : 0;
    v[K_TRAIL] = o.trail || 0; v[K_HA] = o.ha || 0; v[K_CHAMP] = o.champ || 0; v[K_SKY] = o.sky || 0;
    return v;
  }

  const MOODS = {
    intro:       { v: moodVec({ base: '#090B16', dens: 0.8, speed: 1.0, mw: 0.75, neb: 0.55, planet: PL_NEAR, sils: 2, trail: 1, sky: 1 }), fps: 60, res: 0.5 },
    calm:        { v: moodVec({ base: '#080A14', dens: 0.9, speed: 0.9, mw: 0.62, neb: 0.6, planet: PL_MID, sils: 2, trail: 1, sky: 0.9 }), fps: 60, res: 0.5 },
    lobby:       { v: moodVec({ base: '#080912', dens: 1.0, speed: 1.0, mw: 0.75, neb: 0.65, planet: PL_FAR, sils: 1, trail: 1, sky: 0.75 }), fps: 60, res: 0.5 },
    room:        { v: moodVec({ base: '#07080F', dens: 0.85, speed: 0.9, mw: 0.3, neb: 0.7, trail: 1, sky: 0.15 }),              fps: 60, res: 0.5 },
    game:        { v: moodVec({ base: '#06070D', dens: 0.5, speed: 0.7, mw: 0.06, neb: 0.35 }),                                  fps: 30, res: 0.35 },
    tension:     { v: moodVec({ base: '#10060A', dens: 0.5, speed: 1.3, mw: 0.05, neb: 0.3, ha: 1 }),                            fps: 30, res: 0.35 },
    celebration: { v: moodVec({ base: '#0A0C18', dens: 1.3, speed: 2.0, mw: 0.5, neb: 0.75, champ: 0.6, sky: 0.2 }),           fps: 60, res: 0.5 }
  };
  const BLACK_VEC = moodVec({ base: '#030307', dens: 0, speed: 1.0, mw: 0, neb: 0, planet: [0, PL_NEAR[1], PL_NEAR[2]], trail: 1, sky: 1 });
  const scratchVec = new Float32Array(NK);

  const cur = new Float32Array(NK), trFrom = new Float32Array(NK), trTo = new Float32Array(NK);
  cur.set(MOODS.intro.v);
  let trT0 = 0, trDur = 0, trActive = false;
  let moodName = null, targetFps = 60, res = 0.5;

  function transitionParams(vec, dur) {
    trFrom.set(cur);
    trTo.set(vec);
    if (!(dur > 0)) { cur.set(vec); trActive = false; return; }
    trT0 = now(); trDur = dur; trActive = true;
  }
  function stepTransition(t) {
    if (!trActive) return;
    const p = clamp((t - trT0) / trDur, 0, 1), e = easeInOutSine(p);
    for (let k = 0; k < NK; k++) cur[k] = trFrom[k] + (trTo[k] - trFrom[k]) * e;
    if (p >= 1) trActive = false;
  }

  // ---------------------------------------------------------------------------------------
  // Canvas y estado general
  // ---------------------------------------------------------------------------------------
  let canvas = null, ctx = null;
  let cssW = 1, cssH = 1, maxSide = 1;
  let running = false, rafId = 0, lastT = 0, lastDraw = 0;
  let resizeTimer = 0;
  let topStr = '#030307', topR = -1, topG = -1, topB = -1;

  // ---------------------------------------------------------------------------------------
  // Paleta y sprites
  // ---------------------------------------------------------------------------------------
  // Fijos: marca (oxígeno), estrella azul, azufre, invitación, luz estelar, campeón, H-alfa,
  // y los colores de las estrellas por temperatura (más un verde azulado y un rosa apagados).
  const C_TURQ = 0, C_BLUE = 1, C_GOLD = 2, C_VIOLET = 3, C_PEARL = 4, C_CHAMP = 5, C_HALPHA = 6,
      C_ST_WHITE = 7, C_ST_BLUE = 8, C_ST_PALE = 9, C_ST_AMBER = 10, C_ST_ORANGE = 11, C_ST_TEAL = 12, C_ST_ROSE = 13,
      C_GOLD_SOFT = 14, PAL_FIXED = 15, PAL_MAX = 28;
  const palKey = [], palRGB = [], palDot = [], palSoft = [], palStar = [], starFill = [];
  const pulseSprites = {}; const pulseSpriteKeys = [];

  // Punto con halo (estela, ráfagas, destellos de la intro).
  function makeDotSprite(rgb) {
    const s = 32, c = makeCanvas(s, s), g = c.getContext('2d');
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    const core = mix(rgb, [252, 251, 255], 0.55);
    grd.addColorStop(0, rgba(core, 1));
    grd.addColorStop(0.12, rgba(rgb, 0.95));
    grd.addColorStop(0.3, rgba(rgb, 0.42));
    grd.addColorStop(0.58, rgba(rgb, 0.11));
    grd.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    return c;
  }
  // Estrella: núcleo blanco y halo corto del color de su temperatura.
  function makeStarSprite(rgb) {
    const s = 24, c = makeCanvas(s, s), g = c.getContext('2d');
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, rgba(mix(rgb, [255, 255, 255], 0.6), 1));
    grd.addColorStop(0.14, rgba(rgb, 0.8));
    grd.addColorStop(0.3, rgba(rgb, 0.22));
    grd.addColorStop(0.6, rgba(rgb, 0.05));
    grd.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    return c;
  }
  // Mota desenfocada (polvo cercano).
  function makeSoftSprite(rgb) {
    const s = 64, c = makeCanvas(s, s), g = c.getContext('2d');
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grd.addColorStop(0, rgba(rgb, 0.75));
    grd.addColorStop(0.45, rgba(rgb, 0.32));
    grd.addColorStop(1, rgba(rgb, 0));
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    return c;
  }
  function buildPal(i, rgb) {
    palRGB[i] = rgb;
    palDot[i] = makeDotSprite(rgb);
    palSoft[i] = makeSoftSprite(rgb);
    palStar[i] = makeStarSprite(rgb);
    starFill[i] = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
  }
  function setPal(i, hex) {
    const rgb = parseColor(hex) || [94, 216, 196];
    palKey[i] = hex.toLowerCase();
    buildPal(i, rgb);
  }
  function initPalette() {
    setPal(C_TURQ, '#5ED8C4'); setPal(C_BLUE, '#8FB2FF'); setPal(C_GOLD, '#EAC255');
    setPal(C_VIOLET, '#A595F2'); setPal(C_PEARL, '#F6F3EE'); setPal(C_CHAMP, '#EAC255');
    setPal(C_HALPHA, '#EC4F5A');
    setPal(C_ST_WHITE, '#F4F3FF'); setPal(C_ST_BLUE, '#CFDBFF'); setPal(C_ST_PALE, '#FFF2D6');
    setPal(C_ST_AMBER, '#FFD9A8'); setPal(C_ST_ORANGE, '#FFB98A'); setPal(C_ST_TEAL, '#A3D8CF');
    setPal(C_ST_ROSE, '#E8B6C8'); setPal(C_GOLD_SOFT, '#F6DC94');
  }
  function colorIndex(hex) {
    if (typeof hex !== 'string') return C_TURQ;
    const key = hex.toLowerCase();
    for (let i = 0; i < palKey.length; i++) if (palKey[i] === key && i !== C_CHAMP) return i;
    if (!parseColor(hex)) return C_TURQ;
    const idx = palKey.length < PAL_MAX ? palKey.length : PAL_FIXED + ((palKey.length) % (PAL_MAX - PAL_FIXED));
    setPal(idx, hex);
    return idx;
  }
  function setChampColor(rgbOrHex) {
    const rgb = typeof rgbOrHex === 'string' ? parseColor(rgbOrHex) : rgbOrHex;
    if (!rgb) return;
    const hex = '#' + ((1 << 24) | (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]).toString(16).slice(1);
    palKey[C_CHAMP] = '#champ:' + hex;
    buildPal(C_CHAMP, rgb);
  }
  // Temperatura: mayoría blanco y blanco azulado, algo de dorado pálido, poco verde azulado y rosa.
  function pickStarColor() {
    const r = Math.random();
    if (r < 0.38) return C_ST_WHITE;
    if (r < 0.64) return C_ST_BLUE;
    if (r < 0.78) return C_ST_PALE;
    if (r < 0.87) return C_ST_AMBER;
    if (r < 0.91) return C_ST_ORANGE;
    if (r < 0.955) return C_ST_TEAL;
    return C_ST_ROSE;
  }

  function pulseSprite(hex) {
    const key = (hex || '#5ED8C4').toLowerCase();
    const spr = pulseSprites[key];
    if (spr) return spr;
    const rgb = parseColor(key) || [94, 216, 196];
    const s = 256, c = makeCanvas(s, s), g = c.getContext('2d');
    const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
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

  // ---------------------------------------------------------------------------------------
  // Texturas independientes del tamaño de pantalla (se dibujan estiradas)
  // ---------------------------------------------------------------------------------------
  let nebTex = null, haTex = null, cloudTex = null, spikeSprite = null, skyDark = null, skyGlow = null;

  // Degradado del cielo: la luz viene de la atmósfera del planeta, abajo. Arriba se oscurece
  // hacia el negro del espacio; desde el horizonte sube un resplandor azul (#2A3D6E) que se
  // desvanece hacia la mitad de la pantalla. Se dibujan estirados.
  const SKY_GLOW_SOLID = 'rgba(42,61,110,0.42)';
  function buildSky() {
    skyDark = makeCanvas(4, 256);
    let g = skyDark.getContext('2d');
    let grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, 'rgba(3,3,7,0.88)');
    grd.addColorStop(0.3, 'rgba(3,3,7,0.6)');
    grd.addColorStop(0.62, 'rgba(3,3,7,0.15)');
    grd.addColorStop(0.8, 'rgba(3,3,7,0)');
    grd.addColorStop(1, 'rgba(3,3,7,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
    skyGlow = makeCanvas(4, 256);
    g = skyGlow.getContext('2d');
    grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, 'rgba(42,61,110,0)');
    grd.addColorStop(0.35, 'rgba(42,61,110,0.04)');
    grd.addColorStop(0.65, 'rgba(42,61,110,0.15)');
    grd.addColorStop(0.88, 'rgba(42,61,110,0.32)');
    grd.addColorStop(1, 'rgba(42,61,110,0.42)');
    g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
  }


  // Nebulosa tenue: oxígeno verde azulado arriba a la izquierda, polvo cálido con algo de
  // H-alfa a la derecha, y un velo índigo muy leve en todo el cielo. Opaca (negro = nada)
  // para sumarla con 'lighter'.
  function buildNebula() {
    const w = 200, h = 125;
    nebTex = makeCanvas(w, h);
    const g = nebTex.getContext('2d'), img = g.createImageData(w, h), d = img.data;
    const nA = makeNoise(), nB = makeNoise(), nC = makeNoise();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = x / w, v = y / h;
        const o = fbm(nA, u * 4.2, v * 2.8, 4), k = fbm(nB, u * 3.4 + 5, v * 2.4 + 2, 4), r = fbm(nC, u * 5 + 9, v * 3.5, 3);
        const rO = Math.exp(-((u - 0.3) * (u - 0.3) / 0.05 + (v - 0.2) * (v - 0.2) / 0.045));
        const rW = Math.exp(-((u - 0.86) * (u - 0.86) / 0.08 + (v - 0.42) * (v - 0.42) / 0.15));
        // filamentos (ruido con crestas) sobre un velo suave, para que no sea una mancha
        const fil = smoothstep(0.55, 0.92, 1 - Math.abs(2 * o - 1));
        const io = (smoothstep(0.45, 0.85, o) * 0.4 + fil * 0.6) * rO;
        const iw = smoothstep(0.45, 0.85, k) * rW;
        const ir = smoothstep(0.6, 0.88, r) * rW * 0.35;
        const veil = 0.14 * smoothstep(0.3, 0.8, o);
        const p = (y * w + x) * 4;
        d[p] = Math.round(io * 22 + iw * 80 + ir * 84 + veil * 24);
        d[p + 1] = Math.round(io * 60 + iw * 56 + ir * 26 + veil * 24);
        d[p + 2] = Math.round(io * 64 + iw * 32 + ir * 24 + veil * 40);
        d[p + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  // Capa de tensión: nubes de hidrógeno (H-alfa), más densas hacia los bordes.
  function buildHAlpha() {
    const w = 160, h = 100;
    haTex = makeCanvas(w, h);
    const g = haTex.getContext('2d'), img = g.createImageData(w, h), d = img.data;
    const nA = makeNoise();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x / w - 0.5) * 2, dy = (y / h - 0.5) * 2;
        const vig = smoothstep(0.3, 1.15, Math.sqrt(dx * dx + dy * dy));
        const n = fbm(nA, x / w * 5, y / h * 3.2, 4);
        const I = clamp(vig * (0.3 + 1.1 * n) + 0.1 * n, 0, 1);
        const p = (y * w + x) * 4;
        d[p] = Math.round(226 * I); d[p + 1] = Math.round(62 * I); d[p + 2] = Math.round(78 * I); d[p + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  // Nubes tenues de la cara nocturna del planeta (estiradas en horizontal: vistas de canto).
  function buildClouds() {
    const w = 256, h = 48;
    cloudTex = makeCanvas(w, h);
    const g = cloudTex.getContext('2d'), img = g.createImageData(w, h), d = img.data;
    const nA = makeNoise();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = fbm(nA, x / w * 9, y / h * 5, 4);
        const a = smoothstep(0.45, 0.85, n) * 0.55;
        const p = (y * w + x) * 4;
        d[p] = 30; d[p + 1] = 38; d[p + 2] = 58; d[p + 3] = Math.round(a * 255);
      }
    }
    g.putImageData(img, 0, 0);
  }

  // Estrella brillante con difracción suave (cuatro puntas cortas, como en las fotos).
  function buildSpike() {
    const s = 64, c = makeCanvas(s, s), g = c.getContext('2d');
    g.globalCompositeOperation = 'lighter';
    let grd = g.createLinearGradient(0, 0, s, 0);
    grd.addColorStop(0, 'rgba(214,224,255,0)');
    grd.addColorStop(0.5, 'rgba(214,224,255,0.55)');
    grd.addColorStop(1, 'rgba(214,224,255,0)');
    g.fillStyle = grd; g.fillRect(0, s / 2 - 1.2, s, 2.4);
    grd = g.createLinearGradient(0, 0, 0, s);
    grd.addColorStop(0, 'rgba(214,224,255,0)');
    grd.addColorStop(0.5, 'rgba(214,224,255,0.55)');
    grd.addColorStop(1, 'rgba(214,224,255,0)');
    g.fillStyle = grd; g.fillRect(s / 2 - 1.2, 0, 2.4, s);
    grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.18);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.35, 'rgba(214,224,255,0.35)');
    grd.addColorStop(1, 'rgba(214,224,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    spikeSprite = c;
  }

  // ---------------------------------------------------------------------------------------
  // Planeta (canvas propio del tamaño de la pantalla a media resolución)
  // ---------------------------------------------------------------------------------------
  const PR = 0.5;            // resolución del caché del planeta
  const PL_CX = 0.6;         // x del centro del planeta (fracción del ancho): la curva cae más a la izquierda
  const PL_HAZE = 0.09;      // la atmósfera llega hasta 1,09 radios
  const PL_FACE = '#05060C';
  let planetCanvas = null, planetCtx = null, atmoGrad = null, sideGrad = null;
  let plCacheY = NaN, plCacheR = NaN, plCacheSyB = 0, plDirty = true;

  function buildPlanetBase() {
    planetCanvas = makeCanvas(1, 1);
    planetCtx = planetCanvas.getContext('2d');
    // Atmósfera en unidades del radio (se escala con el planeta: más lejos, más fina).
    // Sobre la cara, un brillo que nace al 0,99; en el borde, una línea suave más clara;
    // arriba, la dispersión azul que se desvanece hasta 1,09.
    const grd = planetCtx.createRadialGradient(0, 0, 0.99, 0, 0, 1 + PL_HAZE);
    grd.addColorStop(0, 'rgba(90,130,200,0)');
    grd.addColorStop(0.07, 'rgba(90,130,200,0.10)');
    grd.addColorStop(0.1, 'rgba(168,194,238,0.62)');
    grd.addColorStop(0.13, 'rgba(122,160,224,0.46)');
    grd.addColorStop(0.18, 'rgba(90,130,200,0.28)');
    grd.addColorStop(0.3, 'rgba(90,130,200,0.12)');
    grd.addColorStop(0.5, 'rgba(62,92,160,0.05)');
    grd.addColorStop(0.75, 'rgba(29,42,79,0.02)');
    grd.addColorStop(1, 'rgba(29,42,79,0)');
    atmoGrad = grd;
  }

  function renderPlanet(apex, R) {
    const pg = planetCtx, pc = planetCanvas;
    const top = Math.max(0, apex - R * PL_HAZE);
    const syB = Math.floor(top * PR);
    pg.setTransform(1, 0, 0, 1, 0, 0);
    pg.globalCompositeOperation = 'source-over';
    pg.globalAlpha = 1;
    const clearFrom = plDirty ? 0 : Math.min(syB, plCacheSyB);
    pg.clearRect(0, clearFrom, pc.width, pc.height - clearFrom);
    pg.setTransform(PR, 0, 0, PR, 0, 0);
    const cx = cssW * PL_CX, cy = apex + R;
    // 1. atmósfera
    pg.save();
    pg.translate(cx, cy);
    pg.scale(R, R);
    pg.fillStyle = atmoGrad;
    pg.fillRect(-cx / R, (top - cy) / R, cssW / R, (cssH - top) / R + 0.01);
    pg.restore();
    // 2. la estrella está detrás, a la derecha: ese lado del borde brilla más
    pg.globalCompositeOperation = 'destination-in';
    pg.fillStyle = sideGrad;
    pg.fillRect(0, top, cssW, cssH - top);
    // 3. cara nocturna, detrás de la atmósfera
    pg.globalCompositeOperation = 'destination-over';
    pg.fillStyle = PL_FACE;
    pg.beginPath(); pg.arc(cx, cy, R, 0, TAU); pg.fill();
    // 4. nubes apenas visibles sobre la cara
    pg.globalCompositeOperation = 'source-over';
    pg.save();
    pg.beginPath(); pg.arc(cx, cy, R * 0.9985, 0, TAU); pg.clip();
    pg.globalAlpha = 0.8;
    pg.drawImage(cloudTex, cx - R * 0.8, apex - R * 0.004, R * 1.6, R * 0.2);
    pg.restore();
    pg.globalAlpha = 1;
    plCacheY = apex; plCacheR = R; plCacheSyB = syB; plDirty = false;
  }

  function planetRadius() { return cur[K_PL_R] * Math.max(cssW, cssH * 1.25); }

  function drawPlanet(g) {
    const a = cur[K_PL_A];
    if (a <= 0.004 || !planetCanvas) return;
    const R = planetRadius(), apex = cur[K_PL_Y] * cssH;
    if (apex - R * PL_HAZE >= cssH) return;
    if (plDirty || Math.abs(apex - plCacheY) > 0.3 || Math.abs(R - plCacheR) > 0.5) renderPlanet(apex, R);
    const pc = planetCanvas, sh = pc.height - plCacheSyB;
    if (sh <= 0) return;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = clamp(a, 0, 1);
    g.drawImage(pc, 0, plCacheSyB, pc.width, sh, 0, plCacheSyB / PR, pc.width / PR, sh / PR);
  }

  // ---------------------------------------------------------------------------------------
  // Vía Láctea: banda diagonal de estrellas densas y polvo cálido con bandas oscuras.
  // Se genera al iniciar y al cambiar el tamaño (no se estira: la banda y las estrellas
  // mantienen su forma). Las estrellas que caen detrás de una banda oscura se apagan.
  // ---------------------------------------------------------------------------------------
  const MW_S = 0.5;
  let mwCanvas = null;

  function buildMilkyWay() {
    const W = cssW, H = cssH;
    if (!mwCanvas) mwCanvas = makeCanvas(1, 1);
    mwCanvas.width = Math.max(1, Math.round(W * MW_S));
    mwCanvas.height = Math.max(1, Math.round(H * MW_S));
    const g = mwCanvas.getContext('2d');

    const diag = Math.sqrt(W * W + H * H);
    const ang = -Math.atan2(H, W) * 0.8;               // sube hacia la derecha, casi la diagonal
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const cx0 = W * 0.5, cy0 = H * 0.44, half = diag * 0.12;
    const fq = 11 / diag;

    // 1. brillo, polvo y bandas oscuras a baja resolución (se suaviza al escalar)
    const lw = Math.max(40, Math.ceil(W / 8)), lh = Math.max(26, Math.ceil(H / 8));
    const low = makeCanvas(lw, lh), lg = low.getContext('2d');
    const img = lg.createImageData(lw, lh), d = img.data;
    const band = new Float32Array(lw * lh), lane = new Float32Array(lw * lh);
    const nA = makeNoise(), nB = makeNoise(), nC = makeNoise();
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        const px = (x + 0.5) * W / lw, py = (y + 0.5) * H / lh;
        const rx = px - cx0, ry = py - cy0;
        // ruido en coordenadas de la banda, estirado a lo largo: nubes y bandas oscuras
        // alargadas como en las fotos (sin estirar, las crestas se cierran en anillos)
        const alPx = rx * dx + ry * dy, acPx = ry * dx - rx * dy;
        const along = alPx / (diag * 0.5);
        const warp = (fbm(nC, px * fq * 0.55 + 3.1, py * fq * 0.55, 3) - 0.5) * 1.2;
        const ac = acPx / half + warp;
        const core = Math.exp(-ac * ac * 1.7);
        const n1 = fbm(nA, alPx * fq * 0.75, acPx * fq * 1.5, 4);
        const bulge = 0.65 + 0.55 * Math.exp(-(along - 0.3) * (along - 0.3) * 4);
        const glow = Math.min(1, core * bulge * (0.2 + 1.25 * n1 * n1));
        const n2 = fbm(nB, alPx * fq * 0.9 + 11, (acPx + warp * half) * fq * 3.2 + 5, 4);
        const ridge = 1 - Math.abs(2 * n2 - 1);
        const laneEnv = Math.exp(-(ac - 0.12) * (ac - 0.12) * 4.5);
        const la = smoothstep(0.6, 0.9, ridge) * laneEnv * (0.45 + 0.55 * core) * 0.8;
        const da = smoothstep(0.42, 0.68, ridge) * laneEnv * core * 0.32;
        // brillo: núcleo cálido, bordes blanco azulado
        const warm = clamp(core * 0.85 + (n1 - 0.5) * 0.8, 0, 1);
        let r = 146 + 72 * warm, gr = 158 + 26 * warm, b = 204 - 66 * warm, a = glow * 0.34;
        // polvo cálido alrededor de las bandas oscuras (#8A5A3C)
        let na = da + a * (1 - da);
        if (na > 0) { r = (138 * da + r * a * (1 - da)) / na; gr = (90 * da + gr * a * (1 - da)) / na; b = (60 * da + b * a * (1 - da)) / na; }
        a = na;
        // banda oscura
        na = la + a * (1 - la);
        if (na > 0) { r = (4 * la + r * a * (1 - la)) / na; gr = (4 * la + gr * a * (1 - la)) / na; b = (9 * la + b * a * (1 - la)) / na; }
        a = na;
        const o = (y * lw + x) * 4;
        d[o] = Math.round(r); d[o + 1] = Math.round(gr); d[o + 2] = Math.round(b); d[o + 3] = Math.round(clamp(a, 0, 1) * 255);
        band[y * lw + x] = glow; lane[y * lw + x] = la;
      }
    }
    lg.putImageData(img, 0, 0);

    // 2. estrellas fijas (infinitamente lejos: no derivan ni titilan), escritas píxel a píxel
    // con reparto bilineal; las que caen detrás de una banda oscura se apagan
    const mw = mwCanvas.width, mh = mwCanvas.height;
    const simg = g.createImageData(mw, mh), sd = simg.data;
    const bright = [];
    function cell(x, y) { return clamp(Math.floor(y / H * lh), 0, lh - 1) * lw + clamp(Math.floor(x / W * lw), 0, lw - 1); }
    function plot(ix, iy, rgb, sa) {
      if (ix < 0 || iy < 0 || ix >= mw || iy >= mh || sa < 0.004) return;
      const o = (iy * mw + ix) * 4, da = sd[o + 3] / 255, k = da * (1 - sa), oa = sa + k;
      sd[o] = (rgb[0] * sa + sd[o] * k) / oa; sd[o + 1] = (rgb[1] * sa + sd[o + 1] * k) / oa;
      sd[o + 2] = (rgb[2] * sa + sd[o + 2] * k) / oa; sd[o + 3] = oa * 255;
    }
    function star(x, y, a) {
      const col = pickStarColor();
      if (Math.random() < 0.012) { bright.push(x, y, a, col); return; }
      const rgb = palRGB[col], bx = x * MW_S - 0.5, by = y * MW_S - 0.5;
      const ix = Math.floor(bx), iy = Math.floor(by), fx = bx - ix, fy = by - iy;
      plot(ix, iy, rgb, a * (1 - fx) * (1 - fy)); plot(ix + 1, iy, rgb, a * fx * (1 - fy));
      plot(ix, iy + 1, rgb, a * (1 - fx) * fy); plot(ix + 1, iy + 1, rgb, a * fx * fy);
    }
    const nBg = Math.min(1600, Math.round(W * H / 1400));
    for (let i = 0; i < nBg; i++) {
      const x = Math.random() * W, y = Math.random() * H;
      star(x, y, rand(0.14, 0.55) * (1 - lane[cell(x, y)] * 0.9));
    }
    const nBand = Math.min(3600, Math.round(W * H / 420));
    for (let i = 0; i < nBand; i++) {
      const al = rand(-1.15, 1.15) * diag * 0.5, ac = gauss() * half * 0.6;
      const x = cx0 + dx * al - dy * ac, y = cy0 + dy * al + dx * ac;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const k = cell(x, y);
      if (Math.random() > 0.25 + band[k]) continue;
      star(x, y, rand(0.16, 0.7) * (1 - lane[k] * 0.95));
    }

    // 3. componer: estrellas, el polvo detrás (destination-over) y las pocas brillantes encima
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.putImageData(simg, 0, 0);
    g.globalCompositeOperation = 'destination-over';
    g.imageSmoothingEnabled = true;
    try { g.imageSmoothingQuality = 'high'; } catch (e) { /* nada */ }
    g.drawImage(low, 0, 0, mw, mh);
    g.globalCompositeOperation = 'source-over';
    g.setTransform(MW_S, 0, 0, MW_S, 0, 0);
    for (let i = 0; i < bright.length; i += 4) {
      g.globalAlpha = clamp(bright[i + 2] * 1.6, 0, 0.85);
      g.drawImage(palStar[bright[i + 3]], bright[i] - 3.5, bright[i + 1] - 3.5, 7, 7);
    }
    g.globalAlpha = 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  const buildMs = { caches: 0, sky: 0 };
  function buildCaches() {
    const t0 = now();
    buildNebula();
    buildHAlpha();
    buildClouds();
    buildSpike();
    buildPlanetBase();
    buildSky();
    buildMs.caches = Math.round(now() - t0);
  }

  // ---------------------------------------------------------------------------------------
  // Estrellas y polvo (tres profundidades). No suben: derivan muy lento hacia abajo, más
  // rápido cuanto más cerca (nos alejamos del planeta).
  // ---------------------------------------------------------------------------------------
  const LAYER_BASE = [130, 46, 10];
  const LAYER_MAX = coarse ? [80, 28, 6] : [140, 50, 12];   // 202 en total (114 con pointer: coarse)
  const LAYER_START = [0, LAYER_MAX[0], LAYER_MAX[0] + LAYER_MAX[1]];
  const NP = LAYER_MAX[0] + LAYER_MAX[1] + LAYER_MAX[2];
  const LAYER_PARALLAX = [3, 9, 26];
  const LAYER_PUSH = [0.35, 0.7, 1.6];
  const sX = new Float32Array(NP), sY = new Float32Array(NP), sA = new Float32Array(NP), sS = new Float32Array(NP),
      sV = new Float32Array(NP), sTw = new Float32Array(NP), sTp = new Float32Array(NP), sTa = new Float32Array(NP),
      sChamp = new Float32Array(NP), sRank = new Float32Array(NP);
  const sCol = new Uint8Array(NP), sLayer = new Uint8Array(NP), sSpike = new Uint8Array(NP);
  const parX = new Float32Array(3), parY = new Float32Array(3);

  function initStars() {
    for (let L = 0; L < 3; L++) {
      for (let k = 0; k < LAYER_MAX[L]; k++) {
        const i = LAYER_START[L] + k;
        sLayer[i] = L; sRank[i] = k;
        sX[i] = Math.random() * cssW; sY[i] = Math.random() * cssH;
        sSpike[i] = 0;
        if (L === 0) {
          sS[i] = rand(0.55, 1.0); sA[i] = rand(0.3, 0.7); sV[i] = rand(0.8, 1.6);
          sTw[i] = TAU / rand(900, 3200); sTa[i] = rand(0.25, 0.6);
          sCol[i] = pickStarColor();
        } else if (L === 1) {
          sS[i] = rand(1.0, 1.8); sA[i] = rand(0.35, 0.75); sV[i] = rand(2.5, 4.5);
          sTw[i] = TAU / rand(2500, 6000); sTa[i] = rand(0.1, 0.25);
          sCol[i] = pickStarColor();
          if (k < 3) { sSpike[i] = 1; sS[i] = rand(1.6, 2.0); sA[i] = rand(0.55, 0.75); sCol[i] = Math.random() < 0.6 ? C_ST_BLUE : C_ST_WHITE; }
        } else {
          // motas de polvo desenfocadas, siempre tenues (detrás del texto)
          sS[i] = rand(5, 14); sA[i] = rand(0.04, 0.11); sV[i] = rand(7, 12);
          sTw[i] = TAU / rand(6000, 11000); sTa[i] = 0;
          const r = Math.random();
          sCol[i] = r < 0.4 ? C_ST_PALE : (r < 0.7 ? C_ST_BLUE : (r < 0.9 ? C_ST_AMBER : C_ST_WHITE));
        }
        sTp[i] = Math.random() * TAU;
        sChamp[i] = Math.random();
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // Partículas de efecto (estela, ráfagas, intro). Pool fijo, reemplaza a la más vieja.
  // Sin gravedad: lo suelto deriva y se apaga.
  // ---------------------------------------------------------------------------------------
  const FX_MAX = coarse ? 60 : 100;
  const fX = new Float32Array(FX_MAX), fY = new Float32Array(FX_MAX), fVX = new Float32Array(FX_MAX), fVY = new Float32Array(FX_MAX),
      fAge = new Float32Array(FX_MAX), fLife = new Float32Array(FX_MAX), fSize = new Float32Array(FX_MAX),
      fAlpha = new Float32Array(FX_MAX), fGrav = new Float32Array(FX_MAX), fDrag = new Float32Array(FX_MAX);
  const fCol = new Uint8Array(FX_MAX);
  let fxNext = 0;

  function fxEmit(x, y, vx, vy, life, size, col, grav, drag, alpha) {
    const i = fxNext;
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
    let count = opts.count == null ? 24 : opts.count;
    if (reduced) count = Math.ceil(count / 2);
    const col = colorIndex(opts.color || '#5ED8C4');
    const col2 = opts.color2 ? colorIndex(opts.color2) : col;
    const spread = opts.spread == null ? TAU : opts.spread;
    const angle = opts.angle == null ? 0 : opts.angle;
    const grav = opts.gravity == null ? 0 : opts.gravity;
    const drag = opts.drag == null ? 0.94 : opts.drag;
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const sp = rangeVal(opts.speed, 40, 140);
      fxEmit(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rangeVal(opts.life, 700, 1400) / 1000,
        rangeVal(opts.size, 1.2, 3), (i % 3 === 2) ? col2 : col, grav, drag, opts.alpha == null ? 1 : opts.alpha);
    }
    ensureRunning();
  }

  // ---------------------------------------------------------------------------------------
  // Pulsos
  // ---------------------------------------------------------------------------------------
  const PULSES = 3;
  const puT0 = new Float64Array(PULSES), puStr = new Float32Array(PULSES), puSpr = new Array(PULSES), puOn = new Uint8Array(PULSES);
  function pulse(color, strength) {
    if (!canvas) return;
    const s = strength == null ? 0.3 : +strength;
    if (!(s > 0)) return;
    let slot = -1, oldest = Infinity;
    for (let i = 0; i < PULSES; i++) {
      if (!puOn[i]) { slot = i; break; }
      if (puT0[i] < oldest) { oldest = puT0[i]; slot = i; }
    }
    puOn[slot] = 1; puT0[slot] = now(); puStr[slot] = clamp(s, 0, 1.5); puSpr[slot] = pulseSprite(color || '#5ED8C4');
    ensureRunning();
  }

  // ---------------------------------------------------------------------------------------
  // Empuje del viaje: alejarse del planeta empuja las estrellas hacia abajo; volver, hacia arriba
  // ---------------------------------------------------------------------------------------
  let pushT0 = -1e9, pushDir = 0;
  function descend(dir) {
    if (reduced) return;
    pushDir = dir < 0 ? -1 : 1;
    pushT0 = now();
  }
  function pushSpeed(t) {
    const e = t - pushT0;
    if (e < 0 || e > 900) return 0;
    return 60 * pushDir * (1 - easeOutExpo(e / 900));
  }

  // ---------------------------------------------------------------------------------------
  // Puntero (el momento firma: deja polvo estelar)
  // ---------------------------------------------------------------------------------------
  let ptrX = -1e4, ptrY = -1e4, ptrHas = false;
  let emitX = 0, emitY = 0, emitPending = false;
  let parTX = 0, parTY = 0;

  function onPointer(x, y) {
    if (!ptrHas) { emitX = x; emitY = y; }
    ptrX = x; ptrY = y; ptrHas = true; emitPending = true;
    parTX = cssW > 0 ? (x / cssW - 0.5) : 0;
    parTY = cssH > 0 ? (y / cssH - 0.5) : 0;
  }
  function bindPointer() {
    const opt = { passive: true };
    global.addEventListener('pointermove', function (e) { onPointer(e.clientX, e.clientY); }, opt);
    global.addEventListener('pointerdown', function (e) {
      if (e.pointerType !== 'mouse') { ptrHas = false; onPointer(e.clientX, e.clientY); }
    }, opt);
    global.addEventListener('touchmove', function (e) {
      if (e.touches && e.touches[0]) onPointer(e.touches[0].clientX, e.touches[0].clientY);
    }, opt);
  }

  // ---------------------------------------------------------------------------------------
  // Cuerpos (siluetas lejanas y criatura de la intro): contorno a partir de un lomo
  // ---------------------------------------------------------------------------------------
  function spineNormals(px, py, n, nx, ny) {
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? i - 1 : 0, b = i < n - 1 ? i + 1 : n - 1;
      let tx = px[a] - px[b], ty = py[a] - py[b];     // tangente hacia la cabeza
      const l = Math.sqrt(tx * tx + ty * ty) || 1;
      tx /= l; ty /= l;
      nx[i] = -ty; ny[i] = tx;
    }
  }
  // Un lado del lomo a la cola, el otro de vuelta y la cabeza redondeada.
  function bodyPath(g, px, py, nx, ny, hw, n, k) {
    const tx = ny[0], ty = -nx[0], h0 = hw[0] * k, c = h0 * 1.25;
    g.beginPath();
    g.moveTo(px[0] + nx[0] * h0, py[0] + ny[0] * h0);
    for (let i = 1; i < n; i++) g.lineTo(px[i] + nx[i] * hw[i] * k, py[i] + ny[i] * hw[i] * k);
    for (let i = n - 1; i >= 0; i--) g.lineTo(px[i] - nx[i] * hw[i] * k, py[i] - ny[i] * hw[i] * k);
    g.bezierCurveTo(px[0] - nx[0] * h0 + tx * c, py[0] - ny[0] * h0 + ty * c,
      px[0] + nx[0] * h0 + tx * c, py[0] + ny[0] * h0 + ty * c,
      px[0] + nx[0] * h0, py[0] + ny[0] * h0);
    g.closePath();
  }

  // ---------------------------------------------------------------------------------------
  // Siluetas lejanas: parientes gigantes de las serpientes del juego. Cuerpo largo, sinuoso y
  // afinado, oscuro, con un borde tenue de luz estelar y unas pocas estrellas adentro. Cruzan
  // la pantalla de lado a lado en 60 a 90 s mientras una onda lenta recorre el cuerpo.
  // ---------------------------------------------------------------------------------------
  const SIL_N = 36, SIL_STARS = 13;
  const silPX = new Float32Array(SIL_N), silPY = new Float32Array(SIL_N), silNX = new Float32Array(SIL_N),
      silNY = new Float32Array(SIL_N), silHW = new Float32Array(SIL_N), SIL_PROF = new Float32Array(SIL_N);
  (function buildSilProfile() {
    for (let i = 0; i < SIL_N; i++) {
      const f = i / (SIL_N - 1);
      // como las serpientes del juego: cabeza apenas redondeada, cuerpo casi parejo que se
      // afina recién en la segunda mitad hasta una cola fina
      const head = f < 0.04 ? 0.8 + 0.2 * Math.sin(f / 0.04 * Math.PI / 2) : 1;
      const tail = 1 - smoothstep(0.4, 1, f);
      SIL_PROF[i] = head * (1 - 0.2 * f) * (0.06 + 0.94 * Math.pow(tail, 0.85));
    }
  })();
  const SIL_BODY = 'rgb(5,5,11)', SIL_RIM = 'rgb(196,210,255)';

  function makeSil() {
    return {
      band: 0, x0: 0, y0: 0, dx: 1, dy: 0, u: 0, travel: 1, speed: 0, len: 600, w: 20,
      amp: 30, k: 0.01, amp2: 8, k2: 0.01, om: 0.0003, ph: 0,
      stF: new Float32Array(SIL_STARS), stO: new Float32Array(SIL_STARS), stP: new Float32Array(SIL_STARS),
      stC: new Uint8Array(SIL_STARS)
    };
  }
  const sils = [makeSil(), makeSil()];
  sils[1].band = 1;   // una más arriba y otra más abajo, para que no se encimen

  function resetSil(s, initial, ltr) {
    const ang = rand(-0.12, 0.12);
    if (ltr === undefined) ltr = Math.random() < 0.5;
    s.dx = Math.cos(ang) * (ltr ? 1 : -1); s.dy = Math.sin(ang);
    s.len = clamp(rand(0.5, 0.72) * cssW, 300, 1400);
    s.w = clamp(s.len * rand(0.055, 0.07), 20, 84);
    s.amp = rand(0.025, s.band ? 0.035 : 0.05) * Math.min(cssW, cssH) + 10;
    s.k = TAU / (Math.max(s.len, cssW * 0.6) * rand(0.6, 0.85));
    s.amp2 = rand(5, 11); s.k2 = TAU / (s.len * rand(0.7, 1.0)); s.om = TAU / rand(14000, 22000);
    s.ph = Math.random() * TAU;
    const margin = s.w * 2 + s.amp + s.amp2 + 30;
    // franjas libres de la intro: arriba del título y entre la bajada y el horizonte del planeta
    const yMid = (s.band ? rand(0.63, 0.69) : rand(0.08, 0.22)) * cssH;
    s.x0 = ltr ? -margin : cssW + margin;
    s.y0 = yMid - s.dy * (cssW * 0.5 + margin) / Math.abs(s.dx);
    s.travel = (cssW + 2 * margin) / Math.abs(s.dx) + s.len;
    s.speed = s.travel / rand(60000, 90000);                 // px por ms
    // al iniciar ya está cruzando; las siguientes esperan un rato fuera de la pantalla
    s.u = initial ? rand(0.25, 0.7) * s.travel : -rand(0.05, 0.45) * s.travel;
    for (let j = 0; j < SIL_STARS; j++) {
      s.stF[j] = rand(0.06, 0.7); s.stO[j] = rand(-0.6, 0.6); s.stP[j] = Math.random() * TAU;
      s.stC[j] = Math.random() < 0.55 ? C_ST_WHITE : (Math.random() < 0.6 ? C_ST_BLUE : C_ST_PALE);
    }
  }

  function silSpine(s, t) {
    const ds = s.len / (SIL_N - 1), qx = -s.dy, qy = s.dx;
    for (let i = 0; i < SIL_N; i++) {
      const ui = s.u - i * ds;
      const off = s.amp * Math.sin(s.k * ui + s.ph) + s.amp2 * Math.sin(s.k2 * ui - s.om * t);
      silPX[i] = s.x0 + s.dx * ui + qx * off;
      silPY[i] = s.y0 + s.dy * ui + qy * off;
      silHW[i] = s.w * 0.5 * SIL_PROF[i];
    }
    spineNormals(silPX, silPY, SIL_N, silNX, silNY);
  }

  function rimStroke(g, side, from, to) {
    g.beginPath();
    for (let i = from; i <= to; i++) {
      const o = silHW[i] * side * 0.7;
      const x = silPX[i] + silNX[i] * o, y = silPY[i] + silNY[i] * o;
      if (i === from) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }

  function drawSil(g, t, s, f) {
    if (s.u <= 0) return;
    silSpine(s, t);
    const ox = parX[0] * 0.6, oy = parY[0] * 0.6;
    g.save();
    g.translate(ox, oy);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    // cuerpo de gas oscuro: tres capas, más densas hacia el lomo, así el borde es blando y
    // lo de atrás se ve a medias a través
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = SIL_BODY;
    bodyPath(g, silPX, silPY, silNX, silNY, silHW, SIL_N, 1.0);
    g.globalAlpha = 0.2 * f; g.fill();
    bodyPath(g, silPX, silPY, silNX, silNY, silHW, SIL_N, 0.74);
    g.globalAlpha = 0.24 * f; g.fill();
    bodyPath(g, silPX, silPY, silNX, silNY, silHW, SIL_N, 0.46);
    g.globalAlpha = 0.3 * f; g.fill();
    // luz estelar sobre el lado que mira al planeta (abajo): un brillo ancho y uno fino,
    // más tenues hacia la cola
    let ny = 0;
    for (let i = 0; i < SIL_N; i += 5) ny += silNY[i];
    const side = ny >= 0 ? 1 : -1, third = Math.floor(SIL_N / 3);
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = SIL_RIM;
    g.lineWidth = 9;
    g.globalAlpha = 0.04 * f; rimStroke(g, side, 0, third);
    g.globalAlpha = 0.025 * f; rimStroke(g, side, third, third * 2);
    g.lineWidth = 3.5;
    g.globalAlpha = 0.05 * f; rimStroke(g, side, 0, third);
    g.globalAlpha = 0.03 * f; rimStroke(g, side, third, third * 2);
    g.globalAlpha = 0.015 * f; rimStroke(g, side, third * 2, SIL_N - 1);
    // ojo: un brillo pálido cerca de la cabeza, del lado iluminado
    const e = 1, eo = silHW[e] * side * 0.35;
    g.globalAlpha = 0.6 * f;
    g.drawImage(palStar[C_ST_PALE], silPX[e] + silNX[e] * eo - 4, silPY[e] + silNY[e] * eo - 4, 8, 8);
    // estrellas adentro
    for (let j = 0; j < SIL_STARS; j++) {
      const i = Math.floor(s.stF[j] * (SIL_N - 1));
      const x = silPX[i] + silNX[i] * silHW[i] * s.stO[j], y = silPY[i] + silNY[i] * silHW[i] * s.stO[j];
      g.globalAlpha = f * (0.5 + 0.38 * Math.sin(t * 0.0017 + s.stP[j]));
      g.drawImage(palStar[s.stC[j]], x - 3.5, y - 3.5, 7, 7);
    }
    g.restore();
  }

  // ---------------------------------------------------------------------------------------
  // Intro: destello, cascada en espiral (una galaxia que se enciende) y criatura de gas
  // ---------------------------------------------------------------------------------------
  const NSPARK = 49;
  const skX = new Float32Array(NSPARK), skY = new Float32Array(NSPARK), skD = new Float32Array(NSPARK),
      skS = new Float32Array(NSPARK);
  const skC = new Uint8Array(NSPARK);
  let introT0 = -1, introVariant = null, introCreatureOn = false;
  const CREATURE_N = 12, CREATURE_SPACING = 16, CREATURE_S = 20;
  const crX = new Float32Array(CREATURE_N), crY = new Float32Array(CREATURE_N), crNX = new Float32Array(CREATURE_N),
      crNY = new Float32Array(CREATURE_N), crHW = new Float32Array(CREATURE_N);
  let crHeadX = -1e4;
  (function buildCreatureWidths() {
    for (let i = 0; i < CREATURE_N; i++) crHW[i] = CREATURE_S * (0.46 - 0.22 * Math.pow(i / (CREATURE_N - 1), 1.4));
  })();
  const CR_GAS = 'rgba(94,216,196,0.30)', CR_CORE = 'rgba(214,246,240,0.20)';

  function buildSparks() {
    const ox = cssW * 0.4, oy = cssH * 0.55;
    const scale = clamp(Math.min(cssW, cssH) / 900, 0.45, 1.3);
    const rmax = 400 * scale;
    skX[0] = ox; skY[0] = oy; skD[0] = 150; skS[0] = 3.2; skC[0] = C_PEARL;
    for (let k = 1; k < NSPARK; k++) {
      const arm = k & 1, j = (k - 1) >> 1;          // dos brazos de 24 puntos
      const f = (j + 1) / 24;
      const ang = arm * Math.PI + f * TAU * 1.25 - 0.6;
      const r = 18 * scale + (rmax - 18 * scale) * Math.pow(f, 0.85);
      skX[k] = ox + Math.cos(ang) * r + rand(-10, 10) * scale;
      skY[k] = oy + Math.sin(ang) * r * 0.82 + rand(-10, 10) * scale;
      const dist = Math.sqrt((skX[k] - ox) * (skX[k] - ox) + (skY[k] - oy) * (skY[k] - oy));
      skD[k] = 400 + dist / (0.45 * scale) + rand(-60, 60);
      skS[k] = rand(1.6, 3.0);
      skC[k] = f < 0.35 ? (Math.random() < 0.6 ? C_ST_PALE : C_ST_AMBER) : pickStarColor();
    }
  }

  function creatureHeadX(t) {
    const p = (t - introT0 - 900) / 1200;
    return -60 + (cssW + 60 + CREATURE_N * CREATURE_SPACING + 60) * p;
  }
  function creatureY(x) { return cssH * 0.35 + 40 * Math.sin(TAU * x / 420); }

  // Timeline (eventos programados por tiempo; se procesan en el frame)
  const evAt = [], evFn = [];
  function schedule(delay, fn) { evAt.push(now() + delay); evFn.push(fn); ensureRunning(); }
  function cancelTimeline() { evAt.length = 0; evFn.length = 0; }
  function runTimeline(t) {
    for (let i = 0; i < evAt.length; i++) {
      if (t >= evAt[i]) {
        const fn = evFn[i];
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
      // primero aparece el borde del planeta; el cielo completo llega con el título
      schedule(400, function () {
        scratchVec.set(MOODS.intro.v); scratchVec[K_DENS] = 0; scratchVec[K_MW] = 0; scratchVec[K_NEB] = 0.15;
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
    const t = now() - introT0;
    if (t < 900) return -Infinity;
    if (t > 2400) return Infinity;
    return creatureHeadX(now());
  }

  // ---------------------------------------------------------------------------------------
  // Ambientes públicos
  // ---------------------------------------------------------------------------------------
  function setMood(name, opts) {
    const m = MOODS[name];
    if (!m) return;
    opts = opts || {};
    const color = opts.color ? parseColor(opts.color) : null;
    if (name === moodName && !(name === 'celebration' && color)) return;
    cancelTimeline();
    moodName = name;
    targetFps = m.fps;
    setRes(m.res);
    if (name === 'celebration') {
      setChampColor(color || [234, 194, 85]);
    }
    transitionParams(m.v, reduced ? 400 : 1200);
    if (name === 'celebration') scheduleCelebration();
    ensureRunning();
  }

  function scheduleCelebration() {
    const champHex = palRGB[C_CHAMP] ? '#' + ((1 << 24) | (palRGB[C_CHAMP][0] << 16) | (palRGB[C_CHAMP][1] << 8) | palRGB[C_CHAMP][2]).toString(16).slice(1) : '#EAC255';
    for (let i = 0; i < 6; i++) {
      (function (k) {
        schedule(250 + k * 500, function () {
          const bx = rand(0.12, 0.88) * cssW, by = rand(0.16, 0.72) * cssH;
          // destello local que se abre y se apaga, y la ráfaga de polvo estelar del campeón
          fxEmit(bx, by, 0, 0, 0.75, 26, colorIndex(champHex), 0, 1, reduced ? 0.12 : 0.32);
          burst(bx, by, {
            count: 40, color: champHex, color2: '#F6F3EE', speed: [50, 210], life: [1100, 2000],
            size: [1.6, 3.8], gravity: 0, drag: 0.95
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
    const w = Math.max(1, global.innerWidth || doc.documentElement.clientWidth || 1);
    const h = Math.max(1, global.innerHeight || doc.documentElement.clientHeight || 1);
    const changed = w !== cssW || h !== cssH;
    if (cssW > 1 && cssH > 1 && changed) {
      const sx = w / cssW, sy = h / cssH;
      for (let i = 0; i < NP; i++) { sX[i] *= sx; sY[i] *= sy; }
    }
    cssW = w; cssH = h; maxSide = Math.max(w, h);
    const bw = Math.max(1, Math.round(w * res)), bh = Math.max(1, Math.round(h * res));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    if (changed || !mwCanvas) rebuildSized();
    topR = -1;
  }
  // Lo que depende del tamaño de la pantalla. La Vía Láctea se regenera solo si cambia el
  // ancho o el alto cambia más de un 25 %: la barra de direcciones del celular, que aparece y
  // se esconde, apenas la estira. El caché del planeta (barato) se ajusta siempre.
  let skyW = 0, skyH = 0;
  function rebuildSized() {
    if (!mwCanvas || cssW !== skyW || Math.abs(cssH - skyH) > skyH * 0.25) {
      const t0 = now();
      buildMilkyWay();
      buildMs.sky = Math.round(now() - t0);
      skyW = cssW; skyH = cssH;
      const ltr = Math.random() < 0.5;
      resetSil(sils[0], true, ltr); resetSil(sils[1], true, !ltr);
    }
    if (planetCanvas) {
      planetCanvas.width = Math.max(1, Math.round(cssW * PR));
      planetCanvas.height = Math.max(1, Math.round(cssH * PR));
      const sg = planetCtx.createLinearGradient(0, 0, cssW, 0);
      sg.addColorStop(0, 'rgba(0,0,0,0.3)');
      sg.addColorStop(0.5, 'rgba(0,0,0,0.65)');
      sg.addColorStop(0.85, 'rgba(0,0,0,1)');
      sg.addColorStop(1, 'rgba(0,0,0,1)');
      sideGrad = sg;
      plDirty = true;
    }
  }
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { resizeTimer = 0; applySize(); ensureRunning(); }, 100);
  }

  // ---------------------------------------------------------------------------------------
  // Paso de simulación
  // ---------------------------------------------------------------------------------------
  function visibleCount(L) {
    const c = LAYER_BASE[L] * cur[K_DENS] * (coarse ? 0.6 : 1);
    return c > LAYER_MAX[L] ? LAYER_MAX[L] : c;
  }

  let nebT = 0;

  function step(t, dtMs) {
    const dt = dtMs / 1000;
    runTimeline(t);
    stepTransition(t);

    const speedMul = cur[K_SPEED] * (reduced ? 0.15 : 1);
    const push = pushSpeed(t);
    const trailOn = cur[K_TRAIL] > 0.5 && !reduced;
    nebT += dtMs * (reduced ? 0.15 : 1);

    // Parallax suave hacia el puntero
    const k = clamp(dt * 2.2, 0, 1);
    for (let L = 0; L < 3; L++) {
      parX[L] += (-parTX * LAYER_PARALLAX[L] - parX[L]) * k;
      parY[L] += (-parTY * LAYER_PARALLAX[L] * 0.6 - parY[L]) * k;
    }

    // Criatura de la intro: cruza y deja polvo detrás de la cola
    if (introCreatureOn && introT0 >= 0) {
      const it = t - introT0;
      if (it >= 900 && it <= 2500) {
        crHeadX = creatureHeadX(t);
        for (let c = 0; c < CREATURE_N; c++) {
          crX[c] = crHeadX - c * CREATURE_SPACING;
          crY[c] = creatureY(crX[c]);
        }
        if (crHeadX > -20 && crHeadX < cssW + 20) {
          const tx = crX[CREATURE_N - 1], ty = crY[CREATURE_N - 1], r = Math.random();
          fxEmit(tx + rand(-4, 4), ty + rand(-4, 4), rand(-16, 6), rand(-7, 7), rand(1.0, 1.7), rand(0.9, 2.2),
            r < 0.6 ? C_TURQ : (r < 0.85 ? C_GOLD_SOFT : C_PEARL), 0, 0.965, 0.85);
          fxEmit(crX[6] + rand(-6, 6), crY[6] + rand(-6, 6), rand(-10, 6), rand(-6, 6), rand(0.8, 1.3), rand(0.7, 1.6),
            C_TURQ, 0, 0.965, 0.6);
        }
      } else if (it > 2500) {
        introCreatureOn = false;
      }
    }

    // Estrellas y polvo: deriva hacia abajo, más rápida cuanto más cerca
    for (let i = 0; i < NP; i++) {
      sY[i] += (sV[i] * speedMul + push * LAYER_PUSH[sLayer[i]]) * dt;
      if (sY[i] > cssH + 24) { sY[i] -= cssH + 48; sX[i] = Math.random() * cssW; }
      else if (sY[i] < -24) { sY[i] += cssH + 48; sX[i] = Math.random() * cssW; }
    }

    // Estela del puntero: polvo estelar verde azulado y dorado
    if (trailOn && emitPending && ptrHas) {
      const ex = ptrX - emitX, ey = ptrY - emitY, dist = Math.sqrt(ex * ex + ey * ey);
      const n = Math.min(4, Math.floor(dist / 7));
      if (n >= 1) {
        const inv = 1 / (dist || 1), nx = -ey * inv, ny = ex * inv;
        for (let j = 0; j < n; j++) {
          const f = (j + 1) / n, off = rand(-5, 5);
          const big = Math.random() < 0.12, r = Math.random();
          fxEmit(emitX + ex * f + nx * off, emitY + ey * f + ny * off,
            nx * off * 2 + rand(-8, 8) + ex * inv * 6, ny * off * 2 + rand(-8, 8) + ey * inv * 6,
            rand(0.9, 1.4), big ? rand(2.2, 3.0) : rand(0.9, 2.0), r < 0.6 ? C_TURQ : (r < 0.85 ? C_GOLD_SOFT : C_GOLD),
            0, 0.95, big ? 0.5 : 0.9);
        }
        emitX = ptrX; emitY = ptrY;
      }
      if (dist < 7) emitPending = false;
    } else if (!trailOn) {
      emitX = ptrX; emitY = ptrY; emitPending = false;
    }

    // FX
    for (let q = 0; q < FX_MAX; q++) {
      if (fLife[q] <= 0) continue;
      fAge[q] += dt;
      if (fAge[q] >= fLife[q]) { fLife[q] = 0; continue; }
      const dr = Math.pow(fDrag[q], dt * 60);
      fVX[q] *= dr; fVY[q] = fVY[q] * dr + fGrav[q] * dt;
      fX[q] += fVX[q] * dt; fY[q] += fVY[q] * dt;
    }

    // Siluetas
    const silSpeed = reduced ? 0.2 : 1;
    for (let s = 0; s < 2; s++) {
      const sl = sils[s];
      sl.u += sl.speed * dtMs * silSpeed;
      if (sl.u > sl.travel) resetSil(sl, false);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Dibujo
  // ---------------------------------------------------------------------------------------
  function drawStarLayer(g, t, L) {
    const vis = visibleCount(L);
    if (vis <= 0.01) return;
    const start = LAYER_START[L], end = start + LAYER_MAX[L];
    const ox = parX[L], oy = parY[L], champ = cur[K_CHAMP], twMul = reduced ? 0.3 : 1;
    for (let i = start; i < end; i++) {
      let fade = vis - sRank[i];
      if (fade <= 0) continue;
      if (fade > 1) fade = 1;
      const col = (champ > 0.01 && L > 0 && sChamp[i] < champ) ? C_CHAMP : sCol[i];
      if (L === 2) {
        const x = sX[i] + ox + 4 * Math.sin(t * sTw[i] + sTp[i]), y = sY[i] + oy, d = sS[i];
        g.globalAlpha = sA[i] * fade;
        g.drawImage(palSoft[col], x - d, y - d, d * 2, d * 2);
        continue;
      }
      const tw = sTa[i] * twMul;
      const a = sA[i] * (1 - tw + tw * (0.5 + 0.5 * Math.sin(t * sTw[i] + sTp[i]))) * fade;
      const x = sX[i] + ox, y = sY[i] + oy, d = sS[i] * 7;
      g.globalAlpha = a;
      g.drawImage(palStar[col], x - d * 0.5, y - d * 0.5, d, d);
      if (sSpike[i]) {
        const sd = sS[i] * 13;
        g.globalAlpha = a * 0.55;
        g.drawImage(spikeSprite, x - sd * 0.5, y - sd * 0.5, sd, sd);
      }
    }
  }

  function draw(t, dtMs) {
    const g = ctx;
    g.setTransform(res, 0, 0, res, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;

    // 1. Vacío teñido por el ambiente
    const r = Math.round(cur[K_R]), gg = Math.round(cur[K_G]), b = Math.round(cur[K_B]);
    if (r !== topR || gg !== topG || b !== topB) {
      topR = r; topG = gg; topB = b;
      topStr = 'rgb(' + r + ',' + gg + ',' + b + ')';
    }
    g.fillStyle = topStr;
    g.fillRect(0, 0, cssW, cssH);
    // arriba, espacio negro; abajo, el resplandor de la atmósfera (sigue la altura del
    // planeta y se apaga con él: en room y game el cielo queda casi parejo)
    const sky = cur[K_SKY];
    if (sky > 0.01) {
      g.globalAlpha = clamp(sky, 0, 1);
      g.drawImage(skyDark, 0, 0, cssW, cssH);
    }
    const pa = cur[K_PL_A];
    if (pa > 0.01) {
      const apex = cur[K_PL_Y] * cssH, gy = apex - cssH * 0.62;
      if (gy < cssH) {
        g.globalAlpha = clamp(pa, 0, 1);
        g.drawImage(skyGlow, 0, gy, cssW, apex - gy);
        if (apex < cssH) { g.fillStyle = SKY_GLOW_SOLID; g.fillRect(0, apex, cssW, cssH - apex); }
      }
    }
    g.globalAlpha = 1;

    // 2. Nebulosa tenue que deriva muy lento
    const neb = cur[K_NEB];
    if (neb > 0.01 && nebTex) {
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = clamp(neb, 0, 1);
      // cubre la pantalla sin deformarse (en un celular vertical se recorta a los lados)
      const sc = Math.max(cssW / nebTex.width, cssH / nebTex.height) * 1.24;
      const nw = nebTex.width * sc, nh = nebTex.height * sc;
      const nx = (cssW - nw) * 0.5 + cssW * 0.07 * Math.sin(nebT / 41000), ny = (cssH - nh) * 0.5 + cssH * 0.07 * Math.cos(nebT / 53000);
      g.drawImage(nebTex, nx, ny, nw, nh);
    }

    // 3. Vía Láctea
    const mw = cur[K_MW];
    if (mw > 0.01 && mwCanvas) {
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = clamp(mw, 0, 1);
      g.drawImage(mwCanvas, 0, 0, cssW, cssH);
    }

    // 4. Estrellas lejanas y medias, y la espiral de la intro (todo detrás del planeta)
    g.globalCompositeOperation = 'lighter';
    drawStarLayer(g, t, 0);
    drawStarLayer(g, t, 1);
    if (introT0 >= 0 && introVariant === 'full') drawIntroSparks(g, t);

    // 5. Planeta
    drawPlanet(g);

    // 6. Siluetas lejanas
    if (cur[K_SIL1] > 0.01) drawSil(g, t, sils[0], cur[K_SIL1]);
    if (cur[K_SIL2] > 0.01) drawSil(g, t, sils[1], cur[K_SIL2]);

    // 7. Polvo cercano, desenfocado
    g.globalCompositeOperation = 'lighter';
    drawStarLayer(g, t, 2);

    // 8. Intro: criatura de gas
    if (introCreatureOn && t - introT0 >= 900) drawCreature(g, t);

    // 9. FX (estela y ráfagas)
    g.globalCompositeOperation = 'lighter';
    for (let q = 0; q < FX_MAX; q++) {
      if (fLife[q] <= 0) continue;
      const p = fAge[q] / fLife[q];
      const en = p < 0.1 ? p / 0.1 : 1 - easeInQuart((p - 0.1) / 0.9);
      g.globalAlpha = fAlpha[q] * en;
      const fd = fSize[q] * 6 * (1 - 0.35 * p);
      g.drawImage(palDot[fCol[q]], fX[q] - fd * 0.5, fY[q] - fd * 0.5, fd, fd);
    }

    // 10. Pulsos
    for (let k = 0; k < PULSES; k++) {
      if (!puOn[k]) continue;
      const pt = (t - puT0[k]) / 900;
      if (pt >= 1) { puOn[k] = 0; continue; }
      if (pt < 0) continue;
      const rad = 0.9 * maxSide * easeOutCubic(pt);
      const pa = puStr[k] * 0.35 * Math.pow(1 - pt, 1.3) * (reduced ? 0.6 : 1);
      if (rad < 1 || pa <= 0.002) continue;
      g.globalAlpha = clamp(pa, 0, 1);
      g.drawImage(puSpr[k], cssW * 0.5 - rad, cssH * 0.5 - rad, rad * 2, rad * 2);
    }

    // 11. Tensión: la nebulosa vira al rojo del hidrógeno y late
    const ha = cur[K_HA];
    if (ha > 0.01 && haTex) {
      const beat = reduced ? 0.85 : 0.72 + 0.28 * Math.sin(TAU * t / 1000);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = clamp(0.42 * ha * beat, 0, 1);
      g.drawImage(haTex, 0, 0, cssW, cssH);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }

  function drawIntroSparks(g, t) {
    const e = t - introT0;
    if (e > 4600) return;
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < NSPARK; k++) {
      const le = e - skD[k];
      if (le < 0) continue;
      let a;
      if (le < 120) a = le / 120;
      else if (le < 1020) a = 1 - 0.65 * ((le - 120) / 900);
      else a = 0.35 * (1 - clamp((le - 1020) / 1600, 0, 1));
      if (a <= 0.004) continue;
      const sz = skS[k] * (1 + 0.8 * (le < 300 ? 1 - le / 300 : 0));
      const d = sz * 7;
      g.globalAlpha = a;
      g.drawImage(palDot[skC[k]], skX[k] - d * 0.5, skY[k] - d * 0.5, d, d);
    }
  }

  // Criatura de gas: halo, cuerpo translúcido, núcleo más claro, estrellas adentro y ojos.
  function drawCreature(g, t) {
    const s = CREATURE_S, n = CREATURE_N;
    if (crHeadX < -80 - n * CREATURE_SPACING || crX[n - 1] > cssW + 80) return;
    spineNormals(crX, crY, n, crNX, crNY);
    g.globalCompositeOperation = 'lighter';
    const halo = palSoft[C_TURQ];
    for (let i = 0; i < n; i++) {
      const tt = i / (n - 1), hd = crHW[i] * 6;
      g.globalAlpha = 0.22 * (1 - 0.55 * tt);
      g.drawImage(halo, crX[i] - hd * 0.5, crY[i] - hd * 0.5, hd, hd);
    }
    // tres capas de gas, cada una más angosta, densa y clara (como las serpientes de la arena)
    g.globalAlpha = 1;
    g.fillStyle = CR_GAS;
    bodyPath(g, crX, crY, crNX, crNY, crHW, n, 1.05); g.globalAlpha = 0.45; g.fill();
    bodyPath(g, crX, crY, crNX, crNY, crHW, n, 0.72); g.globalAlpha = 0.7; g.fill();
    bodyPath(g, crX, crY, crNX, crNY, crHW, n, 0.4); g.fillStyle = CR_CORE; g.globalAlpha = 1; g.fill();
    // estrellitas que titilan adentro
    for (let i = 2; i < n; i += 2) {
      const side = (i & 2) ? 0.4 : -0.35;
      g.globalAlpha = 0.45 + 0.45 * Math.sin(t * 0.006 + i * 1.7);
      const pd = 5 + (i % 3);
      g.drawImage(palStar[C_ST_WHITE], crX[i] + crNX[i] * crHW[i] * side - pd * 0.5, crY[i] + crNY[i] * crHW[i] * side - pd * 0.5, pd, pd);
    }
    // ojos
    let dx = crX[0] - crX[1], dy = crY[0] - crY[1];
    const dl = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= dl; dy /= dl;
    const nx = -dy, ny = dx;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    for (let side = -1; side <= 1; side += 2) {
      const exx = crX[0] + dx * 0.18 * s + nx * 0.22 * s * side, eyy = crY[0] + dy * 0.18 * s + ny * 0.22 * s * side;
      g.fillStyle = '#F6F3EE';
      g.beginPath(); g.arc(exx, eyy, 0.12 * s, 0, TAU); g.fill();
      g.fillStyle = '#030307';
      g.beginPath(); g.arc(exx + dx * 0.03 * s, eyy + dy * 0.03 * s, 0.07 * s, 0, TAU); g.fill();
    }
  }

  // ---------------------------------------------------------------------------------------
  // Bucle
  // ---------------------------------------------------------------------------------------
  function frame(t) {
    rafId = 0;
    if (!running || !canvas) return;
    rafId = global.requestAnimationFrame(frame);
    if (lastT === 0) { lastT = t; lastDraw = t - 1000; }
    const minFrame = targetFps <= 30 ? (1000 / 30) - 4 : 0;
    if (t - lastDraw < minFrame) return;
    let dt = t - lastT;
    if (dt > 50) dt = 50;
    if (dt < 0) dt = 0;
    lastT = t; lastDraw = t;
    const c0 = now();
    step(t, dt);
    draw(t, dt);
    const cost = now() - c0;
    statCost = statCost * 0.95 + cost * 0.05;
    statFps = statFps * 0.95 + (dt > 0 ? 1000 / dt : 60) * 0.05;
  }
  let statCost = 0, statFps = 60;
  function stats() {
    let live = 0;
    for (let q = 0; q < FX_MAX; q++) if (fLife[q] > 0) live++;
    let vis = 0;
    for (let L = 0; L < 3; L++) vis += Math.min(LAYER_MAX[L], Math.ceil(visibleCount(L)));
    return { mood: moodName, fps: Math.round(statFps), costMs: Math.round(statCost * 100) / 100, stars: vis, fx: live, res: res, running: running, buildMs: buildMs };
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
  let bound = false;
  function init(canvasEl) {
    let el = canvasEl || doc.getElementById('backdrop');
    if (!el) {
      if (!doc.body) return false;
      el = doc.createElement('canvas');
      el.id = 'backdrop';
      el.setAttribute('aria-hidden', 'true');
      doc.body.insertBefore(el, doc.body.firstChild);
    }
    if (el === canvas) return true;
    if (!el.getContext) return false;
    const c2 = el.getContext('2d', { alpha: false });
    if (!c2) return false;
    canvas = el; ctx = c2;
    try {
      const cs = global.getComputedStyle(el);
      if (cs.position !== 'fixed') {
        el.style.position = 'fixed'; el.style.left = '0'; el.style.top = '0';
        el.style.zIndex = '0'; el.style.pointerEvents = 'none';
      }
    } catch (e) { /* nada */ }
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.display = 'block';
    if (!palDot.length) initPalette();
    if (!nebTex) buildCaches();
    applySize();
    initStars();
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
