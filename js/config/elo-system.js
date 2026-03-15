// elo-system.js  — ELO 2v2 V3 (Stable & Competitive)
// Cambios clave sobre V2:
//  - 300pts por nivel (antes 400) → MENOS cambios de nivel
//  - K-factors reducidos → cambios de puntos más graduales
//  - Caps más ajustados → control de nivel más preciso
//  - Demotion Shield: 3 partidos de protección al subir de división
//  - Bandas más amplias = usuarios permanecen más tiempo en su nivel real

export const ELO_SYSTEM_VERSION = "elo2v5_v1_pro";

export const ELO_CONFIG = {
  BASE_RATING: 1000,
  MIN_RATING: 300,
  MAX_RATING: 5000,
  LEVEL_MIN: 1.0,
  LEVEL_MAX: 7.0,
  LEVEL_STEP: 0.001, 
  BONUS_CAP_RATIO: 0.25, 
  RATING_PER_LEVEL: 1000,

  K: {
    PROVISIONAL: 40, 
    DEVELOPING: 32, 
    STABLE: 22, 
    ELITE: 16, 
    LEGEND: 12, 
  },

  CAPS: {
    COMPETITIVE_ABS: 60, 
    FRIENDLY_ABS: 30,     
  },

  DEMOTION_SHIELD_MATCHES: 3,
  DEMOTION_BUFFER_PTS: 5,

  // Sistema de Multiplicadores de Alta Precisión
  DYNAMIC: {
    STREAK_M: 0.12,     // Multiplicador base por racha
    UPSET_M: 1.45,      // Factor sorpresa
    DOMINANCE_M: 1.25,  // Factor por sets/juegos
    CLUTCH_M: 0.05,     // Plus por tie-break o 7-5
    ACTIVITY_M: 1.15,   // Plus para jugadores activos
  }
};

export function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

export function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

/**
 * Convierte nivel 1-7 → rating base.
 * Fórmula: 1000 + (nivel - 2.5) × RATING_PER_LEVEL
 */
export function ratingFromLevel(level) {
  const l = clampNumber(
    Number(level || 2.5),
    ELO_CONFIG.LEVEL_MIN,
    ELO_CONFIG.LEVEL_MAX,
  );
  return Math.round(
    ELO_CONFIG.BASE_RATING + (l - 2.5) * ELO_CONFIG.RATING_PER_LEVEL,
  );
}

/**
 * Convierte rating → nivel (con 2 decimales).
 */
export function levelFromRating(rating) {
  const r = clampNumber(
    Number(rating || ELO_CONFIG.BASE_RATING),
    ELO_CONFIG.MIN_RATING,
    ELO_CONFIG.MAX_RATING,
  );
  const raw = 2.5 + (r - ELO_CONFIG.BASE_RATING) / ELO_CONFIG.RATING_PER_LEVEL;
  return round2(clampNumber(raw, ELO_CONFIG.LEVEL_MIN, ELO_CONFIG.LEVEL_MAX));
}

export function getBaseEloByLevel(level) {
  return ratingFromLevel(level);
}

export function resolvePlayerRating(player = {}) {
  if (Number.isFinite(Number(player.puntosRanking)))
    return Number(player.puntosRanking);
  if (Number.isFinite(Number(player.rating))) return Number(player.rating);
  return ratingFromLevel(player.nivel || 2.5);
}

export function getDynamicKFactor(user = {}) {
  const rating = resolvePlayerRating(user);
  const matches = Number(user.partidosJugados || 0);
  if (matches < 10) return ELO_CONFIG.K.PROVISIONAL;
  if (matches < 30) return ELO_CONFIG.K.DEVELOPING;
  if (rating >= 2700) return ELO_CONFIG.K.LEGEND;
  if (rating >= 2200) return ELO_CONFIG.K.ELITE;
  return ELO_CONFIG.K.STABLE;
}

