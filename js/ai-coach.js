/* ai-coach.js - Advanced Analysis Engine (v1.0) */

/**
 * Analyzes player journal entries to generate a training focus.
 * @param {Array} journal - List of diary entries
 * @returns {Object} Analysis result with focus area and specific advice.
 */
export function analyzePerformance(journal) {
    if (!journal || journal.length < 3) {
        return {
            status: "DATOS INSUFICIENTES",
            focus: "Juega más partidos",
            advice: "Registra al menos 3 partidos en tu diario para activar el análisis de tu Coach Virtual.",
            trend: "flat"
        };
    }

    const recent = journal.slice(-5); // Last 5 matches
    const avg = {
        defensa: 0,
        volea: 0,
        ataque: 0,
        fisico: 0
    };

    recent.forEach(e => {
        avg.defensa += parseInt(e.defensa || 5);
        avg.volea += parseInt(e.volea || 5);
        avg.ataque += parseInt(e.ataque || 5);
        avg.fisico += parseInt(e.fisico || 5);
    });

    // Calculate averages
    for (let k in avg) avg[k] /= recent.length;

    // Identify Weakness
    const sorted = Object.entries(avg).sort((a, b) => a[1] - b[1]); // Ascending
    const weakness = sorted[0]; // [key, value]
    const strength = sorted[sorted.length - 1];

    return generateAdvice(weakness[0], weakness[1], strength[0]);
}

function generateAdvice(weakArea, score, strongArea) {
    const strategies = {
        defensa: {
            title: "SOLIDEZ DEFENSIVA",
            drills: ["Globos profundos desde rincón", "Salida de pared baja", "Bloqueo de bajada"],
            tip: "Tu defensa está sufriendo. Concéntrate en pasar una bola más, no en ganar el punto desde atrás. Usa el globo para recuperar la red.",
            color: "text-blue-400"
        },
        volea: {
            title: "CONTROL DE RED",
            drills: ["Volea de bloqueo", "Volea profunda al centro", "Bandeja de seguridad"],
            tip: "Estás fallando en la red. Reduce la velocidad de tu volea y busca profundidad y colocación en lugar de potencia.",
            color: "text-green-400"
        },
        ataque: {
            title: "DEFINICIÓN",
            drills: ["Remate por 3", "Vibora a la reja", "Ganar la red rápido"],
            tip: "Te falta pegada. No te apresures a definir. Prepara el punto con bandejas hasta que tengas la bola fácil para sacarla.",
            color: "text-red-400"
        },
        fisico: {
            title: "RESISTENCIA Y PIERNAS",
            drills: ["Series de velocidad", "Desplazamientos laterales", "Coordinación"],
            tip: "Tu físico te limita. Llega antes a la bola flexionando las piernas. El pádel se juega con los pies, no con la mano.",
            color: "text-orange-400"
        }
    };

    const advice = strategies[weakArea];
    
    return {
        status: "ANÁLISIS COMPLETADO",
        focus: advice.title,
        advice: advice.tip,
        drills: advice.drills,
        strength: strongArea.toUpperCase(),
        score: score.toFixed(1),
        meta: advice
    };
}

/**
 * Calculates 'Court Condition Index' based on weather data
 */
export function calculateCourtCondition(temp, rain, wind) {
    let condition = "ESTÁNDAR";
    let message = "Condiciones normales de juego.";
    let ballBehavior = "Rebote medio.";
    let icon = "fa-check-circle";
    let color = "text-green-400";

    if (rain > 40) {
        condition = "CRÍTICO";
        message = "Pista posiblemente mojada. Cristal peligroso.";
        ballBehavior = "Bola muy pesada, no sale.";
        icon = "fa-cloud-showers-heavy";
        color = "text-red-400";
    } else if (temp < 10) {
        condition = "FRÍA / LENTA";
        message = "Cristal muy rápido, rebote bajo.";
        ballBehavior = "Bola dura, cuesta sacarla x3.";
        icon = "fa-snowflake";
        color = "text-blue-300";
    } else if (temp > 25) {
        condition = "RÁPIDA";
        message = "La bola vuela. Saca por 3 fácil.";
        ballBehavior = "Mucho rebote. Controla los globos.";
        icon = "fa-fire";
        color = "text-orange-500";
    } else if (wind > 20) {
        condition = "VENTOSA";
        message = "Evita globos altos. Juega por abajo.";
        ballBehavior = "Trayectorias impredecibles.";
        icon = "fa-wind";
        color = "text-gray-400";
    }

    return { condition, message, ballBehavior, icon, color };
}
