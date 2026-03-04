// eventos.js — Events System V5.0 — Liga · Eliminatorias · Admin
// ──────────────────────────────────────────────────────────────
import { db, auth, observerAuth, getDocument, addDocument, updateDocument } from './firebase-service.js';
import { initAppUI, showToast } from './ui-core.js';
import {
    collection, getDocs, doc, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, serverTimestamp, onSnapshot, writeBatch
} from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';

initAppUI('events');

/* ────────────────────────────────────────────────────────
   STATE
   ──────────────────────────────────────────────────────── */
let currentUser = null;
let currentUserData = null;
let allEvents = [];
let currentFilter = 'all';
let activeEventId = null;   // for admin modal
let adminTabState = 'players';

/* ────────────────────────────────────────────────────────
   BOOT
   ──────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    observerAuth(async (user) => {
        if (!user) return;
        currentUser = user;
        currentUserData = await getDocument('usuarios', user.uid);
        const isAdmin = currentUserData?.rol === 'Admin';
        const isOrganizer = isAdmin || currentUserData?.esOrganizador === true;

        if (isOrganizer) {
            document.getElementById('btn-create-event')?.classList.remove('hidden');
        }

        setupFilters();
        setupCreateModal();
        subscribeEvents();
    });
});

/* ────────────────────────────────────────────────────────
   FILTERS
   ──────────────────────────────────────────────────────── */
function setupFilters() {
    document.querySelectorAll('.evf-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.evf-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderEvents();
        });
    });
}

/* ────────────────────────────────────────────────────────
   REALTIME SUBSCRIPTION
   ──────────────────────────────────────────────────────── */
function subscribeEvents() {
    const q = query(collection(db, 'eventos'), orderBy('createdAt', 'desc'));
    onSnapshot(q, snap => {
        allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderEvents();
    }, err => {
        console.error('Events error:', err);
        renderFallback();
    });
}

/* ────────────────────────────────────────────────────────
   RENDER LIST
   ──────────────────────────────────────────────────────── */
function renderEvents() {
    const container = document.getElementById('events-container');
    if (!container) return;

    let events = [...allEvents];
    if (currentFilter === 'active') {
        events = events.filter(e => e.estado === 'activo' || e.estado === 'inscripcion');
    } else if (currentFilter !== 'all') {
        events = events.filter(e => e.formato === currentFilter);
    }

    if (!events.length) {
        container.innerHTML = `
          <div class="events-empty">
            <i class="fas fa-calendar-xmark"></i>
            <h3>Sin eventos</h3>
            <p>No hay eventos en esta categoría. ¡Sé el primero en generar uno!</p>
          </div>`;
        return;
    }

    container.innerHTML = events.map((ev, i) => buildEventCard(ev, i)).join('');
}

function renderFallback() {
    const container = document.getElementById('events-container');
    if (!container) return;
    container.innerHTML = `
      <div class="events-empty">
        <i class="fas fa-wifi-slash"></i>
        <h3>Sin conexión</h3>
        <p>Comprueba tu conexión e inténtalo de nuevo.</p>
      </div>`;
}

/* ────────────────────────────────────────────────────────
   BUILD EVENT CARD
   ──────────────────────────────────────────────────────── */
