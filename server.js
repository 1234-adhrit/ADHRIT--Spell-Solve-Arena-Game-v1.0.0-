const fs = require("fs");
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const PLAYER_LIMIT = 6;
const MIN_PLAYERS = 2;
const ROUND_DURATION_MS = 20000;
const ROUND_BREAK_MS = 4000;
const WINNER_DELAY_MS = 3000;
const COUNTDOWN_MS = 3000;
const CHAT_LIMIT = 80;
const SPELLING_WORD_BANK_DIR = path.join(__dirname, "data");
const MIN_WORD_BANK_SIZE = 10000;
const SOLO_PLAYER_LIMIT = 1;
const MATCH_HISTORY_LIMIT = 30;
const GLOBAL_LEADERBOARD_LIMIT = 8;
const DEFAULT_MAX_ROUNDS = 12;
const MIN_ROUNDS = 3;
const MAX_ROUNDS = 30;
const MIN_ROUND_DURATION_MS = 10000;
const MAX_ROUND_DURATION_MS = 60000;
const ROUND_DURATION_STEP_MS = 5000;
const FREEZE_DURATION_MS = 1500;
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
const SPELLING_SELECTION_WINDOW = {
  easy: 20000,
  medium: 25000,
  hard: 30000
};

function loadSpellingWordList(level) {
  const filePath = path.join(SPELLING_WORD_BANK_DIR, `spelling-${level}.json`);
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (!Array.isArray(parsed)) {
    throw new Error(`Expected ${filePath} to contain a JSON array of words.`);
  }

  const words = [...new Set(
    parsed
      .map((word) => String(word || "").trim().toLowerCase())
      .filter((word) => /^[a-z]+$/.test(word))
  )];

  if (words.length < MIN_WORD_BANK_SIZE) {
    throw new Error(
      `${filePath} only has ${words.length} valid words. Each spelling difficulty needs at least ${MIN_WORD_BANK_SIZE}.`
    );
  }

  return words;
}

const SPELLING_WORDS = {
  easy: loadSpellingWordList("easy"),
  medium: loadSpellingWordList("medium"),
  hard: loadSpellingWordList("hard")
};

const rooms = new Map();
const socketToRoom = new Map();
const globalPlayerStats = new Map();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

function sanitizeName(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
}

function sanitizeChatMessage(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function sanitizeAvatarColor(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return PLAYER_COLORS.includes(normalized) ? normalized : null;
}

function normalizeRoomCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }

  return Math.min(max, Math.max(min, numeric));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function hashString(value) {
  return String(value || "")
    .split("")
    .reduce((total, character) => total + character.charCodeAt(0), 0);
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  do {
    code = "";
    for (let index = 0; index < 5; index += 1) {
      code += alphabet[randomInt(0, alphabet.length - 1)];
    }
  } while (rooms.has(code));

  return code;
}

function getStartingScore(mode) {
  return mode === "math" ? 3 : 6;
}

function getRoundDrain(mode) {
  return mode === "math" ? 1 : 2;
}

function getPlacementPoints(position) {
  const points = [6, 5, 4, 3, 2, 1];
  return points[position - 1] || 0;
}

