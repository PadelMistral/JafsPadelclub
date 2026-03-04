/* Home V2 — Clean & Real Player Names */
import { db, subscribeCol, getDocument } from "./firebase-service.js";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI } from "./ui-core.js";
import { injectHeader, injectNavbar } from "./modules/ui-loader.js";
import { renderMatchDetail } from "./match-service.js";
import {
  isCancelledMatch,
  isFinishedMatch,
  toDateSafe,
} from "./utils/match-utils.js";
import { getDetailedWeather } from "./external-data.js";
import { analyticsTiming } from "./core/analytics.js";
import {
  requestNotificationPermission,
  showNotificationHelpModal,
  getPushStatusHuman,
} from "./modules/push-notifications.js";
import {
  getCompetitiveState,
  getCoreAIContext,
  observeCoreSession,
  queryCoreAI,
  startCorePresence,
} from "./core/core-engine.js";

let currentUser = null;
let currentUserData = null;
let unsubAm = null;
let unsubRe = null;
let allMatches = [];
let weather = null;
let presenceTimer = null;
let loadedCollections = new Set();
let tabsBound = false;
let matchLoadFallbackFired = false;
const colSignature = new Map();
const homeBootStart = performance.now();
let homeLoadMeasured = false;

/* ── Player Cache (names + photos) ── */
const playerNameCache = new Map();
const playerPhotoCache = new Map();

async function resolvePlayerName(uid) {
  if (!uid) return null;
  if (String(uid).startsWith("GUEST_"))
    return String(uid).split("_")[1] || "Invitado";
  if (playerNameCache.has(uid)) return playerNameCache.get(uid);
  try {
    const doc = await getDocument("usuarios", uid);
    const name = doc?.nombreUsuario || doc?.nombre || "Jugador";
    const photo = doc?.fotoPerfil || doc?.fotoURL || doc?.photoURL || "";
    playerNameCache.set(uid, name);
    if (photo) playerPhotoCache.set(uid, photo);
    return name;
  } catch {
    return "Jugador";
  }
}

async function preloadPlayerNames(matches) {
  const uids = new Set();
  matches.forEach((m) =>
    (m.jugadores || []).forEach((uid) => {
      if (uid && !String(uid).startsWith("GUEST_") && !playerNameCache.has(uid))
        uids.add(uid);
    }),
  );
  const promises = [...uids].map((uid) => resolvePlayerName(uid));
  await Promise.allSettled(promises);
}

function getPlayerDisplayName(uid) {
  if (!uid) return "LIBRE";
  if (String(uid).startsWith("GUEST_"))
    return String(uid).split("_")[1] || "INV";
  if (uid === currentUser?.uid)
    return currentUserData?.nombreUsuario || currentUserData?.nombre || "TÚ";
  return playerNameCache.get(uid) || "Jugador";
}

/* ── Init ── */
document.addEventListener("DOMContentLoaded", () => {
  initAppUI("home");
  observeCoreSession({
    onSignedOut: () => {
      cleanup();
      window.location.replace("index.html");
    },
    onReady: async ({ user, userDoc }) => {
      cleanup();
      currentUser = user;
      currentUserData = userDoc || {};
      await injectHeader(currentUserData);
      injectNavbar("home");
      renderWelcome();
      bindTabs();
      bindAI();
      initWeather();
      startPresence();
      refreshAICoachTip();
      bindNotificationNudge();

      unsubAm =
        (await subscribeCol(
          "partidosAmistosos",
          (list) => mergeMatches("partidosAmistosos", list),
          [],
          [["fecha", "asc"]],
          250,
        )) || null;
      unsubRe =
        (await subscribeCol(
          "partidosReto",
          (list) => mergeMatches("partidosReto", list),
          [],
          [["fecha", "asc"]],
          250,
        )) || null;

      // Fallback: if one collection doesn't load after 3s, render anyway
      setTimeout(() => {
        if (!matchLoadFallbackFired && loadedCollections.size >= 1) {
          matchLoadFallbackFired = true;
          renderNextMatch();
          const activeTab =
            document.querySelector(".hv2-tab.active")?.dataset.filter || "open";
          renderMatchesByFilter(activeTab);
        }
      }, 3000);

      window.getAICoachContext = () =>
        getCoreAIContext({ uid: currentUser.uid });
    },
  });
});

