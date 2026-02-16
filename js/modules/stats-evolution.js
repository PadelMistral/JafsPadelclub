/**
 * @file stats-evolution.js
 * @version 1.5 (Phase 3 & 4 - RPG Engine V2)
 * @description Advanced Gamification Engine. Calculates dynamic technical attributes and manages ELO V2 based on performance, consistency, and inactivity.
 */

import { updateDocument, getDocument, db } from '../firebase-service.js';
import { collection, query, where, orderBy, limit, getDocs } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { triggerFeedback, FEEDBACK } from './feedback-system.js';
import { SmartNotifier } from './smart-notifications.js';

// --- CONFIGURATION CONSTANTS ---
const CONFIG = {
    // RPG Attribute Limits
    MIN_ATTR: 10,
    MAX_ATTR: 99,
    
    // Inertia: Resistance to rapid changes. 
    // Higher = slower evolution. Lower = more volatile.
    INERTIA: {
        TECHNICAL: 20, // Takes ~20 consistent high-perf matches to stabilize a new level
        PHYSICAL: 15,  // Physical state fluctuates faster
        MENTAL: 10     // Mental state is very volatile
    },

    // ELO Constants V2
    ELO: {
        K_ROOKIE: 40,  // < 20 matches
        K_NORMAL: 25,  // Standard
        K_PRO: 15,     // > 2000 points
        INACTIVITY_THRESHOLD_DAYS: 30, // Days before inactivity penalty applies
        STREAK_BONUS_THRESHOLD: 3      // Wins to trigger bonus
    }
};

/**
 * CORE: Re-calculates and upgrades user attributes based on a new technical diary entry.
 * @param {string} uid - User ID
 * @param {Object} technicalEntry - The new diary entry object
 */
export async function evolveUserAttributes(uid, technicalEntry) {
    if (!uid || !technicalEntry) return;

    try {
        const user = await getDocument("usuarios", uid);
        if (!user) return;

        // 1. Get current attributes or defaults
        let attrs = user.atributosTecnicos || {
            volea: 50, remate: 50, fondo: 50, 
            fisico: 60, mentalidad: 60, regularidad: 50
        };

        // 2. Calculate Contextual Performance Score (0-100) based on Diary
        const performanceMap = analyzeEntryPerformance(technicalEntry);

        // 3. Apply Evolution Formula (Inertia System)
        // New = Current + ((Target - Current) / Inertia)
        const newAttrs = {
            ...attrs,
            volea: calculateNewValue(attrs.volea, performanceMap.netGame, CONFIG.INERTIA.TECHNICAL),
            remate: calculateNewValue(attrs.remate, performanceMap.powerGame, CONFIG.INERTIA.TECHNICAL),
            fondo: calculateNewValue(attrs.fondo, performanceMap.baseGame, CONFIG.INERTIA.TECHNICAL),
            fisico: calculateNewValue(attrs.fisico, performanceMap.physical, CONFIG.INERTIA.PHYSICAL),
            mentalidad: calculateNewValue(attrs.mentalidad, performanceMap.mental, CONFIG.INERTIA.MENTAL),
            ultimaActualizacion: new Date().toISOString()
        };

        // 4. Generate Insights / Feedback
        const improvements = detectImprovements(attrs, newAttrs);

        // 5. Detect Inactivity (Phase 4 ELO Prep)
        const lastMatch = user.lastMatchDate ? new Date(user.lastMatchDate.toDate()) : new Date(0);
        const daysSince = (new Date() - lastMatch) / (1000 * 60 * 60 * 24);
        const metadata = user.statsCompetitivas || {};
        metadata.diasInactivo = Math.floor(daysSince);
        
        // 6. Save Updates
        await updateDocument("usuarios", uid, { 
            atributosTecnicos: newAttrs,
            statsCompetitivas: metadata
        });

        // 7. Notify User
        if (improvements.length > 0) {
            // Immediate Toast
            triggerFeedback({ 
                title: "EVOLUCIÓN TÉCNICA", 
                msg: `Mejoras detectadas: ${improvements.join(', ')}`, 
                type: "success" 
            });
            // Persistent / Smart Notification
            SmartNotifier.notifyEvolution(uid, improvements);
        }

    } catch (e) {
        console.error("Evolution Engine Error:", e);
    }
}

