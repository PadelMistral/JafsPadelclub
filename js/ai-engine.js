/**
 * AI-ENGINE.js - Real Adaptive Intelligence Layer
 * @version 9.0 (Deepmind Core)
 *
 * Capabilities:
 * - Dynamic Style Detection
 * - Structural Weakness Analysis
 * - Emotional Pattern Recognition
 * - Predictive Match Engine
 * - Automated Coaching Recommendations
 */

export const AI = {
    /**
     * Analyzes player's history to build a dynamic profile.
     * @param {Object} user - User document
     * @param {Array} history - List of last 20 matches (with diary entries if linked)
     * @param {Array} diary - List of last 20 diary entries
     */
    analyzeProfile: (user, history = [], diary = []) => {
        const stats = user.advancedStats || {};
        const wins = user.victorias || 0;
        const total = user.partidosJugados || 1;
        const winRate = wins / total;
        
        // 1. STYLE DETECTION (Aggressive, Tactician, Wall, Mixed)
        // Based on Winners/UE ratio from recent diary entries or stats
        const wRatio = (stats.winners || 0) / (stats.ue || 1);
        let style = "Equilibrado";
        if (wRatio > 1.8) style = "Agresivo (Artillero)";
        else if (wRatio < 0.8) style = "Muro Defensivo";
        else if (stats.netPoints > stats.backPoints) style = "Voleador Nato";
        else if (stats.consistency > 75) style = "Táctico (Metrónomo)";

        // 2. DETECT STRENGTHS
        const strengths = [];
        if (stats.consistency > 70) strengths.push("Consistencia Alta");
        if (stats.pressure > 70) strengths.push("Clutch Player (Presión)");
        if (winRate > 0.6) strengths.push("Ganador Recurrente");
        if (user.elo?.indoor > user.elo?.outdoor + 50) strengths.push("Especialista Indoor");
        
        // 3. DETECT WEAKNESSES
        const weaknesses = [];
        if (stats.consistency < 40) weaknesses.push("Errores No Forzados");
        if (stats.pressure < 40) weaknesses.push("Fragilidad Mental");
        if (user.rachaActual < -2) weaknesses.push("Racha Negativa");
        
        // 4. EMOTIONAL PATTERNS (From Diary)
        // Check correlation between Mood and Result
        let emotionalTrend = "Estable";
        const badMoodWins = diary.filter(e => ['Frustrado', 'Cansado'].includes(e.biometria?.mood) && e.result === 'win').length;
        if (badMoodWins > 2) emotionalTrend = "Resiliente (Gana jugando mal)";
        
        const goodMoodLosses = diary.filter(e => ['Motivado', 'Fluido'].includes(e.biometria?.mood) && e.result === 'loss').length;
        if (goodMoodLosses > 2) emotionalTrend = "Exceso de Confianza";

        return {
            style,
            strengths,
            weaknesses,
            emotionalTrend,
            progressionIndex: calculateProgression(history)
        };
    },

    /**
     * Generates tailored recommendations based on profile analysis.
     */
    getRecommendations: (analysis) => {
        const recs = [];
        
        // Tactical
        if (analysis.style.includes("Agresivo")) {
            recs.push({ type: 'tactica', text: "Paciencia: Espera la bola cómoda antes de acelerar." });
        } else if (analysis.style.includes("Defensivo")) {
            recs.push({ type: 'tactica', text: "Contragolpe: Sube a la red tras globos profundos." });
        }

        // Equipment (Pala)
        if (analysis.weaknesses.includes("Errores No Forzados")) {
            recs.push({ type: 'pala', text: "Busca palas redondas con punto dulce amplio (Control)." });
        } else if (analysis.style.includes("Agresivo")) {
            recs.push({ type: 'pala', text: "Palas diamante o lágrima con balance alto (Potencia)." });
        }

        // Mental
        if (analysis.emotionalTrend === "Exceso de Confianza") {
            recs.push({ type: 'mental', text: "Mantén la tensión competitiva hasta el último punto." });
        }

        return recs;
    },

    /**
     * Calculates win probability against specific opponents.
     */
    predictMatch: (me, partner, rival1, rival2) => {
        const myElo = me.puntosRanking || 1000;
        const pElo = partner.puntosRanking || 1000;
        const r1Elo = rival1.puntosRanking || 1000;
        const r2Elo = rival2.puntosRanking || 1000;

        const teamA = (myElo + pElo) / 2;
        const teamB = (r1Elo + r2Elo) / 2;

        const diff = teamA - teamB;
        const winProb = 1 / (1 + Math.pow(10, (teamB - teamA) / 400));
        
        return {
            probability: Math.round(winProb * 100),
            diff: Math.round(diff),
            expectedSet: diff > 100 ? "2-0" : (Math.abs(diff) < 50 ? "2-1 / 1-2" : "0-2")
        };
    }
};

/**
 * Helper: Calculate progression trend from ELO history
 */
function calculateProgression(history) {
    if (history.length < 5) return "Sin datos suficientes";
    const recent = history.slice(0, 5);
    const start = recent[recent.length-1].newTotal;
    const end = recent[0].newTotal;
    const diff = end - start;
    
    if (diff > 50) return "Ascenso Meteórico (+50)";
    if (diff > 10) return "Crecimiento Sostenido";
    if (diff < -50) return "Caída Libre (-50)";
    if (diff < -10) return "Bache de Rendimiento";
    return "Estancamiento";
}

