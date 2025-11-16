/**
 * SocketManager - Gestor de Socket.IO
 * Centraliza todos los eventos de socket y comunicación con el servidor
 */

import { SOCKET_EVENTS } from './constants.js';
import { ClientProjectile } from './ClientProjectile.js';

/**
 * Clase para gestionar comunicación Socket.IO
 */
export class SocketManager {
  constructor(socket, gameState, uiManager, notificationSystem, profileManager, renderEngine, onUpdateCallback) {
    this.socket = socket;
    this.gameState = gameState;
    this.uiManager = uiManager;
    this.notificationSystem = notificationSystem;
    this.profileManager = profileManager;
    this.renderEngine = renderEngine;
    this.onUpdate = onUpdateCallback;

    this.setupEventHandlers();
  }

  /**
   * Configurar todos los event handlers
   */
  setupEventHandlers() {
    // Conexión
    this.socket.on(SOCKET_EVENTS.CONNECT, () => this.handleConnect());
    this.socket.on(SOCKET_EVENTS.DISCONNECT, () => this.handleDisconnect());

    // Errores
    this.socket.on(SOCKET_EVENTS.GAME_ERROR, (msg) => this.handleGameError(msg));

    // Sala
    this.socket.on(SOCKET_EVENTS.ROOM_CREATED, (data) => this.handleRoomCreated(data));
    this.socket.on(SOCKET_EVENTS.ROOM_JOINED, (data) => this.handleRoomJoined(data));
    this.socket.on(SOCKET_EVENTS.ROOMS_LIST, (rooms) => this.handleRoomsList(rooms));
    this.socket.on(SOCKET_EVENTS.NEW_HOST, (data) => this.handleNewHost(data));

    // Jugadores
    this.socket.on(SOCKET_EVENTS.UPDATE_PLAYERS, (players, state, config, roomData) =>
      this.handleUpdatePlayers(players, state, config, roomData));

    // Configuración
    this.socket.on(SOCKET_EVENTS.CONFIG_UPDATED, (config) => this.handleConfigUpdated(config));
    this.socket.on(SOCKET_EVENTS.UPDATE_SCORES, (scores) => this.handleUpdateScores(scores));

    // Juego
    this.socket.on(SOCKET_EVENTS.GAME_START, (data) => this.handleGameStart(data));
    this.socket.on(SOCKET_EVENTS.SPECTATING_STARTED, (data) => this.handleSpectatingStarted(data));
    this.socket.on(SOCKET_EVENTS.SPECTATOR_JOINED, (data) => this.handleSpectatorJoined(data));
    this.socket.on(SOCKET_EVENTS.COUNTDOWN, (count, state) => this.handleCountdown(count, state));
    this.socket.on(SOCKET_EVENTS.ROUND_TIME_UPDATE, (timeLeft) => this.handleRoundTimeUpdate(timeLeft));
    this.socket.on(SOCKET_EVENTS.GAME_LOGIC_FRAME, (data) => this.handleGameLogicFrame(data));
    this.socket.on(SOCKET_EVENTS.ROUND_END, (data) => this.handleRoundEnd(data));
    this.socket.on(SOCKET_EVENTS.GAME_END, (data) => this.handleGameEnd(data));

    // Perfil
    this.socket.on(SOCKET_EVENTS.PLAYER_STATS, (data) => this.handlePlayerStats(data));
    this.socket.on(SOCKET_EVENTS.PROFILE_LOADED, (profile) => this.handleProfileLoaded(profile));
    this.socket.on(SOCKET_EVENTS.PROFILE_ERROR, (msg) => this.handleProfileError(msg));

    // Leaderboard
    this.socket.on(SOCKET_EVENTS.LEADERBOARD, (leaderboard) => this.handleLeaderboard(leaderboard));

    // Otros
    this.socket.on(SOCKET_EVENTS.ROOM_FINISHED, (data) => this.handleRoomFinished(data));
    this.socket.on(SOCKET_EVENTS.BACK_TO_MENU_SUCCESS, () => this.handleBackToMenuSuccess());

    // Jugadores en línea e invitaciones
    this.socket.on(SOCKET_EVENTS.ONLINE_PLAYERS_LIST, (players) => this.handleOnlinePlayersList(players));
    this.socket.on(SOCKET_EVENTS.INVITATION_RECEIVED, (data) => this.handleInvitationReceived(data));
    this.socket.on(SOCKET_EVENTS.INVITATION_SENT, (data) => this.handleInvitationSent(data));
  }

