const socket = io();

const panels = {
  landing: document.getElementById('landing'),
  profile: document.getElementById('profile'),
  userView: document.getElementById('userView'),
  admin: document.getElementById('admin')
};

const elements = {
  loginButton: document.getElementById('loginButton'),
  loginError: document.getElementById('loginError'),
  referenceCode: document.getElementById('referenceCode'),
  usernameInput: document.getElementById('usernameInput'),
  avatarInput: document.getElementById('avatarInput'),
  profileSubmit: document.getElementById('profileSubmit'),
  profileError: document.getElementById('profileError'),
  roundLabel: document.getElementById('roundLabel'),
  titleText: document.getElementById('titleText'),
  roleText: document.getElementById('roleText'),
  subtitleText: document.getElementById('subtitleText'),
  timerText: document.getElementById('timerText'),
  previewRound: document.getElementById('previewRound'),
  previewTitle: document.getElementById('previewTitle'),
  previewRole: document.getElementById('previewRole'),
  previewSubtitle: document.getElementById('previewSubtitle'),
  previewTimer: document.getElementById('previewTimer'),
  majorAlert: document.getElementById('majorAlert'),
  minorAlert: document.getElementById('minorAlert'),
  tickSound: document.getElementById('tickSound'),
  alarmSound: document.getElementById('alarmSound'),
  codeUses: document.getElementById('codeUses'),
  codeExpiry: document.getElementById('codeExpiry'),
  codePermission: document.getElementById('codePermission'),
  createCode: document.getElementById('createCode'),
  codeList: document.getElementById('codeList'),
  userList: document.getElementById('userList'),
  newRole: document.getElementById('newRole'),
  addRole: document.getElementById('addRole'),
  roleList: document.getElementById('roleList'),
  randomizeRoles: document.getElementById('randomizeRoles'),
  roundToggle: document.getElementById('roundToggle'),
  roundNumber: document.getElementById('roundNumber'),
  roundUpdate: document.getElementById('roundUpdate'),
  broadcastTitle: document.getElementById('broadcastTitle'),
  broadcastSubtitle: document.getElementById('broadcastSubtitle'),
  sendBroadcast: document.getElementById('sendBroadcast'),
  roleToggle: document.getElementById('roleToggle'),
  roleMessageRows: document.getElementById('roleMessageRows'),
  sendRoleMessage: document.getElementById('sendRoleMessage'),
  timerSeconds: document.getElementById('timerSeconds'),
  timerStart: document.getElementById('timerStart'),
  timerPause: document.getElementById('timerPause'),
  timerStop: document.getElementById('timerStop'),
  timerPreview: document.getElementById('timerPreview'),
  scriptArea: document.getElementById('scriptArea'),
  runScript: document.getElementById('runScript'),
  pauseScript: document.getElementById('pauseScript'),
  scriptStatus: document.getElementById('scriptStatus')
};

let session = {
  role: null,
  permission: null,
  username: null,
  isAdmin: false
};
let lastTitle = '';
let currentRoles = [];
let currentRole = '';
let timerData = { remaining: 0, running: false };
let lastTimerRemaining = null;
let timerTicker = null;
let scriptRunner = null;

function showPanel(panel) {
  Object.values(panels).forEach((item) => item.classList.remove('active'));
  panels[panel].classList.add('active');
}

function formatTime(seconds) {
  const clamped = Math.max(0, seconds);
  const mins = String(Math.floor(clamped / 60)).padStart(2, '0');
  const secs = String(clamped % 60).padStart(2, '0');
  return `[${mins}:${secs}]`;
}

function updateUserView({ title, subtitle, role, roundEnabled, roundNumber, timer }) {
  if (roundEnabled) {
    elements.roundLabel.textContent = `[ROUND ${roundNumber}]`;
    elements.roundLabel.style.display = 'block';
    elements.previewRound.textContent = `[ROUND ${roundNumber}]`;
    elements.previewRound.style.display = 'block';
  } else {
    elements.roundLabel.style.display = 'none';
    elements.previewRound.style.display = 'none';
  }
  if (title !== undefined) {
    elements.titleText.textContent = `[${title.toUpperCase()}]`;
    elements.previewTitle.textContent = `[${title.toUpperCase()}]`;
  }
  if (subtitle !== undefined) {
    elements.subtitleText.textContent = subtitle;
    elements.previewSubtitle.textContent = subtitle;
  }
  if (role !== undefined) {
    currentRole = role || '';
    elements.roleText.textContent = currentRole ? currentRole.toUpperCase() : '';
    elements.previewRole.textContent = currentRole ? currentRole.toUpperCase() : '';
  }
  if (timer) {
    const formatted = formatTime(timer.remaining);
    elements.timerText.textContent = formatted;
    elements.previewTimer.textContent = formatted;
    elements.timerText.classList.toggle('running', timer.running);
    elements.previewTimer.classList.toggle('running', timer.running);
  }
}

