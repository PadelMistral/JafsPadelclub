/* Home V2 - Clean and Real Player Names */
import { db, subscribeCol, getDocument } from "./firebase-service.js";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  addDoc,
  doc,
  deleteDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI, showToast } from "./ui-core.js";
import { injectHeader, injectNavbar } from "./modules/ui-loader.js";
import { renderMatchDetail } from "./match-service.js";
import {
  isCancelledMatch,
  isFinishedMatch,
  toDateSafe,
  getResultSetsString,
  resolveWinnerTeam,
  getMatchPlayers,
} from "./utils/match-utils.js";
import { RESULT_LOCK_MS } from "./config/match-constants.js";
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
let unsubEv = null;
let unsubMyEvents = null;
let allMatches = [];
let myEvents = [];
let weather = null;
let presenceTimer = null;
let loadedCollections = new Set();
let tabsBound = false;
let matchLoadFallbackFired = false;
const colSignature = new Map();
const homeBootStart = performance.now();
let homeLoadMeasured = false;
let nexusOnlineUsers = [];
let nexusAllUsers = [];
let homeEntryOverlayInterval = null;
let homeEntryOverlayValue = 0;
const HOME_MATCH_CACHE_KEY = "home:matches:v1";
let showHomeWelcome = false;
let unsubEventStandings = null;
let activeEventStandingsId = null;
let proposalUsersCache = [];
let proposalListUnsub = null;
let proposalChatUnsub = null;
let activeProposalId = null;

/* Apoing Integration */
let apoingEvents = [];
let apoingLastSyncAt = 0;
const APOING_SYNC_TTL_MS = 300000; // 5 min
const APOING_PROXY_LIST = [
  "/api/apoing-ics?url=",
  "https://api.allorigins.win/raw?url=",
  "https://corsproxy.io/?",
];
const APOING_PROXY_JINA = "https://r.jina.ai/http://";

/* Player cache (names + photos) */
const playerNameCache = new Map();
const playerPhotoCache = new Map();
const eventDocCache = new Map();

function getEventUserNameMap() {
  if (!window.__eventUserNameMap) window.__eventUserNameMap = new Map();
  return window.__eventUserNameMap;
}

function indexEventUserNames(eventDoc) {
  if (!eventDoc) return;
  const map = getEventUserNameMap();
  const inscritos = Array.isArray(eventDoc.inscritos) ? eventDoc.inscritos : [];
  inscritos.forEach((i) => {
    const uid = i?.uid;
    const name = i?.nombre || i?.nombreUsuario;
    if (uid && name) map.set(String(uid), String(name));
  });
  const teams = Array.isArray(eventDoc.teams) ? eventDoc.teams : [];
  teams.forEach((t) => {
    const players = Array.isArray(t?.players) ? t.players : [];
    players.forEach((p) => {
      const uid = p?.uid || p?.id;
      const name = p?.nombre || p?.nombreUsuario;
      if (uid && name) map.set(String(uid), String(name));
    });
  });
}

function getEventUserName(uid) {
  if (!uid) return null;
  try {
    return getEventUserNameMap().get(String(uid)) || null;
  } catch {
    return null;
  }
}

function normalizeMatchForCache(match) {
  const d = toDateSafe(match?.fecha);
  return {
    ...match,
    fecha: d ? d.toISOString() : match?.fecha || null,
  };
}

function saveHomeMatchCache() {
  try {
    const payload = {
      updatedAt: Date.now(),
      matches: Array.isArray(allMatches) ? allMatches.map(normalizeMatchForCache) : [],
    };
    localStorage.setItem(HOME_MATCH_CACHE_KEY, JSON.stringify(payload));
  } catch {}
}

function loadHomeMatchCache() {
  try {
    const raw = localStorage.getItem(HOME_MATCH_CACHE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.matches)) return false;
    allMatches = data.matches;
    return true;
  } catch {
    return false;
  }
}

function applyHomeMatchCache({ complete = false } = {}) {
  if (!loadHomeMatchCache()) return false;
  const activeTab =
    document.querySelector(".hv2-tab.active")?.dataset.filter || "open";
  renderNextMatch();
  renderEventSpotlight();
  maybeCreateEventDayNotice();
  renderMatchesByFilter(activeTab);
  matchLoadFallbackFired = true;
  if (complete) {
    if (!homeLoadMeasured) {
      homeLoadMeasured = true;
      analyticsTiming("home.ttv_ms", performance.now() - homeBootStart);
    }
    completeHomeEntryOverlay();
  }
  return true;
}

async function resolvePlayerName(uid) {
  if (!uid) return null;
  const eventName = getEventUserName(uid);
  if (eventName) return eventName;
  const sUid = String(uid);
  if (sUid.startsWith("GUEST_"))
    return String(uid).split("GUEST_")[1]?.replace(/_/g, " ") || String(uid).split("_")[1] || "Invitado";
  if (sUid.startsWith("invitado_") || sUid.startsWith("manual_")) return "Invitado";
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
    getNormalizedPlayers(m).forEach((uid) => {
      if (uid && !String(uid).startsWith("GUEST_") && !playerNameCache.has(uid))
        uids.add(uid);
    }),
  );
  const promises = [...uids].map((uid) => resolvePlayerName(uid));
  await Promise.allSettled(promises);
}

function getPlayerDisplayName(uid) {
  if (!uid) return "LIBRE";
  const sUid = String(uid);
  const eventName = getEventUserName(sUid);
  if (eventName) return eventName;
  if (sUid.startsWith("GUEST_") || sUid.startsWith("invitado_") || sUid.startsWith("manual_")) {
    const parts = sUid.split("_");
    return parts[1] || "Invitado";
  }
  if (uid === currentUser?.uid)
    return currentUserData?.nombreUsuario || currentUserData?.nombre || "TÚ";
  return playerNameCache.get(uid) || "Jugador";
}

function getInitials(name = "") {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .map((w) => w[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
}
/* Init */
document.addEventListener("DOMContentLoaded", () => {
  showHomeWelcome = shouldShowHomeWelcome();
  if (!showHomeWelcome) {
    const overlay = document.getElementById("home-entry-overlay");
    if (overlay) overlay.classList.add("hidden");
    document.body.classList.remove("home-booting");
  }
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
      if (showHomeWelcome) {
        beginHomeEntryOverlay(currentUserData?.nombreUsuario || currentUserData?.nombre || "Jugador");
      } else {
        const overlay = document.getElementById("home-entry-overlay");
        if (overlay) overlay.classList.add("hidden");
        document.body.classList.remove("home-booting");
      }
      await injectHeader(currentUserData);
      injectNavbar("home");
      renderWelcome();
      bindTabs();
      initWeather();
      startPresence();
      initNexus(); // New: Nexus Online
      bindNotificationNudge();
      checkSystemAlerts(userDoc);
      checkHomeNotices();
      initProposeMatch();
      applyHomeMatchCache({ complete: navigator.onLine === false });

      // Loading matches with safety fallback
      try {
        const amPromise = subscribeCol(
          "partidosAmistosos",
          (list) => mergeMatches("partidosAmistosos", list),
          [],
          [["fecha", "asc"]],
          200,
        );
        const rePromise = subscribeCol(
          "partidosReto",
          (list) => mergeMatches("partidosReto", list),
          [],
          [["fecha", "asc"]],
          200,
        );
        const evPromise = subscribeCol(
          "eventoPartidos",
          (list) => mergeMatches("eventoPartidos", list),
          [],
          [["fecha", "asc"]],
          400,
        );

        const [uA, uR, uE] = await Promise.all([amPromise, rePromise, evPromise]);
        unsubAm = uA;
        unsubRe = uR;
        unsubEv = uE;

        unsubMyEvents = await subscribeCol(
          "eventos",
          (list) => mergeMyEvents(list),
          [],
          [["createdAt", "desc"]],
          200,
        );

        // Fetch Apoing
        syncApoingReservations().catch(() => {});
      } catch (err) {
        console.error("Match loading error:", err);
        applyHomeMatchCache({ complete: true });
      }

      // Final fallback to ensure UI isn't stuck
      setTimeout(() => {
        if (!matchLoadFallbackFired) {
          matchLoadFallbackFired = true;
          renderNextMatch();
          renderMatchesByFilter(
            document.querySelector(".hv2-tab.active")?.dataset.filter || "open",
          );
          completeHomeEntryOverlay();
        }
      }, 3500);

      window.getAICoachContext = () =>
        getCoreAIContext({ uid: currentUser.uid });
    },
  });
});

function cleanup() {
  [unsubAm, unsubRe, unsubEv, unsubMyEvents, unsubNexus].forEach((fn) => {
    if (typeof fn === "function")
      try {
        fn();
      } catch {}
  });
  unsubAm = null;
  unsubRe = null;
  unsubEv = null;
  unsubMyEvents = null;
  unsubNexus = null;
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

/* Welcome */
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
  if (el("welcome-points")) el("welcome-points").textContent = Number(pts).toFixed(1);
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
  const fallback = el("welcome-avatar-fallback");
  const brandImg = el("hv2-brand-image-id");
  const brandFallback = el("hv2-brand-fallback");
  const photo = d?.fotoPerfil || d?.fotoURL || d?.photoURL || "";
  const initials = getInitials(name);

  if (avatarEl) {
    avatarEl.src = photo || "";
    avatarEl.alt = name;
    avatarEl.style.display = photo ? "block" : "none";
    avatarEl.onerror = () => {
      avatarEl.style.display = "none";
      if (fallback) fallback.style.display = "flex";
    };
  }
  if (fallback) {
    fallback.textContent = initials;
    fallback.style.display = photo ? "none" : "flex";
  }
  if (brandImg) {
    brandImg.src = photo || "./imagenes/Logojafs.png";
    brandImg.style.display = "block";
    brandImg.onerror = () => {
      brandImg.src = "./imagenes/Logojafs.png";
      brandImg.style.display = "block";
    };
  }
  if (brandFallback) {
    brandFallback.textContent = "J";
    brandFallback.style.display = "none";
  }
  // Division chip based on ELO
  const divChip = el("user-division-chip");
  const welcomeCard = document.querySelector(".hv2-welcome");
  if (divChip) {
    let divName = "BRONCE",
      divColor = "#cd7f32",
      divBg = "rgba(205,127,50,0.1)",
      divBorder = "rgba(205,127,50,0.25)",
      divGlow = "rgba(205,127,50,0.05)";
    if (pts >= 1400) {
      divName = "ELITE";
      divColor = "#a855f7";
      divBg = "rgba(168,85,247,0.15)";
      divBorder = "rgba(168,85,247,0.4)";
      divGlow = "rgba(168,85,247,0.1)";
    } else if (pts >= 1200) {
      divName = "DIAMANTE";
      divColor = "#00d4ff";
      divBg = "rgba(0,212,255,0.12)";
      divBorder = "rgba(0,212,255,0.3)";
      divGlow = "rgba(0,212,255,0.08)";
    } else if (pts >= 1050) {
      divName = "ORO";
      divColor = "#facc15";
      divBg = "rgba(250,204,21,0.12)";
      divBorder = "rgba(250,204,21,0.3)";
      divGlow = "rgba(250,204,21,0.08)";
    } else if (pts >= 950) {
      divName = "PLATA";
      divColor = "#e2e8f0";
      divBg = "rgba(255,255,255,0.08)";
      divBorder = "rgba(255,255,255,0.2)";
      divGlow = "rgba(255,255,255,0.04)";
    }
    divChip.innerHTML = `<i class="fas fa-shield-halved"></i> ${divName}`;
    divChip.style.color = divColor;
    divChip.style.background = divBg;
    divChip.style.borderColor = divBorder;
    if (welcomeCard) {
      welcomeCard.style.setProperty("--welcome-glow-color", divGlow);
      welcomeCard.style.borderColor = divBorder;
    }
  }

  refreshWelcomeRank();
  startClock();
  setTimeout(checkHomeNotices, 1000);
}

