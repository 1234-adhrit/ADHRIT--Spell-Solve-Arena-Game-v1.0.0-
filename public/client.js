const socket = io();
const PLAYER_COLORS = [
  "#0f7c91",
  "#f28b50",
  "#f6c453",
  "#15895c",
  "#d54d45",
  "#3d6fd1",
  "#d96aa7",
  "#8c6a43"
];

function readLocalFlag(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch (_error) {
    return fallback;
  }
}

function readLocalColor() {
  try {
    const value = window.localStorage.getItem("wordNumberRace.avatarColor");
    return PLAYER_COLORS.includes(value) ? value : PLAYER_COLORS[0];
  } catch (_error) {
    return PLAYER_COLORS[0];
  }
}

const state = {
  room: null,
  selfId: null,
  submittedThisRound: false,
  timerHandle: null,
  lastChatCount: 0,
  roomDirectory: [],
  leaderboard: {
    wins: [],
    bestScore: [],
    fastestSpelling: []
  },
  selectedAvatarColor: readLocalColor(),
  soundEnabled: readLocalFlag("wordNumberRace.soundEnabled", true),
  audioContext: null,
  lastCountdownSecond: null,
  lastResolvedRoundKey: "",
  lastWinnerSoundKey: ""
};

const elements = {
  entryPanel: document.getElementById("entryPanel"),
  roomPanel: document.getElementById("roomPanel"),
  soundToggleBtn: document.getElementById("soundToggleBtn"),
  nameInput: document.getElementById("nameInput"),
  avatarColorPicker: document.getElementById("avatarColorPicker"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  soloRoomBtn: document.getElementById("soloRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  spectateRoomBtn: document.getElementById("spectateRoomBtn"),
  availableRoomsBoard: document.getElementById("availableRoomsBoard"),
  entryLeaderboard: document.getElementById("entryLeaderboard"),
  copyRoomBtn: document.getElementById("copyRoomBtn"),
  roomCodeLabel: document.getElementById("roomCodeLabel"),
  statusLabel: document.getElementById("statusLabel"),
  roomTypeLabel: document.getElementById("roomTypeLabel"),
  modeLabel: document.getElementById("modeLabel"),
  difficultyLabel: document.getElementById("difficultyLabel"),
  leaveRoomBtn: document.getElementById("leaveRoomBtn"),
  noticeBanner: document.getElementById("noticeBanner"),
  hostControls: document.getElementById("hostControls"),
  hostControlsCopy: document.getElementById("hostControlsCopy"),
  easyDifficultyBtn: document.getElementById("easyDifficultyBtn"),
  mediumDifficultyBtn: document.getElementById("mediumDifficultyBtn"),
  hardDifficultyBtn: document.getElementById("hardDifficultyBtn"),
  roundDurationInput: document.getElementById("roundDurationInput"),
  maxRoundsInput: document.getElementById("maxRoundsInput"),
  eliminationsCheckbox: document.getElementById("eliminationsCheckbox"),
  applySettingsBtn: document.getElementById("applySettingsBtn"),
  mathModeBtn: document.getElementById("mathModeBtn"),
  spellingModeBtn: document.getElementById("spellingModeBtn"),
  startMatchBtn: document.getElementById("startMatchBtn"),
  playAgainBtn: document.getElementById("playAgainBtn"),
  playerLobbyControls: document.getElementById("playerLobbyControls"),
  readyStatusText: document.getElementById("readyStatusText"),
  readyToggleBtn: document.getElementById("readyToggleBtn"),
  lobbyMessage: document.getElementById("lobbyMessage"),
  gameArea: document.getElementById("gameArea"),
  roundNumberLabel: document.getElementById("roundNumberLabel"),
  drainLabel: document.getElementById("drainLabel"),
  timerLabel: document.getElementById("timerLabel"),
  challengePrompt: document.getElementById("challengePrompt"),
  playBox: document.getElementById("playBox"),
  powerUpBar: document.getElementById("powerUpBar"),
  doublePowerBtn: document.getElementById("doublePowerBtn"),
  shieldPowerBtn: document.getElementById("shieldPowerBtn"),
  freezePowerBtn: document.getElementById("freezePowerBtn"),
  spectatorBox: document.getElementById("spectatorBox"),
  answerInput: document.getElementById("answerInput"),
  submitAnswerBtn: document.getElementById("submitAnswerBtn"),
  submissionState: document.getElementById("submissionState"),
  playersList: document.getElementById("playersList"),
  spectatorsList: document.getElementById("spectatorsList"),
  settingsSummary: document.getElementById("settingsSummary"),
  roomLeaderboard: document.getElementById("roomLeaderboard"),
  historyList: document.getElementById("historyList"),
  chatMessages: document.getElementById("chatMessages"),
  chatInput: document.getElementById("chatInput"),
  sendChatBtn: document.getElementById("sendChatBtn"),
  roundResultsBody: document.getElementById("roundResultsBody"),
  winnerBox: document.getElementById("winnerBox"),
  winnerHeading: document.getElementById("winnerHeading"),
  winnerText: document.getElementById("winnerText"),
  toast: document.getElementById("toast")
};
elements.avatarColorButtons = [...document.querySelectorAll("[data-color-swatch]")];

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");

  window.clearTimeout(showToast.timerId);
  showToast.timerId = window.setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, 3200);
}

