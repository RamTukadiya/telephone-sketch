const socket = io();
const app = document.querySelector("#app");

let state = { room: null, me: null };
let form = { name: "", code: "" };
let notice = "";
let isResuming = false;
let routeOverride = "";
let lastRoutePath = "";
let isHistoryNavigation = false;
const SESSION_KEY = "zoneDropSession";
isResuming = Boolean(readSession()?.code && readSession()?.playerId);

const joinMatch = location.pathname.match(/^\/join\/([A-Za-z0-9]{4})$/);
let cameFromJoinLink = false;
if (joinMatch && !isResuming) {
  form.code = joinMatch[1].toUpperCase();
  cameFromJoinLink = true;
  history.replaceState({ phase: "home" }, "", "/");
}

let showIntro = !isResuming && !cameFromJoinLink;
let arenaCanvas = null;
let arenaCtx = null;
let wasAlive = true;

socket.on("state", (nextState) => {
  const wasPlaying = state.room?.phase === "playing";
  state = nextState;
  isResuming = false;
  notice = "";
  if (!isHistoryNavigation) routeOverride = "";
  syncBrowserRoute();

  const myPlayer = state.room?.players?.find((player) => player.id === state.me?.playerId);
  const nowAlive = myPlayer ? myPlayer.alive : true;
  const stillPlayingSameState = state.room?.phase === "playing" && wasPlaying && nowAlive === wasAlive;
  wasAlive = nowAlive;

  if (stillPlayingSameState) {
    drawArena();
  } else {
    render();
  }
});

socket.on("connect_error", () => {
  notice = "Connection trouble. Refresh and try again.";
  render();
});

socket.on("connect", () => {
  resumeSavedSession();
});

function emit(event, payload = {}) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (reply) => {
      if (!reply?.ok) notice = reply?.error || "Something went wrong.";
      resolve(reply);
    });
  });
}

function page(shell) {
  const isHomeView = !state.room || routeOverride === "home";
  const phaseClass = isHomeView ? "phase-home" : `phase-${state.room.phase}`;
  app.innerHTML = `
    <section class="screen ${phaseClass}">
      <div class="topbar">
        <div>
          <p class="eyebrow">Last one standing</p>
          <h1>Zone Drop</h1>
        </div>
        ${isHomeView ? "" : `<div class="topRight"><div class="roomBadge">Room <strong>${state.room.code}</strong></div><button class="ghost" data-action="leave" type="button">Leave room</button></div>`}
      </div>
      ${notice ? `<p class="notice">${notice}</p>` : ""}
      ${shell}
    </section>
  `;
  bindInputs();
  app.querySelector("[data-action='leave']")?.addEventListener("click", async () => {
    await emit("leaveRoom");
    clearSession();
    isResuming = false;
    state = { room: null, me: null };
    routeOverride = "home";
    form = { name: "", code: "" };
    history.pushState({ phase: "home" }, "", "/");
    lastRoutePath = "/";
    render();
  });
}

function render() {
  if (isResuming && !state.room) return renderLoading();
  if (showIntro && !state.room) return renderIntro();
  const phase = routeOverride || state.room?.phase;
  if (!state.room || phase === "home") return renderHome();
  if (phase === "lobby") return renderLobby();
  if (phase === "playing") return renderPlaying();
  if (phase === "gameOver") return renderGameOver();
}

function renderIntro() {
  app.innerHTML = `
    <section class="screen phase-home introScreen">
      <div class="topbar">
        <div>
          <p class="eyebrow">Last one standing</p>
          <h1>Zone Drop</h1>
        </div>
      </div>
      <div class="introCard">
        <p>1. Everyone drops into a shared arena. Tap or click to move your marker.</p>
        <p>2. The safe zone shrinks over time. Stay inside it or take damage.</p>
        <p>3. Last player standing wins.</p>
        <button class="primary" data-action="startPlaying" type="button">Let's play</button>
      </div>
    </section>
  `;
  app.querySelector("[data-action='startPlaying']").addEventListener("click", () => {
    showIntro = false;
    render();
  });
}

function renderLoading() {
  app.innerHTML = `
    <section class="screen phase-home">
      <div class="topbar">
        <div>
          <p class="eyebrow">Last one standing</p>
          <h1>Zone Drop</h1>
        </div>
      </div>
      <div class="reconnecting">
        <div class="spinner" aria-hidden="true"></div>
        <p class="notice">Reconnecting to your match...</p>
      </div>
    </section>
  `;
}

