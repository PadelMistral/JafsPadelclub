import { addDocument, auth } from "../firebase-service.js";

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toEntryPayload(entry = {}) {
  const uid = String(entry.uid || "").trim();
  if (!uid) return null;

  return {
    uid,
    kind: String(entry.kind || "system"),
    title: normalizeText(entry.title || "Actualizacion"),
    text: normalizeText(entry.text || ""),
    tag: normalizeText(entry.tag || "Sistema"),
    tone: normalizeText(entry.tone || "system"),
    matchId: entry.matchId || null,
    matchCollection: entry.matchCollection || null,
    entityId: entry.entityId || null,
    actorUid: auth.currentUser?.uid || null,
    actorEmail: auth.currentUser?.email || null,
    meta: entry.meta && typeof entry.meta === "object" ? entry.meta : {},
  };
}

export async function addPlayerHistoryEntry(entry = {}) {
  const payload = toEntryPayload(entry);
  if (!payload) return null;
  return addDocument("playerHistory", payload);
}

export async function addPlayerHistoryEntries(entries = []) {
  const valid = (Array.isArray(entries) ? entries : [])
    .map(toEntryPayload)
    .filter(Boolean);
  if (!valid.length) return [];
  return Promise.allSettled(valid.map((entry) => addDocument("playerHistory", entry)));
}
