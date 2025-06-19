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

  document.addEventListener('keydown', handleKeyPress);

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
    gameLoop();
  });

  socket.on('roundEnd', (data) => {
    roomScores = data.scores; // Update room scores
    showStatus(`Round ${data.round} finished!`, 'info');
    if (data.winner) {
      showStatus(`Round winner: ${data.winner.name}`, 'success');
    }
    
    // Update round info and player list with total scores
    updateGameInfo({ round: data.round + 1, maxRounds: roomConfig.maxRounds });
    updatePlayerList(snakes); // This will now show total scores between rounds
    
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
      // Show/hide save button and disable inputs for non-hosts
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
    
    // Set canvas size
    const canvasSize = `${config.canvasWidth}x${config.canvasHeight}`;
    canvasSizeInput.value = canvasSize;
  }

  function updateCanvasSize(config) {
    canvas.width = config.canvasWidth;
    canvas.height = config.canvasHeight;
    segmentSize = config.segmentSize;
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

    // Validation
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
    const playerColors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#ff9ff3', '#54a0ff', '#fd79a8'];
    
    snakes.forEach((snake, index) => {
      if (!snake.gameover && snake.segments && snake.segments.length > 0) {
        const isCurrentPlayer = snake.id === socket.id;
        const playerColor = playerColors[index % playerColors.length];
        
        snake.segments.forEach((segment, segIndex) => {
          if (segIndex === 0) {
            ctx.fillStyle = isCurrentPlayer ? '#ff4757' : playerColor;
            ctx.fillRect(segment.x, segment.y, segmentSize, segmentSize);
            
            if (isCurrentPlayer) {
              ctx.fillStyle = '#2f3640';
              const eyeSize = Math.max(2, segmentSize / 4);
              ctx.fillRect(segment.x + 3, segment.y + 3, eyeSize, eyeSize);
              ctx.fillRect(segment.x + segmentSize - 3 - eyeSize, segment.y + 3, eyeSize, eyeSize);
            }
          } else {
            ctx.fillStyle = lightenColor(playerColor, 20);
            ctx.fillRect(segment.x + 1, segment.y + 1, segmentSize - 2, segmentSize - 2);
          }
        });
      }
    });

    if (foods) {
      const gradient = ctx.createRadialGradient(
        foods.x + segmentSize/2, foods.y + segmentSize/2, 0,
        foods.x + segmentSize/2, foods.y + segmentSize/2, foods.score * 2
      );
      gradient.addColorStop(0, '#ff6b6b');
      gradient.addColorStop(1, '#ee5a52');
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(foods.x + segmentSize/2, foods.y + segmentSize/2, foods.score * 1.1, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(8, segmentSize/2)}px Arial`;
      ctx.textAlign = 'center';
      ctx.fillText(foods.score, foods.x + segmentSize/2, foods.y + segmentSize/2 + 3);
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
    
    // Sort by current score during game, or total score between rounds
    const sortedPlayers = players.sort((a, b) => {
      if (gameState.playing) {
        return b.score - a.score;
      } else {
        // Show total scores between rounds
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
      
      // Show current score during game, total score between rounds
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

  function handleKeyPress(event) {
    const key = event.keyCode;
    
    if (key >= 37 && key <= 40 && isConnected && gameState.playing) {
      event.preventDefault();
      socket.emit('newMove', { key });
    }
  }

  function showElement(element) {
    if (element) element.classList.remove('hidden');
  }

  function hideElement(element) {
    if (element) element.classList.add('hidden');
  }

  function lightenColor(color, percent) {
    const num = parseInt(color.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
      (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
      (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
  }

  // Global functions for button clicks
  window.joinSpecificRoom = function(roomId) {
    const username = usernameInput.value.trim();
    if (!username) {
      showStatus('Please enter your username first', 'error');
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
    }
  });

  joinRoomButton.addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const roomId = roomIdInput.value.trim().toUpperCase();
    
    if (!username || username.length < 2) {
      showStatus('Username must be 2-20 characters', 'error');
      return;
    }
    
    if (!roomId || roomId.length !== 6) {
      showStatus('Please enter a valid room ID', 'error');
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

  // Initialize
  showStatus('Connected! Enter your username to start.', 'info');
});