// eventos.js — Versión mejorada con aprobación de inscritos y campo repesca
import { db, auth, observerAuth, getDocument, addDocument, updateDocument, getDocsSafe } from './firebase-service.js';
import { initAppUI, showToast, showSidePreferenceModal } from './ui-core.js';
import { openResultForm } from './match-service.js';
import { buildMatchPersistencePatch } from './utils/match-utils.js';
import {
    collection, getDocs, doc, getDoc, updateDoc, deleteDoc, addDoc,
    query, where, orderBy, serverTimestamp, onSnapshot, writeBatch,
    arrayUnion, arrayRemove, increment
} from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { ensureGuestProfile } from './services/guest-player-service.js';
import { installScreenErrorMonitoring, captureScreenError } from './services/error-monitor.js';
import { seedIdentityCache, getCachedIdentity } from './services/identity-service.js';

initAppUI('events');
installScreenErrorMonitoring('eventos', () => ({
    activeEventId,
    currentFilter,
    totalEvents: Array.isArray(allEvents) ? allEvents.length : 0,
}));

/* ==================== STATE ==================== */
let currentUser = null;
let currentUserData = null;
let allEvents = [];
let currentFilter = 'all';
let activeEventId = null;
let adminTabState = 'players';
let unsubscribeEvents = null;
let usersById = new Map();

function escapeEventsHtml(raw = "") {
    const div = document.createElement("div");
    div.textContent = String(raw || "");
    return div.innerHTML;
}

function confirmEventsAction({
    title = "Confirmar",
    message = "¿Quieres continuar?",
    confirmLabel = "Continuar",
    danger = false,
} = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay active modal-stack-front";
        overlay.innerHTML = `
            <div class="modal-card glass-strong" style="max-width:380px;">
                <div class="modal-header">
                    <h3 class="modal-title">${escapeEventsHtml(title)}</h3>
                    <button class="close-btn" type="button">&times;</button>
                </div>
                <div class="modal-body">
                    <p class="text-[11px] text-white/75 leading-relaxed">${escapeEventsHtml(message)}</p>
                    <div class="flex-row gap-2 mt-4">
                        <button type="button" class="btn btn-ghost w-full" data-events-cancel>Cancelar</button>
                        <button type="button" class="btn w-full ${danger ? "btn-danger" : "btn-primary"}" data-events-ok>${escapeEventsHtml(confirmLabel)}</button>
                    </div>
                </div>
            </div>
        `;
        const close = (accepted = false) => {
            overlay.remove();
            resolve(Boolean(accepted));
        };
        overlay.querySelector(".close-btn")?.addEventListener("click", () => close(false));
        overlay.querySelector("[data-events-cancel]")?.addEventListener("click", () => close(false));
        overlay.querySelector("[data-events-ok]")?.addEventListener("click", () => close(true));
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) close(false);
        });
        document.body.appendChild(overlay);
    });
}

function askEventsTextInput({
    title = "Editar valor",
    label = "Valor",
    value = "",
    placeholder = "",
    confirmLabel = "Guardar",
} = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay active modal-stack-front";
        overlay.innerHTML = `
            <div class="modal-card glass-strong" style="max-width:380px;">
                <div class="modal-header">
                    <h3 class="modal-title">${escapeEventsHtml(title)}</h3>
                    <button class="close-btn" type="button">&times;</button>
                </div>
                <div class="modal-body">
                    <label class="text-[10px] font-black text-muted uppercase tracking-widest">${escapeEventsHtml(label)}</label>
                    <input id="events-inline-input" class="input w-full mt-2" value="${escapeEventsHtml(String(value || ""))}" placeholder="${escapeEventsHtml(placeholder)}">
                    <div class="flex-row gap-2 mt-4">
                        <button type="button" class="btn btn-ghost w-full" data-events-input-cancel>Cancelar</button>
                        <button type="button" class="btn btn-primary w-full" data-events-input-ok>${escapeEventsHtml(confirmLabel)}</button>
                    </div>
                </div>
            </div>
        `;
        const close = (result = null) => {
            overlay.remove();
            resolve(result);
        };
        overlay.querySelector(".close-btn")?.addEventListener("click", () => close(null));
        overlay.querySelector("[data-events-input-cancel]")?.addEventListener("click", () => close(null));
        overlay.querySelector("[data-events-input-ok]")?.addEventListener("click", () => {
            close(overlay.querySelector("#events-inline-input")?.value?.trim() || "");
        });
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) close(null);
        });
        document.body.appendChild(overlay);
        overlay.querySelector("#events-inline-input")?.focus();
    });
}

/* ==================== BOOT ==================== */
document.addEventListener('DOMContentLoaded', () => {
    observerAuth(async (user) => {
        if (!user) return;
        currentUser = user;
        try {
            currentUserData = await getDocument('usuarios', user.uid);
        } catch (error) {
            captureScreenError('eventos', error, {
                source: 'observerAuth:getDocument',
                meta: { uid: user.uid },
                tags: ['bootstrap', 'eventos'],
            });
            throw error;
        }
        const isAdmin = currentUserData?.rol === 'Admin';
        const isOrganizer = isAdmin || currentUserData?.esOrganizador === true;

        if (isOrganizer) {
            document.getElementById('btn-create-event')?.classList.remove('hidden');
        }

        await preloadUsersForEvents();
        setupFilters();
        setupCreateModal();
        subscribeEvents();
        setupDashboard();
    });
});

