/**
 * RenderEngine - Motor de Renderizado
 * Maneja todo el dibujado en canvas (grid, snakes, food, projectiles, etc.)
 */

import { CANVAS, COLORS, RENDER, SNAKE, FOOD, PROJECTILE, HEXAGON, CONSUMABLES, COUNTDOWN, INFO_CANVAS } from './constants.js';
import { truncate } from './utils.js';

/**
 * Clase para el motor de renderizado
 */
export class RenderEngine {
  constructor(canvasId, infoCanvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');

    this.infoCanvas = document.getElementById(infoCanvasId);
    this.infoCtx = this.infoCanvas.getContext('2d');

    this.segmentSize = 20;
  }

  /**
   * Actualizar tamaño de segmento
   */
  setSegmentSize(size) {
    this.segmentSize = size;
  }

  /**
   * Limpiar canvas principal
   */
  clear() {
    this.ctx.fillStyle = COLORS.BACKGROUND;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Limpiar canvas de información
   */
  clearInfo() {
    this.infoCtx.fillStyle = CANVAS.BACKGROUND_COLOR;
    this.infoCtx.fillRect(0, 0, this.infoCanvas.width, this.infoCanvas.height);
  }

  /**
   * Dibujar grid
   */
  drawGrid() {
    this.ctx.strokeStyle = COLORS.GRID;
    this.ctx.lineWidth = 1;

    // Líneas verticales
    for (let x = 0; x <= this.canvas.width; x += this.segmentSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
      this.ctx.stroke();
    }

    // Líneas horizontales
    for (let y = 0; y <= this.canvas.height; y += this.segmentSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }
  }

  /**
   * Dibujar jugadores (snakes)
   */
  drawPlayers(snakes, currentSocketId) {
    snakes.forEach(snake => {
      if (snake.gameover || !snake.getRenderSegments) return;

      const isCurrentPlayer = snake.id === currentSocketId;
      const renderSegments = snake.getRenderSegments();
      const hasImmunity = this.hasActiveImmunity(snake);

      renderSegments.forEach((segment, segIndex) => {
        const isHead = segIndex === 0;

        this.drawSnakeSegment(
          segment.x,
          segment.y,
          this.segmentSize,
          snake.color,
          isHead,
          isHead ? snake.direction : null,
          isCurrentPlayer,
          hasImmunity
        );
      });
    });
  }

  /**
   * Verificar si tiene inmunidad activa
   */
  hasActiveImmunity(snake) {
    return snake.activeConsumable &&
           snake.activeConsumable.type === 'immunity' &&
           Date.now() < snake.activeConsumable.endTime;
  }

  /**
   * Dibujar segmento de snake
   */
  drawSnakeSegment(x, y, size, color, isHead = false, direction = null, isCurrentPlayer = false, hasImmunity = false) {
    const padding = SNAKE.SEGMENT_PADDING;
    const innerSize = size - (padding * 2);

    // Efecto de inmunidad
    if (hasImmunity) {
      const pulseIntensity = (Math.sin(Date.now() * 0.008) + 1) * 0.6;
      const glowSize = 4 + (pulseIntensity * 3);
      const glowAlpha = 0.6 + (pulseIntensity * 0.4);

      this.ctx.shadowColor = `rgba(120, 170, 255, ${glowAlpha})`;
      this.ctx.shadowBlur = glowSize;
      this.ctx.fillStyle = color;
      this.ctx.fillRect(x + padding, y + padding, innerSize, innerSize);

      this.ctx.shadowColor = `rgba(170, 220, 255, ${glowAlpha * 0.7})`;
      this.ctx.shadowBlur = glowSize * 1.35;
      this.ctx.fillRect(x + padding, y + padding, innerSize, innerSize);

      this.ctx.shadowBlur = 0;
      this.ctx.shadowColor = 'transparent';
    }

    // Dibujar segmento
    this.drawRect(x + padding, y + padding, innerSize, innerSize, color);

    // Cabeza con ojos
    if (isHead) {
      this.ctx.strokeStyle = '#000000';
      this.ctx.lineWidth = 1;
      this.ctx.strokeRect(x + padding, y + padding, innerSize, innerSize);

      if (direction) {
        this.drawEyes(x, y, size, direction);
      }
    }

    // Borde
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x + padding, y + padding, innerSize, innerSize);
  }

