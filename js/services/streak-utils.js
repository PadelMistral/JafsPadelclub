function toTs(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveOutcome(log = {}) {
  if (typeof log?.won === "boolean") return log.won ? 1 : -1;
  const diff = Number(log?.diff ?? log?.delta ?? 0);
  if (diff > 0) return 1;
  if (diff < 0) return -1;
  return 0;
}

export function computeCurrentStreakFromLogs(logs = []) {
  const ordered = [...(logs || [])].sort((a, b) => toTs(b?.timestamp) - toTs(a?.timestamp));
  let streak = 0;

  for (const log of ordered) {
    const outcome = resolveOutcome(log);
    if (!outcome) continue;
    if (streak === 0) {
      streak = outcome;
      continue;
    }
    if ((streak > 0 && outcome > 0) || (streak < 0 && outcome < 0)) {
      streak += outcome;
      continue;
    }
    break;
  }

  return streak;
}
