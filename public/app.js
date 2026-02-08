const socket = io();

const loginSlide = document.getElementById('login');
const mainSlide = document.getElementById('main');
const overlay = document.getElementById('overlay');

const loginInput = document.getElementById('login-input');
const loginButton = document.getElementById('login-button');
const loginError = document.getElementById('login-error');

const title = document.getElementById('title');
const subtitle = document.getElementById('subtitle');
const info = document.getElementById('info');
const timer = document.getElementById('timer');
const joinButton = document.getElementById('join-button');
const foundButton = document.getElementById('found-button');
const statusMessage = document.getElementById('status-message');
const userInfo = document.getElementById('user-info');
const adminToggle = document.getElementById('admin-toggle');

const hiderSelection = document.getElementById('hider-selection');
const hiderList = document.getElementById('hider-list');
const catchConfirm = document.getElementById('catch-confirm');
const catchText = document.getElementById('catch-text');
const confirmCatch = document.getElementById('confirm-catch');
const denyCatch = document.getElementById('deny-catch');

const minigame = document.getElementById('minigame');
const minigameText = document.getElementById('minigame-text');
const tapButton = document.getElementById('tap-button');

const adminPanel = document.getElementById('admin-panel');
const adminClose = document.getElementById('admin-close');
const adminPlayerList = document.getElementById('admin-player-list');
const swapA = document.getElementById('swap-a');
const swapB = document.getElementById('swap-b');
const swapRoles = document.getElementById('swap-roles');
const adminStart = document.getElementById('admin-start');
const adminEnd = document.getElementById('admin-end');
const adminEndRound = document.getElementById('admin-end-round');
const adminNextRound = document.getElementById('admin-next-round');
const timerValue = document.getElementById('timer-value');
const timerSet = document.getElementById('timer-set');
const timerPause = document.getElementById('timer-pause');
const timerUnpause = document.getElementById('timer-unpause');
const timerSkip = document.getElementById('timer-skip');
const slideMessage = document.getElementById('slide-message');
const slideBlock = document.getElementById('slide-block');
const slideTimer = document.getElementById('slide-timer');
const slideSend = document.getElementById('slide-send');
const cheatReroll = document.getElementById('cheat-reroll');
const forceSeekerSelect = document.getElementById('force-seeker');
const cheatForce = document.getElementById('cheat-force');
const forceLoserSelect = document.getElementById('force-loser');
const cheatLoser = document.getElementById('cheat-loser');
const triggerCaughtSelect = document.getElementById('trigger-caught');
const cheatCaught = document.getElementById('cheat-caught');
const debugState = document.getElementById('debug-state');
const stateJson = document.getElementById('state-json');
const debugReset = document.getElementById('debug-reset');

const overlayTitle = document.getElementById('overlay-title');
const overlaySubtitle = document.getElementById('overlay-subtitle');
const overlayTimer = document.getElementById('overlay-timer');

let currentPlayer = null;
let currentState = null;
let lastTimerValue = null;
let overlayInterval = null;
let kickedInterval = null;

const soundManager = (() => {
  const context = new (window.AudioContext || window.webkitAudioContext)();
  const sounds = {
    transition: new Audio('/sounds/transition.wav'),
    tick: new Audio('/sounds/tick.wav'),
    expire: new Audio('/sounds/expire.wav'),
    caught_alert: new Audio('/sounds/caught_alert.wav')
  };

  const playTone = (freq, duration) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = freq;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
    oscillator.stop(context.currentTime + duration);
  };

  const play = (name) => {
    const audio = sounds[name];
    if (!audio) {
      return;
    }
    audio.currentTime = 0;
    audio.play().catch(() => {
      if (name === 'tick') {
        playTone(880, 0.1);
      } else if (name === 'expire') {
        playTone(220, 0.4);
      } else if (name === 'caught_alert') {
        playTone(120, 0.6);
      } else {
        playTone(440, 0.2);
      }
    });
  };

  return { play };
})();

const showSlide = (slide) => {
  if (slide === 'login') {
    loginSlide.classList.add('active');
    mainSlide.classList.remove('active');
  } else {
    loginSlide.classList.remove('active');
    mainSlide.classList.add('active');
  }
};

const formatTimer = (seconds) => {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `[${minutes}:${secs}]`;
};

const updateTimerDisplay = (timerState) => {
  if (!timerState || timerState.duration === 0) {
    timer.textContent = '';
    timer.classList.remove('running');
    return;
  }
  timer.textContent = formatTimer(timerState.remaining);
  if (timerState.running) {
    timer.classList.add('running');
  } else {
    timer.classList.remove('running');
  }
};