function isValidDifficulty(value) {
  return value === "easy" || value === "medium" || value === "hard";
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function getPlayerList(room) {
  return Array.from(room.players.values());
}

function getSpectatorList(room) {
  return Array.from(room.spectators.values());
}

function getActivePlayers(room) {
  return getPlayerList(room).filter((player) => player.active);
}

function isSoloRoom(room) {
  return Boolean(room?.isSolo);
}

function getRoomPlayerLimit(room) {
  return isSoloRoom(room) ? SOLO_PLAYER_LIMIT : PLAYER_LIMIT;
}

function getRoomMinPlayers(room) {
  return isSoloRoom(room) ? 1 : MIN_PLAYERS;
}

function createStatsRecord() {
  return {
    wins: 0,
    totalCorrect: 0,
    fastestSpellingTimeMs: null,
    bestScore: 0
  };
}

function getDefaultRoomSettings() {
  return {
    roundDurationMs: ROUND_DURATION_MS,
    maxRounds: DEFAULT_MAX_ROUNDS,
    eliminationsEnabled: true,
    freezeDurationMs: FREEZE_DURATION_MS
  };
}

function sanitizeRoomSettings(payload = {}, current = getDefaultRoomSettings()) {
  const roundDurationMs =
    Math.round(
      clampNumber(
        payload?.roundDurationMs ?? current.roundDurationMs,
        MIN_ROUND_DURATION_MS,
        MAX_ROUND_DURATION_MS
      ) / ROUND_DURATION_STEP_MS
    ) * ROUND_DURATION_STEP_MS;

  return {
    roundDurationMs,
    maxRounds: Math.round(
      clampNumber(payload?.maxRounds ?? current.maxRounds, MIN_ROUNDS, MAX_ROUNDS)
    ),
    eliminationsEnabled:
      typeof payload?.eliminationsEnabled === "boolean"
        ? payload.eliminationsEnabled
        : current.eliminationsEnabled,
    freezeDurationMs: FREEZE_DURATION_MS
  };
}

function serializeRoomSettings(settings) {
  return {
    roundDurationMs: settings.roundDurationMs,
    maxRounds: settings.maxRounds,
    eliminationsEnabled: settings.eliminationsEnabled,
    freezeDurationMs: settings.freezeDurationMs
  };
}

function getStartingPowerUps() {
  return {
    double: 1,
    shield: 1,
    freeze: 1
  };
}

function createPlayerEffects() {
  return {
    doubleArmed: false,
    shieldArmed: false,
    frozenUntil: 0
  };
}

function pickAvatarColor(room, preferredColor, name) {
  const preferred = sanitizeAvatarColor(preferredColor);
  if (preferred) {
    return preferred;
  }

  const usedColors = new Set(
    [...getPlayerList(room), ...getSpectatorList(room)]
      .map((entry) => entry.avatarColor)
      .filter(Boolean)
  );

  const firstUnused = PLAYER_COLORS.find((color) => !usedColors.has(color));
  if (firstUnused) {
    return firstUnused;
  }

  return PLAYER_COLORS[hashString(name) % PLAYER_COLORS.length];
}

function isNameTaken(room, name) {
  const lower = name.toLowerCase();
  return (
    getPlayerList(room).some((entry) => entry.name.toLowerCase() === lower) ||
    getSpectatorList(room).some((entry) => entry.name.toLowerCase() === lower)
  );
}

function findParticipant(room, socketId) {
  return room.players.get(socketId) || room.spectators.get(socketId) || null;
}

function getStatsKey(name) {
  return name.toLowerCase();
}

function getOrCreateStats(room, name) {
  const key = getStatsKey(name);
  if (!room.playerStats.has(key)) {
    room.playerStats.set(key, createStatsRecord());
  }

  return room.playerStats.get(key);
}

function serializeStats(stats) {
  return {
    wins: stats?.wins ?? 0,
    totalCorrect: stats?.totalCorrect ?? 0,
    fastestSpellingTimeMs: stats?.fastestSpellingTimeMs ?? null,
    bestScore: stats?.bestScore ?? 0
  };
}

function getOrCreateGlobalStats(name) {
  const key = getStatsKey(name);
  if (!globalPlayerStats.has(key)) {
    globalPlayerStats.set(key, {
      name,
      avatarColor: PLAYER_COLORS[hashString(name) % PLAYER_COLORS.length],
      ...createStatsRecord()
    });
  }

  return globalPlayerStats.get(key);
}

function rememberGlobalPlayerStyle(name, avatarColor) {
  const stats = getOrCreateGlobalStats(name);
  stats.name = name;
  if (avatarColor) {
    stats.avatarColor = avatarColor;
  }
}

function updateGlobalBestScore(name, avatarColor, score) {
  const stats = getOrCreateGlobalStats(name);
  stats.name = name;
  if (avatarColor) {
    stats.avatarColor = avatarColor;
  }
  stats.bestScore = Math.max(stats.bestScore, score);
}

function updateGlobalCorrect(name, avatarColor) {
  const stats = getOrCreateGlobalStats(name);
  stats.name = name;
  if (avatarColor) {
    stats.avatarColor = avatarColor;
  }
  stats.totalCorrect += 1;
}

function updateGlobalFastestSpelling(name, avatarColor, timeMs) {
  const stats = getOrCreateGlobalStats(name);
  stats.name = name;
  if (avatarColor) {
    stats.avatarColor = avatarColor;
  }

  if (stats.fastestSpellingTimeMs === null || timeMs < stats.fastestSpellingTimeMs) {
    stats.fastestSpellingTimeMs = timeMs;
  }
}

function updateGlobalWin(name, avatarColor) {
  const stats = getOrCreateGlobalStats(name);
  stats.name = name;
  if (avatarColor) {
    stats.avatarColor = avatarColor;
  }
  stats.wins += 1;
}

function serializeGlobalLeaderboard() {
  const entries = [...globalPlayerStats.values()].map((entry) => ({
    name: entry.name,
    avatarColor: entry.avatarColor,
    wins: entry.wins,
    totalCorrect: entry.totalCorrect,
    fastestSpellingTimeMs: entry.fastestSpellingTimeMs,
    bestScore: entry.bestScore
  }));

  const sortByName = (left, right) => left.name.localeCompare(right.name);
  const sortFastest = (left, right) => {
    const leftTime = left.fastestSpellingTimeMs ?? Number.MAX_SAFE_INTEGER;
    const rightTime = right.fastestSpellingTimeMs ?? Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return sortByName(left, right);
  };

  return {
    wins: [...entries]
      .filter((entry) => entry.wins > 0)
      .sort((left, right) => right.wins - left.wins || sortByName(left, right))
      .slice(0, GLOBAL_LEADERBOARD_LIMIT),
    bestScore: [...entries]
      .filter((entry) => entry.bestScore > 0)
      .sort((left, right) => right.bestScore - left.bestScore || sortByName(left, right))
      .slice(0, GLOBAL_LEADERBOARD_LIMIT),
    fastestSpelling: [...entries]
      .filter((entry) => entry.fastestSpellingTimeMs !== null)
      .sort(sortFastest)
      .slice(0, GLOBAL_LEADERBOARD_LIMIT)
  };
}

function updatePlayerBestScore(player) {
  player.stats.bestScore = Math.max(player.stats.bestScore ?? 0, player.score);
  updateGlobalBestScore(player.name, player.avatarColor, player.score);
}

function pushChatMessage(room, entry) {
  room.chat.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    ...entry
  });

  if (room.chat.length > CHAT_LIMIT) {
    room.chat.splice(0, room.chat.length - CHAT_LIMIT);
  }
}

function pushSystemMessage(room, text) {
  pushChatMessage(room, {
    type: "system",
    name: "System",
    text
  });
}

function serializeRound(room) {
  if (!room.currentRound) {
    return null;
  }

  return {
    number: room.currentRound.number,
    prompt: room.currentRound.prompt,
    startedAt: room.currentRound.startedAt,
    endsAt: room.currentRound.endsAt,
    drain: room.currentRound.drain,
    participants: [...room.currentRound.participants],
    scoring:
      room.mode === "math"
        ? { type: "fixed", correct: 2 }
        : { type: "placement", places: [6, 5, 4, 3, 2, 1] }
  };
}

function serializeCountdown(room) {
  if (!room.countdown) {
    return null;
  }

  return {
    startedAt: room.countdown.startedAt,
    endsAt: room.countdown.endsAt
  };
}

function getHostName(room) {
  return findParticipant(room, room.hostId)?.name || "Unknown host";
}

