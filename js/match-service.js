// match-service.js - Premium Match Experience (v18.0)
import { db, getDocument, subscribeDoc, updateDocument, addDocument, auth } from './firebase-service.js';
import { doc, getDoc, getDocs, collection, deleteDoc, onSnapshot, query, orderBy, limit, addDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { showToast } from './ui-core.js';
import { createNotification } from './notifications-service.js';

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

        const creatorSnap = await getDoc(doc(db, "usuarios", m.creador));
        const cName = creatorSnap.exists() ? (creatorSnap.data().nombreUsuario || creatorSnap.data().nombre) : 'Jugador';

        container.innerHTML = `
            <div class="match-detail-content animate-up">
                <div class="flex-row between items-center mb-6">
                    <div class="flex-col">
                        <span class="status-badge ${isReto ? 'badge-green' : 'badge-blue'} mb-2">${isReto ? 'COMPETITIVO' : 'AMISTOSO'}</span>
                        <div class="text-2xl font-black text-white">${date.toLocaleTimeString('es-ES', {hour:'2-digit', minute:'2-digit'})}</div>
                        <div class="text-[10px] font-bold text-scnd uppercase tracking-widest">${date.toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'short'})}</div>
                        ${m.familyPointsBet ? `<span class="text-[9px] font-black text-yellow-400 mt-1"><i class="fas fa-coins mr-1"></i> ${m.familyPointsBet} FamilyPoints</span>` : ''}
                        <span class="text-[8px] text-scnd opacity-40 mt-1 font-black">RESERVA DE: ${cName.toUpperCase()}</span>
                    </div>
                    <button class="nav-arrow" onclick="closeMatchModal()"><i class="fas fa-times"></i></button>
                </div>


                <!-- Tennis Court VS -->
                <div class="tennis-court-container shadow-xl">
                    <div class="vs-badge-v2">VS</div>
                    <div class="court-team team-top">
                        ${renderPlayerSlot(players[0], 0, isCreator, matchId, col)}
                        ${renderPlayerSlot(players[1], 1, isCreator, matchId, col)}
                    </div>
                    <div class="court-team team-bottom">
                        ${renderPlayerSlot(players[2], 2, isCreator, matchId, col)}
                        ${renderPlayerSlot(players[3], 3, isCreator, matchId, col)}
                    </div>
                </div>


                ${isParticipant ? `
                    <div class="bg-white/5 rounded-2xl p-4 mb-6">
                         <div class="text-[10px] font-black text-sport-purple uppercase mb-3 flex-row between">
                            <span>Chat del Partido</span>
                            <i class="fas fa-comments"></i>
                         </div>
                         <div id="match-chat-msgs" class="max-h-[150px] overflow-y-auto mb-3 flex-col gap-2 text-xs"></div>
                         <div class="flex-row gap-2">
                            <input type="text" id="match-chat-in" class="sport-input py-2 text-xs" placeholder="Escribe algo...">
                            <button class="nav-arrow" onclick="sendMatchChat('${matchId}', '${col}')"><i class="fas fa-paper-plane text-xs"></i></button>
                         </div>
                    </div>
                ` : `
                    <div class="center flex-col py-6 bg-white/5 rounded-2xl mb-6 opacity-50 border border-white/5">
                        <i class="fas fa-lock mb-2"></i>
                        <span class="text-[9px] font-black uppercase text-center px-6">Chat exclusivo para participantes</span>
                    </div>
                `}

                <div class="match-actions-grid grid grid-cols-2 gap-3">
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
        <div class="match-creation-content animate-up p-2">
            <div class="flex-row between items-center mb-6">
                <div class="flex-col">
                    <span class="status-badge badge-blue mb-2">NUEVA RESERVA</span>
                    <div class="text-3xl font-black text-white">${hour}</div>
                    <div class="text-[10px] font-bold text-scnd uppercase tracking-widest">${date.toLocaleDateString('es-ES', {weekday:'long', day:'numeric', month:'short'})}</div>
                </div>
                <button class="nav-arrow" onclick="closeMatchModal()"><i class="fas fa-times"></i></button>
            </div>

            <div class="sport-card p-4 mb-6">
                <span class="text-label text-sport-blue mb-4 block">Tipo de Partido</span>
                <div class="grid grid-cols-2 gap-3 mb-6">
                    <button id="btn-type-amistoso" class="cat-btn active" onclick="setMatchType('amistoso')">🤝 AMISTOSO</button>
                    <button id="btn-type-reto" class="cat-btn" onclick="setMatchType('reto')">⚡ RETO</button>
                </div>

                <div id="reto-options" class="hidden mb-6 animate-up">
                    <span class="text-label text-yellow-400 mb-2 block">Apuesta de FamilyPoints</span>
                    <div class="flex-row gap-3 items-center bg-yellow-400/5 p-3 rounded-xl border border-yellow-400/10">
                        <i class="fas fa-coins text-yellow-400"></i>
                        <input type="number" id="inp-bet" value="0" min="0" step="10" class="sport-input p-2 flex-1 text-sm font-black text-yellow-500">
                    </div>
                </div>

                <span class="text-label text-sport-blue mb-2 block">Restricción de Nivel</span>
                <div class="flex-row gap-4 items-center bg-white/5 p-3 rounded-xl mb-6">
                    <div class="flex-col flex-1">
                        <span class="text-[8px] text-scnd font-black">MIN</span>
                        <input type="number" id="inp-min-lvl" step="0.1" value="2.0" class="sport-input p-2 text-center text-xs">
                    </div>
                    <div class="text-scnd opacity-30 mt-3">-</div>
                    <div class="flex-col flex-1">
                        <span class="text-[8px] text-scnd font-black">MAX</span>
                        <input type="number" id="inp-max-lvl" step="0.1" value="5.0" class="sport-input p-2 text-center text-xs">
                    </div>
                </div>

                <span class="text-label text-sport-blue mb-2 block">Configura la Pista</span>
                <div class="tennis-court-container mb-6" id="creation-court">
                    <div class="vs-badge-v2">VS</div>
                    <div class="court-team">
                        ${renderPlayerSlot({name: 'Tú', level: userData.nivel || 2.5, id: auth.currentUser.uid, photo: userData.fotoPerfil || userData.fotoURL}, 0, false, null, null)}
                        <div id="slot-1-wrap">${renderPlayerSlot(null, 1, true, null, null)}</div>
                    </div>
                    <div class="court-team">
                        <div id="slot-2-wrap">${renderPlayerSlot(null, 2, true, null, null)}</div>
                        <div id="slot-3-wrap">${renderPlayerSlot(null, 3, true, null, null)}</div>
                    </div>
                </div>



                <button class="btn-primary w-full py-4 font-black" onclick="executeCreateMatch('${dateStr}', '${hour}')">
                    CONFIRMAR RESERVA <i class="fas fa-check ml-2"></i>
                </button>
            </div>
            
            <p class="text-[9px] text-scnd text-center px-8 leading-tight">La reserva es gratuita. Una vez creada, otros jugadores podrán unirse según el nivel establecido.</p>
        </div>
    `;
    
    window._creationType = 'amistoso';
    window._initialJugadores = [currentUser.uid, null, null, null];

    window.setMatchType = (t) => {
        window._creationType = t;
        document.getElementById('btn-type-amistoso').classList.toggle('active', t === 'amistoso');
        document.getElementById('btn-type-reto').classList.toggle('active', t === 'reto');
        document.getElementById('reto-options').classList.toggle('hidden', t !== 'reto');
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
    if (p) {
        const photo = p.photo || p.fotoPerfil || p.fotoURL;
        return `
            <div class="player-slot-court filled" onclick="${mid && !p.id.startsWith('GUEST_') ? `window.viewProfile('${p.id}')` : ''}" style="position:relative">
                <div class="p-avatar">
                    ${photo ? `<img src="${photo}" style="width:100%; height:100%; object-fit:cover;">` : `<i class="fas fa-user text-xs text-blue-900/40"></i>`}
                </div>
                <span class="p-name">${p.name}</span>
                <span class="p-lvl">NV. ${p.level.toFixed(1)}</span>
                ${canEdit && idx > 0 ? `<button class="slot-remove-btn" onclick="event.stopPropagation(); executeMatchAction('remove', '${mid}', '${col}', {idx:${idx}})"><i class="fas fa-times"></i></button>` : ''}
            </div>
        `;
    }

    return `
        <div class="player-slot-court" onclick="${canEdit ? `window.openPlayerSelector('${mid}', '${col}', {idx:${idx}})` : ''}">
            <div class="p-avatar"><i class="fas fa-plus text-xs text-white/30"></i></div>
            <span class="p-name uppercase tracking-tighter" style="font-size: 0.5rem">Añadir</span>
        </div>
    `;
}


function renderMatchActions(m, isParticipant, isCreator, uid, id, col) {
    const isPlayed = m.estado === 'jugado';
    if (isPlayed) return `<button class="btn-primary col-span-2 py-3" onclick="window.location.href='diario.html?matchId=${id}'">VER EN DIARIO</button>`;

    if (!isParticipant) {
        return `<button class="btn-primary col-span-2 py-4" onclick="executeMatchAction('join', '${id}', '${col}')">UNIRSE AHORA</button>`;
    }

    return `
        <button class="btn-ghost py-3 text-xs font-bold border border-white/10" onclick="executeMatchAction('leave', '${id}', '${col}')">SALIR</button>
        ${isCreator ? `<button class="btn-ghost py-3 text-xs font-bold border border-red-500/20 text-red-500" onclick="executeMatchAction('delete', '${id}', '${col}')">ELIMINAR</button>` : ''}
        ${m.jugadores?.length === 4 ? `<button class="btn-primary col-span-2 mt-2 py-3" onclick="openResultForm('${id}', '${col}')">ANOTAR RESULTADO</button>` : ''}
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
            return `<div class="p-1"><span class="font-black ${isMe ? 'text-sport-blue' : 'text-scnd'} mr-1">${sender}:</span> ${data.text}</div>`;
        }));
        box.innerHTML = msgs.join('');
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
        const s1_1 = parseInt(document.getElementById('s1-1').value || 0);
        const s1_2 = parseInt(document.getElementById('s1-2').value || 0);
        const s2_1 = parseInt(document.getElementById('s2-1').value || 0);
        const s2_2 = parseInt(document.getElementById('s2-2').value || 0);

        const t1 = (s1_1 > s1_2 ? 1 : 0) + (s2_1 > s2_2 ? 1 : 0);
        const t2 = (s1_2 > s1_1 ? 1 : 0) + (s2_2 > s2_1 ? 1 : 0);

        if (t1 === 2 || t2 === 2) {
            document.getElementById('set-row-3').style.opacity = '0.3';
            document.getElementById('s3-1').disabled = true;
            document.getElementById('s3-2').disabled = true;
            document.getElementById('s3-1').value = '0';
            document.getElementById('s3-2').value = '0';
        } else {
            document.getElementById('set-row-3').style.opacity = '1';
            document.getElementById('s3-1').disabled = false;
            document.getElementById('s3-2').disabled = false;
        }
    };

    document.getElementById('btn-save-res').onclick = async () => {
        const res = [1, 2, 3].map(i => `${document.getElementById(`s${i}-1`).value || 0}-${document.getElementById(`s${i}-2`).value || 0}`).join(' ');
        await updateDoc(doc(db, col, id), { resultado: { sets: res }, estado: 'jugado' });
        showToast("ÉXITO", "Resultado registrado en el circuito", "success");
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

