const LOG_KEY = "app_diag_log_v1";
const MAX_LOG_ITEMS = 200;

function nowIso() {
  return new Date().toISOString();
}

function safeStore(entry) {
  try {
    const prev = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    prev.push(entry);
    if (prev.length > MAX_LOG_ITEMS) prev.splice(0, prev.length - MAX_LOG_ITEMS);
    localStorage.setItem(LOG_KEY, JSON.stringify(prev));
  } catch (_) {}
}

function sanitizeMeta(meta = {}) {
  const clean = {};
  Object.entries(meta || {}).forEach(([k, v]) => {
    if (v === undefined) return;
    if (typeof v === "string") clean[k] = v.slice(0, 300);
    else if (typeof v === "number" || typeof v === "boolean" || v === null) clean[k] = v;
    else clean[k] = String(v).slice(0, 300);
  });
  return clean;
}

export function logInfo(event, meta = {}) {
  const entry = { ts: nowIso(), level: "info", event, meta: sanitizeMeta(meta) };
  safeStore(entry);
  try { console.log("[APP][INFO]", event, entry.meta); } catch (_) {}
}

export function logWarn(event, meta = {}) {
  const entry = { ts: nowIso(), level: "warn", event, meta: sanitizeMeta(meta) };
  safeStore(entry);
  try { console.warn("[APP][WARN]", event, entry.meta); } catch (_) {}
}

export function logError(event, meta = {}) {
  const entry = { ts: nowIso(), level: "error", event, meta: sanitizeMeta(meta) };
  safeStore(entry);
  try { console.error("[APP][ERROR]", event, entry.meta); } catch (_) {}
  try {
    import("./analytics.js").then((m) => m?.analyticsCount?.("errors.critical", 1)).catch(() => {});
  } catch (_) {}
}

export function getLogs() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
  } catch {
    return [];
  }
}

if (typeof window !== 'undefined') {
  window.getAppLogs = getLogs;
}

