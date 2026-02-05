/* js/modules/vecina-chat.js - Galactic AI v12.0 "Master Coach & Gossip" Edition */
import { auth, getDocument, db } from '../firebase-service.js';
import { collection, getDocs, query, where, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';

// --- ATOMIC STATE & CACHE ---
let chatOpen = false;
let userData = null;
let currentPersonality = 'coach'; // 'coach' or 'vecina'

const MEMORY = {
    intentsCount: JSON.parse(localStorage.getItem('ai_intents_count') || '{}'),
    lastInteraction: localStorage.getItem('ai_last_interaction'),
    tutorialDone: localStorage.getItem('ai_tutorial_done') === 'true'
};

const DATA_CACHE = {
    user: null,
    eloHistory: [],
    matches: [],
    globalUsers: [],
    lastUpdate: 0
};

// --- DATA LAYER (Private) ---

async function _syncData() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const now = Date.now();
    if (now - DATA_CACHE.lastUpdate < 300000 && DATA_CACHE.user) return; 

    try {
        const [uData, eloSnap, matchAmis, matchReto, usersSnap] = await Promise.all([
            getDocument('usuarios', uid),
            getDocs(query(collection(db, "rankingLogs"), where("uid", "==", uid), orderBy("timestamp", "desc"), limit(20))),
            getDocs(query(collection(db, "partidosAmistosos"), where("jugadores", "array-contains", uid), orderBy("fecha", "desc"), limit(20))),
            getDocs(query(collection(db, "partidosReto"), where("jugadores", "array-contains", uid), orderBy("fecha", "desc"), limit(20))),
            getDocs(query(collection(db, "usuarios"), limit(500)))
        ]);

        DATA_CACHE.user = uData;
        DATA_CACHE.eloHistory = eloSnap.docs.map(d => d.data());
        DATA_CACHE.matches = [
            ...matchAmis.docs.map(d => ({ ...d.data(), id: d.id, _col: 'amistoso' })),
            ...matchReto.docs.map(d => ({ ...d.data(), id: d.id, _col: 'reto' }))
        ].sort((a, b) => {
            const dA = a.fecha?.toDate?.() || new Date(a.fecha || 0);
            const dB = b.fecha?.toDate?.() || new Date(b.fecha || 0);
            return dB - dA;
        });
        DATA_CACHE.globalUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        DATA_CACHE.lastUpdate = now;
        userData = uData; 
    } catch (e) {
        console.error("AI Data Layer Error:", e);
    }
}

// --- ANALYSIS LAYER (Private) ---

const Analyzer = {
    getEloTrend: () => {
        if (DATA_CACHE.eloHistory.length < 2) return 'ESTABLE';
        const recent = DATA_CACHE.eloHistory[0].newTotal || 1000;
        const old = DATA_CACHE.eloHistory[Math.min(5, DATA_CACHE.eloHistory.length - 1)].newTotal || 1000;
        if (recent > old + 15) return '📈 ALZA FUERTE';
        if (recent < old - 15) return '📉 CAÍDA';
        return 'ESTABLE';
    },

    getLastMatchInfo: () => {
        const last = DATA_CACHE.matches.find(m => m.estado === 'jugado' || m.resultado);
        if (!last) return null;
        const d = last.fecha?.toDate?.() || new Date(last.fecha);
        return {
            date: d.toLocaleDateString(),
            type: last._col === 'reto' ? 'Reto' : 'Amistoso',
            result: last.resultado?.sets || 'Finalizado'
        };
    },

    findNemesis: (uid) => {
        const defeatCounts = {};
        DATA_CACHE.matches.forEach(m => {
            if (!m.resultado?.sets || !m.jugadores) return;
            const myIdx = m.jugadores.indexOf(uid);
            if (myIdx === -1) return;
            const isTeam1 = myIdx < 2;
            const sets = m.resultado.sets.split(' ');
            let myS = 0, rivS = 0;
            sets.forEach(s => {
                const p = s.split('-').map(Number);
                if (p.length < 2) return;
                if (isTeam1) { p[0] > p[1] ? myS++ : rivS++; }
                else { p[1] > p[0] ? myS++ : rivS++; }
            });
            if (rivS > myS) {
                const rivs = isTeam1 ? [m.jugadores[2], m.jugadores[3]] : [m.jugadores[0], m.jugadores[1]];
                rivs.forEach(rid => { if (rid && rid !== uid) defeatCounts[rid] = (defeatCounts[rid] || 0) + 1; });
            }
        });
        const nemesisId = Object.keys(defeatCounts).reduce((a, b) => defeatCounts[a] > defeatCounts[b] ? a : b, null);
        return nemesisId ? { ...DATA_CACHE.globalUsers.find(u => u.id === nemesisId), count: defeatCounts[nemesisId] } : null;
    },

    predictMatch: (q) => {
        const words = q.split(' ');
        const players = DATA_CACHE.globalUsers.filter(u => {
            const name = (u.nombreUsuario || u.nombre || '').toLowerCase();
            return words.some(w => w.length > 3 && name.includes(w));
        });
        if (players.length < 2) return null;
        const p1 = players[0];
        const p2 = players[1];
        const score1 = (p1.nivel || 2.5) * 50 + (p1.victorias || 0);
        const score2 = (p2.nivel || 2.5) * 50 + (p2.victorias || 0);
        const prob1 = Math.round((score1 / (score1 + score2)) * 100);
        return { p1, p2, prob1 };
    }
};

