import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import {
  canJoin,
  checkWinCondition,
  cleanName,
  createPlayer,
  createRoom,
  eliminatePlayer,
  privateState,
  publicRoom,
  resetRoom,
  setTarget,
  startGame,
  tick
} from "./game.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const rooms = new Map();
const intervals = new Map();

const TICK_MS = 120;

app.use(express.static(path.join(__dirname, "..", "public")));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name, playerId }, reply) => {
    try {
      if (!playerId) throw new Error("Missing player id.");
      if (!cleanName(name)) throw new Error("Type your name before creating a room.");
      const code = makeRoomCode();
      const room = createRoom(code, playerId, name);
      rooms.set(code, room);
      joinSocketToRoom(socket, code, playerId);
      reply?.({ ok: true, code, playerId });
      broadcast(room);
    } catch (error) {
      reply?.({ ok: false, error: error.message });
    }
  });

  socket.on("joinRoom", ({ code, name, playerId }, reply) => {
    try {
      if (!playerId) throw new Error("Missing player id.");
      const normalizedCode = String(code || "").trim().toUpperCase();
      if (!cleanName(name)) throw new Error("Type your name before joining a room.");
      const room = rooms.get(normalizedCode);
      if (!room) throw new Error("That room code was not found.");

      if (!room.players.has(playerId) && !canJoin(room)) {
        throw new Error("That room is already playing or full.");
      }

      if (!room.players.has(playerId)) {
        room.players.set(playerId, createPlayer(playerId, cleanName(name)));
      } else {
        room.players.get(playerId).connected = true;
      }

      joinSocketToRoom(socket, normalizedCode, playerId);
      reply?.({ ok: true, code: normalizedCode, playerId });
      broadcast(room);
    } catch (error) {
      reply?.({ ok: false, error: error.message });
    }
  });

  socket.on("resumeSession", ({ code, playerId }, reply) => {
    try {
      const normalizedCode = String(code || "").trim().toUpperCase();
      const room = rooms.get(normalizedCode);
      if (!room) throw new Error("Room not found.");
      if (!room.players.has(playerId)) throw new Error("Player not found in room.");

      room.players.get(playerId).connected = true;
      joinSocketToRoom(socket, normalizedCode, playerId);
      reply?.({ ok: true, code: normalizedCode, playerId });
      broadcast(room);
    } catch (error) {
      reply?.({ ok: false, error: error.message });
    }
  });

  socket.on("startGame", replyFor(socket, (room, playerId) => {
    if (room.hostId !== playerId) throw new Error("Only the host can start the match.");
    startGame(room);
    startTickLoop(room);
  }));

  socket.on("setTarget", ({ x, y }, reply) => {
    try {
      const room = getSocketRoom(socket);
      if (!room) throw new Error("Join or create a room first.");
      setTarget(room, socket.data.playerId, x, y);
      reply?.({ ok: true });
    } catch (error) {
      reply?.({ ok: false, error: error.message });
    }
  });

  socket.on("playAgain", replyFor(socket, (room, playerId) => {
    if (room.hostId !== playerId) throw new Error("Only the host can reset the room.");
    stopTickLoop(room.code);
    resetRoom(room);
  }));

  socket.on("leaveRoom", (_payload, reply) => {
    try {
      const room = getSocketRoom(socket);
      if (room) {
        const playerId = socket.data.playerId;
        if (room.phase === "playing") {
          eliminatePlayer(room, playerId);
          const ended = checkWinCondition(room);
          if (ended) stopTickLoop(room.code);
        } else {
          room.players.delete(playerId);
          if (room.hostId === playerId && room.players.size > 0) {
            room.hostId = [...room.players.keys()][0];
          }
        }
        socket.leave(room.code);
        socket.leave(playerId);
        if (room.players.size === 0) {
          stopTickLoop(room.code);
          rooms.delete(room.code);
        } else {
          broadcast(room);
        }
      }
      socket.data.roomCode = "";
      socket.data.playerId = "";
      reply?.({ ok: true });
    } catch (error) {
      reply?.({ ok: false, error: error.message });
    }
  });

  socket.on("disconnect", () => {
    const room = getSocketRoom(socket);
    if (!room) return;
    const playerId = socket.data.playerId;
    const player = room.players.get(playerId);
    if (player) player.connected = false;
    broadcast(room);
  });
});

function startTickLoop(room) {
  stopTickLoop(room.code);
  const handle = setInterval(() => {
    const ended = tick(room);
    broadcast(room);
    if (ended) stopTickLoop(room.code);
  }, TICK_MS);
  intervals.set(room.code, handle);
}

function stopTickLoop(code) {
  const handle = intervals.get(code);
  if (handle) {
    clearInterval(handle);
    intervals.delete(code);
  }
}

function joinSocketToRoom(socket, code, playerId) {
  socket.join(code);
  socket.join(playerId);
  socket.data.roomCode = code;
  socket.data.playerId = playerId;
}

function replyFor(socket, action) {
  return (_payload, reply) => runWithRoom(socket, reply, action);
}

function runWithRoom(socket, reply, action) {
  try {
    const room = getSocketRoom(socket);
    if (!room) throw new Error("Join or create a room first.");
    action(room, socket.data.playerId);
    reply?.({ ok: true });
    broadcast(room);
  } catch (error) {
    reply?.({ ok: false, error: error.message });
  }
}

function getSocketRoom(socket) {
  return rooms.get(socket.data.roomCode);
}

function broadcast(room) {
  for (const playerId of room.players.keys()) {
    io.to(playerId).emit("state", {
      room: publicRoom(room),
      me: privateState(room, playerId)
    });
  }
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Zone Drop is running on http://localhost:${port}`);
});
