/* =====================================================
   PADELUMINATIS AI SERVICE - THE NEURAL NEXUS V5.0
   Centralized AI logic (Coach, Tactician, Vecina AP).
   ===================================================== */

import { auth, db, getDocument } from '../firebase-service.js';
import { collection, getDocs, query, where, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { getDetailedWeather } from '../external-data.js';

let userData = null;
let allUsers = [];

const FUNNY_PHRASES = [
    "Ahora no me apetece responderte, búscate la vida.",
    "Eres un pesado, ¿no tienes amigos con los que hablar? Ah no, que juegas al pádel.",
    "Háblale a tu amigo <user> y marea a ese, a mí déjame en paz.",
    "Te deja en visto la persona que te gusta y ¿te crees que yo te voy a contestar a esa tontería?",
    "Estoy ocupada analizando por qué <user> cree que sabe jugar.",
    "¿Tú crees que <user> está bien de la cabeza? Yo creo que no.",
    "No me preguntes cosas difíciles, todavía estoy superando el último set que perdió <user>.",
    "¿Otro mensaje? <user> me dijo que eras intenso, pero no pensaba que tanto.",
    "Si fallaras menos voleas y me escribieras menos, serías mejor jugador.",
    "Dile a <user> que su revés es un insulto al deporte, gracias.",
    "He visto cacatúas con mejor smash que <user>.",
    "¿Sabes qué tienen en común <user> y una nevera? Que los dos se quedan parados en la red.",
    "Si el pádel fuera el Titanic, <user> sería el que toca el violín mientras se hunde el set.",
    "Me han dicho que <user> está buscando su dignidad en el cristal del fondo.",
    "¿Quieres un consejo? No juegues como <user>.",
    "El nivel de <user> es tan bajo que Google Maps lo marca como fosa común.",
    "¿Has probado a jugar al parchís? Es que el pádel no parece lo tuyo, ni lo de <user>.",
    "Menos postureo con la pala de 400€ y más aprender de <user>... bueno, de <user> no, de alguien que sepa."
];

export async function initAIService() {
    if (auth.currentUser) {
        userData = await getDocument('usuarios', auth.currentUser.uid);
        try {
            const snap = await getDocs(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"), limit(50)));
            allUsers = snap.docs.map(d => d.data().nombreUsuario || d.data().nombre || 'Jugador');
        } catch(e) {}
    }
}

export async function processVecinaQuery(qText) {
    const lower = qText.toLowerCase();
    
    if (lower.includes('ranking') || lower.includes('puntos')) {
        const snap = await getDocs(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc")));
        const rank = snap.docs.findIndex(d => d.id === auth.currentUser.uid) + 1;
        return `<div class="rich-bot-card"><div class="card-rank-tag">#${rank} EN EL MUNDO</div><div class="card-main-val">${Math.round(userData?.puntosRanking || 1000)} PTS</div><p class="text-xs opacity-70 mt-2">Sigue así y algún día alcanzarás a <user>.</p></div>`.replace(/<user>/g, `<span class="user-highlight">${allUsers[0] || 'el top 1'}</span>`);
    }
    
    if (lower.includes('llueve') || lower.includes('tiempo') || lower.includes('clima')) {
        const w = await getDetailedWeather();
        if (w && w.current) {
            const cond = calculateCourtCondition(w.current.temperature_2m, w.current.rain, w.current.wind_speed_10m);
            return `
                <div class="rich-bot-card weather">
                    <i class="fas ${cond.icon} ${cond.color} text-4xl mb-2"></i>
                    <div class="card-main-val">${Math.round(w.current.temperature_2m)}°C</div>
                    <p class="text-xs font-bold uppercase mt-1">${cond.condition}</p>
                    <p class="text-xs italic opacity-80 mt-1">${cond.advice}</p>
                </div>
            `;
        }
    }

    if (lower.includes('bola') || lower.includes('pala') || lower.includes('equipo')) {
        return `<div class="rich-bot-card"><i class="fas fa-table-tennis-paddle-ball text-3xl text-primary mb-2"></i><p class="text-xs">Usa bolas nuevas si quieres ganar. <user> siempre juega con bolas de hace 3 meses para no gastar.</p></div>`.replace(/<user>/g, `<span class="user-highlight">${allUsers[Math.floor(Math.random()*allUsers.length)]}</span>`);
    }

    if (lower.includes('ganar') || lower.includes('truco') || lower.includes('consejo')) {
        const tips = [
            "Tira globos al que peor remate de los dos.",
            "Si <user> está en la red, tírale al cuerpo. No falla.",
            "Mantén la calma, la mayoría de puntos se pierden por errores no forzados.",
            "Bebe agua, que pareces un higo paso en la pista."
        ];
        const tip = tips[Math.floor(Math.random() * tips.length)];
        return `<div class="rich-bot-cardTactics"><i class="fas fa-lightbulb text-yellow-400 text-3xl mb-2"></i><p class="text-sm font-bold">${tip.replace(/<user>/g, allUsers[1] || 'el rival')}</p></div>`;
    }

    return getFunnyPhrase();
}

function getFunnyPhrase() {
    const randomUser = allUsers[Math.floor(Math.random() * allUsers.length)] || 'alguien';
    const phrase = FUNNY_PHRASES[Math.floor(Math.random() * FUNNY_PHRASES.length)];
    return phrase.replace(/<user>/g, `<span class="user-highlight">${randomUser}</span>`);
}
/**
 * Calculate Court Condition based on weather
 */
export function calculateCourtCondition(temp, rain, wind) {
    if (rain > 0.5) return { condition: "Bajo Agua", icon: "fa-cloud-showers-heavy", color: "text-blue-500", advice: "Pista impracticable. ¡Mejor quédate en casa!" };
    if (temp > 35) return { condition: "Calor Extremo", icon: "fa-temperature-high", color: "text-red-500", advice: "Pista ultra rápida. Mucha hidratación." };
    if (temp < 10) return { condition: "Frío", icon: "fa-snowflake", color: "text-cyan-400", advice: "Bolas pesadas y poco rebote. Calienta bien." };
    if (wind > 25) return { condition: "Mucho Viento", icon: "fa-wind", color: "text-gray-400", advice: "Evita los globos altos, juega por abajo." };
    return { condition: "Óptima", icon: "fa-sun", color: "text-sport-green", advice: "Condiciones perfectas para jugar." };
}