function cleanup() {
  [unsubAm, unsubRe].forEach((fn) => {
    if (typeof fn === "function")
      try {
        fn();
      } catch {}
  });
  unsubAm = null;
  unsubRe = null;
  allMatches = [];
  loadedCollections = new Set();
  colSignature.clear();
  tabsBound = false;
  if (typeof presenceTimer === "function")
    try {
      presenceTimer();
    } catch {}
  else if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = null;
}

function startPresence() {
  if (!currentUser?.uid) return;
  presenceTimer = startCorePresence(currentUser.uid, 2 * 60 * 1000);
}

/* ── Welcome ── */
function renderWelcome() {
  const d = currentUserData;
  const name = d?.nombreUsuario || d?.nombre || "Jugador";
  const snapshot = getCompetitiveState(d).snapshot;
  const pts = snapshot.rating;
  const lvl = Number(d?.nivel || 2.5).toFixed(2);
  const streak = snapshot.streak;
  const played = snapshot.played;

  const el = (id) => document.getElementById(id);
  if (el("user-name")) el("user-name").textContent = name.toUpperCase();
  if (el("welcome-points")) el("welcome-points").textContent = String(pts);
  if (el("welcome-level")) el("welcome-level").textContent = lvl;
  if (el("stat-streak"))
    el("stat-streak").textContent = (streak > 0 ? "+" : "") + streak;
  if (el("welcome-pending")) el("welcome-pending").textContent = String(played);

  const hour = new Date().getHours();
  if (el("greeting-text")) {
    el("greeting-text").textContent =
      hour >= 5 && hour < 12
        ? "BUENOS DÍAS"
        : hour >= 12 && hour < 20
          ? "BUENAS TARDES"
          : "BUENAS NOCHES";
  }

  const avatarEl = el("welcome-avatar");
  if (avatarEl) {
    const photo = d?.fotoPerfil || d?.fotoURL || d?.photoURL || "";
    avatarEl.src = photo || "./imagenes/Logojafs.png";
    avatarEl.alt = name;
  }
  const fallback = el("welcome-avatar-fallback");
  if (fallback) {
    const initials = name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    fallback.textContent = initials || "?";
  }

  // Division chip based on ELO
  const divChip = el("user-division-chip");
  if (divChip) {
    let divName = "BRONCE",
      divColor = "#cd7f32",
      divBg = "rgba(205,127,50,0.1)",
      divBorder = "rgba(205,127,50,0.25)";
    if (pts >= 1400) {
      divName = "ELITE";
      divColor = "#a855f7";
      divBg = "rgba(168,85,247,0.1)";
      divBorder = "rgba(168,85,247,0.3)";
    } else if (pts >= 1200) {
      divName = "DIAMANTE";
      divColor = "#00d4ff";
      divBg = "rgba(0,212,255,0.1)";
      divBorder = "rgba(0,212,255,0.25)";
    } else if (pts >= 1050) {
      divName = "ORO";
      divColor = "#facc15";
      divBg = "rgba(250,204,21,0.1)";
      divBorder = "rgba(250,204,21,0.25)";
    } else if (pts >= 950) {
      divName = "PLATA";
      divColor = "#94a3b8";
      divBg = "rgba(148,163,184,0.1)";
      divBorder = "rgba(148,163,184,0.25)";
    }
    divChip.innerHTML = `<i class="fas fa-shield-halved"></i> ${divName}`;
    divChip.style.color = divColor;
    divChip.style.background = divBg;
    divChip.style.borderColor = divBorder;
  }

  refreshWelcomeRank();
  startClock();
}

function startClock() {
  function tick() {
    const now = new Date();
    const timeEl = document.getElementById("welcome-live-time");
    const dateEl = document.getElementById("hv2-date-text");
    if (timeEl)
      timeEl.textContent = now.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    if (dateEl) {
      dateEl.textContent = now
        .toLocaleDateString("es-ES", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })
        .toUpperCase();
    }
  }
  tick();
  setInterval(tick, 1000);
}