async function setupDashboard() {
    const btnDownload = document.getElementById('btn-download-ev-poster');
    if (btnDownload) {
        btnDownload.onclick = async () => {
            const played = document.getElementById('count-played').textContent;
            const scheduled = document.getElementById('count-scheduled').textContent;
            const pending = document.getElementById('count-pending').textContent;
            
            try {
                const { shareMatchPoster } = await import('./utils/share-utils.js');
                await shareMatchPoster({
                    title: 'ESTADO COMPETICIONES',
                    teamA: ['EN CURSO', `JUGADOS: ${played}`],
                    teamB: ['TOTAL ACTIVOS', `PENDIENTES: ${pending}`],
                    levelsA: [scheduled],
                    levelsB: ['EVENTOS'],
                    when: new Date().toLocaleDateString(),
                    club: 'JAFS PADEL CLUB'
                });
            } catch (e) {
                console.error("Poster creation failed", e);
                showToast("Error", "No se pudo generar el cartel del dashboard.", "error");
            }
        };
    }
}

async function updateDashboardStats(events) {
    let played = 0, scheduled = 0, pending = 0, open = 0;
    
    events.forEach(ev => {
        if (ev.estado === 'inscripcion') open++;
    });
    
    document.getElementById('count-open').textContent = open;
    
    // We can't easily count matches of ALL events without many queries
    // Let's at least count matches from the most recent active events
    const activeEvents = events.filter(e => e.estado === 'activo').slice(0, 5);
    
    for (const ev of activeEvents) {
        try {
            const matchesSnap = await getDocsSafe(query(collection(db, 'eventoPartidos'), where('eventoId', '==', ev.id)));
            matchesSnap.docs.forEach(d => {
                const m = d.data();
                if (m.estado === 'jugado') played++;
                else if (m.estado === 'programado') scheduled++;
                else pending++;
            });
        } catch (e) {
            console.warn("Failed to fetch matches for dashboard event", ev.id, e);
        }
    }
    
    document.getElementById('count-played').textContent = played;
    document.getElementById('count-scheduled').textContent = scheduled;
    document.getElementById('count-pending').textContent = pending;
}


async function preloadUsersForEvents() {
    try {
        const snap = await getDocsSafe(collection(db, 'usuarios'));
        const rows = (snap?.docs || []).map(d => ({ uid: d.id, ...d.data() }));
        usersById = new Map(rows.map(u => [u.uid, u]));
        seedIdentityCache(rows);
    } catch (e) {
        console.error('Error cargando usuarios eventos:', e);
    }
}

function resolveInscritoLabel(ins) {
    if (!ins) return 'Jugador';
    const uid = ins.uid || '';
    const isGuest = ins.invitado === true || String(uid).startsWith('invitado_') || String(uid).startsWith('manual_') || ins.manual === true;
    const cached = getCachedIdentity(uid);
    if (cached?.name) return cached.name;
    if (!isGuest && usersById.has(uid)) {
        const u = usersById.get(uid);
        return u.nombreUsuario || u.nombre || u.email || 'Jugador';
    }
    return ins.nombre || ins.nombreUsuario || 'Invitado';
}

/* ==================== FILTERS ==================== */
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

/* ==================== REALTIME ==================== */
function subscribeEvents() {
    if (unsubscribeEvents) unsubscribeEvents();
    const q = query(collection(db, 'eventos'), orderBy('createdAt', 'desc'));
    unsubscribeEvents = onSnapshot(q, snap => {
        allEvents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderEvents();
        updateDashboardStats(allEvents);
    }, err => {
        console.error('Events error:', err);
        renderFallback('Error de conexión. Intenta de nuevo.');
    });
}

/* ==================== RENDER ==================== */
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
        container.innerHTML = `<div class="events-empty"><i class="fas fa-calendar-xmark"></i><h3>Sin eventos</h3><p>No hay eventos en esta categoría. ¡Sé el primero en generar uno!</p></div>`;
        return;
    }

    container.innerHTML = events.map((ev, i) => {
        try {
            return buildEventCard(ev, i);
        } catch (err) {
            console.error('Error renderizando evento', ev?.id, err);
            return `
            <article class="event-card-v3 animate-up ev-card-champions" style="animation-delay:${i * 0.06}s">
                <div class="ev-card-body">
                    <div class="events-empty" style="min-height:180px;">
                        <i class="fas fa-triangle-exclamation"></i>
                        <h3>Evento con datos dañados</h3>
                        <p>${escapeEventsHtml(ev?.nombre || ev?.id || 'Evento')}</p>
                    </div>
                </div>
            </article>`;
        }
    }).join('');

    // Añadir listener para clic en tarjeta (excepto botones)
    setTimeout(() => {
        container.querySelectorAll('.event-card-v3').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                const eventId = card.dataset.id;
                const ev = allEvents.find(e => e.id === eventId);
                if (!ev) return;
                const isInscribed = Array.isArray(ev.inscritos) && ev.inscritos.some(i => i.uid === currentUser?.uid && i.aprobado === true);
                if (isInscribed || currentUserData?.rol === 'Admin' || ev.organizadorId === currentUser?.uid) {
                    window.location.href = `evento-detalle.html?id=${eventId}`;
                } else {
                    window.openEventDetail(eventId);
                }
            });
        });
    }, 100);
}

function renderFallback(msg) {
    const container = document.getElementById('events-container');
    if (container) container.innerHTML = `<div class="events-empty"><i class="fas fa-wifi-slash"></i><h3>Sin conexión</h3><p>${msg}</p></div>`;
}


