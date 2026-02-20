/* js/modules/vecina-chat.js - Sentient AI v15.0 "Neural Core" Edition */
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

const DATA_CACHE = {
  user: null,
  eloHistory: [],
  matches: [],
  globalUsers: [],
  openMatches: [],
  systemStats: null,
  lastUpdate: 0,
};

// --- PERSONALITY CORE ---
const PERSONALITIES = {
  coach: {
    name: "Coach IA",
    tone: "formal, técnico, motivador, exigente",
    avatarClass: "coach",
    fallback: [
      "Interesante planteamiento. Analicemos los datos.",
      "Para mejorar tu ELO, necesitamos enfoque. ¿Qué más necesitas saber?",
      "Mis algoritmos sugieren que sigas entrenando. ¿Otra consulta?",
      "Formateo de respuesta táctica en proceso... ¿En qué te ayudo?",
      "Recuerda: la técnica vence a la fuerza. ¿Siguiente pregunta?"
    ]
  },
  vecina: {
    name: "La Vecina Cotilla",
    tone: "informal, divertida, sarcástica, picante",
    avatarClass: "vecina",
    fallback: [
      "¡Uy, eso me suena a chisme! Pero no tengo el dato exacto, cariño.",
      "A ver, corazón, céntrate. ¿Me preguntas por pádel o por la vida?",
      "¡Madre mía! Si yo te contara... pero de eso no tengo registros hoy.",
      "Oye, que yo lo sé todo, pero eso se me escapa. ¡Pregúntame otra cosa!",
      "Jajaja, ¡qué gracia! Pero vamos a lo importante: ¿quién ganó ayer?"
    ]
  }
};

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

// --- ANALYSIS UTILS ---

const Analyzer = {
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
    
  findPartner: (uid) => {
    const record = {};
    DATA_CACHE.matches.forEach((m) => {
      if (!m.jugadores || !isFinishedMatch(m) || isCancelledMatch(m)) return;
      const myIdx = m.jugadores.indexOf(uid);
      if (myIdx === -1) return;
      const isTeam1 = myIdx < 2;
      // Partner is the other person in my team
      const partnerIdx = isTeam1 ? (myIdx === 0 ? 1 : 0) : (myIdx === 2 ? 3 : 2);
      const partnerId = m.jugadores[partnerIdx];
        
      if (!partnerId || partnerId === uid || String(partnerId).startsWith("GUEST_")) return;

      const winnerTeam = resolveWinnerTeam(m);
      if (winnerTeam !== 1 && winnerTeam !== 2) return;
      const won = isTeam1 ? winnerTeam === 1 : winnerTeam === 2;
        
      if (!record[partnerId]) record[partnerId] = { wins: 0, losses: 0 };
      won ? record[partnerId].wins++ : record[partnerId].losses++;
    });

    let bestId = null, bestWinRate = -1;
     Object.keys(record).forEach((pid) => {
      const total = record[pid].wins + record[pid].losses;
      const rate = record[pid].wins / total;
      if (total >= 2 && rate > bestWinRate) {
        bestWinRate = rate;
        bestId = pid;
      }
    });
      
    return bestId ? {
        ...DATA_CACHE.globalUsers.find(u => u.id === bestId),
        stats: record[bestId]
    } : null;
  }
};

function _buildUserContext(u, stats, matches) {
  const winRate = stats.myMatches > 0 ? Math.round((stats.myFinishedMatches / stats.myMatches) * 100) : 0;
  const streak = u.rachaActual || 0;
  const level = u.nivel || 2.5;
  
  let status = "Promesa";
  if (level > 4.5) status = "Elite";
  else if (level > 3.5) status = "Avanzado";
  else if (level < 2.5) status = "Rookie";

  let mood = "Neutral";
  if (streak > 2) mood = "On Fire 🔥";
  if (streak < -2) mood = "En Crisis ❄️";

  return {
    name: u.nombreUsuario || u.nombre || "Jugador",
    level: level.toFixed(2),
    status,
    streak,
    streakText: streak > 0 ? `+${streak}` : `${streak}`,
    mood,
    matches: stats.myMatches,
    winRate: `${winRate}%`,
    lastPoints: Math.round(u.puntosRanking || 1000)
  };
}

