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
    if (el) {
      el.innerHTML = `${onlineCount} Jugadores`;
    }
  } catch (e) {
    console.error("Error detecting online players:", e);
  }
}

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
  const pts = data.puntosRanking || 1000;
  const wins = data.victorias || 0;
  const played = data.partidosJugados || 0;
  const level = (data.nivel || 2.5).toFixed(1);
  const winrate = played > 0 ? Math.round((wins / played) * 100) : 0;

  const ptsEl = document.getElementById("stat-pts");
  const winsEl = document.getElementById("stat-wins");
  const matchesEl = document.getElementById("stat-matches");
  const wrEl = document.getElementById("stat-winrate");
  const lvlEl = document.getElementById("stat-level");

  if (ptsEl) countUp(ptsEl, pts);
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
            <div class="nm-top-row">
                <div class="nm-badge-pro ${match.isComp ? "reto" : "amistoso"}">
                    <i class="fas ${match.isComp ? "fa-bolt" : "fa-handshake"}"></i>
                    <span>${match.isComp ? "RETO POR PUNTOS" : "AMISTOSO"}</span>
                </div>
                <div class="nm-weather-v5">${weatherHtml}</div>
            </div>

            <div class="nm-main-v5">
                <div class="nm-date-box">
                    <span class="d-num">${date.getDate()}</span>
                    <span class="d-month">${date.toLocaleDateString("es-ES", { month: "short" }).toUpperCase()}</span>
                    <span class="d-hour">${date.getHours()}:${date.getMinutes().toString().padStart(2, "0")}</span>
                </div>
                
                <div class="nm-vs-layout">
                    <div class="team-v5 left">
                        <div class="p-chip-v5 ${match.jugadores[0] ? "filled" : "empty"}">${players[0]}</div>
                        <div class="p-chip-v5 ${match.jugadores[1] ? "filled" : "empty"}">${players[1]}</div>
                    </div>
                    <div class="vs-divider-v5">
                        <div class="vs-circle">VS</div>
                        <div class="vs-glow"></div>
                    </div>
                    <div class="team-v5 right">
                        <div class="p-chip-v5 ${match.jugadores[2] ? "filled" : "empty"}">${players[2]}</div>
                        <div class="p-chip-v5 ${match.jugadores[3] ? "filled" : "empty"}">${players[3]}</div>
                    </div>
                </div>
            </div>

            <div class="nm-ai-insight">
                <i class="fas fa-brain animate-pulse"></i>
                <p>${aiInsight}</p>
            </div>

            <div class="nm-footer-v5">
                <div class="nm-org-info">
                   <i class="fas fa-crown"></i>
                   <span>ORGANIZA <b>${creator.toUpperCase()}</b></span>
                </div>
                <div class="nm-slots-info">
                     ${isFull ? '<span class="text-white font-black">PISTA COMPLETA</span>' : `<span class="text-primary font-black">QUEDAN ${4 - match.jugadores.length} HUECOS</span>`}
                </div>
            </div>
            
            <div class="nm-interaction-hint">
                <span>Toca para ver detalles y chat</span>
                <i class="fas fa-chevron-right"></i>
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