function serializeRoomDirectory() {
  return [...rooms.values()]
    .filter((room) => !room.isSolo)
    .map((room) => ({
      id: room.id,
      hostName: getHostName(room),
      mode: room.mode,
      difficulty: room.difficulty,
      phase: room.phase,
      started: room.started,
      playerCount: room.players.size,
      spectatorCount: room.spectators.size,
      readyCount: getPlayerList(room).filter((player) => player.ready).length,
      playerLimit: getRoomPlayerLimit(room),
      joinable: room.phase === "lobby" && room.players.size < getRoomPlayerLimit(room),
      spectatable: true,
      createdAt: room.createdAt
    }))
    .sort((left, right) => right.createdAt - left.createdAt);
}

function serializeRoom(room) {
  const players = getPlayerList(room)
    .map((player) => ({
      id: player.id,
      name: player.name,
      avatarColor: player.avatarColor,
      score: player.score,
      ready: player.ready,
      active: player.active,
      eliminated: player.eliminated,
      isHost: player.id === room.hostId,
      joinedAt: player.joinedAt,
      powerUps: { ...player.powerUps },
      effects: { ...player.effects },
      stats: serializeStats(player.stats)
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.name.localeCompare(right.name);
    });

  const spectators = getSpectatorList(room)
    .map((spectator) => ({
      id: spectator.id,
      name: spectator.name,
      avatarColor: spectator.avatarColor,
      isHost: spectator.id === room.hostId,
      joinedAt: spectator.joinedAt
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    id: room.id,
    hostId: room.hostId,
    isSolo: room.isSolo,
    mode: room.mode,
    difficulty: room.difficulty,
    phase: room.phase,
    started: room.started,
    playerLimit: getRoomPlayerLimit(room),
    minPlayers: getRoomMinPlayers(room),
    settings: serializeRoomSettings(room.settings),
    roundNumber: room.roundNumber,
    countdown: serializeCountdown(room),
    players,
    spectators,
    round: serializeRound(room),
    lastRoundResult: room.lastRoundResult,
    matchHistory: [...room.matchHistory].reverse(),
    winner: room.winner,
    notice: room.notice,
    chat: [...room.chat]
  };
}

function emitGlobalLeaderboard() {
  io.emit("leaderboardState", serializeGlobalLeaderboard());
}

function emitRoomState(room) {
  io.to(room.id).emit("roomState", serializeRoom(room));
  io.emit("roomDirectory", serializeRoomDirectory());
  emitGlobalLeaderboard();
}

function assignNewHost(room) {
  const activePlayer = getPlayerList(room).find((player) => player.active);
  const anyPlayer = getPlayerList(room)[0];
  const spectator = getSpectatorList(room)[0];
  const nextHost = activePlayer || anyPlayer || spectator || null;
  room.hostId = nextHost ? nextHost.id : null;
}

function clearRoomTimers(room) {
  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
  }

  if (room.roundTimer) {
    clearTimeout(room.roundTimer);
    room.roundTimer = null;
  }

  if (room.breakTimer) {
    clearTimeout(room.breakTimer);
    room.breakTimer = null;
  }

  if (room.finishTimer) {
    clearTimeout(room.finishTimer);
    room.finishTimer = null;
  }
}

function allPlayersReady(room) {
  const players = getPlayerList(room);
  if (isSoloRoom(room)) {
    return players.length >= 1;
  }

  return players.length >= MIN_PLAYERS && players.every((player) => player.ready);
}

function resetPlayersForLobby(room) {
  for (const player of getPlayerList(room)) {
    player.score = 0;
    player.ready = false;
    player.active = true;
    player.eliminated = false;
    player.powerUps = getStartingPowerUps();
    player.effects = createPlayerEffects();
  }
}

function getStartError(room) {
  if (room.phase !== "lobby") {
    return "The room must be in the lobby before a match can start.";
  }

  if (room.started || room.phase === "countdown" || room.phase === "playing") {
    return "The match is already running.";
  }

  if (!room.mode) {
    return "Pick Math Race or Spelling Race before starting.";
  }

  const players = getPlayerList(room);
  if (players.length < getRoomMinPlayers(room)) {
    if (isSoloRoom(room)) {
      return "Solo practice needs one player in the room before it can start.";
    }

    return "At least 2 players are needed to start the match.";
  }

  if (!allPlayersReady(room)) {
    return "All players must click Ready before the match can start.";
  }

  return null;
}

function removeRoomIfEmpty(room) {
  if (room.players.size === 0 && room.spectators.size === 0) {
    clearRoomTimers(room);
    rooms.delete(room.id);
    io.emit("roomDirectory", serializeRoomDirectory());
  }
}

function buildMathChallenge(roundNumber, difficulty) {
  const settingsByDifficulty = {
    easy: {
      max: 8 + roundNumber * 2,
      multiplyRound: 5,
      plusRange: [2, 12],
      minusRange: [2, 12],
      multiplierCap: 5
    },
    medium: {
      max: 10 + roundNumber * 3,
      multiplyRound: 3,
      plusRange: [5, 19],
      minusRange: [5, 19],
      multiplierCap: 9
    },
    hard: {
      max: 14 + roundNumber * 5,
      multiplyRound: 1,
      plusRange: [8, 30],
      minusRange: [8, 30],
      multiplierCap: 12
    }
  };

  const settings = settingsByDifficulty[difficulty] || settingsByDifficulty.medium;
  const max = settings.max;
  const useMultiply = roundNumber >= settings.multiplyRound && Math.random() > 0.3;

  if (useMultiply) {
    const a = randomInt(2, Math.min(settings.multiplierCap, 3 + roundNumber));
    const b = randomInt(2, Math.min(settings.multiplierCap, 4 + roundNumber));
    const c = randomInt(1, Math.floor(max / 2));

    if (Math.random() > 0.5) {
      return {
        prompt: `${a} x ${b} + ${c}`,
        answer: String(a * b + c)
      };
    }

    return {
      prompt: `${a} x ${b} - ${c}`,
      answer: String(a * b - c)
    };
  }

  const a = randomInt(settings.plusRange[0], max);
  const b = randomInt(settings.minusRange[0], Math.max(settings.minusRange[1], max - 1));

  if (Math.random() > 0.5) {
    return {
      prompt: `${a} + ${b}`,
      answer: String(a + b)
    };
  }

  const high = Math.max(a, b);
  const low = Math.min(a, b);
  return {
    prompt: `${high} - ${low}`,
    answer: String(high - low)
  };
}

function buildSpellingChallenge(room) {
  const basePool = SPELLING_WORDS[room.difficulty] || SPELLING_WORDS.medium;
  const availableWords = basePool.filter((word) => !room.usedWords.has(word));
  const selectedPool = availableWords.length > 0 ? availableWords : basePool;
  const windowSize =
    SPELLING_SELECTION_WINDOW[room.difficulty] || SPELLING_SELECTION_WINDOW.medium;
  const rankedPool = selectedPool.slice(0, Math.min(selectedPool.length, windowSize));
  const word = rankedPool[randomInt(0, rankedPool.length - 1)];
  room.usedWords.add(word);
  return {
    prompt: word,
    answer: word.toLowerCase()
  };
}

function buildChallenge(room) {
  return room.mode === "math"
    ? buildMathChallenge(room.roundNumber, room.difficulty)
    : buildSpellingChallenge(room);
}

function endMatch(room, reason, options = {}) {
  clearRoomTimers(room);

  const players = getPlayerList(room);
  const ranking = [...players].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (Number(right.active) !== Number(left.active)) {
      return Number(right.active) - Number(left.active);
    }

    return left.name.localeCompare(right.name);
  });

  const winner = options.noWinner ? null : ranking[0] || null;
  if (winner?.stats) {
    winner.stats.wins += 1;
    updateGlobalWin(winner.name, winner.avatarColor);
  }

  room.phase = "finished";
  room.started = false;
  room.currentRound = null;
  room.countdown = null;
  room.notice = `${reason} Difficulty choices will appear in 3 seconds.`;
  room.winner = winner
    ? {
        id: winner.id,
        name: winner.name,
        score: winner.score
      }
    : null;
  pushSystemMessage(room, winner ? `${winner.name} won the match.` : reason);

  emitRoomState(room);

  room.finishTimer = setTimeout(() => {
    const latestRoom = getRoom(room.id);
    if (!latestRoom || latestRoom.phase !== "finished") {
      return;
    }

    resetPlayersForLobby(latestRoom);
    latestRoom.phase = "lobby";
    latestRoom.started = false;
    latestRoom.roundNumber = 0;
    latestRoom.notice = latestRoom.isSolo
      ? "Choose Easy, Medium, or Hard for your next solo run."
      : "Choose Easy, Medium, or Hard for the next match.";
    latestRoom.finishTimer = null;
    pushSystemMessage(
      latestRoom,
      latestRoom.isSolo
        ? "Solo practice is ready again. Choose the next difficulty."
        : "The room is back in the lobby. Choose the next difficulty."
    );
    emitRoomState(latestRoom);
  }, WINNER_DELAY_MS);
}

