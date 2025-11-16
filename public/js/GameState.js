/**
 * GameState - Estado Global del Juego
 * Centraliza todo el estado del cliente
 */

import { DEFAULT_CONFIG } from './constants.js';

/**
 * Clase que gestiona el estado global del juego
 */
export class GameState {
  constructor() {
    this.reset();
  }

  /**
   * Resetear todo el estado a valores iniciales
   */
  reset() {
    // Estado del render loop
    this.renderLoop = null;
    this.isGameRunning = false;

    // Conexión
    this.isConnected = false;
    this.socketId = null;

    // Sala
    this.currentRoomId = null;
    this.isHost = false;
    this.isSpectating = false;

    // Configuración de sala
    this.roomConfig = { ...DEFAULT_CONFIG };

    // Estado de juego
    this.gameState = {
      playing: false,
      round: 1,
      roundTimeLeft: 0,
    };

    // Entidades del juego
    this.snakes = [];
    this.foods = [];
    this.consumables = [];
    this.projectiles = [];
    this.clientProjectiles = [];

    // Puntuaciones
    this.roomScores = {};

    // Jugadores en línea
    this.onlinePlayers = [];
    this.pendingInvitations = [];

    // Perfil del jugador
    this.playerProfile = null;
    this.currentPlayerId = null;

    // Rendering
    this.segmentSize = DEFAULT_CONFIG.SEGMENT_SIZE;
  }

  /**
   * Setters para estado de conexión
   */
  setConnected(connected, socketId = null) {
    this.isConnected = connected;
    this.socketId = socketId;
  }

  /**
   * Setters para sala
   */
  setRoom(roomId, isHost = false, config = null) {
    this.currentRoomId = roomId;
    this.isHost = isHost;
    if (config) {
      this.roomConfig = { ...config };
    }
  }

  leaveRoom() {
    this.currentRoomId = null;
    this.isHost = false;
    this.isSpectating = false;
    this.roomConfig = { ...DEFAULT_CONFIG };
    this.roomScores = {};
  }

  /**
   * Setters para perfil
   */
  setProfile(profile) {
    this.playerProfile = profile;
    if (profile && profile.playerId) {
      this.currentPlayerId = profile.playerId;
    }
  }

  clearProfile() {
    this.playerProfile = null;
    this.currentPlayerId = null;
  }

  /**
   * Setters para estado de juego
   */
  updateGameState(newState) {
    this.gameState = { ...this.gameState, ...newState };
  }

  setRoundTimeLeft(timeLeft) {
    this.gameState.roundTimeLeft = timeLeft;
  }

  /**
   * Setters para entidades
   */
  setSnakes(snakes) {
    this.snakes = snakes;
  }

  setFoods(foods) {
    this.foods = foods;
  }

  setConsumables(consumables) {
    this.consumables = consumables;
  }

  setProjectiles(projectiles) {
    this.projectiles = projectiles;
  }

  setClientProjectiles(projectiles) {
    this.clientProjectiles = projectiles;
  }

  /**
   * Setters para puntuaciones
   */
  setRoomScores(scores) {
    this.roomScores = scores;
  }

  /**
   * Setters para jugadores en línea
   */
  setOnlinePlayers(players) {
    this.onlinePlayers = players;
  }

  addPendingInvitation(invitation) {
    this.pendingInvitations.push(invitation);
  }

  clearPendingInvitations() {
    this.pendingInvitations = [];
  }

  /**
   * Getters
   */
  isInRoom() {
    return this.currentRoomId !== null;
  }

  isPlaying() {
    return this.gameState.playing;
  }

  canStartGame() {
    return this.isHost &&
           !this.gameState.playing &&
           this.snakes.length >= this.roomConfig.minPlayers;
  }

  getCurrentPlayer() {
    return this.snakes.find(snake => snake.id === this.socketId);
  }

  /**
   * Configuración de renderizado
   */
  setSegmentSize(size) {
    this.segmentSize = size;
  }

  updateRoomConfig(config) {
    this.roomConfig = { ...this.roomConfig, ...config };
    if (config.segmentSize) {
      this.segmentSize = config.segmentSize;
    }
  }

  /**
   * Control del render loop
   */
  startRenderLoop() {
    this.isGameRunning = true;
  }

  stopRenderLoop() {
    if (this.renderLoop) {
      cancelAnimationFrame(this.renderLoop);
      this.renderLoop = null;
    }
    this.isGameRunning = false;
  }

  setRenderLoop(loopId) {
    this.renderLoop = loopId;
  }

  /**
   * Modo espectador
   */
  setSpectating(spectating) {
    this.isSpectating = spectating;
  }

  /**
   * Debug info
   */
  getDebugInfo() {
    return {
      connected: this.isConnected,
      socketId: this.socketId,
      room: this.currentRoomId,
      host: this.isHost,
      spectating: this.isSpectating,
      playing: this.gameState.playing,
      round: this.gameState.round,
      players: this.snakes.length,
      profile: this.playerProfile?.stats?.name || 'None',
    };
  }
}

// Exportar instancia singleton
export const gameState = new GameState();

export default gameState;
