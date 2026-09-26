const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;

export const ARENA_SIZE = 600;
const INITIAL_RADIUS = 280;
const MIN_RADIUS = 40;
const SHRINK_PER_TICK = 0.36;
const PLAYER_SPEED_PER_TICK = 18;
const DAMAGE_PER_TICK = 2;
const SUDDEN_DEATH_DAMAGE_PER_TICK = 3;
const START_HEALTH = 100;

export function createRoom(code, hostId, hostName) {
  return {
    code,
    hostId,
    phase: "lobby",
    players: new Map([[hostId, createPlayer(hostId, hostName)]]),
    zone: { cx: ARENA_SIZE / 2, cy: ARENA_SIZE / 2, radius: INITIAL_RADIUS },
    winnerId: ""
  };
}

export function createPlayer(id, name) {
  return {
    id,
    name: cleanName(name),
    connected: true,
    x: ARENA_SIZE / 2,
    y: ARENA_SIZE / 2,
    targetX: ARENA_SIZE / 2,
    targetY: ARENA_SIZE / 2,
    health: START_HEALTH,
    alive: true
  };
}

export function cleanName(name) {
  const cleaned = String(name || "").trim().replace(/\s+/g, " ");
  return cleaned.slice(0, 18);
}

export function canJoin(room) {
  return room.phase === "lobby" && room.players.size < MAX_PLAYERS;
}

export function startGame(room) {
  if (room.phase !== "lobby") throw new Error("This game has already started.");
  if (room.players.size < MIN_PLAYERS) throw new Error(`You need at least ${MIN_PLAYERS} players.`);

  room.zone = { cx: ARENA_SIZE / 2, cy: ARENA_SIZE / 2, radius: INITIAL_RADIUS };
  room.winnerId = "";
  const n = room.players.size;
  let i = 0;
  for (const player of room.players.values()) {
    const angle = (i / n) * Math.PI * 2;
    const spawnRadius = 180;
    player.x = ARENA_SIZE / 2 + Math.cos(angle) * spawnRadius;
    player.y = ARENA_SIZE / 2 + Math.sin(angle) * spawnRadius;
    player.targetX = player.x;
    player.targetY = player.y;
    player.health = START_HEALTH;
    player.alive = true;
    i += 1;
  }
  room.phase = "playing";
}

export function setTarget(room, playerId, x, y) {
  if (room.phase !== "playing") throw new Error("The match has not started.");
  const player = room.players.get(playerId);
  if (!player) throw new Error("You are not in this room.");
  if (!player.alive) throw new Error("You have been eliminated.");
  player.targetX = clamp(Number(x) || 0, 0, ARENA_SIZE);
  player.targetY = clamp(Number(y) || 0, 0, ARENA_SIZE);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function tick(room) {
  if (room.phase !== "playing") return false;

  room.zone.radius = Math.max(MIN_RADIUS, room.zone.radius - SHRINK_PER_TICK);

  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const dx = player.targetX - player.x;
    const dy = player.targetY - player.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.5) {
      const step = Math.min(PLAYER_SPEED_PER_TICK, dist);
      player.x += (dx / dist) * step;
      player.y += (dy / dist) * step;
    }
  }

  const zoneClosed = room.zone.radius <= MIN_RADIUS + 0.01;

  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const distFromCenter = Math.hypot(player.x - room.zone.cx, player.y - room.zone.cy);
    let damage = 0;
    if (distFromCenter > room.zone.radius) damage += DAMAGE_PER_TICK;
    if (zoneClosed) damage += SUDDEN_DEATH_DAMAGE_PER_TICK;
    if (damage > 0) {
      player.health = Math.max(0, player.health - damage);
      if (player.health === 0) player.alive = false;
    }
  }

  return checkWinCondition(room);
}

export function checkWinCondition(room) {
  if (room.phase !== "playing") return false;
  const alivePlayers = [...room.players.values()].filter((player) => player.alive);
  if (alivePlayers.length <= 1) {
    room.phase = "gameOver";
    room.winnerId = alivePlayers[0]?.id || "";
    return true;
  }
  return false;
}

export function eliminatePlayer(room, playerId) {
  const player = room.players.get(playerId);
  if (player) {
    player.alive = false;
    player.connected = false;
  }
}

export function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    arenaSize: ARENA_SIZE,
    zone: room.zone,
    winnerId: room.winnerId,
    winnerName: room.winnerId ? room.players.get(room.winnerId)?.name || "" : "",
    players: [...room.players.values()].map(({ id, name, connected, x, y, health, alive }) => ({
      id,
      name,
      connected,
      x,
      y,
      health,
      alive
    }))
  };
}

export function privateState(room, playerId) {
  return {
    playerId,
    isHost: room.hostId === playerId
  };
}

export function resetRoom(room) {
  room.phase = "lobby";
  room.winnerId = "";
  room.zone = { cx: ARENA_SIZE / 2, cy: ARENA_SIZE / 2, radius: INITIAL_RADIUS };
  for (const player of room.players.values()) {
    player.health = START_HEALTH;
    player.alive = true;
    player.x = ARENA_SIZE / 2;
    player.y = ARENA_SIZE / 2;
    player.targetX = ARENA_SIZE / 2;
    player.targetY = ARENA_SIZE / 2;
  }
}
