import { addDocument, auth } from "../firebase-service.js";
import { normalizeCapturedError } from "./error-monitor-utils.js";

const ERROR_STORAGE_KEY = "jafs:error-monitor:last";
const ERROR_THROTTLE_MS = 30_000;

function buildErrorFingerprint(screen = "unknown", message = "", source = "") {
  return `${String(screen)}|${String(source)}|${String(message).slice(0, 180)}`;
}

function shouldThrottleError(fingerprint) {
  try {
    const raw = localStorage.getItem(ERROR_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const lastSeen = Number(parsed?.[fingerprint] || 0);
    if (Date.now() - lastSeen < ERROR_THROTTLE_MS) return true;
    parsed[fingerprint] = Date.now();
    localStorage.setItem(ERROR_STORAGE_KEY, JSON.stringify(parsed));
    return false;
  } catch {
    return false;
  }
}

export async function captureScreenError(screen = "unknown", errorLike = null, extra = {}) {
  try {
    const payload = normalizeCapturedError(errorLike, extra);
    const fingerprint = buildErrorFingerprint(screen, payload.message, payload.source);
    if (shouldThrottleError(fingerprint)) return { skipped: true, reason: "throttled" };

    const viewport =
      typeof window !== "undefined"
        ? `${window.innerWidth || 0}x${window.innerHeight || 0}`
        : "server";

    const href = typeof window !== "undefined" ? window.location?.href || "" : "";
    const uid = auth?.currentUser?.uid || null;

    await addDocument("appErrors", {
      screen: String(screen || "unknown"),
      message: payload.message,
      stack: payload.stack,
      source: payload.source,
      line: payload.line,
      column: payload.column,
      uid,
      href,
      viewport,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent || "" : "",
      appVersion: typeof window !== "undefined" ? window.__APP_VERSION || "live" : "live",
      meta: extra?.meta || null,
      severity: extra?.severity || "error",
      tags: Array.isArray(extra?.tags) ? extra.tags : [],
    });
    return { success: true };
  } catch (err) {
    console.warn("captureScreenError failed:", err);
    return { success: false, error: err };
  }
}

export function installScreenErrorMonitoring(screen = "unknown", extraMetaProvider = null) {
  if (typeof window === "undefined") return () => {};
  if (window.__screenErrorMonitorInstalled?.[screen]) return () => {};

  window.__screenErrorMonitorInstalled = window.__screenErrorMonitorInstalled || {};
  window.__screenErrorMonitorInstalled[screen] = true;

  const buildMeta = () =>
    (typeof extraMetaProvider === "function" ? extraMetaProvider() : {}) || {};

  const onError = (event) => {
    captureScreenError(screen, event?.error || event, {
      source: event?.filename || "window.error",
      line: event?.lineno,
      column: event?.colno,
      meta: buildMeta(),
      tags: ["window-error", screen],
    });
  };

  const onRejection = (event) => {
    captureScreenError(screen, event?.reason || event, {
      source: "unhandledrejection",
      meta: buildMeta(),
      tags: ["promise-rejection", screen],
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    if (window.__screenErrorMonitorInstalled) {
      delete window.__screenErrorMonitorInstalled[screen];
    }
  };
}
