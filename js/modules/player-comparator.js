/**
 * @file player-comparator.js
 * @version 2.0 (Phase 10.5 - Visual Intelligence)
 * @description Logic for comparing two players with advanced competitive metrics.
 */

import { db, getDocument } from "../firebase-service.js";
import { collection, limit, orderBy, query, where } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { getDynamicKFactor } from "../config/elo-system.js";
import { buildH2H, computeRecentFormScore, computeWinrate } from "./visual-intelligence.js";

export async function comparePlayers(uid1, uid2) {
  if (!uid1 || !uid2) return null;

  try {
    const [p1, p2, logs1, logs2, usersSnap, amSnap, reSnap] = await Promise.all([
      getDocument("usuarios", uid1),
      getDocument("usuarios", uid2),
      window.getDocsSafe(
        query(collection(db, "rankingLogs"), where("uid", "==", uid1), orderBy("timestamp", "desc"), limit(12)),
      ),
      window.getDocsSafe(
        query(collection(db, "rankingLogs"), where("uid", "==", uid2), orderBy("timestamp", "desc"), limit(12)),
      ),
      window.getDocsSafe(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"), limit(500))),
      window.getDocsSafe(query(collection(db, "partidosAmistosos"), where("jugadores", "array-contains", uid1), limit(200))),
      window.getDocsSafe(query(collection(db, "partidosReto"), where("jugadores", "array-contains", uid1), limit(200))),
    ]);

    if (!p1 || !p2) return null;

    const globalUsers = (usersSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
    const p1Rank = getRank(globalUsers, uid1);
    const p2Rank = getRank(globalUsers, uid2);
    const total = globalUsers.length || 1;

    const logsA = (logs1?.docs || []).map((d) => d.data());
    const logsB = (logs2?.docs || []).map((d) => d.data());
    const matches = [
      ...(amSnap?.docs || []).map((d) => d.data()),
      ...(reSnap?.docs || []).map((d) => d.data()),
    ];
    const h2h = buildH2H(matches, uid1, uid2);

    const power1 = calculatePowerLevel(p1);
    const power2 = calculatePowerLevel(p2);
    const attrDiff = buildAttributeDiff(p1, p2);
    const formA = computeRecentFormScore(logsA, 5);
    const formB = computeRecentFormScore(logsB, 5);
    const winrateA = computeWinrate(p1);
    const winrateB = computeWinrate(p2);
    const k1 = getDynamicKFactor(p1);
    const k2 = getDynamicKFactor(p2);

    return {
      p1: {
        uid: uid1,
        name: p1.nombreUsuario || p1.nombre,
        level: p1.nivel,
        elo: p1.puntosRanking,
        kFactor: k1,
        rank: p1Rank,
        percentileTop: toTopPercent(p1Rank, total),
        winrate: winrateA,
        form: formA,
      },
      p2: {
        uid: uid2,
        name: p2.nombreUsuario || p2.nombre,
        level: p2.nivel,
        elo: p2.puntosRanking,
        kFactor: k2,
        rank: p2Rank,
        percentileTop: toTopPercent(p2Rank, total),
        winrate: winrateB,
        form: formB,
      },
      powerLevel: { p1: power1, p2: power2 },
      attributes: attrDiff,
      h2h,
    };
  } catch (e) {
    console.error("Comparison Error", e);
    return null;
  }
}

function buildAttributeDiff(p1, p2) {
  const attrDiff = {};
  const attrs = ["volea", "remate", "fondo", "fisico", "mentalidad", "consistencia", "velocidad"];
  attrs.forEach((key) => {
    const v1 = Number(p1.atributosTecnicos?.[key] || 50);
    const v2 = Number(p2.atributosTecnicos?.[key] || 50);
    attrDiff[key] = {
      val1: v1,
      val2: v2,
      diff: Number((v1 - v2).toFixed(1)),
      leader: v1 > v2 ? 1 : v2 > v1 ? 2 : 0,
    };
  });
  return attrDiff;
}

function getRank(users = [], uid = "") {
  const idx = (users || []).findIndex((u) => (u.id || u.uid) === uid);
  return idx >= 0 ? idx + 1 : 0;
}

function toTopPercent(rank, total) {
  if (!rank || !total) return 100;
  return Math.max(1, Math.min(100, Math.round((rank / total) * 100)));
}

function calculatePowerLevel(user) {
  const attrs = user.atributosTecnicos || {};
  const base = (user.nivel || 2.5) * 20;
  const tech = ((attrs.volea || 50) + (attrs.remate || 50) + (attrs.fondo || 50)) / 3;
  const phys = attrs.fisico || 50;
  const ment = attrs.mentalidad || 50;

  return Math.round(base + tech * 0.25 + phys * 0.15 + ment * 0.1);
}
