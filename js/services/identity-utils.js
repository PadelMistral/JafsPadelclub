export function getIdentityInitials(name = "") {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .map((chunk) => chunk[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
}

export function buildAvatarUrl(name = "") {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || "Jugador")}&background=0f172a&color=fff`;
}
