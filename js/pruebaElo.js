import {
  clampNumber,
  computeExpectedScore,
  getBaseEloByLevel,
  getDynamicKFactor,
  levelFromRating,
  resolvePlayerRating,
  round2,
} from "./config/elo-system.js";

export const ATP_TEST_SYSTEM_VERSION = "atp_hybrid_competitive_v4";

function getMatchType(col = "", matchType = "") {
  if (col === "eventoPartidos") return "evento";
  if (col === "partidosReto") return "reto";
  return String(matchType || "amistoso").toLowerCase();
}

function resolveCompetitiveSeed(player = {}) {
  const levelSeed = getBaseEloByLevel(Number(player?.nivel || 2.5));
  if (player?.isGuest) return levelSeed;
  const currentRating = resolvePlayerRating(player);
  return round2((currentRating * 0.6) + (levelSeed * 0.4));
}

function getHybridKFactor(player = {}, matchType = "amistoso") {
  const baseK = getDynamicKFactor(player);
  const typeFactor = matchType === "evento" ? 0.76 : matchType === "reto" ? 0.66 : 0.54;
  return Math.max(10, round2(baseK * typeFactor));
}

function getDominanceFactor(parsed = null) {
  const setDiff = Math.abs(Number(parsed?.teamASets || 0) - Number(parsed?.teamBSets || 0));
  const gameDiff = Math.abs(Number(parsed?.teamAGames || 0) - Number(parsed?.teamBGames || 0));
  const raw = 1 + (setDiff * 0.025) + (Math.min(gameDiff, 12) * 0.006);
  return round2(Math.min(1.1, raw));
}

function normalizeSplitFactors(a, b) {
  const avg = (Number(a || 0) + Number(b || 0)) / 2 || 1;
  return [round2(a / avg), round2(b / avg)];
}

function buildContributionFactor({ player, partner, result, gameDiff }) {
  const mySeed = resolveCompetitiveSeed(player);
  const partnerSeed = resolveCompetitiveSeed(partner);
  const gapToPartner = clampNumber((mySeed - partnerSeed) / 780, -0.16, 0.16);
  const marginBoost = Math.min(0.03, Number(gameDiff || 0) * 0.0025);

  let rawFactor = 1;
  if (result === 1) {
    rawFactor += gapToPartner < 0 ? Math.abs(gapToPartner) * 0.52 : -(gapToPartner * 0.36);
    rawFactor += marginBoost;
  } else {
    rawFactor += gapToPartner > 0 ? gapToPartner * 0.62 : -(Math.abs(gapToPartner) * 0.18);
    rawFactor -= marginBoost;
  }

  return {
    seed: mySeed,
    gapToPartner: round2(gapToPartner),
    factor: round2(rawFactor),
    roleHint: result === 1
      ? (gapToPartner < 0 ? "underdog_reward" : "carry_discount")
      : (gapToPartner > 0 ? "carry_penalty" : "loss_shield"),
  };
}

function buildLevelDelta({ oldRating, newRating, matchType, result, expected, gameDiff }) {
  const ratingInferred = levelFromRating(newRating) - levelFromRating(oldRating);
  const expectationGap = Math.abs((result ? 1 : 0) - Number(expected || 0.5));
  const typeFactor = matchType === "evento" ? 1.08 : matchType === "reto" ? 1.0 : 0.84;
  const marginFactor = 1 + Math.min(0.12, Number(gameDiff || 0) * 0.012);
  const adjusted = ratingInferred * typeFactor * marginFactor * (0.88 + expectationGap * 0.3);
  return round2(clampNumber(adjusted, -0.035, 0.035));
}