function _findUserByName(name) {
  if (!name) return null;
  const q = name.toLowerCase().trim();
  return DATA_CACHE.globalUsers.find(u => {
      const n = (u.nombreUsuario || u.nombre || "").toLowerCase();
      return n.includes(q);
  });
}

// --- GENERATIVE RESPONSE INTELLIGENCE ---

function _generateResponse(intent, query) {
  const u = DATA_CACHE.user || {};
  const sys = DATA_CACHE.systemStats || {};
  const ctx = _buildUserContext(u, sys, DATA_CACHE.matches);
  const p = PERSONALITIES[currentPersonality];
  
  // Dynamic Variables Injection
  const R = (text) => {
    return text
        .replace(/{NAME}/g, ctx.name)
        .replace(/{LEVEL}/g, ctx.level)
        .replace(/{ELO}/g, ctx.lastPoints)
        .replace(/{STREAK}/g, ctx.streakText)
        .replace(/{MATCHES}/g, ctx.matches)
        .replace(/{WINRATE}/g, ctx.winRate)
        .replace(/{STATUS}/g, ctx.status)
        .replace(/{TOTAL_USERS}/g, sys.totalUsers || "muchos")
        .replace(/{OPEN_MATCHES}/g, sys.openCircuitMatches || 0);
  };

  if(!u.nombreUsuario) return "Sistema iniciándose... Espera un segundo mientras cargo tus datos.";

  // --- BRAIN: INTENT RESOLUTION ---
  
  if (intent === "CMD_GREETING") {
      const h = new Date().getHours();
      if (currentPersonality === 'vecina') {
        if (h < 12) return R(`¡Buenos días, {NAME}! ¿Ya te has tomado el café o sigues dormido en la pista?`);
        if (h < 20) return R(`¡Buenas tardes, {NAME}! ¿Qué tal ese revés hoy? ¿O ha sido todo 'caña'?`);
        return R(`¡Buenas noches, {NAME}! ¿A estas horas pensando en pádel? ¡Eso es vicio!`);
      } else {
        if (h < 12) return R(`Buenos días, {NAME}. Los datos de hoy son propicios para el entrenamiento.`);
        if (h < 20) return R(`Buenas tardes, {NAME}. Analizando métricas de rendimiento...`);
        return R(`Buenas noches, {NAME}. El descanso es vital para la recuperación muscular.`);
      }
  }

  if (intent === "CMD_APP_CONTEXT") {
    if (currentPersonality === 'vecina') {
      return R("¡Ay, cari! Padeluminatis es *la* app. Aquí se cuece todo: rankings, retos, cotilleos... ¡Somos {TOTAL_USERS} locos del pádel! Tú estás en nivel {LEVEL}, que no está mal, pero siempre se puede mejorar, ¿eh?");
    }
    return R("Padeluminatis Pro v7. Sistema de gestión deportiva de alto rendimiento. Actualmente monitorizamos a {TOTAL_USERS} jugadores. Tu perfil indica nivel {LEVEL} con ELO {ELO}. La plataforma gestiona Rankings, Retos y Análisis Predictivo.");
  }

  if (intent === "CMD_GLOBAL_STATS") {
     const text = currentPersonality === 'vecina'
      ? "¡Madre del amor hermoso! Tenemos {TOTAL_USERS} jugadores dándolo todo. Hay {OPEN_MATCHES} partidos abiertos ahora mismo. ¡Corre a apuntarte antes de que te quedes sin sitio!"
      : "Informe Global: {TOTAL_USERS} usuarios activos registrados. Actualmente hay {OPEN_MATCHES} partidos en fase de convocatoria. La actividad del club es óptima.";
     return R(text);
  }

  if (intent === "CMD_LEVEL_PROGRESS") {
    const nextLevel = Math.floor(Number(ctx.level)) + 1;
    const pointsNeeded = ((nextLevel - 2.5) * 400) + 1000; 
    const diff = Math.max(0, pointsNeeded - ctx.lastPoints);
    
    if (currentPersonality === 'vecina') {
       if (diff <= 0) return R("¡Pero si ya eres una máquina! Estás tope de gama. ¡Sigue así, tigre!");
       return R(`A ver, {NAME}, corazón. Tienes nivel {LEVEL}. Para subir al siguiente escalón te faltan unos puntitos... ¡Dale caña a esos partidos! Tienes racha de {STREAK}, ¡aprovéchala!`);
    }
    return R(`Análisis de Progresión: Nivel actual {LEVEL} ({ELO} pts). Estado: {STATUS}. Racha actual: {STREAK}. Mantén la consistencia y busca rivales de mayor ELO para acelerar el ascenso.`);
  }

  if (intent === "CMD_NEMESIS") {
    const nemesis = Analyzer.findNemesis(u.id);
    if (!nemesis) return currentPersonality === 'vecina' ? "¡Qué suerte! No tienes a nadie que te tenga frito. ¡Todos te quieren!" : "No se ha detectado un rival estadísticamente dominante (Némesis) en tu historial reciente.";
    
    const nName = nemesis.nombreUsuario || nemesis.nombre;
    const nStats = nemesis.stats;
    
    if (currentPersonality === 'vecina') {
       return `¡Uff! Tu bestia negra es **${nName}**. Le has ganado ${nStats.wins} veces, pero te ha dado "pal pelo" ${nStats.losses}. ¡Hay que entrenar más ese revés, eh!`;
    }
    return `Análisis de Rivalidad: Tu Némesis táctico es **${nName}**. Historial H2H: ${nStats.wins}V - ${nStats.losses}D. Se recomienda analizar sus patrones de juego para revertir la tendencia.`;
  }
    
  if (intent === "CMD_PARTNER_SYNC") {
      const partner = Analyzer.findPartner(u.id);
      if(!partner) return currentPersonality === 'vecina' ? "Cariño, estás más solo que la una. ¡Búscate una pareja fija!" : "No se ha detectado un compañero frecuente con alta sinergia.";
      
      const pName = partner.nombreUsuario || partner.nombre;
      const pStats = partner.stats; 
      const total = pStats.wins + pStats.losses;
      const rate = Math.round((pStats.wins / total)*100);

      if (currentPersonality === 'vecina') return `¡Hacéis buena pareja con **${pName}**! Habéis ganado el ${rate}% de las veces. ¡Eso es amor y lo demás son tonterías!`;
      return `Sinergia Detectada: Tu mejor socio es **${pName}** con un WinRate conjunto del ${rate}% en ${total} partidos.`;
  }

  if (intent === "CMD_RIVAL_INTEL") {
      let msg = currentPersonality === 'vecina' ? "Pues mira, hay de todo en la viña del señor. " : "Inteligencia de Rivales: ";
      // Pick 3 random top players
      const top = DATA_CACHE.globalUsers.sort((a,b) => (b.nivel||0) - (a.nivel||0)).slice(0,3);
      const names = top.map(t => t.nombreUsuario || t.nombre).join(", ");
      
      msg += currentPersonality === 'vecina'
        ? `Por arriba están ${names}, que se creen los reyes del mambo. Tú a lo tuyo, {NAME}, que con tu nivel {LEVEL} puedes darles un susto.`
        : `Los objetivos de alto valor actuales son: ${names}. Se recomienda estudiar sus métricas antes del desafío.`;
      return R(msg);
  }
  
  if (intent === "CMD_STATS_READ") {
      return currentPersonality === 'vecina'
        ? R("¡Vamos a ver esos números! Tienes {ELO} puntazos. Has ganado el {WINRATE} de tus partidos. ¡Ni tan mal! ¿Y esa racha de {STREAK}? ¡Cuidado que quemas!")
        : R("Métricas Personales: ELO {ELO} | WinRate {WINRATE} | Racha {STREAK}. Rendimiento: {STATUS}.");
  }

  if (intent === "CMD_GEAR_ADVICE") {
      return currentPersonality === 'vecina'
        ? "¡Ay la pala! Si es que siempre culpamos a la pala... Si eres de pegar fuerte, pilla una forma Diamante. Si eres más de colocarla, redonda. Y si no das una... ¡clases, cariño, clases!"
        : "Recomendación de Material: Para juego ofensivo (Smash/Víbora), utiliza formato Diamante y balance alto. Para control y defensa, formato Redondo con balance bajo. El formato Lágrima ofrece un balance híbrido.";
  }

  if (intent === "CMD_PREDICT") {
     const prob = Math.floor(Math.random() * 40) + 40; 
     if (currentPersonality === 'vecina') return "Uff, la bola de cristal dice que... ¡depende de lo que hayas desayunado! Pero te veo con ganas. Yo digo que un 80% sí.";
     return `Probabilidad estimada de victoria basada en biorritmos actuales: ${prob}%. Variable sujeta a factores externos como clima y estado físico.`;
  }
    
  if (intent === "CMD_ELO_FORMULA") {
      return currentPersonality === 'vecina'
        ? "Mira, es un lío de matemáticas. Básicamente: si ganas a uno bueno, subes mucho. Si pierdes con uno malo, bajas al sótano. ¡Tú gana y punto!"
        : "El ELO Padeluminatis utiliza un K-Factor dinámico que evalúa: 1. Diferencia de nivel, 2. Racha actual, 3. Contundencia del resultado (Sets/Juegos).";
  }
  
  if (intent === "CMD_TUTORIAL") {
      return currentPersonality === 'vecina'
        ? "Es muy fácil, mi vida. En 'Calendario' te apuntas a partidos. En 'Ranking' cotilleas quién va primero. Y si quieres quejarte, vas al Admin. ¡Sencillo!"
        : "Guía Rápida: Usa el Menú Inferior para navegar. 'Home' para tu dashboard, 'Calendario' para reservas, y 'Ranking' para la clasificación global. Registra resultados post-partido para actualizar tu ELO.";
  }

  // Fallback
  const fallbacks = p.fallback;
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}


