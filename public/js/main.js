/**
 * Snake Multiplayer - Archivo Principal
 * Punto de entrada y coordinador de todos los módulos
 */

import { KEYCODES, DIRECTIONS, UI } from './constants.js';
import { validateUsername, validateRoomId } from './utils.js';
import { gameState } from './GameState.js';
import { profileManager } from './ProfileManager.js';
import { NotificationSystem } from './NotificationSystem.js';
import { RenderEngine } from './RenderEngine.js';
import { UIManager } from './UIManager.js';
import { SocketManager } from './SocketManager.js';

/**
 * Clase principal del juego
 */
class SnakeMultiplayerGame {
  constructor() {
    this.socket = io();
    this.notificationSystem = new NotificationSystem();
    this.renderEngine = new RenderEngine('game', 'infoCanvas');
    this.uiManager = new UIManager();

    this.socketManager = new SocketManager(
      this.socket,
      gameState,
      this.uiManager,
      this.notificationSystem,
      profileManager,
      this.renderEngine,
      () => this.handleUpdate()
    );

    this.initializeEventListeners();
    this.initializeInterface();
    this.startRenderLoop();
  }

  /**
   * Inicializar event listeners del DOM
   */
  initializeEventListeners() {
    // Keyboard
    document.addEventListener('keydown', (e) => this.handleKeyPress(e));

    // Perfil
    this.uiManager.elements.joinButton.addEventListener('click', (e) => {
      e.preventDefault();
      this.handleLogin();
    });

    this.uiManager.elements.resetProfileButton.addEventListener('click', () => {
      this.handleLogout();
    });

    // Sala
    this.uiManager.elements.createRoomButton.addEventListener('click', () => {
      this.handleCreateRoom();
    });

    this.uiManager.elements.joinRoomButton.addEventListener('click', () => {
      this.handleJoinRoomById();
    });

    this.uiManager.elements.refreshRoomsButton.addEventListener('click', () => {
      this.socketManager.refreshRooms();
    });

    // Juego
    this.uiManager.elements.startGameButton.addEventListener('click', () => {
      this.handleStartGame();
    });

    this.uiManager.elements.backToMenuButton.addEventListener('click', () => {
      this.handleBackToMenu();
    });

    // Configuración
    this.uiManager.elements.toggleConfigButton.addEventListener('click', () => {
      this.handleToggleConfig();
    });

    this.uiManager.elements.saveConfigButton.addEventListener('click', () => {
      this.handleSaveConfig();
    });

    this.uiManager.elements.maxPlayersInput.addEventListener('change', () => {
      this.handleMaxPlayersChange();
    });

    this.uiManager.elements.minPlayersInput.addEventListener('change', () => {
      this.handleMinPlayersChange();
    });

    // Leaderboard
    this.uiManager.elements.leaderboardButton.addEventListener('click', () => {
      this.socketManager.getLeaderboard();
    });

    this.uiManager.elements.loginLeaderboardButton.addEventListener('click', () => {
      this.socketManager.getLeaderboard();
    });

    this.uiManager.elements.closeLeaderboardModal.addEventListener('click', () => {
      this.uiManager.elements.leaderboardModal.classList.add('hidden');
    });

    // Room ID input uppercase
    this.uiManager.elements.roomIdInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });

    // Resize handler
    window.addEventListener('resize', () => this.handleResize());
  }

  /**
   * Inicializar interfaz
   */
  initializeInterface() {
    const savedProfile = profileManager.load();

    if (savedProfile && savedProfile.stats) {
      this.uiManager.elements.usernameInput.value = savedProfile.stats.name;
      this.socketManager.getOrCreateProfile(savedProfile.stats.name);
    } else {
      this.uiManager.showLoginView();
      this.notificationSystem.add('¡Conectado! Ingresa tu nombre para comenzar.', 'info');
    }

    this.handleResize();
  }

  /**
   * Manejar login
   */
  handleLogin() {
    const username = this.uiManager.elements.usernameInput.value.trim();
    const validation = validateUsername(username, UI.USERNAME_MIN_LENGTH, UI.USERNAME_MAX_LENGTH);

    if (!validation.valid) {
      this.notificationSystem.add(validation.error, 'error');
      this.uiManager.elements.usernameInput.focus();
      return;
    }

    this.notificationSystem.add('Cargando perfil...', 'info');
    this.socketManager.getOrCreateProfile(username);
  }

  /**
   * Manejar logout
   */
  handleLogout() {
    this.socketManager.logout(gameState.currentRoomId);

    profileManager.clear();
    gameState.clearProfile();

    this.uiManager.elements.usernameInput.value = '';
    this.uiManager.showLoginView();
    this.notificationSystem.add('Sesión cerrada.', 'info');
  }

  /**
   * Manejar crear sala
   */
  handleCreateRoom() {
    const username = this.uiManager.elements.usernameInput.value.trim();
    const validation = validateUsername(username, UI.USERNAME_MIN_LENGTH, UI.USERNAME_MAX_LENGTH);

    if (!validation.valid) {
      this.notificationSystem.add(validation.error, 'error');
      this.uiManager.elements.usernameInput.focus();
      return;
    }

    this.socketManager.createRoom(username);
  }

  /**
   * Manejar unirse a sala por ID
   */
  handleJoinRoomById() {
    const username = this.uiManager.elements.usernameInput.value.trim();
    const roomId = this.uiManager.elements.roomIdInput.value.trim().toUpperCase();

    const usernameValidation = validateUsername(username, UI.USERNAME_MIN_LENGTH, UI.USERNAME_MAX_LENGTH);
    if (!usernameValidation.valid) {
      this.notificationSystem.add(usernameValidation.error, 'error');
      this.uiManager.elements.usernameInput.focus();
      return;
    }

    const roomIdValidation = validateRoomId(roomId, UI.ROOM_ID_LENGTH);
    if (!roomIdValidation.valid) {
      this.notificationSystem.add(roomIdValidation.error, 'error');
      this.uiManager.elements.roomIdInput.focus();
      return;
    }

    this.socketManager.joinRoom(roomId, username);
  }

  /**
   * Manejar inicio de juego
   */
  handleStartGame() {
    if (gameState.isHost) {
      const config = this.uiManager.getConfigFromInputs();

      if (config.minPlayers > config.maxPlayers) {
        this.notificationSystem.add('Los jugadores mínimos no pueden exceder los máximos', 'error');
        return;
      }

      this.socketManager.updateRoomConfig(config);
    }

    this.socketManager.startGame();
  }

  /**
   * Manejar volver al menú
   */
  handleBackToMenu() {
    if (gameState.isSpectating) {
      gameState.setSpectating(false);
      gameState.leaveRoom();
      gameState.stopRenderLoop();
      this.uiManager.showRoomSelection();
      this.uiManager.updateSpectatorIndicator(false);
      this.socketManager.refreshRooms();
    } else {
      this.socketManager.backToMenu();
      this.uiManager.hideFinalScreen();
    }
  }

  /**
   * Manejar toggle de configuración
   */
  handleToggleConfig() {
    const configSettings = this.uiManager.elements.configSettings;
    if (configSettings.classList.contains('hidden')) {
      configSettings.classList.remove('hidden');
      this.uiManager.elements.toggleConfigButton.textContent = '▼ Configuración';
    } else {
      configSettings.classList.add('hidden');
      this.uiManager.elements.toggleConfigButton.textContent = '⚙️ Configuración';
    }
  }

  /**
   * Manejar guardar configuración
   */
  handleSaveConfig() {
    if (!gameState.isHost) {
      this.notificationSystem.add('Solo el anfitrión puede modificar la configuración', 'error');
      return;
    }

    const config = this.uiManager.getConfigFromInputs();

    if (config.minPlayers > config.maxPlayers) {
      this.notificationSystem.add('Los jugadores mínimos no pueden exceder los máximos', 'error');
      return;
    }

    this.socketManager.updateRoomConfig(config);
  }

  /**
   * Manejar cambio de max players
   */
  handleMaxPlayersChange() {
    const maxVal = parseInt(this.uiManager.elements.maxPlayersInput.value);
    const minVal = parseInt(this.uiManager.elements.minPlayersInput.value);
    if (minVal > maxVal) {
      this.uiManager.elements.minPlayersInput.value = maxVal;
    }
  }

  /**
   * Manejar cambio de min players
   */
  handleMinPlayersChange() {
    const maxVal = parseInt(this.uiManager.elements.maxPlayersInput.value);
    const minVal = parseInt(this.uiManager.elements.minPlayersInput.value);
    if (minVal > maxVal) {
      this.uiManager.elements.minPlayersInput.value = maxVal;
    }
  }

  /**
   * Manejar teclas presionadas
   */
  handleKeyPress(event) {
    if (gameState.isSpectating) return;

    const key = event.keyCode;

    // Movimiento
    if ((key >= KEYCODES.ARROW_LEFT && key <= KEYCODES.ARROW_DOWN) ||
        key === KEYCODES.W || key === KEYCODES.A ||
        key === KEYCODES.S || key === KEYCODES.D) {

      if (gameState.isConnected && gameState.isPlaying()) {
        event.preventDefault();

        // Convertir WASD a códigos de flechas
        let keyToSend = key;
        if (key === KEYCODES.W) keyToSend = KEYCODES.ARROW_UP;
        else if (key === KEYCODES.A) keyToSend = KEYCODES.ARROW_LEFT;
        else if (key === KEYCODES.S) keyToSend = KEYCODES.ARROW_DOWN;
        else if (key === KEYCODES.D) keyToSend = KEYCODES.ARROW_RIGHT;

        this.socketManager.sendMove(keyToSend);
      }
    } else if (key === KEYCODES.SPACE && gameState.isConnected && gameState.isPlaying()) {
      event.preventDefault();
      this.socketManager.attack();
    }
  }

  /**
   * Manejar resize
   */
  handleResize() {
    const canvas = this.uiManager.elements.canvas;
    const infoCanvas = this.uiManager.elements.infoCanvas;
    const container = canvas.parentElement;

    const maxWidth = container.clientWidth;
    const maxHeight = window.innerHeight - 20;

    if (canvas.width > maxWidth || canvas.height > maxHeight) {
      const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
      canvas.style.transform = `scale(${scale})`;
      canvas.style.transformOrigin = 'top left';

      if (infoCanvas) {
        infoCanvas.style.transform = `scale(${scale})`;
        infoCanvas.style.transformOrigin = 'top left';
      }
    } else {
      canvas.style.transform = 'none';
      if (infoCanvas) {
        infoCanvas.style.transform = 'none';
      }
    }
  }

  /**
   * Callback cuando el estado se actualiza
   */
  handleUpdate() {
    // Placeholder para cualquier lógica adicional necesaria
  }

  /**
   * Loop de renderizado principal
   */
  startRenderLoop() {
    const render = () => {
      if (gameState.isGameRunning && gameState.isPlaying()) {
        // Actualizar posiciones de snakes
        gameState.snakes.forEach(snake => {
          if (snake.updateRenderPosition) {
            snake.updateRenderPosition();
          }
        });

        // Actualizar posiciones de proyectiles
        gameState.clientProjectiles.forEach(projectile => {
          projectile.updateRenderPosition();
        });

        // Renderizar juego
        this.renderGame();
      }

      // Siempre actualizar info canvas (para notificaciones)
      this.renderEngine.drawInfoCanvas(
        gameState.gameState,
        gameState.snakes,
        gameState.roomScores,
        this.socket.id,
        this.notificationSystem
      );

      if (gameState.isGameRunning) {
        gameState.setRenderLoop(requestAnimationFrame(render));
      }
    };

    gameState.startRenderLoop();
    render();
  }

  /**
   * Renderizar juego
   */
  renderGame() {
    this.renderEngine.clear();
    this.renderEngine.drawGrid();
    this.renderEngine.drawFoods(gameState.foods);
    this.renderEngine.drawConsumables(gameState.consumables);
    this.renderEngine.drawPlayers(gameState.snakes, this.socket.id);
    this.renderEngine.drawProjectiles(gameState.clientProjectiles);
    this.renderEngine.drawCountdown(gameState.gameState.roundTimeLeft);

    this.uiManager.updatePlayerList(
      gameState.snakes,
      gameState.gameState,
      gameState.roomScores,
      this.socket.id
    );
  }
}

