/*
 * scenes.js: coreografía de escenas y sistemas de UI del abismo bioluminiscente.
 *
 * Expone: window.Scenes, window.Overlays, window.Toasts, window.HUD.
 * Usa (si existen): window.Backdrop (backdrop.js) y window.Arena.bioColor (arena.js).
 * Todas las animaciones se hacen con Web Animations API. Ningún texto que venga del
 * servidor se inserta con innerHTML: todo va con textContent.
 *
 * Firmas (contrato + extensiones marcadas en VISUAL_SPEC.md):
 *   Scenes.go(name, opts)       name: intro|login|lobby|room|game|final
 *                               opts.immediate, opts.greeting (lobby), opts.color (final), opts.reason (final)
 *   Scenes.current()            nombre de la escena actual (se actualiza al iniciar la transición)
 *   Scenes.onEnter(name, fn)    callback al terminar la entrada; devuelve una función para desuscribir
 *   Scenes.playIntro()          Promise que resuelve { skipped } al terminar o saltear la intro
 *   Scenes.isTransitioning()    (extensión)
 *   Scenes.chrome               (extensión) { openDock, closeDock, toggleDock, openProfile, closeProfile, closeAll, alertDock }
 *
 *   Overlays.countdown(n)
 *   Overlays.roundStart()       "¡Ya!" al arrancar la partida
 *   Overlays.final(data)        data: { ranking: [{ id, name, color, length }], winners: [id], reason? }
 *   Overlays.hideAll()
 *   Overlays.open(el), Overlays.close(el)   (extensión) modales .modal
 *
 *   Toasts.show(message, type, durationMs, opts)  → { el, dismiss() }
 *   Toasts.clear()              (extensión)
 *
 *   HUD.update(data), HUD.show(), HUD.hide(), HUD.reset() (extensión)
 */
