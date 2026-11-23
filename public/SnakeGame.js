/*
 * SnakeGame.js: cliente de Snake Multiplayer.
 *
 * Mantiene la lógica de red y de estado (socket.io, perfil, salas) y conecta:
 *   - window.Motion    (js/net/motion.js)    línea de tiempo de los frames del servidor
 *   - window.Arena     (js/render/arena.js)  dibuja canvas#game
 *   - window.Backdrop  (js/ui/backdrop.js)   fondo vivo
 *   - window.Scenes / Overlays / Toasts / HUD (js/ui/scenes.js)
 *
 * Reglas de esta capa (docs/VISUAL_SPEC.md, sección 10):
 *   - Un único requestAnimationFrame siempre vivo. Con partida en curso: Arena.render;
 *     al terminar la partida, 2400 ms de estado congelado; el resto del tiempo, Arena.renderIdle.
 *   - Los eventos de gameLogicFrame se despachan a la arena cuando el render alcanza su frame,
 *     ANTES de dibujar las posiciones de ese frame.
 *   - Nada que venga del servidor se inserta con innerHTML: todo va con textContent.
 */
document.addEventListener('DOMContentLoaded', function () {
  'use strict';

  // ===========================================================================
  // Módulos visuales (con respaldos inertes para que la red nunca dependa de ellos)
  // ===========================================================================
  const noop = function () {};
  const Scenes = window.Scenes || { go: noop, current: function () { return null; }, onEnter: function () { return noop; }, playIntro: function () { return Promise.resolve({}); } };
  const Overlays = window.Overlays || { countdown: noop, roundStart: noop, roundEnd: noop, closeRoundEnd: noop, final: noop, hideAll: noop, open: noop, close: noop };
  const Toasts = window.Toasts || { show: noop };
  const HUD = window.HUD || { update: noop, show: noop, hide: noop, reset: noop };
  const Backdrop = window.Backdrop || { setMood: noop, pulse: noop };
  const Arena = window.Arena || null;
  const Motion = window.Motion || null; // sin Motion, las posiciones se aplican al llegar (sin interpolar)

  const reportedErrors = new Set();
  function reportOnce(err) {
    const key = String((err && err.message) || err);
    if (reportedErrors.has(key)) return;
    reportedErrors.add(key);
    console.error(err);
  }
  // Las llamadas a la capa visual nunca deben cortar un handler de red a la mitad.
  function ui(fn) {
    try { fn(); } catch (err) { reportOnce(err); }
  }

  // ===========================================================================
  // Constantes
  // ===========================================================================
  const SVGNS = 'http://www.w3.org/2000/svg';
  const ARENA_W = 768, ARENA_H = 432;   // tamaño del mundo por defecto; el real viene en la config de la sala
  const FREEZE_MS = 2400;               // congelamiento de la arena al terminar la partida (arena.js, 5.14)
  const FINAL_DELAY_MS = 2000;          // la pantalla final entra cuando la arena ya enfocó al ganador
  const INVITE_COOLDOWN_MS = 8000;      // "Enviada" en el botón de invitar
  const PROFILE_RETRY_MAX = 6;          // reintentos del re-registro automático ("ya está conectado")
  const KEY_TO_ARROW = { 37: 37, 38: 38, 39: 39, 40: 40, 87: 38, 65: 37, 83: 40, 68: 39 }; // flechas y WASD
  const DIFFICULTY_NAMES = { easy: 'fácil', medium: 'medio', hard: 'difícil' };
  const REMAINS_FADE_MS = 2000;         // los restos de un corte se apagan en sus últimos 2 s

  // Mensajes del servidor que llegan en inglés (spec 8.6). Los que ya llegan en español pasan igual.
  const SERVER_ERRORS_ES = {
    'Username must be 2-20 characters': 'El nombre debe tener entre 2 y 20 caracteres',
    'Failed to create room': 'No se pudo crear la sala. Intenta de nuevo.',
    'Error creating room': 'No se pudo crear la sala. Intenta de nuevo.',
    'Invalid room ID': 'El código de sala no es válido',
    'Room not found or has ended': 'No hay una sala abierta con ese código',
    'Room is full': 'La sala está llena',
    'Game already in progress': 'La partida ya empezó. Puedes mirarla desde la lista de salas.',
    'Username already taken in this room': 'Ya hay alguien con ese nombre en la sala',
    'Error joining room': 'No se pudo entrar a la sala. Intenta de nuevo.',
    'Only the host can modify room settings': 'Solo el anfitrión puede cambiar la configuración',
    'Cannot modify settings during game': 'No se puede cambiar la configuración durante la partida',
    'Only the host can start the game': 'Solo el anfitrión puede iniciar la partida',
    'Not enough players to continue': 'No quedan jugadores suficientes para seguir',
    'Error loading profile': 'No se pudo cargar el perfil'
  };
  const NOT_ENOUGH_PLAYERS = 'Not enough players to continue';

  // ===========================================================================
  // DOM (contrato de IDs de index.html)
  // ===========================================================================
  const $ = function (id) { return document.getElementById(id); };
  const canvas = $('game');

  const joinButton = $('joinButton');
  const createRoomButton = $('createRoomButton');
  const joinRoomButton = $('joinRoomButton');
  const startGameButton = $('startGameButton');
  const refreshRoomsButton = $('refreshRoomsButton');
  const usernameInput = $('username');
  const roomIdInput = $('roomId');
  const roomsList = $('roomsList');
  const waitingSpan = $('waitingSpan');
  const playerList = $('playerList');
  const playersCount = $('playersCount');
  const roomInfo = $('roomInfo');

  const configPanel = $('configPanel');
  const toggleConfigButton = $('toggleConfigButton');
  const configSettings = $('configSettings');
  const difficultyInputs = Array.prototype.slice.call(document.querySelectorAll('#difficultyPicker input[name="difficulty"]'));

  const onlinePlayersList = $('onlinePlayersList');
  const dockCount = $('dockCount');
  const profileInfo = $('profileInfo');
  const spectatorBanner = $('spectatorBanner');
  const controlsHint = document.querySelector('.controls-hint');
  const leaderboardModal = $('leaderboardModal');
  const leaderboardList = $('leaderboardList');
  const backToMenuButton = $('backToMenuButton');
  const backToRoomButton = $('backToRoomButton');
  const playAgainButton = $('playAgainButton');
  const finalHint = $('finalHint');
  const leaveRoomButton = $('leaveRoomButton');

  // ===========================================================================
  // Estado de red y de juego
  // ===========================================================================
  let playerProfile = null;
  let currentPlayerId = null;

  const socket = io();
  let gameState = { playing: false, round: 1 };
  let segmentSize = 20;
  let snakes = [];
  let foods = [];
  let consumables = [];
  let clientProjectiles = [];   // lo que dibuja la arena (applyTimelineSample)
  let isConnected = false;
  let hasConnectedOnce = false;
  let isHost = false;
  let isSpectating = false;
  let currentRoomId = null;
  let roomHostId = null;
  let roomHostName = '';
  let roomConfig = {};
  let roundTimeLeft = 0;

  let onlinePlayers = [];
  const pendingInvitations = [];

  // Estado propio de la presentación
  let roundLive = false;        // partida en curso: entre gameStart (o spectatingStarted) y gameEnd
  let freezeUntil = 0;          // performance.now() hasta el que la arena muestra el último estado congelado
  let renderServerT = 0;        // hora del servidor del instante dibujado (la recarga del ancla se mide con esta)
  let crownId = null;           // quién lleva la corona en el frame que alcanzó el render
  let countdownActive = false;  // cuenta regresiva 3, 2, 1 en pantalla
  let startRequested = false;   // el anfitrión pidió iniciar y el servidor todavía no arrancó
  let matchFinished = false;    // llegó gameEnd: la escena final está por entrar o a la vista
  let finalTimer = 0;           // espera entre gameEnd y la pantalla final
  let tensionOn = false;        // últimos 10 segundos
  let frenzyOn = false;         // ya se avisó el frenesí de esta partida
  let lastPulseSecond = -1;
  let keyboardSeen = false;
  let previewList = [];         // criaturas de la sala para Arena.renderIdle
  let idleCaption = '';
  let knownRoomCodes = new Set();
  let knownOnlineIds = new Set();
  let knownPlayerIds = new Set();
  const invitedAt = new Map();  // socketId -> momento de la invitación
  let roomsRefreshTimer = 0;
  let autoProfilePending = false; // el último getOrCreateProfile lo mandó el cliente solo (sesión guardada o reconexión)
  let profileRetryTimer = 0;
  let profileRetryCount = 0;
  let sessionReplaced = false;  // el servidor pasó esta sesión a otra pestaña o dispositivo
  const roomNodes = new Map();  // código de sala -> { li, sig } (la lista se reconcilia en el lugar)
  let joinBusyTimer = 0;
  let pendingButton = null;
  let pendingButtonTimer = 0;

  const coarseQuery = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;

  // ===========================================================================
  // Utilidades
  // ===========================================================================
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function iconEl(symbolId, cls) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVGNS, 'use');
    use.setAttribute('href', '#' + symbolId);
    svg.appendChild(use);
    return svg;
  }
  function clearNode(node) {
    if (node) node.replaceChildren();
  }
  function showElement(element) { if (element) element.classList.remove('hidden'); }
  function hideElement(element) { if (element) element.classList.add('hidden'); }
  function toggleElement(element, visible) { if (visible) showElement(element); else hideElement(element); }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function perfNow() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  // Tamaño del mundo (coordenadas lógicas del servidor): apaisado, 768 × 432
  function arenaW() { return (roomConfig && +roomConfig.canvasWidth) || ARENA_W; }
  function arenaH() { return (roomConfig && +roomConfig.canvasHeight) || ARENA_H; }

  function bio(hex) {
    try {
      if (Arena && typeof Arena.bioColor === 'function') return Arena.bioColor(hex);
      if (typeof Scenes.bioColor === 'function') return Scenes.bioColor(hex);
    } catch (err) { reportOnce(err); }
    return { body: hex || '#1FF2D2', text: '#E8FBFF' };
  }

  function roundTime() { return (roomConfig && +roomConfig.roundTime) || 120; }

  function translateServerMessage(message) {
    const text = String(message === undefined || message === null ? '' : message).trim();
    if (Object.prototype.hasOwnProperty.call(SERVER_ERRORS_ES, text)) return SERVER_ERRORS_ES[text];
    const need = /^Need at least (\d+) players$/.exec(text);
    if (need) return 'Se necesitan al menos ' + need[1] + ' jugadores';
    return text;
  }

  // Toasts DOM (reemplazan a las notificaciones dibujadas en el canvas).
  // duration undefined = duración por tipo (3000 ms, error 4500 ms, invitación 9000 ms).
  function toast(message, type, duration, opts) {
    if (message === undefined || message === null || String(message).trim() === '') return;
    ui(function () { Toasts.show(String(message).trim(), type || 'info', duration, opts); });
  }
  const addCanvasNotification = toast; // alias de compatibilidad con el nombre anterior

  function markInvalid(input) {
    if (!input) return;
    input.classList.remove('is-invalid');
    void input.offsetWidth; // reinicia la ondulación de LAYOUT
    input.classList.add('is-invalid');
    input.setAttribute('aria-invalid', 'true');
  }
  function clearInvalid(input) {
    if (!input) return;
    input.classList.remove('is-invalid');
    input.removeAttribute('aria-invalid');
  }

  // Botones que esperan respuesta del servidor (evita salas duplicadas por doble clic)
  function setPendingButton(btn) {
    clearPendingButton();
    if (!btn) return;
    pendingButton = btn;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    pendingButtonTimer = setTimeout(clearPendingButton, 6000);
  }
  function clearPendingButton() {
    clearTimeout(pendingButtonTimer);
    pendingButtonTimer = 0;
    if (pendingButton) {
      pendingButton.disabled = false;
      pendingButton.removeAttribute('aria-busy');
      pendingButton = null;
    }
  }

  function setJoinBusy(busy) {
    if (!joinButton) return;
    clearTimeout(joinBusyTimer);
    joinButton.disabled = !!busy;
    joinButton.textContent = busy ? 'Entrando…' : 'Entrar';
    if (busy) {
      joinButton.setAttribute('aria-busy', 'true');
      joinBusyTimer = setTimeout(function () { setJoinBusy(false); }, 8000);
    } else {
      joinButton.removeAttribute('aria-busy');
    }
  }

  // ===========================================================================
  // Perfil en localStorage
  // ===========================================================================
  function savePlayerProfile(profile) {
    try {
      localStorage.setItem('snakePlayerProfile', JSON.stringify(profile));
      localStorage.setItem('snakePlayerId', profile.playerId);
    } catch (error) { /* almacenamiento no disponible: el perfil vive solo en memoria */ }
  }

  function loadPlayerProfile() {
    try {
      const savedProfile = localStorage.getItem('snakePlayerProfile');
      const savedPlayerId = localStorage.getItem('snakePlayerId');
      if (savedProfile && savedPlayerId) {
        const profile = JSON.parse(savedProfile);
        return Object.assign({}, profile, { playerId: savedPlayerId });
      }
    } catch (error) { /* perfil corrupto o almacenamiento bloqueado */ }
    return null;
  }

  function clearPlayerProfile() {
    try {
      localStorage.removeItem('snakePlayerProfile');
      localStorage.removeItem('snakePlayerId');
    } catch (error) { /* nada que limpiar */ }
    playerProfile = null;
    currentPlayerId = null;
  }

  function currentUsername() {
    if (playerProfile && playerProfile.stats && playerProfile.stats.name) return String(playerProfile.stats.name);
    return usernameInput ? usernameInput.value.trim() : '';
  }
  function isValidUsername(name) { return !!name && name.length >= 2 && name.length <= 20; }

  // Igual que antes: se reutiliza el playerId solo si el nombre coincide con el perfil cargado.
  function buildIdentity(username, extra) {
    const data = Object.assign({ username: username }, extra || {});
    if (currentPlayerId && playerProfile && playerProfile.stats && playerProfile.stats.name.toLowerCase() === username.toLowerCase()) {
      data.playerId = currentPlayerId;
    } else {
      currentPlayerId = null;
      // Sin perfil en memoria (falló el re-registro automático o la sesión pasó a otra pestaña),
      // la sesión guardada sigue valiendo para el mismo nombre: con su playerId el servidor
      // reemplaza un socket viejo en vez de responder "ya está conectado".
      const saved = loadPlayerProfile();
      if (saved && saved.stats && saved.playerId && String(saved.stats.name).toLowerCase() === username.toLowerCase()) {
        data.playerId = saved.playerId;
      }
    }
    return data;
  }

  // Re-registro automático del perfil guardado (al cargar y al reconectar)
  function requestSavedProfile(profile) {
    if (!profile || !profile.stats || !profile.playerId) return;
    autoProfilePending = true;
    socket.emit('getOrCreateProfile', { username: profile.stats.name, playerId: profile.playerId });
  }
  function cancelProfileRetry() {
    if (profileRetryTimer) { clearTimeout(profileRetryTimer); profileRetryTimer = 0; }
    profileRetryCount = 0;
  }

  function initializeUserInterface() {
    const savedProfile = loadPlayerProfile();
    if (savedProfile && savedProfile.stats) {
      usernameInput.value = savedProfile.stats.name;
      playerProfile = savedProfile;
      currentPlayerId = savedProfile.playerId;
      updateProfileDisplay(savedProfile.stats);
      // La intro muestra "Conectando…" hasta que llegue profileLoaded (o profileError → login)
      requestSavedProfile(savedProfile);
    } else {
      updateProfileDisplay(null);
      ui(function () { Scenes.go('login'); }); // queda en cola hasta que termine la intro
    }
    updateLogoutButtonVisibility();
  }

  function updateLogoutButtonVisibility() {
    const logoutButton = $('resetProfileButton');
    toggleElement(logoutButton, !!(playerProfile && currentPlayerId));
  }

  // Chip del topbar y estadísticas del popover (spec 4.21, Perfil)
  function updateProfileDisplay(stats) {
    const chipName = document.querySelector('#profileView .profile-chip-name');
    const chipMeta = document.querySelector('#profileView .profile-chip-meta');
    const orb = document.querySelector('#profileView .profile-orb');
    if (!stats) {
      if (chipName) chipName.textContent = 'Tu perfil';
      if (chipMeta) chipMeta.textContent = '';
      if (orb) orb.textContent = '';
      if (profileInfo) {
        clearNode(profileInfo);
        const box = el('div', 'profile-stats');
        box.appendChild(el('span', null, 'Ingresa tu nombre para ver tus estadísticas'));
        profileInfo.appendChild(box);
      }
      return;
    }
    const name = String(stats.name || '');
    const wins = stats.wins | 0;
    if (chipName) chipName.textContent = name;
    if (chipMeta) chipMeta.textContent = wins + plural(wins, ' victoria', ' victorias');
    if (orb) orb.textContent = name ? Array.from(name)[0].toUpperCase() : '';
    if (!profileInfo) return;
    clearNode(profileInfo);
    const box = el('div', 'profile-stats');
    box.appendChild(el('strong', 'profile-name', name));
    const grid = el('dl', 'profile-grid');
    [
      ['Partidas', stats.games_played | 0],
      ['Victorias', wins],
      ['Racha actual', stats.current_streak | 0],
      ['Mejor puntaje', stats.best_score | 0]
    ].forEach(function (pair) {
      const cell = el('div');
      cell.appendChild(el('dt', null, pair[0]));
      cell.appendChild(el('dd', null, pair[1]));
      grid.appendChild(cell);
    });
    box.appendChild(grid);
    profileInfo.appendChild(box);
  }

  // ===========================================================================
  // Jugadores en línea e invitaciones (dock)
  // ===========================================================================
  function updateOnlinePlayersList(players) {
    onlinePlayers = Array.isArray(players) ? players : [];
    if (!onlinePlayersList) return;
    const nextIds = new Set();
    const frag = document.createDocumentFragment();

    if (onlinePlayers.length === 0) {
      frag.appendChild(el('li', 'online-players-empty', 'No hay nadie más en línea'));
    }

    const now = Date.now();
    onlinePlayers.forEach(function (player) {
      const id = String(player.socketId);
      nextIds.add(id);
      const listItem = el('li', 'online-player-item');
      if (!knownOnlineIds.has(id)) listItem.setAttribute('data-reveal', '');

      const dot = el('i', 'online-dot');
      dot.setAttribute('aria-hidden', 'true');
      listItem.appendChild(dot);

      const playerInfo = el('div', 'online-player-info');
      playerInfo.appendChild(el('div', 'online-player-name', player.name));
      // Los compañeros de la propia sala figuran aparte: no se los puede invitar (el servidor los lista igual)
      const inMyRoom = !!currentRoomId && player.roomId === currentRoomId;
      let statusClass = player.isInGame ? 'in-game' : 'available';
      let statusText = player.isInGame ? 'En partida' : 'Disponible';
      if (inMyRoom) { statusClass = 'in-room'; statusText = 'En tu sala'; }
      playerInfo.appendChild(el('div', 'online-player-status ' + statusClass, statusText));
      listItem.appendChild(playerInfo);

      // Botón de invitar solo si: estoy en una sala, no hay partida y el jugador está disponible
      const showInviteButton = currentRoomId && !isSpectating && !gameState.playing && !roundLive && player.canInvite;
      if (showInviteButton) {
        const inviteButton = el('button', 'invite-button');
        inviteButton.type = 'button';
        const sentAt = invitedAt.get(id) || 0;
        const recentlySent = now - sentAt < INVITE_COOLDOWN_MS;
        inviteButton.textContent = recentlySent ? 'Enviada' : 'Invitar';
        inviteButton.disabled = recentlySent;
        inviteButton.setAttribute('aria-label', (recentlySent ? 'Invitación enviada a ' : 'Invitar a ') + player.name);
        inviteButton.addEventListener('click', function () {
          invitePlayer(player.socketId, player.name, inviteButton);
        });
        listItem.appendChild(inviteButton);
      }
      frag.appendChild(listItem);
    });

    onlinePlayersList.replaceChildren(frag);
    knownOnlineIds = nextIds;
    if (dockCount) dockCount.textContent = onlinePlayers.length ? String(onlinePlayers.length) : '';
  }

  function invitePlayer(targetSocketId, targetPlayerName, button) {
    if (!currentRoomId || gameState.playing || roundLive) {
      toast('No puedes invitar durante una partida', 'error');
      return;
    }
    socket.emit('invitePlayer', { targetSocketId: targetSocketId });
    const id = String(targetSocketId);
    invitedAt.set(id, Date.now());
    if (button) {
      button.disabled = true;
      button.textContent = 'Enviada';
      button.setAttribute('aria-label', 'Invitación enviada a ' + targetPlayerName);
    }
    setTimeout(function () {
      invitedAt.delete(id);
      updateOnlinePlayersList(onlinePlayers);
    }, INVITE_COOLDOWN_MS);
  }

  function handleInvitationReceived(invitationData) {
    const fromPlayer = invitationData && invitationData.fromPlayer;
    const roomId = invitationData && invitationData.roomId;
    if (!roomId) return;

    pendingInvitations.push({ from: fromPlayer, roomId: roomId, timestamp: Date.now() });
    const message = (fromPlayer || 'Alguien') + ' te invita a la sala ' + roomId;

    // Desde una sala no se puede saltar a otra (el servidor no la abandona): solo se avisa.
    if (currentRoomId) {
      toast(message, 'invitation');
      return;
    }
    if (roomIdInput) roomIdInput.value = String(roomId).toUpperCase();
    toast(message, 'invitation', undefined, {
      actionLabel: 'Unirse',
      onAction: function () {
        if (currentRoomId) return;
        if (roomIdInput) roomIdInput.value = String(roomId).toUpperCase();
        joinRoomFromInput();
      }
    });
  }

  // ===========================================================================
  // Línea de tiempo de los frames del servidor (js/net/motion.js)
  // ===========================================================================
  // El render dibuja un instante un paso atrás del último frame e interpola en línea recta
  // entre los dos frames que lo rodean: la velocidad visible queda constante. Comida,
  // consumibles, escudos y eventos de la arena se toman del frame que el render ya alcanzó,
  // así el efecto coincide con la cabeza que llega.
  const timeline = Motion ? Motion.createTimeline({ tickMs: 83 }) : null;
  const timeSample = { a: null, b: null, f: 0, e: 0, rt: 0 };
  const projectileViews = new Map(); // id -> objeto que lee la arena (se reutiliza entre cuadros)
  const projectileList = [];

  function indexById(list) {
    const map = new Map();
    (list || []).forEach(function (item) { map.set(item.id, item); });
    return map;
  }

  function timelineFrame(data, t) {
    return {
      t: t,
      snakes: indexById(data.players),
      projectiles: indexById(data.projectiles),
      foods: data.foods || [],
      consumables: data.consumables || [],
      payload: data
    };
  }

  // Partida nueva (gameStart o spectatingStarted): el primer frame interpola desde este estado
  function restartTimeline(data) {
    resetTimeline();
    if (!timeline) return;
    if (roomConfig && roomConfig.gameSpeed) timeline.setTick(roomConfig.gameSpeed);
    timeline.seed(timelineFrame(data, null));
  }

  function resetTimeline() {
    projectileViews.clear();
    projectileList.length = 0;
    clientProjectiles = [];
    if (timeline) timeline.clear();
  }

  // Aviso al tomar cada consumible (solo a quien lo toma)
  const PICKUP_TOASTS = {
    immunity: 'Escudo activo: bloquea un disparo',
    bigMouth: 'Boca grande: comés desde más lejos',
    fan: 'Abanico: disparás de a tres'
  };

  function dispatchTimelineFrame(frame) {
    const data = frame.payload;
    dispatchFrameEvents(data);
    callEach(data.consumableEvents, function (event) {
      const message = PICKUP_TOASTS[event.consumableType];
      if (message && event.playerId === socket.id && !isSpectating) toast(message, 'success', 2500);
    });
  }

  function projectileView(p) {
    let view = projectileViews.get(p.id);
    if (!view) {
      view = { id: p.id, playerId: p.playerId, color: p.color, direction: p.direction, x: p.x, y: p.y, seen: 0 };
      projectileViews.set(p.id, view);
    }
    view.color = p.color;
    view.direction = p.direction;
    return view;
  }

  const period = { x: 0, y: 0 };   // envoltorio de los portales: ancho y alto del mundo (múltiplo de la celda)

  function applyTimelineSample(s, now) {
    // Efectos del frame recién alcanzado, antes de dibujarlo: la arena todavía tiene el cuerpo
    // del cuadro anterior, así un corte desprende la parte que se veía
    timeline.drain(dispatchTimelineFrame);

    const a = s.a, b = s.b;
    const cell = segmentSize;
    period.x = Math.floor(arenaW() / cell) * cell;
    period.y = Math.floor(arenaH() / cell) * cell;
    const shotStep = cell * ((roomConfig && +roomConfig.projectileCells) || 1); // lo que avanza un disparo por paso
    for (let i = 0; i < snakes.length; i++) {
      const snake = snakes[i];
      const pa = a.snakes.get(snake.id);
      const pb = b ? b.snakes.get(snake.id) : null;
      if (pa && pb) Motion.snakeAt(pa.segments, pb.segments, s.f, cell, period, snake.renderSegments);
      else if (pa) Motion.snakeAhead(pa.segments, pa.direction, b ? 0 : s.e, cell, period, snake.renderSegments);
      else if (pb) Motion.snakeAt(null, pb.segments, 0, cell, period, snake.renderSegments);
      else continue;
      snake.direction = (pb || pa).direction;
      if (pa) {
        snake.effects = pa.effects || {};
        snake.anchoredUntil = pa.anchoredUntil || 0;
        snake.anchorReadyAt = pa.anchorReadyAt || 0;
      }
    }

    renderServerT = s.rt;
    crownId = (a.payload && a.payload.gameState && a.payload.gameState.leaderId) || null;
    foods = a.foods;
    consumables = a.consumables;
    // Restos de un corte: se desvanecen en sus últimos 2 s (hora del servidor del instante dibujado)
    for (let i = 0; i < foods.length; i++) {
      const food = foods[i];
      if (food.expiresAt) food.fade = Math.max(0, Math.min(1, (food.expiresAt - s.rt) / REMAINS_FADE_MS));
    }

    // Proyectiles: los de a avanzan hacia b (o siguen de largo si ya no están); los nuevos de b
    // arrancan donde se crearon
    const f = b ? s.f : s.e;
    projectileList.length = 0;
    a.projectiles.forEach(function (pa) {
      const pb = b ? b.projectiles.get(pa.id) : null;
      const view = projectileView(pb || pa);
      Motion.projectileAt(pa, pb, f, shotStep, view);
      view.seen = now;
      projectileList.push(view);
    });
    if (b) {
      b.projectiles.forEach(function (pb) {
        if (a.projectiles.has(pb.id)) return;
        const view = projectileView(pb);
        Motion.projectileAt(null, pb, s.f, shotStep, view);
        view.seen = now;
        projectileList.push(view);
      });
    }
    projectileViews.forEach(function (view, id) { if (view.seen !== now) projectileViews.delete(id); });
    clientProjectiles = projectileList;
  }

  function applyTimeline(now) {
    if (!timeline) return;
    const s = timeline.sample(now, timeSample);
    if (s) applyTimelineSample(s, now);
  }

  // Fin de la partida: lo congelado es el último frame (coincide con la clasificación final)
  function settleTimeline() {
    if (!timeline) return;
    const s = timeline.sampleLatest(timeSample);
    if (s) applyTimelineSample(s, perfNow());
    timeline.clear();
  }

  // ===========================================================================
  // Teclado
  // ===========================================================================
  document.addEventListener('keydown', handleKeyPress);

  // Espacio y flechas son teclas de juego: mientras hay partida (o su cuenta regresiva) no desplazan
  // la página ni activan el botón enfocado, aunque la partida todavía no corra (roundLive en false).
  function swallowsGameKeys(target) {
    if (!currentRoomId) return false;
    const scene = Scenes.current();
    if (scene === 'game') return true;
    if (scene === 'room') return countdownActive || roundLive || !!gameState.playing;
    // En el final el foco queda en el título: Espacio no desplaza; un botón al que se llegó con Tab sí responde
    if (scene === 'final') return !(target && target.tagName === 'BUTTON');
    return false;
  }

  function handleKeyPress(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    const inField = !!(target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)));
    const key = event.keyCode;
    // Hay teclado físico si se usan teclas del juego fuera de un campo: escribir el nombre con el
    // teclado en pantalla del celular también dispara keydown y no debe esconder la ayuda táctil
    if (!keyboardSeen && !inField && (KEY_TO_ARROW[key] || key === 32)) {
      keyboardSeen = true;
      updateSpectatorIndicator();
    }
    if (!inField && (key === 32 || (key >= 37 && key <= 40)) && swallowsGameKeys(target)) event.preventDefault();

    // No permitir controles si se está mirando
    if (isSpectating) return;
    // Solo con una partida en curso (no durante la cuenta regresiva)
    if (!isConnected || !gameState.playing || !roundLive) return;
    if (inField) return;

    const arrow = KEY_TO_ARROW[key];
    if (arrow) {
      event.preventDefault();
      // WASD cuenta como flechas. Las teclas apretadas a la vez suman: arriba + derecha = 45°
      if (event.repeat && heldArrows.has(arrow)) return;
      heldArrows.add(arrow);
      clearTimeout(keyReleaseTimer);
      steerMode = 'keys';
      pointer.travel = 0;
      const angle = keysAngle();
      if (angle !== null) emitSteer(angle, perfNow());
    } else if (key === 32) {
      event.preventDefault();
      socket.emit('attack');
    } else if (key === 69) {
      // E: ancla (la misma tecla la suelta); mantenerla apretada no la repite
      event.preventDefault();
      if (!event.repeat) socket.emit('anchor');
    }
  }

  // ===========================================================================
  // Giro libre: el servidor gira la serpiente hacia el rumbo pedido, como mucho
  // turnDegrees por paso. Teclado: 8 rumbos. Mouse: el rumbo de la cabeza al puntero.
  // ===========================================================================
  const heldArrows = new Set();            // códigos de flecha apretados (37 izq, 38 arriba, 39 der, 40 abajo)
  const KEY_RELEASE_GRACE_MS = 70;         // soltar las dos teclas de una diagonal casi a la vez no la pierde
  const MOUSE_TAKEOVER_PX = 12;            // lo que hay que mover el mouse (px de pantalla) para que tome el control
  const MOUSE_DEADZONE_CELLS = 1.5;        // con el puntero encima de la cabeza no se cambia el rumbo (mínimo)
  const STEER_MIN_DELTA = 2 * Math.PI / 180;
  const STEER_MIN_INTERVAL_MS = 40;        // como mucho 25 mensajes por segundo (el servidor da un paso cada 60-70 ms)
  const STEER_REFRESH_MS = 250;            // con el mouse quieto igual se repite, por si el servidor reinició el rumbo
  let keyReleaseTimer = 0;
  let steerMode = 'keys';                  // 'keys' | 'mouse'
  let lastSteerAngle = null;
  let lastSteerT = 0;
  const pointer = { cx: 0, cy: 0, has: false, travel: 0 };   // última posición del mouse en pantalla
  let aimingCursor = false;
  const arenaStage = canvas ? canvas.closest('.arena-stage') : null;

  function canSteer() {
    return isConnected && !!gameState.playing && roundLive && !isSpectating;
  }

  function emitSteer(angle, now) {
    if (!canSteer()) return;
    lastSteerAngle = angle;
    lastSteerT = now;
    socket.emit('steer', { angle: Math.round(angle * 1000) / 1000 });
  }

  function keysAngle() {
    const x = (heldArrows.has(39) ? 1 : 0) - (heldArrows.has(37) ? 1 : 0);
    const y = (heldArrows.has(40) ? 1 : 0) - (heldArrows.has(38) ? 1 : 0);
    return x || y ? Math.atan2(y, x) : null;
  }

  function angleGap(a, b) {
    let d = (a - b) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
  }

  // Al soltar una tecla, el rumbo pasa a las que siguen apretadas; soltarlas todas deja el último
  function handleKeyUp(event) {
    const arrow = KEY_TO_ARROW[event.keyCode];
    if (!arrow || !heldArrows.delete(arrow)) return;
    clearTimeout(keyReleaseTimer);
    if (!heldArrows.size) return;
    keyReleaseTimer = setTimeout(function () {
      if (steerMode !== 'keys' || !heldArrows.size) return;
      const angle = keysAngle();
      if (angle !== null && (lastSteerAngle === null || angleGap(angle, lastSteerAngle) > 1e-6)) emitSteer(angle, perfNow());
    }, KEY_RELEASE_GRACE_MS);
  }

  function resetSteering() {
    heldArrows.clear();
    clearTimeout(keyReleaseTimer);
    steerMode = touchSeen ? 'touch' : 'keys';
    lastSteerAngle = null;
    pointer.travel = 0;
  }

  // Guarda la posición en pantalla; se pasa a coordenadas de la arena en cada cuadro, porque la
  // arena cambia de tamaño y de lugar debajo de un mouse quieto (al empezar la partida, al redimensionar)
  function handlePointerMove(event) {
    if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    if (stick.id !== null) return; // arrastrando el joystick (en la emulación táctil llega como mouse)
    if (pointer.has) pointer.travel += Math.abs(event.clientX - pointer.cx) + Math.abs(event.clientY - pointer.cy);
    pointer.cx = event.clientX;
    pointer.cy = event.clientY;
    pointer.has = true;
    if (steerMode !== 'mouse' && pointer.travel > MOUSE_TAKEOVER_PX && canSteer()) {
      steerMode = 'mouse';
      // Equipo híbrido: si se tocó la pantalla pero ahora se usa el mouse, el joystick sobra
      if (event.pointerType === 'mouse' && !(coarseQuery && coarseQuery.matches)) touchSeen = false;
    }
  }

  // Clic en la arena: dispara (y el mouse toma el control del rumbo). Clic derecho: ancla.
  function handlePointerDown(event) {
    if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    if (event.button === 2) {
      if (!canSteer()) return;
      event.preventDefault();
      socket.emit('anchor');
      return;
    }
    if (event.button !== 0) return;
    if (!canSteer()) return;
    event.preventDefault();
    handlePointerMove(event);
    steerMode = 'mouse';
    socket.emit('attack');
  }

  // Manda el rumbo sin inundar la red: como mucho cada 40 ms, si cambió 2° o pasaron 250 ms
  function steerThrottled(angle, now) {
    if (now - lastSteerT < STEER_MIN_INTERVAL_MS) return;
    if (lastSteerAngle !== null && angleGap(angle, lastSteerAngle) < STEER_MIN_DELTA && now - lastSteerT < STEER_REFRESH_MS) return;
    emitSteer(angle, now);
  }

  // Cada cuadro: mira del mouse, controles táctiles y el rumbo del mouse o del joystick
  function updateSteering(now) {
    const aiming = canSteer();
    if (aiming !== aimingCursor && arenaStage) {
      aimingCursor = aiming;
      arenaStage.classList.toggle('is-aiming', aiming);
    }
    let me = null;
    if (aiming) for (let i = 0; i < snakes.length; i++) if (snakes[i].id === socket.id) { me = snakes[i]; break; }
    updateTouchControls(me);
    if (!aiming) return;
    if (steerMode === 'touch') {
      if (stick.id !== null && stick.angle !== null) steerThrottled(stick.angle, now);
      return;
    }
    if (steerMode !== 'mouse' || !pointer.has || !canvas) return;
    const head = me && me.renderSegments && me.renderSegments[0];
    if (!head) return;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const half = segmentSize / 2;
    const dx = (pointer.cx - r.left) / r.width * arenaW() - (head.x + half);
    const dy = (pointer.cy - r.top) / r.height * arenaH() - (head.y + half);
    // La zona muerta es al menos el radio de giro: si no, con el puntero sobre una comida la serpiente
    // orbitaría alrededor sin alcanzarla (a ese radio, girar al máximo la mantiene en el círculo)
    const turnRad = ((roomConfig && +roomConfig.turnDegrees) || 40) * Math.PI / 180;
    const dead = Math.max(segmentSize * MOUSE_DEADZONE_CELLS, segmentSize / turnRad + 2);
    if (dx * dx + dy * dy < dead * dead) return;
    steerThrottled(Math.atan2(dy, dx), now);
  }

  // ---------------------------------------------------------------------------
  // Táctil: joystick flotante en la mitad izquierda y botón de disparo a la derecha.
  // El joystick pide un rumbo absoluto (empujar a la derecha = ir a la derecha); al soltarlo la
  // serpiente sigue derecho con el último rumbo.
  // ---------------------------------------------------------------------------
  const touchControls = $('touchControls');
  const stickZone = touchControls ? touchControls.querySelector('.touch-stick-zone') : null;
  const stickBase = touchControls ? touchControls.querySelector('.touch-stick') : null;
  const stickKnob = touchControls ? touchControls.querySelector('.touch-stick-knob') : null;
  const fireButton = touchControls ? touchControls.querySelector('.touch-fire') : null;
  const anchorButton = touchControls ? touchControls.querySelector('.touch-anchor') : null;
  const STICK_RADIUS = 46;          // recorrido del pulgar hasta el tope (px)
  const STICK_DEADZONE = 10;        // por debajo, el toque no cambia el rumbo
  const STICK_REST_MARGIN = 28;     // en reposo, separado de la esquina inferior izquierda
  const stick = { id: null, x: 0, y: 0, angle: null };
  let touchSeen = false;            // hubo toques en esta pestaña (o el puntero principal es táctil)
  let touchShown = false;
  let fireReady = null;
  let fireTimer = 0;               // disparo continuo mientras el botón sigue apretado
  let anchorShownState = '', anchorShownP = '';

  // Estado del ancla propia, medido con la hora del servidor del instante dibujado y no con
  // Date.now(): el reloj del cliente puede estar desfasado. progress: lo que queda anclada, o lo que
  // lleva la recarga.
  const anchorView = { state: 'ready', progress: 1 };
  function anchorState(me) {
    const cfg = roomConfig && roomConfig.anchor;
    const rt = renderServerT;
    anchorView.state = 'ready';
    anchorView.progress = 1;
    if (!me || !cfg || !rt) return anchorView;
    if (rt < (me.anchoredUntil || 0)) {
      anchorView.state = 'anchored';
      anchorView.progress = Math.max(0, Math.min(1, (me.anchoredUntil - rt) / cfg.lastsMs));
    } else if (rt < (me.anchorReadyAt || 0)) {
      anchorView.state = 'recharging';
      anchorView.progress = Math.max(0, Math.min(1, 1 - (me.anchorReadyAt - rt) / cfg.rechargeMs));
    }
    return anchorView;
  }

  function setStickBase(x, y) {
    stick.x = x;
    stick.y = y;
    stickBase.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
  }
  function setKnob(dx, dy) {
    stickKnob.style.transform = dx || dy ? 'translate3d(' + dx + 'px,' + dy + 'px,0)' : '';
  }
  function stickToRest() {
    if (!stickZone) return;
    const r = stickZone.getBoundingClientRect();
    const cs = getComputedStyle(stickZone);
    const half = (stickBase.offsetWidth || 128) / 2;
    setStickBase(parseFloat(cs.paddingLeft) + STICK_REST_MARGIN + half,
      r.height - parseFloat(cs.paddingBottom) - STICK_REST_MARGIN - half);
    setKnob(0, 0);
    touchControls.setAttribute('data-stick', 'idle');
  }

  // Visibles para quien juega (no para quien mira) desde la cuenta regresiva: así se puede apoyar el
  // pulgar antes del "¡Ya!" y el rumbo sale apenas empieza la partida
  function updateTouchControls(me) {
    if (!touchControls) return;
    const playing = isConnected && !!currentRoomId && !isSpectating && (countdownActive || canSteer());
    const show = playing && (touchSeen || !!(coarseQuery && coarseQuery.matches));
    if (show !== touchShown) {
      touchShown = show;
      stick.id = null;
      touchControls.hidden = !show;
      if (show) stickToRest();
      else onFireUp();
    }
    if (!show) return;
    const ready = !!(me && me.renderSegments && me.renderSegments.length >= 2);
    if (ready !== fireReady) {
      fireReady = ready;
      fireButton.setAttribute('data-ready', ready ? 'true' : 'false');
    }
    if (anchorButton) {
      const an = anchorState(me);
      if (an.state !== anchorShownState) { anchorShownState = an.state; anchorButton.setAttribute('data-state', an.state); }
      const p = an.progress.toFixed(2);
      if (p !== anchorShownP) { anchorShownP = p; anchorButton.style.setProperty('--p', p); }
    }
  }

  // Cualquier toque fuera del botón de disparo maneja el joystick (también un mouse, como el de la
  // emulación táctil de DevTools): no hay zonas muertas
  function onStickDown(event) {
    if (stick.id !== null || !touchShown) return;
    event.preventDefault();
    touchSeen = true;
    stick.id = event.pointerId;
    try { stickZone.setPointerCapture(event.pointerId); } catch (e) { /* nada */ }
    const r = stickZone.getBoundingClientRect();
    setStickBase(event.clientX - r.left, event.clientY - r.top);
    setKnob(0, 0);
    stick.angle = null;
    steerMode = 'touch';
    touchControls.setAttribute('data-stick', 'active');
  }
  function onStickMove(event) {
    if (event.pointerId !== stick.id) return;
    event.preventDefault();
    const r = stickZone.getBoundingClientRect();
    const px = event.clientX - r.left;
    const py = event.clientY - r.top;
    let dx = px - stick.x;
    let dy = py - stick.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > STICK_RADIUS) {
      // La base sigue al pulgar: para ir hacia el otro lado no hace falta recorrer el doble
      const k = (dist - STICK_RADIUS) / dist;
      setStickBase(stick.x + dx * k, stick.y + dy * k);
      dx = px - stick.x;
      dy = py - stick.y;
    }
    setKnob(dx, dy);
    if (dist > STICK_DEADZONE) {
      const first = stick.angle === null;
      stick.angle = Math.atan2(dy, dx);
      if (first) emitSteer(stick.angle, perfNow()); // el primer rumbo sale enseguida
    }
  }
  function onStickEnd(event) {
    if (event.pointerId !== stick.id) return;
    // Al soltar, manda el último rumbo si el throttle lo había retenido
    if (stick.angle !== null && (lastSteerAngle === null || angleGap(stick.angle, lastSteerAngle) > 1e-6)) emitSteer(stick.angle, perfNow());
    stick.id = null;
    stickToRest();
  }

  // Mantener apretado dispara en continuo, como la barra espaciadora: un pedido por cada pausa entre
  // tiros (el servidor igual la hace cumplir)
  function onFireDown(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.pointerType !== 'mouse') touchSeen = true;
    if (!canSteer()) return;
    fireButton.classList.add('is-pressed');
    socket.emit('attack');
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* nada */ } }
    clearInterval(fireTimer);
    const every = (roomConfig && +roomConfig.shotCooldownMs) || 200;
    fireTimer = setInterval(function () {
      if (!canSteer() || !touchShown) { onFireUp(); return; }
      socket.emit('attack');
    }, every);
  }
  function onFireUp() {
    clearInterval(fireTimer);
    fireTimer = 0;
    fireButton.classList.remove('is-pressed');
  }

  function onAnchorDown(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.pointerType !== 'mouse') touchSeen = true;
    if (!canSteer()) return;
    anchorButton.classList.add('is-pressed');
    socket.emit('anchor');
    if (navigator.vibrate) { try { navigator.vibrate(20); } catch (e) { /* nada */ } }
  }
  function onAnchorUp() { anchorButton.classList.remove('is-pressed'); }

  if (touchControls && stickZone && stickBase && stickKnob && fireButton) {
    stickZone.addEventListener('pointerdown', onStickDown);
    stickZone.addEventListener('pointermove', onStickMove);
    stickZone.addEventListener('pointerup', onStickEnd);
    stickZone.addEventListener('pointercancel', onStickEnd);
    stickZone.addEventListener('lostpointercapture', onStickEnd);
    fireButton.addEventListener('pointerdown', onFireDown);
    fireButton.addEventListener('pointerup', onFireUp);
    fireButton.addEventListener('pointercancel', onFireUp);
    fireButton.addEventListener('pointerleave', onFireUp);
    if (anchorButton) {
      anchorButton.addEventListener('pointerdown', onAnchorDown);
      anchorButton.addEventListener('pointerup', onAnchorUp);
      anchorButton.addEventListener('pointercancel', onAnchorUp);
      anchorButton.addEventListener('pointerleave', onAnchorUp);
    }
    touchControls.addEventListener('contextmenu', function (event) { event.preventDefault(); });
    window.addEventListener('resize', function () { if (touchShown && stick.id === null) stickToRest(); });
  }
  // Aviso de girar el teléfono (lo muestra el CSS): donde se puede (Android), pantalla completa y
  // orientación fija en horizontal con un toque
  const rotateFull = document.querySelector('.rotate-hint-full');
  if (rotateFull && document.fullscreenEnabled && window.screen && screen.orientation && screen.orientation.lock) {
    rotateFull.hidden = false;
    rotateFull.addEventListener('click', function () {
      const root = document.documentElement;
      const full = document.fullscreenElement ? Promise.resolve() : root.requestFullscreen({ navigationUI: 'hide' });
      Promise.resolve(full)
        .then(function () { return screen.orientation.lock('landscape'); })
        .catch(function () { /* el navegador no deja fijar la orientación: queda el aviso */ });
    });
  }

  // Cualquier toque cuenta: en una laptop táctil el joystick aparece recién cuando se usa la pantalla
  window.addEventListener('pointerdown', function (event) { if (event.pointerType === 'touch') touchSeen = true; }, { capture: true, passive: true });

  document.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', function () { heldArrows.clear(); clearTimeout(keyReleaseTimer); });
  window.addEventListener('pointermove', handlePointerMove, { passive: true });
  if (arenaStage) {
    arenaStage.addEventListener('pointerdown', handlePointerDown);
    // En partida, el clic derecho sobre la arena es el ancla: sin menú contextual
    arenaStage.addEventListener('contextmenu', function (event) { if (canSteer()) event.preventDefault(); });
  }

  // ===========================================================================
  // Serpientes locales
  // ===========================================================================
  function createLocalSnake(serverSnake) {
    const snake = new Snake(
      serverSnake.id,
      serverSnake.name,
      segmentSize,
      arenaW(),
      arenaH(),
      serverSnake.segments[0].x,
      serverSnake.segments[0].y,
      serverSnake.direction.x,
      serverSnake.direction.y,
      serverSnake.color,
      roomConfig.gameSpeed || 91
    );

    snake.segments = serverSnake.segments.map(function (seg) { return { x: seg.x, y: seg.y }; });
    snake.targetSegments = serverSnake.segments.map(function (seg) { return { x: seg.x, y: seg.y }; });
    snake.renderSegments = serverSnake.segments.map(function (seg) { return { x: seg.x, y: seg.y }; });
    snake.direction = { x: serverSnake.direction.x, y: serverSnake.direction.y };
    snake.score = serverSnake.score;
    snake.gameover = serverSnake.gameover;
    snake.scoreLeftToGrow = serverSnake.scoreLeftToGrow;
    snake.effects = serverSnake.effects || {};
    snake.anchoredUntil = serverSnake.anchoredUntil || 0;
    snake.anchorReadyAt = serverSnake.anchorReadyAt || 0;

    return snake;
  }

  function copySegments(list) {
    return list.map(function (seg) { return { x: seg.x, y: seg.y }; });
  }

  function rebuildPreview() {
    const me = isSpectating ? null : socket.id;
    previewList = snakes.map(function (s) {
      return { id: s.id, name: s.name, color: s.color, isMe: me !== null && s.id === me };
    });
  }


  // ===========================================================================
  // Arena: configuración y bucle de render (un único requestAnimationFrame)
  // ===========================================================================
  if (Arena && canvas) {
    ui(function () {
      Arena.init(canvas);
      Arena.setConfig({ segmentSize: segmentSize, width: arenaW(), height: arenaH() });
    });
  }

  function applyArenaConfig() {
    if (!Arena) return;
    const reach = (roomConfig && +roomConfig.bigMouthReach) || 0;
    const anchorMs = (roomConfig && roomConfig.anchor && +roomConfig.anchor.lastsMs) || 0;
    ui(function () { Arena.setConfig({ segmentSize: segmentSize, width: arenaW(), height: arenaH(), bigMouthReach: reach, anchorLastsMs: anchorMs }); });
  }

  // Objetos reutilizados por frame (sin allocations en el bucle)
  const arenaState = {
    snakes: snakes, foods: foods, consumables: consumables, projectiles: clientProjectiles,
    myId: null, roundTimeLeft: 0, playing: false, spectating: false, serverT: 0, leaderId: null
  };
  const idleOptions = { snakesPreview: previewList, caption: '' };

  function fillArenaState() {
    arenaState.snakes = snakes;
    arenaState.foods = foods;
    arenaState.consumables = consumables;
    arenaState.projectiles = clientProjectiles;
    arenaState.myId = socket.id;
    arenaState.roundTimeLeft = roundTimeLeft;
    arenaState.playing = !!gameState.playing;
    arenaState.spectating = isSpectating;
    arenaState.serverT = renderServerT;
    arenaState.leaderId = crownId;
  }

  function renderFrame(now) {
    requestAnimationFrame(renderFrame);
    if (!Arena || !canvas) return;
    // La arena solo se dibuja cuando se ve: sala, partida y debajo del velo del final
    const scene = Scenes.current();
    if (scene !== 'room' && scene !== 'game' && scene !== 'final') return;
    try {
      if (roundLive) {
        applyTimeline(now);
        fillArenaState();
        Arena.render(arenaState, now);
      } else if (now < freezeUntil) {
        // Fin de la partida: el último estado queda congelado (sin interpolar) mientras la arena enfoca
        // al ganador, antes de la pantalla final.
        fillArenaState();
        Arena.render(arenaState, now);
      } else {
        idleOptions.snakesPreview = previewList;
        idleOptions.caption = scene === 'room' && !countdownActive ? idleCaption : '';
        Arena.renderIdle(now, idleOptions);
      }
      // Rumbo del mouse (desde la cabeza recién dibujada) o del joystick; mira y controles táctiles
      updateSteering(perfNow());
    } catch (err) {
      reportOnce(err);
    }
  }
  requestAnimationFrame(renderFrame);

  // Eventos visuales del frame del servidor → ganchos de la arena.
  // Los disparos van primero: ocurrieron entre ticks, antes de los impactos del mismo frame
  // (así la arena ya conoce el color de un proyectil que expira en el mismo tick).
  function callEach(list, fn) {
    if (!list || !list.length || typeof fn !== 'function') return;
    for (let i = 0; i < list.length; i++) {
      try { fn(list[i]); } catch (err) { reportOnce(err); }
    }
  }
  function dispatchFrameEvents(data) {
    if (!Arena) return;
    callEach(data.projectileEvents, Arena.onProjectileFired);
    callEach(data.foodEvents, Arena.onFoodEaten);
    callEach(data.hitEvents, Arena.onHit);          // la arena ya sacude y hace el pulso de fondo si soy la víctima
    callEach(data.blockEvents, Arena.onBlock);
    callEach(data.portals, Arena.onPortal);
    callEach(data.expiredProjectiles, Arena.onProjectileExpired);
    callEach(data.consumableEvents, Arena.onConsumablePicked);
  }

  // ===========================================================================
  // HUD y tensión
  // ===========================================================================
  function hudPlayers() {
    return snakes.map(function (s) {
      // El servidor solo manda los efectos vigentes: con el reloj del cliente desfasado, la hora no decide
      const shieldEnd = s.effects ? s.effects.immunity : 0;
      const immune = !!shieldEnd;
      return {
        id: s.id,
        name: s.name,
        color: s.color,
        score: s.score,
        immune: immune,
        immuneUntil: immune ? shieldEnd : 0,
        effects: s.effects || null,
        isMe: !isSpectating && s.id === socket.id,
        gameover: !!s.gameover
      };
    });
  }

  function updateHUD() {
    if (!currentRoomId) return;
    let me = null;
    if (!isSpectating) for (let i = 0; i < snakes.length; i++) if (snakes[i].id === socket.id) { me = snakes[i]; break; }
    ui(function () {
      HUD.update({
        timeLeft: roundTimeLeft,
        roundTime: roundTime(),
        players: hudPlayers(),
        playing: roundLive,
        spectating: isSpectating,
        anchor: me && roomConfig && roomConfig.anchor ? anchorState(me) : null,
        touch: touchShown
      });
    });
  }

  // Últimos 10 segundos: ambiente de tensión y un pulso coral por segundo nuevo
  function checkTension() {
    if (!roundLive) return;
    const t = roundTimeLeft;
    if (t > 10 || t < 0) return;
    if (!tensionOn) {
      tensionOn = true;
      ui(function () { Backdrop.setMood('tension'); });
    }
    if (t > 0 && t !== lastPulseSecond) {
      lastPulseSecond = t;
      ui(function () { Backdrop.pulse('#FF4D6D', 0.15); });
    }
  }
  function resetTension() {
    tensionOn = false;
    lastPulseSecond = -1;
    frenzyOn = false;
  }

  // Frenesí (últimos 20 s): un aviso y un pulso lima del fondo cuando empieza
  function checkFrenzy() {
    if (!roundLive || frenzyOn || !gameState || !gameState.frenzy) return;
    frenzyOn = true;
    toast('Frenesí: más comida hasta el final', 'info', 3000);
    ui(function () { Backdrop.pulse('#C8FF3C', 0.25); });
  }

  // ===========================================================================
  // Socket: conexión
  // ===========================================================================
  socket.on('connect', function () {
    const reconnect = hasConnectedOnce;
    const afterReplacement = sessionReplaced;
    hasConnectedOnce = true;
    isConnected = true;
    sessionReplaced = false;
    if (reconnect) {
      // El servidor ya nos sacó de la sala al caer la conexión: volver al lobby y reenganchar el perfil
      if (currentRoomId) {
        leaveRoomLocally();
        ui(function () { Overlays.hideAll(); Scenes.go(playerProfile ? 'lobby' : 'login'); });
      }
      // Si el servidor todavía tiene el socket viejo (corte del lado del cliente), el mismo playerId
      // le indica que es esta sesión que vuelve: reemplaza al viejo (index.js, getOrCreateProfile)
      if (playerProfile && currentPlayerId && playerProfile.stats) {
        cancelProfileRetry();
        requestSavedProfile({ stats: playerProfile.stats, playerId: currentPlayerId });
      }
      if (!afterReplacement) toast('Conexión restablecida', 'success');
    }
    refreshRooms();
  });

  socket.on('disconnect', function () {
    isConnected = false;
    roundLive = false;
    if (!sessionReplaced) toast('Se perdió la conexión con el servidor', 'error');
  });

  // Otra pestaña o dispositivo abrió esta misma sesión: el servidor la mueve allá y nos desconecta.
  // La sesión guardada (localStorage) es de las dos pestañas, así que no se borra.
  socket.on('sessionReplaced', function () {
    sessionReplaced = true;
    cancelProfileRetry();
    autoProfilePending = false;
    if (currentRoomId) leaveRoomLocally();
    playerProfile = null;
    currentPlayerId = null;
    setJoinBusy(false);
    updateProfileDisplay(null);
    updateLogoutButtonVisibility();
    ui(function () {
      Overlays.hideAll();
      Overlays.close(leaderboardModal);
      Scenes.go('login');
    });
    toast('Abriste tu sesión en otra pestaña o dispositivo. Entra de nuevo para seguir aquí.', 'info', 6000);
  });

  socket.on('gameError', function (message) {
    clearPendingButton();
    startRequested = false;
    if (String(message) === NOT_ENOUGH_PLAYERS) handleRoundAborted();
    syncRoomControls();
    toast(translateServerMessage(message), 'error');
  });

  // La partida se cortó porque se fueron jugadores (index.js, handlePlayerLeaveRoom)
  function handleRoundAborted() {
    roundLive = false;
    freezeUntil = 0;
    countdownActive = false;
    gameState = Object.assign({}, gameState, { playing: false });
    resetTimeline();
    resetTension();
    ui(function () { Overlays.hideAll(); });
    if (isSpectating) {
      socket.emit('backToMenu');
      leaveRoomLocally();
      ui(function () { Scenes.go('lobby'); });
      return;
    }
    ui(function () { Scenes.go('room'); });
    updatePlayerList();
    updateConfigPanel();
    updateOnlinePlayersList(onlinePlayers);
  }

  // ===========================================================================
  // Socket: salas
  // ===========================================================================
  function enterRoom(data, created) {
    clearPendingButton();
    isSpectating = false;
    currentRoomId = data.roomId;
    isHost = !!data.isHost;
    roomConfig = data.config || {};
    segmentSize = roomConfig.segmentSize || segmentSize;
    if (isHost) { roomHostId = socket.id; roomHostName = currentUsername(); }
    roundLive = false;
    freezeUntil = 0;
    countdownActive = false;
    startRequested = false;
    matchFinished = false;
    resetTension();
    knownPlayerIds = new Set();
    // El código (escrito o cargado por una invitación) ya cumplió: no queda en el campo al volver al lobby
    if (roomIdInput) { roomIdInput.value = ''; clearInvalid(roomIdInput); }

    if (data.playerProfile) {
      playerProfile = data.playerProfile;
      currentPlayerId = data.playerProfile.playerId;
      savePlayerProfile(data.playerProfile);
      updateProfileDisplay(data.playerProfile.stats);
    }

    ui(function () { HUD.reset(); });
    applyArenaConfig();
    updateConfigInputs(roomConfig);
    updateConfigPanel();
    updateSpectatorIndicator();
    updateRoomInfo();
    syncRoomControls();
    ui(function () { Overlays.hideAll(); Scenes.go('room'); });

    if (created) toast('Sala ' + data.roomId + ' creada. Comparte el código para invitar.', 'success');
    else toast('Entraste a la sala ' + data.roomId, 'success');

    // Actualizar lista de jugadores (ahora con botones de invitar)
    socket.emit('getOnlinePlayers');
  }

  socket.on('roomCreated', function (data) { enterRoom(data, true); });
  socket.on('roomJoined', function (data) { enterRoom(data, false); });

  socket.on('roomsList', function (rooms) {
    updateRoomsList(rooms);
  });

  socket.on('newHost', function (data) {
    roomHostId = data.hostId;
    roomHostName = data.hostName || '';
    if (data.hostId === socket.id && !isSpectating) {
      isHost = true;
      toast('Ahora eres el anfitrión de la sala', 'info');
    }
    updateRoomInfo();
    updatePlayerList();
    syncRoomControls();
    updateConfigPanel();
  });

  socket.on('updatePlayers', function (players, state, config, roomData) {
    snakes = players.map(function (serverPlayer) {
      const existingSnake = snakes.find(function (s) { return s.id === serverPlayer.id; });
      if (existingSnake) {
        existingSnake.segments = copySegments(serverPlayer.segments);
        existingSnake.targetSegments = copySegments(serverPlayer.segments);
        existingSnake.direction = { x: serverPlayer.direction.x, y: serverPlayer.direction.y };
        existingSnake.score = serverPlayer.score;
        existingSnake.gameover = serverPlayer.gameover;
        existingSnake.scoreLeftToGrow = serverPlayer.scoreLeftToGrow;
        existingSnake.color = serverPlayer.color;
        existingSnake.effects = serverPlayer.effects || {};
        return existingSnake;
      }
      return createLocalSnake(serverPlayer);
    });

    gameState = state;
    roomConfig = config;
    if (config && config.segmentSize && config.segmentSize !== segmentSize) {
      segmentSize = config.segmentSize;
      applyArenaConfig();
    }
    if (roomData) {
      roomHostId = roomData.host;
      if (!isSpectating) isHost = roomData.host === socket.id;
      const hostSnake = snakes.find(function (s) { return s.id === roomData.host; });
      if (hostSnake) roomHostName = hostSnake.name;
    }

    // La cuenta regresiva se cancela si alguien se va y no alcanza el mínimo
    if (countdownActive && !state.playing && players.length < (config.minPlayers || 2)) {
      countdownActive = false;
      ui(function () { Overlays.hideAll(); });
    }
    // "No quedan jugadores suficientes" estando en partida y sin fin de partida pendiente (spec 4.1)
    if (!state.playing && Scenes.current() === 'game' && !isSpectating && !matchFinished && freezeUntil <= perfNow() && !countdownActive) {
      roundLive = false;
      ui(function () { Scenes.go('room'); });
    }

    rebuildPreview();
    updatePlayerList();
    updateRoomInfo();
    syncRoomControls();
    updateConfigPanel();
    // Al terminar la partida el servidor ya reinició la sala (largo 3): el marcador conserva el
    // resultado mientras la arena congelada y la pantalla final lo muestran
    if (Scenes.current() === 'game' && !matchFinished) updateHUD();

    // Actualizar lista de jugadores en línea cuando cambie el estado
    socket.emit('getOnlinePlayers');
  });

  // Firma de lo editable (el nivel): el anfitrión reenvía la misma configuración al iniciar
  // y eso no debe disparar el aviso "Configuración actualizada" en toda la sala.
  function configSignature(config) {
    return config ? String(config.difficulty || '') : '';
  }

  socket.on('configUpdated', function (newConfig) {
    const changed = configSignature(newConfig) !== configSignature(roomConfig);
    roomConfig = newConfig;
    updateConfigInputs(newConfig);
    segmentSize = newConfig.segmentSize;
    applyArenaConfig();
    if (changed) toast('Configuración actualizada', 'success');
  });

  // ===========================================================================
  // Socket: partida
  // ===========================================================================
  socket.on('countdown', function (count, state) {
    if (state) gameState = state;
    countdownActive = true;
    startRequested = false;
    matchFinished = false;
    roundTimeLeft = roundTime(); // el anillo del HUD arranca lleno para la partida que viene
    // La arena pasa al tamaño de partida al empezar la cuenta, no al largar: así la partida arranca
    // sobre una arena quieta. "Jugar de nuevo": quien sigue en la pantalla final vuelve a la arena.
    ui(function () {
      const scene = Scenes.current();
      if (scene === 'room' || scene === 'final') Scenes.go('game');
      Overlays.countdown(count);
    });
    syncRoomControls();
    updateConfigPanel();
    if (Scenes.current() === 'game') updateHUD();
  });

  socket.on('gameStart', function (data) {
    // Un espectador sigue siéndolo en las partidas siguientes: solo es jugador si figura en la lista
    isSpectating = !!currentRoomId && !data.players.some(function (p) { return p.id === socket.id; });
    roomConfig = data.config;
    segmentSize = data.config.segmentSize;

    snakes = data.players.map(function (serverPlayer) { return createLocalSnake(serverPlayer); });
    foods = data.foods || [];
    consumables = data.consumables || [];
    // Los proyectiles vivos al terminar la partida anterior desaparecen sin evento
    restartTimeline(data);
    gameState = data.gameState;
    roundTimeLeft = data.gameState.roundTimeLeft !== undefined ? data.gameState.roundTimeLeft : roundTime();

    roundLive = true;
    resetSteering();
    freezeUntil = 0;
    countdownActive = false;
    startRequested = false;
    matchFinished = false;
    resetTension();
    rebuildPreview();

    applyArenaConfig();
    if (Arena) ui(function () { Arena.onRoundStart(); });
    ui(function () {
      Scenes.go('game');
      Overlays.roundStart();
      HUD.show();
      Backdrop.setMood('game');
    });
    updateHUD();
    updateSpectatorIndicator();
    updateRoomInfo();
    syncRoomControls();
    updateConfigPanel();

    // Actualizar lista sin botones de invitar (juego activo)
    socket.emit('getOnlinePlayers');
  });

  socket.on('spectatingStarted', function (data) {
    clearPendingButton();
    isSpectating = true;
    isHost = false;
    currentRoomId = data.roomId;

    roomConfig = data.config || {};
    segmentSize = roomConfig.segmentSize || segmentSize;

    snakes = data.players.map(function (serverPlayer) { return createLocalSnake(serverPlayer); });
    foods = data.foods || [];
    consumables = data.consumables || [];
    restartTimeline(data);
    gameState = data.gameState;
    roundTimeLeft = data.roundTimeLeft || roundTime();

    roundLive = !!(data.gameState && data.gameState.playing);
    freezeUntil = 0;
    countdownActive = false;
    matchFinished = false;
    resetTension();
    knownPlayerIds = new Set();
    rebuildPreview();

    ui(function () { HUD.reset(); });
    applyArenaConfig();
    updateRoomInfo();
    updateSpectatorIndicator();
    updatePlayerList();
    syncRoomControls();
    updateConfigPanel();
    ui(function () {
      Overlays.hideAll();
      Scenes.go('game');
      HUD.show();
    });
    updateHUD();
    toast('Mirando la sala ' + data.roomId, 'info');
  });

  socket.on('spectatorJoined', function (data) {
    if (isSpectating) return; // no mostrar a otros espectadores
    toast((data && data.spectatorName ? data.spectatorName : 'Alguien') + ' está mirando la partida', 'info');
  });

  socket.on('spectatorLeft', function () {
    // Sin cambios visibles por ahora
  });

  socket.on('roundTimeUpdate', function (timeLeft) {
    roundTimeLeft = timeLeft;
    updateHUD();
    checkTension();
  });

  socket.on('gameLogicFrame', function (data) {
    if (!data || !currentRoomId) return;

    // 1. Posiciones, comida, proyectiles y eventos de la arena: entran a la línea de tiempo y se
    //    aplican cuando el render alcanza este frame (applyTimelineSample)
    if (timeline) {
      timeline.push(timelineFrame(data, data.timestamp), perfNow());
    } else {
      dispatchTimelineFrame({ payload: data });
      foods = data.foods || [];
      consumables = data.consumables || [];
      clientProjectiles = data.projectiles || [];
    }

    // 2. Estado autoritativo para el HUD: al instante
    snakes.forEach(function (localSnake) {
      const serverSnake = data.players.find(function (p) { return p.id === localSnake.id; });
      if (serverSnake) {
        localSnake.segments = copySegments(serverSnake.segments);
        if (!timeline) {
          localSnake.renderSegments = copySegments(serverSnake.segments);
          localSnake.direction = { x: serverSnake.direction.x, y: serverSnake.direction.y };
          localSnake.effects = serverSnake.effects || {};
        }
        localSnake.score = serverSnake.score;
        localSnake.gameover = serverSnake.gameover;
        localSnake.scoreLeftToGrow = serverSnake.scoreLeftToGrow;
        localSnake.color = serverSnake.color;
      }
    });

    gameState = data.gameState;

    if (data.gameState && data.gameState.roundTimeLeft !== undefined) {
      roundTimeLeft = data.gameState.roundTimeLeft;
    }

    // 3. HUD y tensión
    updateHUD();
    checkTension();
    checkFrenzy();
  });

  // Fin de la partida: la arena se congela sobre el ganador y después entra la pantalla final.
  // La sala ya volvió a espera en el servidor: el anfitrión puede jugar de nuevo desde ahí.
  socket.on('gameEnd', function (data) {
    data = data || {};
    settleTimeline();
    roundLive = false;
    countdownActive = false;
    matchFinished = true;
    freezeUntil = perfNow() + FREEZE_MS;
    resetTension();
    gameState = Object.assign({}, gameState, { playing: false });

    const winners = Array.isArray(data.winners) ? data.winners : [];
    if (Arena) ui(function () { Arena.onRoundEnd({ winnerId: winners.length === 1 ? winners[0] : null }); });
    ui(function () { Backdrop.setMood('game'); }); // sale de tension
    clearTimeout(finalTimer);
    finalTimer = setTimeout(function () {
      finalTimer = 0;
      if (!matchFinished) return; // ya arrancó otra partida
      ui(function () { Overlays.final(data, { isMe: function (id) { return !isSpectating && id === socket.id; } }); });
      syncFinalControls();
    }, FINAL_DELAY_MS);

    if (currentPlayerId) {
      socket.emit('getPlayerStats', currentPlayerId);
    }
    updateHUD();
    updatePlayerList();
    syncRoomControls();

    // Actualizar lista con botones (partida terminada)
    socket.emit('getOnlinePlayers');
  });

  // El servidor actual no lo emite; se conserva por compatibilidad
  socket.on('roomFinished', function (data) {
    roundLive = false;
    countdownActive = false;
    resetTension();
    ui(function () {
      Overlays.final({ ranking: [], winners: [], reason: (data && data.reason) || 'La sala se cerró' }, {});
    });
  });

  // ===========================================================================
  // Socket: perfil, ranking, menú
  // ===========================================================================
  socket.on('playerStats', function (data) {
    if (data.playerId === currentPlayerId) {
      playerProfile = data;
      savePlayerProfile(data);
      updateProfileDisplay(data.stats);
    }
  });

  socket.on('profileLoaded', function (profile) {
    autoProfilePending = false;
    cancelProfileRetry();
    playerProfile = profile;
    currentPlayerId = profile.playerId;
    savePlayerProfile(profile);
    updateProfileDisplay(profile.stats);
    setJoinBusy(false);
    clearInvalid(usernameInput);
    updateLogoutButtonVisibility();

    const scene = Scenes.current();
    if (!currentRoomId && (scene === null || scene === 'intro' || scene === 'login')) {
      ui(function () { Scenes.go('lobby', { greeting: profile.stats.name }); });
    }
    refreshRooms();

    // Pedir la lista de jugadores después de un breve delay
    setTimeout(function () {
      socket.emit('getOnlinePlayers');
    }, 500);
  });

  socket.on('profileError', function (message) {
    const automatic = autoProfilePending;
    autoProfilePending = false;
    const nameBusy = /ya está conectado/i.test(String(message));

    // Re-registro automático y el nombre figura conectado: casi siempre es nuestro propio socket viejo
    // que el servidor todavía no descartó. Se reintenta con espera creciente sin tocar la sesión guardada.
    if (automatic && nameBusy && playerProfile && currentPlayerId && profileRetryCount < PROFILE_RETRY_MAX) {
      const delay = Math.min(15000, 1500 * Math.pow(2, profileRetryCount));
      profileRetryCount++;
      if (profileRetryCount === 1) toast('Recuperando tu sesión…', 'info', 4000);
      if (profileRetryTimer) clearTimeout(profileRetryTimer);
      const retryProfile = { stats: playerProfile.stats, playerId: currentPlayerId };
      profileRetryTimer = setTimeout(function () {
        profileRetryTimer = 0;
        if (isConnected) requestSavedProfile(retryProfile);
      }, delay);
      return;
    }
    cancelProfileRetry();

    const typedByUser = !automatic && Scenes.current() === 'login';
    toast(translateServerMessage(message), 'error');

    if (automatic) {
      // La sesión guardada no se borra por un fallo automático: el próximo intento (o el login manual
      // con el mismo nombre, ver buildIdentity) la recupera. Solo se suelta el perfil en memoria.
      playerProfile = null;
      currentPlayerId = null;
    } else {
      clearPlayerProfile();
    }
    setJoinBusy(false);
    if (typedByUser) markInvalid(usernameInput);
    else if (!automatic) usernameInput.value = '';
    updateProfileDisplay(null);
    updateLogoutButtonVisibility();
    if (currentRoomId) leaveRoomLocally();
    ui(function () { Scenes.go('login'); });
  });

  socket.on('leaderboard', function (leaderboard) {
    showLeaderboard(leaderboard);
  });

  socket.on('backToMenuSuccess', function () {
    leaveRoomLocally();
    ui(function () { Scenes.go('lobby'); }); // no-op si ya se pidió desde el botón
    refreshRooms();

    // Actualizar lista sin botones (fuera de sala)
    socket.emit('getOnlinePlayers');
  });

  socket.on('onlinePlayersList', function (players) {
    updateOnlinePlayersList(players);
    // El servidor reenvía esta lista ante cada cambio de salas: en el lobby, la lista de salas se refresca con ella
    if (Scenes.current() === 'lobby') scheduleRoomsRefresh();
  });

  socket.on('invitationReceived', function (invitationData) {
    handleInvitationReceived(invitationData);
  });

  socket.on('invitationSent', function (data) {
    toast('Invitación enviada a ' + data.toPlayer, 'success');
  });

  // Estado local al salir de una sala (vuelta al lobby, cierre de sesión o reconexión)
  function leaveRoomLocally() {
    clearTimeout(finalTimer); finalTimer = 0;
    currentRoomId = null;
    isHost = false;
    isSpectating = false;
    roomHostId = null;
    roomHostName = '';
    roomConfig = {};
    gameState = { playing: false, round: 1 };
    snakes = [];
    foods = [];
    consumables = [];
    resetTimeline();
    roundLive = false;
    freezeUntil = 0;
    countdownActive = false;
    startRequested = false;
    matchFinished = false;
    resetTension();
    previewList = [];
    knownPlayerIds = new Set();
    ui(function () { HUD.reset(); });
    updateSpectatorIndicator();
    updateRoomInfo();
    updatePlayerList();
    syncRoomControls();
    updateConfigPanel();
    updateOnlinePlayersList(onlinePlayers);
  }

  // ===========================================================================
  // Panel de la sala
  // ===========================================================================
  function updateConfigPanel() {
    const visible = !!currentRoomId && !isSpectating && !gameState.playing && !roundLive && !countdownActive;
    toggleElement(configPanel, visible);
    if (!visible) return;
    if (isHost) {
      setConfigInputsEnabled(true);
      toggleConfigButton.textContent = 'Configuración';
    } else {
      setConfigInputsEnabled(false);
      toggleConfigButton.textContent = 'Ver configuración';
    }
    toggleConfigButton.setAttribute('aria-expanded', configSettings.classList.contains('hidden') ? 'false' : 'true');
  }

  function setConfigInputsEnabled(enabled) {
    difficultyInputs.forEach(function (input) { input.disabled = !enabled; });
  }

  function updateConfigInputs(config) {
    if (!config) return;
    const level = difficultyKey(config.difficulty);
    difficultyInputs.forEach(function (input) { input.checked = input.value === level; });
  }

  function readConfigInputs() {
    const checked = difficultyInputs.filter(function (input) { return input.checked; })[0];
    return { difficulty: checked ? checked.value : 'medium' };
  }

  // Botón de inicio, mensaje de espera y caption del modo atracción
  function syncRoomControls() {
    const inRoom = !!currentRoomId && !isSpectating;
    const count = snakes.length;
    const min = (roomConfig && roomConfig.minPlayers) || 2;
    const idleRoom = inRoom && !gameState.playing && !roundLive && !countdownActive;
    const canStart = idleRoom && isHost && count >= min;

    toggleElement(startGameButton, canStart);
    startGameButton.disabled = startRequested;

    let waitText = '';
    if (idleRoom) {
      if (count < min) {
        const missing = min - count;
        waitText = missing === 1 ? 'Falta 1 jugador para empezar' : 'Faltan ' + missing + ' jugadores para empezar';
      } else if (!isHost) {
        waitText = 'Esperando a que el anfitrión inicie la partida';
      }
    }
    if (waitText) {
      if (waitingSpan.textContent !== waitText) waitingSpan.textContent = waitText;
      showElement(waitingSpan);
    } else {
      hideElement(waitingSpan);
    }

    if (!idleRoom) idleCaption = '';
    else if (count < min) idleCaption = 'Esperando jugadores';
    else idleCaption = isHost ? 'Todo listo: inicia la partida cuando quieras' : 'Esperando al anfitrión';

    if (leaveRoomButton) toggleElement(leaveRoomButton, idleRoom);
    syncFinalControls();
  }

  // Botones de la pantalla final. El anfitrión puede jugar de nuevo con los que sigan en la sala; los
  // invitados vuelven a la sala o esperan; un espectador solo puede volver a las salas.
  function syncFinalControls() {
    if (!playAgainButton) return;
    const player = !!currentRoomId && !isSpectating;
    const min = (roomConfig && roomConfig.minPlayers) || 2;
    const missing = Math.max(0, min - snakes.length);
    toggleElement(playAgainButton, player && isHost);
    playAgainButton.disabled = startRequested || missing > 0;
    toggleElement(backToRoomButton, player);
    const leaveText = player ? 'Salir a las salas' : 'Volver a las salas';
    if (backToMenuButton.textContent !== leaveText) backToMenuButton.textContent = leaveText;
    backToMenuButton.classList.toggle('btn-quiet', player);
    backToMenuButton.classList.toggle('btn-primary', !player);
    let hint = '';
    if (player) {
      if (missing > 0) hint = missing === 1 ? 'Falta 1 jugador para jugar de nuevo' : 'Faltan ' + missing + ' jugadores para jugar de nuevo';
      else if (!isHost) hint = (roomHostName || 'El anfitrión') + ' puede iniciar otra partida';
    }
    if (finalHint.textContent !== hint) finalHint.textContent = hint;
    toggleElement(finalHint, !!hint);
  }

  function updatePlayerList() {
    if (!playerList) return;
    const playing = !!gameState.playing && roundLive;
    // En partida, por largo; en la sala, en el orden en que entraron
    const sortedPlayers = playing ? snakes.toSorted(function (a, b) { return b.score - a.score; }) : snakes;

    const nextIds = new Set();
    const frag = document.createDocumentFragment();
    sortedPlayers.forEach(function (player, index) {
      nextIds.add(player.id);
      const isMe = !isSpectating && player.id === socket.id;
      const listItem = el('li', 'player-item' + (player.gameover ? ' eliminated' : '') + (isMe ? ' current-player' : ''));
      if (!knownPlayerIds.has(player.id)) listItem.setAttribute('data-reveal', '');
      const colors = bio(player.color);
      listItem.style.setProperty('--c', colors.body);
      listItem.style.setProperty('--t', colors.text);

      listItem.appendChild(el('span', 'player-rank', index + 1));
      const dot = el('i', 'player-dot');
      dot.setAttribute('aria-hidden', 'true');
      listItem.appendChild(dot);
      const name = el('span', 'player-name', player.name);
      name.title = player.name;
      listItem.appendChild(name);
      if (player.id === roomHostId) listItem.appendChild(el('span', 'player-host', 'Anfitrión'));

      const score = el('span', 'player-score');
      if (playing) score.textContent = String(player.score);
      listItem.appendChild(score);

      const status = el('span', 'player-status');
      if (!player.gameover && player.effects && player.effects.immunity) {
        status.setAttribute('role', 'img');
        status.setAttribute('aria-label', 'Con escudo');
        status.appendChild(iconEl('i-medusa'));
      }
      listItem.appendChild(status);

      frag.appendChild(listItem);
    });

    playerList.replaceChildren(frag);
    knownPlayerIds = nextIds;

    if (playersCount) {
      const max = roomConfig && roomConfig.maxPlayers;
      playersCount.textContent = currentRoomId && snakes.length ? '(' + snakes.length + (max ? ' de ' + max : '') + ')' : '';
    }
  }

  function updateRoomInfo() {
    if (!roomInfo) return;
    clearNode(roomInfo);
    if (!currentRoomId) return;
    const title = el('p', 'room-title');
    title.appendChild(document.createTextNode('Sala'));
    title.appendChild(el('span', 'room-code', currentRoomId));
    roomInfo.appendChild(title);

    // El espectador ya lo ve en el badge del HUD y en la indicación de controles: sin línea de rol aquí
    if (isSpectating) return;
    const role = isHost ? 'Eres el anfitrión' : (roomHostName ? 'Anfitrión: ' + roomHostName : 'Anfitrión: otro jugador');
    roomInfo.appendChild(el('p', 'room-role', role));
  }

  function updateSpectatorIndicator() {
    toggleElement(spectatorBanner, isSpectating);
    if (!controlsHint) return;
    let variant = 'player';
    if (isSpectating) variant = 'spectator';
    else if (coarseQuery && coarseQuery.matches && !keyboardSeen) variant = 'touch';
    if (controlsHint.getAttribute('data-variant') !== variant) controlsHint.setAttribute('data-variant', variant);
  }

  // ===========================================================================
  // Lobby: lista de salas
  // ===========================================================================
  // Nivel conocido o "medium" (salas de un servidor viejo, espectador sin el campo)
  function difficultyKey(difficulty) {
    return Object.prototype.hasOwnProperty.call(DIFFICULTY_NAMES, difficulty) ? difficulty : 'medium';
  }

  // 120 -> "2 min", 90 -> "1 min 30 s", 10 -> "10 s"
  function durationText(seconds) {
    const m = Math.floor(seconds / 60), r = seconds % 60;
    if (!m) return r + ' s';
    return m + ' min' + (r ? ' ' + r + ' s' : '');
  }

  function roomConfigText(config) {
    const cfg = config || {};
    return 'Partida de ' + durationText(+cfg.roundTime || 120) + ', nivel ' + DIFFICULTY_NAMES[difficultyKey(cfg.difficulty)];
  }

  // Firma de lo que muestra una fila: si no cambió, la fila (y su botón, con foco o puntero encima) queda intacta
  function roomSignature(room) {
    const cfg = room.config || {};
    return [room.playing ? 1 : 0, room.players | 0, room.maxPlayers | 0, room.hostName || '',
      cfg.roundTime, cfg.difficulty || ''].join('|');
  }

  // Arma (o actualiza en el lugar) la fila de una sala. El botón de acción se conserva si la acción
  // no cambió: reconstruirlo le sacaba el foco y perdía el clic que cruzaba una actualización.
  function fillRoomItem(roomItem, room, code) {
    const isPlaying = !!room.playing;
    const count = room.players | 0;
    const max = Math.max(count, room.maxPlayers | 0);
    const full = !isPlaying && count >= max;
    const action = isPlaying ? 'spectate' : (full ? '' : 'join');

    let keepButton = null;
    const oldButton = roomItem.querySelector('button[data-action]');
    if (oldButton && action && oldButton.getAttribute('data-action') === action) keepButton = oldButton;
    Array.prototype.slice.call(roomItem.childNodes).forEach(function (child) {
      if (child !== keepButton) roomItem.removeChild(child);
    });

    roomItem.setAttribute('data-state', isPlaying ? 'playing' : (full ? 'full' : 'open'));

    const info = el('div', 'room-info');
    info.appendChild(el('span', 'room-code', code));
    if (isPlaying) info.appendChild(el('span', 'room-live', 'En juego'));
    const host = el('span', 'room-host', 'Anfitrión: ' + (room.hostName || ''));
    host.title = room.hostName || '';
    info.appendChild(host);
    const capacity = el('span', 'room-capacity');
    capacity.setAttribute('role', 'img');
    capacity.setAttribute('aria-label', count + ' de ' + max + ' jugadores');
    for (let i = 0; i < max && i < 16; i++) capacity.appendChild(el('i', i < count ? 'is-on' : null));
    info.appendChild(capacity);
    info.appendChild(el('span', 'room-config', roomConfigText(room.config)));
    roomItem.insertBefore(info, roomItem.firstChild);

    if (keepButton) return;
    if (action === 'spectate') {
      const spectate = el('button', 'join-room-btn is-spectate', 'Mirar');
      spectate.type = 'button';
      spectate.setAttribute('data-room-id', code);
      spectate.setAttribute('data-action', 'spectate');
      spectate.setAttribute('aria-label', 'Mirar la sala ' + code);
      roomItem.appendChild(spectate);
    } else if (action === 'join') {
      const join = el('button', 'join-room-btn', 'Unirse');
      join.type = 'button';
      join.setAttribute('data-room-id', code);
      join.setAttribute('data-action', 'join');
      join.setAttribute('aria-label', 'Unirse a la sala ' + code);
      roomItem.appendChild(join);
    } else {
      roomItem.appendChild(el('span', 'room-full', 'Llena'));
    }
  }

  function updateRoomsList(rooms) {
    if (!roomsList) return;
    const list = Array.isArray(rooms) ? rooms : [];
    const nextCodes = new Set();
    const ordered = [];

    list.forEach(function (room) {
      const code = String(room.id || '');
      if (!code || nextCodes.has(code)) return;
      nextCodes.add(code);
      const sig = roomSignature(room);
      let entry = roomNodes.get(code);
      if (!entry) {
        const li = el('li', 'room-item');
        if (!knownRoomCodes.has(code)) li.setAttribute('data-reveal', '');
        entry = { li: li, sig: '' };
        roomNodes.set(code, entry);
      } else if (entry.li.hasAttribute('data-reveal')) {
        entry.li.removeAttribute('data-reveal'); // la animación de entrada es solo para filas nuevas
      }
      if (entry.sig !== sig) {
        fillRoomItem(entry.li, room, code);
        entry.sig = sig;
      }
      ordered.push(entry.li);
    });

    // Fuera: salas que ya no están y cualquier otro nodo (mensaje de lista vacía, "Buscando salas…")
    roomNodes.forEach(function (entry, code) {
      if (!nextCodes.has(code)) roomNodes.delete(code);
    });
    Array.prototype.slice.call(roomsList.childNodes).forEach(function (child) {
      if (ordered.indexOf(child) === -1) roomsList.removeChild(child);
    });

    if (ordered.length === 0) {
      roomsList.appendChild(el('li', 'empty-room', 'No hay salas abiertas. Crea una y comparte el código.'));
    } else {
      // Solo se mueven las filas fuera de orden (mover un nodo enfocado le saca el foco)
      for (let i = 0; i < ordered.length; i++) {
        const current = roomsList.children[i];
        if (current !== ordered[i]) roomsList.insertBefore(ordered[i], current || null);
      }
    }
    knownRoomCodes = nextCodes;
  }

  roomsList.addEventListener('click', function (event) {
    const button = event.target.closest ? event.target.closest('button[data-action]') : null;
    if (!button || !roomsList.contains(button)) return;
    const roomId = button.getAttribute('data-room-id');
    if (button.getAttribute('data-action') === 'spectate') spectateRoom(roomId, button);
    else joinSpecificRoom(roomId, button);
  });

  function refreshRooms() {
    socket.emit('getRooms');
  }
  function scheduleRoomsRefresh() {
    if (roomsRefreshTimer) return;
    roomsRefreshTimer = setTimeout(function () {
      roomsRefreshTimer = 0;
      if (Scenes.current() === 'lobby') refreshRooms();
    }, 300);
  }

  function spectateRoom(roomId, button) {
    if (!playerProfile || !currentPlayerId) {
      toast('Inicia sesión para mirar partidas', 'error');
      return;
    }
    if (button) setPendingButton(button);
    socket.emit('spectateRoom', {
      roomId: roomId,
      spectatorName: playerProfile.stats.name
    });
  }

  function joinSpecificRoom(roomId, button) {
    const username = currentUsername();
    if (!isValidUsername(username)) {
      toast('El nombre debe tener entre 2 y 20 caracteres', 'error');
      ui(function () { Scenes.go('login'); });
      return;
    }
    if (button) setPendingButton(button);
    socket.emit('joinRoom', buildIdentity(username, { roomId: roomId }));
  }

  function joinRoomFromInput() {
    const username = currentUsername();
    const roomId = roomIdInput.value.trim().toUpperCase();

    if (!isValidUsername(username)) {
      toast('El nombre debe tener entre 2 y 20 caracteres', 'error');
      ui(function () { Scenes.go('login'); });
      return;
    }
    if (!roomId || roomId.length !== 6) {
      markInvalid(roomIdInput);
      toast('El código de sala tiene 6 caracteres', 'error');
      roomIdInput.focus();
      return;
    }
    clearInvalid(roomIdInput);
    setPendingButton(joinRoomButton);
    socket.emit('joinRoom', buildIdentity(username, { roomId: roomId }));
  }

  // ===========================================================================
  // Ranking global
  // ===========================================================================
  function requestLeaderboard() {
    if (leaderboardList) {
      leaderboardList.replaceChildren(el('li', 'leaderboard-item loading', 'Cargando ranking…'));
    }
    ui(function () { Overlays.open(leaderboardModal); });
    socket.emit('getLeaderboard');
  }

  function showLeaderboard(leaderboard) {
    if (!leaderboardList) return;
    // Primero quienes tienen 3 partidas o más, por porcentaje de victorias (orden original)
    const list = (Array.isArray(leaderboard) ? leaderboard : []).toSorted(function (a, b) {
      const aHasMinGames = a.games_played >= 3;
      const bHasMinGames = b.games_played >= 3;

      if (aHasMinGames && bHasMinGames) {
        const aWinRate = a.games_played > 0 ? (a.wins / a.games_played) : 0;
        const bWinRate = b.games_played > 0 ? (b.wins / b.games_played) : 0;
        if (aWinRate !== bWinRate) return bWinRate - aWinRate;
        return b.wins - a.wins;
      }
      if (!aHasMinGames && !bHasMinGames) {
        if (a.wins !== b.wins) return b.wins - a.wins;
        return b.games_played - a.games_played;
      }
      if (aHasMinGames && !bHasMinGames) return -1;
      if (!aHasMinGames && bHasMinGames) return 1;
      return 0;
    });

    const frag = document.createDocumentFragment();
    if (list.length === 0) {
      frag.appendChild(el('li', 'leaderboard-item is-empty', 'Todavía no hay partidas registradas.'));
    }
    list.forEach(function (player, index) {
      const item = el('li', 'leaderboard-item');
      const games = player.games_played | 0;
      const wins = player.wins | 0;
      item.appendChild(el('span', 'rank', index + 1));
      const name = el('span', 'name', player.name);
      name.title = player.name;
      item.appendChild(name);
      item.appendChild(el('span', 'wins', wins));
      item.appendChild(el('span', 'games', games));
      item.appendChild(el('span', 'winrate', (games > 0 ? Math.round((wins / games) * 100) : 0) + ' %'));
      frag.appendChild(item);
    });
    leaderboardList.replaceChildren(frag);
  }

  // ===========================================================================
  // Sesión
  // ===========================================================================
  function resetPlayerProfile() {
    socket.emit('logout', { currentRoomId: currentRoomId });
    cancelProfileRetry();
    autoProfilePending = false;

    clearPlayerProfile();
    leaveRoomLocally();
    usernameInput.value = '';
    clearInvalid(usernameInput);
    setJoinBusy(false);
    updateProfileDisplay(null);
    updateLogoutButtonVisibility();
    onlinePlayers = [];
    onlinePlayersList.replaceChildren(el('li', 'online-players-empty', 'Buscando jugadores…'));
    if (dockCount) dockCount.textContent = '';
    ui(function () {
      Overlays.hideAll();
      Overlays.close(leaderboardModal);
      Scenes.go('login');
    });
    toast('Sesión cerrada', 'info');
  }
  // Sin onclick en el HTML: una CSP estricta no permite manejadores en línea
  const resetProfileButton = $('resetProfileButton');
  if (resetProfileButton) resetProfileButton.addEventListener('click', resetPlayerProfile);

  function submitLogin() {
    const username = usernameInput.value.trim();
    if (isValidUsername(username)) {
      clearInvalid(usernameInput);
      setJoinBusy(true);
      cancelProfileRetry();
      autoProfilePending = false;
      // Tras "sesión abierta en otra pestaña" el servidor nos desconectó y socket.io no reconecta solo
      if (!socket.connected) socket.connect();
      socket.emit('getOrCreateProfile', buildIdentity(username));
    } else {
      markInvalid(usernameInput);
      toast('El nombre debe tener entre 2 y 20 caracteres', 'error');
      usernameInput.focus();
    }
  }

  // ===========================================================================
  // Listeners de la interfaz
  // ===========================================================================
  toggleConfigButton.addEventListener('click', function () {
    const opening = configSettings.classList.contains('hidden');
    toggleElement(configSettings, opening);
    toggleConfigButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
  });

  // El anfitrión cambia de nivel con un toque: el servidor lo reparte a toda la sala
  difficultyInputs.forEach(function (input) {
    input.addEventListener('change', function () {
      if (isHost && input.checked) socket.emit('updateRoomConfig', readConfigInputs());
    });
  });

  joinButton.addEventListener('click', function (event) {
    event.preventDefault();
    submitLogin();
  });
  usernameInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!joinButton.disabled) submitLogin();
    }
  });
  usernameInput.addEventListener('input', function () { clearInvalid(usernameInput); });

  createRoomButton.addEventListener('click', function () {
    const username = currentUsername();
    if (isValidUsername(username)) {
      setPendingButton(createRoomButton);
      socket.emit('createRoom', buildIdentity(username));
    } else {
      toast('El nombre debe tener entre 2 y 20 caracteres', 'error');
      ui(function () { Scenes.go('login'); });
    }
  });

  joinRoomButton.addEventListener('click', function () {
    joinRoomFromInput();
  });
  roomIdInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      joinRoomFromInput();
    }
  });
  roomIdInput.addEventListener('input', function (event) {
    event.target.value = event.target.value.toUpperCase();
    clearInvalid(roomIdInput);
  });

  startGameButton.addEventListener('click', function () {
    if (startRequested) return;
    // Reenviar el nivel antes de iniciar, por si el último cambio no llegó
    if (isHost) socket.emit('updateRoomConfig', readConfigInputs());
    startRequested = true;
    startGameButton.disabled = true;
    socket.emit('startGame');
    // Si el servidor no arranca (por ejemplo, faltan jugadores) el botón vuelve con el gameError
    setTimeout(function () {
      if (startRequested && !countdownActive && !roundLive) { startRequested = false; syncRoomControls(); }
    }, 5000);
  });

  refreshRoomsButton.addEventListener('click', function () {
    refreshRooms();
  });

  // Salir de la sala ("Salir de la sala", y en el final "Salir a las salas" o, para un espectador,
  // "Volver a las salas"): jugadores y espectadores salen por el mismo evento del servidor
  function leaveRoom() {
    socket.emit('backToMenu');
    leaveRoomLocally();
    ui(function () {
      Overlays.hideAll();
      Scenes.go('lobby');
    });
  }
  backToMenuButton.addEventListener('click', leaveRoom);
  if (leaveRoomButton) leaveRoomButton.addEventListener('click', leaveRoom);

  // Pantalla final: la sala ya está en espera; "Volver a la sala" solo cambia de escena
  if (backToRoomButton) backToRoomButton.addEventListener('click', function () {
    ui(function () { Scenes.go('room'); });
  });
  if (playAgainButton) playAgainButton.addEventListener('click', function () {
    if (!isHost || startRequested) return;
    startRequested = true;
    syncFinalControls();
    socket.emit('startGame');
    // Si el servidor no arranca (por ejemplo, alguien se fue) el botón vuelve con el gameError
    setTimeout(function () {
      if (startRequested && !countdownActive && !roundLive) { startRequested = false; syncRoomControls(); }
    }, 3000);
  });

  $('leaderboardButton').addEventListener('click', function () {
    requestLeaderboard();
  });

  $('loginLeaderboardButton').addEventListener('click', function () {
    requestLeaderboard();
  });

  // Overlays ya cierra el modal con #closeLeaderboardModal, Escape y clic en el fondo; esto es idempotente
  $('closeLeaderboardModal').addEventListener('click', function () {
    ui(function () { Overlays.close(leaderboardModal); });
    if (!window.Overlays) hideElement(leaderboardModal);
  });

  if (coarseQuery) {
    const onPointerChange = function () { updateSpectatorIndicator(); };
    if (coarseQuery.addEventListener) coarseQuery.addEventListener('change', onPointerChange);
    else if (coarseQuery.addListener) coarseQuery.addListener(onPointerChange);
  }

  // Al llegar al lobby: salas y jugadores al día
  ui(function () {
    Scenes.onEnter('lobby', function () {
      refreshRooms();
      if (playerProfile) socket.emit('getOnlinePlayers');
    });
  });

  // ===========================================================================
  // Arranque
  // ===========================================================================
  updateSpectatorIndicator();
  syncRoomControls();
  updateConfigPanel();
  initializeUserInterface();
});