function buildEventCard(ev, idx) {
    const formatMap = {
        league:          { label: 'LIGA',         icon: 'fa-table-list',  color: 'cyan'   },
        knockout:        { label: 'ELIMINATORIA', icon: 'fa-sitemap',     color: 'magenta' },
        league_knockout: { label: 'LIGA + ELIM.', icon: 'fa-star',        color: 'gold'   },
    };
    const fmt = formatMap[ev.formato] || { label: 'EVENTO', icon: 'fa-trophy', color: 'cyan' };

    const stateMap = {
        draft:       { label: 'BORRADOR',     cls: 'state-draft'    },
        inscripcion: { label: 'INSCRIPCIONES',cls: 'state-open'     },
        activo:      { label: 'EN CURSO',     cls: 'state-active'   },
        finalizado:  { label: 'FINALIZADO',   cls: 'state-done'     },
        cancelado:   { label: 'CANCELADO',    cls: 'state-cancelled'},
    };
    const st = stateMap[ev.estado] || { label: ev.estado || 'BORRADOR', cls: 'state-draft' };

    const deadline = ev.fechaInscripcion?._seconds
        ? new Date(ev.fechaInscripcion._seconds * 1000)
        : ev.fechaInscripcion ? new Date(ev.fechaInscripcion) : null;
    const startDate = ev.fechaInicio?._seconds
        ? new Date(ev.fechaInicio._seconds * 1000)
        : ev.fechaInicio ? new Date(ev.fechaInicio) : null;

    const slots = Number(ev.plazasMax || 16);
    const filled = Array.isArray(ev.inscritos) ? ev.inscritos.length : 0;
    const pct = Math.min(100, Math.round((filled / slots) * 100));
    const isAdmin = currentUserData?.rol === 'Admin';
    const isOrganizer = isAdmin || ev.organizadorId === currentUser?.uid;
    const isInscribed = Array.isArray(ev.inscritos) && ev.inscritos.some(i => i.uid === currentUser?.uid);

    return `
    <article class="event-card-v3 animate-up" style="animation-delay:${idx * 0.06}s" data-id="${ev.id}">
        <div class="ev-card-header ${fmt.color}">
            <div class="ev-format-badge">
                <i class="fas ${fmt.icon}"></i> ${fmt.label}
            </div>
            <span class="ev-state-badge ${st.cls}">${st.label}</span>
        </div>

        <div class="ev-card-body">
            <h3 class="ev-title">${ev.nombre || 'Sin nombre'}</h3>
            <p class="ev-desc">${ev.descripcion || ''}</p>

            <div class="ev-stats-grid">
                <div class="ev-stat">
                    <i class="fas fa-users"></i>
                    <span><b>${filled}/${slots}</b> parejas</span>
                </div>
                ${ev.premio ? `<div class="ev-stat"><i class="fas fa-trophy text-sport-gold"></i><span><b>${ev.premio}</b></span></div>` : ''}
                ${deadline ? `<div class="ev-stat"><i class="fas fa-hourglass-half text-sport-red"></i><span>Inscr. hasta: <b>${fmtDate(deadline)}</b></span></div>` : ''}
                ${startDate ? `<div class="ev-stat"><i class="fas fa-flag-checkered text-primary"></i><span>Inicio: <b>${fmtDate(startDate)}</b></span></div>` : ''}
                ${ev.nivelMin || ev.nivelMax ? `<div class="ev-stat"><i class="fas fa-sliders text-cyan"></i><span>Nivel: <b>${ev.nivelMin || '—'}–${ev.nivelMax || '—'}</b></span></div>` : ''}
            </div>

            <div class="ev-progress-wrap">
                <div class="ev-progress-bar">
                    <div class="ev-progress-fill ${pct >= 100 ? 'full' : ''}" style="width:${pct}%"></div>
                </div>
                <span class="ev-progress-label">${pct}% ocupado</span>
            </div>

            <div class="ev-card-footer">
                <button class="btn-ev-detail" onclick="window.location.href='evento-detalle.html?id=${ev.id}'">
                    <i class="fas fa-eye"></i> Ver
                </button>
                ${!isInscribed && ev.estado === 'inscripcion' ? `
                    <button class="btn-ev-join" onclick="window.inscribirseEvento('${ev.id}')">
                        <i class="fas fa-bolt"></i> Inscribirse
                    </button>` : ''}
                ${isInscribed ? `<span class="ev-enrolled-badge"><i class="fas fa-check-circle"></i> Inscrito</span>` : ''}
                ${isOrganizer ? `
                    <button class="btn-ev-admin" onclick="window.location.href='evento-detalle.html?id=${ev.id}&admin=1'">
                        <i class="fas fa-shield-halved"></i>
                    </button>` : ''}
            </div>
        </div>
    </article>`;
}

/* ────────────────────────────────────────────────────────
   DETAIL MODAL
   ──────────────────────────────────────────────────────── */