  /**
   * Dibujar ojos
   */
  drawEyes(x, y, size, direction) {
    const eyeSize = Math.max(2, size * SNAKE.EYE_SIZE_RATIO);
    const eyeOffset = size * SNAKE.EYE_OFFSET_RATIO;

    let leftEyeX, leftEyeY, rightEyeX, rightEyeY;

    if (direction.x === 1) {
      leftEyeX = x + size - eyeOffset;
      leftEyeY = y + eyeOffset;
      rightEyeX = x + size - eyeOffset;
      rightEyeY = y + size - eyeOffset;
    } else if (direction.x === -1) {
      leftEyeX = x + eyeOffset;
      leftEyeY = y + eyeOffset;
      rightEyeX = x + eyeOffset;
      rightEyeY = y + size - eyeOffset;
    } else if (direction.y === -1) {
      leftEyeX = x + eyeOffset;
      leftEyeY = y + eyeOffset;
      rightEyeX = x + size - eyeOffset;
      rightEyeY = y + eyeOffset;
    } else {
      leftEyeX = x + eyeOffset;
      leftEyeY = y + size - eyeOffset;
      rightEyeX = x + size - eyeOffset;
      rightEyeY = y + size - eyeOffset;
    }

    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(leftEyeX - eyeSize/2, leftEyeY - eyeSize/2, eyeSize, eyeSize);
    this.ctx.fillRect(rightEyeX - eyeSize/2, rightEyeY - eyeSize/2, eyeSize, eyeSize);
  }

  /**
   * Dibujar food
   */
  drawFoods(foods) {
    foods.forEach(food => this.drawFood(food));
  }

  drawFood(food) {
    const padding = FOOD.PADDING;
    const size = this.segmentSize - (padding * 2);

    const pulse = Math.sin(Date.now() * FOOD.PULSE_SPEED) * FOOD.PULSE_SCALE + 1;
    const pulseSize = size * pulse;
    const offset = (size - pulseSize) / 2;

    this.drawRect(
      food.x + padding + offset,
      food.y + padding + offset,
      pulseSize,
      pulseSize,
      COLORS.FOOD,
      COLORS.FOOD_GLOW
    );

    // Dibujar puntaje
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = `bold ${Math.max(8, this.segmentSize * FOOD.FONT_SIZE_RATIO)}px monospace`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    const centerX = food.x + this.segmentSize / 2;
    const centerY = food.y + this.segmentSize / 2;

    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = FOOD.STROKE_WIDTH;
    this.ctx.strokeText(food.score, centerX, centerY);
    this.ctx.fillText(food.score, centerX, centerY);
  }

  /**
   * Dibujar consumables
   */
  drawConsumables(consumables) {
    consumables.forEach(consumable => this.drawConsumable(consumable));
  }

  drawConsumable(consumable) {
    const style = this.getConsumableStyle(consumable.type);
    if (!style) return;

    const centerX = consumable.x + this.segmentSize / 2;
    const centerY = consumable.y + this.segmentSize / 2;
    const pulse = Math.sin(Date.now() * HEXAGON.PULSE_SPEED) * HEXAGON.PULSE_SCALE + 1;
    const size = (this.segmentSize * HEXAGON.SIZE_RATIO) * pulse;

    if (consumable.type === 'immunity') {
      this.drawLayeredHexagon(centerX, centerY, size, style.color, '#c080ff', style.glowColor);
    } else {
      this.drawHexagon(centerX, centerY, size, style.color, style.glowColor);
    }
  }

  getConsumableStyle(type) {
    const styles = {
      immunity: CONSUMABLES.IMMUNITY,
    };
    return styles[type] || null;
  }

  /**
   * Dibujar hexágono
   */
  drawHexagon(centerX, centerY, radius, color, glowColor) {
    const sides = HEXAGON.SIDES;
    const angle = (Math.PI * 2) / sides;

    this.ctx.beginPath();

    for (let i = 0; i <= sides; i++) {
      const x = centerX + Math.cos(i * angle) * radius;
      const y = centerY + Math.sin(i * angle) * radius;

      if (i === 0) {
        this.ctx.moveTo(x, y);
      } else {
        this.ctx.lineTo(x, y);
      }
    }

    this.ctx.closePath();

    if (glowColor) {
      this.ctx.shadowColor = glowColor;
      this.ctx.shadowBlur = HEXAGON.STROKE_WIDTH * 4;
    }

    this.ctx.fillStyle = color;
    this.ctx.fill();

    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineWidth = HEXAGON.STROKE_WIDTH;
    this.ctx.stroke();

    this.ctx.shadowBlur = 0;
    this.ctx.shadowColor = 'transparent';
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 0;
  }

