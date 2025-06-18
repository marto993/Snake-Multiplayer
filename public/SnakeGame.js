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

  document.addEventListener('keydown', handleKeyPress);

  const socket = io();
  let gameState = { playing: false, round: 1 };
  let segmentSize = 20;
  let snakes = [];
  let foods = {};
  let isConnected = false;
  let isHost = false;
  let currentRoomId = null;

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
    showGameInterface();
    showStatus(`Room ${data.roomId} created!`, 'success');
  });

  socket.on('roomJoined', (data) => {
    currentRoomId = data.roomId;
    isHost = data.isHost;
    showGameInterface();
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
  });

  socket.on('updatePlayers', (players, state, roomData) => {
    snakes = players;
    gameState = state;
    updatePlayerList(players);
    updateGameInfo(state);
    updateRoomInfo(roomData);
    updateHostControls();
    
    if (players.length >= state.minPlayers && !state.playing && isHost) {
      showElement(startGameButton);
    } else {
      hideElement(startGameButton);
    }
    
    if (players.length < state.minPlayers) {
      showElement(waitingSpan);
      showStatus(`Need ${state.minPlayers - players.length} more players`, 'info');
    } else {
      hideElement(waitingSpan);
    }
  });

  socket.on('gameStart', (players, food, canvasWidth, canvasHeight, segSize, state) => {
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    segmentSize = segSize;
    snakes = players;
    foods = food;
    gameState = state;
    
    hideElement(gameOverScreen);
    hideElement(startGameButton);
    showStatus(`Round ${state.round} - Fight!`, 'success');
    console.log(`Round ${state.round} started!`);
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
    showStatus(`Round ${data.round} finished!`, 'info');
    if (data.winner) {
      showStatus(`Round winner: ${data.winner.name}`, 'success');
    }
    
    if (data.nextRound) {
      setTimeout(() => {
        showStatus(`Preparing round ${data.round + 1}...`, 'info');
      }, 2000);
    }
    
    if (isHost && data.nextRound) {
      showElement(startGameButton);
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
      }
    }
  });

  socket.on('roomFinished', (data) => {
    showFinalScreen(null, data.finalScores, data.reason);
  });

  socket.on('backToMenuSuccess', () => {
    currentRoomId = null;
    isHost = false;
    showRoomSelection();
    showStatus('Returned to menu', 'info');
  });

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

  // Game functions (same as before)
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
              const eyeSize = 3;
              ctx.fillRect(segment.x + 3, segment.y + 3, eyeSize, eyeSize);
              ctx.fillRect(segment.x + segmentSize - 6, segment.y + 3, eyeSize, eyeSize);
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
      ctx.arc(foods.x + segmentSize/2, foods.y + segmentSize/2, foods.score * 1.5, 0, 2 * Math.PI);
      ctx.fill();
      
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px Arial';
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
    
    players.sort((a, b) => b.score - a.score).forEach((player, index) => {
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
      score.textContent = player.score;
      
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
    if (roundInfo) {
      roundInfo.textContent = `Round ${state.round}/${state.maxRounds}`;
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
    
    // Show final scores
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