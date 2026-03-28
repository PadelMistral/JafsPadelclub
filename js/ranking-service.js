import { getDocument, db, auth } from "./firebase-service.js";
import { serverTimestamp, doc, runTransaction } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import {
  ELO_SYSTEM_VERSION,
  ELO_CONFIG,
  round2,
  clampNumber,
  getBaseEloByLevel,
  resolvePlayerRating,
  getDynamicKFactor,
  computeExpectedScore,
  buildLevelProgressState,
  levelFromRating,
  getLevelBandByRating,
} from "./config/elo-system.js";
import { checkAchievements } from "./achievement-service.js";
import { calculateGlicko2Delta, applyRankingAdjustments, calculateNewLevel } from "./services/rating-engine.js";
import { buildMatchPersistencePatch, parseGuestMeta } from "./utils/match-utils.js";
import { SistemaPuntuacionAvanzado } from "./services/sistema-puntuacion.js";
import { ATP_TEST_SYSTEM_VERSION, calculateAtpMatchDeltas } from "./pruebaElo.js";

const puntuacionAvanzada = new SistemaPuntuacionAvanzado();

const BONUS_REASON_NONE = "none";
const BONUS_REASON_MVP = "mvp";

function getSeasonDescriptor(dateLike = null) {
  const date = dateLike?.toDate ? dateLike.toDate() : (dateLike ? new Date(dateLike) : new Date());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const quarter = Math.floor(safeDate.getMonth() / 3) + 1;
  return {
    key: `${safeDate.getFullYear()}-T${quarter}`,
    label: `T${quarter} ${safeDate.getFullYear()}`,
  };
}

/**
 * Strips 'undefined' values recursively to avoid Firebase errors
 */
function sanitizeForFirestore(obj) {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== "object") return obj;

  // Preserve special Firestore objects (FieldValue, Timestamp, DocumentReference)
  if (
    obj.constructor?.name === "FieldValue" ||
    obj.constructor?.name === "Timestamp" ||
    obj.constructor?.name === "DocumentReference" ||
    (obj._delegate && obj._modelId) ||
    typeof obj.toMillis === "function"
  ) {
    return obj;
  }

  if (Array.isArray(obj)) return obj.map(v => sanitizeForFirestore(v));

  const result = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const val = sanitizeForFirestore(obj[key]);
      result[key] = val === undefined ? null : val;
    }
  }
  return result;
}

function normalizeResultString(resultStr = "") {
  return String(resultStr || "").trim().replace(/\s+/g, " ");
}

export function parseMatchResult(resultStr = "") {
  const normalized = normalizeResultString(resultStr);
  const pairRegex = /(\d+)\s*-\s*(\d+)/g;
  const sets = [];
  let match;
  while ((match = pairRegex.exec(normalized)) !== null) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a > 12 || b > 12) continue;
    if (a === 0 && b === 0) continue;
    sets.push(`${a}-${b}`);
  }
  if (sets.length < 1) throw new Error("Resultado inválido: no se detectaron sets (ej: 6-4 6-3).");

  let teamASets = 0;
  let teamBSets = 0;
  let teamAGames = 0;
  let teamBGames = 0;
  let lastSetWinner = "";

  sets.forEach((setStr) => {
    const [aRaw, bRaw] = setStr.split("-");
    const a = Number(aRaw);
    const b = Number(bRaw);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    teamAGames += a;
    teamBGames += b;
    if (a > b) {
      teamASets += 1;
      lastSetWinner = "A";
    }
    if (b > a) {
      teamBSets += 1;
      lastSetWinner = "B";
    }
  });

  if (teamASets === teamBSets) {
    // Fallback for legacy/incomplete inputs like one valid set + malformed extra text
    if (teamAGames !== teamBGames) {
      teamASets = teamAGames > teamBGames ? 1 : 0;
      teamBSets = teamBGames > teamAGames ? 1 : 0;
    } else if (lastSetWinner) {
      teamASets = lastSetWinner === "A" ? 1 : 0;
      teamBSets = lastSetWinner === "B" ? 1 : 0;
    } else {
      throw new Error("No se pudo determinar ganador de sets.");
    }
  }

  const winnerTeam = teamASets > teamBSets ? "A" : "B";
  return {
    normalized,
    sets,
    winnerTeam,
    teamASets,
    teamBSets,
    teamAGames,
    teamBGames,
    gameDiff: Math.abs(teamAGames - teamBGames),
  };
}

function calculateMatchFactor(parsed) {
  const diff = Number(parsed?.gameDiff || 0);
  const setDiff = Math.abs(Number(parsed?.teamASets || 0) - Number(parsed?.teamBSets || 0));
  const dominance = 1 + Math.min(ELO_CONFIG.DYNAMIC.DOMINANCE_M - 1, (diff / 48) + (setDiff * 0.06));
  return round2(dominance);
}

function calcClutchAdjustment(baseDelta, parsed) {
  const sets = parsed?.sets || [];
  let clutch = 0;
  sets.forEach(s => {
    if (s.includes("7-6") || s.includes("6-7") || s.includes("7-5") || s.includes("5-7")) clutch += ELO_CONFIG.DYNAMIC.CLUTCH_M;
  });
  return round2(Math.abs(baseDelta) * clutch);
}

// Streak bonus/penalty based on current streak and match outcome.
function calcStreakAdjustment(baseDelta, streak = 0, didWin = false) {
  const s = Number(streak || 0);
  if (!Number.isFinite(s) || s === 0) return 0;
  const magnitude = Math.abs(baseDelta);
  const m = ELO_CONFIG.DYNAMIC.STREAK_M;
  if (didWin) {
    if (s >= 2) return round2(magnitude * Math.min(0.25, m * (s/2)));
    if (s <= -2) return round2(magnitude * Math.min(0.15, m * (Math.abs(s)/3)));
  } else {
    if (s >= 3) return -round2(magnitude * Math.min(0.30, (m * 1.2) * (s/2)));
    if (s <= -2) return -round2(magnitude * Math.min(0.10, m * (Math.abs(s)/4)));
  }
  return 0;
}

// Upset/favorite adjustment to reward surprises and penalize expected losses.
function calcSurpriseAdjustment(baseDelta, expected = 0.5, didWin = false) {
  const exp = Number(expected || 0.5);
  const gap = Math.abs(0.5 - exp);
  if (gap < 0.02) return 0;
  const underdogWin = didWin && exp < 0.5;
  const favoriteLoss = !didWin && exp > 0.5;
  if (!underdogWin && !favoriteLoss) return 0;
  const factor = Math.min(0.50, gap * ELO_CONFIG.DYNAMIC.UPSET_M);
  const sign = underdogWin ? 1 : -1;
  return round2(Math.abs(baseDelta) * factor * sign);
}

// Skill adjustment uses explicit skill fields or positional/surface sub-ELO if present.
function calcSkillAdjustment(baseDelta, player, posKey, surface) {
  if (!player) return 0;
  const rawSkill = Number(player?.skillScore ?? player?.skill ?? player?.habilidad ?? NaN);
  if (Number.isFinite(rawSkill)) {
    const skillNorm = clampNumber(rawSkill, 1, 10);
    const factor = clampNumber((skillNorm - 5) / 40, -0.1, 0.12);
    return round2(Math.abs(baseDelta) * factor);
  }
  const posElo = Number(player?.elo?.[posKey]);
  const surfElo = Number(player?.elo?.[surface]);
  const skillRating = Number.isFinite(posElo) && Number.isFinite(surfElo)
    ? (posElo + surfElo) / 2
    : (Number.isFinite(posElo) ? posElo : (Number.isFinite(surfElo) ? surfElo : NaN));
  if (!Number.isFinite(skillRating)) return 0;
  const baseRating = resolvePlayerRating(player);
  const factor = clampNumber((skillRating - baseRating) / 1200, -0.08, 0.08);
  return round2(Math.abs(baseDelta) * factor);
}

function getSafePlayerDoc(p, fallbackId = null) {
  if (!p) return null;
  const id = p.id || fallbackId;
  // If isGuest was explicitly provided in the object, respect it. 
  // Otherwise check if ID starts with GUEST_
  const idStr = String(id || "");
  const isGuest = (p.isGuest === true) || idStr.startsWith("GUEST_") || idStr.startsWith("invitado_") || idStr.startsWith("manual_");
  const baseRating = resolvePlayerRating(p);
  return {
    ...p,
    id,
    isGuest,
    puntosRanking: baseRating,
    nivel: Number(p.nivel || levelFromRating(baseRating)),
    glickoRD: Number(p.glickoRD || 80),
    glickoVol: Number(p.glickoVol || 0.06),
  };
}