// Funciones globales para compatibilidad con HTML onclick
window.joinSpecificRoom = function(roomId) {
  const game = window.snakeGame;
  if (!game) return;

  const username = game.uiManager.elements.usernameInput.value.trim();
  const validation = validateUsername(username, UI.USERNAME_MIN_LENGTH, UI.USERNAME_MAX_LENGTH);

  if (!validation.valid) {
    game.notificationSystem.add(validation.error, 'error');
    game.uiManager.elements.usernameInput.focus();
    return;
  }

  game.socketManager.joinRoom(roomId, username);
};

window.spectateRoom = function(roomId) {
  const game = window.snakeGame;
  if (!game || !profileManager.hasActiveSession()) {
    game.notificationSystem.add('Necesitas estar conectado para espectar', 'error');
    return;
  }

  game.socketManager.spectateRoom(roomId, profileManager.getPlayerName());
};

window.invitePlayerHandler = function(targetSocketId, targetPlayerName) {
  const game = window.snakeGame;
  if (!game || !gameState.currentRoomId || gameState.isPlaying()) {
    game.notificationSystem.add('No puedes invitar en este momento', 'error');
    return;
  }

  game.socketManager.invitePlayer(targetSocketId);
  game.notificationSystem.add(`Invitación enviada a ${targetPlayerName}`, 'info');
};

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
  window.snakeGame = new SnakeMultiplayerGame();
});