async function refreshWelcomeRank() {
  const rankEl = document.getElementById("user-rank");
  const totalEl = document.getElementById("user-rank-total");
  if (!currentUser?.uid || (!rankEl && !totalEl)) return;
  try {
    const q = query(
      collection(db, "usuarios"),
      orderBy("puntosRanking", "desc"),
      limit(500),
    );
    const snap = await getDocs(q);
    let pos = 0;
    snap.docs.forEach((d, i) => {
      if (d.id === currentUser.uid) pos = i + 1;
    });
    if (rankEl) rankEl.textContent = pos ? `#${pos}` : "#--";
    if (totalEl) totalEl.textContent = `de ${snap.size}`;
  } catch {}
}

/* ── Weather ── */
async function initWeather() {
  try {
    weather = await getDetailedWeather();
    const tempEl = document.getElementById("hv2-temp");
    const descEl = document.getElementById("hv2-weather-desc");
    const iconEl = document.getElementById("hv2-weather-icon");
    if (tempEl && weather?.current) {
      tempEl.textContent = `${Math.round(weather.current.temperature_2m || 0)}°`;
    }
    if (weather?.current) {
      const code = weather.current.weather_code || 0;
      let desc = "Variable",
        icon = "fa-cloud",
        color = "#94a3b8";
      if (code <= 1) {
        desc = "Despejado";
        icon = "fa-sun";
        color = "#fbbf24";
      } else if (code <= 3) {
        desc = "Parcial";
        icon = "fa-cloud-sun";
        color = "#fb923c";
      } else if (code <= 48) {
        desc = "Nublado";
        icon = "fa-cloud";
        color = "#94a3b8";
      } else if (code <= 57) {
        desc = "Llovizna";
        icon = "fa-cloud-rain";
        color = "#60a5fa";
      } else if (code <= 67) {
        desc = "Lluvia";
        icon = "fa-cloud-showers-heavy";
        color = "#3b82f6";
      } else if (code <= 77) {
        desc = "Nieve";
        icon = "fa-snowflake";
        color = "#e2e8f0";
      } else if (code <= 82) {
        desc = "Aguacero";
        icon = "fa-cloud-showers-water";
        color = "#2563eb";
      } else if (code <= 99) {
        desc = "Tormenta";
        icon = "fa-bolt";
        color = "#a78bfa";
      }
      if (descEl) descEl.textContent = desc;
      if (iconEl) {
        iconEl.className = `fas ${icon}`;
        iconEl.style.color = color;
        iconEl.style.filter = `drop-shadow(0 0 8px ${color}50)`;
      }
    }
  } catch {
    weather = null;
  }
}

/* ── AI Coach Tip ── */
const aiTips = [
  "Analiza tu próximo rival con el asistente IA",
  "¿Quieres saber tu mejor socio de dobles?",
  "Pregunta por tu racha y cómo mejorarla",
  "Descubre qué partidos abiertos te convienen",
  "Consulta tu progresión de nivel",
  "¿Lluvia hoy? Pregunta por pistas cubiertas",
];
function refreshAICoachTip() {
  const tipEl = document.getElementById("ai-tip-text");
  if (!tipEl) return;
  const idx = Math.floor(Math.random() * aiTips.length);
  tipEl.textContent = aiTips[idx];
}

/* ── Notifications ── */
function bindNotificationNudge() {
  // Legacy — replaced by AI Coach tip
  refreshAICoachTip();
}

/* ── Match Data ── */
async function mergeMatches(col, list) {
  const sig = JSON.stringify(list.map((m) => m.id + m.estado));
  if (colSignature.get(col) === sig) return;
  colSignature.set(col, sig);

  allMatches = [
    ...allMatches.filter((m) => m.col !== col),
    ...list.map((m) => ({ ...m, col })),
  ].sort((a, b) => {
    const da = toDateSafe(a.fecha);
    const db = toDateSafe(b.fecha);
    return (da?.getTime() || 0) - (db?.getTime() || 0);
  });

  // Clean past open matches from the state to keep UI snappy
  const now = Date.now();
  allMatches = allMatches.filter((m) => {
    const finished = isFinishedMatch(m);
    if (finished) return true;
    const date = toDateSafe(m.fecha);
    if (!date) return false;
    if (date.getTime() < now - 15 * 60 * 1000) return false;
    return true;
  });

  loadedCollections.add(col);
  matchLoadFallbackFired = true;

  // Preload names proactively
  await preloadPlayerNames(allMatches);

  renderNextMatch();
  const activeTab =
    document.querySelector(".hv2-tab.active")?.dataset.filter || "open";
  renderMatchesByFilter(activeTab);

  if (!homeLoadMeasured && loadedCollections.size >= 1) {
    homeLoadMeasured = true;
    analyticsTiming("home.ttv_ms", performance.now() - homeBootStart);
  }
}

