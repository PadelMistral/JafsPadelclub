// evento-detalle.js â€” Vista detallada del evento con panel organizador completo y modal para aÃ±adir jugador
import { db, auth, observerAuth, getDocument } from './firebase-service.js';
import { initAppUI, showToast, showSidePreferenceModal } from './ui-core.js';
import { doc, onSnapshot, collection, query, where, updateDoc, deleteDoc, getDocs, serverTimestamp, addDoc, arrayUnion, arrayRemove, increment, writeBatch, getDoc } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { injectHeader, injectNavbar } from './modules/ui-loader.js';
import { computeGroupTable, generateKnockoutTree, generateRoundRobin } from './event-tournament-engine.js';
import { processMatchResults } from './ranking-service.js';
import { openResultForm, renderMatchDetail, indexEventUserNames } from './match-service.js';

initAppUI('event-detail');

const eventId = new URLSearchParams(window.location.search).get('id');
const requestedTab = new URLSearchParams(window.location.search).get('tab');
let currentUser = null;
let currentUserData = null;
let currentEvent = null;
let eventMatches = [];
let unsubMatches = null;
let myTeam = null;
let registeredUsers = [];
let registeredUsersById = new Map();

// Mapa de formatos para mostrar etiquetas amigables
const formatLabels = {
    league: 'Liga',
    knockout: 'Eliminatoria',
    league_knockout: 'Liga + Eliminatoria'
};

const getInitials = (name) => {
    if (!name) return 'JP';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
};


if (!eventId) window.location.replace('eventos.html');

document.addEventListener('DOMContentLoaded', () => {
    observerAuth(async (user) => {
        if (!user) return window.location.replace('index.html');
        currentUser = user;
        currentUserData = await getDocument('usuarios', user.uid);
        await injectHeader(currentUserData || {});
        injectNavbar('events');
        bindTabs();
        subscribeEvent();
        subscribeMatches();
        if (requestedTab) setTimeout(() => document.querySelector(`.ed-tab[data-tab="${requestedTab}"]`)?.click(), 200);

        await loadRegisteredUsers();
        setupAddPlayerModal();
    });
});

async function loadRegisteredUsers() {
    try {
        const snapshot = await getDocs(collection(db, 'usuarios'));
        registeredUsers = snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
        registeredUsersById = new Map(registeredUsers.map(u => [u.uid, u]));
    } catch (e) {
        console.error('Error cargando usuarios:', e);
    }
}

function resolveParticipantData(p) {
    if (!p) return { uid: '', name: 'Jugador', level: 2.5, photo: '' };
    
    // Normalize p if it is a string
    const uid = (typeof p === 'string') ? p : (p.uid || '');
    const data = (typeof p === 'object') ? p : {};
    
    const sUid = String(uid);
    const isGuest = data.invitado === true || 
                    data.manual === true || 
                    sUid.startsWith('GUEST_') || 
                    sUid.startsWith('invitado_') || 
                    sUid.startsWith('manual_');

    if (isGuest) {
        let name = data.nombre || data.nombreUsuario || '';
        if (!name && sUid.startsWith('GUEST_')) {
             name = sUid.split('_')[1]?.replace(/_/g, ' ');
        }
        return {
            uid: sUid,
            name: name || sUid || 'Invitado',
            level: Number(data.nivel || sUid.split('_')[2] || 2.5),
            photo: data.fotoPerfil || data.fotoURL || './imagenes/Logojafs.png'
        };
    }

    if (registeredUsersById.has(uid)) {
        const u = registeredUsersById.get(uid);
        return {
            uid,
            name: u.nombreUsuario || u.nombre || u.email || uid,
            level: Number(u.nivel || 2.5),
            photo: u.fotoPerfil || u.fotoURL || u.photoURL || ''
        };
    }

    return {
        uid,
        name: data.nombre || data.nombreUsuario || uid || 'Jugador',
        level: Number(data.nivel || 2.5),
        photo: data.fotoPerfil || data.fotoURL || ''
    };
}

function setupAddPlayerModal() {
    const typeSelect = document.getElementById('add-player-type-detalle');
    const registeredDiv = document.getElementById('registered-player-select-detalle');
    const guestDiv = document.getElementById('guest-player-input-detalle');
    const selectUser = document.getElementById('select-registered-user-detalle');

    if (!typeSelect) return;

    if (registeredUsers.length) {
        selectUser.innerHTML = '<option value="">Selecciona un usuario</option>' +
            registeredUsers.map(u => `<option value="${u.uid}">${u.nombreUsuario || u.nombre || u.email}</option>`).join('');
    } else {
        selectUser.innerHTML = '<option value="">No hay usuarios registrados</option>';
    }

    typeSelect.addEventListener('change', () => {
        if (typeSelect.value === 'registered') {
            registeredDiv.classList.remove('hidden');
            guestDiv.classList.add('hidden');
        } else {
            registeredDiv.classList.add('hidden');
            guestDiv.classList.remove('hidden');
        }
    });

    document.getElementById('btn-confirm-add-player-detalle').addEventListener('click', () => {
        const type = typeSelect.value;
        const preference = document.getElementById('player-preference-detalle').value;
        const pairCode = document.getElementById('player-pair-code-detalle').value.trim();
        const level = parseFloat(document.getElementById('player-level-detalle').value) || 2.5;

        if (type === 'registered') {
            const selectedUid = selectUser.value;
            if (!selectedUid) {
                showToast('Debes seleccionar un usuario', 'warning');
                return;
            }
            const user = registeredUsers.find(u => u.uid === selectedUid);
            addPlayerToEvent({
                uid: user.uid,
                nombre: user.nombreUsuario || user.nombre || 'Jugador',
                nivel: user.nivel || level,
                sidePreference: preference,
                pairCode,
                inscritoEn: new Date().toISOString(),
                manual: true,
                invitado: false,
                aprobado: true
            });
        } else {
            const nombre = document.getElementById('guest-name-detalle').value.trim();
            if (!nombre) {
                showToast('Debes introducir un nombre para el invitado', 'warning');
                return;
            }
            addPlayerToEvent({
                uid: `invitado_${Date.now()}`,
                nombre,
                nivel: level,
                sidePreference: preference,
                pairCode,
                inscritoEn: new Date().toISOString(),
                manual: true,
                invitado: true,
                aprobado: true
            });
        }
    });
}

