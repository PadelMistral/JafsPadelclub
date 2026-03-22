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
]);

export function normalizeTeamToken(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function isUnknownTeamName(value = "") {
  const normalized = normalizeTeamToken(value);
  if (!normalized) return true;
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

export function getFriendlyTeamName({
  teamName = "",
  teamId = "",
  playerNames = [],
  playerUids = [],
  resolvePlayerName = null,
  side = "A",
} = {}) {
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

  const normalizedTeamId = String(teamId || "").trim();
  if (normalizedTeamId) {
    const code = normalizedTeamId.replace(/^team[_-]?/i, "").replace(/^t/i, "");
    return `Equipo ${code || side}`;
  }

  return `Equipo ${side}`;
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
