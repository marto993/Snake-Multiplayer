class Snake {
    constructor(ID, playerName, segmentSize, canvasWidht, canvasHeight, startX, startY, directionX, directionY, playerColor = '#00ff41', gameSpeed = 91) {
      this.id = ID;
      this.name = playerName;
	  this.color = playerColor;
      this.canvaswidht = canvasWidht;
      this.canvasheight = canvasHeight;

      this.segmentSize = segmentSize;
      this.segments = [
        { x: startX, y: startY }
      ];
      // Giro libre: `heading` es el rumbo (radianes, 0 = derecha, en sentido horario porque y
      // crece hacia abajo) y `direction` su vector unitario. Cada paso el rumbo gira hacia
      // `targetHeading` como mucho `turnRate` radianes.
      this.turnRate = Snake.DEFAULT_TURN_RATE;
      this.setHeading(Math.atan2(directionY, directionX));
      this.targetHeading = this.heading;
      this.eatFood = false;
      this.score = 1; // Modificado: iniciar con puntaje 1 (tamaño inicial)
      this.gameover = false;
      this.scoreLeftToGrow = 0;
      
      // Efectos de los consumibles: un vencimiento por tipo (hora del servidor en ms), por ejemplo
      // { immunity: 1732300000000, fan: 1732300002500 }. Cada uno vence por su cuenta.
      this.effects = {};
      this.lastShotAt = -Infinity; // hora del servidor del último disparo, para la pausa entre tiros
      
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
    
    // Lógica de movimiento (servidor): gira hacia el rumbo pedido y avanza un cuerpo.
    // Las posiciones se redondean a 0,1 px: el frame pesa menos y el paso sigue midiendo una
    // celda (±0,07 px).
    moveLogic() {
      this.turn();
      const head = { ...this.targetSegments[0] };
      head.x = Snake.round1(head.x + this.direction.x * this.segmentSize);
      head.y = Snake.round1(head.y + this.direction.y * this.segmentSize);

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
    
    // Rumbo y su vector unitario, redondeado a 4 decimales: en los ejes queda exacto (0, ±1) y
    // el frame no arrastra 17 cifras por componente
    setHeading(angle) {
      this.heading = Snake.normalizeAngle(angle);
      this.direction = {
        x: Math.round(Math.cos(this.heading) * 10000) / 10000 || 0,
        y: Math.round(Math.sin(this.heading) * 10000) / 10000 || 0
      };
    }

    // Rumbo pedido por el jugador (mouse o teclado). El giro ocurre en los próximos pasos.
    steerTo(angle) {
      if (typeof angle !== 'number' || !Number.isFinite(angle)) return false;
      this.targetHeading = Snake.normalizeAngle(angle);
      return true;
    }

    // Compatibilidad con clientes viejos (`newMove`): una flecha pide ese rumbo. La vuelta en U
    // ya no se rechaza: es una curva.
    changeDirection(newDirection) {
      if (!newDirection || (!newDirection.x && !newDirection.y)) return false;
      return this.steerTo(Math.atan2(newDirection.y, newDirection.x));
    }

    // Un paso de giro: hacia el rumbo pedido por el lado corto, como mucho turnRate.
    // Si el pedido es justo el opuesto, dobla hacia la derecha de la serpiente.
    turn() {
      const delta = Snake.normalizeAngle(this.targetHeading - this.heading);
      if (delta === 0) return false;
      if (Math.abs(delta) <= this.turnRate) this.setHeading(this.targetHeading);
      else this.setHeading(this.heading + Math.sign(delta) * this.turnRate);
      return true;
    }

    EatFood(scoreFood) {
        this.scoreLeftToGrow += scoreFood; // Modificado: acumular crecimiento
        this.eatFood = true;
        // El puntaje se actualiza automáticamente en el método move()
    }
    
    // Activa un efecto o, si ya estaba activo, reinicia su tiempo a la duración completa (no suma)
    addEffect(type, durationMs, now) {
        this.effects[type] = now + durationMs;
    }

    hasEffect(type, now) {
        const end = this.effects[type];
        return end !== undefined && now < end;
    }

    removeEffect(type) {
        delete this.effects[type];
    }

    // Los efectos vigentes, para mandarlos en el frame. Borra los vencidos.
    activeEffects(now) {
        const active = {};
        for (const type of Object.keys(this.effects)) {
            if (now < this.effects[type]) active[type] = this.effects[type];
            else delete this.effects[type];
        }
        return active;
    }

    // El escudo bloquea un disparo y se consume. `now` es opcional porque traceProjectile pregunta sin hora.
    hasImmunity(now = Date.now()) {
        return this.hasEffect('immunity', now);
    }

    useImmunity(now = Date.now()) {
        if (!this.hasImmunity(now)) return false;
        this.removeEffect('immunity');
        return true;
    }
    
    // Pausa entre tiros: si pasaron cooldownMs desde el último, anota este y devuelve true
    tryShot(now, cooldownMs) {
      if (now - this.lastShotAt < cooldownMs) return false;
      this.lastShotAt = now;
      return true;
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
      this.effects = {};
    }
    
    // Reinicia la snake sin "morir": `length` segmentos en línea, el cuerpo detrás de la cabeza
    reset(startX, startY, directionX = 1, directionY = 0, length = 1) {
      const body = () => Array.from({ length }, (_, i) => ({
        x: startX - directionX * this.segmentSize * i,
        y: startY - directionY * this.segmentSize * i
      }));
      // Arrays con objetos propios: el cliente escribe renderSegments en el lugar
      this.segments = body();
      this.targetSegments = body();
      this.renderSegments = body();
      this.setHeading(Math.atan2(directionY, directionX));
      this.targetHeading = this.heading;
      this.score = length;
      this.gameover = false;
      this.scoreLeftToGrow = 0;
      this.eatFood = false;
      
      this.effects = {};
      this.lastShotAt = -Infinity;
    }
    
    // Método para obtener el puntaje actual (tamaño de la snake)
    getCurrentScore() {
      return this.segments.length;
    }

    // Ángulo en (-π, π]
    static normalizeAngle(a) {
      const TAU = Math.PI * 2;
      a = a % TAU;
      if (a <= -Math.PI) a += TAU;
      else if (a > Math.PI) a -= TAU;
      return a;
    }

    static round1(v) {
      return Math.round(v * 10) / 10;
    }
}

// Giro máximo por paso si la sala no dice otro (40°, como la tabla de dificultad)
Snake.DEFAULT_TURN_RATE = 40 * Math.PI / 180;

// Verificar si el código se está ejecutando en Node.js o en el navegador
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = Snake;
} else {
  window.Snake = Snake;
}