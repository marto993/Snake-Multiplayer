/**
 * ProfileManager - Gestión de Perfiles de Usuario
 * Maneja perfiles, localStorage y autenticación
 */

import { STORAGE } from './constants.js';

/**
 * Clase para gestionar perfiles de usuario
 */
export class ProfileManager {
  constructor() {
    this.profile = null;
    this.playerId = null;
  }

  /**
   * Guardar perfil en localStorage
   * @param {Object} profile - Perfil a guardar
   */
  save(profile) {
    if (!profile) return false;

    try {
      localStorage.setItem(STORAGE.PLAYER_PROFILE, JSON.stringify(profile));
      if (profile.playerId) {
        localStorage.setItem(STORAGE.PLAYER_ID, profile.playerId);
      }
      this.profile = profile;
      this.playerId = profile.playerId;
      return true;
    } catch (error) {
      console.error('Error saving profile:', error);
      return false;
    }
  }

  /**
   * Cargar perfil desde localStorage
   * @returns {Object|null}
   */
  load() {
    try {
      const savedProfile = localStorage.getItem(STORAGE.PLAYER_PROFILE);
      const savedPlayerId = localStorage.getItem(STORAGE.PLAYER_ID);

      if (savedProfile && savedPlayerId) {
        const profile = JSON.parse(savedProfile);
        this.profile = { ...profile, playerId: savedPlayerId };
        this.playerId = savedPlayerId;
        return this.profile;
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    }
    return null;
  }

  /**
   * Limpiar perfil de localStorage
   */
  clear() {
    try {
      localStorage.removeItem(STORAGE.PLAYER_PROFILE);
      localStorage.removeItem(STORAGE.PLAYER_ID);
      this.profile = null;
      this.playerId = null;
      return true;
    } catch (error) {
      console.error('Error clearing profile:', error);
      return false;
    }
  }

  /**
   * Actualizar estadísticas del perfil
   * @param {Object} newStats - Nuevas estadísticas
   */
  updateStats(newStats) {
    if (!this.profile) return false;

    this.profile.stats = { ...this.profile.stats, ...newStats };
    return this.save(this.profile);
  }

  /**
   * Obtener perfil actual
   * @returns {Object|null}
   */
  getProfile() {
    return this.profile;
  }

  /**
   * Obtener ID del jugador
   * @returns {string|null}
   */
  getPlayerId() {
    return this.playerId;
  }

  /**
   * Obtener nombre del jugador
   * @returns {string|null}
   */
  getPlayerName() {
    return this.profile?.stats?.name || null;
  }

  /**
   * Verificar si hay sesión activa
   * @returns {boolean}
   */
  hasActiveSession() {
    return !!this.profile && !!this.playerId;
  }

  /**
   * Obtener estadísticas del perfil
   * @returns {Object|null}
   */
  getStats() {
    return this.profile?.stats || null;
  }

  /**
   * Formatear estadísticas para mostrar
   * @returns {string}
   */
  formatStats() {
    if (!this.profile || !this.profile.stats) {
      return 'Sin estadísticas disponibles';
    }

    const stats = this.profile.stats;
    return `
      📊 ${stats.name}
      🎮 ${stats.games_played} partidas
      🏆 ${stats.wins} victorias
      🔥 Racha: ${stats.current_streak}
      ⭐ Mejor: ${stats.best_score}
    `;
  }

  /**
   * Verificar si el username coincide con el perfil actual
   * @param {string} username - Nombre a verificar
   * @returns {boolean}
   */
  matchesUsername(username) {
    if (!this.profile || !username) return false;
    return this.profile.stats.name.toLowerCase() === username.toLowerCase();
  }

  /**
   * Preparar datos para envío al servidor
   * @param {string} username - Nombre del usuario
   * @returns {Object}
   */
  prepareForServer(username) {
    const data = { username };

    if (this.hasActiveSession() && this.matchesUsername(username)) {
      data.playerId = this.playerId;
    }

    return data;
  }
}

// Exportar instancia singleton
export const profileManager = new ProfileManager();

export default profileManager;
