const http = require('http');
const express = require('express');
const socketIO = require('socket.io');
const Snake = require('./public/snakeClass.js');
const { buildRoomConfig, consumableLimit } = require('./game/difficulty');
const { traceProjectile, fanDirections } = require('./game/projectiles');
const { touchedAlong, wrapPoint, cellIndex } = require('./game/geometry');
const { cutSnake, dropRemains } = require('./game/remains');
const { matchResult, frenzyFoodTarget, crownHolder } = require('./game/match');
const { createAssets } = require('./lib/assets');
const { secureIndex, reportHandler, REPORT_PATH, REPORT_TYPES } = require('./lib/security');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
// Mensajes del WebSocket comprimidos (permessage-deflate de ws, que ya trae Socket.IO). Cada frame
// se parece mucho al anterior: con el contexto compartido entre mensajes viaja entre el 3 y el 5 %
// de los bytes (medido: 58 KB/s por jugador sin comprimir). Los mensajes de menos de 1 KB van tal cual.
const io = socketIO(server, { perMessageDeflate: { threshold: 1024 } });
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

// Archivos de texto precomprimidos (brotli/gzip) y versionados por contenido (lib/assets.js);
// lo demás, express.static. index.html sale con la CSP en modo solo-reporte y un nonce nuevo
// en cada respuesta (lib/security.js); los reportes llegan a /csp-report.
const assets = createAssets(path.join(__dirname, 'public'), { transformIndex: secureIndex });
app.post(REPORT_PATH, express.json({ type: REPORT_TYPES, limit: '16kb' }), reportHandler());
app.use(assets.middleware);
app.use(express.static('public'));

let rooms = new Map();
let connectedUsers = new Map(); // socketId -> { name, roomId, playerId }

// Cada jugador viaja con sus efectos vigentes ({ tipo: vencimiento en ms del servidor })
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
    effects: player.activeEffects(Date.now())
  }));
}

// NUEVO: Función para obtener lista de jugadores en línea
function getOnlinePlayersList(excludeSocketId = null, excludeRoomId = null) {
  const onlinePlayers = [];
  
  connectedUsers.forEach((userData, socketId) => {
    if (socketId === excludeSocketId) return;
    
    // Excluir jugadores de la misma sala
    //if (excludeRoomId && userData.roomId === excludeRoomId) return;
    
    // Solo incluir jugadores que no están en juego
    let isInGame = false;
    if (userData.roomId) {
      const room = rooms.get(userData.roomId);
      if (room && room.gameState.playing) {
        isInGame = true;
      }
    }
    
    onlinePlayers.push({
      socketId: socketId,
      name: userData.name,
      roomId: userData.roomId,
      isInGame: isInGame,
      canInvite: !isInGame && userData.roomId !== excludeRoomId
    });
  });
  
  return onlinePlayers.sort((a, b) => a.name.localeCompare(b.name));
}

// NUEVO: Función para enviar lista actualizada de jugadores
function broadcastOnlinePlayersList() {
  connectedUsers.forEach((userData, socketId) => {
    const currentRoom = userData.roomId;
    const onlineList = getOnlinePlayersList(socketId, currentRoom);
    io.to(socketId).emit('onlinePlayersList', onlineList);
  });
}

