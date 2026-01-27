// ai-tactician.js - Advanced Neural Analysis Engine (v10.0)
import { db, getDocument } from './firebase-service.js';
import { collection, query, where, getDocs, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';

/**
 * High-End AI Strategist.
 * Analyzes the Operative's Journal and Combat History to synthesize protocols.
 */
export async function getTacticalAdvise(userData) {
    const journal = userData.diario || [];
    const racha = userData.rachaActual || 0;
    const level = userData.nivel || 2.5;

    // AI Base state
    let state = {
        text: "SINCRONIZANDO CON EL NEXO...",
        confidence: 30,
        protocol: "STANDBY"
    };

    if (journal.length === 0) {
        state.confidence = 45;
        state.text = "Operativo detectado. Para activar el análisis de rendimiento avanzado, registra tu primera entrada en el Diario de la Matrix.";
        state.protocol = "CALIBRACIÓN";
        return state;
    }

    // Process latest journal entry
    const latest = journal[journal.length - 1];
    state.confidence = Math.min(100, 50 + (journal.length * 8));

    // Intelligence Synthesis logic
    const defense = latest.defensa || 5;
    const volley = latest.volea || 5;
    const smash = latest.remate || 5;
    const vibora = latest.vibora || 5;

    // Pattern Recognition
    let dominantSkill = "";
    let weakestSkill = "consistencia";
    let skills = { defense, volley, smash, vibora };
    let minVal = 11;
    let maxVal = -1;

    for (let key in skills) {
        if (skills[key] > maxVal) { maxVal = skills[key]; dominantSkill = key; }
        if (skills[key] < minVal) { minVal = skills[key]; weakestSkill = key; }
    }

    // Contextual Logic
    if (minVal <= 4) {
        state.text = `ALERTA DE DESEQUILIBRIO: Tus registros indican una vulnerabilidad crítica en ${weakestSkill.toUpperCase()}. El nexo recomienda 20 minutos de cubeta enfocada en control antes de tu próxima misión.`;
        state.protocol = "PROTOCOLO REFUERZO";
    } else if (racha >= 3) {
        state.text = `DINÁMICA POSITIVA: Has encadenado ${racha} victorias. Tu confianza en ${dominantSkill} está en su punto álgido. Mantén la presión en la red y busca el cuerpo del rival en el resto.`;
        state.protocol = "DOMINACIÓN";
    } else if (latest.sensaciones === 'Cansado') {
        state.text = `FATIGA DETECTADA: Tras tu última sesión de combate, reportaste agotamiento. Reduce la velocidad de tus golpes y juega globos profundos para gestionar tu estamina.`;
        state.protocol = "AHORRO ENERGÉTICO";
    } else if (smash > 7 && level < 4) {
        state.text = `POTENCIA ELITE: Tu pegada por arriba es superior a la media de nivel ${level.toFixed(1)}. Úsala como señuelo amagando el remate para dejar una dormilona corta.`;
        state.protocol = "TACTICA ENGAÑO";
    } else {
        state.text = `ESTADO ESTABLE: Tus métricas de ${dominantSkill} y ${weakestSkill} están balanceadas. Enfócate en el juego cruzado para abrir ángulos y facilitar la entrada de tu compañero.`;
        state.protocol = "OPTIMIZACIÓN";
    }

    // Learning Factor
    if (journal.length > 10) {
        state.text += " He aprendido que tu rendimiento decae tras el segundo set. Hidratación con sales es imperativa.";
    }

    return state;
}

/**
 * Tactical Rival Assessment
 */
export function getCombatLogic(me, rival) {
    const diff = (rival.nivel || 2.5) - (me.nivel || 2.5);
    
    if (diff > 0.5) return "ADVERSARIO NIVEL S: Limita tus errores no forzados. Juega al centro y espera su precipitación. No busques el winner rápido.";
    if (diff < -0.5) return "VENTAJA TÁCTICA: Acelera el juego de volea. Presiona su revés y no dejes que respire en el fondo de pista.";
    return "MISIÓN EQUILIBRADA: La consistencia decidirá el enlace. Gana la red y mantén el volumen de bola alto.";
}
