import { getDocument, db, auth } from './firebase-service.js';
import { serverTimestamp, doc, runTransaction } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { getDynamicKFactor } from './modules/stats-evolution.js';

/**
 * Predicts ELO impact with Dynamic K-Factor and Streak Multipliers
 */
export function predictEloImpact({ 
    myLevel, 
    myPoints = 1000, 
    partnerLevel, 
    rival1Level, 
    rival2Level, 
    streak = 0, 
    matchesPlayed = 0, 
    setsDifference = 0, 
    gameDiff = 0,
    dynamicK = null, // New Parameter
    extraParams = {} 
}) {
    const myTeamAvg = (myLevel + (partnerLevel || myLevel)) / 2;
    const rivalTeamAvg = (rival1Level + rival2Level) / 2;
    
    // 1. DYNAMIC K-FACTOR (ELITE TUNING)
    // Use provided dynamic K if available, otherwise fall back to basic logic
    let K = dynamicK || 32;
    if (!dynamicK) {
        if (myLevel < 3.0) K = 40; 
        if (myLevel >= 4.5) K = 20; 
        if (matchesPlayed < 10) K = 64; 
    } 

    // 2. DISCREPANCY & RECOVERY (Rubber-banding)
    const suggestedPoints = 1000 + (myLevel - 2.5) * 400;
    let discrepancyBoost = 1.0;
    if (myPoints < suggestedPoints - 150) discrepancyBoost = 1.35; 
    if (myPoints > suggestedPoints + 300) discrepancyBoost = 0.85;

    // 3. PERFORMANCE DOMINANCE (SETS + GAMES)
    const isComp = !!extraParams.isComp;
    const isCloseMatch = !!extraParams.isCloseMatch;
    const didWin = !!extraParams.didWin;
    const absGameDiff = Math.abs(gameDiff || 0);

    let perfBonus = 1.0;
    if (setsDifference === 2) perfBonus *= 1.18; 

    let dominanceMult = 1.0;
    if (absGameDiff >= 6) dominanceMult = 1.08;
    if (absGameDiff >= 10) dominanceMult = 1.18;
    if (absGameDiff >= 12) dominanceMult = 1.28;

    let clutchMult = 1.0;
    if (isCloseMatch) clutchMult = didWin ? 1.12 : 0.96;

    let compMult = isComp ? 1.08 : 1.0;

    // 4. THE COMEBACK FACTOR (Mental Strength)
    let mentalBonus = 1.0;
    if (extraParams.isComeback) mentalBonus = 1.25;

    // 5. STREAK MULTIPLIERS (DYNAMO CORE)
    let streakMult = 1.0;
    if (streak >= 3) streakMult = 1.25;
    if (streak >= 6) streakMult = 1.6;
    if (streak >= 10) streakMult = 2.5;

    // 6. VANQUISHER FACTOR (Underdog logic)
    const levelDiff = rivalTeamAvg - myTeamAvg;
    let gapMult = 1.0;
    if (levelDiff > 0.25) gapMult = 1.2 + (levelDiff * 0.8); 
    else if (levelDiff < -0.25) gapMult = Math.max(0.3, 0.7 - (Math.abs(levelDiff) * 0.5));

    // 7. WEATHER & SURFACE HARDSHIP (Condition Multiplier)
    let conditionBonus = 0;
    if (extraParams.weatherCondition === 'extreme') conditionBonus += 4; 
    if (extraParams.surface === 'outdoor' && extraParams.weatherCondition === 'windy') conditionBonus += 2;

    // 8. INACTIVITY PENALTY (RUST FACTOR)
    // If daysSinceLastMatch > 21, we assume "rust". 
    // This increases volatility (higher K) but might penalize the gain slightly to represent "re-proving" rank.
    let inactivityMult = 1.0;
    if (extraParams.daysSinceLastMatch > 21) {
        K *= 1.5; // High volatility/uncertainty
        inactivityMult = 0.9; // Slightly harder to gain raw points immediately
    }

    // 9. EMOTIONAL INDEX (From Bio-Metrics if available)
    // If player was "Frustrated" or "Tired", performance is expected to be lower.
    // If they WON despite this, they get a "Resilience Bonus".
    let emotionalBonus = 1.0;
    if (['Frustrated', 'Tired'].includes(extraParams.mood) && extraParams.didWin) {
        emotionalBonus = 1.15; // Resilience
    }

    // 10. ADVANCED PROFILE VARIABLES (Competitive Personalization)
    const consistency = Math.max(0, Math.min(100, Number(extraParams.consistency ?? 50)));
    const pressure = Math.max(0, Math.min(100, Number(extraParams.pressure ?? 50)));
    const aggression = Math.max(0, Math.min(100, Number(extraParams.aggression ?? 50)));
    const winnersAvg = Math.max(0, Number(extraParams.winnersAvg ?? 0));
    const ueAvg = Math.max(0, Number(extraParams.ueAvg ?? 0));
    const teamChemistry = Math.max(0.2, Math.min(1, Number(extraParams.teamChemistry ?? 0.5)));
    const rivalPointsAvg = Number(extraParams.rivalPointsAvg ?? myPoints);
    const partnerPoints = Number(extraParams.partnerPoints ?? myPoints);

    const consistencyMult = 0.9 + (consistency / 100) * 0.2;
    const pressureMult = 0.92 + (pressure / 100) * 0.16;
    const chemistryMult = 0.95 + (teamChemistry * 0.12);

    const shotVolume = winnersAvg + ueAvg;
    const disciplineRatio = shotVolume > 0 ? (winnersAvg - ueAvg) / shotVolume : 0;
    const disciplineMult = Math.max(0.9, Math.min(1.1, 1 + disciplineRatio * 0.1));

    const rivalStrengthGap = (rivalPointsAvg - myPoints) / 600;
    const rivalStrengthMult = Math.max(0.9, Math.min(1.12, 1 + rivalStrengthGap * 0.09));

    const partnerGap = (partnerPoints - myPoints) / 800;
    const partnerSyncMult = Math.max(0.92, Math.min(1.1, 1 + partnerGap * 0.06));

    let fatigueMult = 1.0;
    if (extraParams.daysSinceLastMatch <= 1) fatigueMult = 0.95;
    else if (extraParams.daysSinceLastMatch <= 3) fatigueMult = 0.98;
    else if (extraParams.daysSinceLastMatch >= 10) fatigueMult = 1.03;

    let aggressionMult = 1.0;
    if (didWin) aggressionMult = 0.96 + (aggression / 100) * 0.12;
    else aggressionMult = 1.02 + (aggression / 100) * 0.06;

    // Core Elo Formula
    const levelToRating = (lvl) => 1000 + (lvl - 2.5) * 400;
    const myR = levelToRating(myTeamAvg);
    const rivalR = levelToRating(rivalTeamAvg);
    const expectedScore = 1 / (1 + Math.pow(10, (rivalR - myR) / 400));
    
    // Final Calculation
    let gain = Math.round(
        (K * (1 - expectedScore) * streakMult * perfBonus * gapMult * mentalBonus * discrepancyBoost * dominanceMult * clutchMult * compMult * inactivityMult * emotionalBonus * consistencyMult * pressureMult * disciplineMult * chemistryMult * rivalStrengthMult * partnerSyncMult * fatigueMult * aggressionMult) + conditionBonus
    );
    
    // Loss logic (Forgiveness for underdogs)
    let lossMult = 1.0;
    if (absGameDiff >= 6) lossMult = 1.1;
    if (absGameDiff >= 10) lossMult = 1.25;
    if (isCloseMatch) lossMult = Math.max(0.85, lossMult - 0.15);
    const stabilityShield = Math.max(0.86, Math.min(1.15, (consistencyMult + pressureMult + disciplineMult) / 3));
    let loss = Math.round(K * (0 - expectedScore) * lossMult * aggressionMult / stabilityShield);
    if (levelDiff > 0.5) loss = Math.round(loss * 0.6); // Underdog protection
    if (discrepancyBoost > 1) loss = Math.round(loss * 0.75); // Recovery protection

    return {
        win: Math.max(6, gain),
        loss: Math.min(-3, loss),
        expectedWinrate: Math.round(expectedScore * 100),
        math: {
            K: K,
            expected: parseFloat(expectedScore.toFixed(3)),
            streak: streakMult,
            performance: perfBonus,
            underdog: gapMult,
            dominance: dominanceMult,
            clutch: clutchMult,
            recovery: discrepancyBoost,
            mental: mentalBonus,
            inactivity: inactivityMult,
            emotional: emotionalBonus,
            consistency: Number(consistencyMult.toFixed(3)),
            pressure: Number(pressureMult.toFixed(3)),
            discipline: Number(disciplineMult.toFixed(3)),
            chemistry: Number(chemistryMult.toFixed(3)),
            rivalStrength: Number(rivalStrengthMult.toFixed(3)),
            partnerSync: Number(partnerSyncMult.toFixed(3)),
            fatigue: Number(fatigueMult.toFixed(3)),
            aggression: Number(aggressionMult.toFixed(3)),
            conditionBonus: conditionBonus
        },
        breakdown: {
            base: K,
            streak: streakMult,
            performance: perfBonus,
            dominance: dominanceMult,
            clutch: clutchMult,
            competitive: compMult,
            underdog: gapMult,
            mental: mentalBonus,
            recovery: discrepancyBoost,
            conditions: conditionBonus,
            inactivity: inactivityMult,
            resilience: emotionalBonus,
            consistency: Number(consistencyMult.toFixed(3)),
            pressure: Number(pressureMult.toFixed(3)),
            discipline: Number(disciplineMult.toFixed(3)),
            chemistry: Number(chemistryMult.toFixed(3)),
            rivalStrength: Number(rivalStrengthMult.toFixed(3)),
            partnerSync: Number(partnerSyncMult.toFixed(3)),
            fatigue: Number(fatigueMult.toFixed(3)),
            aggression: Number(aggressionMult.toFixed(3))
        }
    };
}

