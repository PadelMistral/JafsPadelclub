import test from "node:test";
import assert from "node:assert/strict";

import { buildAvatarUrl, getIdentityInitials } from "../js/services/identity-utils.js";

test("getIdentityInitials usa dos letras maximo", () => {
  assert.equal(getIdentityInitials("Juan Antonio"), "JA");
  assert.equal(getIdentityInitials("luis"), "L");
  assert.equal(getIdentityInitials(""), "?");
});

test("buildAvatarUrl genera una url estable con parametros base", () => {
  const url = buildAvatarUrl("Luis Peña");
  assert.match(url, /^https:\/\/ui-avatars\.com\/api\/\?/);
  assert.match(url, /name=/);
  assert.match(url, /background=0f172a/);
});