/* Home Notices */
async function checkHomeNotices() {
    const d = currentUserData;
    if (!d || !currentUser?.uid) return;

    const notices = [];
    const now = new Date();
    const myMatches = allMatches.filter((m) => {
        const players = getNormalizedPlayers(m);
        return players.includes(currentUser.uid) && !isCancelledMatch(m);
    });

    // 1. Matches Today
    const todayMatches = myMatches.filter((m) => {
        const fecha = toDateSafe(m?.fecha);
        if (!fecha) return false;
        return (
            fecha.getDate() === now.getDate() &&
            fecha.getMonth() === now.getMonth() &&
            fecha.getFullYear() === now.getFullYear() &&
            !isFinishedMatch(m) &&
            !isCancelledMatch(m)
        );
    });

    if (todayMatches.length > 0) {
        notices.push({
            type: 'game',
            title: '¡HOY JUEGAS!',
            message: `Tienes ${todayMatches.length} ${todayMatches.length > 1 ? 'partidos' : 'partido'} programado para hoy. ¡A por todas!`,
            action: () => window.location.href = 'calendario.html'
        });
    }

    // 2. Pending Result
    const pendingResult = myMatches.filter((m) => {
        if (isFinishedMatch(m)) return false;
        const hasResult = Boolean(m?.resultado?.sets || (typeof m?.resultado === "string" && m.resultado.trim()));
        if (hasResult) return false;
        const matchTime = toDateSafe(m?.fecha);
        if (!matchTime) return false;
        return (now.getTime() - matchTime.getTime()) >= RESULT_LOCK_MS;
    });

    if (pendingResult.length > 0) {
        notices.unshift({
            type: 'game',
            title: 'RESULTADO PENDIENTE',
            message: `Tienes ${pendingResult.length} ${pendingResult.length > 1 ? 'partidos' : 'partido'} esperando resultado. Regístralo ahora.`,
            action: () => window.location.href = 'calendario.html'
        });
    }

    // 3. Pending Diary
    const diaryEntries = d.diario || [];
    const finishedWithResult = myMatches.filter((m) => {
        const hasResult = Boolean(m?.resultado?.sets || (typeof m?.resultado === "string" && m.resultado.trim()));
        return hasResult || isFinishedMatch(m);
    });
    const missingDiary = finishedWithResult.filter((m) => {
        const matchTime = toDateSafe(m?.fecha);
        if (!matchTime) return false;
        const isOldEnough = (now - matchTime) > 2 * 60 * 60 * 1000; // 2h after match
        if (!isOldEnough) return false;
        return !diaryEntries.some((e) => e.matchId === m.id);
    });

    if (missingDiary.length > 0) {
        notices.push({
            type: 'diary',
            title: 'DIARIO PENDIENTE',
            message: "No has apuntado tus datos en el diario del último partido. ¡No pierdas tu racha táctica!",
            action: () => window.location.href = 'diario.html'
        });
    }

    // Display Notices
    if (notices.length > 0) {
        const notice = notices[0]; // Show first for now
        showHomeAlertModal(notice);
    }
}

