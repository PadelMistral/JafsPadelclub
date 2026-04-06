import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLevelProgressState,
  levelFromRating,
  ratingFromLevel,
} from "../js/config/elo-system.js";

test("ratingFromLevel crece al subir de nivel y levelFromRating mantiene coherencia basica", () => {
  const levelA = 3.0;
  const levelB = 4.0;
  const ratingA = ratingFromLevel(levelA);
  const ratingB = ratingFromLevel(levelB);

  assert.ok(ratingB > ratingA);
  assert.ok(levelFromRating(ratingA) >= 2.95 && levelFromRating(ratingA) <= 3.05);
  assert.ok(levelFromRating(ratingB) >= 3.95 && levelFromRating(ratingB) <= 4.05);
});

test("buildLevelProgressState devuelve progreso y estado consistentes cerca de subida", () => {
  const state = buildLevelProgressState({ rating: ratingFromLevel(3.49) });

  assert.equal(state.currentLevel, 3.49);
  assert.equal(state.prevLevel, 3.49);
  assert.equal(state.nextLevel, 3.5);
  assert.ok(state.progressPct >= 0 && state.progressPct <= 100);
  assert.ok(state.pointsToUp >= 0);
  assert.ok(state.pointsToDown >= 0);
  assert.ok(["stable", "up", "down", "danger"].includes(state.stateClass));
});

test("buildLevelProgressState detecta zona de riesgo cerca del umbral inferior", () => {
  const nearDropRating = ratingFromLevel(3.2) + 1;
  const state = buildLevelProgressState({ rating: nearDropRating, levelOverride: 3.2 });

  assert.equal(state.currentLevel, 3.2);
  assert.ok(state.pointsToDown < state.demotionBuffer);
  assert.equal(state.isNearDown, true);
  assert.match(state.stateLabel, /RIESGO|PELIGRO/i);
});

