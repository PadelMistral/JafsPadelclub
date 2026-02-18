export function toDateSafe(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return Number.isNaN(d?.getTime?.()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getResultSetsString(match) {
  if (!match) return "";
  const raw = match.resultado;
  if (!raw) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw?.sets === "string") return raw.sets.trim();
  return "";
}

export function parseSetWins(setsString) {
  const sets = String(setsString || "").trim().split(/\s+/).filter(Boolean);
  let team1 = 0;
  let team2 = 0;

  sets.forEach((s) => {
    const parts = s.split("-").map(Number);
    if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return;
    if (parts[0] > parts[1]) team1 += 1;
    else if (parts[1] > parts[0]) team2 += 1;
  });

  return { team1, team2, totalSets: team1 + team2 };
}

export function resolveWinnerTeam(match) {
  const winnerRaw = Number(match?.resultado?.ganador || match?.resultado?.winner || 0);
  if (winnerRaw === 1 || winnerRaw === 2) return winnerRaw;

  const setsStr = getResultSetsString(match);
  if (!setsStr) return null;

  const wins = parseSetWins(setsStr);
  if (wins.team1 === wins.team2) return null;
  return wins.team1 > wins.team2 ? 1 : 2;
}

export function hasValidResult(match) {
  const winner = resolveWinnerTeam(match);
  if (winner === 1 || winner === 2) return true;
  const wins = parseSetWins(getResultSetsString(match));
  return wins.totalSets >= 2;
}

export function isFinishedMatch(match) {
  const state = String(match?.estado || "").toLowerCase();
  if (state === "jugado" || state === "finalizado") return true;
  return hasValidResult(match);
}

export function isCancelledMatch(match) {
  const state = String(match?.estado || "").toLowerCase();
  return state === "anulado" || state === "cancelado";
}

export function isExpiredOpenMatch(match, nowMs = Date.now(), graceMinutes = 120) {
  if (!match) return false;
  const state = String(match.estado || "").toLowerCase();
  if (state === "jugado" || state === "anulado" || state === "cancelado") return false;
  if (hasValidResult(match)) return false;

  const date = toDateSafe(match.fecha);
  if (!date) return false;

  const cutoff = date.getTime() + graceMinutes * 60 * 1000;
  return nowMs >= cutoff;
}