function formatDifficulty(value) {
  if (!value) {
    return "Medium";
  }

  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function formatMode(value) {
  if (!value) {
    return "Not picked";
  }

  return value === "math" ? "Math Race" : "Spelling Race";
}

function formatPhase(value) {
  if (value === "countdown") {
    return "Countdown";
  }

  if (value === "playing") {
    return "In Match";
  }

  if (value === "finished") {
    return "Finished";
  }

  return "Lobby";
}

function formatRoomType(isSolo) {
  return isSolo ? "Solo" : "Multiplayer";
}

function formatRoundDuration(ms) {
  return `${Math.round(ms / 1000)}s`;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatFastestSpelling(ms) {
  return ms === null || ms === undefined ? "--" : `${(ms / 1000).toFixed(3)}s`;
}

function getInitials(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase() || "?";
}

function getName() {
  return elements.nameInput.value.trim();
}

function getAvatarColor() {
  return state.selectedAvatarColor;
}

function getRoomCode() {
  return elements.roomCodeInput.value.trim().toUpperCase();
}

function persistAvatarColor() {
  try {
    window.localStorage.setItem("wordNumberRace.avatarColor", state.selectedAvatarColor);
  } catch (_error) {
    // ignore storage errors
  }
}

function persistSoundEnabled() {
  try {
    window.localStorage.setItem("wordNumberRace.soundEnabled", String(state.soundEnabled));
  } catch (_error) {
    // ignore storage errors
  }
}

function renderAvatarPicker() {
  elements.avatarColorButtons.forEach((button) => {
    const color = button.dataset.colorSwatch;
    button.style.setProperty("--swatch-color", color);
    button.classList.toggle("swatch-selected", color === state.selectedAvatarColor);
  });
}

function createAvatarBadge(name, color, extraClass = "") {
  const badge = document.createElement("span");
  badge.className = `avatar-badge${extraClass ? ` ${extraClass}` : ""}`;
  badge.style.setProperty("--avatar-color", color || PLAYER_COLORS[0]);
  badge.textContent = getInitials(name);
  return badge;
}

function updateSoundToggle() {
  elements.soundToggleBtn.textContent = state.soundEnabled ? "Sound On" : "Sound Off";
}

function unlockAudio() {
  if (!state.soundEnabled) {
    return null;
  }

  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }

    state.audioContext = new AudioContextClass();
  }

  if (state.audioContext.state === "suspended") {
    state.audioContext.resume().catch(() => {});
  }

  return state.audioContext;
}

function playTone({ frequency, durationMs, gain = 0.04, type = "sine", delayMs = 0 }) {
  const audioContext = unlockAudio();
  if (!audioContext) {
    return;
  }

  const startAt = audioContext.currentTime + delayMs / 1000;
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.exponentialRampToValueAtTime(gain, startAt + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + durationMs / 1000);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.start(startAt);
  oscillator.stop(startAt + durationMs / 1000 + 0.02);
}

function playSound(name) {
  if (!state.soundEnabled) {
    return;
  }

  if (name === "countdown") {
    playTone({ frequency: 620, durationMs: 120, gain: 0.035, type: "square" });
    return;
  }

  if (name === "go") {
    playTone({ frequency: 760, durationMs: 120, gain: 0.045 });
    playTone({ frequency: 980, durationMs: 200, gain: 0.04, delayMs: 80 });
    return;
  }

  if (name === "correct") {
    playTone({ frequency: 660, durationMs: 120, gain: 0.04 });
    playTone({ frequency: 880, durationMs: 180, gain: 0.04, delayMs: 90 });
    return;
  }

  if (name === "wrong") {
    playTone({ frequency: 300, durationMs: 180, gain: 0.05, type: "sawtooth" });
    return;
  }

  if (name === "winner") {
    playTone({ frequency: 660, durationMs: 140, gain: 0.045 });
    playTone({ frequency: 880, durationMs: 140, gain: 0.045, delayMs: 120 });
    playTone({ frequency: 1040, durationMs: 220, gain: 0.04, delayMs: 240 });
    return;
  }

  if (name === "soloEnd") {
    playTone({ frequency: 260, durationMs: 180, gain: 0.05, type: "triangle" });
    playTone({ frequency: 220, durationMs: 240, gain: 0.04, delayMs: 120 });
  }
}

function callSocket(eventName, payload) {
  return new Promise((resolve) => {
    socket.emit(eventName, payload, resolve);
  });
}

function isHost() {
  return Boolean(state.room && state.room.hostId === state.selfId);
}

function selfPlayer() {
  if (!state.room) {
    return null;
  }

  return state.room.players.find((player) => player.id === state.selfId) || null;
}

function selfSpectator() {
  if (!state.room) {
    return null;
  }

  return state.room.spectators.find((spectator) => spectator.id === state.selfId) || null;
}

function isActivePlayer() {
  const player = selfPlayer();
  return Boolean(player && player.active);
}

function clearRoundTimer() {
  if (state.timerHandle) {
    window.clearInterval(state.timerHandle);
    state.timerHandle = null;
  }
}

function setChoiceState(button, isActive) {
  button.classList.toggle("choice-active", isActive);
}

function getSelfFreezeRemainingMs() {
  const player = selfPlayer();
  if (!player?.effects?.frozenUntil) {
    return 0;
  }

  return Math.max(0, player.effects.frozenUntil - Date.now());
}

function countActiveOpponents() {
  return (state.room?.players || []).filter((player) => player.id !== state.selfId && player.active)
    .length;
}