// --- DIALOGUE LAYER (Private) ---

function _learnIntent(intent) {
    MEMORY.intentsCount[intent] = (MEMORY.intentsCount[intent] || 0) + 1;
    localStorage.setItem('ai_intents_count', JSON.stringify(MEMORY.intentsCount));
}

function _detectIntent(query) {
    const q = query.toLowerCase();
    if (q.includes('último') || q.includes('cuando jugue')) return 'LAST_MATCH';
    if (q.includes('némesis') || q.includes('quién me gana')) return 'NEMESIS';
    if (q.includes('tutorial') || q.includes('ayuda') || q.includes('cómo se usa')) return 'TUTORIAL';
    if (q.includes('racha')) return 'STREAK';
    if (q.includes('puntos') || q.includes('xp')) return 'XP';
    if (q.includes('ganaría') || q.includes('quién gana')) return 'PREDICT';
    if (q.includes('análisis') || q.includes('informe')) return 'REPORT';
    if (q.includes('consejo') || q.includes('tip')) return 'TIP';
    return 'GENERAL';
}

function _getGreeting() {
    const uid = auth.currentUser?.uid;
    const name = DATA_CACHE.user?.nombreUsuario || 'Jugador';
    const mostUsed = Object.keys(MEMORY.intentsCount).reduce((a, b) => MEMORY.intentsCount[a] > MEMORY.intentsCount[b] ? a : b, 'GENERAL');

    if (currentPersonality === 'coach') {
        if (mostUsed === 'REPORT') return `Hola ${name}. He analizado tus últimos 20 partidos. ¿Quieres ver el informe técnico?`;
        return `Listo para entrenar, ${name}. ¿Qué métrica de tu juego revisamos hoy?`;
    } else {
        if (mostUsed === 'NEMESIS') return `¡Vaya racha, cariñín! ¿Vienes a que te cuente quién te tiene gato hoy?`;
        return `¡Hola tesoro! Me han contado una cosa de la pista 3 que te vas a quedar muerta...`;
    }
}

function _getFunnyJoke() {
    const users = DATA_CACHE.globalUsers.filter(u => u.nombreUsuario);
    if (users.length === 0) return "Dicen que por aquí hay gente que calienta pidiendo una cerveza...";
    const r = users[Math.floor(Math.random() * users.length)];
    const jokes = [
        `¿Has visto a ${r.nombreUsuario}? El otro día falló un remate y le echó la culpa a la gravedad.`,
        `Me han dicho que ${r.nombreUsuario} se ha comprado una pala de 400€ a ver si así la bola pasa la red.`,
        `Ayer vi a ${r.nombreUsuario} entrenando... bueno, estaba sentado en el banco mirando el móvil.`,
        `Dicen que ${r.nombreUsuario} tiene un golpe secreto: se llama 'la caña' y lo usa en todos los puntos.`
    ];
    return jokes[Math.floor(Math.random() * jokes.length)];
}

// --- PUBLIC EXPORTS ---