function findEventParticipantMeta(evData, uid) {
  if (!evData || !uid) return null;
  const idStr = String(uid);
  let entry = (evData.inscritos || []).find((item) => String(item?.uid || item?.id || item?.nombre || "") === idStr);
  if (entry) return entry;
  if (Array.isArray(evData.teams)) {
    for (const team of evData.teams) {
      const found = (team?.players || []).find((item) => String(item?.uid || item?.id || item?.nombre || "") === idStr);
      if (found) return found;
    }
  }
  return null;
}

function resolveGuestFallbackMeta({ uid, index = -1, match = {}, eventEntry = null, partner = null }) {
  const rawId = String(uid || "");
  const parsedGuest = parseGuestMeta(rawId);
  const directName =
    match?.playerNames?.[index] ||
    match?.nombresJugadores?.[index] ||
    match?.guestNames?.[index] ||
    match?.invitados?.[index]?.nombre ||
    eventEntry?.nombre ||
    eventEntry?.nombreUsuario ||
    null;
  const directLevel = Number(
    eventEntry?.nivel ??
    match?.guestLevels?.[index] ??
    match?.playerLevels?.[index] ??
    match?.invitados?.[index]?.nivel ??
    parsedGuest?.level ??
    NaN,
  );

  const partnerLevel = Number(partner?.nivel || NaN);
  const fallbackLevel = Number.isFinite(directLevel)
    ? directLevel
    : (Number.isFinite(partnerLevel) ? Math.max(1.0, Math.min(7.0, partnerLevel - 0.25)) : 2.5);
  const fallbackName = directName || parsedGuest?.name || (rawId.length > 15 ? `Invitado ${rawId.slice(0, 4)}` : rawId || "Invitado");

  return {
    nombre: String(fallbackName || "Invitado").trim() || "Invitado",
    nivel: fallbackLevel,
  };
}

function resolveCompetitiveRating(player = null) {
  if (!player) return ELO_CONFIG.BASE_RATING;
  const levelRating = getBaseEloByLevel(Number(player?.nivel || 2.5));
  const currentRating = resolvePlayerRating(player);
  if (player?.isGuest) return levelRating;
  return round2((currentRating * 0.55) + (levelRating * 0.45));
}

function normalizeGuestOverrides(guestOverrides = {}) {
  const normalized = {};
  Object.entries(guestOverrides || {}).forEach(([key, value]) => {
    if (!value || typeof value !== "object") return;
    normalized[String(key)] = {
      uid: String(value.uid || key || ""),
      name: String(value.name || value.nombre || "").trim(),
      nivel: Number(value.nivel ?? value.level ?? NaN),
      index: Number.isFinite(Number(value.index)) ? Number(value.index) : null,
    };
  });
  return normalized;
}

function findGuestOverride(guestOverrides = {}, uid = "", index = -1) {
  const uidStr = String(uid || "");
  const direct = guestOverrides[uidStr];
  if (direct) return direct;
  return Object.values(guestOverrides).find((item) => {
    if (!item) return false;
    if (String(item.uid || "") === uidStr) return true;
    return Number.isFinite(Number(item.index)) && Number(item.index) === Number(index);
  }) || null;
}

function normalizeManualDeltas(manualDeltas = {}) {
  const normalized = {};
  Object.entries(manualDeltas || {}).forEach(([uid, value]) => {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) normalized[String(uid)] = parsed;
  });
  return normalized;
}

function isManualDeltaDefined(manualDeltas = {}, uid = "") {
  return Object.prototype.hasOwnProperty.call(manualDeltas, String(uid || ""));
}

function buildPointsBreakdown({
  baseDelta = 0,
  streak = 0,
  surprise = 0,
  clutch = 0,
  skill = 0,
  bonus = 0,
  finalDelta = 0,
}) {
  const base = round2(baseDelta);
  const racha = round2(streak);
  const sorpresa = round2(surprise);
  const clutchVal = round2(clutch);
  const skillVal = round2(skill);
  const bonusVal = round2(bonus);

  return {
    base,
    racha,
    sorpresa,
    clutch: clutchVal,
    habilidad: skillVal,
    bonusIndividual: bonusVal,
    finalDelta: round2(finalDelta || (base + racha + sorpresa + clutchVal + skillVal + bonusVal))
  };
}

function buildTransparentBreakdown({
  base = 0,
  streak = 0,
  surprise = 0,
  clutch = 0,
  skill = 0,
  bonus = 0,
  finalDelta = 0,
  extras = {},
}) {
  const normalized = {
    base: round2(base),
    racha: round2(streak),
    sorpresa: round2(surprise),
    clutch: round2(clutch),
    habilidad: round2(skill),
    bonusIndividual: round2(bonus),
  };
  const subtotal = round2(
    normalized.base +
    normalized.racha +
    normalized.sorpresa +
    normalized.clutch +
    normalized.habilidad +
    normalized.bonusIndividual,
  );
  const final = round2(finalDelta);
  const ajusteBalance = round2(final - subtotal);
  return {
    ...extras,
    ...normalized,
    subtotalVariables: subtotal,
    ajusteBalance,
    totalCalculado: round2(subtotal + ajusteBalance),
    finalDelta: final,
  };
}


function estimatePointDetailsFromSets(resultStr) {
  const parsed = parseMatchResult(resultStr);
  const points = [];
  const pointsPerSet = [];
  let totalPoints = 0;

  parsed.sets.forEach((setStr, setIdx) => {
    const [aRaw, bRaw] = setStr.split("-");
    const gamesA = Number(aRaw);
    const gamesB = Number(bRaw);
    if (!Number.isFinite(gamesA) || !Number.isFinite(gamesB)) return;

    const setPoints = Math.max(4, (gamesA + gamesB) * 4);
    pointsPerSet.push({ set: setIdx + 1, gamesA, gamesB, points: setPoints });
    totalPoints += setPoints;

    const winnerTeam = gamesA >= gamesB ? "A" : "B";
    for (let g = 1; g <= gamesA + gamesB; g += 1) {
      for (let p = 1; p <= 4; p += 1) {
        points.push({ set: setIdx + 1, game: g, point: p, winnerTeam, type: "estimado" });
      }
    }
  });

  return { points, totalPoints: totalPoints || 1, pointsPerSet };
}

function buildPrediction({ myLevel, myPoints, partnerLevel, rival1Level, rival2Level, matchesPlayed, isComp }) {
  const myRating = Number(myPoints || getBaseEloByLevel(myLevel || 2.5));
  const partnerRating = getBaseEloByLevel(partnerLevel || myLevel || 2.5);
  const rival1Rating = getBaseEloByLevel(rival1Level || 2.5);
  const rival2Rating = getBaseEloByLevel(rival2Level || 2.5);

  const myTeam = (myRating + partnerRating) / 2;
  const rivalTeam = (rival1Rating + rival2Rating) / 2;
  const expected = computeExpectedScore(myTeam, rivalTeam);
  const k = getDynamicKFactor({ puntosRanking: myRating, partidosJugados: matchesPlayed || 0 });
  const modeMult = isComp ? 1.0 : 0.85;
  const cap = isComp ? ELO_CONFIG.CAPS.COMPETITIVE_ABS : ELO_CONFIG.CAPS.FRIENDLY_ABS;

  const winRaw = Math.round(k * (1 - expected) * modeMult);
  const lossRaw = Math.round(k * (0 - expected) * modeMult);

  return {
    win: clampNumber(winRaw, 2, cap),
    loss: clampNumber(lossRaw, -cap, -2),
    expectedWinrate: Math.round(expected * 100),
    streakBonus: 0,
    breakdown: {
      system: ELO_SYSTEM_VERSION,
      teamRating: round2(myTeam),
      rivalRating: round2(rivalTeam),
      k,
      modeMult,
      cap,
    },
    math: {
      K: k,
      expected: round2(expected),
      streak: 1,
      performance: 1,
      underdog: 1,
      dominance: 1,
      clutch: 1,
      partnerSync: 1,
    },
  };
}