/* ── Tabs ── */
function bindTabs() {
  if (tabsBound) return;
  tabsBound = true;
  document.querySelectorAll(".hv2-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".hv2-tab")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderMatchesByFilter(btn.dataset.filter || "open");
    });
  });
}

/* ── Next Match — Sports Scoreboard ── */
function renderNextMatch() {
  const box = document.getElementById("next-match-box");
  if (!box) return;
  const now = Date.now();
  const mine = allMatches
    .filter((m) => (m.jugadores || []).includes(currentUser?.uid))
    .filter((m) => !isCancelledMatch(m) && !isFinishedMatch(m))
    .filter((m) => toDateSafe(m.fecha).getTime() >= now - 10 * 60 * 1000) // strict future
    .sort((a, b) => toDateSafe(a.fecha) - toDateSafe(b.fecha));

  const next = mine[0];
  if (!next) {
    box.innerHTML = `<div class="hv2-no-match"><i class="fas fa-calendar-xmark"></i><span>Sin próximo partido programado</span></div>`;
    return;
  }

  const date = toDateSafe(next.fecha);
  const players = [...(next.jugadores || [])];
  while (players.length < 4) players.push(null);

  const isReto = String(next.col || "").includes("Reto");
  const freeSlots = players.filter((p) => !p).length;
  const tempVal = weather?.current
    ? Math.round(weather.current.temperature_2m || 0)
    : null;
  const temp = tempVal !== null ? `${tempVal}°` : "--";
  const tempColor =
    tempVal !== null
      ? tempVal >= 30
        ? "#ef4444"
        : tempVal >= 20
          ? "#fbbf24"
          : tempVal >= 10
            ? "#22c55e"
            : "#60a5fa"
      : "#94a3b8";

  // Weather icon for scoreboard
  const wCode = weather?.current?.weather_code || 0;
  let wIcon = "fa-sun",
    wColor = "#fbbf24";
  if (wCode > 3 && wCode <= 48) {
    wIcon = "fa-cloud";
    wColor = "#94a3b8";
  } else if (wCode > 48 && wCode <= 67) {
    wIcon = "fa-cloud-rain";
    wColor = "#60a5fa";
  } else if (wCode > 67) {
    wIcon = "fa-bolt";
    wColor = "#a78bfa";
  }

  // Countdown
  const diffMs = date.getTime() - Date.now();
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffH / 24);
  const countdown =
    diffH < 1 ? "AHORA" : diffH < 24 ? `EN ${diffH}H` : `EN ${diffD}D`;

  const pName = (uid, team) => {
    const name = getPlayerDisplayName(uid);
    const isMe = uid === currentUser?.uid;
    const teamCls = team === "a" ? "is-team-a" : "is-team-b";
    const cls = !uid ? "empty" : isMe ? "is-me" : teamCls;
    return `<span class="hv2-sb-player-name ${cls}">${uid ? name : "LIBRE"}</span>`;
  };

  box.innerHTML = `
    <div class="hv2-scoreboard" onclick="window.openMatch('${next.id}','${next.col}')">
      <div class="hv2-court-bg"></div>
      <div class="hv2-sb-header">
        <span class="hv2-sb-type">${isReto ? "⚡ LIGA RETO" : "🎾 AMISTOSO"}</span>
        <span class="hv2-sb-countdown">${countdown}</span>
        <div class="hv2-sb-meta">
          <span class="hv2-sb-meta-item" style="color:${tempColor}"><i class="fas fa-thermometer-half"></i> ${temp}</span>
          <span class="hv2-sb-meta-item" style="color:${wColor}"><i class="fas ${wIcon}"></i></span>
          <span class="hv2-sb-meta-item"><i class="fas fa-clock"></i> ${date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>
          <span class="hv2-sb-meta-item"><i class="fas fa-calendar"></i> ${date.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}</span>
        </div>
      </div>
      <div class="hv2-sb-court">
        <div class="hv2-sb-team team-a">
          <span class="hv2-sb-team-label t-a">EQUIPO A</span>
          <div class="hv2-sb-player">${pName(players[0], "a")}</div>
          <div class="hv2-sb-player">${pName(players[1], "a")}</div>
        </div>
        <div class="hv2-sb-vs">
          <span class="hv2-sb-vs-line"></span>
          <span class="hv2-sb-vs-text">VS</span>
          <span class="hv2-sb-vs-line"></span>
        </div>
        <div class="hv2-sb-team team-b">
          <span class="hv2-sb-team-label t-b">EQUIPO B</span>
          <div class="hv2-sb-player">${pName(players[2], "b")}</div>
          <div class="hv2-sb-player">${pName(players[3], "b")}</div>
        </div>
      </div>
      <div class="hv2-sb-footer">
        <span class="hv2-sb-slots ${freeSlots > 0 ? "has-slots" : "full"}">${freeSlots > 0 ? `${freeSlots} plaza${freeSlots === 1 ? "" : "s"} libre${freeSlots === 1 ? "" : "s"}` : "COMPLETO"}</span>
        <span class="hv2-sb-action">VER PARTIDO <i class="fas fa-chevron-right"></i></span>
      </div>
    </div>
  `;
}

