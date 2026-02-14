/**
 * @file match-service.js
 * @version 19.5 (Final V7 Refactor)
 * @description Premium Match Management Service for Padeluminatis.
 * Handles match details rendering, creation, actions (join/leave/delete), and real-time chat.
 * Fully aligned with Premium V7 "Ultra Vibrant" aesthetics.
 */

import { db, getDocument, subscribeDoc, auth } from './firebase-service.js';
import { 
    doc, getDoc, getDocs, collection, deleteDoc, onSnapshot, 
    query, orderBy, where, limit, addDoc, updateDoc, serverTimestamp 
} from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { showToast } from './ui-core.js';
import { processMatchResults } from './ranking-service.js';
import { createNotification } from './services/notification-service.js';

async function safeOnSnapshot(q, onNext) {
    if (window.getDocsSafe) {
        const warm = await window.getDocsSafe(q, "match-service");
        if (warm?._errorCode === "failed-precondition") return () => {};
    }
    return onSnapshot(q, onNext, () => {});
}

/**
 * Renders the detailed view of a match in a modal or container.
 * Uses Premium V7 classes (court-schema-v7, etc).
 */
export async function renderMatchDetail(container, matchId, type, currentUser, userData) {
    if (!container) return;
    const isReto = type ? type.toLowerCase().includes('reto') : false;
    const col = isReto ? 'partidosReto' : 'partidosAmistosos';
    
    container.innerHTML = `<div class="center py-20"><div class="spinner-galaxy"></div></div>`;

    const render = async (m) => {
        if (!m) { 
            container.innerHTML = '<div class="center p-10 opacity-50">Partido no encontrado o cancelado.</div>'; 
            return; 
        }

        // Privacy Check
        if (m.visibility === 'private') {
            const isInvited = (m.invitedUsers || []).includes(currentUser.uid);
            const isOwner = m.organizerId === currentUser.uid || m.creador === currentUser.uid;
            const isParticipant = (m.jugadores || []).includes(currentUser.uid);
            
            if (!isInvited && !isOwner && !isParticipant) {
                container.innerHTML = `
                    <div class="center py-20 flex-col items-center gap-4 animate-up">
                        <div class="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex center mb-2">
                            <i class="fas fa-lock text-2xl text-red-500"></i>
                        </div>
                        <h3 class="text-lg font-black text-white uppercase tracking-widest">Acceso Restringido</h3>
                        <p class="text-xs text-center text-muted px-10 max-w-sm">
                            Evento clasificado como PRIVADO. Solo personal autorizado o con invitación directa puede acceder a los datos tácticos.
                        </p>
                        <button class="btn-premium-v7 sm mt-6" onclick="document.getElementById('modal-match').classList.remove('active')">
                            Cerrar Protocolo
                        </button>
                    </div>
                `;
                return;
            }
        }
        
        const isParticipant = m.jugadores?.includes(currentUser.uid);
        const isCreator = m.creador === currentUser.uid || userData?.rol === 'Admin';
        const date = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);
        const players = await Promise.all([0, 1, 2, 3].map(i => getPlayerData(m.jugadores?.[i])));

        // Weather Forecast 
        let weatherHtml = '<i class="fas fa-clock opacity-30"></i> <span class="text-[10px]">...</span>';
        try {
            const { getDetailedWeather } = await import('./external-data.js');
            const w = await getDetailedWeather();
            if (w && w.current) {
                const rain = w.current.rain || 0;
                weatherHtml = `
                    <div class="weather-pill-v7 flex-row items-center gap-2">
                        <i class="fas fa-wind text-cyan-400 text-[10px]"></i>
                        <span class="text-[10px] font-black">${Math.round(w.current.wind_speed_10m)}</span>
                        <span class="opacity-30">|</span>
                        <i class="fas fa-droplet ${rain > 0 ? 'text-blue-400' : 'text-gray-500'} text-[10px]"></i>
                        <span class="text-[10px] font-black">${rain}</span>
                        <span class="opacity-30">|</span>
                        <span class="text-[10px] font-black text-white">${Math.round(w.current.temperature_2m)}°C</span>
                    </div>
                `;
            }
        } catch(e) {}

        // Win Forecast Logic
        const team1Avg = ( (players[0]?.level || 2.5) + (players[1]?.level || 2.5) ) / 2;
        const team2Avg = ( (players[2]?.level || 2.5) + (players[3]?.level || 2.5) ) / 2;
        const diff = team1Avg - team2Avg;
        const p1 = Math.min(Math.max(50 + (diff * 20), 10), 90);
        const p2 = 100 - p1;

        const creatorSnap = await getDoc(doc(db, "usuarios", m.creador));
        const cName = creatorSnap.exists() ? (creatorSnap.data().nombreUsuario || creatorSnap.data().nombre) : 'Jugador';

        let eloBreakdownHtml = '';
        if (m.resultado?.sets) {
            const pointsSnap = await window.getDocsSafe(query(collection(db, "matchPointDetails"), where("matchId", "==", matchId), limit(1)));
            const detail = pointsSnap.docs?.[0]?.data?.() || null;
            const pointsPerSet = detail?.pointsPerSet || [];
            const rows = pointsPerSet.map(s => `
                <div class="bd-item-v7">
                    <span class="bd-label">SET ${s.set}</span>
                    <span class="bd-val">${s.gamesA}-${s.gamesB}</span>
                </div>
            `).join('');
            
            eloBreakdownHtml = `
                <div class="elo-breakdown-v7 mb-6">
                    <div class="flex-row between items-center mb-3">
                         <span class="text-[9px] font-black text-primary uppercase tracking-widest">RESULTADO OFICIAL</span>
                         <span class="text-[9px] font-bold text-muted">${detail?.totalPoints || 0} PTS</span>
                    </div>
                    <div class="bd-grid-v7">${rows}</div>
                </div>
            `;
        }

        container.innerHTML = `
            <div class="match-detail-v7 animate-up">
                <div class="detail-hero-v7 flex-col center">
                    <div class="type-badge-v7 ${isReto ? 'reto' : 'amistoso'} mb-4">
                        <i class="fas ${isReto ? 'fa-bolt' : 'fa-handshake'}"></i>
                        <span>${isReto ? 'RETO POR PUNTOS' : 'JUEGO AMISTOSO'}</span>
                    </div>
                    
                    <span class="hero-time-v7">${date.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'})}</span>
                    <div class="hero-date-v7">
                        ${date.toLocaleDateString('es-ES', {weekday:'long', day:'numeric'}).toUpperCase()}
                        <span class="dash">—</span>
                        ${date.toLocaleDateString('es-ES', {month:'long'}).toUpperCase()}
                    </div>
                    <div class="mt-4 opacity-80 scale-90">${weatherHtml}</div>
                </div>

                <!-- Probability Simulation Board -->
                <div class="prediction-card-v7 mb-6">
                    <div class="flex-row between items-end mb-2">
                         <div class="team-prob-box">
                             <span class="team-label text-left">EQUIPO A</span>
                             <span class="prob-val" style="color:var(--primary)">${Math.round(p1)}%</span>
                         </div>
                         <div class="ia-node">
                             <i class="fas fa-brain"></i>
                             <span>IA PREDICTION</span>
                         </div>
                         <div class="team-prob-box text-right">
                             <span class="team-label text-right">EQUIPO B</span>
                             <span class="prob-val" style="color:var(--secondary)">${Math.round(p2)}%</span>
                         </div>
                    </div>
                    <div class="prob-track-v7">
                        <div class="prob-fill t1" style="width: ${p1}%"></div>
                        <div class="prob-fill t2" style="width: ${p2}%"></div>
                    </div>
                </div>

                ${eloBreakdownHtml}

                <div class="court-container-v7 mb-6">
                    <div class="court-schema-v7">
                        <div class="court-net"></div>
                        
                        <div class="players-row-v7 top mb-8">
                            ${renderPlayerSlot(players[0], 0, isCreator, matchId, col)}
                            ${renderPlayerSlot(players[1], 1, isCreator, matchId, col)}
                        </div>
                        
                        <div class="vs-divider-v7">
                           <div class="vs-line"></div>
                           <div class="vs-circle">VS</div>
                           <div class="vs-line"></div>
                        </div>
                        
                        <div class="players-row-v7 bottom mt-8">
                            ${renderPlayerSlot(players[2], 2, isCreator, matchId, col)}
                            ${renderPlayerSlot(players[3], 3, isCreator, matchId, col)}
                        </div>
                    </div>
                </div>

                <div class="flex-row center gap-2 mb-8 opacity-60">
                    <i class="fas fa-crown text-yellow-500 text-[10px]"></i>
                    <span class="text-[9px] font-black uppercase tracking-widest">HOST: ${cName}</span>
                </div>

                <div class="comms-panel-v7 mb-8">
                    <div class="comms-header">
                         <div class="flex-row items-center gap-2">
                             <div class="live-dot"></div>
                             <span class="text-[10px] font-black uppercase tracking-widest text-white">Radio Táctica</span>
                         </div>
                         <i class="fas fa-signal text-xs text-muted"></i>
                    </div>
                    <div class="comms-body custom-scroll" id="match-chat-msgs">
                        ${!isParticipant ? '<div class="lock-overlay"><i class="fas fa-lock mb-1"></i><span>CANAL CIFRADO</span><small>Únete para descifrar</small></div>' : ''}
                    </div>
                    ${isParticipant ? `
                        <div class="comms-footer">
                            <input type="text" id="match-chat-in" class="comms-input" placeholder="Transmitir datos...">
                            <button class="comms-send" onclick="sendMatchChat('${matchId}', '${col}')"><i class="fas fa-paper-plane"></i></button>
                        </div>
                    ` : ''}
                </div>

                <div class="actions-grid-v7 flex-col gap-3">
                    ${renderMatchActions(m, isParticipant, isCreator, currentUser.uid, matchId, col)}
                </div>
            </div>
        `;
        if (isParticipant) initMatchChat(matchId, col);
    };

    const data = await getDocument(col, matchId);
    render(data);
    subscribeDoc(col, matchId, render);
}

