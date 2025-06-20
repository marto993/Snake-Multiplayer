document.addEventListener("DOMContentLoaded", function() {
  let renderLoop = null;
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
  const roundTimer = document.getElementById('roundTimer');
  const gameStatus = document.getElementById('gameStatus');
  const roomInfo = document.getElementById('roomInfo');
  const attackControls = document.getElementById('attackControls');

  const configPanel = document.getElementById('configPanel');
  const toggleConfigButton = document.getElementById('toggleConfigButton');
  const configSettings = document.getElementById('configSettings');
  const saveConfigButton = document.getElementById('saveConfigButton');
  const maxPlayersInput = document.getElementById('maxPlayersInput');
  const minPlayersInput = document.getElementById('minPlayersInput');
  const maxRoundsInput = document.getElementById('maxRoundsInput');
  const roundTimeInput = document.getElementById('roundTimeInput');
  const gameSpeedInput = document.getElementById('gameSpeedInput');
  const canvasSizeInput = document.getElementById('canvasSizeInput');
  const segmentSizeInput = document.getElementById('segmentSizeInput');
  const countdownInput = document.getElementById('countdownInput');
  const attacksEnabledInput = document.getElementById('attacksEnabledInput');

  const socket = io();
  let gameState = { playing: false, round: 1 };
  let segmentSize = 20;
  let snakes = [];
  let foods = [];
  let projectiles = [];
  let clientProjectiles = [];
  let isConnected = false;
  let isHost = false;
  let currentRoomId = null;
  let roomConfig = {};
  let roomScores = {};
  let roundTimeLeft = 0;

  function lerp(start, end, factor) {
    return start + (end - start) * factor;
  }

  function ClientProjectile(serverProjectile) {
    this.id = serverProjectile.id;
    this.playerId = serverProjectile.playerId;
    this.color = serverProjectile.color;
    this.direction = { ...serverProjectile.direction };
    
    this.targetX = serverProjectile.x;
    this.targetY = serverProjectile.y;
    
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

  const retroColors = {
    snake: ['#00ff41', '#ff0080', '#00ffff', '#ffff00', '#ff4040', '#8040ff', '#40ff80', '#ff8040'],
    background: '#000000',
    grid: '#001100',
    food: '#ff0080',
    foodGlow: '#ff40a0',
    projectile: '#ffff00'
  };

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
    
    drawRetroRect(ctx, x + padding, y + padding, innerSize, innerSize, color);
    
    if (isHead) {
      ctx.strokeStyle = isCurrentPlayer ? '#ffffff' : '#000000';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + padding, y + padding, innerSize, innerSize);
      
      if (direction) {
        drawRetroEyes(ctx, x, y, size, direction);
      }
    }
    
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + padding, y + padding, innerSize, innerSize);
  }

  function drawRetroProjectile(ctx, projectile, segmentSize) {
    const centerX = projectile.renderX + segmentSize / 2;
    const centerY = projectile.renderY + segmentSize / 2;
    const size = segmentSize * 0.6;
    
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(Math.PI / 4);
    
    drawRetroRect(ctx, -size/2, -size/2, size, size, projectile.color || retroColors.projectile, '#ffff80');
    
    ctx.restore();
  }

  function drawRetroEyes(ctx, x, y, size, direction) {
    const eyeSize = Math.max(2, size * 0.2);
    const eyeOffset = size * 0.3;
    
    let leftEyeX, leftEyeY, rightEyeX, rightEyeY;
    
    if (direction.x === 1) {
      leftEyeX = x + size - eyeOffset;
      leftEyeY = y + eyeOffset;
      rightEyeX = x + size - eyeOffset;
      rightEyeY = y + size - eyeOffset;
    } else if (direction.x === -1) {
      leftEyeX = x + eyeOffset;
      leftEyeY = y + eyeOffset;
      rightEyeX = x + eyeOffset;
      rightEyeY = y + size - eyeOffset;
    } else if (direction.y === -1) {
      leftEyeX = x + eyeOffset;
      leftEyeY = y + eyeOffset;
      rightEyeX = x + size - eyeOffset;
      rightEyeY = y + eyeOffset;
    } else {
      leftEyeX = x + eyeOffset;
      leftEyeY = y + size - eyeOffset;
      rightEyeX = x + size - eyeOffset;
      rightEyeY = y + size - eyeOffset;
    }
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(leftEyeX - eyeSize/2, leftEyeY - eyeSize/2, eyeSize, eyeSize);
    ctx.fillRect(rightEyeX - eyeSize/2, rightEyeY - eyeSize/2, eyeSize, eyeSize);
  }

  function drawRetroFood(ctx, food, segmentSize) {
    const padding = 2;
    const size = segmentSize - (padding * 2);
    
    const pulse = Math.sin(Date.now() * 0.01) * 0.1 + 1;
    const pulseSize = size * pulse;
    const offset = (size - pulseSize) / 2;
    
    drawRetroRect(
      ctx, 
      food.x + padding + offset, 
      food.y + padding + offset, 
      pulseSize, 
      pulseSize, 
      retroColors.food, 
      retroColors.foodGlow
    );
    
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.max(8, segmentSize * 0.4)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    const centerX = food.x + segmentSize / 2;
    const centerY = food.y + segmentSize / 2;
    
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeText(food.score, centerX, centerY);
    ctx.fillText(food.score, centerX, centerY);
  }

  document.addEventListener('keydown', handleKeyPress);

  function handleKeyPress(event) {
    const key = event.keyCode;
    
    if (key >= 37 && key <= 40 && isConnected && gameState.playing) {
      event.preventDefault();
      socket.emit('newMove', { key });
    } else if (key === 32 && isConnected && gameState.playing && roomConfig.attacksEnabled) {
      event.preventDefault();
      socket.emit('attack');
    }
  }

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
      serverSnake.direction.y,
	  serverSnake.color,
	  roomConfig.gameSpeed || 91
    );
    
    snake.segments = serverSnake.segments.map(seg => ({ ...seg }));
    snake.targetSegments = serverSnake.segments.map(seg => ({ ...seg }));
    snake.renderSegments = serverSnake.segments.map(seg => ({ ...seg }));
    snake.direction = { ...serverSnake.direction };
    snake.score = serverSnake.score;
    snake.gameover = serverSnake.gameover;
    snake.scoreLeftToGrow = serverSnake.scoreLeftToGrow;
    
    return snake;
  }

  function startRenderLoop() {
    if (renderLoop) return;
    
    function render() {
      if (isGameRunning && gameState.playing) {
        snakes.forEach(snake => {
          if (snake.updateRenderPosition) {
            snake.updateRenderPosition();
          }
        });
        
        clientProjectiles.forEach(projectile => {
          projectile.updateRenderPosition();
        });
        
        gameLoop();
      }
      
      if (isGameRunning) {
        renderLoop = requestAnimationFrame(render);
      }
    }
    
    renderLoop = requestAnimationFrame(render);
  }

  function stopRenderLoop() {
    if (renderLoop) {
      cancelAnimationFrame(renderLoop);
      renderLoop = null;
    }
    isGameRunning = false;
  }

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
        existingSnake.segments = serverPlayer.segments.map(seg => ({ ...seg }));
        existingSnake.targetSegments = serverPlayer.segments.map(seg => ({ ...seg }));
        existingSnake.direction = { ...serverPlayer.direction };
        existingSnake.score = serverPlayer.score;
        existingSnake.gameover = serverPlayer.gameover;
        existingSnake.scoreLeftToGrow = serverPlayer.scoreLeftToGrow;
		existingSnake.color = serverPlayer.color;
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
	snakes.forEach(snake => {
		snake.updateInterpolationSpeed(newConfig.gameSpeed);
	});
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
    
    snakes = data.players.map(serverPlayer => createLocalSnake(serverPlayer));
    foods = data.foods || [];
    projectiles = data.projectiles || [];
    gameState = data.gameState;
    roomConfig = data.config;
    roundTimeLeft = data.gameState.roundTimeLeft || roomConfig.roundTime;
    
    isGameRunning = true;
    startRenderLoop();
    
    hideElement(gameOverScreen);
    hideElement(startGameButton);
    hideElement(configPanel);
    showElement(roundTimer);
    updateRoundTimer(roundTimeLeft);
    showStatus(`Ronda ${data.gameState.round} - ¡Batalla por tiempo!`, 'success');
    console.log(`¡Ronda ${data.gameState.round} iniciada!`);
    
    gameLoop();
  });

  socket.on('countdown', (count, state) => {
    gameState = state;
    showStatus(`Ronda ${state.round} inicia en ${count}...`, 'info');
    updateGameInfo(state);
  });

  // Nuevo: evento para actualizar tiempo de ronda
  socket.on('roundTimeUpdate', (timeLeft) => {
    roundTimeLeft = timeLeft;
    updateRoundTimer(timeLeft);
    
    // Cambiar color del timer cuando queda poco tiempo
    if (timeLeft <= 10) {
      roundTimer.style.color = '#ff4040';
      if (timeLeft <= 5) {
        roundTimer.style.animation = 'shake 0.5s infinite';
      }
    }
  });

  socket.on('gameLogicFrame', (data) => {
	// Ya no detectamos muerte por colisión - las rondas terminan por tiempo
	snakes.forEach(localSnake => {
	const serverSnake = data.players.find(p => p.id === localSnake.id);
		if (serverSnake) {
			// Verificar si hubo portal para esta serpiente
			const portalEvent = data.portals && data.portals.find(p => p.playerId === localSnake.id);

			if (portalEvent) {
				// Portal detectado - saltar directamente sin interpolación
				localSnake.targetSegments = serverSnake.segments.map(seg => ({ ...seg }));
				localSnake.segments = serverSnake.segments.map(seg => ({ ...seg }));
				localSnake.renderSegments = serverSnake.segments.map(seg => ({ ...seg }));
			} else {
				// Movimiento normal con interpolación
				localSnake.targetSegments = serverSnake.segments.map(seg => ({ ...seg }));
				localSnake.segments = serverSnake.segments.map(seg => ({ ...seg }));
			}
			localSnake.direction = { ...serverSnake.direction };
			localSnake.score = serverSnake.score;
			localSnake.gameover = serverSnake.gameover;
			localSnake.scoreLeftToGrow = serverSnake.scoreLeftToGrow;
			localSnake.color = serverSnake.color;
		}
	});    
    const serverProjectiles = data.projectiles || [];
    
    clientProjectiles.forEach(clientProjectile => {
      const serverProjectile = serverProjectiles.find(p => p.id === clientProjectile.id);
      if (serverProjectile) {
        clientProjectile.updateTarget(serverProjectile);
      }
    });
    
    clientProjectiles = clientProjectiles.filter(clientProjectile => 
      serverProjectiles.some(p => p.id === clientProjectile.id)
    );
    
    serverProjectiles.forEach(serverProjectile => {
      if (!clientProjectiles.find(cp => cp.id === serverProjectile.id)) {
        clientProjectiles.push(new ClientProjectile(serverProjectile));
      }
    });
    
    foods = data.foods || [];
    gameState = data.gameState;
    projectiles = data.projectiles || [];
    
    // Actualizar tiempo de ronda si está disponible
    if (data.gameState.roundTimeLeft !== undefined) {
      roundTimeLeft = data.gameState.roundTimeLeft;
      updateRoundTimer(roundTimeLeft);
    }
  });

  socket.on('roundEnd', (data) => {
    stopRenderLoop();
    roomScores = data.scores;
    hideElement(roundTimer);
    roundTimer.style.color = '#ff4040';
    roundTimer.style.animation = '';
    
    showStatus(`¡Tiempo agotado! Ronda ${data.round} terminada`, 'info');
    if (data.winner) {
      showStatus(`Ganador de la ronda: ${data.winner.name} (${data.winner.score} segmentos)`, 'success');
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
    hideElement(roundTimer);
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
    hideElement(roundTimer);
    showFinalScreen(null, data.finalScores, data.reason);
  });

  socket.on('backToMenuSuccess', () => {
    stopRenderLoop();
    currentRoomId = null;
    isHost = false;
    roomConfig = {};
    hideElement(roundTimer);
    showRoomSelection();
    showStatus('Regresaste al menú', 'info');
  });

  function updateRoundTimer(timeLeft) {
    if (roundTimer) {
      roundTimer.textContent = `Tiempo: ${timeLeft}s`;
    }
  }

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
    roundTimeInput.disabled = !enabled;
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
    roundTimeInput.value = config.roundTime || 45;
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
      roundTime: parseInt(roundTimeInput.value),
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
            ${room.config.maxRounds} rondas • ${room.config.roundTime}s • ${room.config.canvasWidth}x${room.config.canvasHeight} • Velocidad: ${room.config.gameSpeed}ms
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

  function drawGrid() {
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
        const baseColor = snake.color;
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

    if (foods && foods.length > 0) {
      foods.forEach(food => {
        drawRetroFood(ctx, food, segmentSize);
      });
    }

    if (clientProjectiles && clientProjectiles.length > 0) {
      clientProjectiles.forEach(projectile => {
        drawRetroProjectile(ctx, projectile, segmentSize);
      });
    }
  }

  function gameLoop() {
    ctx.fillStyle = retroColors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    drawGrid();
    drawPlayers();
    updatePlayerList(snakes);
  }

  function updatePlayerList(players) {
    playerList.innerHTML = '';
    
    // Modificado: Ordenar por puntaje actual (tamaño de snake) durante el juego
    const sortedPlayers = players.sort((a, b) => {
      if (gameState.playing) {
        return b.score - a.score; // Puntaje = tamaño de la snake
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
        score.textContent = player.score + ' segs'; // Mostrar tamaño de snake
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

  window.joinSpecificRoom = function(roomId) {
    const username = usernameInput.value.trim();
    if (!username || username.length < 2 || username.length > 20) {
      showStatus('Por favor ingresa un nombre válido (2-20 caracteres)', 'error');
      usernameInput.focus();
      return;
    }
    socket.emit('joinRoom', { roomId, username });
  };

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

  roomIdInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  handleResize();
  showStatus('¡Conectado! Ingresa tu nombre para comenzar.', 'info');
});