function beginMatch(roomId) {
  const room = getRoom(roomId);
  if (!room || room.phase !== "countdown") {
    return;
  }

  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
  }

  room.phase = "playing";
  room.countdown = null;
  room.started = true;
  room.matchNumber += 1;
  room.roundNumber = 0;
  room.lastRoundResult = null;
  room.winner = null;
  room.notice = null;
  room.usedWords.clear();
  pushSystemMessage(room, "Go! The race has started.");

  for (const player of getPlayerList(room)) {
    player.score = getStartingScore(room.mode);
    player.ready = false;
    player.active = true;
    player.eliminated = false;
    player.powerUps = getStartingPowerUps();
    player.effects = createPlayerEffects();
    updatePlayerBestScore(player);
  }

  startNextRound(room);
}

function startCountdown(room, message) {
  clearRoomTimers(room);
  room.phase = "countdown";
  room.started = true;
  room.currentRound = null;
  room.countdown = {
    startedAt: Date.now(),
    endsAt: Date.now() + COUNTDOWN_MS
  };
  room.notice = "3-2-1 countdown started.";
  pushSystemMessage(room, message);
  emitRoomState(room);

  room.countdownTimer = setTimeout(() => {
    beginMatch(room.id);
  }, COUNTDOWN_MS);
}

function maybeEndAfterRound(room) {
  const activePlayers = getActivePlayers(room);

  if (isSoloRoom(room)) {
    if (activePlayers.length === 0) {
      const player = getPlayerList(room)[0];
      endMatch(
        room,
        player
          ? `${player.name} ran out of points, so the solo run is over.`
          : "The solo run is over.",
        { noWinner: true }
      );
      return true;
    }

    return false;
  }

  if (activePlayers.length < MIN_PLAYERS) {
    endMatch(
      room,
      activePlayers.length === 1
        ? `${activePlayers[0].name} is the last active racer.`
        : "The match ended because there are not enough active racers left."
    );
    return true;
  }

  return false;
}

