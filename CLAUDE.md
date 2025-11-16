# CLAUDE.md - Snake Multiplayer Development Guide

This document provides AI assistants with comprehensive context about the Snake Multiplayer codebase, its architecture, conventions, and development workflows.

---

## Table of Contents
1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [File Structure](#file-structure)
4. [Development Workflow](#development-workflow)
5. [Key Design Patterns](#key-design-patterns)
6. [Backend Architecture](#backend-architecture)
7. [Frontend Architecture](#frontend-architecture)
8. [Common Modification Patterns](#common-modification-patterns)
9. [Important Gotchas](#important-gotchas)
10. [Testing Strategy](#testing-strategy)
11. [Deployment](#deployment)

---

## Project Overview

**Snake Multiplayer** is a real-time multiplayer Snake game built with vanilla JavaScript, Socket.IO, and SQLite. It features:

- **Real-time gameplay**: Up to 16 players per room with low-latency synchronization
- **Round-based scoring**: 3 rounds of 60 seconds each, winner determined by total score
- **Combat mechanics**: Projectile attacks that reduce opponent size
- **Consumable system**: Power-ups like immunity with configurable spawn rates
- **Persistent stats**: SQLite database tracking player statistics and rankings
- **Spectator mode**: Join ongoing games as an observer
- **Room system**: Private rooms with unique 6-character codes

### Technology Stack
- **Backend**: Node.js (>=14.0.0) + Express + Socket.IO 4.7.1
- **Database**: SQLite 3.5.1.7
- **Frontend**: Vanilla JavaScript + Canvas API + CSS3
- **Deployment**: Fly.io with persistent volume for database
- **Dev Tools**: Nodemon for auto-reload

### Key Characteristics
- **No build process**: Direct JavaScript files, no bundling/transpilation
- **Minimal dependencies**: Only 3 production dependencies
- **Shared code**: `snakeClass.js` runs on both client and server
- **Server-authoritative**: All game logic validated on backend
- **Interpolation-based rendering**: Smooth visuals despite discrete server updates

---

## Architecture

### High-Level Flow
```
Player Browser → Socket.IO → Express Server → SQLite DB
                    ↓
              Game Loop (83ms default)
                    ↓
         State Broadcast → Clients
                    ↓
           Interpolated Rendering
```

### Client-Server Synchronization Model

**Server (Authoritative)**:
- Processes all inputs in `gameLogicLoop()`
- Validates collisions, combat, food consumption
- Broadcasts canonical state every game tick
- Manages timers for rounds, consumables, cleanup

**Client (Predictive)**:
- Queues player inputs (max 3 moves buffered)
- Predicts local movement for responsiveness
- Receives authoritative state from server
- Interpolates between states for smooth rendering
- Reconciles differences automatically

### Data Flow for Player Movement
```
1. Player presses arrow key
2. Client: Snake.changeDirection() → adds to moveQueue
3. Client: Emits socket.emit('newMove', direction)
4. Server: Receives in gameLogicLoop()
5. Server: Updates player.moveQueue
6. Server: Calls player.processNextMove()
7. Server: Broadcasts 'gameLogicFrame' with new positions
8. Client: Updates snake.targetSegments
9. Client: Interpolates snake.renderSegments (every frame)
10. Client: Renders smooth animation
```

---

## File Structure

```
Snake-Multiplayer/
├── index.js                 # Backend server (1677 lines)
│   ├── Express + Socket.IO setup
│   ├── SQLite database operations
│   ├── Room management (create, join, cleanup)
│   ├── Game loop and round system
│   ├── Projectile and consumable logic
│   └── Socket event handlers
│
├── public/
│   ├── index.html           # Complete UI (1293 lines)
│   │   ├── Inline CSS (retro-cyberpunk theme)
│   │   ├── Profile/login view
│   │   ├── Room selection/creation
│   │   ├── Game interface (3 panels)
│   │   └── Modals (leaderboard, final scores)
│   │
│   ├── SnakeGame.js         # Client game logic (1984 lines)
│   │   ├── Socket.IO event handlers
│   │   ├── Canvas rendering system
│   │   ├── UI state management
│   │   ├── Notification system
│   │   └── Player invitation system
│   │
│   └── snakeClass.js        # Snake entity (347 lines)
│       ├── Movement logic (client prediction + server authority)
│       ├── Interpolation system
│       ├── Consumable management
│       ├── Attack mechanics
│       └── Collision detection (server-side)
│
├── package.json             # Dependencies and scripts
├── fly.toml                # Fly.io deployment config
├── Dockerfile              # Multi-stage container build
├── .gitignore
└── game_stats.db           # SQLite database (auto-generated)
```

### File Modification Frequency
- **index.js**: 🔥 Most backend changes (game logic, events, scoring)
- **SnakeGame.js**: 🔥 Most frontend changes (rendering, UI, client logic)
- **snakeClass.js**: 🔶 Only for snake behavior changes
- **index.html**: 🔶 UI structure and styling
- **package.json**: ❄️ Rarely (dependency updates)
- **fly.toml/Dockerfile**: ❄️ Very rarely (infrastructure)

---

## Development Workflow

### Local Development Setup
```bash
# Clone and install
git clone https://github.com/marto993/Snake-Multiplayer.git
cd Snake-Multiplayer
npm install

# Development (auto-restart on changes)
npm run dev

# Production mode
npm start
```

### Testing Locally
Since there are no automated tests, use manual testing:

1. **Single player testing**: Open `http://localhost:3000`
2. **Multiplayer testing**: Open multiple browser tabs/windows
3. **Cross-device testing**: Use different browsers or devices on same network
4. **Spectator mode**: Join a room that's already in-progress
5. **Database testing**: Check `game_stats.db` with SQLite browser

### Development Tips

**Hot Reload Behavior:**
- Client files (HTML, JS, CSS): Browser refresh required
- Server file (index.js): Nodemon auto-restarts, clients disconnect
- Database: Persists across restarts

**Debugging:**
- Server: Console logs in terminal
- Client: Browser DevTools console
- Socket events: Monitor in Network tab (WS)
- Database: `sqlite3 game_stats.db` then `.schema` or `SELECT * FROM players;`

**Multi-Tab Testing:**
- Use incognito/private windows for different players
- Each tab needs unique username
- Test host migration by closing host tab
- Test spectator by joining mid-game

---

## Key Design Patterns

### Naming Conventions

**Variables & Functions:**
```javascript
// camelCase for most identifiers
let playerCount, gameSpeed, roomConfig
function getPlayerSpawnPosition() {}
function updatePlayerStats() {}

// PascalCase for classes
class Snake {}
class CanvasNotification {}
class ClientProjectile {}

// SCREAMING_SNAKE_CASE for constants
const PLAYER_COLORS = [...]
const MAX_PLAYERS = 16
```

**Socket Events:** (lowercase, descriptive)
```javascript
// Client → Server
'createRoom', 'joinRoom', 'newMove', 'attack'

// Server → Client
'gameLogicFrame', 'roundEnd', 'gameEnd', 'updatePlayers'

// Bidirectional
'spectateRoom', 'updateRoomConfig'
```

### Code Organization Patterns

**Server (index.js):**
```javascript
// 1. Imports and setup
const express = require('express');
const sqlite3 = require('sqlite3');

// 2. Database initialization
db.run(`CREATE TABLE IF NOT EXISTS...`);

// 3. Utility functions
function validateRoomConfig(config) {}
function getPlayerSpawnPosition(room) {}

// 4. Core game logic
function gameLogicLoop(roomId) {}
function endRound(roomId) {}

// 5. Socket.IO connection handler
io.on('connection', (socket) => {
  socket.on('createRoom', async (data) => {});
  socket.on('joinRoom', (data) => {});
  // ... all events in one connection handler
});

// 6. Server startup
server.listen(PORT);
```

**Client (SnakeGame.js):**
```javascript
// 1. Constants and state
const canvas = document.getElementById('canvas');
let currentPlayer, room, players = [];

// 2. Notification system
class CanvasNotification {}
function addCanvasNotification() {}

// 3. Socket event handlers
socket.on('roomCreated', (data) => {});
socket.on('gameLogicFrame', (data) => {});

// 4. UI update functions
function updatePlayersList() {}
function showGameInterface() {}

// 5. Rendering functions
function gameLoop() {}
function drawPlayers() {}

// 6. Event listeners (at bottom)
document.getElementById('createRoomBtn').addEventListener('click', () => {});
```

### State Management

**Server State (Centralized in `rooms` Map):**
```javascript
const rooms = new Map();

// Each room is self-contained
rooms.set(roomId, {
  id, host, players, gameState, config,
  gameboard, foods, consumables, projectiles,
  roundScores, consumableTimers, spectators
});

// No global player state - players exist only within rooms
```

**Client State (Module-scope variables):**
```javascript
// No state management library
let currentPlayer = null;
let room = null;
let players = [];
let foods = [];

// Direct DOM manipulation
function showElement(id) {
  document.getElementById(id).style.display = 'block';
}

// Event-driven updates
socket.on('updatePlayers', (data) => {
  players = data.players.map(p => new Snake(p));
});
```

### Error Handling Pattern

**Server:**
```javascript
socket.on('someEvent', async (data) => {
  try {
    // 1. Validation
    if (!data.username || data.username.length < 2) {
      socket.emit('gameError', 'Username must be 2-20 characters');
      return;
    }

    // 2. Business logic
    const result = await someOperation();

    // 3. Success response
    socket.emit('success', result);

  } catch (error) {
    console.error('Error in someEvent:', error);
    socket.emit('gameError', 'An error occurred');
  }
});
```

**Client:**
```javascript
socket.on('gameError', (message) => {
  addCanvasNotification(message, 'error');
  // User sees in-game toast notification
});
```

---

## Backend Architecture

### Core Data Structures

#### Room Object
```javascript
{
  id: string,                    // 6-char code (e.g., "A3B7K2")
  host: string,                  // Socket ID of room host
  hostName: string,              // Display name of host
  players: Array<Snake>,         // Active players
  finished: boolean,             // Game completed flag

  gameState: {
    playing: boolean,            // Currently in round
    round: number,               // Current round (1-3)
    downCounter: number,         // Countdown before start (always 3)
    intervalId: NodeJS.Timer,    // Game loop interval
    roundTimeLeft: number,       // Seconds remaining in round
    roundTimerId: NodeJS.Timer   // Round countdown interval
  },

  config: {
    maxPlayers: number,          // 2-16
    minPlayers: number,          // 2-16
    gameSpeed: number,           // 40-200ms
    segmentSize: number,         // 5-25px
    consumables: {
      immunity: {
        enabled: boolean,
        spawnInterval: number,   // 3-30s
        duration: number         // 3-15s
      }
    }
  },

  gameboard: number[][],         // 2D grid (0=empty, 1=snake, 2=food, 3=consumable)
  foods: [{x, y, score}, ...],
  consumables: [{id, x, y, type, spawnTime}, ...],
  projectiles: [{id, playerId, x, y, direction, color}, ...],

  roundScores: {
    [playerId]: {
      name: string,
      totalScore: number,
      roundWins: number
    }
  },

  consumableTimers: {
    [type]: NodeJS.Timer
  },

  spectators: Map<socketId, {name, joinedAt}>
}
```

#### Database Schema
```sql
CREATE TABLE players (
  id TEXT PRIMARY KEY,           -- Format: "username_timestamp"
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
)
```

### Socket.IO Events Reference

| Event | Direction | Payload | Response | Description |
|-------|-----------|---------|----------|-------------|
| `createRoom` | C→S | `{username, roomConfig}` | `roomCreated` | Host creates new room |
| `joinRoom` | C→S | `{roomId, username}` | `roomJoined` or `gameError` | Player joins lobby |
| `spectateRoom` | C→S | `{roomId, username}` | `spectatorJoined` | Join as spectator mid-game |
| `updateRoomConfig` | C→S | `{roomId, config}` | `configUpdated` | Host changes settings |
| `startGame` | C→S | `{roomId}` | `gameStart` | Host starts countdown |
| `newMove` | C→S | `{direction}` | (none) | Player movement input |
| `attack` | C→S | (none) | (none) | Fire projectile |
| `invitePlayer` | C→S | `{targetSocketId, roomId}` | `invitation` (to target) | Send room invite |
| `getOnlinePlayers` | C→S | (none) | `onlinePlayersList` | Request connected players |
| `roomCreated` | S→C | `{room, playerId}` | - | Confirmation with room data |
| `roomJoined` | S→C | `{room, playerId}` | - | Successfully joined |
| `updatePlayers` | S→C | `{players}` | - | Player list changed |
| `gameStart` | S→C | `{room, currentPlayer}` | - | Round starting |
| `gameLogicFrame` | S→C | Full game state | - | State update (~12 FPS) |
| `roundEnd` | S→C | `{roundWinner, scores}` | - | Round finished |
| `gameEnd` | S→C | `{finalScores}` | - | Game complete |
| `gameError` | S→C | `{message}` | - | Error notification |

### Game Loop System

**Round-Based Flow:**
```
User clicks "Start"
  ↓
startGame() - emits 'gameStart'
  ↓
3-second countdown (visual only)
  ↓
gameLogicLoop() starts - setInterval at config.gameSpeed (default 83ms)
  │  ├── Process player moveQueues
  │  ├── Update projectiles
  │  ├── Check collisions
  │  ├── Update consumables
  │  └── Broadcast 'gameLogicFrame'
  ↓
roundTimer counts down from 60s
  ↓
endRound() - emits 'roundEnd'
  ↓
If round < 3: startNewRound() after 5s
If round = 3: endGame() - emits 'gameEnd'
  ↓
Room marked finished, deleted after 30s
```

**Fixed Constants (Not Configurable):**
```javascript
maxRounds: 3           // Always 3 rounds per game
roundTime: 60          // Always 60 seconds per round
downCounter: 3         // Always 3 second countdown
canvasWidth: 600       // Fixed canvas dimensions
canvasHeight: 600
attacksEnabled: true   // Always enabled
```

### Scoring System

**Score Calculation:**
```javascript
// During game: score = snake length
player.score = player.segments.length;

// At round end:
roundScores[playerId].totalScore += snakeLength;
if (player === roundWinner) {
  roundScores[playerId].roundWins++;
}

// Game winner: highest total score across all rounds
const winner = Object.entries(roundScores)
  .sort((a, b) => b[1].totalScore - a[1].totalScore)[0];
```

**Database Updates (at game end):**
```javascript
updatePlayerStats(playerId, {
  finalScore: totalScore,      // Score from this game
  roundsWon: numberOfRoundsWon,
  won: boolean                 // true if highest total
});

// Updates these fields:
// - games_played += 1
// - wins += (won ? 1 : 0)
// - total_score += finalScore
// - best_score = max(best_score, finalScore)
// - rounds_won += roundsWon
// - current_streak = (won ? current_streak + 1 : 0)
// - best_streak = max(best_streak, current_streak)
// - last_played = now
```

### Projectile System

**Attack Mechanics:**
```javascript
// Requirements to attack:
if (snake.segments.length < 2) return; // Need at least 2 segments

// Cost: remove 1 segment from tail
snake.segments.pop();

// Create projectile
projectiles.push({
  id: generateId(),
  playerId: socket.id,
  x: headX + direction.x,
  y: headY + direction.y,
  direction: {x, y},
  color: player.color
});

// Movement: same speed as game loop
projectile.x += projectile.direction.x;
projectile.y += projectile.direction.y;

// Damage on hit:
if (hitHead) {
  // Remove 3 segments
  target.segments = target.segments.slice(0, -3);
} else if (hitBody) {
  // Cut snake at impact point
  target.segments = target.segments.slice(0, hitIndex);
}

// Immunity blocks 1 hit:
if (target.hasImmunity()) {
  target.useImmunity();
  // Projectile destroyed, no damage
}
```

### Consumable System

**Timer-Based Spawning:**
```javascript
// Initialize timers for each consumable type
function initializeConsumableSystem(room) {
  const immunityConfig = room.config.consumables.immunity;

  if (immunityConfig.enabled) {
    room.consumableTimers.immunity = setInterval(() => {
      const maxConsumables = Math.max(3, room.players.length + 1);
      const currentCount = room.consumables.filter(c => c.type === 'immunity').length;

      if (currentCount < maxConsumables) {
        spawnConsumable(room, 'immunity');
      }
    }, immunityConfig.spawnInterval * 1000);
  }
}
```

**Immunity Consumable:**
- **Effect**: Blocks exactly 1 projectile hit
- **Duration**: Configurable (default 5s), but immunity persists until used or timer expires
- **Visual**: Blue glow effect on client
- **Implementation**:
  ```javascript
  snake.activeConsumable = {
    type: 'immunity',
    endTime: Date.now() + duration * 1000
  };
  ```

### Room Management

**ID Generation:**
```javascript
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
  // Example output: "A3B7K2", "XZ9W4M"
}
```

**Host Migration:**
```javascript
// On host disconnect
socket.on('disconnect', () => {
  const room = findRoomBySocketId(socket.id);
  if (room && room.host === socket.id) {
    if (room.players.length > 0) {
      // First remaining player becomes host
      room.host = room.players[0].id;
      room.hostName = room.players[0].name;
      io.to(room.id).emit('newHost', {
        hostId: room.host,
        hostName: room.hostName
      });
    } else {
      // No players left, delete room
      deleteRoom(room.id);
    }
  }
});
```

**Room Cleanup:**
```javascript
// After game ends
function endGame(roomId) {
  // ... update stats, emit gameEnd ...

  room.finished = true;

  // Delete room after 30 seconds
  setTimeout(() => {
    deleteRoom(roomId);
  }, 30000);
}

function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Clear all timers
  clearInterval(room.gameState.intervalId);
  clearInterval(room.gameState.roundTimerId);
  Object.values(room.consumableTimers).forEach(timer => clearInterval(timer));

  rooms.delete(roomId);
}
```

---

## Frontend Architecture

### SnakeGame.js - Main Client Logic

**Key Responsibilities:**

1. **Socket.IO Communication**
   ```javascript
   const socket = io();  // Auto-connects to same origin

   // Emit player actions
   socket.emit('createRoom', {username, roomConfig});
   socket.emit('newMove', direction);
   socket.emit('attack');

   // Receive state updates
   socket.on('gameLogicFrame', updateGameState);
   socket.on('roundEnd', showRoundResults);
   ```

2. **Rendering System**
   ```javascript
   function gameLoop() {
     requestAnimationFrame(gameLoop);

     // Clear canvases
     ctx.clearRect(0, 0, canvas.width, canvas.height);
     infoCtx.clearRect(0, 0, infoCanvas.width, infoCanvas.height);

     // Update interpolations
     players.forEach(p => p.updateRenderPosition());

     // Render
     drawGrid();
     drawFoods();
     drawConsumables();
     drawPlayers();
     drawProjectiles();
     drawNotifications();
     drawInfoCanvas();  // Round info, timer, scores
   }
   ```

3. **UI State Management**
   ```javascript
   // View states
   function showProfileView() {
     hideElement('gameInterface');
     hideElement('roomSelectionView');
     showElement('profileView');
   }

   function showGameInterface() {
     hideElement('profileView');
     hideElement('roomSelectionView');
     showElement('gameInterface');
   }
   ```

4. **Notification System**
   ```javascript
   class CanvasNotification {
     constructor(message, type) {
       this.message = message;
       this.type = type;  // 'info', 'success', 'error', 'invitation'
       this.phase = 'entering';
       this.phaseProgress = 0;
       this.totalDuration = 3000;
     }

     update(deltaTime) {
       // entering (300ms) → showing → exiting (300ms)
       // Uses easing functions for smooth animation
     }
   }

   // Usage
   addCanvasNotification('Player joined!', 'success');
   ```

5. **Player Invitation System**
   ```javascript
   // Fetch online players
   socket.emit('getOnlinePlayers');

   socket.on('onlinePlayersList', (players) => {
     players.forEach(player => {
       const status = player.inGame ? 'In game' : 'Available';
       // Render in sidebar
     });
   });

   // Send invitation
   function invitePlayer(socketId) {
     socket.emit('invitePlayer', {
       targetSocketId: socketId,
       roomId: room.id
     });
   }
   ```

### snakeClass.js - Snake Entity

**Key Properties:**
```javascript
class Snake {
  constructor(data) {
    this.id = data.id;                    // Socket ID
    this.name = data.name;
    this.color = data.color;              // From PLAYER_COLORS

    // Position arrays
    this.segments = data.segments;        // Current positions [{x, y}, ...]
    this.targetSegments = [...segments];  // Server authority
    this.renderSegments = [...segments];  // Interpolated for smooth display

    // Movement
    this.direction = data.direction;      // Current {x, y}
    this.moveQueue = [];                  // Buffered inputs (max 3)

    // Game state
    this.score = data.score;              // Snake length
    this.scoreLeftToGrow = 0;             // Pending growth
    this.gameover = data.gameover || false;

    // Consumables
    this.activeConsumable = null;         // {type, endTime}

    // Rendering
    this.interpolationSpeed = 0.15;       // Auto-calculated
    this.playerId = data.playerId;        // Database ID
  }
}
```

**Critical Methods:**

```javascript
// Client-side prediction
move() {
  const head = this.segments[0];
  const newHead = {
    x: head.x + this.direction.x,
    y: head.y + this.direction.y
  };

  // Portal wraparound
  if (newHead.x < 0) newHead.x = canvasWidth - 1;
  if (newHead.x >= canvasWidth) newHead.x = 0;

  this.segments.unshift(newHead);

  // Grow or maintain length
  if (this.scoreLeftToGrow > 0) {
    this.scoreLeftToGrow--;
  } else {
    this.segments.pop();
  }
}

// Server-side authority
moveLogic(gameboard) {
  // Same as move() but checks collisions
  // Returns {collided, consumableEaten}
}

// Input buffering
changeDirection(newDir) {
  // Prevent 180° turns
  const opposite =
    (newDir.x === -this.direction.x && newDir.y === -this.direction.y);
  if (opposite) return;

  // Queue up to 3 moves
  if (this.moveQueue.length < 3) {
    this.moveQueue.push(newDir);
  }
}

// Smooth rendering
updateRenderPosition() {
  for (let i = 0; i < this.segments.length; i++) {
    const target = this.targetSegments[i] || this.segments[i];
    const current = this.renderSegments[i];

    // Detect portal teleports (large jumps)
    const dx = Math.abs(target.x - current.x);
    const dy = Math.abs(target.y - current.y);
    if (dx > canvasWidth / 2 || dy > canvasHeight / 2) {
      // Instant snap, no interpolation
      this.renderSegments[i] = {...target};
    } else {
      // Lerp interpolation
      current.x += (target.x - current.x) * this.interpolationSpeed;
      current.y += (target.y - current.y) * this.interpolationSpeed;
    }
  }
}

// Attack
attack() {
  if (this.segments.length < 2) return false;
  this.segments.pop();  // Cost: 1 segment
  return true;
}

// Consumables
consumeConsumable(type, duration) {
  this.activeConsumable = {
    type: type,
    endTime: Date.now() + duration * 1000
  };
}

hasImmunity() {
  return this.activeConsumable?.type === 'immunity' &&
         Date.now() < this.activeConsumable.endTime;
}

useImmunity() {
  this.activeConsumable = null;  // Consumed on hit
}
```

**Interpolation System:**

The client renders at ~60 FPS while server updates at ~12 FPS (83ms default). Interpolation creates smooth motion:

```javascript
// Automatic speed calculation based on game speed
function calculateInterpolationSpeed(gameSpeed) {
  // gameSpeed range: 25-200ms
  // Slower game = faster interpolation needed
  return Math.max(0.08, Math.min(0.3, 25 / gameSpeed));
}

// Every frame:
players.forEach(player => {
  player.updateRenderPosition();  // Lerps renderSegments toward targetSegments
});

// Every ~83ms:
socket.on('gameLogicFrame', (data) => {
  players.forEach(player => {
    const serverPlayer = data.players.find(p => p.id === player.id);
    player.targetSegments = serverPlayer.segments;  // New target
  });
});
```

### Rendering Pipeline

**Canvas Setup:**
```javascript
// Two canvases
const infoCanvas = document.getElementById('infoCanvas');  // Top panel
const canvas = document.getElementById('canvas');          // Main game

const infoCtx = infoCanvas.getContext('2d');
const ctx = canvas.getContext('2d');

// Retro styling
ctx.font = '12px "Share Tech Mono"';
ctx.imageSmoothingEnabled = false;  // Crisp pixels
```

**Rendering Order:**
```javascript
function gameLoop() {
  // 1. Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 2. Background grid
  drawGrid();

  // 3. Foods (purple glow)
  drawFoods();

  // 4. Consumables (blue glow)
  drawConsumables();

  // 5. Snakes (with names)
  drawPlayers();

  // 6. Projectiles (yellow)
  drawProjectiles();

  // 7. Notifications (top layer)
  drawNotifications();

  // 8. Info panel (separate canvas)
  drawInfoCanvas();
}
```

**Visual Effects:**
```javascript
// Glow effect
function drawRetroGlow(x, y, size, color, glowColor) {
  // Outer glow
  ctx.shadowBlur = 20;
  ctx.shadowColor = glowColor;
  ctx.fillStyle = color;
  ctx.fillRect(x, y, size, size);

  // Reset shadow
  ctx.shadowBlur = 0;
}

// Pulse animation
function getPulseIntensity() {
  return 0.5 + Math.sin(Date.now() / 200) * 0.5;  // 0-1 range
}
```

### UI State Flow

```
Page Load
  ↓
Profile View (login/stats)
  ↓ [Create Room / Join Room]
  ↓
Room Selection View (lobby)
  ↓ [Host clicks Start]
  ↓
Game Interface
  │ [Left Panel: Profile + Online Players]
  │ [Center: Info Canvas + Game Canvas]
  │ [Right Panel: Room Config + Player List]
  ↓ [Game ends]
  ↓
Final Scores Modal
  ↓ [Close modal]
  ↓
Back to Profile View
```

---

## Common Modification Patterns

### Adding a New Consumable Type

**1. Server (index.js):**
```javascript
// Add to room config validation
function validateRoomConfig(config) {
  // ...existing code...

  config.consumables.speed = {
    enabled: config.consumables.speed?.enabled ?? true,
    spawnInterval: Math.max(3, Math.min(30, config.consumables.speed?.spawnInterval ?? 8)),
    duration: Math.max(3, Math.min(15, config.consumables.speed?.duration ?? 5))
  };

  return config;
}

// Add spawning logic
function initializeConsumableSystem(room) {
  // ...existing immunity code...

  const speedConfig = room.config.consumables.speed;
  if (speedConfig.enabled) {
    room.consumableTimers.speed = setInterval(() => {
      const maxConsumables = Math.max(2, room.players.length);
      const currentCount = room.consumables.filter(c => c.type === 'speed').length;
      if (currentCount < maxConsumables) {
        spawnConsumable(room, 'speed');
      }
    }, speedConfig.spawnInterval * 1000);
  }
}

// Add consumption effect in gameLogicLoop
if (consumable.type === 'speed') {
  player.consumeConsumable('speed', room.config.consumables.speed.duration);
  // Optionally modify player.interpolationSpeed or game logic
}
```

**2. Snake Class (snakeClass.js):**
```javascript
consumeConsumable(type, duration) {
  this.activeConsumable = {
    type: type,
    endTime: Date.now() + duration * 1000
  };

  // Type-specific setup
  if (type === 'speed') {
    this.speedMultiplier = 1.5;
  }
}

// Add cleanup in move/moveLogic
if (this.activeConsumable && Date.now() >= this.activeConsumable.endTime) {
  if (this.activeConsumable.type === 'speed') {
    this.speedMultiplier = 1.0;
  }
  this.activeConsumable = null;
}
```

**3. Client (SnakeGame.js):**
```javascript
// Add visual styling
const consumableStyles = {
  // ...existing...
  speed: {
    color: '#fbbf24',      // Yellow
    glowColor: '#fcd34d',
    symbol: '⚡'
  }
};

// Rendering already handles it via consumableStyles lookup
```

**4. UI (index.html):**
```html
<!-- Add configuration controls -->
<div class="config-item">
  <div class="config-header">
    <span>⚡ Speed Boost</span>
    <label class="switch">
      <input type="checkbox" id="speedEnabled" checked>
      <span class="slider"></span>
    </label>
  </div>
  <div class="config-details">
    <label>
      Spawn Interval: <span id="speedIntervalValue">8</span>s
      <input type="range" id="speedInterval" min="3" max="30" value="8">
    </label>
    <label>
      Duration: <span id="speedDurationValue">5</span>s
      <input type="range" id="speedDuration" min="3" max="15" value="5">
    </label>
  </div>
</div>
```

### Modifying Game Rules

**Change round duration:**
```javascript
// index.js - validateRoomConfig()
// Currently hardcoded:
config.roundTime = 60;

// To make configurable:
config.roundTime = Math.max(30, Math.min(120, config.roundTime ?? 60));

// Then update UI in index.html
```

**Change projectile damage:**
```javascript
// index.js - gameLogicLoop() - projectile collision section

// Current:
if (isHead) {
  const segmentsToRemove = 3;
  hit.segments = hit.segments.slice(0, -segmentsToRemove);
}

// Modify to:
if (isHead) {
  const segmentsToRemove = 5;  // More damage
  hit.segments = hit.segments.slice(0, -segmentsToRemove);
}
```

**Change food spawning:**
```javascript
// index.js - getInitialFoodPositions()

// Current:
const foodCount = numPlayers === 2 ? 7 : numPlayers + 5;

// Modify to:
const foodCount = numPlayers * 3;  // More food
```

### Adding a New Socket Event

**1. Define event on server:**
```javascript
// index.js
io.on('connection', (socket) => {
  // ...existing events...

  socket.on('requestPowerUp', (data) => {
    try {
      const room = rooms.get(data.roomId);
      if (!room) {
        socket.emit('gameError', 'Room not found');
        return;
      }

      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;

      // Grant power-up
      player.consumeConsumable('powerup', 10);

      // Broadcast to room
      io.to(data.roomId).emit('powerUpGranted', {
        playerId: socket.id,
        playerName: player.name
      });

    } catch (error) {
      console.error('Error in requestPowerUp:', error);
      socket.emit('gameError', 'Failed to grant power-up');
    }
  });
});
```

**2. Add client handler:**
```javascript
// SnakeGame.js

// Emit from client
function usePowerUp() {
  socket.emit('requestPowerUp', {roomId: room.id});
}

// Listen for response
socket.on('powerUpGranted', (data) => {
  addCanvasNotification(`${data.playerName} used a power-up!`, 'info');
});
```

### Changing Visual Style

**Modify retro theme colors:**
```javascript
// SnakeGame.js
const retroColors = {
  background: '#010409',  // Change to '#1a1a2e' for blue-ish
  grid: '#161b22',        // Grid line color
  text: '#c9d1d9',        // Primary text
  accent: '#58a6ff',      // Accent color
  food: '#a371f7',        // Food color
  foodGlow: '#c084fc'     // Food glow
};
```

**Change font:**
```html
<!-- index.html -->
<style>
  @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap');

  body {
    font-family: 'Orbitron', monospace;  /* Changed from Share Tech Mono */
  }
</style>
```

### Adding Database Fields

**1. Update schema:**
```javascript
// index.js - database initialization
db.run(`CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- ...existing fields...
  projectiles_fired INTEGER DEFAULT 0,  -- NEW
  hits_landed INTEGER DEFAULT 0,        -- NEW
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_played DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Or add column if table exists
db.run(`ALTER TABLE players ADD COLUMN projectiles_fired INTEGER DEFAULT 0`);
```

**2. Update tracking:**
```javascript
// Track in game loop
socket.on('attack', () => {
  // ...existing attack code...

  // Track stat
  if (!room.playerStats) room.playerStats = {};
  if (!room.playerStats[socket.id]) room.playerStats[socket.id] = {};
  room.playerStats[socket.id].projectilesFired =
    (room.playerStats[socket.id].projectilesFired || 0) + 1;
});

// Update database at game end
function endGame(roomId) {
  // ...existing code...

  players.forEach(player => {
    const stats = room.playerStats[player.id] || {};
    db.run(`UPDATE players
            SET projectiles_fired = projectiles_fired + ?
            WHERE id = ?`,
      [stats.projectilesFired || 0, player.playerId]
    );
  });
}
```

---

## Important Gotchas

### Server-Client Synchronization

**GOTCHA: Client prediction can diverge from server**
```javascript
// ❌ WRONG: Trusting client-side collision detection
// Client
if (checkCollision()) {
  socket.emit('playerDied');
}

// ✅ CORRECT: Server validates everything
// Server
function gameLogicLoop(roomId) {
  // Server checks collisions
  if (checkCollision(player)) {
    player.gameover = true;
  }
  // Broadcast authoritative state
  io.to(roomId).emit('gameLogicFrame', gameState);
}
```

### Room Lifecycle

**GOTCHA: Timers must be cleared or memory leaks**
```javascript
// ❌ WRONG: Room deleted but timers still running
rooms.delete(roomId);

// ✅ CORRECT: Clear all timers first
function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  clearInterval(room.gameState.intervalId);
  clearInterval(room.gameState.roundTimerId);
  Object.values(room.consumableTimers).forEach(timer => clearInterval(timer));
  rooms.delete(roomId);
}
```

**GOTCHA: Players can join mid-game (spectators)**
```javascript
// Code must handle both scenarios:
// 1. Joining lobby before game starts → become player
// 2. Joining during game → become spectator

socket.on('joinRoom', (data) => {
  if (room.gameState.playing) {
    // Add as spectator instead
    room.spectators.set(socket.id, {name: data.username, joinedAt: Date.now()});
    socket.emit('spectatorJoined', {...});
  } else {
    // Add as player
    room.players.push(new Snake({...}));
    socket.emit('roomJoined', {...});
  }
});
```

### Database Operations

**GOTCHA: Player IDs are compound keys**
```javascript
// Format: "username_timestamp"
const playerId = `${username}_${Date.now()}`;

// ❌ WRONG: Using username alone
db.get(`SELECT * FROM players WHERE name = ?`, [username]);

// ✅ CORRECT: Using unique player ID
db.get(`SELECT * FROM players WHERE id = ?`, [playerId]);
```

**GOTCHA: Database path differs in production**
```javascript
// Development: ./game_stats.db
// Production: /app/data/game_stats.db

const dbPath = process.env.NODE_ENV === 'production'
  ? '/app/data/game_stats.db'
  : './game_stats.db';
```

### Snake Movement

**GOTCHA: Must prevent 180° turns**
```javascript
// ❌ WRONG: Allowing opposite direction
snake.direction = newDirection;

// ✅ CORRECT: Check if opposite
function changeDirection(newDir) {
  const opposite =
    (newDir.x === -this.direction.x && newDir.y === -this.direction.y);
  if (opposite) return;

  this.moveQueue.push(newDir);
}
```

**GOTCHA: Portal wraparound causes interpolation glitches**
```javascript
// When snake teleports from x=599 to x=0, interpolation would
// animate across the entire canvas

// ✅ FIX: Detect large jumps and skip interpolation
const dx = Math.abs(target.x - current.x);
if (dx > canvasWidth / 2) {
  this.renderSegments[i] = {...target};  // Instant snap
} else {
  // Normal lerp
}
```

### Socket.IO Events

**GOTCHA: Socket disconnects don't automatically clean up**
```javascript
// ✅ Always handle disconnect
socket.on('disconnect', () => {
  const room = findRoomBySocketId(socket.id);
  if (!room) return;

  // Remove player
  room.players = room.players.filter(p => p.id !== socket.id);

  // Remove spectator
  room.spectators.delete(socket.id);

  // Handle host migration
  if (room.host === socket.id) {
    migrateHost(room);
  }

  // Notify others
  io.to(room.id).emit('updatePlayers', {players: room.players});
});
```

### Canvas Rendering

**GOTCHA: Canvas doesn't auto-clear**
```javascript
// ❌ WRONG: Drawing without clearing
function gameLoop() {
  drawPlayers();  // Trails everywhere!
}

// ✅ CORRECT: Clear every frame
function gameLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawPlayers();
}
```

**GOTCHA: Shadows persist across draws**
```javascript
// ❌ WRONG: Shadow affects all subsequent draws
ctx.shadowBlur = 20;
ctx.fillRect(x, y, w, h);
ctx.fillRect(x2, y2, w, h);  // Also has shadow!

// ✅ CORRECT: Reset shadow
ctx.shadowBlur = 20;
ctx.fillRect(x, y, w, h);
ctx.shadowBlur = 0;  // Reset
ctx.fillRect(x2, y2, w, h);
```

### Configuration

**GOTCHA: Some "config" values are hardcoded**
```javascript
// These are NOT configurable despite being in validateRoomConfig:
maxRounds: 3
roundTime: 60
canvasWidth: 600
canvasHeight: 600
attacksEnabled: true

// These ARE configurable:
maxPlayers, minPlayers, gameSpeed, segmentSize, consumables
```

---

## Testing Strategy

### Manual Testing Checklist

**Basic Functionality:**
- [ ] Create room with custom settings
- [ ] Join room with code
- [ ] Start game with minimum players
- [ ] Complete all 3 rounds
- [ ] View final scores
- [ ] Check stats updated in database

**Multiplayer:**
- [ ] 2 players can play together
- [ ] 8+ players in same room
- [ ] Players see each other's movements
- [ ] Collisions work correctly
- [ ] Spectator can join mid-game
- [ ] Spectator cannot interfere with game

**Combat:**
- [ ] Attack removes own segment
- [ ] Projectile hits reduce opponent size
- [ ] Immunity blocks one hit
- [ ] Immunity expires after duration
- [ ] Multiple projectiles on screen

**Edge Cases:**
- [ ] Host disconnects → new host assigned
- [ ] All players disconnect → room deleted
- [ ] Player reconnects to same room
- [ ] Room code collision (very rare)
- [ ] Database query failures
- [ ] Invalid room configurations rejected

**Performance:**
- [ ] 16 players run smoothly
- [ ] No memory leaks after multiple games
- [ ] Database queries don't slow down over time
- [ ] Canvas rendering stays at 60 FPS

### Testing Tools

**Multiple Browsers:**
```bash
# Open multiple tabs/windows
# Chrome: Ctrl+N
# Firefox: Ctrl+Shift+P (private window)

# Or use different browsers:
# - Chrome: http://localhost:3000
# - Firefox: http://localhost:3000
# - Safari: http://localhost:3000
```

**Database Inspection:**
```bash
# Install SQLite tools
sudo apt-get install sqlite3  # Linux
brew install sqlite3          # macOS

# Open database
sqlite3 game_stats.db

# Useful queries
.schema                              # Show table structure
SELECT * FROM players;               # All players
SELECT * FROM players ORDER BY wins DESC LIMIT 10;  # Top players
.mode column                         # Pretty formatting
.headers on                          # Show column names
```

**Socket.IO Debugging:**
```javascript
// Client console
localStorage.debug = 'socket.io-client:socket';

// Server
DEBUG=socket.io* npm run dev
```

**Performance Monitoring:**
```javascript
// Add to gameLoop in SnakeGame.js
let frameCount = 0;
let lastTime = performance.now();

function gameLoop() {
  frameCount++;
  const now = performance.now();
  if (now - lastTime > 1000) {
    console.log(`FPS: ${frameCount}`);
    frameCount = 0;
    lastTime = now;
  }
  // ...rest of game loop
}
```

### Common Test Scenarios

**Test: Player Dies**
```
1. Start game with 2 players
2. Player 1 attacks Player 2's head
3. Verify Player 2 loses 3 segments
4. If Player 2 has < 3 segments, verify gameover
5. Verify game continues with remaining players
```

**Test: Round Transition**
```
1. Start game
2. Wait for 60 seconds
3. Verify roundEnd event received
4. Verify scores displayed
5. Wait 5 seconds
6. Verify new round starts automatically
7. Verify round counter increments
```

**Test: Stats Persistence**
```
1. Note initial stats for player
2. Complete a game (win or lose)
3. Verify games_played incremented
4. Verify wins/total_score updated correctly
5. Verify last_played timestamp updated
6. Refresh page and check stats persist
```

---

## Deployment

### Fly.io Configuration

**fly.toml:**
```toml
app = "snake-multiplayer-2024"
primary_region = "gru"  # São Paulo, Brazil

[build]
  # Uses Dockerfile

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "stop"     # Hibernate when idle
  auto_start_machines = true
  min_machines_running = 0        # Can scale to 0
  processes = ["app"]

[vm]
  size = "shared-cpu-1x"          # 1 shared CPU
  memory = "1gb"                  # 1GB RAM

[mounts]
  source = "game_stats_volume"    # Persistent volume
  destination = "/app/data"       # Database stored here
```

**Dockerfile (Multi-stage):**
```dockerfile
# Stage 1: Base
FROM node:20.18.0-slim AS base
RUN apt-get update && apt-get install -y sqlite3 && rm -rf /var/lib/apt/lists/*

# Stage 2: Dependencies
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Stage 3: Production
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN useradd -m -u 1001 appuser  # Non-root user
COPY --from=deps --chown=appuser:appuser /app/node_modules ./node_modules
COPY --chown=appuser:appuser . .
USER appuser
EXPOSE 3000
CMD ["node", "index.js"]
```

### Deployment Commands

**Initial Setup:**
```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
fly auth login

# Create app (first time only)
fly launch
# Select region: gru (São Paulo)
# Create volume when prompted

# Create persistent volume
fly volumes create game_stats_volume --region gru --size 1
```

**Deploy:**
```bash
# Deploy latest changes
fly deploy

# View logs
fly logs

# SSH into machine
fly ssh console

# Check database
fly ssh console -C "sqlite3 /app/data/game_stats.db 'SELECT COUNT(*) FROM players;'"

# Scale
fly scale count 2  # Run 2 instances
fly scale count 1  # Back to 1

# Restart
fly apps restart snake-multiplayer-2024
```

### Environment Variables

**Set secrets:**
```bash
# Optional: set custom port (default 3000)
fly secrets set PORT=3000

# Set environment
fly secrets set NODE_ENV=production

# View secrets
fly secrets list
```

### Database Backup

**Backup production database:**
```bash
# Download from volume
fly ssh sftp get /app/data/game_stats.db ./backup_$(date +%Y%m%d).db

# Or via command
fly ssh console -C "cat /app/data/game_stats.db" > backup.db
```

**Restore database:**
```bash
# Upload to volume
fly ssh sftp shell
put backup.db /app/data/game_stats.db
exit

# Restart app
fly apps restart
```

### Monitoring

**Health Check:**
```bash
# Check if app is up
curl https://snake-multiplayer-2024.fly.dev/

# View metrics
fly dashboard
```

**Performance:**
```bash
# View resource usage
fly status

# View machine details
fly machine list

# SSH and check processes
fly ssh console
top
```

### Cost Optimization

**Current Setup:**
- **Auto-stop**: Hibernates when no users
- **Min 0 machines**: Can scale to zero
- **Shared CPU**: Cheapest tier
- **1GB volume**: Minimal storage cost

**Estimated Cost:** ~$2-5/month (mostly volume storage)

---

## Quick Reference

### File Locations
| Feature | Server (index.js) | Client (SnakeGame.js) | Snake (snakeClass.js) | UI (index.html) |
|---------|-------------------|------------------------|------------------------|------------------|
| Movement | gameLogicLoop() | socket.on('gameLogicFrame') | move(), moveLogic() | - |
| Combat | Projectile collision | drawProjectiles() | attack() | - |
| Consumables | initializeConsumableSystem() | drawConsumables() | consumeConsumable() | Config panel |
| Scoring | endRound(), endGame() | socket.on('roundEnd') | score property | drawInfoCanvas() |
| Rooms | createRoom, joinRoom | socket.emit('createRoom') | - | Room UI |
| Database | updatePlayerStats() | socket.on('statsUpdated') | - | Profile view |

### Key Constants
```javascript
CANVAS_SIZE: 600x600
DEFAULT_GAME_SPEED: 83ms
DEFAULT_SEGMENT_SIZE: 20px
MAX_ROUNDS: 3 (fixed)
ROUND_TIME: 60s (fixed)
MAX_PLAYERS: 16
MOVE_QUEUE_SIZE: 3
ATTACK_COST: 1 segment
HEAD_HIT_DAMAGE: 3 segments
ROOM_CODE_LENGTH: 6 characters
```

### Common Socket Events
```javascript
// Game flow
'createRoom' → 'roomCreated'
'joinRoom' → 'roomJoined'
'startGame' → 'gameStart' → 'gameLogicFrame' × N → 'roundEnd' → 'gameEnd'

// Actions
'newMove' (client → server)
'attack' (client → server)

// Invites
'invitePlayer' → 'invitation' (server → target client)
'getOnlinePlayers' → 'onlinePlayersList'
```

### Debugging Snippets
```javascript
// Server: Log room state
console.log('Room:', JSON.stringify(room, null, 2));

// Client: Log player positions
console.log('Players:', players.map(p => ({name: p.name, head: p.segments[0]})));

// Check interpolation
console.log('Lerp speed:', player.interpolationSpeed);
console.log('Target vs Render:', player.targetSegments[0], player.renderSegments[0]);

// Database queries
db.all('SELECT * FROM players ORDER BY wins DESC LIMIT 10', console.log);
```

---

## Version History

**v2.0.0** (Current)
- Round-based scoring system (3 rounds)
- Spectator mode
- Enhanced statistics tracking
- Fly.io deployment

**v1.x**
- Initial release
- Basic multiplayer
- Single-round games

---

## Contributing Guidelines

When modifying this codebase:

1. **Test multiplayer**: Always test with 2+ browser instances
2. **Maintain sync**: Keep client and server logic aligned
3. **Clear timers**: Every setInterval needs a clearInterval
4. **Validate inputs**: Server must validate all client data
5. **Update this doc**: Add new features to relevant sections
6. **No breaking changes**: Keep database schema backward-compatible
7. **Profile before optimizing**: Use console.time() for performance issues

---

## Contact & Resources

- **Repository**: https://github.com/marto993/Snake-Multiplayer
- **Developer**: [El Marto](https://github.com/marto993)
- **LinkedIn**: [Martin Di Geronimo](https://www.linkedin.com/in/martin-di-geronimo-29a06b17b)
- **Deployment**: Fly.io
- **License**: MIT

---

**Last Updated**: 2025-11-16
**Document Version**: 1.0.0
