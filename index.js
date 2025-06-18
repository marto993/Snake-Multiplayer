const http = require('http');
const express = require('express');
const socketIO = require('socket.io');
const Snake = require('./public/snakeClass.js');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const port = process.env.PORT || 3000;
const canvasWidth = 1000;
const canvasHeight = 600;
const segmentSize = 10;
const gameSpeed = 100;

app.use(express.static('public'));

// Game rooms management
let rooms = new Map();

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createRoom(hostId, hostName) {
  const roomId = generateRoomId();
  rooms.set(roomId, {
    id: roomId,
    host: hostId,
    hostName: hostName,
    players: [],
    finished: false,
    gameState: {
      playing: false,
      round: 1,
      maxRounds: 3,
      timeoutIdStartGame: 0,
      downCounter: 3,
      intervalId: 0,
      maxPlayers: 8,
      minPlayers: 2
    },
    gameboard: [],
    food: {
      x: getRandomCoordinate(canvasWidth),
      y: getRandomCoordinate(canvasHeight),
      score: Math.floor(Math.random() * 9) + 1
    },
    roundScores: {}
  });
  return roomId;
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    if (room.gameState.intervalId) clearInterval(room.gameState.intervalId);
    if (room.gameState.timeoutIdStartGame) clearTimeout(room.gameState.timeoutIdStartGame);
    rooms.delete(roomId);
  }
}

function resetGameBoard(room) {
  for(let i = 0; i < (canvasWidth/segmentSize); i++){
    room.gameboard[i] = [];
    for (let j = 0; j < (canvasHeight/segmentSize); j++){
      room.gameboard[i][j] = 0;
    }
  }
}

function updateGameBoard(room) {
  resetGameBoard(room);
  
  room.players.forEach((player) => {
    if (!player.gameover) {
      player.segments.forEach((segment) => {
        const x = segment.x / segmentSize;
        const y = segment.y / segmentSize;
        if (x >= 0 && x < (canvasWidth/segmentSize) && y >= 0 && y < (canvasHeight/segmentSize)) {
          room.gameboard[x][y] = 1;
        }
      });
    }
  });
  
  const foodX = room.food.x / segmentSize;
  const foodY = room.food.y / segmentSize;
  if (foodX >= 0 && foodX < (canvasWidth/segmentSize) && foodY >= 0 && foodY < (canvasHeight/segmentSize)) {
    room.gameboard[foodX][foodY] = 2;
  }
}

function getRandomCoordinate(max) {
  return Math.floor(Math.random() * max / segmentSize) * segmentSize;
}

function verifyCoordinate(room, x, y) {
  try {
    const gridX = x / segmentSize;
    const gridY = y / segmentSize;
    
    if (gridX < 0 || gridX >= (canvasWidth/segmentSize) || gridY < 0 || gridY >= (canvasHeight/segmentSize)) {
      return false;
    }
    return room.gameboard[gridX][gridY] === 0;
  } catch (error) {
    console.error('Error in verifyCoordinate:', error);
    return false;
  }
}

function generateFood(room) {
  let foodX, foodY;
  let attempts = 0;
  const maxAttempts = 100;
  
  do {
    foodX = getRandomCoordinate(canvasWidth);
    foodY = getRandomCoordinate(canvasHeight);
    attempts++;
  } while (!verifyCoordinate(room, foodX, foodY) && attempts < maxAttempts);
  
  const scoreFood = Math.floor(Math.random() * 9) + 1;
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
  
  if (room.gameState.round > room.gameState.maxRounds) {
    endGame(room);
  } else {
    setTimeout(() => startNewRound(room), 3000);
  }
  
  io.to(room.id).emit('roundEnd', {
    round: room.gameState.round - 1,
    winner: roundWinner,
    scores: room.roundScores,
    nextRound: room.gameState.round <= room.gameState.maxRounds
  });
}

function endGame(room) {
  const finalWinner = Object.values(room.roundScores).reduce((prev, current) => 
    (prev.totalScore > current.totalScore) ? prev : current
  );
  
  io.to(room.id).emit('gameEnd', {
    winner: finalWinner,
    finalScores: room.roundScores,
    roomFinished: true
  });
  
  // Mark room as finished and schedule deletion
  room.finished = true;
  setTimeout(() => deleteRoom(room.id), 30000); // 30 seconds to show results
}

function resetGame(room) {
  room.gameState.playing = false;
  room.gameState.round = 1;
  room.gameState.downCounter = 3;
  room.players.forEach(player => player.GameOver());
  room.roundScores = {};
  resetGameBoard(room);
  if (room.gameState.intervalId) {
    clearInterval(room.gameState.intervalId);
  }
}