function renderLeaderboardBoard(target) {
  if (!target) {
    return;
  }

  const categories = [
    {
      title: "Most Wins",
      entries: state.leaderboard.wins || [],
      value: (entry) => `${entry.wins} wins`
    },
    {
      title: "Top Scores",
      entries: state.leaderboard.bestScore || [],
      value: (entry) => `${entry.bestScore} pts`
    },
    {
      title: "Fastest Spelling",
      entries: state.leaderboard.fastestSpelling || [],
      value: (entry) => formatFastestSpelling(entry.fastestSpellingTimeMs)
    }
  ];

  target.innerHTML = "";
  const hasEntries = categories.some((category) => category.entries.length > 0);

  if (!hasEntries) {
    const empty = document.createElement("div");
    empty.className = "board-empty";
    empty.textContent = "Leaderboard updates after players finish matches.";
    target.appendChild(empty);
    return;
  }

  categories.forEach((category) => {
    const card = document.createElement("div");
    card.className = "leaderboard-card";

    const title = document.createElement("h4");
    title.textContent = category.title;
    card.appendChild(title);

    if (category.entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-list";
      empty.textContent = "No entries yet.";
      card.appendChild(empty);
      target.appendChild(card);
      return;
    }

    category.entries.forEach((entry, index) => {
      const row = document.createElement("div");
      row.className = "leaderboard-row";

      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = String(index + 1);

      const nameWrap = document.createElement("div");
      nameWrap.className = "avatar-name";
      nameWrap.appendChild(createAvatarBadge(entry.name, entry.avatarColor));

      const name = document.createElement("strong");
      name.textContent = entry.name;
      nameWrap.appendChild(name);

      const value = document.createElement("span");
      value.className = "leaderboard-value";
      value.textContent = category.value(entry);

      row.appendChild(rank);
      row.appendChild(nameWrap);
      row.appendChild(value);
      card.appendChild(row);
    });

    target.appendChild(card);
  });
}

function renderLeaderboards() {
  renderLeaderboardBoard(elements.entryLeaderboard);
  renderLeaderboardBoard(elements.roomLeaderboard);
}

function renderSettingsSummary() {
  if (!state.room?.settings) {
    elements.settingsSummary.innerHTML = '<div class="empty-list">Join a room to see settings.</div>';
    return;
  }

  const settings = state.room.settings;
  elements.settingsSummary.innerHTML = "";

  [
    { label: "Round Timer", value: formatRoundDuration(settings.roundDurationMs) },
    { label: "Max Rounds", value: String(settings.maxRounds) },
    { label: "Eliminations", value: settings.eliminationsEnabled ? "On" : "Off" }
  ].forEach((entry) => {
    const item = document.createElement("div");
    item.className = "list-item compact-item";

    const label = document.createElement("strong");
    label.textContent = entry.label;

    const value = document.createElement("div");
    value.className = "item-meta";
    value.textContent = entry.value;

    item.appendChild(label);
    item.appendChild(value);
    elements.settingsSummary.appendChild(item);
  });
}

function renderMatchHistory() {
  const history = state.room?.matchHistory || [];
  if (history.length === 0) {
    elements.historyList.className = "list-stack empty-list";
    elements.historyList.textContent = "No rounds have been completed in this room yet.";
    return;
  }

  elements.historyList.className = "list-stack";
  elements.historyList.innerHTML = "";

  history.slice(0, 12).forEach((entry) => {
    const item = document.createElement("div");
    item.className = "list-item";

    const title = document.createElement("strong");
    title.textContent = `Match ${entry.matchNumber} • Round ${entry.roundNumber}`;

    const prompt = document.createElement("div");
    prompt.className = "item-meta";
    prompt.textContent = `${formatMode(entry.mode)} • ${formatDifficulty(entry.difficulty)} • Prompt: ${entry.prompt}`;

    const answer = document.createElement("div");
    answer.className = "item-meta";
    answer.textContent = `Answer: ${entry.answer}`;

    const summary = document.createElement("div");
    summary.className = "history-summary";
    summary.textContent = entry.results
      .map((result) => {
        const placement = result.placement ? ` #${result.placement}` : "";
        return `${result.name}${placement} +${result.gained}`;
      })
      .join(" | ");

    item.appendChild(title);
    item.appendChild(prompt);
    item.appendChild(answer);
    item.appendChild(summary);
    elements.historyList.appendChild(item);
  });
}

function renderPowerUps(showPlayBox) {
  const player = selfPlayer();
  const powerUps = player?.powerUps || { double: 0, shield: 0, freeze: 0 };
  const effects = player?.effects || { doubleArmed: false, shieldArmed: false };
  const hasOpponents = countActiveOpponents() > 0;

  elements.powerUpBar.classList.toggle("hidden", !showPlayBox);
  if (!showPlayBox) {
    return;
  }

  elements.doublePowerBtn.textContent = effects.doubleArmed
    ? `Double Armed (${powerUps.double})`
    : `Double x${powerUps.double}`;
  elements.shieldPowerBtn.textContent = effects.shieldArmed
    ? `Shield Armed (${powerUps.shield})`
    : `Shield x${powerUps.shield}`;
  elements.freezePowerBtn.textContent = `Freeze x${powerUps.freeze}`;

  elements.doublePowerBtn.disabled =
    powerUps.double <= 0 || effects.doubleArmed || state.submittedThisRound;
  elements.shieldPowerBtn.disabled = powerUps.shield <= 0 || effects.shieldArmed;
  elements.freezePowerBtn.disabled =
    powerUps.freeze <= 0 || !hasOpponents || state.submittedThisRound;
}

function updatePlayControls(showPlayBox) {
  const frozenRemainingMs = getSelfFreezeRemainingMs();
  const frozen = frozenRemainingMs > 0;
  const canSubmit =
    Boolean(state.room?.round) && showPlayBox && !state.submittedThisRound && !frozen;

  elements.submitAnswerBtn.disabled = !canSubmit;
  elements.answerInput.disabled = !canSubmit;

  if (frozen) {
    elements.submissionState.textContent = `Frozen for ${(frozenRemainingMs / 1000).toFixed(2)}s.`;
  } else if (state.submittedThisRound) {
    elements.submissionState.textContent = "Answer locked in for this round.";
  } else if (showPlayBox) {
    elements.submissionState.textContent = "One submission per round.";
  } else {
    elements.submissionState.textContent = "";
  }
}