function showHomeAlertModal(notice) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.zIndex = '14000';
    overlay.innerHTML = `
        <div class="modal-card glass-strong animate-scale-in" style="max-width:320px; border:1px solid rgba(255,255,255,0.15); padding: 24px;">
            <div class="flex-col items-center text-center gap-4">
                <div class="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center text-primary text-2xl">
                    <i class="fas ${notice.type === 'game' ? 'fa-calendar-check' : 'fa-book-sparkles'}"></i>
                </div>
                <div class="flex-col gap-1">
                    <h3 class="text-lg font-black italic tracking-widest text-primary">${notice.title}</h3>
                    <p class="text-xs text-white/70 leading-relaxed">${notice.message}</p>
                </div>
                <button class="btn-premium-v7 w-full py-3 uppercase text-[10px] font-black" id="notice-btn-go">CONTINUAR</button>
                <button class="text-[9px] font-black text-white/30 uppercase tracking-widest" id="notice-btn-close">CERRAR</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#notice-btn-go').onclick = () => {
        notice.action();
        overlay.remove();
    };
    overlay.querySelector('#notice-btn-close').onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
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

/* Weather */
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

/* System Alerts & Notifs */
async function checkSystemAlerts(userData) {
  if (!userData || !currentUser) return;

  const alerts = [];
  const now = new Date();

  // 1. Check for Match Today
  const today = allMatches
    .filter((m) => {
      const d = toDateSafe(m.fecha);
      return (
        d &&
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear() &&
        getNormalizedPlayers(m).includes(currentUser.uid)
      );
    })
    .sort((a, b) => toDateSafe(a.fecha) - toDateSafe(b.fecha));

  if (today.length > 0) {
    const next = today[0];
    const time = toDateSafe(next.fecha).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
    alerts.push({
      title: "Partido Hoy",
      body: `¡Hoy tienes partido a las ${time}! Prepárate para la victoria.`,
      icon: "fa-calendar-check",
      color: "var(--primary)",
    });
  }

  // 2. Check for Pending Diary
  const lastPlayed = allMatches
    .filter((m) => {
      return (
        isFinishedMatch(m) && getNormalizedPlayers(m).includes(currentUser.uid)
      );
    })
    .sort((a, b) => toDateSafe(b.fecha) - toDateSafe(a.fecha))[0];

  if (lastPlayed) {
    const hasDiary = (userData.diario || []).some(
      (e) => e.matchId === lastPlayed.id,
    );
    if (!hasDiary) {
      alerts.push({
        title: "Diario Pendiente",
        body: "No has registrado tus sensaciones del último partido. ¡Suma puntos extra ahora!",
        icon: "fa-book",
        color: "var(--sport-yellow)",
        link: "diario.html",
      });
    }
  }

  // Show as Toasts if there are any
  if (alerts.length > 0 && typeof window.__appToast === "function") {
    setTimeout(() => {
      alerts.forEach((a, i) => {
        setTimeout(() => {
          window.__appToast(a.title, a.body, "info");
        }, i * 3000);
      });
    }, 2000);
  }
}

/* Recomendaciones Dinámicas */
function refreshRecommendations() {
  const recomEl = document.getElementById("recom-content");
  if (!recomEl) return;

  const now = Date.now();
  const pts = Number(currentUserData?.puntosRanking || 1000);
  const lvl = Number(currentUserData?.nivel || 2.5).toFixed(2);
  const streak = Number(currentUserData?.rachaActual || 0);
  const myMatches = allMatches.filter((m) => getNormalizedPlayers(m).includes(currentUser?.uid));
  const nextMatch = myMatches
    .filter((m) => !isFinishedMatch(m) && !isCancelledMatch(m))
    .filter((m) => toDateSafe(m.fecha)?.getTime() >= now - 10 * 60 * 1000)
    .sort((a, b) => toDateSafe(a.fecha) - toDateSafe(b.fecha))[0];
  const lastMatch = myMatches
    .filter((m) => isFinishedMatch(m))
    .sort((a, b) => toDateSafe(b.fecha) - toDateSafe(a.fecha))[0];

  const lines = [];
  lines.push(`Estado actual: ELO ${Number(pts).toFixed(1)} · Nivel ${lvl} · Racha ${streak >= 0 ? '+' : ''}${streak}.`);

  if (nextMatch) {
    const d = toDateSafe(nextMatch.fecha);
    const when = d ? d.toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "sin fecha";
    const opponentIds = getOpponentIds(nextMatch, currentUser?.uid);
    const oppNames = opponentIds.map((id) => getPlayerDisplayName(id)).filter(Boolean).join(" y ");
    lines.push(`Próximo partido: ${when} vs ${oppNames || "rival por definir"}.`);
    const oppStats = opponentIds.map((id) => computeRecentWinrate(id, 8)).filter(Boolean);
    if (oppStats.length) {
      const best = oppStats.sort((a, b) => a.winrate - b.winrate)[0];
      lines.push(`Rival en foco: ${best.name} con ${best.winrate}% de victorias en sus últimos ${best.total} partidos.`);
    }
  } else {
    lines.push("No hay próximo partido confirmado. Programa uno para seguir sumando ritmo.");
  }

  if (lastMatch) {
    const d = toDateSafe(lastMatch.fecha);
    const when = d ? d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }) : "fecha desconocida";
    const sets = getResultSetsString(lastMatch) || "sin marcador";
    const winner = resolveWinnerTeam(lastMatch);
    const mySide = getTeamSide(lastMatch, currentUser?.uid);
    const resultLabel = winner ? (winner === mySide ? "victoria" : "derrota") : "resultado parcial";
    const teamA = getTeamNames(lastMatch, "A");
    const teamB = getTeamNames(lastMatch, "B");
    lines.push(`Último partido (${when}): ${teamA} vs ${teamB} · ${sets} · ${resultLabel}.`);
  }

  const diaryEntries = currentUserData?.diario || [];
  if (lastMatch && !diaryEntries.some((e) => e.matchId === lastMatch.id)) {
    lines.push("Diario pendiente: registra tus sensaciones del último partido para mejorar tu perfil táctico.");
  }

  recomEl.innerHTML = lines.map((l) => `<div class="hv2-tr-line">${l}</div>`).join("");

  // Cambiar recomendación cada pocos segundos de forma cíclica
  if (!window._recomCycleInit) {
    window._recomCycleInit = true;
    setInterval(refreshRecommendations, 20000);
  }
}

function getTeamSide(match, uid) {
  const players = getNormalizedPlayers(match);
  if (!uid) return null;
  if (players.slice(0, 2).includes(uid)) return 1;
  if (players.slice(2, 4).includes(uid)) return 2;
  return null;
}

function getOpponentIds(match, uid) {
  const players = getNormalizedPlayers(match);
  if (!uid) return [];
  if (players.slice(0, 2).includes(uid)) return players.slice(2, 4).filter(Boolean);
  if (players.slice(2, 4).includes(uid)) return players.slice(0, 2).filter(Boolean);
  return [];
}

function getTeamNames(match, side = "A") {
  const players = getNormalizedPlayers(match);
  const ids = side === "A" ? players.slice(0, 2) : players.slice(2, 4);
  const names = ids.map((id) => getPlayerDisplayName(id)).filter(Boolean);
  return names.length ? names.join(" & ") : "Equipo";
}

function computeRecentWinrate(uid, limitMatches = 8) {
  if (!uid) return null;
  const matches = allMatches
    .filter((m) => isFinishedMatch(m) && getNormalizedPlayers(m).includes(uid))
    .sort((a, b) => toDateSafe(b.fecha) - toDateSafe(a.fecha))
    .slice(0, limitMatches);
  if (!matches.length) return null;
  let wins = 0;
  matches.forEach((m) => {
    const winner = resolveWinnerTeam(m);
    const side = getTeamSide(m, uid);
    if (winner && side && winner === side) wins += 1;
  });
  const winrate = Math.round((wins / matches.length) * 100);
  return { uid, name: getPlayerDisplayName(uid), winrate, total: matches.length };
}

/* Notifications */
function bindNotificationNudge() {
  // Inicializamos recomendaciones por primera vez
  refreshRecommendations();
}

function getNormalizedPlayers(match) {
  const players = getMatchPlayers(match);
  if (!players.length) return [];
  return [...new Set(players)].slice(0, 4);
}

function isEventMatch(match) {
  return (
    String(match?.col || "") === "eventoPartidos" ||
    Boolean(match?.eventMatchId || match?.eventoId || match?.eventLink?.eventoId)
  );
}

function isMatchRelevantToMe(match) {
  if (!currentUser?.uid) return false;
  
  // 0. Handle Apoing directly
  if (match.isApoing) {
    return match.sourceUid === currentUser.uid;
  }

  // 1. Check direct UIDs
  if (getNormalizedPlayers(match).includes(currentUser.uid)) return true;
  
  // 2. Check team membership (for event matches)
  if (myEvents.length > 0) {
    const myTeamIds = myEvents.flatMap(ev => {
      const t = getMyTeamFromEvent(ev);
      return t ? [t.id] : [];
    });
    if (myTeamIds.includes(match?.teamAId) || myTeamIds.includes(match?.teamBId)) return true;
  }
  
  return false;
}

function getEventIdFromMatch(match) {
  return (
    match?.eventoId ||
    match?.eventId ||
    match?.eventLink?.eventoId ||
    null
  );
}

function buildEventSlotKey(match) {
  const d = toDateSafe(match?.fecha);
  if (!d) return null;
  const when = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
  const court = String(match?.courtType || match?.pista || match?.court || "unknown").toLowerCase();
  const eventId = String(match?.eventoId || match?.eventId || match?.eventLink?.eventoId || "");
  return `${eventId}|${court}|${when}`;
}

function getRealPlayerCount(match) {
  const players = (match?.jugadores || match?.playerUids || []).filter(Boolean);
  return players.filter((p) => !String(p).startsWith("GUEST_")).length;
}

function normalizeTeamName(value) {
  return String(value || "").trim().toLowerCase();
}

function isUnknownTeamName(value) {
  const n = normalizeTeamName(value);
  if (!n) return true;
  const compact = n.replace(/\s+/g, "");
  if (["tbd", "tbd.", "tbd?", "tdb", "?", "unknown"].includes(n)) return true;
  if (["tbd", "tbd.", "tbd?", "tdb", "tbdvs", "tbdvstbd", "tbdtbd", "unknown"].includes(compact)) return true;
  if (["desconocido", "desconocidos", "por confirmar", "por definir", "pendiente"].includes(n)) return true;
  return false;
}

function isTbdMatch(match) {
  const noPlayers = getRealPlayerCount(match) === 0;
  const isTbd = isUnknownTeamName(match?.teamAName || match?.equipoA) &&
    isUnknownTeamName(match?.teamBName || match?.equipoB);
  return noPlayers && isTbd;
}

function pickBestMatch(a, b) {
  const aCount = getRealPlayerCount(a);
  const bCount = getRealPlayerCount(b);
  if (aCount !== bCount) return aCount > bCount ? a : b;

  const aIsEvent = String(a?.col || "") === "eventoPartidos";
  const bIsEvent = String(b?.col || "") === "eventoPartidos";
  if (aIsEvent !== bIsEvent) return aIsEvent ? b : a;

  const aTbd = isTbdMatch(a);
  const bTbd = isTbdMatch(b);
  if (aTbd !== bTbd) return aTbd ? b : a;

  const aPlayed = !!a?.resultado?.sets || String(a?.estado || "").toLowerCase() === "jugado";
  const bPlayed = !!b?.resultado?.sets || String(b?.estado || "").toLowerCase() === "jugado";
  if (aPlayed !== bPlayed) return aPlayed ? a : b;

  return a;
}

function dedupeEventSlots(list = []) {
  const map = new Map();
  list.forEach((m) => {
    const key = buildEventSlotKey(m);
    if (!key) {
      const fallbackKey = `${m?.col || ""}:${m?.id || ""}`;
      map.set(fallbackKey, m);
      return;
    }
    if (!map.has(key)) {
      map.set(key, m);
      return;
    }
    const prev = map.get(key);
    map.set(key, pickBestMatch(prev, m));
  });
  return Array.from(map.values());
}

// Remove duplicates when an event match is linked to a calendar match.
function dedupeEventLinkedMatches(list = []) {
  const linkedEventIds = new Set(
    list
      .filter((m) => String(m.col || "") !== "eventoPartidos" && m.eventMatchId)
      .map((m) => String(m.eventMatchId)),
  );
  const seen = new Set();
  const filtered = list.filter((m) => {
    if (String(m.col || "") === "eventoPartidos") {
      const id = String(m.id || "");
      if (linkedEventIds.has(id) || m.linkedMatchId) return false;
    }
    const key = m.eventMatchId
      ? `eventlink:${m.eventMatchId}`
      : `${m.col || ""}:${m.id || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return dedupeEventSlots(filtered);
}

function mergeMyEvents(list = []) {
  if (!currentUser?.uid) return;
  myEvents = (list || [])
    .filter((ev) => Array.isArray(ev?.inscritos) && ev.inscritos.some((i) => i?.uid === currentUser.uid))
    .filter((ev) => !["finalizado", "cancelado"].includes(String(ev?.estado || "").toLowerCase()));
  myEvents.forEach((ev) => indexEventUserNames(ev));
  renderEventSpotlight();
  maybeCreateEventDayNotice();
}

function toDateMs(value) {
  const d = toDateSafe(value);
  return d ? d.getTime() : Infinity;
}

function getMineUpcomingEventMatches() {
  const now = Date.now();
  return dedupeEventLinkedMatches(allMatches)
    .filter((m) => isEventMatch(m))
    .filter((m) => isMatchRelevantToMe(m))
    .filter((m) => !isFinishedMatch(m) && !isCancelledMatch(m))
    .filter((m) => m.fecha && !isTbdMatch(m))
    .filter((m) => {
      const d = toDateSafe(m.fecha);
      return d && d.getTime() >= now - 10 * 60 * 1000;
    })
    .sort((a, b) => toDateMs(a.fecha) - toDateMs(b.fecha));
}

