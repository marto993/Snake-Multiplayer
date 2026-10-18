/*
 * SnakeGame.js: cliente de Snake Multiplayer.
 *
 * Mantiene la lógica de red y de estado (socket.io, perfil, salas, predicción e
 * interpolación) y conecta la capa visual del abismo bioluminiscente:
 *   - window.Arena     (js/render/arena.js)  dibuja canvas#game
 *   - window.Backdrop  (js/ui/backdrop.js)   fondo vivo
 *   - window.Scenes / Overlays / Toasts / HUD (js/ui/scenes.js)
 *
 * Reglas de esta capa (docs/VISUAL_SPEC.md, sección 10):
 *   - Un único requestAnimationFrame siempre vivo. Con ronda en curso: Arena.render;
 *     al terminar la ronda, 2400 ms de estado congelado; el resto del tiempo, Arena.renderIdle.
 *   - Los eventos de gameLogicFrame se despachan a la arena ANTES de aplicar las posiciones nuevas.
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
  const ARENA_SIZE = 600;               // coordenadas lógicas fijas del servidor
  const FREEZE_MS = 2400;               // congelamiento de la arena al terminar la ronda (arena.js, 5.14)
  const INVITE_COOLDOWN_MS = 8000;      // "Enviada" en el botón de invitar
  const PROFILE_RETRY_MAX = 6;          // reintentos del re-registro automático ("ya está conectado")
  const KEY_TO_ARROW = { 37: 37, 38: 38, 39: 39, 40: 40, 87: 38, 65: 37, 83: 40, 68: 39 }; // flechas y WASD
  const SPEED_LABELS = { 200: 'lenta', 83: 'normal', 50: 'rápida', 40: 'muy rápida' };

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

  const gameOverScreen = $('gameOverScreen');
  const restartButton = $('restartButton');
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
  const saveConfigButton = $('saveConfigButton');

  const maxPlayersInput = $('maxPlayersInput');
  const minPlayersInput = $('minPlayersInput');
  const gameSpeedInput = $('gameSpeedInput');
  const segmentSizeInput = $('segmentSizeInput');

  const immunityEnabledInput = $('immunityEnabledInput');
  const immunityIntervalInput = $('immunityIntervalInput');
  const immunityDurationInput = $('immunityDurationInput');

  const onlinePlayersList = $('onlinePlayersList');
  const dockCount = $('dockCount');
  const profileInfo = $('profileInfo');
  const spectatorBanner = $('spectatorBanner');
  const controlsHint = document.querySelector('.controls-hint');
  const leaderboardModal = $('leaderboardModal');
  const leaderboardList = $('leaderboardList');
  const backToMenuButton = $('backToMenuButton');

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
  let projectiles = [];
  let clientProjectiles = [];
  let isConnected = false;
  let hasConnectedOnce = false;
  let isHost = false;
  let isSpectating = false;
  let currentRoomId = null;
  let roomHostId = null;
  let roomHostName = '';
  let roomConfig = {};
  let roomScores = {};
  let roundTimeLeft = 0;

  let onlinePlayers = [];
  const pendingInvitations = [];

  // Estado propio de la presentación
  let roundLive = false;        // ronda en curso: entre gameStart (o spectatingStarted) y roundEnd
  let freezeUntil = 0;          // performance.now() hasta el que la arena muestra el último estado congelado
  let countdownActive = false;  // cuenta regresiva 3, 2, 1 en pantalla
  let startRequested = false;   // el anfitrión pidió iniciar y el servidor todavía no arrancó
  let matchFinished = false;    // llegó gameEnd: la escena final está por entrar
  let tensionOn = false;        // últimos 10 segundos
  let lastPulseSecond = -1;
  let keyboardSeen = false;
  let previewList = [];         // criaturas de la sala para Arena.renderIdle
  let idleCaption = '';
  let knownRoomCodes = new Set();
  let knownOnlineIds = new Set();
  let knownPlayerIds = new Set();
  const invitedAt = new Map();  // socketId -> momento de la invitación
  let roomsRefreshTimer = 0;
  let roundEndHold = false;     // el panel de fin de ronda sigue abierto: la arena mantiene el estado congelado
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
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function showElement(element) { if (element) element.classList.remove('hidden'); }
  function hideElement(element) { if (element) element.classList.add('hidden'); }
  function toggleElement(element, visible) { if (visible) showElement(element); else hideElement(element); }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function perfNow() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function bio(hex) {
    try {
      if (Arena && typeof Arena.bioColor === 'function') return Arena.bioColor(hex);
      if (typeof Scenes.bioColor === 'function') return Scenes.bioColor(hex);
    } catch (err) { reportOnce(err); }
    return { body: hex || '#1FF2D2', text: '#E8FBFF' };
  }

  function maxRounds() { return (roomConfig && +roomConfig.maxRounds) || 3; }
  function roundTime() { return (roomConfig && +roomConfig.roundTime) || 60; }

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

      // Botón de invitar solo si: estoy en una sala, no hay ronda y el jugador está disponible
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

    clearNode(onlinePlayersList);
    onlinePlayersList.appendChild(frag);
    knownOnlineIds = nextIds;
    if (dockCount) dockCount.textContent = onlinePlayers.length ? String(onlinePlayers.length) : '';
  }

  function invitePlayer(targetSocketId, targetPlayerName, button) {
    if (!currentRoomId || gameState.playing || roundLive) {
      toast('No puedes invitar durante una ronda', 'error');
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
  // Proyectiles del cliente (interpolados)
  // ===========================================================================
  function lerp(start, end, factor) {
    return start + (end - start) * factor;
  }

  function ClientProjectile(serverProjectile) {
    this.id = serverProjectile.id;
    this.playerId = serverProjectile.playerId;
    this.color = serverProjectile.color;
    this.direction = { x: serverProjectile.direction.x, y: serverProjectile.direction.y };

    this.targetX = serverProjectile.x;
    this.targetY = serverProjectile.y;

    this.renderX = serverProjectile.prevX || serverProjectile.x;
    this.renderY = serverProjectile.prevY || serverProjectile.y;

    this.interpolationSpeed = 0.2;
  }

  ClientProjectile.prototype.updateRenderPosition = function () {
    this.renderX = lerp(this.renderX, this.targetX, this.interpolationSpeed);
    this.renderY = lerp(this.renderY, this.targetY, this.interpolationSpeed);
  };

  ClientProjectile.prototype.updateTarget = function (serverProjectile) {
    this.targetX = serverProjectile.x;
    this.targetY = serverProjectile.y;
    this.direction = { x: serverProjectile.direction.x, y: serverProjectile.direction.y };
    this.color = serverProjectile.color;
  };

  // ===========================================================================
  // Teclado
  // ===========================================================================
  document.addEventListener('keydown', handleKeyPress);

  // Espacio y flechas son teclas de juego: mientras hay partida (o su cuenta regresiva) no desplazan
  // la página ni activan el botón enfocado, aunque la ronda todavía no corra (roundLive en false).
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
    if (!keyboardSeen && !event.ctrlKey && !event.metaKey && !event.altKey) {
      keyboardSeen = true;
      updateSpectatorIndicator();
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    const inField = !!(target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)));
    const key = event.keyCode;
    if (!inField && (key === 32 || (key >= 37 && key <= 40)) && swallowsGameKeys(target)) event.preventDefault();

    // No permitir controles si se está mirando
    if (isSpectating) return;
    // Solo con una ronda en curso (entre rondas el servidor sigue en playing=true)
    if (!isConnected || !gameState.playing || !roundLive) return;
    if (inField) return;

    const arrow = KEY_TO_ARROW[key];
    if (arrow) {
      event.preventDefault();
      // WASD se convierte a códigos de flecha para el servidor
      socket.emit('newMove', { key: arrow });
    } else if (key === 32) {
      event.preventDefault();
      socket.emit('attack');
    }
  }

  // ===========================================================================
  // Serpientes locales
  // ===========================================================================
  function createLocalSnake(serverSnake) {
    const snake = new Snake(
      serverSnake.id,
      serverSnake.name,
      segmentSize,
      ARENA_SIZE,
      ARENA_SIZE,
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
    snake.activeConsumable = serverSnake.activeConsumable;

    return snake;
  }

  function copySegments(list) {
    return list.map(function (seg) { return { x: seg.x, y: seg.y }; });
  }

  function syncProjectiles(serverProjectiles) {
    const list = serverProjectiles || [];
    clientProjectiles.forEach(function (clientProjectile) {
      const serverProjectile = list.find(function (p) { return p.id === clientProjectile.id; });
      if (serverProjectile) clientProjectile.updateTarget(serverProjectile);
    });
    clientProjectiles = clientProjectiles.filter(function (clientProjectile) {
      return list.some(function (p) { return p.id === clientProjectile.id; });
    });
    list.forEach(function (serverProjectile) {
      if (!clientProjectiles.find(function (cp) { return cp.id === serverProjectile.id; })) {
        clientProjectiles.push(new ClientProjectile(serverProjectile));
      }
    });
  }

  function rebuildPreview() {
    const me = isSpectating ? null : socket.id;
    previewList = snakes.map(function (s) {
      return { id: s.id, name: s.name, color: s.color, isMe: me !== null && s.id === me };
    });
  }

  function colorsById() {
    const map = {};
    snakes.forEach(function (s) { map[s.id] = s.color; });
    return map;
  }
  function colorsByName() {
    // Los nombres son únicos dentro de una sala (index.js, joinRoom)
    const map = {};
    snakes.forEach(function (s) { map[s.name] = s.color; });
    return map;
  }

  // ===========================================================================
  // Arena: configuración y bucle de render (un único requestAnimationFrame)
  // ===========================================================================
  if (Arena && canvas) {
    ui(function () {
      Arena.init(canvas);
      Arena.setConfig({ segmentSize: segmentSize, width: ARENA_SIZE, height: ARENA_SIZE });
    });
  }

  function applyArenaConfig() {
    if (!Arena) return;
    ui(function () { Arena.setConfig({ segmentSize: segmentSize, width: ARENA_SIZE, height: ARENA_SIZE }); });
  }

  // Objetos reutilizados por frame (sin allocations en el bucle)
  const arenaState = {
    snakes: snakes, foods: foods, consumables: consumables, projectiles: clientProjectiles,
    myId: null, roundTimeLeft: 0, playing: false, spectating: false
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
  }

  function renderFrame(now) {
    requestAnimationFrame(renderFrame);
    if (!Arena || !canvas) return;
    // La arena solo se dibuja cuando se ve: sala, partida y debajo del velo del final
    const scene = Scenes.current();
    if (scene !== 'room' && scene !== 'game' && scene !== 'final') return;
    try {
      if (roundLive) {
        for (let i = 0; i < snakes.length; i++) {
          if (snakes[i].updateRenderPosition) snakes[i].updateRenderPosition();
        }
        for (let j = 0; j < clientProjectiles.length; j++) clientProjectiles[j].updateRenderPosition();
        fillArenaState();
        Arena.render(arenaState, now);
      } else if (now < freezeUntil || (roundEndHold && gameOverScreen && !gameOverScreen.classList.contains('hidden'))) {
        // Fin de ronda: el último estado queda congelado (sin interpolar) mientras la arena enfoca al ganador.
        // Sigue congelado mientras el panel de fin de ronda esté abierto
        // (hasta la cuenta regresiva siguiente o "Ocultar"), así el ganador no se reemplaza por el modo atracción.
        fillArenaState();
        Arena.render(arenaState, now);
      } else {
        idleOptions.snakesPreview = previewList;
        idleOptions.caption = scene === 'room' && !countdownActive ? idleCaption : '';
        Arena.renderIdle(now, idleOptions);
      }
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
    const now = Date.now();
    return snakes.map(function (s) {
      const sc = roomScores && roomScores[s.id];
      const ac = s.activeConsumable;
      const immune = !!(ac && ac.type === 'immunity' && (!ac.endTime || now < ac.endTime));
      return {
        id: s.id,
        name: s.name,
        color: s.color,
        score: s.score,
        totalScore: sc ? sc.totalScore : 0,
        roundWins: sc ? sc.roundWins : 0,
        immune: immune,
        immuneUntil: immune && ac.endTime ? ac.endTime : 0,
        isMe: !isSpectating && s.id === socket.id,
        gameover: !!s.gameover
      };
    });
  }

  function updateHUD() {
    if (!currentRoomId) return;
    ui(function () {
      HUD.update({
        round: gameState.round || 1,
        maxRounds: maxRounds(),
        timeLeft: roundTimeLeft,
        roundTime: roundTime(),
        players: hudPlayers(),
        playing: roundLive,
        spectating: isSpectating
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
    roundEndHold = false;
    countdownActive = false;
    gameState = Object.assign({}, gameState, { playing: false });
    clientProjectiles = [];
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
    roomScores = {};
    roundLive = false;
    freezeUntil = 0;
    roundEndHold = false;
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
        existingSnake.activeConsumable = serverPlayer.activeConsumable;
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

    // La cuenta regresiva de la ronda 1 se cancela si alguien se va y no alcanza el mínimo
    if (countdownActive && !state.playing && players.length < (config.minPlayers || 2)) {
      countdownActive = false;
      ui(function () { Overlays.hideAll(); });
    }
    // "No quedan jugadores suficientes" estando en partida y sin fin de ronda pendiente (spec 4.1)
    if (!state.playing && Scenes.current() === 'game' && !isSpectating && !matchFinished && freezeUntil <= perfNow() && !countdownActive) {
      roundLive = false;
      ui(function () { Scenes.go('room'); });
    }

    rebuildPreview();
    updatePlayerList();
    updateRoomInfo();
    syncRoomControls();
    updateConfigPanel();
    if (Scenes.current() === 'game') updateHUD();

    // Actualizar lista de jugadores en línea cuando cambie el estado
    socket.emit('getOnlinePlayers');
  });

  // Firma de los valores editables: el anfitrión reenvía la misma configuración al iniciar
  // y eso no debe disparar el aviso "Configuración actualizada" en toda la sala.
  function configSignature(config) {
    if (!config) return '';
    const immunity = (config.consumables && config.consumables.immunity) || {};
    return [config.maxPlayers, config.minPlayers, config.gameSpeed, config.segmentSize,
      immunity.enabled !== false, immunity.spawnInterval, immunity.duration].join('|');
  }

  socket.on('configUpdated', function (newConfig) {
    const changed = configSignature(newConfig) !== configSignature(roomConfig);
    roomConfig = newConfig;
    updateConfigInputs(newConfig);
    segmentSize = newConfig.segmentSize;
    applyArenaConfig();
    snakes.forEach(function (snake) {
      snake.updateInterpolationSpeed(newConfig.gameSpeed);
    });
    if (changed) toast('Configuración actualizada', 'success');
  });

  socket.on('updateScores', function (scores) {
    roomScores = scores || {};
    updatePlayerList();
    if (Scenes.current() === 'game') updateHUD();
  });

  // ===========================================================================
  // Socket: rondas
  // ===========================================================================
  socket.on('countdown', function (count, state) {
    if (state) gameState = state;
    countdownActive = true;
    roundEndHold = false;
    startRequested = false;
    roundTimeLeft = roundTime(); // el anillo del HUD arranca lleno para la ronda que viene
    ui(function () { Overlays.countdown(count, state ? state.round : gameState.round); });
    syncRoomControls();
    updateConfigPanel();
    if (Scenes.current() === 'game') updateHUD();
  });

  socket.on('gameStart', function (data) {
    // Un espectador sigue siéndolo en las rondas siguientes: solo es jugador si figura en la lista
    isSpectating = !!currentRoomId && !data.players.some(function (p) { return p.id === socket.id; });
    roomConfig = data.config;
    segmentSize = data.config.segmentSize;

    snakes = data.players.map(function (serverPlayer) { return createLocalSnake(serverPlayer); });
    foods = data.foods || [];
    consumables = data.consumables || [];
    projectiles = data.projectiles || [];
    // Los proyectiles vivos al terminar la ronda anterior desaparecen sin evento
    clientProjectiles = [];
    syncProjectiles(projectiles);
    gameState = data.gameState;
    roundTimeLeft = data.gameState.roundTimeLeft !== undefined ? data.gameState.roundTimeLeft : roundTime();

    roundLive = true;
    freezeUntil = 0;
    roundEndHold = false;
    countdownActive = false;
    startRequested = false;
    matchFinished = false;
    resetTension();
    rebuildPreview();

    applyArenaConfig();
    if (Arena) ui(function () { Arena.onRoundStart(); });
    ui(function () {
      Scenes.go('game');
      Overlays.roundStart(gameState.round, maxRounds());
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
    projectiles = data.projectiles || [];
    clientProjectiles = [];
    syncProjectiles(projectiles);
    gameState = data.gameState;
    roundTimeLeft = data.roundTimeLeft || roundTime();
    roomScores = data.roundScores || {};

    roundLive = !!(data.gameState && data.gameState.playing);
    freezeUntil = 0;
    roundEndHold = false;
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

    // 1. Efectos: antes de aplicar las posiciones nuevas (la arena usa las del frame anterior)
    dispatchFrameEvents(data);

    // 2. Estado autoritativo del servidor (sin cambios respecto de la versión anterior)
    snakes.forEach(function (localSnake) {
      const serverSnake = data.players.find(function (p) { return p.id === localSnake.id; });
      if (serverSnake) {
        const portalEvent = data.portals && data.portals.find(function (p) { return p.playerId === localSnake.id; });

        if (portalEvent) {
          // Portal: se salta la interpolación para no cruzar la arena entera
          localSnake.targetSegments = copySegments(serverSnake.segments);
          localSnake.segments = copySegments(serverSnake.segments);
          localSnake.renderSegments = copySegments(serverSnake.segments);
        } else {
          localSnake.targetSegments = copySegments(serverSnake.segments);
          localSnake.segments = copySegments(serverSnake.segments);
        }
        localSnake.direction = { x: serverSnake.direction.x, y: serverSnake.direction.y };
        localSnake.score = serverSnake.score;
        localSnake.gameover = serverSnake.gameover;
        localSnake.scoreLeftToGrow = serverSnake.scoreLeftToGrow;
        localSnake.color = serverSnake.color;
        localSnake.activeConsumable = serverSnake.activeConsumable;
      }
    });

    projectiles = data.projectiles || [];
    syncProjectiles(projectiles);

    foods = data.foods || [];
    consumables = data.consumables || [];
    gameState = data.gameState;

    if (data.consumableEvents && data.consumableEvents.length > 0) {
      data.consumableEvents.forEach(function (event) {
        if (event.consumableType === 'immunity' && event.playerId === socket.id && !isSpectating) {
          toast('Escudo activo: bloquea un disparo', 'success', 2500);
        }
      });
    }

    if (data.gameState && data.gameState.roundTimeLeft !== undefined) {
      roundTimeLeft = data.gameState.roundTimeLeft;
    }

    // 3. HUD y tensión
    updateHUD();
    checkTension();
  });

  socket.on('roundEnd', function (data) {
    roomScores = data.scores || {};
    roundLive = false;
    freezeUntil = perfNow() + FREEZE_MS;
    roundEndHold = true;
    resetTension();

    const winnerId = data.winner ? data.winner.id : null;
    if (Arena) ui(function () { Arena.onRoundEnd({ winnerId: winnerId }); });
    ui(function () {
      Overlays.roundEnd(data, { colorsById: colorsById() });
      Backdrop.setMood('game'); // sale de tension
    });
    updateHUD();   // con playing=false muestra totales y rondas ganadas
    updatePlayerList();
    syncRoomControls();

    // Actualizar lista con botones (ronda terminada)
    socket.emit('getOnlinePlayers');
  });

  socket.on('gameEnd', function (data) {
    roundLive = false;
    countdownActive = false;
    matchFinished = true;
    resetTension();
    gameState = Object.assign({}, gameState, { playing: false });

    if (currentPlayerId) {
      socket.emit('getPlayerStats', currentPlayerId);
    }

    // Overlays espera a que el panel de fin de ronda lleve 1800 ms visible y pasa a la escena 'final'
    // (con el fondo en 'celebration' del color del campeón)
    ui(function () { Overlays.final(data || {}, { colorsByName: colorsByName() }); });
    syncRoomControls();

    // Actualizar lista con botones (juego terminado)
    socket.emit('getOnlinePlayers');
  });

  // El servidor actual no lo emite; se conserva por compatibilidad
  socket.on('roomFinished', function (data) {
    roundLive = false;
    countdownActive = false;
    resetTension();
    ui(function () {
      Overlays.final({ finalScores: (data && data.finalScores) || {}, reason: (data && data.reason) || 'La sala se cerró' }, { colorsByName: colorsByName() });
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
    currentRoomId = null;
    isHost = false;
    isSpectating = false;
    roomHostId = null;
    roomHostName = '';
    roomConfig = {};
    roomScores = {};
    gameState = { playing: false, round: 1 };
    snakes = [];
    foods = [];
    consumables = [];
    projectiles = [];
    clientProjectiles = [];
    roundLive = false;
    freezeUntil = 0;
    roundEndHold = false;
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
      showElement(saveConfigButton);
      setConfigInputsEnabled(true);
      toggleConfigButton.textContent = 'Configuración';
    } else {
      hideElement(saveConfigButton);
      setConfigInputsEnabled(false);
      toggleConfigButton.textContent = 'Ver configuración';
    }
    toggleConfigButton.setAttribute('aria-expanded', configSettings.classList.contains('hidden') ? 'false' : 'true');
  }

  function setConfigInputsEnabled(enabled) {
    maxPlayersInput.disabled = !enabled;
    minPlayersInput.disabled = !enabled;
    gameSpeedInput.disabled = !enabled;
    segmentSizeInput.disabled = !enabled;

    if (immunityEnabledInput) immunityEnabledInput.disabled = !enabled;
    if (immunityIntervalInput) immunityIntervalInput.disabled = !enabled;
    if (immunityDurationInput) immunityDurationInput.disabled = !enabled;
  }

  function updateConfigInputs(config) {
    if (!config) return;
    if (config.maxPlayers !== undefined) maxPlayersInput.value = config.maxPlayers;
    if (config.minPlayers !== undefined) minPlayersInput.value = config.minPlayers;
    if (config.gameSpeed !== undefined) gameSpeedInput.value = config.gameSpeed;
    if (config.segmentSize !== undefined) segmentSizeInput.value = config.segmentSize;

    if (config.consumables && config.consumables.immunity) {
      if (immunityEnabledInput) immunityEnabledInput.checked = config.consumables.immunity.enabled !== false;
      if (immunityIntervalInput) immunityIntervalInput.value = config.consumables.immunity.spawnInterval || 13;
      if (immunityDurationInput) immunityDurationInput.value = config.consumables.immunity.duration || 5;
    }
  }

  function readConfigInputs(defaultInterval) {
    return {
      maxPlayers: parseInt(maxPlayersInput.value, 10),
      minPlayers: parseInt(minPlayersInput.value, 10),
      gameSpeed: parseInt(gameSpeedInput.value, 10),
      segmentSize: parseInt(segmentSizeInput.value, 10),
      consumables: {
        immunity: {
          enabled: immunityEnabledInput ? immunityEnabledInput.checked : true,
          spawnInterval: immunityIntervalInput ? parseInt(immunityIntervalInput.value, 10) : defaultInterval,
          duration: immunityDurationInput ? parseInt(immunityDurationInput.value, 10) : 5
        }
      }
    };
  }

  function saveConfiguration() {
    if (!isHost) {
      toast('Solo el anfitrión puede cambiar la configuración', 'error');
      return;
    }
    const newConfig = readConfigInputs(5);
    if (newConfig.minPlayers > newConfig.maxPlayers) {
      markInvalid(minPlayersInput);
      toast('El mínimo de jugadores no puede superar al máximo', 'error');
      return;
    }
    clearInvalid(minPlayersInput);
    socket.emit('updateRoomConfig', newConfig);
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
  }

  function updatePlayerList() {
    if (!playerList) return;
    const playing = !!gameState.playing && roundLive;
    const sortedPlayers = snakes.slice().sort(function (a, b) {
      if (playing) return b.score - a.score;
      const aTotal = (roomScores && roomScores[a.id]) ? roomScores[a.id].totalScore : 0;
      const bTotal = (roomScores && roomScores[b.id]) ? roomScores[b.id].totalScore : 0;
      return bTotal - aTotal;
    });

    const nextIds = new Set();
    const frag = document.createDocumentFragment();
    const now = Date.now();
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
      if (playing) {
        score.textContent = String(player.score);
      } else {
        const sc = roomScores && roomScores[player.id];
        const totalScore = sc ? sc.totalScore : 0;
        const roundWins = sc ? sc.roundWins : 0;
        score.appendChild(document.createTextNode(String(totalScore)));
        score.appendChild(el('small', null, roundWins + plural(roundWins, ' ronda', ' rondas')));
      }
      listItem.appendChild(score);

      const status = el('span', 'player-status');
      const ac = player.activeConsumable;
      if (!player.gameover && ac && ac.type === 'immunity' && now < ac.endTime) {
        status.setAttribute('role', 'img');
        status.setAttribute('aria-label', 'Con escudo');
        status.appendChild(iconEl('i-medusa'));
      }
      listItem.appendChild(status);

      frag.appendChild(listItem);
    });

    clearNode(playerList);
    playerList.appendChild(frag);
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
  function speedLabel(gameSpeed) {
    const v = +gameSpeed;
    if (SPEED_LABELS[v]) return SPEED_LABELS[v];
    if (v >= 150) return 'lenta';
    if (v >= 70) return 'normal';
    if (v >= 45) return 'rápida';
    return 'muy rápida';
  }

  function roomConfigText(config) {
    const cfg = config || {};
    const rounds = +cfg.maxRounds || 3;
    const seconds = +cfg.roundTime || 60;
    const immunity = cfg.consumables && cfg.consumables.immunity && cfg.consumables.immunity.enabled;
    return rounds + plural(rounds, ' ronda', ' rondas') + ' de ' + seconds + ' s, velocidad ' + speedLabel(cfg.gameSpeed) +
      ', ' + (immunity ? 'con inmunidad' : 'sin inmunidad');
  }

  // Firma de lo que muestra una fila: si no cambió, la fila (y su botón, con foco o puntero encima) queda intacta
  function roomSignature(room) {
    const cfg = room.config || {};
    const immunity = cfg.consumables && cfg.consumables.immunity && cfg.consumables.immunity.enabled;
    return [room.playing ? 1 : 0, room.players | 0, room.maxPlayers | 0, room.hostName || '',
      cfg.maxRounds, cfg.roundTime, cfg.gameSpeed, immunity ? 1 : 0].join('|');
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
  window.spectateRoom = function (roomId) { spectateRoom(roomId); };

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
  window.joinSpecificRoom = function (roomId) { joinSpecificRoom(roomId); };

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
      clearNode(leaderboardList);
      leaderboardList.appendChild(el('li', 'leaderboard-item loading', 'Cargando ranking…'));
    }
    ui(function () { Overlays.open(leaderboardModal); });
    socket.emit('getLeaderboard');
  }

  function showLeaderboard(leaderboard) {
    if (!leaderboardList) return;
    const list = Array.isArray(leaderboard) ? leaderboard.slice() : [];

    // Primero quienes tienen 3 partidas o más, por porcentaje de victorias (orden original)
    list.sort(function (a, b) {
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
    clearNode(leaderboardList);
    leaderboardList.appendChild(frag);
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
    clearNode(onlinePlayersList);
    onlinePlayersList.appendChild(el('li', 'online-players-empty', 'Buscando jugadores…'));
    if (dockCount) dockCount.textContent = '';
    ui(function () {
      Overlays.hideAll();
      Overlays.close(leaderboardModal);
      Scenes.go('login');
    });
    toast('Sesión cerrada', 'info');
  }
  window.resetPlayerProfile = resetPlayerProfile;

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

  saveConfigButton.addEventListener('click', function () {
    saveConfiguration();
  });

  function clampMinToMax() {
    const maxVal = parseInt(maxPlayersInput.value, 10);
    const minVal = parseInt(minPlayersInput.value, 10);
    if (minVal > maxVal) minPlayersInput.value = maxVal;
    clearInvalid(minPlayersInput);
  }
  maxPlayersInput.addEventListener('change', clampMinToMax);
  minPlayersInput.addEventListener('change', clampMinToMax);

  // #restartButton ("Ocultar") lo maneja Overlays con su salida animada; respaldo si falta scenes.js
  if (!window.Overlays && restartButton) {
    restartButton.addEventListener('click', function () { hideElement(gameOverScreen); });
  }

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
    // Guardar configuración antes de iniciar
    if (isHost) {
      const finalConfig = readConfigInputs(13);
      if (finalConfig.minPlayers <= finalConfig.maxPlayers) {
        socket.emit('updateRoomConfig', finalConfig);
      }
    }
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

  // "Volver a las salas": jugadores y espectadores salen por el mismo evento del servidor
  // (antes el espectador llamaba a socket.leave, que no existe en socket.io-client)
  backToMenuButton.addEventListener('click', function () {
    socket.emit('backToMenu');
    leaveRoomLocally();
    ui(function () {
      Overlays.hideAll();
      Scenes.go('lobby');
    });
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
