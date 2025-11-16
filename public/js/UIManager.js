/**
 * UIManager - Gestor de Interfaz de Usuario
 * Maneja vistas, elementos DOM y actualizaciones de UI
 */

import { showElement, hideElement, truncate } from './utils.js';

/**
 * Clase para gestionar la UI
 */
export class UIManager {
  constructor() {
    this.elements = this.cacheElements();
  }

  /**
   * Cachear referencias a elementos DOM
   */
  cacheElements() {
    return {
      // Vistas principales
      loginView: document.getElementById('loginView'),
      profileView: document.getElementById('profileView'),
      roomSelection: document.getElementById('roomSelection'),
      gameInterface: document.getElementById('gameInterface'),

      // Canvas
      canvas: document.getElementById('game'),
      infoCanvas: document.getElementById('infoCanvas'),
      infoCanvasContainer: document.getElementById('infoCanvasContainer'),

      // Perfil
      profileInfo: document.getElementById('profileInfo'),
      usernameInput: document.getElementById('username'),

      // Salas
      roomIdInput: document.getElementById('roomId'),
      roomsList: document.getElementById('roomsList'),
      roomInfo: document.getElementById('roomInfo'),

      // Jugadores
      playerList: document.getElementById('playerList'),
      onlinePlayersList: document.getElementById('onlinePlayersList'),
      onlinePlayersPanel: document.getElementById('onlinePlayersPanel'),

      // Configuración
      configPanel: document.getElementById('configPanel'),
      configSettings: document.getElementById('configSettings'),
      toggleConfigButton: document.getElementById('toggleConfigButton'),
      saveConfigButton: document.getElementById('saveConfigButton'),
      maxPlayersInput: document.getElementById('maxPlayersInput'),
      minPlayersInput: document.getElementById('minPlayersInput'),
      gameSpeedInput: document.getElementById('gameSpeedInput'),
      segmentSizeInput: document.getElementById('segmentSizeInput'),
      immunityEnabledInput: document.getElementById('immunityEnabledInput'),
      immunityIntervalInput: document.getElementById('immunityIntervalInput'),
      immunityDurationInput: document.getElementById('immunityDurationInput'),

      // Botones
      joinButton: document.getElementById('joinButton'),
      createRoomButton: document.getElementById('createRoomButton'),
      joinRoomButton: document.getElementById('joinRoomButton'),
      startGameButton: document.getElementById('startGameButton'),
      refreshRoomsButton: document.getElementById('refreshRoomsButton'),
      backToMenuButton: document.getElementById('backToMenuButton'),
      leaderboardButton: document.getElementById('leaderboardButton'),
      loginLeaderboardButton: document.getElementById('loginLeaderboardButton'),
      closeLeaderboardModal: document.getElementById('closeLeaderboardModal'),
      resetProfileButton: document.getElementById('resetProfileButton'),

      // Pantallas y modales
      gameOverScreen: document.getElementById('gameOverScreen'),
      finalScreen: document.getElementById('finalScreen'),
      leaderboardModal: document.getElementById('leaderboardModal'),
      leaderboardList: document.getElementById('leaderboardList'),
      finalScoresList: document.getElementById('finalScoresList'),
      finalTitle: document.getElementById('finalTitle'),
      finalMessage: document.getElementById('finalMessage'),

      // Otros
      waitingSpan: document.getElementById('waitingSpan'),
      spectatorBanner: document.getElementById('spectatorBanner'),
    };
  }

  /**
   * Mostrar vista de login
   */
  showLoginView() {
    showElement(this.elements.loginView);
    hideElement(this.elements.profileView);
    hideElement(this.elements.roomSelection);
    hideElement(this.elements.gameInterface);
    hideElement(this.elements.onlinePlayersPanel);
  }

  /**
   * Mostrar vista de perfil
   */
  showProfileView() {
    hideElement(this.elements.loginView);
    showElement(this.elements.profileView);
    showElement(this.elements.roomSelection);
    hideElement(this.elements.gameInterface);
    showElement(this.elements.onlinePlayersPanel);
  }

