import test from "node:test";
import assert from "node:assert/strict";

import { computeCurrentStreakFromLogs } from "../js/services/streak-utils.js";
import { getIdentityInitials } from "../js/services/identity-utils.js";
import { parseGuestMeta } from "../js/utils/match-utils.js";

test("computeCurrentStreakFromLogs calcula racha positiva reciente", () => {
  const logs = [
    { diff: 8, timestamp: new Date("2026-03-20T10:00:00Z") },
    { diff: 6, timestamp: new Date("2026-03-18T10:00:00Z") },
    { diff: 4, timestamp: new Date("2026-03-16T10:00:00Z") },
    { diff: -5, timestamp: new Date("2026-03-14T10:00:00Z") },
  ];

  assert.equal(computeCurrentStreakFromLogs(logs), 3);
});

test("computeCurrentStreakFromLogs calcula racha negativa reciente", () => {
  const logs = [
    { diff: -7, timestamp: new Date("2026-03-20T10:00:00Z") },
    { diff: -3, timestamp: new Date("2026-03-18T10:00:00Z") },
    { diff: 9, timestamp: new Date("2026-03-16T10:00:00Z") },
  ];

  assert.equal(computeCurrentStreakFromLogs(logs), -2);
});

test("parseGuestMeta y getIdentityInitials producen datos legibles", () => {
  const guest = parseGuestMeta("GUEST_Luis_Martinez_4.0_171111");
  assert.equal(guest.name, "Luis Martinez");
  assert.equal(guest.level, 4);
  assert.equal(getIdentityInitials("Luis Martinez"), "LM");
});
