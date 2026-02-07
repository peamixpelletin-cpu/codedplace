const socket = io();

const enrollScreen = document.getElementById("enroll-screen");
const gameScreen = document.getElementById("game-screen");
const catchScreen = document.getElementById("catch-screen");
const minigameScreen = document.getElementById("minigame-screen");

const enrollForm = document.getElementById("enroll-form");
const idInput = document.getElementById("id-input");
const enrollMessage = document.getElementById("enroll-message");

const phaseTitle = document.getElementById("phase-title");
const roundLabel = document.getElementById("round-label");
const roleLabel = document.getElementById("role-label");
const infoBlock = document.getElementById("info-block");
const timerEl = document.getElementById("timer");
const actionArea = document.getElementById("action-area");
const adminPanel = document.getElementById("admin-panel");
const participantList = document.getElementById("participant-list");
const startGameButton = document.getElementById("start-game");
const endGameButton = document.getElementById("end-game");

const catchText = document.getElementById("catch-text");
const confirmCatch = document.getElementById("confirm-catch");
const denyCatch = document.getElementById("deny-catch");

const minigameStatus = document.getElementById("minigame-status");
const minigameTiles = document.querySelectorAll(".tile");

let profiles = {};
let myId = null;
let myProfile = null;
let currentState = null;
let pendingCatchPrompt = false;
let seekerSelectionOpen = false;
let lastPhase = null;
let lastTimer = null;

const audioContext = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq, duration, volume = 0.05) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = freq;
  gain.gain.value = volume;
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function playTick() {
  playTone(880, 0.05, 0.03);
}

function playExpire() {
  playTone(120, 0.3, 0.08);
}

function playSlide() {
  playTone(440, 0.1, 0.05);
}

function formatTimer(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.max(0, seconds % 60);
  return `[${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}]`;
}

function setScreen(screen) {
  [enrollScreen, gameScreen, catchScreen, minigameScreen].forEach((element) => {
    element.classList.add("hidden");
  });
  screen.classList.remove("hidden");
}

function updateTimer(state) {
  if (!state) {
    return;
  }
  const remaining = state.timer?.remaining ?? 0;
  timerEl.textContent = formatTimer(remaining);
  timerEl.classList.remove("running", "paused", "finished");
  if (state.timer?.running) {
    timerEl.classList.add("running");
  } else if (state.phase !== "lobby" && remaining === 0) {
    timerEl.classList.add("finished");
  } else {
    timerEl.classList.add("paused");
  }
}

function updateAdminPanel(state) {
  if (!myProfile || myProfile.rank !== "Admin") {
    adminPanel.classList.add("hidden");
    return;
  }
  adminPanel.classList.remove("hidden");
  startGameButton.disabled = state.phase !== "lobby";
  endGameButton.disabled = state.phase === "ended";
  participantList.innerHTML = "";
  state.participants.forEach((participant) => {
    const li = document.createElement("li");
    li.textContent = `${participant.name} (${participant.rank})`;
    const removeButton = document.createElement("button");
    removeButton.textContent = "X";
    removeButton.addEventListener("click", () => {
      socket.emit("remove_player", { id: participant.id });
    });
    li.appendChild(removeButton);
    participantList.appendChild(li);
  });
}

function setInfoText(state, player) {
  if (!state) {
    return "";
  }
  if (state.phase === "choose_seeker") {
    return "THE FIRST SEEKER WILL NOW BE CHOSEN";
  }
  if (state.phase === "initial_wait") {
    return state.timer.label || "PLEASE WAIT IN THE LOBBY ROOM FOR THE ROUND TO BEGIN";
  }
  if (state.phase === "lobby_wait") {
    if (player?.role === "Seeker") {
      return "DO NOT LEAVE THE LOBBY ROOM UNTIL THE ROUND BEGINS";
    }
    return "FIND A HIDING SPOT BEFORE THE ROUND BEGINS";
  }
  if (state.phase === "round") {
    if (player?.role === "Seeker") {
      return "FIND ALL THE HIDERS BEFORE THE ROUND ENDS";
    }
    if (player?.role === "Found Hider") {
      return "PLEASE RETURN TO THE LOBBY ROOM AND WAIT FOR THE ROUND TO END";
    }
    return "STAY HIDDEN UNTIL THE ROUND ENDS";
  }
  if (state.phase === "minigame") {
    if (player?.role === "Seeker") {
      return "PLEASE WAIT FOR THE NEXT SEEKER TO BE ASSIGNED";
    }
    return "WAIT FOR THE MINIGAME TO FINISH";
  }
  if (state.phase === "return_lobby") {
    return state.timer.label || "PLEASE RETURN TO THE LOBBY ROOM";
  }
  if (state.phase === "next_round") {
    return state.timer.label || "THE ROUND WILL BEGIN AFTER THE TIME LIMIT";
  }
  if (state.phase === "ended") {
    return "THANK YOU FOR PARTICIPATING";
  }
  return "";
}