function playAlert(newTitle) {
  if (newTitle !== lastTitle) {
    elements.majorAlert.play().catch(() => {});
  } else {
    elements.minorAlert.play().catch(() => {});
  }
  lastTitle = newTitle;
}

function handleTimer(state) {
  timerData = { ...state };
  updateUserView({ timer: timerData });
  elements.timerPreview.textContent = formatTime(timerData.remaining);
  elements.timerPreview.classList.toggle('running', timerData.running);
  if (timerTicker) {
    clearInterval(timerTicker);
    timerTicker = null;
  }
  if (timerData.running) {
    timerTicker = setInterval(() => {
      elements.tickSound.play().catch(() => {});
    }, 1000);
  }
  if (!timerData.running && timerData.remaining === 0 && lastTimerRemaining !== 0) {
    elements.alarmSound.play().catch(() => {});
  }
  lastTimerRemaining = timerData.remaining;
}

function deterministicColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

function buildAvatar(user) {
  if (user.avatarUrl) {
    const img = document.createElement('img');
    img.src = user.avatarUrl;
    img.alt = user.username;
    img.width = 40;
    img.height = 40;
    img.style.borderRadius = '50%';
    return img;
  }
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = user.username.charAt(0).toUpperCase();
  avatar.style.background = deterministicColor(user.username);
  return avatar;
}

function renderCodes(codes) {
  elements.codeList.innerHTML = '';
  codes.forEach((code) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const meta = document.createElement('div');
    meta.className = 'meta';
    const expiryText = code.expiresAt ? `Expires ${new Date(code.expiresAt).toLocaleString()}` : 'No expiry';
    meta.textContent = `${code.code} | Uses: ${code.usesLeft} | ${expiryText} | ${code.permission}`;
    const actions = document.createElement('div');
    const toggle = document.createElement('button');
    toggle.textContent = code.disabled ? 'Enable' : 'Disable';
    toggle.addEventListener('click', () => socket.emit('code:toggle', { code: code.code }));
    const remove = document.createElement('button');
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => socket.emit('code:delete', { code: code.code }));
    actions.append(toggle, remove);
    item.append(meta, actions);
    elements.codeList.append(item);
  });
}

function renderUsers(userList) {
  elements.userList.innerHTML = '';
  userList.filter((user) => !user.isAdmin).forEach((user) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const info = document.createElement('div');
    info.className = 'meta';
    info.textContent = `${user.username} ${user.role ? `(${user.role})` : ''}`;
    const actions = document.createElement('div');
    const kick = document.createElement('button');
    kick.textContent = 'Kick';
    kick.addEventListener('click', () => socket.emit('user:kick', { id: user.id }));
    const permission = document.createElement('button');
    permission.textContent = 'Toggle Admin';
    permission.addEventListener('click', () => {
      socket.emit('user:permission', { id: user.id, permission: user.permission === 'Admin' ? 'User' : 'Admin' });
    });
    const roleSelect = document.createElement('select');
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'No role';
    roleSelect.append(empty);
    currentRoles.forEach((role) => {
      const option = document.createElement('option');
      option.value = role;
      option.textContent = role;
      if (user.role === role) option.selected = true;
      roleSelect.append(option);
    });
    roleSelect.addEventListener('change', (event) => {
      socket.emit('role:assign', { userId: user.id, role: event.target.value || null });
    });
    actions.append(roleSelect, permission, kick);
    item.prepend(buildAvatar(user));
    item.append(info, actions);
    elements.userList.append(item);
  });
}

