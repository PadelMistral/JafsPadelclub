import { db } from "../firebase-service.js";
import { doc, getDoc, setDoc, collection, query, where, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { clampNumber, getBaseEloByLevel } from "../config/elo-system.js";
import { parseGuestMeta } from "../utils/match-utils.js";
import {
  buildStableGuestId,
  isGuestPlayerId,
  normalizeGuestName,
  slugifyGuestName,
} from "./guest-player-utils.js";

const guestCache = new Map();
export { normalizeGuestName, slugifyGuestName, buildStableGuestId, isGuestPlayerId } from "./guest-player-utils.js";

async function findLinkedUserUidByName(name = "") {
  const clean = normalizeGuestName(name);
  if (!clean) return null;
  const probes = [
    query(collection(db, "usuarios"), where("nombreUsuario", "==", clean), limit(1)),
    query(collection(db, "usuarios"), where("nombre", "==", clean), limit(1)),
  ];
  for (const probe of probes) {
    try {
      const snap = await getDocs(probe);
      if (!snap.empty) return snap.docs[0].id;
    } catch (_) {}
  }
  return null;
}

export async function ensureGuestProfile({ name = "", level = 2.5, source = "manual", guestId = null, extra = {} } = {}) {
  const displayName = normalizeGuestName(name);
  if (!displayName) throw new Error("guest_name_required");

  const uid = String(guestId || buildStableGuestId(displayName));
  const ref = doc(db, "invitados", uid);
  const existingSnap = await getDoc(ref);
  const existing = existingSnap.exists() ? existingSnap.data() : null;
  const safeLevel = clampNumber(Number(level || existing?.nivel || 2.5), 1, 7);
  const linkedUid = existing?.linkedUid || await findLinkedUserUidByName(displayName);
  const aliases = Array.from(new Set([...(Array.isArray(existing?.aliases) ? existing.aliases : []), displayName])).filter(Boolean);

  await setDoc(ref, {
    uid,
    nombre: displayName,
    nombreUsuario: displayName,
    nombreNormalizado: displayName.toLowerCase(),
    nivel: safeLevel,
    puntosBaseInicial: getBaseEloByLevel(safeLevel),
    linkedUid: linkedUid || null,
    aliases,
    source: source || existing?.source || "manual",
    isGuestProfile: true,
    updatedAt: serverTimestamp(),
    ...(existingSnap.exists() ? {} : { createdAt: serverTimestamp() }),
    ...extra,
  }, { merge: true });

  const result = {
    id: uid,
    nombre: displayName,
    nombreUsuario: displayName,
    nivel: safeLevel,
    linkedUid: linkedUid || null,
    isGuest: true,
  };
  guestCache.set(uid, result);
  return result;
}

export async function getGuestProfile(uid = "") {
  const safeUid = String(uid || "");
  if (!isGuestPlayerId(safeUid)) return null;
  if (guestCache.has(safeUid)) return guestCache.get(safeUid);

  try {
    const snap = await getDoc(doc(db, "invitados", safeUid));
    if (snap.exists()) {
      const data = { id: snap.id, ...snap.data(), isGuest: true };
      guestCache.set(safeUid, data);
      return data;
    }
  } catch (_) {}

  const parsed = parseGuestMeta(safeUid);
  if (!parsed) return null;
  const fallback = {
    id: safeUid,
    nombre: parsed.name || "Invitado",
    nombreUsuario: parsed.name || "Invitado",
    nivel: Number(parsed.level || 2.5),
    isGuest: true,
  };
  guestCache.set(safeUid, fallback);
  return fallback;
}
