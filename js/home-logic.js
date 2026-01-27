// home-logic.js - Padeluminatis Dashboard Engine (v18.0)
import { db, auth, observerAuth, subscribeDoc, getDocument } from './firebase-service.js';
import { collection, query, orderBy, limit, getDocs, where } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, countUp, showToast } from './ui-core.js';
import { calculateCourtCondition } from './ai-coach.js';
import { getDetailedWeather, getDailyTip } from './external-data.js';
import { renderXpWidget, renderAchievements } from './modules/gamification.js';
import { initGalaxyBackground } from './modules/galaxy-bg.js';
import { updateHeader } from './modules/ui-loader.js';
import { requestNotificationPermission, checkDailyReminders } from './modules/notifications.js';

let currentUser = null;
let userData = null;
let allMatches = [];

const WELCOME_PHRASES = [
    "¿Listo para dominar la pista hoy? 🎾",
    "La victoria se entrena, el talento se pule. 🔥",
    "Hoy es un gran día para subir ese ELO. 📈",
    "Tu rival ya está temblando... ¡Ve a por todas! ⚔️",
    "Menos excusas, más bandejas. ¡A jugar! 🚀",
    "El circuito te espera. Demuestra quién manda. 🏆"
];

document.addEventListener('DOMContentLoaded', () => {
    initAppUI('home');
    initGalaxyBackground();
    
    observerAuth(async (user) => {
        if (user) {
            currentUser = user;
            
            subscribeDoc("usuarios", user.uid, (data) => {
                userData = data;
                updateDashboard(data);
                updateHeader(data);
            });
            
            await loadMatches();
            await loadLastResult();
            loadInsights();
            requestNotificationPermission();

            
            // Dynamic Welcome Toast
            setTimeout(() => {
                const hour = new Date().getHours();
                let greet = "¡Buenos días!";
                if (hour >= 14 && hour < 21) greet = "¡Buenas tardes!";
                else if (hour >= 21 || hour < 5) greet = "¡Buenas noches!";
                
                const name = (userData?.nombreUsuario || user.displayName || 'Jugador').split(' ')[0];
                const phrase = WELCOME_PHRASES[Math.floor(Math.random() * WELCOME_PHRASES.length)];
                showToast(greet, `${name}, ${phrase}`, 'success');
            }, 1000);
        }
    });
    
    // Filter tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.onclick = () => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            renderMatchFeed(tab.dataset.filter);
        };
    });
});

