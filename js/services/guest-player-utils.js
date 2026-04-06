export function normalizeGuestName(name = "") {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugifyGuestName(name = "") {
  const normalized = normalizeGuestName(name).toLowerCase();
  return normalized.replace(/[\s_]+/g, "_").replace(/[^a-z0-9_]/g, "").replace(/^_+|_+$/g, "") || "invitado";
}

export function buildStableGuestId(name = "") {
  return `GUEST_${slugifyGuestName(name)}`;
}

export function isGuestPlayerId(uid = "") {
  const value = String(uid || "");
  return value.startsWith("GUEST_") || value.startsWith("invitado_") || value.startsWith("manual_");
}

