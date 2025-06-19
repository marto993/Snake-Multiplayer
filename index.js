const http = require('http');
const express = require('express');
const socketIO = require('socket.io');
const Snake = require('./public/snakeClass.js');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const port = process.env.PORT || 3000;

app.use(express.static('public'));

// Game rooms management
let rooms = new Map();

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
    countdownTime: Math.max(1, Math.min(10, parseInt(config.countdownTime) || 3))
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
      intervalId: null
    },
    config: defaultConfig,
    gameboard: [],
    food: { x: 0, y: 0, score: 1 },
    roundScores: {}
  });
  
  const room = rooms.get(roomId);
  resetGameBoard(room);
  generateFood(room);
  
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
  
  // Mark snake segments
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
  
  // Mark food
  if (room.food) {
    const foodX = Math.floor(room.food.x / segmentSize);
    const foodY = Math.floor(room.food.y / segmentSize);
    if (foodX >= 0 && foodX < gridWidth && foodY >= 0 && foodY < gridHeight) {
      room.gameboard[foodX][foodY] = 2;
    }
  }
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

function generateFood(room) {
  const { canvasWidth, canvasHeight, segmentSize } = room.config;
  let foodX, foodY;
  let attempts = 0;
  const maxAttempts = 100;
  
  do {
    foodX = getRandomCoordinate(canvasWidth, segmentSize);
    foodY = getRandomCoordinate(canvasHeight, segmentSize);
    attempts++;
  } while (!verifyCoordinate(room, foodX, foodY) && attempts < maxAttempts);
  
  if (attempts >= maxAttempts) {
    foodX = Math.floor(canvasWidth / 2 / segmentSize) * segmentSize;
    foodY = Math.floor(canvasHeight / 2 / segmentSize) * segmentSize;
  }
  
  const scoreFood = Math.floor(Math.random() * 7) + 3;
  room.food = { x: foodX, y: foodY, score: scoreFood };
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

function endRound(room) {
  const alivePlayers = room.players.filter(p => !p.gameover);
  const roundWinner = alivePlayers.length > 0 ? 
    alivePlayers.reduce((prev, current) => (prev.score > current.score) ? prev : current) : null;
  
  room.players.forEach(player => {
    if (room.roundScores[player.id]) {
      room.roundScores[player.id].totalScore += player.score;
      if (player.id === roundWinner?.id) {
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
  
  room.players.forEach((player, index) => {
    const spawnPos = getPlayerSpawnPosition(room, index);
    
    player.segments = [{ x: spawnPos.x, y: spawnPos.y }];
    player.direction = { x: 1, y: 0 };
    player.score = 0;
    player.gameover = false;
    player.scoreLeftToGrow = 0;
  });
  
  generateFood(room);
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
      players: room.players,
      food: room.food,
      config: room.config,
      gameState: room.gameState
    });
    
    room.gameState.intervalId = setInterval(() => gameLoop(room), room.config.gameSpeed);
  } else {
    io.to(room.id).emit('countdown', room.gameState.downCounter, room.gameState);
    room.gameState.downCounter--;
    room.gameState.timeoutIdStartGame = setTimeout(() => startGame(room), 1000);
  }
}

function gameLoop(room) {
  if (!room.gameState.playing) return;
  
  const { canvasWidth, canvasHeight, segmentSize } = room.config;
  let alivePlayers = 0;
  
  if (!room.gameboard || room.gameboard.length === 0) {
    resetGameBoard(room);
  }
  
  room.players.forEach((player) => {
    if (!player.gameover) {
      player.move();
      const head = player.segments[0];
      
      if (!head) {
        player.GameOver();
        return;
      }
      
      const headX = Math.floor(head.x / segmentSize);
      const headY = Math.floor(head.y / segmentSize);
      
      // Check bounds
      if (headX < 0 || headX >= Math.floor(canvasWidth/segmentSize) || 
          headY < 0 || headY >= Math.floor(canvasHeight/segmentSize)) {
        player.GameOver();
      }
      // Check collisions
      else if (room.gameboard[headX] && room.gameboard[headX][headY] === 1) {
        player.GameOver();
      }
      // Check food
      else if (room.gameboard[headX] && room.gameboard[headX][headY] === 2) {
        player.EatFood(room.food.score);
        generateFood(room);
      }
      
      if (!player.gameover) alivePlayers++;
    }
  });
  
  updateGameBoard(room);
  
  // Only emit if there are alive players to avoid unnecessary renders
  io.to(room.id).emit('gameFrame', room.players, room.food, room.gameState);
  
  // Check end conditions
  if (alivePlayers <= 1 && room.players.length > 1) {
    clearInterval(room.gameState.intervalId);
    room.gameState.intervalId = null;
    setTimeout(() => endRound(room), 1000);
  }
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
    const player = new Snake(socket.id, data.username.trim(), segmentSize, canvasWidth, canvasHeight, 
      spawnPos.x, spawnPos.y, 1, 0);
    room.players.push(player);
    
    socket.emit('roomCreated', { 
      roomId, 
      isHost: true,
      config: room.config
    });
    io.to(roomId).emit('updatePlayers', room.players, room.gameState, room.config, 
      { host: room.host, roomId });
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
    
    const player = new Snake(socket.id, data.username.trim(), segmentSize, canvasWidth, canvasHeight, 
      spawnPos.x, spawnPos.y, 1, 0);
    room.players.push(player);
    
    initializeRoundScores(room);
    socket.emit('roomJoined', { 
      roomId: data.roomId, 
      isHost: false,
      config: room.config
    });
    io.to(data.roomId).emit('updatePlayers', room.players, room.gameState, room.config, 
      { host: room.host, roomId: data.roomId });
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
    
    room.players.forEach((player, index) => {
      const spawnPos = getPlayerSpawnPosition(room, index);
      player.segments = [{ x: spawnPos.x, y: spawnPos.y }];
      player.direction = { x: 1, y: 0 };
      player.segmentSize = validConfig.segmentSize;
    });
    
    resetGameBoard(room);
    generateFood(room);
    updateGameBoard(room);
    
    io.to(currentRoom).emit('configUpdated', validConfig);
    io.to(currentRoom).emit('updatePlayers', room.players, room.gameState, room.config, 
      { host: room.host, roomId: currentRoom });
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
          canvasHeight: room.config.canvasHeight
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
      37: { x: -1, y: 0 }, // Left
      39: { x: 1, y: 0 },  // Right
      38: { x: 0, y: -1 }, // Up
      40: { x: 0, y: 1 }   // Down
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
      
      io.to(currentRoom).emit('updatePlayers', room.players, room.gameState, room.config, 
        { host: room.host, roomId: currentRoom });
      
      if (room.players.length < room.config.minPlayers && room.gameState.playing) {
        room.gameState.playing = false;
        if (room.gameState.intervalId) {
          clearInterval(room.gameState.intervalId);
          room.gameState.intervalId = null;
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