document.addEventListener("DOMContentLoaded", function() {
  // Variables de renderizado - DECLARADAS PRIMERO
  let renderLoop = null;
  let lastLogicUpdate = 0;
  let lastFrameTime = 0;
  let isGameRunning = false;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const gameOverScreen = document.getElementById('gameOverScreen');
  const scoreDisplay = document.getElementById('scoreDisplay');
  const restartButton = document.getElementById('restartButton');
  const joinButton = document.getElementById('joinButton');
  const createRoomButton = document.getElementById('createRoomButton');
  const joinRoomButton = document.getElementById('joinRoomButton');
  const startGameButton = document.getElementById('startGameButton');
  const refreshRoomsButton = document.getElementById('refreshRoomsButton');
  const joinForm = document.getElementById('joinForm');
  const roomSelection = document.getElementById('roomSelection');
  const gameInterface = document.getElementById('gameInterface');
  const usernameInput = document.getElementById('username');
  const roomIdInput = document.getElementById('roomId');
  const roomsList = document.getElementById('roomsList');
  const waitingSpan = document.getElementById('waitingSpan');
  const playerList = document.getElementById('playerList');
  const roundInfo = document.getElementById('roundInfo');
  const gameStatus = document.getElementById('gameStatus');
  const roomInfo = document.getElementById('roomInfo');
  const attackControls = document.getElementById('attackControls');

  // Configuration elements
  const configPanel = document.getElementById('configPanel');
  const toggleConfigButton = document.getElementById('toggleConfigButton');
  const configSettings = document.getElementById('configSettings');
  const saveConfigButton = document.getElementById('saveConfigButton');
  const maxPlayersInput = document.getElementById('maxPlayersInput');
  const minPlayersInput = document.getElementById('minPlayersInput');
  const maxRoundsInput = document.getElementById('maxRoundsInput');
  const gameSpeedInput = document.getElementById('gameSpeedInput');
  const canvasSizeInput = document.getElementById('canvasSizeInput');
  const segmentSizeInput = document.getElementById('segmentSizeInput');
  const countdownInput = document.getElementById('countdownInput');
  const attacksEnabledInput = document.getElementById('attacksEnabledInput');

  // Initialize socket connection
  const socket = io();
  let gameState = { playing: false, round: 1 };
  let segmentSize = 20;
  let snakes = [];
  let foods = {};
  let projectiles = [];
  let clientProjectiles = []; // Array de proyectiles interpolados
  let isConnected = false;
  let isHost = false;
  let currentRoomId = null;
  let roomConfig = {};
  let roomScores = {};

  // Función lerp (linear interpolation)
  function lerp(start, end, factor) {
    return start + (end - start) * factor;
  }

  // Clase Projectile para interpolación (similar a Snake)
  function ClientProjectile(serverProjectile) {
    this.id = serverProjectile.id;
    this.playerId = serverProjectile.playerId;
    this.color = serverProjectile.color;
    this.direction = { ...serverProjectile.direction };
    
    // Posiciones target (del servidor)
    this.targetX = serverProjectile.x;
    this.targetY = serverProjectile.y;
    
    // Posiciones de renderizado (interpoladas)
    this.renderX = serverProjectile.prevX || serverProjectile.x;
    this.renderY = serverProjectile.prevY || serverProjectile.y;
    
    this.interpolationSpeed = 0.2;
  }

  ClientProjectile.prototype.updateRenderPosition = function() {
    this.renderX = lerp(this.renderX, this.targetX, this.interpolationSpeed);
    this.renderY = lerp(this.renderY, this.targetY, this.interpolationSpeed);
  };

  ClientProjectile.prototype.updateTarget = function(serverProjectile) {
    this.targetX = serverProjectile.x;
    this.targetY = serverProjectile.y;
    this.direction = { ...serverProjectile.direction };
    this.color = serverProjectile.color;
  };
  let interpolatedProjectiles = []; // Para interpolación de proyectiles

  // Retro color palette
  const retroColors = {
    snake: ['#00ff41', '#ff0080', '#00ffff', '#ffff00', '#ff4040', '#8040ff', '#40ff80', '#ff8040'],
    background: '#000000',
    grid: '#004400',
    food: '#ff0080',
    foodGlow: '#ff40a0',
    projectile: '#ffff00'
  };

  // Enhanced rendering functions with retro style
  function drawRetroRect(ctx, x, y, width, height, color, glowColor = null) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
    
    if (glowColor) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 5;
      ctx.fillRect(x, y, width, height);
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    }
  }

  function drawRetroSnakeSegment(ctx, x, y, size, color, isHead = false, direction = null, isCurrentPlayer = false) {
    const padding = 1;
    const innerSize = size - (padding * 2);
    
    // Main segment
    drawRetroRect(ctx, x + padding, y + padding, innerSize, innerSize, color);
    
    // Head specific features
    if (isHead) {
      // Border for head
      ctx.strokeStyle = isCurrentPlayer ? '#ffffff' : '#000000';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + padding, y + padding, innerSize, innerSize);
      
      // Simple dot eyes for retro style
      if (direction) {
        drawRetroEyes(ctx, x, y, size, direction);
      }
    }
    
    // Simple border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + padding, y + padding, innerSize, innerSize);
  }

  function drawRetroProjectile(ctx, projectile, segmentSize) {
    const centerX = projectile.renderX + segmentSize / 2;
    const centerY = projectile.renderY + segmentSize / 2;
    const size = segmentSize * 0.6;
    
    // Simple diamond shape for projectiles
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(Math.PI / 4); // 45 degree rotation for diamond
    
    drawRetroRect(ctx, -size/2, -size/2, size, size, projectile.color || retroColors.projectile, '#ffff80');
    
    ctx.restore();
  }

  function drawRetroEyes(ctx, x, y, size, direction) {
    const eyeSize = Math.max(2, size * 0.2);
    const eyeOffset = size * 0.3;
    
    // Eye positions based on direction
    let leftEyeX, leftEyeY, rightEyeX, rightEyeY;
    
    if (direction.x === 1) { // Moving right
      leftEyeX = x + size - eyeOffset;
      leftEyeY = y + eyeOffset;
      rightEyeX = x + size - eyeOffset;
      rightEyeY = y + size - eyeOffset;
    } else if (direction.x === -1) { // Moving left
      leftEyeX = x + eyeOffset;
      leftEyeY = y + eyeOffset;
      rightEyeX = x + eyeOffset;
      rightEyeY = y + size - eyeOffset;
    } else if (direction.y === -1) { // Moving up
      leftEyeX = x + eyeOffset;
      leftEyeY = y + eyeOffset;
      rightEyeX = x + size - eyeOffset;
      rightEyeY = y + eyeOffset;
    } else { // Moving down
      leftEyeX = x + eyeOffset;
      leftEyeY = y + size - eyeOffset;
      rightEyeX = x + size - eyeOffset;
      rightEyeY = y + size - eyeOffset;
    }
    
    // Draw simple square eyes
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(leftEyeX - eyeSize/2, leftEyeY - eyeSize/2, eyeSize, eyeSize);
    ctx.fillRect(rightEyeX - eyeSize/2, rightEyeY - eyeSize/2, eyeSize, eyeSize);
  }

  function drawRetroFood(ctx, food, segmentSize) {
    const padding = 2;
    const size = segmentSize - (padding * 2);
    
    // Pulsing effect
    const pulse = Math.sin(Date.now() * 0.01) * 0.1 + 1;
    const pulseSize = size * pulse;
    const offset = (size - pulseSize) / 2;
    
    // Main food body with glow
    drawRetroRect(
      ctx, 
      food.x + padding + offset, 
      food.y + padding + offset, 
      pulseSize, 
      pulseSize, 
      retroColors.food, 
      retroColors.foodGlow
    );
    
    // Score text
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(8, segmentSize * 0.4)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const centerX = food.x + segmentSize / 2;
    const centerY = food.y + segmentSize / 2;
    
    // Text outline
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeText(food.score, centerX, centerY);
    ctx.fillText(food.score, centerX, centerY);
  }

  // Keyboard handling
  document.addEventListener('keydown', handleKeyPress);

  function handleKeyPress(event) {
    const key = event.keyCode;
    
    if (key >= 37 && key <= 40 && isConnected && gameState.playing) {
      event.preventDefault();
      socket.emit('newMove', { key });
    } else if (key === 32 && isConnected && gameState.playing && roomConfig.attacksEnabled) { // Spacebar
      event.preventDefault();
      socket.emit('attack');
    }
  }

  // Fase 1: Crear instancias Snake locales para interpolación
  function createLocalSnake(serverSnake) {
    const snake = new Snake(
      serverSnake.id,
      serverSnake.name,
      segmentSize,
      roomConfig.canvasWidth || 1000,
      roomConfig.canvasHeight || 600,
      serverSnake.segments[0].x,
      serverSnake.segments[0].y,
      serverSnake.direction.x,
      serverSnake.direction.y
    );
    
    // Copiar estado del servidor
    snake.segments = serverSnake.segments.map(seg => ({ ...seg }));
    snake.targetSegments = serverSnake.segments.map(seg => ({ ...seg }));
    snake.renderSegments = serverSnake.segments.map(seg => ({ ...seg }));
    snake.direction = { ...serverSnake.direction };
    snake.score = serverSnake.score;
    snake.gameover = serverSnake.gameover;
    snake.scoreLeftToGrow = serverSnake.scoreLeftToGrow;
    
    return snake;
  }

  // Fase 1: Loop de renderizado a 60 FPS
  function startRenderLoop() {
    if (renderLoop) return; // Ya está ejecutándose
    
    function render(currentTime) {
      const deltaTime = currentTime - lastFrameTime;
      lastFrameTime = currentTime;
      
      if (isGameRunning && gameState.playing) {
        // Interpolar posiciones de todas las serpientes
        snakes.forEach(snake => {
          if (snake.updateRenderPosition) {
            snake.updateRenderPosition(deltaTime);
          }
        });
        
        // Interpolar proyectiles (igual que snakes)
        clientProjectiles.forEach(projectile => {
          projectile.updateRenderPosition();
        });
        
        // Renderizar frame
        gameLoop();
      }
      
      if (isGameRunning) {
        renderLoop = requestAnimationFrame(render);
      }
    }
    
    renderLoop = requestAnimationFrame(render);
  }

  // Detener render loop
  function stopRenderLoop() {
    if (renderLoop) {
      cancelAnimationFrame(renderLoop);
      renderLoop = null;
    }
    isGameRunning = false;
  }

  // Socket events
  socket.on('connect', () => {
    console.log('Conectado al servidor:', socket.id);
    isConnected = true;
    refreshRooms();
  });

  socket.on('disconnect', () => {
    isConnected = false;
    stopRenderLoop();
    showStatus('Desconectado del servidor', 'error');
  });

  socket.on('gameError', (message) => {
    showStatus(message, 'error');
  });

  socket.on('roomCreated', (data) => {
    currentRoomId = data.roomId;
    isHost = data.isHost;
    roomConfig = data.config;
    showGameInterface();
    updateConfigPanel();
    updateAttackControls();
    showStatus(`¡Sala ${data.roomId} creada!`, 'success');
  });

  socket.on('roomJoined', (data) => {
    currentRoomId = data.roomId;
    isHost = data.isHost;
    roomConfig = data.config;
    showGameInterface();
    updateConfigPanel();
    updateAttackControls();
    showStatus(`¡Te uniste a la sala ${data.roomId}!`, 'success');
  });

  socket.on('roomsList', (rooms) => {
    updateRoomsList(rooms);
  });

  socket.on('newHost', (data) => {
    if (data.hostId === socket.id) {
      isHost = true;
      showStatus('¡Ahora eres el anfitrión!', 'info');
    }
    updateHostControls();
    updateConfigPanel();
  });

  socket.on('updatePlayers', (players, state, config, roomData) => {
    snakes = players.map(serverPlayer => {
      const existingSnake = snakes.find(s => s.id === serverPlayer.id);
      if (existingSnake) {
        // Actualizar snake existente
        existingSnake.segments = serverPlayer.segments.map(seg => ({ ...seg }));
        existingSnake.targetSegments = serverPlayer.segments.map(seg => ({ ...seg }));
        existingSnake.direction = { ...serverPlayer.direction };
        existingSnake.score = serverPlayer.score;
        existingSnake.gameover = serverPlayer.gameover;
        existingSnake.scoreLeftToGrow = serverPlayer.scoreLeftToGrow;
        return existingSnake;
      } else {
        return createLocalSnake(serverPlayer);
      }
    });
    
    gameState = state;
    roomConfig = config;
    updatePlayerList(players);
    updateGameInfo(state);
    updateRoomInfo(roomData);
    updateHostControls();
    updateConfigPanel();
    updateAttackControls();
    
    if (players.length >= config.minPlayers && !state.playing && isHost) {
      showElement(startGameButton);
    } else {
      hideElement(startGameButton);
    }
    
    if (players.length < config.minPlayers) {
      showElement(waitingSpan);
      showStatus(`Necesitas ${config.minPlayers - players.length} jugadores más`, 'info');
    } else {
      hideElement(waitingSpan);
    }
  });

  socket.on('configUpdated', (newConfig) => {
    roomConfig = newConfig;
    updateConfigInputs(newConfig);
    updateCanvasSize(newConfig);
    updateAttackControls();
    showStatus('¡Configuración actualizada!', 'success');
  });

  socket.on('updateScores', (scores) => {
    roomScores = scores;
    updatePlayerList(snakes);
  });

  socket.on('gameStart', (data) => {
    canvas.width = data.config.canvasWidth;
    canvas.height = data.config.canvasHeight;
    segmentSize = data.config.segmentSize;
    
    // Crear snakes locales para interpolación
    snakes = data.players.map(serverPlayer => createLocalSnake(serverPlayer));
    foods = data.food;
    projectiles = data.projectiles || [];
    gameState = data.gameState;
    roomConfig = data.config;
    
    // Fase 1: Iniciar render loop
    isGameRunning = true;
    startRenderLoop();
    
    hideElement(gameOverScreen);
    hideElement(startGameButton);
    hideElement(configPanel);
    showStatus(`Ronda ${data.gameState.round} - ¡Batalla!`, 'success');
    console.log(`¡Ronda ${data.gameState.round} iniciada!`);
    
    // Initial render
    gameLoop();
  });

  socket.on('countdown', (count, state) => {
    gameState = state;
    showStatus(`Ronda ${state.round} inicia en ${count}...`, 'info');
    updateGameInfo(state);
  });

  // Fase 1: Nuevo evento para updates de lógica
  socket.on('gameLogicFrame', (data) => {
    // Actualizar targets de las serpientes existentes
    snakes.forEach(localSnake => {
      const serverSnake = data.players.find(p => p.id === localSnake.id);
      if (serverSnake) {
        localSnake.targetSegments = serverSnake.segments.map(seg => ({ ...seg }));
        localSnake.segments = serverSnake.segments.map(seg => ({ ...seg })); // Para lógica
        localSnake.direction = { ...serverSnake.direction };
        localSnake.score = serverSnake.score;
        localSnake.gameover = serverSnake.gameover;
        localSnake.scoreLeftToGrow = serverSnake.scoreLeftToGrow;
      }
    });
    
    // Actualizar proyectiles (igual que snakes)
    const serverProjectiles = data.projectiles || [];
    
    // Actualizar proyectiles existentes
    clientProjectiles.forEach(clientProjectile => {
      const serverProjectile = serverProjectiles.find(p => p.id === clientProjectile.id);
      if (serverProjectile) {
        clientProjectile.updateTarget(serverProjectile);
      }
    });
    
    // Remover proyectiles que ya no existen
    clientProjectiles = clientProjectiles.filter(clientProjectile => 
      serverProjectiles.some(p => p.id === clientProjectile.id)
    );
    
    // Agregar nuevos proyectiles
    serverProjectiles.forEach(serverProjectile => {
      if (!clientProjectiles.find(cp => cp.id === serverProjectile.id)) {
        clientProjectiles.push(new ClientProjectile(serverProjectile));
      }
    });
    
    foods = data.food;
    gameState = data.gameState;
    projectiles = data.projectiles || []; // Mantener para compatibilidad
    lastLogicUpdate = data.timestamp;
  });

  // Fase 1: Evento de sincronización para interpolación
  socket.on('syncFrame', (data) => {
    // Este evento se usa para mantener sincronizado el renderizado
    // No actualiza lógica, solo indica que debe continuar interpolando
  });

  // Legacy event para compatibilidad
  socket.on('gameFrame', (players, food, state, projectilesData) => {
    // Actualizar como antes si no hay dual-loop
    snakes.forEach(localSnake => {
      const serverSnake = players.find(p => p.id === localSnake.id);
      if (serverSnake) {
        localSnake.segments = serverSnake.segments.map(seg => ({ ...seg }));
        localSnake.targetSegments = serverSnake.segments.map(seg => ({ ...seg }));
        localSnake.renderSegments = serverSnake.segments.map(seg => ({ ...seg }));
        localSnake.direction = { ...serverSnake.direction };
        localSnake.score = serverSnake.score;
        localSnake.gameover = serverSnake.gameover;
      }
    });
    
    foods = food;
    gameState = state;
    projectiles = projectilesData || [];
    gameLoop();
  });

  socket.on('roundEnd', (data) => {
    stopRenderLoop();
    roomScores = data.scores;
    showStatus(`¡Ronda ${data.round} terminada!`, 'info');
    if (data.winner) {
      showStatus(`Ganador de la ronda: ${data.winner.name}`, 'success');
    }
    
    updateGameInfo({ round: data.round + 1, maxRounds: roomConfig.maxRounds });
    updatePlayerList(snakes);
    
    if (data.nextRound) {
      setTimeout(() => {
        showStatus(`Preparando ronda ${data.round + 1}...`, 'info');
        updateGameInfo({ round: data.round + 1, maxRounds: roomConfig.maxRounds });
      }, 2000);
    }
    
    if (isHost && data.nextRound) {
      showElement(startGameButton);
      updateConfigPanel();
    }
  });

  socket.on('gameEnd', (data) => {
    stopRenderLoop();
    showStatus(`¡Juego Terminado! Campeón: ${data.winner.name}`, 'success');
    if (data.roomFinished) {
      showFinalScreen(data.winner, data.finalScores);
    } else {
      showGameOverScreen(`Campeón: ${data.winner.name}`, data.finalScores);
      if (isHost) {
        showElement(startGameButton);
        updateConfigPanel();
      }
    }
  });

  socket.on('roomFinished', (data) => {
    stopRenderLoop();
    showFinalScreen(null, data.finalScores, data.reason);
  });

  socket.on('backToMenuSuccess', () => {
    stopRenderLoop();
    currentRoomId = null;
    isHost = false;
    roomConfig = {};
    showRoomSelection();
    showStatus('Regresaste al menú', 'info');
  });

  // Configuration functions
  function updateConfigPanel() {
    if (currentRoomId && !gameState.playing) {
      showElement(configPanel);
      if (isHost) {
        showElement(saveConfigButton);
        setConfigInputsEnabled(true);
        toggleConfigButton.textContent = '⚙️ Configuración';
      } else {
        hideElement(saveConfigButton);
        setConfigInputsEnabled(false);
        toggleConfigButton.textContent = '👁️ Ver Configuración';
      }
    } else {
      hideElement(configPanel);
    }
  }

  function setConfigInputsEnabled(enabled) {
    maxPlayersInput.disabled = !enabled;
    minPlayersInput.disabled = !enabled;
    maxRoundsInput.disabled = !enabled;
    gameSpeedInput.disabled = !enabled;
    canvasSizeInput.disabled = !enabled;
    segmentSizeInput.disabled = !enabled;
    countdownInput.disabled = !enabled;
    attacksEnabledInput.disabled = !enabled;
  }

  function updateConfigInputs(config) {
    maxPlayersInput.value = config.maxPlayers;
    minPlayersInput.value = config.minPlayers;
    maxRoundsInput.value = config.maxRounds;
    gameSpeedInput.value = config.gameSpeed;
    segmentSizeInput.value = config.segmentSize;
    countdownInput.value = config.countdownTime;
    attacksEnabledInput.checked = config.attacksEnabled || false;
    
    const canvasSize = `${config.canvasWidth}x${config.canvasHeight}`;
    canvasSizeInput.value = canvasSize;
  }

  function updateCanvasSize(config) {
    canvas.width = config.canvasWidth;
    canvas.height = config.canvasHeight;
    segmentSize = config.segmentSize;
    handleResize();
  }

  function updateAttackControls() {
    if (roomConfig.attacksEnabled) {
      showElement(attackControls);
    } else {
      hideElement(attackControls);
    }
  }

  function saveConfiguration() {
    if (!isHost) {
      showStatus('Solo el anfitrión puede modificar la configuración', 'error');
      return;
    }

    const canvasSize = canvasSizeInput.value.split('x');
    const newConfig = {
      maxPlayers: parseInt(maxPlayersInput.value),
      minPlayers: parseInt(minPlayersInput.value),
      maxRounds: parseInt(maxRoundsInput.value),
      gameSpeed: parseInt(gameSpeedInput.value),
      canvasWidth: parseInt(canvasSize[0]),
      canvasHeight: parseInt(canvasSize[1]),
      segmentSize: parseInt(segmentSizeInput.value),
      countdownTime: parseInt(countdownInput.value),
      attacksEnabled: attacksEnabledInput.checked
    };

    if (newConfig.minPlayers > newConfig.maxPlayers) {
      showStatus('Los jugadores mínimos no pueden exceder los máximos', 'error');
      return;
    }

    socket.emit('updateRoomConfig', newConfig);
  }

  // UI Functions
  function showRoomSelection() {
    hideElement(joinForm);
    showElement(roomSelection);
    hideElement(gameInterface);
    refreshRooms();
  }

  function showGameInterface() {
    hideElement(joinForm);
    hideElement(roomSelection);
    showElement(gameInterface);
  }

  function updateRoomsList(rooms) {
    roomsList.innerHTML = '';
    
    if (rooms.length === 0) {
      const emptyMsg = document.createElement('li');
      emptyMsg.textContent = 'No hay salas disponibles';
      emptyMsg.className = 'empty-room';
      roomsList.appendChild(emptyMsg);
      return;
    }
    
    rooms.forEach(room => {
      const roomItem = document.createElement('li');
      roomItem.className = 'room-item';
      const attacksStatus = room.config.attacksEnabled ? '⚔️' : '';
      roomItem.innerHTML = `
        <div class="room-info">
          <strong>Sala: ${room.id}</strong> ${attacksStatus}<br>
          Anfitrión: ${room.hostName}<br>
          Jugadores: ${room.players}/${room.maxPlayers}
          <div class="room-config">
            ${room.config.maxRounds} rondas • ${room.config.canvasWidth}x${room.config.canvasHeight} • Velocidad: ${room.config.gameSpeed}ms
          </div>
        </div>
        <button onclick="joinSpecificRoom('${room.id}')" class="join-room-btn">Unirse</button>
      `;
      roomsList.appendChild(roomItem);
    });
  }

  function updateRoomInfo(roomData) {
    if (roomInfo && roomData) {
      roomInfo.innerHTML = `
        <strong>Sala:</strong> ${roomData.roomId}<br>
        <strong>Anfitrión:</strong> ${roomData.host === socket.id ? 'Tú' : 'Otro jugador'}
      `;
    }
  }

  function updateHostControls() {
    if (isHost && gameState && !gameState.playing) {
      showElement(startGameButton);
    } else {
      hideElement(startGameButton);
    }
  }

  function refreshRooms() {
    socket.emit('getRooms');
  }

  // Game functions with retro style
  function drawGrid() {
    // Almost imperceptible retro grid
    ctx.strokeStyle = '#001100';
    ctx.lineWidth = 1;
    
    for (let x = 0; x <= canvas.width; x += segmentSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    
    for (let y = 0; y <= canvas.height; y += segmentSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }

  function drawPlayers() {
    snakes.forEach((snake, index) => {
      if (!snake.gameover && snake.getRenderSegments) {
        const isCurrentPlayer = snake.id === socket.id;
        const baseColor = retroColors.snake[index % retroColors.snake.length];
        const renderSegments = snake.getRenderSegments();
        
        renderSegments.forEach((segment, segIndex) => {
          const isHead = segIndex === 0;
          
          drawRetroSnakeSegment(
            ctx, 
            segment.x, 
            segment.y, 
            segmentSize, 
            baseColor, 
            isHead, 
            isHead ? snake.direction : null,
            isCurrentPlayer
          );
        });
      }
    });

    if (foods) {
      drawRetroFood(ctx, foods, segmentSize);
    }

    // Draw projectiles usando posiciones interpoladas (igual que snakes)
    if (clientProjectiles && clientProjectiles.length > 0) {
      clientProjectiles.forEach(projectile => {
        drawRetroProjectile(ctx, projectile, segmentSize);
      });
    }
  }

  function gameLoop() {
    // Clear with black background
    ctx.fillStyle = retroColors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    drawGrid();
    drawPlayers();
    updatePlayerList(snakes);
  }

  function updatePlayerList(players) {
    playerList.innerHTML = '';
    
    const sortedPlayers = players.sort((a, b) => {
      if (gameState.playing) {
        return b.score - a.score;
      } else {
        const aTotal = (roomScores && roomScores[a.id]) ? roomScores[a.id].totalScore : 0;
        const bTotal = (roomScores && roomScores[b.id]) ? roomScores[b.id].totalScore : 0;
        return bTotal - aTotal;
      }
    });
    
    sortedPlayers.forEach((player, index) => {
      const listItem = document.createElement('li');
      listItem.className = `player-item ${player.gameover ? 'eliminated' : ''} ${player.id === socket.id ? 'current-player' : ''}`;
      
      const rank = document.createElement('span');
      rank.className = 'player-rank';
      rank.textContent = `#${index + 1}`;
      
      const name = document.createElement('span');
      name.className = 'player-name';
      name.textContent = player.name;
      
      const score = document.createElement('span');
      score.className = 'player-score';
      
      if (gameState.playing) {
        score.textContent = player.score;
      } else {
        const totalScore = (roomScores && roomScores[player.id]) ? roomScores[player.id].totalScore : 0;
        const roundWins = (roomScores && roomScores[player.id]) ? roomScores[player.id].roundWins : 0;
        score.innerHTML = `${totalScore}<br><small>${roundWins}V</small>`;
      }
      
      const status = document.createElement('span');
      status.className = 'player-status';
      status.textContent = player.gameover ? '💀' : '🐍';
      
      listItem.appendChild(rank);
      listItem.appendChild(name);
      listItem.appendChild(score);
      listItem.appendChild(status);
      
      playerList.appendChild(listItem);
    });
  }

  function updateGameInfo(state) {
    if (roundInfo && roomConfig.maxRounds) {
      roundInfo.textContent = `Ronda ${state.round}/${roomConfig.maxRounds}`;
    }
  }

  function showFinalScreen(winner, finalScores, reason = null) {
    const finalScreen = document.getElementById('finalScreen');
    const finalTitle = document.getElementById('finalTitle');
    const finalMessage = document.getElementById('finalMessage');
    const finalScoresList = document.getElementById('finalScoresList');
    
    if (reason) {
      finalTitle.textContent = 'Sala Terminada';
      finalMessage.textContent = reason;
    } else {
      finalTitle.textContent = '¡Juego Completo!';
      finalMessage.textContent = winner ? `Campeón: ${winner.name}` : 'Juego terminado';
    }
    
    finalScoresList.innerHTML = '';
    const sortedScores = Object.values(finalScores).sort((a, b) => b.totalScore - a.totalScore);
    
    sortedScores.forEach((player, index) => {
      const item = document.createElement('li');
      item.className = 'final-score-item';
      item.innerHTML = `
        <span class="final-rank">#${index + 1}</span>
        <span class="final-name">${player.name}</span>
        <span class="final-total">${player.totalScore} pts</span>
        <span class="final-wins">${player.roundWins} victorias</span>
      `;
      finalScoresList.appendChild(item);
    });
    
    hideElement(gameInterface);
    showElement(finalScreen);
  }

  function hideFinalScreen() {
    hideElement(document.getElementById('finalScreen'));
  }

  function showGameOverScreen(message, scores) {
    gameOverScreen.classList.remove('hidden');
    scoreDisplay.textContent = message;
  }

  function hideGameOverScreen() {
    gameOverScreen.classList.add('hidden');
  }

  function showStatus(message, type = 'info') {
    if (gameStatus) {
      gameStatus.textContent = message;
      gameStatus.className = `status ${type}`;
      setTimeout(() => {
        gameStatus.textContent = '';
        gameStatus.className = 'status';
      }, 3000);
    }
  }

  function showElement(element) {
    if (element) element.classList.remove('hidden');
  }

  function hideElement(element) {
    if (element) element.classList.add('hidden');
  }

  // Canvas resize handling
  function handleResize() {
    const container = canvas.parentElement;
    const maxWidth = container.clientWidth - 40;
    const maxHeight = window.innerHeight - 200;
    
    if (canvas.width > maxWidth || canvas.height > maxHeight) {
      const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
      canvas.style.transform = `scale(${scale})`;
      canvas.style.transformOrigin = 'top left';
    } else {
      canvas.style.transform = 'none';
    }
  }

  window.addEventListener('resize', handleResize);

  // Global functions for button clicks
  window.joinSpecificRoom = function(roomId) {
    const username = usernameInput.value.trim();
    if (!username || username.length < 2 || username.length > 20) {
      showStatus('Por favor ingresa un nombre válido (2-20 caracteres)', 'error');
      usernameInput.focus();
      return;
    }
    socket.emit('joinRoom', { roomId, username });
  };

  // Configuration event listeners
  toggleConfigButton.addEventListener('click', () => {
    if (configSettings.classList.contains('hidden')) {
      showElement(configSettings);
      toggleConfigButton.textContent = '▼ Configuración';
    } else {
      hideElement(configSettings);
      toggleConfigButton.textContent = '⚙️ Configuración';
    }
  });

  saveConfigButton.addEventListener('click', () => {
    saveConfiguration();
  });

  // Validation event listeners
  maxPlayersInput.addEventListener('change', () => {
    const maxVal = parseInt(maxPlayersInput.value);
    const minVal = parseInt(minPlayersInput.value);
    if (minVal > maxVal) {
      minPlayersInput.value = maxVal;
    }
  });

  minPlayersInput.addEventListener('change', () => {
    const maxVal = parseInt(maxPlayersInput.value);
    const minVal = parseInt(minPlayersInput.value);
    if (minVal > maxVal) {
      minPlayersInput.value = maxVal;
    }
  });

  // Event listeners
  restartButton.addEventListener('click', () => {
    hideGameOverScreen();
  });

  joinButton.addEventListener('click', (event) => {
    event.preventDefault();
    showRoomSelection();
  });

  createRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username && username.length >= 2 && username.length <= 20) {
      socket.emit('createRoom', { username });
    } else {
      showStatus('El nombre debe tener 2-20 caracteres', 'error');
      usernameInput.focus();
    }
  });

  joinRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const roomId = roomIdInput.value.trim().toUpperCase();
    
    if (!username || username.length < 2) {
      showStatus('El nombre debe tener 2-20 caracteres', 'error');
      usernameInput.focus();
      return;
    }
    
    if (!roomId || roomId.length !== 6) {
      showStatus('Por favor ingresa un ID de sala válido', 'error');
      roomIdInput.focus();
      return;
    }
    
    socket.emit('joinRoom', { roomId, username });
  });

  startGameButton.addEventListener('click', () => {
    socket.emit('startGame');
  });

  refreshRoomsButton.addEventListener('click', () => {
    refreshRooms();
  });

  document.getElementById('backToMenuButton').addEventListener('click', () => {
    socket.emit('backToMenu');
    hideFinalScreen();
  });

  // Auto-uppercase room ID input
  roomIdInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  // Initialize
  handleResize();
  showStatus('¡Conectado! Ingresa tu nombre para comenzar.', 'info');
});