function renderEventSpotlight() {
  const wrap = document.getElementById("event-spotlight");
  const body = document.getElementById("event-spotlight-body");
  const link = document.getElementById("event-spotlight-link");
  if (!wrap || !body) return;

  const upcoming = getMineUpcomingEventMatches().slice(0, 3);
  const nextEvent = myEvents[0] || null;
  if (!nextEvent && !upcoming.length) {
    wrap.classList.add("hidden");
    return;
  }

  wrap.classList.remove("hidden");
  if (nextEvent?.id && link) link.href = `evento-detalle.html?id=${nextEvent.id}`;

  const cards = [];
  if (nextEvent) {
    const inscritos = Array.isArray(nextEvent.inscritos) ? nextEvent.inscritos.length : 0;
    const myTeam = getMyTeamFromEvent(nextEvent);

    let partnerId = myTeam?.playerUids?.find((id) => id && id !== currentUser?.uid) || null;
    let partnerName = partnerId ? getPlayerDisplayName(partnerId) : null;

    if (!partnerId && Array.isArray(nextEvent.inscritos)) {
         const myInscription = nextEvent.inscritos.find(i => i.uid === currentUser?.uid);
         if (myInscription?.pairCode) {
             const partnerInscription = nextEvent.inscritos.find(i => i.uid !== currentUser?.uid && i.pairCode === myInscription.pairCode);
             if (partnerInscription) {
                 partnerId = partnerInscription.uid;
                 partnerName = partnerInscription.nombre || getPlayerDisplayName(partnerId);
             }
         }
    }
    partnerName = partnerName || "Pendiente asignar";

    const eventMatches = dedupeEventLinkedMatches(allMatches).filter(
      (m) => isEventMatch(m) && getEventIdFromMatch(m) === nextEvent.id,
    );
    // Find team matches by ID if generated, or just by player UIDs if still in pool
    const teamMatches = myTeam?.id
      ? eventMatches.filter((m) => m.teamAId === myTeam.id || m.teamBId === myTeam.id)
      : eventMatches.filter((m) => getNormalizedPlayers(m).includes(currentUser?.uid));

    const totalTeam = teamMatches.length;
    const playedTeam = teamMatches.filter((m) => isFinishedMatch(m)).length;
    const pendingTeam = totalTeam - playedTeam;
    const totalEvent = eventMatches.length;
    const playedEvent = eventMatches.filter((m) => isFinishedMatch(m)).length;
    const teamPct = totalTeam ? Math.round((playedTeam / totalTeam) * 100) : 0;
    const eventPct = totalEvent ? Math.round((playedEvent / totalEvent) * 100) : 0;

    cards.push(`
      <div class="hv2-event-chip">
        <div class="hv2-event-chip-title">${(nextEvent.nombre || "Evento").toUpperCase()}</div>
        <div class="hv2-event-chip-sub">Fase: ${String(nextEvent.estado || "inscripcion").toUpperCase()} · ${inscritos}/${Number(nextEvent.plazasMax || 16)} plazas</div>
        <div class="hv2-event-meta">
          <div>
            <span class="hv2-meta-label">Compañero/a</span>
            <span class="hv2-meta-value">${partnerName}</span>
          </div>
          <div>
            <span class="hv2-meta-label">Mis Partidos</span>
            <span class="hv2-meta-value">${playedTeam}/${totalTeam || 0} jugados</span>
          </div>
        </div>
        <div class="hv2-event-progress">
          <div class="hv2-progress-row">
            <div class="hv2-progress-head">
              <span>Progreso de tu equipo ${pendingTeam > 0 ? `<span style="opacity:0.5; font-size:8px;">(Faltan ${pendingTeam})</span>` : ''}</span>
              <span>${playedTeam}/${totalTeam || 0}</span>
            </div>
            <div class="hv2-progress-bar"><span style="width:${teamPct}%"></span></div>
          </div>
          <div class="hv2-progress-row">
            <div class="hv2-progress-head">
              <span>Progreso del evento</span>
              <span>${playedEvent}/${totalEvent || 0}</span>
            </div>
            <div class="hv2-progress-bar alt"><span style="width:${eventPct}%"></span></div>
          </div>
        </div>
        <div id="event-standings-slot" class="hv2-event-standings"></div>
      </div>
    `);
  }

  if (upcoming.length) {
    upcoming.forEach((m) => {
      const d = toDateSafe(m.fecha);
      const when = d
        ? d.toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
        : "Sin fecha";
      const estado = String(m.estado || "pendiente").toUpperCase();
      const result = m.resultado?.sets ? ` · ${m.resultado.sets}` : "";
      const phaseRaw = String(m.phase || "evento").toUpperCase();
      const phaseMap = {
        'GROUP': 'FASE DE GRUPOS',
        'LEAGUE': 'LIGA',
        'KNOCKOUT': 'ELIMINATORIA',
        'SEMI': 'SEMIFINAL',
        'FINAL': 'GRAN FINAL',
        'TBD': 'POR DEFINIR'
      };
      const phasePretty = phaseMap[phaseRaw] || (phaseRaw.includes("KNOCKOUT") ? "ELIMINATORIA" : phaseRaw);
      const getTeamLabel = (tId, tName, pIds) => {
        if (tName && String(tName).toUpperCase() !== "TBD" && String(tName).toUpperCase() !== "PENDIENTE") 
          return String(tName).toUpperCase();
        if (Array.isArray(pIds) && pIds.length > 0) {
            return pIds.map(p => getPlayerDisplayName(p).split(" ")[0]).join("/");
        }
        return "POR DEFINIR";
      };
      const teamALabel = getTeamLabel(m.teamAId, m.teamAName, m.playerUids?.slice(0,2) || m.jugadores?.slice(0,2));
      const teamBLabel = getTeamLabel(m.teamBId, m.teamBName, m.playerUids?.slice(2,4) || m.jugadores?.slice(2,4));

      cards.push(`
        <div class="hv2-event-chip" onclick="window.openMatch('${m.id}','${m.col}')">
          <div class="hv2-event-chip-title">PARTIDO DE TORNEO · ${phasePretty}</div>
          <div class="hv2-event-chip-sub">${teamALabel} vs ${teamBLabel} · ${when}</div>
          <div class="hv2-event-chip-sub">Estado: ${estado}${result}</div>
        </div>
      `);
    });
  } else {
    cards.push(`
      <div class="hv2-event-chip">
        <div class="hv2-event-chip-title">Sin partido asignado</div>
        <div class="hv2-event-chip-sub">Reserva en calendario y vincula un partido pendiente de evento.</div>
      </div>
    `);
  }

  body.innerHTML = cards.join("");
  if (nextEvent) {
    renderEventStandings(nextEvent);
  }
}

function getMyTeamFromEvent(eventDoc) {
  if (!eventDoc || !currentUser?.uid) return null;
  const teams = Array.isArray(eventDoc.teams) ? eventDoc.teams : [];
  return teams.find((t) => Array.isArray(t?.playerUids) && t.playerUids.includes(currentUser.uid)) || null;
}

function getMyGroupFromEvent(eventDoc, teamId) {
  if (!eventDoc || !teamId) return null;
  const groups = eventDoc.groups || {};
  const found = Object.entries(groups).find(([, ids]) => Array.isArray(ids) && ids.includes(teamId));
  return found ? found[0] : null;
}

async function renderEventStandings(eventDoc) {
  const slot = document.getElementById("event-standings-slot");
  if (!slot || !eventDoc?.id) return;
  const myTeam = getMyTeamFromEvent(eventDoc);
  const myTeamId = myTeam?.id || null;
  const myGroup = getMyGroupFromEvent(eventDoc, myTeamId);

  slot.innerHTML = `<div class="hv2-event-standings-title">Clasificación${myGroup ? ` · Grupo ${String(myGroup).toUpperCase()}` : ""}</div>`;
  try {
    if (activeEventStandingsId !== eventDoc.id) {
      if (typeof unsubEventStandings === "function") unsubEventStandings();
      activeEventStandingsId = eventDoc.id;
      unsubEventStandings = await subscribeCol(
        "eventoClasificacion",
        (list) => {
          renderStandingsRows(list, eventDoc, myTeamId, myGroup, slot);
        },
        [["eventoId", "==", eventDoc.id]],
        [["puntos", "desc"], ["diferencia", "desc"]],
        200,
      );
    }
    const snap = await getDocs(
      query(
        collection(db, "eventoClasificacion"),
        where("eventoId", "==", eventDoc.id)
      ),
    );
    renderStandingsRows(
      snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      eventDoc,
      myTeamId,
      myGroup,
      slot,
    );
  } catch (e) {
    slot.innerHTML += `<div class="hv2-event-standings-empty">La clasificación se activará al comenzar la fase de grupos.</div>`;
  }
}

function renderStandingsRows(rowsIn, eventDoc, myTeamId, myGroup, slot) {
  let rows = Array.isArray(rowsIn) ? rowsIn.slice() : [];
  rows.sort((a,b) => (b.puntos || 0) - (a.puntos || 0) || (b.diferencia || 0) - (a.diferencia || 0));
  slot.innerHTML = `<div class="hv2-event-standings-title">Clasificación${myGroup ? ` · Grupo ${String(myGroup).toUpperCase()}` : ""}</div>`;
    const teamToGroup = new Map();
    if (eventDoc.groups) {
      Object.entries(eventDoc.groups).forEach(([g, ids]) => {
        (ids || []).forEach((id) => teamToGroup.set(id, g));
      });
    }

    if (myGroup) {
      rows = rows.filter((r) => teamToGroup.get(r.uid || r.teamId) === myGroup);
    }

    // Fallback: If no classification data found for my group, show members with 0 pts
    if (rows.length === 0 && myGroup && eventDoc.groups?.[myGroup]) {
      const memberIds = eventDoc.groups[myGroup];
      rows = memberIds.map(tid => {
        const teamObj = (eventDoc.teams || []).find(t => t.id === tid);
        return {
          uid: tid,
          teamId: tid,
          nombre: teamObj?.nombre || teamObj?.name || "Equipo",
          puntos: 0,
          diferencia: 0
        };
      });
    }

    const top = rows.slice(0, 10);
    if (!top.length) {
      slot.innerHTML += `<div class="hv2-event-standings-empty">Sin clasificación aún</div>`;
      return;
    }
    slot.innerHTML += top
      .map((r, i) => {
        const isMine = myTeamId && (r.uid === myTeamId || r.teamId === myTeamId);
        const status = i < 4 ? "CLASIFICA" : "ELIM.";
        return `
          <div class="hv2-event-standings-row ${isMine ? "mine" : ""}">
            <span class="pos">#${i + 1}</span>
            <span class="name">${(r.nombre || r.teamName || r.uid || "Equipo").toUpperCase()}</span>
            <span class="pts">${Number(r.puntosGanados || 0)}-${Number(r.puntosPerdidos || 0)} (${Number(r.diferencia || 0)}) · ${Number(r.puntos || 0)} pts</span>
            <span class="hv2-qual ${i < 4 ? "ok" : "out"}">${status}</span>
          </div>
        `;
      })
      .join("");
}