const updateOverlay = (overlayState) => {
  if (!overlayState) {
    overlay.classList.add('hidden');
    document.body.classList.remove('blocked');
    overlayTitle.textContent = '';
    overlaySubtitle.textContent = '';
    overlayTimer.textContent = '';
    if (overlayInterval) {
      clearInterval(overlayInterval);
      overlayInterval = null;
    }
    return;
  }
  overlay.classList.remove('hidden');
  if (overlayState.blockInput) {
    document.body.classList.add('blocked');
  } else {
    document.body.classList.remove('blocked');
  }
  overlayTitle.textContent = overlayState.title || '';
  overlaySubtitle.textContent = overlayState.subtitle || '';
  if (overlayState.showTimer) {
    const endTime = overlayState.startedAt + overlayState.durationMs;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
      overlayTimer.textContent = formatTimer(remaining);
    };
    update();
    if (overlayInterval) {
      clearInterval(overlayInterval);
    }
    overlayInterval = setInterval(update, 500);
  } else {
    overlayTimer.textContent = '';
  }
};

const updateAdminLists = (players) => {
  adminPlayerList.innerHTML = '';
  forceSeekerSelect.innerHTML = '';
  triggerCaughtSelect.innerHTML = '';
  forceLoserSelect.innerHTML = '';
  swapA.innerHTML = '';
  swapB.innerHTML = '';
  players.forEach((player) => {
    const row = document.createElement('div');
    row.className = 'admin-row';
    row.textContent = `${player.name} (${player.rank}) - ${player.enrolled ? 'Enrolled' : 'Spectator'} - ${player.role}`;
    const kickButton = document.createElement('button');
    kickButton.textContent = 'X';
    kickButton.addEventListener('click', () => {
      socket.emit('admin_command', { type: 'kick_player', socketId: player.socketId });
    });
    const forceEnroll = document.createElement('button');
    forceEnroll.textContent = player.enrolled ? 'Unenroll' : 'Enroll';
    forceEnroll.addEventListener('click', () => {
      socket.emit('admin_command', { type: player.enrolled ? 'force_unenroll' : 'force_enroll', socketId: player.socketId });
    });
    const roleSelect = document.createElement('select');
    ['SEEKER', 'HIDER', 'FOUND HIDER', 'SPECTATOR'].forEach((role) => {
      const option = document.createElement('option');
      option.value = role;
      option.textContent = role;
      if (role === player.role) {
        option.selected = true;
      }
      roleSelect.appendChild(option);
    });
    roleSelect.addEventListener('change', () => {
      socket.emit('admin_command', { type: 'set_role', socketId: player.socketId, role: roleSelect.value });
    });
    const forceFound = document.createElement('button');
    forceFound.textContent = 'Force Found';
    forceFound.addEventListener('click', () => {
      socket.emit('admin_command', { type: 'force_found', socketId: player.socketId });
    });
    row.appendChild(kickButton);
    row.appendChild(forceEnroll);
    row.appendChild(roleSelect);
    row.appendChild(forceFound);
    adminPlayerList.appendChild(row);

    const option = document.createElement('option');
    option.value = player.socketId;
    option.textContent = player.name;
    forceSeekerSelect.appendChild(option);

    const caughtOption = document.createElement('option');
    caughtOption.value = player.socketId;
    caughtOption.textContent = player.name;
    triggerCaughtSelect.appendChild(caughtOption);

    const loserOption = document.createElement('option');
    loserOption.value = player.socketId;
    loserOption.textContent = player.name;
    forceLoserSelect.appendChild(loserOption);

    const swapOptionA = document.createElement('option');
    swapOptionA.value = player.socketId;
    swapOptionA.textContent = player.name;
    swapA.appendChild(swapOptionA);

    const swapOptionB = document.createElement('option');
    swapOptionB.value = player.socketId;
    swapOptionB.textContent = player.name;
    swapB.appendChild(swapOptionB);
  });
};

