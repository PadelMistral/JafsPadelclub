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
  if (diff >= 12) return 1.12;
  if (diff >= 8) return 1.08;
  if (diff >= 4) return 1.04;
  return 1.0;
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
  };
}

function buildPointsBreakdown({
  baseDelta,
  expected,
  didWin,
  matchFactor,
  bonusDelta,
  diaryBonus = 0,
  finalDelta,
}) {
  const base = round2(baseDelta);
  const difficulty = round2(((didWin ? 0.5 - expected : expected - 0.5) * Math.max(4, Math.abs(baseDelta))) * 0.5);
  const sets = round2(baseDelta * (matchFactor - 1));
  const racha = 0;
  
  // Penalización por abusar de niveles bajos (Smurf Check)
  let smurfPenalty = 0;
  if (didWin && expected > 0.85) {
    smurfPenalty = -round2(Math.abs(baseDelta) * 0.3); // Penaliza 30% del delta si la prob de ganar era altísima
  }

  const subtotal = base + difficulty + racha + sets + bonusDelta + smurfPenalty + diaryBonus;
  const ajusteJusticia = round2(finalDelta - subtotal);

  return {
    base,
    dificultad: difficulty,
    racha,
    sets,
    rendimientoBonus: round2(bonusDelta),
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
    const jugadores = Array.isArray(initial?.jugadores)
      ? initial.jugadores
      : col === "eventoPartidos" && Array.isArray(initial?.playerUids) && initial.playerUids.length === 4
        ? initial.playerUids
        : null;
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
      if (match.rankingProcessedAt) {
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
      const modeMult = isComp ? 1.0 : 0.85;
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
        roster.push(userSnap.exists() ? getSafePlayerDoc({ id: uid, ...userSnap.data() }, uid) : null);
      }

      const teamA = roster.slice(0, 2).filter(Boolean);
      const teamB = roster.slice(2, 4).filter(Boolean);
      if (teamA.length !== 2 || teamB.length !== 2) throw new Error("Teams incomplete.");

      const teamARating = (resolvePlayerRating(teamA[0]) + resolvePlayerRating(teamA[1])) / 2;
      const teamBRating = (resolvePlayerRating(teamB[0]) + resolvePlayerRating(teamB[1])) / 2;
      const expectedA = computeExpectedScore(teamARating, teamBRating);
      const winnerIsA = parsed.winnerTeam === "A";

      const dynamicKs = roster.map((p) => (p && !p.isGuest ? getDynamicKFactor(p) : null));
      const nonGuestKs = dynamicKs.filter((k) => Number.isFinite(k));
      const kCombined = nonGuestKs.length
        ? nonGuestKs.reduce((acc, k) => acc + k, 0) / nonGuestKs.length
        : ELO_CONFIG.K.STABLE;

      const teamARaw = Math.round(kCombined * ((winnerIsA ? 1 : 0) - expectedA) * modeMult * matchFactor);
      let teamADelta = clampNumber(teamARaw, -capAbs, capAbs);
      let teamBDelta = -teamADelta;

      const teamARealCount = teamA.filter((p) => p && !p.isGuest).length;
      const teamBRealCount = teamB.filter((p) => p && !p.isGuest).length;
      const teamATotalDelta = teamADelta * 2;
      const teamBTotalDelta = -teamATotalDelta;
      const teamABaseForReal = teamARealCount > 0 ? Math.round(teamATotalDelta / teamARealCount) : 0;
      const teamBBaseForReal = teamBRealCount > 0 ? Math.round(teamBTotalDelta / teamBRealCount) : 0;
      const playerBase = [
        roster[0] && !roster[0].isGuest ? teamABaseForReal : 0,
        roster[1] && !roster[1].isGuest ? teamABaseForReal : 0,
        roster[2] && !roster[2].isGuest ? teamBBaseForReal : 0,
        roster[3] && !roster[3].isGuest ? teamBBaseForReal : 0,
      ];
      const bonusDeltas = [0, 0, 0, 0];
      let bonusReason = BONUS_REASON_NONE;

      const mvpId = String(extraMatchData?.mvpId || "").trim();
      const mvpIndex = mvpId ? roster.findIndex((p) => p?.id === mvpId) : -1;
      if (mvpIndex >= 0 && !roster[mvpIndex]?.isGuest) {
        const mvpTeamDelta = mvpIndex < 2 ? teamADelta : teamBDelta;
        const baseAbs = Math.abs(mvpTeamDelta);
        const maxBonus = Math.floor(baseAbs * ELO_CONFIG.BONUS_CAP_RATIO);
        if (maxBonus > 0) {
          const signedBonus = mvpTeamDelta >= 0 ? maxBonus : maxBonus;
          const teammateIndex = mvpIndex % 2 === 0 ? mvpIndex + 1 : mvpIndex - 1;
          if (roster[teammateIndex] && !roster[teammateIndex].isGuest) {
            bonusDeltas[mvpIndex] += signedBonus;
            bonusDeltas[teammateIndex] -= signedBonus;
            bonusReason = BONUS_REASON_MVP;
          }
        }
      }

      const provisionalDeltas = roster.map((player, idx) => {
        if (!player || player.isGuest) return null;
        return Math.round(playerBase[idx] + bonusDeltas[idx]);
      });
      const provisionalSum = provisionalDeltas
        .filter((v) => Number.isFinite(v))
        .reduce((acc, v) => acc + Number(v || 0), 0);
      if (provisionalSum !== 0) {
        const candidateIndices = [0, 1, 2, 3].filter((idx) => Number.isFinite(provisionalDeltas[idx]));
        if (candidateIndices.length > 0) {
          const adjustTarget = candidateIndices.sort(
            (a, b) => Math.abs(provisionalDeltas[b]) - Math.abs(provisionalDeltas[a]),
          )[0];
          provisionalDeltas[adjustTarget] = Number(provisionalDeltas[adjustTarget]) - provisionalSum;
        }
      }

      const changes = [];
      const allocations = [];
      let totalDelta = 0;

      for (let i = 0; i < 4; i += 1) {
        const player = roster[i];
        const amITeamA = i < 2;
        const didWin = (amITeamA && winnerIsA) || (!amITeamA && !winnerIsA);
        const baseDelta = playerBase[i];
        const bonusDelta = bonusDeltas[i];
        let delta = Number.isFinite(provisionalDeltas[i])
          ? Number(provisionalDeltas[i])
          : Math.round(baseDelta + bonusDelta);

        // Calculate smurf penalty (beating very weak opponents)
        const expected = amITeamA ? expectedA : 1 - expectedA;
        let smurfPenalty = 0;
        if (didWin && expected > 0.85) {
          smurfPenalty = -round2(Math.abs(baseDelta) * 0.3);
          delta += smurfPenalty;
        }

        if (!player || player.isGuest) {
          allocations.push({
            uid: player?.id || null,
            team: amITeamA ? "A" : "B",
            baseDelta,
            bonusDelta,
            delta,
            isGuest: true,
          });
          continue;
        }

        totalDelta += delta;
        const oldPoints = resolvePlayerRating(player);
        const newPoints = clampNumber(oldPoints + delta, ELO_CONFIG.MIN_RATING, ELO_CONFIG.MAX_RATING);
        const levelBefore = Number(player.nivel || levelFromRating(oldPoints));
        const levelAfter = levelFromRating(newPoints);
        const progressAfter = buildLevelProgressState({ rating: newPoints, levelOverride: levelAfter });
        const levelBand = getLevelBandByRating(newPoints);

        const position = match.posiciones ? match.posiciones[i] : i % 2 === 0 ? "reves" : "drive";
        const posKey = String(position || "reves").toLowerCase();
        const surface = String(extraMatchData?.surface || match.surface || "indoor").toLowerCase();
        const currentPosElo = Number(player?.elo?.[posKey] || oldPoints);
        const currentSurfElo = Number(player?.elo?.[surface] || oldPoints);

        const breakdown = buildPointsBreakdown({
          baseDelta,
          expected,
          didWin,
          matchFactor,
          bonusDelta,
          finalDelta: delta,
        });

        const analysis = {
          systemVersion: ELO_SYSTEM_VERSION,
          matchId,
          matchCollection: col,
          won: didWin,
          delta,
          baseDelta,
          bonusDelta,
          smurfPenalty,
          bonusCap: Math.floor(Math.abs(baseDelta) * ELO_CONFIG.BONUS_CAP_RATIO),
          bonusReason,
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
            expectedTeam: round2(expected),
            teamRating: round2(amITeamA ? teamARating : teamBRating),
            rivalTeamRating: round2(amITeamA ? teamBRating : teamARating),
            kCombined: round2(kCombined),
            competitiveFactor: modeMult,
            dominanceFactor: matchFactor,
            teamBaseDelta: baseDelta,
            bonusDelta,
            smurfPenalty,
            finalDelta: delta,
            zeroSumGuard: true,
          },
          math: {
            K: round2(kCombined),
            expected: round2(expected),
            streak: 1,
            performance: round2(matchFactor),
            underdog: 1,
            dominance: round2(matchFactor),
            clutch: 1,
            partnerSync: 1,
          },
          puntosCalculados: breakdown,
          puntosDetalle: breakdown,
          timestamp: new Date().toISOString(),
        };

        transaction.update(doc(db, "usuarios", player.id), {
          puntosRanking: newPoints,
          rating: newPoints,
          nivel: levelAfter,
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
        });

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

      transaction.update(matchRef, {
        estado: "jugado",
        resultado: { sets: normalizedResult },
        eloSummary: {
          systemVersion: ELO_SYSTEM_VERSION,
          expectedA: round2(expectedA),
          teamARating: round2(teamARating),
          teamBRating: round2(teamBRating),
          teamADelta,
          teamBDelta,
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

      return {
        success: true,
        skipped: false,
        changes,
        summary: {
          systemVersion: ELO_SYSTEM_VERSION,
          zeroSumCheck: totalDelta,
          kCombined: round2(kCombined),
          expectedA: round2(expectedA),
          teamADelta,
          teamBDelta,
          bonusReason,
        },
      };
    });
  } catch (e) {
    console.error("Match Processing Error:", e);
    return { success: false, error: e?.message || String(e) };
  }
}
