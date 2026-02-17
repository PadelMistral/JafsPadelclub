import {
  db,
  auth,
  observerAuth,
  subscribeDoc,
  getDocument,
  updatePresence,
} from "./firebase-service.js";
import { renderMatchDetail } from "./match-service.js";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  where,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI, countUp, showToast } from "./ui-core.js";
import { calculateCourtCondition } from "./utils/weather-utils.js";
import { getDetailedWeather, getDailyTip } from "./external-data.js";
import { initGalaxyBackground } from "./modules/galaxy-bg.js?v=6.5";
import {
  updateHeader,
  injectHeader,
  injectNavbar,
  showLoading,
  hideLoading,
} from "./modules/ui-loader.js?v=6.5";
import { initAutoNotifications } from "./services/notification-service.js";
import { requestNotificationPermission } from "./modules/push-notifications.js";

let currentUser = null;
let userData = null;
let allMatches = [];
let weatherForecast = null;
let openMatchesCache = [];
let homePresenceInterval = null;
let homeRefreshInterval = null;
let homeUserDocUnsub = null;
let homeBootUid = null;
let lastOnlineRefreshAt = 0;
const PROVISIONAL_MATCHES = 5;
const userProfileCache = new Map();
const shownNotifToastIds = new Set();
let notifToastBaselineReady = false;

function safeAuthRedirect(url) {
  if (window.__appRedirectLock) return;
  window.__appRedirectLock = true;
  window.location.replace(url);
}

/* DUPLICATE WELCOME_PHRASES DISABLED (cleaned) */

function calculateBasePoints(level) {
  const l = parseFloat(level) || 2.5;
  const pts = Math.round(1000 + (l - 2.5) * 400);
  console.log(`Calculando puntos base para nivel ${l}: ${pts}`);
  return pts;
}