/* ==================== BUILD CARD ==================== */
function buildEventCard(ev, idx) {
    const formatMap = {
        league: { label: 'LIGA', icon: 'fa-table-list', color: 'cyan' },
        knockout: { label: 'ELIMINATORIA', icon: 'fa-sitemap', color: 'magenta' },
        league_knockout: { label: 'LIGA + ELIM.', icon: 'fa-star', color: 'gold' },
    };
    const fmt = formatMap[ev.formato] || { label: 'EVENTO', icon: 'fa-trophy', color: 'cyan' };

    const stateMap = {
        draft: { label: 'BORRADOR', cls: 'state-draft' },
        inscripcion: { label: 'INSCRIPCIONES', cls: 'state-open' },
        activo: { label: 'EN CURSO', cls: 'state-active' },
        finalizado: { label: 'FINALIZADO', cls: 'state-done' },
        cancelado: { label: 'CANCELADO', cls: 'state-cancelled' },
    };
    const st = stateMap[ev.estado] || { label: ev.estado || 'BORRADOR', cls: 'state-draft' };
    const logoUrl = ev.imagen || ev.imageUrl || ev.logoUrl || './imagenes/Logojafs.png';

    const deadline = ev.fechaInscripcion?._seconds ? new Date(ev.fechaInscripcion._seconds * 1000) : ev.fechaInscripcion ? new Date(ev.fechaInscripcion) : null;
    const startDate = ev.fechaInicio?._seconds ? new Date(ev.fechaInicio._seconds * 1000) : ev.fechaInicio ? new Date(ev.fechaInicio) : null;

    const slots = Number(ev.plazasMax || 16);
    // Solo contamos inscritos aprobados para las plazas ocupadas
    const inscritosAprobados = (ev.inscritos || []).filter(i => i.aprobado === true);
    const filled = inscritosAprobados.length;
    const pct = Math.min(100, Math.round((filled / slots) * 100));
    const isAdmin = currentUserData?.rol === 'Admin';
    const isOrganizer = isAdmin || ev.organizadorId === currentUser?.uid;
    const isInscribed = inscritosAprobados.some(i => i.uid === currentUser?.uid);

    const countdown = startDate ? getCountdown(startDate) : null;
    let newsStrip = '';
    if (ev.estado === 'activo' || ev.estado === 'inscripcion') {
        let phaseStr = ev.estado === 'inscripcion' ? 'Inscripciones Abiertas' : 'Fase en curso';
        if (ev.estado === 'activo') {
            const hasStartedBrackets = ev.bracket && ev.bracket.length > 0;
            if (ev.formato === 'league' || (ev.formato === 'league_knockout' && !hasStartedBrackets)) {
                phaseStr = 'Fase de Grupos / Liga';
            } else if (ev.formato === 'knockout' || hasStartedBrackets) {
                phaseStr = 'Fase Eliminatoria';
            }
        }
        newsStrip = `
        <div class="ev-news-strip" style="background: rgba(255,255,255,0.05); padding: 8px 12px; border-radius: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; border: 1px solid rgba(255,255,255,0.1);">
            <span style="font-size: 10px; font-weight: 800; color: var(--primary);"><i class="fas fa-bullhorn" style="margin-right:4px;"></i> UPDATE</span>
            <span style="font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.8);">${phaseStr}</span>
        </div>`;
    }

    return `
    <article class="event-card-v3 animate-up ev-card-champions" style="animation-delay:${idx * 0.06}s" data-id="${ev.id}">
        <div class="ev-card-header ${fmt.color}">
            <div class="ev-format-badge"><i class="fas ${fmt.icon}"></i> ${fmt.label}</div>
            <span class="ev-state-badge ${st.cls}">${st.label}</span>
        </div>
        <div class="ev-card-body">
            ${countdown && !countdown.past ? `<div class="ev-countdown ${countdown.urgent ? 'ev-countdown-urgent' : ''}"><i class="fas fa-clock"></i><span>${countdown.text}</span></div>` : ''}
            ${newsStrip}
                        <div class="ev-card-brand">
                <div class="ev-card-logo" style="background-image:url('${logoUrl}')"></div>
                <div class="ev-card-brand-text">
                    <h3 class="ev-title">${ev.nombre || 'Sin nombre'}</h3>
                    <div class="ev-brand-sub">Organiza: ${ev.organizadorNombre || 'Club'}</div>
                </div>
            </div>
            <p class="ev-desc">${ev.descripcion || ''}</p>
            <div class="ev-stats-grid">
                <div class="ev-stat"><i class="fas fa-users"></i><span><b>${filled}/${slots}</b> equipos</span></div>
                <div class="ev-stat"><i class="fas fa-user-clock"></i><span><b>${(ev.inscritos || []).filter(i => i.aprobado === false).length}</b> pendientes</span></div>
                ${ev.premio ? `<div class="ev-stat"><i class="fas fa-trophy text-sport-gold"></i><span><b>${ev.premio}</b></span></div>` : ''}
                ${deadline ? `<div class="ev-stat"><i class="fas fa-hourglass-half text-sport-red"></i><span>Inscr. hasta: <b>${fmtDate(deadline)}</b></span></div>` : ''}
                ${startDate ? `<div class="ev-stat"><i class="fas fa-flag-checkered text-primary"></i><span>Inicio: <b>${fmtDate(startDate)}</b></span></div>` : ''}
                ${ev.nivelMin || ev.nivelMax ? `<div class="ev-stat"><i class="fas fa-sliders text-cyan"></i><span>Nivel: <b>${ev.nivelMin || '—'}–${ev.nivelMax || '—'}</b></span></div>` : ''}
            </div>
            <div class="ev-progress-wrap">
                <div class="ev-progress-bar"><div class="ev-progress-fill ${pct >= 100 ? 'full' : ''}" style="width:${pct}%"></div></div>
                <span class="ev-progress-label">${pct}% ocupado</span>
            </div>
            <div class="ev-card-footer">
                <button class="btn-ev-detail" onclick="window.openEventDetail('${ev.id}')"><i class="fas fa-eye"></i> Ver</button>
                ${!isInscribed && ev.estado === 'inscripcion' ? `<button class="btn-ev-join" onclick="window.inscribirseEvento('${ev.id}')"><i class="fas fa-bolt"></i> Inscribirse</button>` : ''}
                ${isInscribed ? `<span class="ev-enrolled-badge"><i class="fas fa-check-circle"></i> Inscrito</span>` : ''}
                ${isOrganizer ? `<button class="btn-ev-admin" onclick="window.openEventAdmin('${ev.id}')"><i class="fas fa-shield-halved"></i></button>` : ''}
            </div>
        </div>
    </article>`;
}

