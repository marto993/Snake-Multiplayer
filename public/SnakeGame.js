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
  const attacksEnabledInput = document.getElementById('attacksEnabledInput');
  
  // NUEVO: Inputs para configuración de consumibles modificados
  const immunityEnabledInput = document.getElementById('immunityEnabledInput');
  const immunityIntervalInput = document.getElementById('immunityIntervalInput');
  const immunityDurationInput = document.getElementById('immunityDurationInput');

  // Persistence variables
  let playerProfile = null;
  let currentPlayerId = null;

  const socket = io();
  let gameState = { playing: false, round: 1 };
  let segmentSize = 20; // MODIFICADO: nuevo valor por defecto
  let snakes = [];
  let foods = [];
  let consumables = [];
  let projectiles = [];
  let clientProjectiles = [];
  let isConnected = false;
  let isHost = false;
  let currentRoomId = null;
  let roomConfig = {};
  let roomScores = {};
  let roundTimeLeft = 0;

  // MODIFICADO: Colores y estilos para consumibles (sin símbolo, solo efecto visual)
  const consumableStyles = {
    immunity: {
      color: '#0101FF',
      glowColor: '#1F1FEF',
      name: 'Inmunidad'
    }
  };

  // localStorage functions
  function savePlayerProfile(profile) {
    try {
      localStorage.setItem('snakePlayerProfile', JSON.stringify(profile));
      localStorage.setItem('snakePlayerId', profile.playerId);
    } catch (error) {
      console.log('Error saving profile:', error);
    }
  }

  function loadPlayerProfile() {
    try {
      const savedProfile = localStorage.getItem('snakePlayerProfile');
      const savedPlayerId = localStorage.getItem('snakePlayerId');
      
      if (savedProfile && savedPlayerId) {
        const profile = JSON.parse(savedProfile);
        return { ...profile, playerId: savedPlayerId };
      }
    } catch (error) {
      console.log('Error loading profile:', error);
    }
    return null;
  }

  function clearPlayerProfile() {
    localStorage.removeItem('snakePlayerProfile');
    localStorage.removeItem('snakePlayerId');
    playerProfile = null;
    currentPlayerId = null;
  }

  function initializeUserInterface() {
    const savedProfile = loadPlayerProfile();
    if (savedProfile && savedProfile.stats) {
      usernameInput.value = savedProfile.stats.name;
      playerProfile = savedProfile;
      currentPlayerId = savedProfile.playerId;
      
      showStatus('Verificando sesión...', 'info');
      socket.emit('getOrCreateProfile', { 
        username: savedProfile.stats.name, 
        playerId: savedProfile.playerId 
      });
    } else {
      showElement(document.getElementById('loginView'));
      hideElement(document.getElementById('profileView'));
      hideElement(document.getElementById('roomSelection'));
      updateLogoutButtonVisibility();
      showStatus('¡Conectado! Ingresa tu nombre para comenzar.', 'info');
    }
  }

  function updateLogoutButtonVisibility() {
    const logoutButton = document.getElementById('resetProfileButton');
    if (logoutButton) {
      if (playerProfile && currentPlayerId) {
        showElement(logoutButton);
      } else {
        hideElement(logoutButton);
      }
    }
  }

  function updateProfileDisplay(stats) {
    const profileInfo = document.getElementById('profileInfo');
    if (profileInfo && stats) {
      profileInfo.innerHTML = `
        <div class="profile-stats">
          <strong>📊 ${stats.name}</strong><br>
          <span>🎮 ${stats.games_played} partidas</span><br>
          <span>🏆 ${stats.wins} victorias</span><br>
          <span>🔥 Racha: ${stats.current_streak}</span><br>
          <span>⭐ Mejor: ${stats.best_score}</span>
        </div>
      `;
    }
  }

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

  // MODIFICADO: drawRetroSnakeSegment con efecto de inmunidad
  function drawRetroSnakeSegment(ctx, x, y, size, color, isHead = false, direction = null, isCurrentPlayer = false, hasImmunity = false) {
    const padding = 1;
    const innerSize = size - (padding * 2);
    
    // NUEVO: Efecto de sombra azulada pulsante para inmunidad
    if (hasImmunity) {
      const pulseIntensity = (Math.sin(Date.now() * 0.008) + 1) * 0.5; // Pulso lento pero notorio
      const glowSize = 4 + (pulseIntensity * 3);
      const glowAlpha = 0.3 + (pulseIntensity * 0.4);
      
      // Sombra azulada exterior
      ctx.shadowColor = `rgba(100, 150, 255, ${glowAlpha})`;
      ctx.shadowBlur = glowSize;
      ctx.fillStyle = color;
      ctx.fillRect(x + padding, y + padding, innerSize, innerSize);
      
      // Brillo sutil adicional
      ctx.shadowColor = `rgba(150, 200, 255, ${glowAlpha * 0.7})`;
      ctx.shadowBlur = glowSize * 1.5;
      ctx.fillRect(x + padding, y + padding, innerSize, innerSize);
      
      // Limpiar sombra
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    }
    
    // Dibujar segmento normal
    drawRetroRect(ctx, x + padding, y + padding, innerSize, innerSize, color);
    
    if (isHead) {
      ctx.strokeStyle = '#000000';//isCurrentPlayer ? '#ffffff' : '#000000';
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

  // Escudo con Path2D
	function drawShield(ctx, centerX, centerY, size, color, glowColor) {
	  const shield = new Path2D();
	  const width = size * 1.2;
	  const height = size * 1.5;
	  
	  // Contorno del escudo
	  shield.moveTo(centerX, centerY - height/2);
	  shield.quadraticCurveTo(centerX + width/2, centerY - height/2, centerX + width/2, centerY);
	  shield.quadraticCurveTo(centerX + width/2, centerY + height/3, centerX, centerY + height/2);
	  shield.quadraticCurveTo(centerX - width/2, centerY + height/3, centerX - width/2, centerY);
	  shield.quadraticCurveTo(centerX - width/2, centerY - height/2, centerX, centerY - height/2);
	  
	  if (glowColor) {
		ctx.shadowColor = glowColor;
		ctx.shadowBlur = 8;
	  }
	  
	  ctx.fillStyle = color;
	  ctx.fill(shield);
	  ctx.strokeStyle = '#ffffff';
	  ctx.lineWidth = 2;
	  ctx.stroke(shield);
	  ctx.shadowBlur = 0;
	  ctx.strokeStyle = '#000000';
	  ctx.lineWidth = 0;
	}

	// Rayo/Lightning
	function drawLightning(ctx, centerX, centerY, size, color, glowColor) {
	  const lightning = new Path2D();
	  const width = size * 0.8;
	  const height = size * 1.4;
	  
	  lightning.moveTo(centerX - width/3, centerY - height/2);
	  lightning.lineTo(centerX + width/3, centerY - height/2);
	  lightning.lineTo(centerX - width/6, centerY - height/6);
	  lightning.lineTo(centerX + width/2, centerY - height/6);
	  lightning.lineTo(centerX - width/4, centerY + height/6);
	  lightning.lineTo(centerX + width/6, centerY + height/6);
	  lightning.lineTo(centerX - width/3, centerY + height/2);
	  lightning.lineTo(centerX - width/6, centerY + height/6);
	  lightning.lineTo(centerX - width/2, centerY + height/6);
	  lightning.lineTo(centerX + width/4, centerY - height/6);
	  lightning.closePath();
	  
	  if (glowColor) {
		ctx.shadowColor = glowColor;
		ctx.shadowBlur = 10;
	  }
	  
	  ctx.fillStyle = color;
	  ctx.fill(lightning);
	  ctx.shadowBlur = 0;
	}

	// Corazón
	function drawHeart(ctx, centerX, centerY, size, color, glowColor) {
	  const heart = new Path2D();
	  const width = size;
	  const height = size;
	  
	  heart.moveTo(centerX, centerY + height/4);
	  heart.bezierCurveTo(centerX, centerY, centerX - width/2, centerY - height/2, centerX - width/4, centerY - height/4);
	  heart.bezierCurveTo(centerX - width/8, centerY - height/2, centerX + width/8, centerY - height/2, centerX + width/4, centerY - height/4);
	  heart.bezierCurveTo(centerX + width/2, centerY - height/2, centerX, centerY, centerX, centerY + height/4);
	  
	  if (glowColor) {
		ctx.shadowColor = glowColor;
		ctx.shadowBlur = 8;
	  }
	  
	  ctx.fillStyle = color;
	  ctx.fill(heart);
	  ctx.strokeStyle = '#ffffff';
	  ctx.lineWidth = 1;
	  ctx.stroke(heart);
	  ctx.shadowBlur = 0;
	  ctx.strokeStyle = '#000000';
	  ctx.lineWidth = 0;
	}
	function drawHexagon(ctx, centerX, centerY, radius, color, glowColor) {
	  const sides = 6;
	  const angle = (Math.PI * 2) / sides;
	  
	  ctx.beginPath();
	  
	  for (let i = 0; i <= sides; i++) {
		const x = centerX + Math.cos(i * angle) * radius;
		const y = centerY + Math.sin(i * angle) * radius;
		
		if (i === 0) {
		  ctx.moveTo(x, y);
		} else {
		  ctx.lineTo(x, y);
		}
	  }
	  
	  ctx.closePath();
	  
	  // Efecto de brillo
	  if (glowColor) {
		ctx.shadowColor = glowColor;
		ctx.shadowBlur = 8;
	  }
	  
	  ctx.fillStyle = color;
	  ctx.fill();
	  
	  // Borde más marcado
	  ctx.strokeStyle = '#ffffff';
	  ctx.lineWidth = 2;
	  ctx.stroke();
	  
	  // Limpiar sombra y borde
	  ctx.shadowBlur = 0;
	  ctx.shadowColor = 'transparent';
	  ctx.strokeStyle = '#000000';
	  ctx.lineWidth = 0;
	}
	// Función de doble capa para efectos visuales avanzados
	function drawLayeredConsumable(ctx, centerX, centerY, size, baseColor, accentColor, glowColor) {
	  const pulse = Math.sin(Date.now() * 0.01) * 0.2 + 1;
	  
	  // Capa exterior (más grande, transparente)
	  ctx.globalAlpha = 0.3;
	  drawHexagon(ctx, centerX, centerY, size * pulse * 1.3, accentColor, glowColor);
	  
	  // Capa interior (sólida)
	  ctx.globalAlpha = 1;
	  drawHexagon(ctx, centerX, centerY, size * pulse, baseColor, glowColor);
	  
	  // Núcleo brillante
	  ctx.globalAlpha = 0.8;
	  drawHexagon(ctx, centerX, centerY, size * 0.4, '#ffffff', '#ffffff');
	  ctx.globalAlpha = 1;
	}

	// Versión actualizada con formas complejas
	function drawRetroConsumable(ctx, consumable, segmentSize) {
	  const style = consumableStyles[consumable.type];
	  if (!style) return;
	  
	  const centerX = consumable.x + segmentSize / 2;
	  const centerY = consumable.y + segmentSize / 2;
	  const pulse = Math.sin(Date.now() * 0.008) * 0.15 + 1;
	  const size = (segmentSize * 0.35) * pulse;
	  
	  switch(consumable.type) {
		case 'immunity':
			drawLayeredConsumable(ctx, centerX, centerY, size, style.color, '#c080ff', style.glowColor);
			//drawShield(ctx, centerX, centerY, size, style.color, style.glowColor);
			break;
		  
		case 'speed':
		  drawLightning(ctx, centerX, centerY, size, '#ffff00', '#ffff80');
		  break;
		  
		case 'health':
		  drawHeart(ctx, centerX, centerY, size, '#ff4040', '#ff8080');
		  break;
		  
		case 'power':
		  drawLayeredConsumable(ctx, centerX, centerY, size, '#8040ff', '#c080ff', '#ff80ff');
		  break;
		  
		default:
		  drawHexagon(ctx, centerX, centerY, size, style.color, style.glowColor);
	  }
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
    
    // Sincronizar consumible activo
    snake.activeConsumable = serverSnake.activeConsumable;
    
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
    
    if (data.playerProfile) {
      playerProfile = data.playerProfile;
      currentPlayerId = data.playerProfile.playerId;
      savePlayerProfile(data.playerProfile);
      updateProfileDisplay(data.playerProfile.stats);
    }
    
    showGameInterface();
    updateConfigPanel();
    updateAttackControls();
    showStatus(`¡Sala ${data.roomId} creada!`, 'success');
  });

  socket.on('roomJoined', (data) => {
    currentRoomId = data.roomId;
    isHost = data.isHost;
    roomConfig = data.config;
    
    if (data.playerProfile) {
      playerProfile = data.playerProfile;
      currentPlayerId = data.playerProfile.playerId;
      savePlayerProfile(data.playerProfile);
      updateProfileDisplay(data.playerProfile.stats);
    }
    
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
        existingSnake.activeConsumable = serverPlayer.activeConsumable;
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
    consumables = data.consumables || [];
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

  socket.on('roundTimeUpdate', (timeLeft) => {
    roundTimeLeft = timeLeft;
    updateRoundTimer(timeLeft);
    
    if (timeLeft <= 10) {
      roundTimer.style.color = '#ff4040';
      if (timeLeft <= 5) {
        roundTimer.style.animation = 'shake 0.5s infinite';
      }
    }
  });

  // MODIFICADO: gameLogicFrame para manejar consumibles basados en tiempo
  socket.on('gameLogicFrame', (data) => {
	snakes.forEach(localSnake => {
	const serverSnake = data.players.find(p => p.id === localSnake.id);
		if (serverSnake) {
			const portalEvent = data.portals && data.portals.find(p => p.playerId === localSnake.id);

			if (portalEvent) {
				localSnake.targetSegments = serverSnake.segments.map(seg => ({ ...seg }));
				localSnake.segments = serverSnake.segments.map(seg => ({ ...seg }));
				localSnake.renderSegments = serverSnake.segments.map(seg => ({ ...seg }));
			} else {
				localSnake.targetSegments = serverSnake.segments.map(seg => ({ ...seg }));
				localSnake.segments = serverSnake.segments.map(seg => ({ ...seg }));
			}
			localSnake.direction = { ...serverSnake.direction };
			localSnake.score = serverSnake.score;
			localSnake.gameover = serverSnake.gameover;
			localSnake.scoreLeftToGrow = serverSnake.scoreLeftToGrow;
			localSnake.color = serverSnake.color;
            
            // Actualizar consumible activo
            localSnake.activeConsumable = serverSnake.activeConsumable;
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
    consumables = data.consumables || [];
    gameState = data.gameState;
    projectiles = data.projectiles || [];
    
    if (data.consumableEvents && data.consumableEvents.length > 0) {
      data.consumableEvents.forEach(event => {
        const style = consumableStyles[event.consumableType];
        if (style) {
          showStatus(`${event.playerName} obtuvo ${style.name}!`, 'success');
        }
      });
    }
    
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
    
    if (currentPlayerId) {
      socket.emit('getPlayerStats', currentPlayerId);
    }
    
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

  socket.on('playerStats', (data) => {
    if (data.playerId === currentPlayerId) {
      playerProfile = data;
      savePlayerProfile(data);
      updateProfileDisplay(data.stats);
    }
  });

  socket.on('profileLoaded', (profile) => {
    playerProfile = profile;
    currentPlayerId = profile.playerId;
    savePlayerProfile(profile);
    updateProfileDisplay(profile.stats);
    
    hideElement(document.getElementById('loginView'));
    showElement(document.getElementById('profileView'));
    showElement(document.getElementById('roomSelection'));
    hideElement(document.getElementById('gameInterface'));
    updateLogoutButtonVisibility();
    showStatus(`¡Bienvenido, ${profile.stats.name}!`, 'success');
  });

  socket.on('profileError', (message) => {
    showStatus(message, 'error');
    
    clearPlayerProfile();
    usernameInput.value = '';
    showElement(document.getElementById('loginView'));
    hideElement(document.getElementById('profileView'));
    hideElement(document.getElementById('roomSelection'));
    updateLogoutButtonVisibility();
  });

  socket.on('leaderboard', (leaderboard) => {
    showLeaderboard(leaderboard);
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
    attacksEnabledInput.disabled = !enabled;
    
    // NUEVO: Habilitar/deshabilitar inputs de consumibles
    if (immunityEnabledInput) immunityEnabledInput.disabled = !enabled;
    if (immunityIntervalInput) immunityIntervalInput.disabled = !enabled;
    if (immunityDurationInput) immunityDurationInput.disabled = !enabled;
  }

  // MODIFICADO: updateConfigInputs para nuevos controles
  function updateConfigInputs(config) {
    maxPlayersInput.value = config.maxPlayers;
    minPlayersInput.value = config.minPlayers;
    maxRoundsInput.value = config.maxRounds;
    roundTimeInput.value = config.roundTime || 30; // MODIFICADO: nuevo default 30s
    gameSpeedInput.value = config.gameSpeed;
    segmentSizeInput.value = config.segmentSize;
    attacksEnabledInput.checked = config.attacksEnabled !== undefined ? config.attacksEnabled : true; // MODIFICADO: default true
    
    const canvasSize = `${config.canvasWidth}x${config.canvasHeight}`;
    canvasSizeInput.value = canvasSize;
    
    // NUEVO: Configuración de consumibles
    if (config.consumables && config.consumables.immunity) {
      if (immunityEnabledInput) immunityEnabledInput.checked = config.consumables.immunity.enabled !== false;
      if (immunityIntervalInput) immunityIntervalInput.value = config.consumables.immunity.spawnInterval || 13;
      if (immunityDurationInput) immunityDurationInput.value = config.consumables.immunity.duration || 5;
    }
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

  // MODIFICADO: saveConfiguration para nuevos controles
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
      attacksEnabled: attacksEnabledInput.checked,
      // NUEVO: Configuración de consumibles modificada
      consumables: {
        immunity: {
          enabled: immunityEnabledInput ? immunityEnabledInput.checked : true,
          spawnInterval: immunityIntervalInput ? parseInt(immunityIntervalInput.value) : 13,
          duration: immunityDurationInput ? parseInt(immunityDurationInput.value) : 5
        }
      }
    };

    if (newConfig.minPlayers > newConfig.maxPlayers) {
      showStatus('Los jugadores mínimos no pueden exceder los máximos', 'error');
      return;
    }

    socket.emit('updateRoomConfig', newConfig);
  }

  function showRoomSelection() {
    showElement(document.getElementById('roomSelection'));
    hideElement(document.getElementById('gameInterface'));
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
      // MODIFICADO: Mostrar indicador de consumibles si están habilitados
      const consumablesStatus = (room.config.consumables && room.config.consumables.immunity && room.config.consumables.immunity.enabled) ? '🛡️' : '';
      roomItem.innerHTML = `
        <div class="room-info">
          <strong>Sala: ${room.id}</strong> ${attacksStatus}${consumablesStatus}<br>
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

  // MODIFICADO: drawPlayers con efecto de inmunidad
  function drawPlayers() {
    snakes.forEach((snake, index) => {
      if (!snake.gameover && snake.getRenderSegments) {
        const isCurrentPlayer = snake.id === socket.id;
        const baseColor = snake.color;
        const renderSegments = snake.getRenderSegments();
        
        // NUEVO: Verificar si tiene inmunidad activa
        const hasImmunity = snake.activeConsumable && 
                           snake.activeConsumable.type === 'immunity' && 
                           Date.now() < snake.activeConsumable.endTime;
        
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
            isCurrentPlayer,
            hasImmunity // NUEVO: Pasar estado de inmunidad
          );
        });
      }
    });

    if (foods && foods.length > 0) {
      foods.forEach(food => {
        drawRetroFood(ctx, food, segmentSize);
      });
    }

    if (consumables && consumables.length > 0) {
      consumables.forEach(consumable => {
        drawRetroConsumable(ctx, consumable, segmentSize);
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

  // MODIFICADO: updatePlayerList para mostrar consumibles activos
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
        score.textContent = player.score + ' segs';
      } else {
        const totalScore = (roomScores && roomScores[player.id]) ? roomScores[player.id].totalScore : 0;
        const roundWins = (roomScores && roomScores[player.id]) ? roomScores[player.id].roundWins : 0;
        score.innerHTML = `${totalScore}<br><small>${roundWins}V</small>`;
      }
      
      const status = document.createElement('span');
      status.className = 'player-status';
      
      // MODIFICADO: Mostrar estado del consumible activo + estado del jugador
      let statusText = player.gameover ? '💀' : '🐍';
      if (player.activeConsumable && !player.gameover) {
        if (player.activeConsumable.type === 'immunity' && Date.now() < player.activeConsumable.endTime) {
          statusText = '🛡️'; // Icono de inmunidad
        }
      }
      status.textContent = statusText;
      
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

  function resetPlayerProfile() {
    socket.emit('logout', { currentRoomId });
    
    clearPlayerProfile();
    usernameInput.value = '';
    const profileInfo = document.getElementById('profileInfo');
    if (profileInfo) {
      profileInfo.innerHTML = '<div class="profile-stats"><span>Ingresa tu nombre para ver estadísticas</span></div>';
    }
    
    showElement(document.getElementById('loginView'));
    hideElement(document.getElementById('profileView'));
    hideElement(document.getElementById('roomSelection'));
    hideElement(document.getElementById('gameInterface'));
    updateLogoutButtonVisibility();
    showStatus('Sesión cerrada.', 'info');
  }

  function showGameInterface() {
    hideElement(document.getElementById('roomSelection'));
    showElement(document.getElementById('gameInterface'));
  }

  function requestLeaderboard() {
    socket.emit('getLeaderboard');
  }

  function showLeaderboard(leaderboard) {
    const leaderboardModal = document.getElementById('leaderboardModal');
    const leaderboardList = document.getElementById('leaderboardList');
    
    if (leaderboardModal && leaderboardList) {
		  leaderboardList.innerHTML = '';
		  
		  const sortedLeaderboard = leaderboard.sort((a, b) => {
			const aHasMinGames = a.games_played >= 3;
			const bHasMinGames = b.games_played >= 3;
			
			if (aHasMinGames && bHasMinGames) {
			  const aWinRate = a.games_played > 0 ? (a.wins / a.games_played) : 0;
			  const bWinRate = b.games_played > 0 ? (b.wins / b.games_played) : 0;
			  
			  if (aWinRate !== bWinRate) {
				return bWinRate - aWinRate;
			  }
			  return b.wins - a.wins;
			}
			
			if (!aHasMinGames && !bHasMinGames) {
			  if (a.wins !== b.wins) {
				return b.wins - a.wins;
			  }
			  return b.games_played - a.games_played;
			}
			
			if (aHasMinGames && !bHasMinGames) {
			  return -1;
			}
			if (!aHasMinGames && bHasMinGames) {
			  return 1;
			}
			
			return 0;
		  });
		  
		  sortedLeaderboard.forEach((player, index) => {
			const item = document.createElement('li');
			item.className = 'leaderboard-item';
			item.innerHTML = `
			  <span class="rank">#${index + 1}</span>
			  <span class="name">${player.name}</span>
			  <span class="wins">${player.wins}V</span>
			  <span class="games">${player.games_played}P</span>
			  <span class="winrate">${player.games_played > 0 ? Math.round((player.wins / player.games_played) * 100) : 0}%</span>
			`;
			leaderboardList.appendChild(item);
		  });
		  
		  showElement(leaderboardModal);
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
    
    const dataToSend = { roomId, username };
    if (currentPlayerId && playerProfile && playerProfile.stats.name.toLowerCase() === username.toLowerCase()) {
      dataToSend.playerId = currentPlayerId;
    } else {
      currentPlayerId = null;
    }
    
    socket.emit('joinRoom', dataToSend);
  };

  window.resetPlayerProfile = resetPlayerProfile;

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
    const username = usernameInput.value.trim();
    if (username && username.length >= 2 && username.length <= 20) {
      const dataToSend = { username };
      if (currentPlayerId && playerProfile && playerProfile.stats.name.toLowerCase() === username.toLowerCase()) {
        dataToSend.playerId = currentPlayerId;
      } else {
        currentPlayerId = null;
      }
      
      showStatus('Cargando perfil...', 'info');
      socket.emit('getOrCreateProfile', dataToSend);
    } else {
      showStatus('El nombre debe tener 2-20 caracteres', 'error');
      usernameInput.focus();
    }
  });

  createRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (username && username.length >= 2 && username.length <= 20) {
      const dataToSend = { username };
      if (currentPlayerId && playerProfile && playerProfile.stats.name.toLowerCase() === username.toLowerCase()) {
        dataToSend.playerId = currentPlayerId;
      } else {
        currentPlayerId = null;
      }
      
      socket.emit('createRoom', dataToSend);
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
    
    const dataToSend = { roomId, username };
    if (currentPlayerId && playerProfile && playerProfile.stats.name.toLowerCase() === username.toLowerCase()) {
      dataToSend.playerId = currentPlayerId;
    } else {
      currentPlayerId = null;
    }
    
    socket.emit('joinRoom', dataToSend);
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

  document.getElementById('leaderboardButton').addEventListener('click', () => {
    requestLeaderboard();
  });

  document.getElementById('loginLeaderboardButton').addEventListener('click', () => {
    requestLeaderboard();
  });

  document.getElementById('closeLeaderboardModal').addEventListener('click', () => {
    hideElement(document.getElementById('leaderboardModal'));
  });

  roomIdInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  initializeUserInterface();
  handleResize();
});