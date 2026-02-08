const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

const profiles = {
  '732800': { id: '732800', name: 'Eemi', rank: 'Admin' },
  '819223': { id: '819223', name: 'Venni', rank: 'User' },
  '019765': { id: '019765', name: 'Iikka', rank: 'User' }
};

const gameState = {
  phase: 'lobby',
  roundNumber: 1,
  enrollmentOpen: true,
  seekerSocketId: null,
  roundPhase: null,
  infoText: '',
  overlay: null,
  timer: {
    duration: 0,
    remaining: 0,
    running: false,
    label: ''
  },
  minigame: null
};

const players = new Map();
let timerInterval = null;
let overlayTimeout = null;
let timerExpire = null;

const sendState = () => {
  io.emit('state', buildStatePayload());
};

const buildStatePayload = () => {
  const enrolledPlayers = getEnrolledPlayers();
  const seekers = players.get(gameState.seekerSocketId);
  return {
    phase: gameState.phase,
    roundNumber: gameState.roundNumber,
    enrollmentOpen: gameState.enrollmentOpen,
    roundPhase: gameState.roundPhase,
    infoText: gameState.infoText,
    timer: { ...gameState.timer },
    overlay: gameState.overlay,
    minigame: gameState.minigame,
    enrolled: enrolledPlayers.map((player) => ({
      socketId: player.socketId,
      name: player.name,
      rank: player.rank,
      role: player.role,
      found: player.found
    })),
    players: Array.from(players.values()).map((player) => ({
      socketId: player.socketId,
      name: player.name,
      rank: player.rank,
      enrolled: player.enrolled,
      role: player.role,
      found: player.found
    })),
    seekerSocketId: gameState.seekerSocketId,
    seekerName: seekers ? seekers.name : null
  };
};

const getEnrolledPlayers = () => Array.from(players.values()).filter((player) => player.enrolled);

const stopTimer = () => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  gameState.timer.running = false;
};

const setTimer = (seconds, label, onExpire) => {
  stopTimer();
  gameState.timer.duration = seconds;
  gameState.timer.remaining = seconds;
  gameState.timer.running = false;
  gameState.timer.label = label;
  timerExpire = onExpire;
  sendState();
  setTimeout(() => {
    gameState.timer.running = true;
    sendState();
    timerInterval = setInterval(() => {
      gameState.timer.remaining = Math.max(0, gameState.timer.remaining - 1);
      sendState();
      if (gameState.timer.remaining <= 0) {
        stopTimer();
        onExpire();
      }
    }, 1000);
  }, 1000);
};

const pauseTimer = () => {
  stopTimer();
  sendState();
};

const resumeTimer = () => {
  if (gameState.timer.remaining <= 0) {
    return;
  }
  if (gameState.timer.running) {
    return;
  }
  gameState.timer.running = true;
  sendState();
  timerInterval = setInterval(() => {
    gameState.timer.remaining = Math.max(0, gameState.timer.remaining - 1);
    sendState();
    if (gameState.timer.remaining <= 0) {
      stopTimer();
      if (timerExpire) {
        timerExpire();
      }
    }
  }, 1000);
};

const clearOverlay = () => {
  if (overlayTimeout) {
    clearTimeout(overlayTimeout);
    overlayTimeout = null;
  }
  gameState.overlay = null;
  sendState();
};

const setOverlay = (overlay) => {
  if (overlayTimeout) {
    clearTimeout(overlayTimeout);
  }
  gameState.overlay = { ...overlay, startedAt: Date.now() };
  sendState();
  overlayTimeout = setTimeout(() => {
    gameState.overlay = null;
    sendState();
  }, overlay.durationMs);
};

const startGame = () => {
  if (gameState.phase !== 'lobby') {
    return;
  }
  const enrolled = getEnrolledPlayers();
  if (enrolled.length === 0) {
    return;
  }
  gameState.enrollmentOpen = false;
  gameState.phase = 'starting';
  gameState.infoText = 'THE FIRST SEEKER WILL NOW BE CHOSEN';
  gameState.roundPhase = null;
  gameState.timer = { duration: 0, remaining: 0, running: false, label: '' };
  sendState();
  setTimeout(() => {
    assignRoles();
    startRoundSequence();
  }, 3000);
};

const assignRoles = () => {
  const enrolled = getEnrolledPlayers();
  if (enrolled.length === 0) {
    return;
  }
  const seekerIndex = Math.floor(Math.random() * enrolled.length);
  const seeker = enrolled[seekerIndex];
  gameState.seekerSocketId = seeker.socketId;
  enrolled.forEach((player) => {
    player.role = player.socketId === seeker.socketId ? 'SEEKER' : 'HIDER';
    player.found = false;
  });
};

