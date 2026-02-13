/**
 * RIVAL-INTELLIGENCE.js - Phase 3: Competitive Analysis
 * @version 1.0 (Deepmind Core)
 * 
 * Module for parsing Head-to-Head data and generating unique insights.
 */

export const RivalIntelligence = {

    /**
     * Parses historical matchups between current user and opponent.
     * @param {string} userId - Current user ID
     * @param {string} rivalId - Opponent ID
     * @param {Array} history - Array of match objects (documents)
     */
    analyzeHeadToHead: (userId, rivalId, history) => {
        const matches = history.filter(m => {
            if (!m.jugadores || m.jugadores.filter(id => id).length !== 4) return false;
            // Check if user and rival were opponents
            const userIdx = m.jugadores.indexOf(userId);
            const rivalIdx = m.jugadores.indexOf(rivalId);
            if (userIdx === -1 || rivalIdx === -1) return false;
            
            // They are opponents if (0,1 vs 2,3) -> one is <2, other >=2
            const userTeam = userIdx < 2 ? 1 : 2;
            const rivalTeam = rivalIdx < 2 ? 1 : 2;
            return userTeam !== rivalTeam;
        });

        const total = matches.length;
        if (total === 0) return { status: "No Data", wins: 0, losses: 0 };

        let wins = 0;
        let losses = 0;
        let setsWon = 0;
        let setsLost = 0;

        matches.forEach(m => {
            const userIdx = m.jugadores.indexOf(userId);
            const userTeam = userIdx < 2 ? 1 : 2;
            
            // Safe Result Parsing "6-4 6-4"
            if (m.resultado && m.resultado.sets) { // Assuming structured Result
                 // Or parse string Result if needed (depends on V9 structure)
                 // This assumes 'ganador' field exists from V9
                 if (m.resultado.ganador === userTeam) wins++; else losses++;
            } else if (typeof m.resultado === 'string') {
                 // Fallback parsing (simplified)
                 // If string exists, check score logic
            }
        });

        // Calculate Trend (Last 3)
        const recent = matches.slice(0, 3);
        const recentWins = recent.reduce((sum, m) => {
            const userIdx = m.jugadores.indexOf(userId);
            const userTeam = userIdx < 2 ? 1 : 2;
            return sum + (m.resultado?.ganador === userTeam ? 1 : 0);
        }, 0);

        let trend = "Neutral";
        if (recentWins === 3) trend = "Dominante";
        if (recentWins === 0) trend = "Sometido (Kryptonita)";

        return {
            total,
            wins,
            losses,
            winRate: Math.round((wins / total) * 100),
            trend,
            recentForm: `${recentWins}-${recent.length - recentWins}` 
        };
    },

    /**
     * Generates comparative stats side-by-side.
     */
    compareTacticalDNA: (user, rival) => {
        const uStats = user.advancedStats || {};
        const rStats = rival.advancedStats || {};

        return {
            consistency: { user: uStats.consistency || 50, rival: rStats.consistency || 50, label: "CONSISTENCIA" },
            pressure: { user: uStats.pressure || 50, rival: rStats.pressure || 50, label: "PRESIÓN (CLUTCH)" },
            aggression: { user: uStats.aggression || 50, rival: rStats.aggression || 50, label: "AGRESIVIDAD" },
            defense: { user: uStats.defense || 50, rival: rStats.defense || 50, label: "DEFENSA" }
        };
    },

    /**
     * Classifies the Rival based on difficulty.
     */
    classifyRival: (h2h, matchProb) => {
        if (h2h.status === "No Data") return { class: "Incógnita", color: "gray" };
        
        // Kryptonite: Low winrate (<30%) AND High volume (>3 matches)
        if (h2h.winRate < 30 && h2h.total > 3) return { class: "KERYPTONITA", color: "red", icon: "fa-skull" };

        // Easy: High winrate (>70%)
        if (h2h.winRate > 70) return { class: "EASY PEASY", color: "green", icon: "fa-laugh-beam" };

        // Rival: Close match (40-60%)
        if (h2h.winRate >= 40 && h2h.winRate <= 60) return { class: "RIVAL DIRECTO", color: "orange", icon: "fa-handshake" };

        return { class: "NEUTRAL", color: "blue", icon: "fa-user" };
    }
};
