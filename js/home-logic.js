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
import { createNotification, initAutoNotifications } from "./services/notification-service.js";
import { requestNotificationPermission } from "./modules/push-notifications.js";

let currentUser = null;
let userData = null;
let allMatches = [];

/* DUPLICATE WELCOME_PHRASES DISABLED (cleaned) */

function calculateBasePoints(level) {
  const l = parseFloat(level) || 2.5;
  const pts = Math.round(1000 + (l - 2.5) * 400);
  console.log(`Calculando puntos base para nivel ${l}: ${pts}`);
  return pts;
}

// Real Online Count Logic - Only counts users active in the last 15 minutes
async function injectOnlineCount() {
  try {
    const threshold = new Date(Date.now() - 15 * 60 * 1000);
    const q = query(
      collection(db, "usuarios"),
      where("ultimoAcceso", ">", threshold),
      limit(100),
    );
    const snap = await window.getDocsSafe(q);
    const onlineCount = snap.size || 1;

    const el = document.getElementById("online-count-display");
    const elLibrary = document.getElementById("online-count-library");
    if (el) {
      el.innerHTML = `${onlineCount} JUGADORES ONLINE`;
      el.style.cursor = "pointer";
      el.onclick = () => window.showOnlineUsers();
    }
    if (elLibrary) {
      elLibrary.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-sport-green animate-pulse"></span> ${onlineCount} ONLINE`;
    }
    const elNext = document.getElementById("online-count-next");
    if (elNext) {
      elNext.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-sport-green animate-pulse"></span> <span class="val">${onlineCount} ONLINE</span>`;
      elNext.classList.remove("hidden");
    }
  } catch (e) {
    console.error("Error detecting online players:", e);
  }
}

// Show Online Users Modal (Elite Rebirth v7.0)
window.showOnlineUsers = async () => {
  const threshold = new Date(Date.now() - 15 * 60 * 1000);
  const q = query(
    collection(db, "usuarios"),
    where("ultimoAcceso", ">", threshold),
    limit(50),
  );
  const snap = await window.getDocsSafe(q);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay active";
  overlay.style.backdropFilter = "blur(12px) saturate(180%)";
  overlay.innerHTML = `
        <div class="modal-card animate-up" style="background: rgba(10, 10, 15, 0.85); border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 0 50px rgba(0,0,0,0.8);">
            <!-- Glass Header -->
            <div class="modal-header" style="border-bottom: 1px solid rgba(255,255,255,0.05); padding: 20px;">
                <div class="flex-col">
                    <div class="flex-row items-center gap-2 mb-1">
                        <div class="pulse-dot-green"></div>
                        <h3 class="modal-title font-black italic text-white tracking-widest">SALA DE JUGADORES</h3>
                    </div>
                    <span class="text-[10px] text-muted font-bold tracking-[0.2em] uppercase">${snap.size} OPERATIVOS EN LÍNEA</span>
                </div>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <div class="modal-body custom-scroll" style="padding: 15px; max-height: 70vh;">
                <div class="flex-col gap-3">
                    ${snap.docs
                      .map((d) => {
                        const u = d.data();
                        const photo =
                          u.fotoPerfil ||
                          u.fotoURL ||
                          "./imagenes/default-avatar.png";
                        const isMe =
                          u.uid === currentUser?.uid ||
                          d.id === currentUser?.uid;
                        const lvl = Number(u.nivel || 2.5).toFixed(1);

                        return `
                            <div class="flex-row items-center gap-4 p-3 rounded-2xl bg-white/5 border border-white/5 hover:bg-white/10 hover:border-primary/30 transition-all cursor-pointer group ${isMe ? "bg-primary/10 border-primary/20" : ""}" 
                                 onclick="window.viewProfile('${u.uid || d.id}')">
                                
                                <div class="relative flex-shrink-0">
                                    <img src="${photo}" class="w-12 h-12 rounded-full object-cover border-2 ${isMe ? "border-primary shadow-glow-sm" : "border-white/10"}">
                                    <div class="absolute bottom-0 right-0 w-3 h-3 bg-sport-green rounded-full border-2 border-[#0a0a0f] shadow-glow"></div>
                                </div>

                                <div class="flex-col flex-1">
                                    <span class="text-[14px] font-black text-white italic uppercase tracking-tighter ${isMe ? "text-primary" : ""}">
                                        ${u.nombreUsuario || u.nombre || "Jugador"} ${isMe ? '<span class="text-[10px] opacity-70 ml-1">(T)</span>' : ""}
                                    </span>
                                    <div class="flex-row items-center gap-2">
                                        <div class="flex-row items-center gap-1 bg-black/40 px-2 py-0.5 rounded-md border border-white/5">
                                            <span class="text-[8px] text-muted font-black">NV</span>
                                            <span class="text-[10px] text-primary font-black">${lvl}</span>
                                        </div>
                                        <span class="text-[9px] text-muted font-black uppercase tracking-widest opacity-60">${u.rol || "Jugador"}</span>
                                    </div>
                                </div>

                                <i class="fas fa-chevron-right text-[10px] text-muted group-hover:text-primary transition-transform group-hover:translate-x-1"></i>
                            </div>
                        `;
                      })
                      .join("")}
                    ${snap.empty ? '<div class="text-center text-xs text-muted py-10 font-bold uppercase tracking-widest opacity-30">Silencio absoluto en la Matrix...</div>' : ""}
                </div>
            </div>

            <div class="modal-footer" style="padding: 15px; border-top: 1px solid rgba(255,255,255,0.05); text-align: center;">
                <span class="text-[9px] text-muted font-bold italic opacity-60 uppercase tracking-widest">Toca un jugador para ver su perfil estelar</span>
            </div>
        </div>
    `;

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
};

