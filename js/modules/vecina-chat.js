/* js/modules/vecina-chat.js - Vecina AP v7.0 God Mode Sass Edition */
import { showToast } from '../ui-core.js';
import { getDocument, db, auth } from '../firebase-service.js';
import { collection, getDocs, query, where, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { getDetailedWeather } from '../external-data.js';

let isOpen = false;
let userData = null;
let allUsers = [];

const FUNNY_PHRASES = [
    "Ahora no me apetece responderte, búscate la vida.",
    "Eres un pesado, ¿no tienes amigos con los que hablar? Ah no, que juegas al pádel.",
    "Hablale a tu amigo <user> y marea a ese, a mí déjame en paz.",
    "Te deja en visto la persona que te gusta y ¿te crees que yo te voy a contestar a esa tontería?",
    "Estoy ocupada analizando por qué <user> cree que sabe jugar.",
    "¿Tú crees que <user> está bien de la cabeza? Yo creo que no.",
    "No me preguntes cosas difíciles, todavía estoy superando el último set que perdió <user>.",
    "¿Otro mensaje? <user> me dijo que eras intenso, pero no pensaba que tanto.",
    "Si fallaras menos voleas y me escribieras menos, serías mejor jugador.",
    "Estoy instalando una actualización para ignorarte mejor.",
    "Error 404: Paciencia no encontrada.",
    "Dile a <user> que su revés es un insulto al deporte, gracias.",
    "¿Sabes qué tiene en común tu juego y mi paciencia? Que ninguno de los dos existe.",
    "Tu nivel de pádel es como mi conexión a internet en los 90: Lento y ruidoso.",
    "Si la estupidez fuera puntos ELO, serías el número 1 del mundo."
];

const CAPABILITIES = [
    { id: 'ranking', label: '📊 Mi posición real', icon: 'fa-ranking-star' },
    { id: 'top3', label: '🏆 El Olimpo (Top 3)', icon: 'fa-trophy' },
    { id: 'next', label: '📅 ¿Cuándo juego?', icon: 'fa-calendar-day' },
    { id: 'stats', label: '📈 Mis números', icon: 'fa-chart-simple' },
    { id: 'weather', label: '☀️ ¿Llueve hoy?', icon: 'fa-cloud-sun-rain' },
    { id: 'level_info', label: '⭐ ¿Cómo subo nivel?', icon: 'fa-star' },
    { id: 'daily_tip', label: '💡 Consejo Táctico', icon: 'fa-lightbulb' },
    { id: 'rivals', label: '⚔️ Próximas víctimas', icon: 'fa-skull-crossbones' },
    { id: 'joke', label: '🤣 Bordería aleatoria', icon: 'fa-face-laugh-beam' }
];

export async function initVecinaChat() {
    if (document.getElementById('vecina-chat')) return;
    if (auth.currentUser) userData = await getDocument('usuarios', auth.currentUser.uid);
    try {
        const snap = await getDocs(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"), limit(50)));
        allUsers = snap.docs.map(d => d.data().nombreUsuario || d.data().nombre || 'Jugador');
    } catch(e) {}

    const chatHTML = `
        <div id="vecina-chat" class="chat-sheet">
            <div class="chat-header">
                <div class="flex-row gap-3">
                    <div class="vecina-avatar"><i class="fas fa-robot"></i></div>
                    <div class="flex-col gap-0">
                        <span class="font-bold">Vecina AP v7.0</span>
                        <span class="text-2xs opacity-70">IA Border y Omnisciente 😏</span>
                    </div>
                </div>
                <div class="flex-row gap-2">
                    <button class="chat-btn" id="clear-vecina" title="Borrar Conversación"><i class="fas fa-trash-can"></i></button>
                    <button class="chat-btn" id="close-vecina"><i class="fas fa-times"></i></button>
                </div>
            </div>
            
            <div class="chat-body" id="vecina-msgs">
                <div class="msg bot">
                    Hola <span class="user-highlight">${userData?.nombreUsuario || 'tú'}</span>. 
                    Tengo acceso a todo el circuito Padeluminatis. 
                    Si quieres saber por qué sigues en el mismo nivel que hace un año, dímelo.
                </div>
            </div>
            
            <div class="chat-actions scroll-x">
                ${CAPABILITIES.map(c => `
                    <button class="action-chip" onclick="vecinaQuery('${c.id}')" title="${c.label}">
                        <i class="fas ${c.icon}"></i>
                    </button>
                `).join('')}
            </div>
            
            <div class="chat-input-area">
                <input type="text" id="vecina-input" class="chat-input" placeholder="Pregunta algo, si te atreves...">
                <button class="btn-icon send-btn" onclick="sendVecinaMsg()"><i class="fas fa-paper-plane"></i></button>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', chatHTML);
    document.getElementById('close-vecina').onclick = toggleChat;
    document.getElementById('clear-vecina').onclick = clearChat;
    document.getElementById('vecina-input').onkeypress = (e) => { if (e.key === 'Enter') sendVecinaMsg(); };
}

export function toggleChat() {
    document.getElementById('vecina-chat')?.classList.toggle('active');
}

export function clearChat() {
    const box = document.getElementById('vecina-msgs');
    if (box) box.innerHTML = `<div class="msg bot">Memoria limpia. Mi CPU agradece no tener que guardar tus tonterías. ¿Qué quieres ahora?</div>`;
    showToast('Limpieza', 'Historial borrado', 'info');
}

window.sendVecinaMsg = async () => {
    const input = document.getElementById('vecina-input');
    const txt = input.value.trim();
    if (!txt) return;
    addMsg(txt, 'user');
    input.value = '';
    await processQuery(txt);
};

window.vecinaQuery = async (type) => {
    const cap = CAPABILITIES.find(c => c.id === type);
    addMsg(cap?.label || type, 'user');
    await processQuery(type);
};

async function processQuery(qText) {
    showTyping();
    await new Promise(r => setTimeout(r, 700 + Math.random() * 800));
    const lower = qText.toLowerCase();
    let response = '';

    try {
        if (lower.includes('ranking') || lower.includes('posición')) {
            const snap = await getDocs(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc")));
            const rank = snap.docs.findIndex(d => d.id === auth.currentUser.uid) + 1;
            response = `Estás en el puesto <strong>#${rank}</strong>. Para estar más arriba, tendrías que empezar a ganar partidos, que parece que se te olvida.`;
            
        } else if (lower.includes('top3') || lower.includes('olimpio')) {
            const snap = await getDocs(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"), limit(3)));
            const tops = snap.docs.map((d, i) => `<strong>#${i+1}</strong> ${d.data().nombreUsuario || d.data().nombre}`).join('<br>');
            response = `Los amos de la pista:<br><br>${tops}<br><br>Míralos bien, es lo más cerca que estarás de un trofeo.`;

        } else if (lower.includes('cuándo') || lower.includes('juego') || lower.includes('próximo')) {
            const matches = await getUpcomingMatches();
            if (matches.length > 0) {
                const m = matches[0];
                const date = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);
                response = `Juegas el <strong>${date.toLocaleDateString('es-ES', {weekday:'long', day:'numeric'})}</strong> a las <strong>${date.getHours()}:${date.getMinutes().toString().padStart(2,'0')}</strong>. <br><br>Aceptan cancelaciones si te entra miedo, que sería lo normal.`;
            } else {
                response = "¿Cuándo juegas? Pues parece que nunca. No tienes nada reservado, vago.";
            }

        } else if (lower.includes('llueve') || lower.includes('clima') || lower.includes('tiempo')) {
            const w = await getDetailedWeather();
            if (w) {
                const temp = Math.round(w.current?.temperature_2m || w.hourly?.temperature_2m[new Date().getHours()]);
                response = `Hace <strong>${temp}°C</strong>. Si hace sol no tienes excusa, y si llueve al menos así no se ve que estás sudando de puro nervio.`;
            } else {
                response = "Haz lo que la gente normal: saca la mano por la ventana.";
            }

        } else if (lower.includes('nivel') || lower.includes('subir')) {
            response = "Para subir nivel necesitas: <br>1. Ganar partidos de Reto (⚡). <br>2. Dejar de darle al cristal de fondo. <br>3. Tener un poco de dignidad. <br><br>Empieza por lo que veas más fácil.";

        } else if (lower.includes('consejo') || lower.includes('tip')) {
            const tips = ["El globo es tu amigo, no tu enemigo.", "No pegues a la bola, favorécela.", "La red se gana caminando, no corriendo.", "El revés no es un adorno."];
            response = `Consejo: <strong>${tips[Math.floor(Math.random()*tips.length)]}</strong>. <br><br>De nada, aunque sé que lo vas a ignorar.`;

        } else {
            response = getFunnyPhrase();
        }
    } catch (e) {
        response = "Error interno. Lo mismo que le pasa a tu técnica de derecha.";
    }
    
    hideTyping();
    addMsg(response, 'bot');
}