/**
 * Renders the match creation form for a specific date and time.
 * V7 Styled.
 */
export async function renderCreationForm(container, dateStr, hour, currentUser, userData) {
    if (!container) return;
    
    container.innerHTML = `
        <div class="booking-hub-v7 animate-up p-2">
            <div class="hub-header mb-6">
                <span class="hub-tag">SISTEMA DE RESERVAS</span>
                <h2 class="hub-title-v7">${dateStr}</h2>
                <div class="hub-meta-v7">
                    <div class="meta-pill">
                        <i class="fas fa-clock text-primary"></i>
                        <span>${hour}</span>
                    </div>
                    <div class="meta-pill">
                        <i class="fas fa-map-marker-alt text-secondary"></i>
                        <span>Central</span>
                    </div>
                    <div id="creation-weather"></div>
                </div>
            </div>

            <div class="booking-config mb-8">
                <!-- Tipo de Partido -->
                <span class="cfg-label-v7">PROTOCOLO DE JUEGO</span>
                <div class="mode-selector-v7 mb-6">
                    <div id="opt-am" class="mode-card-v7 active" onclick="setMatchType('amistoso')">
                        <div class="mode-icon"><i class="fas fa-handshake"></i></div>
                        <div>
                            <span class="m-name">Amistoso</span>
                            <span class="m-desc text-[9px] opacity-60">Sin impacto ELO</span>
                        </div>
                    </div>
                    <div id="opt-re" class="mode-card-v7" onclick="setMatchType('reto')">
                        <div class="mode-icon"><i class="fas fa-trophy"></i></div>
                        <div>
                            <span class="m-name">Reto Pro</span>
                            <span class="m-desc text-[9px] opacity-60">Ranked (x1.0)</span>
                        </div>
                    </div>
                </div>

                <!-- Alineación Táctica (Disposición de Pista) -->
                <span class="cfg-label-v7">ALINEACIÓN TÁCTICA</span>
                <div class="court-container-v7 mb-6">
                    <div class="court-schema-v7" style="padding: 20px 10px;">
                        <div class="court-net"></div>
                        
                        <div class="players-row-v7 top mb-6">
                            <div class="p-slot-v7 active" id="slot-0-wrap">
                                <div class="p-img-box" style="border-color:var(--primary)">
                                    <img src="${userData.fotoPerfil || userData.fotoURL || './imagenes/Logojafs.png'}">
                                </div>
                                <span class="p-badge" style="color:var(--primary); border-color:currentColor">${(userData.nivel || 2.5).toFixed(1)}</span>
                                <span class="text-[8px] font-black uppercase text-white tracking-widest mt-1 truncate w-16 text-center">${userData.nombreUsuario || 'TÚ'}</span>
                            </div>
                            <div class="p-slot-v7" id="slot-1-wrap" onclick="window.openPlayerSelector('NEW', 'amistoso', {idx:1})">
                                <div class="p-img-box empty"><i class="fas fa-plus text-muted"></i></div>
                                <span class="text-[8px] font-black uppercase text-muted tracking-widest mt-2">VACÍO</span>
                            </div>
                        </div>
                        
                        <div class="vs-divider-v7">
                           <div class="vs-line"></div>
                           <div class="vs-circle">VS</div>
                           <div class="vs-line"></div>
                        </div>
                        
                        <div class="players-row-v7 bottom mt-6">
                            <div class="p-slot-v7" id="slot-2-wrap" onclick="window.openPlayerSelector('NEW', 'amistoso', {idx:2})">
                                <div class="p-img-box empty"><i class="fas fa-plus text-muted"></i></div>
                                <span class="text-[8px] font-black uppercase text-muted tracking-widest mt-2">VACÍO</span>
                            </div>
                            <div class="p-slot-v7" id="slot-3-wrap" onclick="window.openPlayerSelector('NEW', 'amistoso', {idx:3})">
                                <div class="p-img-box empty"><i class="fas fa-plus text-muted"></i></div>
                                <span class="text-[8px] font-black uppercase text-muted tracking-widest mt-2">VACÍO</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Configuración Técnica -->
                <span class="cfg-label-v7">PARAMETROS DE ENTORNO</span>
                <div class="flex-row gap-3 mb-6">
                    <div class="l-input-box flex-1">
                        <label>SUPERFICIE</label>
                        <select id="inp-surface" class="bg-transparent border-none text-white font-black text-xs text-center w-full outline-none">
                            <option value="indoor">INDOOR</option>
                            <option value="outdoor">OUTDOOR</option>
                        </select>
                    </div>
                    <div class="l-input-box flex-1">
                        <label>PISTA</label>
                        <select id="sel-court" class="bg-transparent border-none text-white font-black text-xs text-center w-full outline-none" onchange="window.toggleCourtInput(this)">
                            <option value="Mistral-Homes">MISTRAL-HOMES</option>
                            <option value="custom">OTRA PISTA...</option>
                        </select>
                        <input type="text" id="inp-court-custom" class="hidden mt-2 bg-white/5 border border-white/10 w-full text-[10px] p-2 rounded text-white font-bold uppercase" placeholder="NOMBRE PISTA" oninput="document.getElementById('inp-court').value = this.value">
                        <input type="hidden" id="inp-court" value="Mistral-Homes">
                    </div>
                </div>
                
                <div class="range-box-v7 mb-6">
                    <div class="val-input">
                        <span>NIVEL MIN</span>
                        <input type="number" id="inp-min-lvl" value="2.0" step="0.1" max="7">
                    </div>
                    <div class="range-sep"></div>
                     <div class="val-input">
                        <span>NIVEL MAX</span>
                        <input type="number" id="inp-max-lvl" value="6.0" step="0.1" max="7">
                    </div>
                </div>

                <div id="reto-options" class="hidden-v5 mb-6">
                    <div class="bet-input-wrap-v7">
                        <i class="fas fa-coins text-sport-gold text-xl"></i>
                        <input type="number" id="inp-bet" value="50" placeholder="Apuesta">
                        <span class="suffix">FP POT</span>
                    </div>
                </div>

                <!-- Visibilidad: Pública / Privada -->
                <span class="cfg-label-v7">VISIBILIDAD</span>
                <div class="mode-selector-v7 mb-6">
                    <div id="opt-public" class="mode-card-v7 active" onclick="setMatchVisibility('public')">
                        <div class="mode-icon"><i class="fas fa-globe"></i></div>
                        <div>
                            <span class="m-name">Pública</span>
                            <span class="m-desc text-[9px] opacity-60">Visible para todos</span>
                        </div>
                    </div>
                    <div id="opt-private" class="mode-card-v7" onclick="setMatchVisibility('private')">
                        <div class="mode-icon"><i class="fas fa-lock"></i></div>
                        <div>
                            <span class="m-name">Privada</span>
                            <span class="m-desc text-[9px] opacity-60">Solo invitados</span>
                        </div>
                    </div>
                </div>

                <button class="btn-confirm-v7" onclick="executeCreateMatch('${dateStr}', '${hour}')">
                    <div>
                        <span class="t-main">CONFIRMAR RESERVA</span>
                        <span class="t-sub block">PISTA CENTRAL • TARIFA PLANA</span>
                    </div>
                    <i class="fas fa-fingerprint"></i>
                </button>
            </div>
        </div>
    `;

    // Weather widget
    setTimeout(async () => {
        try {
            const { getDetailedWeather } = await import('./external-data.js');
            const w = await getDetailedWeather();
            if (w && w.current) {
                const box = document.getElementById('creation-weather');
                if (box) {
                    box.className = 'meta-pill';
                    box.innerHTML = `<i class="fas fa-cloud-sun text-white"></i><span>${Math.round(w.current.temperature_2m)}°C</span>`;
                }
            }
        } catch(e) {}
    }, 100);

    // Temp state
    window._creationType = 'amistoso';
    window._creationVisibility = 'public';
    window._initialJugadores = [currentUser.uid, null, null, null];

    window.setMatchType = (t) => {
        window._creationType = t;
        document.getElementById('opt-am').classList.toggle('active', t === 'amistoso');
        document.getElementById('opt-re').classList.toggle('active', t === 'reto');
        document.getElementById('reto-options').classList.toggle('hidden-v5', t !== 'reto');
    };

    window.setMatchVisibility = (v) => {
        window._creationVisibility = v;
        document.getElementById('opt-public').classList.toggle('active', v === 'public');
        document.getElementById('opt-private').classList.toggle('active', v === 'private');
    };
}