export function predictEloImpact({
  myLevel,
  myPoints = 1000,
  partnerLevel,
  rival1Level,
  rival2Level,
  matchesPlayed = 0,
  extraParams = {},
}) {
  return buildPrediction({
    myLevel,
    myPoints,
    partnerLevel,
    rival1Level,
    rival2Level,
    matchesPlayed,
    isComp: Boolean(extraParams?.isComp),
  });
}

export { getBaseEloByLevel };

async function buildRosterAndContext({ matchId, col, initial, extraMatchData = {}, readDoc }) {
  let jugadores = Array.isArray(initial?.jugadores) && initial.jugadores.length === 4
    ? initial.jugadores
    : Array.isArray(initial?.playerUids) && initial.playerUids.length === 4
      ? initial.playerUids
      : Array.isArray(initial?.jugadores) && initial.jugadores.filter(Boolean).length > 0
        ? initial.jugadores
        : Array.isArray(initial?.playerUids) && initial.playerUids.filter(Boolean).length > 0
          ? initial.playerUids
          : null;

  if (col === "eventoPartidos" && (!jugadores || jugadores.filter(Boolean).length !== 4)) {
    const eventIdParent = initial?.eventoId || initial?.eventId || null;
    if (eventIdParent && (initial?.teamAId || initial?.teamBId)) {
      const ev = await readDoc("eventos", eventIdParent);
      const teams = Array.isArray(ev?.teams) ? ev.teams : [];
      const teamA = teams.find((t) => t?.id === initial?.teamAId);
      const teamB = teams.find((t) => t?.id === initial?.teamBId);
      const players = [...(teamA?.playerUids || []), ...(teamB?.playerUids || [])];
      if (players.length >= 4) jugadores = players.slice(0, 4);
    }
  }

  if (!initial || !jugadores || jugadores.filter(Boolean).length !== 4) {
    throw new Error("Match or players invalid");
  }

  const guestOverrides = normalizeGuestOverrides(extraMatchData?.guestOverrides || {});
  const match = { ...initial, jugadores: initial.jugadores || initial.playerUids || jugadores };
  const eventId = match.eventoId || match.eventId || null;
  let evData = eventId ? await readDoc("eventos", eventId) : null;
  const roster = [];
  const matchPlayers = (match.jugadores || []).slice(0, 4);

  for (let i = 0; i < 4; i += 1) {
    const uid = matchPlayers[i];
    const override = findGuestOverride(guestOverrides, uid, i);

    if (!uid || uid === "" || uid === "null") {
      roster.push({
        ...getSafePlayerDoc({
          id: `VIRTUAL_${i}_${matchId}`,
          nombre: override?.name || "Hueco Libre",
          nivel: Number.isFinite(override?.nivel) ? override.nivel : 2.5,
          isGuest: true
        }, `VIRTUAL_${i}`),
        __exists: false
      });
      continue;
    }

    const userData = await readDoc("usuarios", uid);
    if (userData) {
      roster.push({ ...getSafePlayerDoc({ id: uid, ...userData }, uid), __exists: true });
      continue;
    }

    const guestData = await readDoc("invitados", uid);
    if (guestData || override) {
      const baseGuestData = guestData || {};
      roster.push({
        ...getSafePlayerDoc({
          id: uid,
          nombre: override?.name || baseGuestData.nombre || baseGuestData.nombreUsuario || parseGuestMeta(uid)?.name || "Invitado",
          nivel: Number.isFinite(override?.nivel) ? override.nivel : Number(baseGuestData.nivel || 2.5),
          puntosRanking: Number(baseGuestData.puntosBaseInicial || baseGuestData.puntosRanking || NaN),
          isGuest: true,
        }, uid),
        __exists: false
      });
      continue;
    }

    const partnerIdxOfTeam = i < 2 ? (i === 0 ? 1 : 0) : (i === 2 ? 3 : 2);
    const partnerId = matchPlayers[partnerIdxOfTeam];
    const partnerDoc = partnerId ? roster.find((r) => r?.id === partnerId) : null;
    const guestInfo = parseGuestMeta(uid);
    if (guestInfo || override) {
      const eventEntry = findEventParticipantMeta(evData, uid);
      const guestMeta = resolveGuestFallbackMeta({
        uid,
        index: i,
        match,
        eventEntry,
        partner: partnerDoc,
      });
      roster.push({
        ...getSafePlayerDoc({
          id: uid,
          nombre: override?.name || guestMeta.nombre,
          nivel: Number.isFinite(override?.nivel) ? override.nivel : guestMeta.nivel,
          isGuest: true,
        }, uid),
        __exists: false
      });
      continue;
    }

    if (evData) {
      const pEntry = findEventParticipantMeta(evData, uid);
      if (pEntry) {
        roster.push({
          ...getSafePlayerDoc({
            id: uid,
            nombre: override?.name || pEntry.nombre || pEntry.nombreUsuario || String(uid),
            nivel: Number.isFinite(override?.nivel) ? override.nivel : Number(pEntry.nivel || 2.5),
            isGuest: true,
          }, uid),
          __exists: false
        });
        continue;
      }
    }

    const guestMeta = resolveGuestFallbackMeta({
      uid,
      index: i,
      match,
      eventEntry: findEventParticipantMeta(evData, uid),
      partner: partnerDoc,
    });
    roster.push({
      ...getSafePlayerDoc({
        id: uid,
        nombre: override?.name || guestMeta.nombre,
        nivel: Number.isFinite(override?.nivel) ? override.nivel : guestMeta.nivel,
        isGuest: true,
      }, uid),
      __exists: false,
    });
  }

  return { match, jugadores, roster, evData, eventId };
}

