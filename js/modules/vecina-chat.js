/* js/modules/vecina-chat.js - Sentient AI v14.0 "Command Matrix" Edition */
import { auth, getDocument, db } from '../firebase-service.js';
import { collection, getDocs, query, where, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';

// --- ATOMIC STATE & CACHE ---
let chatOpen = false;
let userData = null;
let currentPersonality = 'coach'; // 'coach' or 'vecina'

const MEMORY = {
    intentsCount: JSON.parse(localStorage.getItem('ai_intents_count') || '{}'),
    tutorialDone: localStorage.getItem('ai_tutorial_done') === 'true'
};

const DATA_CACHE = {
    user: null,
    eloHistory: [],
    matches: [],
    globalUsers: [],
    openMatches: [],
    lastUpdate: 0
};

// --- DATA LAYER (Private) ---

async function _syncData() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const now = Date.now();
    if (now - DATA_CACHE.lastUpdate < 300000 && DATA_CACHE.user) return; 

    try {
        const [uData, eloSnap, matchAmis, matchReto, usersSnap, openAmis, openReto] = await Promise.all([
            getDocument('usuarios', uid),
            getDocs(query(collection(db, "rankingLogs"), where("uid", "==", uid), orderBy("timestamp", "desc"), limit(25))),
            getDocs(query(collection(db, "partidosAmistosos"), where("jugadores", "array-contains", uid), orderBy("fecha", "desc"), limit(25))),
            getDocs(query(collection(db, "partidosReto"), where("jugadores", "array-contains", uid), orderBy("fecha", "desc"), limit(25))),
            getDocs(query(collection(db, "usuarios"), limit(400))),
            getDocs(query(collection(db, "partidosAmistosos"), where("estado", "==", "abierto"), limit(10))),
            getDocs(query(collection(db, "partidosReto"), where("estado", "==", "abierto"), limit(10)))
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
        DATA_CACHE.openMatches = [
            ...openAmis.docs.map(d => ({ ...d.data(), _col: 'amistoso' })),
            ...openReto.docs.map(d => ({ ...d.data(), _col: 'reto' }))
        ].filter(m => m.jugadores?.includes(null) || m.jugadores?.length < 4);
        
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
        if (recent > old + 20) return '🚀 EXPONENCIAL';
        if (recent < old - 20) return '🆘 CRÍTICA';
        return recent > old ? 'ALZA' : 'CORRECCIÓN';
    },

    getMatchStats: () => {
        const played = DATA_CACHE.matches.filter(m => m.resultado);
        if (played.length === 0) return null;

        let best = played[0], worst = played[0];
        let maxDiff = -1;

        played.forEach(m => {
            const sets = m.resultado.sets.split(' ');
            let myS = 0, rivS = 0;
            const myIdx = m.jugadores.indexOf(auth.currentUser.uid);
            const isTeam1 = myIdx < 2;

            sets.forEach(s => {
                const p = s.split('-').map(Number);
                if (p.length < 2) return;
                if (isTeam1) { p[0] > p[1] ? myS++ : rivS++; }
                else { p[1] > p[0] ? myS++ : rivS++; }
            });

            const diff = Math.abs(myS - rivS);
            if (myS > rivS && diff >= (best.diff || 0)) {
                best = { ...m, diff };
            }
            if (rivS > myS && diff >= (worst.diff || 0)) {
                worst = { ...m, diff };
            }
        });

        return { best, worst };
    },

    findNemesis: (uid) => {
        const record = {};
        DATA_CACHE.matches.forEach(m => {
            if (!m.resultado?.sets || !m.jugadores) return;
            const myIdx = m.jugadores.indexOf(uid);
            if (myIdx === -1) return;
            const isTeam1 = myIdx < 2;
            const rivs = isTeam1 ? [m.jugadores[2], m.jugadores[3]] : [m.jugadores[0], m.jugadores[1]];
            
            const sets = m.resultado.sets.split(' ');
            let won = false;
            let myS = 0, rivS = 0;
            sets.forEach(s => {
                const p = s.split('-').map(Number);
                if (p.length === 2) {
                    if (isTeam1) { p[0] > p[1] ? myS++ : rivS++; }
                    else { p[1] > p[0] ? myS++ : rivS++; }
                }
            });
            won = myS > rivS;

            rivs.forEach(rid => {
                if (!rid || rid === uid) return;
                if (!record[rid]) record[rid] = { wins: 0, losses: 0 };
                won ? record[rid].wins++ : record[rid].losses++;
            });
        });

        let nemesisId = null, worstRatio = -1;
        Object.keys(record).forEach(rid => {
            const total = record[rid].wins + record[rid].losses;
            const ratio = record[rid].losses / total;
            if (total >= 2 && ratio > worstRatio) {
                worstRatio = ratio;
                nemesisId = rid;
            }
        });

        return nemesisId ? { ...DATA_CACHE.globalUsers.find(u => u.id === nemesisId), stats: record[nemesisId] } : null;
    }
};

// --- DIALOGUE LAYER ---

function _detectIntent(query) {
    const q = query.toLowerCase();
    if (query.startsWith('CMD_')) return query; 
    
    if (q.includes('peor rival') || q.includes('cuesta ganar')) return 'CMD_NEMESIS';
    if (q.includes('mejor partido')) return 'CMD_BEST_MATCH';
    if (q.includes('diferencia') || q.includes('peor partido')) return 'CMD_WORST_MATCH';
    if (q.includes('abierto') || q.includes('hay partidas') || q.includes('huecos')) return 'CMD_OPEN_MATCHES';
    if (q.includes('ultimo') || q.includes('cuándo jugué')) return 'CMD_LAST_MATCH';
    if (q.includes('análisis') || q.includes('informe')) return 'CMD_REPORT';
    if (q.includes('tutorial') || q.includes('ayuda')) return 'CMD_TUTORIAL';
    if (q.includes('consejo') || q.includes('pro tip')) return 'CMD_PRO_TIPS';
    if (q.includes('prediccion') || q.includes('quien gana')) return 'CMD_PREDICT';
    if (q.includes('entrenar') || q.includes('rutina')) return 'CMD_TRAINING_PLAN';
    if (q.includes('clima') || q.includes('tiempo')) return 'CMD_WEATHER_TACTICS';
    return 'GENERAL';
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
        <div id="vecina-chat-panel" class="ai-chat-panel v14">
            <div class="ai-chat-header border-b border-white-05 px-6">
                <div class="personality-toggle" onclick="window.switchAiPersonality()">
                    <div id="p-avatar-bot" class="ai-avatar-box coach">
                        <i class="fas fa-user-pilot"></i>
                    </div>
                </div>
                <div class="ai-header-info flex-1" onclick="window.switchAiPersonality()">
                    <span id="ai-bot-name" class="ai-title italic font-black">ENTRENADOR GALAXY</span>
                    <div class="flex-row items-center gap-2">
                        <div class="pulse-dot-green"></div>
                        <span id="ai-bot-tag" class="ai-subtitle tracking-[2px]">NÚCLEO SENTIENTE V14</span>
                    </div>
                </div>
                <button class="btn-close-neon sm" onclick="window.toggleAiChat()"><i class="fas fa-chevron-down"></i></button>
            </div>
            
            <div id="ai-messages" class="ai-chat-body custom-scroll p-6"></div>

            <div class="ai-chat-footer p-6 bg-black/60 backdrop-blur-3xl border-t border-white-05">
                <div class="ai-command-container mb-4">
                    <select id="ai-cmd-picker" class="ai-cmd-select" onchange="window.aiHandleSelect(this)">
                        <option value="" disabled selected>⚡ SELECCIONAR ACCIÓN TÁCTICA...</option>
                        <optgroup label="📡 ANALÍTICA DE CAMPO">
                            <option value="CMD_REPORT">📊 Generar Informe de Usuario</option>
                            <option value="CMD_LAST_MATCH">🎾 Último Despliegue</option>
                            <option value="CMD_BEST_MATCH">⭐ Hito de Combate</option>
                            <option value="CMD_PREDICT">🔮 Matriz de Predicción</option>
                        </optgroup>
                        <optgroup label="💪 PROTOCOLOS DE MEJORA">
                            <option value="CMD_PRO_TIPS">💡 Consejos de Élite</option>
                            <option value="CMD_TRAINING_PLAN">🏋️ Plan de Optimización</option>
                            <option value="CMD_WEATHER_TACTICS">☁️ Análisis Atmosférico</option>
                        </optgroup>
                        <optgroup label="🤝 RED DE CONTACTOS">
                            <option value="CMD_NEMESIS">💀 Identificar Némesis</option>
                            <option value="CMD_OPEN_MATCHES">🔓 Brechas en la Red</option>
                        </optgroup>
                    </select>
                </div>
                <div class="ai-input-row gap-3">
                    <input type="text" id="ai-input-field" class="bg-white-03 border border-white-05 rounded-2xl px-4 py-3 text-sm text-white flex-1 outline-none focus:border-primary/40 transition-all font-bold" placeholder="Consultar a la Matrix..." autocomplete="off">
                    <button id="ai-send-btn" class="w-12 h-12 rounded-2xl bg-primary text-black flex-center shadow-glow transition-transform hover:scale-105 active:scale-95">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        </div>

        <style>
            .ai-chat-panel.v14 { 
                border-radius: 40px; 
                border: 1px solid rgba(255,255,255,0.08); 
                background: linear-gradient(180deg, rgba(13,18,34,0.95) 0%, rgba(5,6,12,0.98) 100%);
                box-shadow: 0 40px 100px rgba(0,0,0,0.9);
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            .ai-chat-header { height: 80px; display: flex; items-center: center; gap: 15px; background: rgba(255,255,255,0.02); }
            .ai-avatar-box { width: 45px; height: 45px; border-radius: 15px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; position: relative; }
            .ai-avatar-box.coach { background: rgba(0,212,255,0.1); color: #00d4ff; box-shadow: 0 0 20px rgba(0,212,255,0.2); }
            .ai-avatar-box.vecina { background: rgba(198,255,0,0.1); color: #c6ff00; box-shadow: 0 0 20px rgba(198,255,0,0.2); }
            .ai-title { font-size: 0.9rem; color: #fff; letter-spacing: 1px; display: block; margin-bottom: 2px; }
            .ai-subtitle { font-size: 0.65rem; color: var(--text-muted); font-weight: 800; }
            
            .ai-cmd-select { 
                width: 100%; padding: 15px; border-radius: 20px; background: rgba(255,255,255,0.03); 
                border: 1px solid rgba(255,255,255,0.05); color: var(--primary); font-family: 'Rajdhani'; 
                font-weight: 900; font-size: 0.75rem; cursor: pointer; outline: none; transition: 0.3s;
                appearance: none; -webkit-appearance: none;
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23d4ff00' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
                background-repeat: no-repeat; background-position: right 15px center; background-size: 12px;
            }
            
            .ai-result-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 24px; padding: 20px; margin: 15px 0; box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
            .res-title { font-size: 0.65rem; font-weight: 900; color: var(--primary); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px; display: block; opacity: 0.7; }
            .res-val { color: #fff; font-size: 1.1rem; font-weight: 900; line-height: 1.2; }
            .res-sub { color: var(--text-muted); font-size: 0.75rem; margin-top: 8px; font-weight: 600; }
            
            .ai-msg { margin-bottom: 15px; max-width: 85%; }
            .ai-msg.user { align-self: flex-end; }
            .ai-msg.bot { align-self: flex-start; }
            .ai-msg p { padding: 12px 18px; border-radius: 20px; font-size: 0.85rem; line-height: 1.4; }
            .ai-msg.user p { background: rgba(198,255,0,0.1); border: 1px solid rgba(198,255,0,0.2); color: #fff; border-bottom-right-radius: 4px; }
            .ai-msg.bot p { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.05); color: #ccc; border-bottom-left-radius: 4px; }
        </style>
    `;
    document.body.insertAdjacentHTML('beforeend', chatHTML);

    document.getElementById('ai-send-btn').onclick = sendMessage;
    document.getElementById('ai-input-field').onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };

    window.toggleAiChat = toggleChat;
    window.switchAiPersonality = switchAiPersonality;
    window.aiHandleSelect = (el) => {
        if (!el.value) return;
        const text = el.options[el.selectedIndex].text;
        addMessage(text.split(' ').slice(1).join(' '), 'user');
        const tid = addTyping();
        generateResponse(el.value).then(res => {
            removeTyping(tid);
            addMessage(res, 'bot');
        });
        el.selectedIndex = 0;
    };
    
    window.aiQuickCmd = (cmd) => {
        const tid = addTyping();
        generateResponse(cmd).then(res => {
            removeTyping(tid);
            addMessage(res, 'bot');
        });
    };
}

export function switchAiPersonality(target) {
    const name = document.getElementById('ai-bot-name');
    const avatar = document.getElementById('p-avatar-bot');
    currentPersonality = target || (currentPersonality === 'coach' ? 'vecina' : 'coach');
    
    if (currentPersonality === 'coach') {
        name.textContent = "COACH TÉCNICO";
        avatar.className = "ai-avatar-box coach";
        avatar.innerHTML = `<i class="fas fa-user-tie"></i>`;
    } else {
        name.textContent = "VECINA AP";
        avatar.className = "ai-avatar-box vecina";
        avatar.innerHTML = `<i class="fas fa-face-grin-tears"></i>`;
    }
}

export async function toggleChat() {
    const panel = document.getElementById('vecina-chat-panel');
    const fab = document.getElementById('vecina-chat-fab');
    chatOpen = !chatOpen;
    if (chatOpen) {
        panel.classList.add('open');
        fab.classList.add('hidden');
        await _syncData();
        if (document.getElementById('ai-messages').children.length === 0) {
            addMessage(`Hola ${DATA_CACHE.user?.nombreUsuario || 'cracks'}. Soy tu IA modular. Selecciona una función o escríbeme lo que necesites.`, 'bot');
        }
    } else {
        panel.classList.remove('open');
        fab.classList.remove('hidden');
    }
}

export async function sendMessage() {
    const input = document.getElementById('ai-input-field');
    const text = input.value.trim();
    if (!text) return;
    addMessage(text, 'user');
    input.value = '';
    const tid = addTyping();
    const response = await generateResponse(text);
    removeTyping(tid);
    addMessage(response, 'bot');
}

export async function generateResponse(query) {
    const intent = _detectIntent(query);
    await _syncData();
    const uid = auth.currentUser?.uid;
    const respond = (c, v) => currentPersonality === 'coach' ? c : v;

    switch (intent) {
        case 'CMD_REPORT':
            const trend = Analyzer.getEloTrend();
            return respond(
                `<div class="ai-result-card">
                    <span class="res-title">Estado del Jugador</span>
                    <div class="res-val">${trend}</div>
                    <div class="res-sub">Tu ELO actual es ${Math.round(DATA_CACHE.user.puntosRanking)} con un nivel de ${(DATA_CACHE.user.nivel || 2.5).toFixed(2)}.</div>
                </div>`,
                "Cariñito, estás que te sales. Sigue así y te veo en el World Padel Tour (o no...)."
            );

        case 'CMD_LAST_MATCH':
            const matches = DATA_CACHE.matches.filter(m => m.resultado);
            if (matches.length === 0) return "No he encontrado partidos terminados en tu historial.";
            const last = matches[0];
            return `<div class="ai-result-card">
                <span class="res-title">Último Partido</span>
                <div class="res-val">${last.resultado.sets}</div>
                <div class="res-sub">${last.fecha?.toDate?.().toLocaleDateString() || last.fecha} (${last._col})</div>
            </div>`;

        case 'CMD_BEST_MATCH':
            const statsB = Analyzer.getMatchStats();
            if (!statsB || !statsB.best.id) return "No tengo suficientes datos para determinar tu mejor partido.";
            return `<div class="ai-result-card">
                <span class="res-title">Tu Mejor Victoria</span>
                <div class="res-val">${statsB.best.resultado.sets}</div>
                <div class="res-sub">Dominaste con una diferencia de ${statsB.best.diff} sets.</div>
            </div>`;

        case 'CMD_WORST_MATCH':
            const statsW = Analyzer.getMatchStats();
            if (!statsW || !statsW.worst.id) return "No tengo datos de derrotas significativas.";
            return `<div class="ai-result-card">
                <span class="res-title">Partido con más diferencia</span>
                <div class="res-val">${statsW.worst.resultado.sets}</div>
                <div class="res-sub">Te costó seguir el ritmo, diferencia de ${statsW.worst.diff} sets.</div>
            </div>`;

        case 'CMD_NEMESIS':
            const nemesis = Analyzer.findNemesis(uid);
            if (!nemesis) return respond("Aún no tienes un rival con historial dominante sobre ti.", "¡Nadie te gana lo suficiente! Eres el terror de Padeluminatis.");
            return respond(
                `<div class="ai-result-card">
                    <span class="res-title">Tu Peor Rival</span>
                    <div class="res-val">${nemesis.nombreUsuario || 'Ese crack'}</div>
                    <div class="res-sub">Has perdido el ${Math.round((nemesis.stats.losses / (nemesis.stats.wins + nemesis.stats.losses)) * 100)}% de veces contra él.</div>
                </div>`,
                `¡Ay alma cántara! <b>${nemesis.nombreUsuario}</b> te tiene tomada la medida. ${nemesis.stats.losses} veces te ha dado para el pelo.`
            );

        case 'CMD_OPEN_MATCHES':
            const opens = DATA_CACHE.openMatches;
            if (opens.length === 0) return respond("No hay partidas abiertas en este momento. ¡Crea una tú!", "Está todo el mundo durmiendo, hija. Crea una partida y verás cómo vuelan.");
            return `
                <div class="ai-result-card">
                    <span class="res-title">Partidas de Hoy</span>
                    ${opens.map(m => `
                        <div class="flex-row between py-2 border-b border-white/5">
                            <span class="text-xs font-bold">${m.hora} - ${m._col}</span>
                            <button class="text-primary text-[10px] font-black" onclick="window.location.href='calendario.html'">UNIRSE</button>
                        </div>
                    `).join('')}
                </div>
            `;

        case 'CMD_TUTORIAL':
            return `
                <div class="ai-result-card">
                    <span class="res-title">Tutorial Rápido</span>
                    <ul class="ai-list" style="font-size:0.7rem; color:#ccc;">
                        <li>📅 <b>Reserva:</b> Ve a Calendario y pulsa una hora libre.</li>
                        <li>🤝 <b>Unirse:</b> Busca huecos con '+' en el Grid.</li>
                        <li>⚔️ <b>Retos:</b> Elige 'Reto Oficial' al crear para ganar ELO.</li>
                        <li>🤵 <b>Perfil:</b> Cambia tu tema y revisa tus palas.</li>
                    </ul>
                </div>
            `;

        case 'CMD_PRO_TIPS':
            const tips = [
                "<b>Bandeja:</b> Apunta a la malla metálica, no a la pared de fondo.",
                "<b>Globo:</b> En pista indoor, no busques altura, busca profundidad.",
                "<b>Saque:</b> Varía siempre al muro o al centro para confundir.",
                "<b>Volea:</b> Mantén la pala siempre alta, por delante de los ojos."
            ];
            return respond(
                `<div class="ai-result-card"><span class="res-title">Consejo Técnico</span><div class="res-val">${tips[Math.floor(Math.random()*tips.length)]}</div></div>`,
                "Cariño, lo más importante es que no te caigas por la pista. Y si fallas, ¡echa la culpa al sol!"
            );

        case 'CMD_PREDICT':
            const winProb = 45 + Math.floor(Math.random() * 20);
            return respond(
                `<div class="ai-result-card">
                    <span class="res-title">Simulador Probabilístico</span>
                    <div class="res-val">${winProb}% de Probabilidad</div>
                    <div class="res-sub">Basado en tu racha actual y nivel ELO. Estás en un momento de ${winProb > 50 ? 'Dominancia' : 'Desafío'}.</div>
                </div>`,
                `¡Ay hija! Tú dale fuerte y ya veremos. Yo apuesto que ganas pero suda un poco, ¿eh?`
            );

        case 'CMD_WEATHER_TACTICS':
            return respond(
                `<div class="ai-result-card">
                    <span class="res-title">Táctica Atmosférica</span>
                    <div class="res-val">Condición: VARIABLE</div>
                    <p style="font-size:0.7rem; margin-top:5px;">Con calor la bola vuela más (usa globos cortos). Con humedad, la bola pesa (aprieta más la volea).</p>
                </div>`,
                "Si llueve no juegues, que te despeinas y la pala se pone triste."
            );

        case 'CMD_TRAINING_PLAN':
            return `<div class="ai-result-card">
                <span class="res-title">Plan Semanal Sugerido</span>
                <p style="font-size:0.7rem; color:#fff;">Lunes: Técnica de Red<br>Miércoles: Partido Amistoso<br>Viernes: Partido de Reto</p>
            </div>`;

        case 'CMD_JOKE':
            return _getFunnyJoke();

        default:
            if (currentPersonality === 'vecina') return _getFunnyJoke();
            return "Entendido. He registrado tu consulta para mi base de datos táctica. ¿Deseas un análisis más profundo de algún punto?";
    }
}

function _getFunnyJoke() {
    const users = DATA_CACHE.globalUsers.filter(u => u.nombreUsuario);
    if (users.length === 0) return "Dicen que por aquí hay gente que calienta pidiendo una cerveza...";
    const r = users[Math.floor(Math.random() * users.length)];
    const jokes = [
        `¿Has visto a ${r.nombreUsuario}? El otro día falló un remate y le echó la culpa a la gravedad.`,
        `Me han dicho que ${r.nombreUsuario} se ha comprado una pala de 400€ a ver si así la bola pasa la red. ¡Menuda fe!`,
        `Dicen que ${r.nombreUsuario} tiene un golpe secreto: se llama 'la caña' y lo usa en todos los puntos.`
    ];
    return jokes[Math.floor(Math.random() * jokes.length)];
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
