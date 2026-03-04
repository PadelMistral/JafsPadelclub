import { buildAIContext } from "./ai-context-builder.js";
import { buildCoachInsights } from "./ai-coach.js";
import { auth } from "../firebase-service.js";
import { logError, logWarn } from "../core/app-logger.js";
import { analyticsCount, analyticsTiming } from "../core/analytics.js";
import { rateLimitCheck } from "../core/rate-limit.js";
import {
  getTopMemoryInsights,
  rememberInsight,
  rememberPattern,
} from "./ai-memory.js";

/*
  AI Core is prepared for multi-coach expansion.
  Future: register coach profiles by user/phase (tactical, mental, rival-scout).
*/
const coachRegistry = {
  default: "coach_v1",
};
const CONTEXT_TTL_MS = 60 * 1000;
const contextCache = new Map();

function buildPromptEnvelope({ query, phase, context, memory, coach }) {
  return {
    coachId: coachRegistry.default,
    phase,
    query: String(query || "").slice(0, 240),
    user: {
      name: context.user.name,
      level: context.user.level,
      points: context.user.points,
      streak: context.user.streak,
    },
    stats: context.stats,
    target: context.target,
    rivals: {
      upcoming: context.rivals?.upcoming || [],
      headToHead: (context.rivals?.headToHead || []).slice(0, 2),
    },
    recentMatches: (context.recentMatches || []).slice(0, 5),
    memory: {
      topInsights: memory.topInsights,
      topPatterns: memory.topPatterns,
    },
    coach,
    tokenOptimization: {
      recentMatches: (context.recentMatches || []).length,
      diaryEntries: (context.diary || []).length,
      memoryItems: (memory.topInsights || []).length + (memory.topPatterns || []).length,
    },
  };
}

