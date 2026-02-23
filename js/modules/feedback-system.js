/**
 * @file feedback-system.js
 * @version 1.0 (Phase 1 Global System)
 * @description Centralized Feedback Manager for Padeluminatis V7.
 * Handles all user notifications (Toasts, Modals, Status Messages) in a unified way.
 */

import { showToast } from '../ui-core.js';

/**
 * Standardized Feedback Events
 */
export const FEEDBACK = {
    // AUTHENTICATION
    AUTH: {
        LOGIN_SUCCESS: { title: "CONECTADO", msg: "Acceso autorizado a la Matrix.", type: "success" },
        LOGIN_ERROR: { title: "ERROR DE ACCESO", msg: "Credenciales inválidas.", type: "error" },
        REGISTER_SUCCESS: { title: "REGISTRO COMPLETADO", msg: "Tu perfil ha sido creado.", type: "success" },
        PENDING_APPROVAL: { title: "CUENTA PENDIENTE", msg: "Tu acceso requiere aprobación de un administrador.", type: "warning" },
        LOGOUT: { title: "DESCONECTADO", msg: "Sesión finalizada.", type: "info" },
        NETWORK_ERROR: { title: "ERROR DE RED", msg: "Verifica tu conexión a internet.", type: "error" }
    },

    // MATCHES
    MATCH: {
        CREATED: { title: "PARTIDO CREADO", msg: "Despliegue táctico confirmado.", type: "success" },
        JOINED: { title: "UNIDO AL SQUAD", msg: "Te has unido al partido correctamente.", type: "success" },
        LEFT: { title: "ABANDONO", msg: "Has salido del partido.", type: "info" },
        CANCELLED: { title: "PARTIDO CANCELADO", msg: "El evento ha sido eliminado.", type: "warning" },
        RESULT_SAVED: { title: "RESULTADO GUARDADO", msg: "Ranking actualizado.", type: "success" },
        FULL: { title: "SQUAD COMPLETO", msg: "No quedan plazas disponibles.", type: "warning" },
        PERMISSION_DENIED: { title: "ACCESO DENEGADO", msg: "No tienes permisos para esta acción.", type: "error" }
    },

    // RANKING & STATS
    RANKING: {
        LEVEL_UP: (lvl) => ({ title: "LEVEL UP!", msg: `Has ascendido al nivel ${lvl}.`, type: "success" }),
        STREAK_NEW: (count) => ({ title: "RACHA IMPARABLE", msg: `¡${count} victorias consecutivas!`, type: "success" }),
        ELO_CHANGE: (diff) => ({ 
            title: diff >= 0 ? "PUNTOS GANADOS" : "PUNTOS PERDIDOS", 
            msg: `Tu ELO ha cambiado en ${diff > 0 ? '+' : ''}${diff}.`, 
            type: diff >= 0 ? "success" : "warning" 
        })
    },

    // SYSTEM
    SYSTEM: {
        SYNCING: { title: "SINCRONIZANDO...", msg: "Actualizando datos con el servidor.", type: "info" },
        UPDATE_AVAILABLE: { title: "ACTUALIZACIÓN", msg: "Nueva versión disponible. Recargando...", type: "info" },
        ACTION_CONFIRM: { title: "CONFIRMADO", msg: "Acción realizada con éxito.", type: "success" },
        COPY_SUCCESS: { title: "COPIADO", msg: "Enlace copiado al portapapeles.", type: "success" }
    }
};

/**
 * Triggers a feedback event globally.
 * @param {Object} eventDef - Definition from FEEDBACK constant (or custom object)
 * @param {string} [customMsg] - Optional override message
 */
export function triggerFeedback(eventDef, customMsg = null) {
    if (!eventDef) return;
    
    const title = eventDef.title || "NOTIFICACIÓN";
    const msg = customMsg || eventDef.msg || "";
    const type = eventDef.type || "info";

    showToast(title, msg, type);
}

/**
 * Helper for try/catch blocks in async operations
 */
export function handleOperationError(error) {
    console.error("Operation Error:", error);
    
    let feedback = FEEDBACK.SYSTEM.NETWORK_ERROR;
    
    if (error.code === 'permission-denied') feedback = FEEDBACK.MATCH.PERMISSION_DENIED;
    else if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') feedback = FEEDBACK.AUTH.LOGIN_ERROR;
    else if (error.message && error.message.includes('offline')) feedback = FEEDBACK.SYSTEM.NETWORK_ERROR;
    
    // Fallback generic error with technical detail if needed
    if (feedback === FEEDBACK.SYSTEM.NETWORK_ERROR && error.message && !error.message.includes('offline')) {
         showToast("ERROR DEL SISTEMA", error.message, "error");
    } else {
         triggerFeedback(feedback);
    }
}