(function (global) {
  'use strict';

  if (global.Scenes && global.Scenes.__bio) return;

  const doc = global.document;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const noop = function () {};

  // =========================================================================================
  // Utilidades
  // =========================================================================================
  function $(id) { return doc.getElementById(id); }
  function qs(root, sel) { return root ? root.querySelector(sel) : null; }
  function qsa(root, sel) { return root ? Array.prototype.slice.call(root.querySelectorAll(sel)) : []; }
  function now() { return (global.performance && global.performance.now) ? global.performance.now() : Date.now(); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function mk(tag, cls, text) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svgEl(tag, attrs) {
    const e = doc.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]);
    return e;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, Math.max(0, ms)); }); }
  function truncate(s, n) {
    s = s == null ? '' : String(s);
    const chars = Array.from ? Array.from(s) : s.split('');
    return chars.length > n ? chars.slice(0, n).join('') + '…' : s;
  }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function isShown(node) { return !!(node && node.getClientRects && node.getClientRects().length); }
  function callSafe(fn, a, b) { try { return fn(a, b); } catch (e) { if (global.console) console.error(e); } }

  function parseHex(c) {
    if (typeof c !== 'string') return null;
    let h = c.trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length < 6) return null;
    const n = parseInt(h.slice(0, 6), 16);
    return isNaN(n) ? null : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function alpha(hex, a) {
    const rgb = parseHex(hex) || [31, 242, 210];
    return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
  }

  // Preferencias
  const mqReduced = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const mqCoarse = global.matchMedia ? global.matchMedia('(pointer: coarse)') : null;
  let reduced = !!(mqReduced && mqReduced.matches);
  let coarse = !!(mqCoarse && mqCoarse.matches);
  function onMQ(mq, fn) {
    if (!mq) return;
    if (mq.addEventListener) mq.addEventListener('change', fn); else if (mq.addListener) mq.addListener(fn);
  }
  onMQ(mqReduced, function (e) { reduced = !!e.matches; });
  onMQ(mqCoarse, function (e) { coarse = !!e.matches; });
  function isMobile() { return (global.innerWidth || 1024) <= 768; }

  // Tokens de movimiento (se leen una vez al iniciar, con los valores del spec como respaldo)
  const M = {
    out: 'cubic-bezier(0.16, 1, 0.3, 1)', in: 'cubic-bezier(0.5, 0, 0.75, 0)',
    inOut: 'cubic-bezier(0.37, 0, 0.63, 1)', std: 'cubic-bezier(0.2, 0, 0, 1)',
    jelly: 'cubic-bezier(0.34, 1.56, 0.64, 1)', jellySoft: 'cubic-bezier(0.34, 1.3, 0.64, 1)',
    press: 90, hover: 180, quick: 240, base: 360, panel: 520, sceneOut: 420, sceneIn: 720,
    mood: 1200, breath: 3600, breathSlow: 6400, stagger: 60
  };
  function readTokens() {
    let cs;
    try { cs = global.getComputedStyle(doc.documentElement); } catch (e) { return; }
    function str(name, key) {
      const v = (cs.getPropertyValue(name) || '').trim();
      if (/^cubic-bezier\(\s*[-\d.]+\s*,\s*[-\d.]+\s*,\s*[-\d.]+\s*,\s*[-\d.]+\s*\)$/.test(v)) M[key] = v;
    }
    function ms(name, key) {
      const v = (cs.getPropertyValue(name) || '').trim(), n = parseFloat(v);
      if (!isNaN(n) && n >= 0) M[key] = /ms$/.test(v) ? n : (/s$/.test(v) ? n * 1000 : n);
    }
    str('--bio-ease-out', 'out'); str('--bio-ease-in', 'in'); str('--bio-ease-in-out', 'inOut');
    str('--bio-ease-standard', 'std'); str('--bio-ease-jelly', 'jelly'); str('--bio-ease-jelly-soft', 'jellySoft');
    ms('--bio-dur-press', 'press'); ms('--bio-dur-hover', 'hover'); ms('--bio-dur-quick', 'quick');
    ms('--bio-dur-base', 'base'); ms('--bio-dur-panel', 'panel'); ms('--bio-dur-scene-out', 'sceneOut');
    ms('--bio-dur-scene-in', 'sceneIn'); ms('--bio-dur-mood', 'mood'); ms('--bio-dur-breath', 'breath');
    ms('--bio-dur-breath-slow', 'breathSlow'); ms('--bio-stagger', 'stagger');
  }

  // WAAPI. Las animaciones propias llevan id 'bio' para poder cancelarlas sin tocar las de CSS.
  function anim(node, frames, opts) {
    if (!node || typeof node.animate !== 'function') return null;
    let a = null;
    try { a = node.animate(frames, opts); }
    catch (e) {
      try {
        const o2 = {};
        for (const k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o2[k] = opts[k];
        o2.easing = 'ease-out';
        a = node.animate(frames, o2);
      } catch (e2) { a = null; }
    }
    if (a) { try { a.id = 'bio'; } catch (e3) { /* nada */ } }
    return a;
  }
  function done(a) {
    if (!a || !a.finished) return Promise.resolve();
    return a.finished.then(noop, noop);
  }
  function cancelAnim(a) { if (a) { try { a.cancel(); } catch (e) { /* nada */ } } }
  function cancelMine(node, subtree) {
    if (!node || !node.getAnimations) return;
    let list;
    try { list = node.getAnimations(subtree ? { subtree: true } : undefined); } catch (e) { return; }
    for (let i = 0; i < list.length; i++) if (list[i].id === 'bio') cancelAnim(list[i]);
  }
  // Transform base del CSS (para componer sin pisar un translate(-50%,-50%) de LAYOUT).
  function baseTf(node) {
    try {
      const t = global.getComputedStyle(node).transform;
      return (t && t !== 'none') ? t : '';
    } catch (e) { return ''; }
  }
  function tf(base, extra) {
    if (!extra || extra === 'none') return base || 'none';
    return base ? base + ' ' + extra : extra;
  }
  function setInert(node, on) {
    if (!node) return;
    if (on) { node.setAttribute('inert', ''); node.setAttribute('aria-hidden', 'true'); try { node.inert = true; } catch (e) { /* nada */ } }
    else { node.removeAttribute('inert'); node.removeAttribute('aria-hidden'); try { node.inert = false; } catch (e) { /* nada */ } }
  }
  function backdrop() { return global.Backdrop || null; }
  function bdPulse(color, strength) { const B = backdrop(); if (B && B.pulse) callSafe(function () { B.pulse(color, strength); }); }
  function bdMood(name, opts) { const B = backdrop(); if (B && B.setMood) callSafe(function () { B.setMood(name, opts); }); }
  function bdDescend(dir) { const B = backdrop(); if (B && B.descend) callSafe(function () { B.descend(dir); }); }

  // =========================================================================================
  // Colores de jugador (Arena.bioColor, con respaldo local idéntico a la tabla del spec 2.3)
  // =========================================================================================
  const BIO_FALLBACK = {
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
  const BIO_DEFAULT = { slot: 0, body: '#1FF2D2', core: '#E1FFF9', deep: '#03463F', text: '#8AF7E6' };
  const bioCache = {};
  function hslHex(h, s, l) {
    s /= 100; l /= 100;
    const k = function (n) { return (n + h / 30) % 12; };
    const a = s * Math.min(l, 1 - l);
    const f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); };
    const to = function (x) { const v = Math.round(x * 255).toString(16); return v.length < 2 ? '0' + v : v; };
    return '#' + to(f(0)) + to(f(8)) + to(f(4));
  }
  function bio(hex) {
    const A = global.Arena;
    if (A && typeof A.bioColor === 'function') {
      try { const r = A.bioColor(hex); if (r && r.body) return r; } catch (e) { /* respaldo */ }
    }
    const key = typeof hex === 'string' ? hex.trim().toLowerCase() : '';
    if (!key) return BIO_DEFAULT;
    if (BIO_FALLBACK[key]) return BIO_FALLBACK[key];
    if (bioCache[key]) return bioCache[key];
    const rgb = parseHex(key);
    if (!rgb) return BIO_DEFAULT;
    const r1 = rgb[0] / 255, g1 = rgb[1] / 255, b1 = rgb[2] / 255;
    let mx = Math.max(r1, g1, b1), mn = Math.min(r1, g1, b1), h = 0, d = mx - mn;
    if (d) {
      if (mx === r1) h = ((g1 - b1) / d) % 6; else if (mx === g1) h = (b1 - r1) / d + 2; else h = (r1 - g1) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    let sum = 0;
    for (let i = 0; i < key.length; i++) sum += key.charCodeAt(i);
    const res = { slot: sum % 4, body: hslHex(h, 100, 68), core: hslHex(h, 100, 95), deep: hslHex(h, 100, 22), text: hslHex(h, 100, 84) };
    bioCache[key] = res;
    return res;
  }

  // =========================================================================================
  // Iconos (SVG en línea, retícula de 20 px, trazo 1,75, extremos redondeados, currentColor)
  // =========================================================================================
  const SPRITE_ID = { jelly: 'i-medusa', eye: 'i-eye', anemone: 'i-anemona', star: 'i-estrella' };
  function icon(kind, cls, size) {
    const sid = SPRITE_ID[kind];
    if (sid && doc.getElementById(sid)) {
      const u = svgEl('svg', { 'class': 'icon' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true', focusable: 'false' });
      const use = svgEl('use');
      use.setAttribute('href', '#' + sid);
      u.appendChild(use);
      return u;
    }
    const s = svgEl('svg', {
      viewBox: '0 0 20 20', width: String(size || 18), height: String(size || 18), fill: 'none',
      stroke: 'currentColor', 'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      'aria-hidden': 'true', focusable: 'false'
    });
    if (cls) s.setAttribute('class', cls);
    if (kind === 'jelly') {
      s.appendChild(svgEl('path', { d: 'M3.5 10.5a6.5 6.5 0 0 1 13 0c-1.1.6-2.1.6-3.2 0-1.1.6-2.2.6-3.3 0-1.1.6-2.2.6-3.3 0-1.1.6-2.1.6-3.2 0z' }));
      s.appendChild(svgEl('path', { d: 'M6.6 12.2c0 1.6.9 2.2.9 3.8' }));
      s.appendChild(svgEl('path', { d: 'M10 12.4v4.6' }));
      s.appendChild(svgEl('path', { d: 'M13.4 12.2c0 1.6-.9 2.2-.9 3.8' }));
    } else if (kind === 'eye') {
      s.appendChild(svgEl('path', { d: 'M1.8 10S4.8 4.5 10 4.5 18.2 10 18.2 10 15.2 15.5 10 15.5 1.8 10 1.8 10z' }));
      s.appendChild(svgEl('circle', { cx: '10', cy: '10', r: '2.6' }));
    }
    return s;
  }

  // =========================================================================================
  // TOASTS
  // =========================================================================================
  const Toasts = (function () {
    const MAX = 3;
    const DEFAULT_DUR = { info: 3000, success: 3000, error: 4500, invitation: 9000 };
    const items = [];
    let box = null;

    function container() {
      if (box && box.isConnected) return box;
      box = $('toasts');
      if (!box && doc.body) {
        box = mk('div');
        box.id = 'toasts';
        box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:80;display:flex;flex-direction:column;gap:8px;width:min(360px,calc(100vw - 32px));pointer-events:none';
        doc.body.appendChild(box);
      }
      if (box) {
        if (!box.getAttribute('role')) box.setAttribute('role', 'region');
        if (!box.getAttribute('aria-label')) box.setAttribute('aria-label', 'Notificaciones');
      }
      return box;
    }

    function startTimer(it) {
      it.startedAt = now();
      clearTimeout(it.timer);
      it.timer = setTimeout(function () { dismiss(it); }, it.remaining);
      if (it.barAnim) { try { it.barAnim.play(); } catch (e) { /* nada */ } }
      if (it.cssBar) it.bar.style.removeProperty('animation-play-state');
      it.node.classList.remove('is-paused');
    }
    function pauseTimer(it) {
      if (it.paused || it.leaving) return;
      it.paused = true;
      clearTimeout(it.timer);
      it.remaining = Math.max(200, it.remaining - (now() - it.startedAt));
      if (it.barAnim) { try { it.barAnim.pause(); } catch (e) { /* nada */ } }
      if (it.cssBar) it.bar.style.animationPlayState = 'paused';
      it.node.classList.add('is-paused');
    }
    function resumeTimer(it) {
      if (!it.paused || it.leaving) return;
      if (it.node.matches(':hover') || it.node.contains(doc.activeElement)) return;
      it.paused = false;
      startTimer(it);
    }
    function restart(it) {
      it.t0 = now();
      it.remaining = it.duration;
      it.paused = false;
      if (it.barAnim) { try { it.barAnim.currentTime = 0; } catch (e) { /* nada */ } }
      if (it.cssBar) {
        it.bar.style.setProperty('--d', it.duration + 'ms');
        it.bar.style.animation = 'none'; void it.bar.offsetWidth; it.bar.style.removeProperty('animation');
      }
      startTimer(it);
      if (!reduced) anim(it.node, [{ transform: 'scale(1)' }, { transform: 'scale(1.025)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
    }

    function flipSiblings(c, firstTops) {
      if (reduced || !firstTops.length) return;
      for (let i = 0; i < firstTops.length; i++) {
        const f = firstTops[i];
        if (!f.node.isConnected || f.item.leaving) continue;
        const dy = f.top - f.node.getBoundingClientRect().top;
        if (Math.abs(dy) > 0.5) anim(f.node, [{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: M.base, easing: M.out, composite: 'replace' });
      }
    }

    function show(message, type, durationMs, opts) {
      const c = container();
      if (!c) return null;
      type = Object.prototype.hasOwnProperty.call(DEFAULT_DUR, type) ? type : 'info';
      opts = opts || {};
      const text = message == null ? '' : String(message);
      const dur = (typeof durationMs === 'number' && durationMs > 0) ? durationMs : DEFAULT_DUR[type];

      // Mismo texto y tipo en menos de 2000 ms: se reinicia el existente
      for (let i = 0; i < items.length; i++) {
        const ex = items[i];
        if (!ex.leaving && ex.text === text && ex.type === type && now() - ex.t0 < 2000) {
          ex.duration = dur;
          restart(ex);
          return ex.handle;
        }
      }

      const node = mk('div', 'toast');
      node.setAttribute('data-type', type);
      node.setAttribute('role', type === 'error' ? 'alert' : 'status');
      node.style.pointerEvents = 'auto';
      const dot = mk('i', 'toast-dot'); dot.setAttribute('aria-hidden', 'true');
      const p = mk('p', 'toast-text', text);
      node.appendChild(dot);
      node.appendChild(p);
      const it = { node: node, text: text, type: type, duration: dur, remaining: dur, t0: now(), startedAt: 0, timer: 0, paused: false, leaving: false, barAnim: null, cssBar: false, bar: null };
      if (opts.actionLabel) {
        const btn = mk('button', 'toast-action', String(opts.actionLabel));
        btn.type = 'button';
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (typeof opts.onAction === 'function') callSafe(opts.onAction);
          dismiss(it);
        });
        node.appendChild(btn);
      }
      const bar = mk('i', 'toast-progress');
      bar.setAttribute('aria-hidden', 'true');
      bar.style.setProperty('--d', dur + 'ms');
      node.appendChild(bar);
      it.bar = bar;
      it.handle = { el: node, dismiss: function () { dismiss(it); } };

      // FLIP: los que ya están bajan sin salto cuando el nuevo entra arriba
      const firstTops = [];
      for (let i = 0; i < items.length; i++) if (!items[i].leaving) firstTops.push({ node: items[i].node, item: items[i], top: items[i].node.getBoundingClientRect().top });
      c.insertBefore(node, c.firstChild);
      items.unshift(it);
      flipSiblings(c, firstTops);

      // Barra de progreso: si LAYOUT la anima por CSS (con --d) se respeta; si no, WAAPI
      let cssAnim = '';
      try { cssAnim = global.getComputedStyle(bar).animationName; } catch (e) { cssAnim = ''; }
      if (cssAnim && cssAnim !== 'none') it.cssBar = true;
      else {
        bar.style.transformOrigin = 'left center';
        it.barAnim = anim(bar, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: dur, easing: 'linear', fill: 'forwards' });
      }

      // Entrada
      if (reduced) anim(node, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'linear' });
      else anim(node, [
        { opacity: 0, transform: 'translateY(-12px) scale(0.97)', filter: 'blur(4px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0px)' }
      ], { duration: M.base, easing: M.jellySoft });

      node.addEventListener('mouseenter', function () { pauseTimer(it); });
      node.addEventListener('mouseleave', function () { resumeTimer(it); });
      node.addEventListener('focusin', function () { pauseTimer(it); });
      node.addEventListener('focusout', function () { setTimeout(function () { resumeTimer(it); }, 0); });
      startTimer(it);

      // Tope de visibles: el más viejo sale antes de tiempo
      let visible = 0;
      for (let i = 0; i < items.length; i++) {
        if (items[i].leaving) continue;
        visible++;
        if (visible > MAX) dismiss(items[i]);
      }

      if (type === 'invitation') {
        bdPulse('#A98BFF', 0.4);
        Chrome.alertDock();
      }
      return it.handle;
    }

    function dismiss(it) {
      if (!it || it.leaving) return;
      it.leaving = true;
      clearTimeout(it.timer);
      const node = it.node;
      const out = reduced
        ? anim(node, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'linear', fill: 'forwards' })
        : anim(node, [
          { opacity: 1, transform: 'none', filter: 'blur(0px)' },
          { opacity: 0, transform: isMobile() ? 'translateY(-8px)' : 'translateX(16px)', filter: 'blur(4px)' }
        ], { duration: M.quick, easing: M.in, fill: 'forwards' });
      done(out).then(function () {
        if (!node.isConnected) { remove(it); return; }
        const h = node.getBoundingClientRect().height;
        let gap = 0;
        try { gap = parseFloat(global.getComputedStyle(node.parentNode).rowGap) || 0; } catch (e) { gap = 0; }
        node.style.overflow = 'hidden';
        const col = anim(node, [
          { height: h + 'px', marginTop: '0px', paddingTop: global.getComputedStyle(node).paddingTop, paddingBottom: global.getComputedStyle(node).paddingBottom, opacity: 0 },
          { height: '0px', marginTop: (-gap) + 'px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 }
        ], { duration: reduced ? 1 : 200, easing: M.std, fill: 'forwards' });
        return done(col).then(function () { remove(it); });
      });
    }
    function remove(it) {
      const i = items.indexOf(it);
      if (i >= 0) items.splice(i, 1);
      if (it.node.parentNode) it.node.parentNode.removeChild(it.node);
    }
    function clear() { items.slice().forEach(dismiss); }

    return { show: show, clear: clear };
  })();

  // =========================================================================================
  // CHROME: chip de perfil y dock de jugadores en línea
  //
  // LAYOUT los resuelve con la Popover API (popover + popovertarget) y anima la apertura y
  // el cierre con @starting-style. Aquí solo se sincroniza aria-expanded, se ofrecen
  // helpers programáticos y se cierran al cambiar de escena (el top layer taparía overlays).
  // Si el navegador no soporta popovers, se usa un respaldo con .hidden / data-open.
  // =========================================================================================
  const Chrome = (function () {
    const NATIVE = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';
    let inited = false, alertTimer = 0;
    let fbPop = false, fbDock = false;

    function chip() { return qs(doc, '#profileView .profile-chip'); }
    function popover() { return qs(doc, '#profileView .profile-popover'); }
    function dock() { return $('dock'); }
    function usesPopover(node) { return !!(node && NATIVE && node.hasAttribute('popover')); }
    function isOpenNative(node) { try { return node.matches(':popover-open'); } catch (e) { return false; } }

    function isProfileOpen() {
      const p = popover();
      if (!p) return false;
      return usesPopover(p) ? isOpenNative(p) : fbPop;
    }
    function isDockOpen() {
      const d = dock();
      if (!d) return false;
      return usesPopover(d) ? isOpenNative(d) : fbDock;
    }

    function fbShow(node, on, from) {
      cancelMine(node);
      if (on) {
        node.classList.remove('hidden');
        node.setAttribute('data-open', 'true');
        node.style.display = node === dock() ? 'flex' : 'block';
        if (!reduced) anim(node, [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], { duration: M.base, easing: M.out });
      } else {
        node.removeAttribute('data-open');
        node.style.removeProperty('display');
      }
    }

    function openProfile() {
      const p = popover();
      if (!p || isProfileOpen()) return;
      if (usesPopover(p)) { try { p.showPopover(); } catch (e) { /* nada */ } }
      else { fbPop = true; fbShow(p, true, 'translateY(-8px) scale(0.98)'); syncChip(); }
    }
    function closeProfile() {
      const p = popover();
      if (!p || !isProfileOpen()) return;
      if (usesPopover(p)) { try { p.hidePopover(); } catch (e) { /* nada */ } }
      else { fbPop = false; fbShow(p, false); syncChip(); }
    }
    function toggleProfile() { if (isProfileOpen()) closeProfile(); else openProfile(); }

    function openDock() {
      const d = dock();
      if (!d || isDockOpen()) return;
      if (usesPopover(d)) { try { d.showPopover(); } catch (e) { /* nada */ } }
      else { fbDock = true; fbShow(d, true, isMobile() ? 'translateY(40px)' : 'translateX(24px)'); syncToggle(); }
    }
    function closeDock() {
      const d = dock();
      if (!d || !isDockOpen()) return;
      if (usesPopover(d)) { try { d.hidePopover(); } catch (e) { /* nada */ } }
      else { fbDock = false; fbShow(d, false); syncToggle(); }
    }
    function toggleDock() { if (isDockOpen()) closeDock(); else openDock(); }

    function syncChip() { const c = chip(); if (c) c.setAttribute('aria-expanded', isProfileOpen() ? 'true' : 'false'); }
    function syncToggle() { const t = $('dockToggle'); if (t) t.setAttribute('aria-expanded', isDockOpen() ? 'true' : 'false'); }

    // Invitación con el dock cerrado: #dockToggle late una vez y queda violeta 3 s (CSS de LAYOUT).
    function alertDock() {
      const tog = $('dockToggle');
      if (!tog || isDockOpen() || !isShown(tog)) return;
      tog.classList.remove('has-invite');
      tog.removeAttribute('data-invite');
      void tog.offsetWidth;
      tog.classList.add('has-invite');
      tog.setAttribute('data-invite', 'true');
      clearTimeout(alertTimer);
      alertTimer = setTimeout(function () {
        tog.classList.remove('has-invite');
        tog.removeAttribute('data-invite');
      }, 3000);
    }

    function closeAll() { closeProfile(); closeDock(); }

    function init() {
      if (inited) return;
      inited = true;
      const c = chip(), p = popover(), d = dock(), tog = $('dockToggle');
      if (p && !p.id) p.id = 'profilePopover';
      if (c && p) { c.setAttribute('aria-controls', p.id); c.setAttribute('aria-expanded', 'false'); }
      if (tog && d) { tog.setAttribute('aria-controls', d.id || 'dock'); tog.setAttribute('aria-expanded', 'false'); }
      if (p) {
        if (usesPopover(p)) p.addEventListener('toggle', syncChip);
        else {
          p.classList.add('hidden');
          if (c) c.addEventListener('click', function (e) { e.preventDefault(); toggleProfile(); });
          doc.addEventListener('pointerdown', function (e) {
            const pv = $('profileView');
            if (fbPop && pv && !pv.contains(e.target)) closeProfile();
          }, true);
        }
        // una acción del popover (ranking, cerrar sesión) lo cierra
        p.addEventListener('click', function (e) {
          if (e.target && e.target.closest && e.target.closest('button')) setTimeout(closeProfile, 0);
        });
      }
      if (d) {
        if (usesPopover(d)) d.addEventListener('toggle', syncToggle);
        else if (tog) tog.addEventListener('click', function (e) { e.preventDefault(); toggleDock(); });
      }
      global.addEventListener('resize', function () {
        if ((global.innerWidth || 0) >= 1280 && isDockOpen()) closeDock();
      }, { passive: true });
      // Con la página desplazada, el topbar fijo gana fondo (theme.css,
      // body[data-scrolled]) para que el wordmark y los chips no queden encima del contenido.
      let scrolledOn = false;
      const syncScrolled = function () {
        const on = (global.scrollY || global.pageYOffset || 0) > 4;
        if (on === scrolledOn) return;
        scrolledOn = on;
        if (on) doc.body.setAttribute('data-scrolled', ''); else doc.body.removeAttribute('data-scrolled');
      };
      global.addEventListener('scroll', syncScrolled, { passive: true });
      syncScrolled();
    }

    return {
      init: init, openProfile: openProfile, closeProfile: closeProfile, toggleProfile: toggleProfile,
      openDock: openDock, closeDock: closeDock, toggleDock: toggleDock, alertDock: alertDock, closeAll: closeAll,
      isProfileOpen: isProfileOpen, isDockOpen: isDockOpen, isNative: function () { return NATIVE; },
      fallbackOpen: function () { return fbPop || fbDock; }
    };
  })();

  // =========================================================================================
  // HUD
  // =========================================================================================
  const HUD = (function () {
    const CIRC = 163.36;     // 2π × 26
    let built = false, shown = false, want = false;
    let root, bar, side, board, caption;
    let timerWrap, ringProg, ringCilia, timerVal, statusWrap,
        specEl, selfEl, selfDot, selfScore;
    let hideTimer = 0;
    const L = { time: -1, rt: -1, phase: '', playing: null, spec: null, self: '', selfC: '', final3: false };
    // Efectos propios: un indicador por tipo, en orden fijo, cada uno con su tiempo restante
    const EFFECT_CHIPS = [
      { type: 'immunity', label: 'Escudo ', icon: 'jelly' },
      { type: 'bigMouth', label: 'Boca grande ', icon: 'anemone' },
      { type: 'fan', label: 'Abanico ', icon: 'star' }
    ];
    const chips = [];   // { type, el, time, bar, active, until, total, txt }
    let chipRaf = 0;
    const rows = new Map();
    let order = [];          // ids visibles en orden
    let gapLi = null;
    const ents = [];           // buffer reutilizado para ordenar
    let sortTotal = false;

    function arenaEl() { return $('scene-arena'); }

    function build() {
      if (built) return true;
      root = $('hud');
      if (!root) return false;
      built = true;
      bar = qs(root, '.hud-bar');
      if (!bar) { bar = mk('div', 'hud-bar'); root.appendChild(bar); }
      side = qs(root, '.hud-side');
      if (!side) { side = mk('div', 'hud-side'); root.appendChild(side); }
      board = qs(side, '.hud-board');
      if (!board) { board = mk('ol', 'hud-board'); side.insertBefore(board, side.firstChild); }
      caption = qs(side, '.hud-board-caption');
      if (!caption) { caption = mk('p', 'hud-board-caption'); side.appendChild(caption); }
      board.setAttribute('data-metric', 'live');
      board.setAttribute('aria-label', 'Marcador');
      caption.textContent = 'Largo actual';

      bar.replaceChildren();
      // Meta de la partida (una sola, por tiempo)
      const rw = mk('div', 'hud-goal');
      rw.appendChild(mk('span', 'hud-goal-label', 'Gana la más larga'));
      // Temporizador
      timerWrap = mk('div', 'hud-timer');
      timerWrap.setAttribute('data-phase', 'calm');
      const ring = svgEl('svg', { 'class': 'hud-timer-ring', viewBox: '0 0 64 64', 'aria-hidden': 'true', focusable: 'false' });
      ring.appendChild(svgEl('circle', { 'class': 'hud-timer-track', cx: '32', cy: '32', r: '26', fill: 'none', stroke: 'rgba(255,255,255,0.08)', 'stroke-width': '4' }));
      // Los cilios giran por CSS (bio-spin); el anillo lo rota -90° el CSS del svg.
      ringCilia = svgEl('circle', { 'class': 'hud-timer-cilia', cx: '32', cy: '32', r: '29', fill: 'none', stroke: 'currentColor', 'stroke-width': '1', 'stroke-dasharray': '2 6', opacity: '0.5' });
      ring.appendChild(ringCilia);
      ringProg = svgEl('circle', {
        'class': 'hud-timer-progress', cx: '32', cy: '32', r: '26', fill: 'none', stroke: 'currentColor', 'stroke-width': '4',
        'stroke-linecap': 'round', 'stroke-dasharray': String(CIRC)
      });
      ringProg.style.strokeDasharray = String(CIRC);
      ringProg.style.strokeDashoffset = '0';
      ring.appendChild(ringProg);
      timerVal = mk('span', 'hud-timer-value', '2:00');
      timerVal.setAttribute('aria-label', '2 minutos');
      timerWrap.appendChild(ring); timerWrap.appendChild(timerVal);
      // Estado
      statusWrap = mk('div', 'hud-status');
      EFFECT_CHIPS.forEach(function (def) {
        const el = mk('span', 'hud-shield hidden');
        el.setAttribute('data-effect', def.type);
        el.setAttribute('data-reveal', '');
        el.appendChild(icon(def.icon, 'hud-shield-icon', 18));
        el.appendChild(mk('span', 'hud-shield-label', def.label));   // en la columna angosta del celular horizontal se oculta a la vista
        const time = mk('b', 'hud-shield-time', '');
        const meter = mk('i', 'hud-shield-bar');
        meter.setAttribute('aria-hidden', 'true');
        meter.style.setProperty('--p', '1');
        el.appendChild(time); el.appendChild(meter);
        chips.push({ type: def.type, el: el, time: time, bar: meter, active: false, until: 0, total: 0, txt: '' });
      });
      specEl = mk('span', 'hud-spectator hidden');
      specEl.appendChild(icon('eye', 'hud-spectator-icon', 18));
      specEl.appendChild(doc.createTextNode('Espectador'));
      selfEl = mk('span', 'hud-mine hidden');
      selfDot = mk('i', 'hud-dot'); selfDot.setAttribute('aria-hidden', 'true');
      selfScore = mk('b', 'hud-mine-score', '');
      selfEl.appendChild(selfDot); selfEl.appendChild(selfScore);
      chips.forEach(function (ch) { statusWrap.appendChild(ch.el); });
      statusWrap.appendChild(specEl); statusWrap.appendChild(selfEl);

      bar.appendChild(rw); bar.appendChild(timerWrap); bar.appendChild(statusWrap);
      bar.classList.add('hidden'); side.classList.add('hidden');
      return true;
    }

    // 125 -> "2:05"; menos de un minuto, solo los segundos
    function clockText(t) {
      if (t < 60) return String(t);
      const r = t % 60;
      return Math.floor(t / 60) + ':' + (r < 10 ? '0' : '') + r;
    }
    function clockLabel(t) {
      const m = Math.floor(t / 60), r = t % 60, parts = [];
      if (m) parts.push(m + plural(m, ' minuto', ' minutos'));
      if (r || !m) parts.push(r + plural(r, ' segundo', ' segundos'));
      return parts.join(' y ');
    }

    function phaseOf(t, playing) {
      if (!playing) return 'calm';
      if (t <= 10) return 'tension';
      if (t <= 20) return 'warn';
      return 'calm';
    }

    function update(d) {
      if (!d || !build()) return;
      const playing = !!d.playing;
      const spectating = !!d.spectating;
      const rt = Math.max(1, +d.roundTime || 120);
      const t = Math.max(0, Math.round(+d.timeLeft >= 0 ? +d.timeLeft : rt));
      const players = Array.isArray(d.players) ? d.players : [];

      // Temporizador
      if (t !== L.time || rt !== L.rt) {
        timerVal.textContent = clockText(t);
        timerVal.setAttribute('aria-label', clockLabel(t));
        ringProg.style.strokeDashoffset = (CIRC * (1 - clamp(t / rt, 0, 1))).toFixed(2);
        L.time = t; L.rt = rt;
      }
      const phase = phaseOf(t, playing);
      if (phase !== L.phase) {
        timerWrap.setAttribute('data-phase', phase);
        const ar = arenaEl();
        if (ar) ar.setAttribute('data-phase', phase);
        L.phase = phase;
      }
      const fin3 = playing && t <= 3;
      if (fin3 !== L.final3) {
        timerWrap.classList.toggle('is-final', fin3);
        if (fin3) timerWrap.setAttribute('data-final', 'true'); else timerWrap.removeAttribute('data-final');
        L.final3 = fin3;
      }

      // Estado propio
      let me = null;
      for (let i = 0; i < players.length; i++) if (players[i] && players[i].isMe) { me = players[i]; break; }
      const fx = (me && !spectating && playing && me.effects) || null;
      for (let i = 0; i < chips.length; i++) {
        const ch = chips[i];
        const until = fx ? +fx[ch.type] || 0 : 0;
        if ((until > 0) !== ch.active) setChip(ch, until > 0, until);
        else if (ch.active && Math.abs(until - ch.until) > 250 && Math.abs(until - Date.now()) <= 30000) {
          // renovado: el tiempo vuelve a empezar
          ch.until = until; ch.total = Math.max(ch.total, until - Date.now()); ch.txt = '';
        }
      }
      if (spectating !== L.spec) { specEl.classList.toggle('hidden', !spectating); L.spec = spectating; }
      const selfTxt = (me && !spectating) ? String(me.score | 0) : '';
      if (selfTxt !== L.self) { selfScore.textContent = selfTxt; L.self = selfTxt; }
      selfEl.classList.toggle('hidden', !selfTxt);
      if (me) { const sc = bio(me.color).body; if (sc !== L.selfC) { selfEl.style.setProperty('--c', sc); L.selfC = sc; } }

      // Marcador: siempre el largo
      L.playing = playing;
      updateBoard(players, playing);
    }

    // ---------- efectos propios (escudo, boca grande, abanico)
    function fmtSec(ms) { return (Math.max(0, ms) / 1000).toFixed(1).replace('.', ',') + ' s'; }
    function setChip(ch, on, until) {
      ch.active = on;
      if (on) {
        ch.until = until;
        if (ch.until && Math.abs(ch.until - Date.now()) > 30000) ch.until = 0; // reloj desfasado: sin tiempo
        ch.total = ch.until ? Math.max(500, ch.until - Date.now()) : 0;
        ch.txt = '';
        cancelMine(ch.el);
        ch.el.classList.remove('hidden');   // la entrada (bio-reveal) y el latido del icono son CSS
        if (!chipRaf) tickChips();
      } else {
        if (ch.el.classList.contains('hidden')) return;
        const a = reduced ? null : anim(ch.el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.9)' }], { duration: M.quick, easing: M.in, fill: 'forwards' });
        done(a).then(function () { if (!ch.active) { ch.el.classList.add('hidden'); cancelAnim(a); } });
      }
    }
    function tickChips() {
      chipRaf = 0;
      let any = false;
      for (let i = 0; i < chips.length; i++) {
        const ch = chips[i];
        if (!ch.active) continue;
        any = true;
        if (ch.until) {
          const rem = ch.until - Date.now();
          const txt = fmtSec(rem);
          if (txt !== ch.txt) {
            ch.time.textContent = txt; ch.txt = txt;
            ch.bar.style.setProperty('--p', ch.total > 0 ? clamp(rem / ch.total, 0, 1).toFixed(3) : '1');
          }
        } else if (ch.txt === '') {
          ch.time.textContent = ''; ch.txt = ' ';
          ch.bar.style.setProperty('--p', '1');
        }
      }
      if (any) chipRaf = global.requestAnimationFrame(tickChips);
    }

    // ---------- marcador
    function makeRow(id) {
      const li = mk('li', 'hud-row');
      li.setAttribute('data-id', id);
      const r = {
        id: id, li: li, rank: mk('span', 'hud-rank'), dot: mk('i', 'hud-dot'), name: mk('span', 'hud-name'),
        me: mk('span', 'hud-me-tag hidden', 'Tú'), imm: icon('jelly', 'hud-immune-icon hidden', 14),
        score: mk('span', 'hud-score'), len: mk('i', 'hud-len'),
        idx: 9999, v: { name: null, color: null, rank: null, isMe: null, immune: null, out: null, score: null, w: null }
      };
      r.dot.setAttribute('aria-hidden', 'true');
      r.len.setAttribute('aria-hidden', 'true');
      li.appendChild(r.rank); li.appendChild(r.dot); li.appendChild(r.name); li.appendChild(r.me);
      li.appendChild(r.imm); li.appendChild(r.score); li.appendChild(r.len);
      return r;
    }
    function metricOf(p) { return +p.score || 0; }
    function cmp(a, b) {
      const d = metricOf(b) - metricOf(a);
      if (d) return d;
      const ra = rows.get(String(a.id)), rb = rows.get(String(b.id));
      const ia = ra ? ra.idx : 9999, ib = rb ? rb.idx : 9999;
      if (ia !== ib) return ia - ib;
      return String(a.name || '').localeCompare(String(b.name || ''));
    }

    const seen = new Set();
    function updateBoard(players, playing) {
      sortTotal = !playing;
      ents.length = 0;
      for (let i = 0; i < players.length; i++) if (players[i] && players[i].id != null) ents.push(players[i]);
      ents.sort(cmp);
      const n = ents.length;
      const lead = n ? Math.max(1, metricOf(ents[0])) : 1;

      // ids visibles (más de 8: los 7 primeros más el propio)
      let meIdx = -1;
      for (let i = 0; i < n; i++) if (ents[i].isMe) { meIdx = i; break; }
      const limit = n > 8 ? (meIdx >= 7 ? 7 : 8) : n;
      const showGap = n > 8 && meIdx >= 7;

      seen.clear();
      let changed = false;
      const visIds = [];
      for (let i = 0; i < n; i++) {
        const p = ents[i], id = String(p.id);
        seen.add(id);
        let r = rows.get(id);
        if (!r) { r = makeRow(id); rows.set(id, r); changed = true; }
        const visible = i < limit || (showGap && i === meIdx);
        r.newIdx = i;
        if (visible) visIds.push(id);
        fillRow(r, p, i + 1, lead);
      }
      // filas de jugadores que se fueron
      rows.forEach(function (r, id) {
        if (!seen.has(id)) { if (r.li.parentNode) r.li.parentNode.removeChild(r.li); rows.delete(id); changed = true; }
      });
      if (!changed) {
        if (visIds.length !== order.length) changed = true;
        else for (let i = 0; i < visIds.length; i++) if (visIds[i] !== order[i]) { changed = true; break; }
      }
      if (changed || (showGap !== !!(gapLi && gapLi.isConnected))) reorder(visIds, showGap);
      for (let i = 0; i < n; i++) { const rr = rows.get(String(ents[i].id)); if (rr) rr.idx = rr.newIdx; }
      ents.length = 0;
    }

    function fillRow(r, p, rank, lead) {
      const v = r.v;
      const name = String(p.name == null ? '' : p.name);
      if (name !== v.name) { r.name.textContent = truncate(name, 12); r.li.title = name; v.name = name; }
      const col = p.color || '';
      if (col !== v.color) {
        const b = bio(col);
        r.li.style.setProperty('--c', b.body);
        r.li.style.setProperty('--t', b.text);
        v.color = col; r.body = b.body;
      }
      const rk = String(rank);
      if (rk !== v.rank) { r.rank.textContent = rk; v.rank = rk; }
      const isMe = !!p.isMe;
      if (isMe !== v.isMe) { r.li.classList.toggle('is-me', isMe); r.me.classList.toggle('hidden', !isMe); v.isMe = isMe; }
      const imm = !!p.immune;
      if (imm !== v.immune) { r.li.classList.toggle('is-immune', imm); r.imm.classList.toggle('hidden', !imm); v.immune = imm; }
      const out = !!p.gameover && !sortTotal;
      if (out !== v.out) { r.li.classList.toggle('is-out', out); v.out = out; }
      const sc = String(metricOf(p) | 0);
      if (sc !== v.score) { r.score.textContent = sc; v.score = sc; }
      const ws = (Math.round(clamp(metricOf(p) / lead, 0, 1) * 100) / 100).toString();
      if (ws !== v.w) { r.li.style.setProperty('--w', ws); v.w = ws; }
    }

    function markUp(row) {
      clearTimeout(row.upTimer);
      row.li.classList.add('is-up');
      row.upTimer = setTimeout(function () { row.li.classList.remove('is-up'); }, 400);
    }
    function makeGap() {
      const li = mk('li', 'hud-gap');
      li.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 3; i++) {
        const d = mk('i');
        d.style.cssText = 'display:block;width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.6';
        li.appendChild(d);
      }
      return li;
    }

    function reorder(visIds, showGap) {
      const animate = shown && !reduced;
      let firsts = null;
      if (animate) {
        firsts = new Map();
        for (let i = 0; i < order.length; i++) {
          const r0 = rows.get(order[i]);
          if (r0 && r0.li.isConnected) firsts.set(order[i], r0.li.getBoundingClientRect().top);
        }
      }
      // reconstruir el orden reutilizando los mismos <li>
      const keep = new Set(visIds);
      for (let i = 0; i < order.length; i++) {
        if (!keep.has(order[i])) { const ro = rows.get(order[i]); if (ro && ro.li.parentNode) ro.li.parentNode.removeChild(ro.li); }
      }
      if (gapLi && gapLi.parentNode && !showGap) gapLi.parentNode.removeChild(gapLi);
      for (let i = 0; i < visIds.length; i++) {
        const r = rows.get(visIds[i]);
        if (showGap && i === visIds.length - 1) {
          if (!gapLi) gapLi = makeGap();
          board.appendChild(gapLi);
        }
        board.appendChild(r.li);
      }
      const prevOrder = order;
      order = visIds;
      if (!animate) return;
      for (let i = 0; i < visIds.length; i++) {
        const id = visIds[i], row = rows.get(id);
        if (!firsts.has(id)) {
          anim(row.li, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: M.base, easing: M.out });
          continue;
        }
        cancelMine(row.li);
        const dy = firsts.get(id) - row.li.getBoundingClientRect().top;
        if (Math.abs(dy) < 0.5) continue;
        anim(row.li, [{ transform: 'translateY(' + dy + 'px)' }, { transform: 'none' }], { duration: 280, easing: M.std });
        const oldPos = prevOrder.indexOf(id);
        if (oldPos > i) markUp(row);
      }
    }

    // ---------- mostrar / ocultar
    function reveal() {
      if (shown || !build()) return;
      shown = true;
      clearTimeout(hideTimer);
      cancelMine(bar); cancelMine(side);
      bar.classList.remove('hidden'); side.classList.remove('hidden');
      if (!reduced) {
        const bb = baseTf(bar);
        anim(bar, [{ opacity: 0, transform: tf(bb, 'translateY(-16px)') }, { opacity: 1, transform: tf(bb, 'none') }], { duration: M.panel, easing: M.out });
        anim(side, [{ opacity: 0 }, { opacity: 1 }], { duration: M.panel, easing: M.out });
        const lis = board.children;
        for (let i = 0; i < lis.length; i++) {
          anim(lis[i], [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
            { duration: M.panel, delay: 80 + Math.min(i, 8) * M.stagger, easing: M.out, fill: 'backwards' });
        }
      } else {
        anim(bar, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
        anim(side, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      }
    }
    function show() {
      want = true;
      if (!build()) return;
      const ar = arenaEl();
      if (ar && ar.getAttribute('data-mode') && ar.getAttribute('data-mode') !== 'game') return; // Scenes lo revela al cambiar de modo
      reveal();
    }
    function hide(immediate) {
      want = false;
      if (!built || !shown) return;
      shown = false;
      const ar = arenaEl();
      if (ar) ar.setAttribute('data-phase', 'calm');
      L.phase = '';
      cancelMine(bar); cancelMine(side);
      if (immediate || reduced) { bar.classList.add('hidden'); side.classList.add('hidden'); return; }
      const a = anim(bar, [{ opacity: 1 }, { opacity: 0 }], { duration: M.quick, easing: M.in, fill: 'forwards' });
      anim(side, [{ opacity: 1 }, { opacity: 0 }], { duration: M.quick, easing: M.in, fill: 'forwards' });
      done(a).then(function () {
        if (shown) return;
        bar.classList.add('hidden'); side.classList.add('hidden');
        cancelMine(bar); cancelMine(side);
      });
    }
    function modeChanged(mode) {
      if (mode === 'game' && want) reveal();
    }
    function reset() {
      if (!built) return;
      rows.forEach(function (r) { if (r.li.parentNode) r.li.parentNode.removeChild(r.li); });
      rows.clear(); order = [];
      if (gapLi && gapLi.parentNode) gapLi.parentNode.removeChild(gapLi);
      L.time = -1; L.phase = ''; L.playing = null;
      chips.forEach(function (ch) { if (ch.active) setChip(ch, false, 0); });
    }

    return {
      update: update, show: show, hide: hide, reset: reset,
      _build: build, _modeChanged: modeChanged, _wanted: function () { return want; }, _shown: function () { return shown; }
    };
  })();

  // =========================================================================================
  // OVERLAYS
  // =========================================================================================
  const Overlays = (function () {
    const COLORS_BY_N = { 3: '#1FF2D2', 2: '#4FD8FF', 1: '#C8FF3C' };
    const st = {
      cdToken: 0, goToken: 0,
      finalTimer: 0, finalData: null, finalGlow: null, finalAnims: [], modal: null, modalOpener: null,
      modalObs: null, modalKey: null, modalClick: null
    };

    function ensureCountdownParts(o) {
      let k = qs(o, '.overlay-kicker'), ring = qs(o, '.countdown-ring'), num = qs(o, '.countdown-number:not([data-bio-clone])');
      if (!k) { k = mk('p', 'overlay-kicker'); o.appendChild(k); }
      if (!ring) { ring = mk('span', 'countdown-ring'); ring.setAttribute('aria-hidden', 'true'); o.appendChild(ring); }
      if (!num) { num = mk('span', 'countdown-number'); o.appendChild(num); }
      // Respaldo de estilo si LAYOUT no posiciona el anillo
      try {
        const cs = global.getComputedStyle(ring);
        if (cs.position === 'static' && cs.borderStyle === 'none') {
          ring.style.cssText += ';position:absolute;left:50%;top:50%;width:50cqh;height:50cqh;margin:-25cqh 0 0 -25cqh;border:2px solid currentColor;border-radius:50%;opacity:0;pointer-events:none';
        }
      } catch (e) { /* nada */ }
      return { k: k, ring: ring, num: num };
    }
    function ensureRoundParts(o) {
      let k = qs(o, '.overlay-kicker'), g = qs(o, '.round-go');
      if (!k) { k = mk('p', 'overlay-kicker'); o.appendChild(k); }
      if (!g) { g = mk('p', 'round-go'); o.appendChild(g); }
      return { k: k, g: g };
    }

    // ---------- 3, 2, 1
    // La meta de la partida, en la cuenta regresiva y en el "¡Ya!"
    const GOAL_TEXT = 'Gana la serpiente más larga';

    function countdown(n) {
      n = parseInt(n, 10);
      if (!(n > 0)) return;
      const o = $('overlay-countdown');
      if (!o) return;
      hideRoundGo(true);
      const parts = ensureCountdownParts(o);
      const token = ++st.cdToken;
      if (o.classList.contains('hidden') || o.__bioHiding) {
        o.__bioHiding = false;
        cancelMine(o);
        o.classList.remove('hidden');
        anim(o, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: M.out });
      }
      parts.k.textContent = GOAL_TEXT;
      const color = COLORS_BY_N[n] || '#1FF2D2';
      const num = parts.num;
      let prevCd = '';
      try { prevCd = global.getComputedStyle(num).getPropertyValue('--cd').trim() || global.getComputedStyle(num).color; } catch (e) { prevCd = ''; }

      // El número anterior sale a la vez que entra el nuevo
      if (num.textContent && !reduced) {
        cancelMine(num);
        const clone = num.cloneNode(true);
        clone.removeAttribute('id');
        clone.setAttribute('aria-hidden', 'true');
        clone.setAttribute('data-bio-clone', '');
        clone.style.position = 'absolute';
        clone.style.left = num.offsetLeft + 'px';
        clone.style.top = num.offsetTop + 'px';
        clone.style.width = num.offsetWidth + 'px';
        clone.style.height = num.offsetHeight + 'px';
        clone.style.right = 'auto'; clone.style.bottom = 'auto';
        clone.style.margin = '0';
        clone.style.pointerEvents = 'none';
        if (prevCd) { clone.style.setProperty('--cd', prevCd); clone.style.color = prevCd; }
        num.parentNode.insertBefore(clone, num.nextSibling);
        const cb = baseTf(clone);
        const ca = anim(clone, [
          { opacity: 1, transform: tf(cb, 'scale(1)'), filter: 'blur(0px)' },
          { opacity: 0, transform: tf(cb, 'scale(0.7)'), filter: 'blur(8px)' }
        ], { duration: 260, easing: M.in, fill: 'forwards' });
        done(ca).then(function () { if (clone.parentNode) clone.parentNode.removeChild(clone); });
      }
      cancelMine(num);
      num.textContent = String(n);
      num.setAttribute('data-n', String(n));
      o.setAttribute('data-count', String(n));
      num.style.setProperty('--cd', color);
      const nb = baseTf(num);
      if (reduced) anim(num, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      else anim(num, [
        { opacity: 0, transform: tf(nb, 'scale(1.5)'), filter: 'blur(14px)' },
        { opacity: 1, transform: tf(nb, 'scale(1)'), filter: 'blur(0px)' }
      ], { duration: 480, easing: M.out });

      const ring = parts.ring;
      cancelMine(ring);
      ring.style.color = color;
      if (!reduced) {
        const rb = baseTf(ring);
        anim(ring, [
          { opacity: 0.6, transform: tf(rb, 'scale(0.4)') },
          { opacity: 0, transform: tf(rb, 'scale(1.6)') }
        ], { duration: 900, easing: M.out, fill: 'forwards' });
      }
      bdPulse('#1FF2D2', 0.2);
      return token;
    }

    function hideCountdown(fast) {
      const o = $('overlay-countdown');
      if (!o || o.classList.contains('hidden')) return Promise.resolve();
      const token = ++st.cdToken;
      const num = qs(o, '.countdown-number:not([data-bio-clone])');
      if (num && !fast && !reduced) {
        cancelMine(num);
        const nb = baseTf(num);
        anim(num, [
          { opacity: 1, transform: tf(nb, 'scale(1)'), filter: 'blur(0px)' },
          { opacity: 0, transform: tf(nb, 'scale(0.7)'), filter: 'blur(8px)' }
        ], { duration: 260, easing: M.in, fill: 'forwards' });
      }
      o.__bioHiding = true;
      const a = anim(o, [{ opacity: 1 }, { opacity: 0 }], { duration: fast ? 160 : 400, easing: M.in, fill: 'forwards' });
      return done(a).then(function () {
        if (token !== st.cdToken) return;
        o.__bioHiding = false;
        o.classList.add('hidden');
        cancelMine(o, true);
        if (num) num.textContent = '';
        qsa(o, '[data-bio-clone]').forEach(function (c) { if (c !== num && c.parentNode) c.parentNode.removeChild(c); });
      });
    }

    // ---------- ¡Ya!
    function roundStart() {
      hideCountdown(false);
      const o = $('overlay-round');
      bdPulse('#C8FF3C', 0.35);
      if (!o) return;
      const parts = ensureRoundParts(o);
      const token = ++st.goToken;
      cancelMine(o, true);
      parts.k.textContent = GOAL_TEXT;
      parts.g.textContent = '¡Ya!';
      o.classList.remove('hidden');
      let a;
      if (reduced) {
        a = anim(o, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: 1180, easing: 'linear', fill: 'forwards' });
      } else {
        const gb = baseTf(parts.g);
        a = anim(parts.g, [
          { opacity: 0, transform: tf(gb, 'scale(0.8)'), filter: 'blur(0px)', offset: 0, easing: M.jelly },
          { opacity: 1, transform: tf(gb, 'scale(1)'), filter: 'blur(0px)', offset: 420 / 1180 },
          { opacity: 1, transform: tf(gb, 'scale(1)'), filter: 'blur(0px)', offset: 800 / 1180, easing: M.in },
          { opacity: 0, transform: tf(gb, 'scale(1.15)'), filter: 'blur(10px)', offset: 1 }
        ], { duration: 1180, fill: 'forwards' });
        anim(parts.k, [
          { opacity: 0, transform: 'translateY(6px)', offset: 0 },
          { opacity: 1, transform: 'none', offset: 0.25 },
          { opacity: 1, transform: 'none', offset: 0.68 },
          { opacity: 0, transform: 'translateY(-6px)', offset: 1 }
        ], { duration: 1180, easing: 'ease-out', fill: 'forwards' });
      }
      done(a).then(function () {
        if (token !== st.goToken) return;
        o.classList.add('hidden');
        cancelMine(o, true);
      });
    }
    function hideRoundGo(fast) {
      const o = $('overlay-round');
      if (!o || o.classList.contains('hidden')) return;
      st.goToken++;
      cancelMine(o, true);
      o.classList.add('hidden');
    }

    // ---------- Final
    // Gana la serpiente más larga; si empatan, ganan todas las empatadas (título "Empate").
    function final(data) {
      data = data || {};
      clearTimeout(st.finalTimer); st.finalTimer = 0;
      const reason = data.reason ? String(data.reason) : '';
      const winIds = {};
      (Array.isArray(data.winners) ? data.winners : []).forEach(function (id) { winIds[String(id)] = true; });
      const list = (Array.isArray(data.ranking) ? data.ranking : []).map(function (e) {
        e = e || {};
        return { id: String(e.id), name: e.name == null ? '' : String(e.name), color: e.color || '', length: +e.length || 0, winner: !!winIds[String(e.id)] };
      });
      const winners = list.filter(function (e) { return e.winner; });
      const winner = winners.length === 1 ? winners[0] : null;
      const champ = winner ? bio(winner.color) : BIO_DEFAULT;
      st.finalData = { reason: reason, list: list, winner: winner, winners: winners, champ: champ };
      fillFinal(st.finalData);
      hideCountdown(true);
      hideRoundGo(true);
      if (current === 'final') { playFinal(); return; }
      go('final', { color: winner ? champ.body : null, reason: reason || null });
    }

    function fillFinal(fd) {
      const title = $('finalTitle'), msg = $('finalMessage'), ol = $('finalScoresList'), fs = $('finalScreen');
      stopFinal();
      if (fs) {
        if (fd.reason) fs.setAttribute('data-reason', ''); else fs.removeAttribute('data-reason');
        if (fd.reason || !fd.winner) fs.style.removeProperty('--champion');
        else fs.style.setProperty('--champion', fd.champ.body);
      }
      const best = fd.winners.length ? fd.winners[0].length : 0;
      if (title) {
        title.replaceChildren();
        title.removeAttribute('aria-label');
        if (fd.reason || !fd.winner) {
          title.textContent = fd.reason ? 'Sala cerrada' : (fd.winners.length > 1 ? 'Empate' : 'Partida terminada');
          title.classList.toggle('is-closed', !!fd.reason);
          title.removeAttribute('data-champion');
        } else {
          const name = fd.winner.name;
          title.classList.remove('is-closed');
          title.setAttribute('aria-label', name);
          title.setAttribute('data-champion', '');
          // theme.css achica el título según el largo: un nombre largo sin espacios no se parte a mitad de palabra
          title.style.setProperty('--name-len', String(Math.max(6, (Array.from ? Array.from(name) : name.split('')).length)));
          appendLetters(title, name, true);
        }
      }
      if (msg) {
        if (fd.reason) msg.textContent = fd.reason;
        else if (fd.winner) msg.textContent = 'Gana con la serpiente más larga: ' + best + plural(best, ' segmento', ' segmentos') + '.';
        else if (fd.winners.length > 1) {
          const names = fd.winners.map(function (w) { return w.name; });
          msg.textContent = names.slice(0, -1).join(', ') + ' y ' + names[names.length - 1] + ' terminan con ' + best + plural(best, ' segmento', ' segmentos') + '.';
        } else msg.textContent = '';
      }
      if (ol) {
        ol.replaceChildren();
        for (let i = 0; i < fd.list.length; i++) {
          const it = fd.list[i];
          const li = mk('li', 'final-score-item' + (it.winner && !fd.reason ? ' is-champion' : ''));
          if (it.color) { const cb3 = bio(it.color); li.style.setProperty('--c', cb3.body); li.style.setProperty('--t', cb3.text); }
          else li.style.setProperty('--c', '#7397A5');
          const dot = mk('i', 'final-dot'); dot.setAttribute('aria-hidden', 'true');
          li.appendChild(mk('span', 'final-rank', String(i + 1)));
          li.appendChild(dot);
          const nm = mk('span', 'final-name', it.name); nm.title = it.name;
          li.appendChild(nm);
          li.appendChild(mk('span', 'final-total', it.length + plural(it.length, ' segmento', ' segmentos')));
          ol.appendChild(li);
        }
      }
    }
    function appendLetters(target, name, real) {
      const chars = Array.from ? Array.from(name) : name.split('');
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i];
        if (/\s/.test(ch)) { target.appendChild(doc.createTextNode(' ')); continue; }
        const s = mk('span', 'final-letter', ch);
        s.style.display = 'inline-block';
        if (real) s.setAttribute('aria-hidden', 'true');
        target.appendChild(s);
      }
    }

    function stopFinal() {
      for (let i = 0; i < st.finalAnims.length; i++) cancelAnim(st.finalAnims[i]);
      st.finalAnims.length = 0;
      if (st.finalGlow && st.finalGlow.parentNode) st.finalGlow.parentNode.removeChild(st.finalGlow);
      st.finalGlow = null;
    }

    // Coreografía del final; la llama Scenes al mostrar #finalScreen.
    function playFinal() {
      const fs = $('finalScreen');
      if (!fs) return;
      const fd = st.finalData || { reason: '', list: [], winner: null, winners: [], champ: BIO_DEFAULT };
      const title = $('finalTitle'), msg = $('finalMessage'), ol = $('finalScoresList'), back = qs(fs, '.final-actions');
      const hint = $('finalHint');
      const head = qs(fs, '.final-scores');
      const A = st.finalAnims;
      const push = function (a) { if (a) A.push(a); return a; };
      if (reduced) {
        [title, msg, head, ol, hint, back].forEach(function (n, i) { if (n) push(anim(n, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: i * 80, fill: 'backwards' })); });
        focusLater(title || back, 600);
        return;
      }
      const letters = title ? qsa(title, '.final-letter') : [];
      if (letters.length) {
        for (let i = 0; i < letters.length; i++) {
          push(anim(letters[i], [
            { opacity: 0, transform: 'translateY(30px)', filter: 'blur(10px)' },
            { opacity: 1, transform: 'none', filter: 'blur(0px)' }
          ], { duration: 700, delay: 300 + i * 40, easing: M.out, fill: 'backwards' }));
        }
        const lettersEnd = 300 + (letters.length - 1) * 40 + 700;
        const gl = setTimeout(function () { startGlow(title, fd); }, lettersEnd);
        A.push({ cancel: function () { clearTimeout(gl); } });
      } else if (title) {
        push(anim(title, [{ opacity: 0, transform: 'translateY(16px)', filter: 'blur(8px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }],
          { duration: 700, delay: 300, easing: M.out, fill: 'backwards' }));
      }
      if (msg) push(anim(msg, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 900, easing: M.out, fill: 'backwards' }));
      if (head) push(anim(head, [{ opacity: 0, transform: 'translateY(16px)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { duration: 560, delay: 1050, easing: M.out, fill: 'backwards' }));
      if (ol) {
        const items = qsa(ol, '.final-score-item');
        for (let k = 0; k < items.length; k++) {
          push(anim(items[k], [{ opacity: 0, transform: 'translateY(20px)' }, { opacity: 1, transform: 'none' }],
            { duration: 560, delay: 1250 + Math.min(k, 8) * 90, easing: M.out, fill: 'backwards' }));
        }
      }
      if (hint) push(anim(hint, [{ opacity: 0 }, { opacity: 1 }], { duration: 520, delay: 1700, easing: M.out, fill: 'backwards' }));
      if (back) push(anim(back, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: 1800, easing: M.out, fill: 'backwards' }));
      // El foco va al título (tabindex=-1), no a los botones.
      // Espacio es la tecla de disparo: con el botón enfocado, quien seguía disparando al terminar
      // la partida salía del final sin querer (y en el lobby creaba una sala). Tab llega al botón.
      focusLater(title || back, 1900);
    }
    function focusLater(node, ms) {
      if (!node) return;
      const t = setTimeout(function () {
        if (current !== 'final') return;
        try { node.focus({ preventScroll: true }); } catch (e) { /* nada */ }
      }, ms);
      st.finalAnims.push({ cancel: function () { clearTimeout(t); } });
    }
    function startGlow(title, fd) {
      if (!title || !title.isConnected || reduced || !fd.winner) return;
      if (global.getComputedStyle(title).position === 'static') title.style.position = 'relative';
      const g = mk('span', 'final-title-glow');
      g.setAttribute('aria-hidden', 'true');
      g.style.cssText = 'position:absolute;inset:0;pointer-events:none;color:transparent;-webkit-text-fill-color:transparent;' +
        'text-shadow:0 0 24px ' + alpha(fd.champ.body, 0.55) + ', 0 0 64px ' + alpha(fd.champ.body, 0.35) + ';background:none';
      appendLetters(g, fd.winner.name, false);
      title.appendChild(g);
      st.finalGlow = g;
      st.finalAnims.push(anim(g, [{ opacity: 0.25 }, { opacity: 1 }], { duration: M.breath, direction: 'alternate', iterations: Infinity, easing: M.inOut }));
    }

    function hideFinalScreen(animated) {
      const fs = $('finalScreen');
      if (!fs || fs.classList.contains('hidden')) return Promise.resolve();
      if (!animated || reduced) { stopFinal(); fs.classList.add('hidden'); cancelMine(fs); return Promise.resolve(); }
      const a = anim(fs, [{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(6px)' }], { duration: M.sceneOut, easing: M.in, fill: 'forwards' });
      return done(a).then(function () { stopFinal(); fs.classList.add('hidden'); cancelAnim(a); });
    }

    function hideArenaOverlays() {
      hideCountdown(true);
      hideRoundGo(true);
    }

    function hideAll() {
      clearTimeout(st.finalTimer); st.finalTimer = 0;
      hideArenaOverlays(false);
      if (current !== 'final') hideFinalScreen(true);
    }

    // ---------- Modales (.modal)
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    function focusables(root) {
      return qsa(root, FOCUSABLE).filter(function (n) { return isShown(n); });
    }
    function open(node) {
      if (typeof node === 'string') node = $(node);
      if (!node) return;
      if (st.modal === node && !node.__bioClosing) return;
      if (st.modal && st.modal !== node) close(st.modal, true);
      node.__bioClosing = false;
      st.modal = node;
      st.modalOpener = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
      Chrome.closeProfile(true);
      cancelMine(node, true);
      node.classList.remove('hidden');
      if (!node.getAttribute('role')) node.setAttribute('role', 'dialog');
      node.setAttribute('aria-modal', 'true');
      const card = qs(node, '.modal-content') || node;
      if (reduced) anim(node, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      else {
        anim(node, [{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: M.out });
        if (card !== node) {
          const cb = baseTf(card);
          anim(card, [
            { opacity: 0, transform: tf(cb, 'translateY(16px) scale(0.96)') },
            { opacity: 1, transform: tf(cb, 'none') }
          ], { duration: 420, easing: M.out });
        }
        staggerRows(qsa(card, 'li'), 160);
      }
      // filas que llegan después (el ranking carga por socket)
      if (global.MutationObserver && card) {
        st.modalObs = new MutationObserver(function (muts) {
          if (reduced) return;
          const added = [];
          muts.forEach(function (m) { for (let i = 0; i < m.addedNodes.length; i++) { const n = m.addedNodes[i]; if (n.nodeType === 1 && n.tagName === 'LI') added.push(n); } });
          staggerRows(added, 0);
        });
        st.modalObs.observe(card, { childList: true, subtree: true });
      }
      st.modalKey = function (e) {
        if (st.modal !== node) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(node); return; }
        if (e.key === 'Tab') {
          const f = focusables(node);
          if (!f.length) { e.preventDefault(); return; }
          const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && (doc.activeElement === first || !node.contains(doc.activeElement))) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && (doc.activeElement === last || !node.contains(doc.activeElement))) { e.preventDefault(); first.focus(); }
        }
      };
      st.modalClick = function (e) {
        if (e.target === node) { close(node); return; }
        const c = e.target && e.target.closest && e.target.closest('[data-close], .modal-close, #closeLeaderboardModal');
        if (c && node.contains(c)) close(node);
      };
      doc.addEventListener('keydown', st.modalKey, true);
      node.addEventListener('click', st.modalClick);
      setTimeout(function () {
        if (st.modal !== node) return;
        const target = qs(node, '#closeLeaderboardModal, [data-autofocus]') || focusables(node)[0];
        if (target) { try { target.focus({ preventScroll: true }); } catch (e) { /* nada */ } }
      }, 30);
    }
    function staggerRows(list, base) {
      for (let i = 0; i < list.length && i < 40; i++) {
        anim(list[i], [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
          { duration: 360, delay: base + Math.min(i, 9) * 40, easing: M.out, fill: 'backwards' });
      }
    }
    function close(node, immediate) {
      if (typeof node === 'string') node = $(node);
      if (!node) node = st.modal;
      if (!node || node.classList.contains('hidden') || node.__bioClosing) return;
      if (st.modal === node) {
        doc.removeEventListener('keydown', st.modalKey, true);
        node.removeEventListener('click', st.modalClick);
        if (st.modalObs) { st.modalObs.disconnect(); st.modalObs = null; }
        st.modal = null;
      }
      const opener = st.modalOpener; st.modalOpener = null;
      const finish = function () {
        node.__bioClosing = false;
        node.classList.add('hidden');
        node.removeAttribute('aria-modal');
        cancelMine(node, true);
        if (opener && opener.isConnected && isShown(opener)) { try { opener.focus({ preventScroll: true }); } catch (e) { /* nada */ } }
      };
      if (immediate || reduced) { finish(); return; }
      node.__bioClosing = true;
      cancelMine(node, true);
      const card = qs(node, '.modal-content');
      const a = anim(node, [{ opacity: 1 }, { opacity: 0 }], { duration: M.quick, easing: M.in, fill: 'forwards' });
      if (card) anim(card, [{ opacity: 1 }, { opacity: 0 }], { duration: M.quick, easing: M.in, fill: 'forwards' });
      done(a).then(function () { if (node.__bioClosing) finish(); });
    }

    function init() {
      ['overlay-countdown', 'overlay-round', 'finalScreen'].forEach(function (id) {
        const n = $(id); if (n) n.classList.add('hidden');
      });
    }

    return {
      countdown: countdown, roundStart: roundStart,
      final: final, hideAll: hideAll, open: open, close: close,
      _init: init, _playFinal: playFinal, _stopFinal: stopFinal, _hideFinalScreen: hideFinalScreen,
      _hideArenaOverlays: hideArenaOverlays, _isModalOpen: function () { return !!st.modal; },
      _hasFinalData: function () { return !!st.finalData; }
    };
  })();

  // =========================================================================================
  // SCENES
  // =========================================================================================
  const ORDER = { intro: 0, login: 1, lobby: 2, room: 3, game: 4, final: 5 };
  const SCENE_ID = { intro: 'scene-intro', login: 'scene-login', lobby: 'scene-lobby', room: 'scene-arena', game: 'scene-arena' };
  let current = null, busy = false, pending = null, enterCbs = {};
  let previousScene = null; // escena desde la que se llegó a la actual (para el foco)
  const intro = { phase: 'idle', variant: null, t0: 0, timers: [], dest: null, greeting: null, userWants: false,
    promise: null, resolve: null, anims: [], maskRaf: 0, autoTimer: 0, title: null, tag: null, prompt: null, breath: [] };

  function sceneEl(name) { return name && SCENE_ID[name] ? $(SCENE_ID[name]) : null; }
  function allScenes() { return ['scene-intro', 'scene-login', 'scene-lobby', 'scene-arena'].map($).filter(Boolean); }
  function setBodyScene(name) { if (doc.body) doc.body.setAttribute('data-scene', name); }
  function setMode(mode) {
    const a = $('scene-arena');
    if (a && a.getAttribute('data-mode') !== mode) {
      // En partida la arena es más grande que en sala (theme.css, sección 18): se anima el cambio
      const stage = a.querySelector('.arena-stage');
      const before = stage && !reduced && isShown(stage) ? stage.getBoundingClientRect() : null;
      a.setAttribute('data-mode', mode);
      // Se mide después del scrollTop() que los que llaman hacen en el mismo turno, antes de pintar
      if (before && before.width > 0) Promise.resolve().then(function () { flipStage(stage, before); });
    }
    HUD._modeChanged(mode);
  }
  // FLIP: la arena arranca donde y como se veía y llega a su lugar nuevo. El canvas ya tiene su
  // tamaño final (ARENA lo rehace por su ResizeObserver); solo se anima el transform.
  function flipStage(stage, before) {
    const after = stage.getBoundingClientRect();
    if (!after.width) return;
    if (global.Arena && global.Arena.resize) callSafe(global.Arena.resize);
    const s = before.width / after.width;
    const dx = before.left - after.left, dy = before.top - after.top;
    if (Math.abs(s - 1) < 0.01 && Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    anim(stage, [
      { transformOrigin: '0 0', transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + s + ')' },
      { transformOrigin: '0 0', transform: 'none' }
    ], { duration: M.panel, easing: M.out });
  }
  function showState(node, state) {
    if (!node) return;
    node.style.removeProperty('display');
    node.setAttribute('data-state', state);
  }
  function hideState(node) {
    if (!node) return;
    node.setAttribute('data-state', 'hidden');
    node.style.display = 'none';
    setInert(node, true);
    node.style.removeProperty('pointer-events');
    node.style.removeProperty('will-change');
  }
  function scrollTop() {
    if (!(global.scrollY > 0)) return;
    try { global.scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch (e) { try { global.scrollTo(0, 0); } catch (e2) { /* nada */ } }
  }
  function willChange(node, on) {
    if (!node) return;
    if (on) node.style.willChange = 'transform, opacity, filter'; else node.style.removeProperty('will-change');
  }
  function moodFor(to, opts) {
    if (to === 'login') bdMood('calm');
    else if (to === 'lobby') bdMood('lobby');
    else if (to === 'room') bdMood('room');
    else if (to === 'game') bdMood('game');
    else if (to === 'final') {
      if (opts && opts.reason) bdMood('lobby');
      else bdMood('celebration', { color: (opts && opts.color) || '#C8FF3C' });
    }
  }

  function visibleChildren(node) {
    const out = [];
    if (!node) return out;
    for (let i = 0; i < node.children.length; i++) {
      const c = node.children[i];
      if (c.classList.contains('hidden') || c.tagName === 'SCRIPT' || c.tagName === 'TEMPLATE') continue;
      out.push(c);
    }
    return out;
  }
  function staggerTargets(scene, exclude) {
    let list = qsa(scene, '[data-stagger]');
    if (!list.length) {
      let kids = visibleChildren(scene);
      if (kids.length === 1) kids = visibleChildren(kids[0]);
      if (kids.length === 1) kids = visibleChildren(kids[0]);
      list = kids;
    }
    return list.filter(function (n) {
      if (n === exclude || (exclude && n.contains(exclude) && n.children.length <= 1)) return false;
      return !n.classList.contains('hidden');
    });
  }
  function staggerIn(scene, baseDelay, exclude) {
    if (reduced) return;
    const list = staggerTargets(scene, exclude);
    for (let i = 0; i < list.length; i++) {
      anim(list[i], [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
        { duration: 560, delay: baseDelay + Math.min(i, 8) * M.stagger, easing: M.out, fill: 'backwards' });
    }
  }
  function enterFrames() {
    return reduced ? [{ opacity: 0 }, { opacity: 1 }] : [
      { opacity: 0, transform: 'translateY(36px) scale(1.015)', filter: 'blur(8px)' },
      { opacity: 1, transform: 'none', filter: 'blur(0px)' }
    ];
  }
  function leaveFrames() {
    return reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
      { opacity: 1, transform: 'none', filter: 'blur(0px)' },
      { opacity: 0, transform: 'translateY(-28px) scale(0.985)', filter: 'blur(6px)' }
    ];
  }

  function focusScene(name) {
    if (name === 'final') return;
    const ae = doc.activeElement;
    if (name === 'game') {
      if (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) { try { ae.blur(); } catch (e) { /* nada */ } }
      return;
    }
    const sc = sceneEl(name);
    if (!sc) return;
    const chromeIds = ['dock', 'topbar', 'toasts', 'leaderboardModal'];
    for (let i = 0; i < chromeIds.length; i++) { const c = $(chromeIds[i]); if (c && ae && c.contains(ae)) return; }
    let t = null;
    if (name === 'login') t = coarse ? null : $('username');
    // Al volver de una sala, partida o final no se enfoca "Crear sala":
    // un Espacio más (la tecla de disparo) crearía una sala sin querer. Se enfoca el encabezado.
    else if (name === 'lobby') t = (previousScene === 'room' || previousScene === 'game' || previousScene === 'final') ? qs(sc, '.scene-title') : $('createRoomButton');
    if (t && (!isShown(t) || !sc.contains(t))) t = null;
    if (!t) {
      t = qs(sc, '[data-autofocus]');
      // en pantallas táctiles no se enfoca un campo de texto: abriría el teclado sin pedirlo
      if (t && (!isShown(t) || (coarse && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) t = null;
    }
    if (!t) {
      t = qsa(sc, 'h1, h2').filter(isShown)[0] || null;
      if (t && !t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
    }
    if (t) { try { t.focus({ preventScroll: true }); } catch (e) { /* nada */ } }
  }
  function afterEnter(name) {
    focusScene(name);
    const list = enterCbs[name];
    if (list) list.slice().forEach(function (fn) { callSafe(fn, name); });
  }

  // ---------- transición estándar: inmersión
  function immerse(from, to, opts) {
    let fromEl = sceneEl(from), toEl = sceneEl(to);
    if (fromEl === toEl) fromEl = null;
    if (to === 'room' || to === 'game') setMode(to);
    const dir = (ORDER[to] || 0) >= (ORDER[from] || 0) ? 1 : -1;
    bdPulse('#1FF2D2', 0.25);
    bdDescend(dir);
    let outA = null, inA = null;
    if (fromEl) {
      setInert(fromEl, true);
      cancelMine(fromEl, true);
      fromEl.setAttribute('data-state', 'leaving');
      fromEl.style.pointerEvents = 'none';
      willChange(fromEl, true);
      outA = anim(fromEl, leaveFrames(), { duration: reduced ? 200 : M.sceneOut, easing: M.in, fill: 'forwards' });
    }
    if (from === 'room' || from === 'game') { if (!(to === 'room' || to === 'game')) HUD.hide(true); }
    if (toEl) {
      cancelMine(toEl, true);
      setInert(toEl, false);
      showState(toEl, 'entering');
      willChange(toEl, true);
      scrollTop();
      inA = anim(toEl, enterFrames(), { duration: reduced ? 200 : M.sceneIn, delay: reduced ? 0 : 180, easing: M.out, fill: 'backwards' });
      staggerIn(toEl, 300, null);
    }
    return Promise.all([done(outA), done(inA)]).then(function () {
      if (fromEl) { hideState(fromEl); cancelMine(fromEl, true); }
      if (toEl) { toEl.setAttribute('data-state', 'active'); willChange(toEl, false); }
      if (to === 'game') HUD.show();
      afterEnter(to);
    });
  }

  // ---------- sala <-> partida en el mismo contenedor
  function modeSwitch(from, to) {
    const toGame = to === 'game';
    const gi = $('gameInterface'), dock = $('dock');
    if (reduced) {
      setMode(to);
      scrollTop();
      if (toGame) HUD.show(); else HUD.hide();
      const a0 = gi ? anim(gi, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 }) : null;
      return done(a0).then(function () { afterEnter(to); });
    }
    if (gi) cancelMine(gi);
    const a1 = gi ? anim(gi, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-12px)' }], { duration: 240, easing: M.in, fill: 'forwards' }) : null;
    if (toGame && dock && isShown(dock)) anim(dock, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(24px)' }], { duration: 360, easing: M.in, fill: 'forwards' });
    if (!toGame) HUD.hide();
    return wait(240).then(function () {
      setMode(to);
      scrollTop();
      if (toGame) HUD.show();
      cancelAnim(a1);
      const a2 = gi ? anim(gi, toGame
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translateX(-12px)' }, { opacity: 1, transform: 'none' }],
        { duration: 400, delay: toGame ? 260 : 0, easing: M.out, fill: 'backwards' }) : null;
      if (!toGame && dock) { cancelMine(dock); anim(dock, [{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'none' }], { duration: M.panel, easing: M.out, fill: 'backwards' }); }
      if (!toGame && gi) staggerIn(gi, 80, null);
      return Promise.all([done(a2), wait(toGame ? 660 : 520)]);
    }).then(function () {
      if (toGame && dock) cancelMine(dock);
      afterEnter(to);
    });
  }

  // ---------- final (encima de la arena)
  function enterFinal(from, opts) {
    const fs = $('finalScreen'), arena = $('scene-arena');
    const fromEl = sceneEl(from);
    if (fromEl && fromEl !== arena) {
      setInert(fromEl, true);
      const o = anim(fromEl, leaveFrames(), { duration: reduced ? 200 : M.sceneOut, easing: M.in, fill: 'forwards' });
      done(o).then(function () { hideState(fromEl); cancelMine(fromEl, true); });
    }
    // la arena (con su HUD) queda debajo del velo, quieta: no se oculta nada para que no salte la grilla
    if (arena && arena.getAttribute('data-state') !== 'hidden') setInert(arena, true);
    Overlays._hideArenaOverlays(false);
    if (!fs) return Promise.resolve().then(function () { afterEnter('final'); });
    cancelMine(fs);
    fs.classList.remove('hidden');
    setInert(fs, false);
    if (!fs.getAttribute('role')) fs.setAttribute('role', 'dialog');
    const a = anim(fs, [{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 300 : 600, easing: M.out });
    if (Overlays._hasFinalData()) Overlays._playFinal();
    return done(a).then(function () { afterEnter('final'); });
  }
  function exitFinal(to, opts) {
    const arena = $('scene-arena');
    const p1 = Overlays._hideFinalScreen(true);
    Overlays._hideArenaOverlays(true);
    if (arena && to !== 'room' && to !== 'game') { HUD.hide(true); hideState(arena); }
    else if (arena) setInert(arena, false);
    const p2 = (to === 'room' || to === 'game') ? Promise.resolve().then(function () { setMode(to); afterEnter(to); }) : immerse(null, to, opts);
    if (to !== 'room' && to !== 'game') bdDescend(-1);
    return Promise.all([p1, p2]);
  }

  // ---------- salida de la intro: el wordmark viaja (FLIP)
  function textRect(node) {
    try {
      const r = doc.createRange();
      r.selectNodeContents(node);
      const rect = r.getBoundingClientRect();
      if (rect && rect.width > 0) return rect;
    } catch (e) { /* nada */ }
    return node.getBoundingClientRect();
  }
  const FLY_PROPS = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variation-settings',
    'font-feature-settings', 'letter-spacing', 'line-height', 'color', 'text-shadow', 'text-align', 'text-transform',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'white-space', 'background-image',
    'background-clip', '-webkit-background-clip', '-webkit-text-fill-color', 'word-spacing'];
  function makeFlyer(src) {
    const cs = global.getComputedStyle(src);
    const box = src.getBoundingClientRect();
    const f = src.cloneNode(true);
    f.removeAttribute('id');
    f.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < FLY_PROPS.length; i++) {
      const v = cs.getPropertyValue(FLY_PROPS[i]);
      if (v) f.style.setProperty(FLY_PROPS[i], v);
    }
    f.style.position = 'fixed';
    f.style.left = box.left + 'px';
    f.style.top = box.top + 'px';
    f.style.width = box.width + 'px';
    f.style.height = box.height + 'px';
    f.style.margin = '0';
    f.style.zIndex = '35';
    f.style.pointerEvents = 'none';
    f.style.maskImage = 'none';
    f.style.webkitMaskImage = 'none';
    f.style.boxSizing = 'border-box';
    f.style.opacity = '1';
    f.style.transform = 'none';
    f.style.filter = 'none';
    f.style.visibility = 'visible';
    f.style.display = cs.display === 'inline' ? 'inline-block' : cs.display;
    f.style.overflow = 'visible';
    return { el: f, box: box };
  }
  function wordmarkTarget(to, toEl) {
    let t = toEl ? qs(toEl, '[data-wordmark-target]') : null;
    if (!t && to === 'login') t = qs(toEl, '.login-wordmark');
    if (!t) t = qs(doc, '#topbar [data-wordmark-target]') || qs(doc, '#topbar .wordmark');
    return t && isShown(t) ? t : null;
  }

  function introExit(to, opts) {
    const sc = $('scene-intro'), toEl = sceneEl(to);
    const title = intro.title;
    stopIntroLoops();
    if (to === 'room' || to === 'game') setMode(to);
    if (!sc || !title || reduced) return immerse('intro', to, opts).then(introDone);

    bdPulse('#1FF2D2', 0.25);
    bdDescend(1);
    // medir destino con la escena entrante visible pero sin transformar
    if (toEl) {
      cancelMine(toEl, true);
      setInert(toEl, false);
      showState(toEl, 'entering');
      toEl.style.opacity = '0';
    }
    const target = wordmarkTarget(to, toEl);
    const srcR = textRect(title), dstR = target ? textRect(target) : null;
    if (toEl) toEl.style.removeProperty('opacity');

    let inA = null;
    if (toEl) {
      willChange(toEl, true);
      inA = anim(toEl, enterFrames(), { duration: M.sceneIn, delay: 180, easing: M.out, fill: 'backwards' });
      staggerIn(toEl, 300, target);
    }
    // el resto de la intro sale con la inmersión
    sc.setAttribute('data-state', 'leaving');
    setInert(sc, true);
    sc.style.pointerEvents = 'none';
    const outs = [];
    visibleChildren(sc).forEach(function (n) {
      if (n === title) return;
      cancelMine(n);
      outs.push(done(anim(n, leaveFrames(), { duration: M.sceneOut, easing: M.in, fill: 'forwards' })));
    });

    let flyP = Promise.resolve(), flyer = null, tgtA = null;
    if (dstR && srcR.width > 0 && dstR.width > 0) {
      const fl = makeFlyer(title);
      flyer = fl.el;
      doc.body.appendChild(flyer);
      cancelMine(title);
      title.style.visibility = 'hidden';
      const s = dstR.width / srcR.width;
      const ox = srcR.left - fl.box.left, oy = srcR.top - fl.box.top;
      flyer.style.transformOrigin = ox + 'px ' + oy + 'px';
      const dx = dstR.left - srcR.left, dy = dstR.top - srcR.top;
      const fa = anim(flyer, [{ transform: 'translate(0px, 0px) scale(1)' }, { transform: 'translate(' + dx + 'px, ' + dy + 'px) scale(' + s + ')' }],
        { duration: 800, easing: M.inOut, fill: 'forwards' });
      anim(flyer, [{ opacity: 1 }, { opacity: 1, offset: 0.75 }, { opacity: 0 }], { duration: 800, easing: 'linear', fill: 'forwards' });
      tgtA = anim(target, [{ opacity: 0 }, { opacity: 0, offset: 0.75 }, { opacity: 1 }], { duration: 800, easing: 'linear', fill: 'both' });
      flyP = done(fa);
    } else {
      cancelMine(title);
      outs.push(done(anim(title, leaveFrames(), { duration: M.sceneOut, easing: M.in, fill: 'forwards' })));
    }

    return Promise.all([done(inA), flyP].concat(outs)).then(function () {
      if (flyer && flyer.parentNode) flyer.parentNode.removeChild(flyer);
      cancelAnim(tgtA);
      title.style.removeProperty('visibility');
      cancelMine(sc, true);
      hideState(sc);
      if (toEl) { toEl.setAttribute('data-state', 'active'); willChange(toEl, false); }
      if (to === 'game') HUD.show();
      introDone();
      afterEnter(to);
    });
  }
  function introDone() {
    intro.phase = 'done';
    intro.breath.forEach(cancelAnim);
    intro.breath.length = 0;
    if (intro.title) clearIntroStyles();
  }

  // ---------- transición genérica
  function runTransition(from, to, opts) {
    previousScene = from;
    Chrome.closeAll(to === 'game' || to === 'final' || to === 'login' || to === 'intro');
    if (Overlays._isModalOpen() && (to === 'game')) Overlays.close();
    setBodyScene(to);
    current = to;
    if (from !== 'intro' || to !== 'intro') moodFor(to, opts);
    if (opts.immediate || from == null) { applyImmediate(to, opts); return Promise.resolve(); }
    if (from === 'intro') return introExit(to, opts);
    if ((from === 'room' && to === 'game') || (from === 'game' && to === 'room')) return modeSwitch(from, to);
    if (to === 'final') return enterFinal(from, opts);
    if (from === 'final') return exitFinal(to, opts);
    return immerse(from, to, opts);
  }
  function applyImmediate(to, opts) {
    const target = sceneEl(to);
    allScenes().forEach(function (n) {
      cancelMine(n, true);
      if (n === target || (to === 'final' && n.id === 'scene-arena' && n.getAttribute('data-state') !== 'hidden')) { showState(n, 'active'); setInert(n, to === 'final'); }
      else hideState(n);
    });
    if (to === 'room' || to === 'game') setMode(to);
    const fs = $('finalScreen');
    if (fs) {
      if (to === 'final') { fs.classList.remove('hidden'); if (Overlays._hasFinalData()) Overlays._playFinal(); }
      else fs.classList.add('hidden');
    }
    if (to === 'game') HUD.show(); else HUD.hide(true);
    setTimeout(function () { afterEnter(to); }, 0);
  }

  function requestTransition(name, opts) {
    if (busy) { pending = { name: name, opts: opts }; return; }
    if (name === current) return;
    busy = true;
    const from = current;
    let p;
    try { p = runTransition(from, name, opts || {}); } catch (e) { if (global.console) console.error(e); p = Promise.resolve(); }
    p.then(finishTransition, function (e) { if (global.console) console.error(e); finishTransition(); });
  }
  function finishTransition() {
    busy = false;
    const p = pending;
    pending = null;
    if (p && p.name !== current) requestTransition(p.name, p.opts);
  }

  function go(name, opts) {
    ensureInit();
    if (!Object.prototype.hasOwnProperty.call(ORDER, name)) return;
    opts = opts || {};
    if (intro.phase === 'playing' || intro.phase === 'waiting') {
      if (name === 'intro') return;
      intro.dest = { name: name, opts: opts };
      intro.greeting = (name === 'lobby' && opts.greeting) ? String(opts.greeting) : null;
      if (intro.phase === 'waiting') maybeLeaveIntro(false);
      return;
    }
    requestTransition(name, opts);
  }

  // ---------- intro
  // null = aviso por defecto (los spans .prompt-fine / .prompt-coarse de LAYOUT)
  function promptText() {
    if (intro.dest && intro.dest.name !== 'login' && intro.greeting) return 'Hola de nuevo, ' + intro.greeting;
    if (!intro.dest && intro.userWants) return 'Conectando…';
    return null;
  }
  function defaultPromptNodes() {
    if (intro.promptNodes && intro.promptNodes.length) return intro.promptNodes.map(function (n) { return n.cloneNode(true); });
    return [doc.createTextNode(coarse ? 'Toca la pantalla para sumergirte' : 'Pulsa cualquier tecla para sumergirte')];
  }
  function setPrompt(text) {
    const p = intro.prompt;
    if (!p) return;
    const key = text == null ? '\u0000default' : text;
    if (intro.promptKey === key) return;
    intro.promptKey = key;
    if (text == null) p.replaceChildren(...defaultPromptNodes());
    else p.textContent = text;
    if (intro.phase === 'waiting' && !reduced) anim(p, [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: M.base, easing: M.out, composite: 'replace' });
  }
  function introTimer(ms, fn) { intro.timers.push(setTimeout(fn, ms)); }
  function introAnim(node, frames, o) { const a = anim(node, frames, o); if (a) intro.anims.push(a); return a; }

  function startIntro() {
    const sc = $('scene-intro');
    const pending = Promise.withResolvers();
    intro.promise = pending.promise;
    intro.resolve = pending.resolve;
    if (!sc) { intro.phase = 'done'; intro.resolve({ skipped: false, missing: true }); return; }
    let seen = false;
    try { seen = global.sessionStorage.getItem('bio.introSeen') === '1'; } catch (e) { seen = false; }
    intro.variant = reduced ? 'reduced' : (seen ? 'short' : 'full');
    intro.phase = 'playing';
    intro.title = qs(sc, '.intro-title');
    intro.tag = qs(sc, '.intro-tagline');
    intro.prompt = qs(sc, '.intro-prompt');
    current = 'intro';
    setBodyScene('intro');
    allScenes().forEach(function (n) { if (n !== sc) hideState(n); });
    showState(sc, 'active');
    setInert(sc, false);
    if (intro.prompt) {
      intro.promptNodes = Array.prototype.map.call(intro.prompt.childNodes, function (n) { return n.cloneNode(true); });
      if (!intro.prompt.textContent.trim()) intro.promptNodes = [];
      intro.promptKey = '\u0000default';
      if (!intro.promptNodes.length) setPrompt(null);
    }
    if (intro.tag && !intro.tag.textContent.trim()) intro.tag.textContent = 'Multijugador en tiempo real';
    const T = intro.title, G = intro.tag, P = intro.prompt;
    if (T) T.style.opacity = '0';
    if (G) G.style.opacity = '0';
    if (P) P.style.opacity = '0';
    intro.t0 = now();
    const B = backdrop();
    if (B && B.beginIntro) callSafe(function () { B.beginIntro(intro.variant); });

    global.addEventListener('keydown', onIntroInput, true);
    global.addEventListener('pointerdown', onIntroInput, true);

    if (intro.variant === 'full') {
      if (T) { setMask(T, -40); T.style.removeProperty('opacity'); }
      introTimer(1100, function () {
        if (!T) return;
        introAnim(T, [{ fontWeight: 200, letterSpacing: '0.08em', textShadow: '0 0 0 rgba(31,242,210,0), 0 0 0 rgba(31,242,210,0)' }, {}],
          { duration: 1100, easing: M.out, fill: 'backwards' });
        startMaskLoop(T);
      });
      introTimer(2000, function () {
        if (!G) return;
        G.style.removeProperty('opacity');
        introAnim(G, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 500, easing: M.out, fill: 'backwards' });
      });
      introTimer(2500, function () {
        if (!P) return;
        P.style.removeProperty('opacity');
        introAnim(P, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: M.out, fill: 'backwards' });
      });
      introTimer(2800, function () { endSequence(false); });
    } else if (intro.variant === 'short') {
      if (T) { T.style.removeProperty('opacity'); introAnim(T, [{ opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: 600, easing: M.out, fill: 'backwards' }); }
      introTimer(300, function () { if (G) { G.style.removeProperty('opacity'); introAnim(G, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 500, easing: M.out, fill: 'backwards' }); } });
      introTimer(600, function () { if (P) { P.style.removeProperty('opacity'); introAnim(P, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: M.out, fill: 'backwards' }); } });
      introTimer(900, function () { endSequence(false); });
    } else {
      [T, G, P].forEach(function (n) { if (n) { n.style.removeProperty('opacity'); introAnim(n, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'linear', fill: 'backwards' }); } });
      introTimer(400, function () { endSequence(false); });
    }
  }

  function setMask(node, pct) {
    const a = pct - 15, b = pct + 15;
    const g = 'linear-gradient(90deg, #000 ' + a.toFixed(1) + '%, transparent ' + b.toFixed(1) + '%)';
    node.style.webkitMaskImage = g;
    node.style.maskImage = g;
  }
  function clearMask(node) {
    node.style.removeProperty('-webkit-mask-image');
    node.style.removeProperty('mask-image');
    node.style.webkitMaskImage = '';
    node.style.maskImage = '';
  }
  function startMaskLoop(T) {
    const t1 = now();
    const step = function () {
      intro.maskRaf = 0;
      if (intro.phase !== 'playing') return;
      const r = textRect(T);
      const B = backdrop();
      const x = B && B.introCreatureX ? B.introCreatureX() : null;
      let pct;
      if (x === null || x === undefined || r.width <= 0) pct = -40 + (now() - t1) / 1100 * 180;
      else if (x === -Infinity) pct = -40;
      else if (x === Infinity) pct = 140;
      else pct = ((x - 30 - r.left) / r.width) * 100;
      // nunca más lento que el reloj: a los 1100 ms del revelado queda completo
      const minPct = -40 + Math.max(0, (now() - t1 - 500) / 600) * 180;
      if (pct < minPct) pct = minPct;
      if (pct >= 130) { clearMask(T); return; }
      setMask(T, pct);
      intro.maskRaf = global.requestAnimationFrame(step);
    };
    intro.maskRaf = global.requestAnimationFrame(step);
  }
  function stopIntroLoops() {
    if (intro.maskRaf) { global.cancelAnimationFrame(intro.maskRaf); intro.maskRaf = 0; }
    intro.timers.forEach(clearTimeout);
    intro.timers.length = 0;
    clearTimeout(intro.autoTimer); intro.autoTimer = 0;
  }
  function clearIntroStyles() {
    [intro.title, intro.tag, intro.prompt].forEach(function (n) { if (n) n.style.removeProperty('opacity'); });
    if (intro.title) clearMask(intro.title);
  }

  function endSequence(skipped) {
    if (intro.phase !== 'playing') return;
    stopIntroLoops();
    if (skipped) {
      intro.anims.forEach(function (a) { try { a.finish(); } catch (e) { cancelAnim(a); } });
      const B = backdrop();
      if (B && B.skipIntro) callSafe(function () { B.skipIntro(); });
    }
    intro.anims.forEach(cancelAnim);
    intro.anims.length = 0;
    clearIntroStyles();
    intro.phase = 'waiting';
    try { global.sessionStorage.setItem('bio.introSeen', '1'); } catch (e) { /* nada */ }
    if (!reduced) {
      if (intro.prompt) intro.breath.push(anim(intro.prompt, [{ opacity: 1 }, { opacity: 0.55 }], { duration: 1200, direction: 'alternate', iterations: Infinity, easing: M.inOut, delay: 300 }));
    }
    setPrompt(promptText());
    const res = intro.resolve; intro.resolve = null;
    if (res) res({ skipped: !!skipped });
    maybeLeaveIntro(false);
  }

  function maybeLeaveIntro(fromInput) {
    if (intro.phase !== 'waiting') return;
    const d = intro.dest;
    if (!d) { setPrompt(promptText()); return; }
    if (d.name === 'login') {
      if (intro.userWants) leaveIntro(); else setPrompt(promptText());
      return;
    }
    if (intro.userWants) { leaveIntro(); return; }
    setPrompt(promptText());
    if (!intro.autoTimer) intro.autoTimer = setTimeout(function () { intro.autoTimer = 0; leaveIntro(); }, 700);
  }
  function leaveIntro() {
    if (intro.phase !== 'waiting' || !intro.dest) return;
    clearTimeout(intro.autoTimer); intro.autoTimer = 0;
    intro.phase = 'leaving';
    global.removeEventListener('keydown', onIntroInput, true);
    global.removeEventListener('pointerdown', onIntroInput, true);
    const d = intro.dest;
    requestTransition(d.name, d.opts || {});
  }
  const IGNORE_KEYS = { Shift: 1, Control: 1, Alt: 1, Meta: 1, CapsLock: 1, Tab: 1, OS: 1, Fn: 1 };
  function onIntroInput(e) {
    if (intro.phase !== 'playing' && intro.phase !== 'waiting') return;
    if (e.type === 'keydown') {
      if (e.repeat || IGNORE_KEYS[e.key] || e.ctrlKey || e.metaKey || e.altKey) return;
    } else if (e.type === 'pointerdown' && e.button > 0) return;
    intro.userWants = true;
    if (intro.phase === 'playing') endSequence(true);
    else maybeLeaveIntro(true);
    if (!intro.dest) setPrompt(promptText());
  }

  function playIntro() {
    ensureInit();
    return intro.promise || Promise.resolve({ skipped: false });
  }

  function onEnter(name, fn) {
    if (typeof fn !== 'function') return noop;
    (enterCbs[name] = enterCbs[name] || []).push(fn);
    return function () { const l = enterCbs[name]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } };
  }

  // ---------- teclado global
  function onGlobalKey(e) {
    if (e.key !== 'Escape') return;
    if (Overlays._isModalOpen()) return; // el modal lo maneja
    if (!Chrome.fallbackOpen()) return;  // los popovers nativos se cierran solos con Escape
    if (Chrome.isProfileOpen()) { Chrome.closeProfile(); const c = qs(doc, '#profileView .profile-chip'); if (c) { try { c.focus({ preventScroll: true }); } catch (x) { /* nada */ } } return; }
    if (Chrome.isDockOpen()) Chrome.closeDock();
  }

  // =========================================================================================
  // Arranque
  // =========================================================================================
  let inited = false;
  function ensureInit() {
    if (inited) return true;
    if (!doc.body) return false;
    inited = true;
    readTokens();
    const B = backdrop();
    if (B && B.init) callSafe(function () { B.init($('backdrop')); });
    HUD._build();
    Chrome.init();
    Overlays._init();
    const arena = $('scene-arena');
    if (arena && !arena.getAttribute('data-mode')) arena.setAttribute('data-mode', 'room');
    doc.addEventListener('keydown', onGlobalKey);
    startIntro();
    return true;
  }

  global.Scenes = {
    __bio: true,
    go: go,
    current: function () { return current; },
    onEnter: onEnter,
    playIntro: playIntro,
    isTransitioning: function () { return busy || intro.phase === 'playing' || intro.phase === 'leaving'; },
    chrome: {
      openDock: Chrome.openDock, closeDock: Chrome.closeDock, toggleDock: Chrome.toggleDock,
      openProfile: Chrome.openProfile, closeProfile: Chrome.closeProfile, toggleProfile: Chrome.toggleProfile,
      closeAll: Chrome.closeAll, alertDock: Chrome.alertDock
    },
    bioColor: bio
  };
  global.Overlays = Overlays;
  global.Toasts = Toasts;
  global.HUD = HUD;

  if (doc.readyState === 'loading') {
    if ($('scene-intro') || $('scenes')) ensureInit();
    else doc.addEventListener('DOMContentLoaded', ensureInit);
  } else {
    ensureInit();
  }
})(window);
