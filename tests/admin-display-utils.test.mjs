import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveAdminActorLabel,
  resolveAdminEntityLabel,
} from "../js/services/admin-display-utils.js";

test("resolveAdminActorLabel prioriza email y luego usuario conocido", () => {
  const users = [{ id: "u1", nombreUsuario: "JUANAN" }];
  assert.equal(resolveAdminActorLabel("mail@test.com", "u1", users), "mail@test.com");
  assert.equal(resolveAdminActorLabel("", "u1", users), "JUANAN");
  assert.equal(resolveAdminActorLabel("", "01234567890123456789", users), "admin");
});

test("resolveAdminEntityLabel traduce usuarios, invitados y eventos", () => {
  const data = {
    users: [{ id: "u1", nombreUsuario: "CMARCH" }],
    guestProfiles: [{ id: "g1", nombre: "LUIS" }],
    eventsArr: [{ id: "e1", nombre: "Torneo Primavera" }],
  };
  assert.equal(resolveAdminEntityLabel("usuarios", "u1", data), "CMARCH");
  assert.equal(resolveAdminEntityLabel("invitados", "g1", data), "LUIS");
  assert.equal(resolveAdminEntityLabel("eventos", "e1", data), "Torneo Primavera");
});
