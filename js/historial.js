// historial.js - Match History Logic
import { auth, db, observerAuth, getDocument } from './firebase-service.js';
import { collection, getDocs, query, where, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, showToast } from './ui-core.js';
import { injectHeader, injectNavbar, initBackground, setupModals } from './modules/ui-loader.js?v=6.5';

let currentUser = null;
let allMatches = [];

let userMap = {};

document.addEventListener('DOMContentLoaded', () => {
    initAppUI('historial');
    initBackground();
    setupModals();

    const sortSelect = document.getElementById('sort-matches');
    if (sortSelect) sortSelect.addEventListener('change', sortAndRender);

    const searchInput = document.getElementById('user-search');
    if (searchInput) searchInput.addEventListener('input', sortAndRender);

    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            sortAndRender();
        });
    });

    observerAuth(async (user) => {
        if (!user) { window.location.href = 'index.html'; return; }
        currentUser = user;
        
        const userData = await getDocument('usuarios', user.uid);
        if (userData) {
            await injectHeader(userData);
            injectNavbar('history');
        }

        // Stats for current user
        if (userData) {
            const playedEl = document.getElementById('st-played');
            const winsEl = document.getElementById('st-wins');
            const wrEl = document.getElementById('st-wr');
            if (playedEl) playedEl.textContent = userData.partidosJugados || 0;
            if (winsEl) winsEl.textContent = userData.victorias || 0;
            const wr = userData.partidosJugados > 0 ? Math.round((userData.victorias / userData.partidosJugados) * 100) : 0;
            if (wrEl) wrEl.textContent = `${wr}%`;
        }

        // Load Global Data
        const [snapA, snapR, snapU] = await Promise.all([
            window.getDocsSafe(collection(db, "partidosAmistosos")),
            window.getDocsSafe(collection(db, "partidosReto")),
            window.getDocsSafe(collection(db, "usuarios"))
        ]);

        snapU.forEach(d => {
            userMap[d.id] = { 
                name: d.data().nombreUsuario || d.data().nombre || "Jugador",
                photo: d.data().fotoPerfil || d.data().fotoURL
            };
        });

        const list = [];
        snapA.forEach(d => list.push({ id: d.id, ...d.data(), isComp: false }));
        snapR.forEach(d => list.push({ id: d.id, ...d.data(), isComp: true }));

        allMatches = list.map(m => {
            const isParticipant = m.jugadores?.includes(currentUser.uid);
            const isT1 = m.jugadores?.indexOf(currentUser.uid) < 2;
            const rawSets = (m.resultado?.sets || '').trim().split(/\s+/);
            const sets = rawSets.filter(s => s !== '0-0' && s.includes('-'));
            const matchDate = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha || 0);
            
            // Auto-detect "Anulada" if time passed and not played/abierto with holes
            const isExpired = matchDate.getTime() + (150 * 60 * 1000) < Date.now(); // 2.5 hours after
            const isMissingPlayers = (m.jugadores || []).filter(id => id).length < 4;
            const isAutoCanceled = (m.estado === 'abierto' || !m.estado) && isExpired && isMissingPlayers;
            const finalStatus = (m.estado === 'anulado' || isAutoCanceled) ? 'anulado' : (m.estado || 'abierto');

            let t1S = 0, t2S = 0;
            sets.forEach(s => {
                const parts = s.split('-').map(Number);
                if (parts.length === 2) {
                    if (parts[0] > parts[1]) t1S++; else if (parts[1] > parts[0]) t2S++;
                }
            });

            return {
                ...m,
                estado: finalStatus,
                isParticipant,
                won: isParticipant ? (isT1 ? (t1S > t2S) : (t2S > t1S)) : false,
                validSets: sets,
                timestamp: matchDate
            };
        });

        allMatches.sort((a, b) => b.timestamp - a.timestamp);
        sortAndRender();
    });
});