/**
 * Calculates initial ELO based on tennis level (1.0 - 7.0)
 */
export function getBaseEloByLevel(level) {
    const l = parseFloat(level) || 2.5;
    return Math.round(1000 + (l - 2.5) * 400); 
}

function applyFairCompetitionGuard({ delta, didIWin, myLevel, oppAvg, isComp, expectedWinrate }) {
    let adjusted = Number(delta || 0);
    const levelGap = Number((myLevel - oppAvg).toFixed(2));
    const expected = Number(expectedWinrate || 50);
    let rule = "none";

    if (didIWin) {
        // If you were a heavy favorite, wins should not over-reward farming.
        if (levelGap >= 0.8) {
            adjusted = Math.min(adjusted, isComp ? 8 : 6);
            rule = "favorite_cap";
        } else if (expected >= 75) {
            adjusted = Math.min(adjusted, isComp ? 10 : 8);
            rule = "high_expected_cap";
        }

        // If you beat a clearly stronger team, ensure meaningful upside.
        if (levelGap <= -0.6) {
            adjusted = Math.max(adjusted, isComp ? 14 : 10);
            rule = "upset_floor";
        }

        adjusted = Math.min(adjusted, isComp ? 32 : 24);
    } else {
        // Underdog protection on expected losses.
        if (levelGap <= -0.8) {
            adjusted = Math.max(adjusted, isComp ? -6 : -5);
            rule = "underdog_shield";
        }

        // Penalize big favorites more if they lose.
        if (levelGap >= 0.8 || expected >= 75) {
            adjusted = Math.min(adjusted, isComp ? -16 : -14);
            rule = "favorite_loss_penalty";
        }

        adjusted = Math.max(adjusted, isComp ? -24 : -20);
    }

    return {
        delta: Math.round(adjusted),
        rule,
        levelGap,
        expectedWinrate: expected,
    };
}

