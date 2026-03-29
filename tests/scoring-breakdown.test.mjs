import test from "node:test";
import assert from "node:assert/strict";

import { buildTransparentBreakdown } from "../js/services/scoring-breakdown-utils.js";

test("buildTransparentBreakdown cuadra subtotal, ajuste y delta final", () => {
  const result = buildTransparentBreakdown({
    base: 4,
    streak: 2,
    surprise: -1,
    clutch: 0.5,
    skill: 0,
    bonus: 1,
    finalDelta: 8,
    extras: { jugador: "JUANAN" },
  });

  assert.equal(result.subtotalVariables, 6.5);
  assert.equal(result.ajusteBalance, 1.5);
  assert.equal(result.totalCalculado, 8);
  assert.equal(result.finalDelta, 8);
  assert.equal(result.jugador, "JUANAN");
});

test("buildTransparentBreakdown soporta restas limpias", () => {
  const result = buildTransparentBreakdown({
    base: -3,
    streak: -1,
    surprise: 0,
    clutch: -0.5,
    skill: 0,
    bonus: 0,
    finalDelta: -6,
  });

  assert.equal(result.subtotalVariables, -4.5);
  assert.equal(result.ajusteBalance, -1.5);
  assert.equal(result.totalCalculado, -6);
});

