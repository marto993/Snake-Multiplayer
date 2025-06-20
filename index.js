const http = require('http');
const express = require('express');
const socketIO = require('socket.io');
const Snake = require('./public/snakeClass.js');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const port = process.env.PORT || 3000;

// Colores fijos para jugadores
const PLAYER_COLORS = [
  '#00ff41', // Verde brillante
  '#ff0080', // Rosa/magenta
  '#00ffff', // Cian
  '#ffff00', // Amarillo
  '#ff4040', // Rojo
  '#8040ff', // Púrpura
  '#40ff80', // Verde claro
  '#ff8040', // Naranja
  '#4080ff', // Azul
  '#ff40ff', // Magenta claro
  '#80ff40', // Lima
  '#ff4080', // Rosa fuerte
  '#4040ff', // Azul profundo
  '#ffff80', // Amarillo claro
  '#80ffff', // Cian claro
  '#ff8080'  // Rosa claro
];

function getPlayerColor(playerIndex) {
  return PLAYER_COLORS[playerIndex % PLAYER_COLORS.length];
}

app.use(express.static('public'));

let rooms = new Map();

function serializePlayers(players) {
  return players.map(player => ({
    id: player.id,
    name: player.name,
    color: player.color,
    segments: [...player.segments],
    direction: { ...player.direction },
    score: player.score,
    gameover: player.gameover,
    scoreLeftToGrow: player.scoreLeftToGrow
  }));
}

function generateRoomId() {
  let roomId;
  do {
    roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (rooms.has(roomId));
  return roomId;
}

function validateRoomConfig(config) {
  return {
    maxPlayers: Math.max(2, Math.min(20, parseInt(config.maxPlayers) || 8)),
    minPlayers: Math.max(2, Math.min(parseInt(config.maxPlayers) || 8, parseInt(config.minPlayers) || 2)),
    maxRounds: Math.max(1, Math.min(10, parseInt(config.maxRounds) || 3)),
    gameSpeed: Math.max(25, Math.min(200, parseInt(config.gameSpeed) || 75)),
    canvasWidth: Math.max(400, Math.min(1600, parseInt(config.canvasWidth) || 1000)),
    canvasHeight: Math.max(300, Math.min(1000, parseInt(config.canvasHeight) || 600)),
    segmentSize: Math.max(5, Math.min(25, parseInt(config.segmentSize) || 10)),
    countdownTime: Math.max(1, Math.min(10, parseInt(config.countdownTime) || 3)),
    attacksEnabled: Boolean(config.attacksEnabled),
    roundTime: parseInt(config.roundTime) || 45 // Nuevo: tiempo de ronda en segundos
  };
}

function createRoom(hostId, hostName) {
  const roomId = generateRoomId();
  const defaultConfig = validateRoomConfig({});
  
  rooms.set(roomId, {
    id: roomId,
    host: hostId,
    hostName: hostName,
    players: [],
    finished: false,
    gameState: {
      playing: false,
      round: 1,
      timeoutIdStartGame: null,
      downCounter: defaultConfig.countdownTime,
      intervalId: null,
      roundTimeLeft: defaultConfig.roundTime,
      roundTimerId: null
    },
    config: defaultConfig,
    gameboard: [],
    foods: [],
    projectiles: [],
    roundScores: {}
  });
  
  const room = rooms.get(roomId);
  resetGameBoard(room);
  generateFoods(room);
  
  console.log(`Room ${roomId} created by ${hostName}`);
  return roomId;
}

function getRoom(roomId) {
  const room = rooms.get(roomId);
  return room && !room.finished ? room : null;
}

function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    if (room.gameState.intervalId) clearInterval(room.gameState.intervalId);
    if (room.gameState.timeoutIdStartGame) clearTimeout(room.gameState.timeoutIdStartGame);
    if (room.gameState.roundTimerId) clearInterval(room.gameState.roundTimerId);
    rooms.delete(roomId);
    console.log(`Room ${roomId} deleted`);
  }
}