/* ── Match List ── */
function renderMatchesByFilter(filter) {
  const listEl = document.getElementById("matches-list");
  if (!listEl) return;
  if (loadedCollections.size < 1) {
    listEl.innerHTML = `<div class="hv2-skeleton-row"></div><div class="hv2-skeleton-row"></div><div class="hv2-skeleton-row"></div>`;
    return;
  }

  const now = Date.now();
  let list = [...allMatches].filter((m) => !isCancelledMatch(m));

  if (filter === "open") {
    list = list
      .filter((m) => !isFinishedMatch(m))
      .filter((m) => (m.jugadores || []).filter(Boolean).length < 4)
      .filter((m) => {
        const d = toDateSafe(m.fecha);
        return d && d.getTime() >= now - 5 * 60 * 1000;
      });
  } else if (filter === "mine") {
    list = list
      .filter((m) => (m.jugadores || []).includes(currentUser?.uid))
      .filter((m) => !isFinishedMatch(m))
      .filter((m) => {
        const d = toDateSafe(m.fecha);
        return d && d.getTime() >= now - 5 * 60 * 1000;
      });
  } else if (filter === "closed") {
    list = list.filter((m) => isFinishedMatch(m)).reverse();
  }

  if (!list.length) {
    listEl.innerHTML = `<div class="hv2-empty-state"><i class="fas fa-inbox"></i>No hay partidos para este filtro.</div>`;
    return;
  }

  listEl.innerHTML = list
    .slice(0, 30)
    .map((m, i) => renderMatchCard(m, i))
    .join("");
}

