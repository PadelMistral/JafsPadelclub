/**
 * WEATHER UTILITIES
 * derived from Padeluminatis Court Condition Logic
 */

export function calculateCourtCondition(temp, rain, wind) {
  if (rain > 0.5) {
    return {
      condition: "Lluvia",
      icon: "fa-cloud-showers-heavy",
      color: "wx-rain",
      advice: "Pista mojada. Reduce riesgos y protege el cristal.",
    };
  }
  if (rain > 0.1) {
    return {
      condition: "Llovizna",
      icon: "fa-cloud-rain",
      color: "wx-rain",
      advice: "Bote irregular. Prioriza seguridad y globos cortos.",
    };
  }
  if (wind > 25) {
    return {
      condition: "Viento",
      icon: "fa-wind",
      color: "wx-cloud",
      advice: "Evita globos altos. Juega más plano y profundo.",
    };
  }
  if (temp < 10) {
    return {
      condition: "Frío",
      icon: "fa-snowflake",
      color: "wx-cloud",
      advice: "Bola pesada y poco rebote. Calienta bien.",
    };
  }
  if (temp > 28) {
    return {
      condition: "Calor",
      icon: "fa-sun",
      color: "wx-sun",
      advice:
        "La bola vuela mucho. Usa globos profundos y controla la potencia.",
    };
  }
  if (temp < 28) {
    return {
      condition: "Nublado",
      icon: "fa-cloud",
      color: "wx-cloud",
      advice: "Condición estable. Trabaja ritmo y paciencia.",
    };
  }
  return {
    condition: "Soleado",
    icon: "fa-sun",
    color: "wx-sun",
    advice: "Pista rápida. Ataca después del saque.",
  };
}