export function initVecinaChat() {
    if (document.getElementById('vecina-chat-fab')) return;

    const fab = document.createElement('button');
    fab.id = 'vecina-chat-fab';
    fab.className = 'ai-fab';
    fab.innerHTML = `<i class="fas fa-robot"></i>`;
    fab.onclick = toggleChat;
    document.body.appendChild(fab);

    const chatHTML = `
        <div id="vecina-chat-panel" class="ai-chat-panel">
            <div class="ai-chat-header">
                <div class="personality-toggle" onclick="window.switchAiPersonality()">
                    <div id="p-avatar-bot" class="ai-avatar-box coach">
                        <i class="fas fa-user-tie"></i>
                    </div>
                </div>
                <div class="ai-header-info" onclick="window.switchAiPersonality()">
                    <span id="ai-bot-name" class="ai-title">COACH TÉCNICO</span>
                    <span id="ai-bot-tag" class="ai-subtitle">Análisis Profesional</span>
                </div>
                <button class="ai-close-btn" onclick="window.toggleAiChat()"><i class="fas fa-chevron-down"></i></button>
            </div>
            <div id="ai-messages" class="ai-chat-body"></div>
            <div class="ai-chat-input">
                <input type="text" id="ai-input-field" placeholder="Pregunta algo..." autocomplete="off">
                <button id="ai-send-btn"><i class="fas fa-paper-plane"></i></button>
            </div>
        </div>
        <style>
            .ai-chat-body { scroll-behavior: smooth; }
            .ai-analysis-shortcuts { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; margin-top: 10px; }
            .ai-shortcut { 
                background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); 
                padding: 10px; border-radius: 14px; font-size: 0.65rem; font-weight: 800; 
                cursor: pointer; transition: 0.2s; display: flex; align-items: center; gap: 6px;
                text-transform: uppercase; color: #fff;
            }
            .ai-shortcut:hover { background: var(--primary); color: #000; border-color: var(--primary); transform: translateY(-2px); }
            .ai-tutorial-card { background: rgba(0,0,0,0.2); border: 1px solid var(--primary-glow); border-radius: 16px; padding: 15px; margin: 10px 0; border-left: 4px solid var(--primary); }
            .ai-tutorial-title { font-weight: 900; font-size: 0.8rem; color: var(--primary); margin-bottom: 8px; display: block; }
            .ai-step { display: flex; gap: 10px; margin-bottom: 6px; font-size: 0.7rem; color: #ccc; }
            .ai-step i { color: var(--primary); width: 12px; }
            .ai-predict-card { background: rgba(0,0,0,0.4); border-radius: 12px; padding: 12px; text-align: center; margin: 10px 0; border: 1px solid var(--secondary); }
            .predict-vs { font-weight: 900; font-size: 1.2rem; color: #fff; margin: 5px 0; }
            .predict-prob { color: var(--secondary); font-size: 0.7rem; font-weight: 700; }
        </style>
    `;
    document.body.insertAdjacentHTML('beforeend', chatHTML);

    document.getElementById('ai-send-btn').onclick = sendMessage;
    document.getElementById('ai-input-field').onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };

    window.toggleAiChat = toggleChat;
    window.switchAiPersonality = switchAiPersonality;
    window.aiQuickCmd = (cmd) => {
        const inp = document.getElementById('ai-input-field');
        if (cmd === 'last') inp.value = '¿Cuándo fue mi último partido?';
        else if (cmd === 'nemesis') inp.value = '¿Quién es mi némesis?';
        else if (cmd === 'report') inp.value = 'Dame un análisis de mi rendimiento';
        else if (cmd === 'tutorial') inp.value = 'Tutorial de la app';
        else if (cmd === 'xp') inp.value = '¿Cuántos puntos XP tengo?';
        sendMessage();
    };
}

export function switchAiPersonality(target) {
    const name = document.getElementById('ai-bot-name');
    const tag = document.getElementById('ai-bot-tag');
    const avatar = document.getElementById('p-avatar-bot');
    const welcome = document.getElementById('ai-welcome-msg');
    
    currentPersonality = target || (currentPersonality === 'coach' ? 'vecina' : 'coach');
    
    if (currentPersonality === 'coach') {
        name.textContent = "COACH TÉCNICO";
        tag.textContent = "Análisis Profesional";
        avatar.className = "ai-avatar-box coach";
        avatar.innerHTML = `<i class="fas fa-user-tie"></i>`;
    } else {
        name.textContent = "VECINA AP";
        tag.textContent = "La Radio del Circuito";
        avatar.className = "ai-avatar-box vecina";
        avatar.innerHTML = `<i class="fas fa-face-grin-tears"></i>`;
    }
}

