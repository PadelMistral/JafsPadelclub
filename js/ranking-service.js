/* js/ranking-service.js - Premium ELO & Gamification Engine v6.0 */
import { updateDocument, getDocument, db } from './firebase-service.js';
import { collection, getDocs, addDoc, serverTimestamp, query, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { showToast } from './ui-core.js';

/**
 * Predicts ELO impact with Dynamic K-Factor and Streak Multipliers
 */
export function predictEloImpact({ myLevel, myPoints = 1000, partnerLevel, rival1Level, rival2Level, streak = 0, matchesPlayed = 0, setsDifference = 0, gameDiff = 0 }) {
    const myTeamAvg = (myLevel + partnerLevel) / 2;
    const rivalTeamAvg = (rival1Level + rival2Level) / 2;
    
    // 1. DYNAMIC K-FACTOR
    let K = 32;
    if (myLevel < 2.5) K = 45; 
    if (myLevel >= 5.0) K = 20; 
    if (matchesPlayed < 15) K = 60; 

    // 2. LEVEL DISCREPANCY RECOVERY
    const suggestedPoints = 1000 + (myLevel - 2.5) * 400;
    let discrepancyBoost = 1.0;
    if (myPoints < suggestedPoints - 100) discrepancyBoost = 1.25; 
    if (myPoints > suggestedPoints + 200) discrepancyBoost = 0.9;

    // 3. PERFORMANCE MULTIPLIER (Sets + Games Dominance)
    let performanceMultiplier = 1.0;
    if (setsDifference === 2) performanceMultiplier = 1.3; 
    
    // Dominance Bonus (Games)
    if (gameDiff >= 8) performanceMultiplier += 0.2; // Total Domination (e.g. 6-1 6-2)
    if (gameDiff >= 12) performanceMultiplier += 0.4; // The Golden Bagel (6-0 6-0)
    
    // 4. AGGRESSIVE STREAK SYSTEM
    let streakMultiplier = 1.0;
    if (streak >= 2) streakMultiplier = 1.15;
    if (streak >= 4) streakMultiplier = 1.4;
    if (streak >= 7) streakMultiplier = 1.8;
    if (streak >= 10) streakMultiplier = 2.2; // Godlike status

    // 5. THE UNDERDOG / VANQUISHER FACTOR (Team based)
    const levelDiff = rivalTeamAvg - myTeamAvg;
    let gapMultiplier = 1.0;
    if (levelDiff > 0.3) {
        gapMultiplier = 1.1 + (levelDiff * 0.5); // Giant Slayer bonus
    } else if (levelDiff < -0.3) {
        gapMultiplier = 0.75 - (Math.abs(levelDiff) * 0.2); // Expected victory penalty
        gapMultiplier = Math.max(0.4, gapMultiplier);
    }

    // 6. ELO FORMULA (Core)
    const levelToRating = (lvl) => 1000 + (lvl - 2.0) * 200;
    const myRating = levelToRating(myTeamAvg);
    const rivalRating = levelToRating(rivalTeamAvg);
    const expectedScore = 1 / (1 + Math.pow(10, (rivalRating - myRating) / 400));
    
    // FINAL GAIN/LOSS (Individualized)
    let winPoints = Math.round(K * (1 - expectedScore) * streakMultiplier * performanceMultiplier * gapMultiplier * discrepancyBoost);
    
    // Loss logic (Forgiveness if rivals are monsters)
    let lossBase = Math.round(K * (0 - expectedScore));
    if (levelDiff > 0.6) lossBase = Math.round(lossBase * 0.65); // High-level loss forgiveness
    if (discrepancyBoost > 1) lossBase = Math.round(lossBase * 0.8); // Points recovery protection
    
    return {
        win: Math.max(5, winPoints), // Minimum 5pts for any win
        loss: Math.min(-2, lossBase), // Minimum -2pts for any loss
        expectedWinrate: Math.round(expectedScore * 100),
        personalBoost: discrepancyBoost,
        streakBonus: streakMultiplier,
        fieldGap: gapMultiplier
    };
}

/**
 * Calculates initial ELO based on tennis level (1.0 - 7.0)
 * Level 2.5 -> 1000 pts (Base)
 * +1 Level -> +400 pts (increased to make it harder to jump tiers)
 */
export function getBaseEloByLevel(level) {
    const l = parseFloat(level) || 2.5;
    // We use a steeper climb so a 2.5 is far from a 3.7
    return Math.round(1000 + (l - 2.5) * 400); 
}

/**
 * Processes match results and updates all players
 */
export async function processMatchResults(matchId, col, resultStr) {
    try {
        const match = await getDocument(col, matchId);
        if (!match || !match.jugadores || match.jugadores.length !== 4) return { success: false, error: "Match or players invalid" };
        
        const sets = resultStr.trim().split(/\s+/);
        let t1Sets = 0, t2Sets = 0;
        sets.forEach(s => {
            if (!s.includes('-')) return;
            const [g1, g2] = s.split('-').map(Number);
            if (g1 > g2) t1Sets++; else if (g2 > g1) t2Sets++;
        });
        
        const t1Wins = t1Sets > t2Sets;
        const isComp = col === 'partidosReto' || match.tipo === 'reto';

        const rawPlayers = await Promise.all(match.jugadores.map(async id => {
            if (!id) return null;
            if (id.startsWith('GUEST_')) {
                const parts = id.split('_');
                const name = parts[1];
                const lvl = parseFloat(parts[2]) || 2.5;
                return { id, nombre: name, nivel: lvl, isGuest: true };
            }
            const d = await getDocument('usuarios', id);
            return d ? { ...d, id } : null;
        }));

        const team1 = rawPlayers.slice(0, 2).filter(p => p);
        const team2 = rawPlayers.slice(2, 4).filter(p => p);
        
        if (team1.length < 2 || team2.length < 2) return { success: false, error: "Teams incomplete" };

        const t1Avg = (team1.reduce((sum, p) => sum + (p.nivel || 2.5), 0)) / 2;
        const t2Avg = (team2.reduce((sum, p) => sum + (p.nivel || 2.5), 0)) / 2;

        const changes = [];

        // Process each player
        for (let i = 0; i < 4; i++) {
            const p = rawPlayers[i];
            if (!p || p.isGuest) {
                changes.push({ id: p ? p.id : null, isGuest: true });
                continue;
            }

            const amIteam1 = i < 2;
            const partnerIdx = amIteam1 ? (i === 0 ? 1 : 0) : (i === 2 ? 3 : 2);
            const partner = rawPlayers[partnerIdx];
            
            const didIWin = (amIteam1 && t1Wins) || (!amIteam1 && !t1Wins);
            const oppAvg = amIteam1 ? t2Avg : t1Avg;
            const diffSets = Math.abs(t1Sets - t2Sets);
            
            // Calculate Game-level performance
            let myGames = 0, oppGames = 0;
            sets.forEach(s => {
                const parts = s.split('-').map(Number);
                if (parts.length === 2) {
                    if (amIteam1) { myGames += parts[0]; oppGames += parts[1]; }
                    else { myGames += parts[1]; oppGames += parts[0]; }
                }
            });
            const gameDiff = myGames - oppGames;

            // Initialization Logic for Points if missing
            let currentPoints = p.puntosRanking;
            if (currentPoints === undefined || currentPoints === null) {
                currentPoints = Math.round(1000 + ((p.nivel || 2.5) - 2.5) * 400);
            }

            // Calculate Impact
            const elo = predictEloImpact({
                myLevel: p.nivel || 2.5, 
                myPoints: currentPoints,
                partnerLevel: partner ? (partner.nivel || 2.5) : (p.nivel || 2.5), 
                rival1Level: oppAvg, 
                rival2Level: oppAvg,
                streak: p.rachaActual || 0,
                matchesPlayed: p.partidosJugados || 0,
                setsDifference: didIWin ? diffSets : 0,
                gameDiff: gameDiff
            });

            let delta = didIWin ? elo.win : elo.loss;
            
            // Mode Multipliers
            if (!isComp) delta = Math.round(delta * 0.4); // Amistosos count but less
            else delta = Math.round(delta * 1.0); 

            const newPts = Math.max(0, currentPoints + delta);
            const levelChange = calculateLevelChange(p.nivel || 2.5, oppAvg, didIWin);
            const oldLevel = parseFloat((p.nivel || 2.5).toFixed(2));
            const newLevel = Math.max(1, Math.min(7, (p.nivel || 2.5) + levelChange));
            const newLevelFixed = parseFloat(newLevel.toFixed(2));
            
            console.log(`[ELO] Puntos: ${currentPoints} -> ${newPts} (${delta > 0 ? '+' : ''}${delta}) para ${p.nombreUsuario || p.nombre}`);
            console.log(`[LEVEL] Nivel: ${oldLevel} -> ${newLevelFixed} (${levelChange > 0 ? '+' : ''}${levelChange.toFixed(3)})`);

            // Check for level bracket change (e.g. 2.9 -> 3.0 or 3.1 -> 3.0)
            const oldBracket = Math.floor(oldLevel * 2) / 2;
            const newBracket = Math.floor(newLevelFixed * 2) / 2;
            
            if (newBracket > oldBracket) {
                const { sendNotification } = await import('./services/notifications.js');
                sendNotification(p.id, {
                    title: "¡SUBIDA DE NIVEL! 🚀",
                    body: `¡Felicidades! Has ascendido al nivel ${newLevelFixed}. Sigue así.`,
                    icon: "fas fa-arrow-up",
                    type: "success"
                });
            } else if (newBracket < oldBracket) {
                const { sendNotification } = await import('./services/notifications.js');
                sendNotification(p.id, {
                    title: "NIVEL AJUSTADO 📉",
                    body: `Tu nivel ha bajado a ${newLevelFixed}. ¡A entrenar para recuperar el ritmo!`,
                    icon: "fas fa-arrow-down",
                    type: "warning"
                });
            }

            const newWins = (p.victorias || 0) + (didIWin ? 1 : 0);
            const newStreak = didIWin ? (p.rachaActual > 0 ? p.rachaActual + 1 : 1) : (p.rachaActual < 0 ? p.rachaActual - 1 : -1);

            const analysis = {
                won: didIWin,
                pointsDiff: delta,
                opponentAvg: parseFloat(oppAvg.toFixed(2)),
                partnerName: partner ? (partner.nombreUsuario || partner.nombre || "Invitado") : "Solo",
                streak: p.rachaActual || 0,
                prediction: elo.expectedWinrate,
                gapMultiplier: elo.gapMultiplier,
                streakMultiplier: elo.multiplier,
                timestamp: new Date().toISOString()
            };

            // Update User
            await updateDocument('usuarios', p.id, {
                puntosRanking: newPts,
                nivel: newLevelFixed,
                victorias: newWins,
                partidosJugados: (p.partidosJugados || 0) + 1,
                rachaActual: newStreak,
                xp: (p.xp || 0) + (didIWin ? 50 : 10),
                lastMatchAnalysis: analysis
            });

            // Log entry with full details for history display
            await addDoc(collection(db, "rankingLogs"), {
                uid: p.id, 
                matchId, 
                diff: delta, 
                newTotal: newPts, 
                details: analysis,
                timestamp: serverTimestamp()
            });
            
            changes.push({
                uid: p.id,
                won: didIWin,
                delta: delta,
                newPts: newPts,
                analysis
            });
            
            // Achievement Check
            if (newWins === 1) showToast("Logro Desbloqueado", "Tu primera victoria 🏆", "success");
            if (newStreak === 3) showToast("¡En Racha!", "3 Victorias seguidas 🔥", "warning");
        }

        return { success: true, changes };
    } catch(e) {
        console.error("Match Processing Error:", e);
        return { success: false, error: e.message };
    }
}

function calculateLevelChange(myLvl, oppAvg, won) {
    const diff = oppAvg - myLvl;
    let base = 0.03; // Base movement
    
    if (won) {
        if (diff > 0) base += (diff * 0.08); // Boost for beating better players
        else base += (diff * 0.01); // Minimal gain for beating worse players
    } else {
        if (diff < 0) base += (Math.abs(diff) * 0.08); // Drop for losing to worse players
        else base -= (diff * 0.02); // Small drop for losing to better players
    }
    
    // Cap changes to avoid level jumping too fast
    const change = won ? Math.min(base, 0.15) : Math.max(-base, -0.15);
    return change;
}

