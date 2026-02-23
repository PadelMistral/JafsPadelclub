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
import { getDetailedWeather } from "../external-data.js";
import { calculateCourtCondition } from "../utils/weather-utils.js";

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
  weather: null,
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
      "Jajaja, ¡qué gracia! Pero vamos a lo importante: ¿quién ganó ayer?",
      "¡Cielo! Mis antenas no pillan esa frecuencia. ¿Probamos con algo de cotilleo del ranking?",
      "Ni idea, pichón. Pero si quieres te cuento quién es tu némesis para que te eches a temblar."
    ]
  }
};

// --- DATA LAYER (Private) ---

async function _syncData() {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const getDocsSafe =
    typeof window.getDocsSafe === "function"
      ? window.getDocsSafe
      : async (qRef) => getDocs(qRef);

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
      weatherData,
    ] = await Promise.all([
      getDocument("usuarios", uid),
      getDocsSafe(
        query(
          collection(db, "rankingLogs"),
          where("uid", "==", uid),
          orderBy("timestamp", "desc"),
          limit(25),
        ),
      ),
      getDocsSafe(
        query(
          collection(db, "partidosAmistosos"),
          where("jugadores", "array-contains", uid),
          orderBy("fecha", "desc"),
          limit(25),
        ),
      ),
      getDocsSafe(
        query(
          collection(db, "partidosReto"),
          where("jugadores", "array-contains", uid),
          orderBy("fecha", "desc"),
          limit(25),
        ),
      ),
      getDocsSafe(query(collection(db, "usuarios"), limit(400))),
      getDocsSafe(
        query(
          collection(db, "partidosAmistosos"),
          where("estado", "==", "abierto"),
          limit(10),
        ),
      ),
      getDocsSafe(
        query(
          collection(db, "partidosReto"),
          where("estado", "==", "abierto"),
          limit(10),
        ),
      ),
      getDetailedWeather(),
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
    DATA_CACHE.weather = weatherData || null;
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

    // Populate Comparison Selector
    const sel = document.getElementById("ai-compare-select");
    if(sel && DATA_CACHE.globalUsers.length > 0) {
        const current = sel.value;
        sel.innerHTML = '<option value="">Comparar con...</option>' + 
            DATA_CACHE.globalUsers
                .filter(u => u.id !== uid)
                .sort((a,b) => (a.nombreUsuario || a.nombre || "").localeCompare(b.nombreUsuario || b.nombre || ""))
                .map(u => `<option value="${u.id}" ${u.id === current ? 'selected' : ''}>${u.nombreUsuario || u.nombre || 'Jugador'}</option>`)
                .join("");
    }
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

  findVictim: (uid) => {
    const record = {};
    DATA_CACHE.matches.forEach((m) => {
      if (!m.jugadores || !isFinishedMatch(m) || isCancelledMatch(m)) return;
      const myIdx = m.jugadores.indexOf(uid);
      if (myIdx === -1) return;
      const rivs = myIdx < 2 ? [m.jugadores[2], m.jugadores[3]] : [m.jugadores[0], m.jugadores[1]];
      const winnerTeam = resolveWinnerTeam(m);
      const won = myIdx < 2 ? winnerTeam === 1 : winnerTeam === 2;

      rivs.forEach((rid) => {
        if (!rid || rid === uid || String(rid).startsWith("GUEST_")) return;
        if (!record[rid]) record[rid] = { wins: 0, losses: 0 };
        won ? record[rid].wins++ : record[rid].losses++;
      });
    });

    let victimId = null, bestRatio = -1;
    Object.keys(record).forEach((rid) => {
      const total = record[rid].wins + record[rid].losses;
      const ratio = record[rid].wins / total;
      if (total >= 2 && ratio > bestRatio) {
        bestRatio = ratio;
        victimId = rid;
      }
    });
    return victimId ? { ...DATA_CACHE.globalUsers.find(u => u.id === victimId), stats: record[victimId] } : null;
  },

  findPartner: (uid) => {
    const record = {};
    DATA_CACHE.matches.forEach((m) => {
      if (!m.jugadores || !isFinishedMatch(m) || isCancelledMatch(m)) return;
      const myIdx = m.jugadores.indexOf(uid);
      if (myIdx === -1) return;
      
      const partnerIdx = myIdx === 0 ? 1 : (myIdx === 1 ? 0 : (myIdx === 2 ? 3 : 2));
      const pid = m.jugadores[partnerIdx];
      if (!pid || pid === uid || String(pid).startsWith("GUEST_")) return;

      const winnerTeam = resolveWinnerTeam(m);
      const won = myIdx < 2 ? winnerTeam === 1 : winnerTeam === 2;

      if (!record[pid]) record[pid] = { wins: 0, losses: 0 };
      won ? record[pid].wins++ : record[pid].losses++;
    });

    let bestId = null, bestRate = -1;
    Object.keys(record).forEach((pid) => {
      const total = record[pid].wins + record[pid].losses;
      const rate = record[pid].wins / total;
      if (total >= 2 && rate > bestRate) {
        bestRate = rate;
        bestId = pid;
      }
    });

    return bestId ? { ...DATA_CACHE.globalUsers.find(u => u.id === bestId), stats: record[bestId] } : null;
  },

  getDiaryInsights: (u) => {
    if (!u.diario || u.diario.length === 0) return null;
    const latest = u.diario[u.diario.length - 1];
    const recent = u.diario.slice(-5);
    
    const avgFatigue = recent.reduce((acc, e) => acc + (e.biometria?.fatiga || 0), 0) / recent.length;
    const avgStress = recent.reduce((acc, e) => acc + (e.biometria?.estres || 0), 0) / recent.length;
    
    const shotTrend = {};
    const shotsToTrack = ["serve", "volley", "bandeja", "vibora", "smash", "lob"];
    
    recent.forEach(e => {
        if(e.shots) {
            shotsToTrack.forEach(s => {
                const val = e.shots[s] || 5;
                shotTrend[s] = (shotTrend[s] || 0) + val;
            });
        }
    });
    
    let worstShot = null, minVal = 11;
    let bestShot = null, maxVal = -1;

    shotsToTrack.forEach(s => {
        const avg = shotTrend[s] / recent.length;
        if(avg < minVal) { minVal = avg; worstShot = s; }
        if(avg > maxVal) { maxVal = avg; bestShot = s; }
    });

    return { 
        latest, 
        avgFatigue, 
        avgStress, 
        worstShot, 
        bestShot,
        trendSize: recent.length,
        hasFatigue: avgFatigue > 6,
        hasStress: avgStress > 6,
        lastLesson: latest.tactica?.leccion || null
    };
  }
};

function _buildUserContext(u, stats, matches) {
  const played = Number(u.partidosJugados || 0);
  const wins = Number(u.victorias || 0);
  const winRate = played > 0 ? Math.round((wins / played) * 100) : 0;
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
    uid: u.id || auth.currentUser?.uid || "",
    name: u.nombreUsuario || u.nombre || "Jugador",
    level: level.toFixed(2),
    status,
    streak,
    streakText: streak > 0 ? `+${streak}` : `${streak}`,
    mood,
    matches: stats.myMatches,
    winRate: `${winRate}%`,
    lastPoints: Math.round(u.puntosRanking || 1000),
    playerState: u.playerState || {}
  };
}