async function createSelfNoticeOnce(key, title, message, link = "home.html", data = {}) {
  if (!currentUser?.uid) return;
  const storageKey = `home_notice:${currentUser.uid}:${key}`;
  try {
    if (localStorage.getItem(storageKey)) return;
  } catch {}
  try {
    await addDoc(collection(db, "notificaciones"), {
      destinatario: currentUser.uid,
      receptorId: currentUser.uid,
      remitente: currentUser.uid,
      tipo: "event_reminder",
      type: "event_reminder",
      titulo: title,
      mensaje: message,
      enlace: link,
      data,
      leido: false,
      seen: false,
      read: false,
      uid: currentUser.uid,
      title,
      message,
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    try {
      localStorage.setItem(storageKey, "1");
    } catch {}
  } catch (_) {}
}



function sameDay(a, b) {
  return (
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  );
}

function maybeCreateEventDayNotice() {
  const next = getMineUpcomingEventMatches()[0];
  const d = toDateSafe(next?.fecha);
  if (!next || !d) return;
  if (!sameDay(d, new Date())) return;
  const key = `event_today:${next.id}:${new Date().toISOString().slice(0, 10)}`;
  const msg = `Hoy juegas partido de evento a las ${d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}.`;
  createSelfNoticeOnce(key, "Partido de evento hoy", msg, `evento-detalle.html?id=${next.eventoId || ""}&tab=partidos`, {
    type: "event_match_today",
    matchId: next.id,
    eventId: next.eventId || null,
  });
}

/* Match data */
async function mergeMatches(col, list) {
  const sig = JSON.stringify(list.map((m) => m.id + m.estado));
  if (colSignature.get(col) === sig) return;
  colSignature.set(col, sig);

  if (col === "eventoPartidos") {
    const eventIds = [...new Set(list.map((m) => m.eventoId || m.eventId).filter(Boolean))];
    await Promise.allSettled(
      eventIds.map(async (eid) => {
        if (eventDocCache.has(eid)) return;
        const ev = await getDocument("eventos", eid);
        if (ev) {
          eventDocCache.set(eid, ev);
          indexEventUserNames(ev);
        }
      }),
    );
  }

  allMatches = [
    ...allMatches.filter((m) => m.col !== col),
    ...list.map((m) => ({
      ...m,
      col,
      jugadores: getNormalizedPlayers(m),
      organizerId: m.organizerId || m.organizadorId || m.creador || null,
    })),
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
    if (!date) return true; // KEEP match if no date (usually pending event match)
    if (date.getTime() < now - 15 * 60 * 1000) return false;
    return true;
  });

  loadedCollections.add(col);
  matchLoadFallbackFired = true;

  // Preload names proactively
  await preloadPlayerNames(allMatches);

  renderNextMatch();
  renderEventSpotlight();
  maybeCreateEventDayNotice();
  const activeTab =
    document.querySelector(".hv2-tab.active")?.dataset.filter || "open";
  renderMatchesByFilter(activeTab);
  saveHomeMatchCache();

  if (!homeLoadMeasured && loadedCollections.size >= 1) {
    homeLoadMeasured = true;
    analyticsTiming("home.ttv_ms", performance.now() - homeBootStart);
    completeHomeEntryOverlay();
  }
}

function shouldShowHomeWelcome() {
  try {
    const keys = ["show_home_welcome", "home_entry_welcome"];
    for (const key of keys) {
      if (sessionStorage.getItem(key)) {
        sessionStorage.removeItem(key);
        return true;
      }
    }
  } catch {}
  return false;
}

function beginHomeEntryOverlay(name = "Jugador") {
  const overlay = document.getElementById("home-entry-overlay");
  const title = document.getElementById("home-entry-title");
  const fill = document.getElementById("home-entry-fill");
  const pct = document.getElementById("home-entry-pct");
  if (!overlay || !fill || !pct) return;

  document.body.classList.add("home-booting");
  overlay.classList.remove("hidden");
  if (title) title.textContent = `BIENVENIDO DE NUEVO ${String(name).toUpperCase()}`;
  homeEntryOverlayValue = 0;
  fill.style.width = "0%";
  pct.textContent = "0%";
  if (homeEntryOverlayInterval) clearInterval(homeEntryOverlayInterval);
  homeEntryOverlayInterval = setInterval(() => {
    homeEntryOverlayValue = Math.min(90, homeEntryOverlayValue + Math.max(1, Math.floor(Math.random() * 6)));
    fill.style.width = `${homeEntryOverlayValue}%`;
    pct.textContent = `${homeEntryOverlayValue}%`;
  }, 90);
}

function completeHomeEntryOverlay() {
  const overlay = document.getElementById("home-entry-overlay");
  const fill = document.getElementById("home-entry-fill");
  const pct = document.getElementById("home-entry-pct");
  if (!overlay || !fill || !pct) return;
  if (homeEntryOverlayInterval) clearInterval(homeEntryOverlayInterval);
  homeEntryOverlayInterval = null;
  homeEntryOverlayValue = 100;
  fill.style.width = "100%";
  pct.textContent = "100%";
  setTimeout(() => {
    overlay.classList.add("hidden");
    document.body.classList.remove("home-booting");
  }, 520);
}

/* Tabs */
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

/* Next match - sports scoreboard */
function renderNextMatch() {
  const box = document.getElementById("next-match-box");
  if (!box) return;
  const now = Date.now();
  const mine = allMatches
    .filter((m) => isMatchRelevantToMe(m))
    .filter((m) => !isCancelledMatch(m) && !isFinishedMatch(m))
    .filter((m) => {
      const d = toDateSafe(m.fecha);
      return d && d.getTime() >= now - 10 * 60 * 1000;
    }) // strict future
    .sort((a, b) => {
      const da = toDateSafe(a.fecha);
      const db = toDateSafe(b.fecha);
      return (da?.getTime() || 0) - (db?.getTime() || 0);
    });

  const next = mine[0];
  if (!next) {
    box.innerHTML = `<div class="hv2-no-match"><i class="fas fa-calendar-xmark"></i><span>Sin próximo partido programado</span></div>`;
    return;
  }

  const date = toDateSafe(next.fecha);
  const players = [...getNormalizedPlayers(next)];
  while (players.length < 4) players.push(null);

  const isEvent = isEventMatch(next);
  const isReto = String(next.col || "").includes("Reto");
  const freeSlots = isEvent ? 0 : players.filter((p) => !p).length;
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
    return `<span class="hv2-sb-player-name ${cls}">${uid ? name : isEvent ? "POR DEFINIR" : "LIBRE"}</span>`;
  };

  box.innerHTML = `
    <div class="hv2-scoreboard" onclick="window.openMatch('${next.id}','${next.col}')">
      <div class="hv2-court-bg"></div>
      <div class="hv2-sb-header">
        <span class="hv2-sb-type">${isEvent ? "EVENTO" : isReto ? "LIGA RETO" : "AMISTOSO"}</span>
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
        <span class="hv2-sb-slots ${freeSlots > 0 ? "has-slots" : "full"}">${isEvent ? (next.phase ? String(next.phase).toUpperCase() : "EVENTO") : (freeSlots > 0 ? `${freeSlots} plaza${freeSlots === 1 ? "" : "s"} libre${freeSlots === 1 ? "" : "s"}` : "COMPLETO")}</span>
        <span class="hv2-sb-action">VER PARTIDO <i class="fas fa-chevron-right"></i></span>
      </div>
    </div>
  `;
}