export async function toggleChat() {
    const panel = document.getElementById('vecina-chat-panel');
    const fab = document.getElementById('vecina-chat-fab');
    if (!panel) return;

    chatOpen = !chatOpen;
    
    if (chatOpen) {
        panel.classList.add('open');
        fab.classList.add('hidden');
        document.getElementById('ai-input-field')?.focus();
        
        await _syncData();
        const msgContainer = document.getElementById('ai-messages');
        if (msgContainer && msgContainer.children.length === 0) {
            addMessage(_getGreeting(), 'bot');
            addMessage(`
                <div class="ai-analysis-shortcuts">
                    <div class="ai-shortcut" onclick="window.aiQuickCmd('last')"><i class="fas fa-history"></i> Último</div>
                    <div class="ai-shortcut" onclick="window.aiQuickCmd('nemesis')"><i class="fas fa-skull"></i> Némesis</div>
                    <div class="ai-shortcut" onclick="window.aiQuickCmd('xp')"><i class="fas fa-star"></i> Mis XP</div>
                    <div class="ai-shortcut" onclick="window.aiQuickCmd('tutorial')"><i class="fas fa-graduation-cap"></i> Tutorial</div>
                </div>
            `, 'bot');
        }
    } else {
        panel.classList.remove('open');
        fab.classList.remove('hidden');
    }
}

export async function sendMessage() {
    const input = document.getElementById('ai-input-field');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    
    addMessage(text, 'user');
    input.value = '';
    
    const tid = addTyping();
    const response = await generateResponse(text);
    setTimeout(() => {
        removeTyping(tid);
        addMessage(response, 'bot');
    }, 600 + Math.random() * 800);
}