async function getUpcomingMatches() {
    const now = new Date();
    const [am, re] = await Promise.all([
        getDocs(query(collection(db, "partidosAmistosos"), where("jugadores", "array-contains", auth.currentUser.uid))),
        getDocs(query(collection(db, "partidosReto"), where("jugadores", "array-contains", auth.currentUser.uid)))
    ]);
    let list = [];
    am.forEach(d => { if (d.data().estado !== 'jugado') list.push({ id: d.id, ...d.data() }); });
    re.forEach(d => { if (d.data().estado !== 'jugado') list.push({ id: d.id, ...d.data() }); });
    return list.filter(m => (m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha)) > now)
               .sort((a, b) => (a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha)) - (b.fecha?.toDate ? b.fecha.toDate() : new Date(b.fecha)));
}

function getFunnyPhrase() {
    const randomUser = allUsers[Math.floor(Math.random() * allUsers.length)] || 'alguien';
    const phrase = FUNNY_PHRASES[Math.floor(Math.random() * FUNNY_PHRASES.length)];
    return phrase.replace(/<user>/g, `<span class="user-highlight">${randomUser}</span>`);
}

function addMsg(text, type) {
    const box = document.getElementById('vecina-msgs');
    if (!box) return;
    const d = document.createElement('div');
    d.className = `msg ${type} animate-up`;
    d.innerHTML = text;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
}

function showTyping() {
    const box = document.getElementById('vecina-msgs');
    if (!box) return;
    const d = document.createElement('div');
    d.className = 'msg bot typing';
    d.id = 'typing-indicator';
    d.innerHTML = '<span></span><span></span><span></span>';
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
}

function hideTyping() {
    document.getElementById('typing-indicator')?.remove();
}