window.openEventDetail = async (eventId) => {
    const ev = allEvents.find(e => e.id === eventId);
    if (!ev) return;
    document.getElementById('ev-detail-title').textContent = ev.nombre || 'Evento';
    const formatLabels = {
        league: 'Liga', knockout: 'Eliminatoria directa', league_knockout: 'Liga + Eliminatoria'
    };
    document.getElementById('ev-detail-format-badge').textContent = formatLabels[ev.formato] || ev.formato;

    const body = document.getElementById('ev-detail-body');

    // Load inscriptions
    const inscritos = Array.isArray(ev.inscritos) ? ev.inscritos : [];
    const isInscribed = inscritos.some(i => i.uid === currentUser?.uid);

    // Build standings if league
    let standingHTML = '';
    if (ev.formato === 'league' || ev.formato === 'league_knockout') {
        const standings = await loadStandings(eventId);
        standingHTML = renderStandingTable(standings);
    }

    // Build bracket if knockout
    let bracketHTML = '';
    if (ev.formato === 'knockout' || ev.formato === 'league_knockout') {
        const bracket = ev.bracket || [];
        bracketHTML = renderBracket(bracket);
    }

    body.innerHTML = `
        <div class="ev-detail-tabs">
            <button class="ev-dtab active" data-dtab="info" onclick="switchDetailTab('info',this)">Info</button>
            <button class="ev-dtab" data-dtab="players" onclick="switchDetailTab('players',this)">Inscripciones</button>
            ${standingHTML ? `<button class="ev-dtab" data-dtab="standing" onclick="switchDetailTab('standing',this)">Clasificación</button>` : ''}
            ${bracketHTML ? `<button class="ev-dtab" data-dtab="bracket" onclick="switchDetailTab('bracket',this)">Bracket</button>` : ''}
        </div>

        <div id="dtab-info" class="ev-dtab-panel active p-4 flex-col gap-3">
            ${buildDetailInfo(ev)}
        </div>

        <div id="dtab-players" class="ev-dtab-panel hidden p-4">
            ${buildPlayersList(inscritos)}
        </div>

        ${standingHTML ? `
        <div id="dtab-standing" class="ev-dtab-panel hidden p-4">
            ${standingHTML}
        </div>` : ''}

        ${bracketHTML ? `
        <div id="dtab-bracket" class="ev-dtab-panel hidden p-4 overflow-x-auto">
            ${bracketHTML}
        </div>` : ''}

        <div class="p-4 border-t border-white/5">
            ${!isInscribed && ev.estado === 'inscripcion' ? `
                <button class="btn btn-primary w-full" onclick="window.inscribirseEvento('${ev.id}')">
                    <i class="fas fa-bolt mr-1"></i> INSCRIBIRSE AHORA
                </button>` : ''}
            ${isInscribed ? `
                <div class="flex-row items-center gap-2 p-3 rounded-xl bg-sport-green/10 border border-sport-green/20">
                    <i class="fas fa-check-circle text-sport-green"></i>
                    <span class="text-[11px] font-bold text-sport-green">Ya estás inscrito en este evento</span>
                    <button class="ml-auto text-[9px] text-sport-red/80 hover:text-sport-red font-bold uppercase" onclick="window.cancelInscripcion('${ev.id}')">Cancelar</button>
                </div>` : ''}
        </div>
    `;

    document.getElementById('modal-event-detail').classList.add('active');
};

function buildDetailInfo(ev) {
    const deadline = ev.fechaInscripcion?._seconds ? new Date(ev.fechaInscripcion._seconds*1000) : ev.fechaInscripcion ? new Date(ev.fechaInscripcion) : null;
    const startDate = ev.fechaInicio?._seconds ? new Date(ev.fechaInicio._seconds*1000) : ev.fechaInicio ? new Date(ev.fechaInicio) : null;
    const slots = Number(ev.plazasMax || 16);
    const filled = Array.isArray(ev.inscritos) ? ev.inscritos.length : 0;

    return `
        <p class="text-[12px] text-white/70 leading-relaxed">${ev.descripcion || 'Sin descripción.'}</p>
        <div class="ev-info-grid">
            <div class="ev-info-item"><i class="fas fa-users text-primary"></i><div><span class="label">Plazas</span><span class="val">${filled}/${slots}</span></div></div>
            ${ev.premio ? `<div class="ev-info-item"><i class="fas fa-trophy text-sport-gold"></i><div><span class="label">Premio</span><span class="val">${ev.premio}</span></div></div>` : ''}
            ${deadline ? `<div class="ev-info-item"><i class="fas fa-hourglass-half text-sport-red"></i><div><span class="label">Fin inscripción</span><span class="val">${fmtDate(deadline)}</span></div></div>` : ''}
            ${startDate ? `<div class="ev-info-item"><i class="fas fa-flag-checkered text-primary"></i><div><span class="label">Inicio</span><span class="val">${fmtDate(startDate)}</span></div></div>` : ''}
            ${ev.nivelMin || ev.nivelMax ? `<div class="ev-info-item"><i class="fas fa-sliders text-cyan"></i><div><span class="label">Nivel req.</span><span class="val">${ev.nivelMin||'1.0'}–${ev.nivelMax||'7.0'}</span></div></div>` : ''}
            ${ev.modalidad === 'parejas' ? `<div class="ev-info-item"><i class="fas fa-handshake text-cyan"></i><div><span class="label">Modalidad</span><span class="val">Parejas${ev.companeroObligatorio ? ' (pareja obligatoria)' : ''}</span></div></div>` : ''}
        </div>
        <div class="ev-points-info">
            <span class="text-[9px] font-bold text-muted uppercase tracking-widest">Sistema de puntos</span>
            <div class="flex-row gap-3 mt-1">
                <span class="ev-pts-badge win">✓ ${ev.puntosVictoria || 3} pts</span>
                <span class="ev-pts-badge draw">= ${ev.puntosEmpate || 1} pts</span>
                <span class="ev-pts-badge lose">✗ ${ev.puntosDerrota || 0} pts</span>
            </div>
        </div>`;
}