  /**
   * Mostrar interfaz de juego
   */
  showGameInterface() {
    hideElement(this.elements.roomSelection);
    showElement(this.elements.gameInterface);
  }

  /**
   * Mostrar selección de sala
   */
  showRoomSelection() {
    showElement(this.elements.roomSelection);
    hideElement(this.elements.gameInterface);
  }

  /**
   * Actualizar perfil en UI
   */
  updateProfileDisplay(stats) {
    if (!this.elements.profileInfo || !stats) return;

    this.elements.profileInfo.innerHTML = `
      <div class="profile-stats">
        <strong>📊 ${stats.name}</strong><br>
        <span>🎮 ${stats.games_played} partidas</span><br>
        <span>🏆 ${stats.wins} victorias</span><br>
        <span>🔥 Racha: ${stats.current_streak}</span><br>
        <span>⭐ Mejor: ${stats.best_score}</span>
      </div>
    `;
  }

  /**
   * Actualizar lista de salas
   */
  updateRoomsList(rooms) {
    if (!this.elements.roomsList) return;

    this.elements.roomsList.innerHTML = '';

    if (rooms.length === 0) {
      const emptyMsg = document.createElement('li');
      emptyMsg.textContent = 'No hay salas disponibles';
      emptyMsg.className = 'empty-room';
      this.elements.roomsList.appendChild(emptyMsg);
      return;
    }

    rooms.forEach(room => {
      const roomItem = this.createRoomListItem(room);
      this.elements.roomsList.appendChild(roomItem);
    });
  }

  /**
   * Crear elemento de lista de sala
   */
  createRoomListItem(room) {
    const roomItem = document.createElement('li');
    roomItem.className = 'room-item';

    const consumablesStatus = room.config?.consumables?.immunity?.enabled ? '🛡️' : '';
    const isPlaying = room.playing || false;

    let buttonsHtml = '';
    if (isPlaying) {
      buttonsHtml = `<button onclick="window.spectateRoom('${room.id}')" class="join-room-btn" style="background: #333; color: #00ffff; border-color: #00ffff;">👁️ Espectar</button>`;
    } else if (room.players < room.maxPlayers) {
      buttonsHtml = `<button onclick="window.joinSpecificRoom('${room.id}')" class="join-room-btn">Unirse</button>`;
    } else {
      buttonsHtml = `<span style="color: #888; font-size: 0.9em;">Llena</span>`;
    }

    roomItem.innerHTML = `
      <div class="room-info">
        <strong>Sala: ${room.id}</strong> ${isPlaying ? '🎮' : ''} ⚔️${consumablesStatus}<br>
        Anfitrión: ${room.hostName}<br>
        Jugadores: ${room.players}/${room.maxPlayers}${isPlaying ? ' (En juego)' : ''}
        <div class="room-config">
          3 rondas • 60s • 600x600 • Velocidad: ${room.config.gameSpeed}ms
        </div>
      </div>
      ${buttonsHtml}
    `;

    return roomItem;
  }

  /**
   * Actualizar información de sala actual
   */
  updateRoomInfo(roomData, isSpectating, isHost, socketId) {
    if (!this.elements.roomInfo || !roomData) return;

    let statusText = '';
    if (isSpectating) {
      statusText = '<strong style="color: #00ffff;">👁️ Modo Espectador</strong><br>';
    } else if (roomData.host === socketId) {
      statusText = '<strong>Anfitrión:</strong> Tú<br>';
    } else {
      statusText = '<strong>Anfitrión:</strong> Otro jugador<br>';
    }

    this.elements.roomInfo.innerHTML = `
      ${statusText}
      <strong>Sala:</strong> ${roomData.roomId}
    `;
  }

