import test from "node:test";
import assert from "node:assert/strict";

import { normalizeCapturedError } from "../js/services/error-monitor-utils.js";

test("normalizeCapturedError saca mensaje y stack desde Error normal", () => {
  const err = new Error("ranking exploded");
  const result = normalizeCapturedError(err, { source: "ranking.js" });

  assert.equal(result.message, "ranking exploded");
  assert.equal(result.source, "ranking.js");
  assert.ok(typeof result.stack === "string");
});

test("normalizeCapturedError soporta promise rejection style", () => {
  const result = normalizeCapturedError({ reason: { message: "event fail", stack: "trace" } }, { source: "unhandledrejection" });

  assert.equal(result.message, "event fail");
  assert.equal(result.stack, "trace");
  assert.equal(result.source, "unhandledrejection");
});