function generateRoomId() {
  let roomId;
  do {
    roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (rooms.has(roomId));
  return roomId;
}

// Override de desarrollo: ROUND_TIME=10 npm run dev permite partidas cortas para QA.
// Sin la variable (o con un valor inválido) la partida dura 2 minutos.
const ROUND_TIME = (() => {
  const value = Math.floor(Number(process.env.ROUND_TIME));
  return value > 0 ? value : 120;
})();

// La sala solo elige el nivel; el resto de la configuración sale de game/difficulty.js.
// Los campos que manda un cliente viejo (maxPlayers, gameSpeed, ...) se ignoran.
function validateRoomConfig(config) {
  return buildRoomConfig(config && config.difficulty, { roundTime: ROUND_TIME });
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
    pendingProjectileEvents: [], // Disparos ocurridos entre ticks; se envían en el próximo gameLogicFrame
    consumableTimers: {}, // NUEVO: Timers para generación de consumibles
    spectators: new Map() // NUEVO: Espectadores activos (socketId -> { name, joinedAt })
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

function addSpectator(roomId, socketId, spectatorName) {
  const room = getRoom(roomId);
  if (!room || !room.gameState.playing) return false;
  
  if (!room.spectators) room.spectators = new Map();
  
  room.spectators.set(socketId, {
    name: spectatorName,
    joinedAt: Date.now()
  });
  
  return true;
}

function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (room) {
    if (room.gameState.intervalId) clearInterval(room.gameState.intervalId);
    if (room.gameState.timeoutIdStartGame) clearTimeout(room.gameState.timeoutIdStartGame);
    if (room.gameState.roundTimerId) clearInterval(room.gameState.roundTimerId);
    room.gameState.intervalId = null;
    room.gameState.timeoutIdStartGame = null;
    room.gameState.roundTimerId = null;
    room.gameState.playing = false;

    // NUEVO: Limpiar timers de consumibles
    Object.values(room.consumableTimers).forEach(timerId => {
      if (timerId) clearInterval(timerId);
    });
    room.consumableTimers = {};

    rooms.delete(roomId);
    console.log(`Room ${roomId} deleted`);
  }
}

// Una sala sigue viva mientras sea la misma instancia registrada en `rooms`.
// Los timers guardan una referencia a la sala: antes de actuar, comprueban que no la hayan borrado.
function isRoomAlive(room) {
  return !!room && rooms.get(room.id) === room;
}

function clearRoomGameTimers(room) {
  const gs = room.gameState;
  if (gs.intervalId) { clearInterval(gs.intervalId); gs.intervalId = null; }
  if (gs.roundTimerId) { clearInterval(gs.roundTimerId); gs.roundTimerId = null; }
  if (gs.timeoutIdStartGame) { clearTimeout(gs.timeoutIdStartGame); gs.timeoutIdStartGame = null; }
  Object.values(room.consumableTimers).forEach(timerId => {
    if (timerId) clearInterval(timerId);
  });
  room.consumableTimers = {};
}

// La sala vuelve a espera, con los mismos jugadores y el mismo nivel: al terminar la partida
// (lista para "Jugar de nuevo") o cuando se corta por falta de jugadores.
function resetRoomToWaiting(room) {
  clearRoomGameTimers(room);
  room.gameState.playing = false;
  room.gameState.round = 1;
  room.gameState.downCounter = 3;
  room.gameState.roundTimeLeft = room.config.roundTime;
  room.gameState.frenzy = false;
  room.gameState.leaderId = null;
  room.projectiles = [];
  room.pendingProjectileEvents = [];
  room.consumables = [];

  room.players.forEach((player, index) => resetPlayerForRound(room, player, index));

  resetGameBoard(room);
  generateFoods(room);
  updateGameBoard(room);
}

// Corte por falta de jugadores (en plena partida o en su cuenta regresiva): la sala vuelve a
// espera y todos reciben el estado nuevo antes del aviso.
function abortMatch(room) {
  resetRoomToWaiting(room);
  io.to(room.id).emit('updatePlayers', serializePlayers(room.players), 
    { playing: false, round: room.gameState.round }, 
    room.config, { host: room.host, roomId: room.id });
  io.to(room.id).emit('gameError', 'Not enough players to continue');
  broadcastOnlinePlayersList();
}

function resetGameBoard(room) {
  const { canvasWidth, canvasHeight, segmentSize } = room.config;
  const gridWidth = Math.floor(canvasWidth / segmentSize);
  const gridHeight = Math.floor(canvasHeight / segmentSize);
  
  room.gameboard = Array(gridWidth).fill().map(() => Array(gridHeight).fill(0));
}

// Tablero de ocupación: con giro libre las posiciones no caen justo en una celda, así que se
// ubican por su centro. Solo sirve para elegir celdas libres al hacer aparecer comida y escudos;
// comer, tomar el escudo y los impactos se resuelven por distancia (game/geometry.js).
function updateGameBoard(room) {
  resetGameBoard(room);
  const { segmentSize } = room.config;
  const gridWidth = room.gameboard.length;
  const gridHeight = room.gameboard[0].length;
  const mark = (p, value) => {
    room.gameboard[cellIndex(p.x, segmentSize, gridWidth)][cellIndex(p.y, segmentSize, gridHeight)] = value;
  };

  room.players.forEach((player) => {
    if (!player.gameover && player.segments) player.segments.forEach(segment => mark(segment, 1));
  });
  room.foods.forEach(food => mark(food, 2));
  room.consumables.forEach(consumable => mark(consumable, 3)); // 3 = consumible
}

// Alcances del contacto, en celdas, entre centros. La cabeza mide 0,46 celdas de radio y la
// comida de 0,33 a 0,47: comer a 0,85 se siente justo, sin tener que alinearse con una fila.
const EAT_REACH = 0.85;
const PICKUP_REACH = 0.9;   // escudo (la campana es un poco más grande que la comida)
const HIT_REACH = 0.7;      // proyectil contra un segmento: 1,4 celdas de ancho de blanco, más que la fila de la grilla
const SHOT_SPACING = 1;     // no se puede disparar con un proyectil propio a menos de una celda de donde nacería

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

// Deja al jugador listo para una ronda: largo inicial del nivel, mirando a la derecha,
// sin consumibles ni movimientos pendientes
function resetPlayerForRound(room, player, index) {
  const spawn = getPlayerSpawnPosition(room, index);
  player.segmentSize = room.config.segmentSize;
  if (room.config.turnDegrees) player.turnRate = room.config.turnDegrees * Math.PI / 180;
  player.reset(spawn.x, spawn.y, 1, 0, room.config.startLength);
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
  const foodCount = playerCount + room.config.foodExtra;
  
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
  
  // Un temporizador por tipo habilitado (escudo, boca grande, abanico)
  Object.keys(room.config.consumables).forEach(type => {
    if (room.config.consumables[type].enabled) startConsumableTimer(room, type);
  });
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
  return consumableLimit(consumableType, playerCount);
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

// Verificar si un jugador tomó un consumible: contra todo el tramo que recorrió la cabeza en el
// paso (`from` antes de moverse, `step` lo que avanzó), por el lado corto de los portales
function checkConsumableConsumption(room, player, from, step) {
  const { segmentSize, canvasWidth, canvasHeight } = room.config;
  const touched = touchedAlong(from, step, room.consumables, segmentSize * PICKUP_REACH, canvasWidth, canvasHeight);
  const consumableIndex = touched.length ? touched[0] : -1;

  if (consumableIndex !== -1) {
    const consumable = room.consumables[consumableIndex];
    
    // Activa el efecto (o reinicia su tiempo si ya lo tenía); la duración del nivel está en segundos
    const duration = room.config.consumables[consumable.type]?.duration || 5;
    player.addEffect(consumable.type, duration * 1000, Date.now());
    
    // Remover el consumible del mapa
    room.consumables.splice(consumableIndex, 1);
    
    return consumable;
  }
  
  return null;
}

function createProjectile(room, player) {
  // Cambio 1: Reducir mínimo requerido de 3 a 2 segmentos
  if (!room.config.attacksEnabled || player.segments.length < 2) {
    return false;
  }
  
  const now = Date.now();
  const head = player.segments[0];
  const { segmentSize } = room.config;
  
  // Calcular la posición donde aparecería el nuevo proyectil (una celda adelante, en el rumbo actual)
  const newProjectileX = Snake.round1(head.x + (player.direction.x * segmentSize));
  const newProjectileY = Snake.round1(head.y + (player.direction.y * segmentSize));

  // No dispara si ya tiene un proyectil propio justo enfrente (con ángulos no coinciden exacto)
  const spacing2 = Math.pow(segmentSize * SHOT_SPACING, 2);
  const frontProjectile = room.projectiles.find(p =>
    p.playerId === player.id &&
    Math.pow(p.x - newProjectileX, 2) + Math.pow(p.y - newProjectileY, 2) < spacing2
  );
  
  if (frontProjectile) {
    return false; // No puede lanzar si hay un proyectil suyo directamente enfrente
  }

  // Pausa entre tiros: va al final, así un pedido rechazado por otra razón no la consume
  if (!player.tryShot(now, room.config.shotCooldownMs || 0)) {
    return false;
  }

  // Disparar cuesta un segmento, también la ráfaga del abanico
  if (player.segments.length > 1) {
    player.segments.pop();
  }
  player.updateTargets();

  // Con el abanico salen tres: el central y dos abiertos fanDegrees a los lados, cada uno una celda
  // delante de la cabeza en su propio rumbo
  const directions = player.hasEffect('fan', now)
    ? fanDirections(player.direction, room.config.fanDegrees)
    : [player.direction];
  if (!room.pendingProjectileEvents) room.pendingProjectileEvents = [];
  directions.forEach((direction, index) => {
    const projectile = {
      id: Math.random().toString(36).substring(2, 9),
      playerId: player.id,
      x: index === 0 ? newProjectileX : Snake.round1(head.x + direction.x * segmentSize),
      y: index === 0 ? newProjectileY : Snake.round1(head.y + direction.y * segmentSize),
      direction: { ...direction },
      color: player.color
    };
    room.projectiles.push(projectile);

    // Evento visual: el disparo ocurre entre ticks, se envía en el próximo gameLogicFrame. Los
    // laterales van con spread: la arena no repite el costo (la gota de la cola) por ellos.
    const event = {
      id: projectile.id,
      playerId: projectile.playerId,
      x: projectile.x,
      y: projectile.y,
      direction: { ...projectile.direction },
      color: projectile.color
    };
    if (index > 0) event.spread = true;
    room.pendingProjectileEvents.push(event);
  });
  return true;
}

// MODIFICADO: moveProjectiles para manejar inmunidad
// frameEvents (opcional) acumula los eventos visuales del tick: hitEvents, blockEvents, expiredProjectiles
function moveProjectiles(room, frameEvents = { hitEvents: [], blockEvents: [], expiredProjectiles: [] }) {
  const { segmentSize, canvasWidth, canvasHeight, projectileCells } = room.config;
  const bounds = { cell: segmentSize, width: canvasWidth, height: canvasHeight };

  const hitRadius = segmentSize * HIT_REACH;
  // Restos: no se apilan sobre una comida que ya está a menos de media celda
  const nearFood2 = Math.pow(segmentSize / 2, 2);
  const occupied = (x, y) => room.foods.some(f => Math.pow(f.x - x, 2) + Math.pow(f.y - y, 2) < nearFood2);

  room.projectiles = room.projectiles.filter(projectile => {
    const result = traceProjectile(projectile, projectileCells, bounds, room.players, hitRadius);

    if (result.outcome === 'alive') {
      projectile.x = result.x;
      projectile.y = result.y;
      return true;
    }

    if (result.outcome === 'expired') {
      frameEvents.expiredProjectiles.push({ id: projectile.id, x: result.x, y: result.y });
      return false;
    }

    const player = result.player;
    if (result.outcome === 'block') {
      player.useImmunity(); // Consumir inmunidad
      console.log(`${player.name} used immunity to block projectile`);
      frameEvents.blockEvents.push({
        playerId: player.id,
        attackerId: projectile.playerId,
        projectileId: projectile.id,
        x: result.x,
        y: result.y
      });
      return false;
    }

    // Impacto: en la cabeza quita hasta 3 segmentos; en el cuerpo, corta desde ahí.
    // Lo que pierde queda en el mapa como restos (comida que vence a los 10 s).
    const lengthBefore = player.segments.length;
    const { kept, lost } = cutSnake(player.segments, result.segmentIndex);
    player.segments = kept;
    player.updateTargets();
    room.foods.push(...dropRemains(lost, Date.now(), occupied));
    frameEvents.hitEvents.push({
      targetId: player.id,
      attackerId: projectile.playerId,
      projectileId: projectile.id,
      x: result.x,
      y: result.y,
      segmentsLost: lengthBefore - player.segments.length,
      headshot: result.segmentIndex === 0,
      color: player.color,
      attackerColor: projectile.color
    });
    return false;
  });
}

function startRoundTimer(room) {
  room.gameState.roundTimeLeft = room.config.roundTime;
  
  room.gameState.roundTimerId = setInterval(() => {
    if (!isRoomAlive(room)) {
      clearInterval(room.gameState.roundTimerId);
      room.gameState.roundTimerId = null;
      return;
    }
    room.gameState.roundTimeLeft--;
    // Frenesí: en los últimos segundos sube la comida base (gameLogicLoop la va sumando de a una)
    const frenzy = room.config.frenzy;
    if (frenzy && !room.gameState.frenzy && room.gameState.roundTimeLeft <= frenzy.lastSeconds) {
      room.gameState.frenzy = true;
    }
    
    io.to(room.id).emit('roundTimeUpdate', room.gameState.roundTimeLeft);
    
    if (room.gameState.roundTimeLeft <= 0) {
      clearInterval(room.gameState.roundTimerId);
      room.gameState.roundTimerId = null;
      endMatch(room).catch(error => console.error('Error ending match:', error));
    }
  }, 1000);
}

// Fin de la partida: gana la serpiente más larga. Se guardan las estadísticas, todos reciben la
// clasificación y la sala vuelve a espera con los mismos jugadores, lista para "Jugar de nuevo".
async function endMatch(room) {
  if (!isRoomAlive(room) || !room.gameState.playing) return;
  clearRoomGameTimers(room);
  room.gameState.playing = false;

  const { ranking, winners } = matchResult(room.players);
  const lengthById = new Map(ranking.map(entry => [entry.id, entry.length]));
  const updates = room.players.filter(player => player.playerId).map(player =>
    updatePlayerStats(player.playerId, {
      finalScore: lengthById.get(player.id) || 0,
      won: winners.includes(player.id)
    })
  );
  try {
    await Promise.all(updates);
  } catch (error) {
    console.error('Error updating player stats:', error);
  }
  if (!isRoomAlive(room)) return;

  io.to(room.id).emit('gameEnd', { ranking, winners });

  resetRoomToWaiting(room);
  io.to(room.id).emit('updatePlayers', serializePlayers(room.players),
    { playing: false, round: room.gameState.round },
    room.config, { host: room.host, roomId: room.id });
  broadcastOnlinePlayersList();
}

function startGame(room) {
  if (!isRoomAlive(room) || room.finished) return;
  if (room.gameState.downCounter === 0) {
    resetGameBoard(room);
    
    if (room.gameState.timeoutIdStartGame) {
      clearTimeout(room.gameState.timeoutIdStartGame);
      room.gameState.timeoutIdStartGame = null;
    }
    
    room.gameState.playing = true;
    room.gameState.frenzy = false;
    room.gameState.leaderId = null;
    room.pendingProjectileEvents = []; // Arranca la ronda sin eventos de disparo viejos
    
    console.log(`Starting match in room ${room.id}`);
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
    
    // NUEVO: Actualizar lista de jugadores en línea (ya no pueden ser invitados)
    broadcastOnlinePlayersList();
    
  } else {
    io.to(room.id).emit('countdown', room.gameState.downCounter, 
      { playing: room.gameState.playing, round: room.gameState.round });
    room.gameState.downCounter--;
    room.gameState.timeoutIdStartGame = setTimeout(() => startGame(room), 1000);
  }
}

// MODIFICADO: gameLogicLoop
// Una comida base nueva en una celda libre (o en el centro si no encuentra lugar)
function respawnFood(room) {
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

  room.foods.push({ x: foodX, y: foodY, score: Math.floor(Math.random() * 5) + 1 });
}

function gameLogicLoop(room) {
  if (!isRoomAlive(room)) {
    if (room.gameState.intervalId) clearInterval(room.gameState.intervalId);
    room.gameState.intervalId = null;
    return;
  }
  if (!room.gameState.playing) return;
  
  const { canvasWidth, canvasHeight, segmentSize } = room.config;
  let portalEvents = [];
  let consumableEvents = [];
  // Eventos visuales del tick (todos los arrays viajan siempre, aunque estén vacíos)
  const foodEvents = [];
  const frameEvents = { hitEvents: [], blockEvents: [], expiredProjectiles: [] };
  const projectileEvents = room.pendingProjectileEvents || [];
  room.pendingProjectileEvents = [];
  
  if (!room.gameboard || room.gameboard.length === 0) {
    resetGameBoard(room);
  }

  // Los restos de los cortes vencen; la comida base no tiene expiresAt
  const tickNow = Date.now();
  room.foods = room.foods.filter(food => !food.expiresAt || food.expiresAt > tickNow);

  // Frenesí: una comida base nueva por paso hasta llegar a la cantidad aumentada
  if (room.gameState.frenzy && room.config.frenzy) {
    const target = frenzyFoodTarget(room.players.length, room.config.foodExtra, room.config.frenzy.foodBoost);
    if (room.foods.filter(food => !food.remains).length < target) respawnFood(room);
  }
  
  if (room.config.attacksEnabled) {
    moveProjectiles(room, frameEvents);
  }
  
  room.players.forEach((player) => {
    if (!player.gameover) {
      const prevHead = { ...player.segments[0] };
      player.moveLogic(); // gira hacia el rumbo pedido y avanza una celda
      const head = player.segments[0];

      if (!head) {
        return;
      }

      // Lo que avanzó la cabeza en este paso, antes de envolver: el tramo para comer y tomar el escudo
      const step = { x: head.x - prevHead.x, y: head.y - prevHead.y };

      // Portales: la cabeza pasa al borde opuesto conservando su posición exacta (con giro libre
      // no cae en una celda; alinearla a la grilla la correría de costado)
      const portalEventsStart = portalEvents.length;
      const crossed = wrapPoint(head, segmentSize, canvasWidth, canvasHeight);
      // Sumar el ancho deja ruido de coma flotante (-6.3 + 768 = 761.6999…) que viajaría en cada frame
      head.x = Snake.round1(head.x);
      head.y = Snake.round1(head.y);
      if (crossed.x) {
        portalEvents.push({ playerId: player.id, type: 'horizontal', from: crossed.x, to: crossed.x === 'left' ? 'right' : 'left' });
      }
      if (crossed.y) {
        portalEvents.push({ playerId: player.id, type: 'vertical', from: crossed.y, to: crossed.y === 'top' ? 'bottom' : 'top' });
      }

      // Coordenadas del portal: cabeza antes de moverse y cabeza ya envuelta
      for (let p = portalEventsStart; p < portalEvents.length; p++) {
        portalEvents[p].fromX = prevHead.x;
        portalEvents[p].fromY = prevHead.y;
        portalEvents[p].toX = head.x;
        portalEvents[p].toY = head.y;
      }

      // Verificar consumo de consumibles
      const consumedConsumable = checkConsumableConsumption(room, player, prevHead, step);
      if (consumedConsumable) {
        consumableEvents.push({
          playerId: player.id,
          playerName: player.name,
          consumableType: consumedConsumable.type,
          x: consumedConsumable.x,
          y: consumedConsumable.y
        });
        
        // Reiniciar timer del tipo de consumible consumido
        // restartConsumableTimer(room, consumedConsumable.type);
      }
      
      // Comida: todo lo que toca el tramo que recorrió la cabeza (puede ser más de una, por
      // ejemplo al pasar por una fila de restos). Con la boca grande, desde bigMouthReach celdas.
      const eatReach = player.hasEffect('bigMouth', tickNow) ? room.config.bigMouthReach : EAT_REACH;
      const eaten = touchedAlong(prevHead, step, room.foods, segmentSize * eatReach, canvasWidth, canvasHeight)
        .map(index => room.foods[index]);
      for (const eatenFood of eaten) {
        player.EatFood(eatenFood.score);
        room.foods.splice(room.foods.indexOf(eatenFood), 1);
        foodEvents.push({
          playerId: player.id,
          x: eatenFood.x,
          y: eatenFood.y,
          score: eatenFood.score,
          color: player.color
        });

        // Los restos no reaparecen: solo la comida base mantiene su cantidad
        if (!eatenFood.remains) respawnFood(room);
      }
      
      player.score = player.segments.length;
    }
  });
  
  updateGameBoard(room);
  room.gameState.leaderId = crownHolder(room.players, room.gameState.leaderId || null);
  
  io.to(room.id).emit('gameLogicFrame', {
    players: serializePlayers(room.players),
    foods: [...room.foods],
    consumables: [...room.consumables],
    projectiles: [...room.projectiles],
    portals: portalEvents,
    consumableEvents: consumableEvents,
    foodEvents: foodEvents,
    hitEvents: frameEvents.hitEvents,
    blockEvents: frameEvents.blockEvents,
    projectileEvents: projectileEvents,
    expiredProjectiles: frameEvents.expiredProjectiles,
    gameState: {
      playing: room.gameState.playing,
      round: room.gameState.round,
      roundTimeLeft: room.gameState.roundTimeLeft,
      frenzy: !!room.gameState.frenzy,
      leaderId: room.gameState.leaderId || null
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
      
      // NUEVO: Actualizar datos del usuario conectado
      connectedUsers.set(socket.id, {
        name: playerProfile.stats.name,
        roomId: roomId,
        playerId: playerProfile.playerId
      });
      
      const room = getRoom(roomId);
      if (!room) {
        socket.emit('gameError', 'Failed to create room');
        return;
      }
      
      const { canvasWidth, canvasHeight, segmentSize } = room.config;
      const spawnPos = getPlayerSpawnPosition(room, 0);
      const playerColor = getNextAvailableColor(room);
      const player = new Snake(socket.id, playerProfile.stats.name, segmentSize, canvasWidth, canvasHeight, spawnPos.x, spawnPos.y, 1, 0, playerColor, room.config.gameSpeed);
      player.playerId = playerProfile.playerId;
      room.players.push(player);
      resetPlayerForRound(room, player, room.players.length - 1);
      
      socket.emit('roomCreated', { 
        roomId, 
        isHost: true,
        config: room.config,
        playerProfile: playerProfile
      });
      io.to(roomId).emit('updatePlayers', serializePlayers(room.players), 
        { playing: room.gameState.playing, round: room.gameState.round }, 
        room.config, { host: room.host, roomId });
      
      // NUEVO: Enviar lista de jugadores en línea actualizadas
      broadcastOnlinePlayersList();
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
      
      // NUEVO: Actualizar datos del usuario conectado
      connectedUsers.set(socket.id, {
        name: playerProfile.stats.name,
        roomId: data.roomId,
        playerId: playerProfile.playerId
      });
      
      const { canvasWidth, canvasHeight, segmentSize } = room.config;
      const playerIndex = room.players.length;
      const spawnPos = getPlayerSpawnPosition(room, playerIndex);
      const playerColor = getNextAvailableColor(room);
      
      const player = new Snake(socket.id, playerProfile.stats.name, segmentSize, canvasWidth, canvasHeight, spawnPos.x, spawnPos.y, 1, 0, playerColor, room.config.gameSpeed);
      player.playerId = playerProfile.playerId;
      room.players.push(player);
      resetPlayerForRound(room, player, room.players.length - 1);
      
      socket.emit('roomJoined', { 
        roomId: data.roomId, 
        isHost: false,
        config: room.config,
        playerProfile: playerProfile
      });
      
      io.to(data.roomId).emit('updatePlayers', serializePlayers(room.players), 
        { playing: room.gameState.playing, round: room.gameState.round }, 
        room.config, { host: room.host, roomId: data.roomId });
      
      // NUEVO: Enviar lista de jugadores en línea actualizadas
      broadcastOnlinePlayersList();
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
    
    room.players.forEach((player, index) => resetPlayerForRound(room, player, index));
    
    resetGameBoard(room);
    generateFoods(room);
    initializeConsumableSystem(room); // Reinicializar sistema de consumibles
    updateGameBoard(room);
    
    io.to(currentRoom).emit('configUpdated', validConfig);
    io.to(currentRoom).emit('updatePlayers', serializePlayers(room.players), 
      { playing: room.gameState.playing, round: room.gameState.round }, 
      room.config, { host: room.host, roomId: currentRoom });
    // Los que miran la lista de salas en el lobby la vuelven a pedir y ven el nivel nuevo
    broadcastOnlinePlayersList();
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
    
    // La ronda 1 arranca igual que las siguientes: largo inicial y comida según jugadores
    room.players.forEach((player, index) => resetPlayerForRound(room, player, index));
    resetGameBoard(room);
    generateFoods(room);
    updateGameBoard(room);
    room.gameState.timeoutIdStartGame = setTimeout(() => startGame(room), 1000);
  });

  socket.on('attack', () => {
    if (!currentRoom) return;
    
    const room = getRoom(currentRoom);
    if (!room || !room.gameState.playing || !room.config.attacksEnabled) return;
    
    // Verificar que no sea un espectador
    if (room.spectators && room.spectators.has(socket.id)) return;
    
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.gameover) return;
    
    createProjectile(room, player);
  });

  socket.on('spectateRoom', async (data) => {
    try {
      const { roomId, spectatorName } = data;
      
      if (!roomId || roomId.length !== 6) {
        socket.emit('gameError', 'ID de sala inválido');
        return;
      }
      
      const room = getRoom(roomId);
      if (!room) {
        socket.emit('gameError', 'Sala no encontrada');
        return;
      }
      
      if (!room.gameState.playing) {
        socket.emit('gameError', 'La partida no está en progreso');
        return;
      }
      
      if (room.spectators && room.spectators.has(socket.id)) {
        socket.emit('gameError', 'Ya estás espectando esta sala');
        return;
      }
      
      // Verificar que no esté jugando en esta sala
      if (room.players.some(p => p.id === socket.id)) {
        socket.emit('gameError', 'Ya estás jugando en esta sala');
        return;
      }
      
      // Agregar como espectador
      const name = spectatorName || (connectedUsers.get(socket.id)?.name || 'Espectador');
      if (addSpectator(roomId, socket.id, name)) {
        socket.join(roomId);
        currentRoom = roomId;
        
        // Actualizar datos del usuario conectado
        const userData = connectedUsers.get(socket.id);
        if (userData) {
          userData.roomId = roomId;
        }
        
        // Serializar consumibles del config
        const serializedConsumables = {};
        if (room.config.consumables) {
          Object.keys(room.config.consumables).forEach(key => {
            const consumableConfig = room.config.consumables[key];
            if (consumableConfig && typeof consumableConfig === 'object') {
              serializedConsumables[key] = {
                enabled: Boolean(consumableConfig.enabled),
                spawnInterval: Number(consumableConfig.spawnInterval) || 5,
                duration: Number(consumableConfig.duration) || 5
              };
            }
          });
        }
        
        // Serializar players asegurando que no haya referencias circulares
        const serializedPlayers = room.players.map(player => {
          try {
            return {
              id: String(player.id),
              name: String(player.name),
              color: String(player.color),
              segments: player.segments ? player.segments.map(seg => ({
                x: Number(seg.x),
                y: Number(seg.y)
              })) : [],
              direction: player.direction ? {
                x: Number(player.direction.x),
                y: Number(player.direction.y)
              } : { x: 0, y: 0 },
              score: Number(player.score) || 0,
              gameover: Boolean(player.gameover),
              scoreLeftToGrow: Number(player.scoreLeftToGrow) || 0,
              effects: player.activeEffects(Date.now())
            };
          } catch (err) {
            console.error('Error serializing player:', err);
            return null;
          }
        }).filter(p => p !== null);
        
        // Enviar estado actual del juego
        socket.emit('spectatingStarted', {
          roomId: String(roomId),
          players: serializedPlayers,
          foods: room.foods ? room.foods.map(f => ({
            x: Number(f.x),
            y: Number(f.y),
            score: Number(f.score) || 1,
            type: f.type ? String(f.type) : undefined,
            remains: f.remains ? true : undefined,
            expiresAt: f.expiresAt ? Number(f.expiresAt) : undefined
          })) : [],
          consumables: room.consumables ? room.consumables.map(c => ({
            id: String(c.id),
            x: Number(c.x),
            y: Number(c.y),
            type: String(c.type),
            spawnTime: Number(c.spawnTime) || Date.now()
          })) : [],
          projectiles: room.projectiles ? room.projectiles.map(p => ({
            id: String(p.id),
            playerId: String(p.playerId),
            x: Number(p.x),
            y: Number(p.y),
            direction: {
              x: Number(p.direction.x),
              y: Number(p.direction.y)
            },
            color: String(p.color)
          })) : [],
          config: {
            maxPlayers: Number(room.config.maxPlayers) || 8,
            minPlayers: Number(room.config.minPlayers) || 2,
            gameSpeed: Number(room.config.gameSpeed) || 83,
            canvasWidth: Number(room.config.canvasWidth) || 768,
            canvasHeight: Number(room.config.canvasHeight) || 432,
            segmentSize: Number(room.config.segmentSize) || 20,
            attacksEnabled: Boolean(room.config.attacksEnabled),
            roundTime: Number(room.config.roundTime) || 60,
            difficulty: String(room.config.difficulty || 'medium'),
            projectileCells: Number(room.config.projectileCells) || 1,
            bigMouthReach: Number(room.config.bigMouthReach) || 0,
            consumables: serializedConsumables
          },
          gameState: {
            playing: Boolean(room.gameState.playing),
            round: Number(room.gameState.round) || 1,
            roundTimeLeft: Number(room.gameState.roundTimeLeft) || 60,
            frenzy: !!room.gameState.frenzy,
            leaderId: room.gameState.leaderId ? String(room.gameState.leaderId) : null
          },
          roundTimeLeft: Number(room.gameState.roundTimeLeft) || 60
        });
        
        // Notificar a los jugadores (opcional)
        io.to(roomId).emit('spectatorJoined', {
          spectatorName: name,
          spectatorCount: room.spectators.size
        });
        
        console.log(`${name} started spectating room ${roomId}`);
        
        // Actualizar lista de jugadores en línea
        broadcastOnlinePlayersList();
      } else {
        socket.emit('gameError', 'No se pudo unir como espectador');
      }
    } catch (error) {
      console.error('Error spectating room:', error);
      socket.emit('gameError', 'Error al unirse como espectador');
    }
  });

  socket.on('getRooms', () => {
    const availableRooms = Array.from(rooms.values())
      .filter(room => !room.finished)
      .map(room => ({
        id: room.id,
        hostName: room.hostName,
        players: room.players.length,
        maxPlayers: room.config.maxPlayers,
        playing: room.gameState.playing,
        config: {
          difficulty: room.config.difficulty,
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
    
    // Verificar que no sea un espectador
    if (room.spectators && room.spectators.has(socket.id)) return;
    
    const playerToMove = room.players.find(player => player.id === socket.id);
    if (!playerToMove || playerToMove.gameover) return;
    
    const directions = {
      37: { x: -1, y: 0 },
      39: { x: 1, y: 0 },
      38: { x: 0, y: -1 },
      40: { x: 0, y: 1 }
    };
    
    const newDirection = directions[data && data.key];
    if (newDirection) {
      playerToMove.changeDirection(newDirection);
    }
  });

  // Giro libre: el cliente pide un rumbo en radianes (flechas, joystick táctil o mando).
  // La serpiente gira hacia él en los próximos pasos, como mucho turnDegrees por paso.
  socket.on('steer', (data) => {
    if (!currentRoom) return;
    const room = getRoom(currentRoom);
    if (!room || !room.gameState.playing) return;
    if (room.spectators && room.spectators.has(socket.id)) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.gameover) return;
    player.steerTo(data && data.angle);
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
      
      // Mismo nombre ya conectado en otro socket. Si trae el mismo playerId es la misma sesión que
      // vuelve (reconexión tras un corte del lado del cliente: el socket viejo sigue registrado hasta
      // que vence el ping, unos 45 s) o la misma persona en otra pestaña: el socket nuevo toma la
      // sesión y el viejo se desconecta. Sin playerId (o con otro) sigue siendo un nombre ocupado.
      let replacedSocketId = null;
      let nameTaken = false;
      connectedUsers.forEach((userData, socketId) => {
        if (socketId === socket.id) return; // re-registro del mismo socket: idempotente
        if (userData.name.toLowerCase() !== username.toLowerCase()) return;
        if (data.playerId && userData.playerId === data.playerId) replacedSocketId = socketId;
        else nameTaken = true;
      });
      
      if (nameTaken) {
        socket.emit('profileError', `El usuario "${username}" ya está conectado. Intenta con otro nombre.`);
        return;
      }
      
      const playerProfile = await getOrCreatePlayer(username, data.playerId);
      
      if (replacedSocketId) {
        const oldSocket = io.sockets.sockets.get(replacedSocketId);
        connectedUsers.delete(replacedSocketId);
        if (oldSocket) {
          oldSocket.emit('sessionReplaced');
          // Su handler de 'disconnect' lo saca de la sala (handlePlayerLeaveRoom)
          oldSocket.disconnect(true);
        }
        console.log(`Session for "${username}" moved to socket ${socket.id}`);
      }
      
      // NUEVO: Registrar usuario conectado
      connectedUsers.set(socket.id, {
        name: playerProfile.stats.name,
        roomId: null,
        playerId: playerProfile.playerId
      });
      
      socket.emit('profileLoaded', playerProfile);
      
      // NUEVO: Enviar lista de jugadores en línea actualizadas
      broadcastOnlinePlayersList();
    } catch (error) {
      console.error('Error getting profile:', error);
      socket.emit('profileError', 'Error loading profile');
    }
  });

  // NUEVO: Obtener lista de jugadores en línea
  socket.on('getOnlinePlayers', () => {
    const userData = connectedUsers.get(socket.id);
    const currentRoomId = userData ? userData.roomId : null;
    const onlineList = getOnlinePlayersList(socket.id, currentRoomId);
    socket.emit('onlinePlayersList', onlineList);
  });

  // NUEVO: Enviar invitación a otro jugador
  socket.on('invitePlayer', (data) => {
    if (!data.targetSocketId || !currentRoom) {
      socket.emit('gameError', 'No se puede enviar la invitación');
      return;
    }
    
    const room = getRoom(currentRoom);
    if (!room || room.gameState.playing) {
      socket.emit('gameError', 'No puedes invitar durante el juego');
      return;
    }
    
    const inviterData = connectedUsers.get(socket.id);
    const targetData = connectedUsers.get(data.targetSocketId);
    
    if (!inviterData || !targetData) {
      socket.emit('gameError', 'Jugador no encontrado');
      return;
    }
    
    // Verificar que el objetivo no esté en una partida
    if (targetData.roomId) {
      const targetRoom = getRoom(targetData.roomId);
      if (targetRoom && targetRoom.gameState.playing) {
        socket.emit('gameError', `${targetData.name} está jugando actualmente`);
        return;
      }
    }
    
    // Enviar invitación
    io.to(data.targetSocketId).emit('invitationReceived', {
      fromPlayer: inviterData.name,
      roomId: currentRoom,
      fromSocketId: socket.id
    });
    
    // Confirmar al que invitó
    socket.emit('invitationSent', {
      toPlayer: targetData.name
    });
    
    console.log(`${inviterData.name} invited ${targetData.name} to room ${currentRoom}`);
  });

  socket.on('logout', (data) => {
    connectedUsers.delete(socket.id);
    
    if (currentRoom) {
      handlePlayerLeaveRoom(socket, currentRoom);
      currentRoom = null;
    }
    
    // NUEVO: Actualizar lista de jugadores en línea
    broadcastOnlinePlayersList();
  });

  function handlePlayerLeaveRoom(socket, roomId) {
    const room = getRoom(roomId);
    if (!room) return;
    
    // Remover espectadores
    if (room.spectators && room.spectators.has(socket.id)) {
      room.spectators.delete(socket.id);
      socket.leave(roomId);
      
      // Actualizar datos del usuario
      const userData = connectedUsers.get(socket.id);
      if (userData) {
        userData.roomId = null;
      }
      
      // Notificar a la sala
      io.to(roomId).emit('spectatorLeft', {
        spectatorCount: room.spectators.size
      });
      
      broadcastOnlinePlayersList();
      return;
    }
    
    const playerIndex = room.players.findIndex(player => player.id === socket.id);
    if (playerIndex !== -1) {
      const playerName = room.players[playerIndex].name;
      room.players.splice(playerIndex, 1);
      console.log(`Player "${playerName}" left room ${roomId}`);
      // Sale antes de los emits: quien se va (logout, volver al menú) no recibe el estado de la sala
      // que abandona, ni el aviso de partida cortada
      socket.leave(roomId);
      
      room.projectiles = room.projectiles.filter(p => p.playerId !== socket.id);
      if (room.pendingProjectileEvents) {
        room.pendingProjectileEvents = room.pendingProjectileEvents.filter(e => e.playerId !== socket.id);
      }
      
      // NUEVO: Actualizar datos del usuario (ya no está en sala)
      const userData = connectedUsers.get(socket.id);
      if (userData) {
        userData.roomId = null;
      }
      
      if (room.host === socket.id) {
        if (room.players.length > 0) {
          room.host = room.players[0].id;
          room.hostName = room.players[0].name;
          io.to(roomId).emit('newHost', { hostId: room.host, hostName: room.hostName });
        } else {
          deleteRoom(roomId);
          // NUEVO: Actualizar lista de jugadores en línea
          broadcastOnlinePlayersList();
          return;
        }
      }
      
      if (room.players.length < room.config.minPlayers && room.gameState.playing) {
        // Partida en curso (ronda, pausa entre rondas o su cuenta regresiva): se corta y la sala
        // vuelve a espera. abortMatch cancela también el timeout de la ronda siguiente.
        abortMatch(room);
        return;
      }
      
      io.to(roomId).emit('updatePlayers', serializePlayers(room.players), 
        { playing: room.gameState.playing, round: room.gameState.round }, 
        room.config, { host: room.host, roomId });
      
      if (room.players.length < room.config.minPlayers && room.gameState.timeoutIdStartGame) {
        clearTimeout(room.gameState.timeoutIdStartGame);
        room.gameState.timeoutIdStartGame = null;
        room.gameState.downCounter = 3;
      }
      
      // NUEVO: Actualizar lista de jugadores en línea
      broadcastOnlinePlayersList();
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
      // Salir de verdad: un espectador deja room.spectators (si no, al volver a mirar la misma sala
      // recibía "Ya estás espectando") y un jugador deja room.players (en espera o en partida).
      handlePlayerLeaveRoom(socket, currentRoom);
      
      // NUEVO: Actualizar datos del usuario (ya no está en sala)
      const userData = connectedUsers.get(socket.id);
      if (userData) {
        userData.roomId = null;
      }
      
      socket.leave(currentRoom);
      currentRoom = null;
      
      // NUEVO: Actualizar lista de jugadores en línea
      broadcastOnlinePlayersList();
    }
    socket.emit('backToMenuSuccess');
  });

  socket.on('disconnect', () => {
    connectedUsers.delete(socket.id);
    
    if (!currentRoom) {
      // NUEVO: Actualizar lista de jugadores en línea
      broadcastOnlinePlayersList();
      return;
    }
    
    // Limpiar espectadores o jugadores
    handlePlayerLeaveRoom(socket, currentRoom);
    
    // Limpiar referencia de currentRoom
    currentRoom = null;
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
  // Precompresión en segundo plano: no demora el arranque (Fly apaga la máquina sin jugadores)
  assets.warm().catch(error => console.error('Error compressing assets:', error));
});