const startRoundSequence = () => {
  gameState.phase = 'round';
  gameState.roundPhase = 'intro';
  gameState.infoText = '';
  sendState();
  setTimeout(() => {
    gameState.roundPhase = 'lobby_wait';
    gameState.infoText = 'PLEASE WAIT IN THE LOBBY ROOM FOR THE ROUND TO BEGIN';
    setTimer(15, 'LOBBY WAIT', () => {
      gameState.roundPhase = 'pre_round';
      updateInfoForRoles('pre_round');
      setTimer(40, 'PRE-ROUND', () => {
        gameState.roundPhase = 'main';
        updateInfoForRoles('main');
        const hiderCount = getEnrolledPlayers().filter((player) => player.role === 'HIDER').length;
        const minutes = Math.max(1, hiderCount);
        setTimer(minutes * 60, 'ROUND', () => {
          endRound();
        });
      });
    });
  }, 1500);
};

const updateInfoForRoles = (phase) => {
  if (phase === 'pre_round') {
    gameState.infoText = 'SEEKER: DO NOT LEAVE THE LOBBY ROOM UNTIL THE ROUND BEGINS\nHIDERS: FIND A HIDING SPOT BEFORE THE ROUND BEGINS';
  }
  if (phase === 'main') {
    gameState.infoText = 'SEEKER: FIND ALL THE HIDERS BEFORE THE ROUND ENDS\nHIDERS: STAY HIDDEN UNTIL THE ROUND ENDS';
  }
  sendState();
};

const endRound = () => {
  pauseTimer();
  gameState.phase = 'return';
  gameState.infoText = 'PLEASE RETURN TO THE LOBBY ROOM';
  gameState.roundPhase = null;
  sendState();
  setTimer(30, 'RETURN', () => {
    startMinigame();
  });
};

const startMinigame = () => {
  gameState.phase = 'minigame';
  gameState.infoText = 'PLEASE WAIT FOR THE NEXT SEEKER TO BE ASSIGNED';
  gameState.roundPhase = null;
  const foundHiders = getEnrolledPlayers().filter((player) => player.found);
  if (foundHiders.length === 0) {
    const candidates = getEnrolledPlayers().filter((player) => player.socketId !== gameState.seekerSocketId);
    if (candidates.length > 0) {
      const nextSeeker = candidates[Math.floor(Math.random() * candidates.length)];
      setNextSeeker(nextSeeker);
      return;
    }
  }
  const greenDelay = 1000 + Math.floor(Math.random() * 3000);
  gameState.minigame = {
    status: 'waiting',
    greenAt: Date.now() + greenDelay,
    taps: {},
    participants: foundHiders.map((player) => player.socketId)
  };
  sendState();
  setTimeout(() => {
    gameState.minigame.status = 'green';
    sendState();
    setTimeout(() => {
      resolveMinigame();
    }, 5000);
  }, greenDelay);
};

const resolveMinigame = () => {
  if (!gameState.minigame) {
    return;
  }
  const participants = gameState.minigame.participants;
  let slowest = null;
  let slowestTime = -1;
  participants.forEach((socketId) => {
    const tapTime = gameState.minigame.taps[socketId];
    const response = tapTime ? tapTime - gameState.minigame.greenAt : Number.POSITIVE_INFINITY;
    if (response > slowestTime) {
      slowestTime = response;
      slowest = socketId;
    }
  });
  if (!slowest) {
    const enrolled = getEnrolledPlayers();
    slowest = enrolled.length ? enrolled[0].socketId : null;
  }
  const nextSeeker = players.get(slowest);
  if (nextSeeker) {
    setNextSeeker(nextSeeker);
  } else {
    gameState.phase = 'lobby';
    gameState.enrollmentOpen = true;
    gameState.minigame = null;
    sendState();
  }
};

const setNextSeeker = (nextSeeker) => {
  const currentSeeker = players.get(gameState.seekerSocketId);
  if (currentSeeker) {
    currentSeeker.role = 'HIDER';
  }
  getEnrolledPlayers().forEach((player) => {
    if (player.socketId !== nextSeeker.socketId) {
      player.role = 'HIDER';
    }
    player.found = false;
  });
  nextSeeker.role = 'SEEKER';
  gameState.seekerSocketId = nextSeeker.socketId;
  gameState.roundNumber += 1;
  gameState.minigame = null;
  gameState.phase = 'round';
  gameState.infoText = 'THE ROUND WILL BEGIN AFTER THE TIME LIMIT';
  gameState.roundPhase = 'between';
  sendState();
  setTimer(5, 'NEXT ROUND', () => {
    startRoundSequence();
  });
};