function renderHome() {
  page(`
    <section class="hero">
      <div>
        <h2>${cameFromJoinLink ? "Drop into the match." : "The zone is closing. Stay inside. Be the last one standing."}</h2>
        <p>${cameFromJoinLink ? "You scanned an invite. Type your name to join the room." : "Each player opens this site on their own phone or laptop. No login, no signup."}</p>
        ${cameFromJoinLink ? "" : `<p class="tip">Best with 2-8 friends, each on their own device.</p>`}
      </div>
      <form class="panel" id="homeForm">
        <label>Your name
          <input name="name" maxlength="18" value="${escapeHtml(form.name)}" placeholder="Mara" required />
        </label>
        ${cameFromJoinLink ? `
          <div class="joinRow">
            <label>Room code
              <input name="code" maxlength="4" value="${escapeHtml(form.code)}" placeholder="K7Q4" readonly />
            </label>
            <button class="primary" data-action="join" type="button">Join</button>
          </div>
        ` : `
          <div class="actions">
            <button class="primary" data-action="create" type="button">Create room</button>
          </div>
          <div class="joinRow">
            <label>Room code
              <input name="code" maxlength="4" value="${escapeHtml(form.code)}" placeholder="K7Q4" />
            </label>
            <button data-action="join" type="button">Join</button>
          </div>
        `}
      </form>
    </section>
  `);
  app.querySelector("[data-action='create']")?.addEventListener("click", async () => {
    saveHomeForm();
    if (!validateName()) return render();
    const playerId = getOrCreatePlayerId();
    const reply = await emit("createRoom", { name: form.name, playerId });
    if (reply?.ok) saveSession(reply.code, reply.playerId);
    render();
  });
  app.querySelector("[data-action='join']").addEventListener("click", async () => {
    saveHomeForm();
    if (!validateName()) return render();
    const playerId = getOrCreatePlayerId();
    const reply = await emit("joinRoom", { name: form.name, code: form.code, playerId });
    if (reply?.ok) saveSession(reply.code, reply.playerId);
    render();
  });
}

function renderLobby() {
  const { room, me } = state;
  page(`
    <section class="grid">
      <div class="panel">
        <p class="step">Lobby</p>
        <div class="codeCard">
          <span>Room code</span>
          <strong>${room.code}</strong>
        </div>
        ${me.isHost ? `<div id="qrCode" class="qrCode"></div>` : ""}
        <h2>Share the room code</h2>
        <p>Players join from their own devices by entering a name and this room code, or by scanning the QR code above. Start with 2 to 8 players.</p>
        <div class="players">${playerList(room.players)}</div>
        ${me.isHost ? `<button class="primary" data-action="start" ${room.players.length < room.minPlayers ? "disabled" : ""}>Start match</button>` : `<p class="waiting">Waiting for the host to start.</p>`}
      </div>
      <aside class="rules">
        <h3>How it works</h3>
        <p>You'll drop into a shared arena. Tap or click anywhere to move there. A safe zone shrinks over time — staying outside it costs you health. Last player alive wins.</p>
      </aside>
    </section>
  `);
  app.querySelector("[data-action='start']")?.addEventListener("click", () => emit("startGame"));
  if (me.isHost) renderQrCode(room.code);
}

function renderQrCode(code) {
  const container = document.getElementById("qrCode");
  if (!container || typeof QRCode === "undefined") return;
  container.innerHTML = "";
  const joinUrl = `${location.origin}/join/${code}`;
  new QRCode(container, {
    text: joinUrl,
    width: 132,
    height: 132,
    colorDark: "#000000",
    colorLight: "#ffffff"
  });
}