function buildPlayersList(inscritos) {
    if (!inscritos.length) return `<p class="text-center text-muted text-[12px] py-8">Sin inscripciones todavía.</p>`;
    return `
        <div class="ev-players-list">
            ${inscritos.map((ins, i) => `
            <div class="ev-player-row">
                <span class="ev-player-rank">#${i+1}</span>
                <div class="flex-col flex-1">
                    <span class="font-bold text-[12px]">${ins.nombre || ins.uid}</span>
                    ${ins.companero ? `<span class="text-[10px] text-muted">+ ${ins.companero}</span>` : ''}
                </div>
                <span class="text-[10px] text-muted">${fmtDate(ins.inscritoEn?._seconds ? new Date(ins.inscritoEn._seconds*1000) : new Date())}</span>
            </div>`).join('')}
        </div>`;
}

async function loadStandings(eventId) {
    try {
        const snap = await window.getDocsSafe(query(
            collection(db, 'eventoClasificacion'),
            where('eventoId', '==', eventId),
            orderBy('puntos', 'desc'), orderBy('diferencia', 'desc')
        ));
        return snap.docs.map(d => d.data());
    } catch { return []; }
}

function renderStandingTable(standings) {
    if (!standings.length) return `<p class="text-center text-muted text-[12px] py-8">La clasificación aún no está disponible.</p>`;
    return `
      <div class="ev-standing-table">
        <div class="ev-standing-head">
          <span>#</span><span>Pareja</span><span>PJ</span><span>G</span><span>P</span><span>Pts</span>
        </div>
        ${standings.map((s, i) => `
        <div class="ev-standing-row ${i < 2 ? 'top' : i < 4 ? 'playoff' : ''}">
          <span class="ev-rank-num">${i+1}</span>
          <span class="ev-team-name">${s.nombre || '-'}</span>
          <span>${s.pj||0}</span><span>${s.ganados||0}</span><span>${s.perdidos||0}</span>
          <span class="font-black text-primary">${s.puntos||0}</span>
        </div>`).join('')}
      </div>`;
}

function renderBracket(rounds = []) {
    if (!rounds.length) return `<p class="text-center text-muted text-[12px] py-8">El bracket aún no está generado.</p>`;
    return `
      <div class="bracket-wrap">
        ${rounds.map((round, ri) => `
        <div class="bracket-round">
          <div class="bracket-round-label">Ronda ${ri+1}</div>
          ${round.map(match => `
          <div class="bracket-match ${match.winner ? 'played' : ''}">
            <div class="bracket-team ${match.winner === 'A' ? 'winner' : match.winner ? 'loser' : ''}">${match.teamA || '?'}</div>
            <div class="bracket-vs">VS</div>
            <div class="bracket-team ${match.winner === 'B' ? 'winner' : match.winner ? 'loser' : ''}">${match.teamB || '?'}</div>
            ${match.resultado ? `<div class="bracket-result">${match.resultado}</div>` : ''}
          </div>`).join('')}
        </div>`).join('')}
      </div>`;
}

window.switchDetailTab = (tab, btn) => {
    document.querySelectorAll('.ev-dtab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.ev-dtab-panel').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`dtab-${tab}`)?.classList.remove('hidden');
};

/* ────────────────────────────────────────────────────────
   INSCRIPCIÓN
   ──────────────────────────────────────────────────────── */
window.inscribirseEvento = async (eventId) => {
    if (!currentUser) { showToast('Acceso requerido', 'Inicia sesión', 'warning'); return; }
    const ev = allEvents.find(e => e.id === eventId);
    if (!ev) return;

    const isInscribed = Array.isArray(ev.inscritos) && ev.inscritos.some(i => i.uid === currentUser.uid);
    if (isInscribed) { showToast('Ya inscrito', 'Ya estás en este evento', 'info'); return; }

    const slots = Number(ev.plazasMax || 16);
    const filled = Array.isArray(ev.inscritos) ? ev.inscritos.length : 0;
    if (filled >= slots) { showToast('Completo', 'No quedan plazas disponibles', 'warning'); return; }

    // Level check
    const myLevel = Number(currentUserData?.nivel || 2.5);
    if (ev.nivelMin && myLevel < Number(ev.nivelMin)) {
        showToast('Nivel insuficiente', `Necesitas nivel ${ev.nivelMin} o superior`, 'warning'); return;
    }
    if (ev.nivelMax && myLevel > Number(ev.nivelMax)) {
        showToast('Nivel superior', `Este evento es para nivel hasta ${ev.nivelMax}`, 'warning'); return;
    }

    try {
        const newInscripto = {
            uid: currentUser.uid,
            nombre: currentUserData?.nombreUsuario || currentUserData?.nombre || 'Jugador',
            nivel: myLevel,
            inscritoEn: serverTimestamp(),
        };

        const evRef = doc(db, 'eventos', eventId);
        const { arrayUnion } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js');
        await updateDoc(evRef, { inscritos: arrayUnion(newInscripto) });

        // Add to event's clasificacion collection if league
        if (ev.formato === 'league' || ev.formato === 'league_knockout') {
            await setDoc(doc(db, 'eventoClasificacion', `${eventId}_${currentUser.uid}`), {
                eventoId: eventId,
                uid: currentUser.uid,
                nombre: newInscripto.nombre,
                pj: 0, ganados: 0, perdidos: 0, empates: 0,
                puntos: 0, diferencia: 0,
            }, { merge: true });
        }

        showToast('¡Inscrito!', `Te has unido a "${ev.nombre}"`, 'success');
        document.getElementById('modal-event-detail')?.classList.remove('active');
    } catch (e) {
        console.error(e);
        showToast('Error', 'No se pudo completar la inscripción', 'error');
    }
};