async function updateDashboard(data) {
    if (!data) return;
    
    // Basic Info
    const userNameEl = document.getElementById('user-name');
    if (userNameEl) userNameEl.textContent = data.nombreUsuario || data.nombre || 'Jugador';
    
    // Stats
    const pts = data.puntosRanking || 1000;
    const wins = data.victorias || 0;
    const played = data.partidosJugados || 0;
    const nameEl = document.getElementById('user-name');
    if (nameEl) nameEl.textContent = data.nombreUsuario || data.nombre || 'Jugador';

    const lvlEl = document.getElementById('user-level-val');
    if (lvlEl) lvlEl.textContent = (data.nivel || 2.5).toFixed(1);

    const winrate = played > 0 ? Math.round((wins / played) * 100) : 0;
    
    const ptsEl = document.getElementById('stat-pts');
    const wrEl = document.getElementById('stat-winrate');
    if (ptsEl) countUp(ptsEl, pts);
    if (wrEl) wrEl.textContent = `${winrate}%`;
    
    // Get rank
    getDocs(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"), limit(100)))
        .then(snap => {
            const rank = snap.docs.findIndex(d => d.id === currentUser.uid) + 1;
            const rankEl = document.getElementById('user-rank');
            if (rankEl) {
                rankEl.textContent = rank > 0 ? `#${rank}` : '-';
                rankEl.classList.add('text-sport-blue');
            }
        });
    
    // XP & Achievements
    renderXpWidget('xp-widget-container', data);
    renderAchievements('achievements-list', data);
    
    // Family Points
    const famPtsEl = document.getElementById('user-family-pts');
    if (famPtsEl) countUp(famPtsEl, data.familyPoints || 0);

    
    // Dynamic AI Welcome Message
    const aiBox = document.getElementById('ai-welcome-msg');
    if (aiBox) {
        const { analyzePerformance } = await import('./ai-coach.js');
        const analysis = analyzePerformance(data.diario || []);
        const quoteEl = aiBox.querySelector('.ai-quote');
        const nameBrief = (data.nombreUsuario || 'Jugador').split(' ')[0];
        
        const hour = new Date().getHours();
        let intro = "Buenos días";
        if (hour >= 14 && hour < 21) intro = "Buenas tardes";
        else if (hour >= 21 || hour < 5) intro = "Buenas noches";

        if (analysis.status === "DATOS INSUFICIENTES") {
            const tip = "Soy tu Coach AI. Registra 3 partidos en tu diario para empezar mi asesoría.";
            quoteEl.textContent = `¡${intro} ${nameBrief}! ${tip}`;
            aiBox.onclick = () => {
                showToast('Coach IA', tip, 'info');
                setTimeout(() => window.location.href = 'diario.html', 1500);
            };
        } else {
            const tip = `Vigila tu ${analysis.focus.toLowerCase()}, pero aprovecha tu ${analysis.strength.toLowerCase()} hoy.`;
            quoteEl.textContent = `¡${intro} ${nameBrief}! ${tip}`;
            aiBox.onclick = () => {
                showToast('Consejo Elite', analysis.advice, 'success');
                setTimeout(() => window.location.href = 'diario.html', 3000);
            };
        }
    }

    // Analysis section updates
    const tipBox = document.getElementById('tip-box');
    if (tipBox) {
        const { analyzePerformance } = await import('./ai-coach.js');
        const analysis = analyzePerformance(data.diario || []);
        const nextMatch = allMatches.find(m => m.jugadores?.includes(currentUser.uid));
        
        if (nextMatch) {
            tipBox.innerHTML = `
                <i class="fas fa-brain text-xl text-purple-400 mb-1"></i>
                <span class="font-black text-[9px] text-white uppercase">ESTRATEGIA</span>
                <span class="text-[8px] text-scnd">Prepárate: ${analysis.focus || 'Analizando...'}</span>
            `;
            tipBox.onclick = () => showToast('Táctica Próxima', `Para tu siguiente partido, enfócate en ${analysis.focus.toLowerCase()} y mantén la calma.`, 'info');
        } else {
            tipBox.innerHTML = `
                <i class="fas fa-calendar-check text-xl text-sport-blue mb-1"></i>
                <span class="font-black text-[9px] text-white uppercase">EVENTOS</span>
                <span class="text-[8px] text-scnd">Ver próximos eventos</span>
            `;
            tipBox.onclick = () => window.location.href = 'eventos.html';
        }
    }
}


async function loadLastResult() {
    try {
        const logs = await getDocs(query(
            collection(db, "rankingLogs"),
            where("uid", "==", currentUser.uid),
            orderBy("timestamp", "desc"),
            limit(1)
        ));
        
        if (!logs.empty) {
            const log = logs.docs[0].data();
            const box = document.getElementById('last-match-box');
            if (!box) return;
            
            const badge = document.getElementById('last-result-badge');
            const score = document.getElementById('last-score');
            const pts = document.getElementById('last-pts-diff');
            const dateEl = document.getElementById('last-date');
            
            const won = log.diff >= 0;
            box.style.display = 'block';
            badge.textContent = won ? 'Victoria' : 'Derrota';
            badge.className = `result-badge ${won ? 'win' : 'loss'}`;
            pts.textContent = `${log.diff >= 0 ? '+' : ''}${log.diff}`;
            pts.style.color = won ? 'var(--sport-green)' : '#f87171';
            
            if (log.matchId) {
                const match = await getDocument('partidosReto', log.matchId) || await getDocument('partidosAmistosos', log.matchId);
                if (score && match?.resultado?.sets) score.textContent = match.resultado.sets;
                if (dateEl && match?.fecha) {
                    const d = match.fecha.toDate();
                    dateEl.textContent = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
                }
            }
        }
    } catch (e) {
        if (e.code === 'failed-precondition' || e.message.includes('index')) {
            console.error('⚠️ ERROR DE ÍNDICE FIREBASE:', 'Debes crear un índice compuesto para rankingLogs. Haz clic en el enlace del error anterior en la consola.');
        } else {
            console.error('Error loading last result:', e);
        }
    }
}

async function loadMatches() {
    const [am, re] = await Promise.all([
        getDocs(collection(db, "partidosAmistosos")),
        getDocs(collection(db, "partidosReto"))
    ]);
    
    let list = [];
    am.forEach(d => list.push({ id: d.id, col: 'partidosAmistosos', isComp: false, ...d.data() }));
    re.forEach(d => list.push({ id: d.id, col: 'partidosReto', isComp: true, ...d.data() }));
    
    const now = new Date();
    list = list.filter(m => m.estado !== 'jugado' && (m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha)) > new Date(now - 3600000));
    list.sort((a, b) => (a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha)) - (b.fecha?.toDate ? b.fecha.toDate() : new Date(b.fecha)));
    
    allMatches = list;
    const myNext = list.find(m => m.jugadores?.includes(currentUser.uid));
    
    // Only show joinable matches for the feed (not full, and I'm not in them already)
    const joinable = list.filter(m => (m.jugadores?.length || 0) < 4 && !m.jugadores?.includes(currentUser.uid));
    
    renderNextMatch(myNext);
    renderMatchFeed(joinable); 
}


