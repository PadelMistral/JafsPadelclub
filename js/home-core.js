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
  updateDoc,
  increment,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI, showToast } from "./ui-core.js";
import { injectHeader, injectNavbar } from "./modules/ui-loader.js";
import { renderMatchDetail } from "./match-service.js";
import { createNotification } from "./services/notification-service.js";
import {
  isCancelledMatch,
  isFinishedMatch,
  toDateSafe,
  getResultSetsString,
  resolveWinnerTeam,
  getMatchPlayers,
  getNormalizedPlayers,
  getMatchTeamPlayerIds,
  parseGuestMeta,
} from "./utils/match-utils.js";
import { RESULT_LOCK_MS } from "./config/match-constants.js";
import { getDetailedWeather } from "./external-data.js";
import { analyticsTiming } from "./core/analytics.js";
import { APP_APK_DOWNLOAD_ENABLED, APP_APK_URL, resolveApkDownloadUrl } from "./app-config.js";
import {
  requestNotificationPermission,
  showNotificationHelpModal,
  getPushStatusHuman,
  checkNotificationStatus,
} from "./modules/push-notifications.js";
import {
  getCompetitiveState,
  getCoreAIContext,
  observeCoreSession,
  queryCoreAI,
  startCorePresence,
} from "./core/core-engine.js";
import { computeGroupTable } from "./event-tournament-engine.js";
import { shareMatchResult, shareMatchPoster, downloadDataUrl, generateEventStatusPoster } from "./utils/share-utils.js";
import { getFriendlyTeamName, isUnknownTeamName as sharedIsUnknownTeamName } from "./utils/team-utils.js";
import { scoreMatchForUser } from "./services/matchmaking-service.js";
import { buildStableGuestId } from "./services/guest-player-service.js";
import { resolveIdentity, seedIdentityCache } from "./services/identity-service.js";
import { syncComputedStreakForUser } from "./services/streak-service.js";
import { animateCountUp } from "./modules/count-up.js";



let currentUser = null;
let currentUserData = null;
let unsubAm = null;
let unsubRe = null;
let unsubEv = null;
let unsubMyEvents = null;
let unsubClubFeed = null;
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
let homeEntryFailSafeTimer = null;
let homeEntryOverlayValue = 0;
const HOME_MATCH_CACHE_KEY = "home:matches:v1";
let showHomeWelcome = false;
let unsubEventStandings = null;
let activeEventStandingsId = null;
let proposalUsersCache = [];
let proposalListUnsub = null;
let proposalChatUnsub = null;
let proposalMetaUnsub = null;
let activeProposalId = null;
let activeProposalMeta = null;
let proposalInlineMode = false;
let clubFeedItems = [];
const HOME_GUIDE_DISMISSED_KEY = "home:guide:dismissed:v1";
const MIN_BET_COINS = 20;

// Limpieza de overlays heredados "event-day-alert"
function purgeEventDayAlerts() {
  try {
    document.querySelectorAll(".event-day-alert")?.forEach((el) => el.remove());
  } catch {}
}
purgeEventDayAlerts();

function escapeHtml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function compactHomeSecondarySections() {
  const detailsBody = document.querySelector(".hv2-secondary-stack");
  if (!detailsBody || detailsBody.dataset.compacted === "1") return;
  detailsBody.dataset.compacted = "1";

  const promoSections = Array.from(document.querySelectorAll(".hv2-events-promo"));
  promoSections.forEach((section) => {
    const card = section.querySelector(".hv2-promo-card");
    if (!card) return;
    detailsBody.appendChild(card);
    section.classList.add("home-secondary-hidden");
  });

  const spotlight = document.getElementById("event-spotlight");
  if (spotlight && !spotlight.classList.contains("hidden")) {
    spotlight.classList.add("home-secondary-inline");
    detailsBody.prepend(spotlight);
  }
}

function normalizeHomeProductCopy() {
  const reportTitle = document.querySelector(".hv2-tr-title");
  if (reportTitle) reportTitle.textContent = "RESUMEN DIARIO";
  const nexusTitle = document.querySelector(".nexus-title");
  if (nexusTitle) nexusTitle.textContent = "USUARIOS CONECTADOS";
  const sectionSummaries = Array.from(document.querySelectorAll(".hv2-collapsible-summary span"));
  sectionSummaries.forEach((el) => {
    const text = String(el.textContent || "");
    if (/Ultimos Cierres|Últimos Cierres/i.test(text)) el.innerHTML = `<i class="fas fa-flag-checkered"></i> Últimos Resultados`;
    if (/Mas del Club/i.test(text)) el.innerHTML = `<i class="fas fa-grid-2"></i> Mas opciones`;
  });
}

/* Apoing Integration */
let apoingEvents = [];
let apoingLastSyncAt = 0;
const APOING_SYNC_TTL_MS = 300000; // 5 min
const APOING_PROXY_URL = `${window.location.origin}/api/apoing-ics?url=`;
const APOING_PROXY_JINA = "https://r.jina.ai/http://";

function getHomeApoingStorageKey(uid) {
  return `apoingCalendarUrl:${uid || "anon"}`;
}

function getHomeApoingIcsUrl() {
  const byUser = normalizeApoingCalendarUrl(currentUserData?.apoingCalendarUrl || currentUserData?.icsUrl || "");
  if (byUser) return byUser;
  try {
    const uid = String(currentUser?.uid || "");
    return normalizeApoingCalendarUrl(localStorage.getItem(getHomeApoingStorageKey(uid)) || "");
  } catch (_) {
    return "";
  }
}

/* Player cache (names + photos) */
const playerNameCache = new Map();
const playerPhotoCache = new Map();
const playerDataCache = new Map(); // uid → { nivel, posicion, foto }
const eventDocCache = new Map();
const eventStandingsGroupOverride = new Map();