function renderMatchCard(match, idx = 0) {
  const date = toDateSafe(match.fecha);
  if (!date) return "";
  const players = [...(match.jugadores || [])];
  while (players.length < 4) players.push(null);
  const isReto = String(match.col || "").includes("Reto");
  const isMine = (match.jugadores || []).includes(currentUser?.uid);
  const finished = isFinishedMatch(match);
  const freeSlots = players.filter((p) => !p).length;
  const delay = Math.min(300, idx * 40);
  const orgName = match.organizador
    ? getPlayerDisplayName(match.organizador)
    : null;

  const playerAvatar = (uid) => {
    if (!uid)
      return `<div class="hv2-mc-avatar empty-slot"><i class="fas fa-user-plus"></i></div>`;
    const photo = playerPhotoCache.get(uid);
    const name = getPlayerDisplayName(uid);
    const initials = name
      .split(" ")
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    const isMe = uid === currentUser?.uid;
    if (photo) {
      return `<div class="hv2-mc-avatar ${isMe ? "is-me" : ""}"><img src="${photo}" alt="${name}" onerror="this.parentElement.innerHTML='<span>${initials}</span>'"></div>`;
    }
    return `<div class="hv2-mc-avatar ${isMe ? "is-me" : ""}"><span>${initials}</span></div>`;
  };

  const pn = (uid) => {
    const name = getPlayerDisplayName(uid);
    const cls = !uid ? "empty" : uid === currentUser?.uid ? "is-me" : "";
    return `<span class="hv2-mc-player ${cls}">${uid ? name : "Libre"}</span>`;
  };

  const hasResult = match.resultado?.sets || match.resultado?.score;
  const resultStr = hasResult ? match.resultado.sets || "" : "";
  const badge = finished
    ? `<span class="hv2-mc-badge ${hasResult ? "closed-badge" : "pending-badge"}">${hasResult ? "✓ " + resultStr : "PENDIENTE"}</span>`
    : isReto
      ? `<span class="hv2-mc-badge reto-badge">⚡ RETO</span>`
      : freeSlots > 0
        ? `<span class="hv2-mc-badge open-badge">${freeSlots} LIBRE</span>`
        : `<span class="hv2-mc-badge full-badge">COMPLETO</span>`;

  return `
    <div class="hv2-match-card ${isMine ? "mine-card" : ""} ${finished ? "finished-card" : ""}" style="animation-delay:${delay}ms" onclick="window.openMatch('${match.id}','${match.col}')">
      ${badge}
      <div class="hv2-mc-team">
        <div class="hv2-mc-avatars">${playerAvatar(players[0])}${playerAvatar(players[1])}</div>
        ${pn(players[0])}
        ${pn(players[1])}
      </div>
      <div class="hv2-mc-center">
        <span class="hv2-mc-vs">VS</span>
        <span class="hv2-mc-time">${date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>
        <span class="hv2-mc-date">${date.toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit" })}</span>
      </div>
      <div class="hv2-mc-team team-right">
        <div class="hv2-mc-avatars">${playerAvatar(players[2])}${playerAvatar(players[3])}</div>
        ${pn(players[2])}
        ${pn(players[3])}
      </div>
    </div>
  `;
}

/* ── AI Chat ── */
function bindAI() {
  const btn = document.getElementById("btn-open-ai");
  const send = document.getElementById("lia-send-btn");

  btn?.addEventListener("click", () => {
    document.getElementById("modal-lia-chat")?.classList.add("active");
  });

  const showAIResponse = (outBox, text) => {
    if (!outBox) return;
    outBox.innerHTML = `<div class="ai-response-card"><div class="ai-response-icon"><i class="fas fa-robot"></i></div><div class="ai-response-text">${text.replace(/\n/g, "<br>")}</div></div>`;
  };

  send?.addEventListener("click", async () => {
    const outBox = document.getElementById("lia-response");
    const inputEl = document.getElementById("lia-query");
    const q =
      String(inputEl?.value || "").trim() || "Resumen táctico rápido para hoy";
    if (outBox)
      outBox.innerHTML = `<div class="ai-loading"><div class="spinner-neon"></div><span>Analizando datos...</span></div>`;
    const out = await queryCoreAI({
      uid: currentUser?.uid,
      query: q,
      phase: "chat",
    }).catch(() => null);
    showAIResponse(outBox, out?.text || "No se pudo cargar el consejo IA.");
    if (inputEl) inputEl.value = "";
  });

  // Enter key to send
  document.getElementById("lia-query")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      send?.click();
    }
  });

  window.runAIQuickCommand = async (text) => {
    const outEl = document.getElementById("lia-response");
    if (outEl)
      outEl.innerHTML = `<div class="ai-loading"><div class="spinner-neon"></div><span>Consultando...</span></div>`;
    const out = await queryCoreAI({
      uid: currentUser?.uid,
      query: text,
      phase: "chat",
    }).catch(() => null);
    showAIResponse(outEl, out?.text || "No se pudo obtener respuesta.");
  };
}

/* ── Match Modal ── */
window.openMatch = async (id, col) => {
  const modal = document.getElementById("modal-match");
  const area = document.getElementById("match-detail-area");
  if (!modal || !area) return;
  modal.classList.add("active");
  await renderMatchDetail(area, id, col, currentUser, currentUserData || {});
};

window.closeHomeMatchModal = () =>
  document.getElementById("modal-match")?.classList.remove("active");
window.closeLiaModal = () =>
  document.getElementById("modal-lia-chat")?.classList.remove("active");