export async function generateResponse(query) {
    const intent = _detectIntent(query);
    _learnIntent(intent);
    await _syncData();
    const uid = auth.currentUser?.uid;
    if (!uid) return "Cariño, identifícate o no podré acceder a tu ficha.";

    const respond = (c, v) => currentPersonality === 'coach' ? c : v;

    switch (intent) {
        case 'TUTORIAL':
            localStorage.setItem('ai_tutorial_done', 'true');
            return `
                <div class="ai-tutorial-card">
                    <span class="ai-tutorial-title">GUÍA PADELUMINATIS PRO</span>
                    <div class="ai-step"><i class="fas fa-calendar-alt"></i><b>Reservar:</b> Pulsa el botón central '+' para elegir pista y hora.</div>
                    <div class="ai-step"><i class="fas fa-users"></i><b>Matchmaking:</b> En el Calendario, si ves un hueco con '+', pulsa para unirte.</div>
                    <div class="ai-step"><i class="fas fa-trophy"></i><b>ELO:</b> Tus puntos suben al ganar retos oficiales.</div>
                    <div class="ai-step"><i class="fas fa-robot"></i><b>IA:</b> Pregúntame sobre cualquier jugador o tu racha.</div>
                </div>
                <p class="mt-2" style="font-size:0.75rem">¿Quieres que analice tu último partido para empezar?</p>
            `;

        case 'LAST_MATCH':
            const last = Analyzer.getLastMatchInfo();
            if (!last) return respond("No tienes partidos registrados aún.", "Hija, apúntate a algo, que se te va a oxidar la pala.");
            return respond(
                `<div class="ai-stat-card">
                    <div class="ai-stat-header">HISTORIAL RECIENTE</div>
                    <div class="ai-stat-row"><span>Fecha</span><strong>${last.date}</strong></div>
                    <div class="ai-stat-row"><span>Tipo</span><strong>${last.type}</strong></div>
                    <div class="ai-stat-row"><span>Resultado</span><strong>${last.result}</strong></div>
                </div>`,
                `Jugaste el ${last.date}. El resultado fue ${last.result}. ¡Espero que sudaras la camiseta!`
            );

        case 'NEMESIS':
            const nemesis = Analyzer.findNemesis(uid);
            if (!nemesis) return respond("Aún no tienes un rival dominante detectado.", "¡Nadie te gana lo suficiente! Eres el terror de las pistas.");
            return respond(
                `Tu némesis es <b>${nemesis.nombreUsuario}</b>. Te ha ganado ${nemesis.count} veces. Debemos analizar su juego de revés.`,
                `¡Ay, alma cántara! <b>${nemesis.nombreUsuario}</b> te tiene tomada la medida. ${nemesis.count} veces te ha dado pal pelo.`
            );

        case 'XP':
            const xp = DATA_CACHE.user?.xp || 0;
            const ptsNext = 1000 - (xp % 1000);
            return respond(
                `Tienes <b>${xp} FamilyXP</b>. Te faltan ${ptsNext} puntos para subir al siguiente rango de beneficios.`,
                `Llevas <b>${xp} puntitos</b>. A ver si te mueves más, que los puntos no caen del cielo como la lluvia.`
            );

        case 'PREDICT':
            const p = Analyzer.predictMatch(query);
            if (!p) return respond("Necesito los nombres de dos jugadores para la simulación.", "Dime quiénes juegan y te diré quién llorará en el bar.");
            return respond(
                `<div class="ai-predict-card">
                    <span class="ai-tutorial-title">PREDICCIÓN TÁCTICA</span>
                    <div class="predict-vs">${p.p1.nombreUsuario} vs ${p.p2.nombreUsuario}</div>
                    <div class="predict-prob">Probabilidad de victoria para ${p.p1.nombreUsuario}: <b>${p.prob1}%</b></div>
                </div>`,
                `¡Menudo salseo! Yo apuesto a que <b>${p.prob1 > 50 ? p.p1.nombreUsuario : p.p2.nombreUsuario}</b> barre la pista con el otro.`
            );

        case 'REPORT':
            const trend = Analyzer.getEloTrend();
            const wr = DATA_CACHE.user.partidosJugados > 0 ? Math.round((DATA_CACHE.user.victorias / DATA_CACHE.user.partidosJugados) * 100) : 0;
            return respond(
                `<div class="ai-stat-card">
                    <div class="ai-stat-header">INFORME TÉCNICO</div>
                    <div class="ai-stat-row"><span>Eficiencia</span><strong>${wr}%</strong></div>
                    <div class="ai-stat-row"><span>Tendencia ELO</span><strong>${trend}</strong></div>
                </div>`,
                `Llevas un ${wr}% de victorias. La tendencia es ${trend}. Traducido: o espabilas o te borro del grupo.`
            );

        case 'TIP':
            const tips = [
                "Busca siempre el centro de la pista para generar confusión entre los rivales.",
                "Si el sol te molesta, usa globos altos para obligar al rival a mirar arriba.",
                "Asegura siempre el primer servicio, aunque tenga menos potencia.",
                "En el fondo de pista, flexiona las rodillas; mejorarás el control del golpe enormemente."
            ];
            return respond(
                `Consejo del Coach: ${tips[Math.floor(Math.random() * tips.length)]}`,
                "¡Cariño! El mejor consejo es que te compres ropa que combine, que así aunque pierdas vas divina."
            );

        default:
            if (currentPersonality === 'vecina') return _getFunnyJoke();
            return respond(
                "Estoy procesando tus datos. ¿Quieres ver el tutorial o analizar tu ELO?",
                "No me cuentes milongas y dime qué quieres saber, que tengo la cafetera puesta."
            );
    }
}

export function addMessage(content, type) {
    const container = document.getElementById('ai-messages');
    if (!container) return;
    const msg = document.createElement('div');
    msg.className = `ai-msg ${type} animate-fade-in`;
    msg.innerHTML = type === 'user' ? `<p>${content}</p>` : (content.startsWith('<') ? content : `<p>${content}</p>`);
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
}

export function addTyping() {
    const container = document.getElementById('ai-messages');
    const id = 'typing-' + Date.now();
    const msg = document.createElement('div');
    msg.id = id;
    msg.className = 'ai-msg bot typing';
    msg.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
    return id;
}

export function removeTyping(id) {
    document.getElementById(id)?.remove();
}