function toDateSafe(value) {
  if (!value) return new Date();
  if (typeof value.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function formatHour(date) {
  return `${date.getHours()}:${date.getMinutes().toString().padStart(2, "0")}`;
}

function shortPlayerName(name) {
  if (!name) return "JUGADOR";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((t) => t.toUpperCase())
    .join(" ");
}

function buildTeamLabel(team) {
  const filled = team.filter((p) => !p.isEmpty);
  if (!filled.length) return "PLAZAS LIBRES";
  return filled.map((p) => shortPlayerName(p.name)).join(" + ");
}

function buildCompactRoster(players) {
  return players
    .map((p) => {
      const cls = [
        "match-roster-chip-v12",
        p.isEmpty ? "empty" : "",
        p.isMe ? "me" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const text = p.isEmpty
        ? "Libre"
        : `${shortPlayerName(p.name)}${p.isGuest ? " · INV" : ` · ${Number(p.level || 2.5).toFixed(2)}`}`;
      return `<span class="${cls}">${text}</span>`;
    })
    .join("");
}

function getWeatherAnimClass(code) {
  if (code <= 3) return "weather-anim-sun";
  if (code <= 48) return "weather-anim-cloud";
  if (code <= 82) return "weather-anim-rain";
  return "weather-anim-storm";
}

function buildWeatherPill(date, compact = false) {
  if (!weatherForecast?.hourly) return "";
  const hourIdx = weatherForecast.hourly.time.findIndex((t) => {
    const tDate = new Date(t);
    return tDate.getDate() === date.getDate() && tDate.getHours() === date.getHours();
  });
  if (hourIdx === -1) return "";

  const temp = Math.round(weatherForecast.hourly.temperature_2m[hourIdx]);
  const code = weatherForecast.hourly.weather_code[hourIdx];
  const icon = getIconFromCode(code);
  const animClass = getWeatherAnimClass(code);
  const compactClass = compact ? "compact" : "";
  return `<span class="match-weather-pill ${animClass} ${compactClass}"><i class="fas ${icon} match-weather-icon"></i><span>${temp}°</span></span>`;
}

async function getCachedUserProfile(uid) {
  if (!uid || uid.startsWith("GUEST_")) return null;
  if (userProfileCache.has(uid)) return userProfileCache.get(uid);

  const raw = await getDocument("usuarios", uid);
  const profile = {
    id: uid,
    name: raw?.nombreUsuario || raw?.nombre || "Jugador",
    level: Number(raw?.nivel || 2.5),
    photo: raw?.fotoPerfil || raw?.fotoURL || "./imagenes/Logojafs.png",
    role: raw?.rol || "Jugador",
    points: Math.round(Number(raw?.puntosRanking || 1000)),
    streak: Number(raw?.rachaActual || 0),
    wins: Number(raw?.victorias || 0),
    matches: Number(raw?.partidosJugados || 0),
    winRate: Number(raw?.partidosJugados || 0) > 0
      ? Math.round((Number(raw?.victorias || 0) / Number(raw?.partidosJugados || 1)) * 100)
      : 50,
  };
  userProfileCache.set(uid, profile);
  return profile;
}

async function getDetailedMatchSlots(match) {
  const slots = [...(match?.jugadores || [])];
  while (slots.length < 4) slots.push(null);
  const normalized = slots.slice(0, 4);

  return Promise.all(
    normalized.map(async (uid) => {
      if (!uid) {
        return {
          id: null,
          name: "Libre",
          level: null,
          photo: "./imagenes/Logojafs.png",
          isEmpty: true,
          isGuest: false,
          isMe: false,
        };
      }

      if (uid.startsWith("GUEST_")) {
        return {
          id: uid,
          name: uid.split("_")[1] || "Invitado",
          level: null,
          photo: "./imagenes/Logojafs.png",
          isEmpty: false,
          isGuest: true,
          isMe: false,
        };
      }

      const profile = await getCachedUserProfile(uid);
      return {
        ...profile,
        isEmpty: false,
        isGuest: false,
        isMe: uid === currentUser?.uid,
      };
    }),
  );
}

function getPendingMatchesCount() {
  if (!currentUser?.uid || !Array.isArray(allMatches)) return 0;
  const now = new Date();
  return allMatches.filter((m) => {
    const isMine = Array.isArray(m.jugadores) && m.jugadores.includes(currentUser.uid);
    if (!isMine) return false;
    const state = String(m.estado || "").toLowerCase();
    const isClosed = state === "jugado" || state === "cancelado" || state === "anulado";
    if (isClosed) return false;
    const when = toDateSafe(m.fecha);
    return when > new Date(now.getTime() - 2 * 60 * 60 * 1000);
  }).length;
}

function updateWelcomePendingMetric() {
  const pendingEl = document.getElementById("welcome-pending");
  if (pendingEl) pendingEl.textContent = String(getPendingMatchesCount());
}

// Real Online Count Logic - Only counts users active in the last 5 minutes (Real-time)
async function injectOnlineCount() {
  try {
    const threshold = new Date(Date.now() - 5 * 60 * 1000);
    const q = query(
      collection(db, "usuarios"),
      where("ultimoAcceso", ">", threshold),
      limit(100),
    );
    const snap = await window.getDocsSafe(q);
    const onlineCount = snap.docs.length;

    const el = document.getElementById("online-count-display");
    const elLibrary = document.getElementById("online-count-library");
    if (el) {
      el.innerHTML = `
        <button type="button" class="welcome-online-link" aria-label="Abrir Nexus online">
          <span class="welcome-online-dot-stack" aria-hidden="true">
            <span class="welcome-online-dot-pulse"></span>
            <span class="welcome-online-dot-core"></span>
          </span>
          <span class="welcome-online-label">ONLINE</span>
          <span class="welcome-online-count">${onlineCount}</span>
          <span class="welcome-online-small">jugadores</span>
        </button>
      `;
      el.style.cursor = "pointer";
      el.onclick = () => {
        if (typeof window.showOnlineNexus === "function") {
          window.showOnlineNexus();
          return;
        }
        if (typeof window.showOnlineUsers === "function") {
          window.showOnlineUsers();
        }
      };
    }
    if (elLibrary) {
      elLibrary.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-sport-green animate-pulse"></span> ${onlineCount} ONLINE`;
    }
  } catch (e) {
    console.error("Error detecting online players:", e);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // AUTO-CLEAN CACHE ON HARD RELOAD OR VERSION MISMATCH
  if (localStorage.getItem('app_version') !== '7.0') {
      console.log("Actualizando versiÃ³n... Limpiando cachÃ©.");
      sessionStorage.clear();
      localStorage.setItem('app_version', '7.0');
  }

  initAppUI("home");
  injectOnlineCount();
  lastOnlineRefreshAt = Date.now();

  observerAuth(async (user) => {
    if (!user) {
      if (homeUserDocUnsub) {
        try { homeUserDocUnsub(); } catch (_) {}
        homeUserDocUnsub = null;
      }
      homeBootUid = null;
      safeAuthRedirect("index.html");
      return;
    }

    let ud = null;
    try {
        ud = await getDocument('usuarios', user.uid);
    } catch (e) {
        console.error("Auth Observer Error:", e);
    }

    if (!ud) {
        console.warn("Perfil no encontrado o error de red. Manteniendo sesiÃ³n...");
        showToast("Sincronizando...", "Verificando credenciales en la Matrix", "info");
        // Do NOT redirect here to avoid ghost redirects on network glitches
        // Just let it try again or fail gracefully on UI
        // But we need 'userData' for the app.
        // We can retry or just return.
        return; 
    }

    const isApproved = ud.status === 'approved' || ud.rol === 'Admin';
    if (!isApproved) {
       console.warn("Usuario no aprobado. Acceso denegado.");
       showToast("ACCESO DENEGADO", "Tu cuenta estÃ¡ pendiente de aprobaciÃ³n.", "warning");
       setTimeout(async () => {
           await auth.signOut();
           safeAuthRedirect('index.html?msg=pending');
       }, 2000); // Give time to read toast
		   return;
	    }

	    if (homeBootUid === user.uid) return;
	    homeBootUid = user.uid;

	    currentUser = user;
	    userData = ud;

    const { showLoading, hideLoading, injectHeader, injectNavbar } =
      await import("./modules/ui-loader.js?v=6.5");

    // Only show loader if initial_load_done is not set to 'true'
    let isFirstLoad = !sessionStorage.getItem("initial_load_done");
    if (isFirstLoad) showLoading("Sincronizando con la Galaxia...");

    currentUser = user;

    // Update presence on every load
    const { updatePresence } = await import("./firebase-service.js");
    updatePresence(user.uid);
    if (homePresenceInterval) clearInterval(homePresenceInterval);
    homePresenceInterval = setInterval(() => updatePresence(user.uid), 5 * 60 * 1000);

    // Init Auto Notifications System (V7.0) - Unified Service
    initAutoNotifications(user.uid);

    // Listen to user data changes - Optimization: only update UI, don't re-init components
    let lastDataString = "";
    if (homeUserDocUnsub) {
      try { homeUserDocUnsub(); } catch (_) {}
      homeUserDocUnsub = null;
    }
    homeUserDocUnsub = subscribeDoc("usuarios", user.uid, async (data) => {
      if (data) {
        const dataStr = JSON.stringify({ n: data.nivel, p: data.puntosRanking, r: data.rachaActual });
        if (dataStr === lastDataString) return; // Prevent unnecessary re-renders
        lastDataString = dataStr;

        userData = data;
        updateDashboard(data);
        
        // One-time Initializations
        if (isFirstLoad) {
            initMatrixFeed();
            renderHallOfFame(data);
            injectHeader(data);
            injectNavbar("home");
            updateEcosystemHealth();
            requestNotificationPermission();
            setupStatInteractions();
            syncRivalIntelligence(user.uid);
            renderOpenMatches(); // New function
            
            // Personalized welcome toast
            const welcomeName = localStorage.getItem("first_login_welcome");
            if (welcomeName) {
                showToast(`Â¡BIENVENIDO, ${welcomeName.toUpperCase()}!`, "Tu panel de control estÃ¡ listo.", "success");
                localStorage.removeItem("first_login_welcome");
            }
            
            // Initial Orchestrator Sync
            import('./ai-orchestrator.js').then(m => m.AIOrchestrator.init(user.uid));
            
            setTimeout(hideLoading, 1200);
            sessionStorage.setItem("initial_load_done", "true");
            isFirstLoad = false;
        } else {
            updateHeader(data); // Lightweight update
        }
      }
    });

    await loadMatches();
    const podiumRefresh = await renderVerticalPodium();
    
    // Auto-refresh dynamic data
    if (homeRefreshInterval) clearInterval(homeRefreshInterval);
    homeRefreshInterval = setInterval(() => {
        if (Date.now() - lastOnlineRefreshAt >= 5 * 60 * 1000) {
          injectOnlineCount();
          lastOnlineRefreshAt = Date.now();
        }
        renderOpenMatches();
    }, 60000);
  });

  // Filter tabs logic...
  window.filterFeed = (type) => renderMatchFeed(type);
});

async function updateDashboard(data) {
  if (!data) {
    console.warn("No user data found in Firestore");
    const nameEl = document.getElementById("user-name");
    if (nameEl) nameEl.textContent = "NUEVO JUGADOR";
    return;
  }
  
  // Phase 5: Render Active Mode
  renderActiveMode(data);

  // Greeting based on time
  const hour = new Date().getHours();
  let greet = "BUENOS DIAS";
  if (hour >= 14 && hour < 21) greet = "BUENAS TARDES";
  else if (hour >= 21 || hour < 5) greet = "BUENAS NOCHES";

  const userNameEl = document.getElementById("user-name");
  const greetingEl = document.getElementById("greeting-text");
  const welcomeAvatarEl = document.getElementById("welcome-avatar");

  const displayName =
    data.nombreUsuario || data.nombre || currentUser?.displayName || "Jugador";
  if (userNameEl) userNameEl.textContent = displayName.toUpperCase();
  if (greetingEl) greetingEl.textContent = greet;
  if (welcomeAvatarEl) {
    welcomeAvatarEl.src =
      data.fotoPerfil || data.fotoURL || currentUser?.photoURL || "./imagenes/Logojafs.png";
    welcomeAvatarEl.alt = `Avatar de ${displayName}`;
  }

  // Stats
  const wins = Number(data.victorias || 0);
  const played = Number(data.partidosJugados || 0);
  const levelNum = Number(data.nivel || 2.5);
  const level = levelNum.toFixed(1);
  const levelPrecise = levelNum.toFixed(2);
  const winrate = played > 0 ? Math.round((wins / played) * 100) : 0;

  // Points & Rank Status
  const currentPts =
    data.puntosRanking !== undefined
      ? Number(data.puntosRanking)
      : Number(calculateBasePoints(data.nivel));
  const currentRank = data.posicionRanking || '--';
  const rankEl = document.getElementById("user-rank");
  const rankTotalEl = document.getElementById("user-rank-total");
  const pointsDisplayEl = document.getElementById("welcome-points");
  const lvlDisplayEl = document.getElementById("welcome-level");
  const pendingDisplayEl = document.getElementById("welcome-pending");
  const ptsEl = document.getElementById("stat-pts");
  const winsEl = document.getElementById("stat-wins");
  const matchesEl = document.getElementById("stat-matches");
  const wrEl = document.getElementById("stat-winrate");
  const lvlEl = document.getElementById("stat-level");
  const currentElo = Math.round(Number(data.elo || currentPts));
  const pendingMatches = getPendingMatchesCount();

  if (rankEl) rankEl.textContent = `#${currentRank}`;
  if (rankTotalEl) rankTotalEl.textContent = "de --";
  if (pointsDisplayEl) pointsDisplayEl.textContent = `${Math.round(currentPts)}`;
  if (lvlDisplayEl) lvlDisplayEl.textContent = levelPrecise;
  if (pendingDisplayEl) pendingDisplayEl.textContent = `${pendingMatches}`;

  // Trend logic from Logs
  try {
    const logsSnap = await window.getDocsSafe(query(
        collection(db, "rankingLogs"),
        where("uid", "==", currentUser.uid),
        orderBy("timestamp", "desc"),
        limit(2)
    ));
    if (!logsSnap.empty) {
        const latest = logsSnap.docs[0].data();
        const trendEl = document.getElementById("user-rank-trend");
        const lvlTrendEl = document.getElementById("welcome-level-trend");

        // Level Trend
        if (lvlTrendEl && latest.details?.levelAfter && latest.details?.levelBefore) {
            const lDiff = latest.details.levelAfter - latest.details.levelBefore;
            if (lDiff > 0) {
                lvlTrendEl.className = "up";
                lvlTrendEl.innerHTML = '<i class="fas fa-caret-up"></i>';
            } else if (lDiff < 0) {
                lvlTrendEl.className = "down";
                lvlTrendEl.innerHTML = '<i class="fas fa-caret-down"></i>';
            }
        }

        // Rank Trend (Approx from last net diff)
        if (trendEl && latest.diff !== undefined) {
             if (latest.diff > 0) {
                trendEl.className = "welcome-trend-pill up";
                trendEl.innerHTML = '<i class="fas fa-arrow-up mr-1"></i> SUBE';
             } else if (latest.diff < 0) {
                trendEl.className = "welcome-trend-pill down";
                trendEl.innerHTML = '<i class="fas fa-arrow-down mr-1"></i> BAJA';
             }
        }
    }
  } catch(e) { console.warn("Trend sync error:", e); }

  if (ptsEl) countUp(ptsEl, Number(currentPts));
  if (winsEl) winsEl.textContent = wins;
  if (matchesEl) matchesEl.textContent = played;
  if (wrEl) wrEl.textContent = `${winrate}%`;
  if (lvlEl) lvlEl.textContent = level;

  // Level Progress (Home) - Optimized V9.0
  const lvlNum = levelNum || 2.5;
  const currentBracket = Math.floor(lvlNum * 2) / 2;
  const progress = ((lvlNum - currentBracket) / 0.5) * 100;
  const prevStep = Math.max(1, Number((lvlNum - 0.01).toFixed(2)));
  const nextStep = Number((lvlNum + 0.01).toFixed(2));
  const pointsToUp01 = Math.max(1, Math.ceil((nextStep - lvlNum) * 400));
  const pointsToDown01 = Math.max(1, Math.ceil((lvlNum - prevStep) * 400));

  const homeBar = document.getElementById("home-level-bar");
  const homePts = document.getElementById("home-level-points");
  const homeLower = document.getElementById("home-level-lower");
  const homeCurrent = document.getElementById("home-level-current");
  const homeUpper = document.getElementById("home-level-upper");

  if (homeBar) homeBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
  if (homePts) {
    homePts.innerHTML = `
      <span class="lvl-shift-chip up">+${pointsToUp01} PTS · NV ${nextStep.toFixed(2)}</span>
      <span class="lvl-shift-chip down">-${pointsToDown01} PTS · NV ${prevStep.toFixed(2)}</span>
    `;
  }
  if (homeLower) homeLower.textContent = prevStep.toFixed(2);
  if (homeCurrent) homeCurrent.textContent = `NIVEL ${lvlNum.toFixed(2)}`;
  if (homeUpper) homeUpper.textContent = nextStep.toFixed(2);

  // Get rank
  window.getDocsSafe(
    query(
      collection(db, "usuarios"),
      orderBy("puntosRanking", "desc"),
    ),
  ).then((snap) => {
    const total = snap.size || 0;
    const rank = snap.docs.findIndex((d) => d.id === currentUser.uid) + 1;
    const rankEl = document.getElementById("user-rank");
    const rankTotalEl = document.getElementById("user-rank-total");
    if (rankEl) {
      rankEl.textContent = rank > 0 ? `#${rank}` : `#${currentRank || "-"}`;
      rankEl.classList.add("text-primary");
    }
    if (rankTotalEl) rankTotalEl.textContent = total > 0 ? `de ${total}` : "de --";
  });

  // XP & Achievements
  if (typeof renderXpWidget === "function")
    renderXpWidget("xp-widget-container", data);
  if (typeof renderAchievements === "function")
    renderAchievements("achievements-list", data);

  // Stats Horizontal Horizontal (Top)
  const streakNum = data.rachaActual || 0;
  const streakEl = document.getElementById("stat-streak");
  if (streakEl) {
    streakEl.textContent = Math.abs(streakNum);
    streakEl.style.color = streakNum >= 0 ? "var(--sport-green)" : "var(--sport-red)";
  }

  // ADN / PlayerState
  const state = data.playerState || {};
  const dnaStyle = document.getElementById("dna-style");
  const dnaMood = document.getElementById("dna-mood");
  if (dnaStyle) dnaStyle.textContent = (state.qualitative?.style || "ANALIZANDO...").toUpperCase();
  if (dnaMood) dnaMood.textContent = (state.qualitative?.emotionalTrend || "ESTABLE").toUpperCase();

  // AI Welcome Box (ReferenceError Fixed)
  const aiBox = document.getElementById("ai-welcome-box");
  if (aiBox) {
    const quoteEl = aiBox.querySelector(".ai-quote");
    const insightMetaEl = aiBox.querySelector("#ai-insight-meta");
    const nameBrief = (data.nombreUsuario || "Jugador").split(" ")[0];

    const hour = new Date().getHours();
    let intro = "Buenos dias";
    if (hour >= 14 && hour < 21) intro = "Buenas tardes";
    else if (hour >= 21 || hour < 5) intro = "Buenas noches";

    const tips = [
      `Rival Intel analiza a tu nemesis y tu mejor socio de juego.`,
      `La IA predice resultados segun clima, nivel y estado reciente.`,
      `Registra tus partidos en el Diario para mejorar tus recomendaciones.`,
      `Puedes pedirme tacticas para rivales concretos antes de jugar.`,
      `Tu panel IA cruza ranking, racha y nivel para darte objetivos.`
    ];
    const tip = data.aiProfile?.dailyTip || tips[Math.floor(Math.random() * tips.length)];
    if (quoteEl) quoteEl.textContent = `${intro}, ${nameBrief}. ${tip}`;

    if (insightMetaEl) {
      const myUpcoming = allMatches.filter((m) => m.jugadores?.includes(currentUser.uid)).length;
      const rankTxt = rankEl?.textContent || `#${currentRank || "--"}`;
      insightMetaEl.textContent = `${rankTxt} · ELO ${Math.round(currentPts)} · ${myUpcoming} partido(s) en agenda`;
    }

    aiBox.onclick = async () => {
      const fab = document.getElementById("vecina-chat-fab");
      if (fab) fab.click();
      else {
          const { toggleChat } = await import("./modules/vecina-chat.js?v=6.5");
          toggleChat();
      }
    };
  }

  // Rival Intelligence Sync
  syncRivalIntelligence(currentUser?.uid || data.uid);

  // Analysis section updates - Tip Box / Events Box
  const tipBox = document.getElementById("tip-box");
  if (tipBox) {
    const nextMatch = allMatches.find((m) =>
      m.jugadores?.includes(currentUser.uid),
    );

    if (nextMatch) {
      tipBox.innerHTML = `
                <i class="fas fa-brain text-xl text-accent mb-1"></i>
                <span class="font-bold text-xs text-white uppercase">ESTRATEGIA</span>
                <span class="text-xs text-muted">PrepÃ¡rate para el reto</span>
            `;
      tipBox.onclick = () =>
        showToast("TÃ¡ctica", `EnfÃ³cate en tu juego hoy.`, "info");
    } else {
      tipBox.innerHTML = `
                <i class="fas fa-calendar-star text-xl text-primary mb-1"></i>
                <span class="font-bold text-xs text-white uppercase">EVENTOS</span>
                <span class="text-xs text-muted">Ver prÃ³ximos eventos</span>
            `;
      tipBox.onclick = () => (window.location.href = "eventos.html");
    }
  }
}

async function loadLastResult() {
  try {
    const logs = await window.getDocsSafe(
      query(
        collection(db, "rankingLogs"),
        where("uid", "==", currentUser.uid),
        orderBy("timestamp", "desc"),
        limit(1),
      ),
    );

    const box = document.getElementById("last-match-box");
    if (!box) return;

    if (!logs.empty) {
      const log = logs.docs[0].data();
      const badge = document.getElementById("last-result-badge");
      const score = document.getElementById("last-score");
      const pts = document.getElementById("last-pts-diff");
      const dateEl = document.getElementById("last-date");

      const won = log.diff >= 0;
      box.style.display = "block";
      if (badge) {
        badge.textContent = won ? "Victoria" : "Derrota";
        badge.className = `status-badge ${won ? "badge-green" : "badge-orange"}`;
      }
      if (pts) {
        pts.textContent = `${won ? "+" : ""}${log.diff}`;
        pts.className = won
          ? "text-sport-green font-bold"
          : "text-danger font-bold";
      }

      if (log.matchId) {
        const match =
          (await getDocument("partidosReto", log.matchId)) ||
          (await getDocument("partidosAmistosos", log.matchId));
        if (score && match?.resultado?.sets)
          score.textContent = match.resultado.sets;
        if (dateEl && match?.fecha) {
          const d = match.fecha.toDate();
          dateEl.textContent = d.toLocaleDateString("es-ES", {
            weekday: "short",
            day: "numeric",
            month: "short",
          });
        }
      }
    } else {
      box.style.display = "none";
    }
  } catch (e) {
    console.error("Error loading last result:", e);
  }
}

async function loadMatches() {
  const [am, re] = await Promise.all([
    window.getDocsSafe(collection(db, "partidosAmistosos")),
    window.getDocsSafe(collection(db, "partidosReto")),
  ]);

  let list = [];
  am.forEach((d) =>
    list.push({
      id: d.id,
      col: "partidosAmistosos",
      isComp: false,
      ...d.data(),
    }),
  );
  re.forEach((d) =>
    list.push({ id: d.id, col: "partidosReto", isComp: true, ...d.data() }),
  );

  // Deduplicate by collection+id
  const seen = new Set();
  list = list.filter((m) => {
    const key = `${m.col}:${m.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const now = new Date();
  // Filter matches that are played or too old (more than 2 hours ago)
  list = list.filter(
    (m) =>
      m.estado !== "jugado" &&
      (m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha)) >
        new Date(now - 7200000),
  );
  list.sort(
    (a, b) =>
      (a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha)) -
      (b.fecha?.toDate ? b.fecha.toDate() : new Date(b.fecha)),
  );

  allMatches = list;
  const myMatches = list.filter((m) => m.jugadores?.includes(currentUser.uid));
  const myNext = myMatches[0];
  updateWelcomePendingMetric();

  renderNextMatch(myNext);
  renderUpcomingMatches(myMatches.slice(1));
  renderMatchFeed("all");
}

/* Unified Match Renderer V11 */
async function createMatchCardV10(match, idx = 0, context = "default") {
  const date = toDateSafe(match.fecha);
  const filledPlayers = (match.jugadores || []).filter((id) => id).length;
  const slots = Math.max(0, 4 - filledPlayers);
  const isComp = match.col === "partidosReto" || match.isComp;
  const lvlMin = match.restriccionNivel?.min || 2.0;
  const lvlMax = match.restriccionNivel?.max || 6.0;
  const typeLabel = isComp ? "RETO ELO" : "AMISTOSO";
  const weatherHTML = buildWeatherPill(date);
  const players = await getDetailedMatchSlots(match);
  const creatorUser = await getCachedUserProfile(match.creador);
  const creatorName = creatorUser?.name || "Atleta";
  const courtName = (match.courtType || "CENTRAL").toUpperCase();
  const surfaceName = (match.surface || "PADEL").toUpperCase();

  const predictionHTML =
    match.preMatchPrediction?.winProbability !== undefined
      ? `<div class="ai-prediction-badge">
           <i class="fas fa-brain animate-pulse text-primary"></i>
           <span>${Math.round(match.preMatchPrediction.winProbability)}%</span>
         </div>`
      : `<div class="ai-prediction-badge opacity-30">
           <i class="fas fa-robot text-muted"></i>
           <span>--%</span>
         </div>`;

  const statusCls = slots === 0 ? "status-full" : slots === 1 ? "status-urgent" : "status-open";
  const statusText = slots === 0 ? "SQUAD CERRADO" : slots === 1 ? "ÚLTIMA PLAZA" : `${slots} PLAZAS LIBRES`;

  return `
    <div class="match-card-premium-v12 ${context === "next" ? "special-next" : ""} animate-up" 
         style="animation-delay:${idx * 0.05}s;" 
         onclick="openMatch('${match.id}', '${match.col}')">
      
      <div class="m-v12-header">
        <div class="m-v12-type-tag ${isComp ? "reto" : "amistoso"}">
          <i class="fas ${isComp ? "fa-bolt" : "fa-handshake"}"></i>
          <span>${typeLabel}</span>
        </div>
        <div class="m-v12-weather-box">${weatherHTML}</div>
      </div>

      <div class="m-v12-time-row">
        <span class="m-v12-hour">${formatHour(date)}</span>
        <span class="m-v12-date-box">${date.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}</span>
      </div>

      <div class="m-v12-battle-field">
         <div class="m-v12-team">
            <div class="m-v12-avatars">
               <img src="${players[0]?.photo}" class="m-v12-avatar ${players[0]?.isEmpty ? "empty" : ""}">
               <img src="${players[1]?.photo}" class="m-v12-avatar ${players[1]?.isEmpty ? "empty" : ""}">
            </div>
            <span class="m-v12-team-names">${shortPlayerName(players[0]?.name)} + ${shortPlayerName(players[1]?.name)}</span>
         </div>
         
         <div class="m-v12-vs-node">VS</div>

         <div class="m-v12-team right">
            <div class="m-v12-avatars justify-end">
               <img src="${players[2]?.photo}" class="m-v12-avatar ${players[2]?.isEmpty ? "empty" : ""}">
               <img src="${players[3]?.photo}" class="m-v12-avatar ${players[3]?.isEmpty ? "empty" : ""}">
            </div>
            <span class="m-v12-team-names">${shortPlayerName(players[2]?.name)} + ${shortPlayerName(players[3]?.name)}</span>
         </div>
      </div>

      <div class="m-v12-meta-grid">
         <div class="m-v12-meta-item">
            <i class="fas fa-location-dot"></i>
            <span>${courtName}</span>
         </div>
         <div class="m-v12-meta-item">
            <i class="fas fa-layer-group"></i>
            <span>${surfaceName}</span>
         </div>
         <div class="m-v12-meta-item status ${statusCls}">
            <div class="status-dot"></div>
            <span>${statusText}</span>
         </div>
      </div>

      <div class="m-v12-footer">
        <div class="m-v12-host">
           <span class="label">HOST</span>
           <span class="val">@${shortPlayerName(creatorName).split(" ")[0]}</span>
        </div>
        <div class="m-v12-level flex-row gap-1">
           <span class="label">NIVEL</span>
           <span class="val">${lvlMin.toFixed(1)}-${lvlMax.toFixed(1)}</span>
        </div>
        ${predictionHTML}
      </div>
    </div>
  `;
}

async function createOpenMatchCardV11(match, idx = 0) {
  const date = toDateSafe(match.fecha);
  const isComp = match.col === "partidosReto" || match.isComp;
  const typeLabel = isComp ? "RETO" : "AMISTOSO";
  const weatherHTML = buildWeatherPill(date, true);
  const players = await getDetailedMatchSlots(match);
  const teamA = players.slice(0, 2);
  const teamB = players.slice(2, 4);
  const filled = (match.jugadores || []).filter((id) => id).length;
  const slots = Math.max(0, 4 - filled);
  const levelMin = Number(match.restriccionNivel?.min ?? 2.0);
  const levelMax = Number(match.restriccionNivel?.max ?? 6.0);
  const slotText = slots === 1 ? "ULTIMA PLAZA" : `${slots} PLAZAS`;

  const avatarNode = (player) => `
    <img
      src="${player?.photo || "./imagenes/Logojafs.png"}"
      alt="${shortPlayerName(player?.name)}"
      class="open-netflix-avatar ${player?.isEmpty ? "empty" : ""}"
      loading="lazy"
    >
  `;

  return `
    <article class="open-netflix-card animate-fade-in" style="animation-delay:${idx * 0.04}s;" onclick="openMatch('${match.id}', '${match.col}')">
      <div class="open-netflix-top">
        <span class="open-netflix-type ${isComp ? "reto" : "amistoso"}">${typeLabel}</span>
        <span class="open-netflix-weather">${weatherHTML || '<span class="open-netflix-weather-fallback"><i class="fas fa-cloud"></i> --</span>'}</span>
      </div>
      <div class="open-netflix-hour">${formatHour(date)}</div>
      <div class="open-netflix-date">${date.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}</div>

      <div class="open-netflix-duel">
        <div class="open-netflix-side">
          <div class="open-netflix-avatars">
            ${avatarNode(teamA[0])}
            ${avatarNode(teamA[1])}
          </div>
          <span class="open-netflix-name">${buildTeamLabel(teamA)}</span>
        </div>
        <span class="open-netflix-vs">VS</span>
        <div class="open-netflix-side right">
          <div class="open-netflix-avatars right">
            ${avatarNode(teamB[0])}
            ${avatarNode(teamB[1])}
          </div>
          <span class="open-netflix-name">${buildTeamLabel(teamB)}</span>
        </div>
      </div>

      <div class="open-netflix-foot">
        <span class="open-netflix-slot ${slots <= 1 ? "urgent" : ""}">${slotText}</span>
        <span class="open-netflix-level">NV ${levelMin.toFixed(1)}-${levelMax.toFixed(1)}</span>
      </div>
    </article>
  `;
}

async function createUpcomingMiniItem(match, idx = 0) {
  const date = toDateSafe(match.fecha);
  const isComp = match.col === "partidosReto" || match.isComp;
  const players = await getDetailedMatchSlots(match);
  const teamA = players.slice(0, 2);
  const teamB = players.slice(2, 4);
  const sideA = buildTeamLabel(teamA);
  const sideB = buildTeamLabel(teamB);
  const weatherHTML = buildWeatherPill(date, true);
  const filled = (match.jugadores || []).filter((id) => id).length;
  const slots = Math.max(0, 4 - filled);

  return `
    <div class="upcoming-mini-v12 animate-fade-in" style="animation-delay:${idx * 0.03}s" onclick="openMatch('${match.id}', '${match.col}')">
      <div class="up-mini-time">${formatHour(date)} ${weatherHTML}</div>
      <div class="up-mini-duel">
        <span class="up-mini-team">${sideA}</span>
        <span class="up-mini-vs">VS</span>
        <span class="up-mini-team right">${sideB}</span>
      </div>
      <div class="up-mini-meta">
        <span>${date.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}</span>
        <span>${isComp ? "RETO" : "AMISTOSO"}</span>
        <span class="${slots === 0 ? "filled" : ""}">${slots === 0 ? "COMPLETO" : `${slots} HUECOS`}</span>
      </div>
    </div>
  `;
}

window.scrollOpenMatches = (direction = 1) => {
  const container = document.getElementById("open-matches-panel");
  if (!container) return;
  const step = Math.max(240, container.clientWidth);
  container.scrollBy({
    left: step * (direction >= 0 ? 1 : -1),
    behavior: "smooth",
  });
};

function updateOpenMatchesControls(totalOpen) {
  const moreBtn = document.getElementById("open-matches-more-btn");
  const hintEl = document.getElementById("open-matches-hint");
  const prevBtn = document.getElementById("open-matches-prev-btn");
  const nextBtn = document.getElementById("open-matches-next-btn");
  const canScroll = totalOpen > 2;

  if (moreBtn) moreBtn.style.display = totalOpen > 4 ? "inline-flex" : "none";
  if (hintEl) hintEl.classList.toggle("hidden", totalOpen <= 2);

  [prevBtn, nextBtn].forEach((btn) => {
    if (!btn) return;
    btn.disabled = !canScroll;
    btn.classList.toggle("disabled", !canScroll);
  });
}

window.showAllOpenMatches = async () => {
  if (!openMatchesCache.length) {
    showToast("Partidos abiertos", "No hay partidos abiertos disponibles ahora mismo.", "info");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay active";
  overlay.style.zIndex = "10020";
  overlay.innerHTML = `
    <div class="modal-card glass-strong animate-up" style="max-width: 540px; max-height: 85vh; overflow: hidden;">
      <div class="modal-header">
        <div class="flex-col">
          <h3 class="modal-title font-black text-primary tracking-widest italic">PARTIDOS ABIERTOS</h3>
          <span class="text-[10px] text-muted font-bold uppercase tracking-[3px]">${openMatchesCache.length} disponibles</span>
        </div>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <div id="open-matches-full-list" class="modal-body custom-scroll p-4 flex-col gap-3" style="max-height: 72vh;">
        <div class="center py-10 opacity-30"><i class="fas fa-circle-notch fa-spin"></i></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const listContainer = overlay.querySelector("#open-matches-full-list");
  const html = await Promise.all(openMatchesCache.map((m, i) => createMatchCardV10(m, i, "openlist")));
  listContainer.innerHTML = html.join("");

  listContainer.addEventListener("click", (e) => {
    if (e.target.closest(".match-card-premium-v12")) overlay.remove();
  });
};

function isProvisionalPlayer(player) {
  if (!player || player.isEmpty) return false;
  return Number(player.matches || 0) < PROVISIONAL_MATCHES;
}

function getPlayerAnalysisLevel(player) {
  if (!player || player.isEmpty) return 2.5;
  const rawLevel = Number(player.level || 2.5);
  const byPoints = 2.5 + ((Number(player.points || 1000) - 1000) / 420);
  const wr = Number(player.winRate || 50);
  const byWinRate = 2.5 + ((wr - 50) / 20);
  const streakAdj = Number(player.streak || 0) * 0.03;

  const blended = isProvisionalPlayer(player)
    ? (byPoints * 0.65 + byWinRate * 0.35 + streakAdj)
    : (rawLevel * 0.55 + byPoints * 0.25 + byWinRate * 0.20 + streakAdj);

  return Math.max(1, Math.min(7, blended));
}

function computePlayerPower(player) {
  const lvl = getPlayerAnalysisLevel(player);
  const pts = Number(player?.points || 1000);
  const streak = Number(player?.streak || 0);
  const wr = Number(player?.winRate || 50);
  return (lvl * 36) + (pts / 85) + (streak * 2.5) + (wr / 4);
}

function computeTeamPower(team) {
  const valid = team.filter((p) => p && !p.isEmpty);
  if (!valid.length) return 0;
  const total = valid.reduce((acc, p) => acc + computePlayerPower(p), 0);
  return total / valid.length;
}

function averageLevel(team) {
  const valid = team.filter((p) => p && !p.isEmpty);
  if (!valid.length) return 2.5;
  return valid.reduce((acc, p) => acc + getPlayerAnalysisLevel(p), 0) / valid.length;
}

function describePlayerForm(player) {
  if (!player || player.isEmpty) return "plaza libre";
  const name = shortPlayerName(player.name);
  const wr = Number(player.winRate || 50);
  const streak = Number(player.streak || 0);
  const lvl = getPlayerAnalysisLevel(player).toFixed(2);
  const provisional = isProvisionalPlayer(player) ? "en modo provisional" : `nivel IA ${lvl}`;

  let form = "llega estable";
  if (streak >= 3 || wr >= 67) form = "llega encendido";
  else if (streak <= -2 || wr <= 43) form = "llega irregular";

  return `${name} ${form} (${provisional})`;
}

function buildNextMatchAiPrediction(match, teamA, teamB) {
  const teamAReady = teamA.filter((p) => !p.isEmpty).length === 2;
  const teamBReady = teamB.filter((p) => !p.isEmpty).length === 2;
  const complete = teamAReady && teamBReady;

  if (!complete) {
    return {
      probA: null,
      headline: "Me falta una pareja completa para mojarme",
      summary: "Cuando el 2vs2 esté cerrado, te doy favorito y lectura táctica personalizada.",
      editorial: "Sin alineación cerrada no hay pronóstico serio.",
      badge: "AÚN ABIERTO",
    };
  }

  let probA = null;
  const rawWin = match?.preMatchPrediction?.winProbability;
  if (typeof rawWin === "number") {
    probA = rawWin > 1 ? rawWin : rawWin * 100;
  }
  if (probA == null || Number.isNaN(probA)) {
    const powerA = computeTeamPower(teamA);
    const powerB = computeTeamPower(teamB);
    const delta = powerA - powerB;
    probA = 50 + Math.max(-28, Math.min(28, delta * 1.65));
  }

  probA = Math.max(5, Math.min(95, Math.round(probA)));
  const probB = 100 - probA;
  const winnerIsA = probA >= probB;
  const advantage = Math.abs(probA - probB);
  const avgA = averageLevel(teamA).toFixed(2);
  const avgB = averageLevel(teamB).toFixed(2);
  const leadA = [...teamA].sort((a, b) => computePlayerPower(b) - computePlayerPower(a))[0];
  const leadB = [...teamB].sort((a, b) => computePlayerPower(b) - computePlayerPower(a))[0];
  const leadAName = shortPlayerName(leadA?.name || "Jugador A");
  const leadBName = shortPlayerName(leadB?.name || "Jugador B");
  const leadLabel = winnerIsA ? `${leadAName} y su pareja` : `${leadBName} y su pareja`;

  let tone = "ligero";
  if (advantage >= 16) tone = "alto";
  else if (advantage >= 8) tone = "moderado";

  const meInA = teamA.some((p) => p?.id && p.id === currentUser?.uid);
  const meInB = teamB.some((p) => p?.id && p.id === currentUser?.uid);
  const personal = meInA || meInB
    ? `Tu dupla tiene ${meInA ? probA : probB}% según mi modelo actual.`
    : `Mi favorito ahora mismo es ${leadLabel}.`;

  return {
    probA,
    headline: `Si me tengo que mojar: ${leadLabel} parte por delante (${winnerIsA ? probA : probB}%)`,
    summary: `${personal} Clave A: ${describePlayerForm(leadA)}. Clave B: ${describePlayerForm(leadB)}.`,
    editorial: `Partido ${tone}: media IA A ${avgA} vs B ${avgB}. Si el saque inicial entra bien, puede romperse pronto.`,
    badge: `${probA}% · ${probB}%`,
  };
}

async function createNextMatchPoster(match) {
  const date = toDateSafe(match.fecha);
  const isComp = match.col === "partidosReto" || match.isComp;
  const weatherHTML = buildWeatherPill(date);
  const players = await getDetailedMatchSlots(match);
  const teamA = players.slice(0, 2);
  const teamB = players.slice(2, 4);
  const filledPlayers = (match.jugadores || []).filter((id) => id).length;
  const slots = Math.max(0, 4 - filledPlayers);
  const slotText = slots === 0 ? "COMPLETO" : (slots === 1 ? "ULTIMA PLAZA" : `${slots} PLAZAS LIBRES`);
  const levelMin = Number(match.restriccionNivel?.min ?? 2.0);
  const levelMax = Number(match.restriccionNivel?.max ?? 6.0);
  const courtName = (match.courtType || "CENTRAL").toUpperCase();
  const aiPred = buildNextMatchAiPrediction(match, teamA, teamB);

  const playerNode = (player) => {
    const lvl = player?.isEmpty ? "--" : getPlayerAnalysisLevel(player).toFixed(2);
    const lvlLabel = player?.isEmpty
      ? "NV --"
      : (isProvisionalPlayer(player) ? `PROV ${lvl}` : `NV ${lvl}`);
    return `
      <div class="next-poster-player ${player?.isEmpty ? "empty" : ""}">
        <img
          src="${player?.photo || "./imagenes/Logojafs.png"}"
          alt="${shortPlayerName(player?.name)}"
          class="next-poster-avatar ${player?.isEmpty ? "empty" : ""}"
          loading="lazy"
        >
        <div class="next-poster-player-meta">
          <span class="next-poster-player-name">${shortPlayerName(player?.name)}</span>
          <span class="next-poster-player-lvl">${lvlLabel}</span>
        </div>
      </div>
    `;
  };

  return `
    <article class="next-poster-v13 animate-up" onclick="openMatch('${match.id}', '${match.col}')">
      <div class="next-poster-head">
        <span class="next-poster-type ${isComp ? "reto" : "amistoso"}">${isComp ? "RETO ELO" : "AMISTOSO"}</span>
        <span class="next-poster-hour">${formatHour(date)}</span>
      </div>

      <div class="next-poster-sub">
        <span class="next-poster-day">${date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()}</span>
        <span class="next-poster-weather">${weatherHTML || '<span class="next-poster-weather-fallback"><i class="fas fa-cloud"></i> CLIMA N/D</span>'}</span>
      </div>

      <div class="next-poster-court"><i class="fas fa-location-dot"></i> ${courtName}</div>

      <div class="next-poster-duel">
        <div class="next-poster-team">
          ${playerNode(teamA[0])}
          ${playerNode(teamA[1])}
        </div>
        <div class="next-poster-vs">VS</div>
        <div class="next-poster-team right">
          ${playerNode(teamB[0])}
          ${playerNode(teamB[1])}
        </div>
      </div>

      <div class="next-poster-foot">
        <span class="next-poster-slot ${slots <= 1 ? "urgent" : ""}">${slotText}</span>
        <span class="next-poster-level">NIVEL ${levelMin.toFixed(1)} - ${levelMax.toFixed(1)}</span>
      </div>

      <div class="next-poster-ai">
        <div class="next-poster-ai-head">
          <span><i class="fas fa-brain"></i> PRONOSTICO IA</span>
          <span class="next-poster-ai-badge">${aiPred.badge}</span>
        </div>
        <p class="next-poster-ai-title">${aiPred.headline}</p>
        <p class="next-poster-ai-text">${aiPred.summary}</p>
        <p class="next-poster-ai-note">${aiPred.editorial || ""}</p>
      </div>
    </article>
  `;
}

async function renderNextMatch(match) {
  const container = document.getElementById("next-match-container");
  if (!container) return;

  if (!match) {
    container.innerHTML = `
            <div class="empty-state-card-v7 animate-up">
                <div class="empty-icon-v7"><i class="fas fa-calendar-plus text-primary"></i></div>
                <div class="flex-col center">
                    <span class="empty-title-v7 italic">DIARIO LIBRE</span>
                    <button class="btn-booking-v7 mt-6" onclick="window.location.href='calendario.html'">RESERVAR PISTA</button>
                </div>
            </div>
        `;
    return;
  }

  container.innerHTML = `
    <div class="next-match-header-v11 next-match-header-v13">
        <span class="next-match-title-v11">PROXIMO PARTIDO</span>
        <span class="next-match-sub-v11">Cartel principal de tu agenda</span>
    </div>
    ${await createNextMatchPoster(match)}
  `;
}

async function renderUpcomingMatches(matches) {
  const container = document.getElementById("upcoming-matches-panel");
  if (!container) return;

  if (!matches || matches.length === 0) {
    container.innerHTML = '<div class="text-[8px] text-muted center py-6 opacity-40">SIN MAS PARTIDOS PROGRAMADOS</div>';
    return;
  }

  const html = await Promise.all(matches.map((m, i) => createUpcomingMiniItem(m, i + 1)));
  container.innerHTML = html.join("");
}
async function renderMatchFeed(param) {
  const container = document.getElementById("match-feed");
  if (!container) return;

  document.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.classList.toggle(
      "active",
      btn.getAttribute("onclick").includes(`'${param}'`),
    );
  });

  let list = allMatches;
  if (param === "open") {
    list = allMatches.filter((m) => (m.jugadores || []).filter(id => id).length < 4);
  } else if (param === "closed") {
    list = allMatches.filter((m) => (m.jugadores || []).filter(id => id).length >= 4);
  }

  // Private match filtering: hide private matches from non-organizer/non-invited users
  const uid = currentUser?.uid;
  list = list.filter(m => {
    if (m.visibility === 'private') {
      return m.organizerId === uid || m.creador === uid || (m.invitedUsers || []).includes(uid) || (m.jugadores || []).includes(uid);
    }
    return true;
  });

  list = list.slice(0, 12);

  if (!list || list.length === 0) {
    container.innerHTML = `
            <div class="empty-feed-v7 animate-fade-in flex-col center py-10">
                <i class="fas fa-ghost text-4xl text-white/5 mb-4"></i>
                <span class="text-xs font-black text-white/20 uppercase tracking-[4px]">Despliegue no encontrado</span>
            </div>
        `;
    return;
  }

  const html = await Promise.all(
    list.map(async (m, i) => await createMatchCardV10(m, i, "feed"))
  );
  container.innerHTML = html.join("");
}

async function loadInsights() {
  const weatherList = document.getElementById("weather-forecast-card");
  const quickWeather = document.getElementById("quick-weather");
  const tipBox = document.getElementById("tip-box");

  try {
    const w = await getDetailedWeather();
    weatherForecast = w; // Store for other components
    if (w && w.current) {
      const cond = calculateCourtCondition(
        w.current.temperature_2m,
        w.current.rain,
        w.current.wind_speed_10m,
      );
      if (quickWeather)
        quickWeather.innerHTML = `<i class="fas ${cond.icon} mr-1 ${cond.color}"></i> ${cond.condition} - ${Math.round(w.current.temperature_2m)}Â°C`;

      if (weatherList) {
        const daily = w.daily || {
          time: [],
          temperature_2m_max: [],
          weather_code: [],
        };
        weatherList.innerHTML = `
                    <div class="sport-card p-4 flex-col gap-4 animate-up">
                        <div class="flex-row between items-center">
                            <div class="flex-col gap-1">
                                <span class="text-xs font-bold text-muted uppercase tracking-widest">Estado de la Pista</span>
                                <span class="text-xl font-black text-white">${cond.condition.toUpperCase()}</span>
                                <span class="text-xs text-muted italic">${cond.advice || "Condiciones ideales para el pÃ¡del."}</span>
                            </div>
                            <div class="flex-col items-end gap-0">
                                <i class="fas ${cond.icon} text-3xl ${cond.color} mb-1"></i>
                                <span class="text-xs font-bold text-white">${Math.round(w.current.temperature_2m)}Â°C</span>
                                <span class="text-xs text-muted uppercase font-black">${w.current.wind_speed_10m} km/h viento</span>
                            </div>
                        </div>
                        
                        <div class="divider"></div>
                        
                        <div class="flex-row between">
                            ${daily.time
                              .map((t, i) => {
                                const d = new Date(t);
                                const isToday = i === 0;
                                return `
                                    <div class="flex-col center flex-1 ${isToday ? "opacity-100" : "opacity-40"}">
                                        <span class="text-xs font-bold uppercase">${isToday ? "Hoy" : d.toLocaleDateString("es-ES", { weekday: "short" })}</span>
                                        <i class="fas ${getIconFromCode(daily.weather_code[i])} text-sm my-1 text-primary"></i>
                                        <span class="text-xs font-bold">${Math.round(daily.temperature_2m_max[i])}Â°</span>
                                    </div>
                                `;
                              })
                              .join("")}
                        </div>
                    </div>
                `;
      }
    }
  } catch (e) {
    if (quickWeather)
      quickWeather.innerHTML =
        '<i class="fas fa-exclamation-triangle mr-1"></i> CLIMA N/A';
  }

  try {
    const tip = await getDailyTip();
// ... existing code ...
    if (tipBox && tip) {
      tipBox.innerHTML = `
                <i class="fas fa-lightbulb text-2xl text-secondary mb-2"></i>
                <span class="text-xs font-black uppercase text-white">Coach Tip</span>
                <span class="text-xs text-muted opacity-80 truncate w-full text-center">${tip.title}</span>
            `;
      tipBox.onclick = () => showToast("' Consejo Padel", tip.content, "info");
    }
  } catch(e) {}
}

window.openMatch = async (matchId, col) => {
    const modal = document.getElementById('modal-match');
    const container = document.getElementById('match-detail-area');
    
    if (modal && container) {
        modal.classList.add('active');
        container.innerHTML = '<div class="center py-20"><div class="spinner-galaxy"></div></div>'; // Quick clear
        
        try {
            const { renderMatchDetail } = await import("./match-service.js");
            await renderMatchDetail(container, matchId, col, currentUser, userData);
        } catch (e) {
            console.error("Error opening match:", e);
            container.innerHTML = '<div class="center p-10 opacity-50 text-xs">Error al cargar datos del nodo.</div>';
        }
    }
};

function getIconFromCode(code) {
  if (code <= 3) return "fa-sun";
  if (code <= 48) return "fa-cloud";
  if (code <= 67) return "fa-cloud-rain";
  if (code <= 77) return "fa-snowflake";
  if (code <= 82) return "fa-cloud-showers-heavy";
  if (code <= 99) return "fa-bolt";
  return "fa-cloud";
}

async function getPlayerName(uid) {
  if (!uid) return null;
  if (uid.startsWith("GUEST_")) return uid.split("_")[1];
  const d = await getDocument("usuarios", uid);
  return d?.nombreUsuario || d?.nombre || "Jugador";
}
async function initMatrixFeed() {
  const container = document.getElementById("matrix-feed-container");
  if (!container) return;

  const { listenToNotifications, markAsSeen } = await import("./services/notification-service.js");

  listenToNotifications(async (list) => {
    if (!list || list.length === 0) {
      if (!notifToastBaselineReady) notifToastBaselineReady = true;
      container.innerHTML = `
        <div class="feed-node opacity-40">
            <div class="node-pulse bg-white/20"></div>
            <i class="fas fa-satellite opacity-40 ml-1"></i>
            <span class="font-black opacity-60 uppercase text-[9px]">SincronizaciÃ³n estable: Sin anomalÃ­as</span>
        </div>
      `;
      return;
    }

    const ordered = [...list].sort(
      (a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0),
    );

    if (!notifToastBaselineReady) {
      ordered.forEach((n) => shownNotifToastIds.add(n.id));
      notifToastBaselineReady = true;
    } else {
      ordered
        .filter((n) => n?.id && !shownNotifToastIds.has(n.id))
        .slice(0, 3)
        .forEach((n) => {
          const type =
            n.tipo === "warning"
              ? "warning"
              : n.tipo === "error"
                ? "error"
                : n.tipo === "success" ||
                    n.tipo === "match_full" ||
                    n.tipo === "match_join" ||
                    n.tipo === "private_invite" ||
                    n.tipo === "match_opened" ||
                    n.tipo === "ranking_up" ||
                    n.tipo === "level_up"
                  ? "success"
                  : "info";
          showToast(n.titulo || "Padeluminatis", n.mensaje || "Nueva actualización.", type);
          shownNotifToastIds.add(n.id);
        });
    }

    const html = ordered.slice(0, 4).map(n => {
      let icon = 'fa-bolt';
      let color = 'primary';
      if (n.tipo === 'success' || n.tipo === 'match_full' || n.tipo === 'ranking_up' || n.tipo === 'level_up') { icon = 'fa-trophy'; color = 'sport-green'; }
      if (n.tipo === 'warning') { icon = 'fa-triangle-exclamation'; color = 'sport-red'; }
      if (n.tipo === 'ranking_down' || n.tipo === 'match_cancelled') { icon = 'fa-arrow-down'; color = 'sport-red'; }
      if (n.tipo === 'match_opened' || n.tipo === 'new_rival') { icon = 'fa-user-plus'; color = 'primary'; }
      if (n.tipo === 'chat_mention') { icon = 'fa-at'; color = 'primary'; }
      
      return `
        <div class="feed-node animate-fade-in">
            <div class="node-pulse" style="background: var(--${color}); box-shadow: 0 0 10px var(--${color}-glow)"></div>
            <i class="fas ${icon} opacity-40 ml-1"></i>
            <span class="font-black opacity-80 uppercase text-[9px]">${n.titulo}: ${n.mensaje}</span>
        </div>
      `;
    }).join('');

    container.innerHTML = html;

    // Mark as seen after a short delay to allow visual reading
    setTimeout(() => {
        ordered.forEach(n => markAsSeen(n.id));
    }, 8000);
  });
}
 
async function renderVerticalPodium() {
    const container = document.getElementById('vertical-podium');
    if (!container) return;
    
    try {
        const q = query(collection(db, 'usuarios'), orderBy('puntosRanking', 'desc'), limit(3));
        const snap = await window.getDocsSafe(q);
        
        if (snap.empty) return;
        
        const medals = ['gold', 'silver', 'bronze'];
        const colors = ['#FFD700', '#C0C0C0', '#CD7F32'];
        
        // Compact Container
        let html = `
            <div class="card-premium-v7 p-3 border-glow-cyan" style="background: rgba(10,15,25,0.6); backdrop-filter: blur(10px);">
                <div class="flex-row between items-center mb-3 px-2">
                    <span class="text-[9px] font-black text-white/40 uppercase tracking-[2px]">Muro de la Fama</span>
                    <span class="text-[8px] font-bold text-primary italic">Top 3 Elite</span>
                </div>
                <div class="flex-row gap-2">
        `;

        html += snap.docs.map((d, i) => {
            const u = d.data();
            const photo = u.fotoPerfil || u.fotoURL || './imagenes/Logojafs.png';
            const isMe = currentUser && d.id === currentUser.uid;
            
            return `
                <div class="elite-item-v7 flex-1 flex-col center p-2 rounded-xl bg-white/5 border border-white/5 relative overflow-hidden ${medals[i]}">
                    <div class="pr-rank-small">#${i + 1}</div>
                    <div class="pr-avatar-small mb-1" style="border-color: ${colors[i]}">
                        <img src="${photo}" class="w-full h-full object-cover">
                    </div>
                    <span class="text-[9px] font-black text-white truncate w-full text-center">${(u.nombreUsuario || u.nombre || 'Player').split(' ')[0].toUpperCase()}</span>
                    <span class="text-[8px] font-bold text-muted">${Math.round(u.puntosRanking || 1000)} <small class="text-[6px]">PTS</small></span>
                    ${isMe ? '<div class="absolute top-0 right-0 p-1"><div class="w-1.5 h-1.5 bg-primary rounded-full"></div></div>' : ''}
                </div>`;
        }).join('');

        html += `
                </div>
            </div>
        `;

        container.innerHTML = html;
        container.classList.add('p-0');
        container.style.background = 'none';
        container.style.border = 'none';

    } catch(e) { console.error("Error rendering podium:", e); }
}

function renderHallOfFame(user) {
  const container = document.getElementById("home-achievements");
  if (!container) return;

  const diaryEntries = Array.isArray(user.diario) ? user.diario.length : 0;
  const achievements = [
    { id: 'first_win', name: 'Ascenso', icon: 'fa-bolt', check: u => u.victorias > 0, tier: 'bronze' },
    { id: 'streak_3', name: 'Racha', icon: 'fa-fire', check: u => u.rachaActual >= 3, tier: 'silver' },
    { id: 'veteran', name: 'Elite', icon: 'fa-crown', check: u => u.partidosJugados >= 50, tier: 'gold' },
    { id: 'diary_master', name: 'Bitacora', icon: 'fa-book-open', check: () => diaryEntries >= 10, tier: 'cyan' }
  ];

  const html = achievements.map(a => {
    const active = a.check(user);
    return `
      <div class="ach-item-v9 ${active ? 'active' : ''} ${a.tier}">
          <div class="ach-icon-box" style="width: 40px; height: 40px; font-size: 14px;">
              <i class="fas ${a.icon}"></i>
          </div>
          <span class="ach-lbl-v9" style="font-size: 8px;">${a.name}</span>
      </div>
    `;
  }).join('');

  container.innerHTML = html || '<div class="opacity-20 text-[8px] font-black uppercase py-4">Sin datos de gala</div>';
}

/**
 * PHASE 5: AI ACTIVE MODE UI RENDERER
 */
function renderActiveMode(user) {
  // If no container in HTML, inject it before the stats (greeting-box)
  let container = document.getElementById("active-mode-container");
  if (!container) {
     const greetingBox = document.querySelector(".greeting-box");
     if(greetingBox) {
         container = document.createElement("div");
         container.id = "active-mode-container";
         greetingBox.parentNode.insertBefore(container, greetingBox.nextSibling);
     }
  }
  
  const state = user.playerState;
  
  if (!state || !container) {
      if(container) container.innerHTML = ''; // Clear if no state
      return;
  }
  
  // Don't show if Neutral (keep it clean) unless specific requirement
  if (state.mode === 'NEUTRAL_OBSERVER' || state.mode === 'NEUTRAL') {
       container.innerHTML = '';
       return;
  }

  // Map mode to CSS class
  let modeClass = 'mode-neutral';
  let iconClass = 'fa-brain';
  
  if (state.mode === 'CRISIS_MODE') { modeClass = 'mode-crisis'; iconClass = 'fa-shield-virus'; }
  else if (state.mode === 'GIANT_KILLER') { modeClass = 'mode-giant-killer'; iconClass = 'fa-dragon'; }
  else if (state.mode === 'BURNOUT_PROTOCOL') { modeClass = 'mode-fatigue'; iconClass = 'fa-battery-empty'; }
  else if (state.mode === 'FATIGUE_MANAGEMENT') { modeClass = 'mode-fatigue'; iconClass = 'fa-bed-pulse'; }
  else if (state.mode === 'GROWTH_FLOW') { modeClass = 'mode-growth'; iconClass = 'fa-seedling'; }

  const intervention = state.interventionText || "Sistema optimizando rendimiento.";
  const colorClass = state.uiColor || 'text-white';
  
  const metrics = state.metrics || {};

  container.innerHTML = `
      <div class="ai-active-mode-card ${modeClass} animate-up">
          <div class="ai-mode-header">
              <div class="ai-mode-badge ${modeClass}">
                   <div class="ai-pulse-dot"></div>
                   <span>${state.modeLabel || state.mode}</span>
              </div>
              <span class="text-[9px] font-black opacity-60 tracking-widest uppercase">AI ORCHESTRATOR</span>
          </div>
          
          <div class="flex-row items-center gap-3">
              <div class="w-10 h-10 rounded-full bg-white/10 flex-center backdrop-blur-sm border border-white/10">
                  <i class="fas ${iconClass} text-lg ${colorClass}"></i>
              </div>
              <div class="flex-col flex-1">
                  <span class="text-[9px] font-bold text-muted uppercase tracking-widest">INTERVENCIÃ“N ACTIVA</span>
                  <span class="text-xs font-black text-white italic leading-tight">${intervention}</span>
              </div>
          </div>

          <div class="ai-metrics-row">
              <div class="ai-metric-chip">
                  <i class="fas fa-fire-flame-curved text-orange-400"></i>
                  <span>${metrics.fatigue || 0}%</span>
                  <span class="label">FATIGA</span>
              </div>
              <div class="ai-metric-chip">
                  <i class="fas fa-brain text-blue-400"></i>
                  <span>${metrics.mental || 50}%</span>
                  <span class="label">MENTAL</span>
              </div>
              <div class="ai-metric-chip">
                  <i class="fas fa-crosshairs text-purple-400"></i>
                  <span>${metrics.predictiveConfidence || 80}%</span>
                  <span class="label">PRECISIÃ“N</span>
              </div>
              <div class="ai-metric-chip">
                  <i class="fas fa-chart-line ${(metrics.eloTrend || 0) >= 0 ? 'text-sport-green' : 'text-red-400'}"></i>
                  <span>${(metrics.eloTrend || 0) >= 0 ? '+' : ''}${metrics.eloTrend || 0}</span>
                  <span class="label">TREND</span>
              </div>
          </div>

          ${state.activeInterventions && state.activeInterventions.length > 0 ? `
              <div class="ai-intervention-box">
                  <div class="flex-row items-center gap-2 mb-1">
                       <i class="fas fa-bullseye text-[10px] text-primary"></i>
                       <span class="text-[9px] font-bold text-primary uppercase">PLAN SUGERIDO</span>
                  </div>
                  <div class="flex-col gap-1">
                      ${state.activeInterventions.map(i => `
                          <div class="flex-row gap-2 items-center">
                              <i class="fas ${i.icon || 'fa-circle'} text-[10px] text-white/40"></i>
                              <span class="text-[10px] text-white/80">${i.text}</span>
                          </div>
                      `).join('')}
                  </div>
              </div>
          ` : ''}
      </div>
  `;
}







// Health logic
async function updateEcosystemHealth() {
    try {
        const usersSnap = await window.getDocsSafe(collection(db, "usuarios"));
        const [matchesRetoSnap, matchesAmSnap] = await Promise.all([
            window.getDocsSafe(query(collection(db, "partidosReto"), limit(50))),
            window.getDocsSafe(query(collection(db, "partidosAmistosos"), limit(50))),
        ]);
        
        const totalUsers = usersSnap.size || 1;
        const totalMatches = (matchesRetoSnap.size || 0) + (matchesAmSnap.size || 0);
        
        // activity: users active in last 24h
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        let activeUsers = 0;
        usersSnap.forEach(u => {
            const acc = u.data().ultimoAcceso?.toDate();
            if (acc && acc > yesterday) activeUsers++;
        });

        // score calculation
        const activityScore = Math.min(40, (activeUsers / totalUsers) * 100 * 0.4);
        const matchScore = Math.min(30, totalMatches * 0.5);
        const achievementBonus = 20; // assumed high for vibe
        
        const finalScore = Math.round(activityScore + matchScore + achievementBonus + 10); // +10 base
        const score = Math.min(100, finalScore);
        const stateLabel =
          score >= 80
            ? "ÓPTIMO"
            : score >= 60
              ? "ESTABLE"
              : score >= 40
                ? "ALERTA"
                : "CRÍTICO";

        // Update UI
        const valEl = document.getElementById('eco-health-index');
        const aiValEl = document.getElementById('eco-health-val');
        const aiBarEl = document.getElementById('eco-health-bar');

        if (valEl) valEl.textContent = `SINCRONIZANDO: ${stateLabel} ${score}%`;
        if (aiValEl) aiValEl.textContent = `${score}/100`;
        if (aiBarEl) aiBarEl.style.width = `${score}%`;

    } catch(e) { console.error("Health calculation error:", e); }
}

async function syncRivalIntelligence(uid) {
    try {
        const { RivalIntelligence } = await import('./rival-intelligence.js');
        const reSnap = await window.getDocsSafe(query(collection(db, "partidosReto"), where("jugadores", "array-contains", uid), limit(30)));
        const amSnap = await window.getDocsSafe(query(collection(db, "partidosAmistosos"), where("jugadores", "array-contains", uid), limit(30)));
        const matches = [...reSnap.docs, ...amSnap.docs].map(d => d.data());
        
        const partners = {};
        const rivals = { won: {}, lost: {} };

        matches.forEach(m => {
            if (m.estado !== 'jugado' || !m.resultado) return;
            const isT1 = m.equipoA?.includes(uid);
            const userTeam = isT1 ? m.equipoA : m.equipoB;
            const rivalTeam = isT1 ? m.equipoB : m.equipoA;
            const userWon = m.resultado.ganador === (isT1 ? 1 : 2);

            userTeam?.forEach(p => { if (p && p !== uid) partners[p] = (partners[p] || 0) + 1; });
            rivalTeam?.forEach(r => {
                if(r) {
                    if (userWon) rivals.won[r] = (rivals.won[r] || 0) + 1;
                    else rivals.lost[r] = (rivals.lost[r] || 0) + 1;
                }
            });
        });

        const getTop = (obj) => {
            const keys = Object.keys(obj);
            return keys.length > 0 ? keys.reduce((a, b) => obj[a] > obj[b] ? a : b) : null;
        };

        const topNem = getTop(rivals.lost);
        const topVic = getTop(rivals.won);
        const topPar = getTop(partners);

        const renderIntel = async (id, elId, label, icon) => {
            const el = document.getElementById(elId);
            if (!el) return;
            if (id) {
                const u = await getDocument('usuarios', id);
                const name = (u?.nombreUsuario || u?.nombre || 'Jugador').split(' ')[0];
                el.innerHTML = `
                    <i class="fas ${icon} mb-1"></i>
                    <span class="text-[8px] font-black uppercase text-white">${label}</span>
                    <span class="text-[9px] font-bold text-primary mt-1">${name}</span>
                `;
                el.classList.remove('opacity-50');
                el.classList.add('clickable');
                el.onclick = async () => {
                    const { toggleChat, sendMessage } = await import("./modules/vecina-chat.js?v=6.5");
                    toggleChat(true); // Ensure open
                    sendMessage(`Analiza a mi ${label.toLowerCase()} ${name}`);
                };
            }
        };

        await renderIntel(topNem, 'intel-nemesis', 'NÃ‰MESIS', 'fa-skull text-magenta');
        await renderIntel(topVic, 'intel-victim', 'VÃCTIMA', 'fa-crown text-sport-green');
        await renderIntel(topPar, 'intel-partner', 'SOCIO', 'fa-user-group text-cyan');

    } catch(e) { console.warn("Rival Intel sync error:", e); }
}

function setupStatInteractions() {
    const bind = (id, title, msg) => {
        const el = document.getElementById(id);
        if(!el) return;
        el.onclick = () => showVisualBreakdown(title, msg);
    };

    bind('home-stat-level', 'FÃ³rmula de Nivel', 'Calculado basÃ¡ndose en ELO: (ELO-1000)/400 + 2.5. Se pondera por dificultad del rival.');
    bind('home-stat-points', 'Puntos Ranking', 'Puntos ELO acumulados. Suman por victorias, restan por derrotas considerando el ELO esperado.');
    bind('home-stat-streak', 'Efecto Racha', 'Ratio de victorias recientes. Activa multiplicadores x1.25 (3), x1.6 (6), x2.5 (10).');
    
    // Help for Rival Intel
    const rivalPanel = document.getElementById('rival-intel-panel');
    if(rivalPanel) {
        const header = rivalPanel.querySelector('span'); // First span is the header
        if(header) {
            header.innerHTML += ' <i class="fas fa-question-circle text-[8px] opacity-30 cursor-help" onclick="event.stopPropagation(); window.showVisualBreakdown(\'Rival Intelligence\', \'Este panel identifica a tus contactos clave basÃ¡ndose en tu historial de partidos. Pulsa en NÃ©mesis para ver cÃ³mo derrotarle, o en Socio para ver vuestra compatibilidad.\')"></i>';
        }
    }
}

function showVisualBreakdown(title, content) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.zIndex = '9999';
    overlay.innerHTML = `
        <div class="modal-card animate-up glass-strong" style="max-width:320px">
            <div class="modal-header border-b border-white/10 p-4">
                <span class="text-xs font-black text-primary uppercase">${title}</span>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="p-5">
                <p class="text-sm text-white/80 leading-relaxed">${content}</p>
                <div class="mt-4 p-3 bg-white/5 rounded-xl border border-white/5 text-[10px] text-muted italic">
                    <i class="fas fa-info-circle mr-1"></i> Estos valores se actualizan en tiempo real tras cada partido.
                </div>
            </div>
        </div>
    `;
    overlay.onclick = (e) => { if(e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
}

window.openAIHub = async () => {
    const modal = document.getElementById('modal-ai-hub');
    if (!modal) return;
    modal.classList.add('active');
    updateEcosystemHealth();
};

window.runAIQuickCommand = async (command) => {
    if (!command) return;
    const { toggleChat, sendMessage } = await import("./modules/vecina-chat.js?v=6.5");
    const panel = document.getElementById("vecina-chat-panel");
    const isOpen = panel?.classList.contains("open");
    if (!isOpen) await toggleChat();
    await sendMessage(command);
};

window.aiAction = (action) => {
    document.getElementById('modal-ai-hub').classList.remove('active');
    switch(action) {
        case 'profile': window.location.href = 'perfil.html'; break;
        case 'matches': window.location.href = 'historial.html'; break; 
        case 'ranking': window.location.href = 'puntosRanking.html'; break;
        case 'rivals': window.location.href = 'perfil.html'; break; 
        case 'diary': window.location.href = 'diario.html'; break;
        case 'admin': window.location.href = 'admin.html'; break;
        case 'open': window.showAllOpenMatches(); break;
        case 'chat': window.runAIQuickCommand("Dame un informe completo de mi estado actual y proximos objetivos"); break;
    }
};

window.showRivalSelector = async () => {
    // Collect opponents from history
    const opponents = new Map();
    const uid = currentUser?.uid;
    if (!uid) return;

    allMatches.forEach(m => {
        if (!m.jugadores || !m.resultado) return;
        m.jugadores.forEach(pid => {
            if (pid && pid !== uid && !pid.startsWith('GUEST_')) {
               opponents.set(pid, (opponents.get(pid) || 0) + 1);
            }
        });
    });

    const sorted = [...opponents.entries()].sort((a, b) => b[1] - a[1]); // Most frequent first

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.zIndex = '10000';
    overlay.innerHTML = `
        <div class="modal-card animate-up glass-strong" style="max-width:360px">
            <div class="modal-header border-b border-white/10 p-4 flex-row between items-center">
                <span class="text-xs font-black text-white uppercase tracking-widest">SELECCIONAR RIVAL</span>
                <button class="close-btn w-8 h-8 rounded-full bg-white/5 flex center" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times text-white"></i></button>
            </div>
            <div class="p-4 flex-col gap-2 max-h-[60vh] overflow-y-auto custom-scroll">
                ${sorted.length === 0 ? '<div class="text-center text-xs text-muted py-4 opacity-50 font-bold uppercase tracking-widest">Sin historial suficiente.</div>' : ''}
                <div id="rival-list-container">Loading...</div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Async load names to avoid blocking UI
    const container = overlay.querySelector('#rival-list-container');
    const htmlPromises = sorted.map(async ([pid, count]) => {
        const name = await getPlayerName(pid);
        return `
        <div class="flex-row items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5 hover:border-magenta/50 cursor-pointer transition-all hover:bg-white/10" 
                onclick="window.analyzeRival('${pid}')">
            <div class="w-8 h-8 rounded-full bg-black/50 border border-white/10 flex center text-[10px] font-bold text-white shrink-0">
                ${name.substring(0,2).toUpperCase()}
            </div>
            <div class="flex-col flex-1">
                <span class="text-xs font-bold text-white uppercase tracking-tight">${name}</span>
                <span class="text-[9px] text-muted font-bold">${count} PARTIDOS</span>
            </div>
            <i class="fas fa-chevron-right text-[10px] text-magenta opacity-50"></i>
        </div>`;
    });
    
    const items = await Promise.all(htmlPromises);
    container.innerHTML = items.join('');
};

window.analyzeRival = async (rivalId) => {
    document.querySelector('.modal-overlay.active')?.remove();
    
    // Dynamic Import Rival Intelligence
    const { RivalIntelligence } = await import('./rival-intelligence.js');

    // Calculate Stats
    // Assuming allMatches is global in home-logic.js
    const h2h = RivalIntelligence.parseMatches(currentUser.uid, rivalId, allMatches);
    const classification = RivalIntelligence.classifyRival(h2h);
    const rivalName = await getPlayerName(rivalId);

    // Show Report Modal
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.zIndex = '10001';
    overlay.style.backdropFilter = 'blur(10px) saturate(180%)';
    
    const colorMap = { 'red': 'magenta', 'green': 'sport-green', 'orange': 'gold', 'gray': 'white' };
    const themeColor = colorMap[classification.color] || 'gold';

    overlay.innerHTML = `
        <div class="modal-card animate-up glass-strong" style="max-width:340px; border: 1px solid var(--${themeColor}); box-shadow: 0 0 30px var(--${themeColor}-glow)">
            <div class="modal-header p-6 relative overflow-hidden h-40 flex-col justify-end">
                <div class="absolute inset-0 bg-gradient-to-b from-transparent to-black/80 z-10"></div>
                <!-- Abstract BG -->
                <div class="absolute inset-0 opacity-20" style="background: radial-gradient(circle at top right, var(--${themeColor}), transparent 70%);"></div>
                
                <div class="relative z-20">
                    <span class="text-[9px] font-black uppercase text-white/60 tracking-[3px]">EXPEDIENTE TÃCTICO</span>
                    <h2 class="text-2xl font-black italic text-white leading-none mt-1 tracking-tighter">${rivalName.toUpperCase()}</h2>
                    <div class="flex-row items-center gap-2 mt-3">
                         <div class="badge-premium sm" style="background: var(--${themeColor}); color: black; border:none">
                            <i class="fas ${classification.icon}"></i> <span class="font-black tracking-widest">${classification.class}</span>
                        </div>
                    </div>
                </div>
                <button class="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 border border-white/10 flex center text-white z-30 hover:bg-white/20 transition-colors" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
            </div>
            
            <div class="p-6 bg-[#0a0a0f]">
                <div class="flex-row between items-center mb-6 px-4">
                    <div class="flex-col center flex-1">
                        <span class="text-3xl font-black text-sport-green">${h2h.wins}</span>
                        <span class="text-[9px] font-bold text-muted uppercase tracking-widest mt-1">VICTORIAS</span>
                    </div>
                    <div class="text-xl font-black text-white/10">VS</div>
                    <div class="flex-col center flex-1">
                        <span class="text-3xl font-black text-sport-red">${h2h.losses}</span>
                        <span class="text-[9px] font-bold text-muted uppercase tracking-widest mt-1">DERROTAS</span>
                    </div>
                </div>

                <div class="p-5 bg-white/5 rounded-2xl border border-white/5 mb-6 relative overflow-hidden group">
                    <i class="fas fa-quote-left absolute top-3 left-3 text-white/5 text-xl"></i>
                    <p class="text-xs text-white/90 font-medium leading-relaxed italic relative z-10 text-center px-2">"${h2h.tacticalBrief}"</p>
                    <div class="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-50"></div>
                </div>

                <div class="flex-row center">
                    <div class="px-4 py-1 rounded-full border border-white/10 bg-white/5">
                        <span class="text-[9px] font-black text-muted uppercase tracking-widest">WINRATE HISTÃ“RICO: <span class="text-white">${h2h.winRate}%</span></span>
                    </div>
                </div>
            </div>
        </div>
    `;
document.body.appendChild(overlay);
};
async function renderUpcomingMatchesLegacy(matches) {
    const container = document.getElementById('upcoming-matches-panel');
    if (!container) return;

    if (!matches || matches.length === 0) {
        container.innerHTML = `
            <div class="flex-col center py-6 opacity-30">
                <span class="text-[9px] font-black uppercase tracking-widest">Sin mÃ¡s despliegues programados</span>
            </div>
        `;
        return;
    }

    const htmlPromises = matches.map(async (m) => {
        const date = m.fecha.toDate ? m.fecha.toDate() : new Date(m.fecha);
        const isComp = m.col === 'partidosReto';
        return `
            <div class="upcoming-item-v7 flex-row between items-center p-3 bg-white/5 rounded-2xl border border-white/5 hover:border-white/10 clickable transition-all" onclick="openMatch('${m.id}', '${m.col}')">
                <div class="flex-row items-center gap-3">
                    <div class="flex-col center bg-black/40 w-10 h-10 rounded-xl border border-white/5">
                        <span class="text-xs font-black text-white">${date.getDate()}</span>
                        <span class="text-[8px] text-muted uppercase font-bold">${date.toLocaleDateString('es-ES', {month:'short'})}</span>
                    </div>
                    <div class="flex-col">
                        <span class="text-xs font-black text-white italic uppercase">${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')} HRS</span>
                        <span class="text-[9px] text-muted font-bold">${isComp ? 'RETO ELO' : 'AMISTOSO'}</span>
                    </div>
                </div>
                <i class="fas fa-chevron-right text-[10px] text-muted"></i>
            </div>
        `;
    });

    const items = await Promise.all(htmlPromises);
    container.innerHTML = items.join('');
}

async function renderOpenMatches() {
    const container = document.getElementById('open-matches-panel');
    if (!container) return;

    try {
        const [am, re] = await Promise.all([
            window.getDocsSafe(query(collection(db, "partidosAmistosos"), orderBy("fecha", "asc"), limit(40))),
            window.getDocsSafe(query(collection(db, "partidosReto"), orderBy("fecha", "asc"), limit(40)))
        ]);

        let list = [];
        am.forEach(d => list.push({ id: d.id, col: 'partidosAmistosos', ...d.data() }));
        re.forEach(d => list.push({ id: d.id, col: 'partidosReto', ...d.data() }));

        const seen = new Set();
        list = list.filter(m => {
            const key = `${m.col}:${m.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        const now = new Date();
        list = list.filter(m => {
            const date = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);
            const filled = (m.jugadores || []).filter(id => id).length;
            const notPlayed = m.estado !== 'jugado' && m.estado !== 'anulado' && m.estado !== 'cancelado';
            const upcoming = date > new Date(now - 7200000);
            return filled < 4 && notPlayed && upcoming;
        });

        const uid = currentUser?.uid;
        list = list.filter((m) => {
            if (m.visibility === "private") {
                return m.organizerId === uid || m.creador === uid || (m.invitedUsers || []).includes(uid) || (m.jugadores || []).includes(uid);
            }
            return true;
        });

        list.sort((a,b) => (a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha)) - (b.fecha?.toDate ? b.fecha.toDate() : new Date(b.fecha)));
        openMatchesCache = list;
        updateOpenMatchesControls(list.length);
        
        if (list.length === 0) {
            container.innerHTML = `
                <div class="flex-col center py-8 opacity-40 w-full">
                    <i class="fas fa-satellite-dish mb-2 text-primary opacity-20"></i>
                    <span class="text-[9px] font-black uppercase tracking-widest text-muted">0 Partidos Disponibles</span>
                </div>
            `;
            return;
        }

        const html = await Promise.all(list.map((m, idx) => createOpenMatchCardV11(m, idx)));
        container.innerHTML = html.join('');

    } catch(e) { 
        openMatchesCache = [];
        updateOpenMatchesControls(0);
        console.error("Error loading open matches:", e); 
    }
}

// Global cache cleaner helper
window.clearAppCache = () => {
    sessionStorage.clear();
    localStorage.removeItem('app_version');
    window.location.reload();
};
