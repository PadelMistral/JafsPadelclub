/**
 * rating-recalculation.js - System for global ranking re-correction
 * Resets all users and re-simulates the entire match history using the new Glicko-2 Hybrid Engine.
 */
import { db } from "../firebase-service.js";
import { 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  doc, 
  writeBatch, 
  limit 
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { calculateGlicko2Delta, applyRankingAdjustments, calculateNewLevel } from "./rating-engine.js";
import { parseMatchResult, getBaseEloByLevel } from "../ranking-service.js";

/**
 * Resets all players and re-processes every match in chronological order.
 * WARNING: This is a heavy operation.
 */
export async function recalculateAllRatings() {
  console.log("[Rating Recalculation] Starting global reset and re-process...");
  
  // 1. Fetch all users and initialize their base state
  const usersSnap = await getDocs(collection(db, "usuarios"));
  const playersMap = new Map();
  
  usersSnap.forEach(snap => {
    const data = snap.data();
    playersMap.set(snap.id, {
      id: snap.id,
      r: 1000,
      rd: 80,
      vol: 0.06,
      nivel: Number(data.nivelBaseInicial || data.nivel || 2.5),
      partidosJugados: 0,
      victorias: 0,
      rachaActual: 0,
      originalData: data
    });
  });

  // 2. Fetch all matches from all relevant collections
  const collections = ["partidosAmistosos", "partidosReto", "eventoPartidos"];
  let allMatches = [];

  for (const colName of collections) {
    const q = query(collection(db, colName), orderBy("fecha", "asc"));
    const snap = await getDocs(q);
    snap.forEach(docSnap => {
      const data = docSnap.data();
      if (data.estado === "jugado" || data.estado === "finalizado" || data.resultado) {
        allMatches.push({
          id: docSnap.id,
          col: colName,
          ...data,
          timestamp: data.fecha?.seconds ? data.fecha.seconds * 1000 : new Date(data.fecha).getTime()
        });
      }
    });
  }

  // Sort matches globally by date
  allMatches.sort((a, b) => a.timestamp - b.timestamp);
  console.log(`[Rating Recalculation] Processing ${allMatches.length} matches...`);

  // 3. Sequential Simulation
  for (const match of allMatches) {
    try {
      const resultStr = match.resultado?.sets || (typeof match.resultado === 'string' ? match.resultado : "");
      if (!resultStr) continue;

      const parsed = parseMatchResult(resultStr);
      const players = match.jugadores || match.playerUids || [];
      if (players.length !== 4) continue;

      const roster = players.map(uid => playersMap.get(uid) || { 
        id: uid, r: 1000, rd: 80, vol: 0.06, nivel: 2.5, partidosJugados: 0, isGuest: String(uid).startsWith("GUEST_") 
      });

      const winnerIsA = parsed.winnerTeam === "A";

      // Calculate deltas for each player
      const teamA = roster.slice(0, 2);
      const teamB = roster.slice(2, 4);
      const teamARating = (teamA[0].r + teamA[1].r) / 2;
      const teamBRating = (teamB[0].r + teamB[1].r) / 2;

      const results = [];

      for (let i = 0; i < 4; i++) {
        const p = roster[i];
        if (!p || p.isGuest) continue;

        const amITeamA = i < 2;
        const didWin = (amITeamA && winnerIsA) || (!amITeamA && !winnerIsA);
        const actualScore = didWin ? 1 : 0;
        
        const opponents = amITeamA ? teamB : teamA;
        const opponentData = opponents.map(opp => ({ r: opp.r, rd: opp.rd }));
        
        const myRating = p.r;
        const rivalAvgRating = opponentData.reduce((acc, o) => acc + o.r, 0) / opponentData.length;

        const glicko = calculateGlicko2Delta({ r: p.r, rd: p.rd, vol: p.vol }, opponentData, actualScore);
        const finalDelta = applyRankingAdjustments({
          delta: glicko.delta,
          matchesPlayed: p.partidosJugados,
          isWin: didWin,
          myRating: myRating,
          rivalAvgRating: rivalAvgRating
        });

        // Update in-memory state
        p.r = Math.max(300, Math.min(5000, p.r + finalDelta));
        p.rd = glicko.newRD;
        p.nivel = calculateNewLevel(p.nivel, finalDelta);
        p.partidosJugados += 1;
        if (didWin) {
          p.victorias += 1;
          p.rachaActual = (p.rachaActual > 0) ? p.rachaActual + 1 : 1;
        } else {
          p.rachaActual = (p.rachaActual < 0) ? p.rachaActual - 1 : -1;
        }
      }
    } catch (err) {
      console.warn(`[Rating Recalculation] Error in match ${match.id}:`, err.message);
    }
  }

  // 4. Batch Updates to Firestore
  console.log("[Rating Recalculation] Simulation complete. Updating database...");
  const batch = writeBatch(db);
  let count = 0;

  for (const [uid, p] of playersMap) {
    if (String(uid).startsWith("GUEST_")) continue;
    const ref = doc(db, "usuarios", uid);
    batch.update(ref, {
      puntosRanking: p.r,
      rating: p.r,
      nivel: p.nivel,
      glickoRD: p.rd,
      glickoVol: p.vol,
      partidosJugados: p.partidosJugados,
      victorias: p.victorias,
      rachaActual: p.rachaActual
    });
    count++;
    
    // Firestore batches have a limit of 500
    if (count % 450 === 0) {
      await batch.commit();
      console.log(`[Rating Recalculation] Committed ${count} users...`);
    }
  }

  await batch.commit();
  console.log("[Rating Recalculation] DONE. Total users updated:", count);
  return { success: true, totalProcessed: count };
}
