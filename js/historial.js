// historial.js - Match History Logic
import { auth, db, observerAuth, getDocument } from './firebase-service.js';
import { collection, getDocs, query, where, orderBy, limit } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, showToast } from './ui-core.js';
import { injectHeader, injectNavbar, initBackground, setupModals } from './modules/ui-loader.js';

let currentUser = null;
let allMatches = [];

document.addEventListener('DOMContentLoaded', () => {
    initAppUI('historial');
    initBackground();
    setupModals();

    // Sorting
    const sortSelect = document.getElementById('sort-matches');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            sortAndRender();
        });
    }

    // Filters
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            sortAndRender();
        });
    });

    observerAuth(async (user) => {
        if (!user) {
            window.location.href = 'index.html';
            return;
        }

        currentUser = user;
        const userData = await getDocument('usuarios', user.uid);
        if (userData) {
            await injectHeader(userData);
            injectNavbar('history');
        }

        // Load stats
        const playedEl = document.getElementById('st-played');
        const winsEl = document.getElementById('st-wins');
        const wrEl = document.getElementById('st-wr');

        if (playedEl) playedEl.textContent = userData?.partidosJugados || 0;
        if (winsEl) winsEl.textContent = userData?.victorias || 0;
        
        const wr = userData?.partidosJugados > 0 ? Math.round((userData.victorias / userData.partidosJugados) * 100) : 0;
        if (wrEl) wrEl.textContent = `${wr}%`;

        // Load matches
        const [snapA, snapR] = await Promise.all([
            getDocs(collection(db, "partidosAmistosos")),
            getDocs(collection(db, "partidosReto"))
        ]);

        const list = [];
        snapA.forEach(d => list.push({ id: d.id, ...d.data(), isComp: false }));
        snapR.forEach(d => list.push({ id: d.id, ...d.data(), isComp: true }));

        // Filter my played matches
        allMatches = list.filter(m => m.estado === 'jugado' && m.jugadores && m.jugadores.includes(currentUser.uid));

        // Determine win/loss - filter out invalid 0-0 sets
        allMatches.forEach(m => {
            const isT1 = m.jugadores.indexOf(currentUser.uid) < 2;
            const rawSets = (m.resultado?.sets || '0-0').trim().split(/\s+/);
            
            // Filter valid sets (not 0-0)
            const sets = rawSets.filter(s => s !== '0-0' && s.includes('-'));

            let t1S = 0, t2S = 0;
            sets.forEach(s => {
                const parts = s.split('-').map(Number);
                if (parts.length === 2) {
                    const [g1, g2] = parts;
                    if (g1 > g2) t1S++; else if (g2 > g1) t2S++;
                }
            });
            m.won = isT1 ? (t1S > t2S) : (t2S > t1S);
            m.validSets = sets; // Store for display
        });

        allMatches.sort((a, b) => (b.fecha?.toDate ? b.fecha.toDate() : new Date(b.fecha)) - (a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha)));
        sortAndRender();
    });
});