function handleRoomStateSounds(previousRoom, nextRoom) {
  if (!nextRoom) {
    state.lastWinnerSoundKey = "";
    return;
  }

  const previousResultKey = previousRoom?.lastRoundResult
    ? `${previousRoom.lastRoundResult.roundNumber}-${previousRoom.phase}`
    : "";
  const nextResultKey = nextRoom.lastRoundResult
    ? `${nextRoom.lastRoundResult.roundNumber}-${nextRoom.phase}`
    : "";

  if (nextResultKey && nextResultKey !== previousResultKey) {
    const selfResult = nextRoom.lastRoundResult.results.find((entry) => entry.id === state.selfId);
    if (selfResult) {
      playSound(selfResult.correct ? "correct" : "wrong");
    }
  }

  const nextWinnerKey =
    nextRoom.phase === "finished"
      ? nextRoom.winner
        ? `winner:${nextRoom.winner.id}:${nextRoom.roundNumber}`
        : nextRoom.isSolo
          ? `solo:${nextRoom.id}:${nextRoom.roundNumber}`
          : ""
      : "";

  if (nextWinnerKey && nextWinnerKey !== state.lastWinnerSoundKey) {
    playSound(nextRoom.winner ? "winner" : "soloEnd");
  }

  state.lastWinnerSoundKey = nextWinnerKey;
}

function getRoomCardNote(room, hasName) {
  if (!hasName) {
    return "Enter your name above to use the quick join buttons.";
  }

  if (room.joinable) {
    return `${room.readyCount}/${room.playerCount} players are ready in the lobby.`;
  }

  if (room.phase === "lobby" && room.playerCount >= room.playerLimit) {
    return "This room is full right now, but you can still watch as a spectator.";
  }

  if (room.phase === "countdown") {
    return "Countdown has started, so new player slots are locked.";
  }

  if (room.phase === "playing") {
    return "Match in progress. Join as a spectator to watch live.";
  }

  return "This room is between matches. Spectators can still join while the result screen shows.";
}

function renderRoomDirectory() {
  const board = elements.availableRoomsBoard;
  if (!board) {
    return;
  }

  const rooms = state.roomDirectory || [];
  const hasName = Boolean(getName());
  board.innerHTML = "";

  if (rooms.length === 0) {
    const empty = document.createElement("div");
    empty.className = "board-empty";
    empty.textContent = "No servers are open yet. Create the first room.";
    board.appendChild(empty);
    return;
  }

  rooms.forEach((room) => {
    const card = document.createElement("article");
    card.className = "server-card";

    const head = document.createElement("div");
    head.className = "server-card-head";

    const titleWrap = document.createElement("div");

    const title = document.createElement("h3");
    title.textContent = room.id;

    const subtitle = document.createElement("p");
    subtitle.className = "server-subtitle";
    subtitle.textContent = `Host: ${room.hostName}`;

    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);

    const status = document.createElement("span");
    const statusClass =
      room.phase === "lobby"
        ? "open"
        : room.phase === "countdown"
          ? "countdown"
          : room.phase === "playing"
            ? "live"
            : "finished";
    status.className = `status-chip ${statusClass}`;
    status.textContent = formatPhase(room.phase);

    head.appendChild(titleWrap);
    head.appendChild(status);

    const stats = document.createElement("div");
    stats.className = "server-stats";

    [
      { label: "Mode", value: formatMode(room.mode) },
      { label: "Difficulty", value: formatDifficulty(room.difficulty) },
      { label: "Players", value: `${room.playerCount}/${room.playerLimit}` },
      { label: "Spectators", value: String(room.spectatorCount) },
      {
        label: "Ready",
        value: room.phase === "lobby" ? `${room.readyCount}/${room.playerCount}` : "Locked"
      }
    ].forEach((entry) => {
      const stat = document.createElement("div");
      stat.className = "server-stat";

      const label = document.createElement("span");
      label.className = "server-stat-label";
      label.textContent = entry.label;

      const value = document.createElement("strong");
      value.className = "server-stat-value";
      value.textContent = entry.value;

      stat.appendChild(label);
      stat.appendChild(value);
      stats.appendChild(stat);
    });

    const note = document.createElement("p");
    note.className = "server-card-note";
    note.textContent = getRoomCardNote(room, hasName);

    const actions = document.createElement("div");
    actions.className = "server-card-actions";

    const joinButton = document.createElement("button");
    joinButton.textContent = room.joinable ? "Join As Player" : "Players Locked";
    joinButton.disabled = !hasName || !room.joinable;
    joinButton.addEventListener("click", async () => {
      await quickJoinRoom(room.id, "player");
    });

    const spectateButton = document.createElement("button");
    spectateButton.className = "ghost";
    spectateButton.textContent = "Join As Spectator";
    spectateButton.disabled = !hasName || !room.spectatable;
    spectateButton.addEventListener("click", async () => {
      await quickJoinRoom(room.id, "spectator");
    });

    actions.appendChild(joinButton);
    actions.appendChild(spectateButton);

    card.appendChild(head);
    card.appendChild(stats);
    card.appendChild(note);
    card.appendChild(actions);
    board.appendChild(card);
  });
}