function computeMatchScoring({ matchId, col, resultStr, extraMatchData = {}, match, roster }) {
  const normalizedResult = normalizeResultString(resultStr);
  const parsed = parseMatchResult(normalizedResult);
  const pointDetails = estimatePointDetailsFromSets(normalizedResult);
  const isComp = col === "partidosReto" || match.tipo === "reto";
  const modeMult = isComp ? 1.0 : 0.95;
  const matchFactor = calculateMatchFactor(parsed);
  const teamA = roster.slice(0, 2).filter(Boolean);
  const teamB = roster.slice(2, 4).filter(Boolean);
  if (teamA.length !== 2 || teamB.length !== 2) throw new Error("Teams incomplete after fallback.");

  const teamARating = (resolveCompetitiveRating(teamA[0]) + resolveCompetitiveRating(teamA[1])) / 2;
  const teamBRating = (resolveCompetitiveRating(teamB[0]) + resolveCompetitiveRating(teamB[1])) / 2;
  const expectedA = computeExpectedScore(teamARating, teamBRating);
  const winnerIsA = parsed.winnerTeam === "A";
  const dynamicKs = roster.map((p) => (p && !p.isGuest ? getDynamicKFactor(p) : null));
  const nonGuestKs = dynamicKs.filter((k) => Number.isFinite(k));
  const kCombined = nonGuestKs.length
    ? nonGuestKs.reduce((acc, k) => acc + k, 0) / nonGuestKs.length
    : ELO_CONFIG.K.STABLE;
  const provisionalDeltas = [0, 0, 0, 0];
  const allAdjs = [null, null, null, null];
  const calcContexts = [null, null, null, null];
  const teamKind = col === "eventoPartidos" ? "evento" : (match.tipo || (col === "partidosReto" ? "reto" : "amistoso"));

  for (let i = 0; i < 4; i += 1) {
    const player = roster[i];
    if (!player || player.isGuest) {
      provisionalDeltas[i] = 0;
      continue;
    }

    const amITeamA = i < 2;
    const didWin = (amITeamA && winnerIsA) || (!amITeamA && !winnerIsA);
    const actualScore = didWin ? 1 : 0;
    const misAliados = amITeamA ? teamA : teamB;
    const companero = misAliados.find((p) => p && p.id !== player.id) || null;
    const misRivales = amITeamA ? teamB : teamA;
    const margenSetsFormatted = {
      juegosMios: didWin ? Math.max(parsed.teamAGames, parsed.teamBGames) : Math.min(parsed.teamAGames, parsed.teamBGames),
      juegosRivales: didWin ? Math.min(parsed.teamAGames, parsed.teamBGames) : Math.max(parsed.teamAGames, parsed.teamBGames),
      setsMios: didWin ? Math.max(parsed.teamASets, parsed.teamBSets) : Math.min(parsed.teamASets, parsed.teamBSets),
      setsRivales: didWin ? Math.min(parsed.teamASets, parsed.teamBSets) : Math.max(parsed.teamASets, parsed.teamBSets)
    };

    const ctx = {
      jugador: { ...player, puntosRanking: resolveCompetitiveRating(player) },
      companero: companero ? { ...companero, puntosRanking: resolveCompetitiveRating(companero) } : null,
      rivales: misRivales.filter(Boolean).map((r) => ({ ...r, puntosRanking: resolveCompetitiveRating(r) })),
      resultado: actualScore,
      tipoPartido: String(teamKind),
      margenSets: margenSetsFormatted
    };

    const calculo = puntuacionAvanzada.calcularCambio(ctx);
    calcContexts[i] = calculo;
    provisionalDeltas[i] = calculo.limiteAplicado;
    allAdjs[i] = calculo.factoresAdicionales;
    player._temp_base = calculo.cambioElo;
    player._temp_bonus = calculo.factoresAdicionales.companero + calculo.factoresAdicionales.racha + calculo.factoresAdicionales.margenSets;
    player._temp_adjs = {
      streak: calculo.factoresAdicionales.racha,
      surprise: 0,
      clutch: calculo.factoresAdicionales.margenSets,
      skill: calculo.factoresAdicionales.companero
    };
  }

  const rawGains = provisionalDeltas.filter((d) => d > 0).reduce((a, b) => a + b, 0);
  const rawLosses = Math.abs(provisionalDeltas.filter((d) => d < 0).reduce((a, b) => a + b, 0));
  if (rawGains > 0 && rawLosses > 0 && Math.abs(rawGains - rawLosses) > 0.5) {
    const balancedMag = (rawGains + rawLosses) / 2;
    const gainScale = balancedMag / rawGains;
    const lossScale = balancedMag / rawLosses;
    for (let i = 0; i < 4; i += 1) {
      if (provisionalDeltas[i] > 0) provisionalDeltas[i] *= gainScale;
      else if (provisionalDeltas[i] < 0) provisionalDeltas[i] *= lossScale;
    }
  }

  const manualDeltas = normalizeManualDeltas(extraMatchData?.manualDeltas || {});
  if (Object.keys(manualDeltas).length) {
    for (let i = 0; i < 4; i += 1) {
      const player = roster[i];
      if (!player || player.isGuest) continue;
      if (!isManualDeltaDefined(manualDeltas, player.id)) continue;
      provisionalDeltas[i] = Number(manualDeltas[player.id]);
      player._temp_base = Number(manualDeltas[player.id]);
      player._temp_bonus = 0;
      player._temp_adjs = { streak: 0, surprise: 0, clutch: 0, skill: 0 };
    }
  }

  const allocations = [];
  const changes = [];
  let totalDelta = 0;
  const teamADeltas = [provisionalDeltas[0], provisionalDeltas[1]];
  const teamBDeltas = [provisionalDeltas[2], provisionalDeltas[3]];

  for (let i = 0; i < 4; i += 1) {
    const player = roster[i];
    const amITeamA = i < 2;
    const didWin = (amITeamA && winnerIsA) || (!amITeamA && !winnerIsA);
    const delta = Number.isFinite(provisionalDeltas[i]) ? Number(round2(provisionalDeltas[i])) : 0;
    const expected = amITeamA ? expectedA : 1 - expectedA;
    const baseDelta = player?._temp_base ?? delta;
    const bonusDelta = player?._temp_bonus ?? 0;
    const subAdjs = player?._temp_adjs || {};

    if (!player || player.isGuest) {
      const guestBreakdown = buildTransparentBreakdown({
        base: delta,
        finalDelta: delta,
        extras: { guest: true },
      });
      allocations.push({
        uid: player?.id || null,
        name: player?.nombre || player?.nombreUsuario || "Invitado",
        team: amITeamA ? "A" : "B",
        baseDelta: delta,
        delta,
        isGuest: true,
        level: Number(player?.nivel || 2.5),
        substrings: guestBreakdown,
      });
      continue;
    }

    totalDelta += delta;
    const oldPoints = resolvePlayerRating(player);
    const newPoints = clampNumber(oldPoints + delta, ELO_CONFIG.MIN_RATING, ELO_CONFIG.MAX_RATING);
    const levelBefore = Number(player.nivel || levelFromRating(oldPoints));
    const calculo = calcContexts[i];
    const manualMode = isManualDeltaDefined(manualDeltas, player.id);
    let levelAfter = levelBefore;
    if (manualMode) levelAfter = levelFromRating(newPoints);
    else if (calculo && Number.isFinite(calculo.nuevoNivelCambio)) {
      levelAfter = Math.max(1.0, Math.min(7.0, levelBefore + calculo.nuevoNivelCambio));
    }

    const progressAfter = buildLevelProgressState({ rating: newPoints, levelOverride: levelAfter });
    const levelBand = getLevelBandByRating(newPoints);
    const transparentBreakdown = manualMode
      ? buildTransparentBreakdown({
          base: delta,
          finalDelta: delta,
          extras: {
            manual: true,
            note: String(extraMatchData?.manualReason || "Ajuste manual admin"),
          },
        })
      : buildTransparentBreakdown({
          base: Number(player?._temp_base || delta),
          streak: Number(subAdjs.streak || 0),
          surprise: Number(subAdjs.surprise || 0),
          clutch: Number(subAdjs.clutch || 0),
          skill: Number(subAdjs.skill || 0),
          bonus: Number(bonusDelta || 0),
          finalDelta: delta,
          extras: {
            desgloseReal: calculo?.desgloseReal || null,
          },
        });

    const analysis = {
      systemVersion: manualMode ? "v8_admin_manual" : "v8_avanzado",
      matchId,
      matchCollection: col,
      won: didWin,
      delta,
      pointsBefore: oldPoints,
      pointsAfter: newPoints,
      levelBefore,
      levelAfter,
      levelProgressAfter: progressAfter.progressPct,
      levelBand: levelBand.label,
      sets: normalizedResult,
      resultStats: {
        teamASets: parsed.teamASets,
        teamBSets: parsed.teamBSets,
        teamAGames: parsed.teamAGames,
        teamBGames: parsed.teamBGames,
        gameDiff: parsed.gameDiff,
      },
      prediction: Math.round(expected * 100),
      breakdown: manualMode
        ? transparentBreakdown
        : {
            ...(calculo || buildPointsBreakdown({
              baseDelta,
              streak: subAdjs.streak || 0,
              surprise: subAdjs.surprise || 0,
              clutch: subAdjs.clutch || 0,
              skill: subAdjs.skill || 0,
              bonus: bonusDelta,
            })),
            ...transparentBreakdown,
          },
      timestamp: new Date().toISOString(),
    };

    allocations.push({
      uid: player.id,
      name: player.nombre || player.nombreUsuario || player.id,
      team: amITeamA ? "A" : "B",
      baseDelta,
      bonusDelta,
      delta,
      isGuest: false,
      level: Number(player?.nivel || 2.5),
      ratingBefore: oldPoints,
      ratingAfter: newPoints,
      levelAfter,
      levelProgress: progressAfter.progressPct,
      substrings: transparentBreakdown,
      analysis,
    });
    changes.push({ uid: player.id, delta, analysis });
  }

  return {
    normalizedResult,
    parsed,
    pointDetails,
    roster,
    teamA,
    teamB,
    expectedA,
    teamARating,
    teamBRating,
    kCombined,
    modeMult,
    matchFactor,
    winnerIsA,
    allocations,
    changes,
    totalDelta,
    teamADeltas,
    teamBDeltas,
    manualMode: Object.keys(manualDeltas).length > 0,
  };
}

