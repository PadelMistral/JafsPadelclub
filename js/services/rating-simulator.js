/**
 * rating-simulator.js - Player-specific progression simulation
 * Visualizes how a player would have evolved under the new Glicko-2 Mixed System.
 */
import { db } from "../firebase-service.js";
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  orderBy 
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { calculateGlicko2Delta, applyRankingAdjustments } from "./rating-engine.js";
import { parseMatchResult } from "../ranking-service.js";

/**
 * Simulates a single player's evolution based on their match history.
 * @param {string} playerId UID of the player
 */
export async function simulatePlayerProgression(playerId) {
  console.log(`[Rating Simulator] Simulating history for player: ${playerId}`);
  
  // 1. Fetch player base data
  const collections = ["partidosAmistosos", "partidosReto", "eventoPartidos"];
  let matchesPromises = collections.map(colName => {
    // Note: We need to filter by players array including the ID. 
    // Firestore lacks a global "array-contains" across collections without multiple queries.
    return getDocs(query(collection(db, colName), where("jugadores", "array-contains", playerId)));
  });

  // Also check for "playerUids" used in events
  let eventMatchesUids = getDocs(query(collection(db, "eventoPartidos"), where("playerUids", "array-contains", playerId)));

  const snaps = await Promise.all([...matchesPromises, eventMatchesUids]);
  
  let playerMatches = [];
  snaps.forEach(snap => {
    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (data.estado === "jugado" || data.estado === "finalizado" || data.resultado) {
        playerMatches.push({
          id: docSnap.id,
          ...data,
          timestamp: data.fecha?.seconds ? data.fecha.seconds * 1000 : new Date(data.fecha).getTime()
        });
      }
    });
  });

  // Deduplicate matches sharing the same ID
  const dedupMap = new Map();
  playerMatches.forEach(m => dedupMap.set(m.id, m));
  playerMatches = Array.from(dedupMap.values()).sort((a, b) => a.timestamp - b.timestamp);

  console.log(`[Rating Simulator] Found ${playerMatches.length} valid matches in history.`);

  // 2. Simulation State
  let currentR = 1000;
  let currentRD = 80;
  let currentVol = 0.06;
  let matchesPlayed = 0;
  
  const progression = [];

  for (const match of playerMatches) {
    try {
      const resultStr = match.resultado?.sets || (typeof match.resultado === 'string' ? match.resultado : "");
      if (!resultStr) continue;

      const parsed = parseMatchResult(resultStr);
      const players = match.jugadores || match.playerUids || [];
      const myIdx = players.indexOf(playerId);
      if (myIdx === -1) continue;

      const winnerIsA = parsed.winnerTeam === "A";
      const amITeamA = myIdx < 2;
      const didWin = (amITeamA && winnerIsA) || (!amITeamA && !winnerIsA);
      const actualScore = didWin ? 1 : 0;

      // Opponents data (for simulation we use placeholders if historical data is missing)
      // Ideally we would fetch historical snapshots, but for a localized simulator we use current estimates
      const opponents = amITeamA ? players.slice(2, 4) : players.slice(0, 2);
      const opponentData = opponents.map(uid => ({
        r: 1000, // Placeholder: in a real full simulation we'd track every player
        rd: 80
      }));

      // Calculate Glicko delta
      const glicko = calculateGlicko2Delta({ r: currentR, rd: currentRD, vol: currentVol }, opponentData, actualScore);
      const finalDelta = applyRankingAdjustments({
        delta: glicko.delta,
        matchesPlayed: matchesPlayed,
        isWin: didWin,
        myRating: currentR,
        rivalAvgRating: 1000 // Placeholder
      });

      currentR = Math.max(300, Math.min(5000, currentR + finalDelta));
      currentRD = glicko.newRD;
      matchesPlayed++;

      progression.push({
        match: matchesPlayed,
        matchId: match.id,
        rating: currentR,
        delta: finalDelta,
        rd: currentRD,
        date: new Date(match.timestamp).toLocaleDateString()
      });
    } catch (err) {
      console.warn(`[Rating Simulator] Skip match ${match.id}: ${err.message}`);
    }
  }

  return progression;
}