window.cancelInscripcion = async (eventId) => {
    if (!confirm('¿Cancelar tu inscripción en este evento?')) return;
    const ev = allEvents.find(e => e.id === eventId);
    if (!ev) return;
    const myEntry = ev.inscritos.find(i => i.uid === currentUser.uid);
    if (!myEntry) return;
    try {
        const { arrayRemove } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js');
        await updateDoc(doc(db, 'eventos', eventId), { inscritos: arrayRemove(myEntry) });
        showToast('Inscripción cancelada', '', 'info');
        document.getElementById('modal-event-detail')?.classList.remove('active');
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

/* ────────────────────────────────────────────────────────
   CREATE EVENT MODAL
   ──────────────────────────────────────────────────────── */
function setupCreateModal() {
    document.getElementById('btn-create-event')?.addEventListener('click', () => {
        document.getElementById('modal-create-event').classList.add('active');
    });

    // Format selector
    document.querySelectorAll('.ev-format-opt').forEach(opt => {
        opt.addEventListener('click', () => {
            document.querySelectorAll('.ev-format-opt .format-card').forEach(c => c.classList.remove('active'));
            opt.querySelector('.format-card').classList.add('active');
            const fmt = opt.dataset.format;
            const leagueWrap = document.getElementById('ev-league-points-wrap');
            if (leagueWrap) {
                leagueWrap.style.display = (fmt === 'knockout') ? 'none' : 'block';
            }
        });
    });

    // Mode tabs
    document.querySelectorAll('.ev-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.ev-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const partnerWrap = document.getElementById('ev-partner-required-wrap');
            if (partnerWrap) {
                partnerWrap.style.display = btn.dataset.mode === 'parejas' ? 'block' : 'none';
            }
        });
    });

    document.getElementById('btn-save-event')?.addEventListener('click', saveNewEvent);
}

async function saveNewEvent() {
    const nombre = document.getElementById('ev-name')?.value.trim();
    if (!nombre) { showToast('Campo requerido', 'El nombre del evento es obligatorio', 'warning'); return; }

    const formato = document.querySelector('input[name="ev-format"]:checked')?.value || 'league_knockout';
    const modalidad = document.querySelector('.ev-mode-btn.active')?.dataset.mode || 'parejas';
    const companeroObligatorio = document.getElementById('ev-partner-required')?.checked ?? true;
    const regDeadlineStr = document.getElementById('ev-reg-deadline')?.value;
    const startDateStr = document.getElementById('ev-start-date')?.value;
    const plazasMax = Number(document.getElementById('ev-max-slots')?.value || 16);
    const premio = document.getElementById('ev-prize')?.value.trim() || '';
    const nivelMin = document.getElementById('ev-level-min')?.value || '';
    const nivelMax = document.getElementById('ev-level-max')?.value || '';
    const puntosVictoria = Number(document.getElementById('ev-pts-win')?.value || 3);
    const puntosEmpate = Number(document.getElementById('ev-pts-draw')?.value || 1);
    const puntosDerrota = Number(document.getElementById('ev-pts-loss')?.value || 0);
    const descripcion = document.getElementById('ev-description')?.value.trim() || '';

    const btn = document.getElementById('btn-save-event');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i> Guardando...';

    try {
        const payload = {
            nombre,
            descripcion,
            formato,
            modalidad,
            companeroObligatorio,
            plazasMax,
            premio,
            nivelMin: nivelMin ? Number(nivelMin) : null,
            nivelMax: nivelMax ? Number(nivelMax) : null,
            puntosVictoria,
            puntosEmpate,
            puntosDerrota,
            estado: 'inscripcion',
            inscritos: [],
            bracket: [],
            organizadorId: currentUser.uid,
            organizadorNombre: currentUserData?.nombreUsuario || currentUserData?.nombre || 'Admin',
            createdAt: serverTimestamp(),
        };

        if (regDeadlineStr) payload.fechaInscripcion = new Date(regDeadlineStr);
        if (startDateStr)   payload.fechaInicio      = new Date(startDateStr);

        const newEvId = await addDocument('eventos', payload);
        showToast('¡Evento creado!', `"${nombre}" ya está publicado`, 'success');
        document.getElementById('modal-create-event').classList.remove('active');
        
        // Redirección inmediata a la nueva página del evento
        setTimeout(() => {
            window.location.href = `evento-detalle.html?id=${newEvId}`;
        }, 1200);
    } catch (e) {
        console.error(e);
        showToast('Error al crear', e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rocket mr-1"></i> Publicar Evento';
    }
}

/* ────────────────────────────────────────────────────────
   EVENT ADMIN MODAL
   ──────────────────────────────────────────────────────── */
window.openEventAdmin = async (eventId) => {
    activeEventId = eventId;
    const ev = allEvents.find(e => e.id === eventId);
    if (!ev) return;

    document.getElementById('ev-admin-name').textContent = ev.nombre || 'Evento';
    document.getElementById('modal-event-admin').classList.add('active');

    // Bind admin tabs
    document.querySelectorAll('.ev-admin-tab').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.ev-admin-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            adminTabState = btn.dataset.tab;
            renderAdminTab(ev, adminTabState);
        };
    });

    renderAdminTab(ev, 'players');
};

