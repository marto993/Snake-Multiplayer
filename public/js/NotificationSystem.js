/**
 * Sistema de Notificaciones
 * Gestiona notificaciones animadas en canvas
 */

import { NOTIFICATIONS } from './constants.js';
import { lerp, easeOut, easeIn } from './utils.js';

/**
 * Clase para notificación individual
 */
class CanvasNotification {
  constructor(message, type = NOTIFICATIONS.TYPES.INFO, duration = NOTIFICATIONS.DURATION) {
    this.message = message;
    this.type = type;
    this.duration = duration;
    this.createdAt = Date.now();
    this.alpha = 0;
    this.y = -50;
    this.targetY = NOTIFICATIONS.INITIAL_Y;
    this.animationPhase = 'entering';
    this.id = Math.random().toString(36).substring(2, 9);

    // Configurar colores según tipo
    const colors = NOTIFICATIONS.COLORS[type.toUpperCase()] || NOTIFICATIONS.COLORS.INFO;
    this.backgroundColor = colors.BG;
    this.textColor = colors.TEXT;
    this.borderColor = colors.BORDER;
  }

  /**
   * Actualizar estado de la notificación
   * @returns {boolean} - true si debe seguir mostrándose, false si debe eliminarse
   */
  update() {
    const now = Date.now();
    const elapsed = now - this.createdAt;

    switch (this.animationPhase) {
      case 'entering':
        return this.updateEntering(elapsed);

      case 'showing':
        return this.updateShowing(elapsed);

      case 'exiting':
        return this.updateExiting(elapsed);

      default:
        return false;
    }
  }

  updateEntering(elapsed) {
    const progress = Math.min(elapsed / NOTIFICATIONS.ENTER_DURATION, 1);
    this.alpha = progress;
    this.y = lerp(-50, this.targetY, easeOut(progress));

    if (progress >= 1) {
      this.animationPhase = 'showing';
    }
    return true;
  }

  updateShowing(elapsed) {
    this.alpha = 1;
    this.y = this.targetY;

    if (elapsed >= this.duration - NOTIFICATIONS.EXIT_DURATION) {
      this.animationPhase = 'exiting';
    }
    return true;
  }

  updateExiting(elapsed) {
    const exitStart = this.duration - NOTIFICATIONS.EXIT_DURATION;
    const exitProgress = (elapsed - exitStart) / NOTIFICATIONS.EXIT_DURATION;

    this.alpha = 1 - exitProgress;
    this.y = lerp(this.targetY, -50, easeIn(exitProgress));

    return exitProgress < 1;
  }

  /**
   * Dibujar notificación en canvas
   * @param {CanvasRenderingContext2D} ctx - Contexto del canvas
   */
  draw(ctx) {
    if (this.alpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = this.alpha;

    // Configurar fuente
    ctx.font = `400 ${NOTIFICATIONS.FONT_SIZE}px Share Tech Mono, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Medir texto para dimensiones del toast
    const textWidth = ctx.measureText(this.message).width;
    const toastWidth = textWidth + (NOTIFICATIONS.PADDING * 2);
    const toastHeight = NOTIFICATIONS.HEIGHT;
    const x = (ctx.canvas.width - toastWidth) / 2;

    // Dibujar fondo del toast
    ctx.fillStyle = this.backgroundColor;
    this.roundRect(ctx, x, this.y, toastWidth, toastHeight, NOTIFICATIONS.BORDER_RADIUS);
    ctx.fill();

    // Dibujar borde
    ctx.strokeStyle = this.borderColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dibujar texto
    ctx.fillStyle = this.textColor;
    ctx.fillText(this.message, ctx.canvas.width / 2, this.y + toastHeight / 2);

    ctx.restore();
  }

  /**
   * Dibujar rectángulo con bordes redondeados
   */
  roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  /**
   * Forzar inicio de salida
   */
  forceExit() {
    if (this.animationPhase !== 'exiting') {
      this.animationPhase = 'exiting';
      this.createdAt = Date.now() - (this.duration - NOTIFICATIONS.EXIT_DURATION);
    }
  }
}

/**
 * Gestor del sistema de notificaciones
 */
export class NotificationSystem {
  constructor() {
    this.notifications = [];
  }

  /**
   * Agregar nueva notificación
   * @param {string} message - Mensaje a mostrar
   * @param {string} type - Tipo de notificación (info, success, error, invitation)
   * @param {number} duration - Duración en ms
   */
  add(message, type = NOTIFICATIONS.TYPES.INFO, duration = NOTIFICATIONS.DURATION) {
    if (!message || message.trim() === '') return;

    // Marcar todas las notificaciones existentes para salida
    this.notifications.forEach(notif => notif.forceExit());

    // Crear nueva notificación
    const notification = new CanvasNotification(message.trim(), type, duration);
    notification.targetY = NOTIFICATIONS.INITIAL_Y;
    this.notifications.push(notification);
  }

  /**
   * Actualizar todas las notificaciones
   */
  update() {
    this.notifications = this.notifications.filter(notification => notification.update());
  }

  /**
   * Dibujar todas las notificaciones
   * @param {CanvasRenderingContext2D} ctx - Contexto del canvas
   */
  draw(ctx) {
    this.notifications.forEach(notification => notification.draw(ctx));
  }

  /**
   * Limpiar todas las notificaciones
   */
  clear() {
    this.notifications = [];
  }

  /**
   * Obtener número de notificaciones activas
   * @returns {number}
   */
  getCount() {
    return this.notifications.length;
  }
}

export default NotificationSystem;