/* Match list */
function renderMatchesByFilter(filter) {
  const listEl = document.getElementById("matches-list");
  if (!listEl) return;
  if (loadedCollections.size < 1) {
    listEl.innerHTML = `<div class="hv2-skeleton-row"></div><div class="hv2-skeleton-row"></div><div class="hv2-skeleton-row"></div>`;
    return;
  }

  const now = Date.now();
  
  // Merge Apoing events into matches list
  const apoingMatches = apoingEvents.map(ev => ({
    id: `apoing_${ev.uid || Math.random()}`,
    col: "apoing",
    fecha: ev.dtStart,
    jugadores: [ev.sourceUid, null, null, null],
    summary: ev.summary,
    isApoing: true,
    sourceUid: ev.sourceUid,
    sourceName: ev.sourceName || "Jugador Apoing",
    owner: ev.owner || "Jugador"
  }));

  let list = dedupeEventLinkedMatches([...allMatches, ...apoingMatches])
    .filter((m) => !isCancelledMatch(m))
    .filter((m) => {
      if (isEventMatch(m) && !m.fecha) return false;
      return true;
    });

  if (filter === "open") {
    list = list
      .filter((m) => !isFinishedMatch(m))
      .filter((m) => getNormalizedPlayers(m).filter(Boolean).length < 4)
      .filter((m) => !isTbdMatch(m))
      .filter((m) => {
        const d = toDateSafe(m.fecha);
        return d && d.getTime() >= now - 5 * 60 * 1000;
      });
  } else if (filter === "mine") {
    list = list
      .filter((m) => isMatchRelevantToMe(m))
      .filter((m) => !isFinishedMatch(m))
      .filter((m) => {
        const d = toDateSafe(m.fecha);
        return d && d.getTime() >= now - 5 * 60 * 1000;
      });
  } else if (filter === "closed") {
    list = list
      .filter((m) => !isFinishedMatch(m))
      .filter((m) => getNormalizedPlayers(m).filter(Boolean).length >= 4)
      .filter((m) => {
        const d = toDateSafe(m.fecha);
        return d && d.getTime() > now;
      })
      .sort((a, b) => toDateSafe(a.fecha) - toDateSafe(b.fecha));
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
  const players = [...getNormalizedPlayers(match)];
  while (players.length < 4) players.push(null);
  const isEvent = isEventMatch(match);
  const isReto = String(match.col || "").includes("Reto");
  const isMine = getNormalizedPlayers(match).includes(currentUser?.uid) || (match.isApoing && match.sourceUid === currentUser?.uid);
  const finished = isFinishedMatch(match);
  const freeSlots = isEvent ? 0 : players.filter((p) => !p).length;
  const delay = Math.min(300, idx * 40);
  const orgName = match.organizador
    ? getPlayerDisplayName(match.organizador)
    : match.isApoing ? match.owner : null;

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
    ? `<span class="hv2-mc-badge ${hasResult ? "closed-badge" : "pending-badge"}">${hasResult ? "CERRADO " + resultStr : "PENDIENTE"}</span>`
    : match.isApoing
      ? `<span class="hv2-mc-badge apoing-badge">APOING</span>`
      : isEvent
        ? `<span class="hv2-mc-badge open-badge">EVENTO${match.phase ? ` · ${String(match.phase).toUpperCase()}` : ""}</span>`
        : isReto
          ? `<span class="hv2-mc-badge reto-badge">RETO</span>`
          : freeSlots > 0
            ? `<span class="hv2-mc-badge open-badge">${freeSlots} LIBRE</span>`
            : `<span class="hv2-mc-badge full-badge">COMPLETO</span>`;

  const cardClick = match.isApoing 
    ? `window.openApoingMatch('${match.id}')` 
    : `window.openMatch('${match.id}','${match.col}')`;

  return `
    <div class="hv2-match-card ${isMine ? "mine-card" : ""} ${finished ? "finished-card" : ""} ${match.isApoing ? "apoing-card" : ""}" style="animation-delay:${delay}ms" onclick="${cardClick}">
      ${badge}
      <div class="hv2-mc-team">
        <div class="hv2-mc-avatars">${playerAvatar(players[0])}${playerAvatar(players[1])}</div>
        ${pn(players[0])}
        ${pn(players[1])}
      </div>
      <div class="hv2-mc-center">
        <span class="hv2-mc-vs">${match.isApoing ? "<i class='fas fa-calendar-check text-orange-400'></i>" : "VS"}</span>
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

/* Match modal */

/* Nexus online - connected users */
let unsubNexus = null;
async function initNexus() {
  const container = document.getElementById("nexus-container");
  if (!container) return;
  container.style.cursor = "pointer";
  container.onclick = () => window.openNexusModal?.();
  const nexusModal = document.getElementById("modal-nexus");
  if (nexusModal && !nexusModal.dataset.bound) {
    nexusModal.dataset.bound = "1";
    nexusModal.addEventListener("click", (e) => {
      if (e.target === nexusModal) nexusModal.classList.remove("active");
    });
  }

  unsubNexus = await subscribeCol(
    "usuarios",
    (users) => {
      nexusAllUsers = users.slice();
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
      const online = users
        .filter((u) => {
          if (!u.ultimoAcceso) return false;
          const last = u.ultimoAcceso?.toDate
            ? u.ultimoAcceso.toDate()
            : new Date(u.ultimoAcceso);
          return last > tenMinAgo;
        })
        .sort(
          (a, b) =>
            (b.ultimoAcceso?.seconds || 0) - (a.ultimoAcceso?.seconds || 0),
        );

      nexusOnlineUsers = online;
      renderNexus(online);
      const modal = document.getElementById("modal-nexus");
      if (modal?.classList.contains("active")) {
        window.openNexusModal?.();
      }
    },
    [],
    [["ultimoAcceso", "desc"]],
    40,
  );
}

function renderNexus(users) {
  const count = document.getElementById("nexus-count");
  if (!count) return;
  count.textContent = String(users.length);
}

window.openNexusModal = () => {
  const modal = document.getElementById("modal-nexus");
  const list = document.getElementById("nexus-modal-list");
  const title = document.getElementById("nexus-modal-title");
  if (!modal || !list) return;

  const onlineIds = new Set(nexusOnlineUsers.map((u) => u.id));
  const offlineUsers = (nexusAllUsers || [])
    .filter((u) => !onlineIds.has(u.id))
    .sort((a, b) => (b.ultimoAcceso?.seconds || 0) - (a.ultimoAcceso?.seconds || 0));
  if (title) title.textContent = `Usuarios · ${nexusOnlineUsers.length} conectados / ${offlineUsers.length + nexusOnlineUsers.length} total`;

  const onlineHtml = nexusOnlineUsers.length
    ? nexusOnlineUsers
    .map((u) => {
      const isMe = u.id === currentUser?.uid;
      const name = u.nombreUsuario || u.nombre || "Jugador";
      const photo = u.fotoPerfil || u.fotoURL || u.photoURL || "";
      const initials = getInitials(name);
      const last = u.ultimoAcceso?.toDate ? u.ultimoAcceso.toDate() : new Date(u.ultimoAcceso || 0);
      const lastTxt = Number.isNaN(last.getTime())
        ? "Sin fecha"
        : last.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      return `
        <div class="nexus-modal-row" onclick="window.location.href='perfil.html?uid=${u.id}'">
          <div class="nexus-modal-avatar">
            ${photo ? `<img src="${photo}" alt="${name}" onerror="this.outerHTML='<span class=&quot;nexus-initials&quot;>${initials}</span>'">` : `<span class="nexus-initials">${initials}</span>`}
          </div>
          <div class="nexus-modal-info">
            <span class="nexus-modal-name">${isMe ? "TÚ" : name}</span>
            <span class="nexus-modal-meta">Conectado ahora</span>
          </div>
        </div>
      `;
    })
    .join("")
    : '<div class="nexus-modal-empty">No hay usuarios conectados ahora</div>';

  const offlineHtml = `
    <div class="nexus-modal-divider">No conectados â€” última actividad (${offlineUsers.length})</div>
    ${
      offlineUsers.length
        ? offlineUsers
            .map((u) => {
              const name = u.nombreUsuario || u.nombre || "Jugador";
              const photo = u.fotoPerfil || u.fotoURL || u.photoURL || "";
              const initials = getInitials(name);
              const last = u.ultimoAcceso?.toDate ? u.ultimoAcceso.toDate() : new Date(u.ultimoAcceso || 0);
              const lastTxt = Number.isNaN(last.getTime())
                ? "Sin registro"
                : last.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
              return `
                <div class="nexus-modal-row is-offline" onclick="window.location.href='perfil.html?uid=${u.id}'">
                  <div class="nexus-modal-avatar">
                    ${photo ? `<img src="${photo}" alt="${name}" onerror="this.outerHTML='<span class=&quot;nexus-initials&quot;>${initials}</span>'">` : `<span class="nexus-initials">${initials}</span>`}
                  </div>
                  <div class="nexus-modal-info">
                    <span class="nexus-modal-name">${name}</span>
                    <span class="nexus-modal-meta">Último acceso: ${lastTxt}</span>
                  </div>
                </div>
              `;
            })
            .join("")
        : '<div class="text-[10px] opacity-40 p-2">Todos están conectados o sin datos.</div>'
    }
  `;

  list.innerHTML = '<div class="nexus-modal-section-title">Conectados ahora (' + nexusOnlineUsers.length + ')</div>' + onlineHtml + offlineHtml;

  modal.classList.add("active");
};
window.openMatch = (id, col) => {
  if (String(col || "") === "eventoPartidos") {
    const row = allMatches.find(
      (m) => m.id === id && String(m.col || "") === "eventoPartidos",
    );
    if (row?.eventoId) {
      window.location.href = `evento-detalle.html?id=${row.eventoId}&tab=partidos`;
      return;
    }
  }
  const evLinked = allMatches.find(
    (m) => m.id === id && m.eventoId,
  );
  if (evLinked?.eventoId) {
    window.location.href = `evento-detalle.html?id=${evLinked.eventoId}&tab=partidos`;
    return;
  }
  const modal = document.getElementById("modal-match");
  const area = document.getElementById("match-detail-area");
  if (!modal || !area) return;
  modal.classList.add("active");
  renderMatchDetail(area, id, col, currentUser, currentUserData || {});
};

window.closeHomeMatchModal = () => {
  document.getElementById("modal-match")?.classList.remove("active");
};


window.clearAppCache = async () => {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    localStorage.removeItem("home_ai_tip_cache");
    sessionStorage.removeItem("home_state_cache");
    window.__appToast?.("Caché limpiada", "Recargando interfaz...", "success");
    setTimeout(() => window.location.reload(), 450);
  } catch (e) {
    console.warn("clear cache failed:", e);
    window.__appToast?.("Error", "No se pudo limpiar la caché", "error");
  }
};

/* Apoing Logic for Home */
async function syncApoingReservations() {
  const now = Date.now();
  if (now - apoingLastSyncAt < APOING_SYNC_TTL_MS) return;
  
  const sources = await getApoingSources();
  if (!sources.length) return;

  try {
    const allEvents = [];
    for (const source of sources) {
      try {
        const icsUrl = String(source.icsUrl || "").trim();
        if (!icsUrl) continue;
        let raw = "";
        try {
          raw = await fetchRawApoingByUrl(icsUrl);
        } catch (e) {
          console.warn("Apoing fetch fail", source.uid, e);
          continue;
        }
        const parsed = parseIcsEvents(raw).filter((e) => !Number.isNaN(e.dtStart.getTime()));
        const filtered = parsed.filter((e) => isRelevantApoingEvent(e));
        const expanded = expandRecurringEvents(filtered).map((e) => ({
          ...e,
          sourceUid: source.uid,
          sourceName: source.name,
          owner: extractOwnerFromApoingEvent(e) || source.name
        }));
        allEvents.push(...expanded);
      } catch (err) {
        console.warn("Source sync error", source.uid, err);
      }
    }
    apoingEvents = allEvents.sort((a,b) => a.dtStart - b.dtStart);
    apoingLastSyncAt = now;
    const activeTab = document.querySelector(".hv2-tab.active")?.dataset.filter || "open";
    renderMatchesByFilter(activeTab);
  } catch (e) {
    console.error("Apoing sync failed", e);
  }
}

async function getApoingSources() {
  const sources = [];
  const pushUnique = (row) => {
    const uid = String(row?.uid || "").trim();
    const icsUrl = String(row?.icsUrl || "").trim();
    if (!uid || !icsUrl) return;
    if (sources.some((s) => s.uid === uid)) return;
    sources.push({ uid, name: row?.name || "Jugador", icsUrl });
  };
  try {
    const publicSnap = await getDocs(collection(db, "apoingCalendars"));
    publicSnap.forEach((d) => pushUnique({ uid: d.id, ...d.data() }));
  } catch (_) {}
  const myUrl = String(currentUserData?.apoingCalendarUrl || "").trim();
  if (currentUser?.uid && myUrl) pushUnique({ uid: currentUser.uid, name: currentUserData?.nombreUsuario || "Tú", icsUrl: myUrl });
  return sources;
}

async function fetchRawApoingByUrl(url) {
  for (const proxy of APOING_PROXY_LIST) {
    try {
      const target = proxy.includes('allorigins') || proxy.includes('corsproxy') 
        ? `${proxy}${encodeURIComponent(url)}`
        : `${proxy}${url.replace(/^https?:\/\//i, "")}`;
      const resp = await fetch(target);
      if (resp.ok) return await resp.text();
    } catch (_) {}
  }
  const jinaTarget = `${APOING_PROXY_JINA}${url.replace(/^https?:\/\//i, "")}`;
  const resp = await fetch(jinaTarget);
  if (resp.ok) return await resp.text();
  throw new Error("Apoing fetch failed all proxies");
}

function parseIcsEvents(icsText = "") {
  const lines = unfoldIcsLines(icsText);
  const out = [];
  let current = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { current = {}; continue; }
    if (line === "END:VEVENT") { if (current?.dtStart && current?.dtEnd) out.push(current); current = null; continue; }
    if (!current) continue;
    const split = line.indexOf(":");
    if (split <= 0) continue;
    const rawKey = line.slice(0, split).trim();
    const value = decodeIcsText(line.slice(split + 1).trim());
    const key = rawKey.split(";")[0].toUpperCase();
    if (key === "SUMMARY") current.summary = value;
    if (key === "DESCRIPTION") current.description = value;
    if (key === "DTSTART") current.dtStart = parseIcsDate(value);
    if (key === "DTEND") current.dtEnd = parseIcsDate(value);
  }
  return out.filter((e) => e.dtStart instanceof Date && e.dtEnd instanceof Date);
}

function unfoldIcsLines(raw = "") {
  const lines = String(raw || "").split(/\r?\n/);
  const unfolded = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith(" ") || line.startsWith("\t")) unfolded[unfolded.length - 1] += line.trim();
    else unfolded.push(line.trim());
  }
  return unfolded;
}