  /**
   * Actualizar lista de jugadores
   */
  updatePlayerList(players, gameState, roomScores, socketId) {
    if (!this.elements.playerList) return;

    this.elements.playerList.innerHTML = '';

    const sortedPlayers = [...players].sort((a, b) => {
      if (gameState.playing) {
        return b.score - a.score;
      } else {
        const aTotal = roomScores[a.id]?.totalScore || 0;
        const bTotal = roomScores[b.id]?.totalScore || 0;
        return bTotal - aTotal;
      }
    });

    sortedPlayers.forEach((player, index) => {
      const listItem = this.createPlayerListItem(player, index, gameState, roomScores, socketId);
      this.elements.playerList.appendChild(listItem);
    });
  }

  /**
   * Crear elemento de lista de jugador
   */
  createPlayerListItem(player, index, gameState, roomScores, socketId) {
    const listItem = document.createElement('li');
    listItem.className = `player-item ${player.gameover ? 'eliminated' : ''} ${player.id === socketId ? 'current-player' : ''}`;

    const rank = document.createElement('span');
    rank.className = 'player-rank';
    rank.textContent = `#${index + 1}`;

    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = player.name;

    const score = document.createElement('span');
    score.className = 'player-score';

    if (gameState.playing) {
      score.textContent = player.score;
    } else {
      const totalScore = roomScores[player.id]?.totalScore || 0;
      const roundWins = roomScores[player.id]?.roundWins || 0;
      score.innerHTML = `${totalScore}<br><small>${roundWins}V</small>`;
    }

    const status = document.createElement('span');
    status.className = 'player-status';

    let statusText = player.gameover ? '💀' : '🐍';
    if (player.activeConsumable && !player.gameover) {
      if (player.activeConsumable.type === 'immunity' && Date.now() < player.activeConsumable.endTime) {
        statusText = '🛡️';
      }
    }
    status.textContent = statusText;

    listItem.appendChild(rank);
    listItem.appendChild(name);
    listItem.appendChild(score);
    listItem.appendChild(status);

    return listItem;
  }

  /**
   * Actualizar lista de jugadores en línea
   */
  updateOnlinePlayersList(players, currentRoomId, gameStatePlaying) {
    if (!this.elements.onlinePlayersList) return;

    if (!players || players.length === 0) {
      this.elements.onlinePlayersList.innerHTML = '<li class="online-players-empty">No hay otros jugadores en línea</li>';
      return;
    }

    this.elements.onlinePlayersList.innerHTML = '';

    players.forEach(player => {
      const listItem = this.createOnlinePlayerItem(player, currentRoomId, gameStatePlaying);
      this.elements.onlinePlayersList.appendChild(listItem);
    });
  }

  /**
   * Crear elemento de jugador en línea
   */
  createOnlinePlayerItem(player, currentRoomId, gameStatePlaying) {
    const listItem = document.createElement('li');
    listItem.className = 'online-player-item';

    const playerInfo = document.createElement('div');
    playerInfo.className = 'online-player-info';

    const playerName = document.createElement('div');
    playerName.className = 'online-player-name';
    playerName.textContent = player.name;

    const playerStatus = document.createElement('div');
    playerStatus.className = `online-player-status ${player.isInGame ? 'in-game' : 'available'}`;
    playerStatus.textContent = player.isInGame ? 'En partida' : 'Disponible';

    playerInfo.appendChild(playerName);
    playerInfo.appendChild(playerStatus);
    listItem.appendChild(playerInfo);

    // Botón invitar
    const showInviteButton = currentRoomId && !gameStatePlaying && player.canInvite;

    if (showInviteButton) {
      const inviteButton = document.createElement('button');
      inviteButton.className = 'invite-button';
      inviteButton.textContent = '📩 Invitar';
      inviteButton.disabled = !player.canInvite;

      inviteButton.addEventListener('click', () => {
        window.invitePlayerHandler(player.socketId, player.name);
      });

      listItem.appendChild(inviteButton);
    }

    return listItem;
  }