function runLocalAIMotor(prompt) {
  const phase = prompt.phase || "daily";
  const coach = prompt.coach || {};
  const user = prompt.user || {};
  const stats = prompt.stats || {};
  const rivals = prompt.rivals || {};
  const recent = prompt.recentMatches || [];
  const memory = prompt.memory || {};

  // Helper for win/loss form
  const formStr = recent.slice(0, 5).map(m => m.outcome?.win ? 'W' : 'L').join('');

  if (phase === "post") return coach.postMatchAdvice || coach.todaySuggestion;
  if (phase === "pre") return coach.preMatchAdvice || coach.todaySuggestion;

  if (phase === "chat") {
    const q = String(prompt.query || "").toLowerCase();

    // === COMPREHENSIVE QUERY HANDLERS ===

    // Notification Guide
    if (q.includes("notificacion")) {
      return "📱 Para recibir notificaciones:\n1. Asegúrate de que tu navegador tiene permisos.\n2. En Chrome/Safari, añade la App a tu pantalla de inicio (PWA).\n3. Prueba el botón 'FIX NOTIF' en tu perfil si no te llegan.\n4. Si el sistema dice 'No permitido', refresca y pulsa 'Permitir' cuando aparezca el banner.";
    }

    // Apoing Guide
    if (q.includes("apoing")) {
      return "📅 Para conectar Apoing:\n1. Ve a tu Perfil > Botón 'CONECTAR APOING'.\n2. Pega allí el enlace ICS que obtienes en la web de Apoing (Mis Reservas > Sincronizar Calendario).\n3. Una vez guardado, el calendario de la App mostrará tus reservas de pista automáticamente.\n\n💡 Tus reservas propias aparecerán con color especial en el calendario.";
    }

    // My summary / resumen
    if (q.includes("resumen") || q.includes("summary") || q.includes("mi ranking") || q.includes("estado")) {
      const winrate = stats.recentWinRate ? (stats.recentWinRate * 100).toFixed(0) : '0';
      return `🎮 ${user.name} — Resumen Competitivo\n\n🏆 ELO: ${user.points} puntos\n⭐ Nivel: ${user.level}\n🔥 Racha actual: ${user.streak > 0 ? '+' : ''}${user.streak}\n📊 Partidos totales: ${stats.totalMatches || 0} (${stats.playedMatches || 0} jugados)\n🎯 Winrate reciente: ${winrate}% (${stats.recentWins || 0}W / ${stats.recentLosses || 0}L)\n📈 Forma reciente: ${formStr || 'Sin datos'}\n\n${user.streak >= 3 ? '💪 ¡Gran racha! Mantén la intensidad.' : user.streak <= -3 ? '🔄 Racha negativa. Enfoca en consistencia y evita errores no forzados.' : '⚖️ Forma estable. Buen momento para buscar rivales de nivel similar.'}`;
    }

    // Last match
    if (q.includes("último partido") || q.includes("ultimo partido") || q.includes("puntos ganados")) {
      const last = recent[0];
      if (!last) return "No tengo datos de tu último partido jugado. Juega al menos un partido para que pueda analizarlo.";
      const outcome = last.outcome?.win ? '✅ Victoria' : '❌ Derrota';
      const date = last.date ? new Date(last.date).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' }) : 'fecha desconocida';
      return `🎾 Último partido (${date})\n\n${outcome}\n📋 Resultado: ${last.result || 'Sin resultado'}\n👥 Jugadores: ${(last.players || []).join(', ')}\n\n${last.outcome?.win ? '💪 Sigamos sumando victorias.' : '🔄 A remontar en el próximo. Analiza qué puntos te costaron más.'}`;
    }

    // Rival intel
    if (q.includes("rival") || q.includes("nemesis") || q.includes("socio") || q.includes("victima")) {
      const h2h = rivals.headToHead || [];
      if (!h2h.length) return "No tengo datos head-to-head con rivales aún. Juega más partidos para que pueda analizar tus enfrentamientos.";
      let report = "🔍 Análisis de Rivales\n\n";
      h2h.forEach(r => {
        const total = r.wins + r.losses;
        const wr = total > 0 ? ((r.wins/total)*100).toFixed(0) : 0;
        const tag = r.wins > r.losses ? '🟢 DOMINAS' : r.wins < r.losses ? '🔴 NÉMESIS' : '🟡 PAREJO';
        report += `${tag} ${r.rivalUid}: ${r.wins}W-${r.losses}L (${wr}% WR en ${total} partidos)\n`;
      });
      if (coach.rivalAlert) report += `\n⚡ ${coach.rivalAlert.summary}`;
      return report;
    }

    // Open matches recommendation
    if (q.includes("recomend") || q.includes("convien") || q.includes("abierto")) {
      return `🎯 Recomendación de partidos\n\nCon tu ELO de ${user.points} y nivel ${user.level}, te conviene:\n\n1️⃣ Buscar partidos contra rivales entre ${Math.round(user.points - 100)} y ${Math.round(user.points + 100)} ELO para ganar puntos de forma segura.\n2️⃣ Si tu racha es ${user.streak >= 0 ? 'positiva' : 'negativa'}, ${user.streak >= 0 ? 'arriesga con rivales más fuertes para acelerar tu subida' : 'busca partidos más accesibles para recuperar confianza'}.\n3️⃣ Revisa los partidos abiertos en la pestaña "Abiertos" del Home.\n\n${stats.playedMatches < 10 ? '💡 Aún tienes pocos partidos — cada uno cuenta mucho para tu ELO!' : '📊 Tienes buena base de datos. La IA puede darte consejos más precisos.'}`;
    }

    // Events
    if (q.includes("evento") || q.includes("torneo")) {
      return "🏆 Eventos y Torneos\n\nConsulta la sección 'Eventos' para ver torneos activos, ligas y eventos especiales del circuito Padeluminatis.\n\n💡 Participar en torneos da puntos extra de ELO y visibilidad en el ranking.";
    }

    // Level / subir
    if (q.includes("nivel") || q.includes("subir") || q.includes("subid")) {
      return `📈 Progresión de Nivel\n\nTu nivel actual: ⭐ ${user.level}\nTu ELO: ${user.points}\n\n📊 El nivel se calcula en base a tu ELO:\n• 2.0-2.5: Iniciación (800-950 ELO)\n• 2.5-3.0: Intermedio (950-1050 ELO)\n• 3.0-3.5: Avanzado (1050-1200 ELO)\n• 3.5-4.0: Semi-Pro (1200-1400 ELO)\n• 4.0+: Elite (1400+ ELO)\n\n${user.points < 1050 ? '💡 Necesitas ganar más partidos para subir. Busca rivales de tu nivel.' : '💪 Buen ELO! Sigue sumando victorias contra rivales fuertes.'}`;
    }

    // ELO system explanation
    if (q.includes("elo") || q.includes("punto") || q.includes("sistema")) {
      return `📊 Sistema ELO Padeluminatis\n\nEl sistema ELO calcula tu puntuación basándose en:\n\n1️⃣ Resultado: Ganar suma puntos, perder resta\n2️⃣ Diferencia de nivel: Ganar a rivales más fuertes suma más\n3️⃣ Factor K: Los primeros partidos tienen más impacto\n\n• Victoria vs rival más fuerte: +15 a +25 pts\n• Victoria vs rival similar: +10 a +15 pts\n• Victoria vs rival más débil: +5 a +10 pts\n• Derrota: Se resta de forma proporcional\n\nTu ELO actual: ${user.points} | Racha: ${user.streak > 0 ? '+' : ''}${user.streak}`;
    }

    // Ranks / divisions
    if (q.includes("rango") || q.includes("division") || q.includes("color")) {
      return "🏅 Rangos y Divisiones del Circuito\n\n🥉 BRONCE (< 950 ELO) — Color cobre\n🥈 PLATA (950-1049) — Color plateado\n🥇 ORO (1050-1199) — Color dorado\n💎 DIAMANTE (1200-1399) — Color cyan\n👑 ELITE (1400+) — Color púrpura\n\nCada división tiene su propio brillo y color en la welcome card del Home.";
    }

    // Pattern / weakness
    if ((q.includes("patron") || q.includes("fallo") || q.includes("debilidad")) && coach.repeatedPattern) {
      return `🔍 Patrón Detectado\n\n${coach.repeatedPattern.summary}\n💡 ${coach.repeatedPattern.tacticalHint}`;
    }

    // Fallback: general coaching based on context
    if (coach.todaySuggestion) {
      return `🎾 Consejo del Día\n\n${coach.todaySuggestion}\n\n📊 Tu estado: ${user.points} ELO | Racha ${user.streak > 0 ? '+' : ''}${user.streak} | ${stats.playedMatches || 0} partidos\n\n💡 Prueba a preguntar: "Mi resumen", "Rival intel", "Cómo subo de nivel" o "Sistema ELO"`;
    }

    return `🤖 Asistente Padeluminatis\n\nTu ELO: ${user.points} | Nivel: ${user.level} | Racha: ${user.streak > 0 ? '+' : ''}${user.streak}\nPartidos: ${stats.playedMatches || 0} jugados | Winrate: ${stats.recentWinRate ? (stats.recentWinRate * 100).toFixed(0) : '0'}%\n\n💡 Comandos disponibles:\n• "Mi resumen" — Estado completo\n• "Último partido" — Análisis del último partido\n• "Rival intel" — Análisis de rivales\n• "Partidos recomendados" — Qué partidos te convienen\n• "Sistema ELO" — Cómo funcionan los puntos\n• "Subir de nivel" — Progresión\n• "Rangos" — Divisiones y colores`;
  }

  return coach.todaySuggestion || coach.preMatchAdvice;
}