function parseIcsDate(v) {
  const dOnly = String(v).match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dOnly) return new Date(Number(dOnly[1]), Number(dOnly[2])-1, Number(dOnly[3]));
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?/);
  if (!m) return new Date(NaN);
  if (m[7] === "Z") return new Date(Date.UTC(Number(m[1]), Number(m[2])-1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]||0)));
  return new Date(Number(m[1]), Number(m[2])-1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]||0));
}

function decodeIcsText(t) { return String(t||"").replaceAll("\\n","\n").replaceAll("\\,",",").replaceAll("\\;",";").replaceAll("\\\\","\\"); }

function expandRecurringEvents(events) {
  const out = [];
  const horizon = Date.now() + 15 * 24 * 60 * 60 * 1000;
  for (const ev of events) {
    out.push(ev);
    // Recurring logic skipped for home simplicity unless requested, 
    // basic one-off matches are usually enough for home "upcoming" view.
  }
  return out;
}

function isRelevantApoingEvent(ev) {
  const txt = normalizeName(`${ev.summary || ""} ${ev.description || ""}`);
  // Loosen condition: if it mentions padel/padle OR common terms like reserve/match/court
  // but definitely ignore club social.
  const isPadel = txt.includes("padel") || txt.includes("padle");
  const isGeneric = txt.includes("reserva") || txt.includes("pista") || txt.includes("match") || txt.includes("partida");
  const isClub = txt.includes("club social") || txt.includes("club");
  if (isClub && !isPadel) return false;
  return (isPadel || isGeneric) && !txt.includes("club social");
}

function normalizeName(t) { return String(t||"").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }

function extractOwnerFromApoingEvent(ev) {
  const raw = `${ev.summary || ""} ${ev.description || ""}`;
  const patterns = [
    /(?:reservad[oa]\s+por|usuario|cliente|player|jugador)\s*[:\-]\s*([^\n,(]+)/i,
    /\(([A-Za-z\u00C0-\u024F'`.\- ]{3,})\)/,
    /[-|]\s*([A-Za-z\u00C0-\u024F ]{3,})/
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return "";
}

window.openApoingMatch = (id) => {
  window.location.href = "calendario.html";
};

// Ensure cleanup includes Nexus
const originalCleanup = cleanup;
cleanup = () => {
  originalCleanup();
  if (typeof unsubNexus === "function") unsubNexus();
  unsubNexus = null;
};

function initProposeMatch() {
    // Prepare proposal modal on load
    ensureProposalModal();
}

window.openProposeMatchChat = () => {
    openProposalModal();
};

function ensureProposalModal() {
    if (document.getElementById("proposal-modal")) return;
    const modal = document.createElement("div");
    modal.id = "proposal-modal";
    modal.className = "modal-overlay";
    modal.innerHTML = `
        <div class="modal-card glass-strong" style="max-width:560px;">
            <div class="modal-header">
                <h3 class="modal-title">Propuesta de Partido</h3>
                <button class="close-btn" id="proposal-close-btn">&times;</button>
            </div>
            <div class="modal-body scroll-y" style="max-height: 80vh;">
                <div id="proposal-view-list" class="flex-col gap-3"></div>
                <div id="proposal-view-create" class="flex-col gap-3 hidden"></div>
                <div id="proposal-view-chat" class="flex-col gap-3 hidden"></div>
            </div>
        </div>
    `;
    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.remove("active");
    });
    document.body.appendChild(modal);
    modal.querySelector("#proposal-close-btn")?.addEventListener("click", () => {
        modal.classList.remove("active");
        cleanupProposalChat();
    });
}

function openProposalModal() {
    const modal = document.getElementById("proposal-modal");
    if (!modal) return;
    modal.classList.add("active");
    renderProposalList();
}

function setProposalView(view) {
    ["proposal-view-list", "proposal-view-create", "proposal-view-chat"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle("hidden", id !== view);
    });
}

async function renderProposalList() {
    const listEl = document.getElementById("proposal-view-list");
    if (!listEl || !currentUser?.uid) return;
    setProposalView("proposal-view-list");
    listEl.innerHTML = `<div class="text-xs opacity-60">Cargando propuestas...</div>`;

    if (typeof proposalListUnsub === "function") proposalListUnsub();
    proposalListUnsub = onSnapshot(
        query(
            collection(db, "propuestasPartido"),
            where("participantUids", "array-contains", currentUser.uid),
            orderBy("createdAt", "desc"),
        ),
        (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
                .filter((p) => p.status !== "closed");
            listEl.innerHTML = `
                <div class="flex-row between items-center">
                    <div class="text-[10px] uppercase tracking-widest font-black text-primary">Mis propuestas</div>
                    <button class="btn-confirm-v7" id="btn-new-proposal">Nueva propuesta</button>
                </div>
                ${rows.length ? rows.map((p) => proposalCardHtml(p)).join("") : `
                    <div class="p-4 rounded-xl border border-white/10 bg-white/5 text-center text-[10px] opacity-70">
                        No tienes propuestas activas.
                    </div>
                `}
            `;
            listEl.querySelector("#btn-new-proposal")?.addEventListener("click", renderProposalCreate);
            listEl.querySelectorAll("[data-prop-id]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const pid = btn.getAttribute("data-prop-id");
                    if (pid) openProposalChat(pid);
                });
            });
        },
    );
}

function proposalCardHtml(p) {
    const names = Array.isArray(p.participantNames) ? p.participantNames.join(", ") : "";
    const statusLabel = p.status === "rejected" ? "RECHAZADA" : "ABIERTA";
    return `
        <div class="p-3 rounded-xl border border-white/10 bg-white/5 flex-col gap-2">
            <div class="flex-row between items-center">
                <span class="text-[10px] font-black uppercase tracking-widest">${statusLabel}</span>
                <button class="btn-ghost" data-prop-id="${p.id}">Abrir chat</button>
            </div>
            <div class="text-[11px] font-bold">${p.title || "Propuesta de partido"}</div>
            <div class="text-[10px] opacity-60">Participantes: ${names || "Sin datos"}</div>
        </div>
    `;
}

async function renderProposalCreate() {
    const createEl = document.getElementById("proposal-view-create");
    if (!createEl || !currentUser?.uid) return;
    setProposalView("proposal-view-create");
    createEl.innerHTML = `<div class="text-xs opacity-60">Cargando usuarios...</div>`;

    if (!proposalUsersCache.length) {
        try {
            const snap = await getDocs(query(collection(db, "usuarios"), orderBy("nombreUsuario"), limit(200)));
            proposalUsersCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        } catch (_) {
            proposalUsersCache = [];
        }
    }

    const userOptions = proposalUsersCache
        .filter((u) => u.id !== currentUser.uid)
        .map((u) => `
            <label class="flex-row items-center gap-2 text-[11px]">
                <input type="checkbox" class="proposal-user-check" value="${u.id}">
                <span>${u.nombreUsuario || u.nombre || u.email || u.id}</span>
            </label>
        `)
        .join("");

    createEl.innerHTML = `
        <div class="text-[10px] uppercase tracking-widest font-black text-primary">Nueva propuesta</div>
        <div class="p-3 rounded-xl border border-white/10 bg-white/5 flex-col gap-2">
            <label class="text-[10px] font-black uppercase opacity-60">Título</label>
            <input id="proposal-title" class="input" placeholder="Partido de la semana">
        </div>
        <div class="p-3 rounded-xl border border-white/10 bg-white/5 flex-col gap-2">
            <label class="text-[10px] font-black uppercase opacity-60">Invitar jugadores</label>
            <div class="flex-col gap-2 max-h-48 scroll-y">
                ${userOptions || '<div class="text-[10px] opacity-60">No hay usuarios cargados.</div>'}
            </div>
        </div>
        <div class="flex-row gap-2">
            <button class="btn-ghost w-full" id="proposal-back-btn">Volver</button>
            <button class="btn-confirm-v7 w-full" id="proposal-create-btn">Crear chat</button>
        </div>
    `;

    createEl.querySelector("#proposal-back-btn")?.addEventListener("click", renderProposalList);
    createEl.querySelector("#proposal-create-btn")?.addEventListener("click", createProposalChat);
}

async function createProposalChat() {
    const title = document.getElementById("proposal-title")?.value?.trim() || "Propuesta de partido";
    const checks = Array.from(document.querySelectorAll(".proposal-user-check:checked"));
    const uids = checks.map((c) => c.value);
    if (!uids.length) {
        showToast("Faltan jugadores", "Selecciona al menos un usuario para invitar.", "warning");
        return;
    }
    const participantUids = Array.from(new Set([currentUser.uid, ...uids]));
    const participantNames = participantUids.map((uid) => {
        if (uid === currentUser.uid) return currentUserData?.nombreUsuario || currentUserData?.nombre || "Tú";
        const u = proposalUsersCache.find((x) => x.id === uid);
        return u?.nombreUsuario || u?.nombre || u?.email || uid;
    });

    try {
        const ref = await addDoc(collection(db, "propuestasPartido"), {
            title,
            createdBy: currentUser.uid,
            participantUids,
            participantNames,
            status: "open",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
        showToast("Chat creado", "Propuesta abierta con los usuarios seleccionados.", "success");
        openProposalChat(ref.id);
    } catch (e) {
        showToast("Error", "No se pudo crear la propuesta.", "error");
    }
}

function cleanupProposalChat() {
    if (typeof proposalChatUnsub === "function") proposalChatUnsub();
    proposalChatUnsub = null;
    activeProposalId = null;
}

async function openProposalChat(proposalId) {
    const chatEl = document.getElementById("proposal-view-chat");
    if (!chatEl || !proposalId) return;
    setProposalView("proposal-view-chat");
    activeProposalId = proposalId;

    const propSnap = await getDocument("propuestasPartido", proposalId);
    if (!propSnap) {
        showToast("No disponible", "La propuesta ya no existe.", "warning");
        renderProposalList();
        return;
    }

    chatEl.innerHTML = `
        <div class="flex-row between items-center">
            <div>
                <div class="text-[10px] uppercase tracking-widest font-black text-primary">Chat de propuesta</div>
                <div class="text-[11px] font-bold">${propSnap.title || "Propuesta de partido"}</div>
                <div class="text-[10px] opacity-60">Participantes: ${(propSnap.participantNames || []).join(", ")}</div>
            </div>
            <button class="btn-ghost" id="proposal-back-list">Volver</button>
        </div>
        <div id="proposal-chat-list" class="proposal-chat-list"></div>
        <div class="proposal-chat-input">
            <input id="proposal-chat-text" class="input" placeholder="Escribe tu propuesta...">
            <button class="btn-confirm-v7" id="proposal-send-btn">Enviar</button>
        </div>
        <div class="proposal-actions">
            <button class="btn-ghost" id="proposal-reject-btn">Rechazar propuesta</button>
            <button class="btn-confirm-v7" id="proposal-confirm-btn">Concretar propuesta</button>
        </div>
        <div id="proposal-confirm-area" class="proposal-confirm-area hidden"></div>
    `;

    chatEl.querySelector("#proposal-back-list")?.addEventListener("click", () => {
        cleanupProposalChat();
        renderProposalList();
    });
    chatEl.querySelector("#proposal-send-btn")?.addEventListener("click", () => sendProposalMessage(proposalId));
    chatEl.querySelector("#proposal-chat-text")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") sendProposalMessage(proposalId);
    });
    chatEl.querySelector("#proposal-reject-btn")?.addEventListener("click", () => rejectProposal(proposalId));
    chatEl.querySelector("#proposal-confirm-btn")?.addEventListener("click", () => toggleProposalConfirm(propSnap));

    const chatList = chatEl.querySelector("#proposal-chat-list");
    if (typeof proposalChatUnsub === "function") proposalChatUnsub();
    proposalChatUnsub = onSnapshot(
        query(collection(db, "propuestasPartido", proposalId, "chat"), orderBy("createdAt", "asc")),
        (snap) => {
            if (!chatList) return;
            chatList.innerHTML = snap.docs.map((d) => {
                const m = d.data() || {};
                const isMe = m.uid === currentUser?.uid;
                return `
                    <div class="proposal-msg ${isMe ? "me" : ""}">
                        <div class="proposal-msg-meta">${m.name || "Jugador"} · ${formatChatTime(m.createdAt)}</div>
                        <div class="proposal-msg-text">${escapeHtml(m.text || "")}</div>
                    </div>
                `;
            }).join("") || `<div class="text-[10px] opacity-50">Sin mensajes todavía.</div>`;
            chatList.scrollTop = chatList.scrollHeight;
        },
    );
}