  // === HANDLERS DE CONEXIÓN ===

  handleConnect() {
    console.log('Conectado al servidor:', this.socket.id);
    this.gameState.setConnected(true, this.socket.id);
    this.notificationSystem.add('Conectado al servidor', 'success');
    this.refreshRooms();
  }

  handleDisconnect() {
    this.gameState.setConnected(false, null);
    this.gameState.stopRenderLoop();
    this.notificationSystem.add('Desconectado del servidor', 'error');
  }

  handleGameError(message) {
    this.notificationSystem.add(message, 'error');
  }

  // === HANDLERS DE SALA ===

  handleRoomCreated(data) {
    this.gameState.setSpectating(false);
    this.gameState.setRoom(data.roomId, data.isHost, data.config);

    if (data.playerProfile) {
      this.profileManager.save(data.playerProfile);
      this.gameState.setProfile(data.playerProfile);
      this.uiManager.updateProfileDisplay(data.playerProfile.stats);
    }

    this.uiManager.showGameInterface();
    this.uiManager.updateConfigPanel(data.roomId, false, data.isHost);
    this.uiManager.updateSpectatorIndicator(false);
    this.notificationSystem.add(`¡Sala ${data.roomId} creada!`, 'success');

    this.socket.emit(SOCKET_EVENTS.GET_ONLINE_PLAYERS);
  }

  handleRoomJoined(data) {
    this.gameState.setSpectating(false);
    this.gameState.setRoom(data.roomId, data.isHost, data.config);

    if (data.playerProfile) {
      this.profileManager.save(data.playerProfile);
      this.gameState.setProfile(data.playerProfile);
      this.uiManager.updateProfileDisplay(data.playerProfile.stats);
    }

    this.uiManager.showGameInterface();
    this.uiManager.updateConfigPanel(data.roomId, false, data.isHost);
    this.uiManager.updateSpectatorIndicator(false);
    this.notificationSystem.add(`¡Te uniste a la sala ${data.roomId}!`, 'success');

    this.socket.emit(SOCKET_EVENTS.GET_ONLINE_PLAYERS);
  }

  handleRoomsList(rooms) {
    this.uiManager.updateRoomsList(rooms);
  }

  handleNewHost(data) {
    if (data.hostId === this.socket.id) {
      this.gameState.isHost = true;
      this.notificationSystem.add('¡Ahora eres el anfitrión!', 'info');
    }
    this.uiManager.updateConfigPanel(this.gameState.currentRoomId, this.gameState.isPlaying(), this.gameState.isHost);
  }

  handleUpdatePlayers(players, state, config, roomData) {
    // Actualizar snakes (mantener interpolación)
    const updatedSnakes = players.map(serverPlayer => {
      const existingSnake = this.gameState.snakes.find(s => s.id === serverPlayer.id);
      if (existingSnake) {
        this.updateSnakeFromServer(existingSnake, serverPlayer);
        return existingSnake;
      } else {
        return this.createLocalSnake(serverPlayer);
      }
    });

    this.gameState.setSnakes(updatedSnakes);
    this.gameState.updateGameState(state);
    this.gameState.updateRoomConfig(config);

    this.uiManager.updatePlayerList(updatedSnakes, state, this.gameState.roomScores, this.socket.id);
    this.uiManager.updateRoomInfo(roomData, this.gameState.isSpectating, this.gameState.isHost, this.socket.id);
    this.uiManager.updateConfigPanel(this.gameState.currentRoomId, state.playing, this.gameState.isHost);

    // Botón de inicio
    const canStart = this.gameState.canStartGame();
    this.uiManager.updateStartButton(canStart);

    // Mensaje de espera
    if (players.length < config.minPlayers) {
      this.uiManager.updateWaitingMessage(true, config.minPlayers - players.length);
      this.notificationSystem.add(`Necesitas ${config.minPlayers - players.length} jugadores más`, 'info');
    } else {
      this.uiManager.updateWaitingMessage(false);
    }

    this.socket.emit(SOCKET_EVENTS.GET_ONLINE_PLAYERS);
  }

  // === HANDLERS DE CONFIGURACIÓN ===