async function loadContext(uid, match) {
  const cacheKey = `${uid}:${match?.id || "none"}`;
  const now = Date.now();
  const cached = contextCache.get(cacheKey);
  if (cached && now - cached.ts < CONTEXT_TTL_MS) return cached.context;

  const context = await buildAIContext({ uid, match });
  contextCache.set(cacheKey, { ts: now, context });
  return context;
}

async function orchestrate({ uid, query = "", match = null, phase = "daily" } = {}) {
  if (!uid) throw new Error("missing_uid");
  const activeUid = auth.currentUser?.uid || null;
  if (activeUid && activeUid !== uid) {
    logWarn("ai_uid_mismatch_blocked", { activeUid, requestedUid: uid, phase });
    throw new Error("unauthorized_ai_context");
  }
  const rl = rateLimitCheck(`ai:${uid}`, { windowMs: 5 * 60 * 1000, max: 40, minIntervalMs: 1200 });
  if (!rl.ok) {
    logWarn("ai_rate_limited", { uid, reason: rl.reason });
    throw new Error("ai_rate_limited");
  }
  const t0 = performance.now();

  const [context] = await Promise.all([
    loadContext(uid, match),
  ]);
  const memory = getTopMemoryInsights(uid, 3);

  const coach = buildCoachInsights(context);
  const prompt = buildPromptEnvelope({ query, phase, context, memory, coach });
  const text = runLocalAIMotor(prompt);

  rememberInsight(uid, {
    type: phase,
    text,
    matchId: context?.target?.id || null,
    rivalUid: context?.rivals?.upcoming?.[0] || null,
  });
  if (coach.repeatedPattern) {
    rememberPattern(uid, coach.repeatedPattern);
  }
  analyticsCount(`ai.usage.${phase}`, 1);
  analyticsTiming("ai.response_ms", performance.now() - t0);

  return {
    text,
    coach,
    contextMeta: {
      generatedAt: context.generatedAt,
      optimized: true,
      recentMatchesUsed: prompt.tokenOptimization.recentMatches,
      diaryEntriesUsed: prompt.tokenOptimization.diaryEntries,
      memoryItemsUsed: prompt.tokenOptimization.memoryItems,
    },
  };
}

export async function getDailySuggestion(uid) {
  try {
    return await orchestrate({ uid, phase: "daily" });
  } catch (e) {
    logError("ai_daily_failed", { uid, reason: e?.message || "unknown" });
    analyticsCount("ai.fallback.daily", 1);
    return {
      text: "Hoy enfocate en margen seguro: una bola extra antes de acelerar en puntos importantes.",
      coach: null,
      contextMeta: { optimized: true, fallback: true },
    };
  }
}

export async function getMatchAdvice({ uid, match, phase = "pre", query = "consejo partido" } = {}) {
  try {
    return await orchestrate({ uid, match, phase, query });
  } catch (e) {
    logError("ai_match_failed", { uid, phase, reason: e?.message || "unknown" });
    analyticsCount(`ai.fallback.${phase}`, 1);
    return {
      text: "Mantener consistencia y evitar errores no forzados sera la mejor decision tactica ahora.",
      coach: null,
      contextMeta: { optimized: true, fallback: true },
    };
  }
}

export async function handleAIQuery({ uid, query, match = null, phase = "chat" } = {}) {
  try {
    return await orchestrate({ uid, query, match, phase });
  } catch (e) {
    logError("ai_query_failed", { uid, phase, reason: e?.message || "unknown" });
    analyticsCount(`ai.fallback.${phase}`, 1);
    return {
      text: "No pude completar el analisis ahora. Reintenta en unos segundos.",
      coach: null,
      contextMeta: { optimized: true, fallback: true },
    };
  }
}

export { buildAIContext };
