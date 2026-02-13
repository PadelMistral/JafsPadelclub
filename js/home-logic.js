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
    let isFirstLoad = !sessionStorage.getItem("initial_load_done");
    if (isFirstLoad) showLoading("Sincronizando con la Galaxia...");

    currentUser = user;

    // Update presence on every load
    const { updatePresence } = await import("./firebase-service.js");
    updatePresence(user.uid);
    setInterval(() => updatePresence(user.uid), 60000); 

    // Init Auto Notifications System (V7.0) - Unified Service
    initAutoNotifications(user.uid);

    // Listen to user data changes - Optimization: only update UI, don't re-init components
    let lastDataString = "";
    subscribeDoc("usuarios", user.uid, async (data) => {
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
            
            // Personalized welcome toast
            const welcomeName = localStorage.getItem("first_login_welcome");
            if (welcomeName) {
                showToast(`¡BIENVENIDO, ${welcomeName.toUpperCase()}!`, "Tu panel de control está listo.", "success");
                localStorage.removeItem("first_login_welcome");
            }
            
            // Initial Orchestrator Sync
            import('./ai-orchestrator.js').then(m => m.AIOrchestrator.init(user.uid));
            
            setTimeout(hideLoading, 1200);
            isFirstLoad = false;
        } else {
            updateHeader(data); // Lightweight update
        }
      }
    });

    await loadMatches();
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
  if (homePts) {
    const pointsToLevel = Math.round((nextBracket - lvlNum) * 400);
    homePts.innerHTML = `<span class="text-primary font-black">+${pointsToLevel} PTS PARA NV ${nextBracket.toFixed(1)}</span>`;
  }
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
    const nameBrief = (data.nombreUsuario || "Jugador").split(" ")[0];

    const hour = new Date().getHours();
    let intro = "Buenos días";
    if (hour >= 14 && hour < 21) intro = "Buenas tardes";
    else if (hour >= 21 || hour < 5) intro = "Buenas noches";

    const tips = [
      `¿Sabías que el Rival Intel analiza tu Némesis y Socio ideal?`,
      `El AI Brain (La Vecina) predice resultados según el clima y niveles.`,
      `Registra tus partidos en el Diario para que mi cerebro IA aprenda de ti.`,
      `Tu Rival Intel te dirá a quién evitar y con quién formar equipo.`,
      `Soy tu analista táctica: uso la Matrix para que ganes más puntos.`
    ];
    const tip = data.aiProfile?.dailyTip || tips[Math.floor(Math.random() * tips.length)];
    if (quoteEl) quoteEl.textContent = `¡${intro} ${nameBrief}! ${tip}`;

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
  syncRivalIntelligence(data.uid);

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
    list.map(async (m, i) => {
      const date = m.fecha.toDate ? m.fecha.toDate() : new Date(m.fecha);
      const playersCount = (m.jugadores || []).filter(id => id).length;
      const creatorName = await getPlayerName(m.creador);
      const isFull = playersCount >= 4;
      const isMine = m.jugadores?.includes(currentUser.uid);
      const p = m.jugadores || [];

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
                    <div class="f-info-row flex-row items-center gap-2">
                         <span class="f-type-tag ${m.isComp ? "reto" : "am"}">
                            <i class="fas ${m.isComp ? "fa-bolt" : "fa-handshake"}"></i> ${m.isComp ? "RETO" : "AM"}
                         </span>
                         ${m.visibility === 'private' ? '<span class="f-type-tag private"><i class="fas fa-lock"></i></span>' : ''}
                         <span class="f-lvl-tag">NV ${(m.nivelMin || 2.0).toFixed(1)}-${(m.nivelMax || 5.0).toFixed(1)}</span>
                    </div>
                </div>
                
                <div class="f-court-visual">
                    <div class="f-court-schema">
                        <div class="f-court-net"></div>
                        <div class="f-p-grid">
                            <div class="f-p-slot ${p[0] ? 'occupied' : ''}"></div>
                            <div class="f-p-slot ${p[1] ? 'occupied' : ''}"></div>
                            <div class="f-p-slot ${p[2] ? 'occupied' : ''}"></div>
                            <div class="f-p-slot ${p[3] ? 'occupied' : ''}"></div>
                        </div>
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







// Health logic
async function updateEcosystemHealth() {
    try {
        const usersSnap = await window.getDocsSafe(collection(db, "usuarios"));
        const matchesSnap = await window.getDocsSafe(collection(db, "partidosReto"), limit(50));
        
        const totalUsers = usersSnap.size || 1;
        const totalMatches = matchesSnap.size || 0;
        
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

        // Update UI
        const valEl = document.getElementById('eco-health-index');
        const aiValEl = document.getElementById('eco-health-val');
        const aiBarEl = document.getElementById('eco-health-bar');

        if (valEl) valEl.textContent = `ESTADO: ${score}%`;
        if (aiValEl) aiValEl.textContent = `${score}/100`;
        if (aiBarEl) aiBarEl.style.width = `${score}%`;

    } catch(e) { console.error("Health calculation error:", e); }
}

async function syncRivalIntelligence(uid) {
    try {
        const { RivalIntelligence } = await import('./rival-intelligence.js');
        const reSnap = await window.getDocsSafe(query(collection(db, "partidosReto"), where("participantes", "array-contains", uid), limit(30)));
        const amSnap = await window.getDocsSafe(query(collection(db, "partidosAmistosos"), where("participantes", "array-contains", uid), limit(30)));
        const matches = [...reSnap.docs, ...amSnap.docs].map(d => d.data());
        
        const partners = {};
        const rivals = { won: {}, lost: {} };

        matches.forEach(m => {
            if (m.estado !== 'jugado' || !m.resultado) return;
            const isT1 = m.equipo1?.includes(uid);
            const userTeam = isT1 ? m.equipo1 : m.equipo2;
            const rivalTeam = isT1 ? m.equipo2 : m.equipo1;
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

        await renderIntel(topNem, 'intel-nemesis', 'NÉMESIS', 'fa-skull text-magenta');
        await renderIntel(topVic, 'intel-victim', 'VÍCTIMA', 'fa-crown text-sport-green');
        await renderIntel(topPar, 'intel-partner', 'SOCIO', 'fa-user-group text-cyan');

    } catch(e) { console.warn("Rival Intel sync error:", e); }
}

function setupStatInteractions() {
    const bind = (id, title, msg) => {
        const el = document.getElementById(id);
        if(!el) return;
        el.onclick = () => showVisualBreakdown(title, msg);
    };

    bind('home-stat-level', 'Fórmula de Nivel', 'Calculado basándose en ELO: (ELO-1000)/400 + 2.5. Se pondera por dificultad del rival.');
    bind('home-stat-points', 'Puntos Ranking', 'Puntos ELO acumulados. Suman por victorias, restan por derrotas considerando el ELO esperado.');
    bind('home-stat-streak', 'Efecto Racha', 'Ratio de victorias recientes. Activa multiplicadores x1.25 (3), x1.6 (6), x2.5 (10).');
    
    // Help for Rival Intel
    const rivalPanel = document.getElementById('rival-intel-panel');
    if(rivalPanel) {
        const header = rivalPanel.querySelector('span'); // First span is the header
        if(header) {
            header.innerHTML += ' <i class="fas fa-question-circle text-[8px] opacity-30 cursor-help" onclick="event.stopPropagation(); window.showVisualBreakdown(\'Rival Intelligence\', \'Este panel identifica a tus contactos clave basándose en tu historial de partidos. Pulsa en Némesis para ver cómo derrotarle, o en Socio para ver vuestra compatibilidad.\')"></i>';
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

window.aiAction = (action) => {
    document.getElementById('modal-ai-hub').classList.remove('active');
    switch(action) {
        case 'profile': window.location.href = 'perfil.html'; break;
        case 'matches': window.location.href = 'historial.html'; break; 
        case 'ranking': window.location.href = 'ranking.html'; break;
        case 'rivals': window.location.href = 'perfil.html'; break; 
        case 'diary': window.location.href = 'diario.html'; break;
        case 'admin': window.location.href = 'admin.html'; break;
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
    const { getPlayerName } = await import('./firebase-service.js'); // Ensure import

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
                    <span class="text-[9px] font-black uppercase text-white/60 tracking-[3px]">EXPEDIENTE TÁCTICO</span>
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
                        <span class="text-[9px] font-black text-muted uppercase tracking-widest">WINRATE HISTÓRICO: <span class="text-white">${h2h.winRate}%</span></span>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
};