function sortAndRender() {
    const filter = document.querySelector('.filter-tab.active')?.dataset.filter || 'mine';
    const sortType = document.getElementById('sort-matches')?.value || 'date-desc';
    const searchQuery = document.getElementById('user-search')?.value.toLowerCase().trim();

    let list = [...allMatches];

    // Filter by Tab
    if (filter === 'mine') list = list.filter(m => m.isParticipant);
    else if (filter === 'won') list = list.filter(m => m.isParticipant && m.won);
    else if (filter === 'lost') list = list.filter(m => m.isParticipant && !m.won && m.estado === 'jugado');
    else if (filter === 'canceled') list = list.filter(m => m.estado === 'anulado');

    // Filter by Search (User Name)
    if (searchQuery) {
        list = list.filter(m => {
            const players = m.jugadores || [];
            return players.some(uid => {
                if (uid?.startsWith('GUEST_')) return uid.toLowerCase().includes(searchQuery);
                const name = userMap[uid]?.name?.toLowerCase() || '';
                return name.includes(searchQuery);
            }) || (userMap[m.creador]?.name?.toLowerCase().includes(searchQuery));
        });
    }

    // Sort
    list.sort((a, b) => {
        if (sortType === 'date-desc') return b.timestamp - a.timestamp;
        if (sortType === 'date-asc') return a.timestamp - b.timestamp;
        if (sortType === 'name-asc') {
            const creatorA = userMap[a.creador]?.name || '';
            const creatorB = userMap[b.creador]?.name || '';
            return creatorA.localeCompare(creatorB);
        }
        return 0;
    });

    renderMatchesFiltered(list);
}

