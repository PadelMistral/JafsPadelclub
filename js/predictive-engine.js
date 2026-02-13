/**
 * PREDICTIVE-ENGINE.js - Phase 3: Advanced Match Prediction
 * @version 1.0 (Deepmind Core)
 * 
 * Modular engine for pre-match analysis.
 * Does not depend on DOM. Pure logic layer.
 */

export const PredictiveEngine = {
    
    /**
     * Calculates Win Probability based on weighted factors.
     * @param {Object} user - Main player profile
     * @param {Object} partner - Partner profile
     * @param {Object} rival1 - Rival 1 profile
     * @param {Object} rival2 - Rival 2 profile
     * @param {Object} context - { surface: 'indoor'|'outdoor', weather: '...' }
     */
    /**
     * Calculates Win Probability based on weighted factors.
     * Phase 4: Self-Adaptive Weights
     */
    calculateMatchProbability: (user, partner, rival1, rival2, context = {}) => {
        // Default Weights (can be overriden by context.weights)
        const W = context.weights || {
            base: 0.4,
            surface: 0.2,
            position: 0.15,
            form: 0.15,
            mental: 0.1
        };

        const getElo = (p, type) => (p.elo && p.elo[type]) ? p.elo[type] : (p.puntosRanking || 1000);
        const getForm = (p) => p.rachaActual || 0;
        
        // 1. Base ELO Differential
        const teamA_Base = (user.puntosRanking + partner.puntosRanking) / 2;
        const teamB_Base = (rival1.puntosRanking + rival2.puntosRanking) / 2;
        const diffBase = teamA_Base - teamB_Base;

        // 2. Surface Differential
        const surface = context.surface || 'indoor';
        const teamA_Surf = (getElo(user, surface) + getElo(partner, surface)) / 2;
        const teamB_Surf = (getElo(rival1, surface) + getElo(rival2, surface)) / 2;
        const diffSurf = teamA_Surf - teamB_Surf;

        // 3. Positional Synergy
        const teamA_Pos = (getElo(user, 'drive') + getElo(partner, 'reves')) / 2; 
        const teamB_Pos = (getElo(rival1, 'drive') + getElo(rival2, 'reves')) / 2;
        const diffPos = teamA_Pos - teamB_Pos;

        // 4. Form/Momentum
        const teamA_Form = (getForm(user) + getForm(partner));
        const teamB_Form = (getForm(rival1) + getForm(rival2));
        const diffForm = (teamA_Form - teamB_Form) * 10; 

        // 5. Emotional Stability
        const getMental = (p) => p.advancedStats?.pressure || 50;
        const teamA_Mental = (getMental(user) + getMental(partner)) / 2;
        const teamB_Mental = (getMental(rival1) + getMental(rival2)) / 2;
        const diffMental = (teamA_Mental - teamB_Mental) * 2;

        // Weighted Sum
        const totalScore = (diffBase * W.base) + (diffSurf * W.surface) + (diffPos * W.position) + (diffForm * W.form) + (diffMental * W.mental);
        
        const probability = 1 / (1 + Math.pow(10, -totalScore / 400));
        
        const totalMatches = (user.partidosJugados || 0) + (partner.partidosJugados || 0);
        const confidence = Math.min(100, Math.max(20, totalMatches / 2));

        const volatility = (Math.abs(diffForm) > 30 || teamA_Mental < 40) ? 'Alta - Partido Caótico' : 'Baja - Resultado Predecible';

        return {
            winProbability: Math.round(probability * 100),
            confidenceIndex: Math.round(confidence),
            volatility: volatility,
            components: { base: diffBase, surf: diffSurf, form: diffForm },
            appliedWeights: W
        };
    },

    /**
     * Phase 4: Accuracy Engine
     * Calculates how close the prediction was to the result.
     * @param {Object} prediction - { winProbability: 70 }
     * @param {Boolean} didWin - True if User Won
     */
    analyzeAccuracy: (prediction, didWin) => {
        const prob = prediction.winProbability; // e.g. 70
        const resultVal = didWin ? 100 : 0;
        const error = Math.abs(prob - resultVal); // |70 - 100| = 30
        const accuracy = 100 - error; // 70% accurate
        
        return {
            accuracy,
            deviation: error,
            isCorrectDirection: (prob > 50 && didWin) || (prob < 50 && !didWin)
        };
    },

    /**
     * Phase 4: Upset Detection
     * Classifies the deviation severity.
     */
    detectUpset: (prediction, didWin) => {
        const prob = prediction.winProbability;
        let upsetLevel = "None";
        let isUpset = false;

        // User Won but Prob was Low
        if (didWin && prob < 40) {
            isUpset = true;
            upsetLevel = prob < 20 ? "Critical (Epic Win)" : "Medium (Upset)";
        }
        // User Lost but Prob was High
        else if (!didWin && prob > 60) {
            isUpset = true;
            upsetLevel = prob > 80 ? "Critical (Major Collapse)" : "Medium (Disappointment)";
        }

        return { isUpset, level: upsetLevel };
    },

    /**
     * Detects Tactical Risk Zones based on opponent style matching.
     */
    analyzeTacticalRisks: (user, rivalProfile) => {
        const risks = [];
        const opportunities = [];
        
        const userStyle = user.advancedStats || {};
        const rivalStyle = rivalProfile.advancedStats || {};

        // Compare Consistencies
        if ((rivalStyle.consistency || 50) > (userStyle.consistency || 50) + 15) {
            risks.push({
                type: 'Riesgo de Paciencia',
                desc: 'Rival mucho más consistente. No entres en guerra de volumen.',
                severity: 'high'
            });
        }

        // Compare Net Dominance
        if ((rivalStyle.netPoints || 0) > 60 && (userStyle.lobQuality || 50) < 40) {
             risks.push({
                type: 'Zona Aérea Comprometida',
                desc: 'Rival domina la red y tus globos son cortos.',
                severity: 'medium'
            });
        }

        // Opportunities
        if ((rivalStyle.pressure || 50) < 40) {
            opportunities.push({
                type: 'Fragilidad Mental',
                desc: 'El rival colapsa en puntos de oro (30-30, 40-40). Presiona ahí.',
                impact: 'high'
            });
        }
        
        if ((rivalStyle.backhands || 50) < 30) {
             opportunities.push({
                type: 'Nevera al Revés',
                desc: 'Su revés es defensivo. Carga juego ahí para ganar red.',
                impact: 'medium'
            });
        }

        return {
            risks,
            opportunities,
            emotionalWarning: (userStyle.pressure || 50) < 40 ? "Riesgo de Tilt Alto" : "Estabilidad Mental Ok"
        };
    },

    /**
     * Estimates Performance ranges (Winners/UEs)
     */
    predictPerformance: (user, context) => {
        const baseWinners = user.advancedStats?.winnersAvg || 12;
        const baseUE = user.advancedStats?.ueAvg || 8;
        
        let modifier = 1.0;
        if (context.surface === 'outdoor') modifier = 0.9; // Harder to kill
        if (context.weather === 'humid') modifier = 0.8;

        return {
            expectedWinners: `${Math.round(baseWinners * modifier * 0.8)} - ${Math.round(baseWinners * modifier * 1.2)}`,
            expectedUE: `${Math.round(baseUE * 0.8)} - ${Math.round(baseUE * 1.5)}` // Error range usually higher var
        };
    }
};