function renderRoles(roleList) {
  currentRoles = roleList;
  elements.roleList.innerHTML = '';
  elements.roleMessageRows.innerHTML = '';
  roleList.forEach((role) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    const label = document.createElement('div');
    label.textContent = role;
    const remove = document.createElement('button');
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => socket.emit('role:delete', { name: role }));
    item.append(label, remove);
    elements.roleList.append(item);

    const row = document.createElement('div');
    row.className = 'form-row role-row';
    row.dataset.role = role;
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = `${role} Title`;
    const subInput = document.createElement('input');
    subInput.type = 'text';
    subInput.placeholder = `${role} Subtitle`;
    row.append(titleInput, subInput);
    elements.roleMessageRows.append(row);
  });
}

function updateRounds(enabled, number) {
  elements.roundToggle.checked = enabled;
  elements.roundNumber.value = number;
  updateUserView({ roundEnabled: enabled, roundNumber: number });
}

function setTimerState(state) {
  handleTimer(state);
}

function runScript(lines) {
  if (scriptRunner) {
    elements.scriptStatus.textContent = 'Script already running.';
    return;
  }
  let index = 0;
  let paused = false;
  elements.scriptStatus.textContent = 'Running...';

  const executeNext = () => {
    if (paused) {
      elements.scriptStatus.textContent = 'Paused.';
      return;
    }
    if (index >= lines.length) {
      elements.scriptStatus.textContent = 'Script complete.';
      scriptRunner = null;
      return;
    }
    const line = lines[index].trim();
    index += 1;
    if (!line) {
      executeNext();
      return;
    }
    const waitMatch = line.match(/^WAIT\s+(\d+)/i);
    const timerMatch = line.match(/^TIMER\s+(\d+)/i);
    const broadcastMatch = line.match(/^BROADCAST\s+TITLE\s+"([^"]*)"\s+SUB\s+"([^"]*)"/i);
    const roleMatch = line.match(/^MSG_ROLE\s+([^\s]+)\s+TITLE\s+"([^"]*)"\s+SUB\s+"([^"]*)"/i);

    if (waitMatch) {
      const waitTime = Number(waitMatch[1]) * 1000;
      setTimeout(executeNext, waitTime);
      return;
    }
    if (timerMatch) {
      socket.emit('timer:start', { seconds: Number(timerMatch[1]) });
      executeNext();
      return;
    }
    if (broadcastMatch) {
      socket.emit('broadcast', { title: broadcastMatch[1], subtitle: broadcastMatch[2] });
      executeNext();
      return;
    }
    if (roleMatch) {
      socket.emit('role:message', {
        messages: {
          [roleMatch[1]]: { title: roleMatch[2], subtitle: roleMatch[3] }
        }
      });
      executeNext();
      return;
    }
    elements.scriptStatus.textContent = `Unknown command: ${line}`;
    scriptRunner = null;
  };

  scriptRunner = { pause: () => { paused = true; } };
  executeNext();
}

function initTabs() {
  document.querySelectorAll('.tabs button').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((tab) => tab.classList.remove('active'));
      button.classList.add('active');
      document.querySelectorAll('.tab-content').forEach((panel) => panel.classList.remove('active'));
      document.getElementById(`tab-${button.dataset.tab}`).classList.add('active');
    });
  });
  document.getElementById('tab-users').classList.add('active');
}

async function login() {
  elements.loginError.textContent = '';
  const code = elements.referenceCode.value.trim();
  if (!code) {
    elements.loginError.textContent = 'Please enter a code.';
    return;
  }
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
  const data = await response.json();
  if (!response.ok) {
    elements.loginError.textContent = data.error || 'Login failed.';
    return;
  }
  session.role = data.role;
  session.permission = data.permission || 'User';
  if (data.role === 'admin') {
    session.isAdmin = true;
    showPanel('admin');
    initTabs();
    socket.emit('join', { admin: true }, () => {});
  } else {
    showPanel('profile');
  }
}

async function submitProfile() {
  elements.profileError.textContent = '';
  const username = elements.usernameInput.value.trim();
  if (!username) {
    elements.profileError.textContent = 'Username required.';
    return;
  }
  let avatarUrl = '';
  if (elements.avatarInput.files.length) {
    const formData = new FormData();
    formData.append('avatar', elements.avatarInput.files[0]);
    const response = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) {
      elements.profileError.textContent = data.error || 'Upload failed.';
      return;
    }
    avatarUrl = data.url;
  }
  socket.emit('join', { username, avatarUrl, permission: session.permission }, (result) => {
    if (!result.ok) {
      elements.profileError.textContent = result.error;
      return;
    }
    session.username = username;
    showPanel('userView');
  });
}