function _detectIntent(query) {
  const q = query.toLowerCase();
  if (query.startsWith("CMD_")) return query;
  if (q.includes("hola") || q.includes("buenas") || q.includes("hi")) return "CMD_GREETING";
  if (q.includes("contexto") || q.includes("que es esto") || q.includes("app")) return "CMD_APP_CONTEXT";
  if (q.includes("global") || q.includes("comunidad") || q.includes("gente")) return "CMD_GLOBAL_STATS";
  if (q.includes("nivel") || q.includes("progeso") || q.includes("subir")) return "CMD_LEVEL_PROGRESS";
  if (q.includes("nemesis") || q.includes("rival") || q.includes("odio")) return "CMD_NEMESIS";
  if (q.includes("socio") || q.includes("pareja") || q.includes("compañero")) return "CMD_PARTNER_SYNC";
  if (q.includes("recomienda") || q.includes("quien jugar") || q.includes("retar")) return "CMD_RIVAL_INTEL";
  if (q.includes("estadistica") || q.includes("datos") || q.includes("numeros")) return "CMD_STATS_READ";
  if (q.includes("pala") || q.includes("raqueta") || q.includes("material")) return "CMD_GEAR_ADVICE";
  if (q.includes("ganar") || q.includes("pronostico") || q.includes("suerte")) return "CMD_PREDICT";
  if (q.includes("elo") || q.includes("puntos") || q.includes("calculo")) return "CMD_ELO_FORMULA";
  if (q.includes("ayuda") || q.includes("como funciona") || q.includes("guia")) return "CMD_TUTORIAL";
  return "GENERAL";
}