  /**
   * Dibujar hexágono con capas
   */
  drawLayeredHexagon(centerX, centerY, size, baseColor, accentColor, glowColor) {
    const pulse = Math.sin(Date.now() * RENDER.PULSE_SPEED) * RENDER.PULSE_RANGE + 1;

    this.ctx.globalAlpha = HEXAGON.OUTER_ALPHA;
    this.drawHexagon(centerX, centerY, size * pulse * HEXAGON.GLOW_MULTIPLIER, accentColor, glowColor);

    this.ctx.globalAlpha = 1;
    this.drawHexagon(centerX, centerY, size * pulse, baseColor, glowColor);

    this.ctx.globalAlpha = HEXAGON.INNER_ALPHA;
    this.drawHexagon(centerX, centerY, size * HEXAGON.INNER_SIZE_RATIO, '#ffffff', '#ffffff');
    this.ctx.globalAlpha = 1;
  }

  /**
   * Dibujar proyectiles
   */
  drawProjectiles(projectiles) {
    projectiles.forEach(projectile => this.drawProjectile(projectile));
  }

  drawProjectile(projectile) {
    const centerX = projectile.renderX + this.segmentSize / 2;
    const centerY = projectile.renderY + this.segmentSize / 2;
    const size = this.segmentSize * PROJECTILE.SIZE_RATIO;

    this.ctx.save();
    this.ctx.translate(centerX, centerY);
    this.ctx.rotate(PROJECTILE.ROTATION);

    this.drawRect(-size/2, -size/2, size, size, projectile.color || COLORS.PROJECTILE, '#ffff80');

    this.ctx.restore();
  }

