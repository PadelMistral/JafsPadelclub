import { parseMatchResult } from "../ranking-service.js";

export function validateMatchAdminPayload({ resultStr = "", dateVal = "", state = "abierto" } = {}) {
  const errors = [];
  const normalizedState = String(state || "abierto").toLowerCase();

  if (!dateVal) {
    errors.push("Selecciona una fecha válida.");
  }

  if (resultStr) {
    const parsed = parseMatchResult(resultStr);
    if (!parsed?.valid) {
      errors.push("El resultado no tiene un formato válido. Usa algo como 6-4 6-3.");
    }
    if (normalizedState === "cancelado" || normalizedState === "anulado") {
      errors.push("Un partido cancelado no debería guardar resultado.");
    }
  }

  if (!resultStr && normalizedState === "jugado") {
    errors.push("Si marcas el partido como finalizado, añade también el resultado.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
