const PLACEMENT_MATCHES = 5;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function getPlacementMatchesCount() {
  return PLACEMENT_MATCHES;
}

export function getBasePointsByLevel(level) {
  const l = clamp(toNumber(level, 2.5), 1, 7);
  return Math.round(1000 + (l - 2.5) * 400);
}

export function computePlacementProjection(user) {
  const played = Math.max(0, Math.round(toNumber(user?.partidosJugados, 0)));
  const wins = clamp(Math.round(toNumber(user?.victorias, 0)), 0, played);
  const losses = Math.max(0, played - wins);
  const streak = clamp(Math.round(toNumber(user?.rachaActual, 0)), -8, 12);
  const currentPoints = Math.max(0, Math.round(toNumber(user?.puntosRanking, 1000)));
  const currentLevel = clamp(toNumber(user?.nivel, 2.5), 1, 7);

  const winRate = played > 0 ? wins / played : 0.5;
  const pointsSignal = clamp((currentPoints - 700) / 1800, 0, 1);
  const streakSignal = clamp((streak + 8) / 20, 0, 1);
  const perfSignal = clamp(winRate, 0, 1);
  const progress = clamp(played / PLACEMENT_MATCHES, 0, 1);

  const blendedSignal = (perfSignal * 0.55) + (pointsSignal * 0.30) + (streakSignal * 0.15);
  const suggestedLevelRaw = 1 + (blendedSignal * 6) + ((progress - 0.5) * 0.08);
  const suggestedLevel = Number(clamp(suggestedLevelRaw, 1, 7).toFixed(2));

  const adjustmentByWinRate = Math.round((winRate - 0.5) * 150);
  const adjustmentByStreak = streak * 9;
  const suggestedPoints = Math.max(
    0,
    Math.round(getBasePointsByLevel(suggestedLevel) + adjustmentByWinRate + adjustmentByStreak),
  );

  const confidence = Math.round(clamp(progress, 0.2, 1) * 100);
  const isProvisional = played < PLACEMENT_MATCHES;
  const modeLabel = isProvisional ? `PROVISIONAL ${played}/${PLACEMENT_MATCHES}` : 'ESTABLE';
  const deltaLevel = Number((suggestedLevel - currentLevel).toFixed(2));
  const deltaPoints = suggestedPoints - currentPoints;

  return {
    uid: user?.id || user?.uid || null,
    played,
    wins,
    losses,
    winRate,
    streak,
    confidence,
    isProvisional,
    modeLabel,
    currentLevel,
    currentPoints,
    suggestedLevel,
    suggestedPoints,
    deltaLevel,
    deltaPoints,
    summary: isProvisional
      ? `Calibrando nivel real con ${played}/${PLACEMENT_MATCHES} partidos.`
      : `Nivel consolidado con muestra suficiente.`,
  };
}

export function buildPlacementRanking(users = []) {
  const projections = users.map((u) => ({
    user: u,
    projection: computePlacementProjection(u),
  }));

  projections.sort((a, b) => {
    if (b.projection.suggestedPoints !== a.projection.suggestedPoints) {
      return b.projection.suggestedPoints - a.projection.suggestedPoints;
    }
    return b.projection.wins - a.projection.wins;
  });

  return projections.map((row, idx) => ({
    ...row,
    suggestedRank: idx + 1,
  }));
}


