const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3333;

app.use(express.static("public"));

const profiles = {
  "732800": { name: "Eemi", rank: "Admin" },
  "819223": { name: "Venni", rank: "User" },
  "019765": { name: "Iikka", rank: "User" }
};

const players = new Map();
const bannedIds = new Map();

const gameState = {
  phase: "lobby",
  enrollingOpen: true,
  round: 1,
  seekerSocketId: null,
  timer: {
    remaining: 0,
    running: false,
    label: ""
  },
  pendingCatch: null,
  minigame: {
    active: false,
    choices: new Map()
  }
};

const PHASES = {
  LOBBY: "lobby",
  CHOOSE: "choose_seeker",
  ROLE_REVEAL: "role_reveal",
  INITIAL_WAIT: "initial_wait",
  LOBBY_WAIT: "lobby_wait",
  ROUND: "round",
  RETURN_LOBBY: "return_lobby",
  MINIGAME: "minigame",
  NEXT_ROUND: "next_round",
  ENDED: "ended"
};

function now() {
  return Date.now();
}

function getPlayerList() {
  return Array.from(players.values()).map((player) => ({
    id: player.id,
    name: player.name,
    rank: player.rank,
    role: player.role,
    found: player.found
  }));
}

function broadcastState() {
  const payload = {
    phase: gameState.phase,
    enrollingOpen: gameState.enrollingOpen,
    round: gameState.round,
    seekerId: gameState.seekerSocketId ? players.get(gameState.seekerSocketId)?.id : null,
    timer: gameState.timer,
    pendingCatch: gameState.pendingCatch,
    participants: getPlayerList(),
    minigame: {
      active: gameState.minigame.active
    }
  };
  io.emit("state", payload);
}

function setTimer(seconds, running, label) {
  gameState.timer.remaining = seconds;
  gameState.timer.running = running;
  gameState.timer.label = label;
  broadcastState();
}

function stopTimer() {
  gameState.timer.remaining = 0;
  gameState.timer.running = false;
  gameState.timer.label = "";
  broadcastState();
}

function startGame() {
  if (gameState.phase !== PHASES.LOBBY || players.size === 0) {
    return;
  }
  gameState.enrollingOpen = false;
  gameState.phase = PHASES.CHOOSE;
  setTimer(0, false, "");
  broadcastState();
  setTimeout(assignRolesAndBegin, 1500);
}

function assignRolesAndBegin() {
  const enrolled = Array.from(players.values());
  if (enrolled.length === 0) {
    gameState.phase = PHASES.LOBBY;
    gameState.enrollingOpen = true;
    broadcastState();
    return;
  }
  let seeker = null;
  if (gameState.seekerSocketId && players.has(gameState.seekerSocketId)) {
    seeker = players.get(gameState.seekerSocketId);
  } else {
    seeker = enrolled[Math.floor(Math.random() * enrolled.length)];
  }
  gameState.seekerSocketId = seeker.socketId;

  enrolled.forEach((player) => {
    player.role = player.socketId === seeker.socketId ? "Seeker" : "Hider";
    player.found = false;
  });

  gameState.phase = PHASES.ROLE_REVEAL;
  broadcastState();

  setTimeout(() => {
    gameState.phase = PHASES.INITIAL_WAIT;
    setTimer(15, false, "PLEASE WAIT IN THE LOBBY ROOM FOR THE ROUND TO BEGIN");
    broadcastState();
    setTimeout(() => {
      gameState.timer.running = true;
      broadcastState();
    }, 2000);
  }, 1500);
}

function beginLobbyWait() {
  gameState.phase = PHASES.LOBBY_WAIT;
  setTimer(40, false, "");
  broadcastState();
  setTimeout(() => {
    gameState.timer.running = true;
    broadcastState();
  }, 2000);
}

function beginRound() {
  const hiders = Array.from(players.values()).filter((player) => player.role === "Hider");
  const duration = Math.max(1, hiders.length) * 60;
  gameState.phase = PHASES.ROUND;
  setTimer(duration, false, "");
  broadcastState();
  setTimeout(() => {
    gameState.timer.running = true;
    broadcastState();
  }, 1500);
}

function beginReturnToLobby() {
  gameState.phase = PHASES.RETURN_LOBBY;
  setTimer(30, false, "PLEASE RETURN TO THE LOBBY ROOM");
  broadcastState();
  setTimeout(() => {
    gameState.timer.running = true;
    broadcastState();
  }, 1500);
}