function resetGameBoard(room) {
  const { canvasWidth, canvasHeight, segmentSize } = room.config;
  const gridWidth = Math.floor(canvasWidth / segmentSize);
  const gridHeight = Math.floor(canvasHeight / segmentSize);
  
  room.gameboard = Array(gridWidth).fill().map(() => Array(gridHeight).fill(0));
}

function updateGameBoard(room) {
  resetGameBoard(room);
  const { segmentSize } = room.config;
  const gridWidth = room.gameboard.length;
  const gridHeight = room.gameboard[0].length;
  
  room.players.forEach((player) => {
    if (!player.gameover && player.segments) {
      player.segments.forEach((segment) => {
        const x = Math.floor(segment.x / segmentSize);
        const y = Math.floor(segment.y / segmentSize);
        if (x >= 0 && x < gridWidth && y >= 0 && y < gridHeight) {
          room.gameboard[x][y] = 1;
        }
      });
    }
  });
  
  room.foods.forEach(food => {
    const foodX = Math.floor(food.x / segmentSize);
    const foodY = Math.floor(food.y / segmentSize);
    if (foodX >= 0 && foodX < gridWidth && foodY >= 0 && foodY < gridHeight) {
      room.gameboard[foodX][foodY] = 2;
    }
  });
}

function getRandomCoordinate(max, segmentSize) {
  return Math.floor(Math.random() * (max / segmentSize)) * segmentSize;
}

function getPlayerSpawnPosition(room, playerIndex) {
  const { canvasWidth, canvasHeight, segmentSize } = room.config;
  const spawnX = Math.floor(canvasWidth * 0.1);
  const spacing = segmentSize * 3;
  const startY = Math.floor(canvasHeight * 0.2);
  
  return {
    x: Math.floor(spawnX / segmentSize) * segmentSize,
    y: Math.floor((startY + (playerIndex * spacing)) / segmentSize) * segmentSize
  };
}

function verifyCoordinate(room, x, y) {
  const { segmentSize } = room.config;
  const gridX = Math.floor(x / segmentSize);
  const gridY = Math.floor(y / segmentSize);
  
  if (!room.gameboard || !room.gameboard[gridX]) {
    resetGameBoard(room);
  }
  
  return gridX >= 0 && gridX < room.gameboard.length &&
         gridY >= 0 && gridY < room.gameboard[0].length &&
         room.gameboard[gridX][gridY] === 0;
}

function generateFoods(room) {
  const { canvasWidth, canvasHeight, segmentSize } = room.config;
  const playerCount = room.players.length;
  const foodCount = playerCount === 2 ? 8 : playerCount + 6; // Más comida para partidas por tiempo
  
  room.foods = [];
  
  for (let i = 0; i < foodCount; i++) {
    let foodX, foodY;
    let attempts = 0;
    const maxAttempts = 100;
    
    do {
      foodX = getRandomCoordinate(canvasWidth, segmentSize);
      foodY = getRandomCoordinate(canvasHeight, segmentSize);
      attempts++;
    } while (!verifyCoordinate(room, foodX, foodY) && attempts < maxAttempts);
    
    if (attempts >= maxAttempts) {
      foodX = Math.floor(canvasWidth / 2 / segmentSize) * segmentSize + (i * segmentSize);
      foodY = Math.floor(canvasHeight / 2 / segmentSize) * segmentSize;
    }
    
    const scoreFood = Math.floor(Math.random() * 7) + 3;
    room.foods.push({ x: foodX, y: foodY, score: scoreFood });
    
    // Update gameboard immediately for next food placement
    const gridX = Math.floor(foodX / segmentSize);
    const gridY = Math.floor(foodY / segmentSize);
    if (room.gameboard[gridX] && room.gameboard[gridX][gridY] !== undefined) {
      room.gameboard[gridX][gridY] = 2;
    }
  }
}