function updateTimer() {
  if (state.room?.countdown) {
    const remainingMs = Math.max(0, state.room.countdown.endsAt - Date.now());
    const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
    if (seconds !== state.lastCountdownSecond && remainingMs > 0) {
      playSound("countdown");
      state.lastCountdownSecond = seconds;
    }
    elements.timerLabel.textContent = `${(remainingMs / 1000).toFixed(3)}s`;
    elements.challengePrompt.textContent = remainingMs > 0 ? String(seconds) : "Go!";

    if (remainingMs <= 0) {
      if (state.lastCountdownSecond !== 0) {
        playSound("go");
        state.lastCountdownSecond = 0;
      }
      clearRoundTimer();
    }
    updatePlayControls(false);
    return;
  }

  if (!state.room?.round) {
    elements.timerLabel.textContent = state.room?.settings
      ? `${(state.room.settings.roundDurationMs / 1000).toFixed(3)}s`
      : "20.000s";
    state.lastCountdownSecond = null;
    updatePlayControls(false);
    clearRoundTimer();
    return;
  }

  const remainingMs = Math.max(0, state.room.round.endsAt - Date.now());
  elements.timerLabel.textContent = `${(remainingMs / 1000).toFixed(3)}s`;
  updatePlayControls(true);

  if (remainingMs <= 0) {
    clearRoundTimer();
  }
}

function renderPlayers() {
  const players = state.room?.players || [];
  elements.playersList.innerHTML = "";

  players.forEach((player) => {
    const item = document.createElement("div");
    item.className = "list-item";

    const header = document.createElement("strong");

    const nameRow = document.createElement("span");
    nameRow.className = "avatar-name";

    nameRow.appendChild(createAvatarBadge(player.name, player.avatarColor));

    const name = document.createElement("span");
    name.textContent = player.name;
    nameRow.appendChild(name);

    const badgeRow = document.createElement("span");
    badgeRow.className = "badge-row";

    const badges = [];
    if (player.isHost) {
      badges.push({ text: "Host", className: "" });
    }

    if (state.room?.isSolo && (state.room?.phase === "lobby" || state.room?.phase === "countdown")) {
      badges.push({
        text: "Solo",
        className: "ready"
      });
    } else if (state.room?.phase === "lobby" || state.room?.phase === "countdown") {
      badges.push({
        text: player.ready ? "Ready" : "Not Ready",
        className: player.ready ? "ready" : "idle"
      });
    } else {
      badges.push({
        text: player.active ? "Racing" : "Out",
        className: player.active ? "warn" : "out"
      });
    }

    badges.forEach((entry) => {
      const badge = document.createElement("span");
      badge.className = `badge${entry.className ? ` ${entry.className}` : ""}`;
      badge.textContent = entry.text;
      badgeRow.appendChild(badge);
    });

    header.appendChild(nameRow);
    header.appendChild(badgeRow);

    const meta = document.createElement("div");
    meta.className = "item-meta";
    meta.textContent = `Score: ${player.score} | Wins: ${player.stats.wins}`;

    const stats = document.createElement("div");
    stats.className = "item-meta";
    stats.textContent = `Correct: ${player.stats.totalCorrect} | Fastest spelling: ${formatFastestSpelling(player.stats.fastestSpellingTimeMs)}`;

    const powerUpMeta = document.createElement("div");
    powerUpMeta.className = "item-meta";
    powerUpMeta.textContent = `Power-ups: Double ${player.powerUps.double} | Shield ${player.powerUps.shield} | Freeze ${player.powerUps.freeze}`;

    item.appendChild(header);
    item.appendChild(meta);
    item.appendChild(stats);
    item.appendChild(powerUpMeta);
    elements.playersList.appendChild(item);
  });

  if (players.length === 0) {
    elements.playersList.innerHTML = '<div class="empty-list">No players in this room.</div>';
  }
}

function renderSpectators() {
  const spectators = state.room?.spectators || [];
  if (spectators.length === 0) {
    elements.spectatorsList.className = "list-stack empty-list";
    elements.spectatorsList.textContent = "No spectators yet.";
    return;
  }

  elements.spectatorsList.className = "list-stack";
  elements.spectatorsList.innerHTML = "";

  spectators.forEach((spectator) => {
    const item = document.createElement("div");
    item.className = "list-item";

    const header = document.createElement("strong");
    const nameRow = document.createElement("span");
    nameRow.className = "avatar-name";
    nameRow.appendChild(createAvatarBadge(spectator.name, spectator.avatarColor));

    const name = document.createElement("span");
    name.textContent = spectator.name;
    nameRow.appendChild(name);
    header.appendChild(nameRow);

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = spectator.isHost ? "Host" : "Watching";
    header.appendChild(badge);

    item.appendChild(header);
    elements.spectatorsList.appendChild(item);
  });
}

function renderRoundResults() {
  const result = state.room?.lastRoundResult;
  if (!result) {
    elements.roundResultsBody.className = "results-empty";
    elements.roundResultsBody.textContent =
      state.room?.phase === "finished"
        ? "The match is over. Create a new room or join another one to play again."
        : "No round results yet. Start the match to begin racing.";
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "list-stack";

  const answer = document.createElement("div");
  answer.className = "item-meta";
  answer.textContent = `Correct answer: ${result.answer}`;
  wrapper.appendChild(answer);

  result.results.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "result-row";

    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.className = "avatar-name";
    title.appendChild(createAvatarBadge(entry.name, entry.avatarColor, "avatar-inline"));

    const titleText = document.createElement("span");
    titleText.textContent = entry.name;
    title.appendChild(titleText);

    const meta = document.createElement("div");
    meta.className = "result-meta";
    const status = entry.correct ? "Correct" : "Wrong";
    const placementText = entry.placement ? `, place ${entry.placement}` : "";
    const timeText = entry.timeMs === null ? "" : `, ${(entry.timeMs / 1000).toFixed(3)}s`;
    meta.textContent = `${status}${placementText}${timeText}`;

    info.appendChild(title);
    info.appendChild(meta);

    const gained = document.createElement("div");
    gained.className = "points-pill";
    gained.textContent = `+${entry.gained}`;

    const total = document.createElement("div");
    total.className = "result-meta";
    total.textContent = `Total ${entry.total}`;

    row.appendChild(info);
    row.appendChild(gained);
    row.appendChild(total);
    wrapper.appendChild(row);
  });

  elements.roundResultsBody.className = "";
  elements.roundResultsBody.innerHTML = "";
  elements.roundResultsBody.appendChild(wrapper);
}

