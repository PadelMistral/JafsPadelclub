// elo-system.js  — ELO 2v2 V3 (Stable & Competitive)
// Cambios clave sobre V2:
//  - 300pts por nivel (antes 400) → MENOS cambios de nivel
//  - K-factors reducidos → cambios de puntos más graduales
//  - Caps más ajustados → control de nivel más preciso
//  - Demotion Shield: 3 partidos de protección al subir de división
//  - Bandas más amplias = usuarios permanecen más tiempo en su nivel real

export const ELO_SYSTEM_VERSION = "elo2v7_padel_curve";

export const ELO_CONFIG = {
  BASE_RATING: 1000,
  MIN_RATING: 300,
  MAX_RATING: 5000,
  LEVEL_MIN: 1.0,
  LEVEL_MAX: 7.0,
  LEVEL_STEP: 0.01, 
  BONUS_CAP_RATIO: 0.18, 
  RATING_PER_LEVEL: 1200, // Subido de 1000 a 1200 para cambios más lentos

  K: {
    PROVISIONAL: 60,  // "mas facil al inicio" (mucho más rápido salir del rookie)
    DEVELOPING: 40,   // rápido crecimiento inicial
    STABLE: 15,       // estancado nivel medio-alto
    ELITE: 8,         // "muy dificil llegar a top"
    LEGEND: 4,        // legendario es casi inamovible (estancado)
  },

  CAPS: {
    COMPETITIVE_ABS: 55, // bajado más
    FRIENDLY_ABS: 35,    
  },

  DEMOTION_SHIELD_MATCHES: 3,
  DEMOTION_BUFFER_PTS: 8,

  // Sistema de Multiplicadores aún más conservadores
  DYNAMIC: {
    STREAK_M: 0.05,     
    UPSET_M: 1.10,      
    DOMINANCE_M: 1.05,  
    CLUTCH_M: 0.01,     
    ACTIVITY_M: 1.02,   
  }
};

export function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

export function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

const LEVEL_RATING_ANCHORS = [
  { level: 1.0, rating: 300 },
  { level: 1.5, rating: 620 },
  { level: 2.0, rating: 880 },
  { level: 2.5, rating: 1100 },
  { level: 3.0, rating: 1450 },
  { level: 3.25, rating: 1675 },
  { level: 3.5, rating: 1940 },
  { level: 3.75, rating: 2250 },
  { level: 4.0, rating: 2600 },
  { level: 4.25, rating: 2980 },
  { level: 4.5, rating: 3360 },
  { level: 5.0, rating: 3920 },
  { level: 5.5, rating: 4380 },
  { level: 6.0, rating: 4750 },
  { level: 7.0, rating: 5000 },
];

function interpolateByLevel(level) {
  const safeLevel = clampNumber(
    Number(level || 2.5),
    ELO_CONFIG.LEVEL_MIN,
    ELO_CONFIG.LEVEL_MAX,
  );
  for (let i = 0; i < LEVEL_RATING_ANCHORS.length - 1; i += 1) {
    const left = LEVEL_RATING_ANCHORS[i];
    const right = LEVEL_RATING_ANCHORS[i + 1];
    if (safeLevel < left.level || safeLevel > right.level) continue;
    const span = right.level - left.level || 1;
    const ratio = (safeLevel - left.level) / span;
    return Math.round(left.rating + (right.rating - left.rating) * ratio);
  }
  return LEVEL_RATING_ANCHORS[LEVEL_RATING_ANCHORS.length - 1].rating;
}

function interpolateByRating(rating) {
  const safeRating = clampNumber(
    Number(rating || ELO_CONFIG.BASE_RATING),
    ELO_CONFIG.MIN_RATING,
    ELO_CONFIG.MAX_RATING,
  );
  for (let i = 0; i < LEVEL_RATING_ANCHORS.length - 1; i += 1) {
    const left = LEVEL_RATING_ANCHORS[i];
    const right = LEVEL_RATING_ANCHORS[i + 1];
    if (safeRating < left.rating || safeRating > right.rating) continue;
    const span = right.rating - left.rating || 1;
    const ratio = (safeRating - left.rating) / span;
    return round2(left.level + (right.level - left.level) * ratio);
  }
  return LEVEL_RATING_ANCHORS[LEVEL_RATING_ANCHORS.length - 1].level;
}

/**
 * Convierte nivel 1-7 → rating base.
 * Fórmula: 1000 + (nivel - 2.5) × RATING_PER_LEVEL
 */
export function ratingFromLevel(level) {
  return interpolateByLevel(level);
}

/**
 * Convierte rating → nivel (con 2 decimales).
 */
export function levelFromRating(rating) {
  return interpolateByRating(rating);
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