async function renderMatchesFiltered(filtered) {
    const container = document.getElementById('history-container');
    if (!container) return;

    if (filtered.length === 0) {
        container.innerHTML = `
            <div class="empty-state text-center py-16 opacity-40">
                <i class="fas fa-ghost text-5xl mb-4 block"></i>
                <h3 class="text-lg font-black uppercase tracking-widest italic">Sin Rastro en el Radar</h3>
                <p class="text-[10px] font-bold opacity-60">No se encontraron despliegues con estos parámetros</p>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    filtered.forEach((m, i) => {
        const isAnulada = m.estado === 'anulado';
        const result = isAnulada ? '<span class="text-danger">ANULADA</span>' : (m.validSets?.join(' ') || m.resultado?.sets || 'PENDIENTE');
        const creator = userMap[m.creador] || { name: 'Desconocido' };
        
        const item = document.createElement('div');
        item.className = `history-card-premium ${m.isParticipant ? (m.won ? 'won' : 'lost') : 'neutral'} ${isAnulada ? 'canceled' : ''} animate-up`;
        item.style.animationDelay = `${i * 0.05}s`;
        item.onclick = () => showMatchDetail(m);

        // Players Avatar List
        const pList = (m.jugadores || []).map(uid => {
            if (!uid) return `<div class="p-avatar-mini empty"><i class="fas fa-plus"></i></div>`;
            if (uid.startsWith('GUEST_')) return `<div class="p-avatar-mini guest" title="${uid.split('_')[1]}"><i class="fas fa-user-secret"></i></div>`;
            const u = userMap[uid];
            return `<div class="p-avatar-mini" title="${u?.name}">
                        <img src="${u?.photo || './imagenes/default-avatar.png'}" onerror="this.src='./imagenes/default-avatar.png'">
                    </div>`;
        }).join('');

        item.innerHTML = `
            <div class="h-card-inner">
                <div class="h-card-date">
                    <span class="day">${m.timestamp.getDate()}</span>
                    <span class="month">${m.timestamp.toLocaleDateString('es-ES', { month: 'short' }).toUpperCase()}</span>
                </div>
                
                <div class="h-card-content">
                    <div class="h-card-top">
                        <span class="h-type-badge ${m.isComp ? 'reto' : 'friendly'}">
                            ${m.isComp ? 'LIGA PRO' : 'AMISTOSO'}
                        </span>
                        <span class="h-host">
                             <i class="fas fa-crown text-[8px] mr-1 opacity-50"></i>
                             ${creator.name.toUpperCase()}
                        </span>
                    </div>
                    
                    <div class="h-card-main">
                        <div class="h-score">${result}</div>
                        <div class="h-players-row">${pList}</div>
                    </div>
                </div>

                <div class="h-card-action">
                    ${isAnulada ? '<i class="fas fa-ban text-danger opacity-40"></i>' : 
                      (m.isParticipant ? `<i class="fas ${m.won ? 'fa-chevron-up text-sport-green' : 'fa-chevron-down text-danger'}"></i>` : 
                      '<i class="fas fa-eye text-primary opacity-40"></i>')}
                </div>
            </div>
        `;
        container.appendChild(item);
    });
}

async function showMatchDetail(m) {
    const content = document.getElementById('match-detail-content');
    const modal = document.getElementById('modal-match-detail');

    content.innerHTML = '<div class="p-10 text-center"><div class="spinner-neon mx-auto mb-4"></div><span class="text-muted text-sm">Analizando partido...</span></div>';
    modal.classList.add('active');

    // Fetch points logs
    const logsSnap = await window.getDocsSafe(query(collection(db, "rankingLogs"), where("matchId", "==", m.id)));
    const logs = {};
    logsSnap.forEach(doc => logs[doc.data().uid] = doc.data());

    // Fetch Players
    const players = await Promise.all(m.jugadores.map(async uid => {
        if (!uid) return { name: 'Libre', level: 0 };
        if (uid.startsWith('GUEST_')) return { name: uid.split('_')[1], isGuest: true };
        const d = await getDocument('usuarios', uid);
        return { name: d?.nombreUsuario || d?.nombre || 'Jugador', photo: d?.fotoPerfil || d?.fotoURL, id: uid };
    }));

    // Fetch Diary Entries (Simple check for current user or generic query)
    // For now, let's look at the current user's diary in their profile to see if they logged this match
    let diaryContext = null;
    if (currentUser) {
        const userDoc = await getDocument('usuarios', currentUser.uid);
        if (userDoc && userDoc.diario) {
            diaryContext = userDoc.diario.find(e => e.matchId === m.id);
        }
    }

    const date = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);
    const chronicle = generateMatchNarrative(m, players, logs, diaryContext);

    content.innerHTML = `
        <div class="modal-sheet-handle mx-auto w-12 h-1 bg-white opacity-20 rounded-full mb-4"></div>
        <div class="modal-header">
            <div>
                <h3 class="modal-title">Detalles del Encuentro</h3>
                <span class="modal-subtitle text-xs text-muted uppercase tracking-widest">${date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
            </div>
            <button class="modal-close" onclick="document.getElementById('modal-match-detail').classList.remove('active')">
                <i class="fas fa-times"></i>
            </button>
        </div>
        
        <div class="modal-body custom-scroll">
            <!-- Score Display -->
            <div class="match-score-display text-center py-6">
                <span class="score-value block font-black text-4xl text-white tracking-[4px] font-display mb-2 drop-shadow-lg">${m.resultado?.sets || '0-0'}</span>
                <span class="badge ${m.isComp ? 'badge-warning' : 'badge-primary'}">${m.isComp ? ' RETO OFICIAL' : ' AMISTOSO'}</span>
            </div>

            <!-- Court View -->
            <div class="modal-players-court flex-col gap-4 mb-6">
                <div class="modal-court-team flex-row justify-between bg-glass p-4 rounded-xl border border-white/5 shadow-inner">
                    ${renderPlayerCard(players[0], logs[players[0]?.id], 0)}
                    ${renderPlayerCard(players[1], logs[players[1]?.id], 0)}
                </div>
                <div class="modal-court-vs text-center text-xs font-black text-muted tracking-widest my-[-10px] z-10 bg-void px-2 mx-auto rounded-full border border-white/10">VS</div>
                <div class="modal-court-team flex-row justify-between bg-glass p-4 rounded-xl border border-white/5 shadow-inner">
                    ${renderPlayerCard(players[2], logs[players[2]?.id], 1)}
                    ${renderPlayerCard(players[3], logs[players[3]?.id], 1)}
                </div>
            </div>

            <!-- AI Chronicle -->
            <div class="ai-chronicle-card bg-gradient-to-br from-purple-900/40 to-blue-900/40 p-5 rounded-2xl border border-white/10 relative overflow-hidden">
                <div class="absolute top-0 right-0 p-4 opacity-10"><i class="fas fa-quote-right text-4xl"></i></div>
                <div class="ai-chronicle-header flex-row items-center gap-2 text-xs font-black text-accent uppercase mb-3">
                    <i class="fas fa-microchip"></i>
                    <span>Análisis Táctico IA</span>
                </div>
                <p class="ai-chronicle-text text-sm text-gray-200 leading-relaxed font-medium">
                    ${chronicle}
                </p>
                ${!diaryContext ? `
                    <div class="mt-4 pt-3 border-t border-white/10 flex-row between items-center">
                        <span class="text-[10px] text-muted italic">Faltan datos tácticos en tu diario.</span>
                        <a href="diario.html?matchId=${m.id}" class="text-[10px] font-bold text-primary hover:underline">AÑADIR ANÁLISIS <i class="fas fa-arrow-right ml-1"></i></a>
                    </div>
                ` : ''}
            </div>
        </div>
    `;
}

function generateMatchNarrative(m, p, logs, diary) {
    const result = (m.resultado?.sets || '').trim();
    const sets = result.split(/\s+/);
    
    const safeName = (idx) => p?.[idx]?.name || `Jugador ${idx + 1}`;
    // Team names (2v2)
    const t1 = `<b>${safeName(0)}</b> y <b>${safeName(1)}</b>`;
    const t2 = `<b>${safeName(2)}</b> y <b>${safeName(3)}</b>`;
    
    // Parse sets to find winner
    let t1Sets = 0, t2Sets = 0;
    let totalGames = 0;
    let maxDiff = 0;
    
    sets.forEach(s => {
        const parts = s.split('-').map(Number);
        if(parts.length === 2) {
            if(parts[0] > parts[1]) t1Sets++; else t2Sets++;
            totalGames += (parts[0] + parts[1]);
            maxDiff = Math.max(maxDiff, Math.abs(parts[0] - parts[1]));
        }
    });

    const t1Won = t1Sets > t2Sets;
    const winners = t1Won ? t1 : t2;
    const losers = t1Won ? t2 : t1;
    const winnerPlayers = t1Won ? [safeName(0), safeName(1)] : [safeName(2), safeName(3)];
    const loserPlayers = t1Won ? [safeName(2), safeName(3)] : [safeName(0), safeName(1)];

    const isSweep = Math.abs(t1Sets - t2Sets) >= 2 && (t1Sets === 0 || t2Sets === 0);
    const isClose = maxDiff <= 2 || sets.some(s => s.includes('7-5') || s.includes('7-6'));

    let text = `En este <b>${m.isComp ? 'reto oficial' : 'partido amistoso'}</b>, `;

    if (isSweep) {
        text += `<b>${winnerPlayers[0]}</b> y <b>${winnerPlayers[1]}</b> dominaron claramente a <b>${loserPlayers[0]}</b> y <b>${loserPlayers[1]}</b>. `;
        text += `Aunque <b>${loserPlayers[0]}</b> intentó impedirlo con garra, fue un partido en el que la superioridad física y táctica de los ganadores no dejó lugar a dudas. `;
    } else if (isClose) {
        text += `fue un partido muy reñido entre <b>${winnerPlayers[0]}/${winnerPlayers[1]}</b> y <b>${loserPlayers[0]}/${loserPlayers[1]}</b>. `;
        text += `Se decidió por detalles mínimos; <b>${loserPlayers[1]}</b> estuvo a punto de forzar el desempate, pero finalmente el temple de <b>${winnerPlayers[0]}</b> inclinó la balanza. `;
    } else {
        text += `vimos un gran nivel de padel. <b>${winners}</b> supieron leer mejor las debilidades de <b>${losers}</b> y controlaron el ritmo de los puntos importantes. `;
    }

    if (diary) {
        text += `<br><br><b>Perspectiva del Diario:</b> "${diary.comentarios || 'Sin notas adicionales'}" `;
        if (diary.sensaciones) text += `<br>Sensaciones detectadas: <b>${diary.sensaciones}</b>. `;
        if (diary.tacticalBalance) {
            const goods = Object.keys(diary.tacticalBalance).filter(k => diary.tacticalBalance[k] === 'good');
            const bads = Object.keys(diary.tacticalBalance).filter(k => diary.tacticalBalance[k] === 'bad');
            if (goods.length) text += `<br>Brillaste en: <span class="text-sport-green">${goods.join(', ')}</span>. `;
            if (bads.length) text += `<br>Puntos a mejorar: <span class="text-danger">${bads.join(', ')}</span>. `;
        }
    } else {
        text += `<br><br><i class="opacity-50">IA: "Si añades este partido a tu diario, podré darte un análisis biomecánico y táctico mucho más profundo."</i>`;
    }

    return text;
}

function renderPlayerCard(p, log, teamIdx) {
    const photo = p.photo || './imagenes/default-avatar.png';
    const ptsClass = log?.diff >= 0 ? 'text-sport-green' : 'text-danger';
    const ptsTxt = log ? `${log.diff >= 0 ? '+' : ''}${log.diff}` : '0';
    const teamColor = teamIdx === 0 ? 'border-primary/30' : 'border-secondary/30';

    return `
        <div class="modal-player-slot flex-col items-center gap-1 w-20">
            <div class="modal-player-avatar w-12 h-12 rounded-full overflow-hidden border-2 ${teamColor} bg-black/40 shadow-lg">
                <img src="${photo}" class="w-full h-full object-cover">
            </div>
            <span class="modal-player-name text-[10px] font-black text-white truncate w-full text-center uppercase">${p.name || 'Libre'}</span>
            <div class="flex-row items-baseline gap-1">
                <span class="${ptsClass} text-[10px] font-black">${ptsTxt}</span>
                <span class="text-[8px] text-muted font-bold">PTS</span>
            </div>
        </div>
    `;
}




