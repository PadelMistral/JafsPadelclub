const RL_PREFIX = "rl_v1";

function key(name) {
  return `${RL_PREFIX}:${name}`;
}

function read(name) {
  try {
    return JSON.parse(localStorage.getItem(key(name)) || "{}");
  } catch {
    return {};
  }
}

function write(name, data) {
  try {
    localStorage.setItem(key(name), JSON.stringify(data));
  } catch (_) {}
}

export function rateLimitCheck(name, { windowMs = 60000, max = 20, minIntervalMs = 0 } = {}) {
  const now = Date.now();
  const state = read(name);
  const hits = Array.isArray(state.hits) ? state.hits.filter((t) => now - Number(t) <= windowMs) : [];
  const lastTs = Number(state.lastTs || 0);

  if (minIntervalMs > 0 && lastTs > 0 && now - lastTs < minIntervalMs) {
    return { ok: false, reason: "too_fast", retryMs: minIntervalMs - (now - lastTs) };
  }

  if (hits.length >= max) {
    const retryMs = Math.max(1000, windowMs - (now - Number(hits[0] || now)));
    return { ok: false, reason: "window_limit", retryMs };
  }

  hits.push(now);
  write(name, { hits, lastTs: now });
  return { ok: true };
}