const handleSeekerDisconnect = () => {
  const remaining = getEnrolledPlayers();
  if (remaining.length === 0) {
    resetToLobby();
    return;
  }
  const nextSeeker = remaining[Math.floor(Math.random() * remaining.length)];
  gameState.seekerSocketId = nextSeeker.socketId;
  remaining.forEach((player) => {
    player.role = player.socketId === nextSeeker.socketId ? 'SEEKER' : 'HIDER';
  });
  endRound();
};

const resetToLobby = () => {
  pauseTimer();
  gameState.phase = 'lobby';
  gameState.enrollmentOpen = true;
  gameState.roundPhase = null;
  gameState.infoText = '';
  gameState.minigame = null;
  gameState.seekerSocketId = null;
  gameState.roundNumber = 1;
  getEnrolledPlayers().forEach((player) => {
    player.enrolled = false;
    player.role = 'SPECTATOR';
    player.found = false;
  });
  sendState();
};

const ensureAdmin = (socket) => {
  const player = players.get(socket.id);
  if (!player || player.rank !== 'Admin') {
    socket.emit('admin_error', 'Admin access required.');
    return false;
  }
  return true;
};

io.on('connection', (socket) => {
  socket.on('login', (payload) => {
    const profile = profiles[payload.id];
    if (!profile) {
      socket.emit('login_error', 'Invalid ID');
      return;
    }
    const player = {
      socketId: socket.id,
      id: profile.id,
      name: profile.name,
      rank: profile.rank,
      enrolled: false,
      role: 'SPECTATOR',
      found: false,
      blockedUntil: 0
    };
    players.set(socket.id, player);
    socket.emit('login_success', player);
    if (gameState.enrollmentOpen) {
      attemptEnroll(socket, player);
    }
    sendState();
  });

  socket.on('join', () => {
    const player = players.get(socket.id);
    if (!player) {
      return;
    }
    attemptEnroll(socket, player);
    sendState();
  });

  socket.on('start_game', () => {
    if (!ensureAdmin(socket)) {
      return;
    }
    startGame();
  });

  socket.on('admin_command', (command) => {
    if (!ensureAdmin(socket)) {
      return;
    }
    handleAdminCommand(socket, command);
  });

  socket.on('found_someone', () => {
    const player = players.get(socket.id);
    if (!player || player.socketId !== gameState.seekerSocketId) {
      return;
    }
    const hiders = getEnrolledPlayers().filter((member) => member.role === 'HIDER' && !member.found);
    socket.emit('hider_list', hiders.map((member) => ({ socketId: member.socketId, name: member.name })));
  });

  socket.on('select_hider', (payload) => {
    const seeker = players.get(socket.id);
    const hider = players.get(payload.socketId);
    if (!seeker || seeker.socketId !== gameState.seekerSocketId || !hider) {
      return;
    }
    gameState.pendingCatch = { seekerId: seeker.socketId, hiderId: hider.socketId };
    socket.emit('hider_waiting', { name: hider.name });
    io.to(hider.socketId).emit('confirm_catch', { seekerName: seeker.name });
  });

  socket.on('catch_response', (payload) => {
    if (!gameState.pendingCatch) {
      return;
    }
    const { seekerId, hiderId } = gameState.pendingCatch;
    if (socket.id !== hiderId) {
      return;
    }
    const seeker = players.get(seekerId);
    const hider = players.get(hiderId);
    if (!seeker || !hider) {
      gameState.pendingCatch = null;
      return;
    }
    if (payload.accepted) {
      hider.found = true;
      hider.role = 'FOUND HIDER';
      io.to(seekerId).emit('catch_result', { accepted: true, name: hider.name });
      io.to(hiderId).emit('catch_result', { accepted: true, name: hider.name });
      const remainingHiders = getEnrolledPlayers().filter((member) => member.role === 'HIDER' && !member.found);
      if (remainingHiders.length === 0) {
        endRound();
      }
    } else {
      io.to(seekerId).emit('catch_result', { accepted: false, name: hider.name });
      io.to(hiderId).emit('catch_result', { accepted: false, name: hider.name });
    }
    gameState.pendingCatch = null;
    sendState();
  });

  socket.on('minigame_tap', () => {
    if (!gameState.minigame || gameState.minigame.status !== 'green') {
      return;
    }
    if (!gameState.minigame.participants.includes(socket.id)) {
      return;
    }
    if (!gameState.minigame.taps[socket.id]) {
      gameState.minigame.taps[socket.id] = Date.now();
    }
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    players.delete(socket.id);
    if (player && player.socketId === gameState.seekerSocketId) {
      handleSeekerDisconnect();
    }
    sendState();
  });
});