function _getLevelProgressState(rawNivel, rawPuntos) {
  const parsedLevel = parseFloat(rawNivel || 2.5) || 2.5;
  const currentLevel = Math.max(1, Math.min(7, Number(parsedLevel.toFixed(2))));
  const puntos = Number(rawPuntos || 1000);
  const prevLevel = Math.max(1, Number((currentLevel - 0.01).toFixed(2)));
  const nextLevel = Math.min(7, Number((currentLevel + 0.01).toFixed(2)));
  const eloAtLevel = Math.round(1000 + (currentLevel - 2.5) * 400);
  const downThreshold = Math.max(0, eloAtLevel - 15);
  const upThreshold = eloAtLevel + 15;
  const band = Math.max(1, upThreshold - downThreshold);
  const progressPct = Math.max(0, Math.min(100, ((puntos - downThreshold) / band) * 100));

  return {
    currentLevel,
    prevLevel,
    nextLevel,
    progressPct,
    upPct: Math.max(0, 100 - progressPct),
    downPct: Math.max(0, progressPct),
    pointsToUp: Math.max(0, Math.ceil(upThreshold - puntos)),
    pointsToDown: Math.max(0, Math.ceil(puntos - downThreshold)),
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

function _toDateSafe(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function _getMyUpcomingMatches(uid) {
  const now = Date.now();
  return (DATA_CACHE.matches || [])
    .filter((m) => Array.isArray(m.jugadores) && m.jugadores.includes(uid))
    .filter((m) => !isFinishedMatch(m) && !isCancelledMatch(m))
    .map((m) => ({ ...m, __date: _toDateSafe(m.fecha) }))
    .filter((m) => m.__date && m.__date.getTime() >= now - 10 * 60 * 1000)
    .sort((a, b) => a.__date - b.__date);
}

function _formatMatchDate(d) {
  if (!d) return "fecha no disponible";
  return d.toLocaleString("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function _weatherCodeToLabel(code = 0) {
  const c = Number(code || 0);
  if (c === 0) return "despejado";
  if ([1, 2, 3].includes(c)) return "nuboso";
  if ([45, 48].includes(c)) return "niebla";
  if ([51, 53, 55, 56, 57].includes(c)) return "llovizna";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(c)) return "lluvia";
  if ([71, 73, 75, 77, 85, 86].includes(c)) return "nieve";
  if ([95, 96, 99].includes(c)) return "tormenta";
  return "variable";
}

function _buildWeatherSummary(dayOffset = 0) {
  const w = DATA_CACHE.weather;
  if (!w || !w.current || !w.hourly) return null;
  const now = new Date();
  const target = new Date(now);
  target.setDate(now.getDate() + dayOffset);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, "0");
  const d = String(target.getDate()).padStart(2, "0");
  const targetDay = `${y}-${m}-${d}`;

  const hours = Array.isArray(w.hourly?.time) ? w.hourly.time : [];
  const codes = Array.isArray(w.hourly?.weather_code) ? w.hourly.weather_code : [];
  const temps = Array.isArray(w.hourly?.temperature_2m) ? w.hourly.temperature_2m : [];

  const idx = hours.findIndex((t) => String(t || "").startsWith(targetDay));
  if (idx < 0) return null;

  const sample = [];
  for (let i = idx; i < Math.min(hours.length, idx + 24); i += 1) {
    if (!String(hours[i] || "").startsWith(targetDay)) break;
    sample.push({ code: Number(codes[i] || 0), temp: Number(temps[i] || 0) });
  }
  if (!sample.length) return null;

  const rainish = sample.filter((x) => [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(x.code)).length;
  const windy = Number(w.current?.wind_speed_10m || 0);
  const avgTemp = Math.round(sample.reduce((acc, x) => acc + x.temp, 0) / sample.length);
  const dominantCode = sample
    .map((x) => x.code)
    .sort((a, b) => sample.filter((s) => s.code === b).length - sample.filter((s) => s.code === a).length)[0] || 0;

  const rainProb = Math.round((rainish / sample.length) * 100);
  const condition = _weatherCodeToLabel(dominantCode);
  const court = calculateCourtCondition(avgTemp, rainProb > 25 ? 1 : 0, windy);

  return {
    dayLabel: dayOffset === 0 ? "hoy" : "mañana",
    avgTemp,
    rainProb,
    condition,
    wind: Math.round(windy),
    advice: court?.advice || "",
  };
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

  if (intent === "CMD_NEXT_MATCH") {
    const up = _getMyUpcomingMatches(ctx.uid);
    if (!up.length) {
      return currentPersonality === "vecina"
        ? "No tienes próximo partido cerrado todavía. Mira 'partidos abiertos' y te apuntas en un toque."
        : "No tienes próximos partidos programados. Consulta partidos abiertos para reservar.";
    }
    const nx = up[0];
    const when = _formatMatchDate(nx.__date);
    const free = Math.max(0, 4 - (nx.jugadores || []).filter(Boolean).length);
    const lvlMin = Number(nx?.restriccionNivel?.min ?? 1).toFixed(1);
    const lvlMax = Number(nx?.restriccionNivel?.max ?? 7).toFixed(1);
    return currentPersonality === "vecina"
      ? `Tu próximo partido es ${when}. Plazas libres: ${free}/4. Rango de nivel ${lvlMin}-${lvlMax}.`
      : `Próximo partido: ${when}. Disponibilidad: ${free}/4 plazas. Restricción de nivel: ${lvlMin}-${lvlMax}.`;
  }

  if (intent === "CMD_LEVEL_PROGRESS") {
    const lvl = _getLevelProgressState(Number(ctx.level), Number(ctx.lastPoints));
    
    if (currentPersonality === 'vecina') {
       return `Vale, ${ctx.name}. Nivel **${lvl.currentLevel.toFixed(2)}** con **${ctx.lastPoints}** pts. Estás al **${lvl.progressPct.toFixed(2)}%** del tramo actual. Te faltan **${lvl.pointsToUp} pts** para subir a **${lvl.nextLevel.toFixed(2)}** y estás a **${lvl.pointsToDown} pts** de bajar a **${lvl.prevLevel.toFixed(2)}**.`;
    }
    return `Análisis de Progresión: Nivel ${lvl.currentLevel.toFixed(2)} (${ctx.lastPoints} pts). Progreso de tramo: ${lvl.progressPct.toFixed(2)}%. Distancia a subida (${lvl.nextLevel.toFixed(2)}): ${lvl.pointsToUp} pts. Margen antes de bajar (${lvl.prevLevel.toFixed(2)}): ${lvl.pointsToDown} pts.`;
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

  if (intent === "CMD_VICTIM") {
    const victim = Analyzer.findVictim(u.id);
    if (!victim) return currentPersonality === 'vecina' ? "A ver, pichón... todavía no has 'matado' a nadie en la pista. ¡A ver si nos ponemos las pilas!" : "No se ha detectado un rival que domines claramente en tu historial.";
    
    const vName = victim.nombreUsuario || victim.nombre;
    const vStats = victim.stats;
    
    if (currentPersonality === 'vecina') {
       return `¡Ay! Tu víctima favorita es **${vName}**. Le has ganado ${vStats.wins} veces y solo te ha pillado en ${vStats.losses}. ¡Pobrecillo, si te ve ya se echa a temblar!`;
    }
    return `Análisis de Dominio: Tu rival más vulnerable es **${vName}**. Historial H2H: ${vStats.wins}V - ${vStats.losses}D. Mantén la presión psicológica en futuros enfrentamientos.`;
  }

  if (intent === "CMD_COMPARE") {
      const targetUser = _findUserByName(query.replace("compara con", "").replace("vs", "").trim());
      if (!targetUser) return currentPersonality === 'vecina' ? "Huy, ¿con quién? No conozco a ese tal... ¡Asegúrate de escribir bien el nombre!" : "No he podido localizar al usuario solicitado para realizar la comparativa.";
      
      const p1 = ctx;
      const p2 = {
          name: targetUser.nombreUsuario || targetUser.nombre,
          level: (targetUser.nivel || 2.5).toFixed(2),
          elo: Math.round(targetUser.puntosRanking || 1000)
      };

      const diffElo = p1.lastPoints - p2.elo;
      const eloAdv = diffElo > 0 ? p1.name : p2.name;

      if (currentPersonality === 'vecina') {
          return `A ver, **${p1.name}** vs **${p2.name}**. Tú tienes ${p1.lastPoints} ELO y él/ella ${p2.elo}. ${diffElo > 0 ? '¡Le llevas ventaja, no me seas flojo!' : '¡Uff, te saca ventaja! Vas a tener que sudar la gota gorda.'} En nivel estáis parecidos: ${p1.level} vs ${p2.level}.`;
      }
      return `Comparativa Técnica: [${p1.name} ELO:${p1.lastPoints} LVL:${p1.level}] VS [${p2.name} ELO:${p2.elo} LVL:${p2.level}]. Diferencial de ELO: ${Math.abs(diffElo)} a favor de ${eloAdv}. Probabilidades tácticas equilibradas.`;
  }

  if (intent === "CMD_HISTORY") {
      const recent = DATA_CACHE.matches.filter((m) => isFinishedMatch(m) && !isCancelledMatch(m)).slice(0, 5);
      if (recent.length === 0) return currentPersonality === 'vecina' ? "¡Pero si no tienes historial! Juega algo primero, impaciente." : "No se registran partidos recientes en tu historial de competición.";
      
      let summary = currentPersonality === 'vecina' ? `Tus últimos ${recent.length} partidos han sido un show: ` : `Resumen de actividad (${recent.length} partidos): `;
      
      recent.forEach((m, i) => {
          const winnerTeam = resolveWinnerTeam(m);
          const myIdx = m.jugadores.indexOf(u.id);
          const won = myIdx < 2 ? winnerTeam === 1 : winnerTeam === 2;
          summary += (won ? "✅" : "❌");
      });

      if (currentPersonality === 'vecina') {
          const wins = recent.filter(m => {
              const winnerTeam = resolveWinnerTeam(m);
              const myIdx = m.jugadores.indexOf(u.id);
              return myIdx < 2 ? winnerTeam === 1 : winnerTeam === 2;
          }).length;
          summary += wins > 3 ? " ¡Madre mía, vas como un cohete!" : " Bueno, se hace lo que se puede, ¿no?";
          return summary;
      }
      return summary + " Estado de forma analizado a partir de resultados recientes.";
  }

  if (intent === "CMD_LAST_MATCH") {
      const lastFinished = DATA_CACHE.matches.find((m) => isFinishedMatch(m) && !isCancelledMatch(m) && Array.isArray(m.jugadores) && m.jugadores.includes(ctx.uid));
      if (!lastFinished) {
        return currentPersonality === "vecina"
          ? "No tengo un último partido cerrado para mostrarte todavía."
          : "No existe un partido finalizado reciente en tu historial.";
      }
      const winnerTeam = resolveWinnerTeam(lastFinished);
      const myIdx = lastFinished.jugadores.indexOf(ctx.uid);
      const won = myIdx >= 0 && (winnerTeam === 1 || winnerTeam === 2)
        ? (myIdx < 2 ? winnerTeam === 1 : winnerTeam === 2)
        : null;
      const sets = getResultSetsString(lastFinished) || "Resultado registrado";
      const when = (lastFinished.fecha?.toDate ? lastFinished.fecha.toDate() : new Date(lastFinished.fecha || Date.now()))
        .toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
      if (currentPersonality === "vecina") {
        const rs = won === null ? "PARTIDO CERRADO" : (won ? "VICTORIA" : "DERROTA");
        return `Último partido (${when}): **${rs}** con marcador **${sets}**. Si quieres, te saco ajustes tácticos para el próximo.`;
      }
      return `Último partido ${when}: ${won === null ? "resultado registrado" : (won ? "victoria" : "derrota")} · marcador ${sets}.`;
  }

  if (intent === "CMD_OPEN_MATCHES") {
      const lvl = Number(ctx.level || 2.5);
      const compatibles = (DATA_CACHE.openMatches || []).filter((m) => {
        const min = Number(m?.restriccionNivel?.min ?? 1);
        const max = Number(m?.restriccionNivel?.max ?? 7);
        return lvl >= min && lvl <= max;
      }).slice(0, 3);
      if (compatibles.length === 0) {
        return currentPersonality === "vecina"
          ? "Ahora mismo no veo partidos abiertos compatibles con tu nivel. En cuanto salga uno, te aviso."
          : "No hay partidos abiertos compatibles con tu nivel actual.";
      }
      const preview = compatibles.map((m) => {
        const d = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha || Date.now());
        const when = d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        const free = Math.max(0, 4 - (m.jugadores || []).filter(Boolean).length);
        return `- ${when} · libres ${free}/4`;
      }).join("\n");
      return currentPersonality === "vecina"
        ? `Te van bien estos abiertos ahora mismo:\n${preview}`
        : `Partidos abiertos recomendados por compatibilidad de nivel:\n${preview}`;
  }

  if (intent === "CMD_WEATHER_TODAY" || intent === "CMD_WEATHER_TOMORROW") {
      const summary = _buildWeatherSummary(intent === "CMD_WEATHER_TODAY" ? 0 : 1);
      if (!summary) {
        return currentPersonality === "vecina"
          ? "Ahora mismo no tengo el clima sincronizado, pero en unos segundos debería estar."
          : "No hay datos meteorológicos disponibles en este momento.";
      }
      if (currentPersonality === "vecina") {
        return `Clima para ${summary.dayLabel}: ${summary.condition}, ${summary.avgTemp}°C, lluvia aprox ${summary.rainProb}% y viento ${summary.wind} km/h. Consejo pista: ${summary.advice}`;
      }
      return `Previsión ${summary.dayLabel}: condición ${summary.condition}, temperatura media ${summary.avgTemp}°C, probabilidad de lluvia ${summary.rainProb}% y viento ${summary.wind} km/h. Recomendación: ${summary.advice}`;
  }

  if (intent === "CMD_APP_HELP") {
      const up = _getMyUpcomingMatches(ctx.uid).length;
      const open = Number(sys.openCircuitMatches || 0);
      const help = [
        "Home: estado actual, nivel, IA y accesos rápidos.",
        "Calendario: reserva pista, únete a abiertos y revisa horarios.",
        "Ranking: clasificación, variaciones ELO y desglose de puntos.",
        "Diario: registra partido/sensaciones para mejorar recomendaciones.",
        "Perfil: métricas de juego, progreso y ajustes personales."
      ].join("\n");
      return currentPersonality === "vecina"
        ? `Te guío rápido:\n${help}\nAhora mismo tienes ${up} próximos partidos y hay ${open} abiertos en el club.`
        : `Guía de uso:\n${help}\nEstado actual: ${up} próximos partidos personales, ${open} partidos abiertos en la plataforma.`;
  }

  if (intent === "CMD_ADVICE") {
      const insights = Analyzer.getDiaryInsights(u);
      const state = ctx.playerState || {};
      const partner = Analyzer.findPartner(u.id);
      
      let advice = currentPersonality === 'vecina' 
        ? `Escúchame bien, {NAME}. Basado en tu ADN de nivel {LEVEL}: `
        : `Análisis Táctico Personalizado para {NAME} (Nivel {LEVEL}): `;

      if (state.mode === 'Burnout' || insights?.hasFatigue) {
          advice += currentPersonality === 'vecina' ? "¡Para el carro! Estás cansado y vas a lesionarte. ¡Hoy toca sofá!" : "Advertencia: Niveles de fatiga críticos. Riesgo de lesión elevado. Prioridad: Recuperación.";
      } else if (insights?.worstShot) {
          const shotLabels = { serve: 'Saque', volley: 'Volea', bandeja: 'Bandeja', vibora: 'Víbora', smash: 'Remate', lob: 'Globo' };
          advice += currentPersonality === 'vecina' 
            ? `Tu **${shotLabels[insights.worstShot]}** me tiene preocupada. ¡Vete al muro a practicar!` 
            : `Foco técnico: Tu rendimiento en **${shotLabels[insights.worstShot]}** es inferior a tu media. Se recomienda sesión específica de refuerzo.`;
      } else {
          advice += currentPersonality === 'vecina' ? "¡Estás hecho un pincel! Sigue así y entrarás en el top pronto." : "Rendimiento estable. Mantén el volumen de entrenamiento actual.";
      }

      if (partner) {
          advice += currentPersonality === 'vecina' ? ` Ah, y llama a **${partner.nombreUsuario || partner.nombre}**, que hacéis buena pareja.` : ` Nota: Alta sinergia detectada con **${partner.nombreUsuario || partner.nombre}**.`;
      }

      return R(advice);
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
      const played = Number(u.partidosJugados || 0);
      const wins = Number(u.victorias || 0);
      const losses = Number(u.derrotas || Math.max(0, played - wins));
      const rankPos = DATA_CACHE.globalUsers
        .slice()
        .sort((a, b) => Number(b.puntosRanking || 0) - Number(a.puntosRanking || 0))
        .findIndex((x) => x.id === ctx.uid) + 1;
      return currentPersonality === 'vecina'
        ? `Números reales: ELO ${ctx.lastPoints}, nivel ${ctx.level}, récord ${wins}-${losses} en ${played} partidos, winrate ${ctx.winRate}, racha ${ctx.streakText}, ranking #${rankPos > 0 ? rankPos : "--"}.`
        : `Métricas personales: ELO ${ctx.lastPoints} | Nivel ${ctx.level} | Récord ${wins}-${losses} (${played} partidos) | WinRate ${ctx.winRate} | Racha ${ctx.streakText} | Ranking #${rankPos > 0 ? rankPos : "--"}.`;
  }

  if (intent === "CMD_GEAR_ADVICE") {
      return currentPersonality === 'vecina'
        ? "¡Ay la pala! Si es que siempre culpamos a la pala... Si eres de pegar fuerte, pilla una forma Diamante. Si eres más de colocarla, redonda. Y si no das una... ¡clases, cariño, clases!"
        : "Recomendación de Material: Para juego ofensivo (Smash/Víbora), utiliza formato Diamante y balance alto. Para control y defensa, formato Redondo con balance bajo. El formato Lágrima ofrece un balance híbrido.";
  }

  if (intent === "CMD_PREDICT") {
      const prob = 50 + (ctx.streak * 5);
      return currentPersonality === 'vecina'
        ? `Pues mira, corazón, con esa racha de ${ctx.streakText} te doy un ${prob}% de que ganes hoy. ¡Pero no te fíes, que la pelota es redonda!`
        : `Análisis Predictivo: Probabilidad estimada de victoria del ${prob}% basada en métricas de momentum y estado de forma. Sujeto a variaciones por emparejamiento.`;
  }

  if (intent === "CMD_DIARY_ANALYSIS") {
      const insights = Analyzer.getDiaryInsights(u);
      const state = ctx.playerState || {};
      
      if (!insights) return currentPersonality === 'vecina' ? "¡Cariño, tienes el diario más vacío que mi nevera un lunes! Registra algo y te cuento." : "No hay suficientes datos en tu Diario Táctico para generar un informe de rendimiento.";

      const { latest, avgFatigue, avgStress, worstShot, bestShot, hasFatigue, hasStress, lastLesson } = insights;
      const shotLabels = { serve: 'Saque', volley: 'Volea', bandeja: 'Bandeja', vibora: 'Víbora', smash: 'Remate', lob: 'Globo' };
      
      const goodS = shotLabels[bestShot] || bestShot;
      const badS = shotLabels[worstShot] || worstShot;

      if (currentPersonality === 'vecina') {
          let msg = `Oye, he estado ojeando tu diario... `;
          if (lastLesson) msg += `Lo último que aprendiste fue a **${lastLesson}**. `;
          
          if (hasFatigue) msg += "¡Te veo cansadísimo! Descansa un poco, que no estamos para trotes. ";
          if (hasStress) msg += "Y relájate, que los nervios en la red son traicioneros. ";

          msg += `Tu **${goodS}** está de dulce, pero ese **${badS}**... ¡ay! Hay que darle una vuelta. `;
          
          if (state.mode === 'Burnout') msg += "¡Ojo! La Matrix dice que estás al límite. ¡Para antes de romperte!";
          else if (state.mode === 'On_Fire') msg += "¡Estás en racha! Es el momento de retar a los grandes.";
          
          return msg;
      }
      
      return `Auditoría Tactica: Basado en ${insights.trendSize} sesiones. Fortaleza: **${goodS.toUpperCase()}**. Debilidad: **${badS.toUpperCase()}**. Estado de Forma: ${state.modeLabel || 'Normal'}. ${hasFatigue ? '[AVISO: FATIGA ALTA]' : ''} ${hasStress ? '[AVISO: ESTRÉS DETECTADO]' : ''} Conclusión: ${lastLesson ? 'Integrando lección: ' + lastLesson : 'Sin lecciones pendientes'}.`;
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

  // Fallback always useful with real data/context
  const upcoming = _getMyUpcomingMatches(ctx.uid).length;
  const open = Number(sys.openCircuitMatches || 0);
  const wToday = _buildWeatherSummary(0);
  const climateLine = wToday
    ? `Clima hoy: ${wToday.condition}, ${wToday.avgTemp}°C, lluvia ${wToday.rainProb}%.`
    : "Clima hoy no disponible todavía.";
  return currentPersonality === "vecina"
    ? `Te doy estado rápido: ELO ${ctx.lastPoints}, nivel ${ctx.level}, racha ${ctx.streakText}, próximos ${upcoming}, abiertos ${open}. ${climateLine} Prueba comandos: nivel, próximo partido, abiertos, clima hoy/mañana, compara con...`
    : `Resumen instantáneo: ELO ${ctx.lastPoints}, nivel ${ctx.level}, racha ${ctx.streakText}, próximos ${upcoming}, abiertos ${open}. ${climateLine} Comandos útiles: nivel, próximo partido, abiertos, clima hoy/mañana, compara con...`;
}


function _detectIntent(query) {
  const q = query.toLowerCase();
  if (query.startsWith("CMD_")) return query;
  if (q.includes("hola") || q.includes("buenas") || q.includes("hi")) return "CMD_GREETING";
  if (q.includes("como usar") || q.includes("cómo usar") || q.includes("guia app") || q.includes("ayuda app")) return "CMD_APP_HELP";
  if (q.includes("proximo partido") || q.includes("próximo partido") || q.includes("cuando juego") || q.includes("cuándo juego")) return "CMD_NEXT_MATCH";
  if (q.includes("hoy llueve") || q.includes("clima hoy") || q.includes("tiempo hoy")) return "CMD_WEATHER_TODAY";
  if (q.includes("mañana llueve") || q.includes("clima mañana") || q.includes("tiempo mañana")) return "CMD_WEATHER_TOMORROW";
  if (q.includes("llueve") || q.includes("clima") || q.includes("tiempo")) return "CMD_WEATHER_TODAY";
  if (q.includes("contexto") || q.includes("que es esto") || q.includes("app")) return "CMD_APP_CONTEXT";
  if (q.includes("global") || q.includes("comunidad") || q.includes("gente")) return "CMD_GLOBAL_STATS";
  if (q.includes("ultimo partido") || q.includes("último partido")) return "CMD_LAST_MATCH";
  if (q.includes("partidos abiertos") || q.includes("abiertos") || q.includes("reservar")) return "CMD_OPEN_MATCHES";
  if (q.includes("nivel") || q.includes("progreso") || q.includes("progeso") || q.includes("subir")) return "CMD_LEVEL_PROGRESS";
  if (q.includes("historial") || q.includes("visto") || q.includes("partidos")) return "CMD_HISTORY";
  if (q.includes("consejo") || q.includes("ayudame") || q.includes("que hago")) return "CMD_ADVICE";
  if (q.includes("nemesis") || q.includes("rival") || q.includes("odio")) return "CMD_NEMESIS";
  if (q.includes("victima") || q.includes("gano siempre") || q.includes("facil")) return "CMD_VICTIM";
  if (q.includes("compara") || q.includes(" vs ") || q.includes("contra")) return "CMD_COMPARE";
  if (q.includes("socio") || q.includes("pareja") || q.includes("compañero")) return "CMD_PARTNER_SYNC";
  if (q.includes("recomienda") || q.includes("quien jugar") || q.includes("retar")) return "CMD_RIVAL_INTEL";
  if (q.includes("estadistica") || q.includes("datos") || q.includes("numeros")) return "CMD_STATS_READ";
  if (q.includes("pala") || q.includes("raqueta") || q.includes("material")) return "CMD_GEAR_ADVICE";
  if (q.includes("ganar") || q.includes("pronostico") || q.includes("suerte")) return "CMD_PREDICT";
  if (q.includes("diario") || q.includes("aprender") || q.includes("analiza mis") || q.includes("objetivo")) return "CMD_DIARY_ANALYSIS";
  if (q.includes("elo") || q.includes("puntos") || q.includes("calculo")) return "CMD_ELO_FORMULA";
  if (q.includes("ayuda") || q.includes("como funciona") || q.includes("guia")) return "CMD_TUTORIAL";
  return "GENERAL";
}

// --- PUBLIC INTERFACE & UI ---

export async function sendMessage(prefillText = "") {
  const input = document.getElementById("ai-input-field");
  if (prefillText && input) {
    input.value = String(prefillText);
  }
  const rawText = input.value.trim();
  if (!rawText) return;
  const visualText = input.dataset.displayLabel || rawText;
  const text = rawText;

  const msgs = document.getElementById("ai-messages");
  
  // User Msg
  const userDiv = document.createElement("div");
  userDiv.className = "ai-msg user";
  userDiv.innerHTML = `<p>${visualText}</p>`;
  msgs.appendChild(userDiv);
  
  input.value = "";
  delete input.dataset.displayLabel;
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

export function toggleChat(forceOpen = null) {
  const panel = document.getElementById("vecina-chat-panel");
  if (!panel) return;
  if (typeof forceOpen === "boolean") chatOpen = forceOpen;
  else chatOpen = !chatOpen;
  if(chatOpen) {
      panel.style.setProperty("display", "flex", "important");
      panel.classList.add("open");
      document.body.classList.add("ai-chat-open");
      document.documentElement.classList.add("ai-chat-open");
      _syncData();
      document.getElementById("ai-input-field").focus();
  } else {
      panel.classList.remove("open");
      document.body.classList.remove("ai-chat-open");
      document.documentElement.classList.remove("ai-chat-open");
      setTimeout(() => {
        if (!chatOpen) panel.style.setProperty("display", "none", "important");
      }, 260);
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
    input.value = cmd;
    input.dataset.displayLabel = label || cmd;
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
                <!-- USER SELECTOR FOR COMPARISON -->
                <div class="flex flex-row items-center gap-2 mb-3 bg-white/05 p-2 rounded-xl border border-white/05">
                    <i class="fas fa-users text-[10px] text-primary ml-1"></i>
                    <select id="ai-compare-select" class="bg-transparent border-none text-[10px] text-white/50 font-black uppercase outline-none flex-1">
                        <option value="">Selecciona un usuario...</option>
                    </select>
                    <button onclick="window.compareWithSelected()" class="text-[9px] font-black text-primary uppercase bg-primary/10 px-2 py-1 rounded-lg border border-primary/20">VS</button>
                </div>

                <div id="ai-command-wrap" class="ai-command-container-v7 mb-4 overflow-x-auto custom-scroll-hidden">
                    <div class="flex flex-row gap-2 pb-1" style="width: max-content;">
                        <button class="ai-quick-btn-v7 mini" onclick="window.aiQuickCmd('CMD_TUTORIAL','Guia')"><i class="fas fa-book-sparkles"></i><span>Guia</span></button>
                        <button class="ai-quick-btn-v7 mini" onclick="window.aiQuickCmd('CMD_STATS_READ','Datos')"><i class="fas fa-chart-line-up"></i><span>Datos</span></button>
                        <button class="ai-quick-btn-v7 mini" onclick="window.aiQuickCmd('CMD_HISTORY','Historial')"><i class="fas fa-history"></i><span>Historial</span></button>
                        <button class="ai-quick-btn-v7 mini" onclick="window.aiQuickCmd('CMD_ADVICE','Consejo')"><i class="fas fa-lightbulb"></i><span>Consejo</span></button>
                        <button class="ai-quick-btn-v7 mini" onclick="window.aiQuickCmd('CMD_RIVAL_INTEL','Rivales')"><i class="fas fa-crosshairs"></i><span>Rivales</span></button>
                        <button class="ai-quick-btn-v7 mini" onclick="window.aiQuickCmd('CMD_DIARY_ANALYSIS','Diario')"><i class="fas fa-book-journal-whills"></i><span>Diario</span></button>
                        <button class="ai-quick-btn-v7 mini" onclick="window.aiQuickCmd('CMD_NEMESIS','Nemesis')"><i class="fas fa-skull"></i><span>Nemesis</span></button>
                        <button class="ai-quick-btn-v7 mini" onclick="window.aiQuickCmd('CMD_VICTIM','Victima')"><i class="fas fa-ghost"></i><span>Victima</span></button>
                        <button class="ai-quick-btn-v7 mini" onclick="window.aiQuickCmd('CMD_PARTNER_SYNC','Socio')"><i class="fas fa-user-group"></i><span>Socio</span></button>
                        <button class="ai-quick-btn-v7 mini" onclick="window.aiQuickCmd('CMD_LEVEL_PROGRESS','Nivel')"><i class="fas fa-gauge-high"></i><span>Nivel</span></button>
                        <button class="ai-quick-btn-v7 mini" onclick="window.aiQuickCmd('CMD_NEXT_MATCH','Próximo')"><i class="fas fa-calendar-check"></i><span>Próximo</span></button>
                        <button class="ai-quick-btn-v7 mini" onclick="window.aiQuickCmd('CMD_OPEN_MATCHES','Abiertos')"><i class="fas fa-door-open"></i><span>Abiertos</span></button>
                        <button class="ai-quick-btn-v7 mini" onclick="window.aiQuickCmd('CMD_WEATHER_TODAY','Clima Hoy')"><i class="fas fa-cloud-sun"></i><span>Hoy</span></button>
                        <button class="ai-quick-btn-v7 mini" onclick="window.aiQuickCmd('CMD_WEATHER_TOMORROW','Clima Mañana')"><i class="fas fa-cloud-rain"></i><span>Mañana</span></button>
                    </div>
                </div>
                <details class="ai-cmd-details mb-3" open>
                    <summary><i class="fas fa-terminal"></i> VER TODOS LOS COMANDOS</summary>
                    <div class="ai-cmd-grid">
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_GREETING','Hola')">Hola</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_APP_CONTEXT','App')">Contexto App</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_GLOBAL_STATS','Global')">Stats Global</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_TUTORIAL','Guía')">Guía</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_STATS_READ','Datos')">Datos</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_HISTORY','Historial')">Historial</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_ADVICE','Consejo')">Consejo</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_LEVEL_PROGRESS','Nivel')">Nivel</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_NEMESIS','Némesis')">Némesis</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_VICTIM','Víctima')">Víctima</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_PARTNER_SYNC','Socio')">Socio</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_RIVAL_INTEL','Rivales')">Rivales</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_DIARY_ANALYSIS','Diario')">Diario</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_PREDICT','Pronóstico')">Pronóstico</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_GEAR_ADVICE','Pala')">Pala</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_ELO_FORMULA','ELO')">ELO</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_NEXT_MATCH','Próximo')">Próximo partido</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_OPEN_MATCHES','Abiertos')">Partidos abiertos</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_WEATHER_TODAY','Clima hoy')">Clima hoy</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_WEATHER_TOMORROW','Clima mañana')">Clima mañana</button>
                        <button class="ai-cmd-chip" onclick="window.aiQuickCmd('CMD_APP_HELP','Ayuda App')">Ayuda app</button>
                    </div>
                </details>
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
            .custom-scroll-hidden::-webkit-scrollbar { display: none; }
            #vecina-chat-fab.ai-fab {
                position: fixed;
                bottom: calc(90px + env(safe-area-inset-bottom));
                right: 20px;
                width: 56px; height: 56px; border-radius: 50%;
                background: var(--primary); color: #000;
                font-size: 24px; display: flex; align-items: center; justify-content: center;
                box-shadow: 0 10px 25px rgba(198, 255, 0, 0.3);
                z-index: 12040; border: none; cursor: pointer;
                transition: transform 0.2s;
                z-index: 13050 !important;
            }
            #vecina-chat-fab.ai-fab:active { transform: scale(0.9); }

            .ai-chat-panel.v14 { 
                border-radius: 32px 32px 0 0; 
                border: 1px solid rgba(255,255,255,0.1); 
                background: linear-gradient(180deg, rgba(10, 15, 30, 0.95) 0%, rgba(2, 4, 12, 1) 100%);
                backdrop-filter: blur(30px);
                box-shadow: 0 -15px 50px rgba(0,0,0,0.9);
                overflow: hidden;
                display: flex;
                flex-direction: column;
                position: fixed;
                left: 0; right: 0;
                bottom: calc(86px + env(safe-area-inset-bottom));
                width: 100%;
                height: 85dvh; 
                max-height: 800px;
                z-index: 12050;
                transform: none;
                opacity: 0;
                transition: opacity 0.25s ease;
                pointer-events: none;
                visibility: hidden;
            }
            .ai-chat-panel.v14.open { 
                transform: none;
                opacity: 1;
                pointer-events: all;
                visibility: visible;
            }

            @media (min-width: 768px) {
                .ai-chat-panel.v14 {
                    left: auto; right: 20px;
                    bottom: 20px;
                    width: 420px; height: 700px;
                    border-radius: 24px;
                }
                #vecina-chat-fab.ai-fab {
                    bottom: 30px !important;
                    right: 30px !important;
                }
            }
            html.ai-chat-open,
            body.ai-chat-open {
                overflow: hidden !important;
                overscroll-behavior: none !important;
                height: 100dvh !important;
            }
            
            /* CONTENT STYLES */
            .ai-chat-header { min-height: 70px; display: flex; align-items: center; gap: 12px; background: rgba(255,255,255,0.03); }
            .ai-avatar-box { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; transition: all 0.3s; cursor: pointer; }
            .ai-avatar-box.coach { background: rgba(0, 212, 255, 0.1); color: #00d4ff; border: 1px solid rgba(0, 212, 255, 0.2); }
            .ai-avatar-box.vecina { background: rgba(198, 255, 0, 0.1); color: #c6ff00; border: 1px solid rgba(198, 255, 0, 0.2); }
            
            .ai-chat-body { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-bottom: 20px; scroll-behavior: smooth; }
            .ai-msg { max-width: 85%; animation: fadeIn 0.3s; }
            .ai-msg.user { align-self: flex-end; }
            .ai-msg.bot { align-self: flex-start; }
            .ai-msg p { padding: 12px 16px; border-radius: 20px; font-size: 0.9rem; line-height: 1.45; margin: 0; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
            .ai-msg.user p { background: var(--primary); color: #000; border-bottom-right-radius: 4px; font-weight: 700; }
            .ai-msg.bot p { background: rgba(255,255,255,0.08); color: #fff; border-bottom-left-radius: 4px; border: 1px solid rgba(255,255,255,0.05); }
            
            .ai-command-container-v7 { 
                background: rgba(255,255,255,0.03); 
                padding: 10px; 
                border-radius: 20px; 
                border: 1px solid rgba(255,255,255,0.05);
            }
            .ai-quick-btn-v7 { 
                display: flex; 
                flex-direction: column; 
                align-items: center; 
                justify-content: center;
                gap: 5px; 
                padding: 10px; 
                background: rgba(255,255,255,0.05); 
                border-radius: 16px; 
                border: 1px solid rgba(255,255,255,0.05); 
                color: #fff; 
                cursor: pointer; 
                transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); 
                min-width: 75px;
                height: 60px;
            }
            .ai-quick-btn-v7:hover { background: rgba(255,255,255,0.1); border-color: var(--primary); transform: translateY(-2px); }
            .ai-quick-btn-v7 i { font-size: 16px; color: var(--primary); }
            .ai-quick-btn-v7 span { font-size: 8px; text-transform: uppercase; font-weight: 900; letter-spacing: 0.5px; opacity: 0.8; }
            
            .ai-input-container-v7 { 
                display: flex; 
                gap: 8px; 
                background: rgba(0,0,0,0.5); 
                padding: 6px; 
                border-radius: 24px; 
                border: 1px solid rgba(255,255,255,0.1);
                box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            }
            .ai-chat-footer {
                max-height: 44dvh;
                overflow-y: auto;
            }
            .ai-cmd-details summary {
                list-style: none;
                cursor: pointer;
                font-size: 10px;
                font-weight: 900;
                letter-spacing: 1px;
                text-transform: uppercase;
                color: rgba(255,255,255,.82);
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 8px 10px;
                border-radius: 10px;
                background: rgba(255,255,255,.04);
                border: 1px solid rgba(255,255,255,.08);
            }
            .ai-cmd-details[open] summary {
                border-color: rgba(198,255,0,.4);
                color: #d9ff7f;
            }
            .ai-cmd-grid {
                margin-top: 8px;
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 8px;
            }
            .ai-cmd-chip {
                padding: 8px 9px;
                border-radius: 10px;
                border: 1px solid rgba(255,255,255,.1);
                background: rgba(255,255,255,.03);
                color: rgba(255,255,255,.9);
                font-size: 10px;
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: .7px;
            }
            .ai-cmd-chip:hover {
                border-color: rgba(198,255,0,.4);
                background: rgba(198,255,0,.08);
                color: #e5ffad;
            }
            .ai-input-v7 { flex: 1; background: transparent; border: none; color: #fff; padding: 10px 15px; font-size: 0.95rem; outline: none; }
            .ai-send-btn-v7 { 
                width: 48px; 
                height: 48px; 
                border-radius: 50%; 
                background: var(--primary); 
                color: #000; 
                display: flex; 
                align-items: center; 
                justify-content: center; 
                cursor: pointer; 
                font-size: 16px; 
                border: none; 
                transition: 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); 
            }
            .ai-send-btn-v7:hover { transform: scale(1.1) rotate(-10deg); box-shadow: 0 0 20px var(--primary); }
            
            #ai-compare-select {
                -webkit-appearance: none;
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='rgba(255,255,255,0.5)'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E");
                background-repeat: no-repeat;
                background-position: right 8px center;
                background-size: 12px;
                padding-right: 28px;
            }

            @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        </style>
    `;
  document.body.insertAdjacentHTML("beforeend", chatHTML);
  const panel = document.getElementById("vecina-chat-panel");

  // Hard-lock geometry to avoid any stylesheet/caching conflict that can push body height.
  const applyChatGeometry = () => {
    const desktop = window.matchMedia("(min-width: 768px)").matches;
    if (fab) {
      fab.style.setProperty("bottom", desktop ? "30px" : "calc(90px + env(safe-area-inset-bottom))", "important");
      fab.style.setProperty("right", desktop ? "30px" : "20px", "important");
    }
    if (panel) {
      if (desktop) {
        panel.style.setProperty("left", "auto", "important");
        panel.style.setProperty("right", "20px", "important");
        panel.style.setProperty("bottom", "20px", "important");
        panel.style.setProperty("width", "420px", "important");
        panel.style.setProperty("height", "700px", "important");
      } else {
        panel.style.setProperty("left", "0", "important");
        panel.style.setProperty("right", "0", "important");
        panel.style.setProperty("bottom", "calc(86px + env(safe-area-inset-bottom))", "important");
        panel.style.setProperty("width", "100%", "important");
        panel.style.setProperty("height", "85dvh", "important");
      }
    }
  };

  if (fab) {
    fab.style.setProperty("position", "fixed", "important");
    fab.style.setProperty("z-index", "13050", "important");
  }
  if (panel) {
    panel.style.setProperty("position", "fixed", "important");
    panel.style.setProperty("max-height", "800px", "important");
    panel.style.setProperty("z-index", "12050", "important");
    panel.style.setProperty("display", "none", "important");
  }
  applyChatGeometry();
  window.addEventListener("resize", applyChatGeometry);

  document.getElementById("ai-send-btn").onclick = () => sendMessage();
  document.getElementById("ai-input-field").onkeypress = (e) => {
    if (e.key === "Enter") sendMessage();
  };

  window.toggleAiChat = toggleChat;
  window.switchAiPersonality = switchAiPersonality;
  window.aiQuickCmd = window.aiQuickCmd;

  window.compareWithSelected = () => {
      const sel = document.getElementById("ai-compare-select");
      if(!sel.value) return;
      const name = sel.options[sel.selectedIndex].text;
      const input = document.getElementById("ai-input-field");
      input.value = `Compara con ${name}`;
      sendMessage();
  };
}
