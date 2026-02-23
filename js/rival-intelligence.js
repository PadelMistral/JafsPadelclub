export const RivalIntelligence = {

    /**
     * Enhanced parsing of matchups
     */
    parseMatches: (userId, rivalId, history) => {
        const matches = history.filter(m => {
            const players = m.jugadores || m.participantes;
            if (!players || players.length < 4) return false;
            const uIdx = players.indexOf(userId);
            const rIdx = players.indexOf(rivalId);
            if (uIdx === -1 || rIdx === -1) return false;

            const uTeam = uIdx < 2 ? 1 : 2;
            const rTeam = rIdx < 2 ? 1 : 2;
            return uTeam !== rTeam;
        });

        const total = matches.length;
        if (total === 0) return { wins: 0, losses: 0, winRate: 0, confidence: 10, tacticalBrief: "No hay historial previo entre ambos jugadores." };

        let wins = 0;
        let losses = 0;

        const resolveWinner = (m) => {
            if (m.resultado?.ganador) return m.resultado.ganador;
            const sets = String(m.resultado?.sets || '').trim().split(/\s+/).filter(Boolean);
            let t1 = 0, t2 = 0;
            sets.forEach(s => {
                const [a, b] = s.split('-').map(Number);
                if (!Number.isFinite(a) || !Number.isFinite(b)) return;
                if (a > b) t1++;
                else if (b > a) t2++;
            });
            if (t1 === t2) return null;
            return t1 > t2 ? 1 : 2;
        };

        matches.forEach(m => {
            const players = m.jugadores || m.participantes || [];
            const uIdx = players.indexOf(userId);
            const uTeam = uIdx < 2 ? 1 : 2;
            const winner = resolveWinner(m);
            if (winner === uTeam) wins++;
            else if (winner) losses++;
        });

        const winRate = Math.round((wins / total) * 100);
        const confidence = Math.min(100, total * 15 + 10);

        let brief = "";
        if (winRate >= 70) brief = "Dominas claramente el cara a cara. Juega con calma; el rival suele frustrarse ante tu consistencia.";
        else if (winRate <= 30) brief = "Este rival es tu némesis. Suelen ganarte por volumen de juego. Prueba a cambiar el ritmo o jugar globos más profundos.";
        else brief = "Enfrentamiento muy equilibrado. Se decidirá por los detalles y quién cometa menos errores no forzados en el tercer set.";

        return {
            total,
            wins,
            losses,
            winRate,
            confidence,
            tacticalBrief: brief
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
    classifyRival: (h2h) => {
        if (!h2h || h2h.total === 0) return { class: "Incógnita", color: "gray" };
        if (h2h.winRate < 30 && h2h.total >= 2) return { class: "KERYPTONITA", color: "red", icon: "fa-skull" };
        if (h2h.winRate > 70 && h2h.total >= 2) return { class: "VÍCTIMA", color: "green", icon: "fa-laugh-beam" };
        return { class: "RIVAL DIRECTO", color: "orange", icon: "fa-handshake" };
    }
};

