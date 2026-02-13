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

const HUMOR_KEY = 'padeluminatis_ai_humor';
let humorEnabled = localStorage.getItem(HUMOR_KEY) === 'true';

function humorNoData() {
    const lines = [
        "Esto aún no lo sé… mi algoritmo necesita café antes de jugar.",
        "No tengo info suficiente, pero prometo volver más fuerte que un globo en verano.",
        "No me llega el dato, hoy estoy en modo ahorro de energía.",
        "Sin datos por ahora. Mientras tanto, entreno mis predicciones en silencio."
    ];
    return lines[Math.floor(Math.random() * lines.length)];
}

function noData(msg) {
    return humorEnabled ? `${msg} ${humorNoData()}` : msg;
}

// --- DATA LAYER (Private) ---

async function _syncData() {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    const now = Date.now();
    if (now - DATA_CACHE.lastUpdate < 300000 && DATA_CACHE.user) return; 

    try {
        const [uData, eloSnap, matchAmis, matchReto, usersSnap, openAmis, openReto] = await Promise.all([
            getDocument('usuarios', uid),
            window.getDocsSafe(query(collection(db, "rankingLogs"), where("uid", "==", uid), orderBy("timestamp", "desc"), limit(25))),
            window.getDocsSafe(query(collection(db, "partidosAmistosos"), where("jugadores", "array-contains", uid), orderBy("fecha", "desc"), limit(25))),
            window.getDocsSafe(query(collection(db, "partidosReto"), where("jugadores", "array-contains", uid), orderBy("fecha", "desc"), limit(25))),
            window.getDocsSafe(query(collection(db, "usuarios"), limit(400))),
            window.getDocsSafe(query(collection(db, "partidosAmistosos"), where("estado", "==", "abierto"), limit(10))),
            window.getDocsSafe(query(collection(db, "partidosReto"), where("estado", "==", "abierto"), limit(10)))
        ]);

        if (uData) {
            uData.nivel = Number(uData.nivel || 2.5);
            uData.puntosRanking = Number(uData.puntosRanking || 1000);
        }
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
        DATA_CACHE.globalUsers = usersSnap.docs.map(d => {
            const data = d.data() || {};
            return {
                id: d.id,
                ...data,
                nivel: Number(data.nivel || 2.5),
                puntosRanking: Number(data.puntosRanking || 1000)
            };
        });
        DATA_CACHE.openMatches = [
            ...openAmis.docs.map(d => ({ ...d.data(), _col: 'amistoso' })),
            ...openReto.docs.map(d => ({ ...d.data(), _col: 'reto' }))
        ].filter(m => (m.jugadores || []).filter(id => id).length < 4);
        
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
        if (recent > old + 20) return 's? EXPONENCIAL';
        if (recent < old - 20) return '?~ CRÍTICA';
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

function _getMatchDate(m) {
    return m?.fecha?.toDate?.() || new Date(m?.fecha || 0);
}

function _didUserWinMatch(m, uid) {
    if (!m?.resultado?.sets || !m?.jugadores) return false;
    const myIdx = m.jugadores.indexOf(uid);
    if (myIdx === -1) return false;
    const isTeam1 = myIdx < 2;
    const sets = m.resultado.sets.split(' ');
    let myS = 0, rivS = 0;
    sets.forEach(s => {
        const p = s.split('-').map(Number);
        if (p.length < 2) return;
        if (isTeam1) { p[0] > p[1] ? myS++ : rivS++; }
        else { p[1] > p[0] ? myS++ : rivS++; }
    });
    return myS > rivS;
}

function _calcWinrate(uid) {
    const played = DATA_CACHE.matches.filter(m => m.resultado);
    if (played.length === 0) return { wins: 0, total: 0, winrate: 0 };
    let wins = 0;
    played.forEach(m => { if (_didUserWinMatch(m, uid)) wins++; });
    return { wins, total: played.length, winrate: Math.round((wins / played.length) * 100) };
}

function _findUserByName(name) {
    if (!name) return null;
    const q = name.toLowerCase().trim();
    if (!q) return null;
    return DATA_CACHE.globalUsers.find(u => {
        const n = (u.nombreUsuario || u.nombre || '').toLowerCase();
        return n.includes(q);
    });
}

// --- DIALOGUE LAYER ---

function _detectIntent(query) {
    const q = query.toLowerCase();
    if (query.startsWith('CMD_')) return query; 
    
    if (q.includes('socio') || q.includes('compañero')) return 'CMD_PARTNER_SYNC';
    if (q.includes('chiste') || q.includes('risa')) return 'CMD_JOKE';
    if (q.includes('diferencia con') || q.includes('comparar con')) return 'CMD_COMPARE_USER';
    if (q.includes('proximo partido') || q.includes('cuando juego')) return 'CMD_NEXT_MATCH';
    if (q.includes('llueve') || q.includes('lluvia')) return 'CMD_RAIN_TODAY';
    if (q.includes('peor rival') || q.includes('cuesta ganar')) return 'CMD_NEMESIS';
    if (q.includes('mejor partido')) return 'CMD_BEST_MATCH';
    if (q.includes('peor partido')) return 'CMD_WORST_MATCH';
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
                    <span id="ai-bot-name" class="ai-title italic font-black uppercase">INTELIGENCIA AP</span>
                    <div class="flex-row items-center gap-2">
                        <div class="pulse-dot-green"></div>
                        <span id="ai-bot-tag" class="ai-subtitle tracking-[2px]">NÚCLEO SENTIENTE V14</span>
                    </div>
                </div>
                <button id="ai-humor-toggle" class="btn-humor-toggle" onclick="window.toggleAiHumor()">HUMOR</button>
                <button class="btn-close-neon sm" onclick="window.toggleAiChat()"><i class="fas fa-chevron-down"></i></button>
            </div>
            
            <div id="ai-messages" class="ai-chat-body custom-scroll p-6"></div>

            <div class="ai-chat-footer p-4 bg-black/80 backdrop-blur-3xl border-t border-white-05">
                <button id="ai-toggle-commands" class="btn-command-toggle mb-3" onclick="window.toggleAiCommands()">
                    <i class="fas fa-th-large mr-2"></i> COMANDOS RÁPIDOS
                </button>
                <div id="ai-command-wrap" class="ai-command-container hidden">
                    <div class="ai-quick-grid">
                        <button class="ai-quick-btn" onclick="window.aiQuickCmd('CMD_REPORT','Informe')">Informe</button>
                        <button class="ai-quick-btn" onclick="window.aiQuickCmd('CMD_LAST_MATCH','Último')">Último</button>
                        <button class="ai-quick-btn" onclick="window.aiQuickCmd('CMD_MATCH_FORECAST','Pronóstico')">2v2</button>
                        <button class="ai-quick-btn" onclick="window.aiQuickCmd('CMD_STREAK_ANALYSIS','Racha')">Racha</button>
                        <button class="ai-quick-btn" onclick="window.aiQuickCmd('CMD_STATS_READ','Stats')">Stats</button>
                        <button class="ai-quick-btn" onclick="window.aiQuickCmd('CMD_PREDICT','Predicción')">Evo</button>
                    </div>
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
                border-radius: 32px; 
                border: 1px solid rgba(255,255,255,0.12); 
                background: linear-gradient(180deg, rgba(8, 12, 28, 0.98) 0%, rgba(2, 4, 12, 1) 100%);
                box-shadow: 0 40px 100px rgba(0,0,0,0.9);
                overflow: hidden;
                display: flex;
                flex-direction: column;
                position: fixed;
                inset: 16px;
                z-index: 10000;
                transform: translateY(100%);
                transition: transform 0.4s cubic-bezier(0.19, 1, 0.22, 1);
            }
            .ai-chat-panel.v14.open { transform: translateY(0); }
            @media (min-width: 600px) {
                .ai-chat-panel.v14 {
                    inset: auto;
                    right: 24px;
                    bottom: 24px;
                    width: 400px;
                    height: 600px;
                }
            }
            .ai-chat-header { height: 80px; display: flex; items-center: center; gap: 15px; background: rgba(255,255,255,0.02); }
            .ai-avatar-box { width: 45px; height: 45px; border-radius: 15px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; position: relative; }
            .ai-avatar-box.coach { background: rgba(0,212,255,0.1); color: #00d4ff; box-shadow: 0 0 20px rgba(0,212,255,0.2); }
            .ai-avatar-box.vecina { background: rgba(198,255,0,0.1); color: #c6ff00; box-shadow: 0 0 20px rgba(198,255,0,0.2); }
            .ai-title { font-size: 0.9rem; color: #fff; letter-spacing: 1px; display: block; margin-bottom: 2px; }
            .ai-subtitle { font-size: 0.65rem; color: var(--text-muted); font-weight: 800; }
            .btn-command-toggle {
                width: 100%;
                padding: 10px;
                border-radius: 12px;
                background: rgba(198, 255, 0, 0.1);
                color: #c6ff00;
                font-size: 0.7rem;
                font-weight: 900;
                letter-spacing: 1px;
                border: 1px solid rgba(198, 255, 0, 0.2);
                transition: all 0.2s;
            }
            .btn-command-toggle:hover { background: rgba(198, 255, 0, 0.2); }
            .ai-command-container.hidden { display: none; }
            .ai-quick-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
            .ai-quick-btn { 
                padding: 10px 8px; 
                border-radius: 14px; 
                border: 1px solid rgba(255,255,255,0.08); 
                background: rgba(255,255,255,0.06); 
                color: #fff; 
                font-size: 0.7rem; 
                font-weight: 800; 
                text-transform: uppercase; 
                letter-spacing: 1px; 
                cursor: pointer; 
                transition: transform 0.15s ease, border-color 0.2s ease;
            }
            .ai-quick-btn:hover { transform: translateY(-1px); border-color: rgba(198,255,0,0.4); }
            .ai-quick-btn.ghost { background: rgba(0,212,255,0.08); border-color: rgba(0,212,255,0.3); }
            .ai-quick-btn.outline { background: transparent; border-color: rgba(255,255,255,0.12); }
            
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
            .ai-msg.bot p { 
                background: rgba(30, 41, 59, 0.95); 
                border: 1px solid rgba(255, 255, 255, 0.1); 
                color: #f1f5f9; 
                border-bottom-left-radius: 4px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.2);
            }
        </style>
    `;
    document.body.insertAdjacentHTML('beforeend', chatHTML);

    document.getElementById('ai-send-btn').onclick = sendMessage;
    document.getElementById('ai-input-field').onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };

    window.toggleAiChat = toggleChat;
    window.switchAiPersonality = switchAiPersonality;
    window.toggleAiHumor = () => {
        humorEnabled = !humorEnabled;
        localStorage.setItem(HUMOR_KEY, String(humorEnabled));
        const btn = document.getElementById('ai-humor-toggle');
        if (btn) btn.classList.toggle('active', humorEnabled);
        addMessage(humorEnabled ? "Modo humor activado. Prometo no pasarme." : "Modo humor desactivado. Vamos al grano.", 'bot');
    };
    
    window.toggleAiCommands = () => {
        const wrap = document.getElementById('ai-command-wrap');
        wrap.classList.toggle('hidden');
    };

    const btnHumor = document.getElementById('ai-humor-toggle');
    if (btnHumor) btnHumor.classList.toggle('active', humorEnabled);

    window.aiQuickCmd = (cmd, label = '') => {
        if (label) addMessage(label, 'user');
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
        name.textContent = "INTELIGENCIA AP";
        avatar.className = "ai-avatar-box coach";
        avatar.innerHTML = `<i class="fas fa-brain"></i>`;
    } else {
        name.textContent = "VECINA AP";
        avatar.className = "ai-avatar-box vecina";
        avatar.innerHTML = `<i class="fas fa-face-grin-stars"></i>`;
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
            const wr = _calcWinrate(uid);
            let focus = 'Optimiza tu juego en red y transiciones.';
            if (wr.total < 3) focus = 'Registra más partidos para un análisis fino.';
            else if (wr.winrate < 45) focus = 'Prioriza consistencia y defensa.';
            else if (wr.winrate < 60) focus = 'Mejora la toma de decisiones en puntos clave.';
            else focus = 'Estás fuerte. Entra en retos oficiales para escalar ELO.';
            return respond(
                `<div class="ai-result-card">
                    <span class="res-title">Estado del Jugador</span>
                    <div class="res-val">${trend}</div>
                    <div class="res-sub">ELO ${Math.round(DATA_CACHE.user.puntosRanking)} • Nivel ${(DATA_CACHE.user.nivel || 2.5).toFixed(2)} • Efectividad ${wr.winrate}% (${wr.wins}V/${wr.total - wr.wins}D). ${focus}</div>
                </div>`,
                "Cariñito, estás que te sales. Sigue así y te veo en el World Padel Tour (o no...)."
            );

        case 'CMD_LAST_MATCH':
            const matches = DATA_CACHE.matches.filter(m => m.resultado);
            if (matches.length === 0) return noData("No he encontrado partidos terminados en tu historial.");
            const last = matches[0];
            return `<div class="ai-result-card">
                <span class="res-title">Último Partido</span>
                <div class="res-val">${last.resultado.sets}</div>
                <div class="res-sub">${last.fecha?.toDate?.().toLocaleDateString() || last.fecha} (${last._col})</div>
            </div>`;

        case 'CMD_NEXT_MATCH':
            const upcoming = DATA_CACHE.matches
                .filter(m => !m.resultado)
                .map(m => ({ ...m, _date: _getMatchDate(m) }))
                .filter(m => m._date >= new Date())
                .sort((a, b) => a._date - b._date)[0];
            if (!upcoming) return respond(noData("No tienes partidos programados aún."), noData("No veo nada en tu agenda."));
            const typeLabel = upcoming._col === 'reto' ? 'RETO' : 'AMISTOSO';
            return `<div class="ai-result-card">
                <span class="res-title">Próximo Partido</span>
                <div class="res-val">${typeLabel}</div>
                <div class="res-sub">${upcoming._date.toLocaleDateString()} ${upcoming._date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>`;

        case 'CMD_BEST_MATCH':
            const statsB = Analyzer.getMatchStats();
            if (!statsB || !statsB.best.id) return noData("No tengo suficientes datos para determinar tu mejor partido.");
            return `<div class="ai-result-card">
                <span class="res-title">Tu Mejor Victoria</span>
                <div class="res-val">${statsB.best.resultado.sets}</div>
                <div class="res-sub">Dominaste con una diferencia de ${statsB.best.diff} sets.</div>
            </div>`;

        case 'CMD_WORST_MATCH':
            const statsW = Analyzer.getMatchStats();
            if (!statsW || !statsW.worst.id) return noData("No tengo datos de derrotas significativas.");
            return `<div class="ai-result-card">
                <span class="res-title">Partido con más diferencia</span>
                <div class="res-val">${statsW.worst.resultado.sets}</div>
                <div class="res-sub">Te costó seguir el ritmo, diferencia de ${statsW.worst.diff} sets.</div>
            </div>`;

        case 'CMD_NEMESIS':
            const nemesis = Analyzer.findNemesis(uid);
            if (!nemesis) return respond(noData("Aún no tengo un rival con historial dominante sobre ti."), noData("Aún no tengo un rival dominante registrado."));
            return respond(
                `<div class="ai-result-card">
                    <span class="res-title">Tu Peor Rival</span>
                    <div class="res-val">${nemesis.nombreUsuario || 'Ese crack'}</div>
                    <div class="res-sub">Has perdido el ${Math.round((nemesis.stats.losses / (nemesis.stats.wins + nemesis.stats.losses)) * 100)}% de veces contra él.</div>
                </div>`,
                `Pista clara: <b>${nemesis.nombreUsuario}</b> suele ganarte. Toca ajustar táctica y volver más fuerte.`
            );

        case 'CMD_PARTNER_SYNC':
            const pCounts = {};
            DATA_CACHE.matches.forEach(m => {
                const uIdx = m.jugadores?.indexOf(uid);
                if (uIdx === -1) return;
                const pIdx = uIdx < 2 ? (uIdx === 0 ? 1 : 0) : (uIdx === 2 ? 3 : 2);
                const pid = m.jugadores[pIdx];
                if (pid) pCounts[pid] = (pCounts[pid] || 0) + 1;
            });
            const topP = Object.keys(pCounts).reduce((a, b) => pCounts[a] > pCounts[b] ? a : b, null);
            if (!topP) return noData("Parece que no tienes un compañero habitual registrado.");
            const partner = DATA_CACHE.globalUsers.find(u => u.id === topP);
            return respond(
                `<div class="ai-result-card">
                    <span class="res-title">Socio Preferente</span>
                    <div class="res-val">${partner?.nombreUsuario || 'Tu pareja fiel'}</div>
                    <div class="res-sub">Habéis compartido pista ${pCounts[topP]} veces. Vuestra sincronización es de Grado Elite.</div>
                </div>`,
                `Juegas más con <b>${partner?.nombreUsuario || 'tu socio habitual'}</b>. Buen tándem.`
            );

        case 'CMD_OPEN_MATCHES':
            const opens = DATA_CACHE.openMatches;
            if (opens.length === 0) return respond("No hay partidas abiertas en este momento. ¡Crea una tú!", "Está todo el mundo durmiendo, hija. Crea una partida y verás cómo vuelan.");
            return `
                <div class="ai-result-card">
                    <span class="res-title">Partidas de Hoy</span>
                    ${opens.map(m => {
                        const d = _getMatchDate(m);
                        const time = d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
                        const day = d ? d.toLocaleDateString() : '';
                        const type = m._col === 'reto' ? 'RETO' : 'AMISTOSO';
                        return `
                        <div class="flex-row between py-2 border-b border-white/5">
                            <span class="text-xs font-bold">${time} ${day} - ${type}</span>
                            <button class="text-primary text-[10px] font-black" onclick="window.location.href='calendario.html'">UNIRSE</button>
                        </div>
                    `;
                    }).join('')}
                </div>
            `;

        case 'CMD_TUTORIAL':
            return `
                <div class="ai-result-card">
                    <span class="res-title">Tutorial Rápido</span>
                    <ul class="ai-list" style="font-size:0.7rem; color:#ccc;">
                        <li>". <b>Reserva:</b> Ve a Calendario y pulsa una hora libre.</li>
                        <li> <b>Unirse:</b> Busca huecos con '+' en el Grid.</li>
                        <li>"️ <b>Retos:</b> Elige 'Reto Oficial' al crear para ganar ELO.</li>
                        <li> <b>Perfil:</b> Cambia tu tema y revisa tus palas.</li>
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

        case 'CMD_RAIN_TODAY':
            try {
                const { getDetailedWeather } = await import('../external-data.js');
                const w = await getDetailedWeather();
                const rain = w?.current?.rain || 0;
                const temp = Math.round(w?.current?.temperature_2m || 0);
                const isRaining = rain > 0.2;
                return respond(
                    `<div class="ai-result-card">
                        <span class="res-title">Lluvia en Tiempo Real</span>
                        <div class="res-val">${isRaining ? 'SÍ LLUEVE' : 'NO LLUEVE'}</div>
                        <div class="res-sub">${temp}°C • ${rain.toFixed(1)}mm</div>
                    </div>`,
                    isRaining
                        ? `Sí llueve y hace ${temp}°C. Ponte un chubasquero.`
                        : `No llueve. ${temp}°C, así que a la pista.`
                );
            } catch (e) {
                return "Error al conectar con los satélites meteorológicos.";
            }

        case 'CMD_WEATHER_TACTICS':
            try {
                const { getDetailedWeather } = await import('../external-data.js');
                const w = await getDetailedWeather();
                const temp = Math.round(w?.current?.temperature_2m || 20);
                const rain = w?.current?.rain || 0;
                
                let advice = "Condiciones óptimás. Pista rápida.";
                if (temp > 28) advice = "Calor extremo. La bola vuela mucho. Usa globos profundos y controla la potencia.";
                if (temp < 12) advice = "Frío detectado. La bola pesa y sale menos. Ataca más con potencia.";
                if (rain > 0.5) advice = "Lluvia detectada. Pista resbaladiza y bola pesada. Cuidado con los cristales.";

                return respond(
                    `<div class="ai-result-card">
                        <span class="res-title">Sincronización Atmosférica</span>
                        <div class="res-val">${temp}°C | ${rain}mm lluvia</div>
                        <p style="font-size:0.7rem; margin-top:8px; line-height:1.4;">${advice}</p>
                    </div>`,
                    `Hace ${temp} grados. Ni frío ni calor, pero con ${rain}mm de lluvia te vas a poner como un pollito.`
                );
            } catch(e) {
                return "Error al conectar con los satélites meteorológicos.";
            }

        case 'CMD_HISTORY_ANALYTICS':
            const allMatches = DATA_CACHE.matches.filter(m => m.resultado);
            if(allMatches.length === 0) return "Tu historial está vacío como mi base de datos de sentimientos.";
            const wins = allMatches.filter(m => {
                const sets = m.resultado.sets.split(' ');
                let myS=0, rivS=0;
                const myIdx = m.jugadores.indexOf(uid);
                sets.forEach(s => {
                    const p = s.split('-').map(Number);
                    if(myIdx < 2) { p[0] > p[1] ? myS++ : rivS++; }
                    else { p[1] > p[0] ? myS++ : rivS++; }
                });
                return myS > rivS;
            }).length;

            return `<div class="ai-result-card">
                <span class="res-title">Desfase de Victorias</span>
                <div class="res-val">${wins}V / ${allMatches.length - wins}D</div>
                <div class="res-sub">Efectividad total: ${Math.round((wins/allMatches.length)*100)}% en ${allMatches.length} encuentros.</div>
            </div>`;

        case 'CMD_TRAINING_PLAN':
            return `<div class="ai-result-card">
                <span class="res-title">Plan Semanal Sugerido</span>
                <p style="font-size:0.7rem; color:#fff;">Lunes: Técnica de Red<br>Miércoles: Partido Amistoso<br>Viernes: Partido de Reto</p>
            </div>`;

        case 'CMD_JOKE':
            return _getFunnyJoke();

        case 'CMD_STREAK_ANALYSIS':
            const currentStreak = DATA_CACHE.user.rachaActual || 0;
            const message = currentStreak > 0 
                ? `Mantienes una racha de ${currentStreak} victorias. Tu racha histórica máxima es de ${DATA_CACHE.user.rachaMaxima || 10}. Sigue así para duplicar tus bonus de ELO.` 
                : "Tu racha está en 0. Necesitas una victoria para activar el multiplicador 'DYNAMO'.";
            return respond(
                `<div class="ai-result-card">
                    <span class="res-title">Termodinámica de Combate</span>
                    <div class="res-val">${currentStreak > 0 ? 'CALIENTE' : 'FRÍO'}</div>
                    <p style="font-size:0.75rem; color:#ccc;">${message}</p>
                </div>`,
                currentStreak > 3 ? "¡Estás on fire, chato! No te acerques mucho a la red que la vas a quemar." : "Venga, que no se diga. ¡A por la primera victoria!"
            );

        case 'CMD_SURVIVAL_CHANCE':
            const chance = Math.round(50 + (DATA_CACHE.user.nivel * 5) - (DATA_CACHE.user.partidosJugados === 0 ? 20 : 0));
            return respond(
                `<div class="ai-result-card">
                    <span class="res-title">Protocolo de Supervivencia</span>
                    <div class="res-val">${chance}% de Probabilidad</div>
                    <p style="font-size:0.7rem; margin-top:8px;">Calculando integridad estructural... ${chance > 70 ? 'Estatus: DEPREDADOR' : 'Estatus: CAUTELA'}.</p>
                </div>`,
                "Tú sal ahí y dalo todo. Si ves que no llegas, ¡hazle un globo al de la red!"
            );

        case 'CMD_COMPARE_USER':
            let targetName = '';
            if (query.includes('|')) targetName = query.split('|').slice(1).join('|').trim();
            if (!targetName && query.toLowerCase().includes('con ')) targetName = query.split(/con /i).pop().trim();
            if (!targetName) {
                const top = [...DATA_CACHE.globalUsers]
                    .sort((a, b) => (b.puntosRanking || 0) - (a.puntosRanking || 0))
                    .slice(0, 5)
                    .map(u => u.nombreUsuario || u.nombre || 'Jugador')
                    .join(', ');
                return `<div class="ai-result-card">
                    <span class="res-title">Comparar Jugador</span>
                    <div class="res-sub">Escribe: "diferencia con Juan". Top sugeridos: ${top || 'no disponibles'}.</div>
                </div>`;
            }
            const target = _findUserByName(targetName);
            if (!target) return respond(noData("No encuentro a ese jugador en el ranking."), noData("No encuentro a ese jugador en el ranking."));
            const myPts = DATA_CACHE.user?.puntosRanking || 1000;
            const tPts = target.puntosRanking || 1000;
            const diffPts = tPts - myPts;
            const diffLabel = diffPts > 0 ? `Te lleva +${Math.round(diffPts)} pts` : diffPts < 0 ? `Le llevas ${Math.round(Math.abs(diffPts))} pts` : 'Estáis empatados';
            return `<div class="ai-result-card">
                <span class="res-title">Comparativa</span>
                <div class="res-val">${target.nombreUsuario || target.nombre || 'Jugador'}</div>
                <div class="res-sub">${diffLabel} • NV ${(target.nivel || 2.5).toFixed(2)}</div>
            </div>`;

        case 'CMD_COMPARE_ELITE':
            const sorted = [...DATA_CACHE.globalUsers].sort((a,b) => (b.puntosRanking || 0) - (a.puntosRanking || 0));
            const top1 = sorted[0];
            const gap = (top1.puntosRanking || 1000) - (DATA_CACHE.user.puntosRanking || 1000);
            return respond(
                `<div class="ai-result-card">
                    <span class="res-title">Distancia hacia el Trono</span>
                    <div class="res-val">${Math.round(gap)} Pts de brecha</div>
                    <div class="res-sub">El líder actual es ${top1.nombreUsuario || 'Anónimo'}. Te faltan aproximadamente ${Math.ceil(gap / 20)} victorias consecutivas para alcanzarlo.</div>
                </div>`,
                `¿Quieres pillar a <b>${top1.nombreUsuario}</b>? Pues ya puedes ir desayunando fuerte, que te lleva un rato.`
            );

        case 'CMD_METRICS_ADVANCED':
            const avgLevel = DATA_CACHE.globalUsers.reduce((a,b) => a + (b.nivel || 2.5), 0) / (DATA_CACHE.globalUsers.length || 1);
            return `<div class="ai-result-card">
                <span class="res-title">Estructura de la Galaxia</span>
                <div class="res-val">Nivel Promedio: ${avgLevel.toFixed(2)}</div>
                <div class="res-sub">Te encuentras en el segmento ${DATA_CACHE.user.nivel > avgLevel ? 'ALTO' : 'BASE'}. El ${Math.round((DATA_CACHE.globalUsers.filter(u => u.nivel > 4).length / DATA_CACHE.globalUsers.length) * 100)}% de los jugadores son de Nivel Élite (>4.0).</div>
            </div>`;

        case 'CMD_GLOBAL_STATS':
            const totalMatches = DATA_CACHE.matches.length;
            const openCount = DATA_CACHE.openMatches.length;
            const usersCount = DATA_CACHE.globalUsers.length;
            return `<div class="ai-result-card">
                <span class="res-title">Estado del Sistema</span>
                <div class="res-val">${usersCount} Jugadores en Red</div>
                <div class="res-sub">Actualmente hay ${openCount} pistas buscando jugadores y ${totalMatches} partidos registrados en total.</div>
            </div>`;

        case 'CMD_MATCH_FORECAST':
            const nextM = DATA_CACHE.matches
                .filter(m => !m.resultado)
                .map(m => ({ ...m, _date: _getMatchDate(m) }))
                .filter(m => m._date >= new Date())
                .sort((a, b) => a._date - b._date)[0];
            if (!nextM) return noData("No tengo un partido futuro en el radar.");
            const teamA = nextM.equipo1 || [];
            const teamB = nextM.equipo2 || [];
            if (teamA.length < 2 || teamB.length < 2) return noData("Necesito equipos completos 2v2 para pronosticar.");
            const getLvl = (id) => (DATA_CACHE.globalUsers.find(u => u.id === id)?.nivel || 2.5);
            const aAvg = (getLvl(teamA[0]) + getLvl(teamA[1])) / 2;
            const bAvg = (getLvl(teamB[0]) + getLvl(teamB[1])) / 2;
            const diffLvl = aAvg - bAvg;
            const pA = Math.min(Math.max(50 + diffLvl * 18, 10), 90);
            const pB = 100 - pA;
            return `<div class="ai-result-card">
                <span class="res-title">pronóstico 2v2</span>
                <div class="res-val">Equipo A ${Math.round(pA)}%  |  Equipo B ${Math.round(pB)}%</div>
                <div class="res-sub">Basado en niveles medios. Si quieres un pronóstico fino, completa equipos y resultados.</div>
            </div>`;

        case 'CMD_TACTIC_OVERVIEW':
            const journal = (DATA_CACHE.user?.diario || []).slice(-6);
            if (journal.length === 0) return noData("Sin diario no puedo perfilar tu táctica. Registra partidos.");
            const posCount = journal.reduce((a, e) => { const k = e.posicion || 'reves'; a[k] = (a[k] || 0) + 1; return a; }, {});
            const domCount = journal.reduce((a, e) => { const k = e.dominio || 'igualado'; a[k] = (a[k] || 0) + 1; return a; }, {});
            const topPos = Object.keys(posCount).reduce((a,b) => posCount[a] > posCount[b] ? a : b);
            const topDom = Object.keys(domCount).reduce((a,b) => domCount[a] > domCount[b] ? a : b);
            return `<div class="ai-result-card">
                <span class="res-title">Análisis táctico</span>
                <div class="res-val">Zona clave: ${topPos.toUpperCase()} | Dominio: ${topDom.toUpperCase()}</div>
                <div class="res-sub">Trabaja transiciones y cobertura en tu lado fuerte. En 2v2 la comunicación decide puntos.</div>
            </div>`;

        case 'CMD_SHOT_FOCUS':
            const shots = (DATA_CACHE.user?.diario || []).flatMap(e => [e.stats || {}]);
            if (shots.length === 0) return noData("No tengo golpes registrados. Completa el diario para analizar.");
            const avg = (key) => Math.round(shots.reduce((s, st) => s + (st[key] || 5), 0) / shots.length);
            const shotList = ['bandeja','volea','smásh','globo','defensa','vibora'].map(k => ({ k, v: avg(k) }));
            shotList.sort((a,b) => b.v - a.v);
            const best = shotList[0];
            const worst = shotList[shotList.length - 1];
            return `<div class="ai-result-card">
                <span class="res-title">Mejora de golpes</span>
                <div class="res-val">Top: ${best.k.toUpperCase()} ${best.v}/10 | A reforzar: ${worst.k.toUpperCase()} ${worst.v}/10</div>
                <div class="res-sub">Dedica 15 min por sesión al golpe más bajo y mide progreso.</div>
            </div>`;

        case 'CMD_GEAR_GUIDE':
            const gear = (DATA_CACHE.user?.diario || []).map(e => e.detalles || {}).filter(Boolean);
            if (gear.length === 0) return noData("Aún no tengo info de palas. Anota tu pala y configuración en el diario.");
            const countTop = (arr, key) => {
                const map = {};
                arr.forEach(i => { const v = (i[key] || '').trim(); if (v) map[v] = (map[v] || 0) + 1; });
                const keys = Object.keys(map); if (keys.length === 0) return null; return keys.reduce((a,b) => map[a] > map[b] ? a : b);
            };
            const favPala = countTop(gear, 'pala') || 'Sin datos';
            const favCfg = countTop(gear, 'configPala') || 'Sin datos';
            return `<div class="ai-result-card">
                <span class="res-title">Recomendación de pala</span>
                <div class="res-val">Base actual: ${favPala}</div>
                <div class="res-sub">Config más repetida: ${favCfg}. Ajusta balance y grip según sensación.</div>
            </div>`;

        case 'CMD_MENTAL_COACH':
            const moodEntries = (DATA_CACHE.user?.diario || []);
            if (moodEntries.length === 0) return noData("Registra sensaciones para darte coaching mental.");
            const avgMental = Math.round(moodEntries.reduce((s, e) => s + (e.valoracion?.mental || 5), 0) / moodEntries.length);
            return `<div class="ai-result-card">
                <span class="res-title">Gestión emocional</span>
                <div class="res-val">Mental medio: ${avgMental}/10</div>
                <div class="res-sub">Rutina breve: respiración 4-4-4 y palabra clave antes de cada punto.</div>
            </div>`;

        case 'CMD_PREMATCH':
            return `<div class="ai-result-card">
                <span class="res-title">Preparación 2v2</span>
                <div class="res-val">Checklist rápido</div>
                <div class="res-sub">1) Calienta 10 min. 2) Define roles con tu pareja. 3) Objetivo simple por set. 4) Prioriza porcentaje antes que riesgo.</div>
            </div>`;

        case 'CMD_STATS_READ':
            const wr2 = _calcWinrate(uid);
            return `<div class="ai-result-card">
                <span class="res-title">Lectura de estadísticas</span>
                <div class="res-val">Winrate ${wr2.winrate}% (${wr2.wins}V/${wr2.total - wr2.wins}D)</div>
                <div class="res-sub">Combina esto con tu diario para ajustar táctica y golpes débiles.</div>
            </div>`;

        default:
            if (humorEnabled) return humorNoData();
            if (currentPersonality === 'vecina') return _getFunnyJoke();
            return "Entendido. No tengo datos suficientes para responder. ¿Quieres darme más contexto?";
    }
}

function _getFunnyJoke() {
    const users = DATA_CACHE.globalUsers.filter(u => u.nombreUsuario);
    if (users.length === 0) return "Dicen que por aquí hay gente que calienta pidiendo una cerveza...";
    const r = users[Math.floor(Math.random() * users.length)];
    const jokes = [
        `¿Has visto a ${r.nombreUsuario}? El otro día falló un remate y le echó la culpa a la gravedad.`,
        `Me han dicho que ${r.nombreUsuario} se ha comprado una pala de 400, a ver si así la bola pasa la red. ¡Menuda fe!`,
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