function renderChat() {
  const messages = state.room?.chat || [];
  const shouldAutoScroll = messages.length !== state.lastChatCount;

  if (messages.length === 0) {
    elements.chatMessages.className = "chat-messages empty-chat";
    elements.chatMessages.textContent = "No chat messages yet. Say hello to the room.";
    state.lastChatCount = 0;
    return;
  }

  const wrapper = document.createElement("div");
  messages.forEach((message) => {
    const item = document.createElement("div");
    item.className = "chat-message";

    const head = document.createElement("div");
    head.className = "chat-head";

    const author = document.createElement("div");
    author.className = `chat-author${message.type === "system" ? " system" : ""}`;

    if (message.type === "system") {
      author.textContent = "System";
    } else {
      author.classList.add("avatar-name");
      author.appendChild(createAvatarBadge(message.name, message.avatarColor, "avatar-inline"));

      const authorText = document.createElement("span");
      const labels = [];
      if (message.isHost) {
        labels.push("Host");
      }
      if (message.role === "spectator") {
        labels.push("Spectator");
      }
      authorText.textContent =
        labels.length > 0 ? `${message.name} (${labels.join(", ")})` : message.name;
      author.appendChild(authorText);
    }

    const meta = document.createElement("div");
    meta.className = "chat-meta";
    meta.textContent = formatTime(message.createdAt);

    const body = document.createElement("div");
    body.className = "chat-body";
    body.textContent = message.text;

    head.appendChild(author);
    head.appendChild(meta);
    item.appendChild(head);
    item.appendChild(body);
    wrapper.appendChild(item);
  });

  elements.chatMessages.className = "chat-messages";
  elements.chatMessages.innerHTML = "";
  elements.chatMessages.appendChild(wrapper);

  if (shouldAutoScroll) {
    elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  }

  state.lastChatCount = messages.length;
}

function renderWinner() {
  if (!state.room) {
    elements.winnerBox.classList.add("hidden");
    return;
  }

  if (!state.room.winner && !(state.room.isSolo && state.room.phase === "finished")) {
    elements.winnerBox.classList.add("hidden");
    return;
  }

  elements.winnerBox.classList.remove("hidden");

  if (state.room.winner) {
    elements.winnerHeading.textContent = "Winner";
    const extraText =
      state.room.phase === "finished"
        ? " Difficulty choices will appear in 3 seconds."
        : "";
    elements.winnerText.textContent = `${state.room.winner.name} wins with ${state.room.winner.score} points.${extraText}`;
    return;
  }

  elements.winnerHeading.textContent = "Solo Result";
  elements.winnerText.textContent =
    state.room.notice || "Solo practice ended. Choose your next difficulty in 3 seconds.";
}