async function renderNextMatch(match) {
    const container = document.getElementById('next-match-container');
    if (!container) return;
    
    if (!match) {
        container.innerHTML = `
            <div class="sport-card center flex-col py-8" style="background: rgba(255,255,255,0.03); border: 2px dashed rgba(255,255,255,0.05);">
                <i class="fas fa-calendar-plus text-3xl opacity-20 mb-3"></i>
                <span class="font-bold text-xs opacity-40">SIN PARTIDOS PROGRAMADOS</span>
                <button class="btn-primary mt-4 py-2 px-6 text-xs" onclick="window.location.href='calendario.html'">RESERVARTurno</button>
            </div>
        `;
        return;
    }
    
    const date = match.fecha.toDate ? match.fecha.toDate() : new Date(match.fecha);
    const players = await Promise.all((match.jugadores || []).map(getPlayerName));
    const creator = await getPlayerName(match.creador);
    
    container.innerHTML = `
        <div class="match-entry" onclick="openMatch('${match.id}', '${match.col}')">
            <div class="flex-row between mb-2">
                <span class="text-white font-black text-xl">${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}</span>
                <span class="status-badge ${match.isComp ? 'badge-green' : 'badge-blue'}">${match.isComp ? 'RETO' : 'AMISTOSO'}</span>
            </div>
            <div class="text-[10px] text-scnd font-bold uppercase tracking-wider mb-3">${date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            <div class="flex-row between items-center bg-white/5 p-3 rounded-xl">
                 <div class="flex-col gap-1 flex-1">
                    <span class="text-xs font-bold text-white">${players[0] || '?'}${players[1] ? ' & ' + players[1] : ''}</span>
                    <span class="text-[8px] font-black text-sport-blue">VS</span>
                    <span class="text-xs font-bold text-white">${players[2] || '?'}${players[3] ? ' & ' + players[3] : ''}</span>
                 </div>
                 <div class="text-[9px] text-scnd text-right">Reservado por<br><b class="text-white">${creator}</b></div>
            </div>
        </div>
    `;
}

async function renderMatchFeed(list) {
    const container = document.getElementById('match-feed');
    if (!container) return;
    
    if (!list || list.length === 0) {
        container.innerHTML = '<div class="center p-10 opacity-30 text-xs font-bold">NO HAY PARTIDOS ABIERTOS</div>';
        return;
    }

    
    const html = await Promise.all(list.slice(0, 5).map(async (m, i) => {
        const date = m.fecha.toDate ? m.fecha.toDate() : new Date(m.fecha);
        const playersCount = m.jugadores?.length || 0;
        const creator = await getPlayerName(m.creador);
        
        return `
            <div class="match-entry animate-up" style="animation-delay: ${i * 0.05}s" onclick="openMatch('${m.id}', '${m.col}')">
                <div class="flex-row between items-center">
                    <div class="flex-row gap-4 items-center">
                        <div class="bg-white/5 p-2 rounded-lg text-center" style="min-width: 50px;">
                            <div class="text-sm font-black text-white">${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}</div>
                            <div class="text-[8px] text-scnd font-bold">${date.getDate()} ${date.toLocaleDateString('es-ES', { month: 'short' }).toUpperCase()}</div>
                        </div>
                        <div class="flex-col gap-0">
                            <span class="text-xs font-bold text-white">${creator}</span>
                            <span class="text-[9px] text-scnd">${m.isComp ? '⚡ COMPETITIVO' : '🤝 AMISTOSO'}</span>
                        </div>
                    </div>
                    <div class="flex-row gap-1">
                        ${[0,1,2,3].map(idx => `<div class="w-2 h-2 rounded-full ${idx < playersCount ? (m.isComp ? 'bg-sport-green' : 'bg-sport-blue') : 'bg-white/10'}"></div>`).join('')}
                    </div>
                </div>
            </div>
        `;
    }));
    container.innerHTML = html.join('');
}


