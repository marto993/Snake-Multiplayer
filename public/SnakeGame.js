document.addEventListener("DOMContentLoaded", function() {
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

  // Initialize socket connection
  const socket = io();
  let gameState = { playing: false, round: 1 };
  let segmentSize = 20;
  let snakes = [];
  let foods = {};
  let isConnected = false;
  let isHost = false;
  let currentRoomId = null;
  let roomConfig = {};
  let roomScores = {};

  // Enhanced rendering functions
  function drawRoundedRect(ctx, x, y, width, height, radius) {
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
  }

  function drawSnakeSegment(ctx, x, y, size, color, isHead = false, direction = null, isCurrentPlayer = false) {
    const radius = size * 0.2;
    const padding = 1;
    const innerSize = size - (padding * 2);
    
    // Main segment with rounded corners
    ctx.fillStyle = color;
    drawRoundedRect(ctx, x + padding, y + padding, innerSize, innerSize, radius);
    ctx.fill();
    
    // Add subtle shadow/depth
    ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    drawRoundedRect(ctx, x + padding, y + padding, innerSize, innerSize, radius);
    ctx.fill();
    
    // Reset shadow
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    
    // Head specific features
    if (isHead) {
      // Highlight border for head
      ctx.strokeStyle = isCurrentPlayer ? '#ff4757' : darkenColor(color, 30);
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, x + padding, y + padding, innerSize, innerSize, radius);
      ctx.stroke();
      
      // Eyes based on direction
      if (direction && isCurrentPlayer) {
        drawEyes(ctx, x, y, size, direction);
      } else {
        drawEyes(ctx, x, y, size, { x: 1, y: 0 });
      }
      
      // Glossy effect
      const gradient = ctx.createLinearGradient(x, y, x, y + size);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
      gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.1)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      
      ctx.fillStyle = gradient;
      drawRoundedRect(ctx, x + padding, y + padding, innerSize, innerSize, radius);
      ctx.fill();
    } else {
      // Body segment - subtle inner highlight
      const innerGradient = ctx.createLinearGradient(x, y, x + size, y + size);
      innerGradient.addColorStop(0, 'rgba(255, 255, 255, 0.15)');
      innerGradient.addColorStop(1, 'rgba(255, 255, 255, 0.05)');
      
      ctx.fillStyle = innerGradient;
      drawRoundedRect(ctx, x + padding + 2, y + padding + 2, innerSize - 4, innerSize - 4, radius - 1);
      ctx.fill();
    }
  }

  function drawEyes(ctx, x, y, size, direction) {
    const eyeSize = Math.max(2, size * 0.15);
    const eyeOffset = size * 0.25;
    
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
    
    // Draw eyes with white background
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(leftEyeX, leftEyeY, eyeSize, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rightEyeX, rightEyeY, eyeSize, 0, 2 * Math.PI);
    ctx.fill();
    
    // Draw pupils
    ctx.fillStyle = '#2f3640';
    const pupilSize = eyeSize * 0.6;
    ctx.beginPath();
    ctx.arc(leftEyeX, leftEyeY, pupilSize, 0, 2 * Math.PI);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(rightEyeX, rightEyeY, pupilSize, 0, 2 * Math.PI);
    ctx.fill();
  }

  function drawEnhancedFood(ctx, food, segmentSize) {
    const centerX = food.x + segmentSize / 2;
    const centerY = food.y + segmentSize / 2;
    const baseRadius = segmentSize * 0.4;
    const pulseRadius = baseRadius + Math.sin(Date.now() * 0.01) * 2;
    
    // Outer glow
    const glowGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, pulseRadius + 5);
    glowGradient.addColorStop(0, 'rgba(255, 107, 107, 0.6)');
    glowGradient.addColorStop(0.7, 'rgba(255, 107, 107, 0.3)');
    glowGradient.addColorStop(1, 'rgba(255, 107, 107, 0)');
    
    ctx.fillStyle = glowGradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, pulseRadius + 5, 0, 2 * Math.PI);
    ctx.fill();
    
    // Main food body
    const foodGradient = ctx.createRadialGradient(
      centerX - pulseRadius * 0.3, centerY - pulseRadius * 0.3, 0,
      centerX, centerY, pulseRadius
    );
    foodGradient.addColorStop(0, '#ff8a8a');
    foodGradient.addColorStop(0.6, '#ff6b6b');
    foodGradient.addColorStop(1, '#ee5a52');
    
    ctx.fillStyle = foodGradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, pulseRadius, 0, 2 * Math.PI);
    ctx.fill();
    
    // Highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(centerX - pulseRadius * 0.3, centerY - pulseRadius * 0.3, pulseRadius * 0.3, 0, 2 * Math.PI);
    ctx.fill();
    
    // Score text with better styling
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.font = `bold ${Math.max(10, segmentSize * 0.5)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.strokeText(food.score, centerX, centerY);
    ctx.fillText(food.score, centerX, centerY);
  }

  function darkenColor(color, percent) {
    const num = parseInt(color.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max((num >> 16) - amt, 0);
    const G = Math.max((num >> 8 & 0x00FF) - amt, 0);
    const B = Math.max((num & 0x0000FF) - amt, 0);
    return "#" + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
  }

  function lightenColor(color, percent) {
    const num = parseInt(color.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min((num >> 16) + amt, 255);
    const G = Math.min((num >> 8 & 0x00FF) + amt, 255);
    const B = Math.min((num & 0x0000FF) + amt, 255);
    return "#" + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
  }

  // Keyboard handling
  document.addEventListener('keydown', handleKeyPress);

  function handleKeyPress(event) {
    const key = event.keyCode;
    
    if (key >= 37 && key <= 40 && isConnected && gameState.playing) {
      event.preventDefault();
      socket.emit('newMove', { key });
    }
  }

  // Socket events
  socket.on('connect', () => {
    console.log('Connected to server:', socket.id);
    isConnected = true;
    refreshRooms();
  });

  socket.on('disconnect', () => {
    isConnected = false;
    showStatus('Disconnected from server', 'error');
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
    showStatus(`Room ${data.roomId} created!`, 'success');
  });

  socket.on('roomJoined', (data) => {
    currentRoomId = data.roomId;
    isHost = data.isHost;
    roomConfig = data.config;
    showGameInterface();
    updateConfigPanel();
    showStatus(`Joined room ${data.roomId}!`, 'success');
  });

  socket.on('roomsList', (rooms) => {
    updateRoomsList(rooms);
  });

  socket.on('newHost', (data) => {
    if (data.hostId === socket.id) {
      isHost = true;
      showStatus('You are now the host!', 'info');
    }
    updateHostControls();
    updateConfigPanel();
  });

  socket.on('updatePlayers', (players, state, config, roomData) => {
    snakes = players;
    gameState = state;
    roomConfig = config;
    updatePlayerList(players);
    updateGameInfo(state);
    updateRoomInfo(roomData);
    updateHostControls();
    updateConfigPanel();
    
    if (players.length >= config.minPlayers && !state.playing && isHost) {
      showElement(startGameButton);
    } else {
      hideElement(startGameButton);
    }
    
    if (players.length < config.minPlayers) {
      showElement(waitingSpan);
      showStatus(`Need ${config.minPlayers - players.length} more players`, 'info');
    } else {
      hideElement(waitingSpan);
    }
  });

  socket.on('configUpdated', (newConfig) => {
    roomConfig = newConfig;
    updateConfigInputs(newConfig);
    updateCanvasSize(newConfig);
    showStatus('Room settings updated!', 'success');
  });

  socket.on('updateScores', (scores) => {
    roomScores = scores;
    updatePlayerList(snakes);
  });

  socket.on('gameStart', (data) => {
    canvas.width = data.config.canvasWidth;
    canvas.height = data.config.canvasHeight;
    segmentSize = data.config.segmentSize;
    snakes = data.players;
    foods = data.food;
    gameState = data.gameState;
    roomConfig = data.config;
    
    hideElement(gameOverScreen);
    hideElement(startGameButton);
    hideElement(configPanel);
    showStatus(`Round ${data.gameState.round} - Fight!`, 'success');
    console.log(`Round ${data.gameState.round} started!`);
    
    // Initial render
    gameLoop();
  });

  socket.on('countdown', (count, state) => {
    gameState = state;
    showStatus(`Round ${state.round} starting in ${count}...`, 'info');
    updateGameInfo(state);
  });

  socket.on('gameFrame', (players, food, state) => {
    snakes = players;
    foods = food;
    gameState = state;
    // Render only when we receive new data from server
    gameLoop();
  });

  socket.on('roundEnd', (data) => {
    roomScores = data.scores;
    showStatus(`Round ${data.round} finished!`, 'info');
    if (data.winner) {
      showStatus(`Round winner: ${data.winner.name}`, 'success');
    }
    
    updateGameInfo({ round: data.round + 1, maxRounds: roomConfig.maxRounds });
    updatePlayerList(snakes);
    
    if (data.nextRound) {
      setTimeout(() => {
        showStatus(`Preparing round ${data.round + 1}...`, 'info');
        updateGameInfo({ round: data.round + 1, maxRounds: roomConfig.maxRounds });
      }, 2000);
    }
    
    if (isHost && data.nextRound) {
      showElement(startGameButton);
      updateConfigPanel();
    }
  });

  socket.on('gameEnd', (data) => {
    showStatus(`Game Over! Champion: ${data.winner.name}`, 'success');
    if (data.roomFinished) {
      showFinalScreen(data.winner, data.finalScores);
    } else {
      showGameOverScreen(`Champion: ${data.winner.name}`, data.finalScores);
      if (isHost) {
        showElement(startGameButton);
        updateConfigPanel();
      }
    }
  });

  socket.on('roomFinished', (data) => {
    showFinalScreen(null, data.finalScores, data.reason);
  });

  socket.on('backToMenuSuccess', () => {
    currentRoomId = null;
    isHost = false;
    roomConfig = {};
    showRoomSelection();
    showStatus('Returned to menu', 'info');
  });

  // Configuration functions
  function updateConfigPanel() {
    if (currentRoomId && !gameState.playing) {
      showElement(configPanel);
      if (isHost) {
        showElement(saveConfigButton);
        setConfigInputsEnabled(true);
        toggleConfigButton.textContent = '⚙️ Room Settings';
      } else {
        hideElement(saveConfigButton);
        setConfigInputsEnabled(false);
        toggleConfigButton.textContent = '👁️ View Settings';
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
  }

  function updateConfigInputs(config) {
    maxPlayersInput.value = config.maxPlayers;
    minPlayersInput.value = config.minPlayers;
    maxRoundsInput.value = config.maxRounds;
    gameSpeedInput.value = config.gameSpeed;
    segmentSizeInput.value = config.segmentSize;
    countdownInput.value = config.countdownTime;
    
    const canvasSize = `${config.canvasWidth}x${config.canvasHeight}`;
    canvasSizeInput.value = canvasSize;
  }

  function updateCanvasSize(config) {
    canvas.width = config.canvasWidth;
    canvas.height = config.canvasHeight;
    segmentSize = config.segmentSize;
    handleResize();
  }

  function saveConfiguration() {
    if (!isHost) {
      showStatus('Only the host can modify settings', 'error');
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
      countdownTime: parseInt(countdownInput.value)
    };

    if (newConfig.minPlayers > newConfig.maxPlayers) {
      showStatus('Min players cannot exceed max players', 'error');
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
      emptyMsg.textContent = 'No rooms available';
      emptyMsg.className = 'empty-room';
      roomsList.appendChild(emptyMsg);
      return;
    }
    
    rooms.forEach(room => {
      const roomItem = document.createElement('li');
      roomItem.className = 'room-item';
      roomItem.innerHTML = `
        <div class="room-info">
          <strong>Room: ${room.id}</strong><br>
          Host: ${room.hostName}<br>
          Players: ${room.players}/${room.maxPlayers}
          <div class="room-config">
            ${room.config.maxRounds} rounds • ${room.config.canvasWidth}x${room.config.canvasHeight} • Speed: ${room.config.gameSpeed}ms
          </div>
        </div>
        <button onclick="joinSpecificRoom('${room.id}')" class="join-room-btn">Join</button>
      `;
      roomsList.appendChild(roomItem);
    });
  }

  function updateRoomInfo(roomData) {
    if (roomInfo && roomData) {
      roomInfo.innerHTML = `
        <strong>Room:</strong> ${roomData.roomId}<br>
        <strong>Host:</strong> ${roomData.host === socket.id ? 'You' : 'Other player'}
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

  // Game functions
  function drawGrid() {
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 0.5;
    
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
    
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, canvas.width, canvas.height);
  }

  function drawPlayers() {
    const playerColors = [
      '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', 
      '#feca57', '#ff9ff3', '#54a0ff', '#fd79a8'
    ];
    
    snakes.forEach((snake, index) => {
      if (!snake.gameover && snake.segments && snake.segments.length > 0) {
        const isCurrentPlayer = snake.id === socket.id;
        const baseColor = playerColors[index % playerColors.length];
        
        snake.segments.forEach((segment, segIndex) => {
          const isHead = segIndex === 0;
          const segmentColor = isHead ? baseColor : lightenColor(baseColor, 25);
          
          drawSnakeSegment(
            ctx, 
            segment.x, 
            segment.y, 
            segmentSize, 
            segmentColor, 
            isHead, 
            isHead ? snake.direction : null,
            isCurrentPlayer
          );
        });
      }
    });

    if (foods) {
      drawEnhancedFood(ctx, foods, segmentSize);
    }
  }

  function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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
        score.innerHTML = `${totalScore}<br><small>${roundWins}W</small>`;
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
      roundInfo.textContent = `Round ${state.round}/${roomConfig.maxRounds}`;
    }
  }

  function showFinalScreen(winner, finalScores, reason = null) {
    const finalScreen = document.getElementById('finalScreen');
    const finalTitle = document.getElementById('finalTitle');
    const finalMessage = document.getElementById('finalMessage');
    const finalScoresList = document.getElementById('finalScoresList');
    
    if (reason) {
      finalTitle.textContent = 'Room Ended';
      finalMessage.textContent = reason;
    } else {
      finalTitle.textContent = 'Game Complete!';
      finalMessage.textContent = winner ? `Champion: ${winner.name}` : 'Game finished';
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
        <span class="final-wins">${player.roundWins} wins</span>
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
      showStatus('Please enter a valid username (2-20 characters)', 'error');
      usernameInput.focus();
      return;
    }
    socket.emit('joinRoom', { roomId, username });
  };

  // Configuration event listeners
  toggleConfigButton.addEventListener('click', () => {
    if (configSettings.classList.contains('hidden')) {
      showElement(configSettings);
      toggleConfigButton.textContent = '▼ Room Settings';
    } else {
      hideElement(configSettings);
      toggleConfigButton.textContent = '⚙️ Room Settings';
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
      showStatus('Username must be 2-20 characters', 'error');
      usernameInput.focus();
    }
  });

  joinRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const roomId = roomIdInput.value.trim().toUpperCase();
    
    if (!username || username.length < 2) {
      showStatus('Username must be 2-20 characters', 'error');
      usernameInput.focus();
      return;
    }
    
    if (!roomId || roomId.length !== 6) {
      showStatus('Please enter a valid room ID', 'error');
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
  showStatus('Connected! Enter your username to start.', 'info');
});