async function renderAdminTab(ev, tab) {
    const body = document.getElementById('ev-admin-body');
    if (!body) return;

    switch (tab) {
        case 'players':
            body.innerHTML = renderAdminPlayers(ev);
            break;
        case 'matches':
            body.innerHTML = await renderAdminMatches(ev);
            break;
        case 'standing':
            const standings = await loadStandings(ev.id);
            body.innerHTML = renderStandingTable(standings);
            break;
        case 'bracket':
            body.innerHTML = renderBracket(ev.bracket || []);
            break;
        case 'settings':
            body.innerHTML = renderAdminSettings(ev);
            setupAdminSettingsListeners(ev);
            break;
    }
}

function renderAdminPlayers(ev) {
    const inscritos = Array.isArray(ev.inscritos) ? ev.inscritos : [];
    if (!inscritos.length) {
        return `<p class="text-center text-muted text-[12px] py-8">Sin inscripciones todavía.</p>`;
    }
    return `
    <div class="flex-col gap-2">
        <div class="flex-row between items-center mb-2">
            <span class="text-[11px] font-bold text-muted">${inscritos.length} inscrito(s)</span>
            ${ev.estado === 'inscripcion' ? `
            <button class="btn-mini" onclick="window.generarClasificacionInicial('${ev.id}')">
                <i class="fas fa-play mr-1"></i> Iniciar Evento
            </button>` : ''}
        </div>
        ${inscritos.map((ins, i) => `
        <div class="ev-admin-player-row">
            <span class="ev-player-rank">#${i+1}</span>
            <div class="flex-col flex-1">
                <span class="font-bold text-[12px]">${ins.nombre || ins.uid}</span>
                ${ins.companero ? `<span class="text-[10px] text-muted">Pareja: ${ins.companero}</span>` : ''}
            </div>
            <button class="btn-micro danger" onclick="window.expulsarJugador('${ev.id}','${ins.uid}')">
                <i class="fas fa-user-minus"></i>
            </button>
        </div>`).join('')}
        <button class="btn-mini w-full mt-3" onclick="window.addManualPlayer('${ev.id}')">
            <i class="fas fa-user-plus mr-1"></i> Añadir jugador manualmente
        </button>
    </div>`;
}

async function renderAdminMatches(ev) {
    try {
        const snap = await window.getDocsSafe(query(
            collection(db, 'eventoPartidos'),
            where('eventoId', '==', ev.id),
            orderBy('ronda', 'asc')
        ));
        const matches = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (!matches.length) {
            return `
            <div class="flex-col gap-3">
                <p class="text-center text-muted text-[12px]">Sin partidos generados.</p>
                <button class="btn-mini w-full" onclick="window.generarPartidos('${ev.id}')">
                    <i class="fas fa-sitemap mr-1"></i> Generar Partidos
                </button>
            </div>`;
        }

        return `
        <div class="flex-col gap-3">
            <button class="btn-mini mb-2" onclick="window.addManualMatch('${ev.id}')">
                <i class="fas fa-plus mr-1"></i> Añadir partido
            </button>
            ${matches.map(m => `
            <div class="ev-admin-match-row">
                <div class="flex-col flex-1">
                    <span class="font-bold text-[12px]">${m.equipoA || '?'} vs ${m.equipoB || '?'}</span>
                    <span class="text-[10px] text-muted">Ronda ${m.ronda||1}</span>
                </div>
                <div class="flex-row items-center gap-2">
                    ${m.resultado ? `<span class="text-[11px] font-black text-primary">${m.resultado}</span>` : ''}
                    <button class="btn-micro" onclick="window.editMatchResult('${ev.id}','${m.id}')">
                        <i class="fas fa-pen"></i>
                    </button>
                </div>
            </div>`).join('')}
        </div>`;
    } catch {
        return `<p class="text-[12px] text-sport-red py-4">Error cargando partidos.</p>`;
    }
}

