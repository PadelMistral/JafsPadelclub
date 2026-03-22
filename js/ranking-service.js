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

const BONUS_REASON_NONE = "none";
const BONUS_REASON_MVP = "mvp";

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
  const isGuest = String(id || "").startsWith("GUEST_");
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

function buildPointsBreakdown({
  baseDelta,
  expected,
  didWin,
  matchFactor,
  bonusDelta,
  streakDelta = 0,
  surpriseDelta = 0,
  skillDelta = 0,
  diaryBonus = 0,
  smurfPenalty = 0,
  finalDelta,
}) {
  const base = round2(baseDelta);
  const difficulty = round2(((didWin ? 0.5 - expected : expected - 0.5) * Math.max(4, Math.abs(baseDelta))) * 0.5);
  const sets = round2(baseDelta * (matchFactor - 1));
  const racha = round2(streakDelta);
  const sorpresa = round2(surpriseDelta);
  const skill = round2(skillDelta);

  const subtotal = base + difficulty + racha + sets + bonusDelta + sorpresa + skill + smurfPenalty + diaryBonus;
  const ajusteJusticia = round2(finalDelta - subtotal);

  return {
    base,
    dificultad: difficulty,
    racha,
    sets,
    rendimientoBonus: round2(bonusDelta),
    sorpresa,
    skill,
    ajusteJusticia,
    diarioCoach: diaryBonus,
    smurfPenalty,
    total: round2(finalDelta),
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

export async function processMatchResults(matchId, col, resultStr, extraMatchData = {}) {
  try {
    const initial = await getDocument(col, matchId);
    let jugadores = Array.isArray(initial?.jugadores)
      ? initial.jugadores
      : col === "eventoPartidos" && Array.isArray(initial?.playerUids) && initial.playerUids.length === 4
        ? initial.playerUids
        : null;

    if (col === "eventoPartidos" && (!jugadores || jugadores.filter(Boolean).length !== 4)) {
      const eventId = initial?.eventoId || initial?.eventId || null;
      if (eventId && (initial?.teamAId || initial?.teamBId)) {
        const ev = await getDocument("eventos", eventId);
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

    return await runTransaction(db, async (transaction) => {
      const matchRef = doc(db, col, matchId);
      const matchSnap = await transaction.get(matchRef);
      if (!matchSnap.exists()) throw new Error("Match does not exist.");

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

      const roster = [];
      for (const uid of match.jugadores) {
        if (!uid) {
          roster.push(null);
          continue;
        }

        if (String(uid).startsWith("GUEST_")) {
          const parts = String(uid).split("_");
          roster.push(
            getSafePlayerDoc(
              {
                id: uid,
                nombre: parts[1] || "Invitado",
                nivel: Number(parts[2] || 2.5),
                isGuest: true,
              },
              uid,
            ),
          );
          continue;
        }

        const userRef = doc(db, "usuarios", uid);
        const userSnap = await transaction.get(userRef);
        if (userSnap.exists()) {
          roster.push({ ...getSafePlayerDoc({ id: uid, ...userSnap.data() }, uid), __exists: true });
        } else {
          // Fallback for missing user record (e.g. deleted or guest not correctly prefixed)
          roster.push({ ...getSafePlayerDoc({ 
            id: uid, 
            nombre: "Jugador " + uid.slice(0, 4), 
            nivel: 2.5,
            isGuest: true 
          }, uid), __exists: false });
        }
      }

      const teamA = roster.slice(0, 2).filter(Boolean);
      const teamB = roster.slice(2, 4).filter(Boolean);
      if (teamA.length !== 2 || teamB.length !== 2) throw new Error("Teams incomplete after fallback.");

      const teamARating = (resolvePlayerRating(teamA[0]) + resolvePlayerRating(teamA[1])) / 2;
      const teamBRating = (resolvePlayerRating(teamB[0]) + resolvePlayerRating(teamB[1])) / 2;
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
      const eventId = match.eventoId || match.eventId || null;
      let evData = {};
      let winSnapData = {};
      let loseSnapData = {};
      let winRef = null;
      let loseRef = null;

      if (col === "eventoPartidos" && eventId) {
        const teamAId_ev = match.teamAId || match.equipoAUid || null;
        const teamBId_ev = match.teamBId || match.equipoBUid || null;
        if (teamAId_ev && teamBId_ev) {
          eventWinnerTeamId = winnerIsA ? teamAId_ev : teamBId_ev;
          eventLoserTeamId = winnerIsA ? teamBId_ev : teamAId_ev;
          eventWinnerName = winnerIsA ? (match.teamAName || match.equipoA || null) : (match.teamBName || match.equipoB || null);
          eventLoserName = winnerIsA ? (match.teamBName || match.equipoB || null) : (match.teamAName || match.equipoA || null);

          // Read event doc
          const evRef = doc(db, "eventos", eventId);
          const evSnap = await transaction.get(evRef);
          evData = evSnap.exists() ? evSnap.data() : {};

          // Read standings docs
          const winKey = `${eventId}_${eventWinnerTeamId}`;
          const loseKey = `${eventId}_${eventLoserTeamId}`;
          winRef = doc(db, "eventoClasificacion", winKey);
          loseRef = doc(db, "eventoClasificacion", loseKey);
          const winSnap = await transaction.get(winRef);
          const loseSnap = await transaction.get(loseRef);
          winSnapData = winSnap.exists() ? winSnap.data() : {};
          loseSnapData = loseSnap.exists() ? loseSnap.data() : {};
        }
      }
      // ─── END PRE-READ ───

      // --- INDIVIDUAL CALCULATION (GLICKO-2 HYBRID) ---
      const provisionalDeltas = [0, 0, 0, 0];
      const levelDeltas = [0, 0, 0, 0];
      
      for (let i = 0; i < 4; i += 1) {
        const player = roster[i];
        if (!player || player.isGuest) {
            provisionalDeltas[i] = 0;
            continue;
        }
        
        const amITeamA = i < 2;
        const didWin = (amITeamA && winnerIsA) || (!amITeamA && !winnerIsA);
        const actualScore = didWin ? 1 : 0;
        
        const opponents = amITeamA ? teamB : teamA;
        const opponentData = opponents.map(opp => ({ 
          r: resolvePlayerRating(opp), 
          rd: Number(opp.glickoRD || 80) 
        }));
        
        const myRating = resolvePlayerRating(player);
        const rivalAvgRating = opponentData.reduce((acc, o) => acc + o.r, 0) / opponentData.length;
        
        // 1. Calculate raw Glicko-2 delta
        const glickoResult = calculateGlicko2Delta({
          r: myRating,
          rd: Number(player.glickoRD || 80),
          vol: Number(player.glickoVol || 0.06)
        }, opponentData, actualScore);
        
        // 2. Apply Custom Human Adjustments (anti-smurf, difficulty, etc.)
        const finalDelta = applyRankingAdjustments({
          delta: glickoResult.delta,
          matchesPlayed: Number(player.partidosJugados || 0),
          isWin: didWin,
          myRating: myRating,
          rivalAvgRating: rivalAvgRating
        });
        
        provisionalDeltas[i] = round2(finalDelta);
        player.newRD = glickoResult.newRD; // Temporary store for transaction update
      }

      const bonusReason = "Glicko-2 Hybrid";
      const totalTeamADelta = round2((provisionalDeltas[0] + provisionalDeltas[1]) / 2);
      const totalTeamBDelta = round2((provisionalDeltas[2] + provisionalDeltas[3]) / 2);



      const changes = [];
      const allocations = [];
      let totalDelta = 0;

      for (let i = 0; i < 4; i += 1) {
        const player = roster[i];
        const amITeamA = i < 2;
        const didWin = (amITeamA && winnerIsA) || (!amITeamA && !winnerIsA);
        const delta = Number.isFinite(provisionalDeltas[i]) ? Number(provisionalDeltas[i]) : 0;
        const expected = amITeamA ? expectedA : 1 - expectedA;
        const baseDelta = delta;
        const bonusDelta = 0;

        if (!player || player.isGuest) {
          allocations.push({
            uid: player?.id || null,
            team: amITeamA ? "A" : "B",
            baseDelta: delta,
            delta: delta,
            isGuest: true,
          });
          continue;
        }

        totalDelta += delta;
        const oldPoints = resolvePlayerRating(player);
        const newPoints = clampNumber(oldPoints + delta, ELO_CONFIG.MIN_RATING, ELO_CONFIG.MAX_RATING);
        const levelBefore = Number(player.nivel || levelFromRating(oldPoints));
        
        // 3. Decoupled Level Scaling
        const levelAfter = calculateNewLevel(levelBefore, delta);
        const progressAfter = buildLevelProgressState({ rating: newPoints, levelOverride: levelAfter });
        const levelBand = getLevelBandByRating(newPoints);

        const position = match.posiciones ? match.posiciones[i] : i % 2 === 0 ? "reves" : "drive";
        const rawPosKey = String(position || "reves").toLowerCase();
        const posKey = rawPosKey.includes("der") ? "drive" : rawPosKey;
        const surface = String(extraMatchData?.surface || match.surface || "indoor").toLowerCase();
        const currentPosElo = Number(player?.elo?.[posKey] || oldPoints);
        const currentSurfElo = Number(player?.elo?.[surface] || oldPoints);

        const analysis = {
          systemVersion: ELO_SYSTEM_VERSION,
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
          breakdown: {
            expected: round2(expected),
            finalDelta: delta,
            zeroSumGuard: true,
          },
          timestamp: new Date().toISOString(),
        };


        if (player.__exists !== false && !player.isGuest) {
          const baseNivel = Number.isFinite(Number(player.nivelBaseInicial))
            ? Number(player.nivelBaseInicial)
            : levelBefore;
          const basePuntos = Number.isFinite(Number(player.puntosBaseInicial))
            ? Number(player.puntosBaseInicial)
            : oldPoints;
          transaction.update(doc(db, "usuarios", player.id), {
            puntosRanking: newPoints,
            rating: newPoints,
            nivel: levelAfter,
            glickoRD: player.newRD,
            glickoVol: Number(player.glickoVol || 0.06),
            nivelProgresoPct: progressAfter.progressPct,
            nivelRango: levelBand.label,
            victorias: Number(player.victorias || 0) + (didWin ? 1 : 0),
            partidosJugados: Number(player.partidosJugados || 0) + 1,
            rachaActual: didWin
              ? (Number(player.rachaActual || 0) > 0 ? Number(player.rachaActual || 0) + 1 : 1)
              : (Number(player.rachaActual || 0) < 0 ? Number(player.rachaActual || 0) - 1 : -1),
            lastMatchAnalysis: analysis,
            [`elo.${posKey}`]: currentPosElo + delta,
            [`elo.${surface}`]: currentSurfElo + delta,
            lastMatchDate: serverTimestamp(),
            nivelBaseInicial: baseNivel,
            puntosBaseInicial: basePuntos,
          });
        }

        const logId = `${matchId}_${player.id}`;
        transaction.set(doc(db, "rankingLogs", logId), {
          uid: player.id,
          matchId,
          matchCollection: col,
          diff: delta,
          newTotal: newPoints,
          details: analysis,
          subEloIndices: {
            position: currentPosElo + delta,
            surface: currentSurfElo + delta,
          },
          timestamp: serverTimestamp(),
        });

        allocations.push({
          uid: player.id,
          team: amITeamA ? "A" : "B",
          baseDelta,
          bonusDelta,
          delta,
          ratingBefore: oldPoints,
          ratingAfter: newPoints,
          levelAfter,
          levelProgress: progressAfter.progressPct,
          bonusReason,
        });
        changes.push({ uid: player.id, delta, analysis });
      }

      transaction.set(doc(db, "matchPointDetails", matchId), {
        matchId,
        col,
        sets: normalizedResult,
        totalPoints: pointDetails.totalPoints,
        pointsPerSet: pointDetails.pointsPerSet,
        points: pointDetails.points,
        playerAllocations: allocations,
        zeroSumCheck: totalDelta,
        systemVersion: ELO_SYSTEM_VERSION,
        createdAt: serverTimestamp(),
      });

      // ─── WRITE: Event standings using PRE-READ data ───
      if (col === "eventoPartidos" && eventId && eventWinnerTeamId && eventLoserTeamId && winRef && loseRef) {
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
            {
              eventoId: eventId,
              uid: eventWinnerTeamId,
              nombre: eventWinnerName || winSnapData.nombre || eventWinnerTeamId,
              pj: Number(winSnapData.pj || 0) + 1,
              ganados: Number(winSnapData.ganados || 0) + 1,
              puntos: Number(winSnapData.puntos || 0) + ptsWin,
              puntosGanados: winPF,
              puntosPerdidos: winPA,
              diferencia: winPF - winPA,
            },
            { merge: true },
          );
          transaction.set(
            loseRef,
            {
              eventoId: eventId,
              uid: eventLoserTeamId,
              nombre: eventLoserName || loseSnapData.nombre || eventLoserTeamId,
              pj: Number(loseSnapData.pj || 0) + 1,
              perdidos: Number(loseSnapData.perdidos || 0) + 1,
              puntos: Number(loseSnapData.puntos || 0) + ptsLoss,
              puntosGanados: losePF,
              puntosPerdidos: losePA,
              diferencia: losePF - losePA,
            },
            { merge: true },
          );
      }

      transaction.update(matchRef, {
        estado: "jugado",
        resultado: { sets: normalizedResult },
        ...(eventWinnerTeamId ? { ganadorTeamId: eventWinnerTeamId, ganador: winnerIsA ? "A" : "B" } : {}),
        ...(col === "eventoPartidos" ? { standingsProcessedAt: serverTimestamp(), standingsProcessedResult: normalizedResult } : {}),
        eloSummary: {
          systemVersion: ELO_SYSTEM_VERSION,
          expectedA: round2(expectedA),
          teamARating: round2(teamARating),
          teamBRating: round2(teamBRating),
          teamADelta: totalTeamADelta,
          teamBDelta: totalTeamBDelta,
          kCombined: round2(kCombined),
          modeMult,
          dominanceFactor: round2(matchFactor),
          bonusReason,
          zeroSumCheck: totalDelta,
          updatedAt: serverTimestamp(),
        },
        rankingProcessedAt: serverTimestamp(),
        rankingProcessedResult: normalizedResult,
        rankingProcessedBy: auth.currentUser?.uid || null,
      });

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
          systemVersion: ELO_SYSTEM_VERSION,
          zeroSumCheck: totalDelta,
          kCombined: round2(kCombined),
          expectedA: round2(expectedA),
          teamADelta: totalTeamADelta,
          teamBDelta: totalTeamBDelta,
          bonusReason,
        },
      };
    });
  } catch (e) {
    console.error("Match Processing Error:", e);
    return { success: false, error: e?.message || String(e) };
  }
}