function createProjectile(room, player) {
  if (!room.config.attacksEnabled || player.segments.length < 3) {
    return false;
  }
  
  const existingProjectile = room.projectiles.find(p => p.playerId === player.id);
  if (existingProjectile) {
    return false;
  }
  
  const head = player.segments[0];
  const { segmentSize } = room.config;
  
  const projectile = {
    id: Math.random().toString(36).substring(2, 9),
    playerId: player.id,
    x: head.x + (player.direction.x * segmentSize),
    y: head.y + (player.direction.y * segmentSize),
    direction: { ...player.direction },
    color: player.color
  };
  
  player.segments.pop();
  if (player.segments.length > 1) {
    player.segments.pop();
  }
  
  player.updateTargets();
  
  room.projectiles.push(projectile);
  return true;
}

function moveProjectiles(room) {
  const { segmentSize, canvasWidth, canvasHeight } = room.config;
  
  room.projectiles = room.projectiles.filter(projectile => {
    projectile.x += projectile.direction.x * segmentSize;
    projectile.y += projectile.direction.y * segmentSize;
    
    if (projectile.x < 0 || projectile.x >= canvasWidth || 
        projectile.y < 0 || projectile.y >= canvasHeight) {
      return false;
    }
    
    for (let player of room.players) {
      if (!player.gameover && player.segments) {
        for (let i = 0; i < player.segments.length; i++) {
          const segment = player.segments[i];
          if (segment.x === projectile.x && segment.y === projectile.y) {
            // Modificado: ya no mata, solo corta la snake
            if (i === 0) {
              // Si golpea la cabeza, corta 3 segmentos
              const segmentsToRemove = Math.min(3, player.segments.length - 1);
              for (let j = 0; j < segmentsToRemove; j++) {
                if (player.segments.length > 1) {
                  player.segments.pop();
                }
              }
            } else {
              // Si golpea el cuerpo, corta desde ese punto
              player.segments = player.segments.slice(0, i);
            }
            player.updateTargets();
            return false;
          }
        }
      }
    }
    
    return true;
  });
}

function initializeRoundScores(room) {
  room.players.forEach(player => {
    if (!room.roundScores[player.id]) {
      room.roundScores[player.id] = {
        name: player.name,
        totalScore: 0,
        roundWins: 0
      };
    }
  });
}

function startRoundTimer(room) {
  room.gameState.roundTimeLeft = room.config.roundTime;
  
  room.gameState.roundTimerId = setInterval(() => {
    room.gameState.roundTimeLeft--;
    
    // Enviar tiempo restante a los clientes cada segundo
    io.to(room.id).emit('roundTimeUpdate', room.gameState.roundTimeLeft);
    
    if (room.gameState.roundTimeLeft <= 0) {
      clearInterval(room.gameState.roundTimerId);
      room.gameState.roundTimerId = null;
      endRound(room);
    }
  }, 1000);
}

function endRound(room) {
  // Limpiar timers
  if (room.gameState.intervalId) {
    clearInterval(room.gameState.intervalId);
    room.gameState.intervalId = null;
  }
  if (room.gameState.roundTimerId) {
    clearInterval(room.gameState.roundTimerId);
    room.gameState.roundTimerId = null;
  }
  
  // Calcular puntajes basados en el tamaño de la snake
  let roundWinner = null;
  let maxSize = 0;
  
  room.players.forEach(player => {
    const snakeSize = player.segments.length;
    player.score = snakeSize; // El puntaje es el tamaño de la snake
    
    if (snakeSize > maxSize) {
      maxSize = snakeSize;
      roundWinner = player;
    }
    
    if (room.roundScores[player.id]) {
      room.roundScores[player.id].totalScore += snakeSize;
      if (player === roundWinner) {
        room.roundScores[player.id].roundWins++;
      }
    }
  });
  
  room.gameState.round++;
  
  if (room.gameState.round > room.config.maxRounds) {
    endGame(room);
  } else {
    setTimeout(() => startNewRound(room), 3000);
  }
  
  io.to(room.id).emit('roundEnd', {
    round: room.gameState.round - 1,
    winner: roundWinner,
    scores: room.roundScores,
    nextRound: room.gameState.round <= room.config.maxRounds
  });
}