function startNewRound(room) {
  room.players.forEach(player => {
    let newX, newY;
    let attempts = 0;
    do {
      newX = getRandomCoordinate(canvasWidth);
      newY = getRandomCoordinate(canvasHeight);
      attempts++;
    } while (!verifyCoordinate(room, newX, newY) && attempts < 50);
    
    player.segments = [{ x: newX, y: newY }];
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
    clearTimeout(room.gameState.timeoutIdStartGame);
    room.gameState.playing = true;
    
    console.log(`Starting round ${room.gameState.round} in room ${room.id}!`);
    io.to(room.id).emit('gameStart', room.players, room.food, canvasWidth, canvasHeight, segmentSize, room.gameState);
    room.gameState.intervalId = setInterval(() => gameLoop(room), gameSpeed);
  } else {
    console.log(`Round ${room.gameState.round} starting in ${room.gameState.downCounter}`);
    io.to(room.id).emit('countdown', room.gameState.downCounter, room.gameState);
    room.gameState.downCounter--;
    room.gameState.timeoutIdStartGame = setTimeout(() => startGame(room), 1000);
  }
}

function gameLoop(room) {
  let alivePlayers = 0;
  
  room.players.forEach((player) => {
    if (!player.gameover) {
      player.move();
      const head = player.segments[0];
      const headX = head.x / segmentSize;
      const headY = head.y / segmentSize;
      
      if (headX < 0 || headX >= (canvasWidth/segmentSize) || 
          headY < 0 || headY >= (canvasHeight/segmentSize)) {
        player.GameOver();
      }
      else if (room.gameboard[headX][headY] === 1) {
        player.GameOver();
      }
      else if (room.gameboard[headX][headY] === 2) {
        player.EatFood(room.food.score);
        generateFood(room);
      }
      
      if (!player.gameover) alivePlayers++;
    }
  });
  
  updateGameBoard(room);
  io.to(room.id).emit('gameFrame', room.players, room.food, room.gameState);
  
  if (alivePlayers <= 1 && room.players.length > 1) {
    clearInterval(room.gameState.intervalId);
    setTimeout(() => endRound(room), 1000);
  }
}

io.on('connection', (socket) => {
  console.log('New player connected:', socket.id);
  let currentRoom = null;

  socket.on('createRoom', (data) => {
    const roomId = createRoom(socket.id, data.username);
    currentRoom = roomId;
    socket.join(roomId);
    
    const room = getRoom(roomId);
    const player = new Snake(socket.id, data.username, segmentSize, canvasWidth, canvasHeight, 100, 100, 1, 0);
    room.players.push(player);
    
    socket.emit('roomCreated', { roomId, isHost: true });
    io.to(roomId).emit('updatePlayers', room.players, room.gameState, { host: room.host, roomId });
    console.log(`Room ${roomId} created by ${data.username}`);
  });

  socket.on('joinRoom', (data) => {
    const room = getRoom(data.roomId);
    if (!room) {
      socket.emit('gameError', 'Room not found');
      return;
    }
    
    if (room.finished) {
      socket.emit('gameError', 'Room has finished');
      return;
    }
    
    if (room.players.length >= room.gameState.maxPlayers) {
      socket.emit('gameError', 'Room is full');
      return;
    }
    
    if (room.gameState.playing) {
      socket.emit('gameError', 'Game already in progress');
      return;
    }
    
    currentRoom = data.roomId;
    socket.join(data.roomId);
    
    let newX, newY;
    let attempts = 0;
    do {
      newX = getRandomCoordinate(canvasWidth);
      newY = getRandomCoordinate(canvasHeight);
      attempts++;
    } while (!verifyCoordinate(room, newX, newY) && attempts < 50);
    
    const player = new Snake(socket.id, data.username, segmentSize, canvasWidth, canvasHeight, newX, newY, 1, 0);
    room.players.push(player);
    
    initializeRoundScores(room);
    socket.emit('roomJoined', { roomId: data.roomId, isHost: false });
    io.to(data.roomId).emit('updatePlayers', room.players, room.gameState, { host: room.host, roomId: data.roomId });
    console.log(`Player ${data.username} joined room ${data.roomId}`);
  });

  socket.on('startGame', () => {
    if (!currentRoom) return;
    
    const room = getRoom(currentRoom);
    if (!room || room.host !== socket.id) {
      socket.emit('gameError', 'Only the host can start the game');
      return;
    }
    
    if (room.players.length < room.gameState.minPlayers) {
      socket.emit('gameError', `Need at least ${room.gameState.minPlayers} players`);
      return;
    }
    
    if (room.gameState.playing || room.gameState.timeoutIdStartGame) {
      return;
    }
    
    initializeRoundScores(room);
    updateGameBoard(room);
    room.gameState.timeoutIdStartGame = setTimeout(() => startGame(room), 1000);
  });

  socket.on('getRooms', () => {
    const availableRooms = Array.from(rooms.values())
      .filter(room => !room.gameState.playing && !room.finished && room.players.length < room.gameState.maxPlayers)
      .map(room => ({
        id: room.id,
        hostName: room.hostName,
        players: room.players.length,
        maxPlayers: room.gameState.maxPlayers
      }));
    socket.emit('roomsList', availableRooms);
  });

  socket.on('newMove', (data) => {
    if (!currentRoom) return;
    
    const room = getRoom(currentRoom);
    if (!room) return;
    
    const playerToMove = room.players.find(player => player.id === socket.id);
    if (!playerToMove || playerToMove.gameover) return;
    
    const directions = {
      37: { x: -1, y: 0 },
      39: { x: 1, y: 0 },
      38: { x: 0, y: -1 },
      40: { x: 0, y: 1 }
    };
    
    if (directions[data.key]) {
      playerToMove.changeDirection(directions[data.key]);
    }
  });

  socket.on('backToMenu', () => {
    if (currentRoom) {
      socket.leave(currentRoom);
      currentRoom = null;
      isHost = false;
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
      
      io.to(currentRoom).emit('updatePlayers', room.players, room.gameState, { host: room.host, roomId: currentRoom });
      
      if (room.players.length < room.gameState.minPlayers && room.gameState.playing) {
        resetGame(room);
        io.to(currentRoom).emit('gameError', 'Not enough players to continue');
      }
      
      if (room.players.length < room.gameState.minPlayers && room.gameState.timeoutIdStartGame) {
        clearTimeout(room.gameState.timeoutIdStartGame);
        room.gameState.timeoutIdStartGame = 0;
        room.gameState.downCounter = 3;
      }
    }
  });
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});