function beginMinigame() {
  const caught = Array.from(players.values()).filter((player) => player.found);
  if (caught.length === 0) {
    assignNextSeekerRandomly();
    return;
  }
  gameState.phase = PHASES.MINIGAME;
  gameState.minigame.active = true;
  gameState.minigame.choices = new Map();
  setTimer(15, true, "MINIGAME: PICK A TILE");
  broadcastState();

  setTimeout(() => {
    resolveMinigame();
  }, 15000);
}

function resolveMinigame() {
  if (!gameState.minigame.active) {
    return;
  }
  const caught = Array.from(players.values()).filter((player) => player.found);
  if (caught.length === 0) {
    assignNextSeekerRandomly();
    return;
  }
  const loser = caught[Math.floor(Math.random() * caught.length)];
  assignNextSeeker(loser.socketId);
}

function assignNextSeekerRandomly() {
  const enrolled = Array.from(players.values());
  if (enrolled.length === 0) {
    gameState.phase = PHASES.LOBBY;
    gameState.enrollingOpen = true;
    broadcastState();
    return;
  }
  const next = enrolled[Math.floor(Math.random() * enrolled.length)];
  assignNextSeeker(next.socketId);
}

function assignNextSeeker(socketId) {
  gameState.minigame.active = false;
  gameState.minigame.choices = new Map();
  gameState.seekerSocketId = socketId;

  players.forEach((player) => {
    player.role = player.socketId === socketId ? "Seeker" : "Hider";
    player.found = false;
  });

  gameState.phase = PHASES.NEXT_ROUND;
  setTimer(5, false, "THE ROUND WILL BEGIN AFTER THE TIME LIMIT");
  broadcastState();
  setTimeout(() => {
    gameState.timer.running = true;
    broadcastState();
  }, 1500);
}

function endRound() {
  gameState.timer.running = false;
  gameState.pendingCatch = null;
  broadcastState();
  setTimeout(beginReturnToLobby, 2000);
}

function concludeReturnLobby() {
  beginMinigame();
}

function tickTimer() {
  if (!gameState.timer.running || gameState.timer.remaining <= 0) {
    return;
  }
  gameState.timer.remaining -= 1;
  if (gameState.timer.remaining <= 0) {
    gameState.timer.remaining = 0;
    gameState.timer.running = false;
    handleTimerExpired();
  }
  broadcastState();
}

function handleTimerExpired() {
  if (gameState.phase === PHASES.INITIAL_WAIT) {
    beginLobbyWait();
    return;
  }
  if (gameState.phase === PHASES.LOBBY_WAIT) {
    beginRound();
    return;
  }
  if (gameState.phase === PHASES.ROUND) {
    endRound();
    return;
  }
  if (gameState.phase === PHASES.RETURN_LOBBY) {
    concludeReturnLobby();
    return;
  }
  if (gameState.phase === PHASES.MINIGAME) {
    resolveMinigame();
    return;
  }
  if (gameState.phase === PHASES.NEXT_ROUND) {
    gameState.round += 1;
    gameState.phase = PHASES.ROLE_REVEAL;
    broadcastState();
    setTimeout(() => {
      gameState.phase = PHASES.INITIAL_WAIT;
      setTimer(15, false, "PLEASE WAIT IN THE LOBBY ROOM FOR THE ROUND TO BEGIN");
      broadcastState();
      setTimeout(() => {
        gameState.timer.running = true;
        broadcastState();
      }, 2000);
    }, 1500);
  }
}

function checkEndRoundByFound() {
  const hiders = Array.from(players.values()).filter((player) => player.role === "Hider");
  if (hiders.length > 0 && hiders.every((player) => player.found)) {
    endRound();
  }
}

