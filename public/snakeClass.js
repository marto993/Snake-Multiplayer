class Snake {
    constructor(ID, playerName, segmentSize, canvasWidht, canvasHeight, startX, startY, directionX, directionY) {
      this.id = ID;
      this.name = playerName;
      this.canvaswidht = canvasWidht;
      this.canvasheight = canvasHeight;

      this.segmentSize = segmentSize;
      this.segments = [
        { x: startX, y: startY }
      ];
      this.direction = { x: directionX, y: directionY };
      this.eatFood = false;
      this.score = 0;
      this.gameover = false;
      this.scoreLeftToGrow = 0;
      
      // Nuevas propiedades para interpolación (Fase 1)
      this.targetSegments = [{ x: startX, y: startY }];
      this.renderSegments = [{ x: startX, y: startY }];
      this.interpolationSpeed = 0.12; // Velocidad de interpolación
      this.lastMoveTime = Date.now();
    }
    
    move() {
      const head = { ...this.segments[0] };
      head.x += this.direction.x * this.segmentSize;
      head.y += this.direction.y * this.segmentSize;
      
      this.segments.unshift(head);
  
      if (this.scoreLeftToGrow === 0) {
        this.segments.pop();
      } else {
        this.scoreLeftToGrow--;
        this.eatFood = false;
      }
      
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
      
      // Interpolar cada segmento hacia su target
      this.renderSegments = this.renderSegments.map((renderSeg, index) => {
        if (index >= this.targetSegments.length) return renderSeg;
        
        const target = this.targetSegments[index];
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
      if (
        (newDirection.x === 1 && this.direction.x === -1) ||
        (newDirection.x === -1 && this.direction.x === 1) ||
        (newDirection.y === 1 && this.direction.y === -1) ||
        (newDirection.y === -1 && this.direction.y === 1)
      ) {
        return false;
      }
  
      this.direction = newDirection;
      return true;
    }
  
    EatFood(scoreFood) {
        this.score += scoreFood;
        this.scoreLeftToGrow = scoreFood;
        this.eatFood = true;
    }
    
    canAttack() {
      return this.segments.length >= 3 && !this.gameover;
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
        playerId: this.id
      };
      
      // Remove two segments
      this.segments.pop();
      if (this.segments.length > 1) {
        this.segments.pop();
      }
      
      // Actualizar targets
      this.updateTargets();
      
      return projectile;
    }
    
    GameOver() {
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
    }
}

// Verificar si el código se está ejecutando en Node.js o en el navegador
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = Snake;
} else {
  window.Snake = Snake;
}