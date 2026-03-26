/**
 * rating-engine.js - Glicko-2 Hybrid Engine for Padel 2v2
 * Implements simplified Glicko-2 with custom adjustments (anti-smurf, difficulty scaling, etc.)
 * as requested by the senior engineering specifications.
 */

// Glicko-2 constant
const GLICKO_SCALE = 173.7178;

/**
 * Standard g(phi) weight function for Glicko-2
 * Calculates the impact of the opponent's rating uncertainty.
 */
function g(phi) {
  return 1 / Math.sqrt(1 + (3 * Math.pow(phi, 2)) / (Math.pow(Math.PI, 2)));
}

/**
 * Expected score function E(mu, mu_j, phi_j)
 */
function E(mu, mu_j, phi_j) {
  return 1 / (1 + Math.exp(-g(phi_j) * (mu - mu_j)));
}

/**
 * Simplified Glicko-2 Step for a single match observation.
 * @param {Object} player Current player stats { r, rd, vol }
 * @param {Array} opponents Array of { r, rd } for opponents
 * @param {number} actualScore 1 for win, 0 for loss, 0.5 for draw (draws are unlikely in Padel but supported)
 * @returns {Object} { newR, newRD, delta }
 */
export function calculateGlicko2Delta(player, opponents, actualScore) {
  // Convert current rating/RD to Glicko-2 scale (mu, phi)
  const mu = (player.r - 1500) / GLICKO_SCALE;
  const phi = (player.rd || 80) / GLICKO_SCALE;
  
  // Treat match as two 1v1 observations for simplicity, averaging the impact
  let vSum = 0;
  let deltaSum = 0;

  opponents.forEach((opp) => {
    const mu_j = (opp.r - 1500) / GLICKO_SCALE;
    const phi_j = (opp.rd || 80) / GLICKO_SCALE;

    const g_phi_j = g(phi_j);
    const expected = E(mu, mu_j, phi_j);

    vSum += Math.pow(g_phi_j, 2) * expected * (1 - expected);
    deltaSum += g_phi_j * (actualScore - expected);
  });

  // Calculate variances and updates
  const v = 1 / vSum;
  const newMu = mu + (v * deltaSum);
  const newR = (newMu * GLICKO_SCALE) + 1500;
  
  // Calculate new RD (Simplified: reduction based on activity)
  // Standard Glicko-2 involves volatility updates (o), here we keep it simpler to avoid instability
  const newPhi = Math.sqrt(1 / ((1 / Math.pow(phi, 2)) + (1 / v)));
  const newRD = Math.min(newPhi * GLICKO_SCALE, 80); // Cap RD at 80 (user default)

  return { 
    newR, 
    newRD, 
    delta: newR - player.r 
  };
}

export function applyRankingAdjustments({ delta, matchesPlayed, isWin, myRating, rivalAvgRating, gameDiff }) {
  let adjustedDelta = delta;

  // 1. Loss buffer — soften losses slightly
  if (!isWin && adjustedDelta < 0) {
    adjustedDelta *= 0.75;
  }

  // 2. Provisional boost: New players gain/lose more to reach their true level faster
  const matches = Number(matchesPlayed || 0);
  if (matches < 5) {
    adjustedDelta *= 1.8;
  } else if (matches < 15) {
    adjustedDelta *= 1.35;
  } else if (matches < 30) {
    adjustedDelta *= 1.1;
  }

  // 3. Rating gap / difficulty scaling
  const ratingGap = (myRating || 1000) - (rivalAvgRating || 1000);

  if (isWin) {
    if (ratingGap > 300) {
      adjustedDelta *= Math.max(0.1, 1 - (ratingGap - 300) / 600);
    } else if (ratingGap > 150) {
      adjustedDelta *= Math.max(0.4, 1 - (ratingGap - 150) / 500);
    } else if (ratingGap < -300) {
      adjustedDelta *= Math.min(3.0, 1 + (Math.abs(ratingGap) - 300) / 250);
    } else if (ratingGap < -150) {
      adjustedDelta *= Math.min(2.0, 1 + (Math.abs(ratingGap) - 150) / 350);
    }
  } else {
    // On a loss
    if (ratingGap > 300) {
      adjustedDelta *= Math.min(2.0, 1 + (ratingGap - 300) / 400); // Pierde mas contra debiles
    } else if (ratingGap < -300) {
      adjustedDelta *= Math.max(0.2, 1 - (Math.abs(ratingGap) - 300) / 600); // Pierde poco contra muy fuertes
    }
  }

  // 4. Game Difference Multiplier (abultado = mas puntos)
  if (typeof gameDiff === 'number') {
      const diffAbs = Math.abs(gameDiff);
      // diffAbs es algo como 0, 2, 4, 6... hasta 12 (ej. 6-0 6-0)
      if (diffAbs >= 10) adjustedDelta *= (isWin ? 1.25 : 1.15);
      else if (diffAbs >= 6) adjustedDelta *= (isWin ? 1.15 : 1.05);
      else if (diffAbs <= 2) adjustedDelta *= (isWin ? 0.90 : 0.85); // Apretado, suma/resta menos
  }

  // 5. Elo Friction (Cuesta mucho subir en nivel alto)
  if (myRating > 1500) {
      if (isWin) {
          // Ganan menos mientras mas arriba estan (High Elos)
          const friction = Math.max(0.3, 1 - ((myRating - 1500) / 1500));
          adjustedDelta *= friction;
      } else {
          // Pierden mas
          const gravity = Math.min(1.5, 1 + ((myRating - 1500) / 2000));
          adjustedDelta *= gravity;
      }
  }

  // Clamp ampliado individual a un rango potente para permitir subidas notables al inicio
  return Math.max(-50, Math.min(50, Math.round(adjustedDelta)));
}

/**
 * Decoupled Level Calculation
 * Max increment requested: 0.1
 */
export function calculateNewLevel(levelBefore, delta, nextPoints, levelFromRatingFn = null) {
  if (typeof levelFromRatingFn === "function" && Number.isFinite(Number(nextPoints))) {
    const targetLevel = Number(levelFromRatingFn(nextPoints) || levelBefore || 2.5);
    const currentLevel = Number(levelBefore || targetLevel || 2.5);
    const stepCap = delta >= 0 ? 0.1 : 0.08; // El usuario pidio (max 0.1) si se gana muy fuerte
    
    // Friction in level too
    const drift = targetLevel - currentLevel;
    let adjustedLevel = currentLevel + Math.max(-stepCap, Math.min(stepCap, drift));
    
    // Prevent exceeding max level logic directly
    if (adjustedLevel > 4.5) adjustedLevel = 4.5;
    if (adjustedLevel < 2) adjustedLevel = 2; // Floor en 2
    
    return Number(adjustedLevel.toFixed(2));
  }
  const levelAdjustment = Math.max(-0.06, Math.min(0.1, delta * 0.005));
  const lvl = Number((levelBefore + levelAdjustment).toFixed(2));
  return Math.max(2, Math.min(4.5, lvl));
}