function endGame(room) {
  room.gameState.playing = false;
  
  if (room.gameState.intervalId) {
    clearInterval(room.gameState.intervalId);
    room.gameState.intervalId = null;
  }
  
  if (room.gameState.roundTimerId) {
    clearInterval(room.gameState.roundTimerId);
    room.gameState.roundTimerId = null;
  }
    
  const finalWinner = Object.values(room.roundScores).reduce((prev, current) => 
    (prev.totalScore > current.totalScore) ? prev : current
  );
  
  io.to(room.id).emit('gameEnd', {
    winner: finalWinner,
    finalScores: room.roundScores,
    roomFinished: true
  });
  
  room.finished = true;
  setTimeout(() => deleteRoom(room.id), 30000);
}

function startNewRound(room) {
  room.gameState.downCounter = room.config.countdownTime;
  room.gameState.roundTimeLeft = room.config.roundTime;
  room.projectiles = [];
  
  room.players.forEach((player, index) => {
    const spawnPos = getPlayerSpawnPosition(room, index);
    
    player.segments = [{ x: spawnPos.x, y: spawnPos.y }];
    player.direction = { x: 1, y: 0 };
    player.score = 1; // Inicia con puntaje 1 (tamaño inicial)
    player.gameover = false;
    player.scoreLeftToGrow = 0;
    player.moveQueue = [];
    player.updateInterpolationSpeed(room.config.gameSpeed);
    player.updateTargets();
  });
  
  generateFoods(room);
  updateGameBoard(room);
  startGame(room);
}

function startGame(room) {
  if (room.gameState.downCounter === 0) {
    resetGameBoard(room);
    
    if (room.gameState.timeoutIdStartGame) {
      clearTimeout(room.gameState.timeoutIdStartGame);
      room.gameState.timeoutIdStartGame = null;
    }
    
    room.gameState.playing = true;
    
    console.log(`Starting round ${room.gameState.round} in room ${room.id}`);
    io.to(room.id).emit('gameStart', {
      players: serializePlayers(room.players),
      foods: [...room.foods],
      projectiles: [...room.projectiles],
      config: room.config,
      gameState: {
        playing: room.gameState.playing,
        round: room.gameState.round,
        roundTimeLeft: room.gameState.roundTimeLeft
      }
    });
    
    room.gameState.intervalId = setInterval(() => gameLogicLoop(room), room.config.gameSpeed);
    
    // Iniciar timer de ronda
    startRoundTimer(room);
    
  } else {
    io.to(room.id).emit('countdown', room.gameState.downCounter, 
      { playing: room.gameState.playing, round: room.gameState.round });
    room.gameState.downCounter--;
    room.gameState.timeoutIdStartGame = setTimeout(() => startGame(room), 1000);
  }
}