/**
 * Processes match results and updates all players with Advanced ELO Logic
 */
export async function processMatchResults(matchId, col, resultStr, extraMatchData = {}) {
    try {
        // Initial Read (for validation)
        const matchInitial = await getDocument(col, matchId);
        if (!matchInitial || !matchInitial.jugadores || matchInitial.jugadores.filter(id => id).length !== 4) return { success: false, error: "Match or players invalid" };
        
        return await runTransaction(db, async (transaction) => {
            // Re-read match inside transaction for consistency
            const matchRef = doc(db, col, matchId);
            const matchDoc = await transaction.get(matchRef);
            if (!matchDoc.exists()) throw "Match does not exist!";
            const match = matchDoc.data();

            // Avoid duplicate processing when the same result is retried.
            if (match.rankingProcessedResult === resultStr && match.rankingProcessedAt) {
                return { success: true, skipped: true, changes: [] };
            }

            const sets = resultStr.trim().split(/\s+/).filter(Boolean);
            if (sets.length < 2) throw "El resultado debe tener al menos 2 sets (Ej: 6-4 6-3)";

            let t1Sets = 0, t2Sets = 0;
            sets.forEach(s => {
                if (!s.includes('-')) return;
                const parts = s.split('-');
                const g1 = parseInt(parts[0]);
                const g2 = parseInt(parts[1]);
                if (isNaN(g1) || isNaN(g2)) return;

                if (g1 > g2) t1Sets++; 
                else if (g2 > g1) t2Sets++;
            });
            
            if (t1Sets === 0 && t2Sets === 0) throw "Formato de resultado invÃ¡lido (Ej: 6-4 6-3)";
            
            const t1Wins = t1Sets > t2Sets;
            const isComp = col === 'partidosReto' || match.tipo === 'reto';

            // Fetch detailed player data INSIDE transaction
            const rawPlayers = [];
            for (const id of match.jugadores) {
                if (!id) { rawPlayers.push(null); continue; }
                if (id.startsWith('GUEST_')) {
                    const parts = id.split('_');
                    rawPlayers.push({ id, nombre: parts[1], nivel: parseFloat(parts[2]) || 2.5, isGuest: true });
                } else {
                    const pDoc = await transaction.get(doc(db, 'usuarios', id));
                    rawPlayers.push(pDoc.exists() ? { ...pDoc.data(), id } : null);
                }
            }

            const team1 = rawPlayers.slice(0, 2).filter(p => p);
            const team2 = rawPlayers.slice(2, 4).filter(p => p);
            
            if (team1.length < 2 || team2.length < 2) throw "Teams incomplete";

            const t1Avg = (team1.reduce((sum, p) => sum + (p.nivel || 2.5), 0)) / 2;
            const t2Avg = (team2.reduce((sum, p) => sum + (p.nivel || 2.5), 0)) / 2;

            const changes = [];
            const pointAllocations = [];
            const pointDetails = estimatePointDetailsFromSets(resultStr);
            const teamPointCount = pointDetails.totalPoints || 1;
            const surface = extraMatchData.surface || match.surface || 'indoor';

            // Process each player
            for (let i = 0; i < 4; i++) {
                const p = rawPlayers[i];
                if (!p || p.isGuest) {
                    changes.push({ uid: p ? p.id : null, isGuest: true });
                    continue;
                }

                const amIteam1 = i < 2;
                const partnerIdx = amIteam1 ? (i === 0 ? 1 : 0) : (i === 2 ? 3 : 2);
                const partner = rawPlayers[partnerIdx];
                const opponentPlayers = (amIteam1 ? rawPlayers.slice(2, 4) : rawPlayers.slice(0, 2)).filter(op => op);
                const didIWin = (amIteam1 && t1Wins) || (!amIteam1 && !t1Wins);
                const oppAvg = amIteam1 ? t2Avg : t1Avg;
                const diffSets = Math.abs(t1Sets - t2Sets);
                const setsCount = sets.length;
                const isCloseMatch = setsCount === 3 && diffSets === 1;

                // Estimate opponent points even if they are guests
                const oppPointsAvg = opponentPlayers.length
                    ? opponentPlayers.reduce((sum, op) => {
                        const pts = op.isGuest ? getBaseEloByLevel(op.nivel) : Number(op.puntosRanking || getBaseEloByLevel(op.nivel));
                        return sum + pts;
                    }, 0) / opponentPlayers.length
                    : Number(p.puntosRanking || getBaseEloByLevel(p.nivel || 2.5));
                
                let myGames = 0, oppGames = 0;
                sets.forEach(s => {
                    const parts = s.split('-').map(Number);
                    if (parts.length === 2) {
                        if (amIteam1) { myGames += parts[0]; oppGames += parts[1]; }
                        else { myGames += parts[1]; oppGames += parts[0]; }
                    }
                });
                const gameDiff = myGames - oppGames;

                let currentPoints = p.puntosRanking;
                if (currentPoints === undefined || currentPoints === null) {
                    currentPoints = Math.round(1000 + ((p.nivel || 2.5) - 2.5) * 400);
                }

                const position = match.posiciones ? match.posiciones[i] : (i % 2 === 0 ? 'reves' : 'drive');
                const lastMatchDate = p.lastMatchDate ? p.lastMatchDate.toDate() : new Date(0);
                const now = new Date();
                const daysSinceLastMatch = Math.floor((now - lastMatchDate) / (1000 * 60 * 60 * 24));
                const mood = extraMatchData.playerMoods?.[p.id] || 'Normal';
                const stats = p.advancedStats || { consistency: 50, pressure: 50, aggression: 50, modelAccuracy: 85, upsets: 0 };
                const teamChemistry = estimateTeamChemistry(p, partner, stats);
                
                // --- PHASE 4: DYNAMIC K from STATS EVOLUTION ---
                const kFactor = getDynamicKFactor(p);

                const elo = predictEloImpact({
                    myLevel: p.nivel || 2.5, 
                    myPoints: currentPoints,
                    partnerLevel: partner ? (partner.nivel || 2.5) : (p.nivel || 2.5), 
                    rival1Level: oppAvg, 
                    rival2Level: oppAvg,
                    streak: p.rachaActual || 0,
                    matchesPlayed: p.partidosJugados || 0,
                    setsDifference: diffSets,
                    gameDiff: gameDiff,
                    dynamicK: kFactor,
                    extraParams: { 
                        weight: p.peso || 75,
                        isComeback: didIWin && sets.length === 3 && sets[0].split('-').map(Number)[amIteam1 ? 0 : 1] < sets[0].split('-').map(Number)[amIteam1 ? 1 : 0],
                        isComp: isComp,
                        isCloseMatch: isCloseMatch,
                        didWin: didIWin,
                        setsCount: setsCount,
                        surface: surface,
                        weatherCondition: extraMatchData.weather || 'normal',
                        daysSinceLastMatch: daysSinceLastMatch,
                        mood: mood,
                        consistency: stats.consistency || 50,
                        pressure: stats.pressure || 50,
                        aggression: stats.aggression || 50,
                        winnersAvg: stats.winnersAvg || 0,
                        ueAvg: stats.ueAvg || 0,
                        teamChemistry: teamChemistry,
                        rivalPointsAvg: oppPointsAvg,
                        partnerPoints: Number(partner?.puntosRanking || currentPoints),
                    }
                });

                let delta = didIWin ? elo.win : elo.loss;
                if (!isComp) delta = Math.round(delta * 0.7); 
                const fairGuard = applyFairCompetitionGuard({
                    delta,
                    didIWin,
                    myLevel: p.nivel || 2.5,
                    oppAvg,
                    isComp,
                    expectedWinrate: elo.expectedWinrate
                });
                delta = fairGuard.delta;

                const newPts = Math.max(0, currentPoints + delta);
                const levelChange = calculateLevelChange(p.nivel || 2.5, oppAvg, didIWin);
                const newLevel = Math.max(1, Math.min(7, (p.nivel || 2.5) + levelChange));
                
                const eloData = p.elo || {};
                const posKey = position.toLowerCase();
                const currentPosElo = eloData[posKey] || currentPoints;
                const newPosElo = currentPosElo + delta;
                
                const surfKey = surface.toLowerCase();
                const currentSurfElo = eloData[surfKey] || currentPoints;
                const newSurfElo = currentSurfElo + delta;

                let consDelta = didIWin && diffSets === 2 ? 0.5 : (didIWin ? 0.2 : (diffSets === 2 ? -0.5 : -0.2));
                stats.consistency = Math.min(100, Math.max(0, (stats.consistency || 50) + consDelta));
                let pressDelta = isCloseMatch ? (didIWin ? 1.5 : -0.5) : 0;
                stats.pressure = Math.min(100, Math.max(0, (stats.pressure || 50) + pressDelta));

                const pointImpact = buildPointImpact({
                    delta,
                    teamPointCount,
                    amIteam1,
                    team1Avg: t1Avg,
                    team2Avg: t2Avg,
                    myLevel: p.nivel || 2.5,
                    partnerLevel: partner ? (partner.nivel || 2.5) : (p.nivel || 2.5),
                });

                const analysis = {
                    matchId: matchId,
                    matchCollection: col,
                    won: didIWin,
                    delta: delta,
                    pointsBefore: currentPoints,
                    pointsAfter: newPts,
                    levelBefore: p.nivel || 2.5,
                    levelAfter: parseFloat(newLevel.toFixed(2)),
                    myLevel: p.nivel || 2.5,
                    partnerLevel: partner ? (partner.nivel || 2.5) : (p.nivel || 2.5),
                    partnerPoints: Number(partner?.puntosRanking || currentPoints),
                    rivalLevels: opponentPlayers.map(op => (op.nivel || 2.5)),
                    rivalPoints: opponentPlayers.map(op => (op.puntosRanking || currentPoints)),
                    opponentAvg: oppAvg,
                    sets: resultStr,
                    breakdown: elo.breakdown,
                    math: elo.math,
                    // ADDITIVE BREAKDOWN for User Transparency
                    puntosDetalle: {
                        base: parseFloat((elo.math.K * (didIWin ? (1 - elo.math.expected) : (0 - elo.math.expected))).toFixed(2)),
                        get difPuntos() {
                            return parseFloat((this.base * (elo.math.underdog - 1)).toFixed(2));
                        },
                        get rachaPuntos() {
                            return parseFloat(((this.base + this.difPuntos) * (elo.math.streak - 1)).toFixed(2));
                        },
                        get setsPuntos() {
                            return parseFloat(((this.base + this.difPuntos + this.rachaPuntos) * (elo.math.performance * elo.math.dominance - 1)).toFixed(2));
                        },
                        get total() {
                            return delta;
                        }
                    },
                    puntosCalculados: {
                        base: parseFloat((elo.math.K * (didIWin ? (1 - elo.math.expected) : (0 - elo.math.expected))).toFixed(2)),
                        dificultad: 0,
                        racha: 0,
                        ajusteJusticia: 0,
                        sets: 0,
                        total: delta
                    },
                    isComp: isComp,
                    closeMatch: isCloseMatch,
                    gameDiff: gameDiff,
                    prediction: elo.expectedWinrate,
                    pointImpact: pointImpact,
                    fairPlay: fairGuard,
                    mvpBonus: 0,
                    timestamp: new Date().toISOString()
                };
                
                // Finalize additive components
                analysis.puntosCalculados.dificultad = parseFloat((analysis.puntosCalculados.base * (elo.math.underdog - 1)).toFixed(2));
                analysis.puntosCalculados.racha = parseFloat(((analysis.puntosCalculados.base + analysis.puntosCalculados.dificultad) * (elo.math.streak - 1)).toFixed(2));
                analysis.puntosCalculados.sets = parseFloat(((analysis.puntosCalculados.base + analysis.puntosCalculados.dificultad + analysis.puntosCalculados.racha) * (elo.math.performance * elo.math.dominance * elo.math.clutch * elo.math.partnerSync - 1)).toFixed(2));
                
                // Safety: Ensure total is the sum of parts in the log for visual audit
                const rawParts = analysis.puntosCalculados.base + analysis.puntosCalculados.dificultad + analysis.puntosCalculados.racha + analysis.puntosCalculados.sets;
                analysis.puntosCalculados.ajusteJusticia = parseFloat((delta - rawParts).toFixed(2));
                const checkTotal = rawParts + analysis.puntosCalculados.ajusteJusticia;
                if (Math.abs(checkTotal - delta) > 0.1) {
                    analysis.puntosCalculados.ajusteJusticia += (delta - checkTotal); // Adjust rounding to match total
                }

                // Transactional Writes
                transaction.update(doc(db, 'usuarios', p.id), {
                    puntosRanking: newPts,
                    nivel: parseFloat(newLevel.toFixed(2)),
                    victorias: (p.victorias || 0) + (didIWin ? 1 : 0),
                    partidosJugados: (p.partidosJugados || 0) + 1,
                    rachaActual: didIWin ? (p.rachaActual > 0 ? p.rachaActual + 1 : 1) : (p.rachaActual < 0 ? p.rachaActual - 1 : -1),
                    lastMatchAnalysis: analysis,
                    [`elo.${posKey}`]: newPosElo,
                    [`elo.${surfKey}`]: newSurfElo,
                    advancedStats: stats,
                    lastMatchDate: serverTimestamp()
                });

                const logId = `${matchId}_${p.id}`;
                transaction.set(doc(db, "rankingLogs", logId), {
                    uid: p.id,
                    matchId: matchId,
                    matchCollection: col,
                    diff: delta,
                    newTotal: newPts,
                    details: analysis,
                    subEloIndices: { position: newPosElo, surface: newSurfElo },
                    timestamp: serverTimestamp()
                });

                changes.push({ uid: p.id, delta, analysis, pointImpact });
                pointAllocations.push({
                    uid: p.id,
                    team: amIteam1 ? "A" : "B",
                    delta: delta,
                    pointImpact: pointImpact
                });
                
                // UI Toasts can happen after, but we can't emit from here easily. 
                // We'll trust the user to see the updated data or orchestrator notifications.
            }

            // Save details
            transaction.set(doc(db, "matchPointDetails", matchId), {
                matchId: matchId,
                col: col,
                sets: resultStr,
                totalPoints: pointDetails.totalPoints,
                points: pointDetails.points,
                playerAllocations: pointAllocations,
                createdAt: serverTimestamp()
            });

            // Match Summary
            transaction.update(matchRef, {
                estado: 'jugado', // Atomic status update
                resultado: { sets: resultStr }, // Save sets officially
                eloSummary: {
                    totalPoints: pointDetails.totalPoints,
                    pointsPerSet: pointDetails.pointsPerSet,
                    updatedAt: serverTimestamp()
                },
                rankingProcessedAt: serverTimestamp(),
                rankingProcessedResult: resultStr,
                rankingProcessedBy: auth.currentUser?.uid || null
            });

            return { success: true, changes };
        });

        // Loop changes for side effects (Orchestrator, Toasts) - Outside Transaction
        // ... (This part runs after transaction success)
        
    } catch(e) {
        console.error("Match Processing Error:", e);
        return { success: false, error: e.message || e };
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
    let change = won ? Math.min(base, 0.15) : Math.max(-base, -0.15);
    if (won && change < 0.01) change = 0.01;
    if (!won && change > -0.01) change = -0.01;
    return change;
}

function estimatePointDetailsFromSets(resultStr) {
    const sets = resultStr.trim().split(/\s+/).filter(Boolean);
    const points = [];
    const pointsPerSet = [];
    let totalPoints = 0;

    sets.forEach((s, setIdx) => {
        if (!s.includes('-')) return;
        const [g1, g2] = s.split('-').map(Number);
        if (!Number.isFinite(g1) || !Number.isFinite(g2)) return;

        const setPoints = (g1 + g2) * 4; // estimate 4 points per game
        pointsPerSet.push({ set: setIdx + 1, gamesA: g1, gamesB: g2, points: setPoints });
        totalPoints += setPoints;

        const winnerTeam = g1 >= g2 ? 'A' : 'B';
        const gameCount = g1 + g2;
        for (let g = 1; g <= gameCount; g++) {
            for (let p = 1; p <= 4; p++) {
                points.push({
                    set: setIdx + 1,
                    game: g,
                    point: p,
                    winnerTeam,
                    type: "estimado"
                });
            }
        }
    });

    return { points, totalPoints: totalPoints || 1, pointsPerSet };
}

function estimateTeamChemistry(player, partner, stats) {
    if (!partner || partner.isGuest) return 0.5;
    const myLvl = Number(player?.nivel || 2.5);
    const partnerLvl = Number(partner?.nivel || 2.5);
    const myPts = Number(player?.puntosRanking || getBaseEloByLevel(myLvl));
    const partnerPts = Number(partner?.puntosRanking || getBaseEloByLevel(partnerLvl));
    const consistency = Math.max(0, Math.min(100, Number(stats?.consistency || 50))) / 100;

    const lvlGapPenalty = Math.min(0.24, Math.abs(myLvl - partnerLvl) * 0.12);
    const ptsGapPenalty = Math.min(0.18, Math.abs(myPts - partnerPts) / 2500);

    const chemistry = 0.55 + consistency * 0.35 - lvlGapPenalty - ptsGapPenalty;
    return Number(Math.max(0.2, Math.min(1, chemistry)).toFixed(3));
}

function buildPointImpact({ delta, teamPointCount, amIteam1, team1Avg, team2Avg, myLevel, partnerLevel }) {
    const myTeamAvg = amIteam1 ? team1Avg : team2Avg;
    const rivalAvg = amIteam1 ? team2Avg : team1Avg;
    const gap = rivalAvg - myTeamAvg;
    const basePerPoint = delta / teamPointCount;
    const partnerDiff = (partnerLevel || myLevel) - myLevel;
    const diffMult = 1 + (gap * 0.05);
    const partnerMult = 1 + (partnerDiff * 0.02);
    return {
        team: amIteam1 ? "A" : "B",
        basePerPoint: Number(basePerPoint.toFixed(3)),
        levelGap: Number(gap.toFixed(2)),
        partnerDiff: Number(partnerDiff.toFixed(2)),
        multiplier: Number((diffMult * partnerMult).toFixed(3))
    };
}


