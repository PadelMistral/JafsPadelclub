function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(toNumber(value, 0))));
}

export function computeWinrate(wins, played) {
  const safePlayed = Math.max(0, toNumber(played, 0));
  const safeWins = Math.max(0, toNumber(wins, 0));
  if (safePlayed <= 0) return 0;
  return clampPercent((safeWins / safePlayed) * 100);
}

export function computeEloPercent(rating, min = 700, range = 1500) {
  const safeMin = toNumber(min, 700);
  const safeRange = Math.max(1, toNumber(range, 1500));
  return clampPercent(((toNumber(rating, 1000) - safeMin) / safeRange) * 100);
}

export function computeFormPercent(winrate, streak) {
  const safeWinrate = clampPercent(winrate);
  const safeStreak = Math.max(0, toNumber(streak, 0));
  return clampPercent((safeWinrate * 0.7) + (safeStreak * 4.5));
}

export function getStreakVisualState(streak) {
  const safeStreak = toNumber(streak, 0);
  if (safeStreak >= 3) return "streak-hot up";
  if (safeStreak >= 0) return "up";
  return "down";
}

export function buildCompetitiveSnapshot(user = {}) {
  const rating = Math.round(toNumber(user?.puntosRanking, 1000));
  const played = Math.max(0, toNumber(user?.partidosJugados, 0));
  const wins = Math.max(0, toNumber(user?.victorias, 0));
  const streak = toNumber(user?.rachaActual, 0);
  const winrate = computeWinrate(wins, played);
  const eloPct = computeEloPercent(rating);
  const formPct = computeFormPercent(winrate, streak);

  return {
    rating,
    played,
    wins,
    streak,
    winrate,
    eloPct,
    formPct,
    streakClass: getStreakVisualState(streak),
  };
}
