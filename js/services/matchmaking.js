// js/services/matchmaking.js - Premium Matchmaking Engine
import { db } from '../firebase-service.js';
import { collection, getDocs, query, where, limit, orderBy } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';

/**
 * Returns a list of recommended rivals based on ELO and activity.
 */
export async function getRecommendations(currentUser) {
    if (!currentUser) return [];

    try {
        // Fetch all active users (optimization: limit to 50 active?)
        // For now, fetch top 100 by last access
        const q = query(collection(db, 'usuarios'), orderBy('ultimoAcceso', 'desc'), limit(50));
        const snap = await window.getDocsSafe(q);
        
        const myElo = currentUser.puntosRanking || 1000;
        const myWeight = currentUser.peso || 75;

        const candidates = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(u => u.id !== currentUser.uid && u.id !== currentUser.id); // Exclude self

        const recommendations = candidates.map(rival => {
            const rivalElo = rival.puntosRanking || 1000;
            const eloDiff = rivalElo - myElo;
            
            // Win Probability (Simple sigmoid)
            const winProb = 1 / (1 + Math.pow(10, (rivalElo - myElo) / 400));
            
            // Risk/Reward
            // If I win against higher ELO -> High Reward
            // If I lose against lower ELO -> High Risk
            let reward = 32 * (1 - winProb); // Approximate K=32
            let risk = 32 * winProb;

            // Tags
            let type = 'balanced';
            if (eloDiff > 150) type = 'hard'; // Boss Fight
            else if (eloDiff < -150) type = 'easy'; // Easy win
            else if (eloDiff > 50) type = 'challenge';
            
            return {
                user: rival,
                eloDiff,
                winProb: (winProb * 100).toFixed(0),
                reward: Math.round(reward),
                risk: Math.round(risk),
                type
            };
        });

        // Filter: Only show relevant range (+- 400 ELO)
        const filtered = recommendations.filter(r => Math.abs(r.eloDiff) < 400);

        // Sort by 'Challenge' (closest to slightly higher ELO is best for growth)
        // We prioritize rivals who are 0-100 pts above us
        filtered.sort((a, b) => {
            const scoreA = getMatchScore(a.eloDiff);
            const scoreB = getMatchScore(b.eloDiff);
            return scoreB - scoreA;
        });

        return filtered.slice(0, 5); // Return top 5

    } catch (e) {
        console.error("Matchmaking error:", e);
        return [];
    }
}

function getMatchScore(diff) {
    // Ideal rival is +25 to +50 points above
    if (diff >= 0 && diff <= 50) return 100;
    if (diff > 50 && diff <= 100) return 80;
    if (diff < 0 && diff >= -50) return 60;
    if (diff > 100) return 40; // Too hard
    if (diff < -50) return 20; // Too easy
    return 0;
}