function buildTeamResult({
  teamPlayers,
  actualScore,
  expectedScore,
  matchType,
  dominance,
  gameDiff,
  teamRating,
  opponentRating,
}) {
  const baseK = round2((getHybridKFactor(teamPlayers[0], matchType) + getHybridKFactor(teamPlayers[1], matchType)) / 2);
  const baseDelta = round2(baseK * (actualScore - expectedScore));
  const teamDelta = round2(baseDelta * dominance);
  const a = buildContributionFactor({ player: teamPlayers[0], partner: teamPlayers[1], result: actualScore, gameDiff });
  const b = buildContributionFactor({ player: teamPlayers[1], partner: teamPlayers[0], result: actualScore, gameDiff });
  const [factorA, factorB] = normalizeSplitFactors(a.factor, b.factor);

  return {
    baseK,
    baseDelta,
    teamDelta,
    factors: [factorA, factorB],
    players: [a, b],
    meta: {
      expected: round2(expectedScore),
      dominance,
      gameDiff: Number(gameDiff || 0),
      matchType,
      teamRating: round2(teamRating),
      opponentRating: round2(opponentRating),
    },
  };
}

export function calculateAtpMatchDeltas({
  roster = [],
  parsed = null,
  col = "",
  matchType = "",
}) {
  const teamA = roster.slice(0, 2);
  const teamB = roster.slice(2, 4);
  const winnerIsA = parsed?.winnerTeam === "A";
  const resolvedType = getMatchType(col, matchType);
  const teamARating = round2((resolveCompetitiveSeed(teamA[0]) + resolveCompetitiveSeed(teamA[1])) / 2);
  const teamBRating = round2((resolveCompetitiveSeed(teamB[0]) + resolveCompetitiveSeed(teamB[1])) / 2);
  const expectedA = computeExpectedScore(teamARating, teamBRating);
  const expectedB = 1 - expectedA;
  const gameDiff = Math.abs(Number(parsed?.teamAGames || 0) - Number(parsed?.teamBGames || 0));
  const dominance = getDominanceFactor(parsed);

  const resultA = buildTeamResult({
    teamPlayers: teamA,
    actualScore: winnerIsA ? 1 : 0,
    expectedScore: expectedA,
    matchType: resolvedType,
    dominance,
    gameDiff,
    teamRating: teamARating,
    opponentRating: teamBRating,
  });
  const resultB = buildTeamResult({
    teamPlayers: teamB,
    actualScore: winnerIsA ? 0 : 1,
    expectedScore: expectedB,
    matchType: resolvedType,
    dominance,
    gameDiff,
    teamRating: teamBRating,
    opponentRating: teamARating,
  });

  const deltas = [0, 0, 0, 0];
  const contexts = [null, null, null, null];

  [
    { start: 0, team: teamA, teamResult: resultA, actualScore: winnerIsA ? 1 : 0 },
    { start: 2, team: teamB, teamResult: resultB, actualScore: winnerIsA ? 0 : 1 },
  ].forEach(({ start, team, teamResult, actualScore }) => {
    team.forEach((player, idx) => {
      const factor = Number(teamResult.factors[idx] || 1);
      const delta = round2(teamResult.teamDelta * factor);
      const oldRating = resolvePlayerRating(player);
      const newRating = oldRating + delta;
      const detail = teamResult.players[idx];

      deltas[start + idx] = delta;
      contexts[start + idx] = {
        cambioElo: round2(teamResult.baseDelta),
        limiteAplicado: delta,
        nuevoNivelCambio: buildLevelDelta({
          oldRating,
          newRating,
          matchType: teamResult.meta.matchType,
          result: actualScore,
          expected: teamResult.meta.expected,
          gameDiff: teamResult.meta.gameDiff,
        }),
        factoresAdicionales: {
          companero: round2(delta - teamResult.teamDelta),
          racha: 0,
          margenSets: round2(teamResult.teamDelta - teamResult.baseDelta),
        },
        desgloseReal: {
          esperado: teamResult.meta.expected,
          K: teamResult.baseK,
          multiplicadorTipo: teamResult.meta.matchType,
          diferenciaJuegos: teamResult.meta.gameDiff,
          dominance: teamResult.meta.dominance,
          repartoPareja: factor,
          seedIndividual: detail.seed,
          diferenciaConCompanero: detail.gapToPartner,
          roleHint: detail.roleHint,
          teamRating: teamResult.meta.teamRating,
          rivalRating: teamResult.meta.opponentRating,
        },
      };
    });
  });

  return {
    systemVersion: ATP_TEST_SYSTEM_VERSION,
    expectedA: round2(expectedA),
    teamARating,
    teamBRating,
    dominance,
    deltas,
    contexts,
  };
}