const renderState = (state) => {
  currentState = state;
  const role = currentPlayer ? currentPlayer.role : 'SPECTATOR';
  subtitle.textContent = '';
  statusMessage.textContent = '';
  foundButton.classList.add('hidden');
  joinButton.classList.add('hidden');
  hiderSelection.classList.add('hidden');
  catchConfirm.classList.add('hidden');
  minigame.classList.add('hidden');
  tapButton.disabled = true;

  if (state.phase === 'lobby') {
    title.textContent = 'LOBBY';
    info.textContent = state.enrollmentOpen ? 'ENROLLMENT OPEN' : 'ENROLLMENT CLOSED';
    if (!currentPlayer?.enrolled && state.enrollmentOpen) {
      joinButton.classList.remove('hidden');
    }
  } else if (state.phase === 'starting') {
    title.textContent = '[JUDGE]';
    subtitle.textContent = 'THE FIRST SEEKER WILL NOW BE CHOSEN';
    info.textContent = '';
  } else if (state.phase === 'round') {
    title.textContent = `[ROUND ${state.roundNumber}]`;
    subtitle.textContent = `[${role}]`;
    info.textContent = state.infoText || '';
    if (state.roundPhase === 'main' && currentPlayer?.socketId === state.seekerSocketId) {
      foundButton.classList.remove('hidden');
    }
    if (role === 'FOUND HIDER') {
      subtitle.textContent = '[FOUND HIDER]';
      info.textContent = 'PLEASE RETURN TO THE LOBBY ROOM AND WAIT FOR THE ROUND TO END';
    }
  } else if (state.phase === 'return') {
    title.textContent = '[RETURN]';
    subtitle.textContent = '';
    info.textContent = state.infoText;
  } else if (state.phase === 'minigame') {
    title.textContent = '[MINIGAME]';
    subtitle.textContent = '[REACTION TAP]';
    info.textContent = state.infoText;
    if (state.minigame && state.minigame.participants.includes(currentPlayer?.socketId)) {
      minigame.classList.remove('hidden');
      if (state.minigame.status === 'green') {
        minigameText.textContent = 'TAP NOW!';
        tapButton.disabled = false;
      } else {
        minigameText.textContent = 'WAIT FOR GREEN...';
        tapButton.disabled = true;
      }
    }
  }

  updateTimerDisplay(state.timer);
  updateOverlay(state.overlay);

  if (state.timer.running && lastTimerValue !== null && state.timer.remaining !== lastTimerValue) {
    soundManager.play('tick');
  }
  if (lastTimerValue !== null && lastTimerValue > 0 && state.timer.remaining === 0) {
    soundManager.play('expire');
  }
  lastTimerValue = state.timer.remaining;

  if (currentPlayer && currentPlayer.rank === 'Admin') {
    adminToggle.classList.remove('hidden');
    updateAdminLists(state.players || []);
  }
};

loginButton.addEventListener('click', () => {
  loginError.textContent = '';
  socket.emit('login', { id: loginInput.value.trim() });
});

joinButton.addEventListener('click', () => {
  socket.emit('join');
});

foundButton.addEventListener('click', () => {
  socket.emit('found_someone');
});

confirmCatch.addEventListener('click', () => {
  socket.emit('catch_response', { accepted: true });
  catchConfirm.classList.add('hidden');
});

denyCatch.addEventListener('click', () => {
  socket.emit('catch_response', { accepted: false });
  catchConfirm.classList.add('hidden');
});

tapButton.addEventListener('click', () => {
  socket.emit('minigame_tap');
  tapButton.disabled = true;
});

adminToggle.addEventListener('click', () => {
  adminPanel.classList.remove('hidden');
});

adminClose.addEventListener('click', () => {
  adminPanel.classList.add('hidden');
});

adminStart.addEventListener('click', () => {
  socket.emit('admin_command', { type: 'start_game' });
});

adminEnd.addEventListener('click', () => {
  socket.emit('admin_command', { type: 'end_game' });
});

adminEndRound.addEventListener('click', () => {
  socket.emit('admin_command', { type: 'force_end_round' });
});

adminNextRound.addEventListener('click', () => {
  socket.emit('admin_command', { type: 'force_start_next_round' });
});

timerSet.addEventListener('click', () => {
  socket.emit('admin_command', { type: 'timer_set', seconds: Number(timerValue.value) || 0 });
});

timerPause.addEventListener('click', () => {
  socket.emit('admin_command', { type: 'timer_pause' });
});

timerUnpause.addEventListener('click', () => {
  socket.emit('admin_command', { type: 'timer_unpause' });
});

timerSkip.addEventListener('click', () => {
  socket.emit('admin_command', { type: 'timer_skip' });
});