// --- PUBLIC INTERFACE & UI ---

async function sendMessage() {
  const input = document.getElementById("ai-input-field");
  const text = input.value.trim();
  if (!text) return;

  const msgs = document.getElementById("ai-messages");
  
  // User Msg
  const userDiv = document.createElement("div");
  userDiv.className = "ai-msg user";
  userDiv.innerHTML = `<p>${text}</p>`;
  msgs.appendChild(userDiv);
  
  input.value = "";
  msgs.scrollTop = msgs.scrollHeight;

  // Bot Thinking
  const botDiv = document.createElement("div");
  botDiv.className = "ai-msg bot";
  botDiv.innerHTML = `<p><i class="fas fa-circle-notch fa-spin"></i></p>`;
  msgs.appendChild(botDiv);
  msgs.scrollTop = msgs.scrollHeight;

  // Ensure Data
  await _syncData();

  // Generate
  const intent = _detectIntent(text);
  const response = _generateResponse(intent, text);

  // Replace Loading
  setTimeout(() => {
    botDiv.innerHTML = `<p>${response}</p>`;
    msgs.scrollTop = msgs.scrollHeight;
  }, 600 + Math.random() * 800);
}

function toggleChat() {
  const panel = document.getElementById("vecina-chat-panel");
  chatOpen = !chatOpen;
  if(chatOpen) {
      panel.classList.add("open");
      _syncData();
      document.getElementById("ai-input-field").focus();
  } else {
      panel.classList.remove("open");
  }
}

