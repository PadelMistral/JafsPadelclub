/* Home V2 - Clean and Real Player Names */
import { db, subscribeCol, getDocument } from "./firebase-service.js";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
  addDoc,
  serverTimestamp,
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

/* Player cache (names + photos) */
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
      beginHomeEntryOverlay(currentUserData?.nombreUsuario || currentUserData?.nombre || "Jugador");
      await injectHeader(currentUserData);
      injectNavbar("home");
      renderWelcome();
      bindTabs();
      initWeather();
      startPresence();
      initNexus(); // New: Nexus Online
      bindNotificationNudge();
      checkSystemAlerts(userDoc);
      checkHomeNotices(); // Added this line

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
      } catch (err) {
        console.error("Match loading error:", err);
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

    // 1. Matches Today
    const todayMatches = allMatches.filter((m) => {
        const fecha = toDateSafe(m?.fecha);
        if (!fecha) return false;
        return (
            fecha.getDate() === now.getDate() &&
            fecha.getMonth() === now.getMonth() &&
            fecha.getFullYear() === now.getFullYear() &&
            (m.jugadores || []).includes(currentUser.uid) &&
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

    // 2. Pending Diary
    const lastMatches = window.__lastMatchesParticipated || [];
    const diaryEntries = d.diario || [];
    const missingDiary = lastMatches.filter(m => {
        const matchTime = m.fecha?.toDate?.() || new Date(m.fecha);
        const isOldEnough = (now - matchTime) > 2 * 60 * 60 * 1000; // 2h after match
        if (!isOldEnough) return false;
        return !diaryEntries.some(e => e.matchId === m.id);
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
        (m.jugadores || []).includes(currentUser.uid)
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
        isFinishedMatch(m) && (m.jugadores || []).includes(currentUser.uid)
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

  const recs = [];

  // Clima
  if (typeof weather !== "undefined" && weather?.current) {
    const code = weather.current.weather_code || 0;
    const wind = weather.current.wind_speed_10m || 0;
    if (code <= 1)
      recs.push(
        "☀️ Hoy el tiempo es soleado, ideal para un partido exterior. ¡Aprovecha!",
      );
    else if (code > 50)
      recs.push(
        "☔ Parece que va a llover. Intenta buscar partidos en pistas cubiertas (Indoor).",
      );

    if (wind > 15) {
      recs.push(
        `🌬️ Viento fuerte hoy (${wind} km/h). Ten cuidado con los globos largos y ajusta tu posicionamiento al viento.`,
      );
    }
  }

  // Partidos
  if (typeof allMatches !== "undefined" && allMatches.length > 0) {
    const now = new Date();
    const todayMatches = allMatches.filter((m) => {
      let d = toDateSafe(m.fecha);
      if (!d) return false;
      return (
        d.getDate() === now.getDate() &&
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
      );
    });
    if (todayMatches.length > 0) {
      recs.push(
        `🎾 Hoy hay mucho movimiento en la red. Hay ${todayMatches.length} partidos programados hoy. ¿Ya tienes el tuyo?`,
      );
    }
  }

  // Tips tácticos
  recs.push(
    "🔥 Mejora tu derecha: mantén la pala alta en la red y flexiona bien las piernas al defender el fondo de pista.",
  );
  recs.push(
    '🧠 Recuerda comunicarte constantemente con tu compañero: "Mía", "Tuya", "Corto", "Largo". La comunicación gana partidos.',
  );
  recs.push(
    '💪 Después de un buen partido, pasa por "DIARIO" y apunta tus sensaciones para sumar puntos VIP a tu ranking.',
  );
  recs.push(
    "🏆 Analiza a tus posibles rivales antes de entrar a pista y crea una táctica. Piensa dónde están sus puntos débiles.",
  );

  const idx = Math.floor(Math.random() * recs.length);
  recomEl.innerHTML = `<span class="animate-fade-in inline-block">${recs[idx]}</span>`;

  // Cambiar recomendación cada pocos segundos de forma cíclica
  if (!window._recomCycleInit) {
    window._recomCycleInit = true;
    setInterval(refreshRecommendations, 12000);
  }
}

/* Notifications */
function bindNotificationNudge() {
  // Inicializamos recomendaciones por primera vez
  refreshRecommendations();
}

function getNormalizedPlayers(match) {
  if (Array.isArray(match?.jugadores) && match.jugadores.length) {
    return [...match.jugadores];
  }
  if (Array.isArray(match?.playerUids) && match.playerUids.length) {
    return [...new Set(match.playerUids)].slice(0, 4);
  }
  return [];
}

function isEventMatch(match) {
  return String(match?.col || "") === "eventoPartidos";
}

function mergeMyEvents(list = []) {
  if (!currentUser?.uid) return;
  myEvents = (list || [])
    .filter((ev) => Array.isArray(ev?.inscritos) && ev.inscritos.some((i) => i?.uid === currentUser.uid))
    .filter((ev) => !["finalizado", "cancelado"].includes(String(ev?.estado || "").toLowerCase()));
  renderEventSpotlight();
  maybeCreateEventDayNotice();
}

function toDateMs(value) {
  const d = toDateSafe(value);
  return d ? d.getTime() : 0;
}

function getMineUpcomingEventMatches() {
  const now = Date.now();
  return allMatches
    .filter((m) => isEventMatch(m))
    .filter((m) => (m.jugadores || []).includes(currentUser?.uid))
    .filter((m) => !isFinishedMatch(m) && !isCancelledMatch(m))
    .filter((m) => toDateMs(m.fecha) >= now - 10 * 60 * 1000)
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
    cards.push(`
      <div class="hv2-event-chip">
        <div class="hv2-event-chip-title">${(nextEvent.nombre || "Evento").toUpperCase()}</div>
        <div class="hv2-event-chip-sub">Estado: ${String(nextEvent.estado || "inscripcion").toUpperCase()} · ${inscritos}/${Number(nextEvent.plazasMax || 16)} inscritos</div>
      </div>
    `);
  }

  if (upcoming.length) {
    upcoming.forEach((m) => {
      const d = toDateSafe(m.fecha);
      const when = d
        ? d.toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
        : "Sin fecha";
      cards.push(`
        <div class="hv2-event-chip" onclick="window.openMatch('${m.id}','${m.col}')">
          <div class="hv2-event-chip-title">PARTIDO EVENTO · ${String(m.phase || "evento").toUpperCase()}</div>
          <div class="hv2-event-chip-sub">${m.teamAName || "TBD"} vs ${m.teamBName || "TBD"} · ${when}</div>
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
    eventId: next.eventoId || null,
  });
}

/* Match data */
async function mergeMatches(col, list) {
  const sig = JSON.stringify(list.map((m) => m.id + m.estado));
  if (colSignature.get(col) === sig) return;
  colSignature.set(col, sig);

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
    if (!date) return false;
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

  if (!homeLoadMeasured && loadedCollections.size >= 1) {
    homeLoadMeasured = true;
    analyticsTiming("home.ttv_ms", performance.now() - homeBootStart);
    completeHomeEntryOverlay();
  }
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
    return `<span class="hv2-sb-player-name ${cls}">${uid ? name : isEvent ? "TBD" : "LIBRE"}</span>`;
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
    list = list
      .filter((m) => !isFinishedMatch(m))
      .filter((m) => (m.jugadores || []).filter(Boolean).length >= 4)
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
  const players = [...(match.jugadores || [])];
  while (players.length < 4) players.push(null);
  const isEvent = isEventMatch(match);
  const isReto = String(match.col || "").includes("Reto");
  const isMine = (match.jugadores || []).includes(currentUser?.uid);
  const finished = isFinishedMatch(match);
  const freeSlots = isEvent ? 0 : players.filter((p) => !p).length;
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
    ? `<span class="hv2-mc-badge ${hasResult ? "closed-badge" : "pending-badge"}">${hasResult ? "CERRADO " + resultStr : "PENDIENTE"}</span>`
    : isEvent
      ? `<span class="hv2-mc-badge open-badge">EVENTO${match.phase ? ` · ${String(match.phase).toUpperCase()}` : ""}</span>`
      : isReto
        ? `<span class="hv2-mc-badge reto-badge">RETO</span>`
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
  const list = document.getElementById("nexus-list");
  const count = document.getElementById("nexus-count");
  if (!list || !count) return;

  count.textContent = `${users.length} CONECTADOS`;

  if (users.length === 0) {
    list.innerHTML = `<div class="text-[9px] opacity-30 italic px-2">No hay otros jugadores conectados ahora.</div>`;
    return;
  }

  list.innerHTML = users
    .map((u) => {
      const isMe = u.id === currentUser?.uid;
      const name = u.nombreUsuario || u.nombre || "Jugador";
      const photo = u.fotoPerfil || u.fotoURL || u.photoURL || "";
      const initials = getInitials(name);

      return `
      <div class="nexus-user ${isMe ? "is-me" : ""}" onclick="window.location.href='perfil.html?uid=${u.id}'">
        <div class="nexus-avatar">
          ${
            photo
              ? `<img src="${photo}" alt="${name}" onerror="this.outerHTML='<span class=&quot;nexus-initials&quot;>${initials}</span>'">`
              : `<span class="nexus-initials">${initials}</span>`
          }
        </div>
        <span class="nexus-uname">${isMe ? "TÚ" : name.split(" ")[0]}</span>
      </div>
    `;
    })
    .join("");
}

window.openNexusModal = () => {
  const modal = document.getElementById("modal-nexus");
  const list = document.getElementById("nexus-modal-list");
  const title = document.getElementById("nexus-modal-title");
  if (!modal || !list) return;

  const isAdmin = currentUserData?.rol === "Admin";
  if (title) title.textContent = `USUARIOS CONECTADOS (${nexusOnlineUsers.length})`;

  if (!nexusOnlineUsers.length) {
    list.innerHTML = `<div class="center py-10 opacity-50">No hay usuarios conectados en este momento.</div>`;
    modal.classList.add("active");
    return;
  }

  const onlineHtml = nexusOnlineUsers
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
            <span class="nexus-modal-meta">${isAdmin ? `Último acceso: ${lastTxt}` : "Conectado recientemente"}</span>
          </div>
        </div>
      `;
    })
    .join("");

  let offlineHtml = "";
  if (isAdmin) {
    const onlineIds = new Set(nexusOnlineUsers.map((u) => u.id));
    const offlineUsers = nexusAllUsers
      .filter((u) => !onlineIds.has(u.id))
      .sort((a, b) => (b.ultimoAcceso?.seconds || 0) - (a.ultimoAcceso?.seconds || 0));
    offlineHtml = `
      <div class="nexus-modal-divider">Usuarios no conectados (${offlineUsers.length})</div>
      ${
        offlineUsers
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
          .join("") || '<div class="text-[10px] opacity-40 p-2">Sin usuarios offline.</div>'
      }
    `;
  }

  list.innerHTML = onlineHtml + offlineHtml;

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

// Ensure cleanup includes Nexus
const originalCleanup = cleanup;
cleanup = () => {
  originalCleanup();
  if (typeof unsubNexus === "function") unsubNexus();
  unsubNexus = null;
};







