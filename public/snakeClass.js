class Snake {
    constructor(ID, playerName, segmentSize, canvasWidht, canvasHeight, startX, startY, directionX, directionY, playerColor = '#00ff41', gameSpeed = 91) {
      this.id = ID;
      this.name = playerName;
	  this.color = playerColor;
      this.canvaswidht = canvasWidht;
      this.canvasheight = canvasHeight;
	  this.moveQueue = []; // Cola de movimientos pendientes

      this.segmentSize = segmentSize;
      this.segments = [
        { x: startX, y: startY }
      ];
      this.direction = { x: directionX, y: directionY };
      this.eatFood = false;
      this.score = 1; // Modificado: iniciar con puntaje 1 (tamaño inicial)
      this.gameover = false;
      this.scoreLeftToGrow = 0;
      
      // MODIFICADO: Sistema de consumibles basado en tiempo
      this.activeConsumable = null; // { type: 'immunity', endTime: timestamp }
      
      // Calcular interpolationSpeed basado en gameSpeed
      this.interpolationSpeed = this.calculateInterpolationSpeed(gameSpeed);
      this.targetSegments = [{ x: startX, y: startY }];
      this.renderSegments = [{ x: startX, y: startY }];
      this.lastMoveTime = Date.now();
    }
    
    // Calcular interpolación óptima según velocidad del juego
    calculateInterpolationSpeed(gameSpeed) {
      // Mapeo: gameSpeed 25-200ms -> interpolationSpeed 0.3-0.08
      const minSpeed = 25;
      const maxSpeed = 200;
      const minInterpolation = 0.08;
      const maxInterpolation = 0.3;
      
      // Clamp gameSpeed al rango válido
      const clampedSpeed = Math.max(minSpeed, Math.min(maxSpeed, gameSpeed));
      
      // Interpolación inversa: juego más rápido = interpolación más alta
      const normalizedSpeed = (clampedSpeed - minSpeed) / (maxSpeed - minSpeed);
      return maxInterpolation - (normalizedSpeed * (maxInterpolation - minInterpolation));
    }
    
    // Actualizar velocidad de interpolación
    updateInterpolationSpeed(gameSpeed) {
      this.interpolationSpeed = this.calculateInterpolationSpeed(gameSpeed);
    }
    
    move() {
	  const head = { ...this.segments[0] };
	  head.x += this.direction.x * this.segmentSize;
	  head.y += this.direction.y * this.segmentSize;
	  
	  // *** LÓGICA DE PORTALES PARA EL CLIENTE ***
	  const gridWidth = Math.floor(this.canvaswidht / this.segmentSize);
	  const gridHeight = Math.floor(this.canvasheight / this.segmentSize);
	  
	  // Portal horizontal (izquierda/derecha)
	  if (head.x < 0) {
		head.x = (gridWidth - 1) * this.segmentSize;
	  } else if (head.x >= this.canvaswidht) {
		head.x = 0;
	  }
	  
	  // Portal vertical (arriba/abajo)
	  if (head.y < 0) {
		head.y = (gridHeight - 1) * this.segmentSize;
	  } else if (head.y >= this.canvasheight) {
		head.y = 0;
	  }
	  
	  this.segments.unshift(head);

	  if (this.scoreLeftToGrow === 0) {
		this.segments.pop();
	  } else {
		this.scoreLeftToGrow--;
		this.eatFood = false;
	  }
	  
      // Modificado: Actualizar puntaje basado en el tamaño
      this.score = this.segments.length;
      
	  // Actualizar targets para interpolación
	  this.updateTargets();
	}
    
    // Nueva función para lógica de movimiento (servidor)
    moveLogic() {
      const head = { ...this.targetSegments[0] };
      head.x += this.direction.x * this.segmentSize;
      head.y += this.direction.y * this.segmentSize;
      
      this.targetSegments.unshift(head);
  
      if (this.scoreLeftToGrow === 0) {
        this.targetSegments.pop();
      } else {
        this.scoreLeftToGrow--;
        this.eatFood = false;
      }
      
      // Modificado: Actualizar puntaje basado en el tamaño
      this.score = this.targetSegments.length;
      
      // Actualizar segments para compatibilidad
      this.segments = [...this.targetSegments];
      this.lastMoveTime = Date.now();
    }
    
    // Actualizar targets basado en segments actuales
    updateTargets() {
      this.targetSegments = this.segments.map(seg => ({ ...seg }));
      this.lastMoveTime = Date.now();
    }
    
    // Interpolación para renderizado suave (Fase 1)
	updateRenderPosition(deltaTime = 16) {
		if (this.gameover || this.targetSegments.length === 0) {
		this.renderSegments = this.segments.map(seg => ({ ...seg }));
		return;
		}

		// Asegurar que renderSegments tenga el mismo tamaño que targetSegments
		while (this.renderSegments.length < this.targetSegments.length) {
		this.renderSegments.push({ ...this.targetSegments[this.renderSegments.length] });
		}
		while (this.renderSegments.length > this.targetSegments.length) {
		this.renderSegments.pop();
		}

		// Detectar portales y manejar interpolación especial
		this.renderSegments = this.renderSegments.map((renderSeg, index) => {
		if (index >= this.targetSegments.length) return renderSeg;

		const target = this.targetSegments[index];

		// Detectar salto de portal (diferencia grande en posición)
		const deltaX = Math.abs(target.x - renderSeg.x);
		const deltaY = Math.abs(target.y - renderSeg.y);
		const maxNormalMove = this.segmentSize * 2; // Máximo movimiento normal

		// Si detectamos un portal, saltar directamente sin interpolación
		if (deltaX > maxNormalMove || deltaY > maxNormalMove) {
		  return { x: target.x, y: target.y };
		}

		// Interpolación normal usando la velocidad calculada dinámicamente
		return {
		  x: this.lerp(renderSeg.x, target.x, this.interpolationSpeed),
		  y: this.lerp(renderSeg.y, target.y, this.interpolationSpeed)
		};
		});
	}
    
    // Función de interpolación lineal
    lerp(start, end, factor) {
      return start + (end - start) * factor;
    }
    
    // Obtener posiciones para renderizado
    getRenderSegments() {
      return this.renderSegments.length > 0 ? this.renderSegments : this.segments;
    }
    
    changeDirection(newDirection) {
	// Evitar cambiar la dirección opuesta
	if ((newDirection.x === 1 && this.direction.x === -1) ||
	(newDirection.x === -1 && this.direction.x === 1) ||
	(newDirection.y === 1 && this.direction.y === -1) ||
	(newDirection.y === -1 && this.direction.y === 1)) {
		return false;
	}

	// Si la cola está vacía o el movimiento es diferente al último en cola
	if (this.moveQueue.length === 0 || 
	  (this.moveQueue[this.moveQueue.length - 1].x !== newDirection.x || 
	   this.moveQueue[this.moveQueue.length - 1].y !== newDirection.y)) {

		// Limitar cola a máximo 3 movimientos
		if (this.moveQueue.length < 3) {
			this.moveQueue.push({ ...newDirection });
		}
	}

	return true;
	}

	// Agregar nuevo método para procesar la cola:
	processNextMove() {
		if (this.moveQueue.length > 0) {
			const nextMove = this.moveQueue.shift();
			this.direction = nextMove;
			return true;
		}
			return false;
	}
  
    EatFood(scoreFood) {
        this.scoreLeftToGrow += scoreFood; // Modificado: acumular crecimiento
        this.eatFood = true;
        // El puntaje se actualiza automáticamente en el método move()
    }
    
    // MODIFICADO: Consumir consumible con duración por tiempo
    consumeConsumable(consumableType, durationSeconds) {
        const endTime = Date.now() + (durationSeconds * 1000);
        switch(consumableType) {
            case 'immunity':
                this.activeConsumable = {
                    type: 'immunity',
                    endTime: endTime
                };
                break;
            default:
                console.warn(`Unknown consumable type: ${consumableType}`);
        }
    }
    
    // MODIFICADO: Verificar si tiene inmunidad activa basado en tiempo
    hasImmunity() {
        if (!this.activeConsumable || this.activeConsumable.type !== 'immunity') {
            return false;
        }
        
        const currentTime = Date.now();
        if (currentTime >= this.activeConsumable.endTime) {
            this.activeConsumable = null; // Limpiar consumible expirado
            return false;
        }
        
        return true;
    }
    
    // MODIFICADO: Usar inmunidad (solo eliminar el efecto, sin contar usos)
    useImmunity() {
        if (this.hasImmunity()) {
            this.activeConsumable = null; // Eliminar inmunidad al ser usada
            return true;
        }
        return false;
    }
    
    // MODIFICADO: Obtener información del consumible activo para serialización
    getActiveConsumable() {
        // Verificar expiración antes de enviar
        if (this.activeConsumable) {
            const currentTime = Date.now();
            if (currentTime >= this.activeConsumable.endTime) {
                this.activeConsumable = null;
                return null;
            }
        }
        return this.activeConsumable ? { ...this.activeConsumable } : null;
    }
    
    // NUEVO: Método para verificar y limpiar consumibles expirados
    updateConsumables() {
        if (this.activeConsumable) {
            const currentTime = Date.now();
            if (currentTime >= this.activeConsumable.endTime) {
                this.activeConsumable = null;
            }
        }
    }
    
    canAttack() {
      return this.segments.length >= 2 && !this.gameover;
    }
    
    attack() {
      if (!this.canAttack()) {
        return null;
      }
      
      const head = this.segments[0];
      const projectile = {
        x: head.x + (this.direction.x * this.segmentSize),
        y: head.y + (this.direction.y * this.segmentSize),
        direction: { ...this.direction },
        playerId: this.id,
        color: this.color
      };
      
      if (this.segments.length > 1) {
        this.segments.pop();
      }
      
      // Modificado: Actualizar puntaje después del ataque
      this.score = this.segments.length;
      
      // Actualizar targets
      this.updateTargets();
      
      return projectile;
    }
    
    // Modificado: GameOver ya no se usa en el nuevo sistema basado en tiempo
    GameOver() {
      // Este método se mantiene por compatibilidad pero ya no se usa
      // en el nuevo sistema donde las rondas terminan por tiempo
      this.gameover = true;
      this.direction.x = 0;
      this.direction.y = 0;
	  this.moveQueue = [];
      this.segments = [
        { x: 0, y: 0 }
      ];
      this.targetSegments = [
        { x: 0, y: 0 }
      ];
      this.renderSegments = [
        { x: 0, y: 0 }
      ];
      this.score = 0;
      // Limpiar consumibles activos
      this.activeConsumable = null;
    }
    
    // Nuevo método para reiniciar la snake sin "morir"
    reset(startX, startY, directionX = 1, directionY = 0) {
      this.segments = [{ x: startX, y: startY }];
      this.targetSegments = [{ x: startX, y: startY }];
      this.renderSegments = [{ x: startX, y: startY }];
      this.direction = { x: directionX, y: directionY };
      this.score = 1;
      this.gameover = false;
      this.scoreLeftToGrow = 0;
      this.moveQueue = [];
      this.eatFood = false;
      
      // Limpiar consumibles activos al reiniciar
      this.activeConsumable = null;
    }
    
    // Método para obtener el puntaje actual (tamaño de la snake)
    getCurrentScore() {
      return this.segments.length;
    }
}

// Verificar si el código se está ejecutando en Node.js o en el navegador
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = Snake;
} else {
  window.Snake = Snake;
}