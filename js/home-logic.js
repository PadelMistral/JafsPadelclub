import {
  db,
  auth,
  observerAuth,
  subscribeDoc,
  getDocument,
} from "./firebase-service.js";
import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  where,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI, countUp, showToast } from "./ui-core.js";
import {
  initAIService,
  processVecinaQuery,
  calculateCourtCondition,
} from "./services/ai-service.js";
import { getDetailedWeather, getDailyTip } from "./external-data.js";
// Removed renderXpWidget, achievements as they might not exist or are in sub-modules
import { initGalaxyBackground } from "./modules/galaxy-bg.js";
import {
  updateHeader,
  injectHeader,
  injectNavbar,
  showLoading,
  hideLoading,
} from "./modules/ui-loader.js";
import { sendNotification } from "./services/notifications.js";
import { requestNotificationPermission } from "./modules/notifications.js";

let currentUser = null;
let userData = null;
let allMatches = [];

const WELCOME_PHRASES = [
  "¿Listo para dominar la pista hoy? 🎾",
  "La victoria se entrena, el talento se pule. 🔥",
  "Hoy es un gran día para subir puntos en el ranking. 📈",
  "Tu rival ya está temblando... ¡Ve a por todas! ⚔️",
  "Menos excusas, más bandejas. ¡A jugar! 🚀",
  "El circuito te espera. Demuestra quién manda. 🏆",
  "La constancia es la clave del éxito. 🗝️",
  "Juega cada punto como si fuera el último mecha ball. ⚡",
  "Tu mejor golpe es tu actitud mental. 😎",
  "Respira, visualiza y ejecuta. 🧘‍♂️",
];

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
    const snap = await getDocs(q);
    const onlineCount = snap.size || 1;

    const el = document.getElementById("online-count-display");
    const elLibrary = document.getElementById("online-count-library");
    if (el) {
      el.innerHTML = `${onlineCount} JUGADORES ONLINE`;
      el.style.cursor = 'pointer';
      el.onclick = () => window.showOnlineUsers();
    }
    if (elLibrary) {
      elLibrary.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-sport-green animate-pulse"></span> ${onlineCount} ONLINE`;
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
    const snap = await getDocs(q);
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal-sheet">
            <!-- Glass Header -->
            <div class="modal-header">
                <div class="flex-col">
                    <div class="flex-row items-center gap-2 mb-1">
                        <div class="pulse-dot-green"></div>
                        <h3 class="modal-title">SALA COMÚN</h3>
                    </div>
                    <span class="text-[9px] text-muted font-black tracking-[0.2em] uppercase">${snap.size} OPERATIVOS CONECTADOS</span>
                </div>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>

            <div class="modal-body custom-scroll">
                <div class="flex-col gap-3">
                    ${snap.docs.map(d => {
                        const u = d.data();
                        const photo = u.fotoPerfil || u.fotoURL || './imagenes/default-avatar.png';
                        const isMe = u.uid === currentUser?.uid || d.id === currentUser?.uid;
                        const lvl = (u.nivel || 2.5).toFixed(1);
                        const isOnline = true; // By query definition
                        
                        return `
                            <div class="flex-row items-center gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-primary/20 transition-all cursor-pointer group ${isMe ? 'bg-primary/10 border-primary/20 shadow-glow-sm' : ''}" 
                                 onclick="window.viewProfile('${u.uid || d.id}')">
                                
                                <div class="relative flex-shrink-0">
                                    <div class="absolute -inset-1 bg-gradient-to-r ${isMe ? 'from-primary to-accent' : 'from-slate-700 to-slate-800'} rounded-full blur-sm opacity-20 group-hover:opacity-100 transition duration-500"></div>
                                    <img src="${photo}" class="relative w-12 h-12 rounded-full object-cover border-2 ${isMe ? 'border-primary' : 'border-white/10'}">
                                    <div class="absolute bottom-0 right-0 w-3 h-3 bg-sport-green rounded-full border-2 border-slate-900 shadow-glow"></div>
                                </div>

                                <div class="flex-col flex-1">
                                    <span class="text-[13px] font-black text-white italic uppercase tracking-tighter ${isMe ? 'text-primary' : ''}">
                                        ${u.nombreUsuario || u.nombre || 'Jugador'} ${isMe ? '<span class="text-[9px] opacity-70 ml-1">(TÚ)</span>' : ''}
                                    </span>
                                    <div class="flex-row items-center gap-2">
                                        <div class="flex-row items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded-md">
                                            <span class="text-[8px] text-muted font-black">NV</span>
                                            <span class="text-[10px] text-primary font-black">${lvl}</span>
                                        </div>
                                        <span class="text-[9px] text-muted font-black uppercase tracking-widest opacity-40">${u.rol || 'Jugador'}</span>
                                    </div>
                                </div>

                                <i class="fas fa-chevron-right text-[10px] text-muted group-hover:text-primary transition-colors"></i>
                            </div>
                        `;
                    }).join('')}
                    ${snap.empty ? '<div class="text-center text-xs text-muted py-10 font-bold uppercase tracking-widest opacity-30">Silencio absoluto en la Matrix...</div>' : ''}
                </div>
            </div>

            <div class="modal-footer">
                <span class="text-[10px] text-muted font-bold italic opacity-60">Selecciona un perfil para sincronizar datos.</span>
            </div>
        </div>
    `;
    
    overlay.addEventListener('click', (e) => { if(e.target === overlay) overlay.remove(); });
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

    const { showLoading, hideLoading, injectHeader, injectNavbar } =
      await import("./modules/ui-loader.js");

    // Only show loader if initial_load_done is not set to 'true'
    const isFirstLoad = !sessionStorage.getItem("initial_load_done");
    if (isFirstLoad) showLoading("Sincronizando con la Galaxia...");

    currentUser = user;

    // Update presence on every load
    const { updatePresence } = await import("./firebase-service.js");
    updatePresence(user.uid);

    if (user) {
      subscribeDoc("usuarios", user.uid, (data) => {
        userData = data;
        updateDashboard(data);

        // Personalized welcome toast after spectacular loader
        const welcomeName = localStorage.getItem('first_login_welcome');
        if (welcomeName) {
            setTimeout(() => {
                showToast(`¡BIENVENIDO, ${welcomeName.toUpperCase()}!`, "Tu panel de control está listo. ¡A dominar la pista!", "success");
                localStorage.removeItem('first_login_welcome');
            }, 1000);
        }

        // Ensure header is updated with role/info
        injectHeader(data);
        injectNavbar("home");
      });

      await loadMatches();
      await loadLastResult();
      loadInsights();
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
          WELCOME_PHRASES[Math.floor(Math.random() * WELCOME_PHRASES.length)];
        showToast(greet, `${name}, ${phrase}`, "success");
      }, 1000);

      if (isFirstLoad) setTimeout(hideLoading, 1500);
    }
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
  const wins = data.victorias || 0;
  const played = data.partidosJugados || 0;
  const level = (data.nivel || 2.5).toFixed(1);
  const winrate = played > 0 ? Math.round((wins / played) * 100) : 0;

  // Points & Rank Status
  const currentPts = data.puntosRanking !== undefined ? data.puntosRanking : calculateBasePoints(data.nivel);
  const ptsEl = document.getElementById("stat-pts");
  const winsEl = document.getElementById("stat-wins");
  const matchesEl = document.getElementById("stat-matches");
  const wrEl = document.getElementById("stat-winrate");
  const lvlEl = document.getElementById("stat-level");

  if (ptsEl) countUp(ptsEl, Math.round(currentPts)); // Round points for display
  if (winsEl) winsEl.textContent = wins;
  if (matchesEl) matchesEl.textContent = played;
  if (wrEl) wrEl.textContent = `${winrate}%`;
  if (lvlEl) lvlEl.textContent = level;

  // Get rank
  getDocs(
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

  // Dynamic AI Welcome Message
  const aiBox = document.getElementById("ai-welcome-msg");
  if (aiBox) {
    initAIService();
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
        await import("./modules/ui-loader.js");
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
                <i class="fas fa-calendar-check text-xl text-primary mb-1"></i>
                <span class="font-bold text-xs text-white uppercase">EVENTOS</span>
                <span class="text-xs text-muted">Ver próximos eventos</span>
            `;
      tipBox.onclick = () => (window.location.href = "eventos.html");
    }
  }
}