function startNextRound(room) {
  clearRoomTimers(room);

  if (room.phase !== "playing") {
    return;
  }

  room.roundNumber += 1;
  room.notice = null;
  room.lastRoundResult = null;

  const drain = getRoundDrain(room.mode);
  const eliminatedAtStart = [];
  const shieldedPlayers = [];

  for (const player of getActivePlayers(room)) {
    if (player.effects.shieldArmed) {
      player.effects.shieldArmed = false;
      shieldedPlayers.push(player.name);
      continue;
    }

    player.score = Math.max(0, player.score - drain);

    if (room.settings.eliminationsEnabled && player.score === 0) {
      player.active = false;
      player.eliminated = true;
      eliminatedAtStart.push(player.name);
    }
  }

  if (maybeEndAfterRound(room)) {
    return;
  }

  const challenge = buildChallenge(room);
  const activeIds = getActivePlayers(room).map((player) => player.id);

  room.currentRound = {
    number: room.roundNumber,
    prompt: challenge.prompt,
    answer: challenge.answer,
    drain,
    startedAt: Date.now(),
    endsAt: Date.now() + room.settings.roundDurationMs,
    participants: activeIds,
    submissions: new Map()
  };

  const notices = [];
  if (shieldedPlayers.length > 0) {
    notices.push(`${shieldedPlayers.join(", ")} blocked the drain with a shield.`);
  }
  if (eliminatedAtStart.length > 0) {
    notices.push(`${eliminatedAtStart.join(", ")} dropped to 0 points and moved to spectator mode.`);
  }
  room.notice = notices.length > 0 ? notices.join(" ") : null;

  emitRoomState(room);

  room.roundTimer = setTimeout(() => {
    resolveRound(room.id);
  }, room.settings.roundDurationMs);
}

