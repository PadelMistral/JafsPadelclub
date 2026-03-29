import { round2 } from "../config/elo-system.js";

export function buildTransparentBreakdown({
  base = 0,
  streak = 0,
  surprise = 0,
  clutch = 0,
  skill = 0,
  bonus = 0,
  finalDelta = 0,
  extras = {},
} = {}) {
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