function renderAdminSettings(ev) {
    const stateOptions = ['draft', 'inscripcion', 'activo', 'finalizado', 'cancelado'];
    return `
    <div class="flex-col gap-4">
        <div class="form-group">
            <label class="form-label">Estado del evento</label>
            <select id="admin-ev-state" class="input">
                ${stateOptions.map(s => `<option value="${s}" ${ev.estado === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
        </div>
        <div class="form-group">
            <label class="form-label">Premio</label>
            <input type="text" id="admin-ev-prize" class="input" value="${ev.premio || ''}">
        </div>
        <div class="form-row-2">
            <div class="form-group">
                <label class="form-label">Plazas máx.</label>
                <input type="number" id="admin-ev-slots" class="input" value="${ev.plazasMax || 16}">
            </div>
            <div class="form-group">
                <label class="form-label">Pts/Victoria</label>
                <input type="number" id="admin-ev-ptswin" class="input" value="${ev.puntosVictoria || 3}">
            </div>
        </div>
        <button id="btn-admin-save-settings" class="btn btn-primary w-full">
            <i class="fas fa-save mr-1"></i> Guardar cambios
        </button>
        <div class="mt-2 border-t border-white/5 pt-3">
            <button class="btn btn-ghost w-full text-sport-red/80 hover:text-sport-red" onclick="window.deleteEvent('${ev.id}')">
                <i class="fas fa-trash mr-1"></i> Eliminar evento
            </button>
        </div>
    </div>`;
}

function setupAdminSettingsListeners(ev) {
    document.getElementById('btn-admin-save-settings')?.addEventListener('click', async () => {
        const state = document.getElementById('admin-ev-state')?.value;
        const prize = document.getElementById('admin-ev-prize')?.value;
        const slots = Number(document.getElementById('admin-ev-slots')?.value);
        const ptsWin = Number(document.getElementById('admin-ev-ptswin')?.value);
        try {
            await updateDoc(doc(db, 'eventos', ev.id), {
                estado: state, premio: prize, plazasMax: slots, puntosVictoria: ptsWin
            });
            showToast('Guardado', 'Configuración actualizada', 'success');
        } catch (e) { showToast('Error', e.message, 'error'); }
    });
}

/* ─── Admin Actions ─── */

window.expulsarJugador = async (eventId, uid) => {
    if (!confirm('¿Expulsar a este jugador del evento?')) return;
    const ev = allEvents.find(e => e.id === eventId);
    if (!ev) return;
    const entry = ev.inscritos.find(i => i.uid === uid);
    if (!entry) return;
    try {
        const { arrayRemove } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js');
        await updateDoc(doc(db, 'eventos', eventId), { inscritos: arrayRemove(entry) });
        showToast('Jugador expulsado', '', 'info');
        renderAdminTab(allEvents.find(e => e.id === eventId), 'players');
    } catch (e) { showToast('Error', e.message, 'error'); }
};

window.generarClasificacionInicial = async (eventId) => {
    if (!confirm('¿Iniciar el evento y generar la clasificación?')) return;
    try {
        await updateDoc(doc(db, 'eventos', eventId), { estado: 'activo' });
        showToast('Evento iniciado', 'Estado actualizado a ACTIVO', 'success');
    } catch (e) { showToast('Error', e.message, 'error'); }
};

window.generarPartidos = async (eventId) => {
    const ev = allEvents.find(e => e.id === eventId);
    if (!ev || !Array.isArray(ev.inscritos) || ev.inscritos.length < 2) {
        showToast('Insuficientes jugadores', 'Necesitas al menos 2 equipos inscritos', 'warning');
        return;
    }
    try {
        const teams = [...ev.inscritos];
        if (ev.formato === 'league' || ev.formato === 'league_knockout') {
            await generateLeagueMatches(eventId, teams, ev);
        } else {
            await generateKnockoutBracket(eventId, teams, ev);
        }
        showToast('Partidos generados', '¡Calendario listo!', 'success');
        renderAdminTab(ev, 'matches');
    } catch (e) {
        console.error(e);
        showToast('Error', e.message, 'error');
    }
};

async function generateLeagueMatches(eventId, teams, ev) {
    const batch = writeBatch(db);
    let roundNum = 1;
    for (let i = 0; i < teams.length; i++) {
        for (let j = i + 1; j < teams.length; j++) {
            const matchRef = doc(collection(db, 'eventoPartidos'));
            batch.set(matchRef, {
                eventoId: eventId,
                ronda: roundNum,
                equipoA: teams[i].nombre,
                equipoAUid: teams[i].uid,
                equipoB: teams[j].nombre,
                equipoBUid: teams[j].uid,
                resultado: null,
                ganador: null,
                estado: 'pendiente',
                createdAt: serverTimestamp(),
            });
            roundNum++;
        }
    }
    await batch.commit();
}

async function generateKnockoutBracket(eventId, teams, ev) {
    // Shuffle teams
    const shuffled = [...teams].sort(() => Math.random() - 0.5);
    const pairs = [];
    for (let i = 0; i < shuffled.length - 1; i += 2) {
        pairs.push([shuffled[i], shuffled[i + 1]]);
    }
    const batch = writeBatch(db);
    pairs.forEach((pair, idx) => {
        const matchRef = doc(collection(db, 'eventoPartidos'));
        batch.set(matchRef, {
            eventoId: eventId,
            ronda: 1,
            posicionBracket: idx,
            equipoA: pair[0].nombre,
            equipoAUid: pair[0].uid,
            equipoB: pair[1].nombre,
            equipoBUid: pair[1].uid,
            resultado: null,
            ganador: null,
            estado: 'pendiente',
            createdAt: serverTimestamp(),
        });
    });
    await batch.commit();
}

window.editMatchResult = async (eventId, matchId) => {
    const resultado = prompt('Introduce el resultado (ej: 6-3 6-4):');
    if (!resultado) return;
    const ganador = prompt('¿Quién ganó? (A o B):')?.toUpperCase();
    if (ganador !== 'A' && ganador !== 'B') { showToast('Ganador inválido', 'Escribe A o B', 'warning'); return; }
    try {
        await updateDoc(doc(db, 'eventoPartidos', matchId), {
            resultado, ganador, estado: 'jugado',
        });

        // Update standings if league
        const ev = allEvents.find(e => e.id === eventId);
        if (ev && (ev.formato === 'league' || ev.formato === 'league_knockout')) {
            const matchSnap = await window.getDocsSafe(query(
                collection(db, 'eventoPartidos'), where('__name__', '==', matchId)
            ));
            // simplified: update winner points
            const match = matchSnap.docs[0]?.data();
            if (match) {
                const winnerUid = ganador === 'A' ? match.equipoAUid : match.equipoBUid;
                const loserUid  = ganador === 'A' ? match.equipoBUid : match.equipoAUid;
                const winKey  = `${eventId}_${winnerUid}`;
                const loseKey = `${eventId}_${loserUid}`;
                const { increment } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js');
                const b = writeBatch(db);
                b.update(doc(db, 'eventoClasificacion', winKey),  { pj: increment(1), ganados: increment(1), puntos: increment(ev.puntosVictoria || 3) });
                b.update(doc(db, 'eventoClasificacion', loseKey), { pj: increment(1), perdidos: increment(1), puntos: increment(ev.puntosDerrota || 0) });
                await b.commit();
            }
        }
        showToast('Resultado guardado', '', 'success');
        renderAdminTab(ev || {}, 'matches');
    } catch (e) { showToast('Error', e.message, 'error'); }
};

window.deleteEvent = async (eventId) => {
    if (!confirm('¿Eliminar este evento permanentemente? Esta acción no se puede deshacer.')) return;
    try {
        await deleteDoc(doc(db, 'eventos', eventId));
        showToast('Evento eliminado', '', 'info');
        document.getElementById('modal-event-admin')?.classList.remove('active');
    } catch (e) { showToast('Error', e.message, 'error'); }
};

window.addManualPlayer = async (eventId) => {
    const nombre = prompt('Nombre del jugador a añadir:');
    if (!nombre) return;
    try {
        const { arrayUnion } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js');
        await updateDoc(doc(db, 'eventos', eventId), {
            inscritos: arrayUnion({
                uid: `manual_${Date.now()}`,
                nombre,
                inscritoEn: serverTimestamp(),
                manual: true
            })
        });
        showToast('Jugador añadido', nombre, 'success');
    } catch (e) { showToast('Error', e.message, 'error'); }
};

window.addManualMatch = async (eventId) => {
    const equipoA = prompt('Equipo A (nombre):');
    const equipoB = prompt('Equipo B (nombre):');
    if (!equipoA || !equipoB) return;
    try {
        await addDocument('eventoPartidos', {
            eventoId: eventId,
            ronda: 1,
            equipoA, equipoB,
            resultado: null, ganador: null, estado: 'pendiente',
        });
        showToast('Partido añadido', `${equipoA} vs ${equipoB}`, 'success');
    } catch (e) { showToast('Error', e.message, 'error'); }
};

/* ────────────────────────────────────────────────────────
   HELPERS
   ──────────────────────────────────────────────────────── */
function fmtDate(d) {
    if (!d) return '-';
    try {
        return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(d instanceof Date ? d : new Date(d));
    } catch { return '-'; }
}
