/**
 * @file smart-notifications.js
 * @version 1.0 (Phase 6 - Contextual Intelligence)
 * @description Generates rich, contextual notifications based on user activity, progression, and social interactions.
 */

import { createNotification } from '../services/notification-service.js';
import { getDocument } from '../firebase-service.js';

const NOTIF_TYPES = {
    RIVALRY: 'rivalry_alert',
    PROGRESSION: 'level_up',
    INACTIVITY: 'come_back',
    SOCIAL: 'social_interaction'
};

/**
 * Evaluates contextual events and triggers smart notifications.
 * Typically called after significant actions (Match End, Level Up, etc.)
 */
export const SmartNotifier = {
    
    /**
     * Checks for meaningful Rivalry updates after a match.
     */
    async checkRivalryUpdates(winnerUid, loserUid) {
        if (!winnerUid || !loserUid) return;
        
        try {
            const [winner, loser] = await Promise.all([
                getDocument('usuarios', winnerUid),
                getDocument('usuarios', loserUid)
            ]);

            // 1. "Vanquisher" Alert (Beating a much higher ranked player)
            if (winner.puntosRanking < loser.puntosRanking - 100) {
                await createNotification(
                    winnerUid, 
                    "¡MATAGIGANTES!", 
                    `Has derrotado a ${loser.nombreUsuario}, un rival superior. +Honor.`, 
                    NOTIF_TYPES.RIVALRY
                );
                await createNotification(
                    loserUid, 
                    "ALERTA DE RANGO", 
                    `Has caído ante ${winner.nombreUsuario}. Tu estatus está en peligro.`, 
                    NOTIF_TYPES.RIVALRY
                );
            }

            // 2. Power Level Cross-over (If implemented in future)
            // ...
            
        } catch (e) {
            console.warn("SmartNotifier Rivalry Error", e);
        }
    },

    /**
     * Notifies about RPG Attribute Evolution.
     */
    async notifyEvolution(uid, changes) {
        if (!changes || changes.length === 0) return;
        
        await createNotification(
            uid,
            "EVOLUCIÓN TÉCNICA",
            `Tu entrenamiento ha dado frutos. Mejoras: ${changes.join(', ')}`,
            NOTIF_TYPES.PROGRESSION,
            'perfil.html'
        );
    },

    /**
     * Re-engagement loops (Called periodically or on login)
     */
    async checkInactivity(user) {
        if (!user.lastMatchDate) return;
        
        const last = user.lastMatchDate.toDate();
        const days = Math.floor((new Date() - last) / (1000 * 60 * 60 * 24));
        
        if (days === 14) {
             await createNotification(user.id, "ZONA DE PELIGRO", "Llevas 2 semanas inactivo. Tu ELO empezará a oxidarse.", NOTIF_TYPES.INACTIVITY);
        }
        else if (days === 30) {
             await createNotification(user.id, "CORROSIÓN DETECTADA", "30 días sin competir. Penalización de inactividad activa.", NOTIF_TYPES.INACTIVITY);
        }
    }
};
