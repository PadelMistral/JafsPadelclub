// ranking.js - Leaderboard & Points History V4.0
import { db, auth, observerAuth, getDocument } from './firebase-service.js';
import { collection, getDocs, query, orderBy, limit, where } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, countUp, showToast } from './ui-core.js';
import { injectHeader, injectNavbar, initBackground, setupModals } from './modules/ui-loader.js';

let currentUser = null;
let userData = null;
window.podiumData = [];

function getPoints(user) {
    if (user.puntosRanking !== undefined && user.puntosRanking !== null) return user.puntosRanking;
    const l = parseFloat(user.nivel) || 2.5;
    // New scale: 1000 base at 2.5, 400pts per level unit
    return Math.round(1000 + (l - 2.5) * 400);
}

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
    console.log("Iniciando carga de ranking y validación de puntos...");
    const snap = await getDocs(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"), limit(100)));
    
    // Auto-initialization for users without points
    const list = await Promise.all(snap.docs.map(async (d) => {
        let data = d.data();
        if (data.puntosRanking === undefined || data.puntosRanking === null) {
            const initialPts = Math.round(1000 + ((data.nivel || 2.5) - 2.5) * 400);
            console.log(`Inicializando puntos para ${data.nombreUsuario || data.nombre}: ${initialPts}`);
            await updateDocument('usuarios', d.id, { puntosRanking: initialPts });
            data.puntosRanking = initialPts;
        }
        return { id: d.id, ...data };
    }));

    // Sort again after potential updates (though updates are async, next load will be perfect)
    list.sort((a, b) => b.puntosRanking - a.puntosRanking);
    list.forEach((u, i) => u.rank = i + 1);

    // My position tracking
    const myPos = list.findIndex(u => u.id === currentUser.uid);
    if (myPos !== -1) {
        const me = list[myPos];
        const prevRank = userData?.lastRank || me.rank;
        
        document.getElementById('my-rank').textContent = `#${me.rank}`;
        countUp(document.getElementById('my-pts'), me.puntosRanking);
        document.getElementById('my-level').textContent = (me.nivel || 2.5).toFixed(2);
        
        if (prevRank > me.rank) {
            showToast("¡Subiste de Puesto!", `Has ascendido al puesto #${me.rank} 🚀`, "success");
            await updateDocument('usuarios', currentUser.uid, { lastRank: me.rank });
        } else if (prevRank < me.rank) {
            await updateDocument('usuarios', currentUser.uid, { lastRank: me.rank });
        }

        // Level progress
        const lvl = me.nivel || 2.5;
        const progress = (lvl % 0.5) / 0.5 * 100;
        document.getElementById('level-fill').style.width = `${progress}%`;
        document.getElementById('level-next').textContent = `→ ${(Math.floor(lvl * 2) / 2 + 0.5).toFixed(1)}`;
        
        const trendEl = document.getElementById('rank-trend');
        if (me.rachaActual > 0) {
            trendEl.className = 'rank-trend up';
            trendEl.innerHTML = `<i class="fas fa-arrow-up"></i> ${me.rachaActual}`;
            trendEl.style.display = 'inline-flex';
        } else if (me.rachaActual < 0) {
            trendEl.className = 'rank-trend down';
            trendEl.innerHTML = `<i class="fas fa-arrow-down"></i> ${Math.abs(me.rachaActual)}`;
            trendEl.style.display = 'inline-flex';
        } else {
            trendEl.style.display = 'none';
        }

        const metaEl = document.getElementById('rank-meta-text');
        if (metaEl) {
            const totalPlayers = list.length || 1;
            const percentile = Math.max(1, Math.min(100, Math.round((1 - ((me.rank - 1) / totalPlayers)) * 100)));
            metaEl.textContent = `Estás en el TOP ${percentile}% de ${totalPlayers} jugadores activos`;
        }
    }
    
    window.podiumData = list.slice(0, 3);
    for (let i = 0; i < 3; i++) {
        if (list[i]) await renderPodiumSlot(i + 1, list[i]);
    }
    
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
    if (pts) countUp(pts, getPoints(user));
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
            const diff = getPoints(u) - getPoints(userData);
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
                    <div class="flex-col justify-center" style="line-height: 1.1;">
                        <span class="lb-player-name">${name}</span>
                        ${(u.vivienda && u.vivienda.bloque) ? `<span class="text-[9px] text-muted font-bold opacity-70">Blq ${u.vivienda.bloque} - ${u.vivienda.piso}º${u.vivienda.puerta}</span>` : ''}
                    </div>
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
                    <span class="pts-val">${Math.round(getPoints(u))}</span>
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

window.showMatchBreakdown = async (matchId, diff, total, targetUid = null) => {
    const overlay = document.getElementById('modal-match-detail');
    const area = document.getElementById('match-breakdown-area');
    overlay.classList.add('active');
    
    const uidToUse = targetUid || currentUser?.uid;
    
    if (!matchId || !uidToUse) {
        area.innerHTML = `
            <div class="modal-header-row mb-6">
                <h3 class="modal-title">Desglose de Puntos</h3>
                <button class="btn-icon-glass sm" onclick="document.getElementById('modal-match-detail').classList.remove('active')"><i class="fas fa-times"></i></button>
            </div>
            <div class="sport-card p-10 text-center">
                <span class="font-display font-black text-4xl ${diff > 0 ? 'text-sport-green' : 'text-sport-red'}">${diff > 0 ? '+' : ''}${diff}</span>
                <span class="block text-sm text-muted mt-4">Detalles no disponibles</span>
            </div>
        `;
        return;
    }
    
    area.innerHTML = '<div class="loading-state h-64 flex items-center justify-center"><div class="spinner-neon"></div></div>';
    
    // Fetch both match and specific log
    const [match, logsSnap] = await Promise.all([
        getDocument('partidosReto', matchId) || getDocument('partidosAmistosos', matchId),
        getDocs(query(collection(db, "rankingLogs"), where("uid", "==", uidToUse), where("matchId", "==", matchId), limit(1)))
    ]);
    
    if (!match) {
        area.innerHTML = '<div class="empty-state text-danger p-20 text-center">Partido no encontrado o datos incompletos.</div>';
        return;
    }

    const log = logsSnap.empty ? null : logsSnap.docs[0].data();
    const details = log?.details || {};
    
    const date = match.fecha?.toDate ? match.fecha.toDate() : (match.fecha ? new Date(match.fecha) : null);
    const players = match.jugadores || [];
    const isComp = matchId.includes('reto') || match.tipo === 'reto';
    
    // Get player names
    const playerNames = await Promise.all(players.map(async pid => {
        if (!pid) return 'Libre';
        if (pid.startsWith('GUEST_')) return pid.split('_')[1];
        const u = await getDocument('usuarios', pid);
        return u ? (u.nombreUsuario || u.nombre).split(' ')[0] : 'Jugador';
    }));
    
    const team1 = playerNames.slice(0, 2).join(' & ');
    const team2 = playerNames.slice(2, 4).join(' & ');
    const myIdx = players.indexOf(uidToUse);
    const myTeam = myIdx < 2 ? 1 : 2;
    const won = diff > 0;
    
    // Factors
    const partnerName = details.partnerName || (myTeam === 1 ? playerNames[myIdx === 0 ? 1 : 0] : playerNames[myIdx === 2 ? 3 : 2]);
    const gapMult = details.gapMultiplier || 1.0;
    const streakMult = details.streakMultiplier || 1.0;
    const prediction = details.prediction || 50;

    const levelFactor = details.gapMultiplier ? Math.round(diff * (1 - 1/details.gapMultiplier)) : Math.round(diff * 0.2);
    const streakFactor = details.streakMultiplier ? Math.round(diff * (1 - 1/details.streakMultiplier)) : 0;
    const resultFactor = diff - levelFactor - streakFactor;

    area.innerHTML = `
        <div class="modal-header-row mb-8 flex-row between items-center">
            <h3 class="modal-title italic tracking-widest text-primary">Análisis PagaPosta™</h3>
            <button class="btn-close-neon" onclick="document.getElementById('modal-match-detail').classList.remove('active')">
                <i class="fas fa-times"></i>
            </button>
        </div>
        
        <div class="sport-card p-8 mb-8 ${won ? 'glow-green' : 'glow-red'} bg-glass-heavy border border-white/10 rounded-[32px]">
            <div class="flex-row between mb-6 items-center">
                <span class="status-badge ${won ? 'badge-green' : 'badge-orange'} uppercase font-black text-[10px] px-4 py-1.5 rounded-full">${won ? 'VICTORIA' : 'DERROTA'}</span>
                <span class="text-[11px] text-muted font-black">${date ? date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : ''}</span>
            </div>
            
            <div class="text-center mb-8">
                <span class="font-display font-black text-5xl text-white tracking-widest block">${match.resultado?.sets || '0-0 0-0'}</span>
                <span class="text-[10px] text-muted font-bold mt-3 block tracking-[5px] uppercase opacity-60">${isComp ? 'LIGA OFICIAL' : 'AMISTOSO'}</span>
            </div>
            
            <div class="flex-row items-center justify-center gap-6 py-5 border-y border-white/5">
                <div class="flex-1 text-right">
                    <span class="text-[12px] font-black text-white uppercase ${myTeam === 1 ? 'text-primary' : 'opacity-60'}">${team1}</span>
                </div>
                <span class="text-[10px] font-black text-muted opacity-30 italic">vs</span>
                <div class="flex-1 text-left">
                    <span class="text-[12px] font-black text-white uppercase ${myTeam === 2 ? 'text-primary' : 'opacity-60'}">${team2}</span>
                </div>
            </div>
        </div>
        
        <div class="grid grid-cols-2 gap-5 mb-8">
            <div class="bg-white-03 p-5 rounded-3xl border border-white-05">
                <span class="block text-[9px] text-muted uppercase font-black mb-2 tracking-wider opacity-60">Compañero</span>
                <span class="text-base text-white font-black truncate block">${partnerName}</span>
            </div>
            <div class="bg-white-03 p-5 rounded-3xl border border-white-05">
                <span class="block text-[9px] text-muted uppercase font-black mb-2 tracking-wider opacity-60">Pronóstico</span>
                <span class="text-base font-black ${prediction > 50 ? 'text-sport-green' : 'text-sport-red'}">${prediction}% Éxito</span>
            </div>
        </div>

        <h4 class="text-[11px] font-black text-white italic uppercase tracking-[4px] mb-6 text-center opacity-40">Métricas de Rendimiento</h4>
        
        <div class="flex-col gap-4 mb-8">
            <div class="point-factor-row bg-white-03 p-5 rounded-3xl border border-white-05 flex-row items-center gap-5">
                <div class="factor-icon bg-blue-500/20 text-blue-400 w-12 h-12 rounded-2xl flex-center"><i class="fas fa-trophy text-lg"></i></div>
                <div class="factor-info flex-1">
                    <span class="text-[12px] font-black text-white uppercase block">Resultado Base</span>
                    <span class="text-[10px] text-muted font-bold block">Mérito por el set final</span>
                </div>
                <span class="text-xl font-black text-white">${resultFactor > 0 ? '+' : ''}${resultFactor}</span>
            </div>

            <div class="point-factor-row bg-white-03 p-5 rounded-3xl border border-white-05 flex-row items-center gap-5">
                <div class="factor-icon bg-purple-500/20 text-purple-400 w-12 h-12 rounded-2xl flex-center"><i class="fas fa-layer-group text-lg"></i></div>
                <div class="factor-info flex-1">
                    <span class="text-[12px] font-black text-white uppercase block">Diferencial Nivel</span>
                    <span class="text-[10px] text-muted font-bold block">Factor de brecha x${gapMult.toFixed(2)}</span>
                </div>
                <span class="text-xl font-black ${levelFactor >= 0 ? 'text-sport-green' : 'text-sport-red'}">${levelFactor > 0 ? '+' : ''}${levelFactor}</span>
            </div>

            <div class="point-factor-row bg-white-03 p-5 rounded-3xl border border-white-05 flex-row items-center gap-5">
                <div class="factor-icon bg-orange-500/20 text-orange-400 w-12 h-12 rounded-2xl flex-center"><i class="fas fa-fire text-lg"></i></div>
                <div class="factor-info flex-1">
                    <span class="text-[12px] font-black text-white uppercase block">Inercia Victoria</span>
                    <span class="text-[10px] text-muted font-bold block">Bonus x${streakMult.toFixed(2)} acumulado</span>
                </div>
                <span class="text-xl font-black ${streakFactor >= 0 ? 'text-sport-green' : 'text-sport-red'}">${streakFactor > 0 ? '+' : ''}${streakFactor}</span>
            </div>
        </div>
        
        <div class="p-6 rounded-[32px] bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 flex-row between items-center shadow-2xl">
            <div class="flex-col">
                <span class="font-black text-white text-[11px] uppercase tracking-widest mb-1.5 opacity-80">Total Inyectado</span>
                <span class="text-[10px] text-muted font-bold">Ranking Actualizado: ${total} Pts</span>
            </div>
            <span class="font-display font-black text-5xl text-primary glow-text">${diff > 0 ? '+' : ''}${diff}</span>
        </div>
        <div class="h-4"></div>
    `;
};


window.viewProfile = async (uid) => {
    if (!uid) return;
    
    const overlay = document.getElementById('modal-user');
    const area = document.getElementById('user-detail-area');
    
    if(overlay) overlay.classList.add('active');
    if(area) area.innerHTML = `
        <div class="flex-col items-center justify-center p-10 h-64">
            <div class="spinner-neon mb-4"></div>
            <span class="text-xs text-muted font-black tracking-widest">SINCRONIZANDO PERFIL...</span>
        </div>
    `;
    
    const user = await getDocument('usuarios', uid);
    if (!user) {
        if(area) area.innerHTML = '<div class="empty-state text-danger p-10">Usuario no detectado.</div>';
        return;
    }
    
    const name = user.nombreUsuario || user.nombre || 'JUGADOR';
    const photo = user.fotoPerfil || user.fotoURL;
    const viv = user.vivienda || user.direccion || {};
    const viviendaStr = viv.bloque ? `BLOQUE ${viv.bloque} • ${viv.piso}º${viv.puerta}` : 'SIN VIVIENDA REGISTRADA';

    // Fetch substantial history (up to 50 logs)
    const userLogsSnap = await getDocs(query(
        collection(db, "rankingLogs"),
        where("uid", "==", uid),
        limit(50)
    ));

    // Sort and Process Logs
    const sortedLogs = userLogsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
            const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp ? new Date(a.timestamp).getTime() : 0);
            const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp ? new Date(b.timestamp).getTime() : 0);
            return timeB - timeA;
        });

    const logsEntries = sortedLogs.length === 0 
        ? `<div class="flex-col items-center justify-center py-20 opacity-30 w-full h-full text-center">
             <div class="p-6 rounded-full bg-white/5 mb-4">
                <i class="fas fa-folder-open text-4xl text-primary"></i>
             </div>
             <span class="text-[10px] font-black uppercase tracking-[3px]">Sector de actividad vacío</span>
           </div>`
        : await (async () => {
            const items = await Promise.all(sortedLogs.map(async log => {
                const isWin = log.diff > 0;
                const date = log.timestamp?.toDate ? log.timestamp.toDate() : new Date();
                
                // Get match details (Rivals & Score)
                let vsStr = 'Partido Desconocido';
                let scoreStr = '';
                if (log.matchId) {
                    const match = await getDocument('partidosReto', log.matchId) || await getDocument('partidosAmistosos', log.matchId);
                    if (match) {
                        scoreStr = match.resultado?.sets || '';
                        if (match.jugadores) {
                            const myIdx = match.jugadores.findIndex(pid => pid === uid);
                            const rivalIdxs = (myIdx < 2) ? [2, 3] : [0, 1];
                            const rivalNames = await Promise.all(rivalIdxs.map(async idx => {
                                const rId = match.jugadores[idx];
                                if (!rId) return '??';
                                if (rId.startsWith('GUEST_')) return rId.split('_')[1];
                                const rU = await getDocument('usuarios', rId);
                                return rU ? (rU.nombreUsuario || rU.nombre).split(' ')[0] : '??';
                            }));
                            vsStr = `vs ${rivalNames.join(' & ')}`;
                        }
                    }
                }

                return `
                    <div class="flex-row between p-4 bg-white-03 rounded-3xl mb-3 items-center border border-white-05 transition-all cursor-pointer group log-entry-v2" 
                         onclick="window.showMatchBreakdown('${log.matchId}', ${log.diff}, ${log.newTotal}, '${uid}')">
                        <div class="flex-row items-center gap-4">
                            <div class="relative">
                                ${photo 
                                    ? `<img src="${photo}" class="w-10 h-10 rounded-full border border-white/20 object-cover">` 
                                    : `<div class="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-black text-primary border border-white/20">${name.substring(0,1)}</div>`}
                                <div class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full ${isWin ? 'bg-sport-green' : 'bg-sport-red'} border-2 border-slate-900 flex items-center justify-center">
                                    <i class="fas ${isWin ? 'fa-check' : 'fa-times'} text-[6px] text-white"></i>
                                </div>
                            </div>
                            <div class="flex-col gap-0.5">
                                <span class="text-[11px] text-white font-black uppercase tracking-tight group-hover:text-primary transition-colors">${vsStr}</span>
                                <div class="flex-row items-center gap-2">
                                    <span class="text-[8px] text-muted font-bold">${date.toLocaleDateString('es-ES', {day:'numeric', month:'short'})}</span>
                                    ${scoreStr ? `<span class="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[8px] font-black tracking-tighter">${scoreStr}</span>` : ''}
                                </div>
                            </div>
                        </div>
                        <div class="flex-col items-end">
                            <span class="font-black text-sm ${isWin ? 'text-sport-green' : 'text-sport-red'}">${isWin ? '+' : ''}${log.diff}</span>
                            <span class="text-[8px] text-muted font-black tracking-widest">ELO</span>
                        </div>
                    </div>
                `;
            }));
            return items.join('');
        })();

    if(area) area.innerHTML = `
        <!-- HEADER -->
        <div class="modal-header border-b border-white-05 pb-5 px-8">
            <div class="flex-col">
                <div class="flex-row items-center gap-2 mb-1">
                    <div class="pulse-dot-green"></div>
                    <span class="text-[9px] text-muted font-black uppercase tracking-[2px]">EXPEDIENTE DE JUGADOR</span>
                </div>
                <h3 class="modal-title italic">${name.toUpperCase()}</h3>
                <div class="flex-row items-center gap-1.5 mt-1 opacity-60">
                    <i class="fas fa-map-marker-alt text-primary text-[9px]"></i>
                    <span class="text-[10px] font-black text-white">${viviendaStr}</span>
                </div>
            </div>
            <button class="btn-close-neon" onclick="document.getElementById('modal-user').classList.remove('active')">
                <i class="fas fa-times"></i>
            </button>
        </div>

        <!-- BODY -->
        <div class="modal-body custom-scroll p-8">
            <!-- AVATAR & LEVEL -->
            <div class="flex-col items-center mb-12">
                <div class="relative">
                    <div class="absolute -inset-6 bg-gradient-to-r from-primary/30 to-secondary/30 rounded-full blur-3xl opacity-50 animate-pulse"></div>
                    <div class="relative z-10 transition-transform hover:scale-105 duration-500">
                        ${photo 
                            ? `<img src="${photo}" class="w-36 h-36 rounded-full border-4 border-slate-900 object-cover shadow-[0_0_50px_rgba(198,255,0,0.2)]">` 
                            : `<div class="w-36 h-36 rounded-full bg-slate-800 flex items-center justify-center text-5xl font-black text-primary border-4 border-slate-900 shadow-2xl">${name.substring(0,2).toUpperCase()}</div>`}
                        <div class="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-slate-900 text-primary border-2 border-primary px-4 py-1.5 rounded-2xl text-[11px] font-black shadow-[0_0_20px_rgba(198,255,0,0.4)] whitespace-nowrap">
                            RANGO: ${(user.nivel || 2.5).toFixed(2)}
                        </div>
                    </div>
                </div>
            </div>

            <!-- STATS PARALLEL GRID -->
            <div class="flex-row gap-4 mb-10 w-full">
                <div class="stat-box-premium">
                    <div class="w-8 h-8 rounded-full bg-blue-500/10 flex-center mb-1">
                        <i class="fas fa-bolt text-blue-400 text-[10px]"></i>
                    </div>
                    <span class="text-[20px] font-black text-white">${Math.round(user.puntosRanking || 1000)}</span>
                    <span class="text-[8px] text-muted font-black tracking-widest uppercase">PUNTOS</span>
                </div>
                <div class="stat-box-premium">
                    <div class="w-8 h-8 rounded-full bg-green-500/10 flex-center mb-1">
                        <i class="fas fa-shield-alt text-green-400 text-[10px]"></i>
                    </div>
                    <span class="text-[20px] font-black text-white">${user.victorias || 0}</span>
                    <span class="text-[8px] text-muted font-black tracking-widest uppercase">WINS</span>
                </div>
                <div class="stat-box-premium">
                    <div class="w-8 h-8 rounded-full bg-orange-500/10 flex-center mb-1">
                        <i class="fas fa-dumbbell text-orange-400 text-[10px]"></i>
                    </div>
                    <span class="text-[20px] font-black text-white">${user.partidosJugados || 0}</span>
                    <span class="text-[8px] text-muted font-black tracking-widest uppercase">GAMES</span>
                </div>
            </div>

            <!-- ACTIVITY SECTION -->
            <div class="flex-row between items-center mb-6 px-1">
                 <h4 class="text-[10px] font-black text-white italic uppercase tracking-[4px]">Últimas Incursiones</h4>
                 <div class="h-px bg-white-03 flex-1 mx-5"></div>
                 <span class="text-[9px] font-black text-primary opacity-80 uppercase">${sortedLogs.length} PARTIDOS</span>
            </div>

            <div class="user-logs-container max-h-[350px] overflow-y-auto custom-scroll pr-2">
                ${logsEntries}
            </div>
            
            <div class="h-8"></div>
            
            <!-- FOOTER ACTION -->
            <button class="btn-sync-premium" onclick="document.getElementById('modal-user').classList.remove('active')">
                <i class="fas fa-sync-alt mr-2"></i>
                FINALIZAR SINCRONIZACIÓN
            </button>
        </div>
    `;
};
