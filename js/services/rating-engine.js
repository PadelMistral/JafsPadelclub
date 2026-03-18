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

/**
 * Apply custom adjustments required by the project specifications.
 * @param {Object} params { delta, matchesPlayed, isWin, myRating, rivalAvgRating }
 */
export function applyRankingAdjustments({ delta, matchesPlayed, isWin, myRating, rivalAvgRating }) {
  let adjustedDelta = delta;

  // 1. If lose -> multiply delta by 0.7 (buffered losses)
  if (!isWin && adjustedDelta < 0) {
    adjustedDelta *= 0.7;
  }

  // 2. If <10 matches -> reduce gains (anti-smurf)
  if (isWin && matchesPlayed < 10) {
    adjustedDelta *= 0.6; // Reduced climbing speed for fresh accounts
  }

  // 3. Difficulty scaling (inspired by Playtomic)
  const ratingGap = myRating - rivalAvgRating;

  // If wins against much worse (Gap > 150) -> reduce delta
  if (isWin && ratingGap > 150) {
    const gapFactor = Math.max(0.4, 1 - (ratingGap - 150) / 400);
    adjustedDelta *= gapFactor;
  }

  // If wins being underdog (Gap < -150) -> increase delta
  if (isWin && ratingGap < -150) {
    const gapFactor = Math.min(2.0, 1 + (Math.abs(ratingGap) - 150) / 300);
    adjustedDelta *= gapFactor;
  }

  // Final Clamp [-15, +15] as per critical rules
  return Math.max(-15, Math.min(15, adjustedDelta));
}

/**
 * Decoupled Level Calculation
 * levelAfter = levelBefore + clamp(delta * 0.004, -0.03, 0.05)
 */
export function calculateNewLevel(levelBefore, delta) {
  const levelAdjustment = Math.max(-0.03, Math.min(0.05, delta * 0.004));
  return Number((levelBefore + levelAdjustment).toFixed(2));
}
