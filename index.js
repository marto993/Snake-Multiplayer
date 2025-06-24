const http = require('http');
const express = require('express');
const socketIO = require('socket.io');
const Snake = require('./public/snakeClass.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);
const port = process.env.PORT || 3000;

// SQLite Database - Use /data volume in production
const dbPath = process.env.NODE_ENV === 'production' 
  ? '/app/data/game_stats.db' 
  : path.join(__dirname, 'game_stats.db');
const db = new sqlite3.Database(dbPath);

// Initialize database
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    games_played INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    total_score INTEGER DEFAULT 0,
    best_score INTEGER DEFAULT 0,
    rounds_won INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_played DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Colores fijos para jugadores
const PLAYER_COLORS = [
  '#00ff41', '#ff0080', '#00ffff', '#ffff00', '#ff4040', '#8040ff', 
  '#40ff80', '#ff8040', '#4080ff', '#ff40ff', '#80ff40', '#ff4080', 
  '#4040ff', '#ffff80', '#80ffff', '#ff8080'
];

function getNextAvailableColor(room) {
  const usedColors = room.players.map(player => player.color);
  for (let i = 0; i < PLAYER_COLORS.length; i++) {
    const color = PLAYER_COLORS[i];
    if (!usedColors.includes(color)) {
      return color;
    }
  }
  return PLAYER_COLORS[room.players.length % PLAYER_COLORS.length];
}

// Database functions
function generatePlayerId(playerName) {
  return `${playerName.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now().toString(36)}`;
}

function getOrCreatePlayer(playerName, playerId = null) {
  return new Promise((resolve, reject) => {
    if (playerId) {
      db.get('SELECT * FROM players WHERE id = ?', [playerId], (err, row) => {
        if (err) return reject(err);
        if (row) return resolve({ playerId, stats: row });
        searchByName();
      });
    } else {
      searchByName();
    }
    
    function searchByName() {
      db.get('SELECT * FROM players WHERE LOWER(name) = LOWER(?)', [playerName], (err, row) => {
        if (err) return reject(err);
        if (row) return resolve({ playerId: row.id, stats: row });
        createNewPlayer();
      });
    }
    
    function createNewPlayer() {
      const newPlayerId = generatePlayerId(playerName);
      const newPlayer = {
        id: newPlayerId,
        name: playerName,
        games_played: 0,
        wins: 0,
        total_score: 0,
        best_score: 0,
        rounds_won: 0,
        current_streak: 0,
        best_streak: 0
      };
      
      db.run(`INSERT INTO players (id, name) VALUES (?, ?)`, 
        [newPlayerId, playerName], 
        function(err) {
          if (err) return reject(err);
          resolve({ playerId: newPlayerId, stats: newPlayer });
        }
      );
    }
  });
}

function updatePlayerStats(playerId, gameData) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM players WHERE id = ?', [playerId], (err, row) => {
      if (err) return reject(err);
      if (!row) return reject(new Error('Player not found'));
      
      const newGamesPlayed = row.games_played + 1;
      const newTotalScore = row.total_score + (gameData.finalScore || 0);
      const newBestScore = Math.max(row.best_score, gameData.finalScore || 0);
      const newRoundsWon = row.rounds_won + (gameData.roundsWon || 0);
      
      let newWins = row.wins;
      let newCurrentStreak = row.current_streak;
      let newBestStreak = row.best_streak;
      
      if (gameData.won) {
        newWins++;
        newCurrentStreak++;
        newBestStreak = Math.max(newBestStreak, newCurrentStreak);
      } else {
        newCurrentStreak = 0;
      }
      
      db.run(`UPDATE players SET 
        games_played = ?,
        wins = ?,
        total_score = ?,
        best_score = ?,
        rounds_won = ?,
        current_streak = ?,
        best_streak = ?,
        last_played = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [newGamesPlayed, newWins, newTotalScore, newBestScore, 
         newRoundsWon, newCurrentStreak, newBestStreak, playerId],
        function(err) {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  });
}

function getLeaderboard(limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM players 
            ORDER BY wins DESC, best_score DESC 
            LIMIT ?`, [limit], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function getPlayerStats(playerId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM players WHERE id = ?', [playerId], (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

app.use(express.static('public'));

let rooms = new Map();
let connectedUsers = new Map();

// MODIFICADO: serializePlayers para incluir consumibles activos
function serializePlayers(players) {
  return players.map(player => ({
    id: player.id,
    name: player.name,
    color: player.color,
    segments: [...player.segments],
    direction: { ...player.direction },
    score: player.score,
    gameover: player.gameover,
    scoreLeftToGrow: player.scoreLeftToGrow,
    activeConsumable: player.getActiveConsumable() // Incluir consumible activo
  }));
}

function generateRoomId() {
  let roomId;
  do {
    roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (rooms.has(roomId));
  return roomId;
}

// MODIFICADO: validateRoomConfig con nuevos valores por defecto
function validateRoomConfig(config) {
  return {
    maxPlayers: Math.max(2, Math.min(16, parseInt(config.maxPlayers) || 8)),
    minPlayers: Math.max(2, Math.min(parseInt(config.maxPlayers) || 8, parseInt(config.minPlayers) || 2)),
    maxRounds: 3, // FIJO: siempre 3 rondas
    gameSpeed: Math.max(40, Math.min(200, parseInt(config.gameSpeed) || 83)),
    canvasWidth: 1200, // FIJO: siempre 1200x700
    canvasHeight: 700, // FIJO: siempre 1200x700
    segmentSize: Math.max(5, Math.min(25, parseInt(config.segmentSize) || 20)),
    attacksEnabled: true, // FIJO: siempre activado
    roundTime: 14, // FIJO
    // Configuración de consumibles (mantenida)
    consumables: {
      immunity: {
        enabled: Boolean(config.consumables?.immunity?.enabled !== false),
        spawnInterval: Math.max(3, Math.min(30, parseInt(config.consumables?.immunity?.spawnInterval) || 5)),
        duration: Math.max(3, Math.min(15, parseInt(config.consumables?.immunity?.duration) || 5))
      }
    }
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
      downCounter: 3, // FIJO: siempre 3 segundos
      intervalId: null,
      roundTimeLeft: defaultConfig.roundTime,
      roundTimerId: null
    },
    config: defaultConfig,
    gameboard: [],
    foods: [],
    consumables: [], // Array de consumibles
    projectiles: [],
    roundScores: {},
    consumableTimers: {} // NUEVO: Timers para generación de consumibles
  });
  
  const room = rooms.get(roomId);
  resetGameBoard(room);
  generateFoods(room);
  initializeConsumableSystem(room); // NUEVO: Inicializar sistema de consumibles
  
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
    
    // NUEVO: Limpiar timers de consumibles
    Object.values(room.consumableTimers).forEach(timerId => {
      if (timerId) clearInterval(timerId);
    });
    
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

// MODIFICADO: updateGameBoard para incluir consumibles
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
  
  room.consumables.forEach(consumable => {
    const consX = Math.floor(consumable.x / segmentSize);
    const consY = Math.floor(consumable.y / segmentSize);
    if (consX >= 0 && consX < gridWidth && consY >= 0 && consY < gridHeight) {
      room.gameboard[consX][consY] = 3; // 3 = consumible
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
  const foodCount = playerCount === 2 ? 7 : playerCount + 5;
  
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
    
    const scoreFood = Math.floor(Math.random() * 5) + 1;
    room.foods.push({ x: foodX, y: foodY, score: scoreFood });
    
    const gridX = Math.floor(foodX / segmentSize);
    const gridY = Math.floor(foodY / segmentSize);
    if (room.gameboard[gridX] && room.gameboard[gridX][gridY] !== undefined) {
      room.gameboard[gridX][gridY] = 2;
    }
  }
}

// NUEVO: Sistema de consumibles basado en timers
function initializeConsumableSystem(room) {
  // Limpiar timers existentes
  Object.values(room.consumableTimers).forEach(timerId => {
    if (timerId) clearInterval(timerId);
  });
  room.consumableTimers = {};
  
  // Inicializar consumibles de inmunidad si están habilitados
  if (room.config.consumables.immunity.enabled) {
    startConsumableTimer(room, 'immunity');
  }
}

function startConsumableTimer(room, consumableType) {
  const config = room.config.consumables[consumableType];
  if (!config || !config.enabled) return;
  
  const checkAndSpawn = () => {
    if (!room || !room.gameState.playing) return;
    
    const maxConsumables = getMaxConsumablesForType(room, consumableType);
    const currentCount = room.consumables.filter(c => c.type === consumableType).length;
    
    if (currentCount < maxConsumables) {
      spawnConsumable(room, consumableType);
    }
  };
  
  // NUEVO: Spawn inicial de TODOS los consumibles necesarios
  const maxConsumables = getMaxConsumablesForType(room, consumableType);
  const currentCount = room.consumables.filter(c => c.type === consumableType).length;
  
  for (let i = currentCount; i < maxConsumables; i++) {
    if (room.gameState.playing) {
      spawnConsumable(room, consumableType);
    }
  }
    
  // Configurar timer para spawns posteriores
  room.consumableTimers[consumableType] = setInterval(checkAndSpawn, config.spawnInterval * 1000);
}

function restartConsumableTimer(room, consumableType) {
  const config = room.config.consumables[consumableType];
  if (!config || !config.enabled || !room.gameState.playing) return;
  
  // Limpiar timer existente
  if (room.consumableTimers[consumableType]) {
    clearInterval(room.consumableTimers[consumableType]);
  }
  
  const checkAndSpawn = () => {
    if (!room || !room.gameState.playing) return;
    
    const maxConsumables = getMaxConsumablesForType(room, consumableType);
    const currentCount = room.consumables.filter(c => c.type === consumableType).length;
    
    if (currentCount < maxConsumables) {
      spawnConsumable(room, consumableType);
    }
  };
  
  // NUEVO: Spawn inmediato al reiniciar timer
  //checkAndSpawn();
  
  // Reiniciar timer
  room.consumableTimers[consumableType] = setInterval(checkAndSpawn, config.spawnInterval * 1000);
}

function getMaxConsumablesForType(room, consumableType) {
  const playerCount = room.players.filter(p => !p.gameover).length;
  
  switch(consumableType) {
    case 'immunity':
      return Math.max(3, playerCount+1);
    default:
      return 1;
  }
}

function spawnConsumable(room, type) {
  const { canvasWidth, canvasHeight, segmentSize } = room.config;
  
  let consumableX, consumableY;
  let attempts = 0;
  const maxAttempts = 100;
  
  do {
    consumableX = getRandomCoordinate(canvasWidth, segmentSize);
    consumableY = getRandomCoordinate(canvasHeight, segmentSize);
    attempts++;
  } while (!verifyCoordinate(room, consumableX, consumableY) && attempts < maxAttempts);
  
  if (attempts >= maxAttempts) {
    consumableX = Math.floor(canvasWidth * 0.8 / segmentSize) * segmentSize;
    consumableY = Math.floor(canvasHeight * 0.8 / segmentSize) * segmentSize;
  }
  
  room.consumables.push({ 
    id: Math.random().toString(36).substring(2, 9),
    x: consumableX, 
    y: consumableY, 
    type: type,
    spawnTime: Date.now()
  });
  
  console.log(`Spawned ${type} consumable in room ${room.id}`);
}

// MODIFICADO: Verificar si un jugador consumió un consumible
function checkConsumableConsumption(room, player) {
  const { segmentSize } = room.config;
  const head = player.segments[0];
  const headX = Math.floor(head.x / segmentSize);
  const headY = Math.floor(head.y / segmentSize);
  
  const consumableIndex = room.consumables.findIndex(consumable => 
    Math.floor(consumable.x / segmentSize) === headX && 
    Math.floor(consumable.y / segmentSize) === headY
  );
  
  if (consumableIndex !== -1) {
    const consumable = room.consumables[consumableIndex];
    
    // Obtener duración del consumible según configuración
    const duration = room.config.consumables[consumable.type]?.duration || 5;
    
    // El jugador consume el consumible
    player.consumeConsumable(consumable.type, duration);
    
    // Remover el consumible del mapa
    room.consumables.splice(consumableIndex, 1);
    
    return consumable;
  }
  
  return null;
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

// MODIFICADO: moveProjectiles para manejar inmunidad
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
            
            // Verificar inmunidad
            if (player.hasImmunity()) {
              player.useImmunity(); // Consumir inmunidad
              console.log(`${player.name} used immunity to block projectile`);
              return false; // Remover el proyectil
            }
            
            // Sin inmunidad, aplicar daño normal
            if (i === 0) {
              const segmentsToRemove = Math.min(3, player.segments.length - 1);
              for (let j = 0; j < segmentsToRemove; j++) {
                if (player.segments.length > 1) {
                  player.segments.pop();
                }
              }
            } else {
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
    
    io.to(room.id).emit('roundTimeUpdate', room.gameState.roundTimeLeft);
    
    if (room.gameState.roundTimeLeft <= 0) {
      clearInterval(room.gameState.roundTimerId);
      room.gameState.roundTimerId = null;
      endRound(room);
    }
  }, 1000);
}

function endRound(room) {
  if (room.gameState.intervalId) {
    clearInterval(room.gameState.intervalId);
    room.gameState.intervalId = null;
  }
  if (room.gameState.roundTimerId) {
    clearInterval(room.gameState.roundTimerId);
    room.gameState.roundTimerId = null;
  }
  
  // Pausar generación de consumibles
  Object.values(room.consumableTimers).forEach(timerId => {
    if (timerId) clearInterval(timerId);
  });
  
  let roundWinner = null;
  let maxSize = 0;
  
  room.players.forEach(player => {
    const snakeSize = player.segments.length;
    player.score = snakeSize;
    
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

async function endGame(room) {
  room.gameState.playing = false;
  
  if (room.gameState.intervalId) {
    clearInterval(room.gameState.intervalId);
    room.gameState.intervalId = null;
  }
  
  if (room.gameState.roundTimerId) {
    clearInterval(room.gameState.roundTimerId);
    room.gameState.roundTimerId = null;
  }
  
  // Parar generación de consumibles
  Object.values(room.consumableTimers).forEach(timerId => {
    if (timerId) clearInterval(timerId);
  });
    
  const finalWinner = Object.values(room.roundScores).reduce((prev, current) => 
    (prev.totalScore > current.totalScore) ? prev : current
  );
  
  // Update player stats
  const updatePromises = room.players.map(player => {
    if (player.playerId) {
      const gameData = {
        finalScore: room.roundScores[player.id]?.totalScore || 0,
        roundsWon: room.roundScores[player.id]?.roundWins || 0,
        won: room.roundScores[player.id]?.totalScore === finalWinner.totalScore
      };
      return updatePlayerStats(player.playerId, gameData);
    }
  }).filter(Boolean);
  
  try {
    await Promise.all(updatePromises);
  } catch (error) {
    console.error('Error updating player stats:', error);
  }
  
  io.to(room.id).emit('gameEnd', {
    winner: finalWinner,
    finalScores: room.roundScores,
    roomFinished: true
  });
  
  room.finished = true;
  setTimeout(() => deleteRoom(room.id), 30000);
}

// MODIFICADO: startNewRound
function startNewRound(room) {
  room.gameState.downCounter = 3; // FIJO: siempre 3 segundos
  room.gameState.roundTimeLeft = room.config.roundTime;
  room.projectiles = [];
  room.consumables = []; // Limpiar consumibles
  
  room.players.forEach((player, index) => {
    const spawnPos = getPlayerSpawnPosition(room, index);
    
    player.segments = [{ x: spawnPos.x, y: spawnPos.y }];
    player.direction = { x: 1, y: 0 };
    player.score = 1;
    player.gameover = false;
    player.scoreLeftToGrow = 0;
    player.moveQueue = [];
    player.activeConsumable = null; // Limpiar consumibles activos
    player.updateInterpolationSpeed(room.config.gameSpeed);
    player.updateTargets();
  });
  
  generateFoods(room);
  initializeConsumableSystem(room); // Reiniciar sistema de consumibles
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
      consumables: [...room.consumables],
      projectiles: [...room.projectiles],
      config: room.config,
      gameState: {
        playing: room.gameState.playing,
        round: room.gameState.round,
        roundTimeLeft: room.gameState.roundTimeLeft
      }
    });
    
    room.gameState.intervalId = setInterval(() => gameLogicLoop(room), room.config.gameSpeed);
    startRoundTimer(room);
    
    // Iniciar timers de consumibles
    initializeConsumableSystem(room);
    
  } else {
    io.to(room.id).emit('countdown', room.gameState.downCounter, 
      { playing: room.gameState.playing, round: room.gameState.round });
    room.gameState.downCounter--;
    room.gameState.timeoutIdStartGame = setTimeout(() => startGame(room), 1000);
  }
}

// MODIFICADO: gameLogicLoop
function gameLogicLoop(room) {
  if (!room.gameState.playing) return;
  
  const { canvasWidth, canvasHeight, segmentSize } = room.config;
  let portalEvents = [];
  let consumableEvents = [];
  
  if (!room.gameboard || room.gameboard.length === 0) {
    resetGameBoard(room);
  }
  
  if (room.config.attacksEnabled) {
    moveProjectiles(room);
  }
  
  room.players.forEach((player) => {
    if (!player.gameover) {
      // Actualizar consumibles expirados
      player.updateConsumables();
      
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
      
      // Lógica de portales
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
      
      // Verificar consumo de consumibles
      const consumedConsumable = checkConsumableConsumption(room, player);
      if (consumedConsumable) {
        consumableEvents.push({
          playerId: player.id,
          playerName: player.name,
          consumableType: consumedConsumable.type
        });
        
        // Reiniciar timer del tipo de consumible consumido
        // restartConsumableTimer(room, consumedConsumable.type);
      }
      
      // Lógica de comida
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
          
          const newFoodScore = Math.floor(Math.random() * 5) + 1;
          room.foods.push({ x: foodX, y: foodY, score: newFoodScore });
        }
      }
      
      player.score = player.segments.length;
    }
  });
  
  updateGameBoard(room);
  
  io.to(room.id).emit('gameLogicFrame', {
    players: serializePlayers(room.players),
    foods: [...room.foods],
    consumables: [...room.consumables],
    projectiles: [...room.projectiles],
    portals: portalEvents,
    consumableEvents: consumableEvents,
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

  socket.on('createRoom', async (data) => {
    try {
      if (!data.username || data.username.length < 2 || data.username.length > 20) {
        socket.emit('gameError', 'Username must be 2-20 characters');
        return;
      }
      
      const playerProfile = await getOrCreatePlayer(data.username.trim(), data.playerId);
      
      const roomId = createRoom(socket.id, playerProfile.stats.name);
      currentRoom = roomId;
      socket.join(roomId);
      
      const room = getRoom(roomId);
      if (!room) {
        socket.emit('gameError', 'Failed to create room');
        return;
      }
      
      const { canvasWidth, canvasHeight, segmentSize } = room.config;
      const spawnPos = getPlayerSpawnPosition(room, 0);
      const playerColor = getNextAvailableColor(room);
      const player = new Snake(socket.id, playerProfile.stats.name, segmentSize, canvasWidth, canvasHeight, spawnPos.x, spawnPos.y, 1, 0, playerColor, room.config.gameSpeed);
      player.moveQueue = []; 
      player.playerId = playerProfile.playerId;
      room.players.push(player);
      
      socket.emit('roomCreated', { 
        roomId, 
        isHost: true,
        config: room.config,
        playerProfile: playerProfile
      });
      io.to(roomId).emit('updatePlayers', serializePlayers(room.players), 
        { playing: room.gameState.playing, round: room.gameState.round }, 
        room.config, { host: room.host, roomId });
    } catch (error) {
      console.error('Error creating room:', error);
      socket.emit('gameError', 'Error creating room');
    }
  });

  socket.on('joinRoom', async (data) => {
    try {
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
      
      const playerProfile = await getOrCreatePlayer(data.username.trim(), data.playerId);
      
      if (room.players.some(p => p.name === playerProfile.stats.name)) {
        socket.emit('gameError', 'Username already taken in this room');
        return;
      }
      
      currentRoom = data.roomId;
      socket.join(data.roomId);
      
      const { canvasWidth, canvasHeight, segmentSize } = room.config;
      const playerIndex = room.players.length;
      const spawnPos = getPlayerSpawnPosition(room, playerIndex);
      const playerColor = getNextAvailableColor(room);
      
      const player = new Snake(socket.id, playerProfile.stats.name, segmentSize, canvasWidth, canvasHeight, spawnPos.x, spawnPos.y, 1, 0, playerColor, room.config.gameSpeed);
      player.moveQueue = [];
      player.playerId = playerProfile.playerId;
      room.players.push(player);
      
      initializeRoundScores(room);
      socket.emit('roomJoined', { 
        roomId: data.roomId, 
        isHost: false,
        config: room.config,
        playerProfile: playerProfile
      });
      
      io.to(data.roomId).emit('updatePlayers', serializePlayers(room.players), 
        { playing: room.gameState.playing, round: room.gameState.round }, 
        room.config, { host: room.host, roomId: data.roomId });
    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('gameError', 'Error joining room');
    }
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
    room.gameState.downCounter = 3; // FIJO: siempre 3 segundos
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
    initializeConsumableSystem(room); // Reinicializar sistema de consumibles
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
          roundTime: room.config.roundTime,
          consumables: room.config.consumables
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

  socket.on('getPlayerStats', async (playerId) => {
    try {
      const stats = await getPlayerStats(playerId);
      if (stats) {
        socket.emit('playerStats', { playerId, stats });
      }
    } catch (error) {
      console.error('Error getting stats:', error);
    }
  });

  socket.on('getOrCreateProfile', async (data) => {
    try {
      if (!data.username || data.username.length < 2 || data.username.length > 20) {
        socket.emit('profileError', 'Username must be 2-20 characters');
        return;
      }
      
      const username = data.username.trim();
      
      const isUserConnected = Array.from(connectedUsers.values()).some(connectedName => 
        connectedName.toLowerCase() === username.toLowerCase()
      );
      
      if (isUserConnected) {
        socket.emit('profileError', `El usuario "${username}" ya está conectado. Intenta con otro nombre.`);
        return;
      }
      
      const playerProfile = await getOrCreatePlayer(username, data.playerId);
      
      connectedUsers.set(socket.id, playerProfile.stats.name);
      
      socket.emit('profileLoaded', playerProfile);
    } catch (error) {
      console.error('Error getting profile:', error);
      socket.emit('profileError', 'Error loading profile');
    }
  });

  socket.on('logout', (data) => {
    connectedUsers.delete(socket.id);
    
    if (currentRoom) {
      handlePlayerLeaveRoom(socket, currentRoom);
      currentRoom = null;
    }
  });

  function handlePlayerLeaveRoom(socket, roomId) {
    const room = getRoom(roomId);
    if (!room) return;
    
    const playerIndex = room.players.findIndex(player => player.id === socket.id);
    if (playerIndex !== -1) {
      const playerName = room.players[playerIndex].name;
      room.players.splice(playerIndex, 1);
      console.log(`Player "${playerName}" left room ${roomId}`);
      
      room.projectiles = room.projectiles.filter(p => p.playerId !== socket.id);
      delete room.roundScores[socket.id];
      
      if (room.host === socket.id) {
        if (room.players.length > 0) {
          room.host = room.players[0].id;
          room.hostName = room.players[0].name;
          io.to(roomId).emit('newHost', { hostId: room.host, hostName: room.hostName });
        } else {
          deleteRoom(roomId);
          return;
        }
      }
      
      io.to(roomId).emit('updatePlayers', serializePlayers(room.players), 
        { playing: room.gameState.playing, round: room.gameState.round }, 
        room.config, { host: room.host, roomId });
      
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
        Object.values(room.consumableTimers).forEach(timerId => {
          if (timerId) clearInterval(timerId);
        });
        io.to(roomId).emit('gameError', 'Not enough players to continue');
      }
      
      if (room.players.length < room.config.minPlayers && room.gameState.timeoutIdStartGame) {
        clearTimeout(room.gameState.timeoutIdStartGame);
        room.gameState.timeoutIdStartGame = null;
        room.gameState.downCounter = 3;
      }
    }
    
    socket.leave(roomId);
  }

  socket.on('getLeaderboard', async () => {
    try {
      const leaderboard = await getLeaderboard();
      socket.emit('leaderboard', leaderboard);
    } catch (error) {
      console.error('Error getting leaderboard:', error);
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
    connectedUsers.delete(socket.id);
    
    if (!currentRoom) return;
    
    handlePlayerLeaveRoom(socket, currentRoom);
  });
});

process.on('SIGINT', () => {
  db.close((err) => {
    if (err) console.error(err.message);
    console.log('Database connection closed.');
    process.exit(0);
  });
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});