function sortAndRender() {
    const filter = document.querySelector('.filter-tab.active')?.dataset.filter || 'all';
    const sortType = document.getElementById('sort-matches')?.value || 'date-desc';

    let list = [...allMatches];

    // Filter
    if (filter === 'won') list = list.filter(m => m.won);
    else if (filter === 'lost') list = list.filter(m => !m.won);

    // Sort
    list.sort((a, b) => {
        const dA = a.fecha?.toDate ? a.fecha.toDate() : new Date(a.fecha);
        const dB = b.fecha?.toDate ? b.fecha.toDate() : new Date(b.fecha);
        if (sortType === 'date-desc') return dB - dA;
        if (sortType === 'date-asc') return dA - dB;
        if (sortType === 'name-asc') {
            const nameA = a.id.substring(0, 8); // Proxy for sorting if names aren't resolved yet
            const nameB = b.id.substring(0, 8);
            return nameA.localeCompare(nameB);
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
            <div class="empty-state text-center py-10 opacity-60">
                <div class="text-3xl mb-4 text-muted"><i class="fas fa-history"></i></div>
                <h3 class="text-lg font-bold text-secondary mb-2">Sin registros</h3>
                <p class="text-sm text-muted">No hay partidos en esta categoría</p>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    filtered.forEach((m, i) => {
        const date = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);
        const isAnulada = m.estado === 'anulado';
        // Use validSets (filtered) or fallback to raw
        const result = isAnulada ? 'ANULADA' : (m.validSets?.join(' ') || m.resultado?.sets || '-');

        const item = document.createElement('div');
        item.className = `history-item-v7 ${m.won ? 'won' : 'lost'} animate-up`;
        item.style.animationDelay = `${i * 0.05}s`;
        item.onclick = () => showMatchDetail(m);

        // Preview players (just first 2 to save space/complexity)
        const playersHtml = `
            <div class="history-players-mini">
                <div class="mini-court-preview"></div>
                <span class="text-2xs opacity-40 uppercase font-black">Match #${m.id.substring(0,4).toUpperCase()}</span>
            </div>
        `;

        item.innerHTML = `
            <div class="h-item-left">
                <div class="h-date-v7">
                    <span class="h-day">${date.getDate()}</span>
                    <span class="h-mon">${date.toLocaleDateString('es-ES', { month: 'short' }).toUpperCase()}</span>
                </div>
                <div class="h-status-line ${m.won ? 'won' : 'lost'}"></div>
            </div>
            
            <div class="h-item-main">
                <div class="h-header-row">
                    <span class="h-type-tag ${m.isComp ? 'reto' : 'friendly'}">${m.isComp ? '⚡ RETO ⚡' : '🤝 AMISTOSO'}</span>
                    <span class="h-time-v7">${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}</span>
                </div>
                <div class="h-score-v7">${result}</div>
                ${playersHtml}
            </div>

            <div class="h-item-right">
                <div class="h-result-badge ${m.won ? 'won' : 'lost'}">
                    <i class="fas ${m.won ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i>
                </div>
            </div>
        `;
        container.appendChild(item);
    });
}

async function showMatchDetail(m) {
    const content = document.getElementById('match-detail-content');
    const modal = document.getElementById('modal-match-detail');

    content.innerHTML = '<div class="p-10 text-center"><div class="spinner-neon mx-auto mb-4"></div><span class="text-muted text-sm">Cargando detalles...</span></div>';
    modal.classList.add('active');

    // Fetch all logs for this match to see points for all players
    const logsSnap = await getDocs(query(collection(db, "rankingLogs"), where("matchId", "==", m.id)));
    const logs = {};
    logsSnap.forEach(doc => logs[doc.data().uid] = doc.data());

    const players = await Promise.all(m.jugadores.map(async uid => {
        if (!uid) return { name: 'Libre', level: 0 };
        if (uid.startsWith('GUEST_')) return { name: uid.split('_')[1], isGuest: true };
        const d = await getDocument('usuarios', uid);
        return { name: d?.nombreUsuario || d?.nombre || 'Jugador', photo: d?.fotoPerfil || d?.fotoURL, id: uid };
    }));

    const date = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);

    content.innerHTML = `
        <div class="modal-sheet-handle mx-auto w-12 h-1 bg-white opacity-20 rounded-full mb-4"></div>
        <div class="modal-header">
            <div>
                <h3 class="modal-title">Detalles del Partido</h3>
                <span class="modal-subtitle text-xs text-muted uppercase tracking-widest">${date.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
            </div>
            <button class="modal-close" onclick="document.getElementById('modal-match-detail').classList.remove('active')">
                <i class="fas fa-times"></i>
            </button>
        </div>
        
        <div class="modal-body">
            <!-- Score Display -->
            <div class="match-score-display text-center py-6">
                <span class="score-value block font-black text-3xl text-white tracking-widest mb-2">${m.resultado?.sets || '0-0'}</span>
                <span class="badge ${m.isComp ? 'badge-warning' : 'badge-primary'}">${m.isComp ? '⚡ RETO' : '🤝 AMISTOSO'}</span>
            </div>

            <!-- Court View -->
            <div class="modal-players-court flex-col gap-4 mb-6">
                <div class="modal-court-team flex-row justify-between bg-glass p-3 rounded-lg border border-white/10">
                    ${renderPlayerCard(players[0], logs[players[0]?.id])}
                    ${renderPlayerCard(players[1], logs[players[1]?.id])}
                </div>
                <div class="modal-court-vs text-center text-xs font-black text-muted">VS</div>
                <div class="modal-court-team flex-row justify-between bg-glass p-3 rounded-lg border border-white/10">
                    ${renderPlayerCard(players[2], logs[players[2]?.id])}
                    ${renderPlayerCard(players[3], logs[players[3]?.id])}
                </div>
            </div>

            <!-- AI Chronicle -->
            <div class="ai-chronicle-card bg-glass p-4 rounded-xl border border-purple-500/20">
                <div class="ai-chronicle-header flex-row items-center gap-2 text-xs font-bold text-accent uppercase mb-2">
                    <i class="fas fa-robot"></i>
                    <span>Crónica de la IA</span>
                </div>
                <p class="ai-chronicle-text text-sm text-secondary italic leading-relaxed">
                    Este fue un partido ${m.isComp ? 'decisivo para el ranking' : 'de entrenamiento'}. 
                    ${m.resultado?.sets?.includes('6-0') || m.resultado?.sets?.includes('6-1') ? 'Hubo un dominio absoluto en la pista.' : 'Estuvo muy reñido hasta el último set.'}
                </p>
            </div>
        </div>
    `;
}

function renderPlayerCard(p, log) {
    const photo = p.photo || './imagenes/default-avatar.png';
    const ptsClass = log?.diff >= 0 ? 'text-sport-green' : 'text-danger';
    const ptsTxt = log ? `${log.diff >= 0 ? '+' : ''}${log.diff}` : '0';

    return `
        <div class="modal-player-slot flex-col items-center gap-1 w-20">
            <div class="modal-player-avatar w-10 h-10 rounded-full overflow-hidden border border-white/20 bg-black/40">
                <img src="${photo}" class="w-full h-full object-cover">
            </div>
            <span class="modal-player-name text-xs font-bold text-white truncate w-full text-center">${p.name || 'Libre'}</span>
            <span class="modal-player-level ${ptsClass} text-xs font-black">${ptsTxt} PTS</span>
        </div>
    `;
}
