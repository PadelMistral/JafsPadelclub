import { auth, addDocument } from "../firebase-service.js";

function sanitizePayload(payload = {}) {
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return { note: "payload_not_serializable" };
  }
}

export async function logAdminAudit(action, entityType, entityId, payload = {}) {
  const actor = auth.currentUser;
  if (!actor?.uid) return null;

  return addDocument("auditLogs", {
    action,
    entityType,
    entityId,
    actorUid: actor.uid,
    actorEmail: actor.email || "",
    payload: sanitizePayload(payload),
    source: "admin-console",
  });
}