/* ==================== FUNCIONES DE INSCRIPCIÓN ==================== */
window.inscribirseEvento = async (eventId) => {
    if (!currentUser) { showToast('Acceso requerido', 'Inicia sesión', 'warning'); return; }
    const ev = allEvents.find(e => e.id === eventId);
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
            const code = await askEventsTextInput({
                title: 'Codigo de pareja',
                label: 'Codigo compartido',
                value: 'pareja-1',
                placeholder: 'pareja-1',
                confirmLabel: 'Usar codigo'
            });
            if (code === null) return;
            pairCode = code.trim().toLowerCase();
            if (!pairCode) { showToast('Pareja', 'Debes indicar un codigo de pareja.', 'warning'); return; }
        }

        const newInscripto = {
            uid: currentUser.uid,
            nombre: currentUserData?.nombreUsuario || currentUserData?.nombre || 'Jugador',
            nivel: myLevel,
            sidePreference: pref,
            pairCode,
            inscritoEn: new Date().toISOString(),
            aprobado: false, // Pendiente de aprobación
        };

        const evRef = doc(db, 'eventos', eventId);
        await updateDoc(evRef, { inscritos: arrayUnion(newInscripto) });

        showToast('¡Solicitud enviada!', 'Espera la aprobación del organizador', 'success');
        document.getElementById('modal-event-detail')?.classList.remove('active');
    } catch (e) {
        console.error(e);
        showToast('Error', 'No se pudo completar la inscripción', 'error');
    }
};