function gameLogicLoop(room) {
  if (!room.gameState.playing) return;
  
  const { canvasWidth, canvasHeight, segmentSize } = room.config;
  let portalEvents = [];
  
  if (!room.gameboard || room.gameboard.length === 0) {
    resetGameBoard(room);
  }
  
  if (room.config.attacksEnabled) {
    moveProjectiles(room);
  }
  
  room.players.forEach((player) => {
    if (!player.gameover) {
      player.processNextMove();
      const prevHead = { ...player.segments[0] };
      player.moveLogic();
      const head = player.segments[0];
      
      if (!head) {
        return;
      }
      
      const gridWidth = Math.floor(canvasWidth / segmentSize);
      const gridHeight = Math.floor(canvasHeight / segmentSize);
      
      let headX = Math.floor(head.x / segmentSize);
      let headY = Math.floor(head.y / segmentSize);
      let portalOccurred = false;
      
      // Portal horizontal (izquierda/derecha)
      if (headX < 0) {
        headX = gridWidth - 1;
        head.x = headX * segmentSize;
        portalOccurred = true;
        portalEvents.push({ playerId: player.id, type: 'horizontal', from: 'left', to: 'right' });
      } else if (headX >= gridWidth) {
        headX = 0;
        head.x = headX * segmentSize;
        portalOccurred = true;
        portalEvents.push({ playerId: player.id, type: 'horizontal', from: 'right', to: 'left' });
      }
      
      // Portal vertical (arriba/abajo)
      if (headY < 0) {
        headY = gridHeight - 1;
        head.y = headY * segmentSize;
        portalOccurred = true;
        portalEvents.push({ playerId: player.id, type: 'vertical', from: 'top', to: 'bottom' });
      } else if (headY >= gridHeight) {
        headY = 0;
        head.y = headY * segmentSize;
        portalOccurred = true;
        portalEvents.push({ playerId: player.id, type: 'vertical', from: 'bottom', to: 'top' });
      }
      
      // Modificado: Los jugadores pueden atravesarse - no hay restricción por colisión
      if (room.gameboard[headX] && room.gameboard[headX][headY] === 2) {
        const eatenFoodIndex = room.foods.findIndex(food => 
          Math.floor(food.x / segmentSize) === headX && 
          Math.floor(food.y / segmentSize) === headY
        );
        
        if (eatenFoodIndex !== -1) {
          const eatenFood = room.foods[eatenFoodIndex];
          player.EatFood(eatenFood.score);
          room.foods.splice(eatenFoodIndex, 1);
          
          let foodX, foodY;
          let attempts = 0;
          const maxAttempts = 100;
          
          do {
            foodX = getRandomCoordinate(room.config.canvasWidth, segmentSize);
            foodY = getRandomCoordinate(room.config.canvasHeight, segmentSize);
            attempts++;
          } while (!verifyCoordinate(room, foodX, foodY) && attempts < maxAttempts);
          
          if (attempts >= maxAttempts) {
            foodX = Math.floor(room.config.canvasWidth / 2 / segmentSize) * segmentSize;
            foodY = Math.floor(room.config.canvasHeight / 2 / segmentSize) * segmentSize;
          }
          
          const newFoodScore = Math.floor(Math.random() * 7) + 3;
          room.foods.push({ x: foodX, y: foodY, score: newFoodScore });
        }
      }
      
      // Actualizar puntaje basado en el tamaño actual
      player.score = player.segments.length;
    }
  });
  
  updateGameBoard(room);
  
  io.to(room.id).emit('gameLogicFrame', {
    players: serializePlayers(room.players),
    foods: [...room.foods],
    projectiles: [...room.projectiles],
    portals: portalEvents,
    gameState: {
      playing: room.gameState.playing,
      round: room.gameState.round,
      roundTimeLeft: room.gameState.roundTimeLeft
    },
    timestamp: Date.now()
  });
}