function formatChatTime(ts) {
    if (!ts) return "";
    const d = ts?.toDate ? ts.toDate() : new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

async function sendProposalMessage(proposalId) {
    const input = document.getElementById("proposal-chat-text");
    const text = input?.value?.trim();
    if (!text) return;
    input.value = "";
    try {
        const name = currentUserData?.nombreUsuario || currentUserData?.nombre || "Jugador";
        await addDoc(collection(db, "propuestasPartido", proposalId, "chat"), {
            uid: currentUser.uid,
            name,
            text,
            createdAt: serverTimestamp(),
        });
    } catch (e) {
        showToast("Error", "No se pudo enviar el mensaje.", "error");
    }
}

async function rejectProposal(proposalId) {
    if (!confirm("¿Rechazar esta propuesta?")) return;
    try {
        await setDoc(doc(db, "propuestasPartido", proposalId), { status: "rejected", updatedAt: serverTimestamp() }, { merge: true });
        showToast("Propuesta rechazada", "El chat se cerrará para el resto.", "info");
        cleanupProposalChat();
        renderProposalList();
    } catch (e) {
        showToast("Error", "No se pudo rechazar la propuesta.", "error");
    }
}

function toggleProposalConfirm(propSnap) {
    const area = document.getElementById("proposal-confirm-area");
    if (!area) return;
    area.classList.toggle("hidden");
    if (!area.classList.contains("hidden")) {
        renderProposalConfirmForm(propSnap);
    }
}

function renderProposalConfirmForm(propSnap) {
    const area = document.getElementById("proposal-confirm-area");
    if (!area) return;
    const participants = Array.isArray(propSnap.participantUids) ? propSnap.participantUids : [];
    const options = participants.map((uid) => {
        const u = proposalUsersCache.find((x) => x.id === uid);
        const name = uid === currentUser.uid
            ? (currentUserData?.nombreUsuario || currentUserData?.nombre || "Tú")
            : (u?.nombreUsuario || u?.nombre || u?.email || uid);
        return `<option value="${uid}">${name}</option>`;
    }).join("");
    const slotOptions = `<option value="">-- Libre --</option>${options}<option value="guest">Invitado</option>`;
    area.innerHTML = `
        <div class="p-3 rounded-xl border border-white/10 bg-white/5 flex-col gap-3">
            <div class="text-[10px] uppercase tracking-widest font-black text-primary">Concretar propuesta</div>
            <div class="grid grid-cols-2 gap-2">
                <input id="proposal-date" type="date" class="input">
                <input id="proposal-time" type="time" class="input" value="19:00">
                <select id="proposal-surface" class="input">
                    <option value="indoor">Indoor</option>
                    <option value="outdoor">Outdoor</option>
                </select>
                <select id="proposal-court" class="input">
                    <option value="normal">Pista normal</option>
                    <option value="central">Pista central</option>
                </select>
            </div>
            <div class="grid grid-cols-2 gap-2">
                ${[1,2,3,4].map(i => `
                    <div class="flex-col gap-1">
                        <label class="text-[9px] uppercase opacity-60">Jugador ${i}</label>
                        <select class="input proposal-slot" data-slot="${i}">${slotOptions}</select>
                        <input class="input proposal-guest hidden" data-guest="${i}" placeholder="Nombre invitado">
                    </div>
                `).join("")}
            </div>
            <div id="proposal-preview" class="p-2 rounded-xl border border-white/10 bg-white/5 text-[10px]"></div>
            <div class="flex-row gap-2">
                <button class="btn-ghost w-full" id="proposal-cancel-confirm">Cancelar</button>
                <button class="btn-confirm-v7 w-full" id="proposal-finalize">Crear partido</button>
            </div>
        </div>
    `;
    area.querySelectorAll(".proposal-slot").forEach((sel) => {
        sel.addEventListener("change", () => {
            const idx = sel.getAttribute("data-slot");
            const guestInput = area.querySelector(`.proposal-guest[data-guest="${idx}"]`);
            if (!guestInput) return;
            if (sel.value === "guest") guestInput.classList.remove("hidden");
            else guestInput.classList.add("hidden");
            updateProposalPreview(propSnap);
        });
    });
    area.querySelectorAll(".proposal-guest").forEach((inp) => {
        inp.addEventListener("input", () => updateProposalPreview(propSnap));
    });
    area.querySelector("#proposal-cancel-confirm")?.addEventListener("click", () => area.classList.add("hidden"));
    area.querySelector("#proposal-finalize")?.addEventListener("click", () => finalizeProposal(propSnap));
    updateProposalPreview(propSnap);
}

function buildGuestId(name) {
    const safe = String(name || "Invitado").trim().replace(/\s+/g, "_");
    return `GUEST_${safe}_2.5_0`;
}

function updateProposalPreview(propSnap) {
    const preview = document.getElementById("proposal-preview");
    if (!preview) return;
    const names = [];
    document.querySelectorAll(".proposal-slot").forEach((sel) => {
        if (!sel.value) return;
        if (sel.value === "guest") {
            const idx = sel.getAttribute("data-slot");
            const g = document.querySelector(`.proposal-guest[data-guest="${idx}"]`)?.value?.trim() || "Invitado";
            names.push(g);
            return;
        }
        const u = proposalUsersCache.find((x) => x.id === sel.value);
        names.push(u?.nombreUsuario || u?.nombre || u?.email || sel.value);
    });
    const teamA = names.slice(0, 2).join(" / ") || "Por definir";
    const teamB = names.slice(2, 4).join(" / ") || "Por definir";
    preview.innerHTML = `
        <div class="text-[9px] uppercase opacity-60 mb-1">Vista previa parejas</div>
        <div><strong>Equipo A:</strong> ${escapeHtml(teamA)}</div>
        <div><strong>Equipo B:</strong> ${escapeHtml(teamB)}</div>
    `;
}

async function finalizeProposal(propSnap) {
    const date = document.getElementById("proposal-date")?.value;
    const time = document.getElementById("proposal-time")?.value || "19:00";
    if (!date) return showToast("Fecha requerida", "Indica el día del partido.", "warning");
    const players = [];
    document.querySelectorAll(".proposal-slot").forEach((sel) => {
        const val = sel.value;
        if (!val) { players.push(null); return; }
        if (val === "guest") {
            const idx = sel.getAttribute("data-slot");
            const g = document.querySelector(`.proposal-guest[data-guest="${idx}"]`)?.value?.trim();
            players.push(g ? buildGuestId(g) : buildGuestId("Invitado"));
            return;
        }
        players.push(val);
    });
    while (players.length < 4) players.push(null);
    if (players.filter(Boolean).length < 2) {
        return showToast("Faltan jugadores", "Selecciona al menos 2 jugadores.", "warning");
    }

    try {
        const matchDate = new Date(`${date}T${time}`);
        const surface = document.getElementById("proposal-surface")?.value || "indoor";
        const courtType = document.getElementById("proposal-court")?.value || "normal";
        const invitedUsers = (propSnap.participantUids || []).filter((uid) => uid && !String(uid).startsWith("GUEST_"));

        await addDoc(collection(db, "partidosAmistosos"), {
            creador: currentUser.uid,
            organizerId: currentUser.uid,
            fecha: matchDate,
            jugadores: players,
            restriccionNivel: { min: 1.0, max: 7.0 },
            estado: "abierto",
            visibility: "private",
            invitedUsers,
            equipoA: [players[0], players[1]],
            equipoB: [players[2], players[3]],
            surface,
            courtType,
            proposalId: propSnap.id,
            createdAt: serverTimestamp(),
            timestamp: serverTimestamp(),
        });

        await deleteProposalChat(propSnap.id);
        showToast("Partido creado", "El partido ya está en calendario.", "success");
        cleanupProposalChat();
        renderProposalList();
    } catch (e) {
        showToast("Error", "No se pudo crear el partido desde la propuesta.", "error");
    }
}

async function deleteProposalChat(proposalId) {
    try {
        const chatSnap = await getDocs(collection(db, "propuestasPartido", proposalId, "chat"));
        await Promise.all(chatSnap.docs.map((d) => deleteDoc(d.ref)));
        await deleteDoc(doc(db, "propuestasPartido", proposalId));
    } catch (e) {
        console.warn("deleteProposalChat failed", e);
    }
}

function escapeHtml(raw = "") {
    const div = document.createElement("div");
    div.textContent = String(raw || "");
    return div.innerHTML;
}