async function addPlayerToEvent(playerData) {
    if (!canOrganizar()) return showToast('Sin permisos', 'Solo organizador/admin puede aÃ±adir', 'error');
    const ev = currentEvent;
    if (!ev) return;
    if ((ev.inscritos || []).some(i => i.uid === playerData.uid)) {
        return showToast('Duplicado', 'Ese jugador ya estÃ¡ inscrito', 'warning');
    }
    try {
        await updateDoc(doc(db, 'eventos', eventId), {
            inscritos: arrayUnion(playerData)
        });
        showToast('Jugador aÃ±adido', playerData.nombre, 'success');
        document.getElementById('modal-add-player-detalle').classList.remove('active');
        document.getElementById('guest-name-detalle').value = '';
        document.getElementById('player-pair-code-detalle').value = '';
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
}

function getApprovedInscritos() {
    const ev = currentEvent;
    return (ev?.inscritos || []).filter(i => i.aprobado === true);
}

window.openAddPlayerModalED = () => {
    document.getElementById('modal-add-player-detalle')?.classList.add('active');
};

window.openAddTeamModalED = () => {
    if (!canOrganizar()) return;
    const ev = currentEvent;
    if (!ev) return;
    const pool = getApprovedInscritos().map((p) => resolveParticipantData(p));
    const used = new Set((ev.teams || []).flatMap(t => t.playerUids || []));

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active modal-stack-front';
    overlay.innerHTML = `
        <div class="modal-card glass-strong" style="max-width:460px;">
            <div class="modal-header">
                <h3 class="modal-title">Crear equipo</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="flex-col gap-3">
                    <label class="text-[10px] font-black text-muted uppercase tracking-widest">Nombre del equipo</label>
                    <input id="new-team-name" class="input" placeholder="Equipo A">
                    <label class="text-[10px] font-black text-muted uppercase tracking-widest mt-2">Jugador 1</label>
                    <select id="new-team-p1" class="input">
                        ${pool.map(p => `<option value="${p.uid}" ${used.has(p.uid) ? 'disabled' : ''}>${escapeHtml(p.name)}${used.has(p.uid) ? ' (ocupado)' : ''}</option>`).join('')}
                    </select>
                    <label class="text-[10px] font-black text-muted uppercase tracking-widest mt-2">Jugador 2</label>
                    <select id="new-team-p2" class="input">
                        ${pool.map(p => `<option value="${p.uid}" ${used.has(p.uid) ? 'disabled' : ''}>${escapeHtml(p.name)}${used.has(p.uid) ? ' (ocupado)' : ''}</option>`).join('')}
                    </select>
                </div>
                <div class="flex-row gap-2 mt-4">
                    <button class="btn btn-ghost w-full" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn btn-primary w-full" onclick="window.saveNewTeamED()">Crear</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
};

window.saveNewTeamED = async () => {
    const ev = currentEvent;
    if (!ev) return;
    const p1 = document.getElementById('new-team-p1')?.value || '';
    const p2 = document.getElementById('new-team-p2')?.value || '';
    if (!p1 || !p2 || p1 === p2) return showToast('Equipo invÃ¡lido', 'Selecciona dos jugadores distintos', 'warning');
    const used = new Set((ev.teams || []).flatMap(t => t.playerUids || []));
    if (used.has(p1) || used.has(p2)) return showToast('Jugador en otro equipo', 'No puedes duplicar jugadores', 'warning');
    const name = document.getElementById('new-team-name')?.value?.trim() || `Equipo ${String((ev.teams || []).length + 1).padStart(2, '0')}`;
    const id = `team_${Date.now()}`;
    const newTeam = { id, name, playerUids: [p1, p2] };
    try {
        await updateDoc(doc(db, 'eventos', eventId), { teams: [...(ev.teams || []), newTeam], updatedAt: serverTimestamp() });
        showToast('Equipo creado', name, 'success');
        document.querySelectorAll('.modal-overlay').forEach(o => o.classList.contains('modal-stack-front') && o.remove());
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

function canOrganizar() {
    return currentUserData?.rol === 'Admin' ||
        currentEvent?.organizadorId === currentUser?.uid ||
        (currentEvent?.coorganizadores || []).includes(currentUser?.uid);
}

function isInscribed() {
    return (currentEvent?.inscritos || []).some(i => i.uid === currentUser?.uid && i.aprobado === true);
}

function isPending() {
    return (currentEvent?.inscritos || []).some(i => i.uid === currentUser?.uid && i.aprobado !== true);
}

function subscribeEvent() {
    onSnapshot(doc(db, 'eventos', eventId), (s) => {
        if (!s.exists()) return window.location.replace('eventos.html');
        currentEvent = { id: s.id, ...s.data() };
        indexEventUserNames(currentEvent);
        if (isInscribed()) {
            const teams = currentEvent.teams || [];
            myTeam = teams.find(t => t.playerUids?.includes(currentUser.uid));
            if (myTeam && !myTeam.playerNames && currentEvent.inscritos) {
                myTeam.playerNames = myTeam.playerUids.map(uid => {
                    const ins = currentEvent.inscritos.find(i => i.uid === uid);
                    return ins?.nombre || uid;
                });
            }
            // Personal preference: default to my matches if inscribed
            if (!window._filterInitDone) {
                window._matchFilter = 'mis-partidos';
                window._filterInitDone = true;
            }
        }
        renderPage();
    });
}

function subscribeMatches() {
    if (unsubMatches) unsubMatches();
    unsubMatches = onSnapshot(query(collection(db, 'eventoPartidos'), where('eventoId', '==', eventId)), (s) => {
        eventMatches = s.docs.map(d => ({ id: d.id, ...d.data() }));
        renderPane(document.querySelector('.ed-tab.active')?.dataset.tab || 'info');
    });
}

function bindTabs() {
    document.querySelectorAll('.ed-tab').forEach(b => {
        b.onclick = () => {
            const tab = b.dataset.tab;
            if (tab === 'organizador' && !canOrganizar()) return;
            document.querySelectorAll('.ed-tab').forEach(x => x.classList.remove('active'));
            document.querySelectorAll('.ed-pane').forEach(x => x.classList.add('hidden'));
            b.classList.add('active');
            document.getElementById(`pane-${tab}`)?.classList.remove('hidden');
            renderPane(tab);
        };
    });
    if (canOrganizar()) document.getElementById('organizador-tab').style.display = 'block';
}

function renderPage() {
    const ev = currentEvent || {};
    document.getElementById('ed-hero-content').innerHTML = `
        <div class="ed-badge ${ev.formato === 'knockout' ? 'knockout' : 'league'}">
            <i class="fas fa-trophy"></i> ${formatLabels[ev.formato] || 'Evento'}
        </div>
        <h1 class="ed-title">${ev.nombre || 'Evento'}</h1>
        <div class="ed-organizer">Organiza: ${ev.organizadorNombre || 'Club'}</div>
    `;

    const aprobados = (ev.inscritos || []).filter(i => i.aprobado === true).length;
    const pendientes = (ev.inscritos || []).filter(i => i.aprobado !== true).length;
    const teams = (ev.teams || []).length;
    document.getElementById('ed-stats-strip').innerHTML = `
        <div class="ed-stat-box"><span class="ed-stat-val">${aprobados}/${Number(ev.plazasMax || 16)}</span><span class="ed-stat-lbl">Aprobados</span></div>
        <div class="ed-stat-box"><span class="ed-stat-val">${pendientes}</span><span class="ed-stat-lbl">Pendientes</span></div>
        <div class="ed-stat-box"><span class="ed-stat-val">${teams}</span><span class="ed-stat-lbl">Equipos</span></div>
        <div class="ed-stat-box"><span class="ed-stat-val">${String(ev.estado || 'draft').toUpperCase()}</span><span class="ed-stat-lbl">Estado</span></div>
    `;

    renderActionBar();
    renderPane(document.querySelector('.ed-tab.active')?.dataset.tab || 'info');
}

function renderPane(tab) {
    const pane = document.getElementById(`pane-${tab}`);
    if (!pane || !currentEvent) return;
    if (tab === 'info') renderInfo(pane);
    else if (tab === 'participantes') renderParticipantes(pane);
    else if (tab === 'clasificacion') renderClasificacion(pane);
    else if (tab === 'partidos') renderMatches(pane);
    else if (tab === 'bracket') renderBracket(pane);
    else if (tab === 'organizador') renderOrganizador(pane);
}

function renderInfo(pane) {
    const ev = currentEvent;
    
    let statusCardHtml = '';
    if (myTeam) {
        const myGroup = Object.entries(ev.groups || {}).find(([g, ids]) => ids.includes(myTeam.id))?.[0];
        let posText = 'Calculando...';
        let posVal = '';
        let table = [];
        
        if (myGroup) {
             const groupMatches = eventMatches.filter(m => m.phase === 'group' && m.group === myGroup);
             const groupTeams = (ev.teams || []).filter(t => (ev.groups[myGroup] || []).includes(t.id));
             table = computeGroupTable(groupMatches, groupTeams, {win: ev.puntosVictoria || 3, draw: ev.puntosEmpate || 1, loss: ev.puntosDerrota || 0});
             const idx = table.findIndex(r => r.teamId === myTeam.id);
             if (idx !== -1) {
                posVal = `${idx + 1}Âº`;
                posText = `De ${table.length} equipos en Grupo ${myGroup}`;
             }
        }

        const myStats = table.find(r => r.teamId === myTeam.id);
        const pts = myStats ? myStats.pts : 0;
        const played = myStats ? myStats.pj : 0;
        const won = myStats ? myStats.pg : 0;

        statusCardHtml = `
            <div class="user-ev-status-v9 animate-up">
                <div class="ue-glow"></div>
                <div class="ue-icon"><i class="fas fa-trophy"></i></div>
                <div class="ue-body">
                    <div class="flex-row between items-center mb-1">
                        <span class="text-[9px] text-primary font-black uppercase tracking-[2px]">EvoluciÃ³n en Directo</span>
                        <div class="px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20">
                            <span class="text-[10px] text-primary font-black">${pts} <small>PTS</small></span>
                        </div>
                    </div>
                    <h4 class="text-white font-black text-lg tracking-tight">${escapeHtml(myTeam.name)}</h4>
                    <div class="flex-row gap-3 mt-1">
                        <div class="flex-col">
                            <span class="text-[8px] opacity-40 uppercase font-black">PosiciÃ³n</span>
                            <span class="text-[12px] text-white font-bold">${posVal || '-'}</span>
                        </div>
                        <div class="w-px h-6 bg-white/10"></div>
                        <div class="flex-col">
                            <span class="text-[8px] opacity-40 uppercase font-black">Jugados</span>
                            <span class="text-[12px] text-white font-bold">${played}</span>
                        </div>
                         <div class="w-px h-6 bg-white/10"></div>
                        <div class="flex-col">
                            <span class="text-[8px] opacity-40 uppercase font-black">Victorias</span>
                            <span class="text-[12px] text-sport-green font-bold">${won}</span>
                        </div>
                    </div>
                    <p class="text-[10px] text-white/40 font-medium mt-3 italic">${posText}</p>
                </div>
                ${posVal ? `<div class="ue-stat-pill"><span>${posVal}</span></div>` : ''}
            </div>
        `;

    }

    // Enlace a sorteo visible solo si evento activo y usuario aprobado u organizador
    const puedeVerSorteo = (ev.estado === 'activo' && (isInscribed() || canOrganizar())) || canOrganizar();
    const sorteoLink = puedeVerSorteo
        ? `<a class="btn-ed-primary w-full justify-center mt-4" href="evento-sorteo.html?id=${ev.id}"><i class="fas fa-dice"></i> Ver Cuadro / Sorteo</a>`
        : (ev.estado === 'inscripcion' && isPending() ? `<div class="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-500 text-[11px] font-bold text-center mt-4">InscripciÃ³n pendiente de aprobaciÃ³n</div>` : '');

    pane.innerHTML = `
        <div class="ed-info-card border-none bg-transparent p-0">
            ${statusCardHtml}
            
            <div class="ed-info-card">
                <h3 class="ed-info-title"><i class="fas fa-circle-info"></i> Detalles del evento</h3>
                <p class="ed-info-text mb-6 text-[11px] leading-relaxed opacity-70">${ev.descripcion || 'Sin descripciÃ³n.'}</p>
                <div class="ed-info-grid">
                    <div class="ed-info-item"><i class="fas fa-calendar"></i><div><span class="ed-info-label">Inicio</span><span class="ed-info-val">${fmtDate(ev.fechaInicio)}</span></div></div>
                    <div class="ed-info-item"><i class="fas fa-hourglass-half"></i><div><span class="ed-info-label">Cierre inscripciÃ³n</span><span class="ed-info-val">${fmtDate(ev.fechaInscripcion)}</span></div></div>
                    <div class="ed-info-item"><i class="fas fa-user-group"></i><div><span class="ed-info-label">Modalidad</span><span class="ed-info-val">${ev.modalidad || 'parejas'}</span></div></div>
                    <div class="ed-info-item"><i class="fas fa-diagram-project"></i><div><span class="ed-info-label">Formato</span><span class="ed-info-val">${formatLabels[ev.formato] || ev.formato}</span></div></div>
                    ${ev.repesca ? '<div class="ed-info-item"><i class="fas fa-rotate-left"></i><div><span class="ed-info-label">Repesca</span><span class="ed-info-val">SÃ­</span></div></div>' : ''}
                    ${ev.equiposPorGrupo ? `<div class="ed-info-item"><i class="fas fa-arrow-right"></i><div><span class="ed-info-label">Clasifican</span><span class="ed-info-val">${ev.equiposPorGrupo} por grupo</span></div></div>` : ''}
                </div>
                ${sorteoLink}
            </div>
        </div>`;
}


function renderParticipantes(pane) {
    const ev = currentEvent;
    const inscritos = ev.inscritos || [];
    const aprobados = inscritos.filter(i => i.aprobado === true);
    const pendientes = inscritos.filter(i => i.aprobado !== true);

    const renderCard = (p, isPending = false) => {
        const info = resolveParticipantData(p);
        const uid = p?.uid || p;
        return `
            <div class="p-card-v9 ${isPending ? 'pending' : ''}">
                <div class="p-card-status"></div>
                <div class="p-card-avatar">
                    ${info.photo ? `<img src="${info.photo}" class="w-full h-full object-cover rounded-full">` : `<div class="p-card-initials">${getInitials(info.name)}</div>`}
                </div>
                <span class="p-card-name">${escapeHtml(info.name)}</span>
                <span class="p-card-level">LVL ${Number(info.level || 2.5).toFixed(1)}</span>
                ${canOrganizar() ? `
                    <div class="flex-row gap-2 mt-2">
                        ${isPending ? `<button class="btn-aprobar-v9" onclick="window.aprobarJugador('${eventId}','${uid}')"><i class="fas fa-check"></i></button>` : ''}
                        <button class="btn-expulsar-v9" onclick="window.expulsarJugador('${eventId}','${uid}')"><i class="fas fa-user-slash"></i></button>
                    </div>
                ` : ''}
            </div>
        `;
    };

    let html = `
        <div class="ed-info-card bg-transparent border-none p-0">
            <h3 class="ed-info-title mb-4"><i class="fas fa-users"></i> Guerreros Confirmados (${aprobados.length})</h3>
            <div class="participant-grid-v9">
                ${aprobados.length ? aprobados.map(p => renderCard(p, false)).join('') : `<div class="empty-state">No hay jugadores confirmados.</div>`}
            </div>
        </div>
    `;

    if (pendientes.length) {
        html += `
            <div class="ed-info-card bg-transparent border-none p-0 mt-6">
                <h3 class="ed-info-title mb-4"><i class="fas fa-user-clock"></i> Pendientes (${pendientes.length})</h3>
                <div class="participant-grid-v9">
                    ${pendientes.map(p => renderCard(p, true)).join('')}
                </div>
            </div>
        `;
    }

    pane.innerHTML = html;
}

function renderClasificacion(pane) {
    const ev = currentEvent;
    if (!ev) {
        pane.innerHTML = '<div class="empty-state">No hay clasificación disponible.</div>';
        return;
    }
    const cfg = { win: ev.puntosVictoria || 3, draw: ev.puntosEmpate || 1, loss: ev.puntosDerrota || 0 };
    const teams = Array.isArray(ev.teams) ? ev.teams : [];
    const teamMap = new Map(teams.map(t => [t.id, t]));

    if (ev.formato === 'league') {
        const table = computeGroupTable(eventMatches.filter(m => m.phase === 'league'), teams, cfg);
        pane.innerHTML = tableHtml('Clasificación general', table, teamMap, myTeam);
    } else if (ev.formato === 'league_knockout') {
        const groups = ev.groups || {};
        const groupKeys = Object.keys(groups).sort();
        let html = '';
        for (const g of groupKeys) {
            const gTeams = (groups[g] || []).map(id => teamMap.get(id)).filter(Boolean);
            const table = computeGroupTable(eventMatches.filter(m => m.phase === 'group' && m.group === g), gTeams, cfg);
            html += tableHtml(`Grupo ${g}`, table, teamMap, myTeam);
        }
        pane.innerHTML = html || '<div class="empty-state">No hay grupos definidos.</div>';
    } else {
        pane.innerHTML = '<div class="empty-state">No hay clasificación para este formato.</div>';
    }
}
function tableHtml(title, rows, teamMap, myTeam) {
    return `
        <div class="ed-info-card" style="margin-bottom:12px;">
            <h3 class="ed-info-title" style="display:flex; justify-content:between; align-items:center;">
                <span>${title}</span>
                <i class="fas fa-list-ol opacity-50 text-[10px]"></i>
            </h3>
            <div class="table-wrap">
                <table class="ed-standing-table">
                    <thead>
                        <tr><th>#</th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>PF</th><th>PC</th><th>DIF</th><th>Pts</th></tr>
                    </thead>
                    <tbody>
                        ${rows.map((r, i) => {
                            const isMyTeam = myTeam && r.teamId === myTeam.id;
                            const team = teamMap.get(r.teamId);
                            const elimStn = team?.eliminado ? ' <span style="font-size:10px; color:var(--sport-red);">(Eliminado)</span>' : '';
                            const posColor = i === 0 ? '#fbbf24' : (i === 1 ? '#94a3b8' : (i === 2 ? '#b45309' : '#fff'));
                            
                            return `
                            <tr class="${team?.eliminado ? 'opacity-50 grayscale' : ''} ${isMyTeam ? 'my-row-highlight' : ''}">
                                <td style="color:${posColor}; font-weight:900;">${i+1}</td>
                                <td class="team-name-cell">
                                    <span class="t-n" style="${isMyTeam ? 'font-weight:900; color:var(--sport-gold);' : 'color:#abc;' }">${escapeHtml(r.teamName)}</span>
                                    ${elimStn}
                                </td>
                                <td>${r.pj}</td>
                                <td class="text-green-400/80">${r.g}</td>
                                <td class="text-white/40">${r.e}</td>
                                <td class="text-red-400/80">${r.p}</td>
                                <td>${r.pf || 0}</td>
                                <td>${r.pc || 0}</td>
                                <td>${r.dif || 0}</td>
                                <td class="pts-cell"><strong>${r.pts}</strong></td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
}

function renderMatches(pane) {
    const teamMap = new Map((currentEvent?.teams || []).map(t => [t.id, t]));
    const normalizeTeamName = (value) => String(value || '').trim().toLowerCase();
    const isUnknownTeamName = (value) => {
        const n = normalizeTeamName(value);
        if (!n) return true;
        const compact = n.replace(/\s+/g, '');
        if (['tbd', 'tbd.', 'tbd?', 'tdb', '?', 'unknown'].includes(n)) return true;
        if (['tbd', 'tbd.', 'tbd?', 'tdb', 'tbdvs', 'tbdvstbd', 'tbdtbd', 'unknown'].includes(compact)) return true;
        if (['desconocido', 'desconocidos', 'por confirmar', 'por definir', 'pendiente'].includes(n)) return true;
        return false;
    };
    const getRealPlayerCount = (match) => {
        const players = (match?.jugadores || match?.playerUids || []).filter(Boolean);
        return players.filter((p) => !String(p).startsWith('GUEST_')).length;
    };
    const isTbdMatch = (match) => {
        const noPlayers = getRealPlayerCount(match) === 0;
        const isTbd = isUnknownTeamName(match?.teamAName || match?.equipoA) && 
                      isUnknownTeamName(match?.teamBName || match?.equipoB);
        return noPlayers && isTbd;
    };
    const enrichMatch = (m) => {
        const teamA = teamMap.get(m.teamAId);
        const teamB = teamMap.get(m.teamBId);
        const teamAName = (!m.teamAName || isUnknownTeamName(m.teamAName)) && teamA?.name ? teamA.name : m.teamAName;
        const teamBName = (!m.teamBName || isUnknownTeamName(m.teamBName)) && teamB?.name ? teamB.name : m.teamBName;
        const playerUids = Array.isArray(m.playerUids) && m.playerUids.length
            ? m.playerUids
            : [...(teamA?.playerUids || []), ...(teamB?.playerUids || [])];
        return { ...m, teamAName, teamBName, playerUids };
    };
    const buildEventSlotKey = (match) => {
        if (!match?.fecha || !match?.eventoId) return null;
        const d = match.fecha?.toDate ? match.fecha.toDate() : new Date(match.fecha);
        if (Number.isNaN(d?.getTime?.())) return null;
        const when = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
        const court = String(match?.courtType || match?.pista || match?.court || 'unknown').toLowerCase();
        const eventId = String(match?.eventoId || '');
        return `${eventId}|${court}|${when}`;
    };
    const pickBetter = (a, b) => {
        const aCount = getRealPlayerCount(a);
        const bCount = getRealPlayerCount(b);
        if (aCount !== bCount) return aCount > bCount ? a : b;
        const aTbd = isTbdMatch(a);
        const bTbd = isTbdMatch(b);
        if (aTbd !== bTbd) return aTbd ? b : a;
        const aPlayed = !!a?.resultado?.sets || String(a?.estado || '').toLowerCase() === 'jugado';
        const bPlayed = !!b?.resultado?.sets || String(b?.estado || '').toLowerCase() === 'jugado';
        if (aPlayed !== bPlayed) return aPlayed ? a : b;
        return a;
    };
    if (!eventMatches.length) {
        pane.innerHTML = `<div class="empty-state">No hay partidos generados.</div>`;
        return;
    }
    const currentUid = auth.currentUser?.uid;
    const searchVal = window._matchFilter || '';
    const isSpecialFilter = searchVal === 'mis-partidos';
    const filterQuery = isSpecialFilter ? '' : searchVal.toLowerCase();
    
    const phaseWeights = { league: 1, group: 1, knockout: 2, semi: 3, final: 4 };

    const normalizedMatches = eventMatches.map(enrichMatch);
    const filtered = [...normalizedMatches].filter(m => {
        if (isTbdMatch(m)) return false;
        // Essential: Orphan filter
        if (m.phase === 'league' || m.phase === 'group') {
            const ta = currentEvent.teams?.find(t => t.id === m.teamAId);
            const tb = currentEvent.teams?.find(t => t.id === m.teamBId);
            if (!ta && !tb) return false;
        }
        
        // Custom filters
        if (isSpecialFilter) {
            return (m.playerUids || []).includes(currentUid);
        }
        if (filterQuery) {
            const names = `${m.teamAName} ${m.teamBName} ${m.group||''}`.toLowerCase();
            return names.includes(filterQuery);
        }
        return true;
    });

    const sorted = filtered.sort((a,b) => {
        const wA = phaseWeights[a.phase] || 9;
        const wB = phaseWeights[b.phase] || 9;
        if (wA !== wB) return wA - wB;
        return (a.round || 0) - (b.round || 0);
    });
    const uniqueSorted = Array.from(sorted.reduce((acc, m) => {
        const slotKey = buildEventSlotKey(m);
        const baseKey = m.id || m.matchCode || `${m.teamAId || ''}_${m.teamBId || ''}_${m.group || ''}_${m.round || ''}`;
        const key = slotKey || baseKey;
        const existing = acc.get(key);
        acc.set(key, existing ? pickBetter(existing, m) : m);
        return acc;
    }, new Map()).values());

    pane.innerHTML = `
        <div class="matches-filter-bar-v9">
            <div class="mf-search">
                <i class="fas fa-search"></i>
                <input type="text" placeholder="Buscar equipo o grupo..." value="${isSpecialFilter ? '' : searchVal}" oninput="window.setMatchFilter(this.value)">
            </div>
            <button class="mf-btn ${isSpecialFilter ? 'active' : ''}" onclick="window.setMatchFilter('${isSpecialFilter ? '' : 'mis-partidos'}')">
                <i class="fas fa-user"></i> ${isSpecialFilter ? 'Todos' : 'Mis Partidos'}
            </button>
        </div>
        <div class="matches-list">
            ${uniqueSorted.map(m => {
                const isMy = m.playerUids?.includes(currentUid);
                let played = m.estado === 'jugado';
                let score = m.resultado?.score || (typeof m.resultado === 'string' ? m.resultado : '0-0');
                
                // Real-time sync if there is a linked match
                if (!played && m.linkedMatchId) {
                    // We don't fetch from here to avoid loops, but we can check if data was updated in allMatches if we had it
                    // The sync logic in match-service should have pushed the result update to m.resultado
                }

                return `
                <div class="match-card match-court-bg-v7 ${isMy ? 'my-match' : ''} ${played ? 'jugado' : ''}" onclick="window.verDetallePartido('${m.id}')">
                    ${isMy && !played ? '<div class="absolute -top-1 -right-1 p-2 bg-primary/20 rounded-bl-xl"><i class="fas fa-star text-[8px] text-primary"></i></div>' : ''}
                    <div class="match-header">
                        <span>${matchPhaseLabel(m)}</span>
                        <span>${m.fecha ? new Date(m.fecha?.toDate ? m.fecha.toDate() : m.fecha).toLocaleDateString('es-ES', {hour:'2-digit', minute:'2-digit'}) : 'Fecha por decidir'}</span>
                    </div>
                    <div class="match-body-v9">
                        <div class="m-team-v9 ${m.ganadorTeamId === m.teamAId ? 'winner' : ''}">
                            <span class="team-n-v9">${m.teamAName || 'TBD'}</span>
                        </div>
                        <div class="m-score-v9">
                             ${played ? score : (m.linkedMatchId ? '<i class="fas fa-link text-[10px] opacity-40"></i>' : '<span class="m-vs-v9">VS</span>')}
                        </div>
                        <div class="m-team-v9 ${m.ganadorTeamId === m.teamBId ? 'winner' : ''}">
                            <span class="team-n-v9">${m.teamBName || 'TBD'}</span>
                        </div>
                    </div>
                    ${m.linkedMatchId && !played ? `
                        <div class="mt-3 py-1 px-3 bg-white/5 rounded-lg text-center text-[8px] font-black tracking-widest text-[#abc]">
                            VINCULADO AL CALENDARIO
                        </div>
                    ` : ''}
                </div>`;
            }).join('')}

        </div>`;
}

function matchPhaseLabel(m) {
    if (m.phase === 'league') return `JORNADA ${m.round || 1}`;
    if (m.phase === 'group') {
        const gLabel = m.group ? `GRUPO ${m.group} - ` : '';
        return `${gLabel}RONDA ${m.round || 1}`;
    }
    if (m.phase === 'knockout') return `ELIMINATORIA R${m.round || 1}`;
    if (m.phase === 'semi') return 'SEMIFINAL';
    if (m.phase === 'final') return 'GRAN FINAL';
    return (m.phase || 'PARTIDO').toUpperCase();
}

function areGroupsComplete(ev, matches) {
    if (!ev || !Array.isArray(matches)) return false;
    const groupMatches = matches.filter(m => m.phase === 'group' || m.phase === 'league');
    if (!groupMatches.length) return false;
    return groupMatches.every(m => m.estado === 'jugado' || m.resultado?.sets || m.resultado?.score || m.ganadorTeamId);
}

// Modal to select teams that advance to the next phase.
window.openAdvancePhaseModal = () => {
    if (!canOrganizar()) return;
    const ev = currentEvent;
    if (!ev) return;

    const nDefault = Number(ev.equiposPorGrupo || 2);
    const groups = ev.groups || {};
    const teamMap = new Map((ev.teams || []).map(t => [t.id, t]));
    const cfg = { win: ev.puntosVictoria || 3, draw: ev.puntosEmpate || 1, loss: ev.puntosDerrota || 0 };
    const preSelected = new Set();

    Object.keys(groups).forEach(g => {
        const teamIds = groups[g] || [];
        const groupTeams = teamIds.map(id => teamMap.get(id)).filter(Boolean);
        const groupMatches = eventMatches.filter(m => (m.phase === 'group' || m.phase === 'league') && m.group === g);
        const table = computeGroupTable(groupMatches, groupTeams, cfg);
        table.slice(0, nDefault).forEach(r => preSelected.add(r.teamId));
    });

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal-card glass-strong" style="max-width:520px;">
            <div class="modal-header">
                <h3 class="modal-title">PASAR A SIGUIENTE FASE</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="mb-4">
                    <label class="text-[10px] font-black text-muted uppercase tracking-widest">Equipos que pasan por grupo</label>
                    <input type="number" id="adv-pass-count" class="input w-full mt-2" value="${nDefault}" min="1" max="8">
                </div>
                <div class="flex-col gap-3 max-h-[50vh] overflow-y-auto custom-scroll">
                    ${Object.keys(groups).map(g => {
                        const teamIds = groups[g] || [];
                        return `
                        <div class="p-3 rounded-xl border border-white/10 bg-white/5">
                            <div class="text-[10px] font-black text-primary uppercase tracking-widest mb-2">Grupo ${g}</div>
                            <div class="grid grid-cols-2 gap-2">
                                ${teamIds.map(id => {
                                    const t = teamMap.get(id);
                                    if (!t) return '';
                                    const checked = preSelected.has(id) ? 'checked' : '';
                                    return `
                                        <label class="flex-row items-center gap-2 text-[10px] font-bold text-white/80">
                                            <input type="checkbox" class="adv-team-check" value="${id}" ${checked}>
                                            <span>${t.name || t.nombre || t.id}</span>
                                        </label>
                                    `;
                                }).join('')}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
                <div class="flex-row gap-2 mt-4">
                    <button class="btn btn-ghost w-full" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn btn-primary w-full" onclick="window.confirmAdvancePhase()">Avanzar</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    window.confirmAdvancePhase = () => {
        const nPasan = parseInt(document.getElementById('adv-pass-count')?.value || `${nDefault}`, 10);
        const selectedTeamIds = Array.from(overlay.querySelectorAll('.adv-team-check:checked')).map(i => i.value);
        overlay.remove();
        window.generarFaseEliminatoria({ nPasan, selectedTeamIds });
    };
};

function renderBracket(pane) {
    if (!currentEvent.bracket || !currentEvent.bracket.length) {
        pane.innerHTML = `<div class="empty-state">AÃºn no se ha generado el bracket de eliminatorias.</div>`;
        return;
    }

    let html = `<div class="bracket-container"><div class="bracket">`;
    const rounds = currentEvent.bracket;

    rounds.forEach((round, rIdx) => {
        const isLast = (rIdx === rounds.length - 1);
        const isSemi = (rIdx === rounds.length - 2);
        const label = isLast ? 'FINAL' : (isSemi ? 'SEMIS' : `RONDA ${rIdx + 1}`);

        html += `<div class="bracket-round">
            <div class="bracket-round-label">${label}</div>`;
        
        round.forEach(m => {
            const matchData = eventMatches.find(em => em.matchCode === m.matchCode) || m;
            const played = matchData.estado === 'jugado';
            const resultStr = typeof matchData.resultado === 'string' ? matchData.resultado : (matchData.resultado?.score || '');
            const scoreParts = resultStr.split(' '); // Take the first set or the whole string and try to show it nicely
            const scoreA = matchData.ganadorTeamId === m.teamAId ? 'Ganador' : (resultStr ? 'Perdedor' : '');
            const scoreB = matchData.ganadorTeamId === m.teamBId ? 'Ganador' : (resultStr ? 'Perdedor' : '');

            html += `
            <div class="bracket-match" onclick="window.verDetallePartido('${matchData.id || ''}')">
                <div class="b-team-v9 ${matchData.ganadorTeamId === m.teamAId && played ? 'winner' : ''}">
                    <span class="b-name-v9">${m.teamAName || 'TBD'}</span>
                    <span class="b-score-v9">${scoreA}</span>
                </div>
                <div class="b-team-v9 ${matchData.ganadorTeamId === m.teamBId && played ? 'winner' : ''}">
                    <span class="b-name-v9">${m.teamBName || 'TBD'}</span>
                    <span class="b-score-v9">${scoreB}</span>
                </div>
            </div>`;
        });
        html += `</div>`;
    });
    html += `</div></div>`;
    pane.innerHTML = html;
}

function renderOrganizador(pane) {
    const ev = currentEvent;
    const groupsComplete = areGroupsComplete(ev, eventMatches);
    pane.innerHTML = `
        <div class="admin-panel compact-v9" style="padding-top:10px;">
            <div class="org-header-v9">
                <i class="fas fa-crown text-sport-gold"></i>
                <span>GestiÃ³n de Organizador</span>
            </div>
            
            <div class="org-grid-v9">
                <div class="org-card-v9">
                    <label><i class="fas fa-toggle-on"></i> Estado</label>
                    <select id="org-ev-state" class="input">
                        <option value="inscripcion" ${ev.estado === 'inscripcion' ? 'selected' : ''}>InscripciÃ³n</option>
                        <option value="activo" ${ev.estado === 'activo' ? 'selected' : ''}>Activo</option>
                        <option value="finalizado" ${ev.estado === 'finalizado' ? 'selected' : ''}>Finalizado</option>
                    </select>
                </div>
                <div class="org-card-v9">
                    <label><i class="fas fa-star"></i> Pts/Victoria</label>
                    <input type="number" id="org-pts-win" class="input" value="${ev.puntosVictoria || 3}">
                </div>
            </div>

            <div class="org-actions-v9">
                <button class="btn btn-success btn-sm w-full" onclick="window.abrirEvento()" ${ev.estado === 'activo' ? 'disabled' : ''}>
                    <i class="fas fa-play"></i> Activar Sorteo
                </button>
                <div class="flex-row gap-2 mt-2">
                    <button class="btn btn-primary btn-sm flex-1" onclick="window.generarFaseEliminatoria()">
                        <i class="fas fa-sitemap"></i> Bracket
                    </button>
                    <button class="btn btn-micro btn-sm flex-1" onclick="window.regenerarPartidosLiga()">
                        <i class="fas fa-sync-alt"></i> Fix Grupos
                    </button>
                </div>
                <button class="btn btn-ghost btn-sm w-full mt-2" onclick="window.validateBracketED()">
                    <i class="fas fa-shield-check"></i> Validar Bracket
                </button>
                ${groupsComplete ? `
                    <button class="btn btn-success btn-sm w-full mt-2" onclick="window.openAdvancePhaseModal()">
                        <i class="fas fa-forward"></i> Pasar a siguiente fase
                    </button>
                ` : `
                    <div class="text-[10px] text-muted mt-2 text-center">Termina todos los partidos de grupo para avanzar de fase.</div>
                `}
            </div>

            <div class="org-section-v9">
                <h4><i class="fas fa-edit"></i> Grupos y Equipos</h4>
                <div class="flex-row gap-2 mt-2">
                    <button class="btn btn-primary btn-sm flex-1" onclick="window.openAddPlayerModalED()">
                        <i class="fas fa-user-plus"></i> AÃ±adir jugador
                    </button>
                    <button class="btn btn-ghost btn-sm flex-1" onclick="window.openAddTeamModalED()">
                        <i class="fas fa-people-group"></i> Crear equipo
                    </button>
                </div>
                <div id="group-editor-container" class="mt-2"></div>
            </div>

            <div class="org-danger-zone-v9">
                <button class="btn btn-warning btn-xs" onclick="window.reiniciarTorneo()">
                    <i class="fas fa-redo"></i> Reset Torneo
                </button>
                <button class="btn btn-danger btn-xs" onclick="window.deleteEvent()">
                    <i class="fas fa-trash"></i> Borrar
                </button>
            </div>
            
            <button class="btn btn-primary w-full mt-4" onclick="window.guardarConfigOrganizador()">Aplicar Cambios Globales</button>
        </div>`;

    if (ev.teams && ev.teams.length) {
        renderGroupEditor(ev);
    }
}

function renderGroupEditor(ev) {
    const container = document.getElementById('group-editor-container');
    if (!container) return;
    const teams = ev.teams || [];
    const groups = ev.groups || {};
    const groupKeys = Object.keys(groups).length ? Object.keys(groups) : ['A', 'B', 'C', 'D'].slice(0, ev.groupCount || 2);

    let html = '<div class="group-editor">';
    groupKeys.forEach(g => {
        html += `<div class="group-edit-box"><h5>Grupo ${g}</h5>`;
        const teamIdsInGroup = groups[g] || [];
        const teamsInGroup = teams.filter(t => teamIdsInGroup.includes(t.id));
        teamsInGroup.forEach(t => {
            const memberNames = (t.playerUids || [])
                .map((uid) => resolveParticipantData({ uid }).name)
                .filter(Boolean)
                .join(' Â· ');
            html += `<div class="group-team-edit">
                <div class="flex-col">
                    <span>${escapeHtml(t.name)}</span>
                    <span class="text-[9px] opacity-60">${escapeHtml(memberNames || 'Sin jugadores')}</span>
                </div>
                <div class="flex-row gap-2">
                    <button class="btn-micro" onclick="window.openTeamEditor('${t.id}')"><i class="fas fa-user-pen"></i></button>
                    <button class="btn-micro" onclick="window.moverEquipo('${t.id}', '${g}', '')"><i class="fas fa-arrow-right"></i></button>
                    <button class="btn-micro danger" onclick="window.deleteTeamED('${t.id}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
        });
        html += '</div>';
    });
    // Equipos no asignados
    const assignedIds = Object.values(groups).flat();
    const unassigned = teams.filter(t => !assignedIds.includes(t.id));
    if (unassigned.length) {
        html += '<div class="group-edit-box"><h5>Sin grupo</h5>';
        unassigned.forEach(t => {
            const memberNames = (t.playerUids || [])
                .map((uid) => resolveParticipantData({ uid }).name)
                .filter(Boolean)
                .join(' Â· ');
            html += `<div class="group-team-edit">
                <div class="flex-col">
                    <span>${escapeHtml(t.name)}</span>
                    <span class="text-[9px] opacity-60">${escapeHtml(memberNames || 'Sin jugadores')}</span>
                </div>
                <select onchange="window.moverEquipo('${t.id}', '', this.value)">
                    <option value="">Mover a...</option>
                    ${groupKeys.map(g => `<option value="${g}">Grupo ${g}</option>`).join('')}
                </select>
                <button class="btn-micro danger" onclick="window.deleteTeamED('${t.id}')"><i class="fas fa-trash"></i></button>
            </div>`;
        });
        html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
}

// Funciones globales para ediciÃ³n de grupos
window.moverEquipo = (teamId, fromGroup, toGroup) => {
    if (!toGroup) return;
    const newGroup = prompt('Introduce el grupo destino (A, B, C, D):', toGroup || 'A');
    if (!newGroup) return;
    window.guardarMovimiento(teamId, newGroup);
};

window.guardarMovimiento = async (teamId, newGroup) => {
    if (!currentEvent) return;
    const groups = { ...currentEvent.groups };
    // Quitar equipo de cualquier grupo actual
    for (let g in groups) {
        groups[g] = groups[g].filter(id => id !== teamId);
    }
    // AÃ±adir al nuevo grupo
    if (!groups[newGroup]) groups[newGroup] = [];
    groups[newGroup].push(teamId);
    try {
        await updateDoc(doc(db, 'eventos', eventId), { groups });
        showToast('Grupo actualizado', '', 'success');
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

window.deleteTeamED = async (teamId) => {
    if (!canOrganizar()) return;
    if (!confirm('Â¿Eliminar este equipo y sus partidos?')) return;
    const ev = currentEvent;
    if (!ev) return;
    try {
        const teams = (ev.teams || []).filter(t => t.id !== teamId);
        const groups = { ...(ev.groups || {}) };
        Object.keys(groups).forEach((g) => {
            groups[g] = (groups[g] || []).filter(id => id !== teamId);
        });
        await updateDoc(doc(db, 'eventos', eventId), { teams, groups, updatedAt: serverTimestamp() });

        const matchesToDelete = eventMatches.filter(m => m.teamAId === teamId || m.teamBId === teamId);
        await Promise.all(matchesToDelete.map(async (m) => {
            await deleteDoc(doc(db, 'eventoPartidos', m.id));
            if (m.linkedMatchId && m.linkedMatchCollection) {
                await deleteDoc(doc(db, m.linkedMatchCollection, m.linkedMatchId));
            }
        }));
        showToast('Equipo eliminado', '', 'success');
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

// Team editor: reassign players inside a team with validation.
window.openTeamEditor = (teamId) => {
    if (!canOrganizar()) return;
    const ev = currentEvent;
    const team = (ev?.teams || []).find(t => t.id === teamId);
    if (!team) return;
    const inscritos = Array.isArray(ev.inscritos) ? ev.inscritos : [];
    const basePool = inscritos.map(i => {
        const info = resolveParticipantData(i);
        return { uid: info.uid, name: info.name };
    }).filter(i => i.uid);

    // Ensure current players are in the pool
    (team.playerUids || []).forEach(uid => {
        if (uid && !basePool.some(p => p.uid === uid)) {
            basePool.push({ uid, name: uid });
        }
    });

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active modal-stack-front';
    overlay.innerHTML = `
        <div class="modal-card glass-strong" style="max-width:460px;">
            <div class="modal-header">
                <h3 class="modal-title">Editar equipo Â· ${escapeHtml(team.name || team.id)}</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="flex-col gap-3">
                    <label class="text-[10px] font-black text-muted uppercase tracking-widest">Jugador 1</label>
                    <select id="team-edit-p1" class="input">
                        ${basePool.map(p => `<option value="${p.uid}" ${p.uid === team.playerUids?.[0] ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                    </select>
                    <label class="text-[10px] font-black text-muted uppercase tracking-widest mt-2">Jugador 2</label>
                    <select id="team-edit-p2" class="input">
                        ${basePool.map(p => `<option value="${p.uid}" ${p.uid === team.playerUids?.[1] ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="flex-row gap-2 mt-4">
                    <button class="btn btn-ghost w-full" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn btn-primary w-full" onclick="window.saveTeamEdit('${teamId}')">Guardar</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
};

// Persist team changes and propagate to event matches (and linked calendar matches).
window.saveTeamEdit = async (teamId) => {
    if (!currentEvent) return;
    const sel1 = document.getElementById('team-edit-p1')?.value || '';
    const sel2 = document.getElementById('team-edit-p2')?.value || '';
    if (!sel1 || !sel2 || sel1 === sel2) {
        showToast('Equipo invÃ¡lido', 'Selecciona dos jugadores distintos', 'warning');
        return;
    }

    const teams = currentEvent.teams || [];
    const team = teams.find(t => t.id === teamId);
    if (!team) return;
    const otherTeams = teams.filter(t => t.id !== teamId);
    const occupied = new Set(otherTeams.flatMap(t => t.playerUids || []));
    if (occupied.has(sel1) || occupied.has(sel2)) {
        showToast('Jugador en otro equipo', 'No puedes duplicar jugadores entre equipos', 'warning');
        return;
    }

    const updatedTeams = teams.map(t => {
        if (t.id !== teamId) return t;
        return { ...t, playerUids: [sel1, sel2] };
    });

    try {
        await updateDoc(doc(db, 'eventos', eventId), { teams: updatedTeams, updatedAt: serverTimestamp() });

        // Sync event matches that reference this team
        const matchesToUpdate = eventMatches.filter(m => m.teamAId === teamId || m.teamBId === teamId);
        await Promise.all(matchesToUpdate.map(async (m) => {
            const teamA = updatedTeams.find(t => t.id === m.teamAId);
            const teamB = updatedTeams.find(t => t.id === m.teamBId);
            const playerUids = [...(teamA?.playerUids || []), ...(teamB?.playerUids || [])];
            await updateDoc(doc(db, 'eventoPartidos', m.id), {
                playerUids,
                updatedAt: serverTimestamp()
            });
            if (m.linkedMatchId && m.linkedMatchCollection) {
                await updateDoc(doc(db, m.linkedMatchCollection, m.linkedMatchId), {
                    jugadores: playerUids,
                    equipoA: teamA?.playerUids || [],
                    equipoB: teamB?.playerUids || [],
                    updatedAt: serverTimestamp()
                });
            }
        }));

        showToast('Equipo actualizado', '', 'success');
        document.querySelectorAll('.modal-overlay').forEach(o => o.classList.contains('modal-stack-front') && o.remove());
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

window.guardarGrupos = async () => {
    showToast('Grupos guardados', '', 'success');
};

// FunciÃ³n para abrir el evento (cambiar estado a activo)
window.abrirEvento = async () => {
    if (!canOrganizar()) return;
    try {
        await updateDoc(doc(db, 'eventos', eventId), { estado: 'activo' });
        showToast('Evento abierto', 'Ahora los usuarios aprobados pueden ver el sorteo', 'success');
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

window.guardarConfigOrganizador = async () => {
    const estado = document.getElementById('org-ev-state').value;
    const ptsWin = Number(document.getElementById('org-pts-win').value);
    try {
        await updateDoc(doc(db, 'eventos', eventId), { estado: estado, puntosVictoria: ptsWin });
        showToast('ConfiguraciÃ³n guardada', '', 'success');
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

window.reiniciarTorneo = async () => {
    if (!confirm('Â¿Reiniciar el torneo? Se perderÃ¡n todos los resultados y se volverÃ¡ a estado de inscripciÃ³n.')) return;
    try {
        const matchesSnap = await getDocs(query(collection(db, 'eventoPartidos'), where('eventoId', '==', eventId)));
        await Promise.all(matchesSnap.docs.map(d => deleteDoc(doc(db, 'eventoPartidos', d.id))));
        await updateDoc(doc(db, 'eventos', eventId), {
            estado: 'inscripcion',
            teams: [],
            groups: {},
            bracket: null,
            drawState: { status: 'pending', steps: [], version: 0 },
            updatedAt: serverTimestamp()
        });
        showToast('Torneo reiniciado', 'Volviendo a inscripciÃ³n', 'success');
        setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

window.deleteEvent = async () => {
    if (!confirm('Â¿Eliminar evento permanentemente?')) return;
    try {
        await deleteDoc(doc(db, 'eventos', eventId));
        showToast('Evento eliminado', '', 'info');
        setTimeout(() => window.location.href = 'eventos.html', 700);
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

window.editarResultado = async (matchId) => {
    console.log("[EventoDetalle] editarResultado", { matchId });
    const match = eventMatches.find(m => m.id === matchId);
    console.log("[EventoDetalle] match found", match);
    if (match && !match.fecha) {
        const dateStr = prompt('Indica la fecha (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
        const hour = prompt('Indica la hora (HH:MM):', '19:00');
        if (dateStr && hour) {
            const combinedDate = new Date(`${dateStr}T${hour}`);
            if (!Number.isNaN(combinedDate.getTime())) {
                await updateDoc(doc(db, 'eventoPartidos', matchId), {
                    fecha: combinedDate,
                    updatedAt: serverTimestamp()
                });
                console.log("[EventoDetalle] fecha actualizada", { matchId, combinedDate });
            }
        }
    }
    console.log("[EventoDetalle] abriendo form resultado", { matchId });
    openResultForm(matchId, 'eventoPartidos');
};

window.advanceBracket = advanceBracket;

async function advanceBracket(match, winnerTeamId) {
    if (!currentEvent || !currentEvent.bracket) return;
    
    const nextMatch = eventMatches.find(m => m.sourceA === match.matchCode || m.sourceB === match.matchCode);
    if (!nextMatch) return;
    
    const team = (currentEvent.teams || []).find(t => t.id === winnerTeamId);
    if (!team) return;

    const isSourceA = nextMatch.sourceA === match.matchCode;
    const updateData = {};
    
    if (isSourceA) {
        updateData.teamAId = team.id;
        updateData.teamAName = team.name;
    } else {
        updateData.teamBId = team.id;
        updateData.teamBName = team.name;
    }
    
    let otherTeamId = isSourceA ? nextMatch.teamBId : nextMatch.teamAId;
    let otherTeam = null;
    if (otherTeamId) otherTeam = (currentEvent.teams || []).find(t => t.id === otherTeamId);
    
    updateData.playerUids = [
        ...(team.playerUids || []),
        ...(otherTeam?.playerUids || [])
    ];
    
    try {
        await updateDoc(doc(db, 'eventoPartidos', nextMatch.id), updateData);
    } catch(e) {
        console.error('Error avanzando bracket:', e);
    }
}

window.asignarFechaPartido = async (matchId) => {
    const match = eventMatches.find(m => m.id === matchId);
    if (!match) return;
    const dateStr = prompt('Introduce fecha y hora (ej. 2026-03-10T18:00):', new Date().toISOString().slice(0,16));
    if (!dateStr) return;
    try {
        await updateDoc(doc(db, 'eventoPartidos', matchId), {
            fecha: dateStr,
            updatedAt: serverTimestamp()
        });
        showToast('Fecha asignada', 'El partido aparecerÃ¡ en el calendario/home', 'success');
    } catch(e) {
        showToast('Error asignando fecha', e.message, 'error');
    }
};

window.verDetallePartido = (matchId) => {
    if (!matchId) return;
    const match = eventMatches.find(m => m.id === matchId || m.matchCode === matchId);
    if (!match) return;

    const modal = document.getElementById('modal-match-detail-ed');
    if (!modal) return;
    
    const teamMap = new Map((currentEvent?.teams || []).map(t => [t.id, t]));
    const played = match.estado === 'jugado';
    const fallbackPlayers = Array.isArray(match.playerUids) && match.playerUids.length
        ? match.playerUids
        : [...(teamMap.get(match.teamAId)?.playerUids || []), ...(teamMap.get(match.teamBId)?.playerUids || [])];
    const isParticipant = fallbackPlayers.includes(auth.currentUser?.uid);
    const score = typeof match.resultado === 'string' ? match.resultado : (match.resultado?.score || match.resultado?.sets || 'Sin detalle');
    const teamAName = (match.teamAName || teamMap.get(match.teamAId)?.name || 'TBD');
    const teamBName = (match.teamBName || teamMap.get(match.teamBId)?.name || 'TBD');
    
    let actionsHtml = '';
    if (canOrganizar() || (isParticipant && !played)) {
        actionsHtml = `
            <div class="flex-col gap-2 mt-4">
                <button class="btn btn-primary btn-sm w-full" style="background: linear-gradient(90deg, #818cf8, #6366f1) !important;" onclick="window.proponerFechaEvento('${match.id}')">
                    <i class="fas fa-comments-alt mr-2"></i> PROPONER FECHA / CHAT
                </button>
                ${canOrganizar() ? `
                <button class="btn btn-ghost btn-sm w-full" onclick="window.openMatchTeamEditor('${match.id}')">
                    <i class="fas fa-people-arrows mr-2"></i> EDITAR EQUIPOS
                </button>` : ''}
                <button class="btn btn-success btn-sm w-full" onclick="window.editarResultado('${match.id}'); document.getElementById('modal-match-detail-ed').classList.remove('active');">
                    <i class="fas fa-check-circle mr-2"></i> ANOTAR RESULTADO
                </button>
                ${!match.fecha ? `
                <button class="btn btn-primary btn-sm w-full" onclick="window.vincularPartidoCalendario('${match.id}')" style="background: rgba(255,255,255,0.05) !important;">
                    <i class="fas fa-calendar-plus mr-2"></i> VINCULAR A CALENDARIO
                </button>` : ''}
                ${canOrganizar() ? `
                    <button class="btn btn-ghost btn-sm w-full text-red-400 opacity-60 mt-2" onclick="window.reiniciarPartido('${match.id}')">
                        <i class="fas fa-rotate-left mr-2"></i> RESETEAR PARTIDO
                    </button>
                ` : ''}
            </div>
        `;
    }

    modal.innerHTML = `
        <div class="modal-card glass-strong slide-up" style="max-width: 440px;">
            <div class="modal-header">
                <h3 class="modal-title">${matchPhaseLabel(match)}</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').classList.remove('active')">Ã—</button>
            </div>
            <div class="modal-body p-6">
                <div class="match-detail-v9">
                    <div class="flex-row between items-center py-4 px-2 bg-white/5 rounded-2xl border border-white/5">
                        <div class="flex-col items-center flex-1">
                            <span class="text-[10px] text-muted font-bold mb-1">EQUIPO A</span>
                            <span class="text-white font-black text-center text-sm">${escapeHtml(teamAName)}</span>
                        </div>
                        <div class="px-4 text-primary font-black text-xl italic">${played ? score : 'VS'}</div>
                        <div class="flex-col items-center flex-1">
                            <span class="text-[10px] text-muted font-bold mb-1">EQUIPO B</span>
                            <span class="text-white font-black text-center text-sm">${escapeHtml(teamBName)}</span>
                        </div>
                    </div>

                    <div class="md-meta mt-6 p-4 rounded-xl bg-primary/10 border border-primary/20 text-center">
                        <div class="text-[10px] text-primary font-black uppercase tracking-widest mb-1">Cita Programada</div>
                        <div class="text-white font-bold text-lg">
                            <i class="fas fa-calendar-alt text-primary mr-2 opacity-50"></i>
                            ${match.fecha ? new Date(match.fecha?.toDate ? match.fecha.toDate() : match.fecha).toLocaleString('es-ES', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : 'POR DETERMINAR'}
                        </div>
                    </div>
                    ${actionsHtml}
                </div>
            </div>
        </div>
    `;
    modal.classList.add('active');
};

window.openMatchTeamEditor = (matchId) => {
    if (!canOrganizar()) return;
    const match = eventMatches.find(m => m.id === matchId);
    if (!match) return;
    const teams = currentEvent?.teams || [];
    if (!teams.length) return showToast('Sin equipos', 'No hay equipos creados', 'warning');
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active modal-stack-front';
    overlay.innerHTML = `
        <div class="modal-card glass-strong" style="max-width:460px;">
            <div class="modal-header">
                <h3 class="modal-title">Editar equipos del partido</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="flex-col gap-3">
                    <label class="text-[10px] font-black text-muted uppercase tracking-widest">Equipo A</label>
                    <select id="match-edit-teamA" class="input">
                        ${teams.map(t => `<option value="${t.id}" ${t.id === match.teamAId ? 'selected' : ''}>${escapeHtml(t.name || t.id)}</option>`).join('')}
                    </select>
                    <label class="text-[10px] font-black text-muted uppercase tracking-widest mt-2">Equipo B</label>
                    <select id="match-edit-teamB" class="input">
                        ${teams.map(t => `<option value="${t.id}" ${t.id === match.teamBId ? 'selected' : ''}>${escapeHtml(t.name || t.id)}</option>`).join('')}
                    </select>
                </div>
                <div class="flex-row gap-2 mt-4">
                    <button class="btn btn-ghost w-full" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn btn-primary w-full" onclick="window.saveMatchTeamEdit('${matchId}')">Guardar</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
};

window.saveMatchTeamEdit = async (matchId) => {
    const match = eventMatches.find(m => m.id === matchId);
    if (!match) return;
    const teamAId = document.getElementById('match-edit-teamA')?.value || '';
    const teamBId = document.getElementById('match-edit-teamB')?.value || '';
    if (!teamAId || !teamBId || teamAId === teamBId) {
        return showToast('Equipos invÃ¡lidos', 'Selecciona dos equipos distintos', 'warning');
    }
    const conflict = eventMatches.find(m =>
        m.id !== matchId &&
        m.phase === match.phase &&
        Number(m.round || 0) === Number(match.round || 0) &&
        (m.teamAId === teamAId || m.teamBId === teamAId || m.teamAId === teamBId || m.teamBId === teamBId)
    );
    if (conflict) {
        return showToast('Conflicto', 'Ese equipo ya estÃ¡ asignado en otro partido de la misma ronda.', 'error');
    }
    const teamA = (currentEvent?.teams || []).find(t => t.id === teamAId);
    const teamB = (currentEvent?.teams || []).find(t => t.id === teamBId);
    if (!teamA || !teamB) return;
    const playerUids = [...(teamA.playerUids || []), ...(teamB.playerUids || [])].filter(Boolean);
    try {
        await updateDoc(doc(db, 'eventoPartidos', matchId), {
            teamAId,
            teamBId,
            teamAName: teamA.name || '',
            teamBName: teamB.name || '',
            playerUids,
            updatedAt: serverTimestamp()
        });
        if (match.linkedMatchId && match.linkedMatchCollection) {
            await updateDoc(doc(db, match.linkedMatchCollection, match.linkedMatchId), {
                jugadores: playerUids,
                equipoA: teamA.playerUids || [],
                equipoB: teamB.playerUids || [],
                eventTeamAId: teamAId,
                eventTeamBId: teamBId,
                eventTeamAName: teamA.name || '',
                eventTeamBName: teamB.name || '',
                updatedAt: serverTimestamp()
            });
        }
        showToast('Partido actualizado', '', 'success');
        document.querySelectorAll('.modal-overlay').forEach(o => o.classList.contains('modal-stack-front') && o.remove());
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

window.validateBracketED = () => {
    if (!canOrganizar()) return;
    const rounds = currentEvent?.bracket || [];
    if (!rounds.length) return showToast('Bracket vacÃ­o', 'No hay bracket generado', 'warning');

    const issues = [];
    rounds.forEach((round, ri) => {
        const used = new Map();
        round.forEach((bm) => {
            const match = eventMatches.find(m => m.matchCode === bm.matchCode) || bm;
            const a = match.teamAId || bm.teamAId;
            const b = match.teamBId || bm.teamBId;
            if (a) {
                if (used.has(a)) issues.push(`Ronda ${ri + 1}: equipo ${a} repetido`);
                used.set(a, true);
            }
            if (b) {
                if (used.has(b)) issues.push(`Ronda ${ri + 1}: equipo ${b} repetido`);
                used.set(b, true);
            }
        });
    });

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active modal-stack-front';
    overlay.innerHTML = `
        <div class="modal-card glass-strong" style="max-width:480px;">
            <div class="modal-header">
                <h3 class="modal-title">ValidaciÃ³n de Bracket</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                ${issues.length ? `
                    <div class="text-[11px] text-sport-red mb-2">Se detectaron ${issues.length} conflictos</div>
                    <div class="flex-col gap-2 max-h-[40vh] overflow-y-auto custom-scroll">
                        ${issues.map(i => `<div class="p-2 rounded-lg bg-white/5 border border-white/10 text-[10px]">${i}</div>`).join('')}
                    </div>
                ` : `<div class="text-[11px] text-sport-green">No se detectaron conflictos. Bracket OK.</div>`}
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
};

window.abrirProgramacionCalendarioED = (matchId) => {
    const match = eventMatches.find(m => m.id === matchId);
    if (!match) return;
    const modal = document.getElementById('modal-match-detail-ed');
    
    // Default to today at 19:00 if no date
    const d = match.fecha ? (match.fecha.toDate ? match.fecha.toDate() : new Date(match.fecha)) : new Date();
    const isoDate = d.toISOString().split('T')[0];

    modal.innerHTML = `
        <div class="modal-card glass-strong slide-up" style="max-width: 440px;">
            <div class="modal-header">
                <h3 class="modal-title">Programar Fecha</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').classList.remove('active')">Ã—</button>
            </div>
            <div class="modal-body p-6">
                 <p class="text-[11px] text-muted mb-4 text-center">Selecciona cuÃ¡ndo se jugarÃ¡ el partido. Se crearÃ¡ automÃ¡ticamente una reserva vinculada en el calendario general.</p>
                <div class="form-group mb-4">
                    <label class="form-label text-[10px] opacity-70 mb-2 block">DÃA DEL PARTIDO</label>
                    <input type="date" id="ed-match-date" class="input py-3" value="${isoDate}">
                </div>
                <div class="form-group">
                    <label class="form-label text-[10px] opacity-70 mb-2 block">HORA DE INICIO</label>
                    <select id="ed-match-hour" class="input py-3">
                        <option value="08:00">08:00</option><option value="09:30">09:30</option>
                        <option value="11:00" selected>11:00</option><option value="12:30">12:30</option>
                        <option value="14:30">14:30</option><option value="16:00">16:00</option>
                        <option value="17:30">17:30</option><option value="19:00">19:00</option>
                        <option value="20:30">20:30</option>
                    </select>
                </div>
                <button class="btn btn-primary w-full mt-6 py-4 font-black" onclick="window.confirmarProgramacionCalendarioED('${matchId}')">
                    <i class="fas fa-save mr-2"></i> CONFIRMAR Y GUARDAR
                </button>
            </div>
        </div>
    `;
};

window.confirmarProgramacionCalendarioED = async (matchId) => {
    const match = eventMatches.find(m => m.id === matchId);
    const dateStr = document.getElementById('ed-match-date').value;
    const hour = document.getElementById('ed-match-hour').value;
    const { showLoading, hideLoading } = await import('./modules/ui-loader.js');

    if (!dateStr || !hour) return;
    const combinedDate = new Date(`${dateStr}T${hour}`);

    try {
        showLoading("Sincronizando con la Matrix...");
        
        // 1. Update event match
        await updateDoc(doc(db, 'eventoPartidos', matchId), {
            fecha: combinedDate,
            updatedAt: serverTimestamp()
        });
        
        // 2. Add or update calendar (partidosAmistosos) if fully decided
        if (match.playerUids && match.playerUids.length >= 4) {
            const col = "partidosAmistosos";
            const matchData = {
                creador: auth.currentUser.uid,
                organizerId: auth.currentUser.uid,
                fecha: combinedDate,
                jugadores: match.playerUids,
                restriccionNivel: { min: 1, max: 7 },
                estado: 'abierto',
                timestamp: serverTimestamp(),
                equipoA: match.playerUids.slice(0, 2),
                equipoB: match.playerUids.slice(2, 4),
                visibility: 'public',
                eventoId: match.eventoId,
                eventMatchId: match.id,
                phase: match.phase || '',
                type: 'evento',
                eventTeamAId: match.teamAId || null,
                eventTeamBId: match.teamBId || null,
                eventTeamAName: match.teamAName || '',
                eventTeamBName: match.teamBName || ''
            };
            if (match.linkedMatchId && match.linkedMatchCollection) {
                await updateDoc(doc(db, match.linkedMatchCollection, match.linkedMatchId), matchData);
            } else {
                const newMatchRef = await addDoc(collection(db, col), matchData);
                await updateDoc(doc(db, 'eventoPartidos', matchId), {
                    linkedMatchId: newMatchRef.id,
                    linkedMatchCollection: col
                });
            }
        }
        
        hideLoading();
        showToast("Â¡Listo!", "Calendario actualizado y partido programado", "success");
        document.getElementById('modal-match-detail-ed').classList.remove('active');
    } catch (e) {
        hideLoading();
        showToast("Error", e.message, "error");
    }
};

window.generarFaseEliminatoria = async (opts = {}) => {
    if (!canOrganizar()) return;
    const ev = currentEvent;
    
    if (ev.formato === 'league') {
        showToast('AtenciÃ³n', 'Este formato es de liga, no tiene eliminatorias', 'info');
        return;
    }

    const manualIds = Array.isArray(opts.selectedTeamIds) ? opts.selectedTeamIds.filter(Boolean) : null;
    let nPasan = Number.isFinite(Number(opts.nPasan)) ? parseInt(opts.nPasan) : null;
    if (!nPasan) {
        const pasanPorGrupo = prompt('Â¿CuÃ¡ntos equipos pasan por grupo a la siguiente fase?', ev.equiposPorGrupo || 2);
        if (!pasanPorGrupo) return;
        nPasan = parseInt(pasanPorGrupo);
    }

    const groupsKeys = Object.keys(ev.groups || {});
    let clasificados = [];
    let eliminados = [];
    const teamMap = new Map((ev.teams || []).map(t => [t.id, t]));

    if (manualIds && manualIds.length) {
        clasificados = manualIds.map(id => teamMap.get(id)).filter(Boolean);
        const allIds = (ev.teams || []).map(t => t.id);
        eliminados = allIds.filter(id => !manualIds.includes(id)).map(id => teamMap.get(id)).filter(Boolean);
    } else {
        groupsKeys.forEach(g => {
            const teamIds = ev.groups[g] || [];
            const teamsEnGrupo = teamIds.map(id => teamMap.get(id));
            const groupMatches = eventMatches.filter(m => m.phase === 'group' && m.group === g);
            const tabla = computeGroupTable(groupMatches, teamsEnGrupo, {win: ev.puntosVictoria || 3, draw: ev.puntosEmpate || 1, loss: ev.puntosDerrota || 0});
            
            tabla.forEach((fila, idx) => {
                if (idx < nPasan) {
                    clasificados.push(teamMap.get(fila.teamId));
                } else {
                    eliminados.push(teamMap.get(fila.teamId));
                }
            });
        });
    }

    if (clasificados.length < 2) {
        showToast('Error', 'No hay suficientes equipos clasificados para generar eliminatorias', 'error');
        return;
    }

    if (!confirm(`PasarÃ¡n ${clasificados.length} equipos al bracket final y se eliminarÃ¡n ${eliminados.length} equipos. Â¿EstÃ¡s seguro?`)) return;

    try {
        const updatedTeams = (ev.teams || []).map(t => {
            if (eliminados.find(e => e.id === t.id)) return { ...t, eliminado: true };
            return { ...t, eliminado: false };
        });

        const oldMatches = eventMatches.filter(m => m.phase === 'knockout' || m.phase === 'semi' || m.phase === 'final');
        if (oldMatches.length) {
             const batch = writeBatch(db);
             oldMatches.forEach(m => {
                 batch.delete(doc(db, 'eventoPartidos', m.id));
             });
             await batch.commit();
        }

        const bracketRounds = generateKnockoutTree(clasificados, ev.id + '_fase2_new');
        
        const partidosRef = collection(db, 'eventoPartidos');
        for (let r = 0; r < bracketRounds.length; r++) {
            const round = bracketRounds[r];
            for (let s = 0; s < round.length; s++) {
                const match = round[s];
                const teamA = teamMap.get(match.teamAId);
                const teamB = teamMap.get(match.teamBId);
                await addDoc(partidosRef, {
                    eventoId: ev.id,
                    tipo: 'evento',
                    phase: 'knockout',
                    round: r + 1,
                    slot: s + 1,
                    matchCode: match.matchCode || '',
                    sourceA: match.sourceA || null,
                    sourceB: match.sourceB || null,
                    teamAId: match.teamAId || null,
                    teamBId: match.teamBId || null,
                    teamAName: match.teamAId ? (teamA?.name || 'TBD') : null,
                    teamBName: match.teamBId ? (teamB?.name || 'TBD') : null,
                    playerUids: [
                        ...(teamA?.playerUids || []),
                        ...(teamB?.playerUids || [])
                    ],
                    resultado: null,
                    ganadorTeamId: null,
                    estado: 'pendiente',
                    fecha: null,
                    createdAt: serverTimestamp()
                });
            }
        }

        await updateDoc(doc(db, 'eventos', ev.id), { teams: updatedTeams, bracket: bracketRounds });
        showToast('Fase generada', 'Eliminatorias creadas y perdedores eliminados', 'success');

    } catch(e) {
         showToast('Error', e.message, 'error');
    }
};

window.reiniciarPartido = async (matchId) => {
    if (!confirm('Â¿Reiniciar este partido? Se borrarÃ¡ el resultado.')) return;
    try {
        await updateDoc(doc(db, 'eventoPartidos', matchId), {
            resultado: null,
            ganador: null,
            ganadorTeamId: null,
            estado: 'pendiente',
            updatedAt: serverTimestamp()
        });
        showToast('Partido reiniciado', '', 'info');
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

window.regenerarPartidosLiga = async () => {
    if (!canOrganizar()) return;
    const ev = currentEvent;
    if (!ev || !ev.groups || !ev.teams) {
        showToast('Error', 'Sorteo no completado o faltan datos.', 'error');
        return;
    }

    if (!confirm('Esto ELIMINARÃ todos los partidos de liga/grupo del evento (incluidos vÃ­nculos) y los volverÃ¡ a crear. Â¿Continuar?')) return;

    try {
        showToast('Procesando...', 'Regenerando partidos de liga', 'info');
        const partidosRef = collection(db, 'eventoPartidos');
        
        // delete all league/group matches for this event
        const q = query(partidosRef, where('eventoId', '==', ev.id));
        const snap = await getDocs(q);
        
        const batch = writeBatch(db);
        const toDelete = [];
        snap.docs.forEach(d => {
            const m = d.data();
            if (m.phase === 'league' || m.phase === 'group') {
                toDelete.push({ id: d.id, ...m });
                batch.delete(doc(db, 'eventoPartidos', d.id));
            }
        });
        await batch.commit();
        for (const m of toDelete) {
            if (m.linkedMatchId && m.linkedMatchCollection) {
                await deleteDoc(doc(db, m.linkedMatchCollection, m.linkedMatchId));
            }
        }

        const teamMap = new Map(ev.teams.map(t => [t.id, t]));
        for (const [groupName, teamIds] of Object.entries(ev.groups)) {
            const matches = computeGroupTable ? generateRoundRobin(teamIds) : generateRoundRobin(teamIds); 
            // We use generateRoundRobin imported at top
            for (let i = 0; i < matches.length; i++) {
                const m = matches[i];
                const teamA = teamMap.get(m.teamAId);
                const teamB = teamMap.get(m.teamBId);
                if (!teamA || !teamB) continue;

                await addDoc(partidosRef, {
                    eventoId: ev.id,
                    tipo: 'evento',
                    phase: ev.formato === 'league' ? 'league' : 'group',
                    group: groupName,
                    round: i + 1,
                    teamAId: m.teamAId,
                    teamBId: m.teamBId,
                    teamAName: teamA.name || 'TBD',
                    teamBName: teamB.name || 'TBD',
                    playerUids: [...(teamA.playerUids || []), ...(teamB.playerUids || [])],
                    estado: 'pendiente',
                    resultado: null,
                    ganadorTeamId: null,
                    fecha: null,
                    createdAt: serverTimestamp()
                });
            }
        }
        showToast('Ã‰XITO', 'Partidos regenerados correctamente', 'success');
    } catch (e) {
        console.error(e);
        showToast('Error', e.message, 'error');
    }
};

window.aprobarJugador = async (eventId, uid) => {
    const ev = currentEvent;
    if (!ev) return;
    const inscritos = ev.inscritos || [];
    const index = inscritos.findIndex(i => i.uid === uid);
    if (index === -1) return;
    const updated = [...inscritos];
    updated[index] = { ...updated[index], aprobado: true };
    try {
        await updateDoc(doc(db, 'eventos', eventId), { inscritos: updated });
        showToast('Jugador aprobado', '', 'success');
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

window.expulsarJugador = async (eventId, uid) => {
    if (!confirm('Â¿Expulsar a este jugador?')) return;
    const ev = currentEvent;
    if (!ev) return;
    const entry = ev.inscritos?.find(i => i.uid === uid);
    if (!entry) return;
    try {
        const updatedTeams = (ev.teams || []).map(t => {
            if (!Array.isArray(t.playerUids)) return t;
            if (!t.playerUids.includes(uid)) return t;
            const nextUids = t.playerUids.map(p => (p === uid ? null : p));
            return { ...t, playerUids: nextUids };
        });

        await updateDoc(doc(db, 'eventos', eventId), { inscritos: arrayRemove(entry), teams: updatedTeams });

        const impactedTeamIds = new Set(updatedTeams.filter(t => (t.playerUids || []).includes(null) || (t.playerUids || []).includes(uid)).map(t => t.id));
        const matchesToUpdate = eventMatches.filter(m => impactedTeamIds.has(m.teamAId) || impactedTeamIds.has(m.teamBId));
        await Promise.all(matchesToUpdate.map(async (m) => {
            const teamA = updatedTeams.find(t => t.id === m.teamAId);
            const teamB = updatedTeams.find(t => t.id === m.teamBId);
            const playerUids = [...(teamA?.playerUids || []), ...(teamB?.playerUids || [])].filter(Boolean);
            await updateDoc(doc(db, 'eventoPartidos', m.id), {
                playerUids,
                updatedAt: serverTimestamp()
            });
            if (m.linkedMatchId && m.linkedMatchCollection) {
                await updateDoc(doc(db, m.linkedMatchCollection, m.linkedMatchId), {
                    jugadores: playerUids,
                    equipoA: teamA?.playerUids || [],
                    equipoB: teamB?.playerUids || [],
                    updatedAt: serverTimestamp()
                });
            }
        }));
        showToast('Jugador eliminado', '', 'info');
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

function renderActionBar() {
    const bar = document.getElementById('ed-action-bar');
    const content = document.getElementById('ed-action-content');
    if (!bar || !content || !currentEvent) return;

    if (currentEvent.estado === 'inscripcion' && !isInscribed() && !isPending()) {
        bar.classList.remove('hidden');
        content.innerHTML = `<button class="btn-ed-primary" onclick="window.inscribirseEventoED()"><i class="fas fa-bolt"></i> SOLICITAR INSCRIPCIÃ“N</button>`;
    } else if (isPending()) {
        bar.classList.remove('hidden');
        content.innerHTML = `<div class="inscribed-badge pending"><i class="fas fa-hourglass-half"></i> Pendiente de aprobaciÃ³n</div>`;
    } else if (isInscribed() || canOrganizar()) {
        bar.classList.remove('hidden');
        content.innerHTML = `<div class="inscribed-badge"><i class="fas fa-check-circle"></i> ${isInscribed() ? 'Inscrito' : 'Modo organizador'}</div>`;
    } else {
        bar.classList.add('hidden');
    }
}

window.inscribirseEventoED = async () => {
    if (!currentUser) { showToast('Acceso requerido', 'Inicia sesiÃ³n', 'warning'); return; }
    const ev = currentEvent;
    if (!ev) return;

    if (ev.inscritos?.some(i => i.uid === currentUser.uid)) {
        showToast('Ya solicitado', 'Ya has solicitado inscripciÃ³n', 'info');
        return;
    }
    const aprobados = (ev.inscritos || []).filter(i => i.aprobado === true).length;
    if (aprobados >= (ev.plazasMax || 16)) {
        showToast('Completo', 'No quedan plazas', 'warning');
        return;
    }
    if (ev.estado !== 'inscripcion') {
        showToast('InscripciÃ³n cerrada', 'Este evento ya no acepta inscripciones.', 'warning');
        return;
    }

    const myLevel = Number(currentUserData?.nivel || 2.5);
    if (ev.nivelMin && myLevel < Number(ev.nivelMin)) {
        showToast('Nivel insuficiente', `Necesitas nivel ${ev.nivelMin} o superior`, 'warning');
        return;
    }
    if (ev.nivelMax && myLevel > Number(ev.nivelMax)) {
        showToast('Nivel superior', `Este evento es para nivel hasta ${ev.nivelMax}`, 'warning');
        return;
    }

    try {
        const pref = await showSidePreferenceModal();
        if (pref == null) return;

        let pairCode = '';
        if (ev.modalidad === 'parejas' && ev.companeroObligatorio) {
            const code = prompt('CÃ³digo de pareja (igual para ambos)', 'pareja-1');
            if (code === null) return;
            pairCode = code.trim().toLowerCase();
            if (!pairCode) { showToast('Pareja', 'Debes indicar cÃ³digo de pareja.', 'warning'); return; }
        }

        const newInscripto = {
            uid: currentUser.uid,
            nombre: currentUserData?.nombreUsuario || currentUserData?.nombre || 'Jugador',
            nivel: myLevel,
            sidePreference: pref,
            pairCode,
            inscritoEn: new Date().toISOString(),
            aprobado: false,
        };

        const evRef = doc(db, 'eventos', eventId);
        await updateDoc(evRef, { inscritos: arrayUnion(newInscripto) });

        showToast('Â¡Solicitud enviada!', 'Espera la aprobaciÃ³n del organizador', 'success');
    } catch (e) {
        console.error(e);
        showToast('Error', 'No se pudo completar la inscripciÃ³n', 'error');
    }
};

function fmtDate(d) {
    if (!d) return '-';
    const date = d.toDate ? d.toDate() : new Date(d);
    return isNaN(date) ? '-' : date.toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
window.setMatchFilter = (f) => {
    window._matchFilter = f;
    const pane = document.getElementById('pane-partidos');
    if (pane) renderMatches(pane);
};

function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        if (m === '"') return '&quot;';
        return m;
    });
}


window.proponerFechaEvento = async (matchId) => {
    const match = eventMatches.find(m => m.id === matchId);
    if (!match) return;

    let modal = document.getElementById('modal-match');
    let area = document.getElementById('match-detail-area');
    let title = document.getElementById('modal-titulo');

    if (!modal) {
        // Fallback for evento-detalle context if modal-match not present
        modal = document.getElementById('modal-match-detail-ed');
        area = modal?.querySelector('.modal-body') || document.getElementById('match-modal-body-ed');
        title = modal?.querySelector('.modal-title');
    }

    if (!modal || !area) return;

    modal.classList.add('active');
    if (title) title.textContent = "CHAT DEL PARTIDO";
    
    area.innerHTML = `
        <div class="flex-col gap-4 p-4">
            <div class="info-box-v7">
                <i class="fas fa-comments"></i>
                <p class="text-[11px] font-medium leading-relaxed">Usa este chat para proponer fechas y acordar el partido con tus rivales.</p>
            </div>
            <div id="match-chat-container">
                 <div class="center py-10"><div class="spinner-galaxy"></div></div>
            </div>
        </div>
    `;

    // Re-use match-service detail rendering which includes chat
    await renderMatchDetail(area, matchId, 'eventoPartidos', currentUser, currentUserData);
};

window.vincularPartidoCalendario = (matchId) => {
    window.location.href = `calendario.html?vincularMatchId=${matchId}`;
};