function renderRoom() {
  if (!state.room) {
    elements.entryPanel.classList.remove("hidden");
    elements.roomPanel.classList.add("hidden");
    clearRoundTimer();
    elements.chatInput.value = "";
    state.lastChatCount = 0;
    renderRoomDirectory();
    renderLeaderboards();
    renderAvatarPicker();
    updateSoundToggle();
    return;
  }

  elements.entryPanel.classList.add("hidden");
  elements.roomPanel.classList.remove("hidden");
  elements.roomCodeLabel.textContent = state.room.id;
  elements.statusLabel.textContent = formatPhase(state.room.phase);
  elements.roomTypeLabel.textContent = formatRoomType(state.room.isSolo);
  elements.modeLabel.textContent = formatMode(state.room.mode);
  elements.difficultyLabel.textContent = formatDifficulty(state.room.difficulty);
  elements.copyRoomBtn.classList.toggle("hidden", Boolean(state.room.isSolo));
  elements.hostControlsCopy.textContent = state.room.isSolo
    ? "Pick the difficulty and race type, then start your solo practice run whenever you are ready."
    : "Pick the difficulty and race type, then start when at least two players are ready.";
  elements.roundDurationInput.value = Math.round(state.room.settings.roundDurationMs / 1000);
  elements.maxRoundsInput.value = state.room.settings.maxRounds;
  elements.eliminationsCheckbox.checked = state.room.settings.eliminationsEnabled;

  if (state.room.notice) {
    elements.noticeBanner.classList.remove("hidden");
    elements.noticeBanner.textContent = state.room.notice;
  } else {
    elements.noticeBanner.classList.add("hidden");
    elements.noticeBanner.textContent = "";
  }

  const showHostControls = isHost() && state.room.phase === "lobby";
  const currentPlayer = selfPlayer();
  const showPlayerLobbyControls = Boolean(
    currentPlayer && state.room.phase === "lobby" && !state.room.isSolo
  );
  const playerCount = state.room.players.length;
  const readyCount = state.room.players.filter((player) => player.ready).length;
  const allReady = state.room.isSolo
    ? playerCount >= state.room.minPlayers
    : playerCount >= state.room.minPlayers && readyCount === playerCount;

  elements.hostControls.classList.toggle("hidden", !showHostControls);
  elements.playerLobbyControls.classList.toggle("hidden", !showPlayerLobbyControls);
  elements.lobbyMessage.classList.toggle("hidden", state.room.phase !== "lobby");
  elements.gameArea.classList.toggle(
    "hidden",
    state.room.phase !== "playing" && state.room.phase !== "countdown"
  );

  if (state.room.phase === "lobby") {
    if (state.room.isSolo) {
      elements.lobbyMessage.textContent = state.room.winner
        ? `Your last solo winner was ${state.room.winner.name}. Choose a difficulty, choose a mode, and start your next run.`
        : "Solo practice is ready. Choose a difficulty, choose a mode, and start whenever you want.";
    } else {
      elements.lobbyMessage.textContent = state.room.winner
        ? `The last winner was ${state.room.winner.name}. ${readyCount}/${playerCount} players are ready for the next match.`
        : `${readyCount}/${playerCount} players are ready. The room creator needs to choose a difficulty, choose a mode, and start the match.`;
    }
  }

  setChoiceState(elements.easyDifficultyBtn, state.room.difficulty === "easy");
  setChoiceState(elements.mediumDifficultyBtn, state.room.difficulty === "medium");
  setChoiceState(elements.hardDifficultyBtn, state.room.difficulty === "hard");
  setChoiceState(elements.mathModeBtn, state.room.mode === "math");
  setChoiceState(elements.spellingModeBtn, state.room.mode === "spelling");
  elements.applySettingsBtn.disabled = !showHostControls;

  if (showPlayerLobbyControls) {
    elements.readyStatusText.textContent = currentPlayer.ready
      ? "You are ready. You can unready if you want to change something."
      : "Click Ready when you are set for the next match.";
    elements.readyToggleBtn.textContent = currentPlayer.ready ? "Unready" : "Ready Up";
    setChoiceState(elements.readyToggleBtn, currentPlayer.ready);
  }

  elements.startMatchBtn.classList.toggle("hidden", Boolean(showHostControls && state.room.winner));
  elements.playAgainBtn.classList.toggle("hidden", !(showHostControls && state.room.winner));
  elements.startMatchBtn.disabled = !showHostControls || !state.room.mode || !allReady;
  elements.playAgainBtn.disabled = !showHostControls || !state.room.mode || !allReady;

  if (state.room.phase === "countdown" && state.room.countdown) {
    elements.roundNumberLabel.textContent = "3-2-1";
    elements.drainLabel.textContent = "Locked";
    updateTimer();

    if (!state.timerHandle) {
      state.timerHandle = window.setInterval(updateTimer, 50);
    }
  } else if (state.room.round) {
    elements.roundNumberLabel.textContent = String(state.room.round.number);
    elements.drainLabel.textContent = `-${state.room.round.drain}`;
    elements.challengePrompt.textContent = state.room.round.prompt;
    updateTimer();

    if (!state.timerHandle) {
      state.timerHandle = window.setInterval(updateTimer, 50);
    }
  } else {
    elements.challengePrompt.textContent =
      state.room.phase === "finished"
        ? "Match finished."
        : "Waiting for the next round...";
    elements.roundNumberLabel.textContent = String(state.room.roundNumber || 0);
    elements.drainLabel.textContent = state.room.mode === "spelling" ? "-2" : "-1";
    elements.timerLabel.textContent = `${(state.room.settings.roundDurationMs / 1000).toFixed(3)}s`;
    clearRoundTimer();
  }

  const activePlayer = isActivePlayer();
  const watching = Boolean(selfSpectator() || (selfPlayer() && !selfPlayer().active));
  const showPlayBox = state.room.phase === "playing" && activePlayer;
  const showSpectatorBox =
    (state.room.phase === "playing" && !activePlayer && watching) ||
    state.room.phase === "countdown";

  elements.playBox.classList.toggle("hidden", !showPlayBox);
  elements.spectatorBox.classList.toggle("hidden", !showSpectatorBox);
  elements.chatInput.disabled = false;
  elements.sendChatBtn.disabled = false;

  if (showPlayBox) {
    elements.answerInput.focus();
  }

  if (state.room.phase === "countdown") {
    elements.spectatorBox.textContent = "Countdown in progress. The race begins in just a moment.";
  } else if (showSpectatorBox) {
    elements.spectatorBox.textContent =
      "You are watching this round. Spectators and eliminated players can follow the live scoreboard while the racers finish.";
  }

  renderPowerUps(showPlayBox);
  updatePlayControls(showPlayBox);
  renderPlayers();
  renderSpectators();
  renderSettingsSummary();
  renderMatchHistory();
  renderLeaderboards();
  renderChat();
  renderRoundResults();
  renderWinner();
  renderAvatarPicker();
  updateSoundToggle();
}

async function handleRoomAction(action, payload) {
  const response = await callSocket(action, payload);
  if (!response?.ok) {
    showToast(response?.error || "Something went wrong.");
    return false;
  }

  if (response.roomId) {
    elements.roomCodeInput.value = response.roomId;
  }

  return true;
}

async function quickJoinRoom(roomId, role) {
  const name = getName();
  if (!name) {
    showToast("Enter your name before joining from the server board.");
    elements.nameInput.focus();
    return false;
  }

  elements.roomCodeInput.value = roomId;
  return handleRoomAction("joinRoom", {
    name,
    roomId,
    role,
    avatarColor: getAvatarColor()
  });
}

elements.createRoomBtn.addEventListener("click", async () => {
  await handleRoomAction("createRoom", {
    name: getName(),
    avatarColor: getAvatarColor()
  });
});

