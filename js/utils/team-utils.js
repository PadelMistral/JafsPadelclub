const UNKNOWN_TEAM_NAMES = new Set([
  "",
  "?",
  "tbd",
  "tbd.",
  "tbd?",
  "tdb",
  "unknown",
  "desconocido",
  "desconocidos",
  "por confirmar",
  "por definir",
  "pendiente",
  "equipo a",
  "equipo b",
  "manual_1",
]);

export function normalizeTeamToken(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function isUnknownTeamName(value = "") {
  const normalized = normalizeTeamToken(value);
  if (!normalized) return true;
  // Si la cadena mide al menos 20 caracteres y contiene mayormente código (como UUID & UUID)
  const tokens = normalized.split(/[\s&/|,-]+/);
  // Add another split for "vs" because regex \bvs\b is harder in split directly without keeping it
  const cleanTokens = tokens.flatMap(t => t.split(/\bvs\b/i)).map(t => t.trim()).filter(Boolean);
  const looksLikeUids = cleanTokens.some(t => t.length >= 20 && /^[a-z0-9_-]+$/i.test(t));
  if (looksLikeUids) return true;
  
  if (UNKNOWN_TEAM_NAMES.has(normalized)) return true;
  const compact = normalized.replace(/\s+/g, "");
  return ["tbdvs", "tbdvstbd", "tbdtbd", "pendientevs"].includes(compact);
}

export function getShortPlayerName(name = "") {
  const clean = String(name || "").trim();
  if (!clean) return "Jugador";
  return clean.split(/\s+/)[0];
}

export function buildTeamNameFromPlayers(players = [], options = {}) {
  const separator = options.separator || " / ";
  const names = (players || [])
    .map((player) =>
      typeof player === "string"
        ? player
        : player?.nombre || player?.nombreUsuario || player?.displayName || "",
    )
    .map((name) => getShortPlayerName(name))
    .filter(Boolean);

  if (!names.length) return "";
  return names.slice(0, 2).join(separator);
}

export function getFriendlyTeamName(arg = {}, legacyPlayerNames = []) {
  let teamName = "";
  let teamId = "";
  let playerNames = [];
  let playerUids = [];
  let resolvePlayerName = null;
  let fallback = "";
  let side = "A";

  if (typeof arg === "string") {
    teamName = arg;
    playerNames = Array.isArray(legacyPlayerNames) ? legacyPlayerNames : [];
  } else {
    teamName = arg.teamName || "";
    teamId = arg.teamId || "";
    playerNames = arg.playerNames || [];
    playerUids = arg.playerUids || [];
    resolvePlayerName = arg.resolvePlayerName || null;
    fallback = arg.fallback || "";
    side = arg.side || "A";
  }

  if (!isUnknownTeamName(teamName)) return String(teamName).trim();

  const resolvedNames = Array.isArray(playerNames) ? [...playerNames] : [];
  if ((!resolvedNames.length || resolvedNames.every((name) => !name)) && typeof resolvePlayerName === "function") {
    (playerUids || []).forEach((uid) => {
      const resolved = resolvePlayerName(uid);
      if (resolved) resolvedNames.push(resolved);
    });
  }

  const fromPlayers = buildTeamNameFromPlayers(resolvedNames);
  if (fromPlayers) return fromPlayers;

  if (String(fallback || "").trim()) return String(fallback).trim();

  const normalizedTeamId = String(teamId || "").trim();
  if (normalizedTeamId) {
    const code = normalizedTeamId.replace(/^team[_-]?/i, "").replace(/^t/i, "");
    return `Pareja ${code || side}`;
  }

  return `Pareja ${side}`;
}

export function getFriendlyMatchLabel({
  teamAName = "",
  teamBName = "",
  teamAId = "",
  teamBId = "",
  teamAPlayers = [],
  teamBPlayers = [],
  resolvePlayerName = null,
} = {}) {
  const sideA = getFriendlyTeamName({
    teamName: teamAName,
    teamId: teamAId,
    playerNames: teamAPlayers,
    playerUids: teamAPlayers,
    resolvePlayerName,
    side: "A",
  });
  const sideB = getFriendlyTeamName({
    teamName: teamBName,
    teamId: teamBId,
    playerNames: teamBPlayers,
    playerUids: teamBPlayers,
    resolvePlayerName,
    side: "B",
  });
  return `${sideA} vs ${sideB}`;
}