  handleConfigUpdated(newConfig) {
    this.gameState.updateRoomConfig(newConfig);
    this.uiManager.updateConfigInputs(newConfig);
    this.renderEngine.setSegmentSize(newConfig.segmentSize);

    // Actualizar velocidad de interpolación de snakes
    this.gameState.snakes.forEach(snake => {
      if (snake.updateInterpolationSpeed) {
        snake.updateInterpolationSpeed(newConfig.gameSpeed);
      }
    });

    this.notificationSystem.add('¡Configuración actualizada!', 'success');
  }

  handleUpdateScores(scores) {
    this.gameState.setRoomScores(scores);
    this.uiManager.updatePlayerList(this.gameState.snakes, this.gameState.gameState, scores, this.socket.id);
  }

  // === HANDLERS DE JUEGO ===

  handleGameStart(data) {
    this.gameState.setSpectating(false);
    this.renderEngine.setSegmentSize(data.config.segmentSize);

    const snakes = data.players.map(serverPlayer => this.createLocalSnake(serverPlayer));

    this.gameState.setSnakes(snakes);
    this.gameState.setFoods(data.foods || []);
    this.gameState.setConsumables(data.consumables || []);
    this.gameState.setProjectiles(data.projectiles || []);
    this.gameState.updateGameState(data.gameState);
    this.gameState.updateRoomConfig(data.config);
    this.gameState.setRoundTimeLeft(data.gameState.roundTimeLeft || 60);

    this.gameState.startRenderLoop();

    this.notificationSystem.add(`Ronda ${data.gameState.round} - ¡Batalla por tiempo!`, 'success');

    this.socket.emit(SOCKET_EVENTS.GET_ONLINE_PLAYERS);
    this.uiManager.updateSpectatorIndicator(false);

    if (this.onUpdate) this.onUpdate();
  }

  handleSpectatingStarted(data) {
    this.gameState.setSpectating(true);
    this.gameState.setRoom(data.roomId, false, data.config);
    this.renderEngine.setSegmentSize(data.config.segmentSize);

    const snakes = data.players.map(serverPlayer => this.createLocalSnake(serverPlayer));

    this.gameState.setSnakes(snakes);
    this.gameState.setFoods(data.foods || []);
    this.gameState.setConsumables(data.consumables || []);
    this.gameState.setProjectiles(data.projectiles || []);
    this.gameState.updateGameState(data.gameState);
    this.gameState.updateRoomConfig(data.config);
    this.gameState.setRoundTimeLeft(data.roundTimeLeft || 60);
    this.gameState.setRoomScores(data.roundScores || {});

    this.gameState.startRenderLoop();

    this.uiManager.showGameInterface();
    this.uiManager.updateSpectatorIndicator(true);
    this.notificationSystem.add(`Espectando sala ${data.roomId}`, 'info');

    if (this.onUpdate) this.onUpdate();
  }

  handleSpectatorJoined(data) {
    if (this.gameState.isSpectating) return;
    this.notificationSystem.add(`${data.spectatorName} se unió como espectador`, 'info');
  }

  handleCountdown(count, state) {
    this.gameState.updateGameState(state);
    this.notificationSystem.add(`Ronda ${state.round} inicia en ${count}...`, 'info');
  }

  handleRoundTimeUpdate(timeLeft) {
    this.gameState.setRoundTimeLeft(timeLeft);
  }