/**
 * Fetches refined player data.
 * @private
 */
async function getPlayerData(uid) {
    if (!uid) return null;
    if (uid.startsWith('GUEST_')) {
        const parts = uid.split('_');
        return { name: parts[1], level: parseFloat(parts[2]), id: uid, isGuest: true, pala: parts[3] || 'Desconocida' };
    }
    const d = await getDocument('usuarios', uid);
    return d ? { name: d.nombreUsuario || d.nombre, photo: d.fotoPerfil || d.fotoURL, level: d.nivel || 2.5, id: uid } : null;
}

/**
 * Renders a single player slot for the detailed view.
 * Compatible with V7.
 */
function renderPlayerSlot(p, idx, canEdit, mid, col) {
    const isTeamA = idx < 2;
    // Using p-slot-v7 logic
    if (p) {
        const photo = p.photo || p.fotoPerfil || p.fotoURL || './imagenes/Logojafs.png';
        const colorClass = isTeamA ? 'border-primary' : 'border-secondary';
        return `
            <div class="p-slot-v7 pointer" 
                 onclick="${mid && !p.id.startsWith('GUEST_') ? `window.viewProfile('${p.id}')` : ''}">
                <div class="p-img-box" style="border-color:${isTeamA ? 'var(--primary)' : 'var(--secondary)'}">
                    <img src="${photo}">
                </div>
                <span class="p-badge" style="color:${isTeamA ? 'var(--primary)' : 'var(--secondary)'}; border-color:currentColor">${p.level.toFixed(1)}</span>
                <span class="text-[8px] font-black uppercase text-white tracking-widest mt-1 truncate w-16 text-center">${p.name}</span>
                ${canEdit && idx > 0 ? `<button class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex center text-white text-[8px]" onclick="event.stopPropagation(); executeMatchAction('remove', '${mid}', '${col}', {idx:${idx}})"><i class="fas fa-times"></i></button>` : ''}
            </div>
        `;
    }

    return `
        <div class="p-slot-v7" 
             onclick="${canEdit ? `window.openPlayerSelector('${mid}', '${col}', {idx:${idx}})` : ''}">
            <div class="p-img-box empty" style="border:1px dashed rgba(255,255,255,0.2)">
                <i class="fas fa-plus text-white opacity-50"></i>
            </div>
            <span class="text-[8px] font-black uppercase text-muted tracking-widest mt-3">VACÍO</span>
        </div>
    `;
}

/**
 * Determines available actions for a match.
 */
function renderMatchActions(m, isParticipant, isCreator, uid, id, col) {
    const isPlayed = m.estado === 'jugado';
    if (isPlayed) return `<button class="btn-confirm-v7" onclick="window.location.href='diario.html?matchId=${id}'"><span class="t-main">VER ANALITICAS</span><i class="fas fa-chart-pie"></i></button>`;

    if (!isParticipant) {
        return `
            <button class="btn-confirm-v7" onclick="executeMatchAction('join', '${id}', '${col}')">
                <span class="t-main">UNIRSE AL SQUAD</span>
                <i class="fas fa-fingerprint"></i>
            </button>
        `;
    }

    const realPlayerCount = (m.jugadores || []).filter(id => id).length;
    return `
        <div class="flex-row gap-3 w-full">
            <button class="flex-1 py-4 rounded-xl bg-white/5 border border-white/10 text-[10px] font-black text-white hover:bg-white/10" onclick="executeMatchAction('leave', '${id}', '${col}')">
                ABANDONAR
            </button>
            ${isCreator ? `<button class="flex-1 py-4 rounded-xl bg-red-500/10 border border-red-500/30 text-[10px] font-black text-red-500 hover:bg-red-500/20" onclick="executeMatchAction('delete', '${id}', '${col}')">CANCELAR</button>` : ''}
        </div>
        ${realPlayerCount === 4 ? `
            <button class="btn-confirm-v7 mt-2" onclick="openResultForm('${id}', '${col}')">
                <span class="t-main">FINALIZAR & REPORTAR</span>
                <i class="fas fa-flag-checkered"></i>
            </button>
        ` : ''}
    `;
}

/**
 * Creates match in Firestore.
 */
window.executeCreateMatch = async (dateStr, hour) => {
    const minInput = document.getElementById('inp-min-lvl');
    const maxInput = document.getElementById('inp-max-lvl');
    const min = minInput ? parseFloat(minInput.value) : 2.0;
    const max = maxInput ? parseFloat(maxInput.value) : 6.0;
    
    const type = window._creationType || 'amistoso';
    const betInput = document.getElementById('inp-bet');
    const bet = (type === 'reto' && betInput) ? parseInt(betInput.value || 0) : 0;
    const col = type === 'reto' ? 'partidosReto' : 'partidosAmistosos';
    
    // Ensure we have exactly 4 slots
    const jugs = window._initialJugadores || [auth.currentUser.uid, null, null, null];
    while (jugs.length < 4) jugs.push(null);
    if(jugs.length > 4) jugs.length = 4;
    
    const matchDate = new Date(`${dateStr}T${hour}`);
    
    try {
        const visibility = window._creationVisibility || 'public';
        const invitedUsers = jugs.filter(id => id && id !== auth.currentUser.uid && !id.startsWith('GUEST_'));

        const matchData = {
            creador: auth.currentUser.uid,
            organizerId: auth.currentUser.uid,
            fecha: matchDate,
            jugadores: jugs,
            restriccionNivel: { min, max },
            familyPointsBet: bet,
            estado: 'abierto',
            visibility: visibility,
            invitedUsers: visibility === 'private' ? invitedUsers : [],
            timestamp: serverTimestamp(),
            equipoA: [jugs[0], jugs[1]],
            equipoB: [jugs[2], jugs[3]],
            surface: document.getElementById('inp-surface')?.value || 'indoor',
            courtType: document.getElementById('inp-court')?.value || 'normal'
        };

        // Pre-Match Prediction (if filled)
        const validPlayers = jugs.filter(id => id);
        if (validPlayers.length === 4) {
            try {
                const profiles = await Promise.all(jugs.map(async uid => {
                    if (uid.startsWith('GUEST_')) {
                        const parts = uid.split('_');
                        return { id: uid, puntosRanking: 1000, nivel: parseFloat(parts[2]) || 2.5 }; 
                    }
                    const d = await getDoc(doc(db, 'usuarios', uid));
                    return d.exists() ? d.data() : { puntosRanking: 1000, nivel: 2.5 };
                }));

                const { PredictiveEngine } = await import('./predictive-engine.js');
                const prediction = PredictiveEngine.calculateMatchProbability(
                    profiles[0], profiles[1], profiles[2], profiles[3], 
                    { surface: matchData.surface }
                );
                
                matchData.preMatchPrediction = prediction;
                if (prediction.volatility.includes('Alta')) matchData.tags = ['high_volatility'];
            } catch (err) { }
        }

        await addDoc(collection(db, col), matchData);

        const others = jugs.filter(id => id && id !== auth.currentUser.uid && !id.startsWith('GUEST_'));
        if (others.length > 0) {
            const notifType = visibility === 'private' ? 'private_invite' : 'match_join';
            const notifMsg = visibility === 'private'
                ? `Te han invitado a una partida privada el ${matchDate.toLocaleDateString()}`
                : `Te han convocado para el ${matchDate.toLocaleDateString()}`;
            await createNotification(others, "¡Padeluminatis!", notifMsg, notifType, 'calendario.html');
        }

        showToast("SISTEMA", "Despliegue confirmado en la Matrix", "success");
        if (window.closeMatchModal) window.closeMatchModal();
        else document.getElementById('modal-match')?.classList.remove('active');
    } catch(e) {
        console.error("Error creating match:", e);
        showToast("ERROR", "Fallo en la creación del nodo", "error");
    }
};

/**
 * Universal action handler.
 */
window.executeMatchAction = async (action, id, col, extra = {}) => {
    const user = auth.currentUser;
    if (!user) return;
    const ref = doc(db, col, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const m = snap.data();
    let jugs = [...(m.jugadores || [])];
    const matchDate = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);

    try {
        if (action === 'join') {
            const emptyIdx = jugs.findIndex(id => !id);
            if (emptyIdx === -1) return showToast("COMPLETO", "Sin huecos en este nodo", "warning");
            
            const d = await getDoc(doc(db, "usuarios", user.uid));
            const uLvl = d.data()?.nivel || 2.5;
            
            if (m.restriccionNivel && (uLvl < m.restriccionNivel.min || uLvl > m.restriccionNivel.max)) {
                return showToast("ACCESO DENEGADO", "Nivel incompatible con el protocolo", "warning");
            }
            
            // Private Security Check
            if (m.visibility === 'private') {
                const isInvited = (m.invitedUsers || []).includes(user.uid);
                const isOwner = m.organizerId === user.uid || m.creador === user.uid;
                if (!isInvited && !isOwner) {
                    return showToast("ACCESO DENEGADO", "Requiere invitación oficial", "error");
                }
            }
            
            jugs[emptyIdx] = user.uid;
            await updateDoc(ref, { 
                jugadores: jugs,
                equipoA: [jugs[0], jugs[1]],
                equipoB: [jugs[2], jugs[3]]
            });
            
            // Orchestrator Broadcast
            if (jugs.filter(id => id).length === 4) {
                try {
                    const { AIOrchestrator } = await import('./ai-orchestrator.js');
                    jugs.forEach(uid => {
                        if (uid && !uid.startsWith('GUEST_')) AIOrchestrator.dispatch('MATCH_READY', { uid, matchId: id });
                    });
                } catch(err) {}
            }
            
            await createNotification(m.creador, "Refuerzos", `${d.data()?.nombreUsuario} se ha unido al squad`, 'match_join', 'calendario.html');
            showToast("CONECTADO", "Sincronización completa", "success");
        } 
        else if (action === 'leave') {
            const wasFull = jugs.filter(id => id).length === 4;
            const idx = jugs.indexOf(user.uid);
            if (idx !== -1) {
                jugs[idx] = null;
                const activeJugs = jugs.filter(id => id && !id.startsWith('GUEST_'));
                
                if (activeJugs.length === 0 && jugs.filter(id => id).length === 0) {
                    await deleteDoc(ref);
                    showToast("NODO COLAPSADO", "Partido eliminado por vacío", "info");
                } else {
                    await updateDoc(ref, { 
                        jugadores: jugs,
                        creador: activeJugs[0] || m.creador,
                        equipoA: [jugs[0], jugs[1]],
                        equipoB: [jugs[2], jugs[3]]
                    });

                    if (wasFull) {
                        try {
                            const { AIOrchestrator } = await import('./ai-orchestrator.js');
                            jugs.forEach(uid => {
                                if (uid && !uid.startsWith('GUEST_')) AIOrchestrator.dispatch('MATCH_UNREADY', { uid, matchId: id });
                            });
                        } catch(err) {}
                    }
                    showToast("DESCONECTADO", "Has abandonado la sesión", "info");
                }
            }
        }
        else if (action === 'delete') {
            if (confirm("¿Abortar misión?")) {
                const others = jugs.filter(uid => uid !== user.uid && !uid.startsWith('GUEST_'));
                await createNotification(others, "Misión Abortada", `El partido ha sido cancelado por el líder`, 'warning', 'calendario.html');
                await deleteDoc(ref); 
                showToast("ABORTADO", "Protocolo cancelado", "warning"); 
            }
        }
        else if (action === 'remove') {
            const removedUid = jugs[extra.idx];
            jugs[extra.idx] = null;
            await updateDoc(ref, { 
                jugadores: jugs,
                equipoA: [jugs[0], jugs[1]],
                equipoB: [jugs[2], jugs[3]]
            });
            if (removedUid && !removedUid.startsWith('GUEST_')) {
                await createNotification(removedUid, "Expulsado", `Has sido retirado del squad`, 'warning');
            }
            showToast("ELIMINADO", "Jugador expulsado", "info");
        }
        else if (action === 'add') {
             if (extra.idx !== undefined) jugs[extra.idx] = extra.uid;
             else {
                 const nextHueco = jugs.findIndex(id => !id);
                 if (nextHueco !== -1) jugs[nextHueco] = extra.uid;
                 else return showToast("ERROR", "Squad completo", "warning");
             }
             
             await updateDoc(ref, { 
                jugadores: jugs,
                equipoA: [jugs[0], jugs[1]],
                equipoB: [jugs[2], jugs[3]]
             });
             
             if (!extra.uid.startsWith('GUEST_')) {
                await createNotification(extra.uid, "Reclutado", `Te han añadido a un partido`, 'match_join', 'calendario.html');
             }
             showToast("AÑADIDO", "Agente reclutado", "success");
        }
    } catch(e) { 
        console.error(e);
        showToast("ERROR", "Fallo en la operación", "error"); 
    }
};

/**
 * Initializes real-time chat.
 */
async function initMatchChat(id, col) {
    const box = document.getElementById('match-chat-msgs');
    if (!box) return;
    const q = query(collection(db, col, id, 'chat'), orderBy('timestamp', 'asc'), limit(30));
    safeOnSnapshot(q, async (snap) => {
        const msgs = await Promise.all(snap.docs.map(async d => {
            const data = d.data();
            const sender = await getPlayerName(data.uid);
            const isMe = data.uid === auth.currentUser?.uid;
            // Use simple chat styling since comms-panel handles container
            return `
                <div class="flex-row items-end gap-2 mb-2 ${isMe ? 'justify-end' : ''}">
                    <div class="px-3 py-2 rounded-xl text-[10px] ${isMe ? 'bg-primary text-black' : 'bg-white/10 text-white'}" style="max-width:80%">
                        <div class="font-black opacity-50 text-[7px] mb-1 uppercase">${sender}</div>
                        ${data.text}
                    </div>
                </div>
            `;
        }));
        box.innerHTML = msgs.length > 0 ? msgs.join('') : '<div class="center opacity-20 text-[8px] py-10">CANAL LIMPIO</div>';
        box.scrollTop = box.scrollHeight;
    });
}

window.sendMatchChat = async (id, col) => {
    const inp = document.getElementById('match-chat-in');
    const text = inp.value.trim();
    if (!text || !auth.currentUser) return;
    await addDoc(collection(db, col, id, 'chat'), { uid: auth.currentUser.uid, text, timestamp: serverTimestamp() });
    inp.value = '';
};

async function getPlayerName(uid) {
    if (!uid) return 'Anónimo';
    if (uid.startsWith('GUEST_')) return uid.split('_')[1];
    const d = await getDocument('usuarios', uid);
    return d?.nombreUsuario || d?.nombre || 'Jugador';
}

window.closeMatchModal = () => document.getElementById('modal-match')?.classList.remove('active');

window.openResultForm = async (id, col) => {
    const area = document.getElementById('match-detail-area');
    if (!area) return;

    // Use V7 Booking Hub style for result form
    area.innerHTML = `
        <div class="booking-hub-v7 animate-up p-2 max-w-sm mx-auto">
            <h3 class="hub-title-v7 text-center mb-6">Resultados</h3>
            <div class="flex-col gap-4 mb-8">
                ${[1, 2, 3].map(i => `
                    <div class="range-box-v7 justify-between" id="set-row-${i}">
                        <span class="text-[10px] font-black text-primary w-12">SET ${i}</span>
                        <div class="flex-row gap-4">
                             <input type="number" id="s${i}-1" class="bg-transparent border-none text-white font-black text-xl w-10 text-center outline-none" placeholder="0" onchange="checkSets()">
                             <span class="opacity-30">-</span>
                             <input type="number" id="s${i}-2" class="bg-transparent border-none text-white font-black text-xl w-10 text-center outline-none" placeholder="0" onchange="checkSets()">
                        </div>
                    </div>
                `).join('')}
            </div>
            <button class="btn-confirm-v7" id="btn-save-res">
                <span class="t-main">REGISTRAR DATOS</span>
                <i class="fas fa-save"></i>
            </button>
        </div>
    `;

    window.checkSets = () => {
        const s1_1 = parseInt(document.getElementById('s1-1').value) || 0;
        const s1_2 = parseInt(document.getElementById('s1-2').value) || 0;
        const s2_1 = parseInt(document.getElementById('s2-1').value) || 0;
        const s2_2 = parseInt(document.getElementById('s2-2').value) || 0;

        const w1 = s1_1 > s1_2 ? 1 : (s1_2 > s1_1 ? 2 : 0);
        const w2 = s2_1 > s2_2 ? 1 : (s2_2 > s2_1 ? 2 : 0);

        const row3 = document.getElementById('set-row-3');
        if (row3) {
            if (w1 !== 0 && w1 === w2) {
                row3.style.opacity = '0.2';
                row3.style.pointerEvents = 'none';
                document.getElementById('s3-1').value = '';
                document.getElementById('s3-2').value = '';
            } else {
                row3.style.opacity = '1';
                row3.style.pointerEvents = 'auto';
            }
        }
    };

    document.getElementById('btn-save-res').onclick = async () => {
        const res = [];
        for(let i=1; i<=3; i++){
            const i1 = document.getElementById(`s${i}-1`);
            const i2 = document.getElementById(`s${i}-2`);
            if (i1 && i2 && i1.value !== '' && i2.value !== '') {
                res.push(`${i1.value}-${i2.value}`);
            }
        }
        
        if (res.length < 2) return showToast("INCOMPLETO", "Se requieren al menos 2 sets", "warning");

        try {
            const resultStr = res.join(' ');
            await updateDoc(doc(db, col, id), { resultado: { sets: resultStr }, estado: 'jugado' });
            await processMatchResults(id, col, resultStr);
            showToast("DATOS GUARDADOS", "Ranking actualizado", "success");
            window.closeMatchModal();
            setTimeout(() => {
                try { window.location.href = `diario.html?matchId=${id}`; } catch (_) {}
            }, 1000);
        } catch (e) {
            showToast("ERROR", "Fallo al guardar resultados", "error");
        }
    };
};

// --- DYNAMIC UI HELPERS ---
window.toggleCourtInput = (sel) => {
    const customInp = document.getElementById('inp-court-custom');
    const finalInp = document.getElementById('inp-court');
    if (sel.value === 'custom') {
        customInp.classList.remove('hidden');
        customInp.focus();
        finalInp.value = customInp.value; 
    } else {
        customInp.classList.add('hidden');
        finalInp.value = sel.value;
    }
};

window.openPlayerSelector = async (matchId, col, extra) => {
    const q = query(collection(db, 'usuarios'), orderBy('nombreUsuario'), limit(50));
    const listSnap = await getDocs(q);
    const users = listSnap.docs.map(d => ({id: d.id, ...d.data()}));
    
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.zIndex = '9999';
    overlay.innerHTML = `
        <div class="modal-card animate-up glass-strong" style="max-width:360px">
            <div class="modal-header border-b border-white/10 p-4 flex-row between items-center">
                <span class="text-xs font-black text-white uppercase tracking-widest">AÑADIR JUGADOR</span>
                <button class="close-btn w-8 h-8 rounded-full bg-white/5 flex center" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times text-white"></i></button>
            </div>
            
            <div class="p-4">
                <div class="ps-tabs flex-row gap-2 mb-4">
                    <div class="ps-tab active flex-1 p-2 text-center rounded-xl bg-primary text-black font-black text-xs cursor-pointer" onclick="window.switchPsTab(this, 'search')">EXISTENTE</div>
                    <div class="ps-tab flex-1 p-2 text-center rounded-xl bg-white/5 text-white font-black text-xs cursor-pointer" onclick="window.switchPsTab(this, 'guest')">INVITADO</div>
                </div>
                
                <div id="ps-panel-search">
                    <input type="text" id="ps-search" class="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs font-bold mb-3 outline-none focus:border-primary/50" placeholder="Buscar jugador..." oninput="window.filterPsUsers(this.value)">
                    <div id="ps-list" class="flex-col gap-2 max-h-[40vh] overflow-y-auto custom-scroll">
                        <!-- Users Rendered Here -->
                    </div>
                </div>
                
                <div id="ps-panel-guest" class="hidden flex-col gap-3">
                    <input type="text" id="guest-name" class="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs font-bold outline-none focus:border-primary/50" placeholder="Nombre Invitado">
                    <div class="flex-row gap-2">
                        <input type="number" id="guest-level" class="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs font-bold outline-none focus:border-primary/50" placeholder="Nivel (2.5)" step="0.1">
                        <input type="text" id="guest-pala" class="flex-1 bg-white/5 border border-white/10 rounded-xl p-3 text-white text-xs font-bold outline-none focus:border-primary/50" placeholder="Pala (Opcional)">
                    </div>
                </div>

                <button id="btn-add-guest" class="hidden w-full py-4 mt-4 bg-gradient-to-r from-primary to-lime-400 rounded-xl text-black font-black text-xs tracking-widest shadow-glow hover:scale-[1.02] transition-transform" onclick="window.addGuest('${matchId}', '${col}', ${JSON.stringify(extra).replace(/"/g, "'")})">
                    CONFIRMAR INVITADO <i class="fas fa-check ml-2"></i>
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    
    window.psUsersCache = users;
    window.psMatchContext = { matchId, col, extra };
    window.filterPsUsers('');
};

