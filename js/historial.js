// historial.js - Match History Logic
import { auth, db, observerAuth, getDocument } from './firebase-service.js';
import { collection, getDocs, query, where, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, showToast } from './ui-core.js';
import { injectHeader, injectNavbar, initBackground, setupModals } from './modules/ui-loader.js';
import { getFriendlyTeamName } from './utils/team-utils.js';
import { getMatchPlayers, getMatchTeamPlayerIds, getResultSetsString, isCancelledMatch, isExpiredOpenMatch, parseGuestMeta } from './utils/match-utils.js';
import { shareMatchPoster } from './utils/share-utils.js';
import { getCachedIdentity, resolveIdentity, seedIdentityCache } from './services/identity-service.js';

let currentUser = null;
let allMatches = [];

let userMap = {};

function toValidDate(value) {
    const date = value?.toDate ? value.toDate() : new Date(value || 0);
    return Number.isNaN(date?.getTime?.()) ? null : date;
}

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
            document.querySelectorAll('.filter-tab').forEach(t => {
                t.classList.remove('active');
                t.setAttribute('aria-selected', 'false');
            });
            e.target.classList.add('active');
            e.target.setAttribute('aria-selected', 'true');
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
        const [snapA, snapR, snapE, snapU] = await Promise.all([
            window.getDocsSafe(collection(db, "partidosAmistosos")),
            window.getDocsSafe(collection(db, "partidosReto")),
            window.getDocsSafe(collection(db, "eventoPartidos")),
            window.getDocsSafe(collection(db, "usuarios"))
        ]);

        snapU.forEach(d => {
            userMap[d.id] = { 
                name: d.data().nombreUsuario || d.data().nombre || "Jugador",
                photo: d.data().fotoPerfil || d.data().fotoURL
            };
        });
        seedIdentityCache(Object.entries(userMap).map(([uid, value]) => ({ uid, nombre: value.name, fotoURL: value.photo })));

        const list = [];
        snapA.forEach(d => list.push({ id: d.id, col: "partidosAmistosos", ...d.data(), isComp: false }));
        snapR.forEach(d => list.push({ id: d.id, col: "partidosReto", ...d.data(), isComp: true }));
        snapE.forEach(d => list.push({ id: d.id, col: "eventoPartidos", ...d.data(), isComp: true, isEvent: true }));

        allMatches = list.map(m => {
            const players = getMatchPlayers(m);
            const isParticipant = players.includes(currentUser.uid);
            const currentIdx = players.indexOf(currentUser.uid);
            const isT1 = currentIdx >= 0 && currentIdx < 2;
            const rawSets = getResultSetsString(m).trim().split(/\s+/);
            const sets = rawSets.filter(s => s !== '0-0' && s.includes('-'));
            const matchDate = toValidDate(m.fecha);
            const isAutoCanceled = isExpiredOpenMatch({ ...m, jugadores: players });
            const finalStatus = (isCancelledMatch(m) || isAutoCanceled) ? 'anulado' : (m.estado || 'abierto');

            let t1S = 0, t2S = 0;
            sets.forEach(s => {
                const parts = s.split('-').map(Number);
                if (parts.length === 2) {
                    if (parts[0] > parts[1]) t1S++; else if (parts[1] > parts[0]) t2S++;
                }
            });

            return {
                ...m,
                jugadores: players,
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
                if (parseGuestMeta(uid)) return getPlayerName(uid).toLowerCase().includes(searchQuery);
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

const FIREBASE_UID_RE = /^[A-Za-z0-9_-]{20,}$/;
function looksLikeUid(str) {
    if (!str || typeof str !== 'string') return false;
    const trimmed = str.trim();
    return FIREBASE_UID_RE.test(trimmed);
}

function getPlayerName(uid) {
    if (!uid) return 'Libre';
    // Never return a raw UID as a display name
    if (looksLikeUid(uid) || (uid.includes(',') && uid.split(',').some(looksLikeUid))) {
        const guest = parseGuestMeta(uid);
        if (guest) return guest.name || 'Invitado';
        const cached = getCachedIdentity(uid);
        if (cached?.name && !looksLikeUid(cached.name)) return cached.name;
        return userMap[uid]?.name || 'Jugador';
    }
    if (parseGuestMeta(uid)) return parseGuestMeta(uid)?.name || 'Invitado';
    const cached = getCachedIdentity(uid);
    if (cached?.name) return cached.name;
    return userMap[uid]?.name || uid; // return uid only as last resort but getFriendlyTeamName will sanitize
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
        const result = isAnulada ? '<span class="text-danger">ANULADA</span>' : (m.validSets?.join(' ') || getResultSetsString(m) || 'PENDIENTE');
        const creator = userMap[m.creador] || { name: 'Desconocido' };
        const teamAIds = getMatchTeamPlayerIds(m, 'A');
        const teamBIds = getMatchTeamPlayerIds(m, 'B');
        const teamA = getFriendlyTeamName({
            teamName: m.teamAName || m.equipoA,
            playerNames: teamAIds.map(getPlayerName).filter(n => !looksLikeUid(n)),
            playerUids: teamAIds,
            resolvePlayerName: (uid) => {
                if (looksLikeUid(uid)) return userMap[uid]?.name || getCachedIdentity(uid)?.name || null;
                return null;
            },
            side: 'A',
            fallback: 'Pareja A'
        });
        const teamB = getFriendlyTeamName({
            teamName: m.teamBName || m.equipoB,
            playerNames: teamBIds.map(getPlayerName).filter(n => !looksLikeUid(n)),
            playerUids: teamBIds,
            resolvePlayerName: (uid) => {
                if (looksLikeUid(uid)) return userMap[uid]?.name || getCachedIdentity(uid)?.name || null;
                return null;
            },
            side: 'B',
            fallback: 'Pareja B'
        });
        const matchDateLabel = m.timestamp instanceof Date && !Number.isNaN(m.timestamp.getTime())
            ? m.timestamp.toLocaleDateString('es-ES')
            : 'fecha desconocida';
        const cardAriaLabel = `${teamA} contra ${teamB}, ${isAnulada ? 'partido anulado' : `resultado ${result}`}, ${matchDateLabel}`;
        
        const safeDate = m.timestamp instanceof Date && !Number.isNaN(m.timestamp.getTime()) ? m.timestamp : null;
        const item = document.createElement('div');
        item.className = `history-card-premium ${m.isParticipant ? (m.won ? 'won' : 'lost') : 'neutral'} ${isAnulada ? 'canceled' : ''} animate-up`;
        item.style.animationDelay = `${i * 0.05}s`;
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        item.setAttribute('aria-label', cardAriaLabel);
        item.onclick = () => showMatchDetail(m);
        item.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            showMatchDetail(m);
        });

        // Players Avatar List
        const pList = (m.jugadores || []).map(uid => {
            if (!uid) return `<div class="p-avatar-mini empty"><i class="fas fa-plus"></i></div>`;
            if (parseGuestMeta(uid)) return `<div class="p-avatar-mini guest" title="${getPlayerName(uid)}"><i class="fas fa-user-secret"></i></div>`;
            const u = userMap[uid];
            const name = u?.name || 'Jugador';
            const photo = u?.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`;
            return `<div class="p-avatar-mini" title="${name}">
                        <img src="${photo}" onerror="this.src='https://ui-avatars.com/api/?name=P&background=random&color=fff'">
                    </div>`;
        }).join('');

        item.innerHTML = `
            <div class="h-card-inner">
                <div class="h-card-date">
                    <span class="day">${safeDate ? safeDate.getDate() : '--'}</span>
                    <span class="month">${safeDate ? safeDate.toLocaleDateString('es-ES', { month: 'short' }).toUpperCase() : '---'}</span>
                </div>
                
                <div class="h-card-content">
                    <div class="h-card-top">
                        <span class="h-type-badge ${m.isEvent ? 'reto' : (m.isComp ? 'friendly border-primary' : 'friendly')}">
                            ${m.isEvent ? 'TORNEO' : (m.isComp ? 'LIGA PRO' : 'AMISTOSO')}
                        </span>
                        <span class="h-host">
                             <i class="fas fa-crown text-[8px] mr-1 opacity-50"></i>
                             ${creator.name.toUpperCase()}
                        </span>
                    </div>
                    
                    <div class="h-card-main">
                        <div class="h-score">${result}</div>
                        <div class="h-card-matchup">${teamA} <span class="text-primary">vs</span> ${teamB}</div>
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
    if (!content || !modal || !m?.id) return;

    content.innerHTML = '<div class="p-10 text-center"><div class="spinner-neon mx-auto mb-4"></div><span class="text-muted text-sm">Analizando partido...</span></div>';
    modal.classList.add('active');

    try {
        // Fetch points logs
        let logsSnap = await window.getDocsSafe(query(collection(db, "rankingLogs"), where("matchId", "==", m.id)));
        if (logsSnap.empty && getResultSetsString(m) && m?.col) {
            try {
                const { processMatchResults } = await import("./ranking-service.js");
                await processMatchResults(m.id, m.col, getResultSetsString(m), {
                    mvpId: m.mvp || m.mvpId || null,
                    surface: m.superficie || m.surface || "indoor",
                });
                logsSnap = await window.getDocsSafe(query(collection(db, "rankingLogs"), where("matchId", "==", m.id)));
            } catch (e) {
                console.warn("Historial ranking auto-process failed", e);
            }
        }
        const logs = {};
        logsSnap.forEach((row) => {
            const data = row.data() || {};
            const uid = data.uid;
            if (!uid) return;
            if (!logs[uid]) logs[uid] = { ...data, diff: 0, __entries: [] };
            logs[uid].diff = Number(logs[uid].diff || 0) + Number(data.diff || 0);
            logs[uid].__entries.push(data);
        });

        // Fetch Players
        const normalizedPlayers = getMatchPlayers(m);
        while (normalizedPlayers.length < 4) normalizedPlayers.push(null);
        const players = await Promise.all(normalizedPlayers.map(async uid => {
            if (!uid) return { id: null, name: 'Libre', level: 0 };
            if (parseGuestMeta(uid)) {
                return {
                    id: uid,
                    name: getPlayerName(uid),
                    level: Number(parseGuestMeta(uid)?.level || 2.5),
                    isGuest: true
                };
            }
            const d = await getDocument('usuarios', uid);
            return { name: d?.nombreUsuario || d?.nombre || 'Jugador', photo: d?.fotoPerfil || d?.fotoURL, id: uid, level: Number(d?.nivel || 0) };
        }));

        // AI Analysis Validation
        if (!getResultSetsString(m)) {
        content.innerHTML = `
            <div class="center py-20 flex-col items-center gap-4 animate-fade-in">
                <div class="w-16 h-16 rounded-full bg-white/5 border border-white/10 flex center mb-2 opacity-50">
                    <i class="fas fa-brain-circuit text-2xl text-primary"></i>
                </div>
                <h3 class="text-xs font-black text-white uppercase tracking-[4px]">Análisis Bloqueado</h3>
                <p class="text-[11px] text-center text-muted px-10 italic">
                    "El partido aún no se ha jugado. No puedo analizarlo todavía."
                </p>
                <div class="mt-8 flex-col items-center border-t border-white/5 pt-6 w-full">
                     <span class="text-[9px] font-black text-white/20 uppercase tracking-[2px] mb-4">Jugadores Convocados</span>
                     <div class="flex-row gap-4">
                         ${players.map(p => {
                            const photo = p.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=random&color=fff`;
                            return `<div class="w-8 h-8 rounded-full border border-white/10 overflow-hidden opacity-40"><img src="${photo}" class="w-full h-full object-cover"></div>`;
                         }).join('')}
                     </div>
                </div>
                <button class="btn-premium-v7 sm mt-8" onclick="document.getElementById('modal-match-detail').classList.remove('active')">ENTENDIDO</button>
            </div>
        `;
            return;
        }

        // Fetch Diary Entries (Simple check for current user or generic query)
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
                <span class="score-value block font-black text-4xl text-white tracking-[4px] font-display mb-2 drop-shadow-lg">${getResultSetsString(m) || '0-0'}</span>
                <span class="badge ${m.isEvent ? 'badge-danger' : (m.isComp ? 'badge-warning' : 'badge-primary')}">${m.isEvent ? ' TORNEO/EVENTO OFICIAL' : (m.isComp ? ' RETO OFICIAL' : ' AMISTOSO')}</span>
            </div>
            <div class="flex-row gap-2 mb-5">
                <button class="btn-premium-v7 sm flex-1" data-share-history-poster>
                    <i class="fas fa-share-nodes mr-2"></i> COMPARTIR CARTEL
                </button>
                <button class="btn-premium-v7 sm flex-1" data-download-history-poster>
                    <i class="fas fa-download mr-2"></i> DESCARGAR CARTEL
                </button>
            </div>

            <!-- Court View -->
            <div class="modal-match-stage mb-6">
                <div class="modal-court-team modal-stage-side bg-glass p-4 rounded-xl border border-white/5 shadow-inner">
                    ${renderPlayerCard(players[0], logs[players[0]?.id], 0)}
                    ${renderPlayerCard(players[1], logs[players[1]?.id], 0)}
                </div>
                <div class="modal-stage-score">
                    <div class="modal-stage-vs">VS</div>
                    <div class="modal-stage-result">${getResultSetsString(m) || '0-0'}</div>
                    <div class="modal-stage-caption">${m.isEvent ? 'Evento' : (m.isComp ? 'Reto' : 'Amistoso')}</div>
                </div>
                <div class="modal-court-team modal-stage-side bg-glass p-4 rounded-xl border border-white/5 shadow-inner">
                    ${renderPlayerCard(players[2], logs[players[2]?.id], 1)}
                    ${renderPlayerCard(players[3], logs[players[3]?.id], 1)}
                </div>
            </div>

            <!-- ELO Summary per player -->
            <div class="elo-summary-section mb-4 px-1">
                <div class="text-[9px] font-black text-muted uppercase tracking-widest mb-2 flex items-center gap-2">
                    <i class="fas fa-chart-bar text-primary"></i>
                    RESUMEN ELO DEL PARTIDO
                </div>
                <div class="elo-summary-grid">
                    
                    <div class="elo-summary-card">
                        <div class="elo-summary-player">${players[0]?.name || 'Jugador'}</div>
                        ${logs[players[0]?.id] ? `
                        <div class="elo-summary-delta ${Number(logs[players[0]?.id]?.diff || 0) >= 0 ? 'text-sport-green' : 'text-danger'}">
                            ${Number(logs[players[0]?.id]?.diff || 0) >= 0 ? '+' : ''}${Math.round(Number(logs[players[0]?.id]?.diff || 0))} PTS
                        </div>
                        ${formatEloBreakdown(logs[players[0]?.id])}
                        ` : '<div class="text-[9px] text-muted">Sin calculo</div>'}
                    </div>
                    
                    <div class="elo-summary-card">
                        <div class="elo-summary-player">${players[1]?.name || 'Jugador'}</div>
                        ${logs[players[1]?.id] ? `
                        <div class="elo-summary-delta ${Number(logs[players[1]?.id]?.diff || 0) >= 0 ? 'text-sport-green' : 'text-danger'}">
                            ${Number(logs[players[1]?.id]?.diff || 0) >= 0 ? '+' : ''}${Math.round(Number(logs[players[1]?.id]?.diff || 0))} PTS
                        </div>
                        ${formatEloBreakdown(logs[players[1]?.id])}
                        ` : '<div class="text-[9px] text-muted">Sin calculo</div>'}
                    </div>
                    
                    <div class="elo-summary-card">
                        <div class="elo-summary-player">${players[2]?.name || 'Jugador'}</div>
                        ${logs[players[2]?.id] ? `
                        <div class="elo-summary-delta ${Number(logs[players[2]?.id]?.diff || 0) >= 0 ? 'text-sport-green' : 'text-danger'}">
                            ${Number(logs[players[2]?.id]?.diff || 0) >= 0 ? '+' : ''}${Math.round(Number(logs[players[2]?.id]?.diff || 0))} PTS
                        </div>
                        ${formatEloBreakdown(logs[players[2]?.id])}
                        ` : '<div class="text-[9px] text-muted">Sin calculo</div>'}
                    </div>
                    
                    <div class="elo-summary-card">
                        <div class="elo-summary-player">${players[3]?.name || 'Jugador'}</div>
                        ${logs[players[3]?.id] ? `
                        <div class="elo-summary-delta ${Number(logs[players[3]?.id]?.diff || 0) >= 0 ? 'text-sport-green' : 'text-danger'}">
                            ${Number(logs[players[3]?.id]?.diff || 0) >= 0 ? '+' : ''}${Math.round(Number(logs[players[3]?.id]?.diff || 0))} PTS
                        </div>
                        ${formatEloBreakdown(logs[players[3]?.id])}
                        ` : '<div class="text-[9px] text-muted">Sin calculo</div>'}
                    </div>
                    
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
        content.querySelector('[data-share-history-poster]')?.addEventListener('click', async () => {
            const teamA = [players[0]?.name, players[1]?.name].filter(Boolean);
            const teamB = [players[2]?.name, players[3]?.name].filter(Boolean);
            const levelsA = [players[0]?.level, players[1]?.level].filter((v) => Number.isFinite(Number(v)));
            const levelsB = [players[2]?.level, players[3]?.level].filter((v) => Number.isFinite(Number(v)));
            const when = date.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            try {
                const logsA = Number((logs[players[0]?.id]?.diff || 0) + (logs[players[1]?.id]?.diff || 0));
                const logsB = Number((logs[players[2]?.id]?.diff || 0) + (logs[players[3]?.id]?.diff || 0));
                const validSetsList = m.validSets?.length ? m.validSets : getResultSetsString(m).trim().split(/\s+/).filter(s => s !== '0-0' && s.includes('-'));
                const rsets = validSetsList.join(' ');
                await shareMatchPoster({ 
                    title: 'CARTEL DEL PARTIDO', teamA, teamB, levelsA, levelsB, when, club: 'JAFS PADEL CLUB',
                    winner: rsets ? (logsA >= logsB ? 'A' : 'B') : null,
                    eloDiffA: logsA, eloDiffB: logsB,
                    summary: chronicle ? String(chronicle).replace(/<[^>]*>?/gm, '') : '',
                    sets: rsets
                });
            } catch (e) {
                console.error('share history poster failed', e);
                showToast('Cartel', 'No se pudo generar el cartel.', 'error');
            }
        });
        content.querySelector('[data-download-history-poster]')?.addEventListener('click', async () => {
            const teamA = [players[0]?.name, players[1]?.name].filter(Boolean);
            const teamB = [players[2]?.name, players[3]?.name].filter(Boolean);
            const levelsA = [players[0]?.level, players[1]?.level].filter((v) => Number.isFinite(Number(v)));
            const levelsB = [players[2]?.level, players[3]?.level].filter((v) => Number.isFinite(Number(v)));
            const when = date.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
            try {
                const logsA = Number((logs[players[0]?.id]?.diff || 0) + (logs[players[1]?.id]?.diff || 0));
                const logsB = Number((logs[players[2]?.id]?.diff || 0) + (logs[players[3]?.id]?.diff || 0));
                const validSetsList = m.validSets?.length ? m.validSets : getResultSetsString(m).trim().split(/\s+/).filter(s => s !== '0-0' && s.includes('-'));
                const rsets = validSetsList.join(' ');
                await shareMatchPoster({ 
                    title: 'RESULTADO FINAL', teamA, teamB, levelsA, levelsB, when, club: 'JAFS PADEL CLUB', 
                    winner: rsets ? (logsA >= logsB ? 'A' : 'B') : null,
                    eloDiffA: logsA, eloDiffB: logsB,
                    summary: chronicle ? String(chronicle).replace(/<[^>]*>?/gm, '') : '',
                    sets: rsets
                });
            } catch (e) {
                console.error('download history poster failed', e);
                showToast('Cartel', 'No se pudo descargar el cartel.', 'error');
            }
        });
    } catch (error) {
        console.error("showMatchDetail error:", error);
        content.innerHTML = `
            <div class="p-8 text-center flex-col gap-4">
                <i class="fas fa-triangle-exclamation text-danger text-3xl"></i>
                <h3 class="text-sm font-black uppercase tracking-widest">No se pudo abrir el partido</h3>
                <p class="text-xs text-muted">La tarjeta existe, pero el detalle vino incompleto o se cortó la carga.</p>
                <button class="btn-premium-v7 sm" onclick="document.getElementById('modal-match-detail')?.classList.remove('active')">CERRAR</button>
            </div>
        `;
    }
}

function generateMatchNarrative(m, p, logs, diary) {
    const result = (getResultSetsString(m) || '').trim();
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
    const photo = p.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name || 'P')}&background=random&color=fff`;
    const delta = log ? Number(log.diff || 0) : null;
    const hasDelta = delta !== null && !!log;
    const ptsClass = !hasDelta ? 'text-muted' : (delta > 0 ? 'text-sport-green' : delta < 0 ? 'text-danger' : 'text-muted');
    const ptsTxt = hasDelta ? `${delta >= 0 ? '+' : ''}${Math.round(delta)}` : '—';
    const teamColor = teamIdx === 0 ? 'border-primary/30' : 'border-secondary/30';
    const details = log?.details || null;
    const eloBefore = details?.pointsBefore ? Math.round(details.pointsBefore) : null;
    const eloAfter = details?.pointsAfter ? Math.round(details.pointsAfter) : null;
    const eloTip = (eloBefore && eloAfter) ? `${eloBefore} → ${eloAfter}` : '';

    return `
        <div class="modal-player-slot flex-col items-center gap-1 w-24" title="${eloTip}">
            <div class="modal-player-avatar w-12 h-12 rounded-full overflow-hidden border-2 ${teamColor} bg-black/40 shadow-lg">
                <img src="${photo}" class="w-full h-full object-cover" onerror="this.src='https://ui-avatars.com/api/?name=P&background=random&color=fff'">
            </div>
            <span class="modal-player-name text-[10px] font-black text-white truncate w-full text-center uppercase">${p.name || 'Libre'}</span>
            <div class="flex-col items-center gap-0">
                <div class="flex-row items-baseline gap-1">
                    <span class="${ptsClass} text-sm font-black leading-none">${ptsTxt}</span>
                    <span class="text-[8px] text-muted font-bold">PTS</span>
                </div>
                ${eloTip ? `<span class="text-[9px] font-bold" style="color:rgba(255,255,255,0.45)">${eloTip}</span>` : ''}
                <span class="text-[8px] font-bold text-center leading-tight" style="color:rgba(255,255,255,0.52); max-width:96px;">
                    ${!hasDelta
                        ? 'Sin impacto ELO en este calculo'
                        : delta >= 12
                            ? 'Gran impulso competitivo'
                            : delta > 0
                                ? 'Suma solida para seguir subiendo'
                                : delta <= -12
                                    ? 'Castigo fuerte en este partido'
                                    : 'Ajuste leve dentro del tramo'}
                </span>
            </div>
        </div>
    `;
}

/**
 * Genera HTML del desglose de puntos ELO para el modal de detalle.
 */
function formatEloBreakdown(log) {
    if (!log || !log.details || !log.details.breakdown) return '';
    const bd = log.details.breakdown;
    const scoringSystem = String(log?.scoringSystem || log?.details?.systemVersion || "default").toLowerCase();
    const scoringLabel = scoringSystem.includes("atp") ? "ATP Hybrid Competitive" : "ELO Hibrido Club";
    const rows = [
        { label: scoringSystem.includes("atp") ? 'Base ATP' : 'Base Glicko-2', value: bd.base, icon: 'fa-calculator', col: '#00d4ff' },
        { label: 'Racha', value: bd.racha, icon: 'fa-fire', col: '#f59e0b' },
        { label: 'Sorpresa', value: bd.sorpresa, icon: 'fa-bolt', col: '#a78bfa' },
        { label: 'Clutch', value: bd.clutch, icon: 'fa-crosshairs', col: '#f97316' },
        { label: 'Habilidad', value: bd.habilidad, icon: 'fa-star', col: '#22c55e' },
        { label: 'Balance', value: bd.ajusteBalance, icon: 'fa-scale-balanced', col: '#38bdf8' },
    ].filter(r => r.value !== undefined && r.value !== null && r.value !== 0);

    if (!rows.length) return '';

    return `
        <div class="elo-breakdown">
            <div class="elo-breakdown-head">
                <div class="elo-breakdown-title">Desglose ELO</div>
                <div class="elo-breakdown-system" style="color:${scoringSystem.includes("atp") ? "#fbbf24" : "#00d4ff"}">${scoringLabel}</div>
            </div>
            <div class="elo-breakdown-rows">
                ${rows.map(r => `
                    <div class="elo-breakdown-row">
                        <div class="elo-breakdown-label">
                            <i class="fas ${r.icon} text-[9px]" style="color:${r.col}"></i>
                            <span>${r.label}</span>
                        </div>
                        <span class="elo-breakdown-value ${Number(r.value) >= 0 ? 'text-sport-green' : 'text-danger'}">
                            ${Number(r.value) >= 0 ? '+' : ''}${Number(r.value).toFixed(1)}
                        </span>
                    </div>
                `).join('')}
            </div>
            <div class="elo-breakdown-total">
                <span>Suma real</span>
                <span>${Number(bd.totalCalculado || bd.finalDelta || 0).toFixed(2)}</span>
            </div>
        </div>
    `;
}
