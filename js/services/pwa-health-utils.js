export function classifyHealthState(id, value) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("error") || raw.includes("no soportado") || raw.includes("no registrado")) return "danger";
  if (raw.includes("default") || raw.includes("disponible") || raw.includes("navegador")) return "warning";
  if (raw.includes("activo") || raw.includes("suscrito") || raw.includes("instalada") || raw.includes("granted")) return "ok";
  if (id === "admin-health-cache" && raw && raw !== "sin cache") return "ok";
  if (id === "admin-health-scope" && raw && raw !== "sin scope") return "ok";
  return "neutral";
}