window.switchPsTab = (tab, mode) => {
    document.querySelectorAll('.ps-tab').forEach(t => {
        t.classList.remove('bg-primary', 'text-black');
        t.classList.add('bg-white/5', 'text-white');
    });
    tab.classList.remove('bg-white/5', 'text-white');
    tab.classList.add('bg-primary', 'text-black');
    
    document.getElementById('ps-panel-search').classList.toggle('hidden', mode !== 'search');
    document.getElementById('ps-panel-guest').classList.toggle('hidden', mode !== 'guest');
    document.getElementById('btn-add-guest').classList.toggle('hidden', mode !== 'guest');
};

window.filterPsUsers = (q) => {
    const term = q.toLowerCase();
    const filtered = window.psUsersCache.filter(u => (u.nombreUsuario || u.nombre || '').toLowerCase().includes(term));
    const mid = window.psMatchContext.matchId;
    const col = window.psMatchContext.col;
    const extra = window.psMatchContext.extra;
    
    document.getElementById('ps-list').innerHTML = filtered.map(u => {
        const isNew = mid === 'NEW';
        const action = isNew ? `window.selectUserForNew('${u.id}')` : `window.executeMatchAction('add', '${mid}', '${col}', {uid:'${u.id}', idx:${extra.idx}})`;
        const finalAction = `${action}; document.querySelector('.modal-overlay.active').remove();`;
        
        return `
        <div class="flex-row items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5 hover:border-primary/50 cursor-pointer transition-all hover:bg-white/10" onclick="${finalAction}">
            <img src="${u.fotoPerfil || u.fotoURL || './imagenes/Logojafs.png'}" class="w-8 h-8 rounded-full bg-black/50 object-cover border border-white/10">
            <div class="flex-col flex-1">
                <span class="text-xs font-bold text-white">${u.nombreUsuario || u.nombre || 'Jugador'}</span>
                <span class="text-[9px] text-muted">Nivel ${(u.nivel || 2.5).toFixed(2)}</span>
            </div>
            <i class="fas fa-plus text-primary text-xs"></i>
        </div>
        `;
    }).join('');
};

