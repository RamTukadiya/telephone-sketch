const socket = io();
const app = document.querySelector("#app");

let state = { room: null, me: null };
let form = { name: "", code: "" };
let notice = "";
let isResuming = false;
let routeOverride = "";
let lastRoutePath = "";
let isHistoryNavigation = false;
const SESSION_KEY = "telephoneSketchSession";
isResuming = Boolean(readSession()?.code && readSession()?.playerId);

const joinMatch = location.pathname.match(/^\/join\/([A-Za-z0-9]{4})$/);
let cameFromJoinLink = false;
if (joinMatch && !isResuming) {
  form.code = joinMatch[1].toUpperCase();
  cameFromJoinLink = true;
  history.replaceState({ phase: "home" }, "", "/");
}

let showIntro = !isResuming && !cameFromJoinLink;
let revealIndex = 0;
let canvasCtx = null;
let drawing = false;
let lastPoint = null;

socket.on("state", (nextState) => {
  state = nextState;
  isResuming = false;
  notice = "";
  if (!isHistoryNavigation) routeOverride = "";
  revealIndex = 0;
  syncBrowserRoute();
  render();
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
      render();
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
          <p class="eyebrow">Drawing relay party game</p>
          <h1>Telephone Sketch</h1>
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
  if (phase === "relay") return renderRelay();
  if (phase === "reveal") return renderReveal();
}

function renderIntro() {
  app.innerHTML = `
    <section class="screen phase-home introScreen">
      <div class="topbar">
        <div>
          <p class="eyebrow">Drawing relay party game</p>
          <h1>Telephone Sketch</h1>
        </div>
      </div>
      <div class="introCard">
        <p>1. Everyone writes a secret starting phrase.</p>
        <p>2. Phrases and drawings pass around the group. Draw what you're shown, or guess what a drawing means.</p>
        <p>3. At the end, watch every chain unfold — from the first phrase to its final, warped result.</p>
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
          <p class="eyebrow">Drawing relay party game</p>
          <h1>Telephone Sketch</h1>
        </div>
      </div>
      <div class="reconnecting">
        <div class="spinner" aria-hidden="true"></div>
        <p class="notice">Reconnecting to your game...</p>
      </div>
    </section>
  `;
}

function renderHome() {
  page(`
    <section class="hero">
      <div>
        <h2>${cameFromJoinLink ? "Join the relay." : "Write it. Draw it. Watch it warp."}</h2>
        <p>${cameFromJoinLink ? "You scanned an invite. Type your name to join the room." : "Each player opens this site on their own phone or laptop. No login, no signup."}</p>
        ${cameFromJoinLink ? "" : `<p class="tip">Best with 4-8 friends on a call together, or in the same room.</p>`}
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
  });
  app.querySelector("[data-action='join']").addEventListener("click", async () => {
    saveHomeForm();
    if (!validateName()) return render();
    const playerId = getOrCreatePlayerId();
    const reply = await emit("joinRoom", { name: form.name, code: form.code, playerId });
    if (reply?.ok) saveSession(reply.code, reply.playerId);
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
        <p>Players join from their own devices by entering a name and this room code, or by scanning the QR code above. Start with 3 to 8 players.</p>
        <div class="players">${playerList(room.players)}</div>
        ${me.isHost ? `<button class="primary" data-action="start" ${room.players.length < room.minPlayers ? "disabled" : ""}>Start game</button>` : `<p class="waiting">Waiting for the host to start.</p>`}
      </div>
      <aside class="rules">
        <h3>How it works</h3>
        <p>Everyone writes a secret phrase. Each round, you'll get someone else's last entry and either draw what it means or guess a drawing's meaning in words. At the end, watch each phrase's full transformation.</p>
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

function renderRelay() {
  const { room, me } = state;
  const task = me.task;

  if (!task || task.hasSubmitted) {
    page(`
      <section class="panel wide">
        <p class="step">Round ${room.round + 1} of ${room.totalRounds + 1}</p>
        <h2>Waiting on the rest of the table.</h2>
        <p>${room.submittedCount} of ${room.playerCount} players have submitted this round.</p>
      </section>
    `);
    return;
  }

  if (task.type === "phrase") {
    page(`
      <section class="grid">
        <div class="panel">
          <p class="step">Round ${room.round + 1} of ${room.totalRounds + 1}</p>
          ${task.previousEntry ? `
            <h2>What is this drawing?</h2>
            <div class="sketchPreview"><img src="${task.previousEntry.content}" alt="Previous drawing" /></div>
          ` : `
            <h2>Write a phrase for someone else to draw.</h2>
          `}
          <form id="phraseForm">
            <label>${task.previousEntry ? "Your guess" : "Your phrase"}
              <input name="phrase" maxlength="80" placeholder="${task.previousEntry ? "A cat riding a skateboard" : "A dog wearing sunglasses"}" required />
            </label>
            <button class="primary">Submit</button>
          </form>
        </div>
        <aside class="rules">
          <h3>Status</h3>
          <p>${room.submittedCount} of ${room.playerCount} players have submitted this round.</p>
        </aside>
      </section>
    `);
    app.querySelector("#phraseForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = new FormData(event.currentTarget).get("phrase");
      await emit("submitEntry", { content: text });
    });
    return;
  }

  page(`
    <section class="grid">
      <div class="panel">
        <p class="step">Round ${room.round + 1} of ${room.totalRounds + 1}</p>
        <h2>Draw this phrase:</h2>
        <p class="phraseToDraw">"${escapeHtml(task.previousEntry.content)}"</p>
        <div class="canvasWrap">
          <canvas id="sketchCanvas" width="320" height="220"></canvas>
        </div>
        <div class="canvasActions">
          <button class="ghost" data-action="clear" type="button">Clear</button>
          <button class="primary" data-action="submitDrawing" type="button">Submit drawing</button>
        </div>
      </div>
      <aside class="rules">
        <h3>Status</h3>
        <p>${room.submittedCount} of ${room.playerCount} players have submitted this round.</p>
      </aside>
    </section>
  `);
  setupCanvas();
  app.querySelector("[data-action='clear']").addEventListener("click", clearCanvas);
  app.querySelector("[data-action='submitDrawing']").addEventListener("click", async () => {
    const canvas = document.getElementById("sketchCanvas");
    const dataUrl = canvas.toDataURL("image/png");
    await emit("submitEntry", { content: dataUrl });
  });
}

function setupCanvas() {
  const canvas = document.getElementById("sketchCanvas");
  if (!canvas) return;
  canvasCtx = canvas.getContext("2d");
  canvasCtx.fillStyle = "#ffffff";
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
  canvasCtx.strokeStyle = "#0b0d14";
  canvasCtx.lineWidth = 3;
  canvasCtx.lineCap = "round";
  canvasCtx.lineJoin = "round";

  const getPos = (event) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const point = event.touches ? event.touches[0] : event;
    return {
      x: (point.clientX - rect.left) * scaleX,
      y: (point.clientY - rect.top) * scaleY
    };
  };

  const start = (event) => {
    event.preventDefault();
    drawing = true;
    lastPoint = getPos(event);
  };
  const move = (event) => {
    if (!drawing) return;
    event.preventDefault();
    const point = getPos(event);
    canvasCtx.beginPath();
    canvasCtx.moveTo(lastPoint.x, lastPoint.y);
    canvasCtx.lineTo(point.x, point.y);
    canvasCtx.stroke();
    lastPoint = point;
  };
  const end = () => {
    drawing = false;
    lastPoint = null;
  };

  canvas.addEventListener("mousedown", start);
  canvas.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);
  canvas.addEventListener("touchstart", start, { passive: false });
  canvas.addEventListener("touchmove", move, { passive: false });
  canvas.addEventListener("touchend", end);
}

function clearCanvas() {
  const canvas = document.getElementById("sketchCanvas");
  if (!canvas || !canvasCtx) return;
  canvasCtx.fillStyle = "#ffffff";
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
}

function renderReveal() {
  const { room, me } = state;
  const books = room.books;
  const book = books[revealIndex];

  page(`
    <section class="panel wide">
      <p class="step">Chain ${revealIndex + 1} of ${books.length}</p>
      <h2>Started by ${escapeHtml(book.authorName)}</h2>
      <div class="chainStack">${book.entries.map((entry, index) => `
        <article class="chainEntry" style="--i: ${index}">
          <span class="chainAuthor">${escapeHtml(entry.playerName)}</span>
          ${entry.type === "phrase" ? `<p class="chainPhrase">"${escapeHtml(entry.content)}"</p>` : `<img class="chainDrawing" src="${entry.content}" alt="Drawing by ${escapeHtml(entry.playerName)}" />`}
        </article>
      `).join("")}</div>
      <div class="revealNav">
        <button class="ghost" data-action="prevChain" ${revealIndex === 0 ? "disabled" : ""} type="button">Previous chain</button>
        <button class="ghost" data-action="nextChain" ${revealIndex >= books.length - 1 ? "disabled" : ""} type="button">Next chain</button>
      </div>
      ${me.isHost ? `<button class="primary" data-action="again">Play again</button>` : `<p class="waiting">The host can reset the room.</p>`}
    </section>
  `);
  app.querySelector("[data-action='prevChain']")?.addEventListener("click", () => {
    if (revealIndex > 0) {
      revealIndex -= 1;
      render();
    }
  });
  app.querySelector("[data-action='nextChain']")?.addEventListener("click", () => {
    if (revealIndex < books.length - 1) {
      revealIndex += 1;
      render();
    }
  });
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
    render();
  }
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
