// ranking.js - Leaderboard & Points History (v18.0)
import { db, auth, observerAuth, getDocument } from './firebase-service.js';
import { collection, getDocs, query, orderBy, limit, where } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, countUp, showToast } from './ui-core.js';
import { injectHeader, injectNavbar, initBackground, setupModals } from './modules/ui-loader.js';

let currentUser = null;
let userData = null;
window.podiumData = [];

document.addEventListener('DOMContentLoaded', () => {
    initBackground();
    setupModals();
    
    observerAuth(async (user) => {
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        
        currentUser = user;
        userData = await getDocument('usuarios', user.uid);
        
        // Inject header with admin link if applicable
        await injectHeader(userData);
        injectNavbar('ranking');
        
        await loadRanking();
        await loadPointsHistory();
    });
});

async function loadRanking() {
    const snap = await getDocs(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"), limit(50)));
    const list = snap.docs.map((d, i) => ({ id: d.id, rank: i + 1, ...d.data() }));
    
    // My position
    const myIdx = list.findIndex(u => u.id === currentUser.uid);
    if (myIdx !== -1) {
        const me = list[myIdx];
        document.getElementById('my-rank').textContent = `#${me.rank}`;
        countUp(document.getElementById('my-pts'), me.puntosRanking || 1000);
        document.getElementById('my-level').textContent = (me.nivel || 2.5).toFixed(2);
        
        // Level progress (simplified: decimal part as percentage)
        const lvl = me.nivel || 2.5;
        const progress = (lvl % 1) * 100;
        document.getElementById('level-fill').style.width = `${progress}%`;
        document.getElementById('level-next').textContent = `→ ${Math.floor(lvl) + 1}.0`;
        
        // Trend (would need historical data, simulating for now)
        const trendEl = document.getElementById('rank-trend');
        if (me.rachaActual > 0) {
            trendEl.className = 'rank-trend up';
            trendEl.innerHTML = `<i class="fas fa-arrow-up"></i> ${me.rachaActual}`;
        } else if (me.rachaActual < 0) {
            trendEl.className = 'rank-trend down';
            trendEl.innerHTML = `<i class="fas fa-arrow-down"></i> ${Math.abs(me.rachaActual)}`;
        } else {
            trendEl.style.display = 'none';
        }
    }
    
    // Podium
    window.podiumData = list.slice(0, 3);
    for (let i = 0; i < 3; i++) {
        if (list[i]) await renderPodiumSlot(i + 1, list[i]);
    }
    
    // Leaderboard (4th onwards)
    renderLeaderboard(list.slice(3));
}

async function renderPodiumSlot(pos, user) {
    const av = document.getElementById(`p-av-${pos}`);
    const name = document.getElementById(`p-name-${pos}`);
    const pts = document.getElementById(`p-pts-${pos}`);
    
    const photo = user.fotoPerfil || user.fotoURL;
    const userName = user.nombreUsuario || user.nombre || 'Jugador';
    
    if (av) {
        if (photo) av.innerHTML = `<img src="${photo}">`;
        else av.textContent = userName.substring(0, 2).toUpperCase();
        
        // Dynamic medal color based on position
        if (pos === 1) av.style.borderColor = "#fbbf24";
        if (pos === 2) av.style.borderColor = "#94a3b8";
        if (pos === 3) av.style.borderColor = "#b45309";
    }
    if (name) name.textContent = userName;
    if (pts) countUp(pts, user.puntosRanking || 1000);
}

function renderLeaderboard(list) {
    const container = document.getElementById('lb-list');
    if (!container) return;
    
    container.innerHTML = list.map(u => {
        const isMe = u.id === currentUser.uid;
        const name = u.nombreUsuario || u.nombre || 'Jugador';
        const photo = u.fotoPerfil || u.fotoURL;
        const initials = name.substring(0, 2).toUpperCase();
        
        const medalClass = u.rank === 1 ? 'gold-lb' : u.rank === 2 ? 'silver-lb' : u.rank === 3 ? 'bronze-lb' : '';
        
        return `
            <div class="lb-entry ${isMe ? 'me' : ''} ${medalClass} animate-up" onclick="viewProfile('${u.id}')">
                <span class="lb-rank">${u.rank}</span>
                <div class="flex-row gap-3">
                    <div class="w-10 h-10 rounded-full overflow-hidden border-2 border-white/5 flex-shrink-0 center bg-slate-800 leaderboard-avatar">
                        ${photo ? `<img src="${photo}" class="w-full h-full object-cover">` : `<span class="font-bold text-xs">${initials}</span>`}
                    </div>
                    <div class="flex-col gap-0">
                        <span class="font-bold text-sm text-white truncate" style="max-width:130px">${name}</span>
                        <span class="text-2xs text-scnd">Nv. ${(u.nivel || 2.5).toFixed(1)}</span>
                    </div>
                </div>
                <span class="font-display font-black text-lg text-white">${Math.round(u.puntosRanking || 1000)}</span>
            </div>
        `;
    }).join('');
}

async function loadPointsHistory() {
    const container = document.getElementById('points-history');
    if (!container) return;
    
    try {
        const logs = await getDocs(query(
            collection(db, "rankingLogs"),
            where("uid", "==", currentUser.uid),
            orderBy("timestamp", "desc"),
            limit(10)
        ));
        
        if (logs.empty) {
            container.innerHTML = '<div class="text-center text-sm text-scnd py-6 opacity-50">Sin historial de puntos aún</div>';
            return;
        }
        
        const entries = await Promise.all(logs.docs.map(async (doc) => {
            const log = doc.data();
            const isWin = log.diff > 0;
            
            // Try to get match details
            let matchInfo = '';
            let date = '';
            if (log.matchId) {
                const match = await getDocument('partidosReto', log.matchId) || await getDocument('partidosAmistosos', log.matchId);
                if (match) {
                    matchInfo = match.resultado?.sets || '';
                    if (match.fecha) {
                        const d = match.fecha.toDate();
                        date = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
                    }
                }
            }
            if (!date && log.timestamp) {
                const d = log.timestamp.toDate();
                date = d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
            }
            
            return `
                <div class="history-entry" onclick="showMatchBreakdown('${log.matchId}', ${log.diff}, ${log.newTotal})">
                    <div class="history-icon ${isWin ? 'win' : 'loss'}">
                        <i class="fas ${isWin ? 'fa-trophy' : 'fa-times'}"></i>
                    </div>
                    <div class="flex-col gap-1">
                        <span class="font-bold text-sm text-white">${isWin ? 'Victoria' : 'Derrota'}${matchInfo ? ` · ${matchInfo}` : ''}</span>
                        <span class="text-2xs text-scnd">${date || 'Fecha no disponible'}</span>
                    </div>
                    <span class="history-pts ${isWin ? 'positive' : 'negative'}">${log.diff > 0 ? '+' : ''}${log.diff}</span>
                </div>
            `;
        }));
        
        container.innerHTML = entries.join('');
        
    } catch (e) {
        console.error('Error loading history:', e);
        container.innerHTML = '<div class="text-center text-sm text-red-400 py-6">Error al cargar historial</div>';
    }
}

window.showMatchBreakdown = async (matchId, diff, total) => {
    const overlay = document.getElementById('modal-match-detail');
    const area = document.getElementById('match-breakdown-area');
    overlay.classList.add('active');
    
    if (!matchId) {
        area.innerHTML = `
            <h3 class="font-display font-bold text-lg mb-4">Desglose de Puntos</h3>
            <div class="sport-card p-4 mb-4">
                <div class="flex-row between">
                    <span class="text-sm text-scnd">Cambio Total</span>
                    <span class="font-display font-black text-xl ${diff > 0 ? 'text-sport-green' : 'text-red-400'}">${diff > 0 ? '+' : ''}${diff}</span>
                </div>
            </div>
            <p class="text-sm text-scnd text-center">Detalles del partido no disponibles</p>
            <button class="btn-secondary mt-6" onclick="document.getElementById('modal-match-detail').classList.remove('active')">Cerrar</button>
        `;
        return;
    }
    
    area.innerHTML = '<div class="center py-10"><div class="spinner-galaxy"></div></div>';
    
    const match = await getDocument('partidosReto', matchId) || await getDocument('partidosAmistosos', matchId);
    
    if (!match) {
        area.innerHTML = '<div class="center py-10 text-scnd">Partido no encontrado</div>';
        return;
    }
    
    const date = match.fecha?.toDate();
    const players = match.jugadores || [];
    const isComp = matchId.includes('reto') || match.tipo === 'reto';
    
    // Get player names
    const playerNames = await Promise.all(players.map(async uid => {
        if (!uid) return 'Libre';
        if (uid.startsWith('GUEST_')) return uid.split('_')[1] + ' (Inv)';
        const u = await getDocument('usuarios', uid);
        return u?.nombreUsuario || u?.nombre || 'Jugador';
    }));
    
    const team1 = playerNames.slice(0, 2).join(' & ');
    const team2 = playerNames.slice(2, 4).map(n => n || 'Libre').join(' & ');
    const myTeam = players.indexOf(currentUser.uid) < 2 ? 1 : 2;
    const won = diff > 0;
    
    area.innerHTML = `
        <div class="flex-row between mb-4">
            <h3 class="font-display font-bold text-lg">Desglose del Partido</h3>
            <button class="btn-ghost" onclick="document.getElementById('modal-match-detail').classList.remove('active')">
                <i class="fas fa-times"></i>
            </button>
        </div>
        
        <div class="sport-card p-4 mb-4 ${won ? 'border-l-4 border-l-sport-green' : 'border-l-4 border-l-red-400'}">
            <div class="flex-row between mb-3">
                <span class="status-badge ${won ? 'badge-green' : 'badge-orange'}">${won ? 'Victoria' : 'Derrota'}</span>
                <span class="text-2xs text-scnd">${date ? date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : ''}</span>
            </div>
            
            <div class="text-center mb-4">
                <span class="font-display font-black text-3xl text-white">${match.resultado?.sets || '-'}</span>
            </div>
            
            <div class="sport-card p-3" style="background: rgba(0,0,0,0.2); border: none;">
                <div class="flex-row center gap-4 text-sm">
                    <span class="text-white font-bold ${myTeam === 1 ? 'text-sport-green' : ''}">${team1}</span>
                    <span class="text-2xs font-black text-sport-purple">VS</span>
                    <span class="text-white font-bold ${myTeam === 2 ? 'text-sport-green' : ''}">${team2}</span>
                </div>
            </div>
        </div>
        
        <h4 class="font-bold text-sm mb-3 text-scnd">Impacto en tu Ranking</h4>
        
        <div class="flex-col gap-2 mb-4">
            <div class="flex-row between p-3 bg-white/5 rounded-xl">
                <span class="text-sm text-scnd">Base ${isComp ? 'Competitivo' : 'Amistoso'}</span>
                <span class="font-bold ${diff > 0 ? 'text-sport-green' : 'text-red-400'}">${diff > 0 ? '+' : ''}${Math.round(diff * 0.8)}</span>
            </div>
            <div class="flex-row between p-3 bg-white/5 rounded-xl">
                <span class="text-sm text-scnd">Diferencia de Nivel</span>
                <span class="font-bold">${diff > 0 ? '+' : ''}${Math.round(diff * 0.15)}</span>
            </div>
            <div class="flex-row between p-3 bg-white/5 rounded-xl">
                <span class="text-sm text-scnd">Bonus Racha</span>
                <span class="font-bold">${diff > 0 ? '+' : ''}${Math.round(diff * 0.05)}</span>
            </div>
        </div>
        
        <div class="sport-card p-4" style="background: linear-gradient(135deg, rgba(139,92,246,0.2), rgba(0,0,0,0.2));">
            <div class="flex-row between">
                <span class="font-bold text-white">Total Puntos</span>
                <span class="font-display font-black text-2xl ${diff > 0 ? 'text-sport-green' : 'text-red-400'}">${diff > 0 ? '+' : ''}${diff}</span>
            </div>
            <div class="flex-row between mt-2">
                <span class="text-2xs text-scnd">Nuevo Total</span>
                <span class="font-bold text-white">${total} pts</span>
            </div>
        </div>
    `;
};

window.viewProfile = async (uid) => {
    if (!uid) return;
    
    const overlay = document.getElementById('modal-user');
    const area = document.getElementById('user-detail-area');
    
    overlay.classList.add('active');
    area.innerHTML = '<div class="center py-20"><div class="spinner-galaxy"></div></div>';
    
    const user = await getDocument('usuarios', uid);
    if (!user) {
        area.innerHTML = '<div class="center py-10 text-scnd">Usuario no encontrado</div>';
        return;
    }
    
    const name = user.nombreUsuario || user.nombre || 'Jugador';
    const photo = user.fotoPerfil || user.fotoURL;
    const winrate = user.partidosJugados > 0 ? Math.round((user.victorias / user.partidosJugados) * 100) : 0;
    
    // Fetch last 3 logs for this user

    const userLogs = await getDocs(query(
        collection(db, "rankingLogs"),
        where("uid", "==", uid),
        orderBy("timestamp", "desc"),
        limit(3)
    ));

    let logsHtml = '<span class="text-[10px] font-black text-scnd uppercase mb-3 block">Últimos Partidos</span>';
    if (userLogs.empty) {
        logsHtml += '<div class="text-[10px] text-scnd opacity-50 py-4">Sin partidos recientes registrados</div>';
    } else {
        const logEntries = await Promise.all(userLogs.docs.map(async d => {
            const log = d.data();
            const date = log.timestamp?.toDate ? log.timestamp.toDate() : new Date();
            return `
                <div class="flex-row between p-2 bg-white/5 rounded-lg mb-2 border border-white/5">
                    <div class="flex-col gap-0 text-left">
                        <span class="text-[10px] font-bold text-white">${log.diff > 0 ? 'Victoria' : 'Derrota'}</span>
                        <span class="text-[8px] text-scnd">${date.toLocaleDateString('es-ES', {day:'numeric', month:'short'})}</span>
                    </div>
                    <span class="font-black text-sm ${log.diff > 0 ? 'text-sport-green' : 'text-red-400'}">${log.diff > 0 ? '+' : ''}${log.diff}</span>
                </div>
            `;
        }));
        logsHtml += logEntries.join('');
    }

    area.innerHTML = `
        <div class="flex-col center mb-6">
            <div class="w-16 h-16 rounded-full overflow-hidden border-2 border-sport-green/30 mb-2 bg-slate-800 center">
                ${photo ? `<img src="${photo}" class="w-full h-full object-cover">` : `<span class="font-bold text-xl text-white">${name.substring(0,2).toUpperCase()}</span>`}
            </div>
            <h2 class="font-display font-black text-lg text-white">${name}</h2>
            <span class="text-[10px] text-sport-green font-bold">Nivel ${(user.nivel || 2.5).toFixed(2)}</span>
        </div>
        
        <div class="grid grid-cols-3 gap-2 mb-6">
            <div class="bg-white/5 rounded-xl center flex-col p-2">
                <span class="font-black text-lg text-sport-blue">${Math.round(user.puntosRanking || 1000)}</span>
                <span class="text-[7px] text-scnd uppercase font-bold">Puntos</span>
            </div>
            <div class="bg-white/5 rounded-xl center flex-col p-2">
                <span class="font-black text-lg text-sport-green">${user.victorias || 0}</span>
                <span class="text-[7px] text-scnd uppercase font-bold">Wins</span>
            </div>
            <div class="bg-white/5 rounded-xl center flex-col p-2">
                <span class="font-black text-lg text-white">${winrate}%</span>
                <span class="text-[7px] text-scnd uppercase font-bold">WR</span>
            </div>
        </div>

        <div class="mb-6">
            ${logsHtml}
        </div>
        
        <button class="btn-primary w-full py-3 text-xs" onclick="document.getElementById('modal-user').classList.remove('active')">CERRAR PERFIL</button>
    `;
};