window.addGuest = (mid, col, extra) => {
    const name = document.getElementById('guest-name').value.trim();
    const level = document.getElementById('guest-level').value || 2.5;
    const pala = document.getElementById('guest-pala').value.trim() || 'Desconocida';
    
    if (!name) return showToast("ERROR", "Nombre requerido", "error");
    
    const guestId = `GUEST_${name}_${level}_${pala}`;
    
    if (mid === 'NEW') {
        const u = { id: guestId, nombreUsuario: name + ' (Inv)', nivel: parseFloat(level), fotoPerfil: './imagenes/Logojafs.png', isGuest: true };
        if (!window.psUsersCache) window.psUsersCache = [];
        window.psUsersCache.push(u);
        window.selectUserForNew(guestId);
    } else {
        window.executeMatchAction('add', mid, col, { uid: guestId, idx: extra.idx });
    }
    document.querySelector('.modal-overlay.active').remove();
};

window.selectUserForNew = (uid) => {
    const extra = window.psMatchContext.extra; 
    window._initialJugadores[extra.idx] = uid;
    
    let u = window.psUsersCache.find(x => x.id === uid);
    if (!u && uid.startsWith('GUEST_')) {
         const parts = uid.split('_');
         u = { nombreUsuario: parts[1] + ' (Inv)', nivel: parseFloat(parts[2]), fotoPerfil: './imagenes/Logojafs.png' };
    }
    
    const slot = document.getElementById(`slot-${extra.idx}-wrap`);
    if(slot && u) {
        const isTeamA = extra.idx < 2;
        const color = isTeamA ? 'var(--primary)' : 'var(--secondary)';
        
        slot.className = "p-slot-v7 pointer";
        slot.onclick = null; 
        slot.innerHTML = `
            <div class="p-img-box" style="border-color:${color}">
                <img src="${u.fotoPerfil || u.fotoURL || './imagenes/Logojafs.png'}">
            </div>
            <span class="p-badge" style="color:${color}; border-color:currentColor">${(Number(u.nivel)||2.5).toFixed(1)}</span>
            <span class="text-[8px] font-black uppercase text-white tracking-widest mt-1 truncate w-16 text-center">${u.nombreUsuario || u.nombre || 'Jugador'}</span>
            <button class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex center text-white text-[8px] shadow-lg z-10 hover:scale-110 transition-transform" onclick="event.stopPropagation(); window.removeUserFromNew(${extra.idx})"><i class="fas fa-times"></i></button>
        `;
    }
};

window.removeUserFromNew = (idx) => {
    window._initialJugadores[idx] = null;
    const slot = document.getElementById(`slot-${idx}-wrap`);
    if(slot) {
        slot.className = "p-slot-v7";
        slot.innerHTML = `<div class="p-img-box empty"><i class="fas fa-plus text-muted"></i></div>`;
        slot.onclick = () => window.openPlayerSelector('NEW', window._creationType, {idx});
    }
};