export function computeExpectedScore(teamRating, opponentRating) {
  const a = Number(teamRating || ELO_CONFIG.BASE_RATING);
  const b = Number(opponentRating || ELO_CONFIG.BASE_RATING);
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

/* ─────────────────────────────────────────────────────────
   DIVISIONES — bandas más amplias para mayor estabilidad
   ───────────────────────────────────────────────────────── */
const DIVISIONS = [
  {
    id: "rookie",
    min: 0,
    max: 849,
    label: "Rookie",
    icon: "fa-seedling",
    color: "#94a3b8",
  },
  {
    id: "bronze",
    min: 850,
    max: 1049,
    label: "Bronce",
    icon: "fa-shield-halved",
    color: "#cd7f32",
  },
  {
    id: "silver",
    min: 1050,
    max: 1249,
    label: "Plata",
    icon: "fa-medal",
    color: "#c0c0c0",
  },
  {
    id: "gold",
    min: 1250,
    max: 1499,
    label: "Oro",
    icon: "fa-crown",
    color: "#facc15",
  },
  {
    id: "platinum",
    min: 1500,
    max: 1799,
    label: "Platino",
    icon: "fa-gem",
    color: "#22d3ee",
  },
  {
    id: "diamond",
    min: 1800,
    max: 2149,
    label: "Diamante",
    icon: "fa-diamond",
    color: "#60a5fa",
  },
  {
    id: "master",
    min: 2150,
    max: 99999,
    label: "Maestro",
    icon: "fa-trophy",
    color: "#a78bfa",
  },
];

export function getLevelBandByRating(rating) {
  const r = Number(rating || ELO_CONFIG.BASE_RATING);
  if (r < 850) return { key: "rookie", label: "Rookie" };
  if (r < 1050) return { key: "bronze", label: "Bronce" };
  if (r < 1250) return { key: "silver", label: "Plata" };
  if (r < 1500) return { key: "gold", label: "Oro" };
  if (r < 1800) return { key: "platinum", label: "Platino" };
  if (r < 2150) return { key: "diamond", label: "Diamante" };
  return { key: "master", label: "Maestro" };
}

export function getDivisionByRating(rating) {
  const r = Number(rating || ELO_CONFIG.BASE_RATING);
  return DIVISIONS.find((d) => r >= d.min && r <= d.max) || DIVISIONS[0];
}

export function compareDivisionRank(prevRating, currentRating) {
  const prev = getDivisionByRating(prevRating);
  const curr = getDivisionByRating(currentRating);
  const prevIdx = DIVISIONS.findIndex((d) => d.id === prev.id);
  const currIdx = DIVISIONS.findIndex((d) => d.id === curr.id);
  return currIdx - prevIdx;
}

/* ─────────────────────────────────────────────────────────
   PROGRESO DE NIVEL — con demotion buffer
   ───────────────────────────────────────────────────────── */
export function buildLevelProgressState({ rating, levelOverride } = {}) {
  const safeRating = clampNumber(
    Number(rating || ELO_CONFIG.BASE_RATING),
    ELO_CONFIG.MIN_RATING,
    ELO_CONFIG.MAX_RATING,
  );

  const inferredLevel = levelFromRating(safeRating);
  const currentLevel = Number.isFinite(Number(levelOverride))
    ? round2(
        clampNumber(
          Number(levelOverride),
          ELO_CONFIG.LEVEL_MIN,
          ELO_CONFIG.LEVEL_MAX,
        ),
      )
    : inferredLevel;

  const lowerStep = Math.floor(
    (currentLevel - ELO_CONFIG.LEVEL_MIN) / ELO_CONFIG.LEVEL_STEP,
  );
  const prevLevel = round2(
    ELO_CONFIG.LEVEL_MIN + lowerStep * ELO_CONFIG.LEVEL_STEP,
  );
  const nextLevel = round2(
    clampNumber(
      prevLevel + ELO_CONFIG.LEVEL_STEP,
      ELO_CONFIG.LEVEL_MIN,
      ELO_CONFIG.LEVEL_MAX,
    ),
  );

  const downThreshold = ratingFromLevel(prevLevel);
  const upThreshold = ratingFromLevel(nextLevel);
  const band = Math.max(1, upThreshold - downThreshold);
  const progressPct = clampNumber(
    ((safeRating - downThreshold) / band) * 100,
    0,
    100,
  );

  const upPct = round2(100 - progressPct);
  const downPct = round2(progressPct);
  const pointsToUp = Math.max(0, Math.ceil(upThreshold - safeRating));
  const pointsToDown = Math.max(0, Math.ceil(safeRating - downThreshold));

  // Buffer de protección antes de bajar
  const effectiveDownZone = ELO_CONFIG.DEMOTION_BUFFER_PTS;
  const isNearDown = progressPct <= 20 && pointsToDown < effectiveDownZone;

  let stateLabel = "ESTABLE";
  let stateClass = "stable";
  if (progressPct >= 80) {
    stateLabel = "NEAR PRO ↑";
    stateClass = "up";
  } else if (isNearDown) {
    stateLabel = "RIESGO BAJO ↓";
    stateClass = "down";
  } else if (progressPct <= 15) {
    stateLabel = "ZONA PELIGRO";
    stateClass = "danger";
  }

  return {
    currentLevel,
    prevLevel,
    nextLevel,
    progressPct: round2(progressPct),
    upPct,
    downPct,
    pointsToUp,
    pointsToDown,
    stateLabel,
    stateClass,
    levelBand: getLevelBandByRating(safeRating),
    demotionBuffer: effectiveDownZone,
    isNearDown,
  };
}