async function loadLastResult() {
  try {
    const logs = await getDocs(
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
    getDocs(collection(db, "partidosAmistosos")),
    getDocs(collection(db, "partidosReto")),
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
            <div class="empty-state-card animate-up">
                <div class="empty-icon-wrap">
                    <i class="fas fa-calendar-plus"></i>
                </div>
                <span class="empty-title">SIN PARTIDOS</span>
                <span class="empty-desc">Tu agenda está libre. ¿Echamos un partido?</span>
                <button class="btn-primary sm mt-3" onclick="window.location.href='calendario.html'">BUSCAR PISTA</button>
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

  // Ensure 4 players array
  while (players.length < 4) players.push("Libre");

  const creator = await getPlayerName(match.creador);
  const isFull = (match.jugadores?.length || 0) >= 4;

  // Real weather check if available, else fallback
  let weatherHtml =
    '<i class="fas fa-cloud-sun text-primary"></i> <span class="text-xs">Pronóstico...</span>';
  let aiInsight = 'Analizando tu próximo reto...';

  try {
    const w = await getDetailedWeather();
    if (w) {
      const temp = Math.round(w.current.temperature_2m);
      const icon = getIconFromCode(w.current.weather_code);
      weatherHtml = `<i class="fas ${icon} text-accent"></i> <span class="text-xs">${temp}°C</span>`;
      
      const { calculateCourtCondition } = await import('./services/ai-service.js');
      const cond = calculateCourtCondition(w.current.temperature_2m, w.current.rain, w.current.wind_speed_10m);
      aiInsight = cond.advice;
    }
  } catch (e) {}

  container.innerHTML = `
        <div class="next-match-card-v5 ${isFull ? "full" : "open"} animate-up" onclick="openMatch('${match.id}', '${match.col}')">
            
            <!-- Top Header -->
            <div class="flex-row between items-center mb-5 border-b border-white/10 pb-3">
                <div class="flex-col">
                    <div class="flex-row items-baseline gap-1">
                         <span class="text-3xl font-black text-white italic tracking-tighter">${date.getHours()}:${date.getMinutes().toString().padStart(2, "0")}</span>
                         <span class="text-[10px] font-bold text-white opacity-50">HRS</span>
                    </div>
                    <span class="text-[10px] font-black text-accent uppercase tracking-[2px]">${date.toLocaleDateString("es-ES", { weekday:'long', day:'numeric' })}</span>
                </div>
                
                <div class="flex-col items-end gap-1">
                    <div class="nm-badge-pro small ${match.isComp ? "reto" : "amistoso"}">
                        <span>${match.isComp ? "RETO" : "AMISTOSO"}</span>
                    </div>
                    <!-- Small Weather Pill -->
                    <div class="flex-row items-center gap-1 bg-black/40 px-2 py-0.5 rounded-full border border-white/5">
                        <i class="fas fa-temperature-half text-[10px] text-gray-400"></i>
                         <span class="text-[10px] font-bold text-gray-300">Clima</span>
                    </div>
                </div>
            </div>

            <!-- VS Layout -->
            <div class="nm-main-v5 mb-5 relative">
                <div class="nm-vs-layout large-vs">
                    <div class="team-v5 left">
                        <div class="p-chip-v5 large ${match.jugadores[0] ? "filled" : "empty"}">${players[0]}</div>
                        <div class="p-chip-v5 large ${match.jugadores[1] ? "filled" : "empty"}">${players[1]}</div>
                    </div>
                     <!-- Centered VS -->
                    <div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10">
                        <div class="vs-circle large shadow-xl border-4 border-[#0a0a0a] bg-black">VS</div>
                    </div>
                    <div class="team-v5 right">
                        <div class="p-chip-v5 large ${match.jugadores[2] ? "filled" : "empty"}">${players[2]}</div>
                        <div class="p-chip-v5 large ${match.jugadores[3] ? "filled" : "empty"}">${players[3]}</div>
                    </div>
                </div>
            </div>

            <!-- Footer Info -->
             <div class="flex-row between items-end">
                <div class="nm-org-info">
                   <div class="flex-row items-center gap-2 mb-1">
                        <img src="./imagenes/Logojafs.png" class="w-4 h-4 opacity-50">
                        <span class="text-[9px] font-black text-accent uppercase tracking-widest">ORGANIZADOR</span>
                   </div>
                   <span class="text-sm font-bold text-white">${creator.toUpperCase()}</span>
                </div>

                <button class="bg-accent/10 hover:bg-accent/20 border border-accent/30 text-accent rounded-xl px-4 py-2 text-[10px] font-black uppercase tracking-widest transition-all">
                    VER DETALLES <i class="fas fa-arrow-right ml-1"></i>
                </button>
             </div>
        </div>
    `;
}

async function renderMatchFeed(param) {
  const container = document.getElementById("match-feed");
  if (!container) return;

  // Update active filter pill
  document.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.classList.toggle(
      "active",
      btn.getAttribute("onclick").includes(`'${param}'`),
    );
  });

  let list = allMatches;
  if (param === "open") {
    list = allMatches.filter((m) => (m.jugadores?.length || 0) < 4);
  } else if (param === "closed") {
    list = allMatches.filter((m) => (m.jugadores?.length || 0) >= 4);
  }

  // Limit to 12 for performance
  list = list.slice(0, 12);

  if (!list || list.length === 0) {
    container.innerHTML = `
            <div class="empty-feed-msg animate-fade-in">
                <i class="fas fa-ghost mb-2"></i>
                <span>No hay partidas ${param === "all" ? "" : param + "s"} disponibles</span>
            </div>
        `;
    return;
  }

  const html = await Promise.all(
    list.map(async (m, i) => {
      const date = m.fecha.toDate ? m.fecha.toDate() : new Date(m.fecha);
      const playersCount = m.jugadores?.length || 0;
      const creatorName = await getPlayerName(m.creador);
      const isFull = playersCount >= 4;
      const isMine = m.jugadores?.includes(currentUser.uid);

      return `
            <div class="available-match-entry animate-up ${isFull ? "closed" : "open"} ${isMine ? "is-mine" : ""}" 
                 style="animation-delay: ${i * 0.05}s" 
                 onclick="openMatch('${m.id}', '${m.col}')">
                <div class="ame-time-box">
                    <span class="ame-time">${date.getHours()}:${date.getMinutes().toString().padStart(2, "0")}</span>
                    <span class="ame-date">${date.getDate()} ${date.toLocaleDateString("es-ES", { month: "short" }).toUpperCase()}</span>
                </div>
                
                <div class="ame-main-info">
                    <div class="ame-header">
                        <span class="ame-creator">${creatorName}</span>
                        ${isMine ? '<span class="my-match-badge">MÍA</span>' : ""}
                        ${isFull ? '<span class="closed-badge">CERRADA</span>' : ""}
                    </div>
                    <div class="ame-type-row">
                        <span class="ame-type ${m.isComp ? "comp" : "friend"}">${m.isComp ? "⚡ RETO" : "🤝 AMISTOSO"}</span>
                        <span class="ame-level-badge">Nv. ${(m.nivelMin || 2.0).toFixed(1)} - ${(m.nivelMax || 5.0).toFixed(1)}</span>
                    </div>
                </div>
                
                <div class="ame-spots-wrap">
                    <div class="ame-spots-dots">
                         ${[0, 1, 2, 3].map((idx) => `<div class="spot-dot ${idx < playersCount ? "active" : ""}"></div>`).join("")}
                    </div>
                    <span class="ame-spots-text ${isFull ? "text-muted" : "text-primary"}">
                        ${isFull ? "COMPLETO" : `${4 - playersCount} LIBRES`}
                    </span>
                </div>
                
                <div class="ame-arrow">
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
    if (tipBox && tip) {
      tipBox.innerHTML = `
                <i class="fas fa-lightbulb text-2xl text-secondary mb-2"></i>
                <span class="text-xs font-black uppercase text-white">Coach Tip</span>
                <span class="text-xs text-muted opacity-80 truncate w-full text-center">${tip.title}</span>
            `;
      tipBox.onclick = () => showToast("💡 Consejo Padel", tip.content, "info");
    }
  } catch (e) {}
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
