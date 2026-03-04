import { isCancelledMatch, isFinishedMatch, resolveWinnerTeam, toDateSafe } from "../utils/match-utils.js";

function n(value, fallback = 0) {
  const v = Number(value);
  return Number.isFinite(v) ? v : fallback;
}

export function computeWinrate(user = {}) {
  const played = n(user.partidosJugados, 0);
  const wins = n(user.victorias, 0);
  if (played <= 0) return 0;
  return Math.round((wins / played) * 100);
}

export function computeRecentFormScore(logs = [], take = 5) {
  const sample = Array.isArray(logs) ? logs.slice(0, take) : [];
  if (!sample.length) return 0;
  const score = sample.reduce((acc, row) => {
    const diff = n(row?.diff, 0);
    return acc + (diff > 0 ? 1 : diff < 0 ? -1 : 0);
  }, 0);
  return Number((score / sample.length).toFixed(2));
}

export function aggregateMonthlyImprovement(logs = [], days = 30) {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const map = new Map();
  (logs || []).forEach((row) => {
    const uid = row?.uid;
    if (!uid) return;
    const d = toDateSafe(row?.timestamp);
    if (!d || d.getTime() < since) return;
    map.set(uid, n(map.get(uid), 0) + n(row?.diff, 0));
  });
  return map;
}

export function computeActivityScore(user = {}) {
  const played = n(user.partidosJugados, 0);
  const last = toDateSafe(user.lastMatchDate);
  if (!last) return played;
  const days = Math.max(0, Math.floor((Date.now() - last.getTime()) / (24 * 60 * 60 * 1000)));
  const freshness = Math.max(0, 40 - days);
  return played + freshness;
}

export function computeTopPercent(value, population = [], higherIsBetter = true) {
  const list = (population || []).map((v) => n(v, 0)).filter((v) => Number.isFinite(v));
  if (!list.length) return 100;
  const target = n(value, 0);
  const better = higherIsBetter ? list.filter((v) => v > target).length : list.filter((v) => v < target).length;
  const percentile = ((better + 1) / list.length) * 100;
  return Math.max(1, Math.min(100, Math.round(percentile)));
}

export function computeUserPercentiles({ users = [], targetUid = "", monthlyImprovement = new Map() } = {}) {
  const target = (users || []).find((u) => (u.id || u.uid) === targetUid);
  if (!target) {
    return { elo: 100, winrate: 100, activity: 100, monthlyImprovement: 100 };
  }

  const eloVals = users.map((u) => n(u.puntosRanking, 1000));
  const winVals = users.map((u) => computeWinrate(u));
  const activityVals = users.map((u) => computeActivityScore(u));
  const improvementVals = users.map((u) => n(monthlyImprovement.get(u.id || u.uid), 0));

  return {
    elo: computeTopPercent(n(target.puntosRanking, 1000), eloVals, true),
    winrate: computeTopPercent(computeWinrate(target), winVals, true),
    activity: computeTopPercent(computeActivityScore(target), activityVals, true),
    monthlyImprovement: computeTopPercent(n(monthlyImprovement.get(targetUid), 0), improvementVals, true),
  };
}

export function computeLeaderboardMetric(user = {}, metric = "elo", ctx = {}) {
  const logsByUid = ctx.logsByUid || new Map();
  const monthlyImprovement = ctx.monthlyImprovement || new Map();
  const key = user.id || user.uid;
  const userLogs = logsByUid.get(key) || [];

  if (metric === "form") return computeRecentFormScore(userLogs, 5);
  if (metric === "activity") return computeActivityScore(user);
  if (metric === "improvement") return n(monthlyImprovement.get(key), 0);
  if (metric === "winrate") return computeWinrate(user);
  return n(user.puntosRanking, 1000);
}

export function buildH2H(matches = [], uidA = "", uidB = "") {
  const base = {
    total: 0,
    winsA: 0,
    winsB: 0,
    recent: [],
  };
  if (!uidA || !uidB) return base;

  const list = (matches || [])
    .filter((m) => !isCancelledMatch(m) && isFinishedMatch(m))
    .filter((m) => Array.isArray(m.jugadores) && m.jugadores.includes(uidA) && m.jugadores.includes(uidB));

  list.forEach((m) => {
    const players = m.jugadores || [];
    const idxA = players.indexOf(uidA);
    const idxB = players.indexOf(uidB);
    if (idxA < 0 || idxB < 0) return;
    const teamA = idxA < 2 ? 1 : 2;
    const teamB = idxB < 2 ? 1 : 2;
    if (teamA === teamB) return;

    const winner = resolveWinnerTeam(m);
    if (winner !== 1 && winner !== 2) return;

    base.total += 1;
    if (winner === teamA) base.winsA += 1;
    if (winner === teamB) base.winsB += 1;
    base.recent.push({
      date: toDateSafe(m.fecha) || new Date(),
      winner,
      teamA,
      sets: m?.resultado?.sets || "",
    });
  });

  base.recent.sort((a, b) => b.date - a.date);
  base.recent = base.recent.slice(0, 5);
  return base;
}
