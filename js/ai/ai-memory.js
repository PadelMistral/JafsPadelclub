import { getDocument, updateDocument } from "../firebase-service.js";

const MEM_PREFIX = "ai_mem_v1";
const memCache = new Map();
const primedUsers = new Set();
const syncTimers = new Map();

function key(uid) {
  return `${MEM_PREFIX}:${uid}`;
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeMemory(mem = {}) {
  return {
    insights: Array.isArray(mem.insights) ? mem.insights.slice(0, 30) : [],
    patterns: Array.isArray(mem.patterns) ? mem.patterns.slice(0, 20) : [],
    updatedAt: mem.updatedAt || new Date().toISOString(),
  };
}

function dedupeBySignature(list = [], dateField = "updatedAt", max = 30) {
  const bySig = new Map();
  list.forEach((item) => {
    const sig = String(item?.signature || item?.id || item?.text || "").trim();
    if (!sig) return;
    const prev = bySig.get(sig);
    if (!prev) {
      bySig.set(sig, item);
      return;
    }
    const prevTs = new Date(prev?.[dateField] || prev?.createdAt || 0).getTime();
    const nextTs = new Date(item?.[dateField] || item?.createdAt || 0).getTime();
    bySig.set(sig, nextTs >= prevTs ? item : prev);
  });
  return [...bySig.values()]
    .sort((a, b) => new Date(b?.[dateField] || b?.createdAt || 0).getTime() - new Date(a?.[dateField] || a?.createdAt || 0).getTime())
    .slice(0, max);
}

function mergeMemory(localMem = {}, remoteMem = {}) {
  const local = normalizeMemory(localMem);
  const remote = normalizeMemory(remoteMem);
  return normalizeMemory({
    insights: dedupeBySignature([...remote.insights, ...local.insights], "updatedAt", 30),
    patterns: dedupeBySignature([...remote.patterns, ...local.patterns], "lastSeenAt", 20),
    updatedAt: new Date().toISOString(),
  });
}

function scheduleRemoteSync(uid) {
  if (!uid) return;
  const prev = syncTimers.get(uid);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(async () => {
    syncTimers.delete(uid);
    try {
      await updateDocument("usuarios", uid, {
        aiMemory: getAIMemory(uid),
        aiMemoryUpdatedAt: new Date().toISOString(),
      });
    } catch {
      // Local memory remains the fallback if remote sync fails.
    }
  }, 700);
  syncTimers.set(uid, timer);
}

export function getAIMemory(uid) {
  if (!uid) return normalizeMemory();
  if (memCache.has(uid)) return memCache.get(uid);

  const fromStorage = safeJsonParse(localStorage.getItem(key(uid)), null);
  const mem = normalizeMemory(fromStorage || {});
  memCache.set(uid, mem);
  return mem;
}

export function saveAIMemory(uid, memory) {
  if (!uid) return;
  const normalized = normalizeMemory({ ...memory, updatedAt: new Date().toISOString() });
  memCache.set(uid, normalized);
  localStorage.setItem(key(uid), JSON.stringify(normalized));
  scheduleRemoteSync(uid);
}

export async function primeAIMemory(uid) {
  if (!uid) return normalizeMemory();
  if (primedUsers.has(uid) && memCache.has(uid)) return memCache.get(uid);
  primedUsers.add(uid);

  const local = getAIMemory(uid);
  try {
    const userDoc = await getDocument("usuarios", uid);
    const merged = mergeMemory(local, userDoc?.aiMemory || {});
    memCache.set(uid, merged);
    localStorage.setItem(key(uid), JSON.stringify(merged));
    scheduleRemoteSync(uid);
    return merged;
  } catch {
    return local;
  }
}

export function rememberInsight(uid, insight) {
  if (!uid || !insight?.text) return;
  const memory = getAIMemory(uid);
  const sig = `${insight.type || "general"}|${String(insight.text).trim().toLowerCase()}`;
  const exists = memory.insights.find((i) => i.signature === sig);
  if (exists) {
    exists.hits = Number(exists.hits || 1) + 1;
    exists.updatedAt = new Date().toISOString();
  } else {
    memory.insights.unshift({
      signature: sig,
      type: insight.type || "general",
      text: String(insight.text).trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      hits: 1,
      matchId: insight.matchId || null,
      rivalUid: insight.rivalUid || null,
    });
  }
  memory.insights = memory.insights.slice(0, 30);
  saveAIMemory(uid, memory);
}

export function rememberPattern(uid, pattern) {
  if (!uid || !pattern?.id) return;
  const memory = getAIMemory(uid);
  const sig = `${pattern.id}|${String(pattern.summary || "").toLowerCase()}`;
  const existing = memory.patterns.find((p) => p.signature === sig);
  if (existing) {
    existing.hits = Number(existing.hits || 1) + 1;
    existing.lastSeenAt = new Date().toISOString();
  } else {
    memory.patterns.unshift({
      signature: sig,
      id: pattern.id,
      summary: pattern.summary || "",
      confidence: Number(pattern.confidence || 0),
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      hits: 1,
    });
  }
  memory.patterns = memory.patterns.slice(0, 20);
  saveAIMemory(uid, memory);
}

export function getTopMemoryInsights(uid, max = 3) {
  const memory = getAIMemory(uid);
  const topInsights = [...memory.insights]
    .sort((a, b) => Number(b.hits || 0) - Number(a.hits || 0))
    .slice(0, max);
  const topPatterns = [...memory.patterns]
    .sort((a, b) => Number(b.hits || 0) - Number(a.hits || 0))
    .slice(0, max);

  return { topInsights, topPatterns };
}
