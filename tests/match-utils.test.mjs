import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMatchPersistencePatch,
  getCanonicalMatchState,
  parseGuestMeta,
  parseSetWins,
  resolveWinnerTeam,
} from "../js/utils/match-utils.js";

test("parseSetWins detecta correctamente sets ganados por cada equipo", () => {
  const wins = parseSetWins("6-4 3-6 7-5");
  assert.equal(wins.team1, 2);
  assert.equal(wins.team2, 1);
  assert.equal(wins.totalSets, 3);
});

test("resolveWinnerTeam infiere ganador desde resultado almacenado", () => {
  const match = {
    resultado: {
      sets: "6-2 6-4",
    },
  };
  assert.equal(resolveWinnerTeam(match), 1);
});

test("getCanonicalMatchState pasa a jugado cuando existe marcador", () => {
  assert.equal(getCanonicalMatchState("abierto", "6-4 6-3"), "jugado");
});

test("buildMatchPersistencePatch limpia y normaliza estado y resultado", () => {
  const patch = buildMatchPersistencePatch({
    state: "finalizado",
    resultStr: " 6-4   6-3 ",
  });
  assert.equal(patch.estado, "jugado");
  assert.equal(patch.resultado.sets, "6-4 6-3");
  assert.equal(patch.rankingProcessedAt, null);
});

test("parseGuestMeta soporta invitados manuales con nivel incrustado", () => {
  const parsed = parseGuestMeta("manual_LUIS_4.5_171111");
  assert.equal(parsed.name, "LUIS");
  assert.equal(parsed.level, 4.5);
});
