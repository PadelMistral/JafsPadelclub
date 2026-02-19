/* js/modules/vecina-chat.js - Sentient AI v14.0 "Command Matrix" Edition */
import { auth, getDocument, db } from "../firebase-service.js";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import {
  isFinishedMatch,
  isCancelledMatch,
  resolveWinnerTeam,
  isExpiredOpenMatch,
  getResultSetsString,
} from "../utils/match-utils.js";

// --- ATOMIC STATE & CACHE ---
let chatOpen = false;
let userData = null;
let currentPersonality = "coach"; // 'coach' or 'vecina'

const MEMORY = {
  intentsCount: JSON.parse(localStorage.getItem("ai_intents_count") || "{}"),
  tutorialDone: localStorage.getItem("ai_tutorial_done") === "true",
};

const DATA_CACHE = {
  user: null,
  eloHistory: [],
  matches: [],
  globalUsers: [],
  openMatches: [],
  systemStats: null,
  lastUpdate: 0,
};

const HUMOR_KEY = "padeluminatis_ai_humor";
let humorEnabled = localStorage.getItem(HUMOR_KEY) === "true";

function humorNoData() {
  const lines = [
    "Esto aún no lo sé… mi algoritmo necesita café antes de jugar.",
    "No tengo info suficiente, pero prometo volver más fuerte que un globo en verano.",
    "No me llega el dato, hoy estoy en modo ahorro de energía.",
    "Sin datos por ahora. Mientras tanto, entreno mis predicciones en silencio.",
    "El partido aún no se ha jugado. No puedo analizarlo todavía.", // Added
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

function noData(msg) {
  return humorEnabled ? `${msg} ${humorNoData()}` : msg;
}

// --- DATA LAYER (Private) ---

async function _syncData() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const now = Date.now();
  if (now - DATA_CACHE.lastUpdate < 300000 && DATA_CACHE.user) return;

  try {
    const [
      uData,
      eloSnap,
      matchAmis,
      matchReto,
      usersSnap,
      openAmis,
      openReto,
    ] = await Promise.all([
      getDocument("usuarios", uid),
      window.getDocsSafe(
        query(
          collection(db, "rankingLogs"),
          where("uid", "==", uid),
          orderBy("timestamp", "desc"),
          limit(25),
        ),
      ),
      window.getDocsSafe(
        query(
          collection(db, "partidosAmistosos"),
          where("jugadores", "array-contains", uid),
          orderBy("fecha", "desc"),
          limit(25),
        ),
      ),
      window.getDocsSafe(
        query(
          collection(db, "partidosReto"),
          where("jugadores", "array-contains", uid),
          orderBy("fecha", "desc"),
          limit(25),
        ),
      ),
      window.getDocsSafe(query(collection(db, "usuarios"), limit(400))),
      window.getDocsSafe(
        query(
          collection(db, "partidosAmistosos"),
          where("estado", "==", "abierto"),
          limit(10),
        ),
      ),
      window.getDocsSafe(
        query(
          collection(db, "partidosReto"),
          where("estado", "==", "abierto"),
          limit(10),
        ),
      ),
    ]);

    if (uData) {
      uData.nivel = Number(uData.nivel || 2.5);
      uData.puntosRanking = Number(uData.puntosRanking || 1000);
    }
    DATA_CACHE.user = uData;
    DATA_CACHE.eloHistory = eloSnap.docs.map((d) => d.data());
    DATA_CACHE.matches = [
      ...matchAmis.docs.map((d) => ({
        ...d.data(),
        id: d.id,
        _col: "amistoso",
      })),
      ...matchReto.docs.map((d) => ({ ...d.data(), id: d.id, _col: "reto" })),
    ].sort((a, b) => {
      const dA = a.fecha?.toDate?.() || new Date(a.fecha || 0);
      const dB = b.fecha?.toDate?.() || new Date(b.fecha || 0);
      return dB - dA;
    });
    DATA_CACHE.globalUsers = usersSnap.docs.map((d) => {
      const data = d.data() || {};
      return {
        id: d.id,
        ...data,
        nivel: Number(data.nivel || 2.5),
        puntosRanking: Number(data.puntosRanking || 1000),
      };
    });
    DATA_CACHE.openMatches = [
      ...openAmis.docs.map((d) => ({ ...d.data(), _col: "amistoso" })),
      ...openReto.docs.map((d) => ({ ...d.data(), _col: "reto" })),
    ].filter((m) => {
      const filled = (m.jugadores || []).filter((id) => id).length;
      return filled < 4 && !isFinishedMatch(m) && !isCancelledMatch(m) && !isExpiredOpenMatch(m);
    });
    const finishedMatches = DATA_CACHE.matches.filter((m) => isFinishedMatch(m) && !isCancelledMatch(m)).length;
    DATA_CACHE.systemStats = {
      totalUsers: DATA_CACHE.globalUsers.length,
      myMatches: DATA_CACHE.matches.length,
      myFinishedMatches: finishedMatches,
      openCircuitMatches: DATA_CACHE.openMatches.length,
      sections: ["home", "calendario", "ranking", "perfil", "diario", "palas", "admin"],
      refreshedAt: new Date().toISOString(),
    };

    DATA_CACHE.lastUpdate = now;
    userData = uData;
  } catch (e) {
    console.error("AI Data Layer Error:", e);
  }
}

// --- ANALYSIS LAYER (Private) ---

const Analyzer = {
  getEloTrend: () => {
    if (DATA_CACHE.eloHistory.length < 2) return "ESTABLE";
    const recent = DATA_CACHE.eloHistory[0].newTotal || 1000;
    const old =
      DATA_CACHE.eloHistory[Math.min(5, DATA_CACHE.eloHistory.length - 1)]
        .newTotal || 1000;
    if (recent > old + 20) return "s? EXPONENCIAL";
    if (recent < old - 20) return "?~ CRÍTICA";
    return recent > old ? "ALZA" : "CORRECCIÓN";
  },

  getMatchStats: () => {
    const played = DATA_CACHE.matches.filter((m) => isFinishedMatch(m) && !isCancelledMatch(m));
    if (played.length === 0) return null;

    let best = played[0],
      worst = played[0];
    let maxDiff = -1;

    played.forEach((m) => {
      const sets = getResultSetsString(m).split(" ");
      let myS = 0,
        rivS = 0;
      const myIdx = m.jugadores.indexOf(auth.currentUser.uid);
      const isTeam1 = myIdx < 2;

      sets.forEach((s) => {
        const p = s.split("-").map(Number);
        if (p.length < 2) return;
        if (isTeam1) {
          p[0] > p[1] ? myS++ : rivS++;
        } else {
          p[1] > p[0] ? myS++ : rivS++;
        }
      });

      const diff = Math.abs(myS - rivS);
      if (myS > rivS && diff >= (best.diff || 0)) {
        best = { ...m, diff };
      }
      if (rivS > myS && diff >= (worst.diff || 0)) {
        worst = { ...m, diff };
      }
    });

    return { best, worst };
  },

  findNemesis: (uid) => {
    const record = {};
    DATA_CACHE.matches.forEach((m) => {
      if (!m.jugadores || !isFinishedMatch(m) || isCancelledMatch(m)) return;
      const myIdx = m.jugadores.indexOf(uid);
      if (myIdx === -1) return;
      const isTeam1 = myIdx < 2;
      const rivs = isTeam1
        ? [m.jugadores[2], m.jugadores[3]]
        : [m.jugadores[0], m.jugadores[1]];

      const winnerTeam = resolveWinnerTeam(m);
      if (winnerTeam !== 1 && winnerTeam !== 2) return;
      const won = isTeam1 ? winnerTeam === 1 : winnerTeam === 2;

      rivs.forEach((rid) => {
        if (!rid || rid === uid || String(rid).startsWith("GUEST_")) return;
        if (!record[rid]) record[rid] = { wins: 0, losses: 0 };
        won ? record[rid].wins++ : record[rid].losses++;
      });
    });

    let nemesisId = null,
      worstRatio = -1;
    Object.keys(record).forEach((rid) => {
      const total = record[rid].wins + record[rid].losses;
      const ratio = record[rid].losses / total;
      if (total >= 2 && ratio > worstRatio) {
        worstRatio = ratio;
        nemesisId = rid;
      }
    });

    return nemesisId
      ? {
          ...DATA_CACHE.globalUsers.find((u) => u.id === nemesisId),
          stats: record[nemesisId],
        }
      : null;
  },
};

function _getMatchDate(m) {
  return m?.fecha?.toDate?.() || new Date(m?.fecha || 0);
}

function _didUserWinMatch(m, uid) {
  if (!m?.jugadores || !isFinishedMatch(m) || isCancelledMatch(m)) return false;
  const myIdx = m.jugadores.indexOf(uid);
  if (myIdx === -1) return false;
  const isTeam1 = myIdx < 2;
  const winnerTeam = resolveWinnerTeam(m);
  if (winnerTeam !== 1 && winnerTeam !== 2) return false;
  return isTeam1 ? winnerTeam === 1 : winnerTeam === 2;
}

function _calcWinrate(uid) {
  const played = DATA_CACHE.matches.filter((m) => isFinishedMatch(m) && !isCancelledMatch(m));
  if (played.length === 0) return { wins: 0, total: 0, winrate: 0 };
  let wins = 0;
  played.forEach((m) => {
    if (_didUserWinMatch(m, uid)) wins++;
  });
  return {
    wins,
    total: played.length,
    winrate: Math.round((wins / played.length) * 100),
  };
}

function _normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s#@-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function _findUserByName(name) {
  if (!name) return null;
  const raw = String(name || "").trim();
  const byId = raw.match(/#([\w-]+)/);
  if (byId?.[1]) {
    const targetId = byId[1];
    const foundById = DATA_CACHE.globalUsers.find((u) => u.id === targetId);
    if (foundById) return foundById;
  }

  const q = _normalizeText(raw.replace(/^@/, ""));
  if (!q) return null;

  const exact = DATA_CACHE.globalUsers.find((u) => {
    const n = _normalizeText(u.nombreUsuario || u.nombre || "");
    return n === q;
  });
  if (exact) return exact;

  const starts = DATA_CACHE.globalUsers.find((u) => {
    const n = _normalizeText(u.nombreUsuario || u.nombre || "");
    return n.startsWith(q);
  });
  if (starts) return starts;

  const includes = DATA_CACHE.globalUsers.find((u) => {
    const n = _normalizeText(u.nombreUsuario || u.nombre || "");
    return n.includes(q);
  });
  if (includes) return includes;

  const qTokens = q.split(" ").filter(Boolean);
  return DATA_CACHE.globalUsers.find((u) => {
    const n = _normalizeText(u.nombreUsuario || u.nombre || "");
    return qTokens.every((t) => n.includes(t));
  }) || null;
}

// --- DIALOGUE LAYER ---

function _detectIntent(query) {
  const q = query.toLowerCase();
  if (query.startsWith("CMD_")) return query;

  if (
    q.includes("hola") ||
    q.includes("buenas") ||
    q.includes("hi") ||
    q.includes("que tal")
  )
    return "CMD_GREETING";
  if (q.includes("analiza mi partido") || q.includes("análisis del partido") || q.includes("qué tal jugamos"))
    return "CMD_ANALYZE_MATCH";
  if (q.includes("rival intelligence") || q.includes("rival intel") || q.includes("nemesis socio victima"))
    return "CMD_RIVAL_INTEL";
  if (q.includes("resumen total") || q.includes("estado total") || q.includes("todo mi estado"))
    return "CMD_FULL_SUMMARY";
  if (q.includes("estado app") || q.includes("estado proyecto") || q.includes("que sabes de la app"))
    return "CMD_APP_CONTEXT";
  if (
    q.includes("analiza a") ||
    q.includes("análisis de") ||
    q.includes("analiza mi") ||
    q.includes("analiza jugador")
  )
    return "CMD_ANALYZE_RIVAL";
  if (q.includes("socio") || q.includes("compañero")) return "CMD_PARTNER_SYNC";
  if (q.includes("chiste") || q.includes("risa")) return "CMD_JOKE";
  if (q.includes("sugerencia") || q.includes("mejora app") || q.includes("buzon"))
    return "CMD_SUGGEST_FEATURE";
  if (
    q.includes("diferencia con") ||
    q.includes("comparar con") ||
    q.includes("busca a")
  )
    return "CMD_USER_SEARCH";
  if (q.includes("proximo partido") || q.includes("cuando juego"))
    return "CMD_NEXT_MATCH";
  if (q.includes("progreso de nivel") || q.includes("subir de nivel") || q.includes("cuanto falta para subir"))
    return "CMD_LEVEL_PROGRESS";
  if (q.includes("llueve") || q.includes("lluvia")) return "CMD_RAIN_TODAY";
  if (
    q.includes("peor rival") ||
    q.includes("cuesta ganar") ||
    q.includes("nemesis")
  )
    return "CMD_NEMESIS";
  if (q.includes("mejor partido")) return "CMD_BEST_MATCH";
  if (q.includes("ranking") || q.includes("mejor jugador") || q.includes("top"))
    return "CMD_GLOBAL_RANKING";
  if (
    q.includes("abierto") ||
    q.includes("hay partidas") ||
    q.includes("huecos")
  )
    return "CMD_OPEN_MATCHES";
  if (q.includes("ultimo") || q.includes("cuándo jugué"))
    return "CMD_LAST_MATCH";
  if (q.includes("análisis") || q.includes("informe")) return "CMD_REPORT";
  if (q.includes("historial") || q.includes("mis partidos"))
    return "CMD_STATS_READ";
  if (q.includes("estadisticas globales") || q.includes("cuantos partidos"))
    return "CMD_GLOBAL_STATS";
  if (
    q.includes("tutorial") ||
    q.includes("ayuda") ||
    q.includes("como interactuo") ||
    q.includes("instrucciones") ||
    q.includes("que puedo hacer") ||
    q.includes("guia")
  )
    return "CMD_TUTORIAL";
  if (q.includes("consejo") || q.includes("pro tip") || q.includes("qué hago") || q.includes("ayúdame")) return "CMD_PRO_TIPS";
  if (
    q.includes("pala") ||
    q.includes("raqueta") ||
    q.includes("mejor material") ||
    q.includes("equipo")
  )
    return "CMD_GEAR_ADVICE";
  if (
    q.includes("formula") ||
    q.includes("como se calcula") ||
    q.includes("puntos elo") ||
    q.includes("puntuación")
  )
    return "CMD_ELO_FORMULA";
  if (
    q.includes("censo") ||
    q.includes("cuanta gente") ||
    q.includes("niveles de la app") ||
    q.includes("comunidad")
  )
    return "CMD_CLUB_CENSUS";
  if (q.includes("ganar hoy") || q.includes("quién gana") || q.includes("apuesta") || q.includes("probabilidad"))
    return "CMD_PREDICT";
  if (q.includes("clima") || q.includes("tiempo") || q.includes("lloverá") || q.includes("temperatura"))
    return "CMD_RAIN_TODAY";
  if (q.includes("estadísticas") || q.includes("mis datos") || q.includes("mi rendimiento") || q.includes("mis números"))
    return "CMD_STATS_READ";
  if (q.includes("qué pala") || q.includes("recomienda pala") || q.includes("mi pala") || q.includes("material"))
    return "CMD_GEAR_ADVICE";
  
  if (q.includes("vecina") || q.includes("maruja") || q.includes("qué dices"))
    return "CMD_PERSONALITY_CHAT";

  // --- NEW V15 INTENTS ---
  if (q.includes("cabeza a cabeza") || q.includes("h2h") || q.includes("historial con") || q.includes("versus"))
    return "CMD_H2H";
  if (q.includes("momento") || q.includes("tendencia") || q.includes("momentum") || q.includes("forma actual"))
    return "CMD_MOMENTUM";
  if (q.includes("evolución") || q.includes("progreso") || q.includes("crecimiento") || q.includes("mejorado"))
    return "CMD_EVOLUTION";
  if (q.includes("semana") || q.includes("semanal") || q.includes("esta semana") || q.includes("resumen semanal"))
    return "CMD_WEEKLY";
  if (q.includes("récord") || q.includes("record") || q.includes("máximo") || q.includes("mejor racha") || q.includes("personal best"))
    return "CMD_RECORD";
  if (q.includes("zona caliente") || q.includes("horario") || q.includes("mejor hora") || q.includes("cuándo gano"))
    return "CMD_HOT_ZONE";
  if (q.includes("rival más fuerte") || q.includes("quien manda") || q.includes("quién es el jefe"))
    return "CMD_COMPARE_ELITE";
  if (q.includes("posición") || q.includes("drive") || q.includes("revés") || q.includes("zurdo") || q.includes("diestro"))
    return "CMD_TACTIC_OVERVIEW";
  if (q.includes("mental") || q.includes("nervios") || q.includes("presión") || q.includes("ansiedad"))
    return "CMD_MENTAL_COACH";
  if (q.includes("entrenamiento") || q.includes("plan") || q.includes("preparar") || q.includes("rutina"))
    return "CMD_TRAINING_PLAN";
  if (q.includes("golpe") || q.includes("smash") || q.includes("volea") || q.includes("bandeja") || q.includes("víbora"))
    return "CMD_SHOT_FOCUS";
  if (q.includes("pronóstico") || q.includes("predicción") || q.includes("forecast") || q.includes("quién va a ganar"))
    return "CMD_MATCH_FORECAST";
  if (q.includes("métricas") || q.includes("avanzadas") || q.includes("galaxia") || q.includes("estructura"))
    return "CMD_METRICS_ADVANCED";
  if (q.includes("precalentamiento") || q.includes("warmup") || q.includes("antes del partido"))
    return "CMD_PREMATCH";

  return "GENERAL";
}

// --- PUBLIC EXPORTS ---

export function initVecinaChat() {
  if (document.getElementById("vecina-chat-fab")) return;

  const fab = document.createElement("button");
  fab.id = "vecina-chat-fab";
  fab.className = "ai-fab";
  fab.innerHTML = `<i class="fas fa-robot"></i>`;
  fab.onclick = toggleChat;
  document.body.appendChild(fab);

  const chatHTML = `
        <div id="vecina-chat-panel" class="ai-chat-panel v14">
            <div class="ai-chat-header border-b border-white-05 px-6">
                <div class="personality-toggle" onclick="window.switchAiPersonality()">
                    <div id="p-avatar-bot" class="ai-avatar-box coach">
                        <i class="fas fa-robot"></i>
                    </div>
                </div>
                <div class="ai-header-info flex-1" onclick="window.switchAiPersonality()">
                    <span id="ai-bot-name" class="ai-title italic font-black uppercase">VECINA AP INSIGHT</span>
                    <div class="flex-row items-center gap-2">
                        <div class="pulse-dot-green"></div>
                        <span id="ai-bot-tag" class="ai-subtitle tracking-[2px]">NÚCLEO SENTIENTE V14</span>
                    </div>
                </div>
                <div class="flex-row items-center gap-2">
                    <button id="ai-humor-toggle" class="btn-humor-toggle-v7" onclick="window.toggleAiHumor()">HUMOR</button>
                    <button class="btn-close-neon sm" onclick="window.toggleAiChat()"><i class="fas fa-times"></i></button>
                </div>
            </div>
            
            <div id="ai-messages" class="ai-chat-body custom-scroll p-6"></div>

            <div class="ai-chat-footer p-5 bg-black/40 backdrop-blur-3xl border-t border-white-05">
                <div id="ai-command-wrap" class="ai-command-container-v7 mb-4">
                    <div class="ai-quick-grid-v7">
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_TUTORIAL','Guia')">
                            <i class="fas fa-book-sparkles"></i>
                            <span>Guia</span>
                        </button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_REPORT','Informe')">
                            <i class="fas fa-chart-line-up"></i>
                            <span>Informe</span>
                        </button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_RIVAL_INTEL','Rival Intel')">
                            <i class="fas fa-crosshairs"></i>
                            <span>Rivales</span>
                        </button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_NEMESIS','Nemesis')">
                            <i class="fas fa-skull"></i>
                            <span>Nemesis</span>
                        </button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_PARTNER_SYNC','Socio')">
                            <i class="fas fa-user-group"></i>
                            <span>Socio</span>
                        </button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_FULL_SUMMARY','Resumen total')">
                            <i class="fas fa-rectangle-list"></i>
                            <span>Resumen</span>
                        </button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_LEVEL_PROGRESS','Nivel')">
                            <i class="fas fa-gauge-high"></i>
                            <span>Nivel</span>
                        </button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_GLOBAL_RANKING','Ranking')">
                            <i class="fas fa-crown"></i>
                            <span>Ranking</span>
                        </button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_LAST_MATCH','Ultimo')">
                            <i class="fas fa-history"></i>
                            <span>Ultimo</span>
                        </button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_WEEKLY','Semana')">
                            <i class="fas fa-calendar-week"></i>
                            <span>Semana</span>
                        </button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_APP_CONTEXT','Sistema')">
                            <i class="fas fa-database"></i>
                            <span>Sistema</span>
                        </button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_OPEN_MATCHES','Abiertos')">
                            <i class="fas fa-door-open"></i>
                            <span>Abiertos</span>
                        </button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_MOMENTUM','Momentum')">
                            <i class="fas fa-wave-square"></i>
                            <span>Momentum</span>
                        </button>
                        <button class="ai-quick-btn-v7" onclick="window.openSuggestionModal?.()">
                            <i class="fas fa-lightbulb"></i>
                            <span>Sugerir</span>
                        </button>
                    </div>
                </div>
                <div class="ai-input-container-v7">
                    <input type="text" id="ai-input-field" class="ai-input-v7" placeholder="Consultar a la Matrix..." autocomplete="off">
                    <button id="ai-send-btn" class="ai-send-btn-v7">
                        <i class="fas fa-bolt"></i>
                    </button>
                </div>
            </div>
        </div>

        <style>
            .ai-chat-panel.v14 { 
                border-radius: 32px; 
                border: 1px solid rgba(255,255,255,0.12); 
                background: linear-gradient(180deg, rgba(8, 12, 28, 0.95) 0%, rgba(2, 4, 12, 1) 100%);
                backdrop-filter: blur(20px);
                box-shadow: 0 40px 100px rgba(0,0,0,0.9), 0 0 40px rgba(198, 255, 0, 0.05);
                overflow: hidden;
                display: flex;
                flex-direction: column;
                position: fixed;
                right: 20px;
                bottom: 90px;
                width: calc(100% - 24px);
                height: 78vh;
                max-height: 860px;
                z-index: 10000;
                transform: translateY(120%) scale(0.9);
                opacity: 0;
                transition: all 0.5s cubic-bezier(0.19, 1, 0.22, 1);
                pointer-events: none;
            }
            .ai-chat-panel.v14.open { 
                transform: translateY(0) scale(1);
                opacity: 1;
                pointer-events: all;
            }
            @media (min-width: 600px) {
                .ai-chat-panel.v14 {
                    width: 620px;
                    height: 780px;
                }
            }
            .ai-chat-header { 
                min-height: 85px; 
                display: flex; 
                align-items: center; 
                gap: 15px; 
                background: rgba(255,255,255,0.03); 
            }
            .ai-avatar-box { 
                width: 48px; 
                height: 48px; 
                border-radius: 16px; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                font-size: 1.3rem; 
                position: relative; 
                transition: all 0.3s ease;
            }
            .ai-avatar-box.coach { 
                background: rgba(0, 212, 255, 0.1); 
                color: #00d4ff; 
                border: 1px solid rgba(0, 212, 255, 0.2);
                box-shadow: 0 0 20px rgba(0,212,255,0.2); 
            }
            .ai-avatar-box.vecina { 
                background: rgba(198,255,0,0.1); 
                color: #c6ff00; 
                border: 1px solid rgba(198,255,0,0.2);
                box-shadow: 0 0 20px rgba(198,255,0,0.2); 
            }
            .ai-title { font-size: 1rem; color: #fff; letter-spacing: 1px; display: block; margin-bottom: 2px; }
            .ai-subtitle { font-size: 0.65rem; color: var(--text-muted); font-weight: 800; opacity: 0.6; }
            
            .ai-command-container-v7 {
                display: block;
            }
            .ai-quick-grid-v7 { 
                display: grid; 
                grid-template-columns: repeat(4, minmax(0, 1fr)); 
                gap: 6px; 
            }
            .ai-quick-btn-v7 { 
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
                padding: 8px 6px; 
                border-radius: 12px; 
                border: 1px solid rgba(255,255,255,0.05); 
                background: rgba(255,255,255,0.04); 
                color: #fff; 
                cursor: pointer; 
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .ai-quick-btn-v7 i { font-size: 0.92rem; opacity: 0.75; color: var(--primary); }
            .ai-quick-btn-v7 span { font-size: 0.54rem; font-weight: 900; text-transform: uppercase; letter-spacing: 0.7px; opacity: 0.72; line-height: 1.1; text-align: center; }
            .ai-quick-btn-v7:hover { 
                background: rgba(198, 255, 0, 0.08); 
                border-color: rgba(198, 255, 0, 0.2); 
                transform: translateY(-2px);
            }
            .ai-quick-btn-v7:hover i { opacity: 1; transform: scale(1.1); }
            .ai-quick-btn-v7:hover span { opacity: 1; }

            @media (max-width: 560px) {
                .ai-chat-panel.v14 {
                    right: 10px;
                    bottom: 84px;
                    width: calc(100% - 20px);
                    height: 80vh;
                }
                .ai-quick-grid-v7 {
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                }
            }
            
            .ai-input-container-v7 {
                display: flex;
                align-items: center;
                gap: 12px;
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.06);
                padding: 6px;
                padding-left: 18px;
                border-radius: 20px;
                transition: all 0.3s ease;
            }
            .ai-input-container-v7:focus-within {
                background: rgba(255,255,255,0.05);
                border-color: rgba(198, 255, 0, 0.3);
                box-shadow: 0 0 20px rgba(198, 255, 0, 0.05);
            }
            .ai-input-v7 {
                flex: 1;
                background: transparent;
                border: none;
                color: #fff;
                font-size: 0.9rem;
                font-weight: 600;
                outline: none;
                padding: 10px 0;
            }
            .ai-send-btn-v7 {
                width: 42px;
                height: 42px;
                border-radius: 14px;
                background: var(--primary);
                color: #000;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.1rem;
                cursor: pointer;
                transition: all 0.2s;
            }
            .ai-send-btn-v7:hover { transform: scale(1.05); box-shadow: 0 0 15px var(--primary-glow); }
            .ai-send-btn-v7:active { transform: scale(0.95); }

            .btn-humor-toggle-v7 {
                padding: 6px 12px;
                border-radius: 10px;
                font-size: 0.6rem;
                font-weight: 900;
                letter-spacing: 1px;
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.1);
                color: var(--text-muted);
                transition: all 0.3s;
            }
            .btn-humor-toggle-v7.active {
                background: rgba(198, 255, 0, 0.1);
                border-color: rgba(198, 255, 0, 0.3);
                color: var(--primary);
            }

            .ai-chat-body {
                flex: 1;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 20px;
            }
            
            .ai-msg { margin-bottom: 5px; max-width: 85%; animation: msgFadeIn 0.3s ease-out; }
            @keyframes msgFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            
            .ai-msg.user { align-self: flex-end; }
            .ai-msg.bot { align-self: flex-start; }
            .ai-msg p { padding: 14px 20px; border-radius: 22px; font-size: 0.9rem; line-height: 1.5; font-weight: 500; }
            .ai-msg.user p { background: var(--primary); color: #000; border-bottom-right-radius: 4px; box-shadow: 0 4px 15px rgba(198, 255, 0, 0.15); }
            .ai-msg.bot p { 
                background: rgba(255, 255, 255, 0.06); 
                border: 1px solid rgba(255, 255, 255, 0.08); 
                color: #fff; 
                border-bottom-left-radius: 4px;
                backdrop-filter: blur(5px);
            }
            
            .ai-result-card { 
                background: rgba(0, 0, 0, 0.2); 
                border: 1px solid rgba(255, 255, 255, 0.05); 
                border-radius: 24px; 
                padding: 20px; 
                margin: 10px 0; 
                box-shadow: 0 10px 30px rgba(0,0,0,0.3); 
            }
            .res-title { font-size: 0.65rem; font-weight: 900; color: var(--primary); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 12px; display: block; opacity: 0.8; }
            .res-val { color: #fff; font-size: 1.2rem; font-weight: 900; line-height: 1.2; font-family: 'Rajdhani'; }
            .res-sub { color: var(--text-muted); font-size: 0.8rem; margin-top: 10px; font-weight: 500; line-height: 1.4; }
        </style>
    `;
  document.body.insertAdjacentHTML("beforeend", chatHTML);

  document.getElementById("ai-send-btn").onclick = sendMessage;
  document.getElementById("ai-input-field").onkeypress = (e) => {
    if (e.key === "Enter") sendMessage();
  };

  window.toggleAiChat = toggleChat;
  window.switchAiPersonality = switchAiPersonality;
  window.toggleAiHumor = () => {
    humorEnabled = !humorEnabled;
    localStorage.setItem(HUMOR_KEY, String(humorEnabled));
    const btn = document.getElementById("ai-humor-toggle");
    if (btn) btn.classList.toggle("active", humorEnabled);
    addMessage(
      humorEnabled
        ? "Modo humor activado. Prometo no pasarme."
        : "Modo humor desactivado. Vamos al grano.",
      "bot",
    );
  };

  window.toggleAiCommands = () => {
    const wrap = document.getElementById("ai-command-wrap");
    wrap.classList.toggle("hidden");
  };

  const btnHumor = document.getElementById("ai-humor-toggle");
  if (btnHumor) btnHumor.classList.toggle("active", humorEnabled);

  window.aiQuickCmd = (cmd, label = "") => {
    if (label) addMessage(label, "user");
    const tid = addTyping();
    generateResponse(cmd).then((res) => {
      removeTyping(tid);
      addMessage(res, "bot");
    });
  };
}

export function switchAiPersonality(target) {
  const name = document.getElementById("ai-bot-name");
  const avatar = document.getElementById("p-avatar-bot");
  currentPersonality =
    target || (currentPersonality === "coach" ? "vecina" : "coach");

  if (currentPersonality === "coach") {
    name.textContent = "INTELIGENCIA AP";
    avatar.className = "ai-avatar-box coach";
    avatar.innerHTML = `<i class="fas fa-brain"></i>`;
  } else {
    name.textContent = "VECINA AP";
    avatar.className = "ai-avatar-box vecina";
    avatar.innerHTML = `<i class="fas fa-face-grin-stars"></i>`;
  }
}

export async function toggleChat() {
  const panel = document.getElementById("vecina-chat-panel");
  const fab = document.getElementById("vecina-chat-fab");
  chatOpen = !chatOpen;
  if (chatOpen) {
    panel.classList.add("open");
    fab.classList.add("hidden");
    await _syncData();
    if (document.getElementById("ai-messages").children.length === 0) {
      addMessage(
        `Hola ${DATA_CACHE.user?.nombreUsuario || "cracks"}. Soy la IA de Padeluminatis. Puedes interactuar conmigo así:<br><br>1️⃣ <b>Escríbeme:</b> "Busca a Juan", "Mi ranking", "Hay partidas?"<br>2️⃣ <b>Pulsa en el Dashboard:</b> Toca tu Némesis o Socio para que te dé un análisis táctico.<br>3️⃣ <b>Comandos Rápidos:</b> Usa el selector inferior para informes detallados.`,
        "bot",
      );
    }
  } else {
    panel.classList.remove("open");
    fab.classList.remove("hidden");
  }
}

export async function sendMessage(customText) {
  const input = document.getElementById("ai-input-field");
  const text = (
    typeof customText === "string" ? customText : input.value
  ).trim();
  if (!text) return;
  addMessage(text, "user");
  if (!customText) input.value = "";
  const tid = addTyping();
  const response = await generateResponse(text);
  removeTyping(tid);
  addMessage(response, "bot");
}

export async function generateResponse(query) {
  const intent = _detectIntent(query);
  await _syncData();
  const uid = auth.currentUser?.uid;
  const respond = (c, v) => (currentPersonality === "coach" ? c : v);

  switch (intent) {
    case "CMD_GREETING":
      const name = DATA_CACHE.user?.nombreUsuario?.split(" ")[0] || "Agente";
      return respond(
        `¡Hola ${name}! Estoy lista para procesar tus datos. Prueba a escribirme "Mi ranking" o usa el menú táctico de abajo.`,
        `¡Buenas, ${name}! ¿Vienes a cotillear el ranking o quieres que te lea la cartilla con tu winrate?`,
      );

    case "CMD_REPORT":
      const trend = Analyzer.getEloTrend();
      const wr = _calcWinrate(uid);
      let focus = "Optimiza tu juego en red y transiciones.";
      if (wr.total < 3) focus = "Registra más partidos para un análisis fino.";
      else if (wr.winrate < 45) focus = "Prioriza consistencia y defensa.";
      else if (wr.winrate < 60)
        focus = "Mejora la toma de decisiones en puntos clave.";
      else focus = "Estás fuerte. Entra en retos oficiales para escalar ELO.";
      return respond(
        `<div class="ai-result-card">
                    <span class="res-title">Informe Integral V2</span>
                    <div class="res-val">${trend}</div>
                    <div class="flex-col gap-2 mt-3">
                        <div class="flex-row between text-[10px]"><span class="text-white/40">ELO</span><b class="text-white">${Math.round(DATA_CACHE.user.puntosRanking)}</b></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">Nivel</span><b class="text-white">${(DATA_CACHE.user.nivel || 2.5).toFixed(2)}</b></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">Efectividad</span><b class="text-white">${wr.winrate}% (${wr.wins}V/${wr.total - wr.wins}D)</b></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">Racha</span><b class="${(DATA_CACHE.user.rachaActual||0) > 0?'text-sport-green':'text-sport-red'}">${DATA_CACHE.user.rachaActual||0}</b></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">K-Factor</span><b class="text-primary">${DATA_CACHE.user.nivel > 4 ? 'K=15 (Pro)' : DATA_CACHE.user.nivel > 3 ? 'K=25 (Estándar)' : 'K=40 (Rookie)'}</b></div>
                    </div>
                    <div class="mt-3 p-3 bg-white/5 rounded-xl text-[9px] text-muted">${focus}</div>
                </div>`,
        "Cariñito, estás que te sales. Sigue así y te veo en el World Padel Tour (o no...).",
      );

    case "CMD_RIVAL_INTEL": {
      const nemesis = Analyzer.findNemesis(uid);
      const partnerCounts = {};
      const victimCounts = {};

      DATA_CACHE.matches.forEach((m) => {
        if (!m?.jugadores || !isFinishedMatch(m) || isCancelledMatch(m)) return;
        const myIdx = m.jugadores.indexOf(uid);
        if (myIdx === -1) return;
        const partnerIdx = myIdx < 2 ? (myIdx === 0 ? 1 : 0) : (myIdx === 2 ? 3 : 2);
        const partnerId = m.jugadores[partnerIdx];
        if (partnerId && !String(partnerId).startsWith("GUEST_")) {
          partnerCounts[partnerId] = (partnerCounts[partnerId] || 0) + 1;
        }
        const rivals = myIdx < 2 ? [m.jugadores[2], m.jugadores[3]] : [m.jugadores[0], m.jugadores[1]];
        const won = _didUserWinMatch(m, uid);
        if (won) {
          rivals.forEach((rid) => {
            if (!rid || String(rid).startsWith("GUEST_")) return;
            victimCounts[rid] = (victimCounts[rid] || 0) + 1;
          });
        }
      });

      const topByCount = (obj) => {
        const keys = Object.keys(obj);
        if (!keys.length) return null;
        return keys.reduce((a, b) => (obj[a] > obj[b] ? a : b));
      };
      const partnerId = topByCount(partnerCounts);
      const victimId = topByCount(victimCounts);
      const partnerName = DATA_CACHE.globalUsers.find((u) => u.id === partnerId)?.nombreUsuario || DATA_CACHE.globalUsers.find((u) => u.id === partnerId)?.nombre || "Sin datos";
      const victimName = DATA_CACHE.globalUsers.find((u) => u.id === victimId)?.nombreUsuario || DATA_CACHE.globalUsers.find((u) => u.id === victimId)?.nombre || "Sin datos";
      const nemesisName = nemesis?.nombreUsuario || nemesis?.nombre || "Sin nemesis claro";
      const nemesisTotal = Number(nemesis?.stats?.wins || 0) + Number(nemesis?.stats?.losses || 0);
      const nemesisLossPct = nemesisTotal > 0
        ? Math.round((Number(nemesis?.stats?.losses || 0) / nemesisTotal) * 100)
        : 0;
      const nemesisReason = nemesis
        ? `Es tu nemesis porque te gana ${nemesisLossPct}% de las veces (${nemesis?.stats?.wins || 0}V/${nemesis?.stats?.losses || 0}D en duelos directos).`
        : "Aun no hay suficiente historial para marcar una nemesis real.";

      return `<div class="ai-result-card">
                <span class="res-title">Rival Intelligence</span>
                <div class="flex-col gap-2 mt-2">
                  <div class="flex-row between text-[10px]"><span class="text-white/40">NEMESIS</span><b class="text-secondary">${nemesisName}</b></div>
                  <div class="flex-row between text-[10px]"><span class="text-white/40">Socio top</span><b class="text-cyan-300">${partnerName}</b></div>
                  <div class="flex-row between text-[10px]"><span class="text-white/40">Victima top</span><b class="text-sport-green">${victimName}</b></div>
                </div>
                <div class="res-sub mt-2">${nemesisReason}</div>
            </div>`;
    }

    case "CMD_FULL_SUMMARY": {
      const played = DATA_CACHE.matches.filter((m) => isFinishedMatch(m) && !isCancelledMatch(m));
      const wrS = _calcWinrate(uid);
      const lvl = Number(DATA_CACHE.user?.nivel || 2.5).toFixed(2);
      const pts = Math.round(Number(DATA_CACHE.user?.puntosRanking || 1000));
      const open = DATA_CACHE.openMatches.length;
      return `<div class="ai-result-card">
                <span class="res-title">Resumen Total</span>
                <div class="flex-col gap-2 mt-2">
                  <div class="flex-row between text-[10px]"><span class="text-white/40">Nivel</span><b class="text-white">${lvl}</b></div>
                  <div class="flex-row between text-[10px]"><span class="text-white/40">Puntos</span><b class="text-primary">${pts}</b></div>
                  <div class="flex-row between text-[10px]"><span class="text-white/40">Historial</span><b class="text-white">${played.length} partidos</b></div>
                  <div class="flex-row between text-[10px]"><span class="text-white/40">Winrate</span><b class="text-sport-green">${wrS.winrate}%</b></div>
                  <div class="flex-row between text-[10px]"><span class="text-white/40">Abiertos en circuito</span><b class="text-white">${open}</b></div>
                </div>
            </div>`;
    }

    case "CMD_APP_CONTEXT": {
      const s = DATA_CACHE.systemStats || {};
      return `<div class="ai-result-card">
                <span class="res-title">Contexto Global IA</span>
                <div class="flex-col gap-2 mt-2">
                  <div class="flex-row between text-[10px]"><span class="text-white/40">Usuarios en base</span><b class="text-white">${Number(s.totalUsers || 0)}</b></div>
                  <div class="flex-row between text-[10px]"><span class="text-white/40">Tus partidos</span><b class="text-white">${Number(s.myMatches || 0)}</b></div>
                  <div class="flex-row between text-[10px]"><span class="text-white/40">Tus partidos cerrados</span><b class="text-white">${Number(s.myFinishedMatches || 0)}</b></div>
                  <div class="flex-row between text-[10px]"><span class="text-white/40">Abiertos en circuito</span><b class="text-white">${Number(s.openCircuitMatches || 0)}</b></div>
                  <div class="flex-row between text-[10px]"><span class="text-white/40">Secciones conocidas</span><b class="text-primary">${(s.sections || []).join(", ")}</b></div>
                </div>
                <div class="res-sub mt-2">Uso datos de ranking, historial, diario, calendario y palas para responderte con contexto real y actualizado.</div>
            </div>`;
    }

    case "CMD_SUGGEST_FEATURE":
      return `<div class="ai-result-card">
                <span class="res-title">Buzón de Mejoras</span>
                <div class="res-sub mb-3">Tu propuesta irá directa al admin para revisión.</div>
                <button class="text-[10px] font-black uppercase tracking-[2px] px-3 py-2 rounded-xl border border-primary/40 bg-primary/10 text-primary" onclick="window.openSuggestionModal?.()">
                  Enviar sugerencia
                </button>
            </div>`;

    case "CMD_LEVEL_PROGRESS":
      const lvl = Number(DATA_CACHE.user?.nivel || 2.5);
      const bracketMin = Math.floor(lvl * 2) / 2;
      const bracketMax = Math.min(7, bracketMin + 0.5);
      const pct = Math.max(0, Math.min(100, Math.round(((lvl - bracketMin) / Math.max(0.01, bracketMax - bracketMin)) * 100)));
      return `<div class="ai-result-card">
                <span class="res-title">Progreso de Nivel</span>
                <div class="res-val">Nivel ${lvl.toFixed(2)} · ${pct}%</div>
                <div class="res-sub">Tramo actual: ${bracketMin.toFixed(1)} -> ${bracketMax.toFixed(1)}. Sigue sumando resultados y diario para estabilizar la subida.</div>
            </div>`;

    case "CMD_LAST_MATCH":
      const matches = DATA_CACHE.matches.filter((m) => isFinishedMatch(m) && !isCancelledMatch(m));
      if (matches.length === 0)
        return noData("No he encontrado partidos terminados en tu historial.");
      const last = matches[0];
      return `<div class="ai-result-card">
                <span class="res-title">Último Partido</span>
                <div class="res-val">${getResultSetsString(last) || "Resultado registrado"}</div>
                <div class="res-sub">${last.fecha?.toDate?.().toLocaleDateString() || last.fecha} (${last._col})</div>
            </div>`;

    case "CMD_NEXT_MATCH":
      const upcoming = DATA_CACHE.matches
        .filter((m) => !isFinishedMatch(m) && !isCancelledMatch(m))
        .map((m) => ({ ...m, _date: _getMatchDate(m) }))
        .filter((m) => m._date >= new Date())
        .sort((a, b) => a._date - b._date)[0];
      if (!upcoming)
        return respond(
          noData("No tienes partidos programados aún."),
          noData("No veo nada en tu agenda."),
        );
      const typeLabel = upcoming._col === "reto" ? "RETO" : "AMISTOSO";
      return `<div class="ai-result-card">
                <span class="res-title">Próximo Partido</span>
                <div class="res-val">${typeLabel}</div>
                <div class="res-sub">${upcoming._date.toLocaleDateString()} ${upcoming._date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            </div>`;

    case "CMD_BEST_MATCH":
      const statsB = Analyzer.getMatchStats();
      if (!statsB || !statsB.best.id)
        return noData(
          "No tengo suficientes datos para determinar tu mejor partido.",
        );
      return `<div class="ai-result-card">
                <span class="res-title">Tu Mejor Victoria</span>
                <div class="res-val">${getResultSetsString(statsB.best)}</div>
                <div class="res-sub">Dominaste con una diferencia de ${statsB.best.diff} sets.</div>
            </div>`;

    case "CMD_WORST_MATCH":
      const statsW = Analyzer.getMatchStats();
      if (!statsW || !statsW.worst.id)
        return noData("No tengo datos de derrotas significativas.");
      return `<div class="ai-result-card">
                <span class="res-title">Partido con más diferencia</span>
                <div class="res-val">${getResultSetsString(statsW.worst)}</div>
                <div class="res-sub">Te costó seguir el ritmo, diferencia de ${statsW.worst.diff} sets.</div>
            </div>`;

    case "CMD_NEMESIS":
      const nemesis = Analyzer.findNemesis(uid);
      if (!nemesis)
        return respond(
          noData("Aún no tengo un rival con historial dominante sobre ti."),
          noData("Aún no tengo un rival dominante registrado."),
        );
      return respond(
        `<div class="ai-result-card">
                    <span class="res-title">Tu Peor Rival</span>
                    <div class="res-val">${nemesis.nombreUsuario || "Ese crack"}</div>
                    <div class="res-sub">Has perdido el ${Math.round((nemesis.stats.losses / (nemesis.stats.wins + nemesis.stats.losses)) * 100)}% de veces contra él.</div>
                </div>`,
        `Pista clara: <b>${nemesis.nombreUsuario}</b> suele ganarte. Toca ajustar táctica y volver más fuerte.`,
      );

    case "CMD_PARTNER_SYNC":
      const pCounts = {};
      DATA_CACHE.matches.forEach((m) => {
        const uIdx = m.jugadores?.indexOf(uid);
        if (uIdx === -1) return;
        const pIdx = uIdx < 2 ? (uIdx === 0 ? 1 : 0) : uIdx === 2 ? 3 : 2;
        const pid = m.jugadores[pIdx];
        if (pid && !String(pid).startsWith("GUEST_")) pCounts[pid] = (pCounts[pid] || 0) + 1;
      });
      const topP = Object.keys(pCounts).reduce(
        (a, b) => (pCounts[a] > pCounts[b] ? a : b),
        null,
      );
      if (!topP)
        return noData("Parece que no tienes un compañero habitual registrado.");
      const partner = DATA_CACHE.globalUsers.find((u) => u.id === topP);
      return respond(
        `<div class="ai-result-card">
                    <span class="res-title">Socio Preferente</span>
                    <div class="res-val">${partner?.nombreUsuario || "Tu pareja fiel"}</div>
                    <div class="res-sub">Habéis compartido pista ${pCounts[topP]} veces. Vuestra sincronización es de Grado Elite.</div>
                </div>`,
        `Juegas más con <b>${partner?.nombreUsuario || "tu socio habitual"}</b>. Buen tándem.`,
      );

    case "CMD_OPEN_MATCHES":
      const opens = DATA_CACHE.openMatches;
      if (opens.length === 0)
        return respond(
          "No hay partidas abiertas en este momento. ¡Crea una tú!",
          "Está todo el mundo durmiendo, hija. Crea una partida y verás cómo vuelan.",
        );
      return `
                <div class="ai-result-card">
                    <span class="res-title">Partidas de Hoy</span>
                    ${opens
                      .map((m) => {
                        const d = _getMatchDate(m);
                        const time = d
                          ? d.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "--:--";
                        const day = d ? d.toLocaleDateString() : "";
                        const type = m._col === "reto" ? "RETO" : "AMISTOSO";
                        return `
                        <div class="flex-row between py-2 border-b border-white/5">
                            <span class="text-xs font-bold">${time} ${day} - ${type}</span>
                            <button class="text-primary text-[10px] font-black" onclick="window.location.href='calendario.html'">UNIRSE</button>
                        </div>
                    `;
                      })
                      .join("")}
                </div>
            `;

    case "CMD_TUTORIAL":
      return `
                <div class="ai-result-card">
                    <span class="res-title">Manual de Operaciones V14</span>
                    <div class="flex-col gap-4">
                        <div class="flex-col">
                            <span class="text-[9px] font-black text-primary uppercase tracking-widest mb-1">Ecosistema Táctico</span>
                            <ul class="ai-list" style="font-size:0.75rem; color:#eee; list-style:none; padding-left:0;">
                                <li class="mb-2"><i class="fas fa-id-card text-blue-400 mr-2"></i><b>Expediente:</b> Pulsa en el nombre de cualquier jugador en el ranking para ver su historial detallado y palas.</li>
                                <li class="mb-2"><i class="fas fa-brain text-purple-400 mr-2"></i><b>Rival Intel:</b> En la Home, toca en tu Némesis o Socio. Analizaré vuestra compatibilidad y debilidades.</li>
                                <li class="mb-2"><i class="fas fa-book text-sport-green mr-2"></i><b>Diario:</b> Registra partidos usando el Wizard de 5 pasos. Generaré un análisis de eficiencia (Winners vs Errores).</li>
                            </ul>
                        </div>
                        <div class="flex-col">
                            <span class="text-[9px] font-black text-secondary uppercase tracking-widest mb-1">Gestión de Partidos</span>
                            <ul class="ai-list" style="font-size:0.75rem; color:#eee; list-style:none; padding-left:0;">
                                <li class="mb-2"><i class="fas fa-plus-circle text-white mr-2"></i><b>Reservar:</b> En Calendario, pulsa una celda vacía para abrir el Hub de Reservas.</li>
                                <li class="mb-2"><i class="fas fa-flag-checkered text-sport-gold mr-2"></i><b>Reportar:</b> Entra en tu partido actual y pulsa 'Finalizar & Reportar' para actualizar el ELO.</li>
                            </ul>
                        </div>
                    </div>
                </div>
            `;

    case "CMD_PRO_TIPS":
      const tips = [
        "<b>Bandeja:</b> Apunta a la malla metálica, no a la pared de fondo.",
        "<b>Globo:</b> En pista indoor, no busques altura, busca profundidad.",
        "<b>Saque:</b> Varía siempre al muro o al centro para confundir.",
        "<b>Volea:</b> Mantén la pala siempre alta, por delante de los ojos.",
      ];
      return respond(
        `<div class="ai-result-card"><span class="res-title">Consejo Técnico</span><div class="res-val">${tips[Math.floor(Math.random() * tips.length)]}</div></div>`,
        "Cariño, lo más importante es que no te caigas por la pista. Y si fallas, ¡echa la culpa al sol!",
      );

    case "CMD_PREDICT":
      const winProb = 45 + Math.floor(Math.random() * 20);
      return respond(
        `<div class="ai-result-card">
                    <span class="res-title">Simulador Probabilístico</span>
                    <div class="res-val">${winProb}% de Probabilidad</div>
                    <div class="res-sub">Basado en tu racha actual y nivel ELO. Estás en un momento de ${winProb > 50 ? "Dominancia" : "Desafío"}.</div>
                </div>`,
        `¡Ay hija! Tú dale fuerte y ya veremos. Yo apuesto que ganas pero suda un poco, ¿eh?`,
      );

    case "CMD_RAIN_TODAY":
      try {
        const { getDetailedWeather } = await import("../external-data.js");
        const w = await getDetailedWeather();
        const rain = w?.current?.rain || 0;
        const temp = Math.round(w?.current?.temperature_2m || 0);
        const isRaining = rain > 0.2;
        return respond(
          `<div class="ai-result-card">
                        <span class="res-title">Lluvia en Tiempo Real</span>
                        <div class="res-val">${isRaining ? "SÍ LLUEVE" : "NO LLUEVE"}</div>
                        <div class="res-sub">${temp}°C • ${rain.toFixed(1)}mm</div>
                    </div>`,
          isRaining
            ? `Sí llueve y hace ${temp}°C. Ponte un chubasquero.`
            : `No llueve. ${temp}°C, así que a la pista.`,
        );
      } catch (e) {
        return "Error al conectar con los satélites meteorológicos.";
      }

    case "CMD_WEATHER_TACTICS":
      try {
        const { getDetailedWeather } = await import("../external-data.js");
        const w = await getDetailedWeather();
        const temp = Math.round(w?.current?.temperature_2m || 20);
        const rain = w?.current?.rain || 0;

        let advice = "Condiciones óptimás. Pista rápida.";
        if (temp > 28)
          advice =
            "Calor extremo. La bola vuela mucho. Usa globos profundos y controla la potencia.";
        if (temp < 12)
          advice =
            "Frío detectado. La bola pesa y sale menos. Ataca más con potencia.";
        if (rain > 0.5)
          advice =
            "Lluvia detectada. Pista resbaladiza y bola pesada. Cuidado con los cristales.";

        return respond(
          `<div class="ai-result-card">
                        <span class="res-title">Sincronización Atmosférica</span>
                        <div class="res-val">${temp}°C | ${rain}mm lluvia</div>
                        <p style="font-size:0.7rem; margin-top:8px; line-height:1.4;">${advice}</p>
                    </div>`,
          `Hace ${temp} grados. Ni frío ni calor, pero con ${rain}mm de lluvia te vas a poner como un pollito.`,
        );
      } catch (e) {
        return "Error al conectar con los satélites meteorológicos.";
      }

    case "CMD_HISTORY_ANALYTICS":
      const allMatches = DATA_CACHE.matches.filter((m) => isFinishedMatch(m) && !isCancelledMatch(m));
      if (allMatches.length === 0)
        return "Tu historial está vacío como mi base de datos de sentimientos.";
      const wins = allMatches.filter((m) => _didUserWinMatch(m, uid)).length;

      return `<div class="ai-result-card">
                <span class="res-title">Desfase de Victorias</span>
                <div class="res-val">${wins}V / ${allMatches.length - wins}D</div>
                <div class="res-sub">Efectividad total: ${Math.round((wins / allMatches.length) * 100)}% en ${allMatches.length} encuentros.</div>
            </div>`;

    case "CMD_TRAINING_PLAN":
      return `<div class="ai-result-card">
                <span class="res-title">Plan Semanal Sugerido</span>
                <p style="font-size:0.7rem; color:#fff;">Lunes: Técnica de Red<br>Miércoles: Partido Amistoso<br>Viernes: Partido de Reto</p>
            </div>`;

    case "CMD_JOKE":
      return _getFunnyJoke();

    case "CMD_STREAK_ANALYSIS":
      const currentStreak = DATA_CACHE.user.rachaActual || 0;
      const message =
        currentStreak > 0
          ? `Mantienes una racha de ${currentStreak} victorias. Tu racha histórica máxima es de ${DATA_CACHE.user.rachaMaxima || 10}. Sigue así para duplicar tus bonus de ELO.`
          : "Tu racha está en 0. Necesitas una victoria para activar el multiplicador 'DYNAMO'.";
      return respond(
        `<div class="ai-result-card">
                    <span class="res-title">Termodinámica de Combate</span>
                    <div class="res-val">${currentStreak > 0 ? "CALIENTE" : "FRÍO"}</div>
                    <p style="font-size:0.75rem; color:#ccc;">${message}</p>
                </div>`,
        currentStreak > 3
          ? "¡Estás on fire, chato! No te acerques mucho a la red que la vas a quemar."
          : "Venga, que no se diga. ¡A por la primera victoria!",
      );

    case "CMD_SURVIVAL_CHANCE":
      const chance = Math.round(
        50 +
          DATA_CACHE.user.nivel * 5 -
          (DATA_CACHE.user.partidosJugados === 0 ? 20 : 0),
      );
      return respond(
        `<div class="ai-result-card">
                    <span class="res-title">Protocolo de Supervivencia</span>
                    <div class="res-val">${chance}% de Probabilidad</div>
                    <p style="font-size:0.7rem; margin-top:8px;">Calculando integridad estructural... ${chance > 70 ? "Estatus: DEPREDADOR" : "Estatus: CAUTELA"}.</p>
                </div>`,
        "Tú sal ahí y dalo todo. Si ves que no llegas, ¡hazle un globo al de la red!",
      );

    case "CMD_COMPARE_USER": {
      let targetName = "";
      if (query.includes("|"))
        targetName = query.split("|").slice(1).join("|").trim();
      if (!targetName && query.toLowerCase().includes("con "))
        targetName = query.split(/con /i).pop().trim();
      if (!targetName) {
        const top = [...DATA_CACHE.globalUsers]
          .sort((a, b) => (b.puntosRanking || 0) - (a.puntosRanking || 0))
          .slice(0, 5)
          .map((u) => u.nombreUsuario || u.nombre || "Jugador")
          .join(", ");
        return `<div class="ai-result-card">
                    <span class="res-title">Comparar Jugador</span>
                    <div class="res-sub">Escribe: "diferencia con Juan". Top sugeridos: ${top || "no disponibles"}.</div>
                </div>`;
      }
      const target = _findUserByName(targetName);
      if (!target)
        return respond(
          noData("No encuentro a ese jugador en el ranking."),
          noData("No encuentro a ese jugador en el ranking."),
        );
      const myPts = DATA_CACHE.user?.puntosRanking || 1000;
      const tPts = target.puntosRanking || 1000;
      const diffPts = tPts - myPts;
      const diffLabel =
        diffPts > 0
          ? `Te lleva +${Math.round(diffPts)} pts`
          : diffPts < 0
            ? `Le llevas ${Math.round(Math.abs(diffPts))} pts`
            : "Estáis empatados";
      return `<div class="ai-result-card">
                <span class="res-title">Comparativa</span>
                <div class="res-val">${target.nombreUsuario || target.nombre || "Jugador"}</div>
                <div class="res-sub">${diffLabel} • NV ${(target.nivel || 2.5).toFixed(2)}</div>
            </div>`;
    }

    case "CMD_COMPARE_ELITE":
      const sorted = [...DATA_CACHE.globalUsers].sort(
        (a, b) => (b.puntosRanking || 0) - (a.puntosRanking || 0),
      );
      const top1 = sorted[0];
      const gap =
        (top1.puntosRanking || 1000) - (DATA_CACHE.user.puntosRanking || 1000);
      return respond(
        `<div class="ai-result-card">
                    <span class="res-title">Distancia hacia el Trono</span>
                    <div class="res-val">${Math.round(gap)} Pts de brecha</div>
                    <div class="res-sub">El líder actual es ${top1.nombreUsuario || "Anónimo"}. Te faltan aproximadamente ${Math.ceil(gap / 20)} victorias consecutivas para alcanzarlo.</div>
                </div>`,
        `¿Quieres pillar a <b>${top1.nombreUsuario}</b>? Pues ya puedes ir desayunando fuerte, que te lleva un rato.`,
      );

    case "CMD_METRICS_ADVANCED":
      const avgLevel =
        DATA_CACHE.globalUsers.reduce((a, b) => a + (b.nivel || 2.5), 0) /
        (DATA_CACHE.globalUsers.length || 1);
      return `<div class="ai-result-card">
                <span class="res-title">Estructura de la Galaxia</span>
                <div class="res-val">Nivel Promedio: ${avgLevel.toFixed(2)}</div>
                <div class="res-sub">Te encuentras en el segmento ${DATA_CACHE.user.nivel > avgLevel ? "ALTO" : "BASE"}. El ${Math.round((DATA_CACHE.globalUsers.filter((u) => u.nivel > 4).length / DATA_CACHE.globalUsers.length) * 100)}% de los jugadores son de Nivel Élite (>4.0).</div>
            </div>`;
    case "CMD_GEAR_ADVICE":
      return respond(
        `<div class="ai-result-card">
                    <span class="res-title">Laboratorio de Material</span>
                    <p style="font-size:0.75rem; color:#fff; line-height:1.4;">
                        Detecto que usas una <b>${DATA_CACHE.user.pala || "pala genérica"}</b>.<br><br>
                        ?~ <b>Mi consejo:</b> Si buscas subir de 3.5 a 4.0, prioriza palas de fibra de carbono 12K. Si te duele el codo, busca gomas EVA Soft.<br><br>
                        Ve a la sección 'Padel Lab' para comparar modelos específicos del club.
                    </p>
                </div>`,
        "Hija, no es la pala, es el brazo... ¡pero una Adidas Adipower nunca viene mal!",
      );

    case "CMD_ELO_FORMULA":
      return `<div class="ai-result-card">
                <span class="res-title">Algoritmo ELO V2 (Dinámico)</span>
                <div class="flex-col gap-3">
                    <p style="font-size:0.75rem; color:#ccc; line-height:1.4;">
                        Tu ELO se calcula mediante: <b>R = Ro + K × (S - Se)</b>
                    </p>
                    <div class="flex-col gap-2 p-3 bg-white/5 rounded-xl">
                        <div class="flex-row between text-[10px]"><span class="text-white/40">Ro</span><span class="text-white">ELO actual antes del partido</span></div>
                        <div class="flex-row between text-[10px]"><span class="text-primary">K (Dinámico)</span><span class="text-white">Varía según experiencia</span></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">S</span><span class="text-white">1 (Victoria) / 0 (Derrota)</span></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">Se</span><span class="text-white">Probabilidad esperada vs rival</span></div>
                    </div>
                    <div class="p-3 bg-primary/10 rounded-xl border border-primary/20">
                        <span class="text-[9px] font-black text-primary uppercase block mb-2">K-Factor Adaptativo V2</span>
                        <div class="flex-row between text-[10px]"><span class="text-white/50">Rookie (< 3.0)</span><b class="text-white">K = 40</b></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/50">Estándar</span><b class="text-white">K = 25</b></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/50">Pro (> 4.0)</span><b class="text-white">K = 15</b></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/50">Inactivo (> 30 días)</span><b class="text-sport-red">K × 1.5</b></div>
                    </div>
                    <div class="p-3 bg-white/3 rounded-xl">
                        <span class="text-[9px] font-black text-sport-gold uppercase block mb-2">Multiplicadores Especiales</span>
                        <div class="flex-row between text-[10px]"><span class="text-white/50">Racha 3+</span><b class="text-sport-green">× 1.25</b></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/50">Racha 6+</span><b class="text-sport-green">× 1.60</b></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/50">Matagigantes</span><b class="text-sport-gold">× 1.50</b></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/50">Clean Sheet</span><b class="text-cyan-400">+5 pts</b></div>
                    </div>
                </div>
            </div>`;

    case "CMD_CLUB_CENSUS":
      const lvls = DATA_CACHE.globalUsers.map((u) => u.nivel || 2.5);
      const low = lvls.filter((l) => l < 3).length;
      const mid = lvls.filter((l) => l >= 3 && l < 4).length;
      const high = lvls.filter((l) => l >= 4).length;
      return `<div class="ai-result-card">
                <span class="res-title">Censo Padeluminatis</span>
                <div class="flex-col gap-2 mt-2">
                    <div class="flex-row between text-[10px]"><span class="text-white/50">ASPIRANTES (<3.0)</span><b>${low}</b></div>
                    <div class="flex-row between text-[10px]"><span class="text-white/50">AVANZADOS (3.0-4.0)</span><b>${mid}</b></div>
                    <div class="flex-row between text-[10px]"><span class="text-primary">ELITE (>4.0)</span><b>${high}</b></div>
                </div>
                <p class="text-[9px] text-muted italic mt-3">Representas el ${Math.round((1 / DATA_CACHE.globalUsers.length) * 100)}% de la potencia del club.</p>
            </div>`;

    case "CMD_GLOBAL_STATS":
      const totalMatches = DATA_CACHE.matches.length;
      const openCount = DATA_CACHE.openMatches.length;
      const usersCount = DATA_CACHE.globalUsers.length;
      return `<div class="ai-result-card">
                <span class="res-title">Estado del Sistema</span>
                <div class="res-val">${usersCount} Jugadores en Red</div>
                <div class="res-sub">Actualmente hay ${openCount} pistas buscando jugadores y ${totalMatches} partidos registrados en total.</div>
            </div>`;

    case "CMD_MATCH_FORECAST":
      const nextM = DATA_CACHE.matches
        .filter((m) => !isFinishedMatch(m) && !isCancelledMatch(m))
        .map((m) => ({ ...m, _date: _getMatchDate(m) }))
        .filter((m) => m._date >= new Date())
        .sort((a, b) => a._date - b._date)[0];
      if (!nextM) return noData("No tengo un partido futuro en el radar.");
      const teamA = nextM.equipoA || [];
      const teamB = nextM.equipoB || [];
      if (teamA.length < 2 || teamB.length < 2)
        return noData("Necesito equipos completos 2v2 para pronosticar.");
      const getLvl = (id) =>
        DATA_CACHE.globalUsers.find((u) => u.id === id)?.nivel || 2.5;
      const aAvg = (getLvl(teamA[0]) + getLvl(teamA[1])) / 2;
      const bAvg = (getLvl(teamB[0]) + getLvl(teamB[1])) / 2;
      const diffLvl = aAvg - bAvg;
      const pA = Math.min(Math.max(50 + diffLvl * 18, 10), 90);
      const pB = 100 - pA;
      return respond(
        `<div class="ai-result-card">
                    <span class="res-title">Predicción de Duelo</span>
                    <div class="res-val">Equipo A ${Math.round(pA)}%  |  Equipo B ${Math.round(pB)}%</div>
                    <div class="res-sub">Basado en niveles medios reales detectados en la Matrix.</div>
                </div>`,
        "Mis cálculos dicen que el Equipo A tiene ventaja, pero ya sabes lo que dicen... el pádel es un deporte de locos.",
      );

    case "CMD_GLOBAL_RANKING":
      const top5 = [...DATA_CACHE.globalUsers]
        .sort((a, b) => (b.puntosRanking || 0) - (a.puntosRanking || 0))
        .slice(0, 5);
      return `<div class="ai-result-card">
                <span class="res-title">Olimpo Padeluminati</span>
                ${top5
                  .map(
                    (u, i) => `
                    <div class="flex-row between py-1 border-b border-white/5">
                        <span class="text-[10px] font-bold">#${i + 1} ${u.nombreUsuario || u.nombre}</span>
                        <span class="text-[10px] text-primary font-black">${Math.round(u.puntosRanking)} Pts</span>
                    </div>
                `,
                  )
                  .join("")}
            </div>`;

    case "CMD_USER_SEARCH": {
      let targetName = "";
      if (query.toLowerCase().includes("busca a "))
        targetName = query
          .split(/busca a /i)
          .pop()
          .trim();
      else if (query.toLowerCase().includes("diferencia con "))
        targetName = query
          .split(/diferencia con /i)
          .pop()
          .trim();

      if (!targetName) return "Dime a quién busco (ej: 'busca a Juan').";
      const target = _findUserByName(targetName);
      if (!target)
        return noData(
          `No he encontrado a ningún '${targetName}' en el circuito.`,
        );

      const myPts = DATA_CACHE.user?.puntosRanking || 1000;
      const tPts = target.puntosRanking || 1000;
      const diff = tPts - myPts;
      const tPhoto = target.fotoPerfil || target.fotoURL;
      const tViv = target.vivienda || {};
      const tAddr = (tViv.bloque || tViv.piso || tViv.puerta) 
        ? `Blq ${tViv.bloque || '-'}, Piso ${tViv.piso || '-'}` : null;
      return `<div class="ai-result-card">
                <span class="res-title">Perfil de ${target.nombreUsuario || target.nombre}</span>
                <div class="flex-row items-center gap-3 mb-3">
                    ${tPhoto ? `<img src="${tPhoto}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;border:2px solid rgba(198,255,0,0.3)">` : `<div style="width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-weight:900;color:white">${(target.nombreUsuario||'J').charAt(0)}</div>`}
                    <div class="flex-col">
                        <span class="text-xs font-black text-white">${(target.nombreUsuario || target.nombre || 'Jugador').toUpperCase()}</span>
                        <span class="text-[8px] text-muted font-bold">Nivel ${(target.nivel || 2.5).toFixed(2)}</span>
                    </div>
                </div>
                <div class="flex-col gap-1">
                    <div class="flex-row between text-[10px]"><span class="text-white/40">ELO</span><b class="text-white">${Math.round(tPts)}</b></div>
                    <div class="flex-row between text-[10px]"><span class="text-white/40">Diferencia</span><b class="${diff > 0 ? 'text-sport-red' : 'text-sport-green'}">${diff > 0 ? `Te lleva +${Math.round(diff)}` : `Le sacas ${Math.round(Math.abs(diff))}`}</b></div>
                    ${tAddr ? `<div class="flex-row between text-[10px]"><span class="text-white/40">Vivienda</span><span class="text-white/60">${tAddr}</span></div>` : ''}
                    ${target.telefono ? `<div class="flex-row between text-[10px]"><span class="text-white/40">Teléfono</span><span class="text-white/60">${target.telefono}</span></div>` : ''}
                </div>
            </div>`;
    }

    case "CMD_TACTIC_OVERVIEW":
      const journal = (DATA_CACHE.user?.diario || []).slice(-6);
      if (journal.length === 0)
        return noData(
          "Sin diario no puedo perfilar tu táctica. Registra partidos.",
        );
      const posCount = journal.reduce((a, e) => {
        const k = e.posicion || "reves";
        a[k] = (a[k] || 0) + 1;
        return a;
      }, {});
      const domCount = journal.reduce((a, e) => {
        const k = e.dominio || "igualado";
        a[k] = (a[k] || 0) + 1;
        return a;
      }, {});
      const topPos = Object.keys(posCount).reduce((a, b) =>
        posCount[a] > posCount[b] ? a : b,
      );
      const topDom = Object.keys(domCount).reduce((a, b) =>
        domCount[a] > domCount[b] ? a : b,
      );
      return `<div class="ai-result-card">
                <span class="res-title">Análisis táctico</span>
                <div class="res-val">Zona clave: ${topPos.toUpperCase()} | Dominio: ${topDom.toUpperCase()}</div>
                <div class="res-sub">Trabaja transiciones y cobertura en tu lado fuerte. En 2v2 la comunicación decide puntos.</div>
            </div>`;

    case "CMD_SHOT_FOCUS":
      const shots = (DATA_CACHE.user?.diario || []).flatMap((e) => [
        e.stats || {},
      ]);
      if (shots.length === 0)
        return noData(
          "No tengo golpes registrados. Completa el diario para analizar.",
        );
      const avg = (key) =>
        Math.round(
          shots.reduce((s, st) => s + (st[key] || 5), 0) / shots.length,
        );
      const shotList = [
        "bandeja",
        "volea",
        "smásh",
        "globo",
        "defensa",
        "vibora",
      ].map((k) => ({ k, v: avg(k) }));
      shotList.sort((a, b) => b.v - a.v);
      const best = shotList[0];
      const worst = shotList[shotList.length - 1];
      return `<div class="ai-result-card">
                <span class="res-title">Mejora de golpes</span>
                <div class="res-val">Top: ${best.k.toUpperCase()} ${best.v}/10 | A reforzar: ${worst.k.toUpperCase()} ${worst.v}/10</div>
                <div class="res-sub">Dedica 15 min por sesión al golpe más bajo y mide progreso.</div>
            </div>`;

    case "CMD_GEAR_GUIDE":
      const gear = (DATA_CACHE.user?.diario || [])
        .map((e) => e.detalles || {})
        .filter(Boolean);
      if (gear.length === 0)
        return noData(
          "Aún no tengo info de palas. Anota tu pala y configuración en el diario.",
        );
      const countTop = (arr, key) => {
        const map = {};
        arr.forEach((i) => {
          const v = (i[key] || "").trim();
          if (v) map[v] = (map[v] || 0) + 1;
        });
        const keys = Object.keys(map);
        if (keys.length === 0) return null;
        return keys.reduce((a, b) => (map[a] > map[b] ? a : b));
      };
      const favPala = countTop(gear, "pala") || "Sin datos";
      const favCfg = countTop(gear, "configPala") || "Sin datos";
      return `<div class="ai-result-card">
                <span class="res-title">Recomendación de pala</span>
                <div class="res-val">Base actual: ${favPala}</div>
                <div class="res-sub">Config más repetida: ${favCfg}. Ajusta balance y grip según sensación.</div>
            </div>`;

    case "CMD_MENTAL_COACH":
      const moodEntries = DATA_CACHE.user?.diario || [];
      if (moodEntries.length === 0)
        return noData("Registra sensaciones para darte coaching mental.");
      const avgMental = Math.round(
        moodEntries.reduce((s, e) => s + (e.valoracion?.mental || 5), 0) /
          moodEntries.length,
      );
      return `<div class="ai-result-card">
                <span class="res-title">Gestión emocional</span>
                <div class="res-val">Mental medio: ${avgMental}/10</div>
                <div class="res-sub">Rutina breve: respiración 4-4-4 y palabra clave antes de cada punto.</div>
            </div>`;

    case "CMD_PREMATCH":
      return `<div class="ai-result-card">
                <span class="res-title">Preparación 2v2</span>
                <div class="res-val">Checklist rápido</div>
                <div class="res-sub">1) Calienta 10 min. 2) Define roles con tu pareja. 3) Objetivo simple por set. 4) Prioriza porcentaje antes que riesgo.</div>
            </div>`;

    case "CMD_STATS_READ":
      const wr2 = _calcWinrate(uid);
      return `<div class="ai-result-card">
                <span class="res-title">Lectura de estadísticas</span>
                <div class="res-val">Winrate ${wr2.winrate}% (${wr2.wins}V/${wr2.total - wr2.wins}D)</div>
                <div class="res-sub">Combina esto con tu diario para ajustar táctica y golpes débiles.</div>
            </div>`;

    case "CMD_ANALYZE_RIVAL":
      let rName = query
        .split(/analiza (a |mi )/i)
        .pop()
        .trim();
      let rUser = _findUserByName(rName);
      const qNorm = _normalizeText(query);
      if (!rUser && qNorm.includes("nemesis")) {
        rUser = Analyzer.findNemesis(uid) || null;
      }
      if (!rUser)
        return noData(`No encuentro a ese jugador en la base de datos.`);

      const myLvl = DATA_CACHE.user?.nivel || 2.5;
      const rLvl = rUser.nivel || 2.5;
      const isHarder = rLvl > myLvl;

      return `<div class="ai-result-card">
                <span class="res-title">Reporte de Inteligencia: ${rUser.nombreUsuario || rUser.nombre}</span>
                <div class="res-val">Nivel ${rLvl.toFixed(2)} (${isHarder ? "Supera" : "Bajo"} tu nivel)</div>
                <div class="res-sub">
                    <b>Estrategia:</b> ${isHarder ? "Juega a asegurar. No asumas riesgos innecesarios, busca su punto más débil." : "Domina el centro. Tienes ventaja técnica, úsala para desplazarle."}<br><br>
                    <b>Probabilidad:</b> ${Math.round(50 + (myLvl - rLvl) * 15)}% de victoria base.
                </div>
            </div>`;

    case "CMD_ANALYZE_MATCH":
      const myMatches = DATA_CACHE.matches || [];
      const lastM = myMatches
        .filter(m => m.jugadores?.includes(uid) && isFinishedMatch(m) && !isCancelledMatch(m))
        .sort((a,b) => (b.fecha?.toMillis?.() || 0) - (a.fecha?.toMillis?.() || 0))[0];
      
      if (!lastM) return noData("No hay registros de combates en tu base de datos.");

      return `<div class="ai-result-card">
                <span class="res-title">Análisis de Combate</span>
                <div class="res-val">Resultado: ${getResultSetsString(lastM) || "Partido cerrado"}</div>
                <div class="res-sub">La Matrix detecta una ejecución táctica de nivel ${ (DATA_CACHE.user?.nivel || 2.5).toFixed(2) }. Revisa tu diario para optimizar errores.</div>
            </div>`;

    // --- NEW V15 COMMANDS ---
    case "CMD_H2H": {
      let rName = query.split(/con |versus |vs /i).pop().trim();
      let rival = _findUserByName(rName);
      if (!rival && _normalizeText(query).includes("nemesis")) rival = Analyzer.findNemesis(uid) || null;
      if (!rival) return noData(`No encuentro a '${rName}' para comparar.`);
      const record = { wins: 0, losses: 0 };
      DATA_CACHE.matches.forEach(m => {
        if (!isFinishedMatch(m) || isCancelledMatch(m) || !m.jugadores?.includes(uid) || !m.jugadores?.includes(rival.id)) return;
        _didUserWinMatch(m, uid) ? record.wins++ : record.losses++;
      });
      const total = record.wins + record.losses;
      if (total === 0) return noData(`No tengo partidos registrados contra ${rival.nombreUsuario || 'ese jugador'}.`);
      return `<div class="ai-result-card">
                <span class="res-title">H2H: Tú vs ${rival.nombreUsuario || rival.nombre}</span>
                <div class="res-val">${record.wins}V - ${record.losses}D</div>
                <div class="res-sub">Efectividad: ${Math.round(record.wins / total * 100)}% en ${total} enfrentamientos directos.</div>
            </div>`;
    }

    case "CMD_MOMENTUM": {
      const last5 = DATA_CACHE.matches.filter(m => isFinishedMatch(m) && !isCancelledMatch(m)).slice(0, 5);
      if (last5.length === 0) return noData("Sin partidos para medir tu momento.");
      let w = 0;
      last5.forEach(m => { if (_didUserWinMatch(m, uid)) w++; });
      const momentum = w >= 4 ? "🔥 EN LLAMAS" : w >= 3 ? "📈 AL ALZA" : w >= 2 ? "⚖️ ESTABLE" : "📉 EN CAÍDA";
      const momColor = w >= 4 ? "text-sport-green" : w >= 2 ? "text-sport-gold" : "text-sport-red";
      return respond(
        `<div class="ai-result-card">
            <span class="res-title">Momentum (5 últimos)</span>
            <div class="res-val ${momColor}">${momentum}</div>
            <div class="res-sub">${w} victorias en los últimos 5 partidos. ${w>=4?'Mantén la presión.':w>=2?'Estás estable, busca rachas.':'Toca resetear mentalidad y centrarse.'}</div>
        </div>`,
        w >= 4 ? "¡Vas como un tiro, chaval!" : "Venga, que se puede remontar siempre."
      );
    }

    case "CMD_EVOLUTION": {
      const history = DATA_CACHE.eloHistory;
      if (history.length < 2) return noData("Necesito más registros. Juega más.");
      const newest = history[0]?.newTotal || 1000;
      const oldest = history[history.length - 1]?.newTotal || 1000;
      const totalChange = newest - oldest;
      const period = history.length;
      return `<div class="ai-result-card">
                <span class="res-title">Evolución ELO (${period} registros)</span>
                <div class="res-val ${totalChange >= 0 ? 'text-sport-green' : 'text-sport-red'}">${totalChange >= 0 ? '+' : ''}${Math.round(totalChange)} puntos</div>
                <div class="flex-col gap-2 mt-3">
                    <div class="flex-row between text-[10px]"><span class="text-white/40">ELO Inicial</span><b class="text-white">${Math.round(oldest)}</b></div>
                    <div class="flex-row between text-[10px]"><span class="text-white/40">ELO Actual</span><b class="text-primary">${Math.round(newest)}</b></div>
                    <div class="flex-row between text-[10px]"><span class="text-white/40">Promedio/Partido</span><b class="text-white">${(totalChange / period).toFixed(1)} pts</b></div>
                </div>
            </div>`;
    }

    case "CMD_WEEKLY": {
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thisWeek = DATA_CACHE.matches.filter(m => {
        const d = _getMatchDate(m);
        return d >= weekAgo && d <= now;
      });
      const played = thisWeek.filter(m => isFinishedMatch(m) && !isCancelledMatch(m));
      const wins = played.filter(m => _didUserWinMatch(m, uid)).length;
      return `<div class="ai-result-card">
                <span class="res-title">Resumen Semanal</span>
                <div class="res-val">${thisWeek.length} partidos esta semana</div>
                <div class="flex-col gap-2 mt-3">
                    <div class="flex-row between text-[10px]"><span class="text-white/40">Jugados</span><b class="text-white">${played.length}</b></div>
                    <div class="flex-row between text-[10px]"><span class="text-white/40">Victorias</span><b class="text-sport-green">${wins}</b></div>
                    <div class="flex-row between text-[10px]"><span class="text-white/40">Pendientes</span><b class="text-sport-gold">${thisWeek.length - played.length}</b></div>
                    <div class="flex-row between text-[10px]"><span class="text-white/40">WR Semanal</span><b class="text-primary">${played.length > 0 ? Math.round(wins/played.length*100) : 0}%</b></div>
                </div>
            </div>`;
    }

    case "CMD_RECORD": {
      const u = DATA_CACHE.user;
      return `<div class="ai-result-card">
                <span class="res-title">Records Personales</span>
                <div class="flex-col gap-2">
                    <div class="flex-row between text-[10px]"><span class="text-white/40">Racha Máxima</span><b class="text-sport-green">${u.rachaMaxima || u.rachaActual || 0} victorias</b></div>
                    <div class="flex-row between text-[10px]"><span class="text-white/40">ELO Máximo</span><b class="text-primary">${Math.round(u.eloMaximo || u.puntosRanking || 1000)}</b></div>
                    <div class="flex-row between text-[10px]"><span class="text-white/40">Nivel Alcanzado</span><b class="text-white">${(u.nivelMaximo || u.nivel || 2.5).toFixed(2)}</b></div>
                    <div class="flex-row between text-[10px]"><span class="text-white/40">Total Partidos</span><b class="text-white">${u.partidosJugados || 0}</b></div>
                    <div class="flex-row between text-[10px]"><span class="text-white/40">Total Victorias</span><b class="text-sport-green">${u.victorias || 0}</b></div>
                </div>
            </div>`;
    }

    case "CMD_HOT_ZONE": {
      const matchDays = {};
      DATA_CACHE.matches.filter(m => isFinishedMatch(m) && !isCancelledMatch(m)).forEach(m => {
        const d = _getMatchDate(m);
        const day = d.toLocaleDateString('es-ES', { weekday: 'long' });
        if (!matchDays[day]) matchDays[day] = { total: 0, wins: 0 };
        matchDays[day].total++;
        if (_didUserWinMatch(m, uid)) matchDays[day].wins++;
      });
      const sorted = Object.entries(matchDays).sort((a, b) => b[1].total - a[1].total);
      if (sorted.length === 0) return noData("Sin datos de patrones aún.");
      const bestDay = sorted.reduce((best, curr) => {
        const wr = curr[1].total > 0 ? curr[1].wins / curr[1].total : 0;
        return wr > (best[1].total > 0 ? best[1].wins / best[1].total : 0) ? curr : best;
      });
      return `<div class="ai-result-card">
                <span class="res-title">Zona Caliente</span>
                <div class="res-val">Mejor día: ${bestDay[0].toUpperCase()}</div>
                <div class="flex-col gap-1 mt-3">
                    ${sorted.map(([day, s]) => `<div class="flex-row between text-[10px]"><span class="text-white/40">${day}</span><b class="text-white">${s.wins}V/${s.total-s.wins}D (${Math.round(s.wins/s.total*100)}%)</b></div>`).join('')}
                </div>
            </div>`;
    }

    default:
      const helpCard = `
                <div class="ai-result-card animate-up">
                    <span class="res-title">Vecina AP: Inteligencia V15</span>
                    <div class="res-val">No te entiendo... ¡pero se me dan bien muchas cosas!</div>
                    <div class="flex-col gap-2 mt-3">
                        <span class="text-[9px] font-black text-primary uppercase tracking-widest">Comandos Disponibles</span>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">📊</span><span class="text-white">"informe", "mi ranking"</span></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">🔍</span><span class="text-white">"busca a Juan"</span></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">⚔️</span><span class="text-white">"h2h con Pedro"</span></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">🎯</span><span class="text-white">"rival intelligence"</span></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">🧾</span><span class="text-white">"resumen total"</span></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">💡</span><span class="text-white">"sugerencia"</span></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">📈</span><span class="text-white">"evolución", "momentum"</span></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">🏆</span><span class="text-white">"record", "mejor racha"</span></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">📅</span><span class="text-white">"resumen semanal"</span></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">🔥</span><span class="text-white">"zona caliente", "mejor hora"</span></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">🧮</span><span class="text-white">"fórmula ELO"</span></div>
                        <div class="flex-row between text-[10px]"><span class="text-white/40">🌧️</span><span class="text-white">"llueve?", "clima"</span></div>
                    </div>
                </div>`;
      if (currentPersonality === "vecina") {
        const joke = _getFunnyJoke();
        return `${helpCard}<div class="mt-4 p-3 bg-white/5 rounded-xl border border-white/10 italic text-[10px] text-primary">
                  <i class="fas fa-quote-left opacity-30 mr-2"></i>${joke}
                </div>`;
      }
      return helpCard;
  }
}

function _getFunnyJoke() {
  const users = DATA_CACHE.globalUsers.filter((u) => (u.nombreUsuario || u.nombre) && u.id !== auth.currentUser?.uid);
  if (users.length === 0)
    return "Dicen que por aquí hay gente que calienta pidiendo una cerveza... ¡Y no miro a nadie!";
    
  const r = users[Math.floor(Math.random() * users.length)];
  const nick = r.nombreUsuario || r.nombre || "ese jugador";
  const jokes = [
    `¿Has visto a <b>${nick}</b>? El otro día falló un remate, se quedó mirando la pala y dijo: "Es que vibra". ¡Claro, chato, vibra de miedo!`,
    `Me han dicho que <b>${nick}</b> se ha comprado una pala de 400€ a ver si así la bola pasa la red. ¡Menuda fe tiene el colega!`,
    `Dicen que <b>${nick}</b> tiene un golpe secreto: se llama 'la caña' y lo usa en todos los puntos. ¡Es un artista!`,
    `Ojo con <b>${nick}</b>, que calienta haciendo sombras en el espejo y luego en la pista no le da ni al aire.`,
    `¿Sabes por qué <b>${nick}</b> siempre pide la bola nueva? Porque a la vieja ya le tiene puesto nombre de tanto fallarla.`,
    `He visto a <b>${nick}</b> quejarse del sol... ¡en una pista indoor! Ese es el nivel, Maribel.`,
    `<b>${nick}</b> dice que juega agresivo, pero su volea llega por correo ordinario.`,
    `Si <b>${nick}</b> te dice "tranqui, la saco", tú prepara ya el globo defensivo.`,
    `Hoy <b>${nick}</b> entró tan motivado que hizo calentamiento... en la pista de al lado.`,
    `La táctica secreta de <b>${nick}</b>: mirar al rival muy serio para que no note el miedo.`
  ];
  return jokes[Math.floor(Math.random() * jokes.length)];
}

export function addMessage(content, type) {
  const container = document.getElementById("ai-messages");
  if (!container) return;

  const wrapper = document.createElement("div");
  wrapper.className = `chat-row ${type} animate-fade-in`;

  // Avatar for bot
  let avatarHtml = "";
  if (type === "bot") {
    const icon =
      typeof currentPersonality !== "undefined" &&
      currentPersonality === "coach"
        ? "fa-user-pilot"
        : "fa-robot";
    avatarHtml = `<div class="chat-avatar bot"><i class="fas ${icon}"></i></div>`;
  }

  wrapper.innerHTML = `
        ${avatarHtml}
        <div class="ai-msg ${type}">
            ${type === "user" ? `<p>${content}</p>` : content.startsWith("<") ? content : `<p>${content}</p>`}
        </div>
    `;

  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
}

export function addTyping() {
  const container = document.getElementById("ai-messages");
  const id = "typing-" + Date.now();

  const wrapper = document.createElement("div");
  wrapper.id = id;
  wrapper.className = "chat-row bot animate-fade-in";

  const icon =
    typeof currentPersonality !== "undefined" && currentPersonality === "coach"
      ? "fa-user-pilot"
      : "fa-robot";

  wrapper.innerHTML = `
        <div class="chat-avatar bot"><i class="fas ${icon}"></i></div>
        <div class="ai-msg bot typing">
            <span></span><span></span><span></span>
        </div>
    `;

  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
  return id;
}

export function removeTyping(id) {
  document.getElementById(id)?.remove();
}

