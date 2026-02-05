// match-service.js - Premium Match Experience (v18.0)
import { db, getDocument, subscribeDoc, updateDocument, addDocument, auth } from './firebase-service.js';
import { doc, getDoc, getDocs, collection, deleteDoc, onSnapshot, query, orderBy, limit, addDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { showToast } from './ui-core.js';
import { sendNotification } from './services/notifications.js';

export async function renderMatchDetail(container, matchId, type, currentUser, userData) {
    if (!container) return;
    const isReto = type ? type.toLowerCase().includes('reto') : false;
    const col = isReto ? 'partidosReto' : 'partidosAmistosos';
    
    container.innerHTML = `<div class="center py-20"><div class="spinner-galaxy"></div></div>`;

    const render = async (m) => {
        if (!m) { container.innerHTML = '<div class="center p-10 opacity-50">Partido no encontrado</div>'; return; }
        
        const isParticipant = m.jugadores?.includes(currentUser.uid);
        const isCreator = m.creador === currentUser.uid || userData?.rol === 'Admin';
        const date = m.fecha?.toDate ? m.fecha.toDate() : new Date(m.fecha);
        const players = await Promise.all([0, 1, 2, 3].map(i => getPlayerData(m.jugadores?.[i])));

        // Weather Forecast 
        let weatherHtml = '<i class="fas fa-clock opacity-30"></i> <span class="text-[10px]">Cargando...</span>';
        try {
            const { getDetailedWeather } = await import('./external-data.js');
            const w = await getDetailedWeather();
            if (w && w.current) {
                const rain = w.current.rain || 0;
                const wind = w.current.wind_speed_10m || 0;
                weatherHtml = `
                    <div class="flex-row items-center gap-3">
                        <div class="flex-row items-center gap-1 bg-black/40 px-3 py-1.5 rounded-full border border-white/5">
                            <i class="fas fa-wind text-cyan-400 text-[10px]"></i>
                            <span class="text-[10px] font-black text-white">${Math.round(wind)}<span class="opacity-50 ml-0.5">km/h</span></span>
                        </div>
                        <div class="flex-row items-center gap-1 bg-black/40 px-3 py-1.5 rounded-full border border-white/5">
                            <i class="fas fa-droplet ${rain > 0 ? 'text-blue-400' : 'text-gray-500'} text-[10px]"></i>
                            <span class="text-[10px] font-black text-white">${rain}<span class="opacity-50 ml-0.5">mm</span></span>
                        </div>
                        <div class="flex-row items-center gap-1 bg-black/40 px-3 py-1.5 rounded-full border border-white/10">
                            <i class="fas fa-temperature-half text-primary text-[10px]"></i>
                            <span class="text-[10px] font-black text-white">${Math.round(w.current.temperature_2m)}°C</span>
                        </div>
                    </div>
                `;
            }
        } catch(e) {}

        // Win Forecast
        const team1Avg = ( (players[0]?.level || 2.5) + (players[1]?.level || 2.5) ) / 2;
        const team2Avg = ( (players[2]?.level || 2.5) + (players[3]?.level || 2.5) ) / 2;
        const diff = team1Avg - team2Avg;
        const p1 = Math.min(Math.max(50 + (diff * 20), 10), 90);
        const p2 = 100 - p1;

        const creatorSnap = await getDoc(doc(db, "usuarios", m.creador));
        const cName = creatorSnap.exists() ? (creatorSnap.data().nombreUsuario || creatorSnap.data().nombre) : 'Jugador';

        container.innerHTML = `
            <div class="match-detail-v5 animate-up">
                <div class="detail-header-v5 mb-6">
                    <div class="flex-col">
                        <div class="type-badge-pro ${isReto ? 'reto' : 'amistoso'}">
                            <i class="fas ${isReto ? 'fa-bolt' : 'fa-handshake'}"></i>
                            <span>${isReto ? 'RETO POR PUNTOS' : 'JUEGO AMISTOSO'}</span>
                        </div>
                        <h2 class="text-2xl font-black text-white mb-0 mt-2">${date.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'})} HS</h2>
                        <span class="text-[10px] font-bold text-muted uppercase tracking-[2px]">${date.toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'short'})}</span>
                    </div>
                    <div class="detail-weather-v5">${weatherHtml}</div>
                </div>

                <!-- Probability Bar -->
                <div class="probability-wrap mb-6">
                    <div class="flex-between mb-1">
                        <span class="text-[9px] font-black text-primary">EQUIPO A: ${Math.round(p1)}%</span>
                        <span class="text-[9px] font-black text-muted uppercase">Nivel vs Probabilidad</span>
                        <span class="text-[9px] font-black text-secondary">EQUIPO B: ${Math.round(p2)}%</span>
                    </div>
                    <div class="prob-bar-track">
                        <div class="prob-fill t1" style="width: ${p1}%"></div>
                        <div class="prob-fill t2" style="width: ${p2}%"></div>
                    </div>
                </div>

                <div class="tennis-court-v5 shadow-2xl mb-6">
                    <div class="net-line"></div>
                    <div class="court-half">
                        <div class="court-slots">
                            ${renderPlayerSlot(players[0], 0, isCreator, matchId, col)}
                            ${renderPlayerSlot(players[1], 1, isCreator, matchId, col)}
                        </div>
                    </div>
                    <div class="vs-circle-v5">VS</div>
                    <div class="court-half">
                         <div class="court-slots">
                            ${renderPlayerSlot(players[2], 2, isCreator, matchId, col)}
                            ${renderPlayerSlot(players[3], 3, isCreator, matchId, col)}
                        </div>
                    </div>
                </div>

                <div class="organizer-chip mb-6">
                    <i class="fas fa-crown text-yellow-500"></i>
                    <span>CREADO POR <b>${cName.toUpperCase()}</b></span>
                </div>

                <div class="match-chat-v5 mb-6">
                    <div class="chat-header-mini">
                         <i class="fas fa-comments text-primary mr-2"></i>
                         <span>ESTRATEGIA DE PISTA</span>
                    </div>
                    <div id="match-chat-msgs" class="chat-flow-area">
                        ${!isParticipant ? '<div class="chat-lock-msg"><i class="fas fa-lock"></i> Entra al partido para chatear</div>' : ''}
                    </div>
                    ${isParticipant ? `
                        <div class="chat-input-row-mini">
                            <input type="text" id="match-chat-in" placeholder="Escribe al equipo...">
                            <button class="send-mini" onclick="sendMatchChat('${matchId}', '${col}')"><i class="fas fa-chevron-right"></i></button>
                        </div>
                    ` : ''}
                </div>

                <div class="actions-grid-v5">
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

export async function renderCreationForm(container, dateStr, hour, currentUser, userData) {
    if (!container) return;
    const date = new Date(dateStr);
    
    container.innerHTML = `
        <div class="match-creation-v5 animate-up">
            <div class="modal-header-row mb-6">
                <div class="flex-col">
                    <span class="badge-creation">NUEVA RESERVA</span>
                    <h2 class="text-xl font-black text-white uppercase">${hour} • ${date.toLocaleDateString('es-ES', {weekday:'short', day:'numeric', month:'short'})}</h2>
                </div>
                <div id="creation-weather" class="creation-weather-small"></div>
                <button class="btn-icon-glass" onclick="closeMatchModal()"><i class="fas fa-times"></i></button>
            </div>

            </div>

            <div class="form-body-v5">
                <!-- External Reservation Alert -->
                <div class="alert-box-warning mb-4">
                    <i class="fas fa-exclamation-triangle text-yellow-500"></i>
                    <div class="flex-col">
                        <span class="text-[10px] font-black uppercase text-yellow-500">Recordatorio Importante</span>
                        <span class="text-[10px] text-muted leading-tight">Recuerda reservar tu pista también en <a href="https://www.apoing.com" target="_blank" class="text-white underline">www.apoing.com</a> para asegurar el horario.</span>
                    </div>
                </div>

                <div class="section-title-row mb-3">
                    <span class="text-xs font-bold text-muted uppercase tracking-widest">Configuración del Partido</span>
                    <div class="h-[1px] flex-1 bg-white/10 ml-3"></div>
                </div>

                <!-- Match Type Cards -->
                <div class="grid grid-cols-2 gap-3 mb-6">
                    <div class="type-card active" id="opt-am" onclick="setMatchType('amistoso')">
                        <div class="type-icon-box bg-blue-500/20 text-blue-400">
                            <i class="fas fa-handshake"></i>
                        </div>
                        <span class="type-title">Amistoso</span>
                        <span class="type-desc">Entrenamiento relax sin presión</span>
                        <div class="active-check"><i class="fas fa-check"></i></div>
                    </div>
                    
                    <div class="type-card" id="opt-re" onclick="setMatchType('reto')">
                        <div class="type-icon-box bg-orange-500/20 text-orange-400">
                            <i class="fas fa-bolt"></i>
                        </div>
                        <span class="type-title">Reto Oficial</span>
                        <span class="type-desc">Compite por puntos ELO</span>
                        <div class="active-check"><i class="fas fa-check"></i></div>
                    </div>
                </div>

                <!-- Level Restriction -->
                <div class="setting-row-card mb-6">
                    <div class="flex-row items-center justify-between mb-3">
                        <div class="flex-col gap-1">
                            <span class="text-sm font-bold text-white">Nivel Requerido</span>
                            <span class="text-[10px] text-muted">Limitar acceso por nivel de juego</span>
                        </div>
                        <label class="switch-toggle">
                            <input type="checkbox" id="check-lvl-restrict" onchange="toggleLvlInputs(this.checked)">
                            <span class="slider round"></span>
                        </label>
                    </div>
                    
                    <div id="lvl-inputs-container" class="level-inputs-wrapper disabled">
                        <div class="lvl-input-group">
                            <span class="lvl-label">MÍNIMO</span>
                            <input type="number" id="inp-min-lvl" value="2.0" step="0.1" min="1.0" max="7.0" class="lvl-field">
                        </div>
                        <div class="lvl-arrow"><i class="fas fa-arrow-right"></i></div>
                        <div class="lvl-input-group">
                            <span class="lvl-label">MÁXIMO</span>
                            <input type="number" id="inp-max-lvl" value="5.5" step="0.1" min="1.0" max="7.0" class="lvl-field">
                        </div>
                    </div>
                </div>

                <!-- Reto Options (Conditional) -->
                <div id="reto-options" class="setting-row-card mb-6 hidden-v5">
                     <div class="flex-row items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center text-yellow-400">
                            <i class="fas fa-coins"></i>
                        </div>
                        <div class="flex-col flex-1">
                            <span class="text-sm font-bold text-white">Apuesta FamilyPoints</span>
                            <input type="number" id="inp-bet" value="50" step="10" class="bet-input" placeholder="0">
                        </div>
                     </div>
                </div>

                <!-- Court Preview -->
                <div class="section-title-row mb-3">
                    <span class="text-xs font-bold text-muted uppercase tracking-widest">Alineación Inicial</span>
                    <div class="h-[1px] flex-1 bg-white/10 ml-3"></div>
                </div>
                
                <div class="tennis-court-v5 mini mb-8">
                    <div class="court-half">
                        <div class="court-slots">
                            ${renderPlayerSlot({name: 'Tú', level: userData.nivel || 2.5, id: auth.currentUser.uid, photo: userData.fotoPerfil || userData.fotoURL}, 0, false, null, null)}
                            <div id="slot-1-wrap">${renderPlayerSlot(null, 1, true, 'NEW', null)}</div>
                        </div>
                    </div>
                    <div class="vs-circle-v5 sm">VS</div>
                    <div class="court-half">
                         <div class="court-slots">
                            <div id="slot-2-wrap">${renderPlayerSlot(null, 2, true, 'NEW', null)}</div>
                            <div id="slot-3-wrap">${renderPlayerSlot(null, 3, true, 'NEW', null)}</div>
                        </div>
                    </div>
                </div>

                <button class="btn-primary w-full py-4 rounded-xl shadow-lg shadow-primary/20 hover:scale-[1.02] transition-transform" onclick="executeCreateMatch('${dateStr}', '${hour}')">
                    <div class="flex-col items-center leading-none">
                        <span class="text-sm font-black tracking-widest">RESERVAR PISTA</span>
                        <span class="text-[10px] font-bold opacity-60 mt-1">CONFIRMAR PARTIDO</span>
                    </div>
                </button>
            </div>
        </div>
    `;

    // Fetch weather for creation form
    setTimeout(async () => {
        try {
            const { getDetailedWeather } = await import('./external-data.js');
            const w = await getDetailedWeather();
            if (w && w.current) {
                const rain = w.current.rain || 0;
                document.getElementById('creation-weather').innerHTML = `
                    <div class="flex-row items-center gap-1 text-[10px] font-bold text-muted">
                        <i class="fas fa-droplet ${rain > 0 ? 'text-blue-400' : ''}"></i>
                        <span>${rain}mm</span>
                        <span class="mx-1">•</span>
                        <i class="fas fa-temperature-half text-primary"></i>
                        <span>${Math.round(w.current.temperature_2m)}°C</span>
                    </div>
                `;
            }
        } catch(e) {}
    }, 100);

    
    window._creationType = 'amistoso';
    window._initialJugadores = [currentUser.uid, null, null, null];

    window.setMatchType = (t) => {
        window._creationType = t;
        document.getElementById('opt-am').classList.toggle('active', t === 'amistoso');
        document.getElementById('opt-re').classList.toggle('active', t === 'reto');
        document.getElementById('reto-options').classList.toggle('hidden-v5', t !== 'reto');
    };

    window.toggleLvlInputs = (on) => {
        document.getElementById('lvl-inputs-container').classList.toggle('disabled', !on);
    };
}

async function getPlayerData(uid) {
    if (!uid) return null;
    if (uid.startsWith('GUEST_')) {
        const parts = uid.split('_');
        return { name: parts[1], level: parseFloat(parts[2]), id: uid, isGuest: true };
    }
    const d = await getDocument('usuarios', uid);
    return d ? { name: d.nombreUsuario || d.nombre, photo: d.fotoPerfil || d.fotoURL, level: d.nivel || 2.5, id: uid } : null;
}

function renderPlayerSlot(p, idx, canEdit, mid, col) {
    const isTeamA = idx < 2;
    const accentColor = isTeamA ? 'rgba(0, 212, 255, 0.4)' : 'rgba(236, 72, 153, 0.4)';
    const borderColor = isTeamA ? 'var(--primary)' : 'var(--secondary)';

    if (p) {
        const photo = p.photo || p.fotoPerfil || p.fotoURL;
        return `
            <div class="player-slot-court filled animate-pop-in" 
                 onclick="${mid && !p.id.startsWith('GUEST_') ? `window.viewProfile('${p.id}')` : ''}" 
                 style="--slot-accent: ${accentColor}; --slot-border: ${borderColor}">
                <div class="p-avatar-ring">
                    <div class="p-avatar">
                        ${photo ? `<img src="${photo}" style="width:100%; height:100%; object-fit:cover;">` : `<i class="fas fa-user"></i>`}
                    </div>
                </div>
                <div class="p-info-box">
                    <span class="p-name">${p.name}</span>
                    <div class="p-lvl-badge">NV. ${p.level.toFixed(1)}</div>
                </div>
                ${canEdit && idx > 0 ? `<button class="slot-remove-btn" onclick="event.stopPropagation(); executeMatchAction('remove', '${mid}', '${col}', {idx:${idx}})"><i class="fas fa-times-circle"></i></button>` : ''}
                <div class="slot-pulse"></div>
            </div>
        `;
    }

    return `
        <div class="player-slot-court empty" 
             onclick="${canEdit ? `window.openPlayerSelector('${mid}', '${col}', {idx:${idx}})` : ''}"
             style="--slot-border: rgba(255,255,255,0.1)">
            <div class="p-avatar-add">
                <i class="fas fa-plus"></i>
            </div>
            <span class="p-add-label">AÑADIR JUGADOR</span>
        </div>
    `;
}


function renderMatchActions(m, isParticipant, isCreator, uid, id, col) {
    const isPlayed = m.estado === 'jugado';
    if (isPlayed) return `<button class="btn-primary w-full py-4 font-black" onclick="window.location.href='diario.html?matchId=${id}'">VER FICHA TÉCNICA</button>`;

    if (!isParticipant) {
        return `<button class="btn-primary w-full py-5 font-black text-lg" onclick="executeMatchAction('join', '${id}', '${col}')">
            <i class="fas fa-hand-fist mr-2"></i> UNIRSE AL PARTIDO
        </button>`;
    }

    return `
        <div class="flex-row gap-2 w-full">
            <button class="btn-icon-glass py-4 flex-1 text-xs font-black uppercase tracking-widest" onclick="executeMatchAction('leave', '${id}', '${col}')">Abandonar</button>
            ${isCreator ? `<button class="btn-icon-glass py-4 flex-1 text-xs font-black uppercase tracking-widest text-red-500 border-red-500/20" onclick="executeMatchAction('delete', '${id}', '${col}')">Cancelar</button>` : ''}
        </div>
        ${m.jugadores?.length === 4 ? `<button class="btn-primary w-full mt-3 py-4 font-black" onclick="openResultForm('${id}', '${col}')">ANOTAR RESULTADO FINAL</button>` : ''}
    `;
}

// Logic implementations...
window.executeCreateMatch = async (dateStr, hour) => {
    const min = parseFloat(document.getElementById('inp-min-lvl').value);
    const max = parseFloat(document.getElementById('inp-max-lvl').value);
    const type = window._creationType || 'amistoso';
    const bet = type === 'reto' ? parseInt(document.getElementById('inp-bet').value || 0) : 0;
    const col = type === 'reto' ? 'partidosReto' : 'partidosAmistosos';
    
    const jugs = (window._initialJugadores || [auth.currentUser.uid]).filter(id => id !== null);
    const matchDate = new Date(`${dateStr}T${hour}`);
    
    try {
        const docRef = await addDoc(collection(db, col), {
            creador: auth.currentUser.uid,
            fecha: matchDate,
            jugadores: jugs,
            restriccionNivel: { min, max },
            familyPointsBet: bet,
            estado: 'abierto',
            timestamp: serverTimestamp()
        });

        // Notify added players (except creator)
        const others = jugs.filter(id => id !== auth.currentUser.uid && !id.startsWith('GUEST_'));
        if (others.length > 0) {
            await createNotification(others, "¡Te han añadido!", `Te han incluido en un partido el ${matchDate.toLocaleDateString()}`, 'match_join', 'calendario.html');
        }

        showToast("¡HECHO!", "Reserva confirmada con éxito", "success");
        closeMatchModal();
    } catch(e) {
        showToast("ERROR", "No se pudo crear el partido", "error");
    }
};

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
            if (jugs.length >= 4) return showToast("COMPLETO", "No quedan plazas", "warning");
            const d = await getDoc(doc(db, "usuarios", user.uid));
            const uLvl = d.data().nivel || 2.5;
            if (uLvl < m.restriccionNivel.min || uLvl > m.restriccionNivel.max) return showToast("NIVEL", "No cumples el requisito de este partido", "warning");
            
            jugs.push(user.uid);
            await updateDoc(ref, { jugadores: jugs });

            // Notify creator
            await createNotification(m.creador, "Nuevo Rival/Compañero", `${d.data().nombreUsuario || 'Alguien'} se ha unido a tu partido`, 'match_join', 'calendario.html');
            
            showToast("UNIDO", "Ya estás en la pista", "success");
        } 
        else if (action === 'leave') {
            jugs = jugs.filter(uid => uid !== user.uid);
            if (jugs.length === 0) {
                await deleteDoc(ref);
            } else {
                await updateDoc(ref, { jugadores: jugs, creador: jugs[0] });
                // Notify remaining players
                const others = jugs.filter(uid => !uid.startsWith('GUEST_'));
                await createNotification(others, "Baja en el partido", `Un jugador ha abandonado el partido del ${matchDate.toLocaleTimeString()}`, 'warning', 'calendario.html');
            }
            showToast("SALIDO", "Has dejado el partido", "info");
        }
        else if (action === 'delete') {
            if (confirm("¿Borrar reserva?")) {
                const others = jugs.filter(uid => uid !== user.uid && !uid.startsWith('GUEST_'));
                await createNotification(others, "Partido Cancelado", `El partido del ${matchDate.toLocaleDateString()} ha sido anulado`, 'warning', 'calendario.html');
                await deleteDoc(ref); 
                showToast("ELIMINADO", "Reserva cancelada", "warning"); 
            }
        }
        else if (action === 'remove') {
            const removedUid = jugs[extra.idx];
            jugs.splice(extra.idx, 1);
            await updateDoc(ref, { jugadores: jugs });
            if (removedUid && !removedUid.startsWith('GUEST_')) {
                await createNotification(removedUid, "Te han eliminado", `Has sido retirado del partido del ${matchDate.toLocaleTimeString()}`, 'warning');
            }
        }
        else if (action === 'add') {
             jugs.push(extra.uid);
             await updateDoc(ref, { jugadores: jugs });
             if (!extra.uid.startsWith('GUEST_')) {
                await createNotification(extra.uid, "¡Te han añadido!", `Te han incluido en un partido el ${matchDate.toLocaleDateString()}`, 'match_join', 'calendario.html');
             }
        }
    } catch(e) { showToast("ERROR", "Acción fallida", "error"); }
};


async function initMatchChat(id, col) {
    const box = document.getElementById('match-chat-msgs');
    if (!box) return;
    const q = query(collection(db, col, id, 'chat'), orderBy('timestamp', 'asc'), limit(30));
    onSnapshot(q, async (snap) => {
        const msgs = await Promise.all(snap.docs.map(async d => {
            const data = d.data();
            const sender = await getPlayerName(data.uid);
            const isMe = data.uid === auth.currentUser.uid;
            return `
                <div class="chat-msg-row ${isMe ? 'mine' : 'theirs'} animate-fade-in">
                    <div class="flex-row gap-1 mb-0.5">
                         <span class="text-[8px] font-black uppercase ${isMe ? 'text-primary' : 'text-scnd'}">${sender}</span>
                    </div>
                    <div class="chat-bubble">
                        ${data.text}
                    </div>
                </div>
            `;
        }));
        box.innerHTML = msgs.length > 0 ? msgs.join('') : '<div class="center opacity-20 text-[10px] py-10">Sin mensajes aún</div>';
        box.scrollTop = box.scrollHeight;
    });
}

window.sendMatchChat = async (id, col) => {
    const inp = document.getElementById('match-chat-in');
    const text = inp.value.trim();
    if (!text) return;
    await addDoc(collection(db, col, id, 'chat'), { uid: auth.currentUser.uid, text, timestamp: serverTimestamp() });
    inp.value = '';
};

async function getPlayerName(uid) {
    if (!uid) return 'Anon';
    if (uid.startsWith('GUEST_')) return uid.split('_')[1];
    const d = await getDocument('usuarios', uid);
    return d?.nombreUsuario || d?.nombre || 'Jugador';
}

window.closeMatchModal = () => document.getElementById('modal-match').classList.remove('active');

window.openResultForm = (id, col) => {
    const overlay = document.getElementById('modal-match');
    const area = document.getElementById('match-detail-area');
    overlay.classList.add('active');
    area.innerHTML = `
        <div class="p-4 animate-up">
            <h3 class="font-black text-white text-xl mb-6">ANOTAR RESULTADO</h3>
            <div class="flex-col gap-4 mb-8">
                ${[1, 2, 3].map(i => `
                    <div class="flex-row between items-center bg-white/5 p-3 rounded-xl border border-white/10" id="set-row-${i}">
                        <span class="text-[10px] font-black text-scnd">SET ${i}</span>
                        <div class="flex-row gap-2">
                             <input type="number" id="s${i}-1" class="sport-input w-12 p-2 text-center font-black" placeholder="0" onchange="checkSets()">
                             <input type="number" id="s${i}-2" class="sport-input w-12 p-2 text-center font-black" placeholder="0" onchange="checkSets()">
                        </div>
                    </div>
                `).join('')}
            </div>
            <button class="btn-primary w-full py-4 font-black" id="btn-save-res">GUARDAR RESULTADO</button>
        </div>
    `;

    window.checkSets = () => {
        const s1_1 = parseInt(document.getElementById('s1-1').value) || 0;
        const s1_2 = parseInt(document.getElementById('s1-2').value) || 0;
        const s2_1 = parseInt(document.getElementById('s2-1').value) || 0;
        const s2_2 = parseInt(document.getElementById('s2-2').value) || 0;

        const w1 = s1_1 > s1_2 ? 1 : (s1_2 > s1_1 ? 2 : 0);
        const w2 = s2_1 > s2_2 ? 1 : (s2_2 > s2_1 ? 2 : 0);

        if (w1 !== 0 && w1 === w2) {
            // Same winner twice = 2-0
            document.getElementById('set-row-3').style.opacity = '0.3';
            document.getElementById('set-row-3').style.pointerEvents = 'none';
            document.getElementById('s3-1').value = '';
            document.getElementById('s3-2').value = '';
        } else {
            document.getElementById('set-row-3').style.opacity = '1';
            document.getElementById('set-row-3').style.pointerEvents = 'auto';
        }
    };

    document.getElementById('btn-save-res').onclick = async () => {
        const res = [];
        for(let i=1; i<=3; i++){
            const v1 = document.getElementById(`s${i}-1`).value;
            const v2 = document.getElementById(`s${i}-2`).value;
            if(v1 !== '' && v2 !== '') res.push(`${v1}-${v2}`);
        }
        
        if (res.length < 2) return showToast("Error", "Mínimo 2 sets", "warning");

        await updateDoc(doc(db, col, id), { resultado: { sets: res.join(' ') }, estado: 'jugado' });
        showToast("ÉXITO", "Resultado registrado", "success");
        closeMatchModal();
    };
};

window.openPlayerSelector = async (mid, col, extra = {}) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active z-[1000]';
    overlay.innerHTML = `
        <div class="modal-sheet">
            <div class="flex-row between mb-6">
                <h3 class="font-black text-white">AÑADIR JUGADOR</h3>
                <button class="nav-arrow" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
            </div>
            <div class="flex-col gap-4 max-h-[60vh] overflow-y-auto" id="player-list-area">
                <div class="center py-10"><div class="spinner-galaxy"></div></div>
            </div>
            <div class="h-px bg-white/5 my-4"></div>
            <div class="flex-col gap-3">
                <span class="text-[10px] font-black text-scnd uppercase">Añadir Invitado (Externo)</span>
                <div class="flex-row gap-2">
                    <input type="text" id="guest-name" class="sport-input p-2 flex-1" placeholder="Nombre Invitado">
                    <input type="number" id="guest-lvl" class="sport-input p-2 w-16" value="2.5" step="0.1">
                    <button class="btn-primary p-2 w-10" onclick="addGuest('${mid}','${col}',${extra.idx})"><i class="fas fa-plus"></i></button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const users = await getDocs(query(collection(db, "usuarios"), orderBy("nombreUsuario", "asc")));
    const list = document.getElementById('player-list-area');
    list.innerHTML = users.docs.map(d => {
        const u = d.data();
        const photo = u.fotoPerfil || u.fotoURL || './imagenes/default-avatar.png';
        return `
            <div class="u-item-list" 
                 onclick="selectPlayer('${mid}','${col}','${d.id}','${u.nombreUsuario || u.nombre}',${extra.idx})">
                <div class="flex-row gap-3 items-center">
                    <img src="${photo}" class="u-avatar-list">
                    <div class="flex-col text-left">
                        <span class="text-xs font-bold text-white">${u.nombreUsuario || u.nombre}</span>
                        <span class="text-[8px] text-scnd font-black">NV. ${(u.nivel || 2.5).toFixed(1)}</span>
                    </div>
                </div>
                <i class="fas fa-plus-circle text-sport-blue"></i>
            </div>
        `;
    }).join('');


    window.selectPlayer = async (m, c, uid, name, idx) => {
        if (m === 'NEW') {
            window._initialJugadores[idx] = uid;
            const wrap = document.getElementById(`slot-${idx}-wrap`);
            if (wrap) {
                const pData = await getPlayerData(uid);
                wrap.innerHTML = renderPlayerSlot(pData, idx, true, null, null);
            }
            overlay.remove();
        } else {
            await executeMatchAction('add', m, c, { uid });
            overlay.remove();
        }
    };

    window.addGuest = async (m, c, idx) => {
        const name = document.getElementById('guest-name').value.trim();
        const lvl = document.getElementById('guest-lvl').value;
        if (!name) return;
        const guestId = `GUEST_${name}_${lvl}_${Date.now()}`;
        if (m === 'NEW') {
            window._initialJugadores[idx] = guestId;
            const wrap = document.getElementById(`slot-${idx}-wrap`);
            if (wrap) {
                const pData = await getPlayerData(guestId);
                wrap.innerHTML = renderPlayerSlot(pData, idx, true, null, null);
            }
            overlay.remove();
        } else {
            await executeMatchAction('add', m, c, { uid: guestId });
            overlay.remove();
        }
    };

};

