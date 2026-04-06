export function normalizeGuestName(name = "") {
  return String(name || "").replace(/\s+/g, " ").trim();
}

export function slugifyGuestName(name = "") {
  return normalizeGuestName(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isGuestPlayerId(uid = "") {
  const safeUid = String(uid || "");
  return safeUid.startsWith("GUEST_") || safeUid.startsWith("invitado_") || safeUid.startsWith("manual_");
}

export function buildStableGuestId(name = "", level = 2.5) {
  const cleanName = normalizeGuestName(name) || "Invitado";
  const slug = slugifyGuestName(cleanName) || "invitado";
  const safeLevel = Number.isFinite(Number(level)) ? Number(level).toFixed(1) : "2.5";
  return `GUEST_${slug}_${safeLevel}_stable`;
}
