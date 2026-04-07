import { db, getDocument, getDocsSafe } from "../firebase-service.js";
import { collection, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

const MATCH_CONTEXT_LIMIT = 5;

function toDateSafe(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isPlayed(match) {
  const state = String(match?.estado || "").toLowerCase();
  return state === "jugado" || state === "jugada" || Boolean(match?.resultado?.sets);
}

function isFinished(match) {
  const state = String(match?.estado || "").toLowerCase();
  return state === "jugado" || state === "jugada" || state === "cancelado" || state === "anulado";
}

function extractDiaryText(entry = {}) {
  const chunks = [
    entry.texto,
    entry.notas,
    entry.resumen,
    entry.sensaciones,
    entry.analisis,
    entry.entrada,
    entry.entradaLibre,
    entry.rivales,
    entry.fallos,
    entry.aciertos,
  ].filter(Boolean);

  if (entry.biometria && typeof entry.biometria === "object") {
    chunks.push(JSON.stringify(entry.biometria));
  }
  if (entry.tecnica && typeof entry.tecnica === "object") {
    chunks.push(JSON.stringify(entry.tecnica));
  }
  return chunks.join(" | ").slice(0, 320);
}

function parseSets(setsRaw = "") {
  const sets = String(setsRaw)
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((set) => {
      const [a, b] = set.split("-").map((v) => Number(v));
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      return { a, b };
    })
    .filter(Boolean);
  return sets;
}

function aliasUid(uid, currentUid) {
  if (!uid) return null;
  if (uid === currentUid) return "ME";
  if (String(uid).startsWith("GUEST_")) return "GUEST";
  return `RIVAL_${String(uid).slice(-4)}`;
}

function matchOutcomeForUid(match, uid) {
  const players = Array.isArray(match?.jugadores) ? match.jugadores : [];
  const idx = players.indexOf(uid);
  if (idx < 0) return null;

  const sets = parseSets(match?.resultado?.sets || "");
  if (!sets.length) return null;

  const myTeamA = idx <= 1;
  let wonSets = 0;
  let lostSets = 0;
  for (const s of sets) {
    const teamAWon = s.a > s.b;
    const didWinSet = myTeamA ? teamAWon : !teamAWon;
    if (didWinSet) wonSets += 1;
    else lostSets += 1;
  }
  return {
    win: wonSets > lostSets,
    wonSets,
    lostSets,
  };
}

async function getMatchCollections(uid) {
  const [am, re] = await Promise.all([
    getDocsSafe(
      query(collection(db, "partidosAmistosos"), where("jugadores", "array-contains", uid), limit(40)),
      "ai_ctx_am",
    ),
    getDocsSafe(
      query(collection(db, "partidosReto"), where("jugadores", "array-contains", uid), limit(40)),
      "ai_ctx_re",
    ),
  ]);

  const all = [
    ...(am?.docs || []).map((d) => ({ id: d.id, col: "partidosAmistosos", ...d.data() })),
    ...(re?.docs || []).map((d) => ({ id: d.id, col: "partidosReto", ...d.data() })),
  ].filter((m) => Array.isArray(m.jugadores) && m.jugadores.includes(uid));

  all.sort((a, b) => {
    const ad = toDateSafe(a.fecha)?.getTime() || 0;
    const bd = toDateSafe(b.fecha)?.getTime() || 0;
    return bd - ad;
  });
  return all;
}

function summarizeRivalries(matches, uid) {
  const now = Date.now();
  const upcoming = matches
    .filter((m) => !isFinished(m))
    .filter((m) => (toDateSafe(m.fecha)?.getTime() || 0) >= now - 30 * 60 * 1000)
    .sort((a, b) => (toDateSafe(a.fecha)?.getTime() || 0) - (toDateSafe(b.fecha)?.getTime() || 0));

  const nextMatch = upcoming[0] || null;
  const rivals = nextMatch
    ? (nextMatch.jugadores || []).filter((pid) => pid && pid !== uid && !String(pid).startsWith("GUEST_"))
    : [];

  const headToHead = rivals.map((rid) => {
    const games = matches.filter((m) => Array.isArray(m.jugadores) && m.jugadores.includes(rid) && isPlayed(m));
    let wins = 0;
    let losses = 0;
    for (const g of games) {
      const outcome = matchOutcomeForUid(g, uid);
      if (!outcome) continue;
      if (outcome.win) wins += 1;
      else losses += 1;
    }
    return { rivalUid: aliasUid(rid, uid), games: wins + losses, wins, losses };
  });

  return { nextMatch, rivals, headToHead };
}

export async function buildAIContext({ uid, match = null } = {}) {
  if (!uid) throw new Error("missing_uid");

  const [userDoc, rankingLogsSnap, diarySnap, allMyMatches] = await Promise.all([
    getDocument("usuarios", uid),
    getDocsSafe(
      query(collection(db, "rankingLogs"), where("uid", "==", uid), orderBy("timestamp", "desc"), limit(20)),
      "ai_ctx_rank",
    ),
    getDocsSafe(
      query(collection(db, "diario"), where("uid", "==", uid), orderBy("fecha", "desc"), limit(20)),
      "ai_ctx_diary",
    ),
    getMatchCollections(uid),
  ]);

  const played = allMyMatches.filter((m) => isPlayed(m));
  const recentPlayed = played.slice(0, MATCH_CONTEXT_LIMIT);

  let wins = 0;
  let losses = 0;
  recentPlayed.forEach((m) => {
    const out = matchOutcomeForUid(m, uid);
    if (!out) return;
    if (out.win) wins += 1;
    else losses += 1;
  });

  const rivalry = summarizeRivalries(allMyMatches, uid);
  const diaryEntries = (diarySnap?.docs || []).map((d) => ({
    id: d.id,
    date: toDateSafe(d.data()?.fecha)?.toISOString() || null,
    text: extractDiaryText(d.data()),
  }));

  const targetMatch = match || rivalry.nextMatch;

  const context = {
    generatedAt: new Date().toISOString(),
    user: {
      uid,
      name: userDoc?.nombreUsuario || userDoc?.nombre || "Jugador",
      level: Number(userDoc?.nivel || 2.5),
      points: Number(userDoc?.puntosRanking || 1000),
      streak: Number(userDoc?.rachaActual || 0),
    },
    stats: {
      totalMatches: allMyMatches.length,
      playedMatches: played.length,
      recentWindow: recentPlayed.length,
      recentWins: wins,
      recentLosses: losses,
      recentWinRate: recentPlayed.length ? Number((wins / recentPlayed.length).toFixed(2)) : 0,
      rankingEvents: (rankingLogsSnap?.docs || []).length,
    },
    recentMatches: recentPlayed.map((m) => ({
      id: m.id,
      col: m.col,
      date: toDateSafe(m.fecha)?.toISOString() || null,
      result: m?.resultado?.sets || null,
      state: m.estado || null,
      players: (m.jugadores || []).filter(Boolean).map((pid) => aliasUid(pid, uid)),
      outcome: matchOutcomeForUid(m, uid),
    })),
    diary: diaryEntries.slice(0, 6),
    target: targetMatch
      ? {
          id: targetMatch.id,
          col: targetMatch.col || null,
          date: toDateSafe(targetMatch.fecha)?.toISOString() || null,
          players: (targetMatch.jugadores || []).filter(Boolean).map((pid) => aliasUid(pid, uid)),
          result: targetMatch?.resultado?.sets || null,
          state: targetMatch?.estado || null,
        }
      : null,
    rivals: {
      upcoming: rivalry.rivals.map((rid) => aliasUid(rid, uid)),
      headToHead: rivalry.headToHead,
    },
    tokenBudget: {
      diaryEntries: Math.min(6, diaryEntries.length),
      recentMatches: recentPlayed.length,
      rankingEvents: Math.min(20, (rankingLogsSnap?.docs || []).length),
    },
  };

  return context;
}