window.cancelInscripcion = async (eventId) => {
    if (!(await confirmEventsAction({
        title: 'Cancelar inscripcion',
        message: 'Se cancelara tu plaza o solicitud en este evento.',
        confirmLabel: 'Cancelar',
        danger: true
    }))) return;
    const ev = allEvents.find(e => e.id === eventId);
    if (!ev) return;
    const myEntry = ev.inscritos?.find(i => i.uid === currentUser?.uid);
    if (!myEntry) return;
    try {
        await updateDoc(doc(db, 'eventos', eventId), { inscritos: arrayRemove(myEntry) });
        showToast('Inscripción cancelada', '', 'info');
        document.getElementById('modal-event-detail')?.classList.remove('active');
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

/* ==================== DETALLE MODAL (Vista rápida) ==================== */
window.openEventDetail = async (eventId) => {
    const ev = allEvents.find(e => e.id === eventId);
    if (!ev) return;
    document.getElementById('ev-detail-title').textContent = ev.nombre || 'Evento';
    const formatLabels = { league: 'Liga', knockout: 'Eliminatoria directa', league_knockout: 'Liga + Eliminatoria' };
    document.getElementById('ev-detail-format-badge').textContent = formatLabels[ev.formato] || ev.formato;

    const body = document.getElementById('ev-detail-body');
    const inscritos = Array.isArray(ev.inscritos) ? ev.inscritos : [];
    const aprobados = inscritos.filter(i => i.aprobado === true);
    const isInscribed = aprobados.some(i => i.uid === currentUser?.uid);

    let standingHTML = '', bracketHTML = '';
    if (ev.formato === 'league' || ev.formato === 'league_knockout') {
        const standings = await loadStandings(eventId);
        standingHTML = renderStandingTable(standings);
    }
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
        <div id="dtab-info" class="ev-dtab-panel active p-4 flex-col gap-3">${buildDetailInfo(ev)}</div>
        <div id="dtab-players" class="ev-dtab-panel hidden p-4">${buildPlayersList(inscritos)}</div>
        ${standingHTML ? `<div id="dtab-standing" class="ev-dtab-panel hidden p-4">${standingHTML}</div>` : ''}
        ${bracketHTML ? `<div id="dtab-bracket" class="ev-dtab-panel hidden p-4 overflow-x-auto">${bracketHTML}</div>` : ''}
        <div class="p-4 border-t border-white/5">
            ${!isInscribed && ev.estado === 'inscripcion' ? `<button class="btn btn-primary w-full" onclick="window.inscribirseEvento('${ev.id}')"><i class="fas fa-bolt mr-1"></i> SOLICITAR INSCRIPCIÓN</button>` : ''}
            ${isInscribed ? `<div class="flex-row items-center gap-2 p-3 rounded-xl bg-sport-green/10 border border-sport-green/20"><i class="fas fa-check-circle text-sport-green"></i><span class="text-[11px] font-bold text-sport-green">Ya estás inscrito</span><button class="ml-auto text-[9px] text-sport-red/80 hover:text-sport-red font-bold uppercase" onclick="window.cancelInscripcion('${ev.id}')">Cancelar</button></div>` : ''}
        </div>
    `;
    document.getElementById('modal-event-detail').classList.add('active');
};

function buildDetailInfo(ev) {
    const deadline = ev.fechaInscripcion?._seconds ? new Date(ev.fechaInscripcion._seconds*1000) : ev.fechaInscripcion ? new Date(ev.fechaInscripcion) : null;
    const startDate = ev.fechaInicio?._seconds ? new Date(ev.fechaInicio._seconds*1000) : ev.fechaInicio ? new Date(ev.fechaInicio) : null;
    const slots = Number(ev.plazasMax || 16);
    const aprobados = (ev.inscritos || []).filter(i => i.aprobado === true);
    const filled = aprobados.length;

    return `
        <p class="text-[12px] text-white/70 leading-relaxed">${ev.descripcion || 'Sin descripción.'}</p>
        <div class="ev-info-grid">
            <div class="ev-info-item"><i class="fas fa-users text-primary"></i><div><span class="label">Plazas</span><span class="val">${filled}/${slots}</span></div></div>
            <div class="ev-info-item"><i class="fas fa-user-clock text-warning"></i><div><span class="label">Pendientes</span><span class="val">${(ev.inscritos || []).filter(i => i.aprobado === false).length}</span></div></div>
            ${ev.premio ? `<div class="ev-info-item"><i class="fas fa-trophy text-sport-gold"></i><div><span class="label">Premio</span><span class="val">${ev.premio}</span></div></div>` : ''}
            ${deadline ? `<div class="ev-info-item"><i class="fas fa-hourglass-half text-sport-red"></i><div><span class="label">Fin inscripción</span><span class="val">${fmtDate(deadline)}</span></div></div>` : ''}
            ${startDate ? `<div class="ev-info-item"><i class="fas fa-flag-checkered text-primary"></i><div><span class="label">Inicio</span><span class="val">${fmtDate(startDate)}</span></div></div>` : ''}
            ${ev.nivelMin || ev.nivelMax ? `<div class="ev-info-item"><i class="fas fa-sliders text-cyan"></i><div><span class="label">Nivel req.</span><span class="val">${ev.nivelMin||'1.0'}–${ev.nivelMax||'7.0'}</span></div></div>` : ''}
        </div>
        <div class="ev-points-info">
            <span class="text-[9px] font-bold text-muted uppercase">Sistema de puntos</span>
            <div class="flex-row gap-3 mt-1">
                <span class="ev-pts-badge win">✓ ${ev.puntosVictoria || 3} pts</span>
                <span class="ev-pts-badge draw">= ${ev.puntosEmpate || 1} pts</span>
                <span class="ev-pts-badge lose">✗ ${ev.puntosDerrota || 0} pts</span>
            </div>
        </div>`;
}

function buildPlayersList(inscritos) {
    if (!inscritos.length) return `<p class="text-center text-muted text-[12px] py-8">Sin inscripciones todavía.</p>`;
    return `<div class="ev-players-list">${inscritos.map((ins, i) => `
        <div class="ev-player-row">
            <span class="ev-player-rank">#${i+1}</span>
            <div class="flex-col flex-1">
                <span class="font-bold text-[12px]">${resolveInscritoLabel(ins)}</span>
                ${ins.aprobado ? '<span class="text-[10px] text-sport-green">✓ Aprobado</span>' : '<span class="text-[10px] text-warning">⏳ Pendiente</span>'}
            </div>
            <span class="text-[10px] text-muted">${fmtDate(ins.inscritoEn?._seconds ? new Date(ins.inscritoEn._seconds*1000) : new Date())}</span>
        </div>`).join('')}</div>`;
}

async function loadStandings(eventId) {
    try {
        const snap = await getDocsSafe(query(collection(db, 'eventoClasificacion'), where('eventoId', '==', eventId), orderBy('puntos', 'desc'), orderBy('diferencia', 'desc')));
        return snap.docs.map(d => d.data());
    } catch { return []; }
}

function renderStandingTable(standings) {
    if (!standings.length) return `<p class="text-center text-muted text-[12px] py-8">Clasificación no disponible.</p>`;
    return `
      <div class="ev-standing-table">
        <div class="ev-standing-head"><span>#</span><span>Pareja</span><span>PJ</span><span>G</span><span>P</span><span>PF</span><span>PC</span><span>DIF</span><span>Pts</span></div>
        ${standings.map((s, i) => `
        <div class="ev-standing-row ${i < 2 ? 'top' : i < 4 ? 'playoff' : ''}">
          <span class="ev-rank-num">${i+1}</span>
          <span class="ev-team-name">${s.nombre || '-'}</span>
          <span>${s.pj||0}</span><span>${s.ganados||0}</span><span>${s.perdidos||0}</span>
          <span>${s.puntosGanados||0}</span><span>${s.puntosPerdidos||0}</span>
          <span>${s.diferencia||0}</span>
          <span class="font-black text-primary">${s.puntos||0}</span>
        </div>`).join('')}
      </div>`;
}

function renderBracket(rounds = []) {
    if (!rounds.length) return `<p class="text-center text-muted text-[12px] py-8">Bracket no generado.</p>`;
    return `<div class="bracket-wrap">${rounds.map((round, ri) => `
        <div class="bracket-round">
          <div class="bracket-round-label">Ronda ${ri+1}</div>
          ${round.map(m => `
          <div class="bracket-match">
            <div class="bracket-team ${m.winner === 'A' ? 'winner' : m.winner ? 'loser' : ''}">${m.teamA || '?'}</div>
            <div class="bracket-vs">VS</div>
            <div class="bracket-team ${m.winner === 'B' ? 'winner' : m.winner ? 'loser' : ''}">${m.teamB || '?'}</div>
            ${m.resultado ? `<div class="bracket-result">${m.resultado}</div>` : ''}
          </div>`).join('')}
        </div>`).join('')}</div>`;
}

window.switchDetailTab = (tab, btn) => {
    document.querySelectorAll('.ev-dtab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.ev-dtab-panel').forEach(p => p.classList.add('hidden'));
    btn.classList.add('active');
    document.getElementById(`dtab-${tab}`)?.classList.remove('hidden');
};

/* ==================== CREAR EVENTO ==================== */
function setupCreateModal() {
    document.getElementById('btn-create-event')?.addEventListener('click', () => {
        document.getElementById('modal-create-event').classList.add('active');
    });

    document.querySelectorAll('.ev-format-opt').forEach(opt => {
        opt.addEventListener('click', () => {
            document.querySelectorAll('.ev-format-opt .format-card').forEach(c => c.classList.remove('active'));
            opt.querySelector('.format-card').classList.add('active');
            const fmt = opt.dataset.format;
            const leagueWrap = document.getElementById('ev-league-points-wrap');
            const groupWrap = document.getElementById('ev-group-count-wrap');
            const teamsPerGroupWrap = document.getElementById('ev-teams-per-group-wrap');
            const repescaWrap = document.getElementById('ev-repesca-wrap');
            if (leagueWrap) leagueWrap.style.display = (fmt === 'knockout') ? 'none' : 'block';
            if (groupWrap) groupWrap.style.display = (fmt === 'league_knockout') ? 'block' : 'none';
            if (teamsPerGroupWrap) teamsPerGroupWrap.style.display = (fmt === 'league_knockout') ? 'block' : 'none';
            if (repescaWrap) repescaWrap.style.display = (fmt === 'league_knockout' || fmt === 'knockout') ? 'block' : 'none';
        });
    });

    document.querySelectorAll('.ev-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.ev-mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const partnerWrap = document.getElementById('ev-partner-required-wrap');
            if (partnerWrap) partnerWrap.style.display = btn.dataset.mode === 'parejas' ? 'block' : 'none';
        });
    });

    document.getElementById('btn-save-event')?.addEventListener('click', saveNewEvent);
}

async function saveNewEvent() {
    const nombre = document.getElementById('ev-name')?.value.trim();
    if (!nombre) { showToast('Campo requerido', 'El nombre es obligatorio', 'warning'); return; }

    const formato = document.querySelector('input[name="ev-format"]:checked')?.value || 'league_knockout';
    const modalidad = document.querySelector('.ev-mode-btn.active')?.dataset.mode || 'parejas';
    const pairingPolicy = document.getElementById('ev-pairing-policy')?.value || 'balanced';
    const companeroObligatorio = document.getElementById('ev-partner-required')?.checked ?? true;
    const regDeadlineStr = document.getElementById('ev-reg-deadline')?.value;
    const startDateStr = document.getElementById('ev-start-date')?.value;
    const plazasMax = Number(document.getElementById('ev-max-slots')?.value || 16);
    const groupCountRaw = Number(document.getElementById('ev-group-count')?.value || 2);
    const groupCount = Math.min(4, Math.max(2, groupCountRaw));
    const equiposPorGrupo = Number(document.getElementById('ev-teams-per-group')?.value || 2);
    const repesca = document.getElementById('ev-repesca')?.checked === true;
    let premio = document.getElementById('ev-prize')?.value.trim() || '';
    const trofeoAuto = document.getElementById('ev-trofeo-auto')?.checked === true;
    if (trofeoAuto) premio = premio ? premio + ' + Trofeo' : 'Trofeo';
    const invitadosRaw = document.getElementById('ev-invitados')?.value.trim() || '';
    const invitados = parseInvitados(invitadosRaw);
    const nivelMin = document.getElementById('ev-level-min')?.value || '';
    const nivelMax = document.getElementById('ev-level-max')?.value || '';
    const puntosVictoria = Number(document.getElementById('ev-pts-win')?.value || 3);
    const puntosEmpate = Number(document.getElementById('ev-pts-draw')?.value || 1);
    const puntosDerrota = Number(document.getElementById('ev-pts-loss')?.value || 0);
    const descripcion = document.getElementById('ev-description')?.value.trim() || '';
    const imagen = document.getElementById('ev-image')?.value.trim() || '';

    if (nivelMin && nivelMax && Number(nivelMin) > Number(nivelMax)) {
        showToast('Niveles inválidos', 'El mínimo no puede ser mayor que el máximo.', 'warning');
        return;
    }

    const btn = document.getElementById('btn-save-event');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-1"></i> Guardando...';

    try {
        const payload = {
            nombre, descripcion, imagen: imagen || null, formato, modalidad, companeroObligatorio, plazasMax, premio,
            nivelMin: nivelMin ? Number(nivelMin) : null,
            nivelMax: nivelMax ? Number(nivelMax) : null,
            puntosVictoria, puntosEmpate, puntosDerrota,
            repesca, // Nuevo campo
            estado: 'inscripcion',
            inscritos: [],
            bracket: [],
            groups: { A: [], B: [], C: [], D: [] },
            teams: [],
            groupCount: formato === 'league_knockout' ? groupCount : 2,
            equiposPorGrupo: formato === 'league_knockout' ? equiposPorGrupo : null,
            pairingPolicy,
            drawState: { status: 'pending', steps: [], version: 0 },
            organizadorId: currentUser.uid,
            organizadorNombre: currentUserData?.nombreUsuario || currentUserData?.nombre || 'Admin',
            invitados: invitados,
            createdAt: serverTimestamp(),
        };

        if (invitados.length) {
            const guestProfiles = await Promise.all(
                invitados.map((inv) => ensureGuestProfile({
                    name: inv.nombre,
                    level: inv.nivel,
                    source: 'event_create',
                }))
            );
            payload.inscritos = guestProfiles.map((guest) => ({
                uid: guest.id,
                nombre: guest.nombre,
                nivel: guest.nivel,
                inscritoEn: new Date().toISOString(),
                invitado: true,
                aprobado: true,
            }));
        }

        if (regDeadlineStr) payload.fechaInscripcion = new Date(regDeadlineStr);
        if (startDateStr)   payload.fechaInicio      = new Date(startDateStr);

        const newEvRef = await addDocument('eventos', payload);
        showToast('¡Evento creado!', `"${nombre}" publicado`, 'success');
        document.getElementById('modal-create-event').classList.remove('active');
        if (newEvRef?.id) {
            setTimeout(() => window.location.href = `evento-detalle.html?id=${newEvRef.id}`, 1200);
        }
    } catch (e) {
        console.error(e);
        showToast('Error al crear', e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rocket mr-1"></i> Publicar Evento';
    }
}

/* ==================== ADMIN MODAL ==================== */
window.openEventAdmin = async (eventId) => {
    activeEventId = eventId;
    const ev = allEvents.find(e => e.id === eventId);
    if (!ev) return;

    document.getElementById('ev-admin-name').textContent = ev.nombre || 'Evento';
    document.getElementById('modal-event-admin').classList.add('active');

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
    const pendientes = inscritos.filter(i => i.aprobado !== true);
    const aprobados = inscritos.filter(i => i.aprobado === true);

    return `
    <div class="flex-col gap-4">
        <div class="flex-row between items-center">
            <span class="text-[11px] font-bold text-muted">Pendientes (${pendientes.length})</span>
        </div>
        ${pendientes.length ? pendientes.map((ins, i) => `
        <div class="ev-admin-player-row">
            <span class="ev-player-rank">#${i+1}</span>
            <div class="flex-col flex-1">
                <span class="font-bold text-[12px]">${resolveInscritoLabel(ins)}</span>
            </div>
            <div class="flex-row gap-1">
                <button class="btn-micro success" onclick="window.aprobarJugador('${ev.id}','${ins.uid}')"><i class="fas fa-check"></i></button>
                <button class="btn-micro danger" onclick="window.expulsarJugador('${ev.id}','${ins.uid}')"><i class="fas fa-times"></i></button>
            </div>
        </div>`).join('') : '<p class="text-muted text-[12px]">No hay pendientes</p>'}

        <div class="mt-4 pt-2 border-t border-white/5">
            <div class="flex-row between items-center">
                <span class="text-[11px] font-bold text-muted">Aprobados (${aprobados.length})</span>
                ${ev.estado === 'inscripcion' ? `
                <button class="btn-mini" onclick="window.addManualPlayer('${ev.id}')">
                    <i class="fas fa-user-plus mr-1"></i> Añadir
                </button>` : ''}
            </div>
            ${aprobados.length ? aprobados.map((ins, i) => `
            <div class="ev-admin-player-row">
                <span class="ev-player-rank">#${i+1}</span>
                <div class="flex-col flex-1">
                    <span class="font-bold text-[12px]">${resolveInscritoLabel(ins)}</span>
                </div>
                <button class="btn-micro danger" onclick="window.expulsarJugador('${ev.id}','${ins.uid}')"><i class="fas fa-user-minus"></i></button>
            </div>`).join('') : '<p class="text-muted text-[12px]">No hay aprobados</p>'}
        </div>
    </div>`;
}

async function renderAdminMatches(ev) {
    try {
        const snap = await getDocsSafe(query(collection(db, 'eventoPartidos'), where('eventoId', '==', ev.id)));
        const matches = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (a.round||1) - (b.round||1));
        const uniqueMatches = Array.from(new Map(matches.map(m => {
            const key = m.id || m.matchCode || `${m.teamAId || ''}_${m.teamBId || ''}_${m.group || ''}_${m.round || ''}`;
            return [key, m];
        })).values());

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
            ${uniqueMatches.map(m => `
            <div class="ev-admin-match-row">
                <div class="flex-col flex-1">
                    <span class="font-bold text-[12px]">${m.teamAName || m.equipoA || '?'} vs ${m.teamBName || m.equipoB || '?'}</span>
                    <span class="text-[10px] text-muted">${String(m.phase || 'evento').toUpperCase()} · Ronda ${m.round || m.ronda || 1}</span>
                </div>
                <div class="flex-row items-center gap-2">
                    ${m.resultado ? `<span class="text-[11px] font-black text-primary">${m.resultado}</span>` : ''}
                    <button class="btn-micro" onclick="window.editMatchResult('${ev.id}','${m.id}')">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn-micro danger" onclick="window.deleteEventMatch('${ev.id}','${m.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>`).join('')}
        </div>`;
    } catch (e) {
        console.error(e);
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
        <button id="btn-admin-save-settings" class="btn btn-primary w-full"><i class="fas fa-save mr-1"></i> Guardar cambios</button>
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

/* ==================== ACCIONES ADMIN MEJORADAS ==================== */
window.aprobarJugador = async (eventId, uid) => {
    const ev = allEvents.find(e => e.id === eventId);
    if (!ev) return;
    const inscritos = ev.inscritos || [];
    const index = inscritos.findIndex(i => i.uid === uid);
    if (index === -1) return;
    const updated = [...inscritos];
    updated[index] = { ...updated[index], aprobado: true };
    try {
        await updateDoc(doc(db, 'eventos', eventId), { inscritos: updated });
        showToast('Jugador aprobado', '', 'success');
        renderAdminTab(ev, 'players');
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

window.expulsarJugador = async (eventId, uid) => {
    if (!(await confirmEventsAction({
        title: 'Expulsar jugador',
        message: 'Se eliminara a este jugador del evento.',
        confirmLabel: 'Expulsar',
        danger: true
    }))) return;
    const ev = allEvents.find(e => e.id === eventId);
    if (!ev) return;
    const entry = ev.inscritos?.find(i => i.uid === uid);
    if (!entry) return;
    try {
        await updateDoc(doc(db, 'eventos', eventId), { inscritos: arrayRemove(entry) });
        showToast('Jugador eliminado', '', 'info');
        renderAdminTab(ev, 'players');
    } catch (e) { showToast('Error', e.message, 'error'); }
};

window.deleteEvent = async (eventId) => {
    if (!(await confirmEventsAction({
        title: 'Eliminar evento',
        message: 'Esta accion elimina el evento de forma permanente.',
        confirmLabel: 'Eliminar',
        danger: true
    }))) return;
    try {
        await deleteDoc(doc(db, 'eventos', eventId));
        showToast('Evento eliminado', '', 'info');
        document.getElementById('modal-event-admin')?.classList.remove('active');
    } catch (e) { showToast('Error', e.message, 'error'); }
};

window.addManualPlayer = async (eventId) => {
    const nombre = await askEventsTextInput({
        title: 'Añadir jugador manual',
        label: 'Nombre del jugador',
        value: '',
        placeholder: 'Nombre o apodo',
        confirmLabel: 'Añadir'
    });
    if (!nombre) return;
    try {
        await updateDoc(doc(db, 'eventos', eventId), {
            inscritos: arrayUnion({
                uid: `manual_${Date.now()}`,
                nombre,
                inscritoEn: new Date().toISOString(),
                manual: true,
                aprobado: true, // Se añade directamente como aprobado
            })
        });
        showToast('Jugador añadido', nombre, 'success');
    } catch (e) { showToast('Error', e.message, 'error'); }
};

window.addManualMatch = async (eventId) => {
    const equipoA = await askEventsTextInput({
        title: 'Partido manual',
        label: 'Pareja 1',
        value: '',
        placeholder: 'Nombre de la pareja 1',
        confirmLabel: 'Continuar'
    });
    if (!equipoA) return;
    const equipoB = await askEventsTextInput({
        title: 'Partido manual',
        label: 'Pareja 2',
        value: '',
        placeholder: 'Nombre de la pareja 2',
        confirmLabel: 'Crear'
    });
    if (!equipoA || !equipoB) return;
    try {
        await addDocument('eventoPartidos', {
            eventoId: eventId,
            tipo: 'evento',
            phase: 'league',
            round: 1,
            teamAId: `manual_a_${Date.now()}`,
            teamBId: `manual_b_${Date.now()}`,
            teamAName: equipoA,
            teamBName: equipoB,
            playerUids: [],
            ganadorTeamId: null,
            fecha: null,
            ...buildMatchPersistencePatch({ state: 'abierto', resultStr: '' }),
            createdAt: serverTimestamp()
        });
        showToast('Partido añadido', `${equipoA} vs ${equipoB}`, 'success');
    } catch (e) { showToast('Error', e.message, 'error'); }
};

window.editMatchResult = async (_eventId, matchId) => {
    if (!matchId) return;
    openResultForm(matchId, 'eventoPartidos');
};

window.deleteEventMatch = async (_eventId, matchId) => {
    if (!(await confirmEventsAction({
        title: 'Eliminar partido',
        message: 'Se eliminara este partido del evento y su vinculo si existe.',
        confirmLabel: 'Eliminar',
        danger: true
    }))) return;
    try {
        const snap = await getDoc(doc(db, 'eventoPartidos', matchId));
        const data = snap.exists() ? snap.data() : null;
        if (data?.linkedMatchId && data?.linkedMatchCollection) {
            await deleteDoc(doc(db, data.linkedMatchCollection, data.linkedMatchId));
        }
        await deleteDoc(doc(db, 'eventoPartidos', matchId));
        showToast('Partido eliminado', '', 'success');
    } catch (e) {
        showToast('Error', e.message, 'error');
    }
};

window.generarPartidos = async (eventId) => {
    showToast('Función no disponible', 'Usa el panel de sorteo', 'warning');
};

/* ==================== HELPERS ==================== */
function fmtDate(d) {
    if (!d) return '-';
    try {
        return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(d instanceof Date ? d : new Date(d));
    } catch { return '-'; }
}

function getCountdown(startDate) {
    const now = new Date();
    const start = startDate instanceof Date ? startDate : new Date(startDate);
    const diff = start - now;
    if (diff <= 0) return { text: 'Ya empezó', past: true, urgent: false };
    const days = Math.floor(diff / (24*60*60*1000));
    const hours = Math.floor((diff % (24*60*60*1000)) / (60*60*1000));
    const mins = Math.floor((diff % (60*60*1000)) / (60*1000));
    if (days > 7) return { text: `Empieza en ${days} días`, past: false, urgent: false };
    if (days > 0) return { text: `${days}d ${hours}h`, past: false, urgent: true };
    if (hours > 0) return { text: `${hours}h ${mins}m`, past: false, urgent: true };
    return { text: `${mins} min`, past: false, urgent: true };
}

function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

function parseInvitados(raw) {
    if (!raw.trim()) return [];
    return raw.split(/\n/).map(l => l.trim()).filter(Boolean).map(line => {
        const parts = line.split(/[,;]/).map(p => p.trim());
        const nombre = parts[0] || '';
        const nivel = parts[1] ? Number(parts[1].replace(',', '.')) : 2.5;
        return nombre ? { nombre, nivel: Number.isFinite(nivel) ? nivel : 2.5 } : null;
    }).filter(Boolean);
}