const attemptEnroll = (socket, player) => {
  const now = Date.now();
  if (!gameState.enrollmentOpen) {
    socket.emit('enrollment_closed');
    return;
  }
  if (player.blockedUntil && player.blockedUntil > now) {
    socket.emit('kicked', { remainingMs: player.blockedUntil - now });
    return;
  }
  player.enrolled = true;
  player.role = 'HIDER';
  socket.emit('enrolled');
};

const handleAdminCommand = (socket, command) => {
  switch (command.type) {
    case 'kick_player':
      kickPlayer(command.socketId);
      break;
    case 'force_enroll':
      forceEnroll(command.socketId, true);
      break;
    case 'force_unenroll':
      forceEnroll(command.socketId, false);
      break;
    case 'set_role':
      setRole(command.socketId, command.role);
      break;
    case 'swap_roles':
      swapRoles(command.socketIdA, command.socketIdB);
      break;
    case 'force_found':
      setFound(command.socketId, true);
      break;
    case 'start_game':
      startGame();
      break;
    case 'end_game':
      if (gameState.phase === 'round') {
        socket.emit('admin_error', 'Cannot end game during active round.');
        return;
      }
      setOverlay({
        title: 'THANK YOU FOR PLAYING',
        subtitle: 'RETURNING TO LOBBY',
        durationMs: 5000,
        blockInput: true,
        playNarration: false,
        showTimer: false
      });
      setTimeout(() => {
        resetToLobby();
      }, 5200);
      break;
    case 'force_end_round':
      endRound();
      break;
    case 'force_start_next_round':
      startRoundSequence();
      break;
    case 'timer_set':
      gameState.timer.remaining = Math.max(0, command.seconds);
      gameState.timer.duration = Math.max(gameState.timer.duration, command.seconds);
      sendState();
      break;
    case 'timer_pause':
      pauseTimer();
      break;
    case 'timer_unpause':
      resumeTimer();
      break;
    case 'timer_skip':
      gameState.timer.remaining = 0;
      sendState();
      if (timerExpire) {
        timerExpire();
      }
      break;
    case 'custom_slide':
      setOverlay(command.overlay);
      break;
    case 'reroll_seeker':
      assignRoles();
      sendState();
      break;
    case 'force_next_seeker':
      const target = players.get(command.socketId);
      if (target) {
        setNextSeeker(target);
      }
      break;
    case 'force_minigame_loser':
      if (gameState.phase !== 'minigame') {
        socket.emit('admin_error', 'Minigame is not active.');
        return;
      }
      const loser = players.get(command.socketId);
      if (loser) {
        setNextSeeker(loser);
      }
      break;
    case 'trigger_caught':
      io.to(command.socketId).emit('confirm_catch', { seekerName: 'ADMIN' });
      break;
    case 'sound_test':
      io.emit('sound_test', command.sound);
      break;
    case 'reset_all':
      resetToLobby();
      break;
    default:
      socket.emit('admin_error', 'Unknown command.');
  }
};

const kickPlayer = (socketId) => {
  const player = players.get(socketId);
  if (!player) {
    return;
  }
  player.enrolled = false;
  player.role = 'SPECTATOR';
  player.blockedUntil = Date.now() + 10000;
  io.to(socketId).emit('kicked', { remainingMs: 10000 });
  sendState();
};

const forceEnroll = (socketId, enroll) => {
  const player = players.get(socketId);
  if (!player) {
    return;
  }
  player.enrolled = enroll;
  if (!enroll) {
    player.role = 'SPECTATOR';
  }
  sendState();
};

const setRole = (socketId, role) => {
  const player = players.get(socketId);
  if (!player) {
    return;
  }
  player.role = role;
  sendState();
};

const swapRoles = (socketIdA, socketIdB) => {
  const playerA = players.get(socketIdA);
  const playerB = players.get(socketIdB);
  if (!playerA || !playerB) {
    return;
  }
  const temp = playerA.role;
  playerA.role = playerB.role;
  playerB.role = temp;
  sendState();
};

const setFound = (socketId, found) => {
  const player = players.get(socketId);
  if (!player) {
    return;
  }
  player.found = found;
  if (found) {
    player.role = 'FOUND HIDER';
  } else if (player.role === 'FOUND HIDER') {
    player.role = 'HIDER';
  }
  sendState();
};

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
