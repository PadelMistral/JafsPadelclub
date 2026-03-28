import { RESULT_LOCK_MINUTES } from "../config/match-constants.js";

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
  if (typeof raw?.score === "string") return raw.score.trim();
  return "";
}

export function normalizeStoredResultString(resultStr = "") {
  return String(resultStr || "").trim().replace(/\s+/g, " ");
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

export function getCanonicalMatchState(matchOrState = null, resultStr = "") {
  const rawState =
    typeof matchOrState === "string"
      ? matchOrState
      : String(matchOrState?.estado || "");
  const normalizedState = String(rawState || "").trim().toLowerCase();
  const normalizedResult =
    resultStr ||
    (typeof matchOrState === "object" ? getResultSetsString(matchOrState) : "");

  if (normalizedState === "cancelado" || normalizedState === "anulado") {
    return normalizedState;
  }
  if (normalizeStoredResultString(normalizedResult)) return "jugado";
  if (["pendiente", "programado", "finalizado"].includes(normalizedState)) {
    return normalizedState === "finalizado" ? "jugado" : "abierto";
  }
  return normalizedState || "abierto";
}

export function buildStoredResultPayload(resultStr = "") {
  const normalized = normalizeStoredResultString(resultStr);
  return normalized ? { sets: normalized } : {};
}

export function buildMatchPersistencePatch({ state = "", resultStr = "", dateValue = null } = {}) {
  const normalizedResult = normalizeStoredResultString(resultStr);
  const patch = {
    estado: getCanonicalMatchState(state, normalizedResult),
    resultado: buildStoredResultPayload(normalizedResult),
  };
  if (dateValue) patch.fecha = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (normalizedResult) patch.rankingProcessedAt = null;
  return patch;
}

export function buildBaseMatchPayload({
  creatorId = null,
  organizerId = null,
  matchDate = null,
  players = [],
  minLevel = 1.0,
  maxLevel = 7.0,
  visibility = "public",
  invitedUsers = [],
  state = "abierto",
  sidePreferences = [],
  surface = "indoor",
  courtType = "normal",
  extra = {},
} = {}) {
  const normalizedPlayers = Array.isArray(players)
    ? players.slice(0, 4).map((id) => (id ? String(id) : null))
    : [];
  while (normalizedPlayers.length < 4) normalizedPlayers.push(null);

  const normalizedSides = Array.isArray(sidePreferences)
    ? sidePreferences.slice(0, 4)
    : [];
  while (normalizedSides.length < 4) {
    normalizedSides.push(normalizedSides.length % 2 === 0 ? "derecha" : "reves");
  }

  return {
    creador: creatorId || null,
    organizerId: organizerId || creatorId || null,
    fecha: matchDate instanceof Date ? matchDate : new Date(matchDate),
    jugadores: normalizedPlayers,
    playerUids: normalizedPlayers,
    restriccionNivel: { min: Number(minLevel || 1), max: Number(maxLevel || 7) },
    visibility: visibility || "public",
    invitedUsers: Array.isArray(invitedUsers) ? invitedUsers.filter(Boolean) : [],
    equipoA: normalizedPlayers.slice(0, 2),
    equipoB: normalizedPlayers.slice(2, 4),
    sidePreferences: normalizedSides,
    posiciones: normalizedSides.map((side) =>
      String(side || "").toLowerCase().includes("der") ? "drive" : "reves",
    ),
    surface: surface || "indoor",
    courtType: courtType || "normal",
    timestamp: extra.timestamp ?? null,
    createdAt: extra.createdAt ?? null,
    ...buildMatchPersistencePatch({ state }),
    ...extra,
  };
}

export function isExpiredOpenMatch(match, nowMs = Date.now(), graceMinutes = RESULT_LOCK_MINUTES + 30) {
  if (!match) return false;
  const state = String(match.estado || "").toLowerCase();
  if (state === "jugado" || state === "jugada" || state === "anulado" || state === "cancelado") return false;
  if (hasValidResult(match)) return false;

  const date = toDateSafe(match.fecha);
  if (!date) return false;

  const cutoff = date.getTime() + graceMinutes * 60 * 1000;
  return nowMs >= cutoff;
}

export function normalizePlayerIds(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((p) => {
      if (typeof p === "string") return p;
      if (typeof p === "number") return String(p);
      return p?.uid || p?.id || p?.userId || null;
    })
    .filter(Boolean);
}

export function getMatchPlayers(match) {
  if (!match) return [];
  const jugs = normalizePlayerIds(match.jugadores);
  if (jugs.length) return jugs;
  const uids = normalizePlayerIds(match.playerUids);
  if (uids.length) return uids;
  const teamA = normalizePlayerIds(match.equipoA);
  const teamB = normalizePlayerIds(match.equipoB);
  const merged = [...teamA, ...teamB].filter(Boolean);
  if (merged.length) return merged;
  const players = normalizePlayerIds(match.players);
  if (players.length) return players;
  const ids = normalizePlayerIds(match.playerIds);
  if (ids.length) return ids;
  return [];
}

export function isEventMatch(match) {
  if (!match) return false;
  const col = String(match.col || "").toLowerCase();
  if (col === "eventopartidos" || col === "torneopartidos") return true;
  if (match.eventoId || match.eventId || match.eventMatchId || match.eventLink?.eventoId) return true;
  return false;
}

export function getNormalizedPlayers(match) {
  const players = getMatchPlayers(match);
  if (!players.length) return [];
  return [...new Set(players)].slice(0, 4);
}

export function getMatchTeamPlayerIds(match, side = "A") {
  if (!match) return [];
  const safeSide = String(side || "A").toUpperCase() === "B" ? "B" : "A";
  const directPlayers = normalizePlayerIds(
    safeSide === "A"
      ? (match.teamAPlayers || match.playersA || match.equipoA)
      : (match.teamBPlayers || match.playersB || match.equipoB),
  );
  if (directPlayers.length) return directPlayers.slice(0, 2);

  const normalized = getNormalizedPlayers(match);
  if (!normalized.length) return [];
  return safeSide === "A" ? normalized.slice(0, 2) : normalized.slice(2, 4);
}

/**
 * Parses guest metadata from a synthetic UID like GUEST_Name_Level_Timestamp
 */
export function parseGuestMeta(uid) {
  if (!uid) return null;
  const s = String(uid);
  if (!s.startsWith("GUEST_") && !s.startsWith("invitado_") && !s.startsWith("manual_")) return null;
  const parts = s.split("_");
  if (parts.length >= 4 && Number.isFinite(parseFloat(parts[parts.length - 2]))) {
    const levelRaw = parts[parts.length - 2];
    const level = parseFloat(levelRaw);
    const nameRaw = parts.slice(1, parts.length - 2).join(" ");
    const name = nameRaw.replace(/_/g, " ").trim() || "Invitado";
    return { name, level: Number.isFinite(level) ? level : 2.5, raw: s };
  }
  const joinedName = parts.slice(1).join(" ").replace(/_/g, " ").trim() || "Invitado";
  const level = parseFloat(parts[2]);
  if (Number.isFinite(level) && parts.length === 3) {
    const name = (parts[1] || "Invitado").replace(/_/g, " ").trim() || "Invitado";
    return { name, level, raw: s };
  }
  const name = joinedName;
  return { name, level: Number.isFinite(level) ? level : 2.5, raw: s };
}
