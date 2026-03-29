import test from "node:test";
import assert from "node:assert/strict";

import {
  computeCompetitiveMatchContexts,
  getCompetitiveSystemLabel,
  getCompetitiveSystemVersion,
  normalizeScoringSystem,
} from "../js/services/competitive-engine.js";

test("normalizeScoringSystem normaliza claves desconocidas al sistema default", () => {
  assert.equal(normalizeScoringSystem("default"), "default");
  assert.equal(normalizeScoringSystem("atp_test"), "atp_test");
  assert.equal(normalizeScoringSystem("legacy"), "default");
  assert.equal(normalizeScoringSystem(""), "default");
});

test("getCompetitiveSystemLabel y version devuelven metadatos coherentes", () => {
  assert.match(getCompetitiveSystemLabel("default"), /ELO/i);
  assert.match(getCompetitiveSystemLabel("atp_test"), /ATP/i);
  assert.ok(getCompetitiveSystemVersion("default"));
  assert.ok(getCompetitiveSystemVersion("atp_test"));
});

test("computeCompetitiveMatchContexts usa el motor club con buildDefaultContext", () => {
  const roster = [
    { id: "U1", puntosRanking: 1200, nivel: 3.1, partidosJugados: 20, rachaActual: 1 },
    { id: "U2", puntosRanking: 1180, nivel: 3.0, partidosJugados: 18, rachaActual: 0 },
    { id: "U3", puntosRanking: 1210, nivel: 3.1, partidosJugados: 22, rachaActual: -1 },
    { id: "U4", puntosRanking: 1195, nivel: 3.0, partidosJugados: 19, rachaActual: 0 },
  ];

  const result = computeCompetitiveMatchContexts({
    scoringSystem: "default",
    roster,
    buildDefaultContext: (index, player) => ({
      jugador: player,
      companero: roster[index ^ 1] || null,
      rivales: roster.slice(2),
      resultado: index < 2 ? 1 : 0,
      tipoPartido: "reto",
      margenSets: { juegosMios: 12, juegosRivales: 9, setsMios: 2, setsRivales: 1 },
    }),
  });

  assert.equal(result.systemKey, "default");
  assert.equal(result.contexts.length, 4);
  assert.ok(result.contexts.every((ctx) => ctx && Number.isFinite(Number(ctx.limiteAplicado))));
});

test("computeCompetitiveMatchContexts usa el motor ATP cuando corresponde", () => {
  const roster = [
    { id: "A1", puntosRanking: 1450, nivel: 3.8, partidosJugados: 30 },
    { id: "A2", puntosRanking: 1100, nivel: 2.9, partidosJugados: 18 },
    { id: "B1", puntosRanking: 1340, nivel: 3.4, partidosJugados: 26 },
    { id: "B2", puntosRanking: 1320, nivel: 3.3, partidosJugados: 22 },
  ];

  const result = computeCompetitiveMatchContexts({
    scoringSystem: "atp_test",
    roster,
    parsed: {
      winnerTeam: "A",
      teamASets: 2,
      teamBSets: 0,
      teamAGames: 12,
      teamBGames: 6,
    },
    col: "partidosReto",
    matchType: "reto",
  });

  assert.equal(result.systemKey, "atp_test");
  assert.equal(result.contexts.length, 4);
  assert.ok(result.matchMeta);
});