document.addEventListener("DOMContentLoaded", () => {
  initAppUI("home");
  injectOnlineCount();

  observerAuth(async (user) => {
    if (!user) {
      window.location.href = "index.html";
      return;
    }

    // Register SW when document is stable
    // Robust Service Worker Registration for VS Code Preview & Production
    if ("serviceWorker" in navigator) {
      // Skip if inside restricted environment
      if (
        window.location.protocol === "vscode-webview:" ||
        window.location.href.includes("vscode-")
      ) {
        console.log("Skipping SW registration in preview environment.");
      } else {
        navigator.serviceWorker.register("./sw.js").catch((err) => {
          if (err.name === "AbortError" || err.message.includes("shutdown")) {
            console.warn(
              "SW registration aborted (likely due to environment shutdown)",
            );
          } else if (err.name !== "InvalidStateError") {
            console.error("SW Error:", err);
          }
        });
      }
    }

    const { showLoading, hideLoading, injectHeader, injectNavbar } =
      await import("./modules/ui-loader.js?v=6.5");

    // Only show loader if initial_load_done is not set to 'true'
    const isFirstLoad = !sessionStorage.getItem("initial_load_done");
    if (isFirstLoad) showLoading("Sincronizando con la Galaxia...");

    currentUser = user;

    // Update presence on every load
    const { updatePresence } = await import("./firebase-service.js");
    updatePresence(user.uid);
    setInterval(() => updatePresence(user.uid), 60000); 

    // Init Auto Notifications System (V7.0) - Unified Service
    initAutoNotifications(user.uid);

    // Listen to user data changes
    subscribeDoc("usuarios", user.uid, async (data) => {
      if (data) {
        currentUser = user;
        userData = data;
        updateDashboard(data);
        initMatrixFeed();
        renderHallOfFame(data);

        // Personalized welcome toast after spectacular loader
        const welcomeName = localStorage.getItem("first_login_welcome");
        if (welcomeName) {
          setTimeout(() => {
            showToast(
              `¡BIENVENIDO, ${welcomeName.toUpperCase()}!`,
              "Tu panel de control está listo. ¡A dominar la pista!",
              "success",
            );
            localStorage.removeItem("first_login_welcome");
          }, 1000);
        }

        // Ensure header is updated with role/info
        injectHeader(data);
        injectNavbar("home");
      }
    });

    await loadMatches();
    // Reduced home payload: move weather/insights to AI chat
    requestNotificationPermission();

    // Dynamic Welcome Toast
    setTimeout(() => {
      const hour = new Date().getHours();
      let greet = "¡Buenos días!";
      if (hour >= 14 && hour < 21) greet = "¡Buenas tardes!";
      else if (hour >= 21 || hour < 5) greet = "¡Buenas noches!";

      const name = (
        userData?.nombreUsuario ||
        user.displayName ||
        "Jugador"
      ).split(" ")[0];
      const phrase =
        userData?.aiProfile?.funPhrase ||
        "¡A dominar la pista!";
      showToast(greet, `${name}, ${phrase}`, "success");
    }, 1000);

    // Initial Orchestrator Sync (Phase 5)
    import('./ai-orchestrator.js').then(m => m.AIOrchestrator.init(user.uid));

    if (isFirstLoad) setTimeout(hideLoading, 1500);
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
  let greet = "¡BUENOS DÍAS!";
  if (hour >= 14 && hour < 21) greet = "¡BUENAS TARDES!";
  else if (hour >= 21 || hour < 5) greet = "¡BUENAS NOCHES!";

  const userNameEl = document.getElementById("user-name");
  const greetingEl = document.getElementById("greeting-text");

  if (userNameEl)
    userNameEl.textContent = (
      data.nombreUsuario ||
      data.nombre ||
      "JUGADOR"
    ).toUpperCase();
  if (greetingEl) greetingEl.textContent = greet;

  // Stats
  const wins = Number(data.victorias || 0);
  const played = Number(data.partidosJugados || 0);
  const levelNum = Number(data.nivel || 2.5);
  const level = levelNum.toFixed(1);
  const winrate = played > 0 ? Math.round((wins / played) * 100) : 0;

  // Points & Rank Status
  const currentPts =
    data.puntosRanking !== undefined
      ? Number(data.puntosRanking)
      : Number(calculateBasePoints(data.nivel));
  const ptsEl = document.getElementById("stat-pts");
  const winsEl = document.getElementById("stat-wins");
  const matchesEl = document.getElementById("stat-matches");
  const wrEl = document.getElementById("stat-winrate");
  const lvlEl = document.getElementById("stat-level");

  if (ptsEl) countUp(ptsEl, Number(currentPts));
  if (winsEl) winsEl.textContent = wins;
  if (matchesEl) matchesEl.textContent = played;
  if (wrEl) wrEl.textContent = `${winrate}%`;
  if (lvlEl) lvlEl.textContent = level;

  // Level Progress (Home) - Optimized V9.0
  const lvlNum = levelNum || 2.5;
  const currentBracket = Math.floor(lvlNum * 2) / 2;
  const nextBracket = currentBracket + 0.5;
  const prevBracket = Math.max(1, currentBracket - 0.5);
  const progress = ((lvlNum - currentBracket) / 0.5) * 100;
  
  // Points logic: 1.00 nivel = 400 pts, siguiente paso cada 0.01 (4 pts)
  const pointsSinceBracket = Math.round((lvlNum - currentBracket) * 800);
  const pointsToPrev = pointsSinceBracket;
  const nextStep = Math.round(lvlNum * 100) / 100 + 0.01;
  const pointsToNext = Math.max(0, Math.ceil((nextStep - lvlNum) * 400));

  const homeBar = document.getElementById("home-level-bar");
  const homePts = document.getElementById("home-level-points");
  const homeLower = document.getElementById("home-level-lower");
  const homeCurrent = document.getElementById("home-level-current");
  const homeUpper = document.getElementById("home-level-upper");

  if (homeBar) homeBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
  if (homePts)
    homePts.innerHTML = `<span class="text-primary font-black">+${pointsToNext} PTS</span> <span class="opacity-30">|</span> <span class="text-orange-400 font-black">-${pointsToPrev} PTS</span>`;
  if (homeLower) homeLower.textContent = currentBracket.toFixed(1);
  if (homeCurrent) homeCurrent.textContent = `NIVEL ${lvlNum.toFixed(2)}`;
  if (homeUpper) homeUpper.textContent = nextBracket.toFixed(1);

  // Get rank
  window.getDocsSafe(
    query(
      collection(db, "usuarios"),
      orderBy("puntosRanking", "desc"),
      limit(100),
    ),
  ).then((snap) => {
    const rank = snap.docs.findIndex((d) => d.id === currentUser.uid) + 1;
    const rankEl = document.getElementById("user-rank");
    if (rankEl) {
      rankEl.textContent = rank > 0 ? `#${rank}` : "-";
      rankEl.classList.add("text-primary");
    }
  });

  // XP & Achievements
  if (typeof renderXpWidget === "function")
    renderXpWidget("xp-widget-container", data);
  if (typeof renderAchievements === "function")
    renderAchievements("achievements-list", data);

  // Family Points
  const famPtsEl = document.getElementById("user-family-pts");
  if (famPtsEl) countUp(famPtsEl, data.familyPoints || 0);

  const aiBox = document.getElementById("ai-welcome-msg");
  if (aiBox) {
    const quoteEl = aiBox.querySelector(".ai-quote");
    const nameBrief = (data.nombreUsuario || "Jugador").split(" ")[0];

    const hour = new Date().getHours();
    let intro = "Buenos días";
    if (hour >= 14 && hour < 21) intro = "Buenas tardes";
    else if (hour >= 21 || hour < 5) intro = "Buenas noches";

    const tip = "Soy Vecina AP. Analizando tu potencial galáctico...";
    if (quoteEl) quoteEl.textContent = `¡${intro} ${nameBrief}! ${tip}`;

    aiBox.onclick = async () => {
      const { initVecinaChat, toggleChat } =
        await import("./modules/ui-loader.js?v=6.5");
      // Vecina Chat is actually initialized in ui-loader
      const fab = document.querySelector(".ai-fab");
      if (fab) fab.click();
    };
  }

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
                <span class="text-xs text-muted">Prepárate para el reto</span>
            `;
      tipBox.onclick = () =>
        showToast("Táctica", `Enfócate en tu juego hoy.`, "info");
    } else {
      tipBox.innerHTML = `
                <i class="fas fa-calendar-star text-xl text-primary mb-1"></i>
                <span class="font-bold text-xs text-white uppercase">EVENTOS</span>
                <span class="text-xs text-muted">Ver próximos eventos</span>
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
  const myNext = list.find((m) => m.jugadores?.includes(currentUser.uid));

  renderNextMatch(myNext);
  renderMatchFeed("all");
}

async function renderNextMatch(match) {
  const container = document.getElementById("next-match-container");
  if (!container) return;

  if (!match) {
    container.innerHTML = `
            <div class="empty-state-card-v7 animate-up">
                <div class="empty-icon-v7">
                    <i class="fas fa-calendar-plus text-primary"></i>
                </div>
                <div class="flex-col center">
                    <span class="empty-title-v7 italic">AGENDA LIBRE</span>
                    <span class="empty-desc-v7">No tienes despliegues activos en la Matrix.</span>
                    <button class="btn-booking-v7 mt-6" onclick="window.location.href='calendario.html'">
                        RESERVAR PISTA <i class="fas fa-chevron-right ml-2 text-[8px]"></i>
                    </button>
                </div>
            </div>
        `;
    return;
  }

  const date = match.fecha.toDate
    ? match.fecha.toDate()
    : new Date(match.fecha);
  const players = await Promise.all(
    (match.jugadores || []).map(async (uid) => {
      if (!uid) return "Libre";
      return await getPlayerName(uid);
    }),
  );

  while (players.length < 4) players.push("Libre");

  const creator = await getPlayerName(match.creador);
  const isFull = (match.jugadores || []).filter(id => id).length >= 4;

  container.innerHTML = `
        <div class="next-match-card-premium-v7 animate-up" onclick="openMatch('${match.id}', '${match.col}')">
            <div class="nm-glass-overlay"></div>
            
            <div class="nm-header-v7 flex-row between items-center mb-6">
                <div class="flex-col">
                    <div class="flex-row items-baseline gap-2">
                         <span class="text-4xl font-black text-white italic tracking-tighter">${date.getHours()}:${date.getMinutes().toString().padStart(2, "0")}</span>
                         <span class="text-[12px] font-black text-primary uppercase tracking-[2px]">HRS</span>
                    </div>
                    <span class="text-[11px] font-black text-white/50 uppercase tracking-[4px] mt-1">${date.toLocaleDateString("es-ES", { weekday: "long", day: "numeric" })}</span>
                </div>
                
                <div class="nm-badge-pro-v7 ${match.isComp ? "reto" : "amistoso"}">
                    <i class="fas ${match.isComp ? "fa-bolt" : "fa-handshake"}"></i>
                    <span>${match.isComp ? "RETO ELO" : "AMISTOSO"}</span>
                </div>
            </div>

            <div class="nm-court-simplified mb-6">
                <div class="flex-row between items-center relative gap-4">
                    <div class="team-side flex-1 flex-col gap-2">
                        <div class="p-chip-elite ${match.jugadores[0] ? "filled" : "empty"}">${players[0].toUpperCase()}</div>
                        <div class="p-chip-elite ${match.jugadores[1] ? "filled" : "empty"}">${players[1].toUpperCase()}</div>
                    </div>
                    
                    <div class="vs-divider-mini">VS</div>
                    
                    <div class="team-side flex-1 flex-col gap-2">
                        <div class="p-chip-elite ${match.jugadores[2] ? "filled" : "empty"}">${players[2].toUpperCase()}</div>
                        <div class="p-chip-elite ${match.jugadores[3] ? "filled" : "empty"}">${players[3].toUpperCase()}</div>
                    </div>
                </div>
            </div>

            <!-- PREDICTION COMPONENT (PHASE 3.5) -->
            ${match.preMatchPrediction ? `
            <div class="mb-4 animate-fade-in">
                <div class="flex-row items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm">
                    <div class="flex-row items-center gap-3">
                        <div class="w-10 h-10 rounded-full flex flex-row items-center justify-center border-2 border-primary relative" style="overflow:hidden">
                            <i class="fas fa-brain text-purple-400 absolute text-[8px] opacity-50 top-1"></i>
                            <span class="text-[10px] font-black text-white relative z-10">${match.preMatchPrediction.winProbability}%</span>
                            <div class="absolute inset-0 bg-primary opacity-20" style="height:${match.preMatchPrediction.winProbability}%"></div>
                        </div>
                        <div class="flex-col">
                            <span class="text-[9px] font-bold text-muted uppercase tracking-widest">IA PREDICCIÓN</span>
                            <span class="text-[10px] font-black uppercase tracking-wider ${match.preMatchPrediction.winProbability > 50 ? 'text-sport-green' : 'text-red-400'}">
                                ${match.preMatchPrediction.winProbability > 50 ? 'VICTORIA PROBABLE' : 'PARTIDO DIFÍCIL'}
                            </span>
                        </div>
                    </div>
                     ${match.tags?.includes('high_volatility') ? `
                        <div class="flex-row items-center gap-1 px-2 py-1 rounded bg-red-500/20 border border-red-500/30">
                            <i class="fas fa-exclamation-triangle text-red-400 text-[10px]"></i>
                            <span class="text-[8px] font-black text-red-400 uppercase tracking-widest">VOLATIL</span>
                        </div>
                    ` : ''}
                </div>
            </div>
            ` : ''}

             <div class="flex-row between items-center">
                <div class="flex-row items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-white/5 flex-center border border-white/10">
                         <i class="fas fa-crown text-yellow-500 text-sm"></i>
                    </div>
                    <div class="flex-col">
                        <span class="text-[9px] font-black text-muted uppercase tracking-[2px]">Organizador</span>
                        <span class="text-xs font-black text-white uppercase italic">${creator}</span>
                    </div>
                </div>

                <div class="btn-view-details-v7">
                    DETALLES <i class="fas fa-arrow-right-long ml-2"></i>
                </div>
             </div>
        </div>
    `;
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
    list.map(async (m, i) => {
      const date = m.fecha.toDate ? m.fecha.toDate() : new Date(m.fecha);
      const playersCount = (m.jugadores || []).filter(id => id).length;
      const creatorName = await getPlayerName(m.creador);
      const isFull = playersCount >= 4;
      const isMine = m.jugadores?.includes(currentUser.uid);

      return `
            <div class="feed-match-card-v7 animate-up ${isFull ? "closed" : "open"} ${isMine ? "me" : ""}" 
                 style="animation-delay: ${i * 0.05}s" 
                 onclick="openMatch('${m.id}', '${m.col}')">
                
                <div class="f-date-col">
                    <span class="f-hour">${date.getHours()}:${date.getMinutes().toString().padStart(2, "0")}</span>
                    <span class="f-day">${date.getDate()} ${date.toLocaleDateString("es-ES", { month: "short" }).toUpperCase()}</span>
                </div>
                
                <div class="f-main-col">
                    <div class="f-header-row mb-1">
                        <span class="f-creator">${creatorName.toUpperCase()}</span>
                        ${isMine ? '<span class="f-badge-me">T</span>' : ""}
                    </div>
                    <div class="f-info-row flex-row items-center gap-3">
                         <span class="f-type-tag ${m.isComp ? "reto" : "am"}">
                            <i class="fas ${m.isComp ? "fa-bolt" : "fa-handshake"}"></i> ${m.isComp ? "RETO" : "AM"}
                         </span>
                         <span class="f-lvl-tag">NV ${(m.nivelMin || 2.0).toFixed(1)}-${(m.nivelMax || 5.0).toFixed(1)}</span>
                    </div>
                </div>
                
                <div class="f-spots-col">
                    <div class="f-spots-visual">
                         ${[0, 1, 2, 3].map((idx) => `<div class="f-dot ${idx < playersCount ? "filled" : ""}"></div>`).join("")}
                    </div>
                    <span class="f-spots-label ${isFull ? "full" : ""}">
                        ${isFull ? "LLENO" : `${playersCount}/4`}
                    </span>
                </div>
                
                <div class="f-arrow">
                    <i class="fas fa-chevron-right"></i>
                </div>
            </div>
        `;
    }),
  );
  container.innerHTML = html.join("");
}

async function loadInsights() {
  const weatherList = document.getElementById("weather-forecast-card");
  const quickWeather = document.getElementById("quick-weather");
  const tipBox = document.getElementById("tip-box");

  try {
    const w = await getDetailedWeather();
    if (w && w.current) {
      const cond = calculateCourtCondition(
        w.current.temperature_2m,
        w.current.rain,
        w.current.wind_speed_10m,
      );
      if (quickWeather)
        quickWeather.innerHTML = `<i class="fas ${cond.icon} mr-1 ${cond.color}"></i> ${cond.condition} - ${Math.round(w.current.temperature_2m)}°C`;

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
                                <span class="text-xs text-muted italic">${cond.advice || "Condiciones ideales para el pádel."}</span>
                            </div>
                            <div class="flex-col items-end gap-0">
                                <i class="fas ${cond.icon} text-3xl ${cond.color} mb-1"></i>
                                <span class="text-xs font-bold text-white">${Math.round(w.current.temperature_2m)}°C</span>
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
                                        <span class="text-xs font-bold">${Math.round(daily.temperature_2m_max[i])}°</span>
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
            // Ensure we have user data before rendering
            if (!currentUser || !userData) {
                 // Retry once after 500ms if data not ready (edge case on fresh load)
                 await new Promise(r => setTimeout(r, 500));
            }
            await renderMatchDetail(container, matchId, col, currentUser, userData);
        } catch (e) {
            console.error("Error opening match:", e);
            container.innerHTML = '<div class="center p-10 opacity-50 text-xs">Error al cargar datos del nodo.</div>';
        }
    }
};  } catch (e) {}
}

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