io.on("connection", (socket) => {
  socket.emit("profiles", profiles);
  socket.emit("state", {
    phase: gameState.phase,
    enrollingOpen: gameState.enrollingOpen,
    round: gameState.round,
    seekerId: gameState.seekerSocketId ? players.get(gameState.seekerSocketId)?.id : null,
    timer: gameState.timer,
    pendingCatch: gameState.pendingCatch,
    participants: getPlayerList(),
    minigame: {
      active: gameState.minigame.active
    }
  });

  socket.on("enroll", (payload) => {
    const id = String(payload?.id || "").trim();
    if (!profiles[id]) {
      socket.emit("enroll_error", "INVALID ID");
      return;
    }
    const bannedUntil = bannedIds.get(id);
    if (bannedUntil && bannedUntil > now()) {
      socket.emit("enroll_error", "YOU ARE TEMPORARILY BLOCKED");
      return;
    }
    if (!gameState.enrollingOpen) {
      socket.emit("enroll_error", "ENROLLING IS CLOSED");
      return;
    }
    const existing = Array.from(players.values()).find((player) => player.id === id);
    if (existing) {
      socket.emit("enroll_error", "ID ALREADY ENROLLED");
      return;
    }
    const profile = profiles[id];
    const player = {
      socketId: socket.id,
      id,
      name: profile.name,
      rank: profile.rank,
      role: "Pending",
      found: false
    };
    players.set(socket.id, player);
    broadcastState();
  });

  socket.on("start_game", () => {
    const player = players.get(socket.id);
    if (!player || player.rank !== "Admin") {
      return;
    }
    startGame();
  });

  socket.on("end_game", () => {
    const player = players.get(socket.id);
    if (!player || player.rank !== "Admin") {
      return;
    }
    gameState.phase = PHASES.ENDED;
    gameState.timer.running = false;
    gameState.pendingCatch = null;
    broadcastState();
  });

  socket.on("remove_player", (payload) => {
    const player = players.get(socket.id);
    if (!player || player.rank !== "Admin") {
      return;
    }
    const targetId = payload?.id;
    if (!targetId) {
      return;
    }
    const target = Array.from(players.values()).find((entry) => entry.id === targetId);
    if (target) {
      players.delete(target.socketId);
    }
    bannedIds.set(targetId, now() + 10000);
    broadcastState();
  });

  socket.on("found_hider", (payload) => {
    const seeker = players.get(socket.id);
    if (!seeker || seeker.role !== "Seeker" || gameState.phase !== PHASES.ROUND) {
      return;
    }
    const hiderId = payload?.id;
    const hider = Array.from(players.values()).find((entry) => entry.id === hiderId && entry.role === "Hider" && !entry.found);
    if (!hider) {
      return;
    }
    gameState.pendingCatch = {
      seekerId: seeker.socketId,
      seekerName: seeker.name,
      hiderId: hider.id,
      hiderName: hider.name,
      hiderSocketId: hider.socketId
    };
    io.to(hider.socketId).emit("catch_prompt", {
      seekerName: seeker.name
    });
    broadcastState();
  });

  socket.on("catch_response", (payload) => {
    const response = payload?.response;
    if (!gameState.pendingCatch || socket.id !== gameState.pendingCatch.hiderSocketId) {
      return;
    }
    const seekerSocketId = gameState.pendingCatch.seekerId;
    const hider = players.get(socket.id);
    if (!hider) {
      gameState.pendingCatch = null;
      broadcastState();
      return;
    }
    if (response === "confirm") {
      hider.found = true;
      hider.role = "Found Hider";
      io.to(seekerSocketId).emit("catch_result", { result: "confirmed", hiderName: hider.name });
      io.to(hider.socketId).emit("catch_result", { result: "confirmed", hiderName: hider.name });
      gameState.pendingCatch = null;
      broadcastState();
      checkEndRoundByFound();
      return;
    }
    io.to(seekerSocketId).emit("catch_result", { result: "denied", hiderName: hider.name });
    io.to(hider.socketId).emit("catch_result", { result: "denied", hiderName: hider.name });
    gameState.pendingCatch = null;
    broadcastState();
  });

  socket.on("minigame_choice", (payload) => {
    if (!gameState.minigame.active) {
      return;
    }
    const player = players.get(socket.id);
    if (!player || !player.found) {
      return;
    }
    gameState.minigame.choices.set(socket.id, payload?.choice || "?");
    broadcastState();
    const caught = Array.from(players.values()).filter((entry) => entry.found);
    if (gameState.minigame.choices.size >= caught.length) {
      resolveMinigame();
    }
  });

  socket.on("disconnect", () => {
    const player = players.get(socket.id);
    if (!player) {
      return;
    }
    const wasSeeker = player.role === "Seeker";
    players.delete(socket.id);
    if (wasSeeker && gameState.phase !== PHASES.LOBBY && gameState.phase !== PHASES.ENDED) {
      endRound();
    }
    broadcastState();
  });
});

setInterval(tickTimer, 1000);

server.listen(PORT, () => {
  console.log(`Hide & Seek helper running on port ${PORT}`);
});
