const MIN_PLAYERS = 3;
const MAX_PLAYERS = 8;

export function createRoom(code, hostId, hostName) {
  return {
    code,
    hostId,
    phase: "lobby",
    playerOrder: [],
    players: new Map([[hostId, createPlayer(hostId, hostName)]]),
    books: [],
    currentRound: 0,
    totalRounds: 0,
    submissions: new Set()
  };
}

export function createPlayer(id, name) {
  return {
    id,
    name: cleanName(name),
    connected: true
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
  if (room.phase !== "lobby") throw new Error("This room has already started.");
  if (room.players.size < MIN_PLAYERS) throw new Error(`You need at least ${MIN_PLAYERS} players.`);

  room.playerOrder = [...room.players.keys()];
  const n = room.playerOrder.length;
  room.books = room.playerOrder.map((authorId) => ({ authorId, entries: [] }));
  room.currentRound = 0;
  room.totalRounds = n - 1;
  room.submissions.clear();
  room.phase = "relay";
}

function bookIndexFor(room, playerId) {
  const n = room.playerOrder.length;
  const playerIndex = room.playerOrder.indexOf(playerId);
  if (playerIndex === -1) throw new Error("You are not in this game.");
  return (((playerIndex - room.currentRound) % n) + n) % n;
}

function nextEntryType(book) {
  if (book.entries.length === 0) return "phrase";
  const last = book.entries.at(-1);
  return last.type === "phrase" ? "drawing" : "phrase";
}

export function currentTask(room, playerId) {
  if (room.phase !== "relay") return null;
  const bookIndex = bookIndexFor(room, playerId);
  const book = room.books[bookIndex];
  const type = nextEntryType(book);
  const previousEntry = book.entries.at(-1) || null;
  return {
    bookIndex,
    type,
    previousEntry: previousEntry ? { type: previousEntry.type, content: previousEntry.content } : null,
    hasSubmitted: room.submissions.has(playerId)
  };
}

export function submitEntry(room, playerId, content) {
  if (room.phase !== "relay") throw new Error("The relay is not open right now.");
  if (room.submissions.has(playerId)) throw new Error("You already submitted this round.");

  const bookIndex = bookIndexFor(room, playerId);
  const book = room.books[bookIndex];
  const type = nextEntryType(book);

  if (type === "phrase") {
    const text = String(content || "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (text.length < 2) throw new Error("Write a slightly longer phrase.");
    book.entries.push({ type: "phrase", playerId, content: text });
  } else {
    const dataUrl = String(content || "");
    if (!dataUrl.startsWith("data:image/")) throw new Error("Draw something before submitting.");
    if (dataUrl.length > 400000) throw new Error("Drawing is too large. Try a simpler sketch.");
    book.entries.push({ type: "drawing", playerId, content: dataUrl });
  }

  room.submissions.add(playerId);

  if (room.submissions.size === room.players.size) {
    room.submissions.clear();
    room.currentRound += 1;
    if (room.currentRound > room.totalRounds) {
      room.phase = "reveal";
    }
  }
}

export function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    round: room.currentRound,
    totalRounds: room.totalRounds,
    submittedCount: room.submissions.size,
    playerCount: room.players.size,
    players: [...room.players.values()].map(({ id, name, connected }) => ({ id, name, connected })),
    books:
      room.phase === "reveal"
        ? room.books.map((book) => ({
            authorId: book.authorId,
            authorName: room.players.get(book.authorId)?.name || "Unknown",
            entries: book.entries.map((entry) => ({
              type: entry.type,
              content: entry.content,
              playerName: room.players.get(entry.playerId)?.name || "Unknown"
            }))
          }))
        : []
  };
}

export function privateState(room, playerId) {
  return {
    playerId,
    isHost: room.hostId === playerId,
    task: currentTask(room, playerId)
  };
}

export function resetRoom(room) {
  room.phase = "lobby";
  room.playerOrder = [];
  room.books = [];
  room.currentRound = 0;
  room.totalRounds = 0;
  room.submissions.clear();
}
