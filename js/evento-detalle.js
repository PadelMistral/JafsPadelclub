// evento-detalle.js — Vista detallada del evento con panel organizador completo y modal para añadir jugador
import { db, auth, observerAuth, getDocument } from './firebase-service.js';
import { initAppUI, showToast, showSidePreferenceModal } from './ui-core.js';
import { doc, onSnapshot, collection, query, where, updateDoc, deleteDoc, getDocs, serverTimestamp, addDoc, arrayUnion, arrayRemove, increment, writeBatch, getDoc } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { injectHeader, injectNavbar } from './modules/ui-loader.js';
import { computeGroupTable, generateKnockoutTree, generateRoundRobin } from './event-tournament-engine.js';
import { processMatchResults } from './ranking-service.js';
import { openResultForm } from './match-service.js';

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
    } catch (e) {
        console.error('Error cargando usuarios:', e);
    }
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
                aprobado: true
            });
        }
    });
}

async function addPlayerToEvent(playerData) {
    try {
        await updateDoc(doc(db, 'eventos', eventId), {
            inscritos: arrayUnion(playerData)
        });
        showToast('Jugador añadido', playerData.nombre, 'success');
        document.getElementById('modal-add-player-detalle').classList.remove('active');
        document.getElementById('guest-name-detalle').value = '';
        document.getElementById('player-pair-code-detalle').value = '';
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
}

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
                posVal = `${idx + 1}º`;
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
                        <span class="text-[9px] text-primary font-black uppercase tracking-[2px]">Evolución en Directo</span>
                        <div class="px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20">
                            <span class="text-[10px] text-primary font-black">${pts} <small>PTS</small></span>
                        </div>
                    </div>
                    <h4 class="text-white font-black text-lg tracking-tight">${escapeHtml(myTeam.name)}</h4>
                    <div class="flex-row gap-3 mt-1">
                        <div class="flex-col">
                            <span class="text-[8px] opacity-40 uppercase font-black">Posición</span>
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
        : (ev.estado === 'inscripcion' && isPending() ? `<div class="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-500 text-[11px] font-bold text-center mt-4">Inscripción pendiente de aprobación</div>` : '');

    pane.innerHTML = `
        <div class="ed-info-card border-none bg-transparent p-0">
            ${statusCardHtml}
            
            <div class="ed-info-card">
                <h3 class="ed-info-title"><i class="fas fa-circle-info"></i> Detalles del evento</h3>
                <p class="ed-info-text mb-6 text-[11px] leading-relaxed opacity-70">${ev.descripcion || 'Sin descripción.'}</p>
                <div class="ed-info-grid">
                    <div class="ed-info-item"><i class="fas fa-calendar"></i><div><span class="ed-info-label">Inicio</span><span class="ed-info-val">${fmtDate(ev.fechaInicio)}</span></div></div>
                    <div class="ed-info-item"><i class="fas fa-hourglass-half"></i><div><span class="ed-info-label">Cierre inscripción</span><span class="ed-info-val">${fmtDate(ev.fechaInscripcion)}</span></div></div>
                    <div class="ed-info-item"><i class="fas fa-user-group"></i><div><span class="ed-info-label">Modalidad</span><span class="ed-info-val">${ev.modalidad || 'parejas'}</span></div></div>
                    <div class="ed-info-item"><i class="fas fa-diagram-project"></i><div><span class="ed-info-label">Formato</span><span class="ed-info-val">${formatLabels[ev.formato] || ev.formato}</span></div></div>
                    ${ev.repesca ? '<div class="ed-info-item"><i class="fas fa-rotate-left"></i><div><span class="ed-info-label">Repesca</span><span class="ed-info-val">Sí</span></div></div>' : ''}
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

    let html = `
        <div class="ed-info-card bg-transparent border-none p-0">
            <h3 class="ed-info-title mb-4"><i class="fas fa-users"></i> Guerreros Confirmados (${aprobados.length})</h3>
            <div class="participant-grid-v9">
                ${aprobados.map(p => `
                    <div class="p-card-v9">
                        <div class="p-card-status"></div>
                        <div class="p-card-avatar">
                            <div class="p-card-initials">${getInitials(p.nombre)}</div>
                        </div>
                        <span class="p-card-name">${escapeHtml(p.nombre)}</span>
                        <span class="p-card-level">LVL ${Number(p.nivel || 2.5).toFixed(1)}</span>
                        ${canOrganizar() ? `<button class="btn-expulsar-v9" onclick="window.expulsarJugador('${ev.id}', '${p.uid}')"><i class="fas fa-user-minus"></i></button>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    if (canOrganizar() && pendientes.length) {
        html += `
            <div class="ed-info-card mt-8">
                <h3 class="ed-info-title"><i class="fas fa-user-clock text-amber-500"></i> Solicitudes Pendientes (${pendientes.length})</h3>
                <div class="participant-grid-v9">
                    ${pendientes.map((p, idx) => `
                        <div class="p-card-v9">
                            <div class="p-card-status pending"></div>
                            <div class="p-card-initials bg-amber-500/10 text-amber-500">${getInitials(p.nombre)}</div>
                            <span class="p-card-name">${escapeHtml(p.nombre)}</span>
                            <span class="p-card-level">Lvl ${p.nivel || '?'}</span>
                            <div class="flex-row gap-1 mt-3">
                                <button class="btn btn-success btn-xs" onclick="window.aprobarJugador(${inscritos.indexOf(p)})"><i class="fas fa-check"></i></button>
                                <button class="btn btn-danger btn-xs" onclick="window.expulsarJugador('${ev.id}', '${p.uid}')"><i class="fas fa-times"></i></button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    pane.innerHTML = html;
}


function renderClasificacion(pane) {
    const ev = currentEvent;
    const teams = ev.teams || [];
    if (!teams.length) {
        pane.innerHTML = '<div class="empty-state">No hay equipos formados aún.</div>';
        return;
    }

    const teamMap = new Map(teams.map(t => [t.id, t]));
    const cfg = { win: Number(ev.puntosVictoria || 3), draw: Number(ev.puntosEmpate || 1), loss: Number(ev.puntosDerrota || 0) };

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
                        <tr><th>#</th><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>Pts</th></tr>
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
                                <td class="pts-cell"><strong>${r.pts}</strong></td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
}

function renderMatches(pane) {
    if (!eventMatches.length) {
        pane.innerHTML = `<div class="empty-state">No hay partidos generados.</div>`;
        return;
    }
    const currentUid = auth.currentUser?.uid;
    const searchVal = window._matchFilter || '';
    const isSpecialFilter = searchVal === 'mis-partidos';
    const filterQuery = isSpecialFilter ? '' : searchVal.toLowerCase();
    
    const phaseWeights = { league: 1, group: 1, knockout: 2, semi: 3, final: 4 };

    const filtered = [...eventMatches].filter(m => {
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
            ${sorted.map(m => {
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

function renderBracket(pane) {
    if (!currentEvent.bracket || !currentEvent.bracket.length) {
        pane.innerHTML = `<div class="empty-state">Aún no se ha generado el bracket de eliminatorias.</div>`;
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
    pane.innerHTML = `
        <div class="admin-panel compact-v9" style="padding-top:10px;">
            <div class="org-header-v9">
                <i class="fas fa-crown text-sport-gold"></i>
                <span>Gestión de Organizador</span>
            </div>
            
            <div class="org-grid-v9">
                <div class="org-card-v9">
                    <label><i class="fas fa-toggle-on"></i> Estado</label>
                    <select id="org-ev-state" class="input">
                        <option value="inscripcion" ${ev.estado === 'inscripcion' ? 'selected' : ''}>Inscripción</option>
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
            </div>

            <div class="org-section-v9">
                <h4><i class="fas fa-edit"></i> Grupos y Equipos</h4>
                <div id="group-editor-container" class="mt-2"></div>
                <button class="btn btn-primary btn-sm w-full mt-3" onclick="window.guardarGrupos()">Guardar Estructura</button>
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
            html += `<div class="group-team-edit">${escapeHtml(t.name)} <button class="btn-micro" onclick="window.moverEquipo('${t.id}', '${g}', '')"><i class="fas fa-arrow-right"></i></button></div>`;
        });
        html += '</div>';
    });
    // Equipos no asignados
    const assignedIds = Object.values(groups).flat();
    const unassigned = teams.filter(t => !assignedIds.includes(t.id));
    if (unassigned.length) {
        html += '<div class="group-edit-box"><h5>Sin grupo</h5>';
        unassigned.forEach(t => {
            html += `<div class="group-team-edit">${escapeHtml(t.name)} 
                <select onchange="window.moverEquipo('${t.id}', '', this.value)">
                    <option value="">Mover a...</option>
                    ${groupKeys.map(g => `<option value="${g}">Grupo ${g}</option>`).join('')}
                </select>
            </div>`;
        });
        html += '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
}

// Funciones globales para edición de grupos
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
    // Añadir al nuevo grupo
    if (!groups[newGroup]) groups[newGroup] = [];
    groups[newGroup].push(teamId);
    try {
        await updateDoc(doc(db, 'eventos', eventId), { groups });
        showToast('Grupo actualizado', '', 'success');
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

window.guardarGrupos = async () => {
    showToast('Grupos guardados', '', 'success');
};

// Función para abrir el evento (cambiar estado a activo)
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
        showToast('Configuración guardada', '', 'success');
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

window.reiniciarTorneo = async () => {
    if (!confirm('¿Reiniciar el torneo? Se perderán todos los resultados y se volverá a estado de inscripción.')) return;
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
        showToast('Torneo reiniciado', 'Volviendo a inscripción', 'success');
        setTimeout(() => window.location.reload(), 1000);
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

window.deleteEvent = async () => {
    if (!confirm('¿Eliminar evento permanentemente?')) return;
    try {
        await deleteDoc(doc(db, 'eventos', eventId));
        showToast('Evento eliminado', '', 'info');
        setTimeout(() => window.location.href = 'eventos.html', 700);
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

window.editarResultado = async (matchId) => {
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
        showToast('Fecha asignada', 'El partido aparecerá en el calendario/home', 'success');
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
    
    const played = match.estado === 'jugado';
    const isParticipant = (match.playerUids || []).includes(auth.currentUser?.uid);
    const score = typeof match.resultado === 'string' ? match.resultado : (match.resultado?.score || match.resultado?.sets || 'Sin detalle');
    
    let actionsHtml = '';
    if (canOrganizar() || (isParticipant && !played)) {
        actionsHtml = `
            <div class="flex-col gap-2 mt-4">
                <button class="btn btn-primary btn-sm w-full" onclick="window.abrirProgramacionCalendarioED('${match.id}')">
                    <i class="fas fa-calendar-plus mr-2"></i> PROGRAMAR FECHA/CALENDARIO
                </button>
                <button class="btn btn-success btn-sm w-full" onclick="window.editarResultado('${match.id}'); document.getElementById('modal-match-detail-ed').classList.remove('active');">
                    <i class="fas fa-check-circle mr-2"></i> ANOTAR RESULTADO
                </button>
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
                <button class="close-btn" onclick="this.closest('.modal-overlay').classList.remove('active')">×</button>
            </div>
            <div class="modal-body p-6">
                <div class="match-detail-v9">
                    <div class="flex-row between items-center py-4 px-2 bg-white/5 rounded-2xl border border-white/5">
                        <div class="flex-col items-center flex-1">
                            <span class="text-[10px] text-muted font-bold mb-1">EQUIPO A</span>
                            <span class="text-white font-black text-center text-sm">${escapeHtml(match.teamAName || 'TBD')}</span>
                        </div>
                        <div class="px-4 text-primary font-black text-xl italic">${played ? score : 'VS'}</div>
                        <div class="flex-col items-center flex-1">
                            <span class="text-[10px] text-muted font-bold mb-1">EQUIPO B</span>
                            <span class="text-white font-black text-center text-sm">${escapeHtml(match.teamBName || 'TBD')}</span>
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
                <button class="close-btn" onclick="this.closest('.modal-overlay').classList.remove('active')">×</button>
            </div>
            <div class="modal-body p-6">
                 <p class="text-[11px] text-muted mb-4 text-center">Selecciona cuándo se jugará el partido. Se creará automáticamente una reserva vinculada en el calendario general.</p>
                <div class="form-group mb-4">
                    <label class="form-label text-[10px] opacity-70 mb-2 block">DÍA DEL PARTIDO</label>
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
        
        // 2. Add to calendar (partidosAmistosos) if fully decided
        if (match.playerUids && match.playerUids.length >= 2) {
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
                type: 'evento'
             };
             const newMatchRef = await addDoc(collection(db, col), matchData);
             await updateDoc(doc(db, 'eventoPartidos', matchId), {
                 linkedMatchId: newMatchRef.id,
                 linkedMatchCollection: col
             });
        }
        
        hideLoading();
        showToast("¡Listo!", "Calendario actualizado y partido programado", "success");
        document.getElementById('modal-match-detail-ed').classList.remove('active');
    } catch (e) {
        hideLoading();
        showToast("Error", e.message, "error");
    }
};

window.generarFaseEliminatoria = async () => {
    if (!canOrganizar()) return;
    const ev = currentEvent;
    
    if (ev.formato === 'league') {
        showToast('Atención', 'Este formato es de liga, no tiene eliminatorias', 'info');
        return;
    }

    const pasanPorGrupo = prompt('¿Cuántos equipos pasan por grupo a la siguiente fase?', ev.equiposPorGrupo || 2);
    if (!pasanPorGrupo) return;
    const nPasan = parseInt(pasanPorGrupo);

    const groupsKeys = Object.keys(ev.groups || {});
    let clasificados = [];
    let eliminados = [];
    const teamMap = new Map((ev.teams || []).map(t => [t.id, t]));

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

    if (clasificados.length < 2) {
        showToast('Error', 'No hay suficientes equipos clasificados para generar eliminatorias', 'error');
        return;
    }

    if (!confirm(`Pasarán ${clasificados.length} equipos al bracket final y se eliminarán ${eliminados.length} equipos. ¿Estás seguro?`)) return;

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
    if (!confirm('¿Reiniciar este partido? Se borrará el resultado.')) return;
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

    if (!confirm('Esto ELIMINARÁ todos los partidos pendientes de fase liga y los volverá a crear según los grupos actuales. ¿Continuar?')) return;

    try {
        showToast('Procesando...', 'Regenerando partidos de liga', 'info');
        const partidosRef = collection(db, 'eventoPartidos');
        
        // delete all pending league/group matches for this event
        const q = query(partidosRef, where('eventoId', '==', ev.id), where('estado', '==', 'pendiente'));
        const snap = await getDocs(q);
        
        const batch = writeBatch(db);
        let deletedCount = 0;
        snap.docs.forEach(d => {
            const m = d.data();
            if (m.phase === 'league' || m.phase === 'group') {
                batch.delete(doc(db, 'eventoPartidos', d.id));
                deletedCount++;
            }
        });
        await batch.commit();

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
        showToast('ÉXITO', 'Partidos regenerados correctamente', 'success');
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
    if (!confirm('¿Expulsar a este jugador?')) return;
    const ev = currentEvent;
    if (!ev) return;
    const entry = ev.inscritos?.find(i => i.uid === uid);
    if (!entry) return;
    try {
        await updateDoc(doc(db, 'eventos', eventId), { inscritos: arrayRemove(entry) });
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
        content.innerHTML = `<button class="btn-ed-primary" onclick="window.inscribirseEventoED()"><i class="fas fa-bolt"></i> SOLICITAR INSCRIPCIÓN</button>`;
    } else if (isPending()) {
        bar.classList.remove('hidden');
        content.innerHTML = `<div class="inscribed-badge pending"><i class="fas fa-hourglass-half"></i> Pendiente de aprobación</div>`;
    } else if (isInscribed() || canOrganizar()) {
        bar.classList.remove('hidden');
        content.innerHTML = `<div class="inscribed-badge"><i class="fas fa-check-circle"></i> ${isInscribed() ? 'Inscrito' : 'Modo organizador'}</div>`;
    } else {
        bar.classList.add('hidden');
    }
}

window.inscribirseEventoED = async () => {
    if (!currentUser) { showToast('Acceso requerido', 'Inicia sesión', 'warning'); return; }
    const ev = currentEvent;
    if (!ev) return;

    if (ev.inscritos?.some(i => i.uid === currentUser.uid)) {
        showToast('Ya solicitado', 'Ya has solicitado inscripción', 'info');
        return;
    }
    const aprobados = (ev.inscritos || []).filter(i => i.aprobado === true).length;
    if (aprobados >= (ev.plazasMax || 16)) {
        showToast('Completo', 'No quedan plazas', 'warning');
        return;
    }
    if (ev.estado !== 'inscripcion') {
        showToast('Inscripción cerrada', 'Este evento ya no acepta inscripciones.', 'warning');
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
            const code = prompt('Código de pareja (igual para ambos)', 'pareja-1');
            if (code === null) return;
            pairCode = code.trim().toLowerCase();
            if (!pairCode) { showToast('Pareja', 'Debes indicar código de pareja.', 'warning'); return; }
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

        showToast('¡Solicitud enviada!', 'Espera la aprobación del organizador', 'success');
    } catch (e) {
        console.error(e);
        showToast('Error', 'No se pudo completar la inscripción', 'error');
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