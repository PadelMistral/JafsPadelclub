import test from "node:test";
import assert from "node:assert/strict";

import { classifyHealthState } from "../js/services/pwa-health-utils.js";

test("classifyHealthState detecta estados ok", () => {
  assert.equal(classifyHealthState("admin-health-sw", "Activo"), "ok");
  assert.equal(classifyHealthState("admin-health-push", "Suscrito"), "ok");
  assert.equal(classifyHealthState("admin-health-cache", "jafs-padel-runtime"), "ok");
});

test("classifyHealthState detecta warning y danger", () => {
  assert.equal(classifyHealthState("admin-health-notif", "default"), "warning");
  assert.equal(classifyHealthState("admin-health-standalone", "Navegador"), "warning");
  assert.equal(classifyHealthState("admin-health-sw", "No registrado"), "danger");
  assert.equal(classifyHealthState("admin-health-push", "Error"), "danger");
});