/**
 * Helper: Smooth value progression
 */
function calculateNewValue(current, target, inertia) {
    if (target === null || target === undefined) return current;
    const delta = (target - current) / inertia;
    const newVal = current + delta;
    return Math.max(CONFIG.MIN_ATTR, Math.min(CONFIG.MAX_ATTR, Math.round(newVal * 10) / 10)); // Keep 1 decimal internally
}

/**
 * Helper: Converts diary subjectivity into numeric targets (0-100)
 */
function analyzeEntryPerformance(entry) {
    // Safe defaults
    const stats = entry.stats || { winners: 0, ue: 0 };
    const bio = entry.biometria || { fisico: 5, mental: 5, confianza: 5};
    const feedback = entry.feedbackTecnico || {}; // Future detailed input

    // Win/UE Ratio is key for consistency target
    const ratio = (stats.winners + 1) / (stats.ue + 1);
    
    // Base Target: 0.5 ratio -> 40pts, 1.0 -> 60pts, 2.0 -> 80pts, 3.0 -> 95pts
    let baseTarget = 50 + (ratio - 1) * 20; 
    baseTarget = Math.max(20, Math.min(95, baseTarget));

    // Specific Skills Mapping
    // If user says they felt "8/10" in volley, target is roughly 80, adjusted by objective stats.
    const perceivedVolley = (feedback.volea || 5) * 10;
    
    return {
        // Technical Targets (Weighted: 40% Analysis, 60% Objective Ratio)
        netGame: (perceivedVolley * 0.4) + (baseTarget * 0.6),
        powerGame: ((feedback.remate || 5) * 10 * 0.4) + (baseTarget * 0.6), 
        baseGame: ((feedback.fondo || 5) * 10 * 0.4) + (baseTarget * 0.6),
        
        // Physical/Mental Targets (Mostly subjective but dampened)
        physical: (bio.fisico * 10),
        mental: ((bio.mental + bio.confianza) / 2) * 10
    };
}

/**
 * Helper: Detect meaningful changes for UI feedback
 */
function detectImprovements(oldA, newA) {
    const changes = [];
    const significant = 0.5; // Threshold to notify

    if (newA.volea - oldA.volea >= significant) changes.push("Volea 🔺");
    if (newA.remate - oldA.remate >= significant) changes.push("Potencia 🔺");
    if (newA.fondo - oldA.fondo >= significant) changes.push("Defensa 🔺");
    if (newA.mentalidad - oldA.mentalidad >= significant) changes.push("Mentalidad 🧠");
    if (newA.fisico - oldA.fisico >= significant) changes.push("Físico 💪");

    return changes;
}

/**
 * V2 ELO UTILS: Returns the dynamic K factor for a user
 */
export function getDynamicKFactor(userDoc) {
    const matches = userDoc.partidosJugados || 0;
    const points = userDoc.puntosRanking || 1000;
    
    // Inactivity check
    const lastMatch = userDoc.lastMatchDate ? new Date(userDoc.lastMatchDate.toDate()) : new Date();
    const daysSince = (new Date() - lastMatch) / (1000 * 60 * 60 * 24);

    if (daysSince > CONFIG.ELO.INACTIVITY_THRESHOLD_DAYS) {
        // High volatility for returning players
        return CONFIG.ELO.K_ROOKIE * 1.5; 
    }

    if (matches < 20) return CONFIG.ELO.K_ROOKIE;
    if (points > 2000) return CONFIG.ELO.K_PRO;
    
    return CONFIG.ELO.K_NORMAL;
}
