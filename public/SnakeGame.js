document.addEventListener("DOMContentLoaded", function() {
  let renderLoop = null;
  let isGameRunning = false;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  
  // Canvas de información
  const infoCanvas = document.getElementById("infoCanvas");
  const infoCtx = infoCanvas.getContext("2d");
  const infoCanvasContainer = document.getElementById("infoCanvasContainer");
  
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
  const roomInfo = document.getElementById('roomInfo');

  const configPanel = document.getElementById('configPanel');
  const toggleConfigButton = document.getElementById('toggleConfigButton');
  const configSettings = document.getElementById('configSettings');
  const saveConfigButton = document.getElementById('saveConfigButton');
  
  const maxPlayersInput = document.getElementById('maxPlayersInput');
  const minPlayersInput = document.getElementById('minPlayersInput');
  const gameSpeedInput = document.getElementById('gameSpeedInput');
  const segmentSizeInput = document.getElementById('segmentSizeInput');
  
  const immunityEnabledInput = document.getElementById('immunityEnabledInput');
  const immunityIntervalInput = document.getElementById('immunityIntervalInput');
  const immunityDurationInput = document.getElementById('immunityDurationInput');

  // NUEVO: Elementos para sistema de invitaciones
  const onlinePlayersPanel = document.getElementById('onlinePlayersPanel');
  const onlinePlayersList = document.getElementById('onlinePlayersList');

  // Sistema de notificaciones en canvas
  let canvasNotifications = [];
  
  function CanvasNotification(message, type = 'info', duration = 3000) {
    this.message = message;
    this.type = type;
    this.duration = duration;
    this.createdAt = Date.now();
    this.alpha = 0;
    this.y = -50; // Empieza arriba, fuera del canvas
    this.targetY = 0;
    this.animationPhase = 'entering'; // 'entering', 'showing', 'exiting'
    this.id = Math.random().toString(36).substring(2, 9);
    
    // Calcular posición Y basada en notificaciones existentes
    const existingNotifications = canvasNotifications.filter(n => n.animationPhase !== 'exiting');
    this.targetY = existingNotifications.length * 45 + 20;
    
    // Configurar colores según tipo
    switch(type) {
      case 'success':
        this.backgroundColor = 'rgba(63, 185, 80, 0.9)';
        this.textColor = '#ffffff';
        this.borderColor = '#3fb950';
        break;
      case 'error':
        this.backgroundColor = 'rgba(248, 81, 73, 0.9)';
        this.textColor = '#ffffff';
        this.borderColor = '#f85149';
        break;
      case 'invitation':
        this.backgroundColor = 'rgba(88, 166, 255, 0.9)';
        this.textColor = '#ffffff';
        this.borderColor = '#58a6ff';
        break;
      case 'info':
      default:
        this.backgroundColor = 'rgba(88, 166, 255, 0.9)';
        this.textColor = '#ffffff';
        this.borderColor = '#58a6ff';
        break;
    }
  }
  
  CanvasNotification.prototype.update = function() {
    const now = Date.now();
    const elapsed = now - this.createdAt;
    
    if (this.animationPhase === 'entering') {
      // Animación de entrada (primeros 300ms)
      const progress = Math.min(elapsed / 300, 1);
      this.alpha = progress;
      this.y = this.lerp(-50, this.targetY, this.easeOut(progress));
      
      if (progress >= 1) {
        this.animationPhase = 'showing';
      }
    } else if (this.animationPhase === 'showing') {
      // Mostrando (duración - 600ms para entrada y salida)
      this.alpha = 1;
      this.y = this.targetY;
      
      if (elapsed >= this.duration - 300) {
        this.animationPhase = 'exiting';
      }
    } else if (this.animationPhase === 'exiting') {
      // Animación de salida (últimos 300ms)
      const exitProgress = (elapsed - (this.duration - 300)) / 300;
      this.alpha = 1 - exitProgress;
      this.y = this.lerp(this.targetY, -50, this.easeIn(exitProgress));
      
      if (exitProgress >= 1) {
        return false; // Marcar para eliminación
      }
    }
    
    return true; // Continuar mostrando
  };
  
  CanvasNotification.prototype.lerp = function(start, end, factor) {
    return start + (end - start) * factor;
  };
  
  CanvasNotification.prototype.easeOut = function(t) {
    return 1 - Math.pow(1 - t, 3);
  };
  
  CanvasNotification.prototype.easeIn = function(t) {
    return t * t * t;
  };
  
  CanvasNotification.prototype.draw = function(context) {
    if (this.alpha <= 0) return;
    
    context.save();
    context.globalAlpha = this.alpha;
    
    // Configurar fuente
    context.font = '400 16px Share Tech Mono, monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    
    // Medir texto para dimensiones del toast
    const textWidth = context.measureText(this.message).width;
    const padding = 20;
    const toastWidth = textWidth + (padding * 2);
    const toastHeight = 35;
    const x = (context.canvas.width - toastWidth) / 2;
    
    // Dibujar fondo del toast
    context.fillStyle = this.backgroundColor;
    this.roundRect(context, x, this.y, toastWidth, toastHeight, 8);
    context.fill();
    
    // Dibujar borde
    context.strokeStyle = this.borderColor;
    context.lineWidth = 2;
    context.stroke();
    
    // Dibujar texto
    context.fillStyle = this.textColor;
    context.fillText(this.message, context.canvas.width / 2, this.y + toastHeight / 2);
    
    context.restore();
  };
  
  CanvasNotification.prototype.roundRect = function(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  };
  
  function addCanvasNotification(message, type = 'info', duration = 3000) {
    if (!message || message.trim() === '') return;
    
    // Marcar todas las notificaciones existentes para salida inmediata
    canvasNotifications.forEach(notif => {
      if (notif.animationPhase !== 'exiting') {
        notif.animationPhase = 'exiting';
        notif.createdAt = Date.now() - (notif.duration - 300); // Forzar inicio de salida
      }
    });
    
    const notification = new CanvasNotification(message.trim(), type, duration);
    notification.targetY = 20; // Siempre en la primera posición
    canvasNotifications.push(notification);
  }
  
  function updateCanvasNotifications() {
    canvasNotifications = canvasNotifications.filter(notification => notification.update());
  }
  
  function drawCanvasNotifications(context) {
    canvasNotifications.forEach(notification => {
      notification.draw(context);
    });
  }

  // Persistence variables
  let playerProfile = null;
  let currentPlayerId = null;

  const socket = io();
  let gameState = { playing: false, round: 1 };
  let segmentSize = 20;
  let snakes = [];
  let foods = [];
  let consumables = [];
  let projectiles = [];
  let clientProjectiles = [];
  let isConnected = false;
  let isHost = false;
  let isSpectating = false;
  let currentRoomId = null;
  let roomConfig = {};
  let roomScores = {};
  let roundTimeLeft = 0;

  // NUEVO: Variables para sistema de invitaciones
  let onlinePlayers = [];
  let pendingInvitations = [];

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
      
      //addCanvasNotification('Verificando sesión...', 'info');
      socket.emit('getOrCreateProfile', { 
        username: savedProfile.stats.name, 
        playerId: savedProfile.playerId 
      });
    } else {
      showElement(document.getElementById('loginView'));
      hideElement(document.getElementById('profileView'));
      hideElement(document.getElementById('roomSelection'));
      hideElement(onlinePlayersPanel);
      updateLogoutButtonVisibility();
      addCanvasNotification('¡Conectado! Ingresa tu nombre para comenzar.', 'info');
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

  // NUEVO: Funciones para sistema de invitaciones
  function updateOnlinePlayersList(players) {
    console.log('Actualizando lista de jugadores online:', players); // DEBUG
    onlinePlayers = players || [];
    
    if (!onlinePlayers || onlinePlayers.length === 0) {
      onlinePlayersList.innerHTML = '<li class="online-players-empty">No hay otros jugadores en línea</li>';
      return;
    }
    
    onlinePlayersList.innerHTML = '';
    
    onlinePlayers.forEach(player => {
      const listItem = document.createElement('li');
      listItem.className = 'online-player-item';
      
      const playerInfo = document.createElement('div');
      playerInfo.className = 'online-player-info';
      
      const playerName = document.createElement('div');
      playerName.className = 'online-player-name';
      playerName.textContent = player.name;
      
      const playerStatus = document.createElement('div');
      playerStatus.className = `online-player-status ${player.isInGame ? 'in-game' : 'available'}`;
      playerStatus.textContent = player.isInGame ? 'En partida' : 'Disponible';
      
      playerInfo.appendChild(playerName);
      playerInfo.appendChild(playerStatus);
      listItem.appendChild(playerInfo);
      
      // Mostrar botón invitar solo si: estamos en sala + juego no activo + jugador disponible
      const showInviteButton = currentRoomId && !gameState.playing && player.canInvite;
      
      if (showInviteButton) {
        const inviteButton = document.createElement('button');
        inviteButton.className = 'invite-button';
        inviteButton.textContent = '📩 Invitar';
        inviteButton.disabled = !player.canInvite;
        
        inviteButton.addEventListener('click', () => {
          invitePlayer(player.socketId, player.name);
        });
        
        listItem.appendChild(inviteButton);
      }
      
      onlinePlayersList.appendChild(listItem);
    });
  }

  function invitePlayer(targetSocketId, targetPlayerName) {
    if (!currentRoomId || gameState.playing) {
      addCanvasNotification('No puedes invitar en este momento', 'error');
      return;
    }
    
    socket.emit('invitePlayer', { targetSocketId });
    addCanvasNotification(`Invitación enviada a ${targetPlayerName}`, 'info');
  }

  function handleInvitationReceived(invitationData) {
    const { fromPlayer, roomId } = invitationData;
    
    // Mostrar notificación especial de invitación
    addCanvasNotification(`${fromPlayer} te ha invitado a la sala ${roomId}`, 'invitation', 5000);
    
    // Copiar automáticamente el código de sala al input
    if (roomIdInput) {
      roomIdInput.value = roomId;
      roomIdInput.focus();
      roomIdInput.select();
    }
    
    // Agregar a lista de invitaciones pendientes
    pendingInvitations.push({
      from: fromPlayer,
      roomId: roomId,
      timestamp: Date.now()
    });
    
    console.log(`Invitation received from ${fromPlayer} to room ${roomId}`);
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
    snake: ['#58a6ff', '#a371f7', '#7dd3fc', '#fbbf24', '#f85149', '#c084fc', '#3fb950', '#f97316'],
    background: '#010409',
    grid: '#161b22',
    food: '#a371f7',
    foodGlow: '#c084fc',
    projectile: '#fbbf24'
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

  function drawRetroSnakeSegment(ctx, x, y, size, color, isHead = false, direction = null, isCurrentPlayer = false, hasImmunity = false) {
    const padding = 1;
    const innerSize = size - (padding * 2);
    
    if (hasImmunity) {
      const pulseIntensity = (Math.sin(Date.now() * 0.008) + 1) * 0.6;
      const glowSize = 4 + (pulseIntensity * 3);
      const glowAlpha = 0.6 + (pulseIntensity * 0.4);
      
      ctx.shadowColor = `rgba(120, 170, 255, ${glowAlpha})`;
      ctx.shadowBlur = glowSize;
      ctx.fillStyle = color;
      ctx.fillRect(x + padding, y + padding, innerSize, innerSize);
      
      ctx.shadowColor = `rgba(170, 220, 255, ${glowAlpha * 0.7})`;
      ctx.shadowBlur = glowSize * 1.35;
      ctx.fillRect(x + padding, y + padding, innerSize, innerSize);
      
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
    }
    
    drawRetroRect(ctx, x + padding, y + padding, innerSize, innerSize, color);
    
    if (isHead) {
      ctx.strokeStyle = '#000000';
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
    
    if (glowColor) {
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 8;
    }
    
    ctx.fillStyle = color;
    ctx.fill();
    
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 0;
  }

  function drawLayeredConsumable(ctx, centerX, centerY, size, baseColor, accentColor, glowColor) {
    const pulse = Math.sin(Date.now() * 0.01) * 0.2 + 1;
    
    ctx.globalAlpha = 0.3;
    drawHexagon(ctx, centerX, centerY, size * pulse * 1.3, accentColor, glowColor);
    
    ctx.globalAlpha = 1;
    drawHexagon(ctx, centerX, centerY, size * pulse, baseColor, glowColor);
    
    ctx.globalAlpha = 0.8;
    drawHexagon(ctx, centerX, centerY, size * 0.4, '#ffffff', '#ffffff');
    ctx.globalAlpha = 1;
  }

  function drawRetroConsumable(ctx, consumable, segmentSize) {
    const style = consumableStyles[consumable.type];
    if (!style) return;
    
    const centerX = consumable.x + segmentSize / 2;
    const centerY = consumable.y + segmentSize / 2;
    const pulse = Math.sin(Date.now() * 0.008) * 0.15 + 1;
    const size = (segmentSize * 0.45) * pulse;
    
    switch(consumable.type) {
      case 'immunity':
        drawLayeredConsumable(ctx, centerX, centerY, size, style.color, '#c080ff', style.glowColor);
        break;
      default:
        drawHexagon(ctx, centerX, centerY, size, style.color, style.glowColor);
    }
  }

  // Canvas de información con layout de 2 columnas
  function drawInfoCanvas() {
    if (!infoCanvas) return;
    
    // Limpiar canvas
    infoCtx.fillStyle = '#010409';
    infoCtx.fillRect(0, 0, infoCanvas.width, infoCanvas.height);
    
    // Definir las dos secciones
    const leftSectionWidth = 150;
    const rightSectionX = leftSectionWidth + 20;
    const rightSectionWidth = infoCanvas.width - rightSectionX - 20;
    
    // === SECCIÓN IZQUIERDA: RONDA Y TIEMPO ===
    infoCtx.textAlign = 'left';
    
    // Ronda (más pequeña, arriba)
    infoCtx.font = '400 22px Share Tech Mono, monospace';
    infoCtx.fillStyle = '#c9d1d9';
    infoCtx.fillText(`RONDA ${gameState.round}/3`, 20, 32);
    
    // Tiempo (más grande, destacado, abajo)
    infoCtx.font = '400 28px Share Tech Mono, monospace';
    const timeColor = roundTimeLeft <= 10 ? '#f85149' : roundTimeLeft <= 20 ? '#d29922' : '#58a6ff';
    infoCtx.fillStyle = timeColor;
    infoCtx.fillText(`${roundTimeLeft}s`, 20, 75);
    
    // === LÍNEA DIVISORIA VERTICAL ===
    infoCtx.strokeStyle = '#30363d';
    infoCtx.lineWidth = 1;
    infoCtx.beginPath();
    infoCtx.moveTo(leftSectionWidth, 10);
    infoCtx.lineTo(leftSectionWidth, infoCanvas.height - 10);
    infoCtx.stroke();
    
    // === SECCIÓN DERECHA: PUNTAJES DE JUGADORES ===
    if (snakes && snakes.length > 0) {
      const sortedSnakes = [...snakes].sort((a, b) => {
        if (gameState.playing) {
          return b.score - a.score;
        } else {
          const aTotal = (roomScores && roomScores[a.id]) ? roomScores[a.id].totalScore : 0;
          const bTotal = (roomScores && roomScores[b.id]) ? roomScores[b.id].totalScore : 0;
          return bTotal - aTotal;
        }
      });
      
      // Calcular layout optimizado - más jugadores por fila
      const maxPlayersPerRow = Math.min(16, sortedSnakes.length);
      const totalRows = Math.ceil(sortedSnakes.length / maxPlayersPerRow);
      const playerWidth = rightSectionWidth / maxPlayersPerRow;
      const playerHeight = Math.max(40, (infoCanvas.height - 20) / totalRows);
      const startY = 40;
      
      sortedSnakes.forEach((snake, index) => {
        const row = Math.floor(index / maxPlayersPerRow);
        const col = index % maxPlayersPerRow;
        const x = rightSectionX + (col * playerWidth) + 10;
        const y = startY + (row * playerHeight);
        
        const isCurrentPlayer = snake.id === socket.id;
        
        // Usar el color de la snake del jugador
        let textColor = snake.color || '#58a6ff';
        
        // Nombre del jugador con ranking
        infoCtx.font = '400 18px Share Tech Mono, monospace';
        infoCtx.fillStyle = textColor;
        infoCtx.textAlign = 'left';
        
        // Truncar nombre según espacio disponible
        const maxNameLength = Math.floor(playerWidth / 10);
        const playerName = snake.name.length > maxNameLength ? snake.name.substring(0, maxNameLength - 1) + '…' : snake.name;
        infoCtx.fillText(`#${index + 1} ${playerName}`, x, y);
        
        // Puntajes en línea separada
        infoCtx.font = '400 16px Share Tech Mono, monospace';
        if (gameState.playing) {
          infoCtx.fillText(`${snake.score} segs`, x, y + 16);
        } else {
          const totalScore = (roomScores && roomScores[snake.id]) ? roomScores[snake.id].totalScore : 0;
          const roundWins = (roomScores && roomScores[snake.id]) ? roomScores[snake.id].roundWins : 0;
          infoCtx.fillText(`${totalScore} segs (${roundWins}V)`, x, y + 16);
        }
      });
    }
    
    // Dibujar notificaciones en el canvas de información
    updateCanvasNotifications();
    drawCanvasNotifications(infoCtx);
  }

  document.addEventListener('keydown', handleKeyPress);

	function handleKeyPress(event) {
	  // No permitir controles si se está espectando
	  if (isSpectating) return;
	  
	  const key = event.keyCode;
	  
	  // Flechas (37-40) o WASD (87,65,83,68)
	  if ((key >= 37 && key <= 40) || key === 87 || key === 65 || key === 83 || key === 68) {
		if (isConnected && gameState.playing) {
		  event.preventDefault();
		  
		  // Convertir WASD a códigos de flechas para el servidor
		  let keyToSend = key;
		  if (key === 87) keyToSend = 38; // W -> ↑
		  else if (key === 65) keyToSend = 37; // A -> ←
		  else if (key === 83) keyToSend = 40; // S -> ↓
		  else if (key === 68) keyToSend = 39; // D → →
		  
		  socket.emit('newMove', { key: keyToSend });
		}
	  } else if (key === 32 && isConnected && gameState.playing) {
		event.preventDefault();
		socket.emit('attack');
	  }
	}

  function createLocalSnake(serverSnake) {
    const snake = new Snake(
      serverSnake.id,
      serverSnake.name,
      segmentSize,
      600,
      600,
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
      
      // Actualizar canvas de info siempre (para notificaciones)
      drawInfoCanvas();
      
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
    // Mostrar canvas de info siempre
    showElement(infoCanvasContainer);
    drawInfoCanvas();
    refreshRooms();
  });

  socket.on('disconnect', () => {
    isConnected = false;
    stopRenderLoop();
    addCanvasNotification('Desconectado del servidor', 'error');
  });

  socket.on('gameError', (message) => {
    addCanvasNotification(message, 'error');
  });

  socket.on('roomCreated', (data) => {
    isSpectating = false;
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
    updateSpectatorIndicator();
    addCanvasNotification(`¡Sala ${data.roomId} creada!`, 'success');
    
    // NUEVO: Actualizar lista de jugadores (ahora con botones de invitar)
    socket.emit('getOnlinePlayers');
  });

  socket.on('roomJoined', (data) => {
    isSpectating = false;
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
    updateSpectatorIndicator();
    addCanvasNotification(`¡Te uniste a la sala ${data.roomId}!`, 'success');
    
    // NUEVO: Actualizar lista de jugadores (ahora con botones de invitar)
    socket.emit('getOnlinePlayers');
  });

  socket.on('roomsList', (rooms) => {
    updateRoomsList(rooms);
  });

  socket.on('newHost', (data) => {
    if (data.hostId === socket.id) {
      isHost = true;
      addCanvasNotification('¡Ahora eres el anfitrión!', 'info');
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
    updateRoomInfo(roomData);
    updateHostControls();
    updateConfigPanel();
    
    // Actualizar canvas de info
    drawInfoCanvas();
    
    if (players.length >= config.minPlayers && !state.playing && isHost) {
      showElement(startGameButton);
    } else {
      hideElement(startGameButton);
    }
    
    if (players.length < config.minPlayers) {
      showElement(waitingSpan);
      addCanvasNotification(`Necesitas ${config.minPlayers - players.length} jugadores más`, 'info');
    } else {
      hideElement(waitingSpan);
    }
    
    // NUEVO: Actualizar lista de jugadores online cuando cambie el estado
    socket.emit('getOnlinePlayers');
  });

  socket.on('configUpdated', (newConfig) => {
    roomConfig = newConfig;
    updateConfigInputs(newConfig);
    updateCanvasSize(newConfig);
    snakes.forEach(snake => {
      snake.updateInterpolationSpeed(newConfig.gameSpeed);
    });
    addCanvasNotification('¡Configuración actualizada!', 'success');
  });

  socket.on('updateScores', (scores) => {
    roomScores = scores;
    updatePlayerList(snakes);
    drawInfoCanvas();
  });

  socket.on('gameStart', (data) => {
    isSpectating = false;
    canvas.width = 600;
    canvas.height = 600;
    segmentSize = data.config.segmentSize;
    
    snakes = data.players.map(serverPlayer => createLocalSnake(serverPlayer));
    foods = data.foods || [];
    consumables = data.consumables || [];
    projectiles = data.projectiles || [];
    gameState = data.gameState;
    roomConfig = data.config;
    roundTimeLeft = data.gameState.roundTimeLeft || 35;
    
    isGameRunning = true;
    startRenderLoop();
    
    hideElement(gameOverScreen);
    hideElement(startGameButton);
    hideElement(configPanel);
    
    addCanvasNotification(`Ronda ${data.gameState.round} - ¡Batalla por tiempo!`, 'success');
    console.log(`¡Ronda ${data.gameState.round} iniciada!`);
    
    // NUEVO: Actualizar lista sin botones de invitar (juego activo)
    socket.emit('getOnlinePlayers');
    
    updateSpectatorIndicator();
    gameLoop();
  });

  socket.on('spectatingStarted', (data) => {
    isSpectating = true;
    isHost = false;
    currentRoomId = data.roomId;
    
    canvas.width = 600;
    canvas.height = 600;
    segmentSize = data.config.segmentSize;
    
    snakes = data.players.map(serverPlayer => createLocalSnake(serverPlayer));
    foods = data.foods || [];
    consumables = data.consumables || [];
    projectiles = data.projectiles || [];
    gameState = data.gameState;
    roomConfig = data.config;
    roundTimeLeft = data.roundTimeLeft || 60;
    roomScores = data.roundScores || {};
    
    isGameRunning = true;
    startRenderLoop();
    
    hideElement(gameOverScreen);
    hideElement(startGameButton);
    hideElement(configPanel);
    showElement(document.getElementById('gameInterface'));
    hideElement(document.getElementById('roomSelection'));
    
    updateSpectatorIndicator();
    addCanvasNotification(`Espectando sala ${data.roomId}`, 'info');
    
    gameLoop();
  });

  socket.on('spectatorJoined', (data) => {
    if (isSpectating) return; // No mostrar a otros espectadores
    addCanvasNotification(`${data.spectatorName} se unió como espectador`, 'info');
  });

  socket.on('spectatorLeft', (data) => {
    // Actualizar contador si es necesario
  });

  socket.on('countdown', (count, state) => {
    gameState = state;
    addCanvasNotification(`Ronda ${state.round} inicia en ${count}...`, 'info');
    drawInfoCanvas();
  });

  socket.on('roundTimeUpdate', (timeLeft) => {
    roundTimeLeft = timeLeft;
    drawInfoCanvas();
  });

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
          addCanvasNotification(`${event.playerName} obtuvo ${style.name}!`, 'success');
        }
      });
    }
    
    if (data.gameState.roundTimeLeft !== undefined) {
      roundTimeLeft = data.gameState.roundTimeLeft;
    }
  });

  socket.on('roundEnd', (data) => {
    stopRenderLoop();
    roomScores = data.scores;
    
    addCanvasNotification(`¡Tiempo agotado! Ronda ${data.round} terminada`, 'info');
    if (data.winner) {
      addCanvasNotification(`Ganador de la ronda: ${data.winner.name} (${data.winner.score} segmentos)`, 'success');
    }
    
    updatePlayerList(snakes);
    drawInfoCanvas();
    
    /*if (data.nextRound) {
      setTimeout(() => {
        addCanvasNotification(`Preparando ronda ${data.round + 1}...`, 'info');
      }, 2000);
    }*/
    
    if (isHost && data.nextRound) {
      showElement(startGameButton);
      updateConfigPanel();
    }
    
    // NUEVO: Actualizar lista con botones (ronda terminada, juego pausado)
    socket.emit('getOnlinePlayers');
  });

  socket.on('gameEnd', (data) => {
    stopRenderLoop();
    addCanvasNotification(`¡Juego Terminado! Campeón: ${data.winner.name}`, 'success');
    
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
    
    // NUEVO: Actualizar lista con botones (juego terminado)
    socket.emit('getOnlinePlayers');
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
    
    // NUEVO: Mostrar panel de jugadores en línea
    showElement(onlinePlayersPanel);
    updateLogoutButtonVisibility();
    addCanvasNotification(`¡Bienvenido, ${profile.stats.name}!`, 'success');
    
    // NUEVO: Solicitar lista de jugadores después de un breve delay
    setTimeout(() => {
      socket.emit('getOnlinePlayers');
    }, 500);
  });

  socket.on('profileError', (message) => {
    addCanvasNotification(message, 'error');
    
    clearPlayerProfile();
    usernameInput.value = '';
    showElement(document.getElementById('loginView'));
    hideElement(document.getElementById('profileView'));
    hideElement(document.getElementById('roomSelection'));
    hideElement(onlinePlayersPanel);
    updateLogoutButtonVisibility();
  });

  socket.on('leaderboard', (leaderboard) => {
    showLeaderboard(leaderboard);
  });

  socket.on('roomFinished', (data) => {
    stopRenderLoop();
    showFinalScreen(null, data.finalScores, data.reason);
  });

  socket.on('backToMenuSuccess', () => {
    stopRenderLoop();
    currentRoomId = null;
    isHost = false;
    isSpectating = false;
    roomConfig = {};
    showRoomSelection();
    updateSpectatorIndicator();
    addCanvasNotification('Regresaste al menú', 'info');
    
    // NUEVO: Actualizar lista sin botones (fuera de sala)
    socket.emit('getOnlinePlayers');
  });

  // NUEVO: Eventos para sistema de invitaciones
  socket.on('onlinePlayersList', (players) => {
    updateOnlinePlayersList(players);
	console.log(players);
  });

  socket.on('invitationReceived', (invitationData) => {
    handleInvitationReceived(invitationData);
  });

  socket.on('invitationSent', (data) => {
    addCanvasNotification(`Invitación enviada a ${data.toPlayer}`, 'success');
  });

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
    gameSpeedInput.disabled = !enabled;
    segmentSizeInput.disabled = !enabled;
    
    if (immunityEnabledInput) immunityEnabledInput.disabled = !enabled;
    if (immunityIntervalInput) immunityIntervalInput.disabled = !enabled;
    if (immunityDurationInput) immunityDurationInput.disabled = !enabled;
  }

  function updateConfigInputs(config) {
    maxPlayersInput.value = config.maxPlayers;
    minPlayersInput.value = config.minPlayers;
    gameSpeedInput.value = config.gameSpeed;
    segmentSizeInput.value = config.segmentSize;
    
    if (config.consumables && config.consumables.immunity) {
      if (immunityEnabledInput) immunityEnabledInput.checked = config.consumables.immunity.enabled !== false;
      if (immunityIntervalInput) immunityIntervalInput.value = config.consumables.immunity.spawnInterval || 13;
      if (immunityDurationInput) immunityDurationInput.value = config.consumables.immunity.duration || 5;
    }
  }

  function updateCanvasSize(config) {
    canvas.width = 600;
    canvas.height = 600;
    segmentSize = config.segmentSize;
    handleResize();
  }

  function saveConfiguration() {
    if (!isHost) {
      addCanvasNotification('Solo el anfitrión puede modificar la configuración', 'error');
      return;
    }

    const newConfig = {
      maxPlayers: parseInt(maxPlayersInput.value),
      minPlayers: parseInt(minPlayersInput.value),
      gameSpeed: parseInt(gameSpeedInput.value),
      segmentSize: parseInt(segmentSizeInput.value),
      consumables: {
        immunity: {
          enabled: immunityEnabledInput ? immunityEnabledInput.checked : true,
          spawnInterval: immunityIntervalInput ? parseInt(immunityIntervalInput.value) : 5,
          duration: immunityDurationInput ? parseInt(immunityDurationInput.value) : 5
        }
      }
    };

    if (newConfig.minPlayers > newConfig.maxPlayers) {
      addCanvasNotification('Los jugadores mínimos no pueden exceder los máximos', 'error');
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
      const consumablesStatus = (room.config.consumables && room.config.consumables.immunity && room.config.consumables.immunity.enabled) ? '🛡️' : '';
      const isPlaying = room.playing || false;
      
      let buttonsHtml = '';
      if (isPlaying) {
        buttonsHtml = `<button onclick="spectateRoom('${room.id}')" class="join-room-btn" style="background: #333; color: #00ffff; border-color: #00ffff;">👁️ Espectar</button>`;
      } else if (room.players < room.maxPlayers) {
        buttonsHtml = `<button onclick="joinSpecificRoom('${room.id}')" class="join-room-btn">Unirse</button>`;
      } else {
        buttonsHtml = `<span style="color: #888; font-size: 0.9em;">Llena</span>`;
      }
      
      roomItem.innerHTML = `
        <div class="room-info">
          <strong>Sala: ${room.id}</strong> ${isPlaying ? '🎮' : ''} ⚔️${consumablesStatus}<br>
          Anfitrión: ${room.hostName}<br>
          Jugadores: ${room.players}/${room.maxPlayers}${isPlaying ? ' (En juego)' : ''}
          <div class="room-config">
            3 rondas • 35s • 600x600 • Velocidad: ${room.config.gameSpeed}ms
          </div>
        </div>
        ${buttonsHtml}
      `;
      roomsList.appendChild(roomItem);
    });
  }

  function updateRoomInfo(roomData) {
    if (roomInfo && roomData) {
      let statusText = '';
      if (isSpectating) {
        statusText = '<strong style="color: #00ffff;">👁️ Modo Espectador</strong><br>';
      } else if (roomData.host === socket.id) {
        statusText = '<strong>Anfitrión:</strong> Tú<br>';
      } else {
        statusText = '<strong>Anfitrión:</strong> Otro jugador<br>';
      }
      
      roomInfo.innerHTML = `
        ${statusText}
        <strong>Sala:</strong> ${roomData.roomId}
      `;
    }
  }

  function updateSpectatorIndicator() {
    const spectatorBanner = document.getElementById('spectatorBanner');
    if (spectatorBanner) {
      if (isSpectating) {
        showElement(spectatorBanner);
      } else {
        hideElement(spectatorBanner);
      }
    }
    
    // Actualizar controles hint
    const controlsHint = document.querySelector('.controls-hint');
    if (controlsHint && isSpectating) {
      controlsHint.innerHTML = '<strong>👁️ MODO ESPECTADOR</strong><br>Estás viendo la partida en tiempo real';
    } else if (controlsHint) {
      controlsHint.innerHTML = `
        <strong>Controles:</strong><br>
        ⬆️⬇️⬅️➡️ Flechas o WASD<br>
        🎯 Espacio - Atacar
      `;
    }
  }

  function spectateRoom(roomId) {
    if (!playerProfile || !currentPlayerId) {
      addCanvasNotification('Necesitas estar conectado para espectar', 'error');
      return;
    }
    
    socket.emit('spectateRoom', { 
      roomId: roomId,
      spectatorName: playerProfile.stats.name
    });
  }

  window.spectateRoom = spectateRoom;

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
            hasImmunity
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
  
  function drawCountdown() {
	if (roundTimeLeft > 10 || roundTimeLeft < 0) return;
	  
	  const centerX = canvas.width / 2;
	  const centerY = canvas.height / 2;
	  
	  // Configurar el contexto para el countdown
	  ctx.save();
	  
	  // Tamaño de fuente dinámico basado en el tiempo restante
	  const fontSize = 220 + (10 - roundTimeLeft) * 8; // Crece a medida que se acerca a 0
	  ctx.font = `bold ${fontSize}px Share Tech Mono, monospace`;
	  ctx.textAlign = 'center';
	  ctx.textBaseline = 'middle';
	  
	  // Efecto de pulsación
	  const pulseScale = 1 + Math.sin(Date.now() * 0.01) * 0.1;
	  ctx.scale(pulseScale, pulseScale);
	  
      // Color y transparencia basados en urgencia
      let alpha, strokeColor, fillColor;
      if (roundTimeLeft <= 3) {
		// Rojo urgente para últimos 3 segundos
		alpha = 0.2;
		strokeColor = '#f85149';
		fillColor = '#f85149';
	  } else if (roundTimeLeft <= 5) {
		// Amarillo de advertencia
		alpha = 0.15;
		strokeColor = '#d29922';
		fillColor = '#d29922';
	  } else {
		// Azul normal
		alpha = 0.1;
		strokeColor = '#58a6ff';
		fillColor = '#58a6ff';
	  }
	  
	  // Sombra/Glow para mejor visibilidad
	  ctx.shadowColor = strokeColor;
	  ctx.shadowBlur = 20;
	  ctx.globalAlpha = alpha;
	  
	  // Dibujar contorno grueso
	  ctx.strokeStyle = strokeColor;
	  ctx.lineWidth = 6;
	  ctx.strokeText(roundTimeLeft.toString(), centerX / pulseScale, centerY / pulseScale);
	  
	  // Dibujar texto principal
	  ctx.fillStyle = fillColor;
	  ctx.fillText(roundTimeLeft.toString(), centerX / pulseScale, centerY / pulseScale);
	  
	  // Texto adicional "TIEMPO!" en los últimos 3 segundos
	  if (roundTimeLeft <= 1) {
		ctx.font = `400 48px Share Tech Mono, monospace`;
		ctx.globalAlpha = alpha * 0.8;
		ctx.fillStyle = fillColor;
		ctx.strokeStyle = strokeColor;
		ctx.lineWidth = 2;
		
		const warningY = (centerY / pulseScale) + 160;
		ctx.strokeText('¡TIEMPO!', centerX / pulseScale, warningY);
		ctx.fillText('¡TIEMPO!', centerX / pulseScale, warningY);
	  }
	  
	  ctx.restore();
	}

  function gameLoop() {
    ctx.fillStyle = retroColors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    drawGrid();
    drawPlayers();
	drawCountdown();
    updatePlayerList(snakes);
    
    // Actualizar canvas de información
    drawInfoCanvas();
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
      
      let statusText = player.gameover ? '💀' : '🐍';
      if (player.activeConsumable && !player.gameover) {
        if (player.activeConsumable.type === 'immunity' && Date.now() < player.activeConsumable.endTime) {
          statusText = '🛡️';
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

  function showElement(element) {
    if (element) element.classList.remove('hidden');
  }

  function hideElement(element) {
    if (element) element.classList.add('hidden');
  }

  function handleResize() {
    const container = canvas.parentElement;
    const maxWidth = container.clientWidth; //- 40;
    const maxHeight = window.innerHeight - 20;
    
    if (canvas.width > maxWidth || canvas.height > maxHeight) {
      const scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height);
      canvas.style.transform = `scale(${scale})`;
      canvas.style.transformOrigin = 'top left';
      
      if (infoCanvas) {
        infoCanvas.style.transform = `scale(${scale})`;
        infoCanvas.style.transformOrigin = 'top left';
      }
    } else {
      canvas.style.transform = 'none';
      if (infoCanvas) {
        infoCanvas.style.transform = 'none';
      }
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
    hideElement(onlinePlayersPanel);
    updateLogoutButtonVisibility();
    addCanvasNotification('Sesión cerrada.', 'info');
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
      addCanvasNotification('Por favor ingresa un nombre válido (2-20 caracteres)', 'error');
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

  // Event Listeners
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
      
      addCanvasNotification('Cargando perfil...', 'info');
      socket.emit('getOrCreateProfile', dataToSend);
    } else {
      addCanvasNotification('El nombre debe tener 2-20 caracteres', 'error');
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
      addCanvasNotification('El nombre debe tener 2-20 caracteres', 'error');
      usernameInput.focus();
    }
  });

  joinRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const roomId = roomIdInput.value.trim().toUpperCase();
    
    if (!username || username.length < 2) {
      addCanvasNotification('El nombre debe tener 2-20 caracteres', 'error');
      usernameInput.focus();
      return;
    }
    
    if (!roomId || roomId.length !== 6) {
      addCanvasNotification('Por favor ingresa un ID de sala válido', 'error');
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
    // Guardar configuración antes de iniciar
    if (isHost) {
      const finalConfig = {
        maxPlayers: parseInt(maxPlayersInput.value),
        minPlayers: parseInt(minPlayersInput.value),
        gameSpeed: parseInt(gameSpeedInput.value),
        segmentSize: parseInt(segmentSizeInput.value),
        consumables: {
          immunity: {
            enabled: immunityEnabledInput ? immunityEnabledInput.checked : true,
            spawnInterval: immunityIntervalInput ? parseInt(immunityIntervalInput.value) : 13,
            duration: immunityDurationInput ? parseInt(immunityDurationInput.value) : 5
          }
        }
      };
      
      if (finalConfig.minPlayers <= finalConfig.maxPlayers) {
        socket.emit('updateRoomConfig', finalConfig);
      }
    }
    
    socket.emit('startGame');
  });

  refreshRoomsButton.addEventListener('click', () => {
    refreshRooms();
  });

  document.getElementById('backToMenuButton').addEventListener('click', () => {
    if (isSpectating) {
      // Si está espectando, salir de la sala
      if (currentRoomId) {
        socket.leave(currentRoomId);
        currentRoomId = null;
        isSpectating = false;
        stopRenderLoop();
        showRoomSelection();
        updateSpectatorIndicator();
        socket.emit('getRooms');
      }
    } else {
      socket.emit('backToMenu');
      hideFinalScreen();
    }
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

  // Inicializar interfaz y render loop para notificaciones
  initializeUserInterface();
  handleResize();
  
  // Iniciar loop de renderizado para las notificaciones (siempre activo)
  isGameRunning = true;
  startRenderLoop();
});