socket.on('state:init', (state) => {
  renderCodes(state.codes || []);
  renderUsers(state.users || []);
  renderRoles(state.roles || []);
  updateRounds(state.roundsEnabled, state.roundNumber);
  setTimerState(state.timerState || { remaining: 0, running: false });
  if (session.username) {
    const me = (state.users || []).find((user) => user.username === session.username);
    if (me) updateUserView({ role: me.role });
  }
});

socket.on('state:update', (state) => {
  renderCodes(state.codes || []);
  renderUsers(state.users || []);
  renderRoles(state.roles || []);
  updateRounds(state.roundsEnabled, state.roundNumber);
  if (session.username) {
    const me = (state.users || []).find((user) => user.username === session.username);
    if (me) updateUserView({ role: me.role });
  }
});

socket.on('user:updated', (user) => {
  if (session.username && user.username === session.username) {
    updateUserView({ role: user.role });
  }
});

socket.on('broadcast', ({ title, subtitle }) => {
  updateUserView({ title, subtitle });
  playAlert(title);
});

socket.on('role:message', ({ messages }) => {
  if (!session.username) return;
  const matching = messages && Object.keys(messages).find((key) => key.toLowerCase() === currentRole.toLowerCase());
  if (matching) {
    const message = messages[matching];
    updateUserView({ title: message.title, subtitle: message.subtitle });
    playAlert(message.title);
  }
});

socket.on('timer:update', (state) => {
  setTimerState(state);
});

socket.on('user:kicked', () => {
  alert('You have been removed by the admin.');
  window.location.reload();
});

socket.on('user:joined', (user) => {
  if (session.username && user.username === session.username) {
    updateUserView({ role: user.role });
  }
});

elements.loginButton.addEventListener('click', login);
elements.profileSubmit.addEventListener('click', submitProfile);

elements.createCode.addEventListener('click', () => {
  socket.emit('code:create', {
    uses: elements.codeUses.value,
    expiryMinutes: elements.codeExpiry.value,
    permission: elements.codePermission.value
  });
});

elements.addRole.addEventListener('click', () => {
  socket.emit('role:create', { name: elements.newRole.value });
  elements.newRole.value = '';
});

elements.randomizeRoles.addEventListener('click', () => {
  const caps = {};
  document.querySelectorAll('#roleList .list-item').forEach((item) => {
    const role = item.querySelector('div').textContent;
    caps[role] = null;
  });
  socket.emit('roles:randomize', { caps });
});

elements.roundUpdate.addEventListener('click', () => {
  socket.emit('rounds:update', { enabled: elements.roundToggle.checked, number: elements.roundNumber.value });
});

elements.sendBroadcast.addEventListener('click', () => {
  socket.emit('broadcast', { title: elements.broadcastTitle.value, subtitle: elements.broadcastSubtitle.value });
});

elements.sendRoleMessage.addEventListener('click', () => {
  if (!elements.roleToggle.checked) {
    socket.emit('broadcast', { title: elements.broadcastTitle.value, subtitle: elements.broadcastSubtitle.value });
    return;
  }
  const messages = {};
  document.querySelectorAll('.role-row').forEach((row) => {
    const role = row.dataset.role;
    const inputs = row.querySelectorAll('input');
    messages[role] = { title: inputs[0].value, subtitle: inputs[1].value };
  });
  socket.emit('role:message', { messages });
});

elements.roleToggle.addEventListener('change', () => {
  const visible = elements.roleToggle.checked;
  elements.roleMessageRows.style.display = visible ? 'flex' : 'none';
});

elements.timerStart.addEventListener('click', () => {
  socket.emit('timer:start', { seconds: elements.timerSeconds.value });
});

elements.timerPause.addEventListener('click', () => {
  socket.emit('timer:pause');
});

elements.timerStop.addEventListener('click', () => {
  socket.emit('timer:stop');
});

elements.runScript.addEventListener('click', () => {
  const lines = elements.scriptArea.value.split('\n');
  runScript(lines);
});

elements.pauseScript.addEventListener('click', () => {
  if (scriptRunner) {
    scriptRunner.pause();
  }
});

updateUserView({ title: 'Ready', subtitle: 'Awaiting instructions.', role: '' });
showPanel('landing');
