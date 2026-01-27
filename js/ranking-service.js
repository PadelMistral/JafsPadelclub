/* js/ranking-service.js - Premium ELO & Gamification Engine v5.0 */
import { updateDocument, getDocument, db } from './firebase-service.js';
import { collection, getDocs, addDoc, serverTimestamp, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { showToast } from './ui-core.js';

/**
 * Predicts ELO impact with Dynamic K-Factor and Streak Multipliers
 */
export function predictEloImpact({ myLevel, myPoints = 1000, partnerLevel, rival1Level, rival2Level, streak = 0, matchesPlayed = 0, setsDifference = 0 }) {
    const myTeamAvg = (myLevel + partnerLevel) / 2;
    const rivalTeamAvg = (rival1Level + rival2Level) / 2;
    
    // Dynamic K-Factor logic from Mistral
    let K = 32;
    if (matchesPlayed < 30) K = 40; // New player bonus
    if (myPoints >= 2400) K = 16;  // Pro stability
    
    // Streak Bonus
    let streakMultiplier = 1.0;
    if (streak >= 3) streakMultiplier = 1.2;
    if (streak >= 5) streakMultiplier = 1.5;
    if (streak >= 10) streakMultiplier = 2.0;

    // Margin of Victory Multiplier (Sets)
    let marginMultiplier = 1.0;
    if (setsDifference) {
        marginMultiplier = Math.log(Math.abs(setsDifference) + 1) + 0.5;
    }
    
    const levelToRating = (lvl) => 1000 + (lvl - 2.5) * 200;
    const myRating = levelToRating(myTeamAvg);
    const rivalRating = levelToRating(rivalTeamAvg);
    
    const expectedScore = 1 / (1 + Math.pow(10, (rivalRating - myRating) / 400));
    
    let winPoints = Math.round(K * (1 - expectedScore) * streakMultiplier * marginMultiplier);
    let lossPoints = Math.round(K * (0 - expectedScore));
    
    return {
        win: winPoints,
        loss: lossPoints,
        expectedWinrate: Math.round(expectedScore * 100),
        multiplier: streakMultiplier,
        kFactor: K
    };
}

/**
 * Processes match results and updates all players
 */
export async function processMatchResults(matchId, col, resultStr) {
    try {
        const match = await getDocument(col, matchId);
        if (!match || match.jugadores.length !== 4) return;
        
        const sets = resultStr.trim().split(/\s+/);
        let t1Sets = 0, t2Sets = 0;
        sets.forEach(s => {
            const [g1, g2] = s.split('-').map(Number);
            if (g1 > g2) t1Sets++; else if (g2 > g1) t2Sets++;
        });
        
        const t1Wins = t1Sets > t2Sets;
        const isComp = col === 'partidosReto';

        const rawPlayers = await Promise.all(match.jugadores.map(async id => {
            if (id.startsWith('GUEST')) {
                const parts = id.split('_');
                return { id, nivel: parseFloat(parts[2]) || 2.5, isGuest: true };
            }
            const d = await getDocument('usuarios', id);
            return d ? { ...d, id } : null;
        }));

        const team1 = [rawPlayers[0], rawPlayers[1]].filter(p => p);
        const team2 = [rawPlayers[2], rawPlayers[3]].filter(p => p);
        const t1Avg = (team1[0].nivel + team1[1].nivel) / 2;
        const t2Avg = (team2[0].nivel + team2[1].nivel) / 2;

        // Process each player
        for (let i = 0; i < 4; i++) {
            const p = rawPlayers[i];
            if (!p || p.isGuest) continue;

            const amIteam1 = i < 2;
            const didIWin = (amIteam1 && t1Wins) || (!amIteam1 && !t1Wins);
            const oppAvg = amIteam1 ? t2Avg : t1Avg;
            const diffSets = Math.abs(t1Sets - t2Sets);
            
            // Calculate Points
            const elo = predictEloImpact({
                myLevel: p.nivel, 
                myPoints: p.puntosRanking || 1000,
                partnerLevel: p.nivel, 
                rival1Level: oppAvg, 
                rival2Level: oppAvg,
                streak: p.rachaActual || 0,
                matchesPlayed: p.partidosJugados || 0,
                setsDifference: didIWin ? diffSets : 0
            });

            const delta = didIWin ? elo.win : elo.loss;
            const finalDelta = isComp ? Math.round(delta * 1.5) : delta;
            
            const newPts = Math.max(0, (p.puntosRanking || 1000) + finalDelta);
            const levelChange = calculateLevelChange(p.nivel, oppAvg, didIWin);
            const newLevel = Math.max(1, Math.min(7, (p.nivel || 2.5) + levelChange));
            
            const newWins = (p.victorias || 0) + (didIWin ? 1 : 0);
            const newStreak = didIWin ? (p.rachaActual > 0 ? p.rachaActual + 1 : 1) : (p.rachaActual < 0 ? p.rachaActual - 1 : -1);

            // Update User
            await updateDocument('usuarios', p.id, {
                puntosRanking: newPts,
                nivel: parseFloat(newLevel.toFixed(2)),
                victorias: newWins,
                partidosJugados: (p.partidosJugados || 0) + 1,
                rachaActual: newStreak,
                xp: (p.xp || 0) + (didIWin ? 50 : 10)
            });

            // Log entry
            await addDoc(collection(db, "rankingLogs"), {
                uid: p.id, matchId, diff: finalDelta, 
                newTotal: newPts, timestamp: serverTimestamp()
            });
            
            // Achievement Check (Simple)
            if (newWins === 1) showToast("Logro Desbloqueado", "Tu primera victoria 🏆", "success");
            if (newStreak === 3) showToast("¡En Racha!", "3 Victorias seguidas 🔥", "warning");
        }

        return true;
    } catch(e) {
        console.error(e);
        return false;
    }
}

function calculateLevelChange(myLvl, oppAvg, won) {
    const diff = oppAvg - myLvl;
    let base = 0.02;
    if (won && diff > 0) base += (diff * 0.02); // Gain more vs better players
    if (!won && diff < 0) base += (Math.abs(diff) * 0.02); // Lose more vs worse players
    return won ? base : -base;
}