  /**
   * Actualizar panel de configuración
   */
  updateConfigPanel(currentRoomId, isPlaying, isHost) {
    if (!this.elements.configPanel) return;

    if (currentRoomId && !isPlaying) {
      showElement(this.elements.configPanel);
      if (isHost) {
        showElement(this.elements.saveConfigButton);
        this.setConfigInputsEnabled(true);
        this.elements.toggleConfigButton.textContent = '⚙️ Configuración';
      } else {
        hideElement(this.elements.saveConfigButton);
        this.setConfigInputsEnabled(false);
        this.elements.toggleConfigButton.textContent = '👁️ Ver Configuración';
      }
    } else {
      hideElement(this.elements.configPanel);
    }
  }

  /**
   * Habilitar/deshabilitar inputs de configuración
   */
  setConfigInputsEnabled(enabled) {
    if (this.elements.maxPlayersInput) this.elements.maxPlayersInput.disabled = !enabled;
    if (this.elements.minPlayersInput) this.elements.minPlayersInput.disabled = !enabled;
    if (this.elements.gameSpeedInput) this.elements.gameSpeedInput.disabled = !enabled;
    if (this.elements.segmentSizeInput) this.elements.segmentSizeInput.disabled = !enabled;
    if (this.elements.immunityEnabledInput) this.elements.immunityEnabledInput.disabled = !enabled;
    if (this.elements.immunityIntervalInput) this.elements.immunityIntervalInput.disabled = !enabled;
    if (this.elements.immunityDurationInput) this.elements.immunityDurationInput.disabled = !enabled;
  }

  /**
   * Actualizar inputs de configuración con valores
   */
  updateConfigInputs(config) {
    if (this.elements.maxPlayersInput) this.elements.maxPlayersInput.value = config.maxPlayers;
    if (this.elements.minPlayersInput) this.elements.minPlayersInput.value = config.minPlayers;
    if (this.elements.gameSpeedInput) this.elements.gameSpeedInput.value = config.gameSpeed;
    if (this.elements.segmentSizeInput) this.elements.segmentSizeInput.value = config.segmentSize;

    if (config.consumables?.immunity) {
      if (this.elements.immunityEnabledInput) {
        this.elements.immunityEnabledInput.checked = config.consumables.immunity.enabled !== false;
      }
      if (this.elements.immunityIntervalInput) {
        this.elements.immunityIntervalInput.value = config.consumables.immunity.spawnInterval || 5;
      }
      if (this.elements.immunityDurationInput) {
        this.elements.immunityDurationInput.value = config.consumables.immunity.duration || 5;
      }
    }
  }

  /**
   * Obtener configuración desde inputs
   */
  getConfigFromInputs() {
    return {
      maxPlayers: parseInt(this.elements.maxPlayersInput.value),
      minPlayers: parseInt(this.elements.minPlayersInput.value),
      gameSpeed: parseInt(this.elements.gameSpeedInput.value),
      segmentSize: parseInt(this.elements.segmentSizeInput.value),
      consumables: {
        immunity: {
          enabled: this.elements.immunityEnabledInput ? this.elements.immunityEnabledInput.checked : true,
          spawnInterval: this.elements.immunityIntervalInput ? parseInt(this.elements.immunityIntervalInput.value) : 5,
          duration: this.elements.immunityDurationInput ? parseInt(this.elements.immunityDurationInput.value) : 5,
        },
      },
    };
  }

  /**
   * Mostrar/ocultar botón de inicio
   */
  updateStartButton(show) {
    if (show) {
      showElement(this.elements.startGameButton);
    } else {
      hideElement(this.elements.startGameButton);
    }
  }

