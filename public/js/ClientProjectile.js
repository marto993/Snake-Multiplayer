/**
 * ClientProjectile - Proyectil del Cliente
 * Versión cliente del proyectil con interpolación
 */

import { PROJECTILE } from './constants.js';
import { lerp } from './utils.js';

/**
 * Clase para proyectiles del lado del cliente
 */
export class ClientProjectile {
  constructor(serverProjectile) {
    this.id = serverProjectile.id;
    this.playerId = serverProjectile.playerId;
    this.color = serverProjectile.color;
    this.direction = { ...serverProjectile.direction };

    // Posición objetivo (del servidor)
    this.targetX = serverProjectile.x;
    this.targetY = serverProjectile.y;

    // Posición de renderizado (interpolada)
    this.renderX = serverProjectile.prevX || serverProjectile.x;
    this.renderY = serverProjectile.prevY || serverProjectile.y;

    this.interpolationSpeed = PROJECTILE.INTERPOLATION_SPEED;
  }

  /**
   * Actualizar posición de renderizado con interpolación
   */
  updateRenderPosition() {
    this.renderX = lerp(this.renderX, this.targetX, this.interpolationSpeed);
    this.renderY = lerp(this.renderY, this.targetY, this.interpolationSpeed);
  }

  /**
   * Actualizar objetivo basado en datos del servidor
   * @param {Object} serverProjectile - Datos del servidor
   */
  updateTarget(serverProjectile) {
    this.targetX = serverProjectile.x;
    this.targetY = serverProjectile.y;
    this.direction = { ...serverProjectile.direction };
    this.color = serverProjectile.color;
  }

  /**
   * Obtener posición de renderizado
   * @returns {{x: number, y: number}}
   */
  getRenderPosition() {
    return {
      x: this.renderX,
      y: this.renderY,
    };
  }

  /**
   * Verificar si el proyectil está cerca de su objetivo
   * @param {number} threshold - Umbral de distancia
   * @returns {boolean}
   */
  isNearTarget(threshold = 1) {
    const dx = Math.abs(this.targetX - this.renderX);
    const dy = Math.abs(this.targetY - this.renderY);
    return dx < threshold && dy < threshold;
  }
}

export default ClientProjectile;