const WELCOME_PHRASES = [
  "¿Listo para dominar la pista, Padeluminati?",
  "La victoria se entrena en la oscuridad... ¡Brilla en la pista!",
  "Hoy es un gran día para escalar el Olimpo Padeluminati.",
  "El circuito tiembla ante tu bandeja... ¡Demuéstralo!",
  "Padeluminatis Pro: donde los mejores se hacen leyendas.",
  "La constancia es el secreto de los elegidos.",
];

window.openMatch = async (id, col) => {
  const overlay = document.getElementById("modal-match");
  const area = document.getElementById("match-detail-area");
  overlay.classList.add("active");
  area.innerHTML =
    '<div class="loading-state"><div class="spinner-neon"></div></div>';

  // Dynamically load match service only when needed
  const { renderMatchDetail } = await import("./match-service.js");
  renderMatchDetail(area, id, col, currentUser, userData);
};

// V9 Padeluminatis Evolution
async function initMatrixFeed() {
  const container = document.getElementById("matrix-feed-container");
  if (!container) return;

  const feeds = [
    { icon: 'fa-user-plus', text: 'NUEVO ASPIRANTE UNIDO AL CIRCUITO', color: 'primary' },
    { icon: 'fa-trophy', text: 'TORNEO DE PRIMAVERA: INSCRIPCIONES ABIERTAS', color: 'sport-gold' },
    { icon: 'fa-bolt', text: 'NIVELES ACTUALIZADOS TRAS EL LTIMO PARTIDO', color: 'secondary' },
    { icon: 'fa-fire', text: 'RACHA COLECTIVA EN AUMENTO (74% WINS)', color: 'sport-green' }
  ];

  container.innerHTML = feeds.map(f => `
    <div class="feed-node animate-fade-in">
        <div class="node-pulse" style="background: var(--${f.color || 'primary'}); box-shadow: 0 0 10px var(--${f.color || 'primary'})"></div>
        <i class="fas ${f.icon} opacity-40 ml-1"></i>
        <span class="font-black opacity-80">${f.text}</span>
    </div>
  `).join('');
}

function renderHallOfFame(user) {
  const container = document.getElementById("home-achievements");
  if (!container) return;

  const achievements = [
    { id: 'first_win', name: 'ASCENSO', icon: 'fa-bolt', check: u => u.victorias > 0, tier: 'bronze' },
    { id: 'streak_3', name: 'LEGADO', icon: 'fa-fire', check: u => u.rachaActual >= 3, tier: 'silver' },
    { id: 'veteran', name: 'ELITE', icon: 'fa-crown', check: u => u.partidosJugados >= 50, tier: 'gold' }
  ];

  const html = achievements.map(a => {
    const active = a.check(user);
    return `
      <div class="ach-item-v9 ${active ? 'active' : ''} ${a.tier}" style="width: 80px;">
          <div class="ach-icon-box" style="width: 44px; height: 44px; font-size: 16px;">
              <i class="fas ${a.icon}"></i>
          </div>
          <span class="ach-lbl-v9" style="font-size: 7px;">${a.name}</span>
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
                  <span class="text-[9px] font-bold text-muted uppercase tracking-widest">INTERVENCIÓN ACTIVA</span>
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
                  <span class="label">PRECISIÓN</span>
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