slideSend.addEventListener('click', () => {
  const message = slideMessage.value.trim();
  if (!message) {
    return;
  }
  const duration = Math.min(20000, Math.max(3000, 2000 + message.length * (1000 / 18)));
  socket.emit('admin_command', {
    type: 'custom_slide',
    overlay: {
      title: message.toUpperCase(),
      subtitle: '',
      durationMs: duration,
      blockInput: slideBlock.checked,
      playNarration: false,
      showTimer: slideTimer.checked
    }
  });
  slideMessage.value = '';
});

cheatReroll.addEventListener('click', () => {
  socket.emit('admin_command', { type: 'reroll_seeker' });
});

cheatForce.addEventListener('click', () => {
  if (!forceSeekerSelect.value) {
    return;
  }
  socket.emit('admin_command', { type: 'force_next_seeker', socketId: forceSeekerSelect.value });
});

cheatLoser.addEventListener('click', () => {
  if (!forceLoserSelect.value) {
    return;
  }
  socket.emit('admin_command', { type: 'force_minigame_loser', socketId: forceLoserSelect.value });
});

cheatCaught.addEventListener('click', () => {
  if (!triggerCaughtSelect.value) {
    return;
  }
  socket.emit('admin_command', { type: 'trigger_caught', socketId: triggerCaughtSelect.value });
});

Array.from(document.querySelectorAll('.sound-test')).forEach((button) => {
  button.addEventListener('click', () => {
    socket.emit('admin_command', { type: 'sound_test', sound: button.dataset.sound });
  });
});

debugState.addEventListener('click', () => {
  stateJson.textContent = JSON.stringify(currentState, null, 2);
});

debugReset.addEventListener('click', () => {
  socket.emit('admin_command', { type: 'reset_all' });
});

swapRoles.addEventListener('click', () => {
  if (!swapA.value || !swapB.value) {
    return;
  }
  socket.emit('admin_command', { type: 'swap_roles', socketIdA: swapA.value, socketIdB: swapB.value });
});

Array.from(document.querySelectorAll('.tab')).forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((button) => button.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((panel) => panel.classList.add('hidden'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
  });
});

socket.on('login_success', (player) => {
  currentPlayer = player;
  userInfo.textContent = `${player.name} (${player.rank})`;
  showSlide('main');
});

socket.on('login_error', (message) => {
  loginError.textContent = message;
});

socket.on('enrollment_closed', () => {
  statusMessage.textContent = 'Enrollment closed';
});

socket.on('kicked', (payload) => {
  if (kickedInterval) {
    clearInterval(kickedInterval);
  }
  const endAt = Date.now() + payload.remainingMs;
  const update = () => {
    const remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    statusMessage.textContent = `YOU WERE REMOVED. TRY AGAIN IN ${remaining} SECONDS.`;
    if (remaining <= 0) {
      clearInterval(kickedInterval);
      kickedInterval = null;
    }
  };
  update();
  kickedInterval = setInterval(update, 500);
});

socket.on('enrolled', () => {
  statusMessage.textContent = 'Enrolled.';
});

socket.on('state', (state) => {
  if (currentPlayer) {
    const updated = state.players.find((player) => player.socketId === currentPlayer.socketId);
    if (updated) {
      currentPlayer = { ...currentPlayer, ...updated };
    }
  }
  renderState(state);
});

socket.on('hider_list', (list) => {
  hiderList.innerHTML = '';
  hiderSelection.classList.remove('hidden');
  list.forEach((hider) => {
    const button = document.createElement('button');
    button.textContent = hider.name;
    button.addEventListener('click', () => {
      socket.emit('select_hider', { socketId: hider.socketId });
      hiderSelection.classList.add('hidden');
    });
    hiderList.appendChild(button);
  });
});

socket.on('hider_waiting', (payload) => {
  statusMessage.textContent = `PLEASE WAIT FOR ${payload.name} TO CONFIRM`;
});

socket.on('confirm_catch', (payload) => {
  catchConfirm.classList.remove('hidden');
  catchText.textContent = `PLEASE CONFIRM THAT YOU WERE CAUGHT BY ${payload.seekerName}`;
  soundManager.play('caught_alert');
});

socket.on('catch_result', (payload) => {
  if (!payload.accepted) {
    statusMessage.textContent = `${payload.name} denied the catch.`;
  }
  catchConfirm.classList.add('hidden');
});

socket.on('sound_test', (sound) => {
  soundManager.play(sound);
});

socket.on('admin_error', (message) => {
  statusMessage.textContent = message;
});

showSlide('login');
