import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStableGuestId,
  isGuestPlayerId,
  normalizeGuestName,
  slugifyGuestName,
} from "../js/services/guest-player-utils.js";

test("normalizeGuestName limpia acentos y caracteres raros", () => {
  assert.equal(normalizeGuestName("  Lúís***   Peña "), "Luis Pena");
});

test("slugifyGuestName y buildStableGuestId generan ids estables", () => {
  assert.equal(slugifyGuestName("Luis Peña"), "luis_pena");
  assert.equal(buildStableGuestId("Luis Peña"), "GUEST_luis_pena");
});

test("isGuestPlayerId detecta formatos antiguos y estables", () => {
  assert.equal(isGuestPlayerId("GUEST_luis_pena"), true);
  assert.equal(isGuestPlayerId("manual_LUIS"), true);
  assert.equal(isGuestPlayerId("invitado_123"), true);
  assert.equal(isGuestPlayerId("realFirebaseUid123"), false);
});