function updateActionArea(state, player) {
  actionArea.innerHTML = "";
  if (!player || !state) {
    return;
  }
  if (state.phase === "round" && player.role === "Seeker") {
    if (state.pendingCatch && state.pendingCatch.seekerId === socket.id) {
      const waiting = document.createElement("p");
      waiting.textContent = `PLEASE WAIT FOR ${state.pendingCatch.hiderName || state.pendingCatch.hiderId} TO CONFIRM`;
      actionArea.appendChild(waiting);
      return;
    }
    if (!seekerSelectionOpen) {
      const button = document.createElement("button");
      button.textContent = "I FOUND SOMEONE";
      button.classList.add("primary");
      button.addEventListener("click", () => {
        seekerSelectionOpen = true;
        updateActionArea(state, player);
      });
      actionArea.appendChild(button);
      return;
    }
    const title = document.createElement("p");
    title.textContent = "[HIDER SELECTION]";
    actionArea.appendChild(title);
    const message = document.createElement("p");
    message.textContent = "PLEASE SELECT THE HIDER YOU FOUND";
    actionArea.appendChild(message);
    const hiders = state.participants.filter((participant) => participant.role === "Hider");
    hiders.forEach((hider) => {
      const button = document.createElement("button");
      button.textContent = hider.name;
      button.addEventListener("click", () => {
        socket.emit("found_hider", { id: hider.id });
        seekerSelectionOpen = false;
      });
      actionArea.appendChild(button);
    });
    const cancel = document.createElement("button");
    cancel.textContent = "CANCEL";
    cancel.addEventListener("click", () => {
      seekerSelectionOpen = false;
      updateActionArea(state, player);
    });
    actionArea.appendChild(cancel);
  }
}

function updateGameScreen(state) {
  if (!state) {
    return;
  }
  if (state.phase !== "round") {
    seekerSelectionOpen = false;
  }
  if (!myId) {
    setScreen(enrollScreen);
    return;
  }
  const player = state.participants.find((participant) => participant.id === myId);
  if (!player) {
    setScreen(enrollScreen);
    enrollMessage.textContent = "YOU ARE NOT ENROLLED";
    return;
  }
  myProfile = player;

  if (pendingCatchPrompt) {
    setScreen(catchScreen);
    return;
  }

  if (state.phase === "minigame" && player.found) {
    setScreen(minigameScreen);
    minigameStatus.textContent = "MAKE YOUR PICK";
    minigameTiles.forEach((tile) => {
      tile.disabled = false;
    });
  } else {
    setScreen(gameScreen);
  }

  phaseTitle.textContent = "[JUDGE]";
  if (state.phase === "choose_seeker") {
    phaseTitle.textContent = "[JUDGE]";
  }
  if (state.phase === "minigame") {
    phaseTitle.textContent = "[MINIGAME]";
  }

  roundLabel.textContent = `[ROUND ${state.round}]`;
  roleLabel.textContent = `[${player.role}]`;
  infoBlock.textContent = setInfoText(state, player) || "";
  updateTimer(state);
  updateActionArea(state, player);
  updateAdminPanel(state);

  if (state.phase === "ended") {
    document.body.style.background = "#000";
    document.body.style.color = "#fff";
  } else {
    document.body.style.background = "#fdfdfd";
    document.body.style.color = "#000";
  }
}

socket.on("profiles", (data) => {
  profiles = data || {};
});

socket.on("state", (state) => {
  const previousPhase = lastPhase;
  const previousTimer = lastTimer;
  currentState = state;
  lastPhase = state.phase;
  lastTimer = state.timer?.remaining ?? 0;
  if (previousPhase && previousPhase !== state.phase) {
    playSlide();
  }
  if (previousTimer !== null && state.timer?.running && previousTimer > state.timer.remaining) {
    playTick();
  }
  if (previousTimer > 0 && state.timer?.remaining === 0) {
    playExpire();
  }
  updateGameScreen(state);
});

socket.on("enroll_error", (message) => {
  enrollMessage.textContent = message;
  myId = null;
});

socket.on("catch_prompt", ({ seekerName }) => {
  pendingCatchPrompt = true;
  catchText.textContent = `PLEASE CONFIRM THAT YOU WERE CAUGHT BY ${seekerName}`;
  playTone(200, 0.8, 0.1);
  updateGameScreen(currentState);
});

socket.on("catch_result", ({ result, hiderName }) => {
  pendingCatchPrompt = false;
  if (result === "denied") {
    enrollMessage.textContent = `${hiderName} DENIED`;
  }
  updateGameScreen(currentState);
});

enrollForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = idInput.value.trim();
  if (!id) {
    return;
  }
  myId = id;
  socket.emit("enroll", { id });
  enrollMessage.textContent = "WAITING FOR CONFIRMATION";
});

startGameButton.addEventListener("click", () => {
  socket.emit("start_game");
});

endGameButton.addEventListener("click", () => {
  socket.emit("end_game");
});

confirmCatch.addEventListener("click", () => {
  socket.emit("catch_response", { response: "confirm" });
  pendingCatchPrompt = false;
});

denyCatch.addEventListener("click", () => {
  socket.emit("catch_response", { response: "deny" });
  pendingCatchPrompt = false;
});

minigameTiles.forEach((tile) => {
  tile.addEventListener("click", () => {
    const choice = tile.dataset.choice;
    socket.emit("minigame_choice", { choice });
    minigameStatus.textContent = `YOU PICKED ${choice}. WAITING...`;
    minigameTiles.forEach((button) => {
      button.disabled = true;
    });
  });
});

window.addEventListener("click", () => {
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
});
