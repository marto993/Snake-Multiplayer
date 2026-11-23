/*
 * arena.js — renderizador bioluminiscente de la arena (window.Arena).
 *
 * Dibuja canvas#game en coordenadas lógicas de W x H (768 x 432 por defecto), con el backing store
 * escalado por devicePixelRatio. Sin shadowBlur por frame: todo brillo sale de
 * sprites cacheados con globalCompositeOperation 'lighter'. Sin allocations
 * grandes por frame (buffers Float32Array reutilizados, pools de efectos).
 *
 * Depende de window.Particles (public/js/fx/particles.js), que se carga antes.
 * Especificación: docs/VISUAL_SPEC.md, secciones 2.3 y 5.
 *
 * API pública:
 *   Arena.init(canvasEl)
 *   Arena.setConfig({ segmentSize, width, height })   (tamaño del mundo, del servidor)
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

  // Mundo apaisado de 768 × 432 (16:9); setConfig lo actualiza con canvasWidth / canvasHeight del servidor
  let W = 768, H = 432, HALF_W = 384, HALF_H = 216;
  const TAU = Math.PI * 2;
  const BG_HEX = '#020A12';
  const BG_RGB = [2, 10, 18];

  const FONT_UI = '"Recursive", "Segoe UI", system-ui, sans-serif';
  const FONT_DISPLAY = '"Fraunces", "Iowan Old Style", Georgia, serif';

  // ---------------------------------------------------------------------------
  // Curvas (sección 3.2)
  // ---------------------------------------------------------------------------
  function easeOutExpo(t) { return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t); }
  function easeInOutSine(t) { return -(Math.cos(Math.PI * t) - 1) / 2; }
  function easeOutBack(t) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
  function easeOutCubic(t) { const u = 1 - t; return 1 - u * u * u; }
  function smoothstep(a, b, x) { let t = (x - a) / (b - a); t = t < 0 ? 0 : (t > 1 ? 1 : t); return t * t * (3 - 2 * t); }
  function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  // ---------------------------------------------------------------------------
  // Preferencias del usuario
  // ---------------------------------------------------------------------------
  let reducedMotion = false;
  let coarsePointer = false;
  let highContrast = false;

  function watchMedia(query, fn) {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    let mq;
    try { mq = window.matchMedia(query); } catch (err) { return; }
    fn(mq.matches);
    const handler = function (ev) { fn(ev.matches); };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  }

  // ---------------------------------------------------------------------------
  // Colores de jugador (sección 2.3)
  // ---------------------------------------------------------------------------
  const BIO_PLAYER = {
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
    let s = String(str || '').trim();
    if (s.charAt(0) === '#') s = s.slice(1);
    if (s.length === 3) s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    const n = parseInt(s.slice(0, 6), 16);
    if (s.length < 6 || isNaN(n)) return null;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function toHex(r, g, b) {
    const v = ((1 << 24) | (Math.round(clamp(r, 0, 255)) << 16) | (Math.round(clamp(g, 0, 255)) << 8) | Math.round(clamp(b, 0, 255)));
    return '#' + v.toString(16).slice(1).toUpperCase();
  }

  function rgbToHue(rgb) {
    const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d === 0) return 0;
    let h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  }

  function hslHex(h, s, l) {
    s /= 100; l /= 100;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }

  const bioCache = new Map();

  function bioColor(hex) {
    if (hex && typeof hex === 'object' && hex.body) return hex;
    const raw = hex === undefined || hex === null ? '' : hex;
    let rec = bioCache.get(raw);
    if (rec) return rec;
    const key = String(raw).trim().toLowerCase();
    rec = BIO_PLAYER[key];
    if (!rec) {
      const rgb = parseHex(key);
      if (!rgb) {
        rec = BIO_PLAYER['#00ff41'];
      } else {
        const h = rgbToHue(rgb);
        let sum = 0;
        for (let i = 0; i < key.length; i++) sum += key.charCodeAt(i);
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
  const DIM_LEVELS = 8; // 0 = alpha 1, 7 = alpha 0,3
  function dimAlpha(level) { return 1 - level * (0.7 / (DIM_LEVELS - 1)); }
  function dimLevel(a) { return clamp(Math.round((1 - a) / (0.7 / (DIM_LEVELS - 1))), 0, DIM_LEVELS - 1); }

  const paints = new Map();

  function mixRgb(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function rgbStr(c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; }
  function rgbaStr(c, a) { return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')'; }

  function paintFor(hexOrRec) {
    const rec = bioColor(hexOrRec);
    let p = paints.get(rec);
    if (p) return p;
    const body = parseHex(rec.body) || [125, 255, 106];
    const core = parseHex(rec.core) || [229, 253, 225];
    const deep = parseHex(rec.deep) || [11, 75, 1];
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
    let r = p.ramps[level];
    if (r) return r;
    r = new Array(32);
    const inner = new Array(32);
    const mid = new Array(32);
    const under = mixRgb(BG_RGB, p.bodyRgb, 0.1);
    const am = dimAlpha(level);
    for (let i = 0; i < 32; i++) {
      const t = i / 31;
      const c = mixRgb(p.bodyRgb, p.deepRgb, smoothstep(0.15, 1, t) * 0.85);
      let a = t <= 0.7 ? 1 : 1 - ((t - 0.7) / 0.3) * 0.65;
      a *= am;
      r[i] = rgbStr(mixRgb(under, c, a));
      const cm = mixRgb(c, p.deepRgb, 0.28 + 0.12 * t);
      mid[i] = rgbStr(mixRgb(under, cm, a));
      const ci = mixRgb(c, p.deepRgb, 0.56 + 0.18 * t);
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
  let canvas = null, ctx = null;
  let cssSize = 768;      // ancho CSS del canvas (el alto sale de la proporción del mundo)
  let dprEff = 1;         // devicePixelRatio efectivo
  let K = 1;              // px del backing store por px lógico
  let arenaScale = 1;     // cssSize / W
  const MAX_BACKING = 2200; // ancho máximo del backing store del canvas (px)
  let s = 20;             // segmentSize
  let resizeObs = null, resizeTimer = 0;
  let textEpoch = 1;      // se incrementa al cargar fuentes o cambiar de escala
  let fontsReady = false;

  let quality = 2;
  let qualityLockUntil = 0;
  let ftBuf = new Float32Array(90), ftIdx = 0, ftCount = 0, ftSum = 0;
  let lastNow = 0, frameDt = 16, lastRenderMs = 0, frameNo = 0;
  let animT = 0;          // reloj de animación (se ralentiza en el congelamiento)
  let timeScale = 1;

  let particles = null;
  let mode = 'none';      // 'game' | 'idle'
  let lastState = null;
  let lastGameRenderT = -1e9;
  let myId = null;

  // ---------------------------------------------------------------------------
  // Canvas auxiliares
  // ---------------------------------------------------------------------------
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  // Fondo abisal + grilla de puntos (cacheado a resolución del backing store).
  // La grilla se hornea en el mismo caché: con alpha 0,07 su orden respecto de
  // las cáusticas aditivas es visualmente equivalente y ahorra un drawImage por frame.
  let bgCanvas = null;
  let vignetteDark = null, vignetteCoral = null;
  let stripTop = null, stripBottom = null, stripLeft = null, stripRight = null;
  let causticCyan = null, causticCoral = null;
  let patCyan = null, patCoral = null;
  let patMatrix = null;
  const causticOff = new Float32Array(4); // ax, ay, bx, by
  let snowSprite = null;
  let pearlSprite = null, shieldSprite = null, violetSprite = null, pearlBig = null;
  let anemoneSprite = null, coralSprite = null;   // glows de la boca grande y del abanico
  let goldSprite = null;                          // glow de la corona
  let turquoiseSprite = null;

  function buildBackground() {
    const bw = canvas.width, bh = canvas.height;
    if (!bgCanvas) bgCanvas = makeCanvas(bw, bh);
    if (bgCanvas.width !== bw || bgCanvas.height !== bh) { bgCanvas.width = bw; bgCanvas.height = bh; }
    const g = bgCanvas.getContext('2d');
    g.setTransform(K, 0, 0, K, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = BG_HEX;
    g.fillRect(0, 0, W, H);
    const rg = g.createRadialGradient(W / 2, H * 0.2, 0, W / 2, H * 0.2, Math.max(W, H) * 0.87);
    rg.addColorStop(0, 'rgba(7,37,54,0.55)');
    rg.addColorStop(1, 'rgba(7,37,54,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);
    const lg = g.createLinearGradient(0, H * 0.65, 0, H);
    lg.addColorStop(0, 'rgba(1,5,9,0)');
    lg.addColorStop(1, 'rgba(1,5,9,0.6)');
    g.fillStyle = lg;
    g.fillRect(0, H * 0.65, W, H * 0.35);
    // grilla de puntos en cada esquina de celda (cada dos celdas con s = 8)
    const step = s < 10 ? s * 2 : s;
    g.fillStyle = 'rgba(79,216,255,0.07)';
    const rr = 0.6;
    for (let y = step; y < H; y += step) {
      for (let x = step; x < W; x += step) {
        g.beginPath();
        g.arc(x, y, rr, 0, TAU);
        g.fill();
      }
    }
  }

  function buildVignettes() {
    const size = 300;
    function vig(rgb, edgeAlpha) {
      const c = makeCanvas(size, size);
      const g = c.getContext('2d');
      const half = size / 2;
      const outer = Math.sqrt(2) * half;
      // transparente hasta el 55 % de la semidiagonal, color pleno en las esquinas
      const grad = g.createRadialGradient(half, half, outer * 0.55, half, half, outer);
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
    const depth = 14;
    const len = W;
    function strip(horizontal, fromStart) {
      const cw = horizontal ? len * K : depth * K;
      const ch = horizontal ? depth * K : len * K;
      const c = makeCanvas(cw, ch);
      const g = c.getContext('2d');
      const grad = horizontal
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
    const N = 256, P = 12;
    const ptx = new Float32Array(P), pty = new Float32Array(P);
    for (let p = 0; p < P; p++) { ptx[p] = Math.random(); pty[p] = Math.random(); }
    const vals = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      const v = (y + 0.5) / N;
      for (let x = 0; x < N; x++) {
        const u = (x + 0.5) / N;
        let f1 = 9, f2 = 9;
        for (let p = 0; p < P; p++) {
          let dx = u - ptx[p]; if (dx < 0) dx = -dx; if (dx > 0.5) dx = 1 - dx;
          let dy = v - pty[p]; if (dy < 0) dy = -dy; if (dy > 0.5) dy = 1 - dy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
        }
        const val = 1 - smoothstep(0, 0.06, f2 - f1);
        vals[y * N + x] = Math.pow(val, 1.5) * 0.9;
      }
    }
    function tinted(r, g, b) {
      const c = makeCanvas(N, N);
      const cx = c.getContext('2d');
      const img = cx.createImageData(N, N);
      const d = img.data;
      for (let i = 0, j = 0; i < N * N; i++, j += 4) {
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
    anemoneSprite = Particles.glowSprite('#FF8FD0', true);
    coralSprite = Particles.glowSprite('#FF7A59', true);
    goldSprite = Particles.glowSprite('#FFE08A', false);
    turquoiseSprite = Particles.glowSprite('#1FF2D2', true);
  }

  // ---------------------------------------------------------------------------
  // Texto en sprites (etiquetas, textos flotantes, contador, caption)
  // ---------------------------------------------------------------------------
  function fontUi(weight, px) { return weight + ' ' + px.toFixed(2) + 'px ' + FONT_UI; }

  // Devuelve un canvas con el texto centrado; c._w/c._h guardan su tamaño lógico.
  function textSprite(reuse, str, font, logicalPx, fill, outline, outlineCss) {
    const c = reuse || makeCanvas(2, 2);
    let g = c.getContext('2d');
    const devFont = font.replace(/[\d.]+px/, (logicalPx * K).toFixed(2) + 'px');
    g.font = devFont;
    const tw = g.measureText(str).width;
    const lwDev = outline ? outlineCss * dprEff : 0;
    const pad = Math.ceil(lwDev + 2 * K);
    const cw = Math.ceil(tw + pad * 2);
    const ch = Math.ceil(logicalPx * K * 1.4 + pad * 2);
    c.width = Math.max(2, cw);
    c.height = Math.max(2, ch);
    g = c.getContext('2d');
    g.font = devFont;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    const cx = c.width / 2, cy = c.height / 2;
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
    let n = String(name == null ? '' : name);
    if (n.length > 12) n = n.slice(0, 12) + '…';
    return n;
  }

  let meLabel = null, meLabelEpoch = 0;
  function getMeLabel() {
    if (!meLabel || meLabelEpoch !== textEpoch) {
      meLabel = textSprite(meLabel, 'Tú', fontUi(700, 12), labelPx() * 1.08, '#C8FF3C', 'rgba(2,10,18,0.85)', 3);
      meLabelEpoch = textEpoch;
    }
    return meLabel;
  }

  // Pool de sprites de texto flotante
  const textPool = [];
  function takeTextCanvas() { return textPool.length ? textPool.pop() : null; }
  function releaseTextCanvas(c) { if (c && textPool.length < 24) textPool.push(c); }

  // Sprites del contador gigante: uno por número (10..1), cada número tiene su color fijo.
  const digitSprites = new Array(11);
  const digitEpoch = new Int32Array(11);
  function countdownColor(n) { return n >= 6 ? '#1FF2D2' : (n >= 4 ? '#FFB547' : '#FF4D6D'); }
  function countdownSize(n) { return (n <= 3 ? 340 : 300) * H / 600; }
  function buildDigit(n) {
    const px = countdownSize(n);
    const kd = Math.min(K, 1.1) * 0.85; // resolución reducida: es un elemento suave de fondo
    const font = 'italic 300 ' + (px * kd).toFixed(1) + 'px ' + FONT_DISPLAY;
    const c = digitSprites[n] || makeCanvas(2, 2);
    let g = c.getContext('2d');
    g.font = font;
    const str = String(n);
    const tw = g.measureText(str).width;
    const pad = Math.ceil(48 * kd);
    c.width = Math.ceil(tw + pad * 2);
    c.height = Math.ceil(px * kd * 1.25 + pad * 2);
    g = c.getContext('2d');
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const col = countdownColor(n);
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
  const FOOD_COL = ['#7CFFB2', '#B8FF5A', '#E8F24A', '#FFD447', '#FFA347'];
  const FOOD_R = [4.0, 4.4, 4.8, 5.2, 5.6];
  const FOOD_GLOW = 1.9;         // radio del glow = FOOD_GLOW × r × (1 + 0,1 × valor)
  const foodOrbs = new Array(5);
  const foodGlows = new Array(5);
  let foodKey = '';            // '' fuerza la regeneración
  let foodKS = 0, foodKK = 0, foodKE = 0, foodKA = 0;
  function ensureFoodSprites() {
    if (foodKey !== '' && foodKS === s && foodKK === K && foodKE === textEpoch && foodKA === arenaScale) return;
    foodKey = 'ok';
    foodKS = s; foodKK = K; foodKE = textEpoch; foodKA = arenaScale;
    for (let v = 0; v < 5; v++) {
      const r = FOOD_R[v];
      const showDigit = 1.15 * r * arenaScale >= 7;
      const dev = r * K;
      const rim = Math.max(1.2, 1.3 * K); // contorno oscuro: lo separa del glow y de la nieve
      const size = Math.ceil((dev + rim) * 2 + 4);
      const c = foodOrbs[v] || makeCanvas(size, size);
      c.width = size; c.height = size;
      const g = c.getContext('2d');
      const cx = size / 2;
      g.fillStyle = 'rgba(2, 19, 28, 0.85)';
      g.beginPath();
      g.arc(cx, cx, dev + rim, 0, TAU);
      g.fill();
      const rgb = parseHex(FOOD_COL[v]);
      const grad = g.createRadialGradient(cx - dev * 0.25, cx - dev * 0.25, 0, cx, cx, dev);
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
    let settled = false;
    const timer = setTimeout(function () { if (!settled) { settled = true; bumpText(); } }, 1500);
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
    let n = q === 2 ? 70 : (q === 1 ? 45 : 25);
    if (coarsePointer) n = Math.round(n * 0.6);
    return n;
  }
  function particleLimitFor(q) { return q === 2 ? 600 : (q === 1 ? 400 : 200); }
  function trailLenFor(q) { return q === 0 ? 5 : 10; }

  let qualityLocked = false;
  function setQuality(q, lock) {
    if (lock !== undefined) qualityLocked = !!lock;
    q = clamp(q | 0, 0, 2);
    const dprChange = (q === 0) !== (quality === 0);
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
    const t = lastNow;
    if (!qualityLocked && ftCount >= 90 && t > qualityLockUntil && quality > 0 && ftSum / ftCount > 19) {
      setQuality(quality - 1);
      qualityLockUntil = t + 5000;
      ftCount = 0; ftSum = 0; ftIdx = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Tamaño / DPR
  // ---------------------------------------------------------------------------
  // Ancho CSS del canvas. Si la caja no tiene la proporción del mundo, manda el lado más chico
  function measureCss() {
    if (!canvas) return cssSize;
    let w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || w < 10) return cssSize;
    if (h && h >= 10) w = Math.min(w, h * W / H);
    return w;
  }

  function applySize(force) {
    if (!canvas) return;
    const css = measureCss();
    const dprRaw = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const dprMax = quality === 0 ? 1.5 : 2;
    const d = Math.min(dprRaw, dprMax);
    // En partida la arena puede pasar de 1000 px CSS: con DPR 2 serían 4 M de pixeles por cuadro.
    // El tope deja la nitidez casi igual y el costo de pintar acotado.
    const target = Math.min(MAX_BACKING, Math.max(64, Math.round(css * d)));
    const targetH = Math.max(36, Math.round(target * H / W));
    if (!force && target === canvas.width && targetH === canvas.height && css === cssSize && d === dprEff) return;
    cssSize = css;
    dprEff = d;
    if (canvas.width !== target) canvas.width = target;
    if (canvas.height !== targetH) canvas.height = targetH;
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
  let lastDprRaw = 1;

  function scheduleResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { resizeTimer = 0; applySize(false); }, 120);
  }

  // ---------------------------------------------------------------------------
  // Partículas ambientales: nieve marina (5.2)
  // ---------------------------------------------------------------------------
  const SNOW_MAX = 70;
  const snowX = new Float32Array(SNOW_MAX), snowY = new Float32Array(SNOW_MAX);
  const snowZ = new Float32Array(SNOW_MAX), snowPh = new Float32Array(SNOW_MAX);
  const snowW = new Float32Array(SNOW_MAX), snowDx = new Float32Array(SNOW_MAX);
  const snowRise = new Float32Array(SNOW_MAX), snowGlow = new Float32Array(SNOW_MAX);
  const snowPaint = new Array(SNOW_MAX);
  let snowActive = 70;
  let snowSpeed = 1; // multiplicador (cámara lenta)

  function initSnow() {
    for (let i = 0; i < SNOW_MAX; i++) {
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
  const HEADS_MAX = 40;
  const headX = new Float32Array(HEADS_MAX), headY = new Float32Array(HEADS_MAX);
  const headR2 = new Float32Array(HEADS_MAX);
  const headPaint = new Array(HEADS_MAX);
  let headCount = 0;

  function pushHead(x, y, radius, paint) {
    if (headCount >= HEADS_MAX) return;
    headX[headCount] = x;
    headY[headCount] = y;
    headR2[headCount] = radius * radius;
    headPaint[headCount] = paint;
    headCount++;
  }

  function updateSnow(dtMs) {
    const dt = dtMs / 1000 * snowSpeed;
    const decay = dtMs / 900;
    for (let i = 0; i < snowActive; i++) {
      let x = snowX[i] + snowDx[i] * dt;
      let y = snowY[i] - snowRise[i] * snowZ[i] * dt;
      if (y < -6) { y = H + 6; x = Math.random() * W; }
      if (x < -6) x += W + 12; else if (x > W + 6) x -= W + 12;
      snowX[i] = x;
      snowY[i] = y;
      let g = snowGlow[i] - decay;
      if (g < 0) g = 0;
      // estela de dinoflagelados
      const sx = x + 4 * Math.sin(animT * snowW[i] + snowPh[i]);
      for (let h = 0; h < headCount; h++) {
        const dx = sx - headX[h], dy = y - headY[h];
        if (dx * dx + dy * dy < headR2[h]) { g = 1; snowPaint[i] = headPaint[h]; break; }
      }
      snowGlow[i] = g;
    }
  }

  // En partida (`inGame`) la nieve queda más chica y tenue: es fondo, no tiene que competir con la
  // comida ni con el escudo.
  function drawSnow(inGame) {
    const c = ctx;
    const sizeK = inGame ? 0.7 : 1, alphaK = inGame ? 0.55 : 1;
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < snowActive; i++) {
      const z = snowZ[i];
      const x = snowX[i] + 4 * Math.sin(animT * snowW[i] + snowPh[i]);
      const y = snowY[i];
      const size = (0.6 + (z - 0.3) / 0.7 * 1.2) * sizeK;
      const a = (0.08 + (z - 0.3) / 0.7 * 0.27) * alphaK;
      const g = snowGlow[i];
      const R = size * 2.6;
      c.globalAlpha = a * (1 - g * 0.5);
      c.drawImage(snowSprite, x - R, y - R, R + R, R + R);
      if (g > 0.02 && snowPaint[i]) {
        const R2 = size * 6;
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
  let tensionLevel = 0;      // suavizado
  let tensionBumpT0 = -1e9;
  let countFade = 1;         // fundido de contador y tensión en el congelamiento

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
    const drift = (dtMs / 1000) * snowSpeed * (1 + 0.6 * tensionLevel);
    causticOff[0] = (causticOff[0] + 6 * drift) % (256 * 2.4);
    causticOff[1] = (causticOff[1] + 3 * drift) % (256 * 2.4);
    causticOff[2] = (causticOff[2] - 4 * drift) % (256 * 3.4);
    causticOff[3] = (causticOff[3] + 5 * drift) % (256 * 3.4);
    ctx.globalCompositeOperation = 'lighter';
    const coral = 0.6 * tensionLevel * countFade;
    drawCausticLayer(patCyan, 2.4, causticOff[0], causticOff[1], 0.055 * alphaMul * (1 - coral));
    if (coral > 0.01) drawCausticLayer(patCoral, 2.4, causticOff[0], causticOff[1], 0.055 * alphaMul * coral);
    if (quality === 2) {
      drawCausticLayer(patCyan, 3.4, causticOff[2], causticOff[3], 0.035 * alphaMul * (1 - coral));
      if (coral > 0.01) drawCausticLayer(patCoral, 3.4, causticOff[2], causticOff[3], 0.035 * alphaMul * coral);
    }
    ctx.globalAlpha = 1;
  }

  function drawMembrane(now) {
    const a = reducedMotion ? 0.10 : 0.10 + 0.02 * Math.sin(now * TAU / 6400);
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
    let bump = now - tensionBumpT0 < 400 ? 0.25 * (1 - (now - tensionBumpT0) / 400) : 0;
    if (tensionLevel <= 0.001) bump = 0;
    const ta = (tensionLevel + bump) * countFade;
    if (ta > 0.003) {
      ctx.globalAlpha = Math.min(1, ta);
      ctx.drawImage(vignetteCoral, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------------------
  // Sacudida y límite de destellos (5.12)
  // ---------------------------------------------------------------------------
  const shakeI = new Float32Array(4), shakeT0 = new Float64Array(4), shakeDur = new Float32Array(4);
  let shakeX = 0, shakeY = 0;

  function shake(intensity, ms) {
    if (reducedMotion) return;
    const I = +intensity || 0, d = +ms || 0;
    if (I <= 0 || d <= 0) return;
    const now = nowMs();
    let slot = 0, minRem = 1e9;
    for (let i = 0; i < 4; i++) {
      const t = (now - shakeT0[i]) / (shakeDur[i] || 1);
      const rem = t >= 1 ? 0 : shakeI[i] * (1 - t) * (1 - t);
      if (rem < minRem) { minRem = rem; slot = i; }
    }
    shakeI[slot] = I;
    shakeT0[slot] = now;
    shakeDur[slot] = d;
  }

  function computeShake(now) {
    let best = 0;
    for (let i = 0; i < 4; i++) {
      if (shakeI[i] <= 0) continue;
      const t = (now - shakeT0[i]) / shakeDur[i];
      if (t >= 1 || t < 0) { if (t >= 1) shakeI[i] = 0; continue; }
      const k = (1 - t) * (1 - t);
      const rem = shakeI[i] * k;
      if (rem > best) best = rem;
    }
    if (reducedMotion) best = 0;
    shakeX = best * Math.sin(now * 0.071);
    shakeY = best * Math.cos(now * 0.053);
  }

  const flashTimes = new Float64Array(3);
  let flashIdx = 0;
  function allowFlash(now) {
    const oldest = flashTimes[flashIdx];
    if (oldest !== 0 && now - oldest < 1000) return false;
    flashTimes[flashIdx] = now;
    flashIdx = (flashIdx + 1) % 3;
    return true;
  }
  function flashAlpha(a) { return Math.min(a, reducedMotion ? 0.25 : 0.7); }

  // ---------------------------------------------------------------------------
  // Pool de efectos de la arena
  // ---------------------------------------------------------------------------
  const FX_RING = 1, FX_FLASH = 2, FX_WAVE = 3, FX_COLUMN = 4, FX_FOUNTAIN = 5,
      FX_EDGE = 6, FX_PWAVE = 7, FX_DROP = 8, FX_TEXT = 9, FX_STREAK = 10;
  const FX_MAX = 112;
  const fxPool = [];
  for (let fi = 0; fi < FX_MAX; fi++) {
    fxPool.push({
      on: false, type: 0, t0: 0, dur: 0, x: 0, y: 0, r0: 0, r1: 0, lw: 1, a: 1,
      color: '#FFFFFF', sprite: null, id: null, edge: 0, vx: 0, vy: 0, n: 0, paint: null, s: 20, rise: 0
    });
  }
  let fxCursor = 0;

  function fxSpawn(type, t0, dur) {
    let f = null;
    for (let i = 0; i < FX_MAX; i++) {
      const j = (fxCursor + i) % FX_MAX;
      if (!fxPool[j].on) { f = fxPool[j]; fxCursor = (j + 1) % FX_MAX; break; }
    }
    if (!f) {
      // lleno: reemplaza el más viejo
      let oldest = 0, ot = 1e18;
      for (let k = 0; k < FX_MAX; k++) if (fxPool[k].t0 < ot) { ot = fxPool[k].t0; oldest = k; }
      f = fxPool[oldest];
      if (f.type === FX_TEXT) releaseTextCanvas(f.sprite);
    }
    f.on = true; f.type = type; f.t0 = t0; f.dur = dur;
    f.x = 0; f.y = 0; f.r0 = 0; f.r1 = 0; f.lw = 1.5; f.a = 1; f.color = '#E8FBFF';
    f.sprite = null; f.id = null; f.edge = 0; f.vx = 0; f.vy = 0; f.n = 0; f.paint = null; f.s = s; f.rise = 0;
    return f;
  }

  function fxRing(x, y, r0, r1, dur, color, alpha, lw, delay) {
    const f = fxSpawn(FX_RING, nowMs() + (delay || 0), dur);
    f.x = x; f.y = y; f.r0 = r0; f.r1 = r1; f.color = color; f.a = alpha; f.lw = lw || 1.5;
    return f;
  }

  function fxFlash(x, y, radius, alpha, dur) {
    const now = nowMs();
    if (!allowFlash(now)) return;
    const f = fxSpawn(FX_FLASH, now, dur);
    f.x = x; f.y = y; f.r0 = radius; f.a = flashAlpha(alpha);
  }

  function fxText(x, y, str, color, px, rise, dur) {
    const f = fxSpawn(FX_TEXT, nowMs(), dur || 700);
    f.x = x; f.y = y; f.rise = rise === undefined ? 18 : rise;
    f.sprite = textSprite(takeTextCanvas(), str, fontUi(700, 12), px, color, 'rgba(2,10,18,0.85)', 3);
    return f;
  }

  function fxEdge(edge, pos, paint, dur, alpha) {
    const f = fxSpawn(FX_EDGE, nowMs(), dur || 600);
    f.edge = edge; f.x = pos; f.paint = paint; f.a = alpha === undefined ? 1 : alpha;
  }

  function edgeOf(x, y) {
    // borde más cercano a un punto: 0 arriba, 1 derecha, 2 abajo, 3 izquierda
    const dTop = y, dRight = W - x, dBottom = H - y, dLeft = x;
    const m = Math.min(dTop, dRight, dBottom, dLeft);
    if (m === dTop) return 0;
    if (m === dRight) return 1;
    if (m === dBottom) return 2;
    return 3;
  }

  function updateFx(now) {
    for (let i = 0; i < FX_MAX; i++) {
      const f = fxPool[i];
      if (!f.on) continue;
      const el = now - f.t0;
      if (el > f.dur) {
        if (f.type === FX_TEXT) releaseTextCanvas(f.sprite);
        f.on = false;
        continue;
      }
      if (f.type === FX_FOUNTAIN && el >= 0) {
        // fuente de plancton del ganador: 80 partículas repartidas en 1200 ms
        const total = scaleCount(80);
        const want = Math.min(total, Math.floor(total * el / 1200));
        const rec = snakeRecs.get(f.id);
        if (rec && rec.n > 0) {
          const hx = rec.x[0], hy = rec.y[0];
          while (f.n < want) {
            const p = f.n & 1 ? rec.paint.core : rec.paint.body;
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
    const c = ctx;
    for (let i = 0; i < FX_MAX; i++) {
      const f = fxPool[i];
      if (!f.on) continue;
      const el = now - f.t0;
      if (el < 0) continue;
      const t = el / f.dur;
      if (t > 1) continue;
      const type = f.type;
      if (layer === 0) {
        if (type !== FX_COLUMN) continue;
        const rec = snakeRecs.get(f.id);
        if (!rec || rec.n === 0) continue;
        const cx = rec.x[0];
        const ca = 0.35 * smoothstep(0, 500, el) * (1 - smoothstep(f.dur - 400, f.dur, el));
        const cw = 6 * f.s;
        c.globalCompositeOperation = 'lighter';
        c.globalAlpha = ca;
        drawColumn(cx, rec.y[0], cw, rec.paint);
      } else if (layer === 1) {
        if (type === FX_RING) {
          const rr = f.r0 + (f.r1 - f.r0) * easeOutCubic(t);
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = f.a * (1 - t);
          c.strokeStyle = f.color;
          c.lineWidth = f.lw;
          c.beginPath();
          c.arc(f.x, f.y, rr, 0, TAU);
          c.stroke();
        } else if (type === FX_FLASH) {
          const fr = f.r0;
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = f.a * (1 - t);
          c.drawImage(pearlBig, f.x - fr, f.y - fr, fr * 2, fr * 2);
        } else if (type === FX_WAVE) {
          const wr = 450 * easeOutExpo(t);
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
          const dy = f.y + 14 * easeOutCubic(t);
          const dr = f.r0 * (1 - 0.4 * t);
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = 0.9 * (1 - t);
          const spr = f.paint ? f.paint.glowCore : pearlSprite;
          c.drawImage(spr, f.x - dr * 2.4, dy - dr * 2.4, dr * 4.8, dr * 4.8);
          if (f.paint) {
            c.globalAlpha = 0.6 * (1 - t);
            c.drawImage(f.paint.glowBody, f.x - dr * 4, dy - dr * 4, dr * 8, dr * 8);
          }
        } else if (type === FX_STREAK) {
          // Comida tomada con la boca grande: viaja hasta la cabeza (que sigue moviéndose), acelerando
          const rec = snakeRecs.get(f.id);
          if (!rec || rec.n === 0) continue;
          const hx = rec.x[0], hy = rec.y[0];
          const p = t * t, q = Math.max(0, p - 0.35);
          const px = f.x + (hx - f.x) * p, py = f.y + (hy - f.y) * p;
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = 0.75;
          c.strokeStyle = f.color;
          c.lineWidth = 2 * (1 - 0.5 * t);
          c.beginPath();
          c.moveTo(f.x + (hx - f.x) * q, f.y + (hy - f.y) * q);
          c.lineTo(px, py);
          c.stroke();
          c.globalAlpha = 0.9;
          const sr = 0.9 * f.s;
          c.drawImage(pearlSprite, px - sr, py - sr, sr * 2, sr * 2);
        }
      } else if (layer === 2) {
        if (type !== FX_TEXT || !f.sprite) continue;
        const ty = f.y - f.rise * easeOutCubic(t);
        const ta = t < 0.15 ? t / 0.15 : 1 - smoothstep(0.55, 1, t);
        c.globalCompositeOperation = 'source-over';
        c.globalAlpha = ta;
        const tw = f.sprite._w, th = f.sprite._h;
        const tx = clamp(f.x, tw / 2, W - tw / 2);
        c.drawImage(f.sprite, tx - tw / 2, ty - th / 2, tw, th);
      } else if (layer === 3) {
        if (type === FX_EDGE) {
          const ea = f.a * (1 - easeOutCubic(t)) * 0.9;
          const half = 3 * f.s;
          const spr2 = f.paint ? f.paint.glowBodyBig : turquoiseSprite;
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = ea;
          if (f.edge === 0) c.drawImage(spr2, f.x - half, -14, half * 2, 28);
          else if (f.edge === 2) c.drawImage(spr2, f.x - half, H - 14, half * 2, 28);
          else if (f.edge === 3) c.drawImage(spr2, -14, f.x - half, 28, half * 2);
          else c.drawImage(spr2, W - 14, f.x - half, 28, half * 2);
        } else if (type === FX_PWAVE) {
          const pe = easeOutExpo(t);
          const along = 1.6 * f.s * (0.35 + 0.65 * pe);
          const inward = 0.5 * f.s * (0.35 + 0.65 * pe) + 1;
          c.globalCompositeOperation = 'lighter';
          c.globalAlpha = 0.6 * (1 - t);
          c.strokeStyle = f.paint ? f.paint.body : '#1FF2D2';
          c.lineWidth = 2;
          c.beginPath();
          if (f.edge === 0 || f.edge === 2) c.ellipse(f.x, f.y, along, inward, 0, 0, TAU);
          else c.ellipse(f.x, f.y, inward, along, 0, 0, TAU);
          c.stroke();
          c.globalAlpha = 0.3 * (1 - t);
          const gs = f.paint ? f.paint.glowBody : turquoiseSprite;
          c.drawImage(gs, f.x - along, f.y - along, along * 2, along * 2);
        }
      }
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  // Columna de luz del ganador: degradado vertical cacheado
  let columnSprite = null;
  function drawColumn(cx, headYv, width, paint) {
    if (!columnSprite) {
      columnSprite = makeCanvas(64, 256);
      const g = columnSprite.getContext('2d');
      const lg = g.createLinearGradient(0, 0, 0, 256);
      lg.addColorStop(0, 'rgba(232,251,255,0)');
      lg.addColorStop(0.55, 'rgba(232,251,255,0.55)');
      lg.addColorStop(0.92, 'rgba(232,251,255,1)');
      lg.addColorStop(1, 'rgba(232,251,255,0)');
      g.fillStyle = lg;
      g.fillRect(0, 0, 64, 256);
      // bordes horizontales suaves
      g.globalCompositeOperation = 'destination-in';
      const hg = g.createLinearGradient(0, 0, 64, 0);
      hg.addColorStop(0, 'rgba(0,0,0,0)');
      hg.addColorStop(0.5, 'rgba(0,0,0,1)');
      hg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = hg;
      g.fillRect(0, 0, 64, 256);
    }
    const bottom = headYv + 0.6 * s;
    const a = ctx.globalAlpha;
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
  const BO = { count: 0, color: '', speed: [0, 0], life: [0, 0], size: [0, 0], endSize: undefined,
             shape: 'dot', gravity: 0, drag: 0.9, angle: 0, spread: TAU, alpha: 1, glow: true, lineWidth: 1.5 };

  function scaleCount(n) { return reducedMotion ? Math.max(1, Math.round(n * 0.5)) : n; }

  function setBurst(count, color, sp0, sp1, l0, l1, z0, z1, shape, gravity, drag) {
    const f = s / 20;
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
  const snakeRecs = new Map();
  const MAX_RUNS = 32;

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
    let cap = 64;
    while (cap < n) cap *= 2;
    rec.cap = cap;
    rec.rx = new Float32Array(cap); rec.ry = new Float32Array(cap);
    rec.x = new Float32Array(cap); rec.y = new Float32Array(cap);
    rec.nx = new Float32Array(cap); rec.ny = new Float32Array(cap);
  }

  function getRec(id) {
    let r = snakeRecs.get(id);
    if (!r) { r = new SnakeRec(id); snakeRecs.set(id, r); }
    return r;
  }

  // Radio del cuerpo r(t) = s * (0,46 - 0,22 * t^1,4), tabulado
  const RLUT = new Float32Array(64);
  for (let ri = 0; ri < 64; ri++) RLUT[ri] = 0.46 - 0.22 * Math.pow(ri / 63, 1.4);
  function radAt(t, ss) { return ss * RLUT[(t * 63 + 0.5) | 0]; }

  // Cortes en portales (5.5): un tramo nuevo cuando dos puntos consecutivos saltan > media arena
  function computeRuns(rec) {
    const n = rec.n, rx = rec.rx, ry = rec.ry, runs = rec.runs;
    let rc = 0;
    runs[0] = 0;
    for (let i = 0; i < n - 1; i++) {
      const dx = rx[i + 1] - rx[i], dy = ry[i + 1] - ry[i];
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
    const n = rec.n, rx = rec.rx, ry = rec.ry, x = rec.x, y = rec.y, nx = rec.nx, ny = rec.ny;
    const inv = 1 / Math.max(n - 1, 1);
    const amp = ss * 0.09;
    for (let r = 0; r < rec.runCount; r++) {
      const a = rec.runs[r * 2], b = rec.runs[r * 2 + 1];
      for (let i = a; i <= b; i++) {
        const p = i > a ? i - 1 : i;
        const q = i < b ? i + 1 : i;
        let tx = rx[p] - rx[q], ty = ry[p] - ry[q];
        let len = Math.sqrt(tx * tx + ty * ty);
        if (len < 1e-3) { tx = rec.dirX; ty = rec.dirY; len = 1; }
        tx /= len; ty /= len;
        nx[i] = -ty; ny[i] = tx;
        if (wave && i > 0) {
          const t = i * inv;
          const A = amp * smoothstep(0, 0.25, t);
          const off = A * Math.sin(animT * 0.006 - i * 0.9);
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
    let dx = 0, dy = 0, ok = false;
    if (rec.n >= 2 && rec.runs[1] >= 1) {
      dx = rec.rx[0] - rec.rx[1];
      dy = rec.ry[0] - rec.ry[1];
      const l = Math.sqrt(dx * dx + dy * dy);
      if (l > 0.2 * ss) { dx /= l; dy /= l; ok = true; }
    }
    if (!ok) {
      dx = fallbackX; dy = fallbackY;
      const l2 = Math.sqrt(dx * dx + dy * dy);
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
    const m = b - a;
    const i0 = a + q0;
    if (q0 === 0) c.moveTo(X[a], Y[a]);
    else c.moveTo((X[i0 - 1] + X[i0]) * 0.5, (Y[i0 - 1] + Y[i0]) * 0.5);
    for (let q = q0; q <= q1; q++) {
      const i = a + q;
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
  let haloBoostT0 = -1e9;

  function haloBoost(now) {
    const el = now - haloBoostT0;
    if (el < 0 || el > 600) return 1;
    return 1 + 0.6 * (1 - easeInOutSine(el / 600));
  }

  function passHalo(rec, ss, now) {
    const c = ctx, p = rec.paint, n = rec.n;
    if (n === 0) return;
    const inv = 1 / Math.max(n - 1, 1);
    // Q2: cada punto; Q1: cada 2 (alpha x1,5); Q0: cada 3 (alpha x1,9), para el raster por software
    const step = quality === 2 ? 1 : (quality === 1 ? 2 : 3);
    const mul = (step === 1 ? 1 : (step === 2 ? 1.5 : 1.9)) * (rec.isMe ? 1.25 : 1) * haloBoost(now) * rec.alphaVis;
    const big = 3.2 * ss * 0.46 > 24;
    const spr = big ? p.glowBodyBig : p.glowBody;
    const X = rec.x, Y = rec.y;
    for (let r = 0; r < rec.runCount; r++) {
      const a = rec.runs[r * 2], b = rec.runs[r * 2 + 1];
      for (let i = a; i <= b; i += step) {
        const t = i * inv;
        const R = 3.2 * radAt(t, ss);
        const al = 0.22 * (1 - 0.6 * t) * mul;
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
    const X = rec.rx, Y = rec.ry;
    const dx = X[j] - X[i], dy = Y[j] - Y[i];
    let bx = X[i], by = Y[i];
    if (dx > HALF_W || dx < -HALF_W) bx = X[i] < HALF_W ? 0 : W;
    else by = Y[i] < HALF_H ? 0 : H;
    const R = 1.8 * ss;
    ctx.globalAlpha = 0.35 * rec.alphaVis;
    ctx.drawImage(rec.paint.glowBodyBig, bx - R, by - R, R + R, R + R);
  }

  // Extremo de tramo cortado por un portal: punto sobre el borde (un poco afuera) en EXT.
  const EXT = new Float32Array(2);
  function edgeExt(rec, i, j) {
    const dx = rec.rx[j] - rec.rx[i];
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
    const c = ctx;
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
    const c = ctx;
    edgeExt(rec, i, j);
    c.beginPath();
    if (atStart) { c.moveTo(EXT[0], EXT[1]); c.lineTo(rec.x[i], rec.y[i]); }
    else { c.moveTo(rec.x[i], rec.y[i]); c.lineTo(EXT[0], EXT[1]); }
    c.stroke();
  }

  function passImmunityMembrane(rec, ss, now) {
    if (!rec.immune || rec.n === 0) return;
    const c = ctx;
    const beat = Math.sin(now * 0.001 * 1.6 * TAU);
    c.strokeStyle = '#9FF4FF';
    c.globalAlpha = (0.10 + 0.05 * beat) * rec.alphaVis * bellBlink(rec);
    c.lineWidth = 2 * radAt(0, ss) + 0.5 * ss;
    for (let r = 0; r < rec.runCount; r++) {
      const a = rec.runs[r * 2], b = rec.runs[r * 2 + 1];
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
    const c = ctx, n = rec.n;
    if (n === 0) return;
    const level = dimLevel(rec.alphaVis);
    const ramp = rampFor(rec.paint, level);
    const inner = rec.paint.inners[level];
    const midR = rec.paint.mids[level];
    const inv = 1 / Math.max(n - 1, 1);
    const chunk = n > 48 ? Math.ceil(n / 24) : (n > 24 ? 2 : 1);
    const rim = Math.max(0.9, 0.075 * ss);
    const X = rec.x, Y = rec.y;
    for (let layer = 0; layer < 3; layer++) {
      const R = layer === 0 ? ramp : (layer === 1 ? midR : inner);
      const sub = layer === 0 ? 0 : (layer === 1 ? rim * 2 : rim * 4.5);
      for (let r = 0; r < rec.runCount; r++) {
        const a = rec.runs[r * 2], b = rec.runs[r * 2 + 1];
        const m = b - a;
        if (m === 0) {
          if (a === 0) continue; // la cabeza la dibuja passHead
          const t0 = a * inv;
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
        let q = 0;
        while (q <= m) {
          let q1 = q + chunk - 1;
          if (q1 > m) q1 = m;
          const tm = (a + (q + q1) * 0.5) * inv;
          c.lineCap = q1 === m ? 'round' : 'butt';
          c.lineWidth = Math.max(0.6, 2 * radAt(tm, ss) - sub);
          c.strokeStyle = R[(tm * 31 + 0.5) | 0];
          c.beginPath();
          pathRange(c, X, Y, a, b, q, q1);
          if (q1 < m) {
            // solape mínimo sobre el trozo siguiente: evita la costura del antialias
            const ie = a + q1;
            const ux = X[ie + 1] - X[ie], uy = Y[ie + 1] - Y[ie];
            const ul = Math.sqrt(ux * ux + uy * uy) || 1;
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
    const c = ctx, n = rec.n;
    if (n < 2 || rec.filament <= 0.01) return;
    const X = rec.x, Y = rec.y;
    const inv = 1 / Math.max(n - 1, 1);
    const g = n > 48 ? 3 : (n > 24 ? 2 : 1);
    const am = rec.filament * rec.alphaVis;
    c.strokeStyle = rec.paint.core;
    c.lineCap = 'butt';
    for (let r = 0; r < rec.runCount; r++) {
      const a = rec.runs[r * 2], b = rec.runs[r * 2 + 1];
      const m = b - a;
      if (m === 0) continue;
      for (let q = 0; q <= m; q += g) {
        let q1 = q + g - 1;
        if (q1 > m) q1 = m;
        const t = (a + (q + q1) * 0.5) * inv;
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
    const c = ctx, n = rec.n, p = rec.paint;
    if (n < 2) return;
    const inv = 1 / Math.max(n - 1, 1);
    const spr = p.glowCore;
    const dotR = Math.max(1, 0.09 * ss);
    const R = dotR * 3.2;
    const X = rec.x, Y = rec.y, NX = rec.nx, NY = rec.ny;
    const pattern = p.slot % 4;
    const sp = ss < 12 ? 2 : 1;
    const period = pattern === 0 ? 3 * sp : (pattern === 3 ? 5 * sp : 2 * sp);
    const phase0 = pattern === 3 ? 2 : 1;
    const av = rec.alphaVis * (rec.anchored ? 0.35 : 1);   // anclada, los fotóforos bajan
    for (let i = phase0; i < n; i += period) {
      const t = i * inv;
      const rr = radAt(t, ss);
      const tw = 0.5 + 0.5 * Math.sin(animT * 0.004 + i * 1.7);
      c.globalAlpha = tw * av;
      const x = X[i], y = Y[i];
      if (pattern === 0) {
        const ox = NX[i] * 0.6 * rr, oy = NY[i] * 0.6 * rr;
        c.drawImage(spr, x + ox - R, y + oy - R, R + R, R + R);
        c.drawImage(spr, x - ox - R, y - oy - R, R + R, R + R);
      } else if (pattern === 1) {
        c.drawImage(spr, x - R, y - R, R + R, R + R);
      } else if (pattern === 2) {
        const side = ((i / period) | 0) & 1 ? 0.6 : -0.6;
        c.drawImage(spr, x + NX[i] * side * rr - R, y + NY[i] * side * rr - R, R + R, R + R);
      } else {
        // tres puntos en línea a lo largo del cuerpo
        const tx = NY[i] * 0.3 * ss, ty = -NX[i] * 0.3 * ss;
        c.drawImage(spr, x - R, y - R, R + R, R + R);
        c.drawImage(spr, x + tx - R, y + ty - R, R + R, R + R);
        c.drawImage(spr, x - tx - R, y - ty - R, R + R, R + R);
      }
    }
    // pulsos de luz que fluyen de la cabeza a la cola (vida en reposo, muy tenues)
    if (n > 4) {
      const gap = 7;
      const head0 = (animT * 0.008) % gap;
      for (let pp = head0; pp < n - 1; pp += gap) {
        const j0 = pp | 0, jf = pp - j0;
        const jx = X[j0 + 1] - X[j0], jy = Y[j0 + 1] - Y[j0];
        if (jx > HALF_W || jx < -HALF_W || jy > HALF_H || jy < -HALF_H) continue;
        const pt = pp * inv;
        const prr = radAt(pt, ss) * 1.6;
        c.globalAlpha = 0.32 * (1 - pt) * av * rec.filament;
        c.drawImage(p.glowCore, X[j0] + jx * jf - prr, Y[j0] + jy * jf - prr, prr * 2, prr * 2);
      }
    }
    // peristalsis: bultos luminosos que recorren el cuerpo a 22 segmentos por segundo
    for (let k = 0; k < rec.bulgeN; k++) {
      const pos = (now - rec.bulge[k]) * 0.022;
      if (pos > n - 1) {
        rec.bulge[k] = rec.bulge[rec.bulgeN - 1];
        rec.bulgeN--;
        k--;
        continue;
      }
      if (pos < 0) continue;
      const i0 = pos | 0, fr = pos - i0;
      const i1 = i0 + 1 < n ? i0 + 1 : i0;
      // no interpolar a través de un corte de portal
      let bx = X[i0], by = Y[i0];
      const jx = X[i1] - bx, jy = Y[i1] - by;
      if (jx < HALF_W && jx > -HALF_W && jy < HALF_H && jy > -HALF_H) { bx += jx * fr; by += jy * fr; }
      const br = radAt(pos * inv, ss) * 1.25;
      const fade = 1 - smoothstep(0.8, 1, pos * inv);
      c.globalAlpha = 0.55 * fade * av;
      c.drawImage(spr, bx - br * 2.2, by - br * 2.2, br * 4.4, br * 4.4);
      c.globalAlpha = 0.35 * fade * av;
      c.drawImage(p.glowBody, bx - br * 3, by - br * 3, br * 6, br * 6);
    }
  }

  function bellBlink(rec) {
    if (!rec.immune || !rec.immuneEnd) return 1;
    const left = rec.immuneEnd - Date.now();
    if (left > 1500 || left < -500) return 1;
    const on = Math.sin(nowMs() * 0.001 * 4 * TAU) > 0;
    return on ? 1 : 0.25;
  }

  function passHead(rec, ss, now) {
    const c = ctx, p = rec.paint;
    if (rec.n === 0) return;
    const dx = rec.dirX, dy = rec.dirY;
    const nxh = -dy, nyh = dx;
    let hx = rec.x[0], hy = rec.y[0];
    // retroceso visual al disparar
    const rel = now - rec.recoilT0;
    if (rel >= 0 && rel < 90) {
      const rk = 0.15 * ss * Math.sin(Math.PI * rel / 90);
      hx -= dx * rk; hy -= dy * rk;
    }
    const av = rec.alphaVis;
    const ang = Math.atan2(dy, dx);
    // glow de cabeza
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.6 * av;
    const gr = 1.0 * ss;
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
    const ir = 0.55 * ss;
    c.drawImage(p.glowCore, hx + dx * 0.05 * ss - ir, hy + dy * 0.05 * ss - ir, ir * 2, ir * 2);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = av < 1 ? 0.5 + 0.5 * av : 1;
    // ojos
    const ex = hx + dx * 0.18 * ss, ey = hy + dy * 0.18 * ss;
    if (ss >= 12) {
      const o = 0.22 * ss, sr = 0.12 * ss, pr = 0.07 * ss, pf = 0.03 * ss;
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
      const sw1 = Math.sin(animT * 0.003), sw2 = Math.sin(animT * 0.004 + 1);
      const lx0 = hx + dx * 0.3 * ss, ly0 = hy + dy * 0.3 * ss;
      const lcx = hx + dx * 0.7 * ss + nxh * 0.25 * ss * sw1, lcy = hy + dy * 0.7 * ss + nyh * 0.25 * ss * sw1;
      const lex = hx + dx * 0.85 * ss + nxh * 0.15 * ss * sw2, ley = hy + dy * 0.85 * ss + nyh * 0.15 * ss * sw2;
      c.strokeStyle = p.lure;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(lx0, ly0);
      c.quadraticCurveTo(lcx, lcy, lex, ley);
      c.stroke();
      c.globalCompositeOperation = 'lighter';
      const lr = 0.35 * ss;
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
      const o2 = 0.22 * ss;
      c.fillStyle = '#01060A';
      c.fillRect(ex + nxh * o2 - 0.5, ey + nyh * o2 - 0.5, 1, 1);
      c.fillRect(ex - nxh * o2 - 0.5, ey - nyh * o2 - 0.5, 1, 1);
    }
    c.globalAlpha = 1;
    drawBell(rec, ss, now, hx, hy, ang);
    // sonar del jugador propio (y sonar triple al empezar la ronda)
    if (rec.isMe && mode === 'game') {
      for (let k = 0; k < 3; k++) {
        const el = now - roundStartT - k * 200;
        if (el < 0 || el >= 700) continue;
        const tt = el / 700;
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
      const sp = (now - sonarBase) % 2400;
      if (sp >= 0 && sp < 900) {
        const st = sp / 900;
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
  let sonarBase = 0;

  // Campana de medusa (5.7)
  function drawBell(rec, ss, now, hx, hy, ang) {
    const c = ctx;
    const popEl = now - rec.popT0;
    const popping = popEl >= 0 && popEl < 280;
    if (!rec.immune && !popping) return;
    let scale = 1, alpha = 1;
    const inf = now - rec.inflateT0;
    if (inf >= 0 && inf < 360) scale = Math.max(0, easeOutBack(inf / 360));
    if (popping) {
      const pt = popEl / 280;
      scale = 1 + 0.35 * easeOutCubic(pt);
      alpha = 1 - pt;
    } else {
      alpha = bellBlink(rec);
    }
    if (scale <= 0.01) return;
    const beat = reducedMotion ? 0 : Math.sin(now * 0.001 * 1.6 * TAU);
    const rx = 0.95 * ss * scale * (1 + 0.08 * beat);
    const ry = 0.95 * ss * scale * (1 - 0.08 * beat);
    const cosA = Math.cos(ang), sinA = Math.sin(ang);
    const bx = hx - cosA * 0.15 * ss, by = hy - sinA * 0.15 * ss;
    alpha *= rec.alphaVis;
    // glow suave
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.35 * alpha;
    const gr = 1.6 * ss * scale;
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
      for (let k = -1; k <= 1; k++) {
        const ox = -sinA * k * ry * 0.7, oy = cosA * k * ry * 0.7;
        const sx0 = bx + ox, sy0 = by + oy;
        const sway = Math.sin(animT * 0.004 + k * 1.3) * 0.18 * ss;
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
  const LABEL_MAX = 64, LABEL_PAD = 2;
  let placedLabels = new Float32Array(LABEL_MAX * 4), placedLabelN = 0;
  const labelOrder = new Int32Array(LABEL_MAX);

  function resetLabelSlots() { placedLabelN = 0; }

  function labelHits(x0, y0, x1, y1) {
    for (let i = 0; i < placedLabelN; i++) {
      const o = i * 4;
      if (x0 < placedLabels[o + 2] && x1 > placedLabels[o] && y0 < placedLabels[o + 3] && y1 > placedLabels[o + 1]) return true;
    }
    return false;
  }

  function drawLabel(rec, ss, sprite, alpha, scale) {
    const c = ctx;
    const w = sprite._w * scale, h = sprite._h * scale;
    const hx = rec.x[0], hy = rec.y[0];
    const above = hy - (0.9 * ss + 8);
    const below = hy + 0.9 * ss + 8 + h * 0.2;
    let ly = above;
    if (ly - h / 2 < 16) ly = below;
    const lx = clamp(hx, w / 2 + 2, W - w / 2 - 2);
    const x0 = lx - w / 2 - LABEL_PAD, x1 = lx + w / 2 + LABEL_PAD;
    if (labelHits(x0, ly - h / 2 - LABEL_PAD, x1, ly + h / 2 + LABEL_PAD)) {
      const alt = ly === above ? below : above;
      if (alt - h / 2 < 2 || alt + h / 2 > H - 2 || labelHits(x0, alt - h / 2 - LABEL_PAD, x1, alt + h / 2 + LABEL_PAD)) return;
      ly = alt;
    }
    if (placedLabelN < LABEL_MAX) {
      const o = placedLabelN * 4;
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
    const n = Math.min(visCount, LABEL_MAX);
    for (let i = 0; i < n; i++) {
      const p = labelPriority(visRecs[i]);
      let j = i - 1;
      while (j >= 0 && labelPriority(visRecs[labelOrder[j]]) < p) { labelOrder[j + 1] = labelOrder[j]; j--; }
      labelOrder[j + 1] = i;
    }
    return n;
  }

  // ---------------------------------------------------------------------------
  // Comida, consumibles y proyectiles
  // ---------------------------------------------------------------------------
  let prevFoodKeys = new Float64Array(128), prevFoodN = 0;
  const curFoodKeys = new Float64Array(128);
  let spawnKey = new Float64Array(48), spawnT0 = new Float64Array(48), spawnN = 0;
  let lastFoodsRef = null;
  let foodsPrimed = false;
  let prevConsIds = [], curConsIds = [];
  let consSpawnId = new Array(16), consSpawnT0 = new Float64Array(16), consSpawnN = 0;
  let lastConsRef = null;
  let consPrimed = false;

  function addSpawn(key, now) {
    if (spawnN >= 48) { // descarta la más vieja
      for (let i = 1; i < 48; i++) { spawnKey[i - 1] = spawnKey[i]; spawnT0[i - 1] = spawnT0[i]; }
      spawnN = 47;
    }
    spawnKey[spawnN] = key;
    spawnT0[spawnN] = now;
    spawnN++;
  }

  function spawnScale(key, now) {
    for (let i = 0; i < spawnN; i++) {
      if (spawnKey[i] === key) {
        const el = now - spawnT0[i];
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
    const n = foods ? Math.min(foods.length, 128) : 0;
    for (let i = 0; i < n; i++) {
      const f = foods[i];
      const key = f.x * 1000 + f.y;
      curFoodKeys[i] = key;
      if (foodsPrimed) {
        let found = false;
        for (let j = 0; j < prevFoodN; j++) if (prevFoodKeys[j] === key) { found = true; break; }
        if (!found) {
          addSpawn(key, now);
          const half = s / 2;
          fxRing(f.x + half, f.y + half, 0.3 * s, 1.4 * s, 360, FOOD_COL[clamp((f.score | 0) - 1, 0, 4)], 0.7, 1.5, 0);
        }
      }
    }
    for (let k = 0; k < n; k++) prevFoodKeys[k] = curFoodKeys[k];
    prevFoodN = n;
    foodsPrimed = true;
  }

  function detectConsumableSpawns(cons, now) {
    if (cons === lastConsRef) return;
    lastConsRef = cons;
    const n = cons ? cons.length : 0;
    curConsIds.length = 0;
    for (let i = 0; i < n; i++) {
      const c = cons[i];
      const id = c.id !== undefined ? c.id : (c.x * 1000 + c.y);
      curConsIds.push(id);
      if (consPrimed && prevConsIds.indexOf(id) < 0) {
        if (consSpawnN >= 16) consSpawnN = 0;
        consSpawnId[consSpawnN] = id;
        consSpawnT0[consSpawnN] = now;
        consSpawnN++;
        const half = s / 2;
        fxRing(c.x + half, c.y + half, 0.3 * s, 1.8 * s, 420, '#9FF4FF', 0.7, 1.5, 0);
      }
    }
    const tmp = prevConsIds; prevConsIds = curConsIds; curConsIds = tmp;
    consPrimed = true;
  }

  function consSpawnScale(id, now) {
    for (let i = 0; i < consSpawnN; i++) {
      if (consSpawnId[i] === id) {
        const el = now - consSpawnT0[i];
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
    const c = ctx, half = s / 2, n = foods.length;
    const w = 0.8 * TAU / 1000;
    // glows
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const f = foods[i];
      const fa = foodAlpha(f);
      if (fa <= 0.01) continue;
      const v = clamp((f.score | 0) - 1, 0, 4);
      const ph = foodPhase(f.x, f.y);
      const sc = spawnScale(f.x * 1000 + f.y, now);
      if (sc <= 0.01) continue;
      const br = 1 + 0.06 * Math.sin(animT * w + ph);
      const cx = f.x + half, cy = f.y + half + 0.06 * s * Math.sin(animT * w * 0.9 + ph * 1.3);
      const r = FOOD_R[v];
      const R = FOOD_GLOW * r * (1 + 0.1 * (v + 1)) * br * sc;
      c.globalAlpha = 0.9 * fa;
      c.drawImage(foodGlows[v], cx - R, cy - R, R * 2, R * 2);
    }
    // discos (con contorno y dígito horneados)
    c.globalCompositeOperation = 'source-over';
    for (let i = 0; i < n; i++) {
      const f = foods[i];
      const fa = foodAlpha(f);
      if (fa <= 0.01) continue;
      const v = clamp((f.score | 0) - 1, 0, 4);
      const ph = foodPhase(f.x, f.y);
      const sc = spawnScale(f.x * 1000 + f.y, now);
      if (sc <= 0.01) continue;
      const br = 1 + 0.06 * Math.sin(animT * w + ph);
      const cx = f.x + half, cy = f.y + half + 0.06 * s * Math.sin(animT * w * 0.9 + ph * 1.3);
      const orb = foodOrbs[v];
      const hr = orb._r * br * sc;
      c.globalAlpha = fa;
      c.drawImage(orb, cx - hr, cy - hr, hr * 2, hr * 2);
    }
    // satélites y anillo exterior del 5
    c.globalCompositeOperation = 'lighter';
    const satR = Math.max(1, 0.06 * s) * 3;
    for (let i = 0; i < n; i++) {
      const f = foods[i];
      const fa = foodAlpha(f);
      if (fa <= 0.01) continue;
      const v = clamp((f.score | 0) - 1, 0, 4);
      const ph = foodPhase(f.x, f.y);
      const sc = spawnScale(f.x * 1000 + f.y, now);
      if (sc <= 0.01) continue;
      const cx = f.x + half, cy = f.y + half + 0.06 * s * Math.sin(animT * w * 0.9 + ph * 1.3);
      const r = FOOD_R[v] * sc;
      const orbit = 1.6 * r + 1.5;
      const count = v + 1;
      const base = animT * 0.0016 + ph;
      c.globalAlpha = 0.95 * fa;
      for (let k = 0; k < count; k++) {
        const a = base + k * TAU / count;
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

  // Consumibles en el mapa (5.9): cada tipo con su silueta y su color, de tamaño fijo en px de la
  // arena. Todos comparten el anillo de sonar (en su color), que es la seña de "esto se toma".
  // sonar: anillo y partículas; ring: anillo al tomarlo y pulso del fondo; light: partículas claras
  const CONS_LOOK = {
    immunity: { sonar: '#B9A6FF', ring: '#9FF4FF', light: '#C9F8FF' },
    bigMouth: { sonar: '#FF8FD0', ring: '#FF8FD0', light: '#FFD6EC' },
    fan: { sonar: '#FF7A59', ring: '#FF7A59', light: '#FFE3D9' }
  };
  const CONS_BELL_W = 7.5, CONS_BELL_H = 9;   // semiancho y alto de la campana
  const CONS_SONAR_MS = 2000;
  function drawConsumables(cons, now) {
    if (!cons || cons.length === 0) return;
    const c = ctx, half = s / 2;
    for (let i = 0; i < cons.length; i++) {
      const it = cons[i];
      const id = it.id !== undefined ? it.id : (it.x * 1000 + it.y);
      const sc = consSpawnScale(id, now);
      if (sc <= 0.01) continue;
      const look = CONS_LOOK[it.type] || CONS_LOOK.immunity;
      const ph = foodPhase(it.x, it.y);
      const cx = it.x + half;
      const cy = it.y + half + 1.2 * Math.sin(animT * 0.0012 * TAU / 1.2 + ph) - 2;
      const beat = Math.sin(animT * 0.001 * 1.4 * TAU + ph);
      // sonar: un anillo que nace en el centro y se abre hasta 26 px mientras se apaga
      const st = ((animT + ph * 318) % CONS_SONAR_MS) / CONS_SONAR_MS;
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 0.6 * (1 - st) * (1 - st) * sc;
      c.strokeStyle = look.sonar;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(cx, cy + 2, 9 + 17 * easeOutCubic(st), 0, TAU);
      c.stroke();
      if (look === CONS_LOOK.bigMouth) drawAnemone(c, cx, cy + 2, sc, ph, beat);
      else if (look === CONS_LOOK.fan) drawStarfish(c, cx, cy + 2, sc, ph);
      else drawJelly(c, cx, cy, sc, ph, beat);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  // Escudo: medusa violeta
  function drawJelly(c, cx, cy, sc, ph, beat) {
    // glows: violeta amplio y celeste cerca del núcleo
    const g2 = 20 * sc * (1 + 0.08 * Math.sin(animT * 0.001 * 0.7 * TAU + ph));
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.5 + 0.1 * Math.sin(animT * 0.001 * 0.7 * TAU + ph);
    c.drawImage(violetSprite, cx - g2, cy - g2, g2 * 2, g2 * 2);
    const g1 = 12 * sc;
    c.globalAlpha = 0.35;
    c.drawImage(shieldSprite, cx - g1, cy - g1, g1 * 2, g1 * 2);
    // tentáculos
    c.globalCompositeOperation = 'source-over';
    const bw = CONS_BELL_W * sc * (1 + 0.06 * beat), bh = CONS_BELL_H * sc * (1 - 0.06 * beat);
    c.globalAlpha = 0.85;
    c.strokeStyle = '#D6CCFF';
    c.lineWidth = 1.2;
    c.beginPath();
    for (let k = 0; k < 3; k++) {
      const tx = cx + (k - 1) * bw * 0.55;
      const sway = Math.sin(animT * 0.004 + k) * 1.8 * sc;
      c.moveTo(tx, cy);
      c.quadraticCurveTo(tx + sway, cy + 4 * sc, tx - sway * 0.6, cy + 8 * sc);
    }
    c.stroke();
    // campana (sprite horneado con su degradado y su borde)
    const bell = ensureConsSprite();
    c.globalAlpha = 1;
    c.drawImage(bell, cx - bw * bell._sx, cy - bh * bell._sy, bw * 2 * bell._sx, bh * bell._sy * bell._hy);
    // núcleo
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.9;
    const nr = 4 * sc;
    c.drawImage(pearlSprite, cx - nr, cy - bh * 0.45 - nr, nr * 2, nr * 2);
  }

  // Boca grande: anémona rosa. Ocho tentáculos que se mecen alrededor de una boca que se abre y
  // se cierra con el latido.
  const ANEMONE_ARMS = 8, ANEMONE_SWAY = 0.14;   // vaivén en radianes: 8 brazos a 45° no llegan a cruzarse
  function anemoneSway(k, ph) { return ANEMONE_SWAY * Math.sin(animT * 0.003 + k * 1.3 + ph); }
  function drawAnemone(c, cx, cy, sc, ph, beat) {
    const g = 18 * sc * (1 + 0.08 * Math.sin(animT * 0.001 * 0.7 * TAU + ph));
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.5;
    c.drawImage(anemoneSprite, cx - g, cy - g, g * 2, g * 2);
    c.globalCompositeOperation = 'source-over';
    const open = 1 + 0.12 * beat;
    const r0 = 3 * sc * open, r1 = 8.5 * sc;
    c.globalAlpha = 0.9;
    c.strokeStyle = '#FF8FD0';
    c.lineWidth = 1.4;
    c.lineCap = 'round';
    c.beginPath();
    for (let k = 0; k < ANEMONE_ARMS; k++) {
      const a = k * TAU / ANEMONE_ARMS + ph;
      const sway = anemoneSway(k, ph);
      c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      c.quadraticCurveTo(cx + Math.cos(a + sway) * (r0 + r1) * 0.55, cy + Math.sin(a + sway) * (r0 + r1) * 0.55,
        cx + Math.cos(a + sway * 1.6) * r1, cy + Math.sin(a + sway * 1.6) * r1);
    }
    c.stroke();
    c.lineCap = 'butt';
    // puntas
    c.fillStyle = '#FFD6EC';
    c.beginPath();
    for (let k = 0; k < ANEMONE_ARMS; k++) {
      const a = k * TAU / ANEMONE_ARMS + ph + anemoneSway(k, ph) * 1.6;
      const tx = cx + Math.cos(a) * r1, ty = cy + Math.sin(a) * r1;
      c.moveTo(tx + 1.1 * sc, ty);
      c.arc(tx, ty, 1.1 * sc, 0, TAU);
    }
    c.fill();
    // boca: centro oscuro con borde claro
    c.fillStyle = 'rgba(58, 8, 40, 0.9)';
    c.beginPath();
    c.arc(cx, cy, 2.6 * sc * open, 0, TAU);
    c.fill();
    c.strokeStyle = '#FFD6EC';
    c.lineWidth = 1.2;
    c.stroke();
  }

  // Abanico: estrella de mar coral de cinco brazos que gira despacio
  function drawStarfish(c, cx, cy, sc, ph) {
    const g = 18 * sc * (1 + 0.08 * Math.sin(animT * 0.001 * 0.7 * TAU + ph));
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.5;
    c.drawImage(coralSprite, cx - g, cy - g, g * 2, g * 2);
    c.globalCompositeOperation = 'source-over';
    const rot = animT * 0.0004 + ph - Math.PI / 2;
    const ro = 8.5 * sc, ri = 3.6 * sc;
    c.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = rot + k * Math.PI / 5;
      const r = k % 2 ? ri : ro;
      if (k === 0) c.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      else c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    c.closePath();
    c.globalAlpha = 0.9;
    c.fillStyle = '#FF7A59';
    c.fill();
    c.strokeStyle = '#FFD2C4';
    c.lineWidth = 1.2;
    c.lineJoin = 'round';
    c.stroke();
    c.lineJoin = 'miter';
    // poros a lo largo de cada brazo
    c.fillStyle = '#FFE3D9';
    c.beginPath();
    for (let k = 0; k < 5; k++) {
      const a = rot + k * TAU / 5;
      for (let j = 1; j <= 2; j++) {
        const px = cx + Math.cos(a) * ro * j * 0.32, py = cy + Math.sin(a) * ro * j * 0.32;
        c.moveTo(px + 0.8 * sc, py);
        c.arc(px, py, 0.8 * sc, 0, TAU);
      }
    }
    c.fill();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.8;
    const nr = 3 * sc;
    c.drawImage(pearlSprite, cx - nr, cy - nr, nr * 2, nr * 2);
  }

  // Campana del escudo: media elipse con degradado violeta (#D9CCFF -> #9C82FF, alpha 0,75) y
  // borde #F3EEFF al 90 %, horneada en un sprite por escala.
  let consSprite = null, consKK = 0;
  function ensureConsSprite() {
    if (consSprite && consKK === K) return consSprite;
    consKK = K;
    const rx = CONS_BELL_W * K, ry = CONS_BELL_H * K;
    const pad = 2;
    const cw = Math.ceil(rx * 2 + pad * 2), ch = Math.ceil(ry + pad * 2);
    const cnv = consSprite || makeCanvas(cw, ch);
    cnv.width = cw; cnv.height = ch;
    const g = cnv.getContext('2d');
    const cx = cw / 2, base = ry + pad;
    const lg = g.createLinearGradient(0, pad, 0, base);
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
  const trails = new Map();
  const trailPool = [];
  function newTrail() {
    const t = trailPool.length ? trailPool.pop() : { buf: new Float32Array(20), n: 0, head: 0, paint: null, seen: 0, fadeT0: 0, color: '' };
    t.n = 0; t.head = 0; t.paint = null; t.seen = 0; t.fadeT0 = 0; t.color = '';
    return t;
  }

  let trailNow = 0, trailLen = 10;
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
    const c = ctx, L = tr.n;
    if (L < 2) return;
    c.strokeStyle = tr.paint.body;
    const w0 = 0.36 * s;
    let idx = tr.head;
    let px = tr.buf[idx * 2], py = tr.buf[idx * 2 + 1];
    for (let j = 1; j < L; j++) {
      idx = (idx - 1 + 10) % 10;
      const qx = tr.buf[idx * 2], qy = tr.buf[idx * 2 + 1];
      const k = 1 - j / (L - 1 || 1);
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
    const c = ctx, half = s / 2;
    trailNow = now;
    trailLen = trailLenFor(quality);
    const n = list ? list.length : 0;
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const p = list[i];
      const x = (p.renderX !== undefined ? p.renderX : p.x) + half;
      const y = (p.renderY !== undefined ? p.renderY : p.y) + half;
      let tr = trails.get(p.id);
      if (!tr) { tr = newTrail(); trails.set(p.id, tr); }
      if (tr.color !== p.color || !tr.paint) { tr.paint = paintFor(p.color); tr.color = p.color; }
      tr.seen = frameNo;
      tr.fadeT0 = 0;
      const hd = (tr.head + 1) % 10;
      tr.buf[hd * 2] = x; tr.buf[hd * 2 + 1] = y;
      tr.head = hd;
      if (tr.n < trailLen) tr.n++; else tr.n = trailLen;
      drawTrail(tr, 1);
    }
    trails.forEach(trailSweep);
    // halos
    const flick = 1 + 0.15 * Math.sin(now * 0.05);
    const R = 1.6 * s;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      const tr = trails.get(p.id);
      if (!tr) continue;
      const x = tr.buf[tr.head * 2], y = tr.buf[tr.head * 2 + 1];
      c.globalAlpha = Math.min(1, 0.8 * flick);
      c.drawImage(tr.paint.glowBody, x - R, y - R, R * 2, R * 2);
    }
    // núcleos: cápsula orientada (largo 0,9 s, ancho 0,36 s)
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.lineWidth = 0.36 * s;
    const hl = 0.27 * s;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      const tr = trails.get(p.id);
      if (!tr) continue;
      const x = tr.buf[tr.head * 2], y = tr.buf[tr.head * 2 + 1];
      const dx = p.direction ? p.direction.x : 1, dy = p.direction ? p.direction.y : 0;
      c.strokeStyle = tr.paint.core;
      c.beginPath();
      c.moveTo(x - dx * hl, y - dy * hl);
      c.lineTo(x + dx * hl, y + dy * hl);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  // Colas desprendidas (impactos)
  const TAIL_MAX = 8, TAIL_PTS = 96;
  const tails = [];
  for (let ti = 0; ti < TAIL_MAX; ti++) tails.push({ on: false, t0: 0, n: 0, bx: new Float32Array(TAIL_PTS), by: new Float32Array(TAIL_PTS), paint: null, vx: 0, vy: 0, t0n: 0, s: 20 });

  function spawnTail(rec, lost, now) {
    if (!rec || rec.n < 2 || lost <= 0) return;
    let slot = null, oldest = 1e18, oi = 0;
    for (let i = 0; i < TAIL_MAX; i++) {
      if (!tails[i].on) { slot = tails[i]; break; }
      if (tails[i].t0 < oldest) { oldest = tails[i].t0; oi = i; }
    }
    if (!slot) slot = tails[oi];
    const n = Math.min(lost, rec.n - 1, TAIL_PTS);
    const start = rec.n - n;
    // no copiar a través de un corte de portal: se corta en el primer salto
    let count = 0;
    for (let k = start; k < rec.n; k++) {
      if (count > 0) {
        const dx = rec.x[k] - slot.bx[count - 1], dy = rec.y[k] - slot.by[count - 1];
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
    const c = ctx;
    for (let i = 0; i < TAIL_MAX; i++) {
      const tl = tails[i];
      if (!tl.on) continue;
      const el = now - tl.t0;
      if (el > 900) { tl.on = false; continue; }
      const t = el / 900;
      const ox = tl.vx * el / 1000, oy = tl.vy * el / 1000;
      const fade = 1 - t;
      c.save();
      c.translate(ox, oy);
      c.globalCompositeOperation = 'lighter';
      const R = 2.4 * radAt(tl.t0n, tl.s);
      c.globalAlpha = 0.18 * fade;
      for (let k = 0; k < tl.n; k += 2) {
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
  let countNum = 0, countT0 = -1e9;

  function prepareDigits(timeLeft) {
    // genera un sprite por frame antes de que haga falta (sin tirones en el momento tenso)
    if (timeLeft > 16) return;
    for (let n = 10; n >= 1; n--) {
      if (!digitReady(n)) { buildDigit(n); return; }
    }
  }

  function drawCountdown(state, now) {
    const tl = state.roundTimeLeft;
    const show = state.playing && tl >= 1 && tl <= 10;
    if (!show) { countNum = 0; return; }
    const n = Math.ceil(tl);
    if (n !== countNum) {
      countNum = n;
      countT0 = now;
      tensionBumpT0 = now;
    }
    if (!digitReady(n)) buildDigit(n);
    const spr = digitSprites[n];
    const base = n >= 6 ? 0.10 : (n >= 4 ? 0.14 : 0.20);
    const el = (now - countT0) / 450;
    const e = easeOutExpo(clamp01(el));
    const scale = reducedMotion ? 1 : 1.18 + (1 - 1.18) * e;
    const alpha = (base * 2 + (base - base * 2) * e) * countFade;
    const w = spr._w * scale, h = spr._h * scale;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.drawImage(spr, W / 2 - w / 2, H / 2 + 12 - h / 2, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------------------
  // Congelamiento de fin de ronda (5.14)
  // ---------------------------------------------------------------------------
  let freezeT0 = -1e9;
  let freezeWinner = null;
  const FREEZE_MS = 2400;
  let roundStartT = -1e9;

  function frozen(now) { return now - freezeT0 < FREEZE_MS; }

  // ---------------------------------------------------------------------------
  // Marco del frame
  // ---------------------------------------------------------------------------
  function frameBegin(now) {
    frameNo++;
    let dt;
    if (!lastNow) dt = 16;
    else dt = now - lastNow;
    if (dt > 250 || dt < 0) dt = 16;   // pestaña oculta o reloj extraño: no saltar
    trackFrame(now - lastNow);
    lastNow = now;
    if (dt > 50) dt = 50;
    frameDt = dt;
    // cámara lenta del congelamiento (400 ms para entrar, 400 ms para salir)
    const targetScale = (mode === 'game' && frozen(now)) ? 0.25 : 1;
    const stepK = clamp01(dt / 400) * 3;
    timeScale += (targetScale - timeScale) * (stepK > 1 ? 1 : stepK);
    snowSpeed = timeScale;
    animT += dt * timeScale;
    // dpr cambiado (pantalla distinta)
    const dprRaw = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    if (dprRaw !== lastDprRaw) { lastDprRaw = dprRaw; scheduleResize(); }
    return dt;
  }

  function beginDraw() {
    const c = ctx;
    c.setTransform(K, 0, 0, K, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }

  function drawBase(dt, causticMul) {
    const c = ctx;
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
  const visRecs = new Array(32);
  let visCount = 0;
  let recSweepT = 0;

  function recSweep(rec, id) {
    if (lastNow - rec.lastSeenT > 15000) snakeRecs.delete(id);
  }

  function prepareSnakes(state, now) {
    visCount = 0;
    headCount = 0;
    const snakes = state.snakes;
    if (!snakes) return;
    const me = state.spectating ? null : state.myId;
    const wave = !reducedMotion && quality > 0;
    let meRec = null;
    const fr = frozen(now);
    for (let i = 0; i < snakes.length; i++) {
      const sn = snakes[i];
      if (!sn) continue;
      const rec = getRec(sn.id);
      rec.lastSeenT = now;
      rec.s = s;
      rec.name = sn.name;
      rec.isMe = me !== null && me !== undefined && sn.id === me;
      if (rec.colorKey !== sn.color || !rec.paint) { rec.paint = paintFor(sn.color); rec.colorKey = sn.color; }
      const shieldEnd = sn.effects ? sn.effects.immunity : 0;
      const imm = !!shieldEnd;
      if (imm && !rec.immune && now - rec.inflateT0 > 1000) rec.inflateT0 = now; // por si el evento no llegó
      rec.immune = imm;
      rec.immuneEnd = imm ? shieldEnd : 0;
      rec.bigMouth = !!(sn.effects && sn.effects.bigMouth);
      // Ancla: con la hora del servidor del instante dibujado (state.serverT)
      const anchoredUntil = +sn.anchoredUntil || 0;
      rec.anchored = !!state.serverT && anchoredUntil > state.serverT;
      rec.anchorLeft = rec.anchored ? clamp01((anchoredUntil - state.serverT) / anchorLastsMs) : 0;
      if (sn.gameover) { rec.n = 0; continue; }
      const segs = sn.getRenderSegments ? sn.getRenderSegments() : sn.segments;
      const n = segs ? segs.length : 0;
      if (n === 0) { rec.n = 0; continue; }
      ensureCap(rec, n);
      const half = s / 2;
      for (let k = 0; k < n; k++) {
        rec.rx[k] = segs[k].x + half;
        rec.ry[k] = segs[k].y + half;
      }
      rec.n = n;
      computeRuns(rec);
      const d = sn.direction;
      computeDir(rec, d ? d.x : 0, d ? d.y : 0, s);
      computeShape(rec, s, wave && !rec.anchored);   // anclada no ondula
      // fin de ronda: los que no ganaron se atenúan y pierden el filamento
      if (fr && freezeWinner !== undefined && freezeWinner !== null) {
        const et = easeInOutSine(clamp01((now - freezeT0) / 600));
        const win = freezeWinner !== null && sn.id === freezeWinner;
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
    let c = ctx, i, rec;
    // 1. halos
    c.globalCompositeOperation = 'lighter';
    for (i = 0; i < visCount; i++) { rec = visRecs[i]; passHalo(rec, ssOf(rec), now); }
    // membrana de inmunidad
    for (i = 0; i < visCount; i++) { rec = visRecs[i]; if (rec.immune) passImmunityMembrane(rec, ssOf(rec), now); }
    // alcance de la boca grande
    for (i = 0; i < visCount; i++) { rec = visRecs[i]; if (rec.bigMouth && rec.n > 0) passBigMouthReach(rec, ssOf(rec)); }
    // 2. cuerpos (la coraza del ancla va debajo: asoma como contorno)
    c.globalCompositeOperation = 'source-over';
    for (i = 0; i < visCount; i++) { rec = visRecs[i]; if (rec.anchored && rec.n > 0) passAnchorShell(rec, ssOf(rec)); }
    c.globalAlpha = 1;
    for (i = 0; i < visCount; i++) { rec = visRecs[i]; passBody(rec, ssOf(rec)); }
    // 3. filamentos
    c.globalCompositeOperation = 'lighter';
    for (i = 0; i < visCount; i++) { rec = visRecs[i]; passFilament(rec, ssOf(rec)); }
    // 4. fotóforos
    for (i = 0; i < visCount; i++) { rec = visRecs[i]; passPhotophores(rec, ssOf(rec), now); }
    // 5. cabezas
    for (i = 0; i < visCount; i++) { rec = visRecs[i]; passHead(rec, ssOf(rec), now); }
    // 6. ancla: placas sobre el cuerpo y el aro que se vacía sobre la cabeza
    for (i = 0; i < visCount; i++) { rec = visRecs[i]; if (rec.anchored && rec.n > 0) passAnchorPlates(rec, ssOf(rec)); }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  // Ancla (5.7): la criatura se cierra. Coraza perla debajo del cuerpo (asoma como contorno), placas
  // a lo largo del cuerpo y un aro sobre la cabeza que se vacía en lo que dura.
  let anchorLastsMs = 1500;
  function passAnchorShell(rec, ss) {
    const c = ctx;
    c.strokeStyle = '#E8FBFF';
    c.globalAlpha = 0.85 * rec.alphaVis;
    c.lineWidth = 2 * radAt(0, ss) + 2.4;
    c.lineCap = 'round';
    for (let r = 0; r < rec.runCount; r++) {
      const a = rec.runs[r * 2], b = rec.runs[r * 2 + 1];
      c.beginPath();
      pathRange(c, rec.x, rec.y, a, b, 0, b - a);
      c.stroke();
      strokeCutEnds(rec, r, a, b);
    }
  }
  function passAnchorPlates(rec, ss) {
    const c = ctx, n = rec.n, X = rec.x, Y = rec.y, NX = rec.nx, NY = rec.ny;
    const inv = 1 / Math.max(n - 1, 1);
    c.globalCompositeOperation = 'source-over';
    c.strokeStyle = '#E8FBFF';
    c.globalAlpha = 0.5 * rec.alphaVis;
    c.lineWidth = 1;
    c.beginPath();
    for (let i = 1; i < n; i += 2) {
      const rr = radAt(i * inv, ss) * 0.8;
      c.moveTo(X[i] - NX[i] * rr, Y[i] - NY[i] * rr);
      c.lineTo(X[i] + NX[i] * rr, Y[i] + NY[i] * rr);
    }
    c.stroke();
    const hx = X[0], hy = Y[0], ar = 1.15 * ss;
    c.globalCompositeOperation = 'lighter';
    c.lineWidth = 2;
    c.globalAlpha = 0.2 * rec.alphaVis;
    c.beginPath();
    c.arc(hx, hy, ar, 0, TAU);
    c.stroke();
    c.globalAlpha = 0.9 * rec.alphaVis;
    c.beginPath();
    c.arc(hx, hy, ar, -Math.PI / 2, -Math.PI / 2 + TAU * rec.anchorLeft);
    c.stroke();
  }

  // Boca grande: un anillo punteado y tenue, del color de la anémona, marca hasta dónde come
  let bigMouthReach = 2.55;
  function passBigMouthReach(rec, ss) {
    const c = ctx;
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = (0.34 + 0.08 * Math.sin(animT * 0.004)) * rec.alphaVis;
    c.strokeStyle = '#FF8FD0';
    c.lineWidth = 1.2;
    c.setLineDash(DASH_REACH);
    c.lineDashOffset = -animT * 0.01;
    c.beginPath();
    c.arc(rec.x[0], rec.y[0], bigMouthReach * ss, 0, TAU);
    c.stroke();
    c.setLineDash(NO_DASH);
    c.lineDashOffset = 0;
  }
  const DASH_REACH = [3, 4], NO_DASH = [];

  // Corona (5.6): tres puntas de luz dorada justo encima de la cabeza de la serpiente más larga,
  // siempre derecha en la pantalla, debajo de la etiqueta de nombre
  function drawCrown(id, now) {
    if (id === null || id === undefined) return;
    const rec = snakeRecs.get(id);
    if (!rec || rec.n === 0 || rec.lastSeenT !== now) return;
    const c = ctx, ss = s;
    const hx = rec.x[0], hy = rec.y[0] - 0.75 * ss + 0.6 * Math.sin(animT * 0.003);
    const w = 0.7 * ss, hSide = 0.42 * ss, hMid = 0.62 * ss;
    const a = rec.alphaVis;
    // glow detrás
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.55 * a;
    const g = 1.3 * ss;
    c.drawImage(goldSprite, hx - g, hy - hMid * 0.5 - g, g * 2, g * 2);
    // contorno: base y tres puntas
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 0.95 * a;
    c.strokeStyle = '#FFE08A';
    c.lineWidth = 1.4;
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(hx - w, hy);
    c.lineTo(hx - w, hy - hSide);
    c.lineTo(hx - w * 0.45, hy - hSide * 0.45);
    c.lineTo(hx, hy - hMid);
    c.lineTo(hx + w * 0.45, hy - hSide * 0.45);
    c.lineTo(hx + w, hy - hSide);
    c.lineTo(hx + w, hy);
    c.closePath();
    c.fillStyle = 'rgba(255, 224, 138, 0.28)';
    c.fill();
    c.stroke();
    c.lineJoin = 'miter';
    // perlas en las puntas
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = a;
    const pr = 0.22 * ss;
    c.drawImage(pearlSprite, hx - w - pr, hy - hSide - pr, pr * 2, pr * 2);
    c.drawImage(pearlSprite, hx - pr, hy - hMid - pr, pr * 2, pr * 2);
    c.drawImage(pearlSprite, hx + w - pr, hy - hSide - pr, pr * 2, pr * 2);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  function ssGame() { return s; }

  function drawGameLabels(now) {
    const c = ctx;
    c.globalCompositeOperation = 'source-over';
    resetLabelSlots();
    const n = sortLabelOrder();
    for (let i = 0; i < n; i++) {
      const rec = visRecs[labelOrder[i]];
      if (rec.n === 0) continue;
      if (rec.isMe) {
        const el = now - roundStartT;
        if (el >= 0 && el < 2500) {
          const a = el < 200 ? el / 200 : 1 - smoothstep(2100, 2500, el);
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

  let renderStart = 0;

  function render(state, now) {
    if (!ctx || !state) return;
    if (typeof now !== 'number') now = nowMs();
    renderStart = nowMs();
    if (mode !== 'game') { mode = 'game'; }
    const dt = frameBegin(now);
    lastState = state;
    lastGameRenderT = now;
    myId = state.myId;

    // Tensión
    const tl = state.roundTimeLeft;
    const fr = frozen(now);
    const targetT = (state.playing && tl !== undefined && tl <= 10 && tl >= 0 && !fr) ? (10 - tl) / 10 : 0;
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
    if (state.playing || fr) drawCrown(state.leaderId, now); //   corona sobre la más larga
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
  const creatures = new Map();
  const creatureArr = [];
  let idleEpoch = 0;
  let sIdle = 18;
  let captionSprite = null, captionText = '', captionEpoch = 0;
  let pointerX = -1e4, pointerY = -1e4, pointerT = -1e9, pointerSpeed = 0;
  const ANON = [
    { id: '__anon0', name: '', color: '#00ffff' },
    { id: '__anon1', name: '', color: '#40ff80' },
    { id: '__anon2', name: '', color: '#8040ff' }
  ];

  function hash1(i, seed) {
    const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    return (v - Math.floor(v)) * 2 - 1;
  }
  function noise1(x, seed) {
    const i = Math.floor(x), f = x - i;
    const u = f * f * (3 - 2 * f);
    return hash1(i, seed) * (1 - u) + hash1(i + 1, seed) * u;
  }

  function Creature(id) {
    this.id = id;
    this.rec = new SnakeRec(id);
    this.x = W / 2; this.y = H / 2;
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
    const cx = Math.cos(heading), cy = Math.sin(heading);
    for (let k = 0; k < 10; k++) {
      cr.hist[k * 2] = x - cx * spacing * (k + 1);
      cr.hist[k * 2 + 1] = y - cy * spacing * (k + 1);
    }
    cr.dist = 0;
  }

  // Si la criatura corresponde a una serpiente recién vista en partida, nace donde
  // quedó esa serpiente (continuidad entre ronda y sala). El resto del cuerpo se disuelve.
  function seedFromGame(cr, now) {
    if (now - lastGameRenderT > 4000) return false;
    const rec = snakeRecs.get(cr.id);
    if (!rec || rec.n === 0 || rec.lastSeenT < lastGameRenderT - 50) return false;
    const spacing = 0.8 * sIdle;
    const hx = clamp(rec.rx[0], 30, W - 30), hy = clamp(rec.ry[0], 30, H - 30);
    placeCreature(cr, hx, hy, Math.atan2(rec.dirY, rec.dirX), spacing);
    // historia desde el cuerpo real (mismo tramo)
    const limit = rec.runs[1];
    for (let k = 0; k < 10 && k + 1 <= limit; k++) {
      cr.hist[k * 2] = clamp(rec.rx[k + 1], 4, W - 4);
      cr.hist[k * 2 + 1] = clamp(rec.ry[k + 1], 4, H - 4);
    }
    // el resto del cuerpo se convierte en una nube de plancton que se dispersa
    const p = rec.paint;
    const stepJ = rec.n > 70 ? 3 : 2;
    for (let j = 11; j < rec.n && j < 160; j += stepJ) {
      const jx = rec.x[j] + (Math.random() - 0.5) * s, jy = rec.y[j] + (Math.random() - 0.5) * s;
      setBurst(1, (j & 2) ? p.body : p.core, 12, 46, 450, 1100, 0.9, 2.2, 'dot', -24, 0.94);
      particles.burst(jx, jy, BO);
    }
    return true;
  }

  function hatchCreature(cr, now) {
    const spacing = 0.8 * sIdle;
    placeCreature(cr, 80 + Math.random() * (W - 160), 80 + Math.random() * (H - 160), Math.random() * TAU, spacing * 0.2);
    cr.hatchT0 = now;
    const p = cr.rec.paint;
    fxRing(cr.x, cr.y, 0.3 * sIdle, 2.4 * sIdle, 700, p.core, 0.8, 1.5, 0);
    setBurst(scaleCount(20), p.body, 20, 80, 500, 1000, 1, 2.2, 'dot', -10, 0.92);
    particles.burst(cr.x, cr.y, BO);
  }

  function dissolveCreature(cr) {
    const rec = cr.rec, p = rec.paint;
    if (!p) return;
    for (let i = 0; i < rec.n; i++) {
      setBurst(scaleCount(3), (i & 1) ? p.core : p.body, 10, 40, 700, 900, 1, 2.2, 'dot', -30, 0.95);
      BO.angle = -Math.PI / 2;
      BO.spread = 1.6;
      particles.burst(rec.x[i], rec.y[i], BO);
    }
  }

  function syncCreatures(list, now) {
    idleEpoch++;
    const src = list && list.length ? list : ANON;
    const anon = !(list && list.length);
    for (let i = 0; i < src.length && i < 24; i++) {
      const it = src[i];
      if (!it || it.id === undefined || it.id === null) continue;
      let cr = creatures.get(it.id);
      let fresh = false;
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
    for (let k = creatureArr.length - 1; k >= 0; k--) {
      const c = creatureArr[k];
      if (c.seen !== idleEpoch) {
        dissolveCreature(c);
        creatures.delete(c.id);
        creatureArr.splice(k, 1);
      }
    }
  }

  function steerCreatures(dtMs) {
    const dt = dtMs / 1000 * timeScale;
    const spacing = 0.8 * sIdle;
    const speed = 38;
    for (let i = 0; i < creatureArr.length; i++) {
      const cr = creatureArr[i];
      const turn = noise1(animT / cr.period + cr.seed, cr.seed) * 1.5;
      cr.heading += turn * dt;
      const m = 40 + sIdle;
      if (cr.x < m || cr.x > W - m || cr.y < m || cr.y > H - m) {
        const desired = Math.atan2(H / 2 - cr.y, W / 2 - cr.x);
        let diff = desired - cr.heading;
        while (diff > Math.PI) diff -= TAU;
        while (diff < -Math.PI) diff += TAU;
        cr.heading += diff * clamp01(dt * 2.2);
      }
      const step = speed * dt;
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
    let meRec = null;
    const wave = !reducedMotion && quality > 0;
    for (let i = 0; i < creatureArr.length; i++) {
      const cr = creatureArr[i];
      const rec = cr.rec;
      const hatchEl = now - cr.hatchT0;
      let pts = 10;
      if (hatchEl >= 0 && hatchEl < 1200) pts = 2 + Math.round(8 * easeOutCubic(hatchEl / 1200));
      ensureCap(rec, 11);
      rec.rx[0] = cr.x; rec.ry[0] = cr.y;
      for (let k = 1; k < pts; k++) {
        rec.rx[k] = cr.hist[(k - 1) * 2];
        rec.ry[k] = cr.hist[(k - 1) * 2 + 1];
      }
      rec.n = pts;
      rec.s = sIdle;
      rec.name = cr.name;
      rec.isMe = cr.isMe;
      rec.immune = false;
      rec.bigMouth = false;
      rec.anchored = false;
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

  let pointerPaintRef = null;
  function pointerPaint() {
    if (!pointerPaintRef) pointerPaintRef = paintFor('#00ffff');
    return pointerPaintRef;
  }

  function ssIdle() { return sIdle; }

  function drawIdleLabels() {
    const c = ctx;
    c.globalCompositeOperation = 'source-over';
    resetLabelSlots();
    const n = sortLabelOrder();
    for (let i = 0; i < n; i++) {
      const rec = visRecs[labelOrder[i]];
      if (rec.n === 0) continue;
      const cr = creatures.get(rec.id);
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
    let w = captionSprite._w, h = captionSprite._h;
    if (w > W - 24) { h = h * (W - 24) / w; w = W - 24; }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(captionSprite, W / 2 - w / 2, H - 28 - h / 2, w, h);
  }

  let modeSwitchedFromGame = false;

  function renderIdle(now, opts) {
    if (!ctx) return;
    if (typeof now !== 'number') now = nowMs();
    renderStart = nowMs();
    modeSwitchedFromGame = mode === 'game';
    mode = 'idle';
    const dt = frameBegin(now);
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
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const x = (ev.clientX - r.left) / r.width * W;
    const y = (ev.clientY - r.top) / r.height * H;
    const t = nowMs();
    const dtp = t - pointerT;
    if (dtp > 0 && dtp < 200) {
      const dx = x - pointerX, dy = y - pointerY;
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
    const sn = lastState.snakes;
    for (let i = 0; i < sn.length; i++) if (sn[i] && sn[i].id === id) return sn[i].color;
    return null;
  }

  function backdropPulse(color, strength) {
    const B = global.Backdrop;
    if (B && typeof B.pulse === 'function') {
      try { B.pulse(color, strength); } catch (err) { /* el fondo vivo es opcional */ }
    }
  }

  function cellCenterX(x) { return (+x || 0) + s / 2; }
  function cellCenterY(y) { return (+y || 0) + s / 2; }

  function onFoodEaten(e) {
    if (!e || !particles) return;
    const v = clamp((e.score | 0) || 1, 1, 5);
    const col = FOOD_COL[v - 1];
    const cx = cellCenterX(e.x), cy = cellCenterY(e.y);
    setBurst(scaleCount(6 + 4 * v), col, 30, 70 + 20 * v, 380, 700, 1.2, 2.4, 'dot', -10, 0.9);
    burstNow(cx, cy);
    fxRing(cx, cy, 0.4 * s, 1.8 * s, 320, col, 0.7, 1.5, 0);
    const rec = snakeRecs.get(e.playerId);
    if (rec && rec.bulgeN < 3) rec.bulge[rec.bulgeN++] = nowMs();
    // Comida tomada de lejos (boca grande): una estela la lleva hasta la boca. Del otro lado de un
    // portal, no: cruzaría toda la arena.
    if (rec && rec.n > 0) {
      const dist = Math.hypot(rec.x[0] - cx, rec.y[0] - cy);
      if (dist > 1.2 * s && dist < 4 * s) {
        const f = fxSpawn(FX_STREAK, nowMs(), 170);
        f.x = cx; f.y = cy; f.id = e.playerId; f.color = col;
      }
    }
    if (isMe(e.playerId)) fxText(cx, cy - 0.6 * s, '+' + v, col, labelPx() * 1.15, 18, 700);
  }

  function onHit(e) {
    if (!e || !particles) return;
    const now = nowMs();
    const cx = cellCenterX(e.x), cy = cellCenterY(e.y);
    const vp = paintFor(e.color || snakeColorById(e.targetId) || '#00ff41');
    const ap = paintFor(e.attackerColor || snakeColorById(e.attackerId) || '#4FD8FF');
    if (e.anchored) { onAnchoredHit(e, cx, cy, ap); return; }
    // segmentsLost llega en 0 cuando el disparo da en la cabeza de una serpiente de 1 segmento
    // (index.js, moveProjectiles): hay impacto pero no daño, así que no se muestra "−1"
    const lost = e.segmentsLost === undefined ? 1 : Math.max(0, e.segmentsLost | 0);
    const head = !!e.headshot;
    let total = Math.min(48, 10 + 5 * lost) + (head ? 12 : 0);
    total = scaleCount(total);
    const sparks = Math.round(total * 0.6);
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
    const rec = snakeRecs.get(e.targetId);
    if (rec && rec.n > 1 && lost > 0) spawnTail(rec, lost, now);
    const tp = vp;
    const tx = cx, ty = cy - 0.7 * s;
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

  // Impacto contra una serpiente anclada: rebota en la coraza. Chispas perla rápidas y cortas, un
  // anillo seco y "−1" (pierde un segmento, sin cola desprendida ni tinta).
  function onAnchoredHit(e, cx, cy, ap) {
    const lost = Math.max(0, e.segmentsLost | 0);
    setBurst(scaleCount(14), '#E8FBFF', 120, 260, 200, 380, 1, 2, 'spark', 0, 0.86);
    burstNow(cx, cy);
    setBurst(scaleCount(6), ap.body, 80, 180, 200, 350, 1, 2, 'spark', 0, 0.86);
    burstNow(cx, cy);
    fxRing(cx, cy, 0.3 * s, 1.4 * s, 200, '#E8FBFF', 0.9, 2, 0);
    fxText(cx, cy - 0.7 * s, lost ? '−' + lost : 'Sin daño', '#E8FBFF', labelPx() * 1.1, 18, 800);
    if (isMe(e.targetId)) shake(3, 120);
    else if (isMe(e.attackerId)) shake(1.5, 80);
  }

  function onBlock(e) {
    if (!e || !particles) return;
    const now = nowMs();
    const cx = cellCenterX(e.x), cy = cellCenterY(e.y);
    setBurst(scaleCount(14), '#9FF4FF', 40, 120, 500, 900, 1.5, 3.5, 'bubble', -40, 0.9);
    burstNow(cx, cy);
    fxRing(cx, cy, 0.4 * s, 2.0 * s, 380, '#9FF4FF', 0.8, 1.5, 0);
    fxRing(cx, cy, 0.4 * s, 2.8 * s, 420, '#9FF4FF', 0.5, 1.2, 80);
    const rec = snakeRecs.get(e.playerId);
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
  const PP = new Float32Array(4);

  function portalSide(edge, cellX, cellY, paint) {
    portalPoint(edge, cellX, cellY, PP);
    const x = PP[0], y = PP[1], ix = PP[2], iy = PP[3];
    const f = fxSpawn(FX_PWAVE, nowMs(), 420);
    f.x = x; f.y = y; f.edge = edge; f.paint = paint;
    fxEdge(edge, (edge === 0 || edge === 2) ? x : y, paint, 600, 1);
    setBurst(scaleCount(6), paint.body, 30, 90, 350, 650, 1, 2, 'dot', 0, 0.9);
    BO.angle = Math.atan2(iy, ix);
    BO.spread = 1.6;
    burstNow(x + ix * 2, y + iy * 2);
  }

  function onPortal(e) {
    if (!e || !particles) return;
    const color = snakeColorById(e.playerId);
    const paint = paintFor(color || '#1FF2D2');
    const fx = e.fromX, fy = e.fromY, tx = e.toX, ty = e.toY;
    if (fx === undefined || tx === undefined) return;
    let fromEdge, toEdge;
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
    const now = nowMs();
    const paint = paintFor(e.color || snakeColorById(e.playerId) || '#4FD8FF');
    const dx = e.direction ? e.direction.x : 1, dy = e.direction ? e.direction.y : 0;
    const cx = cellCenterX(e.x), cy = cellCenterY(e.y);
    setBurst(scaleCount(6), paint.body, 80, 180, 180, 320, 1, 2, 'spark', 0, 0.88);
    BO.angle = Math.atan2(dy, dx);
    BO.spread = 0.9;
    burstNow(cx - dx * s * 0.4, cy - dy * s * 0.4);
    // Los laterales del abanico (spread) no repiten el costo: la ráfaga cuesta un solo segmento
    const rec = e.spread ? null : snakeRecs.get(e.playerId);
    if (rec && rec.n > 0) {
      rec.recoilT0 = now;
      const ti = rec.n - 1;
      const f = fxSpawn(FX_DROP, now, 500);
      f.x = rec.x[ti]; f.y = rec.y[ti]; f.r0 = 0.35 * s; f.paint = rec.paint;
      setBurst(scaleCount(4), rec.paint.body, 10, 40, 300, 500, 0.8, 1.4, 'dot', 30, 0.92);
      burstNow(f.x, f.y);
    }
    // recordar color por id (para el expirado)
    if (e.id !== undefined) {
      let tr = trails.get(e.id);
      if (!tr) { tr = newTrail(); tr.seen = frameNo; trails.set(e.id, tr); }
      tr.paint = paint; tr.color = e.color;
    }
    if (isMe(e.playerId) && !e.spread) shake(1.5, 80);
  }

  function onProjectileExpired(e) {
    if (!e || !particles) return;
    const tr = e.id !== undefined ? trails.get(e.id) : null;
    const paint = tr && tr.paint ? tr.paint : null;
    const col = paint ? paint.body : '#4FD8FF';
    const cx = cellCenterX(e.x), cy = cellCenterY(e.y);
    setBurst(scaleCount(7), col, 20, 60, 300, 500, 1, 2, 'dot', 0, 0.9);
    burstNow(cx, cy);
    fxRing(cx, cy, 0.3 * s, 1.0 * s, 240, col, 0.7, 1.5, 0);
    const edge = edgeOf(cx, cy);
    const dEdge = edge === 0 ? cy : (edge === 1 ? W - cx : (edge === 2 ? H - cy : cx));
    if (dEdge < 2 * s) fxEdge(edge, (edge === 0 || edge === 2) ? cx : cy, paint, 360, 0.7);
  }

  function onConsumablePicked(e) {
    if (!e || !particles) return;
    const now = nowMs();
    const rec = snakeRecs.get(e.playerId);
    let cx, cy;
    if (e.x !== undefined && e.y !== undefined) { cx = cellCenterX(e.x); cy = cellCenterY(e.y); }
    else if (rec && rec.n > 0) { cx = rec.x[0]; cy = rec.y[0]; }
    else return;
    const look = CONS_LOOK[e.consumableType] || CONS_LOOK.immunity;
    fxRing(cx, cy, 0.5 * s, 2.4 * s, 420, look.ring, 0.8, 1.8, 0);
    const half = scaleCount(18) >> 1;
    setBurst(half, look.light, 40, 120, 500, 900, 1.2, 2.6, 'dot', -30, 0.92);
    burstNow(cx, cy);
    setBurst(half, look.sonar, 40, 120, 500, 900, 1.2, 2.6, 'dot', -30, 0.92);
    burstNow(cx, cy);
    if (rec && look === CONS_LOOK.immunity) { rec.inflateT0 = now; rec.immune = true; }
    if (isMe(e.playerId)) backdropPulse(look.ring, 0.2);
  }

  function onRoundStart() {
    const now = nowMs();
    freezeT0 = -1e9;
    freezeWinner = undefined;
    roundStartT = now;
    haloBoostT0 = now;
    sonarBase = now + 600;
    const f = fxSpawn(FX_WAVE, now, 800);
    f.x = W / 2; f.y = H / 2;
    // descartar colas desprendidas y estelas de la ronda anterior
    for (let i = 0; i < TAIL_MAX; i++) tails[i].on = false;
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
    const now = nowMs();
    const winnerId = data && data.winnerId !== undefined ? data.winnerId : null;
    freezeT0 = now;
    freezeWinner = winnerId;
    if (winnerId === null || winnerId === undefined) return;
    const rec = snakeRecs.get(winnerId);
    if (!rec) return;
    const col = fxSpawn(FX_COLUMN, now, FREEZE_MS + 400);
    col.id = winnerId; col.s = s;
    const fo = fxSpawn(FX_FOUNTAIN, now, 1300);
    fo.id = winnerId; fo.n = 0;
    if (isMe(winnerId)) backdropPulse('#C8FF3C', 0.5);
  }

  // ---------------------------------------------------------------------------
  // Init / config
  // ---------------------------------------------------------------------------
  let inited = false;

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
    const nw = +cfg.width || W, nh = +cfg.height || H;
    if (nw !== W || nh !== H) {
      W = nw; H = nh; HALF_W = W / 2; HALF_H = H / 2;
      for (let i = 0; i < SNOW_MAX; i++) { snowX[i] = Math.random() * W; snowY[i] = Math.random() * H; }
      if (canvas) applySize(true);
    }
    if (+cfg.bigMouthReach > 0) bigMouthReach = +cfg.bigMouthReach;
    if (+cfg.anchorLastsMs > 0) anchorLastsMs = +cfg.anchorLastsMs;
    const ns = +cfg.segmentSize || s;
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

  // Rehace el canvas ya, sin esperar al ResizeObserver: Scenes lo llama al agrandar la arena para
  // que no se vea estirada mientras anima
  function resize() {
    if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = 0; }
    applySize(false);
  }

  global.Arena = {
    init: init,
    setConfig: setConfig,
    resize: resize,
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