io.on('connection', (socket) => {
  console.log('New player connected:', socket.id);
  let currentRoom = null;

  socket.on('createRoom', (data) => {
    if (!data.username || data.username.length < 2 || data.username.length > 20) {
      socket.emit('gameError', 'Username must be 2-20 characters');
      return;
    }
    
    const roomId = createRoom(socket.id, data.username.trim());
    currentRoom = roomId;
    socket.join(roomId);
    
    const room = getRoom(roomId);
    if (!room) {
      socket.emit('gameError', 'Failed to create room');
      return;
    }
    
    const { canvasWidth, canvasHeight, segmentSize } = room.config;
    const spawnPos = getPlayerSpawnPosition(room, 0);
    const playerColor = getPlayerColor(0);
    const player = new Snake(socket.id, data.username.trim(), segmentSize, canvasWidth, canvasHeight, spawnPos.x, spawnPos.y, 1, 0, playerColor, room.config.gameSpeed);
    player.moveQueue = []; 
    room.players.push(player);
    
    socket.emit('roomCreated', { 
      roomId, 
      isHost: true,
      config: room.config
    });
    io.to(roomId).emit('updatePlayers', serializePlayers(room.players), 
      { playing: room.gameState.playing, round: room.gameState.round }, 
      room.config, { host: room.host, roomId });
  });

  socket.on('joinRoom', (data) => {
    if (!data.username || data.username.length < 2 || data.username.length > 20) {
      socket.emit('gameError', 'Username must be 2-20 characters');
      return;
    }
    
    if (!data.roomId || data.roomId.length !== 6) {
      socket.emit('gameError', 'Invalid room ID');
      return;
    }
    
    const room = getRoom(data.roomId);
    if (!room) {
      socket.emit('gameError', 'Room not found or has ended');
      return;
    }
    
    if (room.players.length >= room.config.maxPlayers) {
      socket.emit('gameError', 'Room is full');
      return;
    }
    
    if (room.gameState.playing) {
      socket.emit('gameError', 'Game already in progress');
      return;
    }
    
    if (room.players.some(p => p.name === data.username.trim())) {
      socket.emit('gameError', 'Username already taken in this room');
      return;
    }
    
    currentRoom = data.roomId;
    socket.join(data.roomId);
    
    const { canvasWidth, canvasHeight, segmentSize } = room.config;
    const playerIndex = room.players.length;
    const spawnPos = getPlayerSpawnPosition(room, playerIndex);
    const playerColor = getPlayerColor(playerIndex);
    
    const player = new Snake(socket.id, data.username.trim(), segmentSize, canvasWidth, canvasHeight, spawnPos.x, spawnPos.y, 1, 0, playerColor, room.config.gameSpeed);
    player.moveQueue = [];
    room.players.push(player);
    
    initializeRoundScores(room);
    socket.emit('roomJoined', { 
      roomId: data.roomId, 
      isHost: false,
      config: room.config
    });
    io.to(data.roomId).emit('updatePlayers', serializePlayers(room.players), 
      { playing: room.gameState.playing, round: room.gameState.round }, 
      room.config, { host: room.host, roomId: data.roomId });
  });

  socket.on('updateRoomConfig', (newConfig) => {
    if (!currentRoom) return;
    
    const room = getRoom(currentRoom);
    if (!room || room.host !== socket.id) {
      socket.emit('gameError', 'Only the host can modify room settings');
      return;
    }
    
    if (room.gameState.playing) {
      socket.emit('gameError', 'Cannot modify settings during game');
      return;
    }
    
    const validConfig = validateRoomConfig(newConfig);
    
    room.config = validConfig;
    room.gameState.downCounter = validConfig.countdownTime;
    room.gameState.roundTimeLeft = validConfig.roundTime;
    
    room.players.forEach((player, index) => {
      const spawnPos = getPlayerSpawnPosition(room, index);
      player.segments = [{ x: spawnPos.x, y: spawnPos.y }];
      player.direction = { x: 1, y: 0 };
      player.segmentSize = validConfig.segmentSize;
      player.updateInterpolationSpeed(validConfig.gameSpeed);
      player.updateTargets();
    });
    
    resetGameBoard(room);
    generateFoods(room);
    updateGameBoard(room);
    
    io.to(currentRoom).emit('configUpdated', validConfig);
    io.to(currentRoom).emit('updatePlayers', serializePlayers(room.players), 
      { playing: room.gameState.playing, round: room.gameState.round }, 
      room.config, { host: room.host, roomId: currentRoom });
  });

  socket.on('startGame', () => {
    if (!currentRoom) return;
    
    const room = getRoom(currentRoom);
    if (!room || room.host !== socket.id) {
      socket.emit('gameError', 'Only the host can start the game');
      return;
    }
    
    if (room.players.length < room.config.minPlayers) {
      socket.emit('gameError', `Need at least ${room.config.minPlayers} players`);
      return;
    }
    
    if (room.gameState.playing || room.gameState.timeoutIdStartGame) {
      return;
    }
    
    initializeRoundScores(room);
    updateGameBoard(room);
    io.to(currentRoom).emit('updateScores', room.roundScores);
    room.gameState.timeoutIdStartGame = setTimeout(() => startGame(room), 1000);
  });

  socket.on('attack', () => {
    if (!currentRoom) return;
    
    const room = getRoom(currentRoom);
    if (!room || !room.gameState.playing || !room.config.attacksEnabled) return;
    
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.gameover) return;
    
    createProjectile(room, player);
  });

  socket.on('getRooms', () => {
    const availableRooms = Array.from(rooms.values())
      .filter(room => !room.gameState.playing && !room.finished && room.players.length < room.config.maxPlayers)
      .map(room => ({
        id: room.id,
        hostName: room.hostName,
        players: room.players.length,
        maxPlayers: room.config.maxPlayers,
        config: {
          maxRounds: room.config.maxRounds,
          gameSpeed: room.config.gameSpeed,
          canvasWidth: room.config.canvasWidth,
          canvasHeight: room.config.canvasHeight,
          attacksEnabled: room.config.attacksEnabled,
          roundTime: room.config.roundTime
        }
      }));
    socket.emit('roomsList', availableRooms);
  });

  socket.on('newMove', (data) => {
    if (!currentRoom) return;
    
    const room = getRoom(currentRoom);
    if (!room || !room.gameState.playing) return;
    
    const playerToMove = room.players.find(player => player.id === socket.id);
    if (!playerToMove || playerToMove.gameover) return;
    
    const directions = {
      37: { x: -1, y: 0 },
      39: { x: 1, y: 0 },
      38: { x: 0, y: -1 },
      40: { x: 0, y: 1 }
    };
    
    const newDirection = directions[data.key];
    if (newDirection) {
      playerToMove.changeDirection(newDirection);
    }
  });

  socket.on('backToMenu', () => {
    if (currentRoom) {
      socket.leave(currentRoom);
      currentRoom = null;
    }
    socket.emit('backToMenuSuccess');
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    
    const room = getRoom(currentRoom);
    if (!room) return;
    
    const playerIndex = room.players.findIndex(player => player.id === socket.id);
    if (playerIndex !== -1) {
      const playerName = room.players[playerIndex].name;
      room.players.splice(playerIndex, 1);
      console.log(`Player "${playerName}" disconnected from room ${currentRoom}`);
      
      room.projectiles = room.projectiles.filter(p => p.playerId !== socket.id);
      delete room.roundScores[socket.id];
      
      if (room.host === socket.id) {
        if (room.players.length > 0) {
          room.host = room.players[0].id;
          room.hostName = room.players[0].name;
          io.to(currentRoom).emit('newHost', { hostId: room.host, hostName: room.hostName });
        } else {
          deleteRoom(currentRoom);
          return;
        }
      }
      
      io.to(currentRoom).emit('updatePlayers', serializePlayers(room.players), 
        { playing: room.gameState.playing, round: room.gameState.round }, 
        room.config, { host: room.host, roomId: currentRoom });
      
      if (room.players.length < room.config.minPlayers && room.gameState.playing) {
        room.gameState.playing = false;
        if (room.gameState.intervalId) {
          clearInterval(room.gameState.intervalId);
          room.gameState.intervalId = null;
        }
        if (room.gameState.roundTimerId) {
          clearInterval(room.gameState.roundTimerId);
          room.gameState.roundTimerId = null;
        }
        io.to(currentRoom).emit('gameError', 'Not enough players to continue');
      }
      
      if (room.players.length < room.config.minPlayers && room.gameState.timeoutIdStartGame) {
        clearTimeout(room.gameState.timeoutIdStartGame);
        room.gameState.timeoutIdStartGame = null;
        room.gameState.downCounter = room.config.countdownTime;
      }
    }
  });
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});