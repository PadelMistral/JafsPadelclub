import { auth, db, serverTimestamp } from "../firebase-service.js";
import { doc, setDoc, increment } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

const SHARDS = 10;
const FLUSH_MS = 5000;
const queue = {};
let flushTimer = null;
let flushing = false;

function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function shardFor(uid = "anon") {
  let sum = 0;
  const s = String(uid || "anon");
  for (let i = 0; i < s.length; i += 1) sum = (sum + s.charCodeAt(i)) % SHARDS;
  return sum;
}

function docId(uid) {
  return `${dayKey()}_${shardFor(uid)}`;
}

function queueInc(path, value) {
  queue[path] = Number(queue[path] || 0) + Number(value || 0);
}

function buildPayload(uid) {
  const payload = {
    day: dayKey(),
    shard: shardFor(uid),
    updatedAt: serverTimestamp(),
    counters: {},
    metrics: {},
    flags: {},
  };

  const putNested = (root, path, val) => {
    const parts = String(path || "").split(".").filter(Boolean);
    if (!parts.length) return;
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const p = parts[i];
      if (!cursor[p] || typeof cursor[p] !== "object") cursor[p] = {};
      cursor = cursor[p];
    }
    cursor[parts[parts.length - 1]] = val;
  };

  Object.entries(queue).forEach(([k, v]) => {
    putNested(payload, k, increment(v));
  });
  return payload;
}

async function flush() {
  if (flushing) return;
  if (!Object.keys(queue).length) return;
  const uid = auth.currentUser?.uid || "anon";
  flushing = true;
  const ref = doc(db, "analytics", docId(uid));
  const payload = buildPayload(uid);

  const snapshot = { ...queue };
  Object.keys(queue).forEach((k) => delete queue[k]);

  try {
    await setDoc(ref, payload, { merge: true });
  } catch (_) {
    Object.entries(snapshot).forEach(([k, v]) => {
      queue[k] = Number(queue[k] || 0) + Number(v || 0);
    });
  } finally {
    flushing = false;
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    await flush();
  }, FLUSH_MS);
}

export function analyticsCount(name, value = 1) {
  if (!name) return;
  queueInc(`counters.${name}`, value);
  scheduleFlush();
}

export function analyticsTiming(name, durationMs) {
  const ms = Number(durationMs || 0);
  if (!name || !Number.isFinite(ms) || ms < 0) return;
  queueInc(`metrics.${name}.sumMs`, ms);
  queueInc(`metrics.${name}.count`, 1);
  scheduleFlush();
}

export function analyticsSetFlag(name, val) {
  if (!name) return;
  queueInc(`flags.${name}.${val ? "on" : "off"}`, 1);
  scheduleFlush();
}

if (typeof window !== "undefined") {
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("beforeunload", () => {
    flush();
  });
}