async function loadInsights() {
    const weatherList = document.getElementById('weather-forecast-card');
    const quickWeather = document.getElementById('quick-weather');
    const tipBox = document.getElementById('tip-box');
    
    try {
        const w = await getDetailedWeather();
        if (w && w.current) {
            const cond = calculateCourtCondition(w.current.temperature_2m, w.current.rain, w.current.wind_speed_10m);
            if (quickWeather) quickWeather.innerHTML = `<i class="fas ${cond.icon} mr-1 ${cond.color}"></i> ${cond.condition} - ${Math.round(w.current.temperature_2m)}°C`;
            
            if (weatherList) {
                const daily = w.daily || { time: [], temperature_2m_max: [], weather_code: [] };
                weatherList.innerHTML = `
                    <div class="sport-card p-4 flex-col gap-4 animate-up" style="background: linear-gradient(135deg, rgba(59, 130, 246, 0.05), transparent);">
                        <div class="flex-row between items-center">
                            <div class="flex-col gap-1">
                                <span class="text-[8px] font-black text-scnd uppercase tracking-widest">Estado de la Pista</span>
                                <span class="text-xl font-black text-white">${cond.condition.toUpperCase()}</span>
                                <span class="text-[8px] text-scnd italic">${cond.advice || 'Condiciones ideales para el pádel.'}</span>
                            </div>
                            <div class="flex-col items-end gap-0">
                                <i class="fas ${cond.icon} text-3xl ${cond.color} mb-1"></i>
                                <span class="text-xs font-bold text-white">${Math.round(w.current.temperature_2m)}°C</span>
                                <span class="text-[7px] text-scnd uppercase font-black">${w.current.wind_speed_10m} km/h viento</span>
                            </div>
                        </div>
                        
                        <div class="h-px bg-white/5"></div>
                        
                        <div class="flex-row between">
                            ${daily.time.map((t, i) => {
                                const d = new Date(t);
                                const isToday = i === 0;
                                return `
                                    <div class="flex-col center flex-1 ${isToday ? 'opacity-100' : 'opacity-40'}">
                                        <span class="text-[7px] font-bold uppercase">${isToday ? 'Hoy' : d.toLocaleDateString('es-ES', { weekday: 'short' })}</span>
                                        <i class="fas ${getIconFromCode(daily.weather_code[i])} text-xs my-1 text-sport-blue"></i>
                                        <span class="text-[8px] font-bold">${Math.round(daily.temperature_2m_max[i])}°</span>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }
        }
    } catch (e) { 
        if (quickWeather) quickWeather.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i> CLIMA N/A'; 
    }
    
    try {
        const tip = await getDailyTip();
        if (tipBox) {
            tipBox.innerHTML = `
                <i class="fas fa-lightbulb text-2xl text-yellow-400 mb-2"></i>
                <span class="text-[9px] font-black uppercase text-white">Coach Tip</span>
                <span class="text-[7px] text-scnd opacity-60 truncate w-full text-center">${tip.title}</span>
            `;
            tipBox.onclick = () => showToast('💡 Consejo Padel', tip.content, 'info');
        }
    } catch (e) {}
}


function getIconFromCode(code) {
    if (code <= 3) return 'fa-sun';
    if (code <= 48) return 'fa-cloud';
    if (code <= 67) return 'fa-cloud-rain';
    if (code <= 77) return 'fa-snowflake';
    if (code <= 82) return 'fa-cloud-showers-heavy';
    if (code <= 99) return 'fa-bolt';
    return 'fa-cloud';
}



async function getPlayerName(uid) {
    if (!uid) return null;
    if (uid.startsWith('GUEST_')) return uid.split('_')[1];
    const d = await getDocument('usuarios', uid);
    return d?.nombreUsuario || d?.nombre || 'Jugador';
}

window.openMatch = async (id, col) => {
    const overlay = document.getElementById('modal-match');
    const area = document.getElementById('match-detail-area');
    overlay.classList.add('active');
    area.innerHTML = '<div class="center py-20"><div class="spinner-galaxy"></div></div>';
    const { renderMatchDetail } = await import('./match-service.js');
    renderMatchDetail(area, id, col, currentUser, userData);
};
