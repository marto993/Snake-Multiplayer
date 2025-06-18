class Snake {
    constructor(ID, playerName, segmentSize, canvasWidht, canvasHeight, startX, startY, directionX, directionY) {
      this.id = ID;
      //this.ctx = ctx;
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
      //this.gameboard = gameBoard;
    }
    move() {
      const head = { ...this.segments[0] };
      head.x += this.direction.x * this.segmentSize;
      head.y += this.direction.y * this.segmentSize;
      
      this.segments.unshift(head); // Agregar la nueva cabeza al inicio
  
      // Eliminar el último segmento si no se ha comido algo
      if (this.scoreLeftToGrow === 0) {//(!this.eatFood) {
        this.segments.pop();
      } else { // entonces, si se comió la comida...
        this.scoreLeftToGrow--;
        this.eatFood = false;
      } 
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
    GameOver() {
      this.gameover = true;
      this.direction.x = 0;
      this.direction.y = 0;
      this.segments = [
        { x: 0, y: 0 }
      ];
    }
  }


// Verificar si el código se está ejecutando en Node.js o en el navegador
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  // El código se está ejecutando en Node.js, exportamos la clase
  module.exports = Snake;
} else {
  // El código se está ejecutando en el navegador, definimos la clase en el ámbito global
  window.Snake = Snake;
}