function timeAgo(dateIn) {
  if (!dateIn) return "";
  const d = dateIn instanceof Date ? dateIn : new Date(dateIn);
  if (isNaN(d)) return "";
  const diff = Math.floor((new Date() - d) / 1000);
  if (diff < 60) return `hace unos instantes`;
  if (diff < 3600) return `hace ${Math.floor(diff/60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff/3600)}h`;
  return `hace ${Math.floor(diff/86400)}d`;
}

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
    if (uid && name) {
        map.set(String(uid), String(name));
        if (!playerNameCache.has(uid)) playerNameCache.set(uid, name);
    }
  });
  const teams = Array.isArray(eventDoc.teams) ? eventDoc.teams : [];
  teams.forEach((t) => {
    const players = Array.isArray(t?.players) ? t.players : [];
    players.forEach((p) => {
      const uid = p?.uid || p?.id;
      const name = p?.nombre || p?.nombreUsuario;
      if (uid && name) {
          map.set(String(uid), String(name));
          if (!playerNameCache.has(uid)) playerNameCache.set(uid, name);
      }
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
  renderHomeCompactBrief();
  renderEventSpotlight();
  renderCompetitivePulse();
  renderHomeGuidedPanel();
  renderHomeDailyChallenge();
  renderHomeAchievements();
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

function isHomeGuideDismissed() {
  try {
    return localStorage.getItem(HOME_GUIDE_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function dismissHomeGuide() {
  try {
    localStorage.setItem(HOME_GUIDE_DISMISSED_KEY, "1");
  } catch {}
  renderHomeGuidedPanel();
}
window.dismissHomeGuide = dismissHomeGuide;

async function resolvePlayerName(uid) {
  if (!uid) return null;
  const sUid = String(uid);
  if (playerNameCache.has(sUid)) return playerNameCache.get(sUid);
  const identity = await resolveIdentity(sUid, {
    currentUserId: currentUser?.uid,
    currentUserData,
  });
  if (identity?.name) playerNameCache.set(sUid, identity.name);
  if (identity?.photo) playerPhotoCache.set(sUid, identity.photo);
  // Store full data for poster / level resolution
  if (identity) {
    playerDataCache.set(sUid, {
      nivel: identity.nivel ?? identity.level ?? null,
      foto: identity.photo || null,
      posicion: identity.posicionPreferida || identity.posicion || null,
    });
  }
  return identity?.name || "Jugador";
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
  if (!uid || String(uid).includes("LIBRE")) return "LIBRE";
  const sUid = String(uid);
  
  const eventName = getEventUserName(sUid);
  if (eventName) return eventName;
  const guestMeta = parseGuestMeta(sUid);
  if (guestMeta?.name && isNaN(guestMeta.name)) return guestMeta.name;

  // 3. Current User check
  if (uid === currentUser?.uid)
    return currentUserData?.nombreUsuario || currentUserData?.nombre || "Tú";

  const cached = playerNameCache.get(sUid);
  if (cached) return cached;
  if (sUid.startsWith("manual_")) {
    return "Invitado";
  }

  return "Jugador";
}

function getPlayerMeta(uid) {
  if (!uid) return null;
  const guest = parseGuestMeta(uid);
  if (guest) return { nombre: guest.name, nivel: guest.level, posicionPreferida: "flex" };
  const name = getPlayerDisplayName(uid);
  const own = uid === currentUser?.uid ? currentUserData : null;
  if (own) {
    return {
      uid,
      nombre: own.nombreUsuario || own.nombre || name,
      nivel: Number(own.nivel || 2.5),
      posicionPreferida: own.posicionPreferida || own.sidePreference || own.posicion || "",
    };
  }
  return {
    uid,
    nombre: name,
    nivel: 2.5,
    posicionPreferida: "",
  };
}

function getMatchmakingContext() {
  return {
    historyMatches: dedupeEventLinkedMatches(allMatches)
      .filter((m) => !isCancelledMatch(m))
      .filter((m) => isFinishedMatch(m)),
  };
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

function normalizeBracketRounds(rawBracket = null) {
  if (!rawBracket || !Array.isArray(rawBracket) || !rawBracket.length) return [];
  if (Array.isArray(rawBracket[0])) return rawBracket;
  const grouped = new Map();
  rawBracket
    .filter((match) => match && typeof match === "object")
    .forEach((match) => {
      const round = Number(match.round || 1);
      const slot = Number(match.slot || 1);
      const next = { ...match, round, slot };
      if (!grouped.has(round)) grouped.set(round, []);
      grouped.get(round).push(next);
    });
  return Array.from(grouped.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, matches]) => matches.sort((a, b) => Number(a.slot || 0) - Number(b.slot || 0)));
}
/* Init */
document.addEventListener("DOMContentLoaded", async () => {
  showHomeWelcome = shouldShowHomeWelcome();
  if (!showHomeWelcome) {
    const overlay = document.getElementById("home-entry-overlay");
    if (overlay) overlay.classList.add("hidden");
    document.body.classList.remove("home-booting");
  }
  try {
    await initAppUI("home");
  } catch (e) {
    console.warn("[Home] initAppUI fallo, seguimos en modo seguro:", e);
  }
  observeCoreSession({
    onSignedOut: () => {
      cleanup();
      window.location.replace("index.html");
    },
    onReady: async ({ user, userDoc }) => {
      try {
        cleanup();
        currentUser = user;
        currentUserData = userDoc || {};
        try {
          currentUserData.computedStreak = await syncComputedStreakForUser(user.uid, currentUserData, { maxLogs: 60 });
        } catch (streakErr) {
          console.warn("[Home] streak fallback", streakErr);
          currentUserData.computedStreak = Number(currentUserData?.rachaActual || 0);
        }
        seedIdentityCache([{ uid: user.uid, ...currentUserData }]);
        if (showHomeWelcome) {
          beginHomeEntryOverlay(currentUserData?.nombreUsuario || currentUserData?.nombre || "Jugador");
        } else {
          const overlay = document.getElementById("home-entry-overlay");
          if (overlay) overlay.classList.add("hidden");
          document.body.classList.remove("home-booting");
        }
        try {
          await injectHeader(currentUserData);
        } catch (headerErr) {
          console.warn("[Home] header fallback", headerErr);
        }
        try {
          injectNavbar("home");
        } catch (navErr) {
          console.warn("[Home] navbar fallback", navErr);
        }
        compactHomeSecondarySections();
        normalizeHomeProductCopy();
        if (typeof fixHomeCopyEncoding === "function") fixHomeCopyEncoding();
        purgeEventDayAlerts();
        renderNotificationHealthCard();
        renderWelcome();
        bindTabs();
        initWeather();
        startPresence();
        initNexus();
        bindNotificationNudge();

        // Auto-notifications (Real-time watchers)
        const { initCoreNotifications } = await import("./core/core-engine.js");
        initCoreNotifications(user.uid);

        checkHomeNotices();
        initProposeMatch();
        applyHomeMatchCache({ complete: navigator.onLine === false });

        // Loading matches with safety fallback
        try {
        const amPromise = subscribeCol(
          "partidosAmistosos",
          (list) => mergeMatches("partidosAmistosos", list),
          [],
          [["fecha", "desc"]],
          200,
        );
        const rePromise = subscribeCol(
          "partidosReto",
          (list) => mergeMatches("partidosReto", list),
          [],
          [["fecha", "desc"]],
          200,
        );
        const evPromise = subscribeCol(
          "eventoPartidos",
          (list) => mergeMatches("eventoPartidos", list),
          [],
          [["fecha", "desc"]],
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

        unsubClubFeed = await subscribeCol(
          "playerHistory",
          async (rows) => {
            clubFeedItems = (rows || []).slice().sort((a, b) => (toDateSafe(b?.createdAt)?.getTime() || 0) - (toDateSafe(a?.createdAt)?.getTime() || 0));
            const uids = [...new Set(clubFeedItems.map((item) => item?.uid).filter(Boolean))];
            await Promise.allSettled(uids.map((uid) => resolvePlayerName(uid)));
            renderHomeCompactBrief();
            renderClubFeed();
          },
          [],
          [["createdAt", "desc"]],
          8,
        );

        // Fetch Apoing
        syncApoingReservations().catch(() => {});
        } catch (err) {
          console.error("Match loading error:", err);
          applyHomeMatchCache({ complete: true });
        }

        // Final fallback to ensure UI isn't stuck and Today notice shows
        setTimeout(() => {
        if (!matchLoadFallbackFired) {
          matchLoadFallbackFired = true;
          renderNextMatch();
          renderHomeCompactBrief();
          renderCompetitivePulse();
          renderMatchesByFilter(
            document.querySelector(".hv2-tab.active")?.dataset.filter || "open",
          );
          completeHomeEntryOverlay();
        }
        // Force check for today's match even if cache was used
        maybeCreateEventDayNotice();
        }, 3500);


        window.getAICoachContext = () =>
          getCoreAIContext({ uid: currentUser.uid });
      } catch (err) {
        console.error("[Home] init error:", err);
        showToast("Error", "Home no pudo terminar la carga. Hemos aplicado modo seguro.", "error");
        completeHomeEntryOverlay();
      }
    },
  });
});

function cleanup() {
  [unsubAm, unsubRe, unsubEv, unsubMyEvents, unsubNexus, unsubClubFeed].forEach((fn) => {
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
  unsubClubFeed = null;
  stopNexusRefreshTimer();
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
  const streak = Number.isFinite(Number(d?.computedStreak)) ? Number(d.computedStreak) : snapshot.streak;
  const played = snapshot.played;

  const el = (id) => document.getElementById(id);
  if (el("user-name")) el("user-name").textContent = name.toUpperCase();
  if (el("welcome-points")) animateCountUp(el("welcome-points"), Number(pts).toFixed(1), 1400);
  if (el("welcome-level")) animateCountUp(el("welcome-level"), lvl, 1200);
  if (el("stat-streak")) {
    const streakVal = (streak > 0 ? "+" : "") + streak;
    el("stat-streak").textContent = streakVal;
  }

  // Tactical stats (Nemesis, Victim, Partner) are now calculated by refreshTacticalStats()
  refreshTacticalStats().catch(err => console.error("Error refreshing tactical stats:", err));

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
    refreshTacticalStats();
    renderHomeAppInstallNotice();
  renderHomeIcsSetup();
    startClock();
  setTimeout(checkHomeNotices, 1000);
  }

/* Tactical Stats */
async function refreshTacticalStats() {
    if (!currentUser?.uid || !allMatches.length) return;
    
    const myUid = currentUser.uid;
    const finishedMatches = dedupeEventLinkedMatches(allMatches).filter(m => isFinishedMatch(m));
    const opponentWins = new Map(); // Opponent -> times they beat me
    const opponentLosses = new Map(); // Opponent -> times I beat them
    const teammateCounts = new Map(); // Teammate -> times played together
    const currentStreak = Number.isFinite(Number(currentUserData?.computedStreak))
        ? Number(currentUserData.computedStreak)
        : Number(currentUserData?.rachaActual || 0);

    const sorted = [...finishedMatches].sort((a,b) => toDateSafe(b.fecha) - toDateSafe(a.fecha));

    for (const m of sorted) {
        const players = getNormalizedPlayers(m);
        if (!players.includes(myUid)) continue;

        const winnerTeam = resolveWinnerTeam(m);
        const myTeam = players.indexOf(myUid) < 2 ? "A" : "B";
        const won = (winnerTeam === "A" || winnerTeam === 1) ? myTeam === "A" : (winnerTeam === "B" || winnerTeam === 2) ? myTeam === "B" : false;

        // Opponents and Partners
        const myTeammate = myTeam === "A" 
            ? players[players.indexOf(myUid) === 0 ? 1 : 0] 
            : players[players.indexOf(myUid) === 2 ? 3 : 2];
        
        if (myTeammate && !String(myTeammate).startsWith("GUEST_") && myTeammate !== "LIBRE") {
            teammateCounts.set(myTeammate, (teammateCounts.get(myTeammate) || 0) + 1);
        }

        const opponents = myTeam === "A" ? [players[2], players[3]] : [players[0], players[1]];
        opponents.forEach(opp => {
            if (opp && !String(opp).startsWith("GUEST_") && opp !== "LIBRE") {
                if (!won) {
                    opponentWins.set(opp, (opponentWins.get(opp) || 0) + 1);
                } else {
                    opponentLosses.set(opp, (opponentLosses.get(opp) || 0) + 1);
                }
            }
        });
    }

    // Update Streak
    const streakEl = document.getElementById("stat-streak");
    if (streakEl) {
        streakEl.textContent = (currentStreak > 0 ? "+" : "") + currentStreak;
        streakEl.className = "hv2-xp-val " + (currentStreak > 0 ? "text-sport-green" : currentStreak < 0 ? "text-sport-red" : "");
    }
    if (currentUserData) currentUserData.computedStreak = currentStreak;

    // Find Partner
    let topPartnerUid = null;
    let maxPartnerGames = 0;
    teammateCounts.forEach((count, uid) => {
        if (count > maxPartnerGames) {
            maxPartnerGames = count;
            topPartnerUid = uid;
        }
    });

    const partnerEl = document.getElementById("stat-partner");
    if (partnerEl) {
        if (topPartnerUid) {
            const name = await resolvePlayerName(topPartnerUid);
            partnerEl.textContent = name.split(" ")[0].toUpperCase();
            partnerEl.title = `${name} (${maxPartnerGames} partidos juntos)`;
        } else {
            partnerEl.textContent = "---";
        }
    }

    // Find Nemesis
    let topNemesisUid = null;
    let maxNemesisWins = 0;
    opponentWins.forEach((wins, uid) => {
        if (wins > maxNemesisWins) {
            maxNemesisWins = wins;
            topNemesisUid = uid;
        }
    });

    const nemesisEl = document.getElementById("stat-nemesis");
    if (nemesisEl) {
        if (topNemesisUid) {
            const name = await resolvePlayerName(topNemesisUid);
            nemesisEl.textContent = name.split(" ")[0].toUpperCase();
            nemesisEl.title = `${name} te ha ganado ${maxNemesisWins} veces`;
        } else {
            nemesisEl.textContent = "---";
        }
    }

    // Find Victim
    let topVictimUid = null;
    let maxVictimLosses = 0;
    opponentLosses.forEach((losses, uid) => {
        if (losses > maxVictimLosses) {
            maxVictimLosses = losses;
            topVictimUid = uid;
        }
    });

    const victimEl = document.getElementById("stat-victim");
    if (victimEl) {
        if (topVictimUid) {
            const name = await resolvePlayerName(topVictimUid);
            victimEl.textContent = name.split(" ")[0].toUpperCase();
            victimEl.title = `Le has ganado ${maxVictimLosses} veces`;
        } else {
            victimEl.textContent = "---";
        }
    }
}

/* Home Notices */
async function checkHomeNotices() {
    const d = currentUserData;
    if (!d || !currentUser?.uid) return;

    const notices = [];
    const now = new Date();
    const hasIcs = Boolean(getHomeApoingIcsUrl());
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

    // 1. Today Match - Handled by maybeCreateEventDayNotice directly for premium view


    if (!hasIcs) {
        notices.push({
            type: 'ics',
            title: 'FALTA TU ICS DE APOING',
            message: 'Entra en Apoing, abre tu perfil, copia el calendario ICS y guardalo en tu perfil para detectar reservas y disponibilidad.',
            action: () => window.location.href = 'perfil.html?focus=apoing#profile-apoing-settings'
        });
    }

    // 2. Pending Result
    const pendingResult = myMatches.filter((m) => {
        if (isFinishedMatch(m)) return false;
        const hasResult = Boolean(getResultSetsString(m));
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

    const nextApoingMine = [...apoingEvents]
      .filter((ev) => String(ev?.sourceUid || "") === String(currentUser.uid))
      .filter((ev) => ev?.dtStart && ev.dtStart.getTime() >= now.getTime() - 10 * 60 * 1000)
      .sort((a, b) => a.dtStart - b.dtStart)[0] || null;
    if (hasIcs && nextApoingMine) {
        const nearMatch = myMatches.find((m) => {
            const date = toDateSafe(m?.fecha);
            return date && Math.abs(date.getTime() - nextApoingMine.dtStart.getTime()) <= 90 * 60 * 1000;
        });
        notices.unshift({
            type: 'apoing',
            title: 'RESERVA APOING DETECTADA',
            message: nearMatch
                ? `Tu reserva del ${nextApoingMine.dtStart.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" })} a las ${nextApoingMine.dtStart.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} ya coincide con tu partido.`
                : `Tienes una reserva el ${nextApoingMine.dtStart.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" })} a las ${nextApoingMine.dtStart.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}. Puedes mantenerla privada o publicarla desde Calendario.`,
            action: () => window.location.href = 'calendario.html'
        });
    }

    // 3. Pending Diary
    const diaryEntries = d.diario || [];
    const finishedWithResult = myMatches.filter((m) => {
        const hasResult = Boolean(getResultSetsString(m));
        return hasResult || isFinishedMatch(m);
    });
    const missingDiary = finishedWithResult.filter((m) => {
        const matchTime = toDateSafe(m?.fecha);
        if (!matchTime) return false;
        const isOldEnough = (now - matchTime) > 2 * 60 * 60 * 1000; // 2h after match
        if (!isOldEnough) return false;
        return !diaryEntries.some((e) => e.matchId === m.id);
    });

    if (!hasIcs) {
        notices.push({
            type: 'apoing',
            title: 'Conecta tu Apoing (.ics)',
            message: "Ve a tu perfil de Apoing, copia el enlace .ics y pégalo en Perfil o Calendario para sincronizar.",
            action: () => window.location.href = 'perfil.html?focus=apoing#profile-apoing-settings'
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
                    <i class="fas ${notice.type === 'game' ? 'fa-calendar-check' : notice.type === 'ics' ? 'fa-calendar-plus' : 'fa-book-sparkles'}"></i>
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

const __showHomeAlertModalBase = showHomeAlertModal;
showHomeAlertModal = function showHomeAlertModalEnhanced(notice) {
  if (notice?.type !== "apoing") return __showHomeAlertModalBase(notice);
  const upcomingWithoutReserve = getUpcomingRelevantMatchWithoutApoing();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay active";
  overlay.style.zIndex = "14000";
  overlay.innerHTML = `
    <div class="modal-card glass-strong animate-scale-in home-apoing-notice-card">
      <div class="flex-col items-center text-center gap-4">
        <div class="home-apoing-notice-icon"><i class="fas fa-calendar-check"></i></div>
        <div class="flex-col gap-1">
          <h3 class="home-apoing-notice-title">${escapeHtml(notice.title || "Reserva detectada")}</h3>
          <p class="home-apoing-notice-copy">${escapeHtml(notice.message || "")}</p>
        </div>
        ${upcomingWithoutReserve ? `<div class="home-apoing-warning">Tienes partido en calendario, pero no vemos reserva de Apoing asociada a ningún participante.</div>` : ""}
        <div class="flex-row gap-2 justify-center flex-wrap">
          <button class="btn-premium-v7 py-3 uppercase text-[10px] font-black" id="notice-btn-go">Abrir calendario</button>
          ${upcomingWithoutReserve ? `<a class="hv2-inline-link" href="https://www.apoing.com" target="_blank" rel="noopener">Ir a apoing.com <i class="fas fa-arrow-up-right-from-square"></i></a>` : ""}
          <button class="text-[9px] font-black text-white/30 uppercase tracking-widest" id="notice-btn-close">Cerrar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#notice-btn-go")?.addEventListener("click", () => {
    notice.action?.();
    overlay.remove();
  });
  overlay.querySelector("#notice-btn-close")?.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
};

function renderHomeIcsSetup() {
  const section = document.getElementById("home-ics-section");
  if (!section) return;
  const hasIcs = Boolean(getHomeApoingIcsUrl());
  section.classList.toggle("hidden", hasIcs);
}

async function renderHomeAppInstallNotice() {
  const host = document.getElementById("home-notice-placeholder");
  if (!host) return;

  // Si ya es APK nativa, no mostrar el banner de descarga
  const isNative = (() => {
    try {
      const cap = window.Capacitor;
      if (!cap) return false;
      if (typeof cap.isNativePlatform === "function") return cap.isNativePlatform();
      const platform = typeof cap.getPlatform === "function" ? cap.getPlatform() : "";
      return platform === "android" || platform === "ios";
    } catch (_) { return false; }
  })();

  if (isNative || !APP_APK_DOWNLOAD_ENABLED) {
    host.classList.add("hidden");
    host.innerHTML = "";
    return;
  }

  const storageKey = "home_apk_notice_dismissed_session";
  try {
    if (sessionStorage.getItem(storageKey) === "1") {
      host.classList.add("hidden");
      host.innerHTML = "";
      return;
    }
  } catch (_) {}

  let apkUrl = APP_APK_URL;
  try {
    apkUrl = await resolveApkDownloadUrl();
  } catch (_) {}
  if (!apkUrl) {
    host.classList.add("hidden");
    host.innerHTML = "";
    return;
  }
  const apkAbsoluteUrl = new URL(apkUrl, window.location.href).toString();

  host.classList.remove("hidden");
  host.innerHTML = `
    <div class="hv2-app-banner">
      <div class="hv2-app-banner-copy">
        <span class="hv2-section-title"><i class="fas fa-mobile-screen-button"></i> App nativa disponible</span>
        <p class="hv2-setup-text">Descarga directa del APK en tu movil. Al abrir la app te pedira permisos de notificaciones y quedara todo listo.</p>
      </div>
      <div class="hv2-app-banner-actions">
        <a class="hv2-inline-link" href="${apkAbsoluteUrl}" download="JafsPadelclub-mobile-release.apk" target="_blank" rel="noopener">
          <i class="fas fa-download"></i> Instalar app
        </a>
        <button type="button" class="hv2-app-banner-close" id="home-app-banner-close">Cerrar</button>
      </div>
    </div>
  `;

  const closeBtn = document.getElementById("home-app-banner-close");
  closeBtn?.addEventListener("click", () => {
    host.classList.add("hidden");
    host.innerHTML = "";
    try { sessionStorage.setItem(storageKey, "1"); } catch (_) {}
  });
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

  // Suprimimos alerta de diario; priorizamos recordatorio de Apoing

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
  const streak = Number.isFinite(Number(currentUserData?.computedStreak))
    ? Number(currentUserData.computedStreak)
    : Number(currentUserData?.rachaActual || 0);
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
    lines.push(`último partido (${when}): ${teamA} vs ${teamB} · ${sets} · ${resultLabel}.`);
  }

  // Sin línea de diario pendiente

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

function getMyRelevantMatches() {
  if (!currentUser?.uid) return [];
  return dedupeEventLinkedMatches(allMatches)
    .filter((m) => !isCancelledMatch(m))
    .filter((m) => isMatchRelevantToMe(m));
}

function getPendingResultMatches() {
  const now = Date.now();
  return getMyRelevantMatches().filter((m) => {
    if (isFinishedMatch(m)) return false;
    if (Boolean(getResultSetsString(m))) return false;
    const matchTime = toDateSafe(m?.fecha);
    if (!matchTime) return false;
    return now - matchTime.getTime() >= RESULT_LOCK_MS;
  });
}

function getProposalDraftKey() {
  return "proposal:draft:v1";
}

function saveProposalDraft(draft) {
  try {
    localStorage.setItem(getProposalDraftKey(), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

function buildProposalDraftFromMeta(meta = {}, proposalId = activeProposalId) {
  const participantIds = Array.isArray(meta?.participantIds) ? meta.participantIds.filter(Boolean) : [];
  const players = [...participantIds];
  while (players.length < 4) players.push(null);
  return {
    proposalId: proposalId || null,
    players: players.slice(0, 4),
    invitedUsers: participantIds.slice(),
    surface: meta?.surface || "indoor",
    courtType: meta?.courtType || "normal",
    createdBy: meta?.createdBy || currentUser?.uid || null,
    title: meta?.title || "Propuesta de partido",
  };
}

function closeProposalModal() {
  document.getElementById("proposal-modal")?.classList.remove("active");
}

function cleanupProposalChat() {
  [proposalChatUnsub, proposalMetaUnsub].forEach((fn) => {
    if (typeof fn === "function") {
      try { fn(); } catch {}
    }
  });
  proposalChatUnsub = null;
  proposalMetaUnsub = null;
  activeProposalId = null;
  activeProposalMeta = null;
}

function preloadProposalUsers() {
  if (proposalUsersCache.length) return;
  subscribeCol(
    "usuarios",
    (rows) => {
      proposalUsersCache = (rows || [])
        .filter((row) => row?.id && row.id !== currentUser?.uid)
        .map((row) => ({ id: row.id, ...row }))
        .sort((a, b) => String(a?.nombreUsuario || a?.nombre || "").localeCompare(String(b?.nombreUsuario || b?.nombre || ""), "es"));
    },
    [],
    [["nombreUsuario", "asc"]],
    120,
  ).catch(() => {});
}

function buildPulseActionCard() {
  const myMatches = getMyRelevantMatches();
  const now = Date.now();
  const diaryEntries = Array.isArray(currentUserData?.diario) ? currentUserData.diario : [];
  const pendingResult = myMatches.filter((m) => {
    if (isFinishedMatch(m)) return false;
    const hasResult = Boolean(getResultSetsString(m));
    if (hasResult) return false;
    const matchTime = toDateSafe(m?.fecha);
    if (!matchTime) return false;
    return now - matchTime.getTime() >= RESULT_LOCK_MS;
  });
  if (pendingResult.length) {
    return {
      tone: "action",
      eyebrow: "Decision inmediata",
      tag: "Administra",
      title: "Cierra tus resultados",
      copy: `Hay ${pendingResult.length} partido${pendingResult.length === 1 ? "" : "s"} esperando marcador. Si lo registras ahora, el ranking y el historial quedan sincronizados.`,
      chips: ["ranking al dia", "sin bloqueos", "mejor trazabilidad"],
      ctaLabel: "Ir a calendario",
      ctaAction: `window.location.href='calendario.html'`,
    };
  }

  const finishedWithResult = myMatches
    .filter((m) => isFinishedMatch(m))
    .sort((a, b) => (toDateSafe(b.fecha)?.getTime() || 0) - (toDateSafe(a.fecha)?.getTime() || 0));
  const missingDiary = finishedWithResult.find((m) => !diaryEntries.some((e) => e.matchId === m.id));
  if (missingDiary) {
    const when = toDateSafe(missingDiary.fecha)?.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" }) || "reciente";
    return {
      tone: "action",
      eyebrow: "Siguiente mejora",
      tag: "Diario",
      title: "Registra tu lectura del partido",
      copy: `Tu ultimo partido con resultado del ${when} aun no tiene analisis. Guardarlo mejora tu historial, tu perfil y las recomendaciones.`,
      chips: ["historial", "analisis", "mejor perfil"],
      ctaLabel: "Abrir diario",
      ctaAction: `window.location.href='diario.html'`,
    };
  }

  const openSuggestions = dedupeEventLinkedMatches(allMatches)
    .filter((m) => !isCancelledMatch(m))
    .filter((m) => !isFinishedMatch(m))
    .filter((m) => !isMatchRelevantToMe(m))
    .filter((m) => !isEventKnockoutLocked(m))
    .filter((m) => getNormalizedPlayers(m).filter(Boolean).length < 4)
    .filter((m) => {
      const d = toDateSafe(m.fecha);
      return d && d.getTime() >= now - 5 * 60 * 1000;
    })
    .map((m) => ({
      ...m,
      __matchFit: scoreMatchForUser(m, currentUserData || currentUser || {}, getPlayerMeta, getMatchmakingContext()),
    }))
    .sort((a, b) => Number(b.__matchFit?.total || 0) - Number(a.__matchFit?.total || 0));
  const top = openSuggestions[0];
  if (top) {
    const fit = top.__matchFit || {};
    const when = toDateSafe(top.fecha)?.toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) || "sin fecha";
    return {
      tone: "action",
      eyebrow: "Mejor oportunidad",
      tag: `${Math.round(fit.total || 0)}% match`,
      title: "Hay una partida muy encajable",
      copy: `Se juega ${when} y aparece como ${fit.headline || "buen encaje"} para tu nivel y disponibilidad.`,
      chips: (fit.reasons || []).slice(0, 3),
      ctaLabel: "Ver partido",
      ctaAction: `window.openMatch('${top.id}','${top.col}')`,
    };
  }

  return {
    tone: "action",
    eyebrow: "Todo en orden",
    tag: "Estable",
    title: "Tu panel esta al dia",
    copy: "No hay tareas criticas pendientes. Es un buen momento para revisar tus partidas, explorar rivales o lanzar una nueva propuesta.",
    chips: ["sin alertas", "estado limpio", "listo para competir"],
    ctaLabel: "Ver eventos",
    ctaAction: `window.location.href='eventos.html'`,
  };
}

function buildPulseFormCard() {
  const myMatches = getMyRelevantMatches();
  const recentFinished = myMatches
    .filter((m) => isFinishedMatch(m))
    .sort((a, b) => (toDateSafe(b.fecha)?.getTime() || 0) - (toDateSafe(a.fecha)?.getTime() || 0))
    .slice(0, 5);
  let wins = 0;
  recentFinished.forEach((m) => {
    const winner = resolveWinnerTeam(m);
    const side = getTeamSide(m, currentUser?.uid);
    if (winner && side && winner === side) wins += 1;
  });
  const losses = Math.max(0, recentFinished.length - wins);
  const winRate = recentFinished.length ? Math.round((wins / recentFinished.length) * 100) : 0;
  const avgFit = dedupeEventLinkedMatches(allMatches)
    .filter((m) => !isCancelledMatch(m))
    .filter((m) => !isFinishedMatch(m))
    .filter((m) => !isMatchRelevantToMe(m))
    .filter((m) => getNormalizedPlayers(m).filter(Boolean).length < 4)
    .map((m) => Number(scoreMatchForUser(m, currentUserData || currentUser || {}, getPlayerMeta, getMatchmakingContext()).total || 0))
    .slice(0, 8);
  const avgOpportunity = avgFit.length ? Math.round(avgFit.reduce((a, b) => a + b, 0) / avgFit.length) : 0;
  const streak = Number.isFinite(Number(currentUserData?.computedStreak))
    ? Number(currentUserData.computedStreak)
    : Number(currentUserData?.rachaActual || 0);

  return {
    tone: "form",
    eyebrow: "Forma actual",
    tag: streak > 0 ? `+${streak} racha` : streak < 0 ? `${streak} racha` : "sin racha",
    title: recentFinished.length ? `${wins}-${losses} en tus ultimos ${recentFinished.length}` : "Todavia sin muestra suficiente",
    copy: recentFinished.length
      ? `Tu ventana reciente marca ${winRate}% de victorias. El mercado actual te ofrece oportunidades con un encaje medio del ${avgOpportunity || 0}%.`
      : "Aun faltan partidos cerrados para medir tendencia competitiva real. En cuanto juegues mas, este bloque empezara a detectar forma y ritmo.",
    metrics: [
      { value: `${winRate}%`, label: "win rate corto" },
      { value: `${avgOpportunity || 0}%`, label: "oportunidad media" },
    ],
  };
}

function buildPulseAgendaCard() {
  const myMatches = getMyRelevantMatches();
  const now = Date.now();
  const nextMine = myMatches
    .filter((m) => !isFinishedMatch(m))
    .filter((m) => {
      const d = toDateSafe(m.fecha);
      return d && d.getTime() >= now - 10 * 60 * 1000;
    })
    .sort((a, b) => (toDateSafe(a.fecha)?.getTime() || 0) - (toDateSafe(b.fecha)?.getTime() || 0))[0];
  const thisWeek = myMatches.filter((m) => {
    const d = toDateSafe(m.fecha);
    if (!d) return false;
    return d.getTime() >= now && d.getTime() <= now + 7 * 24 * 60 * 60 * 1000;
  }).length;
  const openSlots = dedupeEventLinkedMatches(allMatches)
    .filter((m) => !isCancelledMatch(m))
    .filter((m) => !isFinishedMatch(m))
    .filter((m) => !isMatchRelevantToMe(m))
    .filter((m) => getNormalizedPlayers(m).filter(Boolean).length < 4).length;
  const when = nextMine
    ? toDateSafe(nextMine.fecha)?.toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "sin reserva activa";

  return {
    tone: "agenda",
    eyebrow: "Agenda competitiva",
    tag: thisWeek ? `${thisWeek} esta semana` : "semana libre",
    title: nextMine ? "Tu proxima cita ya esta fijada" : "Aun puedes ocupar huecos clave",
    copy: nextMine
      ? `La siguiente partida esta prevista para ${when}. Tienes ${openSlots} huecos abiertos adicionales en la app por si quieres jugar mas.`
      : `No hay una reserva personal inmediata. Ahora mismo hay ${openSlots} partidos abiertos donde todavia puedes entrar.`,
    metrics: [
      { value: nextMine ? when : "--", label: "proximo slot" },
      { value: `${openSlots}`, label: "huecos abiertos" },
    ],
  };
}

function renderCompetitivePulse() {
  const container = document.getElementById("home-competitive-pulse");
  if (!container) return;

  const cards = [buildPulseActionCard(), buildPulseFormCard(), buildPulseAgendaCard()];
  container.innerHTML = cards.map((card) => {
    const metrics = Array.isArray(card.metrics) && card.metrics.length
      ? `<div class="hv2-pulse-metrics">${card.metrics.map((item) => `<div class="hv2-pulse-metric"><b>${item.value}</b><span>${item.label}</span></div>`).join("")}</div>`
      : `<div class="hv2-pulse-list">${(card.chips || []).map((chip) => `<span class="hv2-pulse-chip">${chip}</span>`).join("")}</div>`;
    const cta = card.ctaLabel && card.ctaAction
      ? `<button class="hv2-pulse-cta" onclick="${card.ctaAction}">${card.ctaLabel}<i class="fas fa-chevron-right"></i></button>`
      : "";
    return `
      <article class="hv2-pulse-card is-${card.tone || "action"}">
        <div class="hv2-pulse-top">
          <span class="hv2-pulse-eyebrow">${card.eyebrow || "Panel"}</span>
          <span class="hv2-pulse-tag">${card.tag || "activo"}</span>
        </div>
        <div class="hv2-pulse-title">${card.title || "Sin datos"}</div>
        <div class="hv2-pulse-copy">${card.copy || ""}</div>
        ${metrics}
        ${cta}
      </article>
    `;
  }).join("");
}

function renderHomeGuidedPanel() {
  const container = document.getElementById("home-guided-panel");
  if (!container) return;
  if (isHomeGuideDismissed()) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  const myMatches = getMyRelevantMatches();
  const hasFuture = myMatches.some((m) => !isFinishedMatch(m) && toDateSafe(m?.fecha));
  const hasEvent = Array.isArray(myEvents) && myEvents.length > 0;
  const hasHistory = myMatches.some((m) => isFinishedMatch(m));
  const finishedCount = [hasFuture, hasEvent, hasHistory].filter(Boolean).length;
  const progressPct = Math.round((finishedCount / 3) * 100);

  container.classList.remove("hidden");
  container.innerHTML = `
    <div class="hv2-guide-card">
      <div class="hv2-guide-head">
        <span class="hv2-guide-title"><i class="fas fa-compass"></i> Empieza aquí</span>
        <button type="button" class="hv2-guide-close" onclick="window.dismissHomeGuide()">Ocultar</button>
      </div>
      <div class="hv2-guide-sub">Haz estos 3 pasos para entender la app en 2 minutos.</div>
      <div class="hv2-guide-progress">
        <span style="width:${progressPct}%"></span>
      </div>
      <div class="hv2-guide-list">
        <a class="hv2-guide-step ${hasFuture ? "done" : ""}" href="calendario.html">
          <i class="fas ${hasFuture ? "fa-circle-check" : "fa-circle"}"></i>
          <span>Reserva o únete a tu primer partido</span>
        </a>
        <a class="hv2-guide-step ${hasEvent ? "done" : ""}" href="eventos.html">
          <i class="fas ${hasEvent ? "fa-circle-check" : "fa-circle"}"></i>
          <span>Entra en un evento y revisa cruces</span>
        </a>
        <a class="hv2-guide-step ${hasHistory ? "done" : ""}" href="historial.html">
          <i class="fas ${hasHistory ? "fa-circle-check" : "fa-circle"}"></i>
          <span>Mira resultados y evolución personal</span>
        </a>
      </div>
    </div>
  `;
}

function renderHomeDailyChallenge() {
  const container = document.getElementById("home-daily-challenge");
  if (!container) return;
  const myMatches = getMyRelevantMatches();
  const openSlots = dedupeEventLinkedMatches(allMatches)
    .filter((m) => !isCancelledMatch(m))
    .filter((m) => !isFinishedMatch(m))
    .filter((m) => !isMatchRelevantToMe(m))
    .filter((m) => getNormalizedPlayers(m).filter(Boolean).length < 4).length;
  const streak = Number.isFinite(Number(currentUserData?.computedStreak))
    ? Number(currentUserData.computedStreak)
    : Number(currentUserData?.rachaActual || 0);
  const today = new Date();
  const recentWins = myMatches
    .filter((m) => isFinishedMatch(m))
    .filter((m) => {
      const d = toDateSafe(m?.fecha);
      if (!d) return false;
      return (today.getTime() - d.getTime()) <= (1000 * 60 * 60 * 24 * 10);
    })
    .filter((m) => resolveWinnerTeam(m) === getTeamSide(m, currentUser?.uid))
    .length;
  const challengeReady = openSlots > 0 || !myMatches.some((m) => !isFinishedMatch(m));
  container.innerHTML = `
    <div class="hv2-challenge-card ${challengeReady ? "ready" : ""}">
      <div class="hv2-challenge-top">
        <span class="hv2-challenge-kicker"><i class="fas fa-bolt"></i> Reto diario</span>
        <span class="hv2-challenge-pill">${challengeReady ? "Activo" : "En curso"}</span>
      </div>
      <div class="hv2-challenge-title">Juega hoy para subir tu momentum competitivo</div>
      <div class="hv2-challenge-copy">
        ${challengeReady
          ? `Tienes ${openSlots} partido${openSlots === 1 ? "" : "s"} abierto${openSlots === 1 ? "" : "s"} para entrar ahora mismo.`
          : "Ya tienes actividad pendiente. Ciérrala con resultado para mantener tu ritmo."}
      </div>
      <div class="hv2-challenge-metrics">
        <div><b>${streak}</b><span>racha</span></div>
        <div><b>${recentWins}</b><span>victorias (10d)</span></div>
        <div><b>${openSlots}</b><span>huecos libres</span></div>
      </div>
      <div class="hv2-challenge-actions">
        <button type="button" class="hv2-challenge-btn" onclick="window.location.href='calendario.html'">Jugar hoy</button>
        <button type="button" class="hv2-challenge-btn ghost" onclick="window.location.href='eventos.html'">Ir a eventos</button>
      </div>
    </div>
  `;
}

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

function renderHomeAchievements() {
  const container = document.getElementById("home-achievements");
  if (!container) return;
  const myMatches = getMyRelevantMatches().filter((m) => isFinishedMatch(m));
  const streak = Number.isFinite(Number(currentUserData?.computedStreak))
    ? Number(currentUserData.computedStreak)
    : Number(currentUserData?.rachaActual || 0);
  const totalWins = myMatches.filter((m) => resolveWinnerTeam(m) === getTeamSide(m, currentUser?.uid)).length;
  const totalPlayed = myMatches.length;
  const winRate = totalPlayed ? Math.round((totalWins / totalPlayed) * 100) : 0;
  const badges = [
    {
      label: "En racha",
      icon: "fa-fire",
      unlocked: streak >= 3,
      hint: "Gana 3 partidos seguidos",
    },
    {
      label: "Competidor",
      icon: "fa-trophy",
      unlocked: totalWins >= 10,
      hint: "Llega a 10 victorias",
    },
    {
      label: "Sólido",
      icon: "fa-shield-halved",
      unlocked: totalPlayed >= 8 && winRate >= 55,
      hint: "8 partidos y 55% de winrate",
    },
  ];
  const unlocked = badges.filter((b) => b.unlocked).length;

  const { start, end } = getWeekRange();
  const weekMatches = getMyRelevantMatches().filter((m) => {
    const d = toDateSafe(m?.fecha);
    return d && d >= start && d < end;
  });
  const weekPlayed = weekMatches.filter((m) => isFinishedMatch(m)).length;
  const weeklyTarget = 3;
  const weeklyPct = Math.min(100, Math.round((weekPlayed / weeklyTarget) * 100));

  const rivalCount = new Map();
  myMatches.forEach((m) => {
    const players = getNormalizedPlayers(m).filter(Boolean).map((uid) => String(uid));
    players.forEach((uid) => {
      if (!currentUser?.uid || uid === String(currentUser.uid)) return;
      rivalCount.set(uid, Number(rivalCount.get(uid) || 0) + 1);
    });
  });
  const topRival = [...rivalCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const rivalName = topRival ? getPlayerDisplayName(topRival[0]) : "Aún por descubrir";
  const rivalGames = topRival ? topRival[1] : 0;

  container.innerHTML = `
    <div class="hv2-achv-card">
      <div class="hv2-achv-head">
        <span class="hv2-achv-title"><i class="fas fa-medal"></i> Logros y competitividad</span>
        <span class="hv2-achv-chip">${unlocked}/${badges.length} desbloqueados</span>
      </div>
      <div class="hv2-achv-grid">
        ${badges.map((b) => `
          <div class="hv2-achv-badge ${b.unlocked ? "on" : "off"}">
            <i class="fas ${b.icon}"></i>
            <strong>${b.label}</strong>
            <span>${b.unlocked ? "Conseguido" : b.hint}</span>
          </div>
        `).join("")}
      </div>
      <div class="hv2-weekly-card">
        <div class="hv2-weekly-top">
          <span><i class="fas fa-bullseye"></i> Misión semanal</span>
          <b>${weekPlayed}/${weeklyTarget}</b>
        </div>
        <div class="hv2-weekly-bar"><span style="width:${weeklyPct}%"></span></div>
        <div class="hv2-weekly-copy">Juega ${weeklyTarget} partidos esta semana para mantener ritmo competitivo.</div>
      </div>
      <div class="hv2-rival-card">
        <div class="hv2-rival-top"><i class="fas fa-crosshairs"></i> Rival más frecuente</div>
        <div class="hv2-rival-name">${escapeHtml(rivalName)}</div>
        <div class="hv2-rival-copy">${rivalGames ? `${rivalGames} enfrentamientos registrados` : "Aún no hay histórico suficiente"}</div>
      </div>
    </div>
  `;
}

function renderHomeCompactBrief() {
  const container = document.getElementById("home-compact-brief");
  if (!container) return;

  const myMatches = getMyRelevantMatches();
  const nextMine = myMatches
    .filter((m) => !isFinishedMatch(m))
    .sort((a, b) => (toDateSafe(a.fecha)?.getTime() || 0) - (toDateSafe(b.fecha)?.getTime() || 0))[0];
  const openSlots = dedupeEventLinkedMatches(allMatches)
    .filter((m) => !isCancelledMatch(m))
    .filter((m) => !isFinishedMatch(m))
    .filter((m) => !isMatchRelevantToMe(m))
    .filter((m) => getNormalizedPlayers(m).filter(Boolean).length < 4).length;
  const recentFinished = myMatches.filter((m) => isFinishedMatch(m)).slice(-5);
  const recentWins = recentFinished.filter((m) => resolveWinnerTeam(m) && resolveWinnerTeam(m) === getTeamSide(m, currentUser?.uid)).length;
  const winRate = recentFinished.length ? Math.round((recentWins / recentFinished.length) * 100) : 0;
  const clubMoves = clubFeedItems.slice(0, 6).length;
  const nextWhen = nextMine
    ? toDateSafe(nextMine.fecha)?.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "--";

  container.innerHTML = [
    {
      value: nextWhen || "--",
      label: "Próximo slot",
      copy: nextMine ? "Tu próxima cita ya está fijada." : "Todavía sin partido reservado.",
    },
    {
      value: `${openSlots}`,
      label: "Huecos abiertos",
      copy: openSlots ? "Opciones reales para entrar hoy o esta semana." : "Ahora mismo no hay plazas libres relevantes.",
    },
    {
      value: recentFinished.length ? `${winRate}%` : `${clubMoves}`,
      label: recentFinished.length ? "Forma reciente" : "Actividad social",
      copy: recentFinished.length ? "Rendimiento corto de tus últimos cierres." : "Movimientos recientes detectados en el club.",
    },
  ].map((item) => `
    <article class="hv2-brief-card">
      <span>${item.label}</span>
      <strong>${item.value}</strong>
      <p>${item.copy}</p>
    </article>
  `).join("");
  renderHomeGuidedPanel();
  renderHomeDailyChallenge();
  renderHomeAchievements();
}

function renderClubFeedLegacy() {
  const container = document.getElementById("home-club-feed");
  if (!container) return;
  if (!clubFeedItems.length) {
    container.innerHTML = `<div class="hv2-empty-state"><i class="fas fa-wave-square"></i>La actividad reciente aparecera aqui en cuanto haya partidos y resultados.</div>`;
    return;
  }

  const iconByTone = {
    diary: "fa-book-open",
    match: "fa-table-tennis-paddle-ball",
    admin: "fa-shield-halved",
    elo: "fa-bolt",
    system: "fa-sparkles",
  };

  container.innerHTML = clubFeedItems.slice(0, 6).map((item) => {
    const tone = item?.tone || "system";
    const icon = iconByTone[tone] || "fa-sparkles";
    const name = item?.uid === currentUser?.uid
      ? (currentUserData?.nombreUsuario || currentUserData?.nombre || "Tu")
      : getPlayerDisplayName(item?.uid);
    const date = toDateSafe(item?.createdAt);
    const when = date
      ? date.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "ahora";
    return `
      <article class="hv2-club-card">
        <div class="hv2-club-icon ${tone}"><i class="fas ${icon}"></i></div>
        <div class="hv2-club-main">
          <div class="hv2-club-eyebrow">${item?.tag || "Sistema"} · ${name || "Jugador"}</div>
          <div class="hv2-club-title">${item?.title || "Cierre reciente"}</div>
          <div class="hv2-club-text">${item?.text || "Nuevo cierre registrado."}</div>
        </div>
        <div class="hv2-club-date">${when}</div>
      </article>
    `;
  }).join("");
}

function setClubFeedSectionVisible(visible) {
  const section = document.getElementById("home-club-feed-section");
  if (!section) return;
  section.classList.toggle("hidden", !visible);
}

function buildDerivedClubFeed() {
  const safeMatches = dedupeEventLinkedMatches(allMatches || []).filter((m) => !isCancelledMatch(m));

  const finished = safeMatches
    .filter((m) => isFinishedMatch(m))
    .sort((a, b) => (toDateSafe(b?.fecha)?.getTime() || 0) - (toDateSafe(a?.fecha)?.getTime() || 0))
    .slice(0, 4)
    .map((m) => {
      const players = getNormalizedPlayers(m).map((uid) => getPlayerDisplayName(uid));
      const teamA = getFriendlyTeamName(m?.teamAName, players.slice(0, 2));
      const teamB = getFriendlyTeamName(m?.teamBName, players.slice(2, 4));
      const winner = resolveWinnerTeam(m);
      const winnerName = winner === "A" ? teamA : winner === "B" ? teamB : "";
      return {
        source: "derived",
        tone: "match",
        tag: "Cierre",
        title: winnerName ? `Gano ${winnerName}` : "Partido cerrado",
        text: `${teamA} vs ${teamB}${getResultSetsString(m) ? ` · ${getResultSetsString(m)}` : ""}`,
        createdAt: toDateSafe(m?.fecha) || new Date(),
        matchId: m?.id || null,
      };
    });

  const openUpcoming = safeMatches
    .filter((m) => !isFinishedMatch(m))
    .filter((m) => getNormalizedPlayers(m).length < 4)
    .sort((a, b) => (toDateSafe(a?.fecha)?.getTime() || 0) - (toDateSafe(b?.fecha)?.getTime() || 0))
    .slice(0, 3)
    .map((m) => {
      const date = toDateSafe(m?.fecha);
      const freeSlots = Math.max(0, 4 - getNormalizedPlayers(m).length);
      return {
        source: "derived",
        tone: "system",
        tag: "Hueco",
        title: freeSlots > 1 ? `${freeSlots} plazas libres` : "Última plaza libre",
        text: `${date ? date.toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Próximo turno"} · ${m?.col === "partidosReto" ? "Reto" : m?.col === "eventoPartidos" ? "Torneo" : "Amistoso"}`,
        createdAt: date || new Date(),
        matchId: m?.id || null,
      };
    });

  return finished;
}

function renderClubFeed() {
  const container = document.getElementById("home-club-feed");
  if (!container) return;

  const iconByTone = {
    diary: "fa-book-open",
    match: "fa-table-tennis-paddle-ball",
    admin: "fa-shield-halved",
    elo: "fa-bolt",
    system: "fa-sparkles",
  };

  const mergedFeed = [...clubFeedItems.filter((item) => ["match", "elo", "admin", "system"].includes(String(item?.tone || "system"))), ...buildDerivedClubFeed()]
    .filter(Boolean)
    .sort((a, b) => (toDateSafe(b?.createdAt || b?.fecha)?.getTime() || 0) - (toDateSafe(a?.createdAt || a?.fecha)?.getTime() || 0))
    .filter((item, index, arr) => {
      const key = `${item?.uid || "app"}|${item?.matchId || item?.entityId || item?.title}|${item?.title}`;
      return arr.findIndex((x) => `${x?.uid || "app"}|${x?.matchId || x?.entityId || x?.title}|${x?.title}` === key) === index;
    })
    .slice(0, 4);

  if (!mergedFeed.length) {
    setClubFeedSectionVisible(false);
    container.innerHTML = `<div class="hv2-empty-state"><i class="fas fa-wave-square"></i>Cuando haya partidos y resultados, aqui tendras un resumen util.</div>`;
    renderHomeRecentResults();
    return;
  }

  setClubFeedSectionVisible(true);
  container.innerHTML = mergedFeed.map((item) => {
    const tone = item?.tone || "system";
    const icon = iconByTone[tone] || "fa-sparkles";
    const name = item?.uid === currentUser?.uid
      ? (currentUserData?.nombreUsuario || currentUserData?.nombre || "Tu")
      : getPlayerDisplayName(item?.uid);
    const date = toDateSafe(item?.createdAt || item?.fecha);
    const when = date
      ? date.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "ahora";
    return `
      <article class="hv2-club-card ${item?.source === "derived" ? "is-derived" : ""}">
        <div class="hv2-club-icon ${tone}"><i class="fas ${icon}"></i></div>
        <div class="hv2-club-main">
          <div class="hv2-club-eyebrow">${item?.tag || "Sistema"} · ${name || "Jugador"}</div>
          <div class="hv2-club-title">${item?.title || "Cierre reciente"}</div>
          <div class="hv2-club-text">${item?.text || "Nuevo cierre registrado."}</div>
        </div>
        <div class="hv2-club-date">${when}</div>
      </article>
    `;
  }).join("");
  renderHomeRecentResults();
}

function buildRecentResultUsersVs(match) {
  const aIds = getMatchTeamPlayerIds(match, "A");
  const bIds = getMatchTeamPlayerIds(match, "B");
  const aNames = aIds.map((uid) => getPlayerDisplayName(uid)).filter(Boolean);
  const bNames = bIds.map((uid) => getPlayerDisplayName(uid)).filter(Boolean);
  const left = getFriendlyTeamName({ playerNames: aNames, fallback: "Pareja 1", side: "A" });
  const right = getFriendlyTeamName({ playerNames: bNames, fallback: "Pareja 2", side: "B" });
  
  const winner = resolveWinnerTeam(match);
  const colorA = winner === 'A' ? 'var(--sport-gold)' : 'rgba(255,255,255,0.7)';
  const colorB = winner === 'B' ? 'var(--sport-gold)' : 'rgba(255,255,255,0.7)';
  
  return `<span style="color:${colorA}">${left}</span> <span style="opacity:0.3">vs</span> <span style="color:${colorB}">${right}</span>`;
}

function getHomeHistoryAvatar(uid) {
  if (!uid) return `<div class="p-avatar-mini empty"><i class="fas fa-plus"></i></div>`;
  const photo = playerPhotoCache.get(String(uid)) || "";
  const name = getPlayerDisplayName(uid);
  if (parseGuestMeta(uid)) return `<div class="p-avatar-mini guest" title="${escapeHtml(name)}"><i class="fas fa-user-secret"></i></div>`;
  if (photo) {
    return `<div class="p-avatar-mini" title="${escapeHtml(name)}"><img src="${escapeHtml(photo)}" alt="${escapeHtml(name)}"></div>`;
  }
  return `<div class="p-avatar-mini" title="${escapeHtml(name)}"><img src="https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff" alt="${escapeHtml(name)}"></div>`;
}

function renderHomeRecentResults() {
  const section = document.getElementById("home-recent-results-section");
  const listEl = document.getElementById("home-recent-results-list");
  if (!section || !listEl) return;

  const recent = dedupeEventLinkedMatches(allMatches)
    .filter((m) => !isCancelledMatch(m))
    .filter((m) => isFinishedMatch(m) || Boolean(getResultSetsString(m)))
    .sort((a, b) => (toDateSafe(b.fecha)?.getTime() || 0) - (toDateSafe(a.fecha)?.getTime() || 0))
    .slice(0, 5);

  if (!recent.length) {
    section.classList.add("hidden");
    listEl.innerHTML = "";
    return;
  }

  section.classList.remove("hidden");
  listEl.innerHTML = recent.map((match) => {
    const result = getResultSetsString(match) || "Finalizado";
    const when = toDateSafe(match.fecha)?.toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }) || "Sin fecha";
    const type = String(match.col || "") === "eventoPartidos" ? "Evento" : String(match.col || "") === "partidosReto" ? "Reto" : "Amistoso";
    
    const winner = resolveWinnerTeam(match);
    const scoreColor = winner === 'A' ? 'var(--sport-green)' : (winner === 'B' ? 'var(--sport-gold)' : 'var(--primary)');
    const logs = Array.isArray(match?.rankingDiffs) ? match.rankingDiffs : (Array.isArray(match?.eloDiffs) ? match.eloDiffs : []);
    const pointDelta = logs.find((row) => String(row?.uid || row?.playerId || "") === String(currentUser?.uid || ""));
    const deltaValue = Number(pointDelta?.diff || pointDelta?.delta || 0);
    const deltaText = Number.isFinite(deltaValue) && deltaValue !== 0 ? `${deltaValue > 0 ? "+" : ""}${deltaValue.toFixed(1)} pts` : "Puntos en detalle";
    const aiSummary = match?.resumenIA || match?.aiSummary || match?.resultado?.resumenIA || match?.analisisIA || "";
    const safeDate = toDateSafe(match.fecha);
    const players = getNormalizedPlayers(match);
    const avatars = players.slice(0, 4).map((uid) => getHomeHistoryAvatar(uid)).join("");
    const stateClass = winner === "A" || winner === "B"
      ? ((players.includes(currentUser?.uid) && ((players.indexOf(currentUser.uid) < 2 && winner === "A") || (players.indexOf(currentUser.uid) >= 2 && winner === "B"))) ? "won" : "lost")
      : "neutral";

    return `
      <article class="history-card-premium ${stateClass} animate-up home-history-card home-history-card-pro" onclick="window.openMatch('${match.id}','${match.col}')">
        <div class="h-card-inner">
          <div class="h-card-date">
            <span class="day">${safeDate ? safeDate.getDate() : "--"}</span>
            <span class="month">${safeDate ? safeDate.toLocaleDateString('es-ES', { month: 'short' }).toUpperCase() : "---"}</span>
          </div>
          <div class="h-card-content">
            <div class="h-card-top">
              <span class="h-type-badge ${String(match.col || "") === "partidosReto" ? "reto" : String(match.col || "") === "eventoPartidos" ? "reto" : "friendly"}">${type}</span>
              <span class="h-host">${escapeHtml(when)}</span>
            </div>
            <div class="h-card-main">
              <div class="home-history-scoreline">
                <div class="h-score" style="color:${scoreColor};">${escapeHtml(result)}</div>
                <div class="home-history-result-pill ${stateClass}">${stateClass === "won" ? "Victoria" : stateClass === "lost" ? "Derrota" : "Cerrado"}</div>
              </div>
              <div class="h-card-matchup">${buildRecentResultUsersVs(match)}</div>
              <div class="h-players-row">${avatars}</div>
              <div class="home-history-bottom">
                <div class="home-history-points-card">
                  <span>Puntos</span>
                  <strong>${escapeHtml(deltaText)}</strong>
                </div>
                ${aiSummary ? `<div class="home-history-ai">${escapeHtml(String(aiSummary).slice(0, 140))}</div>` : `<div class="home-history-ai muted">Pulsa para abrir el partido y revisar su resumen completo.</div>`}
              </div>
            </div>
          </div>
          <div class="h-card-action">
            <div class="home-history-open">
              <span>Ver</span>
              <i class="fas fa-chevron-right"></i>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

/* Notifications */
function bindNotificationNudge() {
  // Inicializamos recomendaciones por primera vez
  refreshRecommendations();
  renderHomeCompactBrief();
  renderCompetitivePulse();
  renderClubFeed();
}

function isEventMatch(match) {
  return (
    String(match?.col || "") === "eventoPartidos" ||
    Boolean(match?.eventMatchId || match?.eventoId || match?.eventLink?.eventoId)
  );
}

function isKnockoutPhaseMatch(match = {}) {
  const phase = String(match.phase || "").toLowerCase();
  return ["knockout", "semi", "semis", "semifinal", "final", "cuartos", "quarter"].includes(phase);
}

function isGroupPhaseMatch(match = {}, ev = null) {
  const phase = String(match.phase || "").toLowerCase();
  if (["group", "liga", "league", "grupos"].includes(phase)) return true;
  if (!phase && (ev?.formato === "groups" || ev?.formato === "league")) return true;
  return false;
}

function isEventGroupsComplete(eventId) {
  if (!eventId) return true;
  const ev = eventDocCache.get(eventId) || null;
  const matches = allMatches.filter((m) => getEventIdFromMatch(m) === eventId);
  const groupMatches = matches.filter((m) => isGroupPhaseMatch(m, ev));
  if (!groupMatches.length) return true;
  return groupMatches.every((m) => isFinishedMatch(m));
}

function isEventKnockoutLocked(match) {
  if (!isEventMatch(match)) return false;
  if (!isKnockoutPhaseMatch(match)) return false;
  const eventId = getEventIdFromMatch(match);
  return !isEventGroupsComplete(eventId);
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
  return sharedIsUnknownTeamName(value);
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

  const aPlayed = Boolean(getResultSetsString(a)) || String(a?.estado || "").toLowerCase() === "jugado";
  const bPlayed = Boolean(getResultSetsString(b)) || String(b?.estado || "").toLowerCase() === "jugado";
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
  // Keep eventDocCache in sync with real-time event data
  myEvents.forEach((ev) => {
    if (ev?.id) eventDocCache.set(ev.id, ev);
    indexEventUserNames(ev);
  });
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

function formatCompactMatchDate(dateIn) {
  const d = toDateSafe(dateIn);
  if (!d) return { day: "--", month: "--", weekday: "--", time: "--:--" };
  return {
    day: d.toLocaleDateString("es-ES", { day: "2-digit" }),
    month: d.toLocaleDateString("es-ES", { month: "short" }).replace(".", "").toUpperCase(),
    weekday: d.toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "").toUpperCase(),
    time: d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }),
  };
}

function getAverageLevelFromPlayers(players = []) {
  const levels = players
    .map((uid) => Number(playerDataCache.get(String(uid))?.nivel || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!levels.length) return null;
  return levels.reduce((acc, value) => acc + value, 0) / levels.length;
}

function getWeatherBadgeForDate(dateIn) {
  const d = toDateSafe(dateIn);
  if (!d || !Array.isArray(weather?.daily?.time)) {
    return { icon: "fa-cloud", temp: "--", label: "Clima pendiente", note: "Sin previsión" };
  }
  const idx = weather.daily.time.findIndex((item) => String(item) === d.toLocaleDateString("sv-SE"));
  if (idx < 0) {
    return { icon: "fa-cloud", temp: "--", label: "Clima pendiente", note: "Sin previsión" };
  }
  const code = Number(weather.daily.weather_code?.[idx] || 0);
  let icon = "fa-sun";
  let label = "Despejado";
  if (code >= 45 && code <= 48) {
    icon = "fa-smog";
    label = "Bruma";
  } else if (code >= 51 && code <= 67) {
    icon = "fa-cloud-rain";
    label = "Lluvia";
  } else if (code >= 80) {
    icon = "fa-cloud-showers-heavy";
    label = "Inestable";
  } else if (code >= 2) {
    icon = "fa-cloud";
    label = "Nubes";
  }
  const max = Math.round(Number(weather.daily.temperature_2m_max?.[idx] || 0));
  const min = Math.round(Number(weather.daily.temperature_2m_min?.[idx] || 0));
  const rain = Math.round(Number(weather.daily.precipitation_probability_max?.[idx] || 0));
  return {
    icon,
    temp: `${max}°/${min}°`,
    label,
    note: rain ? `${rain}% lluvia` : "Pista favorable",
  };
}

function getUpcomingRelevantMatchWithoutApoing() {
  const now = Date.now();
  return allMatches
    .filter((m) => isMatchRelevantToMe(m))
    .filter((m) => !isCancelledMatch(m) && !isFinishedMatch(m))
    .filter((m) => {
      const d = toDateSafe(m?.fecha);
      return d && d.getTime() >= now - 10 * 60 * 1000;
    })
    .sort((a, b) => (toDateSafe(a.fecha)?.getTime() || 0) - (toDateSafe(b.fecha)?.getTime() || 0))
    .find((match) => {
      const matchDate = toDateSafe(match?.fecha);
      if (!matchDate) return false;
      return !apoingEvents.some((ev) => {
        if (String(ev?.sourceUid || "") !== String(currentUser?.uid || "")) return false;
        return Math.abs((ev.dtStart?.getTime?.() || 0) - matchDate.getTime()) <= 90 * 60 * 1000;
      });
    }) || null;
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

    const myTeamFromEvent = getMyTeamFromEvent(nextEvent);
    const myGroup = myTeamFromEvent
      ? Object.entries(nextEvent.groups || {}).find(([, ids]) => ids?.includes(myTeamFromEvent.id))?.[0]
      : null;

    const eventMatches = allMatches.filter(
      (m) => String(m.col || "") === "eventoPartidos" && getEventIdFromMatch(m) === nextEvent.id,
    );
    
    const groupMatches = eventMatches.filter((m) => {
      if (!isGroupPhaseMatch(m, nextEvent)) return false;
      if (myGroup && m.group) return String(m.group) === String(myGroup);
      return true;
    });

    // Find team matches by ID if generated, or just by player UIDs if still in pool
    const teamMatches = myTeamFromEvent?.id
      ? groupMatches.filter((m) => m.teamAId === myTeamFromEvent.id || m.teamBId === myTeamFromEvent.id)
      : groupMatches.filter((m) => getNormalizedPlayers(m).includes(currentUser?.uid));

    const totalTeam = teamMatches.length;
    const playedTeam = teamMatches.filter((m) => isFinishedMatch(m)).length;
    const pendingTeam = totalTeam - playedTeam;
    const totalEvent = groupMatches.length;
    const playedEvent = groupMatches.filter((m) => isFinishedMatch(m)).length;
    const teamPct = totalTeam ? Math.round((playedTeam / totalTeam) * 100) : 0;
    const eventPct = totalEvent ? Math.round((playedEvent / totalEvent) * 100) : 0;


    cards.push(`
      <div class="hv2-event-chip premium-v2">
        <div class="hv2-event-chip-header">
           <div class="hv2-event-chip-title">${(nextEvent.nombre || "Evento").toUpperCase()}</div>
           <div class="hv2-event-chip-tag">${String(nextEvent.estado || "inscripcion").toUpperCase()}</div>
        </div>
        
        <div class="hv2-event-chip-sub">
          <i class="fas fa-users-viewfinder mr-1"></i> ${inscritos}/${Number(nextEvent.plazasMax || 16)} Plazas confirmadas
        </div>

        <div class="hv2-event-meta-grid">
          <div class="hv2-meta-item">
            <span class="hv2-meta-label">Compañero/a</span>
            <div class="hv2-meta-val-wrap">
              <i class="fas fa-user-friends text-primary"></i>
              <span class="hv2-meta-value">${partnerName}</span>
            </div>
          </div>
          <div class="hv2-meta-item">
            <span class="hv2-meta-label">Tu Grupo</span>
            <div class="hv2-meta-val-wrap">
              <i class="fas fa-layer-group text-primary"></i>
              <span class="hv2-meta-value">${myGroup ? `GRUPO ${myGroup}` : 'POR ASIGNAR'}</span>
            </div>
          </div>
        </div>

        <div class="hv2-event-progress-section">
          <div class="hv2-progress-row">
            <div class="hv2-progress-head">
              <span>Progreso de tu equipo</span>
              <span>${playedTeam}/${totalTeam || 0}</span>
            </div>
            <div class="hv2-progress-bar main"><span style="width:${teamPct}%"></span></div>
          </div>
        </div>

        <div id="event-standings-slot" class="hv2-event-standings-container"></div>
        
        <div class="hv2-event-actions mt-3 flex-row gap-2">
           <button type="button" class="btn-premium-v7 sm shadow flex-1 items-center justify-center gap-1" onclick="window.downloadEventPoster('${nextEvent.id}')">
             <i class="fas fa-file-arrow-down mr-1"></i> CARTEL
           </button>
           <a href="evento-detalle.html?id=${nextEvent.id}" class="btn-event-enter flex-1 text-center bg-white/10 hover:bg-white/20 text-white rounded-full text-[10px] font-black uppercase tracking-widest px-4 py-3 border border-white/20 transition-all duration-300">
              PANEL <i class="fas fa-chevron-right ml-1"></i>
           </a>
        </div>
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
      const resultSets = getResultSetsString(m);
      const result = resultSets ? ` · ${resultSets}` : "";
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
      const getTeamLabel = (tId, tName, pIds) => getFriendlyTeamName({
        teamName: tName,
        teamId: tId,
        playerNames: Array.isArray(pIds) ? pIds.map((p) => getPlayerDisplayName(p)) : [],
        side: tId === m.teamAId ? "A" : "B"
      }).toUpperCase();
      const teamALabel = getTeamLabel(m.teamAId, m.teamAName, getMatchTeamPlayerIds(m, "A"));
      const teamBLabel = getTeamLabel(m.teamBId, m.teamBName, getMatchTeamPlayerIds(m, "B"));

      cards.push(`
        <div class="hv2-event-chip premium-v2 tournament-match" onclick="window.openMatch('${m.id}','${m.col}')">
          <div class="hv2-event-chip-header">
            <div class="hv2-event-chip-title">PARTIDO DE TORNEO</div>
            <div class="hv2-event-chip-tag phase">${phasePretty}</div>
          </div>
          <div class="hv2-event-chip-sub mt-2">
            <div class="flex-row items-center justify-between">
               <span class="text-white font-bold">${teamALabel} <span class="text-primary italic">vs</span> ${teamBLabel}</span>
               <span class="text-[10px] text-white/40">${when}</span>
            </div>
          </div>
          <div class="hv2-event-chip-footer mt-2 pt-2 border-t border-white/5 flex between items-center">
             <span class="text-[9px] font-black tracking-widest text-[#abc]">${estado}${result}</span>
             <i class="fas fa-chevron-right text-primary text-[10px]"></i>
          </div>
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

renderEventSpotlight = function renderEventSpotlightRefined() {
  const wrap = document.getElementById("event-spotlight");
  const body = document.getElementById("event-spotlight-body");
  const link = document.getElementById("event-spotlight-link");
  if (!wrap || !body) return;

  const upcoming = getMineUpcomingEventMatches();
  const nextEvent = myEvents[0] || null;
  const featuredMatch = upcoming[0] || null;

  wrap.classList.remove("hidden");

  if (!nextEvent) {
    if (link) link.href = "eventos.html";
    body.innerHTML = `
      <article class="hv2-event-hero-card empty-event-state" onclick="window.location.href='eventos.html'">
        <div class="hv2-event-hero-top">
           <div>
             <span class="hv2-event-kicker">Sin evento activo</span>
             <h3 class="hv2-event-title-main">¡Únete a la competición!</h3>
           </div>
           <i class="fas fa-trophy text-primary opacity-50 text-2xl"></i>
        </div>
        <div class="hv2-event-next-mini empty mt-4" style="background: rgba(198,255,0,0.05); border: 1px solid rgba(198,255,0,0.2);">
           <div class="hv2-event-mini-body">
             <span class="hv2-event-mini-label text-primary">Inscripción abierta</span>
             <strong style="color: #fff;">Explora torneos y ligas disponibles</strong>
             <span>Crea tu propio evento o únete a uno existente para medir tu nivel.</span>
           </div>
           <button class="btn-premium-v7 sm mt-2 px-4" style="align-self: flex-start;">VER EVENTOS <i class="fas fa-chevron-right ml-1"></i></button>
        </div>
      </article>
    `;
    const slot = document.getElementById("event-standings-slot");
    if (slot) slot.innerHTML = "";
    return;
  }

  if (link) link.href = `evento-detalle.html?id=${nextEvent.id}`;

  const inscritos = Array.isArray(nextEvent.inscritos) ? nextEvent.inscritos.length : 0;
  const myTeam = getMyTeamFromEvent(nextEvent);
  const myGroup = myTeam
    ? Object.entries(nextEvent.groups || {}).find(([, ids]) => ids?.includes(myTeam.id))?.[0]
    : null;
  const eventMatches = allMatches.filter(
    (m) => String(m.col || "") === "eventoPartidos" && getEventIdFromMatch(m) === nextEvent.id,
  );
  const myEventMatches = eventMatches.filter((m) => isMatchRelevantToMe(m));
  const playedMatches = myEventMatches.filter((m) => isFinishedMatch(m)).length;
  const pendingMatches = Math.max(0, myEventMatches.length - playedMatches);
  const dateBits = formatCompactMatchDate(featuredMatch?.fecha || nextEvent?.fechaInicio || nextEvent?.fecha || null);
  const featuredTeams = featuredMatch ? {
    a: getFriendlyTeamName({
      teamName: featuredMatch.teamAName,
      teamId: featuredMatch.teamAId,
      playerNames: getMatchTeamPlayerIds(featuredMatch, "A").map((id) => getPlayerDisplayName(id)),
      fallback: "Pareja A",
      side: "A",
    }),
    b: getFriendlyTeamName({
      teamName: featuredMatch.teamBName,
      teamId: featuredMatch.teamBId,
      playerNames: getMatchTeamPlayerIds(featuredMatch, "B").map((id) => getPlayerDisplayName(id)),
      fallback: "Pareja B",
      side: "B",
    }),
  } : null;

  body.innerHTML = `
    <article class="hv2-event-hero-card" onclick="window.location.href='evento-detalle.html?id=${nextEvent.id}'">
      <div class="hv2-event-hero-top">
        <div>
          <span class="hv2-event-kicker">Mi evento</span>
          <h3 class="hv2-event-title-main">${escapeHtml(nextEvent.nombre || "Evento")}</h3>
        </div>
        <span class="hv2-event-status">${escapeHtml(String(nextEvent.estado || "activo").toUpperCase())}</span>
      </div>
      <div class="hv2-event-hero-grid">
        <div class="hv2-event-stat"><span>Inscritos</span><strong>${inscritos}/${Number(nextEvent.plazasMax || 16)}</strong></div>
        <div class="hv2-event-stat"><span>Grupo</span><strong>${myGroup ? `Grupo ${myGroup}` : "Pendiente"}</strong></div>
        <div class="hv2-event-stat"><span>Jugados</span><strong>${playedMatches}</strong></div>
        <div class="hv2-event-stat"><span>Por jugar</span><strong>${pendingMatches}</strong></div>
      </div>
      ${featuredMatch ? `
        <div class="hv2-event-next-mini">
          <div class="hv2-event-mini-date">
            <span>${dateBits.weekday}</span>
            <strong>${dateBits.day}</strong>
            <small>${dateBits.month}</small>
          </div>
          <div class="hv2-event-mini-body">
            <span class="hv2-event-mini-label">Siguiente cruce</span>
            <strong>${escapeHtml(featuredTeams?.a || "Pareja A")} vs ${escapeHtml(featuredTeams?.b || "Pareja B")}</strong>
            <span>${dateBits.time}</span>
          </div>
        </div>
      ` : `
        <div class="hv2-event-next-mini empty">
          <div class="hv2-event-mini-body">
            <span class="hv2-event-mini-label">Siguiente cruce</span>
            <strong>Aún no hay partido asignado</strong>
            <span>Entra al panel para revisar fase, clasificación y próximos partidos.</span>
          </div>
        </div>
      `}
    </article>
    <div id="event-standings-slot" class="hv2-event-standings-container"></div>
  `;

  renderEventStandings(nextEvent);
};

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

window.setHomeEventStandingsGroup = (eventId, groupKey = "") => {
  if (!eventId) return;
  const normalized = String(groupKey || "").trim().toUpperCase();
  if (!normalized) eventStandingsGroupOverride.delete(eventId);
  else eventStandingsGroupOverride.set(eventId, normalized);
  const ev = eventDocCache.get(eventId);
  if (ev) renderEventStandings(ev);
};

// Corrección rápida de textos con acentos para navegadores que muestren mojibake
export function fixHomeCopyEncoding() {
  document.querySelectorAll(".hv2-collapsible-summary span").forEach((el) => {
    const text = String(el.textContent || "");
    if (/Ultimos Resultados|Ãšltimos Resultados/i.test(text)) {
      el.innerHTML = `<i class="fas fa-flag-checkered"></i> Últimos Resultados`;
    }
    if (/Mas opciones|Mas del Club/i.test(text)) {
      el.innerHTML = `<i class="fas fa-grid-2"></i> Más opciones`;
    }
  });
}

async function renderNotificationHealthCard() {
  const card = document.getElementById("notify-health-card");
  const statusEl = document.getElementById("notify-health-status");
  const iconEl = document.getElementById("notify-health-icon");
  const btnPerm = document.getElementById("btn-notify-permission");
  const btnHelp = document.getElementById("btn-notify-help");
  if (!card || !statusEl || !btnPerm || !btnHelp || !iconEl) return;

  const setState = (label, tone = "ok") => {
    statusEl.textContent = label;
    card.dataset.tone = tone;
    iconEl.className = "nh-icon " + tone;
  };

  try {
    const status = await checkNotificationStatus();
    const human = await getPushStatusHuman(status);
    setState(human.label || "Listas", human.state || "ok");
  } catch (e) {
    console.warn("Notify health error", e);
    setState("No se pudo comprobar", "warn");
  }

  btnPerm.onclick = async () => {
    btnPerm.disabled = true;
    await requestNotificationPermission();
    btnPerm.disabled = false;
    renderNotificationHealthCard();
  };
  btnHelp.onclick = () => showNotificationHelpModal();
}

async function renderEventStandings(eventDoc) {
  const slot = document.getElementById("event-standings-slot");
  if (!slot || !eventDoc?.id) return;
  const myTeam = getMyTeamFromEvent(eventDoc);
  const myTeamId = myTeam?.id || null;
  const myGroup = getMyGroupFromEvent(eventDoc, myTeamId);
  const activeGroup = eventStandingsGroupOverride.get(eventDoc.id) || myGroup;

    try {
        const cfg = { 
            win: eventDoc.puntosVictoria || 3, 
            draw: eventDoc.puntosEmpate || 1, 
            loss: eventDoc.puntosDerrota || 0 
        };
        
        // Use raw allMatches to get the actual eventoPartidos. 
        // dedupeEventLinkedMatches hides the original event match and replaces it with the calendar match,
        // which lacks teamAId, teamBId, and group fields, breaking the standings calculation.
        const eventMatches = allMatches.filter(m => String(m.col || "") === "eventoPartidos" && getEventIdFromMatch(m) === eventDoc.id);
    const teams = Array.isArray(eventDoc.teams) ? eventDoc.teams : [];

    // Brackets logic!
    const isKnockout = eventDoc.faseActual === 'knockout' || eventDoc.formato === 'knockout';
    if (isKnockout) {
        renderKnockoutBracket(eventDoc, eventMatches, myTeamId, slot);
        return;
    }

    let computedRows = [];
    if (eventDoc.formato === 'league') {
        computedRows = computeGroupTable(eventMatches.filter(m => m.phase === 'league' || !m.phase), teams, cfg);
    } else {
        const g = activeGroup;
        const gTeams = g ? (eventDoc.groups?.[g] || []).map(tid => teams.find(t => t.id === tid)).filter(Boolean) : teams;
        computedRows = computeGroupTable(eventMatches.filter(m => m.group === g), gTeams, cfg);
    }

    renderStandingsRows(computedRows, eventDoc, myTeamId, activeGroup, slot);
  } catch (e) {
    console.error("renderEventStandings fail:", e);
    slot.innerHTML = `<div class="hv2-event-standings-empty">No se pudo calcular la clasificación.</div>`;
  }
}

function renderKnockoutBracket(eventDoc, eventMatches, myTeamId, slot) {
    const teams = Array.isArray(eventDoc.teams) ? eventDoc.teams : [];
    const getTeamName = (id) => {
      const team = teams.find(t => t.id === id);
      return team?.name || team?.nombre || "Por definir";
    };
    
    // Deduplicate matches just in case
    const uniqueMatches = new Map();
    eventMatches.forEach(m => uniqueMatches.set(m.id || m.matchCode, m));
    const cleanMatches = Array.from(uniqueMatches.values());
    
    let html = `
      <div class="hv2-standings-header">
        <span class="hv2-standings-title"><i class="fas fa-sitemap"></i> Cuadro Final</span>
      </div>
      <div class="hv2-standings-table-mini bg-black/40 rounded-xl border border-white/5" style="overflow-x:auto; padding:12px;">
    `;
    
    const rounds = normalizeBracketRounds(eventDoc.bracket || eventDoc.bracketRounds || []);
    if (!rounds.length) {
        html += `<div class="hv2-event-standings-empty" style="text-align:center; padding:20px; font-size:11px; opacity:0.6;"><i class="fas fa-clock-rotate-left"></i> El cuadro se dibujará al finalizar la fase de grupos.</div></div>`;
        if (slot) slot.innerHTML = html;
        return html;
    }
    html += `<div class="bracket-container" style="transform: scale(0.85); transform-origin: left top; padding-bottom: 20px;"><div class="bracket">`;

    rounds.forEach((round, rIdx) => {
        const isLast = (rIdx === rounds.length - 1);
        const isSemi = (rIdx === rounds.length - 2);
        const label = isLast ? 'FINAL' : (isSemi ? 'SEMIS' : `RONDA ${rIdx + 1}`);

        html += `<div class="bracket-round">
            <div class="bracket-round-label" style="font-size:14px; color:var(--primary); font-weight:900;">${label}</div>`;
        
        round.forEach(m => {
            const matchData = cleanMatches.find(em => em.matchCode === m.matchCode) || m;
            const played = matchData.estado === 'jugado' || !!getResultSetsString(matchData);
            const resultStr = getResultSetsString(matchData) || '';
            const tA = getTeamName(m.teamAId);
            const tB = getTeamName(m.teamBId);
            const isMineA = m.teamAId === myTeamId;
            const isMineB = m.teamBId === myTeamId;
            const winnerA = matchData.ganadorTeamId === m.teamAId;
            const winnerB = matchData.ganadorTeamId === m.teamBId;

            html += `
            <div class="bracket-match ${!played ? 'pending' : ''}" style="min-width:180px; cursor:pointer;" onclick="window.openMatch('${matchData.id}', 'eventoPartidos')">
                <div class="b-team-v9 ${winnerA && played ? 'winner' : ''} ${isMineA ? 'my-row-highlight' : ''}" style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between;">
                    <span class="b-name-v9" style="font-size:12px; font-weight:800; ${winnerA ? 'color:var(--sport-gold)' : 'color:#fff'};">${tA.substring(0, 16).toUpperCase()}</span>
                    <span class="b-score-v9" style="font-size:12px; font-weight:900; color:var(--primary);">${winnerA ? 'W' : (played ? '-' : '')}</span>
                </div>
                <div class="b-team-v9 ${winnerB && played ? 'winner' : ''} ${isMineB ? 'my-row-highlight' : ''}" style="padding:8px; display:flex; justify-content:space-between;">
                    <span class="b-name-v9" style="font-size:12px; font-weight:800; ${winnerB ? 'color:var(--sport-gold)' : 'color:#fff'};">${tB.substring(0, 16).toUpperCase()}</span>
                    <span class="b-score-v9" style="font-size:12px; font-weight:900; color:var(--primary);">${winnerB ? 'W' : (played ? '-' : '')}</span>
                </div>
                ${resultStr ? `<div style="text-align:center; padding:4px; font-size:10px; font-weight:900; background:rgba(0,0,0,0.4); color:#b8ff00;">${resultStr}</div>` : ''}
            </div>`;
        });
        html += `</div>`;
    });
    
    html += `</div></div>`;
    const thirdPlace = cleanMatches.find((m) => String(m.phase || "").toLowerCase() === "third_place");
    if (thirdPlace) {
      const thirdPlayed = thirdPlace.estado === "jugado" || !!getResultSetsString(thirdPlace);
      const thirdWinnerA = thirdPlace.ganadorTeamId === thirdPlace.teamAId;
      const thirdWinnerB = thirdPlace.ganadorTeamId === thirdPlace.teamBId;
      html += `
        <div style="margin-top:12px;">
          <div class="bracket-round-label" style="font-size:12px; color:#facc15; font-weight:900;">3º / 4º PUESTO</div>
          <div class="bracket-match ${!thirdPlayed ? 'pending' : ''}" style="min-width:180px; cursor:pointer;" onclick="window.openMatch('${thirdPlace.id}', 'eventoPartidos')">
              <div class="b-team-v9 ${thirdWinnerA && thirdPlayed ? 'winner' : ''}" style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between;">
                  <span class="b-name-v9" style="font-size:12px; font-weight:800; ${thirdWinnerA ? 'color:var(--sport-gold)' : 'color:#fff'};">${getTeamName(thirdPlace.teamAId).substring(0, 16).toUpperCase()}</span>
                  <span class="b-score-v9" style="font-size:12px; font-weight:900; color:var(--primary);">${thirdWinnerA ? '3º' : (thirdPlayed ? '4º' : '-')}</span>
              </div>
              <div class="b-team-v9 ${thirdWinnerB && thirdPlayed ? 'winner' : ''}" style="padding:8px; display:flex; justify-content:space-between;">
                  <span class="b-name-v9" style="font-size:12px; font-weight:800; ${thirdWinnerB ? 'color:var(--sport-gold)' : 'color:#fff'};">${getTeamName(thirdPlace.teamBId).substring(0, 16).toUpperCase()}</span>
                  <span class="b-score-v9" style="font-size:12px; font-weight:900; color:var(--primary);">${thirdWinnerB ? '3º' : (thirdPlayed ? '4º' : '-')}</span>
              </div>
          </div>
        </div>
      `;
    }
    html += `</div>`;
    if (slot) slot.innerHTML = html;
    return html;
}

window.downloadEventPoster = async (eventId) => {
    const ev = eventDocCache.get(eventId) || myEvents.find(e => e.id === eventId);
    if (!ev) return;
    
    // Use raw allMatches to get the actual eventoPartidos.
    const eventMatches = allMatches.filter(m => String(m.col || "") === "eventoPartidos" && getEventIdFromMatch(m) === ev.id);
    const teams = Array.isArray(ev.teams) ? ev.teams : [];
    const getTeamName = (id) => teams.find(t => t.id === id)?.nombre || "Por definir";

    const played = eventMatches.filter(isFinishedMatch).map(m => ({
        teamAName: getTeamName(m.teamAId),
        teamBName: getTeamName(m.teamBId),
        resultado: getResultSetsString(m) || 'Finalizado'
    }));
    
    const scheduled = eventMatches.filter(m => !isFinishedMatch(m) && !isTbdMatch(m)).map(m => {
        const d = toDateSafe(m.fecha);
        return {
            teamAName: getTeamName(m.teamAId),
            teamBName: getTeamName(m.teamBId),
            fechaStr: d ? d.toLocaleString("es-ES", { weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : 'Fijado'
        };
    });
    
    const pending = eventMatches.filter(m => !isFinishedMatch(m) && isTbdMatch(m)).map(m => ({
        teamAName: getTeamName(m.teamAId),
        teamBName: getTeamName(m.teamBId)
    }));

    const isKnockout = ev.faseActual === 'knockout' || ev.formato === 'knockout';
    const standings = [];
    const groupDraw = [];
    
    const cfg = { win: ev.puntosVictoria||3, draw: ev.puntosEmpate||1, loss: ev.puntosDerrota||0 };

    if (isKnockout) {
        // En eliminatorias, dibujamos el cuadro en los grupos para que el cartel lo visualice
        const ko = eventMatches.filter(m => String(m.phase || "").toLowerCase() === 'knockout' || String(m.fase || "").toLowerCase() === 'knockout');
        const rows = ko.map(m => `${getTeamName(m.teamAId)} vs ${getTeamName(m.teamBId)}`);
        groupDraw.push({ title: 'CUADRO FINAL', teams: rows });
    } else if (ev.formato === 'league') {
        const computed = computeGroupTable(eventMatches.filter(m => m.phase === 'league' || !m.phase), teams, cfg);
        computed.sort((a,b) => ((b.pts??b.puntos??0) - (a.pts??a.puntos??0)) || ((b.dif??b.diferencia??0) - (a.dif??a.diferencia??0)));
        standings.push({
            title: 'GENERAL',
            rows: computed.map(r => ({ teamName: r.nombre||r.name||r.teamName||'Equipo', pj: r.pj||0, pts: r.pts||r.puntos||0 }))
        });
    } else {
        const groups = ev.groups || {};
        Object.keys(groups).sort().forEach(g => {
            const memberIds = groups[g];
            if (!memberIds.length) return;
            const gTeams = memberIds.map(id => teams.find(t=>t.id===id)).filter(Boolean);
            const computed = computeGroupTable(eventMatches.filter(m => m.group === g), gTeams, cfg);
            computed.sort((a,b) => ((b.pts??b.puntos??0) - (a.pts??a.puntos??0)) || ((b.dif??b.diferencia??0) - (a.dif??a.diferencia??0)));
            standings.push({
                title: g,
                rows: computed.map(r => ({ teamName: r.nombre||r.name||r.teamName||'Equipo', pj: r.pj||0, pts: r.pts||r.puntos||0 }))
            });
        });
    }
    
    const { generateEventStatusPoster } = await import('./utils/share-utils.js');
    await generateEventStatusPoster({
        eventName: ev.nombre,
        organizer: 'JAFS PADEL CLUB',
        eventFormat: ev.formato || ev.faseActual || 'TORNEO',
        teamCount: (ev.teams||[]).length,
        registeredCount: (ev.inscritos||[]).length,
        played,
        scheduled,
        pending,
        standings,
        groupDraw
    });
};

function renderStandingsRows(rowsIn, eventDoc, myTeamId, myGroup, slot) {
  let rows = Array.isArray(rowsIn) ? rowsIn.slice() : [];
  rows.sort((a,b) => {
    const ptsA = a.pts ?? a.puntos ?? 0;
    const ptsB = b.pts ?? b.puntos ?? 0;
    const difA = a.dif ?? a.diferencia ?? 0;
    const difB = b.dif ?? b.diferencia ?? 0;
    return ptsB - ptsA || difB - difA;
  });
  
  const title = myGroup ? `Clasificación Grupo ${String(myGroup).toUpperCase()}` : "Clasificación General";
  
  const groupKeys = Object.keys(eventDoc.groups || {}).sort();
  const canSwitchGroups = !!myTeamId && groupKeys.length > 1;
  const selectorHtml = canSwitchGroups
    ? `
      <div class="hv2-standings-switch">
        <label>Grupo</label>
        <select onchange="window.setHomeEventStandingsGroup('${eventDoc.id}', this.value)">
          ${groupKeys.map((g) => `<option value="${g}" ${String(g) === String(myGroup || "") ? "selected" : ""}>${g}</option>`).join("")}
        </select>
      </div>
    `
    : "";

  let html = `
    <div class="hv2-standings-header">
      <span class="hv2-standings-title">${title}</span>
      ${selectorHtml}
    </div>
    <div class="hv2-standings-table-mini">
      <div class="hv2-std-head">
        <span class="pos">#</span>
        <span class="team">EQUIPO</span>
        <span class="pj">PJ</span>
        <span class="pts">PTS</span>
      </div>
      <div class="hv2-std-body">
  `;

  const memberIds = myGroup && eventDoc.groups?.[myGroup] ? eventDoc.groups[myGroup] : [];
  
  // If we have a group, we filter rows by that group
  let displayRows = rows;
  if (myGroup && memberIds.length) {
    displayRows = rows.filter(r => memberIds.includes(r.uid || r.teamId));
  }

  if (!displayRows.length) {
    html += `<div class="hv2-event-standings-empty">La clasificación se actualizará al registrar resultados.</div>`;
  } else {
    displayRows.forEach((r, i) => {
      const isMine = (r.uid || r.teamId) === myTeamId;
      const teamObj = (eventDoc.teams || []).find(t => t.id === (r.uid || r.teamId));
      const teamName = teamObj?.nombre || teamObj?.name || r.nombre || r.teamName || "Equipo";
      
      html += `
        <div class="hv2-std-row ${isMine ? 'mine' : ''}">
          <span class="pos">${i + 1}</span>
          <span class="team">${teamName}</span>
          <span class="pj">${r.pj ?? 0}</span>
          <span class="pts">${r.pts ?? r.puntos ?? 0}</span>
        </div>

      `;
    });
  }

  html += `</div></div>`;
  slot.innerHTML = html;
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
  if (!a || !b) return false;
  return (
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  );
}



function maybeCreateEventDayNotice() {
  const relevant = getMyRelevantMatches();
  const next = relevant
    .filter((m) => !isFinishedMatch(m))
    .filter((m) => {
      const matchDate = toDateSafe(m?.fecha);
      return matchDate && sameDay(matchDate, new Date()) && matchDate.getTime() >= Date.now() - 15 * 60 * 1000;
    })
    .sort((a, b) => (toDateSafe(a?.fecha)?.getTime() || 0) - (toDateSafe(b?.fecha)?.getTime() || 0))[0];

  const recentlyFinished = relevant
    .filter((m) => isFinishedMatch(m))
    .filter((m) => {
      const matchDate = toDateSafe(m?.fecha);
      return matchDate && sameDay(matchDate, new Date()) && matchDate.getTime() > Date.now() - 4 * 60 * 60 * 1000;
    })
    .sort((a, b) => (toDateSafe(b?.fecha)?.getTime() || 0) - (toDateSafe(a?.fecha)?.getTime() || 0))[0];

  const match = recentlyFinished || next;
  if (!match) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(`eda_hidden_${match.id}_${todayStr}`)) return;

  const modalId = `modal-eda-${match.id}`;
  if (document.getElementById(modalId)) return;

  const overlay = document.createElement("div");
  overlay.id = modalId;
  overlay.className = "modal-overlay active";
  overlay.style.zIndex = "10000";

  const d = toDateSafe(match.fecha);
  const finished = isFinishedMatch(match);
  const players = getNormalizedPlayers(match);
  const n = (idx) => {
      const uid = players[idx];
      if (!uid) return "Pendiente";
      if (uid === currentUser?.uid) return "Tú";
      return getPlayerDisplayName(uid) || "Jugador";
  };

  const locationLabel = match.isApoing ? "Reserva Apoing" : match.courtName || match.club || "Pista reservada";
  const resultStr = finished ? (getResultSetsString(match) || "COMPLETADO") : "A LAS " + d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  overlay.innerHTML = `
    <div class="modal-card glass-strong p-0 overflow-hidden" style="max-width:420px; border-radius: 32px !important;">
      <div class="hv2-setup-card eda-modal-style" style="border:none; margin:0; width:100%;">
          <div class="hv2-setup-copy">
              <span class="hv2-section-title">
                  <i class="fas ${finished ? "fa-trophy" : "fa-calendar-circle-exclamation"}"></i> 
                  ${finished ? "PARTIDO FINALIZADO" : "¡HOY TIENES PARTIDO!"}
              </span>
              <p class="hv2-setup-text" style="margin-top:4px; opacity:0.6;">${finished ? "Revisa el resultado y descarga tu cartel." : "Nuestra Matrix ha detectado acción hoy en las pistas."}</p>
              
              <div class="eda-match-players mt-6 mb-6" style="background: rgba(255,255,255,0.03); padding: 15px; border-radius: 20px;">
                 <div class="eda-team-col">
                    <div class="eda-p-name" style="font-family:'Rajdhani'; font-weight:900; font-size:13px; color:var(--sport-gold);">${n(0)}</div>
                    <div class="eda-p-name" style="font-family:'Rajdhani'; font-weight:900; font-size:13px; color:var(--sport-gold);">${n(1)}</div>
                 </div>
                 <div class="eda-vs-badge" style="background:var(--primary); color:black;">VS</div>
                 <div class="eda-team-col text-right">
                    <div class="eda-p-name" style="font-family:'Rajdhani'; font-weight:900; font-size:13px;">${n(2)}</div>
                    <div class="eda-p-name" style="font-family:'Rajdhani'; font-weight:900; font-size:13px;">${n(3)}</div>
                 </div>
              </div>

              <div class="flex-col gap-1 mb-6">
                <span class="text-[9px] uppercase opacity-40 font-black tracking-widest">${finished ? "SCORE FINAL" : "DETALLES DE RESERVA"}</span>
                <span class="text-lg font-black text-white">${finished ? resultStr : escapeHtml(locationLabel)}</span>
                ${!finished ? `<span class="text-xs font-bold text-primary">${d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>` : ''}
              </div>

              <div class="flex-row gap-3">
                  <button class="btn btn-primary flex-1" id="eda-btn-download">
                      <i class="fas fa-download mr-1"></i> CARTEL
                  </button>
                   <button class="btn btn-ghost flex-1" id="eda-btn-close">
                      CERRAR
                  </button>
              </div>
          </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const prepareMetadata = () => {
    const pNames = players.map(uid => getPlayerDisplayName(uid));
    const levels = players.map(uid => {
        if (uid === currentUser?.uid) return Number(currentUserData?.nivel || 2.5);
        const guest = typeof uid === "string" && uid.startsWith("GUEST_") ? parseGuestMeta(uid) : null;
        if (guest) return Number(guest.level || 2.5);
        return 2.5;
    });
    return {
      title: finished ? "RESULTADO DEL PARTIDO" : "PARTIDO DE HOY",
      when: d.toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }),
      teamA: [pNames[0], pNames[1]],
      teamB: [pNames[2], pNames[3]],
      levelsA: [levels[0], levels[1]],
      levelsB: [levels[2], levels[3]],
      winner: finished ? resolveWinnerTeam(match) : null,
      sets: finished ? getResultSetsString(match) : null,
      club: "JAFS PADEL CLUB"
    };
  };

  overlay.querySelector("#eda-btn-download").onclick = async () => {
     await shareMatchPoster(prepareMetadata());
  };

  overlay.querySelector("#eda-btn-close").onclick = () => {
    overlay.remove();
    localStorage.setItem(`eda_hidden_${match.id}_${todayStr}`, "1");
  };
}




/* Tactical Stats — Nemesis & Partner */


/* Match data */
async function mergeMatches(col, list) {
  const sig = JSON.stringify(list.map((m) => m.id + m.estado));
  if (colSignature.get(col) === sig) return;
  colSignature.set(col, sig);

  if (col === "eventoPartidos") {
    const eventIds = [...new Set(list.map((m) => m.eventoId || m.eventId).filter(Boolean))];
    await Promise.allSettled(
      eventIds.map(async (eid) => {
        // Always fetch fresh data (not cached) to get latest standings, teams, etc.
        const ev = await getDocument("eventos", eid);
        if (ev) {
          eventDocCache.set(eid, ev);
          indexEventUserNames(ev);
          // Also keep myEvents in sync
          const idx = myEvents.findIndex(e => e.id === eid);
          if (idx >= 0) myEvents[idx] = ev;
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
    const dateA = toDateSafe(a.fecha);
    const dateB = toDateSafe(b.fecha);
    return (dateA?.getTime() || 0) - (dateB?.getTime() || 0);
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
  renderHomeCompactBrief();
  renderEventSpotlight();
  renderCompetitivePulse();
  refreshTacticalStats();
  maybeCreateEventDayNotice();
  const activeTab =
    document.querySelector(".hv2-tab.active")?.dataset.filter || "open";
  renderMatchesByFilter(activeTab);
  saveHomeMatchCache();
  
  // Re-run alerts if all main collections are loaded
  if (loadedCollections.size >= 3) {
    checkSystemAlerts(currentUserData || {});
    
    // Push reminders for today
    import("./modules/push-notifications.js").then(m => {
      m.checkDailyReminders(currentUser?.uid, allMatches);
    });
  }

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
  if (homeEntryFailSafeTimer) clearTimeout(homeEntryFailSafeTimer);
  homeEntryOverlayInterval = setInterval(() => {
    homeEntryOverlayValue = Math.min(90, homeEntryOverlayValue + Math.max(1, Math.floor(Math.random() * 6)));
    fill.style.width = `${homeEntryOverlayValue}%`;
    pct.textContent = `${homeEntryOverlayValue}%`;
  }, 90);
  homeEntryFailSafeTimer = setTimeout(() => {
    if (!overlay.classList.contains("hidden")) completeHomeEntryOverlay();
  }, 9000);
}

function completeHomeEntryOverlay() {
  const overlay = document.getElementById("home-entry-overlay");
  const fill = document.getElementById("home-entry-fill");
  const pct = document.getElementById("home-entry-pct");
  if (!overlay || !fill || !pct) return;
  if (homeEntryOverlayInterval) clearInterval(homeEntryOverlayInterval);
  if (homeEntryFailSafeTimer) clearTimeout(homeEntryFailSafeTimer);
  homeEntryFailSafeTimer = null;
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
  document.querySelectorAll(".hv2-tab-pill, .hv2-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".hv2-tab-pill, .hv2-tab")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderMatchesByFilter(btn.dataset.filter || "open");
    });
  });
}

/* Next match - sports scoreboard */
function OLD_renderNextMatch() {
  const box = document.getElementById("next-match-box");
  if (!box) return;
  const now = Date.now();
  const mine = allMatches
    .filter((m) => isMatchRelevantToMe(m))
    .filter((m) => !isEventKnockoutLocked(m))
    .filter((m) => !isCancelledMatch(m) && !isFinishedMatch(m))
    .filter((m) => {
      const d = toDateSafe(m.fecha);
      return d && d.getTime() >= now - 10 * 60 * 1000;
    }) // strict future
    .sort((a, b) => {
      const dateA = toDateSafe(a.fecha);
      const dateB = toDateSafe(b.fecha);
      return (dateA?.getTime() || 0) - (dateB?.getTime() || 0);
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
    const short = name.split(" ")[0] || "Tú";
    const isMe = uid === currentUser?.uid;
    const teamCls = team === "a" ? "is-team-a" : "is-team-b";
    const cls = !uid ? "empty" : isMe ? "is-me" : teamCls;
    return `<span class="hv2-sb-player-name ${cls}">${uid ? short : "LIBRE"}</span>`;
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
          <span class="hv2-sb-team-label t-a hidden">${pName(players[0], "a")} & ${pName(players[1], "a")}</span>
          <div class="hv2-sb-player">${pName(players[0], "a")}</div>
          <div class="hv2-sb-player">${pName(players[1], "a")}</div>
        </div>
        <div class="hv2-sb-vs">
          <span class="hv2-sb-vs-line"></span>
          <span class="hv2-sb-vs-text">VS</span>
          <span class="hv2-sb-vs-line"></span>
        </div>
        <div class="hv2-sb-team team-b">
          <span class="hv2-sb-team-label t-b hidden">${pName(players[2], "b")} & ${pName(players[3], "b")}</span>
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
  maybeCreateEventDayNotice(); // Reinforce when scoreboard renders
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
  const apoingMatches = apoingEvents.filter(ev => {
    // Filter out Apoing events that match an existing match in my collections
    const startTime = ev.dtStart.getTime();
    const overlaps = allMatches.some(m => {
        const d = toDateSafe(m.fecha);
        if (!d) return false;
        // Increase tolerance to 120 min to avoid any double booking
        return Math.abs(d.getTime() - startTime) < 120 * 60 * 1000;
    });

    return !overlaps;
  }).map(ev => {
    // Inject into cache so it shows the owner instead of "Jugador"
    const ownerName = ev.owner || ev.sourceName || "Jugador Apoing";
    if (ev.sourceUid && !playerNameCache.has(ev.sourceUid)) {
       playerNameCache.set(ev.sourceUid, ownerName);
    }
    return {
      id: `apoing_${ev.uid || Math.random()}`,
      col: "apoing",
      fecha: ev.dtStart,
      jugadores: [ev.sourceUid, null, null, null],
      summary: ev.summary,
      isApoing: true,
      sourceUid: ev.sourceUid,
      sourceName: ev.sourceName || "Jugador Apoing",
      owner: ownerName
    };
  });


  let list = dedupeEventLinkedMatches([...allMatches, ...apoingMatches])
    .filter((m) => !isCancelledMatch(m))
    .filter((m) => !isEventKnockoutLocked(m))
    .filter((m) => {
      if (isEventMatch(m) && !m.fecha) return false;
      return true;
    });

  if (filter === "open") {
    list = list
      .filter((m) => !m.isApoing)
      .filter((m) => !isFinishedMatch(m))
      .filter((m) => getNormalizedPlayers(m).filter(Boolean).length < 4)
      .filter((m) => !isTbdMatch(m))
      .filter((m) => {
        const d = toDateSafe(m.fecha);
        return d && d.getTime() >= now - 5 * 60 * 1000;
      });
    list = list
      .map((m) => ({
        ...m,
        __matchFit: scoreMatchForUser(m, currentUserData || currentUser || {}, getPlayerMeta, getMatchmakingContext()),
      }))
      .sort((a, b) => {
        const fitDiff = Number(b.__matchFit?.total || 0) - Number(a.__matchFit?.total || 0);
        if (fitDiff !== 0) return fitDiff;
        return (toDateSafe(a.fecha)?.getTime() || 0) - (toDateSafe(b.fecha)?.getTime() || 0);
      });
  } else if (filter === "mine") {
    list = list
      .filter((m) => isMatchRelevantToMe(m))
      .filter((m) => !isFinishedMatch(m))
      .filter((m) => {
        const d = toDateSafe(m.fecha);
        return d && d.getTime() >= now - 5 * 60 * 1000;
      });
  } else if (filter === "apoing") {
    list = apoingMatches.length ? apoingMatches : list.filter(m => m.isApoing);
    list = list.filter(m => {
      const d = toDateSafe(m.fecha);
      return d && d.getTime() >= now - 5 * 60 * 1000;
    }).sort((a, b) => (toDateSafe(a.fecha)?.getTime() || 0) - (toDateSafe(b.fecha)?.getTime() || 0));
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
    const emptyMsg = filter === "mine"
      ? `<div class="hv2-no-match-rich mt-2">
           <div class="hv2-no-match-main">
             <i class="fas fa-calendar-xmark text-3xl"></i>
             <div>
               <strong>SIN PARTIDOS CONFIRMADOS</strong>
               <span>No tienes ninguna cita inminente en tu agenda.</span>
             </div>
           </div>
           <div class="hv2-no-match-actions mt-1">
             <a href="calendario.html" class="hv2-inline-btn primary flex-1"><i class="fas fa-calendar-plus"></i> RESERVAR AHORA</a>
           </div>
         </div>`
      : `<div class="hv2-empty-state"><i class="fas fa-inbox"></i>No hay partidos para este filtro.</div>`;
      
    listEl.innerHTML = emptyMsg;
    renderHomeRecentResults();
    return;
  }

  listEl.innerHTML = list
    .slice(0, 30)
    .map((m, i) => renderMatchCard(m, i))
    .join("");
  renderHomeRecentResults();
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
  const fit = match.__matchFit || null;

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
  const teamALabel = getFriendlyTeamName({
    teamName: match?.teamAName,
    playerNames: players.slice(0, 2).map((uid) => (uid ? getPlayerDisplayName(uid) : null)),
    fallback: "Pareja 1",
  });
  const teamBLabel = getFriendlyTeamName({
    teamName: match?.teamBName,
    playerNames: players.slice(2, 4).map((uid) => (uid ? getPlayerDisplayName(uid) : null)),
    fallback: "Pareja 2",
  });

  const resultStr = getResultSetsString(match) || "";
  const hasResult = Boolean(resultStr);
  const winner = finished && hasResult ? resolveWinnerTeam(match) : null;
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
  const smartBadge = fit && !isMine && !finished && !match.isApoing
    ? `<span class="hv2-mc-smart-badge is-${fit.tone || "soft"}"><strong>${Math.round(fit.total)}% match</strong><small>${fit.headline || "encaje moderado"}</small></span>`
    : "";
  const smartDetail = fit && !isMine && !finished && !match.isApoing && Array.isArray(fit.reasons) && fit.reasons.length
    ? `<div class="hv2-mc-smart-detail">${fit.reasons.slice(0, 3).map((reason) => `<span>${reason}</span>`).join("")}</div>`
    : "";

  const cardClick = match.isApoing 
    ? `window.openApoingMatch('${match.id}')` 
    : `window.openMatch('${match.id}','${match.col}')`;

  const teamAClass = winner === "A" ? "team-win" : winner === "B" ? "team-loss" : "";
  const teamBClass = winner === "B" ? "team-win" : winner === "A" ? "team-loss" : "";
  let winnerBadge = "";
  if (winner === "A" || winner === "B") {
      winnerBadge = `<span class="hv2-mc-winner-badge">Ganador: ${escapeHtml(winner === "A" ? teamALabel : teamBLabel)}</span>`;
  }

  // Weather micro info
  const tempVal = weather?.current ? Math.round(weather.current.temperature_2m || 0) : null;
  const wCode = weather?.current?.weather_code || 0;
  let wIcon = "fa-sun", wColor = "#fbbf24";
  if (wCode > 3 && wCode <= 48) { wIcon = "fa-cloud"; wColor = "#94a3b8"; }
  else if (wCode > 48 && wCode <= 67) { wIcon = "fa-cloud-rain"; wColor = "#60a5fa"; }
  else if (wCode > 67) { wIcon = "fa-bolt"; wColor = "#a78bfa"; }

  // Countdown chip
  const diffMs = date.getTime() - Date.now();
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffH / 24);
  const countdownChip = diffMs <= 0 ? "" : diffH < 1 ? `<span class="hv2-mc-countdown now">AHORA</span>` : diffH < 24 ? `<span class="hv2-mc-countdown">EN ${diffH}H</span>` : diffD < 7 ? `<span class="hv2-mc-countdown">EN ${diffD}D</span>` : "";

  return `
    <div class="hv2-match-card ${isMine ? "mine-card" : ""} ${finished ? "finished-card" : ""} ${match.isApoing ? "apoing-card" : ""}" style="animation-delay:${delay}ms" onclick="${cardClick}">
      ${badge}
      ${smartBadge}
      <div class="hv2-mc-team ${teamAClass}">
        <div class="hv2-mc-avatars">${playerAvatar(players[0])}${playerAvatar(players[1])}</div>
        ${pn(players[0])}
        ${pn(players[1])}
      </div>
      <div class="hv2-mc-center">
        <span class="hv2-mc-vs">${match.isApoing ? "<i class='fas fa-calendar-check' style='color:#fb923c'></i>" : "VS"}</span>
        <span class="hv2-mc-time">${date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>
        <span class="hv2-mc-date">${date.toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit" })}</span>
        ${!finished && tempVal !== null ? `<span class="hv2-mc-weather"><i class="fas ${wIcon}" style="color:${wColor}"></i> ${tempVal}°</span>` : ""}
      </div>
      <div class="hv2-mc-team team-right ${teamBClass}">
        <div class="hv2-mc-avatars">${playerAvatar(players[2])}${playerAvatar(players[3])}</div>
        ${pn(players[2])}
        ${pn(players[3])}
      </div>
      ${smartDetail}
      ${winnerBadge}
      ${countdownChip}
      <div class="hv2-mc-footer-strip">
        ${orgName ? `<span class="hv2-mc-org"><i class="fas fa-user-tie"></i> ${escapeHtml(orgName.split(" ")[0])}</span>` : ""}
        <button class="hv2-mc-share-btn" onclick="event.stopPropagation(); window.shareMatch('${match.id}', '${match.col}')">
           <i class="fas fa-share-nodes"></i>
        </button>
      </div>
    </div>
  `;

}

/* Match modal */

/* Nexus online - connected users */
let unsubNexus = null;
let nexusRefreshTimer = null;

function parseLastSeenDate(value) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatLastSeenLabel(value) {
  const date = parseLastSeenDate(value);
  if (!date) return { relative: "sin registro", absolute: "Sin fecha registrada" };
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));
  let relative = "justo ahora";
  if (diffMin >= 1 && diffMin < 60) relative = `hace ${diffMin} min`;
  else if (diffMin >= 60 && diffMin < 1440) relative = `hace ${Math.floor(diffMin / 60)} h`;
  else if (diffMin >= 1440) relative = `hace ${Math.floor(diffMin / 1440)} d`;
  const absolute = date.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return { relative, absolute };
}

function stopNexusRefreshTimer() {
  if (nexusRefreshTimer) {
    clearInterval(nexusRefreshTimer);
    nexusRefreshTimer = null;
  }
}
async function initNexus() {
  const container = document.getElementById("nexus-container");
  if (!container) return;
  container.style.cursor = "pointer";
  container.onclick = () => window.openNexusModal?.();
  const nexusModal = document.getElementById("modal-nexus");
  if (nexusModal && !nexusModal.dataset.bound) {
    nexusModal.dataset.bound = "1";
    nexusModal.addEventListener("click", (e) => {
      if (e.target === nexusModal) {
        nexusModal.classList.remove("active");
        stopNexusRefreshTimer();
      }
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
      const seen = formatLastSeenLabel(u.ultimoAcceso);
      return `
        <div class="nexus-modal-row" onclick="window.location.href='perfil.html?uid=${u.id}'">
          <div class="nexus-modal-avatar">
            ${photo ? `<img src="${photo}" alt="${name}" onerror="this.outerHTML='<span class=&quot;nexus-initials&quot;>${initials}</span>'">` : `<span class="nexus-initials">${initials}</span>`}
          </div>
          <div class="nexus-modal-info">
            <span class="nexus-modal-name">${isMe ? "Tú" : name}</span>
            <span class="nexus-modal-meta">Conectado ahora · ${seen.absolute}</span>
          </div>
        </div>
      `;
    })
    .join("")
    : '<div class="nexus-modal-empty">No hay usuarios conectados ahora</div>';

  const offlineHtml = `
    <div class="nexus-modal-divider">No conectados · última actividad (${offlineUsers.length})</div>
    ${
      offlineUsers.length
        ? offlineUsers
            .map((u) => {
              const name = u.nombreUsuario || u.nombre || "Jugador";
              const photo = u.fotoPerfil || u.fotoURL || u.photoURL || "";
              const initials = getInitials(name);
              const seen = formatLastSeenLabel(u.ultimoAcceso);
              return `
                <div class="nexus-modal-row is-offline" onclick="window.location.href='perfil.html?uid=${u.id}'">
                  <div class="nexus-modal-avatar">
                    ${photo ? `<img src="${photo}" alt="${name}" onerror="this.outerHTML='<span class=&quot;nexus-initials&quot;>${initials}</span>'">` : `<span class="nexus-initials">${initials}</span>`}
                  </div>
                  <div class="nexus-modal-info">
                    <span class="nexus-modal-name">${name}</span>
                    <span class="nexus-modal-meta">Último acceso: ${seen.relative} · ${seen.absolute}</span>
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
  stopNexusRefreshTimer();
  nexusRefreshTimer = setInterval(() => {
    if (!modal.classList.contains("active")) {
      stopNexusRefreshTimer();
      return;
    }
    window.openNexusModal();
  }, 60000);
};
window.openMatch = async (id, col) => {
  const modal = document.getElementById("modal-match");
  // Elimina contenedores duplicados que puedan existir
  try { document.getElementById("modal-result-form")?.remove(); } catch {}
  try {
    document.querySelectorAll("#match-detail-area").forEach((el) => {
      if (!modal?.contains(el)) el.remove();
    });
  } catch {}

  const area = modal?.querySelector("#match-detail-area");
  if (!modal || !area) {
    console.warn("[Home] modal-match not found", { id, col });
    return;
  }
  purgeEventDayAlerts();
  area.innerHTML = '<div class="center py-10 text-center text-white/70"><div class="spinner-galaxy" style="margin-bottom:12px;"></div><div>Cargando detalles del partido...</div></div>';
  const row = allMatches.find((m) => m.id === id || m.eventMatchId === id) || null;

  const normalizeCol = (c) => {
    if (!c) return null;
    const v = String(c).toLowerCase();
    if (v.includes("evento")) return "eventoPartidos";
    if (v.includes("reto")) return "partidosReto";
    return "partidosAmistosos";
  };

  let resolvedCol = normalizeCol(col || row?.col);
  let resolvedId = row?.id || id;

  // Si no sabemos la colección, probamos a descubrirla rápido
  if (!resolvedCol && resolvedId) {
    const candidates = ["partidosAmistosos", "partidosReto", "eventoPartidos"];
    for (const c of candidates) {
      try {
        const doc = await getDocument(c, resolvedId);
        if (doc) { resolvedCol = c; break; }
      } catch (_) {}
    }
  }
  if (!resolvedCol) resolvedCol = "partidosAmistosos";

  modal.classList.add("active");

  try {
    await renderMatchDetail(area, resolvedId, resolvedCol, currentUser, currentUserData || {});
    const fullMatch = await getDocument(resolvedCol, resolvedId).catch(() => null);
    injectSmartMatchActions(area, fullMatch || row || {}, resolvedCol, resolvedId);
  } catch (err) {
    console.error("[Home] renderMatchDetail failed", err);
    area.innerHTML = `
      <div class="p-6 text-center text-red-200 flex-col gap-2">
        <i class="fas fa-triangle-exclamation text-2xl"></i>
        <div class="font-black text-sm">No se pudo cargar el partido</div>
        <div class="text-xs opacity-70">ID: ${resolvedId} · ${resolvedCol}</div>
        <button class="btn btn-ghost sm" onclick="window.location.reload()">Recargar</button>
      </div>`;
    if (typeof showToast === "function") showToast("Error", "No se pudo abrir el detalle. Avísanos o recarga.", "error");
  }
};

function injectSmartMatchActions(container, match, col, matchId) {
  if (!container || !matchId || !currentUser?.uid) return;
  const isEvent = String(col || "").toLowerCase() === "eventopartidos";
  const isFinished = isFinishedMatch(match);
  const wrap = document.createElement("div");
  wrap.className = "home-match-smart-actions";
  wrap.innerHTML = `
    <div class="hmsa-title"><i class="fas fa-wand-magic-sparkles"></i> Acciones rápidas</div>
    <div class="hmsa-grid">
      ${!isEvent && !isFinished ? `<button type="button" class="hmsa-btn" onclick="window.quickJoinMatch('${matchId}','${col}')"><i class="fas fa-user-plus"></i> Unirme</button>` : ""}
      ${!isFinished ? `<button type="button" class="hmsa-btn ghost" onclick="window.quickRemindMatch('${matchId}','${col}')"><i class="fas fa-bell"></i> Recordarme</button>` : ""}
      <button type="button" class="hmsa-btn accent" onclick="window.openBetModal('${matchId}','${col}')"><i class="fas fa-coins"></i> Apostar</button>
    </div>
  `;
  container.appendChild(wrap);
}

window.quickJoinMatch = async (matchId, col) => {
  try {
    const colNorm = String(col || "").toLowerCase().includes("reto") ? "partidosReto" : "partidosAmistosos";
    const m = await getDocument(colNorm, matchId);
    if (!m) return showToast("No disponible", "No se encontró el partido.", "warning");
    if (isFinishedMatch(m)) return showToast("Cerrado", "Este partido ya está cerrado.", "info");
    const players = [...getNormalizedPlayers(m)];
    if (players.includes(currentUser.uid)) return showToast("Ya estás dentro", "Este partido ya te incluye.", "info");
    const openIndex = players.findIndex((p) => !p);
    if (openIndex === -1 && players.length >= 4) return showToast("Completo", "Ya no quedan plazas libres.", "warning");
    if (openIndex >= 0) players[openIndex] = currentUser.uid;
    else players.push(currentUser.uid);
    const normalized = players.slice(0, 4);
    while (normalized.length < 4) normalized.push(null);
    await updateDoc(doc(db, colNorm, matchId), {
      jugadores: normalized,
      playerUids: normalized.filter(Boolean),
      updatedAt: serverTimestamp(),
    });
    if (m.creadorId && m.creadorId !== currentUser.uid) {
      await createNotification(
        m.creadorId,
        "Nuevo jugador en tu partido",
        `${currentUserData?.nombreUsuario || currentUserData?.nombre || "Un jugador"} se ha unido al partido.`,
        "info",
        "home.html",
        { type: "match_join", matchId }
      );
    }
    showToast("¡Dentro!", "Te has unido al partido correctamente.", "success");
  } catch (e) {
    console.error("quickJoinMatch error", e);
    showToast("Error", "No se pudo unir al partido.", "error");
  }
};

window.quickRemindMatch = async (matchId, col) => {
  try {
    const key = `match_reminder_${matchId}`;
    await createSelfNoticeOnce(
      key,
      "Recordatorio de partido",
      "Te avisaremos para este partido y su resultado.",
      `home.html?match=${encodeURIComponent(matchId)}`,
      { matchId, col },
    );
    showToast("Listo", "Recordatorio activado.", "success");
  } catch (e) {
    showToast("Error", "No se pudo crear el recordatorio.", "error");
  }
};

window.openBetModal = async (matchId, col) => {
  if (!currentUser?.uid) return;
  const m = await getDocument(col, matchId).catch(() => null);
  if (!m) return showToast("Partido", "No se encontró el partido.", "warning");
  if (isFinishedMatch(m)) return showToast("Apuestas cerradas", "El partido ya finalizó.", "info");
  const players = getNormalizedPlayers(m).filter(Boolean);
  if (players.length < 2) return showToast("Aún no", "Faltan jugadores para apostar.", "warning");
  const wallet = Number(currentUserData?.monedasVirtuales || 1000);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay active";
  overlay.innerHTML = `
    <div class="modal-card glass-strong" style="max-width:430px;">
      <div class="modal-header">
        <h3 class="modal-title">Apuesta virtual</h3>
        <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="hmsa-wallet">Saldo: <b>${wallet}</b> monedas</div>
        <label class="text-[10px] font-black text-muted uppercase tracking-widest">Equipo ganador</label>
        <select id="bet-side" class="input mt-2">
          <option value="A">${escapeHtml(m.teamAName || "Equipo A")}</option>
          <option value="B">${escapeHtml(m.teamBName || "Equipo B")}</option>
        </select>
        <label class="text-[10px] font-black text-muted uppercase tracking-widest mt-3">Cantidad</label>
        <input id="bet-amount" type="number" min="${MIN_BET_COINS}" step="10" value="${Math.max(MIN_BET_COINS, Math.min(200, wallet))}" class="input mt-2">
        <button class="btn btn-primary w-full mt-4" onclick="window.placeMatchBet('${matchId}','${col}')">Confirmar apuesta</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
};

window.placeMatchBet = async (matchId, col) => {
  try {
    const amount = Number(document.getElementById("bet-amount")?.value || 0);
    const side = String(document.getElementById("bet-side")?.value || "A");
    const wallet = Number(currentUserData?.monedasVirtuales || 1000);
    if (!Number.isFinite(amount) || amount < MIN_BET_COINS) return showToast("Cantidad inválida", `Mínimo ${MIN_BET_COINS} monedas.`, "warning");
    if (amount > wallet) return showToast("Saldo insuficiente", "No tienes suficientes monedas virtuales.", "warning");
    const existing = await getDocs(query(
      collection(db, "matchBets"),
      where("matchId", "==", matchId),
      where("uid", "==", currentUser.uid),
      limit(1),
    ));
    if (!existing.empty) return showToast("Ya apostaste", "Solo se permite una apuesta por partido.", "info");
    await addDoc(collection(db, "matchBets"), {
      matchId,
      col,
      uid: currentUser.uid,
      userName: currentUserData?.nombreUsuario || currentUserData?.nombre || "Jugador",
      side,
      amount,
      status: "open",
      createdAt: serverTimestamp(),
    });
    await updateDoc(doc(db, "usuarios", currentUser.uid), {
      monedasVirtuales: increment(-amount),
      updatedAt: serverTimestamp(),
    });
    currentUserData.monedasVirtuales = wallet - amount;
    document.querySelectorAll(".modal-overlay.active").forEach((m) => {
      const title = m.querySelector(".modal-title")?.textContent || "";
      if (title.toLowerCase().includes("apuesta")) m.remove();
    });
    showToast("Apuesta registrada", `Has apostado ${amount} monedas.`, "success");
  } catch (e) {
    console.error("placeMatchBet error", e);
    showToast("Error", "No se pudo registrar la apuesta.", "error");
  }
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

// Override: desactivar alertas de diario y pedir ICS de Apoing si falta
window.checkSystemAlerts = (userData = currentUserData) => {
  purgeEventDayAlerts();
  const hasApoing = Boolean(String(userData?.apoingCalendarUrl || "").trim() || getHomeApoingIcsUrl());
  if (!hasApoing) {
    try {
      const modal = document.getElementById("modal-match");
      const area = modal?.querySelector("#match-detail-area");
      if (area) {
        area.innerHTML = `
          <div class="p-6 text-center text-white/80 flex-col gap-3">
            <div class="text-lg font-black">Conecta tu Apoing (.ics)</div>
            <p class="text-sm opacity-80">Ve a tu perfil de Apoing, copia el enlace que termina en .ics y pégalo en Perfil o Calendario para sincronizar tus partidos.</p>
            <div class="text-xs opacity-60">Perfil → sección Apoing → pegar .ics y Guardar.</div>
            <div class="flex gap-2 justify-center mt-2">
              <button class="btn" onclick="window.location.href='perfil.html?focus=apoing#profile-apoing-settings'">Ir a Perfil</button>
              <button class="btn btn-ghost" onclick="document.getElementById('modal-match')?.classList.remove('active')">Cerrar</button>
            </div>
          </div>`;
        modal.classList.add("active");
      }
    } catch (_) {}
    showToast?.("Apoing", "Añade tu enlace .ics para sincronizar tus reservas", "info");
  }
};
/* Apoing Logic for Home */
async function syncApoingReservations() {
  const now = Date.now();
  if (now - apoingLastSyncAt < APOING_SYNC_TTL_MS) return;
  
  const sources = await getUnifiedApoingSources();
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
          owner: normalizeApoingOwnerName(extractOwnerFromApoingEvent({ ...e, sourceName: source.name }), source.name)
        }));
        allEvents.push(...expanded);
      } catch (err) {
        console.warn("Source sync error", source.uid, err);
      }
    }
    apoingEvents = dedupeApoingEventsByReservation(allEvents);
    apoingLastSyncAt = now;
    const activeTab = document.querySelector(".hv2-tab.active")?.dataset.filter || "open";
    renderMatchesByFilter(activeTab);
  } catch (e) {
    console.error("Apoing sync failed", e);
  }
}

async function getUnifiedApoingSources() {
  const sources = [];
  const currentUid = String(currentUser?.uid || "");
  const pushUnique = (row) => {
    const uid = String(row?.uid || "").trim();
    const icsUrl = normalizeApoingCalendarUrl(row?.icsUrl || row?.apoingCalendarUrl || row?.url || row?.calendarUrl || "");
    if (!uid || !icsUrl) return;
    if (!isValidApoingCalendarUrl(icsUrl)) return;
    const safeName = normalizeApoingOwnerName(
      row?.name || row?.nickname || row?.nombreUsuario || row?.nombre || row?.email || "",
      row?.nickname || row?.nombreUsuario || (row?.email ? String(row.email).split("@")[0] : "Jugador"),
    );
    const nextEntry = {
      uid,
      name: safeName || "Jugador",
      email: row?.email || "",
      icsUrl,
    };
    if (uid !== currentUid && isSuspiciousApoingSourceName(nextEntry.name, nextEntry.email)) {
      return;
    }
    const existingIndex = sources.findIndex((s) => s.uid === uid);
    if (existingIndex >= 0) {
      const current = sources[existingIndex];
      sources[existingIndex] = {
        ...current,
        ...(scoreApoingOwnerName(nextEntry.name) > scoreApoingOwnerName(current.name) ? { name: nextEntry.name } : {}),
        email: nextEntry.email || current.email || "",
        icsUrl: nextEntry.icsUrl || current.icsUrl,
      };
      return;
    }
    sources.push(nextEntry);
  };

  try {
    const publicSnap = await getDocs(collection(db, "apoingCalendars"));
    publicSnap.forEach((d) => {
      const data = d.data() || {};
      if (data.active === false) return;
      pushUnique({
        uid: d.id,
        name: data.name || data.nickname || data.nombre || data.nombreUsuario || "Jugador",
        nickname: data.nickname || data.nombreUsuario || "",
        nombre: data.nombre || "",
        nombreUsuario: data.nombreUsuario || "",
        email: data.email || "",
        icsUrl: data.icsUrl || "",
      });
    });
  } catch (_) {}

  try {
    const usersSnap = await getDocs(collection(db, "usuarios"));
    usersSnap.forEach((d) => {
      const data = d.data() || {};
      const url = data.apoingCalendarUrl || data.icsUrl || "";
      if (!url) return;
      pushUnique({
        uid: d.id,
        name: data.nombreUsuario || data.nombre || "Jugador",
        nickname: data.nombreUsuario || "",
        nombre: data.nombre || "",
        nombreUsuario: data.nombreUsuario || "",
        email: data.email || "",
        icsUrl: url,
      });
    });
  } catch (_) {}

  const myUrl = getHomeApoingIcsUrl();
  const hasMe = currentUser?.uid && sources.some((s) => s.uid === currentUser.uid);
  if (currentUser?.uid && myUrl && !hasMe) {
    pushUnique({
      uid: currentUser.uid,
      name: currentUserData?.nombreUsuario || currentUserData?.nombre || "TÃº",
      nickname: currentUserData?.nombreUsuario || "",
      nombre: currentUserData?.nombre || "",
      nombreUsuario: currentUserData?.nombreUsuario || "",
      email: currentUser.email || "",
      icsUrl: myUrl,
    });
  }

  const byUrl = new Map();
  sources.forEach((source) => {
    const key = String(source.icsUrl || "").trim().toLowerCase();
    if (!key) return;
    const list = byUrl.get(key) || [];
    list.push(source);
    byUrl.set(key, list);
  });

  const deduped = [];
  byUrl.forEach((list) => {
    if (list.length === 1) return deduped.push(list[0]);
    const preferred =
      list.find((row) => String(row.uid) === currentUid) ||
      [...list].sort((a, b) => scoreApoingOwnerName(b.name) - scoreApoingOwnerName(a.name))[0];
    if (preferred) deduped.push(preferred);
  });
  return deduped;
}

async function getApoingSources() {
  return getUnifiedApoingSources();
  const sources = [];
  const currentUid = String(currentUser?.uid || "");
  const pushUnique = (row) => {
    const uid = String(row?.uid || "").trim();
    const icsUrl = String(row?.icsUrl || "").trim();
    if (!uid || !icsUrl) return;
    if (!/^https:\/\/www\.apoing\.com\/calendars\/.+\.ics$/i.test(icsUrl)) return;
    const safeName = normalizeApoingOwnerName(
      row?.name || row?.nickname || row?.nombreUsuario || row?.nombre || row?.email || "",
      row?.nickname || row?.nombreUsuario || (row?.email ? String(row.email).split("@")[0] : "Jugador"),
    );
    const nextEntry = {
      uid,
      name: safeName || "Jugador",
      email: row?.email || "",
      icsUrl,
    };
    const existingIndex = sources.findIndex((s) => s.uid === uid);
    if (existingIndex >= 0) {
      const current = sources[existingIndex];
      sources[existingIndex] = {
        ...current,
        ...(scoreApoingOwnerName(nextEntry.name) > scoreApoingOwnerName(current.name) ? { name: nextEntry.name } : {}),
        email: nextEntry.email || current.email || "",
        icsUrl: nextEntry.icsUrl || current.icsUrl,
      };
      return;
    }
    sources.push(nextEntry);
  };
  try {
    const publicSnap = await getDocs(collection(db, "apoingCalendars"));
    publicSnap.forEach((d) => pushUnique({ uid: d.id, ...d.data() }));
  } catch (_) {}
  const myUrl = normalizeApoingCalendarUrl(currentUserData?.apoingCalendarUrl || currentUserData?.icsUrl || "");
  if (currentUser?.uid && myUrl) pushUnique({ uid: currentUser.uid, name: currentUserData?.nombreUsuario || "Tú", icsUrl: myUrl });
  const byUrl = new Map();
  sources.forEach((source) => {
    const key = String(source.icsUrl || "").trim().toLowerCase();
    if (!key) return;
    const list = byUrl.get(key) || [];
    list.push(source);
    byUrl.set(key, list);
  });
  const deduped = [];
  byUrl.forEach((list) => {
    if (list.length === 1) return deduped.push(list[0]);
    const preferred =
      list.find((row) => String(row.uid) === currentUid) ||
      [...list].sort((a, b) => scoreApoingOwnerName(b.name) - scoreApoingOwnerName(a.name))[0];
    if (preferred) deduped.push(preferred);
  });
  return deduped;
}

/**
 * Fetch an ICS feed from Apoing URL.
 * Strategy:
 *  1. Try direct fetch (works if no CORS restriction)
 *  2. Try the local Cloudflare worker proxy (/api/apoing-ics)
 *  3. Try corsproxy.io as fallback
 */
async function fetchRawApoingByUrl(url) {
  const encodedUrl = encodeURIComponent(url);
  const strategies = [
    () => fetch(`https://api.codetabs.com/v1/proxy?quest=${encodedUrl}`, { cache: "no-store" }),
    () => fetch(`https://corsproxy.io/?${encodedUrl}`, { cache: "no-store" }),
    () => fetch(`https://api.allorigins.win/raw?url=${encodedUrl}`, { cache: "no-store" }),
    () => fetch(String(url), { cache: "no-store" })
  ];
  for (const strategy of strategies) {
    try {
      const resp = await Promise.race([
        strategy(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
      ]);
      if (!resp.ok) continue;
      const text = await resp.text();
      if (String(text || "").includes("BEGIN:VCALENDAR")) {
        return text;
      }
    } catch (err) {
      console.warn("home-core: Apoing fetch strategy fail", err?.message);
    }
  }
  console.warn("home-core: All fetch strategies failed for Apoing URL:", url.slice(0, 60));
  return "";
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
  const mentionsMistralHomes = txt.includes("mistral homes");
  const mentionsPadel = txt.includes("padel mistral homes") || txt.includes("mistral homes padel") || txt.includes("padel") || txt.includes("pista padel") || txt.includes("court padel") || txt.includes("reserva padel");
  const mentionsClub = txt.includes("club social") || txt.includes("mistral homes club") || txt.includes("club mistral homes");
  if (mentionsClub && !mentionsPadel) return false;
  if (mentionsMistralHomes) return mentionsPadel && !mentionsClub;
  return mentionsPadel;
}

function normalizeName(t) { return String(t||"").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }

function normalizeApoingOwnerName(raw = "", fallback = "") {
  const value = String(raw || fallback || "").trim();
  if (!value) return "";
  const normalized = normalizeName(value);
  if (!normalized) return "";
  if (["jugador", "usuario", "cliente", "player", "ricardo"].includes(normalized)) return String(fallback || "").trim();
  if (/\b(?:pista|court|cancha)\s*[a-z]?\d{1,2}\b/i.test(value) || /^[a-z]{3,}\s+[a-z]\d{1,2}$/i.test(value)) return String(fallback || "").trim();
  if (/^(mistral|club|padel|reserva|apoing)/i.test(value)) return String(fallback || "").trim();
  return value.replace(/\b\w/g, (m) => m.toUpperCase()).replace(/\s+/g, " ").trim();
}

function normalizeApoingCalendarUrl(raw = "") {
  const clean = String(raw || "")
    .replace(/[\s"'`<>]/g, "")
    .replace(/&amp;/gi, "&")
    .trim();
  if (!clean) return "";
  const normalizedProtocol = clean.replace(/^http:\/\//i, "https://");
  if (/^https:\/\/apoing\.com\/calendars\/.+\.ics(?:\?.*)?$/i.test(normalizedProtocol)) {
    return normalizedProtocol.replace(/^https:\/\/apoing\.com\//i, "https://www.apoing.com/");
  }
  return normalizedProtocol;
}

function isValidApoingCalendarUrl(url = "") {
  return /^https:\/\/www\.apoing\.com\/calendars\/.+\.ics(?:\?.*)?$/i.test(String(url || "").trim());
}

function scoreApoingOwnerName(name = "") {
  const safe = normalizeApoingOwnerName(name, "");
  if (!safe) return 0;
  const normalized = normalizeName(safe);
  if (!normalized) return 0;
  if (/@/.test(safe)) return 1;
  if (/jugador|usuario|cliente|player|ricardo/.test(normalized)) return 1;
  if (/\b(?:pista|court|cancha)\s*[a-z]?\d{1,2}\b/i.test(safe) || /^[a-z]{3,}\s+[a-z]\d{1,2}$/i.test(normalized)) return 1;
  return safe.split(/\s+/).length >= 2 ? 5 : 3;
}

function isSuspiciousApoingSourceName(name = "", email = "") {
  const normalized = normalizeName(name);
  if (!normalized) return false;
  if (normalized === "ricardo a1") return true;
  const looksLikeAlias = /^[a-z]{3,}\s+[a-z]\d{1,2}$/.test(normalized);
  const weakScore = scoreApoingOwnerName(name) <= 1;
  const hasEmail = /@/.test(String(email || "").trim());
  return looksLikeAlias && weakScore && !hasEmail;
}

function dedupeApoingEventsByReservation(events = []) {
  const keyed = new Map();
  events.forEach((event) => {
    const start = event?.dtStart?.getTime?.() || 0;
    const end = event?.dtEnd?.getTime?.() || 0;
    const summary = normalizeName(event?.summary || "");
    const key = [start, end, summary].join("|");
    const current = keyed.get(key);
    if (!current) {
      keyed.set(key, event);
      return;
    }
    const currentScore = Math.max(scoreApoingOwnerName(current?.owner || ""), scoreApoingOwnerName(current?.sourceName || ""));
    const nextScore = Math.max(scoreApoingOwnerName(event?.owner || ""), scoreApoingOwnerName(event?.sourceName || ""));
    if (nextScore > currentScore) keyed.set(key, event);
  });
  return [...keyed.values()].sort((a, b) => (a.dtStart?.getTime?.() || 0) - (b.dtStart?.getTime?.() || 0));
}

function extractOwnerFromApoingEvent(ev) {
  const raw = `${ev.summary || ""} ${ev.description || ""}`;
  const patterns = [
    /(?:reservad[oa]\s+por|usuario|cliente|player|jugador)\s*[:\-]\s*([^\n,(]+)/i,
    /(?:titular|owner)\s*[:\-]\s*([^\n,(]+)/i
  ];
  for (const p of patterns) {
    const m = raw.match(p);
    if (m?.[1]?.trim()) return normalizeApoingOwnerName(m[1], ev.sourceName || "");
  }
  return normalizeApoingOwnerName("", ev.sourceName || "");
}

window.openApoingMatch = (id) => {
  const ev = (typeof apoingEvents !== 'undefined' ? apoingEvents : []).find(e => `apoing_${e.uid || ''}` === id || id.includes(e.uid));
  if (ev && ev.dtStart) {
    showToast("Reserva", "Redirigiendo a tu reserva para montar partido...", "info");
    setTimeout(() => {
      window.location.href = `calendario.html?jumpDate=${ev.dtStart.toISOString()}`;
    }, 1200);
  } else {
    window.location.href = "calendario.html";
  }
};

// Ensure cleanup includes Nexus
const originalCleanup = cleanup;
cleanup = () => {
  originalCleanup();
  if (typeof unsubNexus === "function") unsubNexus();
  unsubNexus = null;
};

// residue start 
/*
        const el = document.getElementById(id);
        if (!el) return;
        const isTarget = id === view;
        if (isTarget) {
            el.classList.remove("hidden");
            // Chat view needs flex, others use flex-col
            el.style.display = id === "proposal-view-chat" ? "flex" : "flex";
        } else {
            el.classList.add("hidden");
            el.style.display = "none";
        }
*/
// end residue

function updateProposalBadges(rows) {
    try {
        const proposals = Array.isArray(rows) ? rows : [];
        const activeCount = proposals.length;

        const quickBadge = document.querySelector("[data-proposal-badge]");
        if (quickBadge) {
            quickBadge.textContent = activeCount > 0 ? activeCount : "";
            quickBadge.style.display = activeCount > 0 ? "flex" : "none";
        }

        const heroBadge = document.querySelector(".hv2-propose-badge");
        if (!heroBadge) return;

        heroBadge.classList.remove("has-messages", "has-proposals");
        if (activeCount === 0) {
            heroBadge.innerHTML = '<i class="fas fa-plus"></i>';
            return;
        }

        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const recentlyUpdated = proposals.some((p) => {
            const updatedAt = p?.updatedAt?.toMillis?.() || 0;
            return updatedAt > dayAgo;
        });

        heroBadge.classList.add(recentlyUpdated ? "has-messages" : "has-proposals");
        heroBadge.innerHTML = `<span>${activeCount}</span>`;
    } catch (_) {}
}
window.shareMatch = async (matchId, col) => {
    const match = allMatches.find(m => m.id === matchId) || {};
    const d = toDateSafe(match.fecha);
    const dateStr = d ? d.toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : "próximamente";
    const players = getNormalizedPlayers(match);
    const names = players.map(uid => getPlayerDisplayName(uid));
    
    // Check if finished to use mission / result poster
    if (isFinishedMatch(match)) {
        const sets = getResultSetsString(match) || "PARTIDO FINALIZADO";
        const winner = resolveWinnerTeam(match);
        const pNames = players.map(uid => String(getPlayerDisplayName(uid) || "Jugador"));
        
        const metadata = {
            players: pNames,
            teamA: [pNames[0], pNames[1]],
            teamB: [pNames[2], pNames[3]],
            winner,
            sets,
            club: "JAFS PADEL",
            logoUrl: 'imagenes/Logojafs.png'
        };

        
        const analysis = {
            sets: sets,
            delta: 0,
            pointsAfter: "CONFIRMADAS",
            levelBand: "PARTIDO COMPLETADO"
        };
        
        await shareMatchResult(analysis, metadata);
        return;
    }


    // Default social share text
    let text = `🎾 ¡Partido de Padel! \n📅 ${dateStr}\n`;
    if (names.length >= 4) {
        text += `⚔️ ${names[0]} / ${names[1]} VS ${names[2]} / ${names[3]}\n`;
    }
    
    text += `\nEntra en JafsPadel para ver mas.`;

    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Partido en JafsPadel',
                text: text,
                url: window.location.origin
            });
        } catch (err) {
            // console.log('Share failed', err);
        }
    } else {
        try {
            await navigator.clipboard.writeText(text);
            showToast("Copiado", "Detalles del partido copiados al portapapeles", "success");
        } catch (err) {
            console.error("Clipboard fail", err);
        }
    }
};




// === POSTER HUB ===
window.openPosterHub = () => {
    const modalId = "modal-poster-hub";
    let modal = document.getElementById(modalId);
    if (!modal) {
        modal = document.createElement("div");
        modal.id = modalId;
        modal.className = "modal-overlay";
        modal.innerHTML = `
            <div class="modal-card glass-strong animate-up" style="max-width:480px;">
                <div class="modal-header">
                    <h3 class="modal-title" style="font-size:14px;"><i class="fas fa-file-image text-primary mr-2"></i>HUB DE CARTELES</h3>
                    <button class="close-btn" onclick="document.getElementById('${modalId}').classList.remove('active')">&times;</button>
                </div>
                <div class="modal-body flex-col gap-4 p-5">
                    <p class="text-[10px] opacity-60 uppercase font-black tracking-widest text-center mb-2">Generación de carteles premium</p>
                    <div class="text-[10px] text-white/60 text-center">Descarga directa en PNG para compartir en WhatsApp o redes.</div>
                    
                    <button class="btn-promo-hub" onclick="window.generatePoster('week')">
                        <i class="fas fa-calendar-week"></i>
                        <div class="flex-col items-start">
                            <span class="hub-t">TODA LA SEMANA</span>
                            <span class="hub-s">Resumen de próximos 7 días</span>
                        </div>
                    </button>

                    <button class="btn-promo-hub" onclick="window.generatePoster('today')">
                        <i class="fas fa-calendar-day"></i>
                        <div class="flex-col items-start">
                            <span class="hub-t">PARTIDOS DE HOY</span>
                            <span class="hub-s">Cartel para las partidas de hoy</span>
                        </div>
                    </button>

                    <button class="btn-promo-hub" onclick="window.generatePoster('match')">
                        <i class="fas fa-table-tennis-paddle-ball"></i>
                        <div class="flex-col items-start">
                            <span class="hub-t">PARTIDO CONCRETO</span>
                            <span class="hub-s">Elige un partido para cartel individual</span>
                        </div>
                    </button>

                    <button class="btn-promo-hub" onclick="window.generatePoster('weekday')">
                        <i class="fas fa-calendar-alt"></i>
                        <div class="flex-col items-start">
                            <span class="hub-t">DÍA DE LA SEMANA</span>
                            <span class="hub-s">Filtra por lunes, martes, etc.</span>
                        </div>
                    </button>

                    <button class="btn-promo-hub" onclick="window.generatePoster('event')">
                        <i class="fas fa-trophy"></i>
                        <div class="flex-col items-start">
                            <span class="hub-t">EVENTO ESPECÍFICO</span>
                            <span class="hub-s">Genera estado visual del evento elegido</span>
                        </div>
                    </button>
                    
                    <div id="poster-match-selector" class="hidden mt-2 p-3 bg-black/40 rounded-xl border border-white/10 max-h-48 overflow-y-auto custom-scroll">
                        <div class="text-[10px] opacity-40 text-center py-4">Cargando partidas...</div>
                    </div>
                    <div id="poster-weekday-selector" class="hidden mt-2 p-3 bg-black/40 rounded-xl border border-white/10">
                      <div class="poster-weekdays-grid">
                        <button type="button" class="poster-day-btn" onclick="window.generatePosterByWeekday(1)">Lunes</button>
                        <button type="button" class="poster-day-btn" onclick="window.generatePosterByWeekday(2)">Martes</button>
                        <button type="button" class="poster-day-btn" onclick="window.generatePosterByWeekday(3)">Miércoles</button>
                        <button type="button" class="poster-day-btn" onclick="window.generatePosterByWeekday(4)">Jueves</button>
                        <button type="button" class="poster-day-btn" onclick="window.generatePosterByWeekday(5)">Viernes</button>
                        <button type="button" class="poster-day-btn" onclick="window.generatePosterByWeekday(6)">Sábado</button>
                        <button type="button" class="poster-day-btn" onclick="window.generatePosterByWeekday(0)">Domingo</button>
                      </div>
                    </div>
                    <div id="poster-event-selector" class="hidden mt-2 p-3 bg-black/40 rounded-xl border border-white/10 max-h-48 overflow-y-auto custom-scroll">
                      <div class="text-[10px] opacity-40 text-center py-4">Cargando eventos...</div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        if (!document.getElementById("poster-hub-styles")) {
            const style = document.createElement("style");
            style.id = "poster-hub-styles";
            style.textContent = `
                .btn-promo-hub {
                    display: flex; align-items: center; gap: 16px; padding: 16px; 
                    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
                    border-radius: 18px; color: #fff; text-align: left; cursor: pointer; transition: all 0.2s ease;
                    width:100%; box-sizing:border-box;
                }
                .btn-promo-hub:hover { border-color: var(--primary); background: rgba(0,212,255,0.08); transform: scale(1.02); }
                .btn-promo-hub i { font-size: 20px; color: var(--primary); width: 24px; text-align: center; }
                .hub-t { font-size: 13px; font-weight: 900; letter-spacing: 0.5px; }
                .hub-s { font-size: 10px; opacity: 0.5; font-weight: 600; }
                .poster-sel-item { padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); cursor:pointer; transition:background 0.2s; }
                .poster-sel-item:hover { background: rgba(255,255,255,0.05); }
                .poster-sel-item:last-child { border-bottom:none; }
                .poster-weekdays-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
                .poster-day-btn {
                  border:1px solid rgba(255,255,255,0.1);
                  background:rgba(255,255,255,0.04);
                  color:#fff;
                  border-radius:12px;
                  min-height:36px;
                  font-size:11px;
                  font-weight:800;
                  cursor:pointer;
                }
                .poster-day-btn:hover { border-color: rgba(0,212,255,0.35); background: rgba(0,212,255,0.12); }
            `;
            document.head.appendChild(style);
        }
    }
    modal.classList.add("active");
};

function closePosterHubSelectors() {
  ["poster-match-selector", "poster-weekday-selector", "poster-event-selector"].forEach((id) => {
    document.getElementById(id)?.classList.add("hidden");
  });
}

function getPosterMatchesByType(type) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (type === "today") {
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return allMatches.filter((m) => {
      const d = toDateSafe(m.fecha);
      return d && d >= startOfToday && d <= endOfToday && !isFinishedMatch(m);
    });
  }
  if (type === "week") {
    const endOfWeek = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);
    return allMatches.filter((m) => {
      const d = toDateSafe(m.fecha);
      return d && d >= startOfToday && d <= endOfWeek && !isFinishedMatch(m);
    });
  }
  return [];
}

async function buildSchedulePosterDataUrl(title, matches = []) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = 1080;
  canvas.height = 1350;
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, "#020617");
  gradient.addColorStop(0.35, "#0a1630");
  gradient.addColorStop(0.8, "#081b24");
  gradient.addColorStop(1, "#020617");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  for (let y = 0; y < canvas.height; y += 56) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#b8ff00";
  ctx.font = "900 52px Rajdhani";
  ctx.textAlign = "left";
  ctx.fillText(String(title).toUpperCase(), 72, 100);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.font = "700 24px Rajdhani";
  ctx.fillText(new Date().toLocaleString("es-ES", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }), 72, 138);

  const rows = matches.slice(0, 12);
  let y = 190;
  if (!rows.length) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "800 34px Rajdhani";
    ctx.fillText("SIN PARTIDOS DISPONIBLES", 72, y + 60);
    return canvas.toDataURL("image/png", 0.95);
  }

  rows.forEach((match, idx) => {
    const d = toDateSafe(match.fecha);
    const time = d ? d.toLocaleString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Fecha pendiente";
    const players = getNormalizedPlayers(match);
    while (players.length < 4) players.push(null);
    const p0 = players[0] ? getPlayerDisplayName(players[0]) : "Libre";
    const p1 = players[1] ? getPlayerDisplayName(players[1]) : "Libre";
    const p2 = players[2] ? getPlayerDisplayName(players[2]) : "Libre";
    const p3 = players[3] ? getPlayerDisplayName(players[3]) : "Libre";
    const teamA = `${p0} / ${p1}`;
    const teamB = `${p2} / ${p3}`;
    const cardY = y + idx * 88;

    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.strokeStyle = "rgba(0,212,255,0.28)";
    ctx.lineWidth = 2;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(68, cardY, 944, 74, 18);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = "#00d4ff";
    ctx.font = "800 18px Rajdhani";
    ctx.fillText(time.toUpperCase(), 90, cardY + 24);
    ctx.fillStyle = "#fff";
    ctx.font = "900 24px Rajdhani";
    ctx.fillText(`${teamA}  VS  ${teamB}`.toUpperCase(), 90, cardY + 54);
  });

  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = "700 18px Rajdhani";
  ctx.textAlign = "center";
  ctx.fillText("PADELUMINATIS · DESCARGA DIRECTA", canvas.width / 2, canvas.height - 32);
  return canvas.toDataURL("image/png", 0.95);
}

async function downloadSchedulePoster(title, matches) {
  const dataUrl = await buildSchedulePosterDataUrl(title, matches);
  await downloadDataUrl(dataUrl, `cartel_${String(title).toLowerCase().replace(/\s+/g, "_")}.png`);
  showToast("Cartel listo", "Se ha descargado el cartel en PNG.", "success");
}

window.generatePoster = async (type) => {
    closePosterHubSelectors();
    if (type === 'match') {
        const selector = document.getElementById('poster-match-selector');
        if (selector) {
            selector.classList.remove('hidden');
            renderPosterMatchList();
        }
        return;
    }
    if (type === "weekday") {
      document.getElementById("poster-weekday-selector")?.classList.remove("hidden");
      return;
    }
    if (type === "event") {
      const selector = document.getElementById("poster-event-selector");
      if (selector) {
        selector.classList.remove("hidden");
        renderPosterEventList();
      }
      return;
    }
    
    showToast("Generando...", "Preparando cartel del club...", "info");
    try {
        const matchesToPrint = getPosterMatchesByType(type);
        if (!matchesToPrint.length) {
          showToast("Aviso", type === "today" ? "No hay partidos para hoy" : "No hay partidos esta semana", "warning");
          return;
        }
        const title = type === "today" ? "Partidos de hoy" : "Proximos partidos";
        await downloadSchedulePoster(title, matchesToPrint);
    } catch (e) {
        console.error(e);
        showToast("Error", "No se pudo generar el cartel", "error");
    }
};

function renderPosterMatchList() {
    const container = document.getElementById("poster-match-selector");
    if (!container) return;
    const upcoming = allMatches.filter(m => !isFinishedMatch(m)).sort((a,b) => toDateSafe(a.fecha) - toDateSafe(b.fecha));
    if (!upcoming.length) {
        container.innerHTML = `<div class="text-[10px] opacity-40 text-center py-4">No hay partidos próximos</div>`;
        return;
    }
    container.innerHTML = upcoming.map(m => {
        const d = toDateSafe(m.fecha);
        const time = d ? d.toLocaleString('es-ES', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : 'N/D';
        const mPlayers = getNormalizedPlayers(m);
        while (mPlayers.length < 4) mPlayers.push(null);
        const pNamesStr = mPlayers.map(uid => uid ? getPlayerDisplayName(uid) : 'Libre').join(', ');
        return `
            <div class="poster-sel-item" onclick="window.generateIndividualPoster('${m.id}')">
                <div class="text-[11px] font-bold text-white">${time}</div>
                <div class="text-[9px] opacity-60 truncate">${escapeHtml(pNamesStr)}</div>
            </div>
        `;
    }).join("");
}

window.generatePosterByWeekday = async (weekday) => {
  closePosterHubSelectors();
  const selector = document.getElementById("poster-weekday-selector");
  if (selector) selector.classList.remove("hidden");
  const matches = allMatches
    .filter((m) => !isFinishedMatch(m))
    .filter((m) => {
      const d = toDateSafe(m.fecha);
      return d && d.getDay() === Number(weekday);
    })
    .sort((a, b) => toDateSafe(a.fecha) - toDateSafe(b.fecha));
  if (!matches.length) {
    showToast("Aviso", "No hay partidos para ese dia.", "warning");
    return;
  }
  const dayNames = ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"];
  await downloadSchedulePoster(`Partidos ${dayNames[Number(weekday)] || ""}`, matches);
};

function renderPosterEventList() {
  const container = document.getElementById("poster-event-selector");
  if (!container) return;
  const rows = (myEvents || []).slice(0, 20);
  if (!rows.length) {
    container.innerHTML = `<div class="text-[10px] opacity-40 text-center py-4">No tienes eventos activos</div>`;
    return;
  }
  container.innerHTML = rows
    .map((ev) => {
      const title = escapeHtml(ev?.nombre || ev?.titulo || "Evento");
      const state = escapeHtml(ev?.estado || "activo");
      return `
        <div class="poster-sel-item" onclick="window.generatePosterFromEvent('${ev.id}')">
          <div class="text-[11px] font-bold text-white">${title}</div>
          <div class="text-[9px] opacity-60 truncate">Estado: ${state}</div>
        </div>
      `;
    })
    .join("");
}

window.generatePosterFromEvent = async (eventId) => {
  try {
    const eventRow = (myEvents || []).find((ev) => ev.id === eventId);
    if (!eventRow) {
      showToast("Aviso", "No hemos encontrado ese evento.", "warning");
      return;
    }
    const relatedMatches = allMatches.filter((m) => String(m.eventoId || m.eventId || "") === String(eventId));
    const played = relatedMatches.filter((m) => isFinishedMatch(m)).slice(0, 10).map((m) => {
      const mPlayers = getNormalizedPlayers(m);
      while (mPlayers.length < 4) mPlayers.push(null);
      const n0 = mPlayers[0] ? getPlayerDisplayName(mPlayers[0]) : 'Libre';
      const n1 = mPlayers[1] ? getPlayerDisplayName(mPlayers[1]) : 'Libre';
      const n2 = mPlayers[2] ? getPlayerDisplayName(mPlayers[2]) : 'Libre';
      const n3 = mPlayers[3] ? getPlayerDisplayName(mPlayers[3]) : 'Libre';
      return {
        teamAName: `${n0} / ${n1}`,
        teamBName: `${n2} / ${n3}`,
        resultado: getResultSetsString(m) || m.resultado || "-",
      };
    });
    const scheduled = relatedMatches.filter((m) => !isFinishedMatch(m)).slice(0, 10).map((m) => {
      const mPlayers = getNormalizedPlayers(m);
      while (mPlayers.length < 4) mPlayers.push(null);
      const n0 = mPlayers[0] ? getPlayerDisplayName(mPlayers[0]) : 'Libre';
      const n1 = mPlayers[1] ? getPlayerDisplayName(mPlayers[1]) : 'Libre';
      const n2 = mPlayers[2] ? getPlayerDisplayName(mPlayers[2]) : 'Libre';
      const n3 = mPlayers[3] ? getPlayerDisplayName(mPlayers[3]) : 'Libre';
      return {
        teamAName: `${n0} / ${n1}`,
        teamBName: `${n2} / ${n3}`,
        fechaStr: toDateSafe(m.fecha)?.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) || "Pendiente",
      };
    });

    await generateEventStatusPoster({
      eventName: eventRow?.nombre || eventRow?.titulo || "Evento",
      organizer: currentUserData?.club || "JAFS PADEL CLUB",
      eventFormat: eventRow?.tipo || eventRow?.formato || "Evento",
      registeredCount: Array.isArray(eventRow?.inscritos) ? eventRow.inscritos.length : 0,
      teamCount: Array.isArray(eventRow?.teams) ? eventRow.teams.length : 0,
      played,
      scheduled,
      pending: [],
      standings: [],
    });
    showToast("Cartel listo", "Estado del evento descargado.", "success");
    document.getElementById("modal-poster-hub")?.classList.remove("active");
  } catch (e) {
    console.error("Event poster fail", e);
    showToast("Error", "No se pudo generar el cartel del evento.", "error");
  }
};

window.generateIndividualPoster = async (matchId) => {
    const match = allMatches.find(m => m.id === matchId);
    if (!match) return;
    showToast("Generando...", "Preparando cartel individual", "info");
    const d = toDateSafe(match.fecha);
    const isFinished = isFinishedMatch(match);
    const sets = isFinished ? (getResultSetsString(match) || "FINALIZADO") : null;
    const winner = isFinished ? resolveWinnerTeam(match) : null;
    const players = getNormalizedPlayers(match);
    while (players.length < 4) players.push(null);
    const pNames = players.map(uid => uid ? getPlayerDisplayName(uid) : 'Libre');
    const pLevels = players.map(uid => {
        if (!uid) return null;
        if (uid === currentUser?.uid) return Number(currentUserData?.nivel || 2.5);
        const guest = parseGuestMeta(uid);
        if (guest) return Number(guest.level || 2.5);
        // Try playerDataCache first
        const cached = playerDataCache.get(uid);
        if (cached?.nivel) return Number(cached.nivel);
        // Fall back to proposalUsersCache
        const pUser = proposalUsersCache.find(u => u.id === uid);
        if (pUser?.nivel) return Number(pUser.nivel);
        return null; // null = unknown, poster will show '?'
    });
    const matchType = String(match.col || '').includes('Reto') ? 'LIGA RETO' :
        String(match.col || '').includes('evento') ? 'EVENTO' : 'AMISTOSO';
    const data = {
        title: isFinished ? 'RESULTADO DEL PARTIDO' : 'PARTIDO PROGRAMADO',
        matchType,
        when: d ? d.toLocaleString('es-ES', { weekday:'long', day:'2-digit', month:'long', hour:'2-digit', minute:'2-digit' }) : 'Próximamente',
        teamA: [pNames[0], pNames[1]],
        teamB: [pNames[2], pNames[3]],
        levelsA: [pLevels[0], pLevels[1]],
        levelsB: [pLevels[2], pLevels[3]],
        winner,
        sets,
        club: 'JAFS PADEL CLUB',
        logoUrl: 'imagenes/Logojafs.png'
    };
    await shareMatchPoster(data);
    document.getElementById("modal-poster-hub")?.classList.remove("active");
};

/* Legacy proposal block disabled: replaced by richer modal flow below.
// === REMAINING PROPOSAL LOGIC ===
function timeAgo(date) {
    if (!date) return "N/D";
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " años";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " meses";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " d";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " h";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " m";
    return "ahora";
}

window.renderProposalList = async () => {
    navigateProposalView("proposal-view-list");
    const container = document.getElementById("proposal-view-list");
    if (!container) return;
    container.innerHTML = `<div class="text-[10px] opacity-40 text-center py-20 uppercase font-black tracking-widest animate-pulse">Sincronizando...</div>`;

    if (proposalListUnsub) { try { proposalListUnsub(); } catch(e) {} }
    proposalListUnsub = subscribeCol("propuestasPartido", (list) => {
        const open = list.filter(p => (p.status || 'open') === 'open').sort((a,b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        if (!open.length) {
            container.innerHTML = `
                <div class="flex-col items-center justify-center p-12 opacity-30 text-center">
                    <i class="fas fa-comments text-4xl mb-4"></i>
                    <span class="text-[11px] font-black tracking-widest">NADA POR AQUÍ...</span>
                </div>
            `;
            return;
        }
        container.innerHTML = `
            <div class="flex-col gap-3">
                ${open.map(p => {
                    const count = (p.participantIds || []).length;
                    const date = p.createdAt?.toDate?.() || new Date();
                    return `
                        <div class="proposal-card-v2" onclick="window.openProposalDetail('${p.id}')">
                            <div class="flex-col flex-1">
                                <span class="p-title">${escapeHtml(p.title || 'Propuesta de partido')}</span>
                                <div class="p-meta">
                                    <span class="p-badge">${count}/4</span>
                                    <span class="p-ago">${timeAgo(date)}</span>
                                </div>
                            </div>
                            <i class="fas fa-chevron-right opacity-30"></i>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    });
};

window.openProposalDetail = async (pid) => {
    activeProposalId = pid;
    navigateProposalView("proposal-view-chat");
    const chatEl = document.getElementById("proposal-view-chat");
    if (!chatEl) return;
    chatEl.innerHTML = `
        <div class="flex-row items-center gap-3 p-3 bg-white/5 rounded-2xl mb-4 border border-white/10">
            <button class="btn btn-ghost sm" onclick="window.renderProposalList()"><i class="fas fa-arrow-left"></i></button>
            <div class="flex-col flex-1 truncate">
                <span id="proposal-chat-title" class="text-[12px] font-black uppercase truncate">...</span>
                <span id="proposal-chat-status" class="text-[9px] opacity-40 font-bold">...</span>
            </div>
        </div>
        <div id="proposal-messages" class="flex-1 overflow-y-auto pr-1 custom-scroll mb-4" style="min-height:300px; display:flex; flex-direction:column; gap:12px;"></div>
        <div class="flex-row gap-2 items-end bg-black/40 p-2 rounded-2xl border border-white/5">
            <textarea id="proposal-input" class="input flex-1" style="min-height:44px; max-height:120px; font-size:12px; padding:12px 16px; border:none; background:transparent;" placeholder="Escribe al grupo..."></textarea>
            <button class="btn btn-primary" id="btn-send-proposal" style="height:44px; width:44px; border-radius:18px; flex-shrink:0;">
                <i class="fas fa-paper-plane"></i>
            </button>
        </div>
    `;

    document.getElementById("btn-send-proposal").addEventListener("click", () => window.sendProposalMessage());
    document.getElementById("proposal-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); window.sendProposalMessage(); }
    });

    if (proposalChatUnsub) { try { proposalChatUnsub(); } catch(e) {} }
    if (proposalMetaUnsub) { try { proposalMetaUnsub(); } catch(e) {} }

    proposalMetaUnsub = onSnapshot(doc(db, "propuestasPartido", pid), (d) => {
        if (!d.exists()) return;
        const data = d.data();
        activeProposalMeta = data;
        const titleEl = document.getElementById("proposal-chat-title");
        const statusEl = document.getElementById("proposal-chat-status");
        if (titleEl) titleEl.textContent = data.title || "Propuesta";
        if (statusEl) statusEl.textContent = `${(data.participantIds || []).length}/4 JUGADORES · ${(data.status || 'abierta').toUpperCase()}`;
    });

    const q = query(collection(db, "propuestasPartido", pid, "chat"), orderBy("createdAt", "asc"), limit(100));
    proposalChatUnsub = onSnapshot(q, (snap) => {
        const msgsEl = document.getElementById("proposal-messages");
        if (!msgsEl) return;
        const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        msgsEl.innerHTML = msgs.map(m => {
            const isMe = m.senderUid === currentUser?.uid;
            const time = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' }) : '';
            return `
                <div class="msg-bubble-wrap ${isMe ? 'is-me' : ''}">
                    ${!isMe ? `<span class="msg-sender">${escapeHtml(m.senderName || 'Anónimo')}</span>` : ''}
                    <div class="msg-bubble"><p>${escapeHtml(m.text || '')}</p><span class="msg-time">${time}</span></div>
                </div>
            `;
        }).join('') || `<div class="text-[10px] opacity-20 text-center py-20 italic">No hay mensajes.</div>`;
        msgsEl.scrollTop = msgsEl.scrollHeight;
    });
};

window.sendProposalMessage = async () => {
    const input = document.getElementById("proposal-input");
    const text = input?.value?.trim();
    if (!text || !activeProposalId || !currentUser?.uid) return;
    input.value = "";
    try {
        await addDoc(collection(db, "propuestasPartido", activeProposalId, "chat"), {
            text,
            senderUid: currentUser.uid,
            senderName: currentUserData?.nombreUsuario || currentUserData?.nombre || "Jugador",
            createdAt: serverTimestamp()
        });
        await setDoc(doc(db, "propuestasPartido", activeProposalId), { updatedAt: serverTimestamp() }, { merge: true });
    } catch (e) {
        showToast("Error", "No se pudo enviar", "error");
    }
};

function navigateProposalView(view) {
    const ids = ["proposal-view-list", "proposal-view-chat"];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === view) {
            el.style.display = "flex";
            el.classList.remove("hidden");
        } else {
            el.style.display = "none";
            el.classList.add("hidden");
        }
    });
}

*/
function getProposalUserName(uid) {
  if (!uid) return "Libre";
  if (uid === currentUser?.uid) return currentUserData?.nombreUsuario || currentUserData?.nombre || "Tu";
  const cached = proposalUsersCache.find((row) => row.id === uid);
  return cached?.nombreUsuario || cached?.nombre || getPlayerDisplayName(uid) || "Jugador";
}

function getProposalUserPhoto(uid) {
  if (!uid) return "";
  if (uid === currentUser?.uid) return currentUserData?.fotoPerfil || currentUserData?.fotoURL || currentUserData?.photoURL || "";
  const cached = proposalUsersCache.find((row) => row.id === uid);
  return cached?.fotoPerfil || cached?.fotoURL || cached?.photoURL || "";
}

function canCurrentUserJoinProposal(meta = {}) {
  const ids = Array.isArray(meta?.participantIds) ? meta.participantIds.filter(Boolean) : [];
  if (!currentUser?.uid) return false;
  if (ids.includes(currentUser.uid)) return false;
  return ids.length < 4 && String(meta?.status || "open").toLowerCase() === "open";
}

function getProposalReservedPlayers(meta = {}) {
  const ids = Array.isArray(meta?.participantIds) ? meta.participantIds.filter(Boolean).slice(0, 4) : [];
  while (ids.length < 4) ids.push(null);
  return ids;
}

function renderProposalMembers(meta = {}) {
  const ids = getProposalReservedPlayers(meta);
  return ids.map((uid) => {
    const name = getProposalUserName(uid);
    const photo = getProposalUserPhoto(uid);
    const initials = getInitials(name);
    return `
      <div class="proposal-member-chip ${uid ? "" : "empty"}">
        <div class="proposal-member-avatar">
          ${uid ? (photo ? `<img src="${photo}" alt="${escapeHtml(name)}" onerror="this.outerHTML='<span>${initials}</span>'">` : `<span>${initials}</span>`) : `<i class="fas fa-user-plus"></i>`}
        </div>
        <span>${escapeHtml(uid ? name : "Libre")}</span>
      </div>
    `;
  }).join("");
}

function renderProposalCreateView() {
  navigateProposalView("proposal-view-create");
  const container = document.getElementById("proposal-view-create");
  if (!container) return;
  const users = proposalUsersCache.slice(0, 24);
  container.innerHTML = `
    <div class="proposal-create-shell">
      <div class="proposal-create-head">
        <button type="button" class="btn btn-ghost sm" onclick="window.renderProposalList()"><i class="fas fa-arrow-left"></i></button>
        <div>
          <strong>Nueva propuesta</strong>
          <span>Selecciona jugadores y luego fija el dia desde calendario.</span>
        </div>
      </div>
      <label class="proposal-field">
        <span>Titulo</span>
        <input id="proposal-create-title" class="input" maxlength="64" placeholder="Ej. Martes tarde en Padel Mistral">
      </label>
      <label class="proposal-field">
        <span>Mensaje inicial</span>
        <textarea id="proposal-create-message" class="input" rows="3" placeholder="Propuesta de partido, nivel y franja ideal"></textarea>
      </label>
      <div class="proposal-field">
        <span>Invitar jugadores</span>
        <div class="proposal-invite-grid">
          ${users.length ? users.map((user) => `
            <button type="button" class="proposal-invite-chip" data-invite-user="${user.id}" onclick="window.toggleProposalInvite('${user.id}')">
              <strong>${escapeHtml(user.nombreUsuario || user.nombre || "Jugador")}</strong>
              <small>${Number(user.nivel || 2.5).toFixed(1)} nivel</small>
            </button>
          `).join("") : `<div class="proposal-empty-copy">Cargando usuarios disponibles...</div>`}
        </div>
      </div>
      <div class="proposal-create-actions">
        <button type="button" class="hv2-inline-btn primary" onclick="window.createProposalFromHome()">
          <i class="fas fa-paper-plane"></i> Crear propuesta
        </button>
        <button type="button" class="hv2-inline-btn" onclick="window.renderProposalList()">
          Cancelar
        </button>
      </div>
    </div>
  `;
}
window.renderProposalCreateView = renderProposalCreateView;

window.toggleProposalInvite = (uid) => {
  const btn = document.querySelector(`[data-invite-user="${uid}"]`);
  if (!btn) return;
  const selected = btn.dataset.selected === "1";
  btn.dataset.selected = selected ? "0" : "1";
  btn.classList.toggle("is-selected", !selected);
};

window.createProposalFromHome = async () => {
  if (!currentUser?.uid) return;
  const titleInput = document.getElementById("proposal-create-title");
  const messageInput = document.getElementById("proposal-create-message");
  const selectedUsers = Array.from(document.querySelectorAll("[data-invite-user][data-selected='1']")).map((node) => node.getAttribute("data-invite-user")).filter(Boolean);
  const title = String(titleInput?.value || "").trim() || `Partido con ${currentUserData?.nombreUsuario || currentUserData?.nombre || "jugadores"}`;
  const message = String(messageInput?.value || "").trim();
  const participantIds = [currentUser.uid, ...selectedUsers].slice(0, 4);
  try {
    const proposalRef = await addDoc(collection(db, "propuestasPartido"), {
      title,
      description: message,
      createdBy: currentUser.uid,
      createdByName: currentUserData?.nombreUsuario || currentUserData?.nombre || "Jugador",
      participantIds,
      invitedUserIds: selectedUsers,
      status: participantIds.length >= 4 ? "full" : "open",
      surface: "indoor",
      courtType: "normal",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await addDoc(collection(db, "propuestasPartido", proposalRef.id, "chat"), {
      text: message || "Propuesta creada. Podemos completar jugadores y reservar dia desde calendario.",
      senderUid: currentUser.uid,
      senderName: currentUserData?.nombreUsuario || currentUserData?.nombre || "Jugador",
      createdAt: serverTimestamp(),
      system: false,
    });
    await Promise.allSettled(selectedUsers.map((uid) =>
      createNotification(uid, "Nueva propuesta", `${currentUserData?.nombreUsuario || currentUserData?.nombre || "Un jugador"} te ha invitado a una propuesta de partido.`, "info", "home.html", { type: "proposal_invite", proposalId: proposalRef.id }),
    ));
    showToast("Propuesta creada", "Ya puedes abrirla, hablar con el grupo y reservar el dia.", "success");
    window.openProposalDetail(proposalRef.id);
  } catch (e) {
    console.error(e);
    showToast("Error", "No se pudo crear la propuesta.", "error");
  }
};

window.renderProposalList = async () => {
  preloadProposalUsers();
  navigateProposalView("proposal-view-list");
  const container = document.getElementById("proposal-view-list");
  if (!container) return;
  container.innerHTML = `<div class="text-[10px] opacity-40 text-center py-20 uppercase font-black tracking-widest animate-pulse">Sincronizando...</div>`;
  if (proposalListUnsub) {
    try { proposalListUnsub(); } catch {}
  }
  proposalListUnsub = subscribeCol("propuestasPartido", (list) => {
    const openRows = (list || [])
      .filter((row) => String(row?.status || "open").toLowerCase() !== "closed")
      .sort((a, b) => (b?.updatedAt?.toMillis?.() || b?.createdAt?.toMillis?.() || 0) - (a?.updatedAt?.toMillis?.() || a?.createdAt?.toMillis?.() || 0));
    container.innerHTML = `
      <div class="proposal-list-shell">
        <div class="proposal-list-top">
          <div>
            <strong>Propuestas activas</strong>
            <span>Chat, jugadores y salto directo a calendario.</span>
          </div>
          <button type="button" class="hv2-inline-btn primary" onclick="window.renderProposalCreateView()">
            <i class="fas fa-plus"></i> Nueva
          </button>
        </div>
        ${openRows.length ? openRows.map((proposal) => {
          const ids = Array.isArray(proposal?.participantIds) ? proposal.participantIds.filter(Boolean) : [];
          const isMine = ids.includes(currentUser?.uid);
          const summary = proposal?.description || "Sin mensaje inicial.";
          return `
            <button type="button" class="proposal-card-v2 ${isMine ? "is-mine" : ""}" onclick="window.openProposalDetail('${proposal.id}')">
              <div class="proposal-card-head">
                <span class="p-title">${escapeHtml(proposal.title || "Propuesta de partido")}</span>
                <span class="p-badge">${ids.length}/4</span>
              </div>
              <div class="proposal-member-row">${renderProposalMembers(proposal)}</div>
              <p class="proposal-card-copy">${escapeHtml(summary)}</p>
              <div class="p-meta">
                <span>${timeAgo(proposal?.updatedAt?.toDate?.() || proposal?.createdAt?.toDate?.() || new Date())}</span>
                <span>${isMine ? "Estas dentro" : "Abierta"}</span>
              </div>
            </button>
          `;
        }).join("") : `<div class="proposal-empty-copy">Todavia no hay propuestas abiertas. Crea la primera y fijad el partido desde calendario.</div>`}
      </div>
    `;
  });
};

async function persistProposalMeta(proposalId, nextMeta) {
  await setDoc(doc(db, "propuestasPartido", proposalId), {
    ...nextMeta,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

window.joinProposalFromHome = async () => {
  if (!activeProposalId || !currentUser?.uid || !activeProposalMeta) return;
  const ids = Array.isArray(activeProposalMeta.participantIds) ? activeProposalMeta.participantIds.filter(Boolean) : [];
  if (ids.includes(currentUser.uid) || ids.length >= 4) return;
  const nextIds = [...ids, currentUser.uid].slice(0, 4);
  try {
    await persistProposalMeta(activeProposalId, {
      participantIds: nextIds,
      status: nextIds.length >= 4 ? "full" : "open",
    });
    await addDoc(collection(db, "propuestasPartido", activeProposalId, "chat"), {
      text: `${currentUserData?.nombreUsuario || currentUserData?.nombre || "Jugador"} se ha unido a la propuesta.`,
      senderUid: currentUser.uid,
      senderName: currentUserData?.nombreUsuario || currentUserData?.nombre || "Jugador",
      createdAt: serverTimestamp(),
      system: true,
    });
    showToast("Dentro", "Ya formas parte de la propuesta.", "success");
  } catch (e) {
    showToast("Error", "No se pudo unir a la propuesta.", "error");
  }
};

window.leaveProposalFromHome = async () => {
  if (!activeProposalId || !currentUser?.uid || !activeProposalMeta) return;
  const isOwner = activeProposalMeta.createdBy === currentUser.uid;
  const ids = Array.isArray(activeProposalMeta.participantIds) ? activeProposalMeta.participantIds.filter(Boolean) : [];
  try {
    if (isOwner) {
      // Owner closes the proposal entirely
      await persistProposalMeta(activeProposalId, { status: 'closed' });
      await addDoc(collection(db, 'propuestasPartido', activeProposalId, 'chat'), {
        text: `${currentUserData?.nombreUsuario || 'El organizador'} ha cerrado esta propuesta.`,
        senderUid: currentUser.uid,
        senderName: currentUserData?.nombreUsuario || 'Jugador',
        createdAt: serverTimestamp(),
        system: true,
      });
      showToast('Propuesta cerrada', 'Se ha archivado la propuesta.', 'info');
      closeProposalModal();
      cleanupProposalChat();
    } else {
      // Participant leaves the chat
      const nextIds = ids.filter(uid => uid !== currentUser.uid);
      await persistProposalMeta(activeProposalId, { participantIds: nextIds, status: 'open' });
      await addDoc(collection(db, 'propuestasPartido', activeProposalId, 'chat'), {
        text: `${currentUserData?.nombreUsuario || 'Jugador'} ha salido de la propuesta.`,
        senderUid: currentUser.uid,
        senderName: currentUserData?.nombreUsuario || 'Jugador',
        createdAt: serverTimestamp(),
        system: true,
      });
      showToast('Actualizado', 'Has salido de la propuesta.', 'success');
      window.renderProposalList();
    }
  } catch (e) {
    showToast('Error', 'No se pudo completar la acción.', 'error');
  }
};

window.reserveProposalFromHome = async () => {
  if (!activeProposalId || !activeProposalMeta) return;
  const draft = buildProposalDraftFromMeta(activeProposalMeta, activeProposalId);
  if (!saveProposalDraft(draft)) {
    showToast("Error", "No se pudo preparar la reserva.", "error");
    return;
  }
  closeProposalModal();
  window.location.href = `calendario.html?proposalId=${activeProposalId}`;
};

function renderProposalActionBar(meta = {}) {
  const host = document.getElementById("proposal-chat-actions");
  if (!host) return;
  const ids = Array.isArray(meta?.participantIds) ? meta.participantIds.filter(Boolean) : [];
  const isMine = ids.includes(currentUser?.uid);
  const canJoin = canCurrentUserJoinProposal(meta);

  // Auto-detect: if all participants already have a linked real match → suggest closing
  const linkedMatchExists = ids.length >= 2 && ids.every(uid =>
    allMatches.some(m => !isCancelledMatch(m) && !isFinishedMatch(m) && getNormalizedPlayers(m).includes(uid))
  );

  host.innerHTML = `
    <div class="proposal-action-grid">
      ${canJoin ? `<button type="button" class="hv2-inline-btn primary" onclick="window.joinProposalFromHome()"><i class="fas fa-user-plus"></i> Unirme</button>` : ""}
      ${isMine ? `<button type="button" class="hv2-inline-btn" onclick="window.reserveProposalFromHome()"><i class="fas fa-calendar-plus"></i> Fijar dia</button>` : ""}
      <button type="button" class="hv2-inline-btn" onclick="window.location.href='calendario.html'"><i class="fas fa-calendar-days"></i> Calendario</button>
      ${isMine ? `<button type="button" class="hv2-inline-btn danger" onclick="window.leaveProposalFromHome()" title="${meta?.createdBy === currentUser?.uid ? 'Cerrar propuesta' : 'Salir del chat'}"><i class="fas fa-door-open"></i> ${meta?.createdBy === currentUser?.uid ? 'Cerrar' : 'Salir'}</button>` : ""}
    </div>
    ${linkedMatchExists ? `<div style="background:rgba(0,212,255,0.08);border:1px solid rgba(0,212,255,0.3);border-radius:12px;padding:8px 12px;font-size:10px;font-weight:800;color:#00d4ff;text-align:center;margin-bottom:6px;"><i class="fas fa-circle-check"></i> ¡Los jugadores ya tienen partido vinculado! Puedes cerrar esta propuesta.</div>` : ''}
    <div class="proposal-member-row">${renderProposalMembers(meta)}</div>
  `;
}

window.openProposalDetail = async (pid) => {
  activeProposalId = pid;
  navigateProposalView("proposal-view-chat");
  const chatEl = document.getElementById("proposal-view-chat");
  if (!chatEl) return;
  chatEl.innerHTML = `
    <div class="flex-row items-center gap-3 p-3 bg-white/5 rounded-2xl mb-4 border border-white/10">
      <button class="btn btn-ghost sm" onclick="window.renderProposalList()" title="Volver a la lista"><i class="fas fa-arrow-left"></i></button>
      <div class="flex-col flex-1 truncate">
        <span id="proposal-chat-title" class="text-[12px] font-black uppercase truncate">...</span>
        <span id="proposal-chat-status" class="text-[9px] opacity-40 font-bold">...</span>
      </div>
      <button class="btn btn-ghost sm" onclick="window.leaveProposalFromHome ? window.leaveProposalFromHome() : (closeProposalModal && closeProposalModal())" title="Salir / Cerrar propuesta" style="color:#ef4444; border-color:rgba(239,68,68,0.3);">
        <i class="fas fa-xmark"></i>
      </button>
    </div>
    <div id="proposal-chat-actions" class="proposal-chat-actions"></div>
    <div id="proposal-messages" class="flex-1 overflow-y-auto pr-1 custom-scroll mb-4" style="min-height:260px; display:flex; flex-direction:column; gap:12px;"></div>
    <div class="flex-row gap-2 items-end bg-black/40 p-2 rounded-2xl border border-white/5">
      <textarea id="proposal-input" class="input flex-1" style="min-height:44px; max-height:120px; font-size:12px; padding:12px 16px; border:none; background:transparent;" placeholder="Escribe al grupo..."></textarea>
      <button class="btn btn-primary" id="btn-send-proposal" style="height:44px; width:44px; border-radius:18px; flex-shrink:0;">
        <i class="fas fa-paper-plane"></i>
      </button>
    </div>
  `;
  document.getElementById("btn-send-proposal")?.addEventListener("click", () => window.sendProposalMessage());
  document.getElementById("proposal-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      window.sendProposalMessage();
    }
  });
  cleanupProposalChat();
  activeProposalId = pid;
  proposalMetaUnsub = onSnapshot(doc(db, "propuestasPartido", pid), (snap) => {
    if (!snap.exists()) return;
    activeProposalMeta = { id: snap.id, ...snap.data() };
    const titleEl = document.getElementById("proposal-chat-title");
    const statusEl = document.getElementById("proposal-chat-status");
    if (titleEl) titleEl.textContent = activeProposalMeta.title || "Propuesta";
    if (statusEl) statusEl.textContent = `${(activeProposalMeta.participantIds || []).filter(Boolean).length}/4 JUGADORES · ${(activeProposalMeta.status || "abierta").toUpperCase()}`;
    renderProposalActionBar(activeProposalMeta);
  });
  proposalChatUnsub = onSnapshot(
    query(collection(db, "propuestasPartido", pid, "chat"), orderBy("createdAt", "asc"), limit(120)),
    (snap) => {
      const msgsEl = document.getElementById("proposal-messages");
      if (!msgsEl) return;
      const msgs = snap.docs.map((row) => ({ id: row.id, ...row.data() }));
      msgsEl.innerHTML = msgs.map((m) => {
        const isMe = m.senderUid === currentUser?.uid;
        const time = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
        return `
          <div class="msg-bubble-wrap ${isMe ? "is-me" : ""} ${m.system ? "is-system" : ""}">
            ${!isMe ? `<span class="msg-sender">${escapeHtml(m.senderName || "Jugador")}</span>` : ""}
            <div class="msg-bubble"><p>${escapeHtml(m.text || "")}</p><span class="msg-time">${time}</span></div>
          </div>
        `;
      }).join("") || `<div class="proposal-empty-copy">Todavia no hay mensajes.</div>`;
      msgsEl.scrollTop = msgsEl.scrollHeight;
    },
  );
};

window.sendProposalMessage = async () => {
  const input = document.getElementById("proposal-input");
  const text = String(input?.value || "").trim();
  if (!text || !activeProposalId || !currentUser?.uid) return;
  input.value = "";
  try {
    await addDoc(collection(db, "propuestasPartido", activeProposalId, "chat"), {
      text,
      senderUid: currentUser.uid,
      senderName: currentUserData?.nombreUsuario || currentUserData?.nombre || "Jugador",
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, "propuestasPartido", activeProposalId), { updatedAt: serverTimestamp() }, { merge: true });
  } catch (e) {
    showToast("Error", "No se pudo enviar el mensaje.", "error");
  }
};

function ensureProposalModal() {
  if (document.getElementById("proposal-modal")) return;
  proposalInlineMode = false;
  const wrapper = document.createElement("div");
  wrapper.id = "proposal-modal";
  wrapper.className = "modal-overlay";
  wrapper.innerHTML = `
    <div class="modal-card glass-strong" style="max-width:min(94vw,720px); display:flex; flex-direction:column; height:min(90dvh,720px);">
      <div class="modal-header" style="flex-shrink:0;">
        <div style="display:flex;flex-direction:column;gap:2px;">
          <h3 class="modal-title" style="font-size:13px;"><i class="fas fa-comments" style="color:var(--primary);margin-right:6px;"></i>Propuestas de partido</h3>
          <span style="font-size:10px;color:rgba(255,255,255,0.4);font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">Invita, chatea y reserva el dia del partido</span>
        </div>
        <button class="close-btn" id="proposal-close-btn" style="flex-shrink:0;">&times;</button>
      </div>
      <div class="modal-body" id="proposal-modal-body" style="flex:1;overflow-y:auto;overflow-x:hidden;padding:14px;display:flex;flex-direction:column;gap:10px;">
        <div id="proposal-view-list" class="flex-col gap-3"></div>
        <div id="proposal-view-create" class="flex-col gap-3 hidden"></div>
        <div id="proposal-view-chat" style="flex:1;display:flex;flex-direction:column;gap:8px;" class="hidden"></div>
      </div>
    </div>
  `;
  wrapper.addEventListener("click", (e) => {
    if (e.target === wrapper) {
      closeProposalModal();
      cleanupProposalChat();
    }
  });
  document.body.appendChild(wrapper);
  wrapper.querySelector("#proposal-close-btn")?.addEventListener("click", () => {
    closeProposalModal();
    cleanupProposalChat();
  });
}

function initProposeMatch() {
  preloadProposalUsers();
  ensureProposalModal();
}

window.openProposeMatchChat = () => {
  ensureProposalModal();
  preloadProposalUsers();
  document.getElementById("proposal-modal")?.classList.add("active");
  window.renderProposalList();
};

function navigateProposalView(view) {
  const ids = ["proposal-view-list", "proposal-view-create", "proposal-view-chat"];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === view) {
      el.style.display = "flex";
      el.classList.remove("hidden");
    } else {
      el.style.display = "none";
      el.classList.add("hidden");
    }
  });
}

function renderNextMatch() {
  const box = document.getElementById("next-match-box");
  if (!box) return;
  const now = Date.now();
  const pendingResult = getPendingResultMatches();
  const mine = allMatches
    .filter((m) => isMatchRelevantToMe(m))
    .filter((m) => !isEventKnockoutLocked(m))
    .filter((m) => !isCancelledMatch(m) && !isFinishedMatch(m))
    .filter((m) => {
      const d = toDateSafe(m.fecha);
      return d && d.getTime() >= now - 10 * 60 * 1000;
    })
    .sort((a, b) => (toDateSafe(a.fecha)?.getTime() || 0) - (toDateSafe(b.fecha)?.getTime() || 0));
  const next = mine[0];
  if (!next) {
    // Collect Apoing-style bookings (my upcoming calendar matches that are not yet confirmed/real)
    const apoingBookings = allMatches
      .filter(m => isMatchRelevantToMe(m) && !isFinishedMatch(m) && !isCancelledMatch(m))
      .filter(m => {
        const d = toDateSafe(m.fecha);
        return d && d.getTime() >= Date.now();
      })
      .sort((a, b) => (toDateSafe(a.fecha)?.getTime() || 0) - (toDateSafe(b.fecha)?.getTime() || 0))
      .slice(0, 3);

    const apoingHTML = apoingBookings.length ? `
      <div style="margin-top:14px; width:100%;">
        <div style="font-size:9px; font-weight:900; letter-spacing:2px; color:rgba(255,255,255,0.4); text-transform:uppercase; margin-bottom:8px; text-align:left;"><i class="fas fa-bookmark" style="color:var(--primary);"></i> RESERVAS APOING</div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          ${apoingBookings.map(m => {
            const d = toDateSafe(m.fecha);
            const players = getNormalizedPlayers(m).filter(Boolean);
            const dateStr = d ? d.toLocaleDateString('es-ES', { weekday:'short', day:'numeric', month:'short' }).toUpperCase() : '??';
            const timeStr = d ? d.toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' }) : '';
            const pStr = players.map(uid => getPlayerDisplayName(uid).split(' ')[0]).join(' · ') || 'Sin jugadores';
            return `<div style="display:flex; align-items:center; justify-content:space-between; background:rgba(0,212,255,0.06); border:1px solid rgba(0,212,255,0.15); border-radius:12px; padding:8px 12px;">
              <div style="display:flex; flex-direction:column; gap:1px;">
                <span style="font-size:10px; font-weight:900; color:#fff;">${dateStr} · ${timeStr}</span>
                <span style="font-size:9px; color:rgba(255,255,255,0.5); font-weight:700;">${pStr}</span>
              </div>
              <i class="fas fa-chevron-right" style="font-size:10px; color:var(--primary); opacity:0.5;"></i>
            </div>`;
          }).join('')}
        </div>
      </div>` : '';

    box.innerHTML = `
      <div class="hv2-no-match hv2-no-match-rich premium-v2">
        <div class="hv2-no-match-main flex-col items-center justify-center p-4">
          <div class="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mb-3">
             <i class="fas fa-calendar-xmark text-3xl text-primary drop-shadow-[0_0_8px_rgba(184,255,0,0.5)]"></i>
          </div>
          <div class="text-center w-full">
            <strong class="block text-white text-lg font-black tracking-wide mb-1">Cancha libre</strong>
            <span class="block text-white/60 text-xs px-4 mb-4">Sin partido inmediato. Propón uno rápido o crea uno en el calendario.</span>
          </div>
          
          <div class="w-full flex-col gap-2">
            <div class="flex-row gap-2 w-full">
              <button type="button" class="flex-1 btn-premium-v7 shadow flex items-center justify-center gap-2 py-3 drop-shadow-[0_5px_15px_rgba(184,255,0,0.2)]" onclick="window.openProposeMatchChat()">
                <i class="fas fa-comments text-base"></i> <span class="font-black tracking-widest text-[11px]">PROPONER</span>
              </button>
              <button type="button" class="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-black text-[11px] uppercase tracking-widest border-2 border-primary/40 text-primary bg-primary/10 hover:bg-primary/20 transition-all" onclick="window.location.href='calendario.html'" style="border-radius:16px;">
                <i class="fas fa-plus-circle text-base"></i> CREAR
              </button>
            </div>
            <div class="flex-row gap-2 mt-1 w-full">
               <button type="button" class="flex-1 text-center bg-white/10 hover:bg-white/20 text-white rounded-xl text-[10px] font-black uppercase tracking-widest px-2 py-2 border border-white/20 transition-all duration-300" onclick="window.location.href='calendario.html'">
                 <i class="fas fa-calendar-days text-primary mr-1"></i> CALENDARIO
               </button>
               ${pendingResult.length ? `
                 <button type="button" class="flex-1 text-center bg-red-500/20 hover:bg-red-500/40 text-white rounded-xl text-[10px] font-black uppercase tracking-widest px-2 py-2 border border-red-500/30 transition-all duration-300" onclick="window.location.href='calendario.html'">
                  <i class="fas fa-pen text-red-400 mr-1"></i> ANOTAR PTS
                 </button>
               ` : `
                 <button type="button" class="flex-1 text-center bg-white/10 hover:bg-white/20 text-white rounded-xl text-[10px] font-black uppercase tracking-widest px-2 py-2 border border-white/20 transition-all duration-300" onclick="window.openPosterHub()">
                  <i class="fas fa-image text-white mr-1"></i> POSTERS
                 </button>
               `}
            </div>
            ${apoingHTML}
          </div>
        </div>
      </div>
    `;
    return;
  }
  const date = toDateSafe(next.fecha);
  const players = [...getNormalizedPlayers(next)];
  while (players.length < 4) players.push(null);
  const isEvent = isEventMatch(next);
  const isReto = String(next.col || "").includes("Reto");
  const freeSlots = isEvent ? 0 : players.filter((p) => !p).length;
  const tempVal = weather?.current ? Math.round(weather.current.temperature_2m || 0) : null;
  const temp = tempVal !== null ? `${tempVal}°` : "--";
  let wIcon = "fa-sun";
  let wColor = "#fbbf24";
  const wCode = weather?.current?.weather_code || 0;
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
  const diffMs = date.getTime() - Date.now();
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffH / 24);
  const countdown = diffH < 1 ? "AHORA" : diffH < 24 ? `EN ${diffH}H` : `EN ${diffD}D`;
  const pName = (uid, team) => {
    const name = getPlayerDisplayName(uid);
    const short = name.split(" ")[0] || "Tu";
    const cls = !uid ? "empty" : uid === currentUser?.uid ? "is-me" : team === "a" ? "is-team-a" : "is-team-b";
    return `<span class="hv2-sb-player-name ${cls}">${uid ? short : "LIBRE"}</span>`;
  };
  box.innerHTML = `
    <div class="hv2-scoreboard" onclick="window.openMatch('${next.id}','${next.col}')">
      <div class="hv2-court-bg"></div>
      <div class="hv2-sb-header">
        <span class="hv2-sb-type">${isEvent ? "EVENTO" : isReto ? "LIGA RETO" : "AMISTOSO"}</span>
        <span class="hv2-sb-countdown">${countdown}</span>
        <div class="hv2-sb-meta">
          <span class="hv2-sb-meta-item"><i class="fas fa-clock"></i> ${date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>
          <span class="hv2-sb-meta-item"><i class="fas fa-calendar"></i> ${date.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}</span>
          <span class="hv2-sb-meta-item"><i class="fas fa-thermometer-half"></i> ${temp}</span>
          <span class="hv2-sb-meta-item" style="color:${wColor}"><i class="fas ${wIcon}"></i></span>
        </div>
      </div>
      <div class="hv2-sb-court">
        <div class="hv2-sb-team team-a">
          <div class="hv2-sb-player">${pName(players[0], "a")}</div>
          <div class="hv2-sb-player">${pName(players[1], "a")}</div>
        </div>
        <div class="hv2-sb-vs">
          <span class="hv2-sb-vs-line"></span>
          <span class="hv2-sb-vs-text">VS</span>
          <span class="hv2-sb-vs-line"></span>
        </div>
        <div class="hv2-sb-team team-b">
          <div class="hv2-sb-player">${pName(players[2], "b")}</div>
          <div class="hv2-sb-player">${pName(players[3], "b")}</div>
        </div>
      </div>
      ${pendingResult.length ? `<div class="hv2-sb-alert"><i class="fas fa-circle-exclamation"></i><span>No has incluido el resultado aun de ${pendingResult.length} partido${pendingResult.length === 1 ? "" : "s"} anterior${pendingResult.length === 1 ? "" : "es"}.</span><button type="button" class="hv2-inline-btn compact" onclick="event.stopPropagation(); window.location.href='calendario.html'">Anadir resultado</button></div>` : ""}
      <div class="hv2-sb-footer">
        <span class="hv2-sb-slots ${freeSlots > 0 ? "has-slots" : "full"}">${isEvent ? (next.phase ? String(next.phase).toUpperCase() : "EVENTO") : (freeSlots > 0 ? `${freeSlots} plaza${freeSlots === 1 ? "" : "s"} libre${freeSlots === 1 ? "" : "s"}` : "COMPLETO")}</span>
        <div class="hv2-sb-footer-actions">
          <button type="button" class="hv2-inline-btn compact" onclick="event.stopPropagation(); window.openPosterHub()"><i class="fas fa-download"></i> Cartel</button>
          <span class="hv2-sb-action">VER PARTIDO <i class="fas fa-chevron-right"></i></span>
        </div>
      </div>
    </div>
  `;
  maybeCreateEventDayNotice();
}

renderNextMatch = function renderNextMatchRefined() {
  const box = document.getElementById("next-match-box");
  if (!box) return;
  const now = Date.now();
  const pendingResult = getPendingResultMatches();
  const mine = allMatches
    .filter((m) => isMatchRelevantToMe(m))
    .filter((m) => !isEventKnockoutLocked(m))
    .filter((m) => !isCancelledMatch(m) && !isFinishedMatch(m))
    .filter((m) => {
      const d = toDateSafe(m.fecha);
      return d && d.getTime() >= now - 10 * 60 * 1000;
    })
    .sort((a, b) => (toDateSafe(a.fecha)?.getTime() || 0) - (toDateSafe(b.fecha)?.getTime() || 0));
  const next = mine[0];
  if (!next) {
    box.innerHTML = `
      <div class="hv2-scoreboard compact-poster hv2-scoreboard-empty">
        <div class="hv2-court-bg"></div>
        <div class="hv2-sb-header">
          <span class="hv2-sb-type">SIN PARTIDO</span>
          <span class="hv2-sb-countdown">LISTO</span>
        </div>
        <div class="hv2-scoreboard-empty-body">
          <div class="hv2-scoreboard-empty-copy">
            <strong>Tu próximo cartel aún está vacío</strong>
            <span>Ve al calendario para revisar huecos, reservas de Apoing o montar un partido rápido 2vs2.</span>
          </div>
          <div class="hv2-scoreboard-empty-actions">
            <button type="button" class="hv2-inline-btn compact" onclick="window.location.href='calendario.html'">
              <i class="fas fa-calendar-days"></i> Calendario
            </button>
            <button type="button" class="hv2-inline-btn compact" onclick="window.location.href='calendario.html'">
              <i class="fas fa-plus"></i> Crear rápido
            </button>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const date = toDateSafe(next.fecha);
  const players = [...getNormalizedPlayers(next)];
  while (players.length < 4) players.push(null);
  const isEvent = isEventMatch(next);
  const isReto = String(next.col || "").includes("Reto");
  const freeSlots = isEvent ? 0 : players.filter((p) => !p).length;
  const avgLevel = getAverageLevelFromPlayers(players.filter(Boolean));
  const weatherBadge = getWeatherBadgeForDate(next.fecha);
  const apoingReservation = apoingEvents
    .filter((ev) => String(ev?.sourceUid || "") === String(currentUser?.uid || ""))
    .filter((ev) => ev?.dtStart && Math.abs(ev.dtStart.getTime() - date.getTime()) <= 90 * 60 * 1000)
    .sort((a, b) => a.dtStart - b.dtStart)[0] || null;
  const diffMs = date.getTime() - Date.now();
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffH / 24);
  const countdown = diffH < 1 ? "AHORA" : diffH < 24 ? `EN ${diffH}H` : `EN ${diffD}D`;
  const dateBits = formatCompactMatchDate(next.fecha);
  const pName = (uid, team) => {
    const name = getPlayerDisplayName(uid);
    const short = name.split(" ")[0] || "Tu";
    const cls = !uid ? "empty" : uid === currentUser?.uid ? "is-me" : team === "a" ? "is-team-a" : "is-team-b";
    return `<span class="hv2-sb-player-name ${cls}">${uid ? short : "LIBRE"}</span>`;
  };

  box.innerHTML = `
    <div class="hv2-scoreboard compact-poster" onclick="window.openMatch('${next.id}','${next.col}')">
      <div class="hv2-court-bg"></div>
      <div class="hv2-sb-header">
        <span class="hv2-sb-type">${isEvent ? "EVENTO" : isReto ? "LIGA RETO" : "AMISTOSO"}</span>
        <span class="hv2-sb-countdown">${countdown}</span>
        <div class="hv2-sb-meta">
          <span class="hv2-sb-meta-item"><i class="fas fa-clock"></i> ${dateBits.time}</span>
          <span class="hv2-sb-meta-item"><i class="fas fa-calendar"></i> ${dateBits.weekday} ${dateBits.day} ${dateBits.month}</span>
          <span class="hv2-sb-meta-item"><i class="fas ${weatherBadge.icon}"></i> ${weatherBadge.temp}</span>
        </div>
      </div>
      <div class="hv2-sb-mini-calendar">
        <span>${dateBits.weekday}</span>
        <strong>${dateBits.day}</strong>
        <small>${dateBits.month}</small>
      </div>
      <div class="hv2-sb-court">
        <div class="hv2-sb-team team-a">
          <div class="hv2-sb-player">${pName(players[0], "a")}</div>
          <div class="hv2-sb-player">${pName(players[1], "a")}</div>
        </div>
        <div class="hv2-sb-vs">
          <span class="hv2-sb-vs-line"></span>
          <span class="hv2-sb-vs-text">VS</span>
          <span class="hv2-sb-vs-line"></span>
        </div>
        <div class="hv2-sb-team team-b">
          <div class="hv2-sb-player">${pName(players[2], "b")}</div>
          <div class="hv2-sb-player">${pName(players[3], "b")}</div>
        </div>
      </div>
      <div class="hv2-sb-insights">
        <span><i class="fas fa-layer-group"></i> Nivel medio ${avgLevel ? avgLevel.toFixed(2) : "--"}</span>
        <span><i class="fas fa-user-plus"></i> ${freeSlots > 0 ? `${freeSlots} pendiente${freeSlots > 1 ? "s" : ""}` : "Cuadro completo"}</span>
        <span><i class="fas ${weatherBadge.icon}"></i> ${weatherBadge.label} · ${weatherBadge.note}</span>
      </div>
      ${pendingResult.length ? `<div class="hv2-sb-alert"><i class="fas fa-circle-exclamation"></i><span>Tienes ${pendingResult.length} partido${pendingResult.length === 1 ? "" : "s"} anterior${pendingResult.length === 1 ? "" : "es"} pendiente${pendingResult.length === 1 ? "" : "s"} de cerrar.</span><button type="button" class="hv2-inline-btn compact" onclick="event.stopPropagation(); window.location.href='calendario.html'">Añadir resultado</button></div>` : ""}
      <div class="hv2-sb-footer">
        <span class="hv2-sb-slots ${freeSlots > 0 ? "has-slots" : "full"}">${isEvent ? (next.phase ? String(next.phase).toUpperCase() : "EVENTO") : (freeSlots > 0 ? `${freeSlots} plaza${freeSlots === 1 ? "" : "s"} libre${freeSlots === 1 ? "" : "s"}` : "COMPLETO")}</span>
        <div class="hv2-sb-footer-actions">
          <button type="button" class="hv2-inline-btn compact" onclick="event.stopPropagation(); window.openPosterHub()"><i class="fas fa-download"></i> Cartel</button>
          <span class="hv2-sb-action">VER PARTIDO <i class="fas fa-chevron-right"></i></span>
        </div>
      </div>
    </div>
  `;
};

window.openFeaturedEventDetail = () => {
  const preferredEvent =
    (myEvents || []).find((eventRow) => eventRow?.id) ||
    dedupeEventLinkedMatches(allMatches).find((match) => match?.eventoId)?.eventoId ||
    null;
  const eventId = typeof preferredEvent === "string" ? preferredEvent : preferredEvent?.id || null;
  if (eventId) {
    window.location.href = `evento-detalle.html?id=${encodeURIComponent(eventId)}`;
    return;
  }
  window.location.href = "eventos.html";
};
