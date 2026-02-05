// ranking.js - Leaderboard & Points History V4.0
import { db, auth, observerAuth, getDocument } from './firebase-service.js';
import { collection, getDocs, query, orderBy, limit, where } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, countUp, showToast } from './ui-core.js';
import { injectHeader, injectNavbar, initBackground, setupModals } from './modules/ui-loader.js';

let currentUser = null;
let userData = null;
window.podiumData = [];

document.addEventListener('DOMContentLoaded', () => {
    initAppUI('ranking');
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
        
        // Trend
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
        if (photo) av.innerHTML = `<div class="avatar-premium"><img src="${photo}"></div>`;
        else av.innerHTML = `<div class="avatar-premium initials">${userName.substring(0, 2).toUpperCase()}</div>`;
        
        // Dynamic medal color logic is handled by CSS classes in HTML
    }
    if (name) name.textContent = userName;
    if (pts) countUp(pts, user.puntosRanking || 1000);
}

function renderLeaderboard(list) {
    const container = document.getElementById('lb-list');
    if (!container) return;
    
    container.innerHTML = list.map((u, i) => {
        const isMe = u.id === currentUser.uid;
        const name = u.nombreUsuario || u.nombre || 'Jugador';
        const photo = u.fotoPerfil || u.fotoURL || './imagenes/default-avatar.png'; // Fallback
        
        // Comparison logic (me vs others)
        let compHtml = '';
        if (!isMe && userData) {
            const diff = (u.puntosRanking || 1000) - (userData.puntosRanking || 1000);
            const diffClass = diff >= 0 ? 'text-danger' : 'text-success';
            const diffSign = diff >= 0 ? '+' : '';
            if (diff !== 0) compHtml = `<span class="pts-diff ${diffClass}">${diffSign}${Math.round(diff)}</span>`;
        } else if (isMe) {
            compHtml = `<span class="pts-diff text-primary">TÚ</span>`;
        }

        // Stats Calculation
        const ps = u.partidosJugados || 0;
        const vs = u.victorias || 0;
        const winrate = ps > 0 ? Math.round((vs / ps) * 100) : 0;
        
        // Gradient Logic: Galactic Shift
        // Top ranks (handled by podium) start index at 0 (effectively 4th place in list logic usually, or list includes all?)
        // If list includes podium, we should skip them or style them.
        // Assuming list is FULL list.
        
        let bgStyle = '';
        if (!isMe) {
            // Shift from Blue (top) to Deep Purple (bottom)
            const depth = Math.min(i / 20, 1); // 0 to 1 over 20 positions
            const r = 15 + (10 * depth);
            const g = 23 + (5 * depth);
            const b = 42 + (20 * depth);
            const a = 0.4 - (depth * 0.2); // Fade out slightly
            bgStyle = `background: linear-gradient(90deg, rgba(${r},${g},${b},${a}) 0%, rgba(15, 23, 42, 0.1) 100%); border-left: 3px solid rgba(${0 + (100*depth)}, 212, 255, ${0.5 - (depth*0.3)})`;
        }

        return `
            <div class="lb-row ${isMe ? 'me' : ''} animate-up" 
                 onclick="viewProfile('${u.id}')" 
                 style="animation-delay: ${i * 0.03}s; ${!isMe ? bgStyle : ''}">
                
                <div class="lb-cell-rank">${u.rank}</div>
                
                <div class="lb-cell-player">
                    <img src="${photo}" class="lb-player-img" loading="lazy">
                    <span class="lb-player-name">${name}</span>
                </div>
                
                <div class="lb-cell-level">
                    <span class="level-badge-mini">${(u.nivel || 2.5).toFixed(2)}</span>
                </div>
                
                <div class="lb-cell-stats">
                    <div class="winrate-bar-track">
                        <div class="winrate-bar-fill" style="width: ${winrate}%"></div>
                    </div>
                    <span class="stats-text-mini">${winrate}% WR</span>
                </div>
                
                <div class="lb-cell-pts">
                    <span class="pts-val">${Math.round(u.puntosRanking || 1000)}</span>
                    ${compHtml}
                </div>
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
            container.innerHTML = '<div class="empty-state"><span class="empty-text">Sin historial</span></div>';
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
                <div class="history-entry ${isWin ? 'win' : 'loss'}" onclick="showMatchBreakdown('${log.matchId}', ${log.diff}, ${log.newTotal})">
                    <div class="history-icon">
                        <i class="fas ${isWin ? 'fa-arrow-up' : 'fa-arrow-down'}"></i>
                    </div>
                    <div class="history-details">
                        <span class="history-title">${isWin ? 'Victoria' : 'Derrota'} ${matchInfo ? `<span class="history-score">${matchInfo}</span>` : ''}</span>
                        <span class="history-date">${date || 'N/A'}</span>
                    </div>
                    <span class="history-value">${isWin ? '+' : ''}${log.diff}</span>
                </div>
            `;
        }));
        
        container.innerHTML = entries.join('');
        
    } catch (e) {
        console.error('Error loading history:', e);
        container.innerHTML = '<div class="error-state">Error cargando historial</div>';
    }
}