  handleGameLogicFrame(data) {
    // Actualizar snakes
    this.gameState.snakes.forEach(localSnake => {
      const serverSnake = data.players.find(p => p.id === localSnake.id);
      if (serverSnake) {
        const portalEvent = data.portals?.find(p => p.playerId === localSnake.id);

        if (portalEvent) {
          // Portal: actualizar todas las posiciones
          localSnake.targetSegments = serverSnake.segments.map(seg => ({ ...seg }));
          localSnake.segments = serverSnake.segments.map(seg => ({ ...seg }));
          localSnake.renderSegments = serverSnake.segments.map(seg => ({ ...seg }));
        } else {
          localSnake.targetSegments = serverSnake.segments.map(seg => ({ ...seg }));
          localSnake.segments = serverSnake.segments.map(seg => ({ ...seg }));
        }

        localSnake.direction = { ...serverSnake.direction };
        localSnake.score = serverSnake.score;
        localSnake.gameover = serverSnake.gameover;
        localSnake.scoreLeftToGrow = serverSnake.scoreLeftToGrow;
        localSnake.color = serverSnake.color;
        localSnake.activeConsumable = serverSnake.activeConsumable;
      }
    });

    // Actualizar proyectiles
    const serverProjectiles = data.projectiles || [];
    let clientProjectiles = this.gameState.clientProjectiles;

    // Actualizar existentes
    clientProjectiles.forEach(clientProjectile => {
      const serverProjectile = serverProjectiles.find(p => p.id === clientProjectile.id);
      if (serverProjectile) {
        clientProjectile.updateTarget(serverProjectile);
      }
    });

    // Eliminar proyectiles que ya no existen
    clientProjectiles = clientProjectiles.filter(cp =>
      serverProjectiles.some(p => p.id === cp.id)
    );

    // Agregar nuevos proyectiles
    serverProjectiles.forEach(serverProjectile => {
      if (!clientProjectiles.find(cp => cp.id === serverProjectile.id)) {
        clientProjectiles.push(new ClientProjectile(serverProjectile));
      }
    });

    this.gameState.setClientProjectiles(clientProjectiles);
    this.gameState.setFoods(data.foods || []);
    this.gameState.setConsumables(data.consumables || []);
    this.gameState.updateGameState(data.gameState);
    this.gameState.setProjectiles(data.projectiles || []);

    // Eventos de consumibles
    if (data.consumableEvents && data.consumableEvents.length > 0) {
      data.consumableEvents.forEach(event => {
        this.notificationSystem.add(`${event.playerName} obtuvo ${event.consumableType}!`, 'success');
      });
    }

    if (data.gameState.roundTimeLeft !== undefined) {
      this.gameState.setRoundTimeLeft(data.gameState.roundTimeLeft);
    }
  }

  handleRoundEnd(data) {
    this.gameState.stopRenderLoop();
    this.gameState.setRoomScores(data.scores);

    this.notificationSystem.add(`¡Tiempo agotado! Ronda ${data.round} terminada`, 'info');
    if (data.winner) {
      this.notificationSystem.add(`Ganador: ${data.winner.name} (${data.winner.score} segmentos)`, 'success');
    }

    this.uiManager.updatePlayerList(this.gameState.snakes, this.gameState.gameState, data.scores, this.socket.id);

    if (this.gameState.isHost && data.nextRound) {
      this.uiManager.updateStartButton(true);
      this.uiManager.updateConfigPanel(this.gameState.currentRoomId, false, this.gameState.isHost);
    }

    this.socket.emit(SOCKET_EVENTS.GET_ONLINE_PLAYERS);
  }

  handleGameEnd(data) {
    this.gameState.stopRenderLoop();
    this.notificationSystem.add(`¡Juego Terminado! Campeón: ${data.winner.name}`, 'success');

    if (this.profileManager.getPlayerId()) {
      this.socket.emit(SOCKET_EVENTS.GET_PLAYER_STATS, this.profileManager.getPlayerId());
    }

    if (data.roomFinished) {
      this.uiManager.showFinalScreen(data.winner, data.finalScores);
    }

    this.socket.emit(SOCKET_EVENTS.GET_ONLINE_PLAYERS);
  }

  // === HANDLERS DE PERFIL ===

  handlePlayerStats(data) {
    if (data.playerId === this.profileManager.getPlayerId()) {
      this.profileManager.save(data);
      this.gameState.setProfile(data);
      this.uiManager.updateProfileDisplay(data.stats);
    }
  }

  handleProfileLoaded(profile) {
    this.profileManager.save(profile);
    this.gameState.setProfile(profile);
    this.uiManager.updateProfileDisplay(profile.stats);

    this.uiManager.showProfileView();

    this.notificationSystem.add(`¡Bienvenido, ${profile.stats.name}!`, 'success');

    setTimeout(() => {
      this.socket.emit(SOCKET_EVENTS.GET_ONLINE_PLAYERS);
    }, 500);
  }

  handleProfileError(message) {
    this.notificationSystem.add(message, 'error');
    this.profileManager.clear();
    this.gameState.clearProfile();
    this.uiManager.showLoginView();
  }

  handleLeaderboard(leaderboard) {
    this.uiManager.showLeaderboard(leaderboard);
  }

  handleRoomFinished(data) {
    this.gameState.stopRenderLoop();
    this.uiManager.showFinalScreen(null, data.finalScores, data.reason);
  }

  handleBackToMenuSuccess() {
    this.gameState.stopRenderLoop();
    this.gameState.leaveRoom();
    this.uiManager.showRoomSelection();
    this.uiManager.updateSpectatorIndicator(false);
    this.notificationSystem.add('Regresaste al menú', 'info');

    this.socket.emit(SOCKET_EVENTS.GET_ONLINE_PLAYERS);
  }