elements.soloRoomBtn.addEventListener("click", async () => {
  await handleRoomAction("createRoom", {
    name: getName(),
    solo: true,
    avatarColor: getAvatarColor()
  });
});

elements.joinRoomBtn.addEventListener("click", async () => {
  await handleRoomAction("joinRoom", {
    name: getName(),
    roomId: getRoomCode(),
    role: "player",
    avatarColor: getAvatarColor()
  });
});

elements.spectateRoomBtn.addEventListener("click", async () => {
  await handleRoomAction("joinRoom", {
    name: getName(),
    roomId: getRoomCode(),
    role: "spectator",
    avatarColor: getAvatarColor()
  });
});

elements.nameInput.addEventListener("input", () => {
  renderRoomDirectory();
});

elements.avatarColorButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.selectedAvatarColor = button.dataset.colorSwatch;
    persistAvatarColor();
    renderAvatarPicker();
  });
});

elements.soundToggleBtn.addEventListener("click", () => {
  state.soundEnabled = !state.soundEnabled;
  persistSoundEnabled();
  if (state.soundEnabled) {
    unlockAudio();
  }
  updateSoundToggle();
});

elements.mathModeBtn.addEventListener("click", async () => {
  await handleRoomAction("chooseMode", { mode: "math" });
});

elements.spellingModeBtn.addEventListener("click", async () => {
  await handleRoomAction("chooseMode", { mode: "spelling" });
});

elements.easyDifficultyBtn.addEventListener("click", async () => {
  await handleRoomAction("chooseDifficulty", { difficulty: "easy" });
});

elements.mediumDifficultyBtn.addEventListener("click", async () => {
  await handleRoomAction("chooseDifficulty", { difficulty: "medium" });
});

elements.hardDifficultyBtn.addEventListener("click", async () => {
  await handleRoomAction("chooseDifficulty", { difficulty: "hard" });
});

elements.applySettingsBtn.addEventListener("click", async () => {
  await handleRoomAction("updateSettings", {
    roundDurationMs: Number(elements.roundDurationInput.value) * 1000,
    maxRounds: Number(elements.maxRoundsInput.value),
    eliminationsEnabled: elements.eliminationsCheckbox.checked
  });
});

elements.readyToggleBtn.addEventListener("click", async () => {
  await handleRoomAction("toggleReady", {});
});

elements.startMatchBtn.addEventListener("click", async () => {
  await handleRoomAction("startMatch", {});
});

elements.playAgainBtn.addEventListener("click", async () => {
  await handleRoomAction("playAgain", {});
});

elements.copyRoomBtn.addEventListener("click", async () => {
  const code = state.room?.id;
  if (!code) {
    showToast("Join a room first.");
    return;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      const helper = document.createElement("textarea");
      helper.value = code;
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    showToast(`Room code ${code} copied.`);
  } catch (_error) {
    showToast("Could not copy the room code.");
  }
});

elements.leaveRoomBtn.addEventListener("click", async () => {
  const ok = await handleRoomAction("leaveRoom", {});
  if (ok) {
    state.room = null;
    state.submittedThisRound = false;
    elements.answerInput.value = "";
    elements.chatInput.value = "";
    renderRoom();
  }
});

elements.submitAnswerBtn.addEventListener("click", async () => {
  const answer = elements.answerInput.value.trim();
  const response = await callSocket("submitAnswer", { answer });

  if (!response?.ok) {
    showToast(response?.error || "Could not submit your answer.");
    return;
  }

  state.submittedThisRound = true;
  renderRoom();
});

elements.doublePowerBtn.addEventListener("click", async () => {
  await handleRoomAction("usePowerUp", { type: "double" });
});

elements.shieldPowerBtn.addEventListener("click", async () => {
  await handleRoomAction("usePowerUp", { type: "shield" });
});

elements.freezePowerBtn.addEventListener("click", async () => {
  await handleRoomAction("usePowerUp", { type: "freeze" });
});

elements.answerInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  if (!elements.submitAnswerBtn.disabled) {
    elements.submitAnswerBtn.click();
  }
});

elements.sendChatBtn.addEventListener("click", async () => {
  const text = elements.chatInput.value.trim();
  const response = await callSocket("sendChat", { text });

  if (!response?.ok) {
    showToast(response?.error || "Could not send the message.");
    return;
  }

  elements.chatInput.value = "";
  elements.chatInput.focus();
});

elements.chatInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  if (!elements.sendChatBtn.disabled) {
    elements.sendChatBtn.click();
  }
});

socket.on("connected", ({ socketId }) => {
  state.selfId = socketId;
});

socket.on("leaderboardState", (leaderboard) => {
  state.leaderboard = leaderboard || {
    wins: [],
    bestScore: [],
    fastestSpelling: []
  };
  renderLeaderboards();
});

socket.on("roomDirectory", (rooms) => {
  state.roomDirectory = Array.isArray(rooms) ? rooms : [];
  renderRoomDirectory();
});

socket.on("roomState", (room) => {
  const previousRoom = state.room;
  const previousRound = state.room?.round?.number;
  const nextRound = room?.round?.number;

  if (previousRound !== nextRound || room?.phase !== "playing") {
    state.submittedThisRound = false;
    elements.answerInput.value = "";
  }

  handleRoomStateSounds(previousRoom, room);
  state.room = room;
  renderRoom();
});

socket.on("disconnect", () => {
  showToast("Disconnected from the server. Reconnect the page to keep playing.");
});

window.addEventListener("pointerdown", unlockAudio, { passive: true });
renderAvatarPicker();
renderLeaderboards();
updateSoundToggle();