export async function previewMatchResults(matchId, col, resultStr, extraMatchData = {}) {
  const initial = await getDocument(col, matchId);
  const readDoc = async (collectionName, id) => getDocument(collectionName, id);
  const built = await buildRosterAndContext({ matchId, col, initial, extraMatchData, readDoc });
  const computed = computeMatchScoring({ matchId, col, resultStr, extraMatchData, match: built.match, roster: built.roster });
  return {
    success: true,
    preview: true,
    roster: built.roster,
    match: built.match,
    summary: {
      systemVersion: String(extraMatchData?.scoringSystem || "default").toLowerCase() === "atp_test" ? ATP_TEST_SYSTEM_VERSION : ELO_SYSTEM_VERSION,
      zeroSumCheck: round2(computed.totalDelta),
      kCombined: round2(computed.kCombined),
      expectedA: round2(computed.expectedA),
      teamADeltas: computed.teamADeltas.map((d) => round2(d)),
      teamBDeltas: computed.teamBDeltas.map((d) => round2(d)),
      manualMode: computed.manualMode,
    },
    allocations: computed.allocations,
    changes: computed.changes,
  };
}

export async function processMatchResults(matchId, col, resultStr, extraMatchData = {}) {
  try {
    const initial = await getDocument(col, matchId);
    const guestOverrides = normalizeGuestOverrides(extraMatchData?.guestOverrides || {});
    const manualDeltas = normalizeManualDeltas(extraMatchData?.manualDeltas || {});
    const scoringSystem = String(extraMatchData?.scoringSystem || "default").toLowerCase();
    const activeSystemVersion = scoringSystem === "atp_test" ? ATP_TEST_SYSTEM_VERSION : ELO_SYSTEM_VERSION;
    let jugadores = Array.isArray(initial?.jugadores) && initial.jugadores.length === 4
      ? initial.jugadores
      : Array.isArray(initial?.playerUids) && initial.playerUids.length === 4
        ? initial.playerUids
        : Array.isArray(initial?.jugadores) && initial.jugadores.filter(Boolean).length > 0
          ? initial.jugadores
          : Array.isArray(initial?.playerUids) && initial.playerUids.filter(Boolean).length > 0
            ? initial.playerUids
            : null;

    if (col === "eventoPartidos" && (!jugadores || jugadores.filter(Boolean).length !== 4)) {
      const eventId_parent = initial?.eventoId || initial?.eventId || null;
      if (eventId_parent && (initial?.teamAId || initial?.teamBId)) {
        const ev = await getDocument("eventos", eventId_parent);
        const teams = Array.isArray(ev?.teams) ? ev.teams : [];
        const teamA = teams.find(t => t?.id === initial?.teamAId);
        const teamB = teams.find(t => t?.id === initial?.teamBId);
        const players = [
          ...(teamA?.playerUids || []),
          ...(teamB?.playerUids || []),
        ];
        if (players.length >= 4) jugadores = players.slice(0, 4);
      }
    }
    if (!initial || !jugadores || jugadores.filter(Boolean).length !== 4) {
      return { success: false, error: "Match or players invalid" };
    }

    console.log(`[ELO_V11_STRICT] Processing ${col}/${matchId} at ${new Date().toISOString()}`);
    return await runTransaction(db, async (transaction) => {
      const matchRef = doc(db, col, matchId);
      const matchSnap = await transaction.get(matchRef);
      if (!matchSnap.exists()) {
        console.warn(`[ELO_V11] Match ${matchId} not found in ${col}. Skipping update.`);
        return { success: false, error: "Match doesn't exist" };
      }

      const matchRaw = matchSnap.data();
      const match = { ...matchRaw, jugadores: matchRaw.jugadores || matchRaw.playerUids || jugadores };
      const normalizedResult = normalizeResultString(resultStr);
      // Only skip if rankingProcessedAt is set (non-null/non-undefined) - admin can clear it to force reprocess
      if (match.rankingProcessedAt != null) {
        return {
          success: true,
          skipped: true,
          reason:
            match.rankingProcessedResult === normalizedResult
              ? "already_processed_same_result"
              : "already_processed_different_result",
          changes: [],
        };
      }

      const parsed = parseMatchResult(normalizedResult);
      const pointDetails = estimatePointDetailsFromSets(normalizedResult);
      const isComp = col === "partidosReto" || match.tipo === "reto";
      const modeMult = isComp ? 1.0 : 0.95;
      const matchFactor = calculateMatchFactor(parsed);
      const capAbs = isComp ? ELO_CONFIG.CAPS.COMPETITIVE_ABS : ELO_CONFIG.CAPS.FRIENDLY_ABS;
      // ─── EVENT CONTEXT READ ───
      const _eventId = match.eventoId || match.eventId || null;
      let evData = null;
      if (_eventId) {
        const evSnap = await transaction.get(doc(db, "eventos", _eventId));
        if (evSnap.exists()) evData = evSnap.data();
      }

      const roster = [];
      const matchPlayers = (match.jugadores || []).slice(0, 4);

      for (let i = 0; i < 4; i++) {
        const uid = matchPlayers[i];
        const override = findGuestOverride(guestOverrides, uid, i);
        
        // Final fallback for null/empty slots to ensure 2vs2
        if (!uid || uid === "" || uid === "null") {
           roster.push({
             ...getSafePlayerDoc({
               id: `VIRTUAL_${i}_${matchId}`,
               nombre: override?.name || "Hueco Libre",
               nivel: Number.isFinite(override?.nivel) ? override.nivel : 2.5,
               isGuest: true
             }, `VIRTUAL_${i}`),
             __exists: false
           });
           continue;
        }

        // 1. Try standard Firestore user
        const userRef = doc(db, "usuarios", uid);
        const userSnap = await transaction.get(userRef);
        if (userSnap.exists()) {
          roster.push({ ...getSafePlayerDoc({ id: uid, ...userSnap.data() }, uid), __exists: true });
          continue;
        }

        const guestRef = doc(db, "invitados", uid);
        const guestSnap = await transaction.get(guestRef);
        if (guestSnap.exists()) {
          const guestData = guestSnap.data() || {};
          roster.push({
            ...getSafePlayerDoc({
              id: uid,
              nombre: override?.name || guestData.nombre || guestData.nombreUsuario || parseGuestMeta(uid)?.name || "Invitado",
              nivel: Number.isFinite(override?.nivel) ? override.nivel : Number(guestData.nivel || 2.5),
              puntosRanking: Number(guestData.puntosBaseInicial || guestData.puntosRanking || NaN),
              isGuest: true,
            }, uid),
            __exists: false,
          });
          continue;
        }

        const partnerIdxOfTeam = i < 2 ? (i === 0 ? 1 : 0) : (i === 2 ? 3 : 2);
        const partnerId = matchPlayers[partnerIdxOfTeam];
        const partnerDoc = partnerId ? roster.find((r) => r?.id === partnerId) : null;

        // 2. Try synthetic Guest Metadata (GUEST_name_level_...) or manual guest ids
        const guestInfo = parseGuestMeta(uid);
        if (guestInfo || override) {
          const eventEntry = findEventParticipantMeta(evData, uid);
          const guestMeta = resolveGuestFallbackMeta({
            uid,
            index: i,
            match,
            eventEntry,
            partner: partnerDoc,
          });
          roster.push({
            ...getSafePlayerDoc(
              {
                id: uid,
                nombre: override?.name || guestMeta.nombre,
                nivel: Number.isFinite(override?.nivel) ? override.nivel : guestMeta.nivel,
                isGuest: true,
              },
              uid,
            ),
            __exists: false
          });
          continue;
        }

        // 3. Try Event Registration Fallback
        if (evData) {
          const pEntry = findEventParticipantMeta(evData, uid);
          if (pEntry) {
            roster.push({
              ...getSafePlayerDoc(
                {
                  id: uid,
                  nombre: override?.name || pEntry.nombre || pEntry.nombreUsuario || String(uid),
                  nivel: Number.isFinite(override?.nivel) ? override.nivel : Number(pEntry.nivel || 2.5),
                  isGuest: true,
                },
                uid,
              ),
              __exists: false
            });
            continue;
          }
        }

        // 4. Final Fallback (Unknown user -> Treat as Guest with best-effort name/level)
        const guestMeta = resolveGuestFallbackMeta({
          uid,
          index: i,
          match,
          eventEntry: findEventParticipantMeta(evData, uid),
          partner: partnerDoc,
        });

        roster.push({
          ...getSafePlayerDoc(
            {
              id: uid,
              nombre: override?.name || guestMeta.nombre,
              nivel: Number.isFinite(override?.nivel) ? override.nivel : guestMeta.nivel,
              isGuest: true,
            },
            uid,
          ),
          __exists: false,
        });
      }


      const teamA = roster.slice(0, 2).filter(Boolean);
      const teamB = roster.slice(2, 4).filter(Boolean);
      if (teamA.length !== 2 || teamB.length !== 2) throw new Error("Teams incomplete after fallback.");

      const teamARating = (resolveCompetitiveRating(teamA[0]) + resolveCompetitiveRating(teamA[1])) / 2;
      const teamBRating = (resolveCompetitiveRating(teamB[0]) + resolveCompetitiveRating(teamB[1])) / 2;
      const expectedA = computeExpectedScore(teamARating, teamBRating);
      const winnerIsA = parsed.winnerTeam === "A";

      const dynamicKs = roster.map((p) => (p && !p.isGuest ? getDynamicKFactor(p) : null));
      const nonGuestKs = dynamicKs.filter((k) => Number.isFinite(k));
      const kCombined = nonGuestKs.length
        ? nonGuestKs.reduce((acc, k) => acc + k, 0) / nonGuestKs.length
        : ELO_CONFIG.K.STABLE;

      // ─── PRE-READ: Event + standings docs BEFORE any writes ───
      let eventWinnerTeamId = null;
      let eventLoserTeamId = null;
      let eventWinnerName = null;
      let eventLoserName = null;
      // eventId and evData are already declared above for roster discovery
      if (!evData) evData = {}; 
      let winSnapData = {};
      let loseSnapData = {};
      let winRef = null;
      let loseRef = null;

        if (col === "eventoPartidos" && _eventId) {
          const teamAId_ev = match.teamAId || match.equipoAUid || null;
          const teamBId_ev = match.teamBId || match.equipoBUid || null;
          if (teamAId_ev && teamBId_ev) {
            eventWinnerTeamId = winnerIsA ? teamAId_ev : teamBId_ev;
            eventLoserTeamId = winnerIsA ? teamBId_ev : teamAId_ev;
            eventWinnerName = winnerIsA ? (match.teamAName || match.equipoA || null) : (match.teamBName || match.equipoB || null);
            eventLoserName = winnerIsA ? (match.teamBName || match.equipoB || null) : (match.teamAName || match.equipoA || null);
  
            // Read standings docs
          const winKey = `${_eventId}_${eventWinnerTeamId}`;
          const loseKey = `${_eventId}_${eventLoserTeamId}`;
          winRef = doc(db, "eventoClasificacion", winKey);
          loseRef = doc(db, "eventoClasificacion", loseKey);
          const winSnap = await transaction.get(winRef);
          const loseSnap = await transaction.get(loseRef);
          winSnapData = winSnap.exists() ? winSnap.data() : {};
          loseSnapData = loseSnap.exists() ? loseSnap.data() : {};
        }
      }
      // ─── END PRE-READ ───

      // --- INDIVIDUAL CALCULATION (SISTEMA PUNTUACION AVANZADO V8) ---
      const provisionalDeltas = [0, 0, 0, 0];
      const levelDeltas = [0, 0, 0, 0];
      const allAdjs = [null, null, null, null];
      const calcContexts = [null, null, null, null];
      const atpComputation = scoringSystem === "atp_test"
        ? calculateAtpMatchDeltas({
            roster,
            parsed,
            col,
            matchType: match.tipo,
          })
        : null;
      
      for (let i = 0; i < 4; i += 1) {
        const player = roster[i];
        if (!player || player.isGuest) {
            provisionalDeltas[i] = 0;
            continue;
        }
        
        const amITeamA = i < 2;
        const didWin = (amITeamA && winnerIsA) || (!amITeamA && !winnerIsA);
        const actualScore = didWin ? 1 : 0;
        
        const misAliados = amITeamA ? teamA : teamB;
        const companero = misAliados.find(p => p && p.id !== player.id) || null;
        const misRivales = amITeamA ? teamB : teamA;

        // Limpiar stats para el contexto
        const margenSetsFormatted = {
            juegosMios: didWin ? Math.max(parsed.teamAGames, parsed.teamBGames) : Math.min(parsed.teamAGames, parsed.teamBGames),
            juegosRivales: didWin ? Math.min(parsed.teamAGames, parsed.teamBGames) : Math.max(parsed.teamAGames, parsed.teamBGames),
            setsMios: didWin ? Math.max(parsed.teamASets, parsed.teamBSets) : Math.min(parsed.teamASets, parsed.teamBSets),
            setsRivales: didWin ? Math.min(parsed.teamASets, parsed.teamBSets) : Math.max(parsed.teamASets, parsed.teamBSets)
        };

        const ctx = {
            jugador: { ...player, puntosRanking: resolveCompetitiveRating(player) },
            companero: companero ? { ...companero, puntosRanking: resolveCompetitiveRating(companero) } : null,
            rivales: misRivales.filter(Boolean).map((r) => ({ ...r, puntosRanking: resolveCompetitiveRating(r) })),
            resultado: actualScore,
            tipoPartido: String(col === "eventoPartidos" ? "evento" : (match.tipo || (col === "partidosReto" ? "reto" : "amistoso"))),
            margenSets: margenSetsFormatted
        };

        const calculo = atpComputation?.contexts?.[i] || puntuacionAvanzada.calcularCambio(ctx);
        calcContexts[i] = calculo;
        
        provisionalDeltas[i] = calculo.limiteAplicado;
        levelDeltas[i] = calculo.nuevoNivelCambio;
        
        player._temp_base = calculo.cambioElo;
        player._temp_bonus = calculo.factoresAdicionales.companero + calculo.factoresAdicionales.racha + calculo.factoresAdicionales.margenSets;
        player._temp_adjs = { 
            streak: calculo.factoresAdicionales.racha, 
            surprise: 0, 
            clutch: calculo.factoresAdicionales.margenSets, 
            skill: calculo.factoresAdicionales.companero 
        };
        
        console.log(`[ELO AVANZADO] Player ${player.id?.slice(0,6)} | Win:${didWin} | BaseElo:${calculo.cambioElo} | Factores:${JSON.stringify(calculo.factoresAdicionales)} | Limite:${calculo.limiteAplicado} | NivelDelta:${calculo.nuevoNivelCambio}`);
      }

      const bonusReason = scoringSystem === "atp_test" ? "ATP Hybrid Competitive" : "Glicko-2 Hybrid";
      // Ensure individual records are prioritized over team averages
      const teamADeltas = [provisionalDeltas[0], provisionalDeltas[1]];
      const teamBDeltas = [provisionalDeltas[2], provisionalDeltas[3]];



      const changes = [];
      const allocations = [];
      let totalDelta = 0;

      // Collective Zero-Sum Balance: Ensure total gains magnitude matches total losses magnitude
      // to maintain league stability and prevent inflation from provisional high-K players.
      const rawGains = provisionalDeltas.filter(d => d > 0).reduce((a,b) => a + b, 0);
      const rawLosses = Math.abs(provisionalDeltas.filter(d => d < 0).reduce((a,b) => a + b, 0));
      
      if (rawGains > 0 && rawLosses > 0 && Math.abs(rawGains - rawLosses) > 0.5) {
          const balancedMag = (rawGains + rawLosses) / 2;
          const gainScale = balancedMag / rawGains;
          const lossScale = balancedMag / rawLosses;
          for (let i = 0; i < 4; i++) {
              if (provisionalDeltas[i] > 0) provisionalDeltas[i] *= gainScale;
              else if (provisionalDeltas[i] < 0) provisionalDeltas[i] *= lossScale;
          }
      }

      if (Object.keys(manualDeltas).length) {
        for (let i = 0; i < 4; i += 1) {
          const player = roster[i];
          if (!player || player.isGuest || !isManualDeltaDefined(manualDeltas, player.id)) continue;
          provisionalDeltas[i] = Number(manualDeltas[player.id]);
          player._temp_base = Number(manualDeltas[player.id]);
          player._temp_bonus = 0;
          player._temp_adjs = { streak: 0, surprise: 0, clutch: 0, skill: 0 };
        }
      }

      for (let i = 0; i < 4; i += 1) {
        const player = roster[i];
        const amITeamA = i < 2;
        const didWin = (amITeamA && winnerIsA) || (!amITeamA && !winnerIsA);
        const delta = Number.isFinite(provisionalDeltas[i]) ? Number(provisionalDeltas[i]) : 0;
        const expected = amITeamA ? expectedA : 1 - expectedA;
        const baseDelta = player?._temp_base ?? delta;
        const bonusDelta = player?._temp_bonus ?? 0;
        const subAdjs = player?._temp_adjs || {};

        if (!player || player.isGuest) {
          const guestBreakdown = buildTransparentBreakdown({
            base: delta,
            finalDelta: delta,
            extras: {
              guest: true,
              desgloseReal: calcContexts[i]?.desgloseReal || null,
            },
          });
          const guestOldPoints = player ? resolvePlayerRating(player) : 0;
          const guestNewPoints = clampNumber(guestOldPoints + delta, ELO_CONFIG.MIN_RATING, ELO_CONFIG.MAX_RATING);
          const guestLevelBefore = Number(player?.nivel || levelFromRating(guestOldPoints));
          const guestLevelAfter = scoringSystem === "atp_test"
            ? levelFromRating(guestNewPoints)
            : Math.max(1.0, Math.min(7.0, guestLevelBefore + Number(calcContexts[i]?.nuevoNivelCambio || 0)));
          if (player?.id && player?.isGuest) {
            const guestRef = doc(db, "invitados", String(player.id));
            transaction.set(guestRef, sanitizeForFirestore({
              uid: String(player.id),
              nombre: player.nombre || player.nombreUsuario || "Invitado",
              nombreUsuario: player.nombreUsuario || player.nombre || "Invitado",
              nombreNormalizado: String(player.nombre || player.nombreUsuario || "Invitado").trim().toLowerCase(),
              isGuestProfile: true,
              puntosRanking: guestNewPoints,
              rating: guestNewPoints,
              nivel: Number(guestLevelAfter.toFixed(4)),
              victorias: Math.max(0, Number(player.victorias || 0) + (didWin ? 1 : 0)),
              partidosJugados: Math.max(0, Number(player.partidosJugados || 0) + 1),
              rachaActual: didWin
                ? (Number(player.rachaActual || 0) > 0 ? Number(player.rachaActual || 0) + 1 : 1)
                : (Number(player.rachaActual || 0) < 0 ? Number(player.rachaActual || 0) - 1 : -1),
              ultimoResultado: didWin ? "victoria" : "derrota",
              lastMatchDate: serverTimestamp(),
              puntosBaseInicial: Number(player.puntosBaseInicial || getBaseEloByLevel(guestLevelBefore)),
              nivelBaseInicial: Number(player.nivelBaseInicial || guestLevelBefore),
              scoringSystem,
              updatedAt: serverTimestamp(),
            }), { merge: true });
          }
          allocations.push({
            uid: player?.id || null,
            name: player?.nombre || player?.nombreUsuario || "Invitado",
            team: amITeamA ? "A" : "B",
            baseDelta: delta,
            delta: delta,
            isGuest: true,
            ratingBefore: guestOldPoints,
            ratingAfter: guestNewPoints,
            levelAfter: guestLevelAfter,
            substrings: guestBreakdown,
          });
          continue;
        }

        totalDelta += delta;
        const oldPoints = resolvePlayerRating(player);
        const newPoints = clampNumber(oldPoints + delta, ELO_CONFIG.MIN_RATING, ELO_CONFIG.MAX_RATING);
        const levelBefore = Number(player.nivel || levelFromRating(oldPoints));
        const manualMode = isManualDeltaDefined(manualDeltas, player.id);
        
        // 3. Aplicar Nivel (Skill Level) Avanzado
        const calculo = calcContexts[i];
        let levelAfter = levelBefore;
        if (manualMode) {
            levelAfter = levelFromRating(newPoints);
        } else if (calculo && Number.isFinite(calculo.nuevoNivelCambio)) {
            levelAfter = Math.max(1.0, Math.min(7.0, levelBefore + calculo.nuevoNivelCambio));
        }

        const progressAfter = buildLevelProgressState({ rating: newPoints, levelOverride: levelAfter });
        const levelBand = getLevelBandByRating(newPoints);

        const position = match.posiciones ? match.posiciones[i] : i % 2 === 0 ? "reves" : "drive";
        const rawPosKey = String(position || "reves").toLowerCase();
        const posKey = rawPosKey.includes("der") ? "drive" : rawPosKey;
        const surface = String(extraMatchData?.surface || match.surface || "indoor").toLowerCase();
        const currentPosElo = Number(player?.elo?.[posKey] || oldPoints);
        const currentSurfElo = Number(player?.elo?.[surface] || oldPoints);

        const transparentBreakdown = manualMode
          ? buildTransparentBreakdown({
              base: delta,
              finalDelta: delta,
              extras: {
                manual: true,
                note: String(extraMatchData?.manualReason || "Ajuste manual admin"),
              },
            })
          : buildTransparentBreakdown({
              base: Number(player?._temp_base || delta),
              streak: Number(subAdjs.streak || 0),
              surprise: Number(subAdjs.surprise || 0),
              clutch: Number(subAdjs.clutch || 0),
              skill: Number(subAdjs.skill || 0),
              bonus: Number(bonusDelta || 0),
              finalDelta: delta,
              extras: {
                desgloseReal: calculo?.desgloseReal || null,
              },
            });

        const analysis = {
          systemVersion: manualMode ? "v8_admin_manual" : activeSystemVersion,
          matchId,
          matchCollection: col,
          won: didWin,
          delta,
          pointsBefore: oldPoints,
          pointsAfter: newPoints,
          levelBefore,
          levelAfter,
          levelProgressAfter: progressAfter.progressPct,
          levelBand: levelBand.label,
          sets: normalizedResult,
          resultStats: {
            teamASets: parsed.teamASets,
            teamBSets: parsed.teamBSets,
            teamAGames: parsed.teamAGames,
            teamBGames: parsed.teamBGames,
            gameDiff: parsed.gameDiff,
          },
          prediction: Math.round(expected * 100),
          breakdown: manualMode
            ? transparentBreakdown
            : {
                ...(calculo || buildPointsBreakdown({ 
                  baseDelta, 
                  streak: subAdjs.streak || 0, 
                  surprise: subAdjs.surprise || 0,
                  clutch: subAdjs.clutch || 0,
                  skill: subAdjs.skill || 0,
                  bonus: bonusDelta,
                })),
                ...transparentBreakdown,
              },
          timestamp: new Date().toISOString(),
        };


        if (player.__exists === true && !player.isGuest && player.id) {
          const baseNivel = Number.isFinite(Number(player.nivelBaseInicial))
            ? Number(player.nivelBaseInicial)
            : levelBefore;
          const basePuntos = Number.isFinite(Number(player.puntosBaseInicial))
            ? Number(player.puntosBaseInicial)
            : oldPoints;
          // Build safe update — never write undefined
          const userUpdate = {
            puntosRanking: newPoints,
            rating: newPoints,
            nivel: Number(levelAfter.toFixed(4)),
            nivelProgresoPct: Number(progressAfter.progressPct || 50),
            nivelRango: levelBand.label || "Bronce",
            victorias: Number(player.victorias || 0) + (didWin ? 1 : 0),
            partidosJugados: Number(player.partidosJugados || 0) + 1,
            rachaActual: didWin
              ? (Number(player.rachaActual || 0) > 0 ? Number(player.rachaActual || 0) + 1 : 1)
              : (Number(player.rachaActual || 0) < 0 ? Number(player.rachaActual || 0) - 1 : -1),
            lastMatchAnalysis: analysis,
            lastMatchDate: serverTimestamp(),
            nivelBaseInicial: baseNivel,
            puntosBaseInicial: basePuntos,
          };

          // Sanity check for Glicko components if present
          if (Number.isFinite(player.glickoRD)) userUpdate.glickoRD = player.glickoRD;
          if (Number.isFinite(player.glickoVol)) userUpdate.glickoVol = player.glickoVol;
          // Only write elo sub-indices if they resolve to real numbers
          if (posKey && Number.isFinite(currentPosElo + delta)) userUpdate[`elo.${posKey}`] = currentPosElo + delta;
          if (surface && Number.isFinite(currentSurfElo + delta)) userUpdate[`elo.${surface}`] = currentSurfElo + delta;
          
          try {
            transaction.update(doc(db, "usuarios", String(player.id)), sanitizeForFirestore(userUpdate));
          } catch (updateErr) {
            console.error(`[ELO_V11] Failed to update user ${player.id}:`, updateErr);
            throw updateErr;
          }
        }

        // Save rankingLog — timestamp must be a real Firestore Timestamp for query ordering
        const logId = `${matchId}_${player.id}`;
        const logTimestamp = match.fecha?.seconds
          ? match.fecha   // Use match date for chronological ordering
          : serverTimestamp();
        transaction.set(doc(db, "rankingLogs", logId), sanitizeForFirestore({
          uid: player.id,
          matchId,
          matchCol: col,
          matchCollection: col,
          diff: Number(delta.toFixed(2)),
          newTotal: Number(newPoints),
          pointsBefore: Number(oldPoints),
          levelBefore: Number(levelBefore.toFixed(4)),
          levelAfter: Number(levelAfter.toFixed(4)),
          sets: normalizedResult,
          won: didWin,
          type: col === 'eventoPartidos' ? 'TORNEO' : col === 'partidosReto' ? 'RETO' : 'AMISTOSO',
          seasonKey: getSeasonDescriptor(match?.fecha).key,
          seasonLabel: getSeasonDescriptor(match?.fecha).label,
          scoringSystem,
          details: analysis,
          timestamp: logTimestamp,
        }));

        allocations.push({
          uid: player.id,
          team: amITeamA ? "A" : "B",
          baseDelta,
          bonusDelta,
          delta,
          substrings: transparentBreakdown,
          ratingBefore: oldPoints,
          ratingAfter: newPoints,
          levelAfter,
          levelProgress: progressAfter.progressPct,
          bonusReason,
        });
        changes.push({ uid: player.id, delta, analysis });
      }

      transaction.set(doc(db, "matchPointDetails", matchId), sanitizeForFirestore({
        matchId,
        col,
        sets: normalizedResult,
        totalPoints: pointDetails.totalPoints,
        pointsPerSet: pointDetails.pointsPerSet,
        points: pointDetails.points,
        playerAllocations: allocations,
        zeroSumCheck: totalDelta,
        systemVersion: activeSystemVersion,
        scoringSystem,
        createdAt: serverTimestamp(),
      }));

      // ─── WRITE: Event standings using PRE-READ data ───
      if (col === "eventoPartidos" && _eventId && eventWinnerTeamId && eventLoserTeamId && winRef && loseRef) {
          const ptsWin = Number(evData?.puntosVictoria || 2);
          const ptsLoss = Number(evData?.puntosDerrota || 1);
          const teamAGames = Number(parsed?.teamAGames || 0);
          const teamBGames = Number(parsed?.teamBGames || 0);
          const winGamesFor = winnerIsA ? teamAGames : teamBGames;
          const winGamesAgainst = winnerIsA ? teamBGames : teamAGames;
          const loseGamesFor = winnerIsA ? teamBGames : teamAGames;
          const loseGamesAgainst = winnerIsA ? teamAGames : teamBGames;
          const winPF = Number(winSnapData.puntosGanados || 0) + winGamesFor;
          const winPA = Number(winSnapData.puntosPerdidos || 0) + winGamesAgainst;
          const losePF = Number(loseSnapData.puntosGanados || 0) + loseGamesFor;
          const losePA = Number(loseSnapData.puntosPerdidos || 0) + loseGamesAgainst;
          transaction.set(
            winRef,
            sanitizeForFirestore({
              eventoId: _eventId,
              uid: eventWinnerTeamId,
              nombre: eventWinnerName || winSnapData.nombre || eventWinnerTeamId,
              pj: Number(winSnapData.pj || 0) + 1,
              ganados: Number(winSnapData.ganados || 0) + 1,
              puntos: Number(winSnapData.puntos || 0) + ptsWin,
              puntosGanados: winPF,
              puntosPerdidos: winPA,
              diferencia: winPF - winPA,
            }),
            { merge: true },
          );
          transaction.set(
            loseRef,
            sanitizeForFirestore({
              eventoId: _eventId,
              uid: eventLoserTeamId,
              nombre: eventLoserName || loseSnapData.nombre || eventLoserTeamId,
              pj: Number(loseSnapData.pj || 0) + 1,
              perdidos: Number(loseSnapData.perdidos || 0) + 1,
              puntos: Number(loseSnapData.puntos || 0) + ptsLoss,
              puntosGanados: losePF,
              puntosPerdidos: losePA,
              diferencia: losePF - losePA,
            }),
            { merge: true },
          );
      }

        // Use set with merge: true instead of update to be more resilient
        transaction.set(matchRef, sanitizeForFirestore({
          ...buildMatchPersistencePatch({ state: "jugado", resultStr: normalizedResult }),
          ...(eventWinnerTeamId ? { ganadorTeamId: eventWinnerTeamId, ganador: winnerIsA ? "A" : "B" } : {}),
          ...(col === "eventoPartidos" ? { standingsProcessedAt: serverTimestamp(), standingsProcessedResult: normalizedResult } : {}),
          eloSummary: {
            systemVersion: activeSystemVersion,
            scoringSystem,
            expectedA: round2(expectedA),
            teamARating: round2(teamARating),
            teamBRating: round2(teamBRating),
            teamADeltas: teamADeltas.map(d => round2(d)),
            teamBDeltas: teamBDeltas.map(d => round2(d)),
            // Added detailed player data for the hacker UI breakdown
            playerData: allocations.map(a => ({
                uid: a.uid,
                name: (function() {
                  const p = roster.find(r => r?.id === a.uid);
                  return p?.nombre || p?.nombreUsuario || 'Jugador';
                })(),
                delta: round2(a.delta),
                breakdown: sanitizeForFirestore(a.substrings || {}) // sub-adjustments
            })),
            teamADelta: round2(teamADeltas.reduce((a,b)=>a+b,0)/2),
            teamBDelta: round2(teamBDeltas.reduce((a,b)=>a+b,0)/2),
            kCombined: round2(kCombined),
            modeMult,
            dominanceFactor: round2(atpComputation?.dominance || matchFactor),
            bonusReason,
            zeroSumCheck: totalDelta,
            updatedAt: serverTimestamp(),
            manualOverride: Boolean(Object.keys(manualDeltas).length),
          },
          eventoId: _eventId,
          eventMatchId: match.eventMatchId || null,
          eventTeamAId: match.eventTeamAId || null,
          eventTeamBId: match.eventTeamBId || null,
          rankingProcessedResult: normalizedResult,
          rankingProcessedAt: serverTimestamp(),
          rankingProcessedBy: auth.currentUser?.uid || null,
          scoringSystem,
          scoringSystemVersion: activeSystemVersion,
          eventRecord: {
            eventoId: _eventId,
            // Add other relevant event-specific data here if needed
          },
        }), { merge: true });

      // After success, trigger background check for achievements
      roster.forEach((p, idx) => {
          if (p && !p.isGuest) {
              const allocation = allocations.find(a => a.uid === p.id);
              if (allocation) {
                checkAchievements(p.id, {
                    partidosJugados: Number(p.partidosJugados || 0) + 1,
                    victorias: Number(p.victorias || 0) + (allocation.delta > 0 ? 1 : 0),
                    rachaActual: allocation.delta > 0 
                        ? (Number(p.rachaActual || 0) > 0 ? Number(p.rachaActual || 0) + 1 : 1)
                        : (Number(p.rachaActual || 0) < 0 ? Number(p.rachaActual || 0) - 1 : -1)
                }, { 
                    mvpId: extraMatchData?.mvpId, 
                    fecha: match.fecha 
                }).catch(e => console.warn("Achievement check failed for", p.id, e));
              }
          }
      });

      return {
        success: true,
        skipped: false,
        changes,
        summary: {
          systemVersion: activeSystemVersion,
          scoringSystem,
          zeroSumCheck: totalDelta,
          kCombined: round2(kCombined),
          expectedA: round2(expectedA),
          teamADeltas: teamADeltas.map(d => round2(d)),
          teamBDeltas: teamBDeltas.map(d => round2(d)),
          bonusReason,
        },
      };
    });
  } catch (e) {
    console.error("Match Processing Error:", e);
    return { success: false, error: e?.message || String(e) };
  }
}