function renderPlaying() {
  const { room, me } = state;
  const myPlayer = room.players.find((player) => player.id === me.playerId);
  const alivePlayers = room.players.filter((player) => player.alive);

  page(`
    <section class="grid">
      <div class="panel arenaPanel">
        <p class="step">${alivePlayers.length} alive of ${room.players.length}</p>
        <div class="arenaWrap">
          <canvas id="arenaCanvas" width="${room.arenaSize}" height="${room.arenaSize}"></canvas>
        </div>
        ${myPlayer && !myPlayer.alive ? `<p class="waiting">You've been eliminated. Spectating the rest of the match.</p>` : `<p class="tip">Tap or click inside the arena to move.</p>`}
      </div>
      <aside class="rules">
        <h3>Players</h3>
        <div class="players">${room.players.map((player) => `
          <div class="player">
            <span>${escapeHtml(player.name)}${player.id === me.playerId ? " (you)" : ""}</span>
            <small class="${player.alive ? "alive" : "eliminated"}">${player.alive ? `${player.health}%` : "out"}</small>
          </div>
        `).join("")}</div>
      </aside>
    </section>
  `);

  arenaCanvas = document.getElementById("arenaCanvas");
  arenaCtx = arenaCanvas.getContext("2d");
  drawArena();

  if (myPlayer && myPlayer.alive) {
    const handleTap = (event) => {
      event.preventDefault();
      const rect = arenaCanvas.getBoundingClientRect();
      const scaleX = arenaCanvas.width / rect.width;
      const scaleY = arenaCanvas.height / rect.height;
      const point = event.touches ? event.touches[0] : event;
      const x = (point.clientX - rect.left) * scaleX;
      const y = (point.clientY - rect.top) * scaleY;
      emit("setTarget", { x, y });
    };
    arenaCanvas.addEventListener("mousedown", handleTap);
    arenaCanvas.addEventListener("touchstart", handleTap, { passive: false });
  }
}

function drawArena() {
  if (!arenaCanvas || !arenaCtx || !state.room) return;
  const { room, me } = state;
  const ctx = arenaCtx;
  const size = room.arenaSize;

  ctx.fillStyle = "#150a10";
  ctx.fillRect(0, 0, size, size);

  ctx.beginPath();
  ctx.arc(room.zone.cx, room.zone.cy, room.zone.radius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(111, 227, 160, 0.12)";
  ctx.fill();
  ctx.strokeStyle = "#6fe3a0";
  ctx.lineWidth = 3;
  ctx.stroke();

  room.players.forEach((player) => {
    if (!player.alive) return;
    ctx.beginPath();
    ctx.arc(player.x, player.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = player.id === me.playerId ? "#ffb454" : "#7aa8ff";
    ctx.fill();
    ctx.strokeStyle = "#05070d";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = "#f2f4fa";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(player.name, player.x, player.y - 16);
  });
}

function renderGameOver() {
  const { room, me } = state;
  page(`
    <section class="panel wide gameOverPanel">
      <p class="step">Match over</p>
      <h2>${room.winnerName ? `${escapeHtml(room.winnerName)} survives.` : "No survivors."}</h2>
      <div class="players">${room.players.map((player) => `
        <div class="player">
          <span>${escapeHtml(player.name)}</span>
          <small>${player.id === room.winnerId ? "winner" : "eliminated"}</small>
        </div>
      `).join("")}</div>
      ${me.isHost ? `<button class="primary" data-action="again">Play again</button>` : `<p class="waiting">The host can reset the room.</p>`}
    </section>
  `);
  app.querySelector("[data-action='again']")?.addEventListener("click", () => emit("playAgain"));
}

function playerList(players) {
  return players.map((player) => `
    <div class="player">
      <span>${escapeHtml(player.name)}</span>
      <small>${player.connected ? "online" : "away"}</small>
    </div>
  `).join("");
}

function bindInputs() {
  app.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => {
      if (input.name === "code") {
        input.value = input.value.toUpperCase();
      }
      form[input.name] = input.name === "code" ? input.value.toUpperCase() : input.value;
    });
  });
}

function saveHomeForm() {
  const data = new FormData(app.querySelector("#homeForm"));
  form.name = data.get("name");
  form.code = String(data.get("code") || "").toUpperCase();
}

function validateName() {
  if (String(form.name || "").trim()) return true;
  notice = "Type your name before creating or joining a room.";
  return false;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function syncBrowserRoute() {
  const route = currentRoute();
  if (!route || route.path === lastRoutePath) return;
  const method = lastRoutePath ? "pushState" : "replaceState";
  history[method](route.state, "", route.path);
  lastRoutePath = route.path;
}

async function resumeSavedSession() {
  const saved = readSession();
  if (!saved?.code || !saved?.playerId) {
    isResuming = false;
    render();
    return;
  }

  const reply = await emit("resumeSession", {
    code: saved.code,
    playerId: saved.playerId
  });

  if (!reply?.ok) {
    isResuming = false;
    clearSession();
  }
  render();
}

function getOrCreatePlayerId() {
  const saved = readSession();
  if (saved?.playerId) return saved.playerId;
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function saveSession(code, playerId) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code, playerId }));
}

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function currentRoute() {
  if (!state.room) {
    return { path: "/", state: { phase: "home" } };
  }
  const phase = state.room.phase;
  const path = `/room/${state.room.code}/${phase}`;
  return { path, state: { phase, code: state.room.code } };
}

window.addEventListener("popstate", (event) => {
  isHistoryNavigation = true;
  routeOverride = event.state?.phase || "home";
  lastRoutePath = location.pathname;
  render();
  setTimeout(() => {
    isHistoryNavigation = false;
  }, 0);
});

render();
