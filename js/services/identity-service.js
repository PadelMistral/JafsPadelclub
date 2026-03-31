import { getDocument } from "../firebase-service.js";
import { parseGuestMeta } from "../utils/match-utils.js";
import { buildAvatarUrl, getIdentityInitials } from "./identity-utils.js";

const identityCache = new Map();

function escapeHtml(raw = "") {
  return String(raw || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeIdentity(raw = {}, fallbackUid = "") {
  const name = String(raw?.nombreUsuario || raw?.nombre || raw?.name || raw?.email || "Jugador").trim() || "Jugador";
  const photo = String(raw?.fotoPerfil || raw?.fotoURL || raw?.photoURL || raw?.photo || "").trim();
  return {
    uid: String(raw?.uid || raw?.id || fallbackUid || ""),
    name,
    shortName: name.split(/\s+/)[0] || name,
    photo,
    initials: getIdentityInitials(name),
    level: Number(raw?.nivel || raw?.level || 2.5),
    isGuest: raw?.isGuest === true || raw?.isGuestProfile === true,
  };
}

export function getCachedIdentity(uid = "") {
  return identityCache.get(String(uid || "")) || null;
}

export function seedIdentityCache(entries = []) {
  (entries || []).forEach((entry) => {
    const normalized = normalizeIdentity(entry, entry?.uid || entry?.id || "");
    if (normalized.uid) identityCache.set(normalized.uid, normalized);
  });
}

export async function resolveIdentity(uid, options = {}) {
  if (!uid) return normalizeIdentity({ name: "Jugador" });
  const safeUid = String(uid);
  if (identityCache.has(safeUid)) return identityCache.get(safeUid);

  if (safeUid === String(options.currentUserId || "") && options.currentUserData) {
    const normalizedSelf = normalizeIdentity({ ...options.currentUserData, uid: safeUid }, safeUid);
    identityCache.set(safeUid, normalizedSelf);
    return normalizedSelf;
  }

  const localUser = options.userMap?.[safeUid] || options.userMap?.get?.(safeUid) || null;
  if (localUser) {
    const normalizedLocal = normalizeIdentity({ ...localUser, uid: safeUid }, safeUid);
    identityCache.set(safeUid, normalizedLocal);
    return normalizedLocal;
  }

  const guestMeta = parseGuestMeta(safeUid);
  if (guestMeta) {
    const normalizedGuest = normalizeIdentity({
      uid: safeUid,
      nombre: guestMeta.name || "Invitado",
      nivel: Number(guestMeta.level || 2.5),
      isGuest: true,
    }, safeUid);
    identityCache.set(safeUid, normalizedGuest);
    return normalizedGuest;
  }

  const userDoc = await getDocument("usuarios", safeUid).catch(() => null);
  if (userDoc) {
    const normalizedUser = normalizeIdentity({ ...userDoc, uid: safeUid }, safeUid);
    identityCache.set(safeUid, normalizedUser);
    return normalizedUser;
  }

  const guestDoc = await getDocument("invitados", safeUid).catch(() => null);
  if (guestDoc) {
    const normalizedStoredGuest = normalizeIdentity({ ...guestDoc, uid: safeUid, isGuest: true }, safeUid);
    identityCache.set(safeUid, normalizedStoredGuest);
    return normalizedStoredGuest;
  }

  const fallback = normalizeIdentity({
    uid: safeUid,
    nombre: "Jugador",
  }, safeUid);
  identityCache.set(safeUid, fallback);
  return fallback;
}

export async function resolveDisplayName(uid, options = {}) {
  const identity = await resolveIdentity(uid, options);
  return identity?.name || "Jugador";
}

export function renderIdentityAvatar(identity = {}, className = "avatar") {
  const safeName = escapeHtml(identity?.name || "Jugador");
  const safeInitials = escapeHtml(identity?.initials || getIdentityInitials(identity?.name || "Jugador"));
  const safeClass = escapeHtml(className);
  const photo = String(identity?.photo || "").trim();
  if (photo) {
    return `<img src="${escapeHtml(photo)}" class="${safeClass}" alt="${safeName}" onerror="this.outerHTML='<span class=&quot;${safeClass} avatar-fallback&quot;>${safeInitials}</span>'" />`;
  }
  return `<span class="${safeClass} avatar-fallback">${safeInitials}</span>`;
}