  /**
   * Dibujar rectángulo con glow
   */
  drawRect(x, y, width, height, color, glowColor = null) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, width, height);

    if (glowColor) {
      this.ctx.shadowColor = glowColor;
      this.ctx.shadowBlur = RENDER.GLOW_BLUR;
      this.ctx.fillRect(x, y, width, height);
      this.ctx.shadowBlur = 0;
      this.ctx.shadowColor = 'transparent';
    }
  }

  /**
   * Dibujar countdown en canvas principal
   */
  drawCountdown(roundTimeLeft) {
    if (roundTimeLeft > COUNTDOWN.SHOW_UNDER_SECONDS || roundTimeLeft < 0) return;

    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;

    this.ctx.save();

    const fontSize = COUNTDOWN.BASE_FONT_SIZE + (COUNTDOWN.SHOW_UNDER_SECONDS - roundTimeLeft) * COUNTDOWN.FONT_GROWTH;
    this.ctx.font = `bold ${fontSize}px Share Tech Mono, monospace`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    const pulseScale = 1 + Math.sin(Date.now() * COUNTDOWN.PULSE_SPEED) * COUNTDOWN.PULSE_SCALE;
    this.ctx.scale(pulseScale, pulseScale);

    let alpha, strokeColor, fillColor;
    if (roundTimeLeft <= 3) {
      alpha = COUNTDOWN.ALPHA_DANGER;
      strokeColor = COLORS.DANGER;
      fillColor = COLORS.DANGER;
    } else if (roundTimeLeft <= 5) {
      alpha = COUNTDOWN.ALPHA_WARNING;
      strokeColor = COLORS.WARNING;
      fillColor = COLORS.WARNING;
    } else {
      alpha = COUNTDOWN.ALPHA_NORMAL;
      strokeColor = COLORS.ACCENT;
      fillColor = COLORS.ACCENT;
    }

    this.ctx.shadowColor = strokeColor;
    this.ctx.shadowBlur = COUNTDOWN.SHADOW_BLUR;
    this.ctx.globalAlpha = alpha;

    this.ctx.strokeStyle = strokeColor;
    this.ctx.lineWidth = COUNTDOWN.STROKE_WIDTH;
    this.ctx.strokeText(roundTimeLeft.toString(), centerX / pulseScale, centerY / pulseScale);

    this.ctx.fillStyle = fillColor;
    this.ctx.fillText(roundTimeLeft.toString(), centerX / pulseScale, centerY / pulseScale);

    if (roundTimeLeft <= 1) {
      this.ctx.font = `400 48px Share Tech Mono, monospace`;
      this.ctx.globalAlpha = alpha * 0.8;
      const warningY = (centerY / pulseScale) + 160;
      this.ctx.strokeText('¡TIEMPO!', centerX / pulseScale, warningY);
      this.ctx.fillText('¡TIEMPO!', centerX / pulseScale, warningY);
    }

    this.ctx.restore();
  }

  /**
   * Dibujar info canvas
   */
  drawInfoCanvas(gameState, snakes, roomScores, socketId, notificationSystem) {
    this.clearInfo();

    const leftSectionWidth = INFO_CANVAS.LEFT_SECTION_WIDTH;
    const rightSectionX = leftSectionWidth + INFO_CANVAS.RIGHT_SECTION_OFFSET;

    // Sección izquierda: Ronda y tiempo
    this.infoCtx.textAlign = 'left';

    this.infoCtx.font = `400 ${INFO_CANVAS.ROUND_FONT_SIZE}px Share Tech Mono, monospace`;
    this.infoCtx.fillStyle = COLORS.TEXT_PRIMARY;
    this.infoCtx.fillText(`RONDA ${gameState.round}/3`, INFO_CANVAS.PADDING, 32);

    const timeColor = gameState.roundTimeLeft <= 10 ? COLORS.DANGER :
                      gameState.roundTimeLeft <= 20 ? COLORS.WARNING : COLORS.ACCENT;

    this.infoCtx.font = `400 ${INFO_CANVAS.TIME_FONT_SIZE}px Share Tech Mono, monospace`;
    this.infoCtx.fillStyle = timeColor;
    this.infoCtx.fillText(`${gameState.roundTimeLeft}s`, INFO_CANVAS.PADDING, 75);

    // Línea divisoria
    this.infoCtx.strokeStyle = CANVAS.GRID_COLOR;
    this.infoCtx.lineWidth = 1;
    this.infoCtx.beginPath();
    this.infoCtx.moveTo(leftSectionWidth, INFO_CANVAS.DIVIDER_PADDING);
    this.infoCtx.lineTo(leftSectionWidth, this.infoCanvas.height - INFO_CANVAS.DIVIDER_PADDING);
    this.infoCtx.stroke();

    // Sección derecha: Jugadores
    if (snakes && snakes.length > 0) {
      this.drawPlayerScores(snakes, roomScores, gameState.playing, rightSectionX, socketId);
    }

    // Notificaciones
    if (notificationSystem) {
      notificationSystem.update();
      notificationSystem.draw(this.infoCtx);
    }
  }

  /**
   * Dibujar puntajes de jugadores
   */
  drawPlayerScores(snakes, roomScores, isPlaying, startX, socketId) {
    const sortedSnakes = [...snakes].sort((a, b) => {
      if (isPlaying) {
        return b.score - a.score;
      } else {
        const aTotal = roomScores[a.id]?.totalScore || 0;
        const bTotal = roomScores[b.id]?.totalScore || 0;
        return bTotal - aTotal;
      }
    });

    const maxPlayersPerRow = Math.min(16, sortedSnakes.length);
    const totalRows = Math.ceil(sortedSnakes.length / maxPlayersPerRow);
    const rightSectionWidth = this.infoCanvas.width - startX - INFO_CANVAS.PADDING;
    const playerWidth = rightSectionWidth / maxPlayersPerRow;
    const playerHeight = Math.max(INFO_CANVAS.MIN_PLAYER_HEIGHT, (this.infoCanvas.height - INFO_CANVAS.PADDING) / totalRows);

    sortedSnakes.forEach((snake, index) => {
      const row = Math.floor(index / maxPlayersPerRow);
      const col = index % maxPlayersPerRow;
      const x = startX + (col * playerWidth) + 10;
      const y = INFO_CANVAS.START_Y + (row * playerHeight);

      const textColor = snake.color || COLORS.ACCENT;

      this.infoCtx.font = `400 ${INFO_CANVAS.PLAYER_FONT_SIZE}px Share Tech Mono, monospace`;
      this.infoCtx.fillStyle = textColor;
      this.infoCtx.textAlign = 'left';

      const maxNameLength = Math.floor(playerWidth / 10);
      const playerName = truncate(snake.name, maxNameLength);
      this.infoCtx.fillText(`#${index + 1} ${playerName}`, x, y);

      this.infoCtx.font = `400 ${INFO_CANVAS.SCORE_FONT_SIZE}px Share Tech Mono, monospace`;
      if (isPlaying) {
        this.infoCtx.fillText(`${snake.score} segs`, x, y + 16);
      } else {
        const totalScore = roomScores[snake.id]?.totalScore || 0;
        const roundWins = roomScores[snake.id]?.roundWins || 0;
        this.infoCtx.fillText(`${totalScore} segs (${roundWins}V)`, x, y + 16);
      }
    });
  }
}

export default RenderEngine;