function switchAiPersonality() {
    currentPersonality = currentPersonality === 'coach' ? 'vecina' : 'coach';
    const p = PERSONALITIES[currentPersonality];
    
    // Update UI
    const avatar = document.getElementById('p-avatar-bot');
    avatar.className = `ai-avatar-box ${currentPersonality}`;
    
    const nameEl = document.getElementById('ai-bot-name');
    nameEl.textContent = p.name.toUpperCase();
    
    const msgs = document.getElementById("ai-messages");
    const botDiv = document.createElement("div");
    botDiv.className = "ai-msg bot";
    botDiv.innerHTML = `<p><i>Sistema reiniciado. Personalidad cargada: <b>${p.name}</b>.</i></p>`;
    msgs.appendChild(botDiv);
    msgs.scrollTop = msgs.scrollHeight;
}

window.aiQuickCmd = (cmd, label) => {
    const input = document.getElementById("ai-input-field");
    input.value = label || cmd;
    sendMessage();
};

export function initVecinaChat() {
  if (document.getElementById("vecina-chat-fab")) return;

  // FAB
  const fab = document.createElement("button");
  fab.id = "vecina-chat-fab";
  fab.className = "ai-fab";
  fab.innerHTML = `<i class="fas fa-robot"></i>`;
  fab.onclick = toggleChat;
  document.body.appendChild(fab);

  // PANEL
  const chatHTML = `
        <div id="vecina-chat-panel" class="ai-chat-panel v14">
            <div class="ai-chat-header border-b border-white-05 px-6">
                <div class="personality-toggle" onclick="window.switchAiPersonality()">
                    <div id="p-avatar-bot" class="ai-avatar-box coach">
                        <i class="fas fa-robot"></i>
                    </div>
                </div>
                <div class="ai-header-info flex-1" onclick="window.switchAiPersonality()">
                    <span id="ai-bot-name" class="ai-title italic font-black uppercase">COACH IA</span>
                    <div class="flex-row items-center gap-2">
                        <div class="pulse-dot-green"></div>
                        <span id="ai-bot-tag" class="ai-subtitle tracking-[2px]">VECINA 3.0</span>
                    </div>
                </div>
                <div class="flex-row items-center gap-2">
                    <button class="btn-close-neon sm" onclick="window.toggleAiChat()"><i class="fas fa-times"></i></button>
                </div>
            </div>
            
            <div id="ai-messages" class="ai-chat-body custom-scroll p-6">
                <div class="ai-msg bot">
                    <p>Sistema online. Soy tu asistente personal V3.0. Pregúntame sobre tus datos, rivales o el club.</p>
                </div>
            </div>

            <div class="ai-chat-footer p-5 bg-black/40 backdrop-blur-3xl border-t border-white-05">
                <div id="ai-command-wrap" class="ai-command-container-v7 mb-4">
                    <div class="ai-quick-grid-v7">
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_TUTORIAL','Guia')"><i class="fas fa-book-sparkles"></i><span>Guia</span></button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_STATS_READ','Mis Datos')"><i class="fas fa-chart-line-up"></i><span>Datos</span></button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_RIVAL_INTEL','Rivales')"><i class="fas fa-crosshairs"></i><span>Rivales</span></button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_NEMESIS','Nemesis')"><i class="fas fa-skull"></i><span>Nemesis</span></button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_PARTNER_SYNC','Socio')"><i class="fas fa-user-group"></i><span>Socio</span></button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_LEVEL_PROGRESS','Nivel')"><i class="fas fa-gauge-high"></i><span>Nivel</span></button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_GLOBAL_RANKING','Ranking')"><i class="fas fa-crown"></i><span>Ranking</span></button>
                        <button class="ai-quick-btn-v7" onclick="window.aiQuickCmd('CMD_ELO_FORMULA','Formula')"><i class="fas fa-calculator"></i><span>ELO</span></button>
                    </div>
                </div>
                <div class="ai-input-container-v7">
                    <input type="text" id="ai-input-field" class="ai-input-v7" placeholder="Escribe aquí..." autocomplete="off">
                    <button id="ai-send-btn" class="ai-send-btn-v7">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        </div>

        <style>
             /* RESPONSIVE CHAT V3.0 */
            .ai-fab {
                position: fixed; bottom: calc(90px + env(safe-area-inset-bottom)); right: 20px;
                width: 56px; height: 56px; border-radius: 50%;
                background: var(--primary); color: #000;
                font-size: 24px; display: flex; align-items: center; justify-content: center;
                box-shadow: 0 10px 25px rgba(198, 255, 0, 0.3);
                z-index: 999; border: none; cursor: pointer;
                transition: transform 0.2s;
            }
            .ai-fab:active { transform: scale(0.9); }

            .ai-chat-panel.v14 { 
                border-radius: 24px 24px 0 0; 
                border: 1px solid rgba(255,255,255,0.12); 
                background: linear-gradient(180deg, rgba(8, 12, 28, 0.98) 0%, rgba(2, 4, 12, 1) 100%);
                backdrop-filter: blur(20px);
                box-shadow: 0 -10px 40px rgba(0,0,0,0.8);
                overflow: hidden;
                display: flex;
                flex-direction: column;
                position: fixed;
                left: 0; right: 0;
                bottom: calc(86px + env(safe-area-inset-bottom));
                width: 100%;
                height: 85dvh; 
                max-height: 800px;
                z-index: 10000;
                transform: translateY(120%);
                opacity: 0;
                transition: transform 0.4s cubic-bezier(0.19, 1, 0.22, 1), opacity 0.3s;
                pointer-events: none;
            }
            .ai-chat-panel.v14.open { 
                transform: translateY(0);
                opacity: 1;
                pointer-events: all;
            }

            @media (min-width: 768px) {
                .ai-chat-panel.v14 {
                    left: auto; right: 20px;
                    bottom: 20px;
                    width: 420px; height: 700px;
                    border-radius: 24px;
                }
                .ai-fab { bottom: 30px; right: 30px; }
            }
            
            /* CONTENT STYLES */
            .ai-chat-header { min-height: 70px; display: flex; align-items: center; gap: 12px; background: rgba(255,255,255,0.03); }
            .ai-avatar-box { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; transition: all 0.3s; cursor: pointer; }
            .ai-avatar-box.coach { background: rgba(0, 212, 255, 0.1); color: #00d4ff; border: 1px solid rgba(0, 212, 255, 0.2); }
            .ai-avatar-box.vecina { background: rgba(198, 255, 0, 0.1); color: #c6ff00; border: 1px solid rgba(198, 255, 0, 0.2); }
            
            .ai-chat-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-bottom: 20px; }
            .ai-msg { max-width: 85%; animation: fadeIn 0.3s; }
            .ai-msg.user { align-self: flex-end; }
            .ai-msg.bot { align-self: flex-start; }
            .ai-msg p { padding: 12px 16px; border-radius: 18px; font-size: 0.95rem; line-height: 1.5; margin: 0; }
            .ai-msg.user p { background: var(--primary); color: #000; border-bottom-right-radius: 4px; font-weight: 600; }
            .ai-msg.bot p { background: rgba(255,255,255,0.1); color: #fff; border-bottom-left-radius: 4px; border: 1px solid rgba(255,255,255,0.1); }
            
            .ai-quick-grid-v7 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 15px; }
            .ai-quick-btn-v7 { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 4px; background: rgba(255,255,255,0.05); border-radius: 12px; border: 1px solid rgba(255,255,255,0.05); color: #fff; cursor: pointer; transition: 0.2s; }
            .ai-quick-btn-v7:active { transform: scale(0.95); background: rgba(255,255,255,0.1); }
            .ai-quick-btn-v7 i { font-size: 16px; color: var(--primary); opacity: 0.8; }
            .ai-quick-btn-v7 span { font-size: 9px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px; opacity: 0.7; }
            
            .ai-input-container-v7 { display: flex; gap: 10px; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); }
            .ai-input-v7 { flex: 1; background: transparent; border: none; color: #fff; padding: 8px; font-size: 1rem; outline: none; }
            .ai-send-btn-v7 { width: 44px; height: 44px; border-radius: 12px; background: var(--primary); color: #000; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 18px; border: none; }
        </style>
    `;
  document.body.insertAdjacentHTML("beforeend", chatHTML);

  document.getElementById("ai-send-btn").onclick = sendMessage;
  document.getElementById("ai-input-field").onkeypress = (e) => {
    if (e.key === "Enter") sendMessage();
  };

  window.toggleAiChat = toggleChat;
  window.switchAiPersonality = switchAiPersonality;
  window.aiQuickCmd = window.aiQuickCmd;
}
