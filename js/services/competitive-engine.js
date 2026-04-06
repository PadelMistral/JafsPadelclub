import { ELO_SYSTEM_VERSION } from "../config/elo-system.js";
import { SistemaPuntuacionAvanzado } from "./sistema-puntuacion.js";
import { ATP_TEST_SYSTEM_VERSION, calculateAtpMatchDeltas } from "../pruebaElo.js";

const DEFAULT_SYSTEM_KEY = "default";
const ATP_SYSTEM_KEY = "atp_test";
const CLUB_SYSTEM_LABEL = "ELO Hibrido Club";
const ATP_SYSTEM_LABEL = "ATP Hybrid Competitive";

const advancedScoring = new SistemaPuntuacionAvanzado();

export function normalizeScoringSystem(scoringSystem = DEFAULT_SYSTEM_KEY) {
  return String(scoringSystem || DEFAULT_SYSTEM_KEY).toLowerCase() === ATP_SYSTEM_KEY
    ? ATP_SYSTEM_KEY
    : DEFAULT_SYSTEM_KEY;
}

export function getCompetitiveSystemVersion(scoringSystem = DEFAULT_SYSTEM_KEY) {
  return normalizeScoringSystem(scoringSystem) === ATP_SYSTEM_KEY
    ? ATP_TEST_SYSTEM_VERSION
    : ELO_SYSTEM_VERSION;
}

export function getCompetitiveSystemLabel(scoringSystem = DEFAULT_SYSTEM_KEY) {
  return normalizeScoringSystem(scoringSystem) === ATP_SYSTEM_KEY
    ? ATP_SYSTEM_LABEL
    : CLUB_SYSTEM_LABEL;
}

export function computeCompetitiveMatchContexts({
  scoringSystem = DEFAULT_SYSTEM_KEY,
  roster = [],
  parsed = null,
  col = "",
  matchType = "",
  buildDefaultContext,
}) {
  const systemKey = normalizeScoringSystem(scoringSystem);

  if (systemKey === ATP_SYSTEM_KEY) {
    const atpResult = calculateAtpMatchDeltas({
      roster,
      parsed,
      col,
      matchType,
    });

    return {
      systemKey,
      systemLabel: ATP_SYSTEM_LABEL,
      systemVersion: ATP_TEST_SYSTEM_VERSION,
      contexts: atpResult?.contexts || [],
      matchMeta: atpResult || null,
    };
  }

  const contexts = roster.map((player, index) => {
    if (!player) return null;
    const ctx = typeof buildDefaultContext === "function" ? buildDefaultContext(index, player) : null;
    return ctx ? advancedScoring.calcularCambio(ctx) : null;
  });

  return {
    systemKey,
    systemLabel: CLUB_SYSTEM_LABEL,
    systemVersion: ELO_SYSTEM_VERSION,
    contexts,
    matchMeta: null,
  };
}
