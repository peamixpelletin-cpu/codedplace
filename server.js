const path = require('path');
const express = require('express');
const http = require('http');
const multer = require('multer');
const { Server } = require('socket.io');

const ADMIN_CODE = '1923-7328-0011-8123';
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const uploadDir = path.join(__dirname, 'uploads');
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`;
    cb(null, safeName);
  }
});
const upload = multer({ storage });

app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

const codes = new Map();
const users = new Map();
const roles = new Set(['Hider', 'Seeker', 'Spectator']);
let roundsEnabled = false;
let roundNumber = 1;
let timerState = {
  remaining: 0,
  running: false,
  updatedAt: Date.now()
};
let timerInterval = null;

function generateCode() {
  const segment = () => Math.random().toString(16).slice(2, 6).toUpperCase().padEnd(4, '0');
  return `${segment()}-${segment()}-${segment()}-${segment()}`;
}

function isExpired(entry) {
  return entry.expiresAt && Date.now() > entry.expiresAt;
}

function broadcastState() {
  io.emit('state:update', {
    codes: Array.from(codes.entries()).map(([code, data]) => ({ code, ...data })),
    users: Array.from(users.values()),
    roles: Array.from(roles.values()),
    roundsEnabled,
    roundNumber,
    timerState
  });
}

function updateTimerState(nextState) {
  timerState = {
    ...timerState,
    ...nextState,
    updatedAt: Date.now()
  };
  io.emit('timer:update', timerState);
}

function stopTimerInterval() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

app.post('/api/login', (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'Missing code.' });
  }
  if (code === ADMIN_CODE) {
    return res.json({ role: 'admin' });
  }
  const entry = codes.get(code);
  if (!entry) {
    return res.status(401).json({ error: 'Invalid reference code.' });
  }
  if (entry.disabled) {
    return res.status(403).json({ error: 'Reference code disabled.' });
  }
  if (isExpired(entry)) {
    return res.status(403).json({ error: 'Reference code expired.' });
  }
  if (entry.usesLeft <= 0) {
    return res.status(403).json({ error: 'Reference code exhausted.' });
  }
  entry.usesLeft -= 1;
  codes.set(code, entry);
  broadcastState();
  return res.json({ role: 'user', permission: entry.permission || 'User' });
});

app.post('/api/upload', upload.single('avatar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }
  return res.json({ url: `/uploads/${req.file.filename}` });
});

io.on('connection', (socket) => {
  socket.on('join', (payload, callback) => {
    const { username, avatarUrl, permission, admin } = payload || {};
    if (admin) {
      users.set(socket.id, {
        id: socket.id,
        username: 'Admin',
        avatarUrl: null,
        role: 'Admin',
        permission: 'Admin',
        isAdmin: true
      });
      callback({ ok: true, state: { roundsEnabled, roundNumber, roles: Array.from(roles.values()) } });
      broadcastState();
      return;
    }
    const trimmed = (username || '').trim();
    if (!trimmed) {
      callback({ ok: false, error: 'Username is required.' });
      return;
    }
    const exists = Array.from(users.values()).some((user) => user.username.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      callback({ ok: false, error: 'Username already taken.' });
      return;
    }
    const user = {
      id: socket.id,
      username: trimmed,
      avatarUrl: avatarUrl || null,
      role: null,
      permission: permission || 'User',
      isAdmin: false
    };
    users.set(socket.id, user);
    callback({ ok: true, state: { roundsEnabled, roundNumber, roles: Array.from(roles.values()) } });
    io.emit('user:joined', user);
    broadcastState();
  });

  socket.on('disconnect', () => {
    if (users.has(socket.id)) {
      users.delete(socket.id);
      io.emit('user:left', socket.id);
      broadcastState();
    }
  });

  socket.on('code:create', ({ uses, expiryMinutes, permission }) => {
    const code = generateCode();
    const usesLeft = Math.max(1, Number(uses) || 1);
    const expiresAt = expiryMinutes ? Date.now() + Number(expiryMinutes) * 60000 : null;
    codes.set(code, {
      usesLeft,
      expiresAt,
      permission: permission || 'User',
      disabled: false
    });
    broadcastState();
  });

  socket.on('code:toggle', ({ code }) => {
    const entry = codes.get(code);
    if (!entry) return;
    entry.disabled = !entry.disabled;
    codes.set(code, entry);
    broadcastState();
  });

  socket.on('code:delete', ({ code }) => {
    codes.delete(code);
    broadcastState();
  });

  socket.on('user:kick', ({ id }) => {
    const target = io.sockets.sockets.get(id);
    if (target) {
      target.emit('user:kicked');
      target.disconnect(true);
    }
  });

  socket.on('user:permission', ({ id, permission }) => {
    const entry = users.get(id);
    if (!entry) return;
    entry.permission = permission;
    users.set(id, entry);
    io.emit('user:updated', entry);
    broadcastState();
  });

  socket.on('role:create', ({ name }) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    roles.add(trimmed);
    broadcastState();
  });

  socket.on('role:delete', ({ name }) => {
    if (!roles.has(name)) return;
    roles.delete(name);
    users.forEach((user) => {
      if (user.role === name) {
        user.role = null;
        users.set(user.id, user);
      }
    });
    broadcastState();
  });

  socket.on('role:assign', ({ userId, role }) => {
    const entry = users.get(userId);
    if (!entry) return;
    entry.role = role || null;
    users.set(userId, entry);
    io.emit('user:updated', entry);
    broadcastState();
  });

  socket.on('roles:randomize', ({ caps }) => {
    const roleList = Array.from(roles.values());
    const availableUsers = Array.from(users.values()).filter((user) => !user.isAdmin);
    const remainingCaps = new Map();
    roleList.forEach((role) => {
      const capValue = caps && caps[role] ? Number(caps[role]) : null;
      remainingCaps.set(role, capValue && capValue > 0 ? capValue : null);
    });
    availableUsers.forEach((user) => {
      const shuffled = roleList.sort(() => Math.random() - 0.5);
      const assignable = shuffled.find((role) => {
        const cap = remainingCaps.get(role);
        return cap === null || cap > 0;
      });
      user.role = assignable || null;
      if (assignable && remainingCaps.get(assignable) !== null) {
        remainingCaps.set(assignable, remainingCaps.get(assignable) - 1);
      }
      users.set(user.id, user);
    });
    broadcastState();
  });

  socket.on('rounds:update', ({ enabled, number }) => {
    roundsEnabled = Boolean(enabled);
    roundNumber = Number(number) || 1;
    broadcastState();
  });

  socket.on('broadcast', ({ title, subtitle }) => {
    io.emit('broadcast', { title, subtitle });
  });

  socket.on('role:message', ({ messages }) => {
    io.emit('role:message', { messages });
  });

  socket.on('timer:start', ({ seconds }) => {
    stopTimerInterval();
    const duration = Math.max(0, Number(seconds) || 0);
    updateTimerState({ remaining: duration, running: true });
    timerInterval = setInterval(() => {
      if (timerState.remaining <= 0) {
        stopTimerInterval();
        updateTimerState({ remaining: 0, running: false });
        return;
      }
      updateTimerState({ remaining: timerState.remaining - 1, running: true });
    }, 1000);
  });

  socket.on('timer:pause', () => {
    stopTimerInterval();
    updateTimerState({ running: false });
  });

  socket.on('timer:stop', () => {
    stopTimerInterval();
    updateTimerState({ running: false, remaining: 0 });
  });

  socket.emit('state:init', {
    codes: Array.from(codes.entries()).map(([code, data]) => ({ code, ...data })),
    users: Array.from(users.values()),
    roles: Array.from(roles.values()),
    roundsEnabled,
    roundNumber,
    timerState
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Hide & Seek Judge running on http://localhost:${PORT}`);
});