function resolveRound(roomId) {
  const room = getRoom(roomId);
  if (!room || room.phase !== "playing" || !room.currentRound) {
    return;
  }

  clearRoomTimers(room);

  const answer = room.currentRound.answer;
  const prompt = room.currentRound.prompt;
  const participantIds = [...room.currentRound.participants];
  const results = [];

  if (room.mode === "math") {
    for (const playerId of participantIds) {
      const player = room.players.get(playerId);
      if (!player || !player.active) {
        continue;
      }

      const submission = room.currentRound.submissions.get(playerId);
      const correct = Boolean(submission && submission.correct);
      const usedDouble = Boolean(player.effects.doubleArmed);
      let gained = correct ? 2 : 0;
      if (correct && usedDouble) {
        gained *= 2;
      }
      player.score += gained;
      if (correct) {
        player.stats.totalCorrect += 1;
        updateGlobalCorrect(player.name, player.avatarColor);
      }
      updatePlayerBestScore(player);

      results.push({
        id: player.id,
        name: player.name,
        avatarColor: player.avatarColor,
        correct,
        answer: submission ? submission.answer : "",
        placement: null,
        timeMs: submission ? submission.submittedAt - room.currentRound.startedAt : null,
        gained,
        total: player.score
      });
    }
  } else {
    const orderedCorrect = participantIds
      .map((playerId) => {
        const player = room.players.get(playerId);
        const submission = room.currentRound.submissions.get(playerId);
        if (!player || !player.active || !submission || !submission.correct) {
          return null;
        }

        return {
          player,
          submission
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.submission.submittedAt - right.submission.submittedAt);

    const placementMap = new Map();
    orderedCorrect.forEach((entry, index) => {
      const placement = index + 1;
      const timeMs = entry.submission.submittedAt - room.currentRound.startedAt;
      placementMap.set(entry.player.id, placement);
      const usedDouble = Boolean(entry.player.effects.doubleArmed);
      let gained = getPlacementPoints(placement);
      if (usedDouble) {
        gained *= 2;
      }
      entry.player.score += gained;
      entry.player.stats.totalCorrect += 1;
      updateGlobalCorrect(entry.player.name, entry.player.avatarColor);
      if (
        entry.player.stats.fastestSpellingTimeMs === null ||
        timeMs < entry.player.stats.fastestSpellingTimeMs
      ) {
        entry.player.stats.fastestSpellingTimeMs = timeMs;
      }
      updateGlobalFastestSpelling(entry.player.name, entry.player.avatarColor, timeMs);
      updatePlayerBestScore(entry.player);
    });

    for (const playerId of participantIds) {
      const player = room.players.get(playerId);
      if (!player || !player.active) {
        continue;
      }

      const submission = room.currentRound.submissions.get(playerId);
      const correct = Boolean(submission && submission.correct);
      const placement = placementMap.get(player.id) || null;
      const usedDouble = Boolean(player.effects.doubleArmed);
      let gained = placement ? getPlacementPoints(placement) : 0;
      if (placement && usedDouble) {
        gained *= 2;
      }
      updatePlayerBestScore(player);

      results.push({
        id: player.id,
        name: player.name,
        avatarColor: player.avatarColor,
        correct,
        answer: submission ? submission.answer : "",
        placement,
        timeMs: submission ? submission.submittedAt - room.currentRound.startedAt : null,
        gained,
        total: player.score
      });
    }
  }

  results.sort((left, right) => {
    if (right.gained !== left.gained) {
      return right.gained - left.gained;
    }

    const leftTime = left.timeMs ?? Number.MAX_SAFE_INTEGER;
    const rightTime = right.timeMs ?? Number.MAX_SAFE_INTEGER;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return left.name.localeCompare(right.name);
  });

  for (const playerId of participantIds) {
    const player = room.players.get(playerId);
    if (!player) {
      continue;
    }

    player.effects.doubleArmed = false;
  }

  room.lastRoundResult = {
    roundNumber: room.roundNumber,
    prompt,
    answer,
    resolvedAt: Date.now(),
    results
  };
  room.matchHistory.push({
    id: `${room.matchNumber}-${room.roundNumber}-${Date.now()}`,
    matchNumber: room.matchNumber,
    roundNumber: room.roundNumber,
    mode: room.mode,
    difficulty: room.difficulty,
    prompt,
    answer,
    resolvedAt: Date.now(),
    results
  });
  if (room.matchHistory.length > MATCH_HISTORY_LIMIT) {
    room.matchHistory.splice(0, room.matchHistory.length - MATCH_HISTORY_LIMIT);
  }
  room.currentRound = null;

  emitRoomState(room);

  if (room.roundNumber >= room.settings.maxRounds) {
    endMatch(room, `Round limit reached after ${room.settings.maxRounds} rounds.`);
    return;
  }

  if (maybeEndAfterRound(room)) {
    return;
  }

  room.breakTimer = setTimeout(() => {
    startNextRound(room);
  }, ROUND_BREAK_MS);
}

function allParticipantsSubmitted(room) {
  if (!room.currentRound) {
    return false;
  }

  return room.currentRound.participants.every((playerId) => {
    const player = room.players.get(playerId);
    if (!player || !player.active) {
      return true;
    }
    return room.currentRound.submissions.has(playerId);
  });
}

function removeSocketFromRoom(socket, disconnecting = false) {
  const roomId = socketToRoom.get(socket.id);
  if (!roomId) {
    return;
  }

  const room = getRoom(roomId);
  socketToRoom.delete(socket.id);

  if (!room) {
    return;
  }

  const wasPlayer = room.players.has(socket.id);
  const departing = findParticipant(room, socket.id);
  const departingRole = wasPlayer ? "player" : "spectator";

  room.players.delete(socket.id);
  room.spectators.delete(socket.id);

  if (!disconnecting) {
    socket.leave(roomId);
  }

  if (room.hostId === socket.id) {
    assignNewHost(room);
  }

  if (room.currentRound) {
    room.currentRound.submissions.delete(socket.id);
    room.currentRound.participants = room.currentRound.participants.filter(
      (playerId) => playerId !== socket.id
    );
  }

  removeRoomIfEmpty(room);

  if (!rooms.has(roomId)) {
    return;
  }

  if (departing) {
    pushSystemMessage(room, `${departing.name} left the room as a ${departingRole}.`);
  }

  if (room.phase === "playing" && wasPlayer) {
    const activePlayers = getActivePlayers(room);

    if (activePlayers.length < getRoomMinPlayers(room)) {
      endMatch(
        room,
        departing
          ? `${departing.name} left, so the match ended because not enough racers remain.`
          : "The match ended because not enough racers remain."
      );
      return;
    }

    if (room.currentRound && allParticipantsSubmitted(room)) {
      resolveRound(room.id);
      return;
    }
  }

  if (room.phase === "countdown" && wasPlayer) {
    const players = getPlayerList(room);
    if (players.length < getRoomMinPlayers(room)) {
      clearRoomTimers(room);
      room.phase = "lobby";
      room.started = false;
      room.countdown = null;
      room.notice = room.isSolo
        ? "Countdown canceled because the solo player left."
        : "Countdown canceled because there are not enough players.";
      pushSystemMessage(
        room,
        room.isSolo
          ? "Countdown canceled because the solo player left."
          : "Countdown canceled because there are not enough players."
      );
      emitRoomState(room);
      return;
    }
  }

  emitRoomState(room);
}

function createRoom(socket, name, options = {}) {
  const roomId = createRoomCode();
  const room = {
    id: roomId,
    hostId: socket.id,
    isSolo: Boolean(options.solo),
    mode: null,
    difficulty: "medium",
    settings: getDefaultRoomSettings(),
    phase: "lobby",
    started: false,
    createdAt: Date.now(),
    matchNumber: 0,
    roundNumber: 0,
    countdown: null,
    players: new Map(),
    spectators: new Map(),
    playerStats: new Map(),
    currentRound: null,
    lastRoundResult: null,
    matchHistory: [],
    winner: null,
    notice: null,
    chat: [],
    usedWords: new Set(),
    countdownTimer: null,
    roundTimer: null,
    breakTimer: null,
    finishTimer: null
  };

  const avatarColor = pickAvatarColor(room, options.avatarColor, name);

  room.players.set(socket.id, {
    id: socket.id,
    name,
    avatarColor,
    score: 0,
    ready: false,
    active: true,
    eliminated: false,
    joinedAt: Date.now(),
    powerUps: getStartingPowerUps(),
    effects: createPlayerEffects(),
    stats: getOrCreateStats(room, name)
  });
  rememberGlobalPlayerStyle(name, avatarColor);

  rooms.set(roomId, room);
  socketToRoom.set(socket.id, roomId);
  socket.join(roomId);
  pushSystemMessage(
    room,
    room.isSolo ? `${name} started a solo practice room.` : `${name} created the room.`
  );
  emitRoomState(room);

  return room;
}

io.on("connection", (socket) => {
  socket.emit("connected", { socketId: socket.id });
  socket.emit("roomDirectory", serializeRoomDirectory());
  socket.emit("leaderboardState", serializeGlobalLeaderboard());

  socket.on("createRoom", (payload, callback = () => {}) => {
    const name = sanitizeName(payload?.name);
    const solo = Boolean(payload?.solo);
    const avatarColor = sanitizeAvatarColor(payload?.avatarColor);

    if (!name) {
      callback({ ok: false, error: "Enter your name before creating a room." });
      return;
    }

    removeSocketFromRoom(socket);
    const room = createRoom(socket, name, { solo, avatarColor });
    callback({ ok: true, roomId: room.id });
  });

  socket.on("joinRoom", (payload, callback = () => {}) => {
    const roomId = normalizeRoomCode(payload?.roomId);
    const name = sanitizeName(payload?.name);
    const role = payload?.role === "spectator" ? "spectator" : "player";
    const avatarColor = sanitizeAvatarColor(payload?.avatarColor);
    const room = getRoom(roomId);

    if (!name) {
      callback({ ok: false, error: "Enter your name before joining a room." });
      return;
    }

    if (!room) {
      callback({ ok: false, error: "Room not found. Check the room code and try again." });
      return;
    }

    if (room.isSolo) {
      callback({ ok: false, error: "That room is private solo practice and cannot be joined." });
      return;
    }

    if (isNameTaken(room, name)) {
      callback({ ok: false, error: "That name is already being used in this room." });
      return;
    }

    if (role === "player" && room.phase !== "lobby") {
      callback({ ok: false, error: "This match has already started. Join as a spectator instead." });
      return;
    }

    if (role === "player" && room.players.size >= PLAYER_LIMIT) {
      callback({ ok: false, error: "This room is full. Each room can only have 6 players." });
      return;
    }

    removeSocketFromRoom(socket);

    socketToRoom.set(socket.id, roomId);
    socket.join(roomId);

    if (role === "player") {
      const assignedColor = pickAvatarColor(room, avatarColor, name);
      room.players.set(socket.id, {
        id: socket.id,
        name,
        avatarColor: assignedColor,
        score: 0,
        ready: false,
        active: true,
        eliminated: false,
        joinedAt: Date.now(),
        powerUps: getStartingPowerUps(),
        effects: createPlayerEffects(),
        stats: getOrCreateStats(room, name)
      });
      rememberGlobalPlayerStyle(name, assignedColor);
    } else {
      const assignedColor = pickAvatarColor(room, avatarColor, name);
      room.spectators.set(socket.id, {
        id: socket.id,
        name,
        avatarColor: assignedColor,
        joinedAt: Date.now()
      });
      rememberGlobalPlayerStyle(name, assignedColor);
    }

    pushSystemMessage(room, `${name} joined as a ${role}.`);
    emitRoomState(room);
    callback({ ok: true, roomId });
  });

  socket.on("chooseMode", (payload, callback = () => {}) => {
    const roomId = socketToRoom.get(socket.id);
    const room = getRoom(roomId);
    const mode = payload?.mode;

    if (!room) {
      callback({ ok: false, error: "Join a room first." });
      return;
    }

    if (room.hostId !== socket.id) {
      callback({ ok: false, error: "Only the room creator can choose the game mode." });
      return;
    }

    if (room.started) {
      callback({ ok: false, error: "The match is already running." });
      return;
    }

    if (mode !== "math" && mode !== "spelling") {
      callback({ ok: false, error: "Choose either Math Race or Spelling Race." });
      return;
    }

    room.mode = mode;
    room.notice = `${mode === "math" ? "Math" : "Spelling"} Race is selected.`;
    pushSystemMessage(room, `${mode === "math" ? "Math Race" : "Spelling Race"} was selected.`);
    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on("toggleReady", (_payload, callback = () => {}) => {
    const roomId = socketToRoom.get(socket.id);
    const room = getRoom(roomId);
    const player = room?.players.get(socket.id);

    if (!room || !player) {
      callback({ ok: false, error: "Only players in a room can use Ready." });
      return;
    }

    if (room.phase !== "lobby" || room.started) {
      callback({ ok: false, error: "You can only change readiness while the room is in the lobby." });
      return;
    }

    player.ready = !player.ready;
    room.notice = `${player.name} is ${player.ready ? "ready" : "not ready yet"}.`;
    pushSystemMessage(room, `${player.name} is ${player.ready ? "ready" : "not ready"} for the next match.`);
    emitRoomState(room);
    callback({ ok: true, ready: player.ready });
  });

  socket.on("chooseDifficulty", (payload, callback = () => {}) => {
    const roomId = socketToRoom.get(socket.id);
    const room = getRoom(roomId);
    const difficulty = payload?.difficulty;

    if (!room) {
      callback({ ok: false, error: "Join a room first." });
      return;
    }

    if (room.hostId !== socket.id) {
      callback({ ok: false, error: "Only the room creator can choose the difficulty." });
      return;
    }

    if (room.started) {
      callback({ ok: false, error: "The match is already running." });
      return;
    }

    if (!isValidDifficulty(difficulty)) {
      callback({ ok: false, error: "Choose Easy, Medium, or Hard." });
      return;
    }

    room.difficulty = difficulty;
    room.notice = `${difficulty[0].toUpperCase()}${difficulty.slice(1)} difficulty is selected.`;
    pushSystemMessage(
      room,
      `${difficulty[0].toUpperCase()}${difficulty.slice(1)} difficulty was selected.`
    );
    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on("updateSettings", (payload, callback = () => {}) => {
    const roomId = socketToRoom.get(socket.id);
    const room = getRoom(roomId);

    if (!room) {
      callback({ ok: false, error: "Join a room first." });
      return;
    }

    if (room.hostId !== socket.id) {
      callback({ ok: false, error: "Only the room creator can change the room settings." });
      return;
    }

    if (room.phase !== "lobby" || room.started) {
      callback({ ok: false, error: "Room settings can only be changed while the room is in the lobby." });
      return;
    }

    room.settings = sanitizeRoomSettings(payload, room.settings);
    room.notice = `Round timer ${room.settings.roundDurationMs / 1000}s, max rounds ${room.settings.maxRounds}, eliminations ${room.settings.eliminationsEnabled ? "on" : "off"}.`;
    pushSystemMessage(
      room,
      `Room settings updated: ${room.settings.roundDurationMs / 1000}s rounds, ${room.settings.maxRounds} max rounds, eliminations ${room.settings.eliminationsEnabled ? "on" : "off"}.`
    );
    emitRoomState(room);
    callback({ ok: true, settings: serializeRoomSettings(room.settings) });
  });

  socket.on("startMatch", (_payload, callback = () => {}) => {
    const roomId = socketToRoom.get(socket.id);
    const room = getRoom(roomId);

    if (!room) {
      callback({ ok: false, error: "Join a room first." });
      return;
    }

    if (room.hostId !== socket.id) {
      callback({ ok: false, error: "Only the room creator can start the match." });
      return;
    }

    const error = getStartError(room);
    if (error) {
      callback({ ok: false, error });
      return;
    }

    callback({ ok: true });
    startCountdown(
      room,
      `3-2-1... ${room.mode === "math" ? "Math Race" : "Spelling Race"} is about to start on ${room.difficulty} difficulty.`
    );
  });

  socket.on("playAgain", (_payload, callback = () => {}) => {
    const roomId = socketToRoom.get(socket.id);
    const room = getRoom(roomId);

    if (!room) {
      callback({ ok: false, error: "Join a room first." });
      return;
    }

    if (room.hostId !== socket.id) {
      callback({ ok: false, error: "Only the room creator can start the rematch." });
      return;
    }

    if (room.phase !== "lobby" || !room.winner) {
      callback({ ok: false, error: "A rematch can only be started from the lobby after a finished game." });
      return;
    }

    const error = getStartError(room);
    if (error) {
      callback({ ok: false, error });
      return;
    }

    callback({ ok: true });
    startCountdown(
      room,
      `Rematch starting in 3... ${room.mode === "math" ? "Math Race" : "Spelling Race"} on ${room.difficulty} difficulty.`
    );
  });

  socket.on("submitAnswer", (payload, callback = () => {}) => {
    const roomId = socketToRoom.get(socket.id);
    const room = getRoom(roomId);
    const answer = String(payload?.answer ?? "").trim();

    if (!room || room.phase !== "playing" || !room.currentRound) {
      callback({ ok: false, error: "There is no active round right now." });
      return;
    }

    const player = room.players.get(socket.id);
    if (!player || !player.active) {
      callback({ ok: false, error: "Only active players can submit answers." });
      return;
    }

    if (player.effects.frozenUntil > Date.now()) {
      callback({ ok: false, error: "You are frozen for a moment and cannot answer yet." });
      return;
    }

    if (room.currentRound.submissions.has(socket.id)) {
      callback({ ok: false, error: "You already submitted this round." });
      return;
    }

    if (!answer) {
      callback({ ok: false, error: "Type an answer before submitting." });
      return;
    }

    const normalizedAnswer =
      room.mode === "math" ? answer.replace(/\s+/g, "") : answer.toLowerCase();
    const correct = normalizedAnswer === room.currentRound.answer;

    room.currentRound.submissions.set(socket.id, {
      answer,
      correct,
      submittedAt: Date.now()
    });

    emitRoomState(room);
    callback({ ok: true, correct });

    if (allParticipantsSubmitted(room)) {
      resolveRound(room.id);
    }
  });

  socket.on("usePowerUp", (payload, callback = () => {}) => {
    const roomId = socketToRoom.get(socket.id);
    const room = getRoom(roomId);
    const player = room?.players.get(socket.id);
    const type = payload?.type;

    if (!room || !player) {
      callback({ ok: false, error: "Only players in a room can use power-ups." });
      return;
    }

    if (room.phase !== "playing" || !room.currentRound) {
      callback({ ok: false, error: "Power-ups can only be used during a live round." });
      return;
    }

    if (!player.active) {
      callback({ ok: false, error: "Only active players can use power-ups." });
      return;
    }

    if (room.currentRound.submissions.has(socket.id)) {
      callback({ ok: false, error: "Use your power-up before you submit for this round." });
      return;
    }

    if (player.effects.frozenUntil > Date.now()) {
      callback({ ok: false, error: "You cannot use a power-up while frozen." });
      return;
    }

    if (!["double", "shield", "freeze"].includes(type)) {
      callback({ ok: false, error: "Unknown power-up." });
      return;
    }

    if ((player.powerUps[type] || 0) <= 0) {
      callback({ ok: false, error: "That power-up has already been used." });
      return;
    }

    if (type === "double" && player.effects.doubleArmed) {
      callback({ ok: false, error: "Double Points is already armed for this round." });
      return;
    }

    if (type === "shield" && player.effects.shieldArmed) {
      callback({ ok: false, error: "Shield is already armed for the next drain." });
      return;
    }

    if (type === "freeze") {
      const opponents = getActivePlayers(room).filter((entry) => entry.id !== socket.id);
      if (opponents.length === 0) {
        callback({ ok: false, error: "There are no active opponents to freeze right now." });
        return;
      }

      const frozenUntil = Date.now() + room.settings.freezeDurationMs;
      opponents.forEach((opponent) => {
        opponent.effects.frozenUntil = Math.max(opponent.effects.frozenUntil, frozenUntil);
      });
      player.powerUps.freeze -= 1;
      room.notice = `${player.name} froze the other racers for ${room.settings.freezeDurationMs / 1000}s.`;
      pushSystemMessage(
        room,
        `${player.name} used Freeze and slowed the other racers for ${room.settings.freezeDurationMs / 1000}s.`
      );
      emitRoomState(room);
      callback({ ok: true });
      return;
    }

    player.powerUps[type] -= 1;
    if (type === "double") {
      player.effects.doubleArmed = true;
      room.notice = `${player.name} armed Double Points for this round.`;
      pushSystemMessage(room, `${player.name} armed Double Points.`);
    } else {
      player.effects.shieldArmed = true;
      room.notice = `${player.name} armed a Shield for the next drain.`;
      pushSystemMessage(room, `${player.name} armed a Shield for the next drain.`);
    }

    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on("sendChat", (payload, callback = () => {}) => {
    const roomId = socketToRoom.get(socket.id);
    const room = getRoom(roomId);
    const participant = room ? findParticipant(room, socket.id) : null;
    const text = sanitizeChatMessage(payload?.text);

    if (!room || !participant) {
      callback({ ok: false, error: "Join a room before sending chat messages." });
      return;
    }

    if (!text) {
      callback({ ok: false, error: "Type a message before sending." });
      return;
    }

    pushChatMessage(room, {
      type: "user",
      name: participant.name,
      avatarColor: participant.avatarColor,
      role: room.players.has(socket.id) ? "player" : "spectator",
      isHost: room.hostId === socket.id,
      text
    });
    emitRoomState(room);
    callback({ ok: true });
  });

  socket.on("leaveRoom", (_payload, callback = () => {}) => {
    removeSocketFromRoom(socket);
    callback({ ok: true });
  });

  socket.on("disconnect", () => {
    removeSocketFromRoom(socket, true);
  });
});

server.listen(PORT, () => {
  console.log(`Race server running at http://localhost:${PORT}`);
});