  /**
   * Actualizar indicador de espectador
   */
  updateSpectatorIndicator(isSpectating) {
    if (!this.elements.spectatorBanner) return;

    if (isSpectating) {
      showElement(this.elements.spectatorBanner);
    } else {
      hideElement(this.elements.spectatorBanner);
    }

    // Actualizar hint de controles
    const controlsHint = document.querySelector('.controls-hint');
    if (controlsHint) {
      if (isSpectating) {
        controlsHint.innerHTML = '<strong>👁️ MODO ESPECTADOR</strong><br>Estás viendo la partida en tiempo real';
      } else {
        controlsHint.innerHTML = `
          <strong>Controles:</strong><br>
          ⬆️⬇️⬅️➡️ Flechas o WASD<br>
          🎯 Espacio - Atacar
        `;
      }
    }
  }

  /**
   * Mostrar leaderboard
   */
  showLeaderboard(leaderboard) {
    if (!this.elements.leaderboardModal || !this.elements.leaderboardList) return;

    this.elements.leaderboardList.innerHTML = '';

    const sortedLeaderboard = this.sortLeaderboard(leaderboard);

    sortedLeaderboard.forEach((player, index) => {
      const item = document.createElement('li');
      item.className = 'leaderboard-item';
      const winRate = player.games_played > 0 ? Math.round((player.wins / player.games_played) * 100) : 0;

      item.innerHTML = `
        <span class="rank">#${index + 1}</span>
        <span class="name">${player.name}</span>
        <span class="wins">${player.wins}V</span>
        <span class="games">${player.games_played}P</span>
        <span class="winrate">${winRate}%</span>
      `;
      this.elements.leaderboardList.appendChild(item);
    });

    showElement(this.elements.leaderboardModal);
  }

  /**
   * Ordenar leaderboard
   */
  sortLeaderboard(leaderboard) {
    return leaderboard.sort((a, b) => {
      const aHasMinGames = a.games_played >= 3;
      const bHasMinGames = b.games_played >= 3;

      if (aHasMinGames && bHasMinGames) {
        const aWinRate = a.games_played > 0 ? (a.wins / a.games_played) : 0;
        const bWinRate = b.games_played > 0 ? (b.wins / b.games_played) : 0;

        if (aWinRate !== bWinRate) {
          return bWinRate - aWinRate;
        }
        return b.wins - a.wins;
      }

      if (!aHasMinGames && !bHasMinGames) {
        if (a.wins !== b.wins) {
          return b.wins - a.wins;
        }
        return b.games_played - a.games_played;
      }

      return aHasMinGames ? -1 : 1;
    });
  }

  /**
   * Mostrar pantalla final
   */
  showFinalScreen(winner, finalScores, reason = null) {
    if (reason) {
      this.elements.finalTitle.textContent = 'Sala Terminada';
      this.elements.finalMessage.textContent = reason;
    } else {
      this.elements.finalTitle.textContent = '¡Juego Completo!';
      this.elements.finalMessage.textContent = winner ? `Campeón: ${winner.name}` : 'Juego terminado';
    }

    this.elements.finalScoresList.innerHTML = '';
    const sortedScores = Object.values(finalScores).sort((a, b) => b.totalScore - a.totalScore);

    sortedScores.forEach((player, index) => {
      const item = document.createElement('li');
      item.className = 'final-score-item';
      item.innerHTML = `
        <span class="final-rank">#${index + 1}</span>
        <span class="final-name">${player.name}</span>
        <span class="final-total">${player.totalScore} pts</span>
        <span class="final-wins">${player.roundWins} victorias</span>
      `;
      this.elements.finalScoresList.appendChild(item);
    });

    hideElement(this.elements.gameInterface);
    showElement(this.elements.finalScreen);
  }

  /**
   * Ocultar pantalla final
   */
  hideFinalScreen() {
    hideElement(this.elements.finalScreen);
  }

  /**
   * Mostrar/ocultar mensaje de espera
   */
  updateWaitingMessage(show, playersNeeded = 0) {
    if (show) {
      showElement(this.elements.waitingSpan);
    } else {
      hideElement(this.elements.waitingSpan);
    }
  }
}

export default UIManager;