  handleOnlinePlayersList(players) {
    this.gameState.setOnlinePlayers(players);
    this.uiManager.updateOnlinePlayersList(
      players,
      this.gameState.currentRoomId,
      this.gameState.isPlaying()
    );
  }

  handleInvitationReceived(invitationData) {
    const { fromPlayer, roomId } = invitationData;

    this.notificationSystem.add(`${fromPlayer} te ha invitado a la sala ${roomId}`, 'invitation', 5000);

    // Copiar automáticamente el código de sala
    const roomIdInput = this.uiManager.elements.roomIdInput;
    if (roomIdInput) {
      roomIdInput.value = roomId;
      roomIdInput.focus();
      roomIdInput.select();
    }

    this.gameState.addPendingInvitation({
      from: fromPlayer,
      roomId: roomId,
      timestamp: Date.now(),
    });
  }

  handleInvitationSent(data) {
    this.notificationSystem.add(`Invitación enviada a ${data.toPlayer}`, 'success');
  }

  // === HELPERS ===

  createLocalSnake(serverSnake) {
    // Utiliza la clase Snake global del archivo snakeClass.js
    const snake = new Snake(
      serverSnake.id,
      serverSnake.name,
      this.renderEngine.segmentSize,
      600,
      600,
      serverSnake.segments[0].x,
      serverSnake.segments[0].y,
      serverSnake.direction.x,
      serverSnake.direction.y,
      serverSnake.color,
      this.gameState.roomConfig.gameSpeed || 83
    );

    this.updateSnakeFromServer(snake, serverSnake);
    return snake;
  }

  updateSnakeFromServer(snake, serverSnake) {
    snake.segments = serverSnake.segments.map(seg => ({ ...seg }));
    snake.targetSegments = serverSnake.segments.map(seg => ({ ...seg }));
    snake.direction = { ...serverSnake.direction };
    snake.score = serverSnake.score;
    snake.gameover = serverSnake.gameover;
    snake.scoreLeftToGrow = serverSnake.scoreLeftToGrow;
    snake.color = serverSnake.color;
    snake.activeConsumable = serverSnake.activeConsumable;
  }

  // === MÉTODOS PÚBLICOS PARA EMITIR EVENTOS ===

  createRoom(username) {
    const data = this.profileManager.prepareForServer(username);
    this.socket.emit(SOCKET_EVENTS.CREATE_ROOM, data);
  }

  joinRoom(roomId, username) {
    const data = { roomId, ...this.profileManager.prepareForServer(username) };
    this.socket.emit(SOCKET_EVENTS.JOIN_ROOM, data);
  }

  spectateRoom(roomId, spectatorName) {
    this.socket.emit(SOCKET_EVENTS.SPECTATE_ROOM, { roomId, spectatorName });
  }

  updateRoomConfig(config) {
    this.socket.emit(SOCKET_EVENTS.UPDATE_ROOM_CONFIG, config);
  }

  startGame() {
    this.socket.emit(SOCKET_EVENTS.START_GAME);
  }

  sendMove(key) {
    this.socket.emit(SOCKET_EVENTS.NEW_MOVE, { key });
  }

  attack() {
    this.socket.emit(SOCKET_EVENTS.ATTACK);
  }

  invitePlayer(targetSocketId) {
    this.socket.emit(SOCKET_EVENTS.INVITE_PLAYER, { targetSocketId });
  }

  getOnlinePlayers() {
    this.socket.emit(SOCKET_EVENTS.GET_ONLINE_PLAYERS);
  }

  getOrCreateProfile(username) {
    const data = this.profileManager.prepareForServer(username);
    this.socket.emit(SOCKET_EVENTS.GET_OR_CREATE_PROFILE, data);
  }

  getLeaderboard() {
    this.socket.emit(SOCKET_EVENTS.GET_LEADERBOARD);
  }

  refreshRooms() {
    this.socket.emit(SOCKET_EVENTS.GET_ROOMS);
  }

  backToMenu() {
    this.socket.emit(SOCKET_EVENTS.BACK_TO_MENU);
  }

  logout(currentRoomId) {
    this.socket.emit(SOCKET_EVENTS.LOGOUT, { currentRoomId });
  }
}

export default SocketManager;
