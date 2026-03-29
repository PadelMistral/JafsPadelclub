import test from "node:test";
import assert from "node:assert/strict";

import { SistemaPuntuacionAvanzado } from "../js/services/sistema-puntuacion.js";
import { calculateAtpMatchDeltas } from "../js/pruebaElo.js";

test("SistemaPuntuacionAvanzado reparte responsabilidad: el fuerte gana menos con pareja inferior", () => {
  const sistema = new SistemaPuntuacionAvanzado();

  const stronger = sistema.calcularCambio({
    jugador: { puntosRanking: 1600, nivel: 4.5, partidosJugados: 40, rachaActual: 2 },
    companero: { puntosRanking: 1000, nivel: 2.5 },
    rivales: [
      { puntosRanking: 1300, nivel: 3.5 },
      { puntosRanking: 1280, nivel: 3.4 },
    ],
    resultado: 1,
    tipoPartido: "reto",
    margenSets: { juegosMios: 12, juegosRivales: 8, setsMios: 2, setsRivales: 0 },
  });

  const weaker = sistema.calcularCambio({
    jugador: { puntosRanking: 1000, nivel: 2.5, partidosJugados: 12, rachaActual: 1 },
    companero: { puntosRanking: 1600, nivel: 4.5 },
    rivales: [
      { puntosRanking: 1300, nivel: 3.5 },
      { puntosRanking: 1280, nivel: 3.4 },
    ],
    resultado: 1,
    tipoPartido: "reto",
    margenSets: { juegosMios: 12, juegosRivales: 8, setsMios: 2, setsRivales: 0 },
  });

  assert.ok(stronger.limiteAplicado < weaker.limiteAplicado);
});

test("ATP hybrid devuelve cuatro deltas coherentes por equipo", () => {
  const roster = [
    { id: "A1", puntosRanking: 1450, nivel: 3.8, partidosJugados: 30 },
    { id: "A2", puntosRanking: 1100, nivel: 2.9, partidosJugados: 18 },
    { id: "B1", puntosRanking: 1340, nivel: 3.4, partidosJugados: 26 },
    { id: "B2", puntosRanking: 1320, nivel: 3.3, partidosJugados: 22 },
  ];

  const result = calculateAtpMatchDeltas({
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

  assert.equal(result.deltas.length, 4);
  assert.ok(result.deltas[0] > 0);
  assert.ok(result.deltas[1] > 0);
  assert.ok(result.deltas[2] < 0);
  assert.ok(result.deltas[3] < 0);
});