window.showMatchBreakdown = async (matchId, diff, total) => {
    const overlay = document.getElementById('modal-match-detail');
    const area = document.getElementById('match-breakdown-area');
    overlay.classList.add('active');
    
    if (!matchId) {
        area.innerHTML = `
            <div class="modal-header-row mb-4">
                <h3 class="modal-title">Desglose de Puntos</h3>
                <button class="btn-icon-glass sm" onclick="document.getElementById('modal-match-detail').classList.remove('active')"><i class="fas fa-times"></i></button>
            </div>
            <div class="sport-card p-4 text-center">
                <span class="font-display font-black text-3xl ${diff > 0 ? 'text-sport-green' : 'text-danger'}">${diff > 0 ? '+' : ''}${diff}</span>
                <span class="block text-sm text-muted mt-2">Detalles no disponibles</span>
            </div>
        `;
        return;
    }
    
    area.innerHTML = '<div class="loading-state"><div class="spinner-neon"></div></div>';
    
    const match = await getDocument('partidosReto', matchId) || await getDocument('partidosAmistosos', matchId);
    
    if (!match) {
        area.innerHTML = '<div class="empty-state text-danger">Partido no encontrado</div>';
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
    
    // Detailed Point Breakdown Logic
    const basePoints = 25; // Standard base
    const levelFactor = Math.round(diff * 0.4); // Points from level difference
    const streakBonus = Math.round(diff * 0.1); // Streak bonus
    const resultFactor = diff - levelFactor - streakBonus; // Remaining is result weight

    area.innerHTML = `
        <div class="modal-header-row mb-4">
            <h3 class="modal-title">Análisis de Puntuación</h3>
            <button class="btn-icon-glass sm" onclick="document.getElementById('modal-match-detail').classList.remove('active')">
                <i class="fas fa-times"></i>
            </button>
        </div>
        
        <div class="sport-card p-4 mb-4 ${won ? 'glow-green' : 'glow-red'}">
            <div class="flex-row between mb-3">
                <span class="status-badge ${won ? 'badge-green' : 'badge-orange'}">${won ? 'VICTORIA' : 'DERROTA'}</span>
                <span class="text-xs text-muted">${date ? date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : ''}</span>
            </div>
            
            <div class="text-center mb-4">
                <span class="font-display font-black text-4xl text-white tracking-widest">${match.resultado?.sets || '-'}</span>
                <span class="block text-xs text-muted mt-1 uppercase tracking-widest">${isComp ? 'Partido Oficial' : 'Amistoso'}</span>
            </div>
            
            <div class="match-teams-display">
                <span class="team-name ${myTeam === 1 ? 'chk' : ''}">${team1}</span>
                <span class="vs-label">VS</span>
                <span class="team-name ${myTeam === 2 ? 'chk' : ''}">${team2}</span>
            </div>
        </div>
        
        <h4 class="section-subtitle mb-3">Desglose de Rendimiento</h4>
        
        <div class="flex-col gap-3 mb-4">
            <div class="point-factor-row">
                <div class="factor-icon bg-blue-500/20 text-blue-400"><i class="fas fa-trophy"></i></div>
                <div class="factor-info">
                    <span class="factor-name">Resultado Base</span>
                    <span class="factor-desc">Puntos por ${won ? 'ganar' : 'perder'} el encuentro</span>
                </div>
                <span class="factor-val text-white">${resultFactor > 0 ? '+' : ''}${resultFactor}</span>
            </div>

            <div class="point-factor-row">
                <div class="factor-icon bg-purple-500/20 text-purple-400"><i class="fas fa-layer-group"></i></div>
                <div class="factor-info">
                    <span class="factor-name">Diferencia Nivel</span>
                    <span class="factor-desc">Ajuste por nivel de rivales</span>
                </div>
                <span class="factor-val ${levelFactor >= 0 ? 'text-sport-green' : 'text-danger'}">${levelFactor > 0 ? '+' : ''}${levelFactor}</span>
            </div>

            <div class="point-factor-row">
                <div class="factor-icon bg-orange-500/20 text-orange-400"><i class="fas fa-fire"></i></div>
                <div class="factor-info">
                    <span class="factor-name">Racha Actual</span>
                    <span class="factor-desc">Bonus por consistencia</span>
                </div>
                <span class="factor-val text-white">${streakBonus > 0 ? '+' : ''}${streakBonus}</span>
            </div>
        </div>
        
        <div class="sport-card p-4 gradient-card flex-row between items-center">
            <div class="flex-col">
                <span class="font-bold text-white text-sm uppercase opacity-90">Impacto Total</span>
                <span class="text-xs text-white opacity-60">Nuevo ELO: ${total}</span>
            </div>
            <span class="font-display font-black text-3xl text-white">${diff > 0 ? '+' : ''}${diff}</span>
        </div>
    `;
};

window.viewProfile = async (uid) => {
    if (!uid) return;
    
    const overlay = document.getElementById('modal-user');
    const area = document.getElementById('user-detail-area');
    
    if(overlay) overlay.classList.add('active');
    if(area) area.innerHTML = '<div class="loading-state"><div class="spinner-neon"></div></div>';
    
    const user = await getDocument('usuarios', uid);
    if (!user) {
        if(area) area.innerHTML = '<div class="empty-state text-danger">Usuario no encontrado</div>';
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

    let logsHtml = '<h4 class="section-subtitle mb-2">Últimos Resultados</h4>';
    if (userLogs.empty) {
        logsHtml += '<div class="empty-list-text">Sin partidos recientes</div>';
    } else {
        const logEntries = await Promise.all(userLogs.docs.map(async d => {
            const log = d.data();
            const date = log.timestamp?.toDate ? log.timestamp.toDate() : new Date();
            return `
                <div class="flex-row between p-2 bg-glass rounded-lg mb-2 items-center">
                    <div class="flex-col gap-0">
                        <span class="text-xs font-bold ${log.diff > 0 ? 'text-sport-green' : 'text-danger'}">${log.diff > 0 ? 'VICTORIA' : 'DERROTA'}</span>
                        <span class="text-2xs text-muted">${date.toLocaleDateString('es-ES', {day:'numeric', month:'short'})}</span>
                    </div>
                    <span class="font-black text-sm text-white">${log.diff > 0 ? '+' : ''}${log.diff}</span>
                </div>
            `;
        }));
        logsHtml += logEntries.join('');
    }

    // Format vivienda display
    const viv = user.vivienda || {};
    const viviendaStr = viv.bloque ? `Blq ${viv.bloque} - ${viv.piso}º${viv.puerta}` : 'Sin vivienda';
    
    if(area) area.innerHTML = `
        <div class="profile-modal-v5 animate-up">
            <!-- Header with cover effect -->
            <div class="profile-header-v5">
                <div class="profile-cover"></div>
                <div class="profile-main-info">
                    <div class="profile-avatar-wrapper">
                        ${photo ? `<img src="${photo}" class="profile-img-v5">` : `<div class="profile-initials-v5">${name.substring(0,2).toUpperCase()}</div>`}
                        <div class="profile-level-tag">NV. ${(user.nivel || 2.5).toFixed(2)}</div>
                    </div>
                    <h2 class="profile-name-v5">${name}</h2>
                    <div class="profile-badges-row">
                        <span class="p-badge badge-housing"><i class="fas fa-house-user"></i> ${viviendaStr}</span>
                    </div>
                </div>
            </div>

            <!-- Stats Grid Premium with Colors -->
            <div class="profile-stats-grid-v5">
                <div class="p-stat-card stat-blue">
                    <i class="fas fa-ranking-star"></i>
                    <div class="flex-col">
                        <span class="p-val">${Math.round(user.puntosRanking || 1000)}</span>
                        <span class="p-lbl">Puntos ELO</span>
                    </div>
                </div>
                <div class="p-stat-card stat-green">
                    <i class="fas fa-trophy"></i>
                    <div class="flex-col">
                        <span class="p-val">${user.victorias || 0}</span>
                        <span class="p-lbl">Victorias</span>
                    </div>
                </div>
                <div class="p-stat-card stat-orange">
                    <i class="fas fa-fire"></i>
                    <div class="flex-col">
                        <span class="p-val">${user.rachaActual || 0}</span>
                        <span class="p-lbl">Racha</span>
                    </div>
                </div>
                <div class="p-stat-card stat-purple">
                    <i class="fas fa-percentage"></i>
                    <div class="flex-col">
                        <span class="p-val">${winrate}%</span>
                        <span class="p-lbl">Win Rate</span>
                    </div>
                </div>
            </div>

            <!-- Results Section -->
            <div class="profile-results-section">
                ${logsHtml}
            </div>

            <!-- Actions -->
            <div class="profile-actions-v5">
                <button class="btn-primary flex-1 py-3" onclick="showToast('Comparar', 'Comparativa de niveles: Tú vs ${name}', 'info')">
                    <i class="fas fa-code-compare mr-2"></i> COMPARAR
                </button>
                <button class="btn-secondary flex-1 py-3" onclick="window.location.href='mailto:${user.email}'">
                    <i class="fas fa-envelope mr-2"></i> CONTACTAR
                </button>
            </div>
            
            <button class="btn-ghost w-full py-3 mt-2 text-xs opacity-50" onclick="document.getElementById('modal-user').classList.remove('active')">
                CERRAR FICHA
            </button>
        </div>
    `;
};
