/* evento-detalle.js — Robust Event Page */
import { db, auth, observerAuth, getDocument, updateDocument, addDocument } from './firebase-service.js';
import { initAppUI, showToast } from './ui-core.js';
import { 
    doc, onSnapshot, collection, query, where, orderBy, 
    serverTimestamp, updateDoc, writeBatch, increment, deleteDoc
} from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { injectHeader, injectNavbar } from './modules/ui-loader.js';

let currentUser = null;
let currentUserData = null;
let eventId = new URLSearchParams(window.location.search).get('id');
let currentEvent = null;

initAppUI('event-detail');

document.addEventListener('DOMContentLoaded', () => {
    if (!eventId) {
        window.location.replace('eventos.html');
        return;
    }

    observerAuth(async (user) => {
        if (!user) return window.location.replace('index.html');
        currentUser = user;
        currentUserData = await getDocument('usuarios', user.uid);
        
        await injectHeader(currentUserData);
        injectNavbar('events');

        subscribeEvent();
        bindTabs();

        const params = new URLSearchParams(window.location.search);
        if (params.get('admin') === '1') {
            setTimeout(() => {
                const btn = document.getElementById('btn-ed-admin');
                if (btn && !btn.classList.contains('hidden')) btn.click();
            }, 500);
        }
    });
});

/* ─── Realtime Logic ─── */
function subscribeEvent() {
    onSnapshot(doc(db, 'eventos', eventId), (snap) => {
        if (!snap.exists()) {
            showToast('Error', 'El evento no existe', 'error');
            setTimeout(() => window.location.replace('eventos.html'), 2000);
            return;
        }
        currentEvent = { id: snap.id, ...snap.data() };
        renderPage();
    });
}

function bindTabs() {
    document.querySelectorAll('.ed-tab').forEach(btn => {
        btn.onclick = () => {
            const tab = btn.dataset.tab;
            if (tab === 'admin' && !canAdmin()) return;
            
            document.querySelectorAll('.ed-tab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.ed-pane').forEach(p => p.classList.add('hidden'));
            
            btn.classList.add('active');
            document.getElementById(`pane-${tab}`)?.classList.remove('hidden');
            
            renderPane(tab);
        };
    });
}

function canAdmin() {
    return currentUserData?.rol === 'Admin' || currentEvent?.organizadorId === currentUser?.uid;
}

/* ─── Rendering ─── */
function renderPage() {
    const ev = currentEvent;
    
    // Hero
    const hero = document.getElementById('ed-hero-content');
    const fmtLabels = { league: 'Liga', knockout: 'Eliminatoria', league_knockout: 'L+E' };
    const badgeCls = ev.formato === 'league' ? 'league' : 'knockout';
    
    hero.innerHTML = `
        <div class="ed-badge ${badgeCls}">
            <i class="fas fa-trophy"></i> ${fmtLabels[ev.formato] || 'Evento'}
        </div>
        <h1 class="ed-title">${ev.nombre || 'Evento'}</h1>
        <div class="ed-organizer">Org: ${ev.organizadorNombre || 'Admin'}</div>
    `;

    // Stats Strip
    const strip = document.getElementById('ed-stats-strip');
    const filled = (ev.inscritos || []).length;
    const slots = ev.plazasMax || 16;
    strip.innerHTML = `
        <div class="ed-stat-box">
            <span class="ed-stat-val">${filled}/${slots}</span>
            <span class="ed-stat-lbl">Inscritos</span>
        </div>
        <div class="ed-stat-box">
            <span class="ed-stat-val">${ev.premio || '—'}</span>
            <span class="ed-stat-lbl">Premio</span>
        </div>
        <div class="ed-stat-box">
            <span class="ed-stat-val">${ev.estado?.toUpperCase() || 'DRAFT'}</span>
            <span class="ed-stat-lbl">Estado</span>
        </div>
    `;

    // Admin tab visibility
    if (canAdmin()) {
        document.getElementById('btn-ed-admin')?.classList.remove('hidden');
    }

    // Default pane
    const activeTab = document.querySelector('.ed-tab.active')?.dataset.tab || 'info';
    renderPane(activeTab);
    renderActionBar();
}

function renderPane(tab) {
    const pane = document.getElementById(`pane-${tab}`);
    if (!pane) return;

    if (tab === 'info') renderInfoPane(pane);
    else if (tab === 'bracket') renderBracketPane(pane);
    else if (tab === 'clasificacion') renderClasificacionPane(pane);
    else if (tab === 'partidos') renderPartidosPane(pane);
    else if (tab === 'admin') renderAdminPane(pane);
}

function renderInfoPane(pane) {
    const ev = currentEvent;
    pane.innerHTML = `
        <div class="ed-info-card">
            <h3 class="ed-info-title"><i class="fas fa-file-lines"></i> Descripción</h3>
            <p class="ed-info-text text-pretty">${ev.descripcion || 'Sin descripción detallada.'}</p>
            <div class="ed-info-grid">
                <div class="ed-info-item"><i class="fas fa-calendar"></i><div class="ed-info-col"><span class="ed-info-label">Inicio</span><span class="ed-info-val">${fmtD(ev.fechaInicio)}</span></div></div>
                <div class="ed-info-item"><i class="fas fa-hourglass"></i><div class="ed-info-col"><span class="ed-info-label">Inscripción</span><span class="ed-info-val">${fmtD(ev.fechaInscripcion)}</span></div></div>
                <div class="ed-info-item"><i class="fas fa-sliders"></i><div class="ed-info-col"><span class="ed-info-label">Niveles</span><span class="ed-info-val">${ev.nivelMin || '1.0'} a ${ev.nivelMax || '7.0'}</span></div></div>
                <div class="ed-info-item"><i class="fas fa-users-gear"></i><div class="ed-info-col"><span class="ed-info-label">Formato</span><span class="ed-info-val">${ev.modalidad || 'parejas'}</span></div></div>
            </div>
        </div>
    `;
}

function renderBracketPane(pane) {
    const bracket = currentEvent.bracket || [];
    if (!bracket.length) {
        pane.innerHTML = `<div class="empty-state">El bracket no ha sido generado todavía.</div>`;
        return;
    }
    pane.innerHTML = `<div class="bracket-container overflow-x-auto py-4">${renderBracketHTML(bracket)}</div>`;
}

async function renderClasificacionPane(pane) {
    if (currentEvent.formato === 'knockout') {
        pane.innerHTML = `<div class="empty-state">Este evento es de eliminación directa, no tiene tabla de liga.</div>`;
        return;
    }
    pane.innerHTML = `<div class="loading-state">Cargando clasificación...</div>`;
    
    const snap = await window.getDocsSafe(query(
        collection(db, 'eventoClasificacion'),
        where('eventoId', '==', eventId),
        orderBy('puntos', 'desc'), orderBy('diferencia', 'desc')
    ));
    const standings = snap.docs.map(d => d.data());
    
    if (!standings.length) {
        pane.innerHTML = `<div class="empty-state">Sin datos de clasificación aún.</div>`;
        return;
    }

    pane.innerHTML = `
        <table class="ed-standing-table">
            <thead>
                <tr class="text-[10px] text-muted uppercase font-black tracking-widest">
                    <th class="text-left px-3">#</th>
                    <th class="text-left">Nombre</th>
                    <th>PJ</th><th>V</th><th>D</th><th class="text-right">PTS</th>
                </tr>
            </thead>
            <tbody>
                ${standings.map((s, i) => `
                    <tr class="ed-standing-row">
                        <td class="px-3">${i+1}</td>
                        <td class="font-bold">${s.nombre || '-'}</td>
                        <td class="text-center">${s.pj||0}</td>
                        <td class="text-center">${s.ganados||0}</td>
                        <td class="text-center">${s.perdidos||0}</td>
                        <td class="text-right font-black text-primary">${s.puntos||0}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

async function renderPartidosPane(pane) {
    pane.innerHTML = `<div class="loading-state">Cargando partidos...</div>`;
    const snap = await window.getDocsSafe(query(collection(db, 'eventoPartidos'), where('eventoId', '==', eventId), orderBy('ronda', 'asc')));
    const matches = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!matches.length) {
        pane.innerHTML = `<div class="empty-state">Aún no se han generado los enfrentamientos.</div>`;
        return;
    }

    pane.innerHTML = `
        <div class="flex-col gap-3">
            ${matches.map(m => `
                <div class="ed-match-card ${m.estado === 'jugado' ? 'closed' : ''}">
                    <div class="ed-m-ronda">R${m.ronda || 1}</div>
                    <div class="ed-m-vs">
                        <span class="${m.ganador === 'A' ? 'winner' : ''}">${m.equipoA}</span>
                        <div class="vs-label">VS</div>
                        <span class="${m.ganador === 'B' ? 'winner' : ''}">${m.equipoB}</span>
                    </div>
                    <div class="ed-m-res">${m.resultado || '--'}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderAdminPane(pane) {
    const ev = currentEvent;
    pane.innerHTML = `
        <div class="ed-admin-grid">
            <div class="ed-admin-box">
                <h3>Editar Básico</h3>
                <div class="form-group mb-3">
                    <label class="form-label-sm">Nombre Evento</label>
                    <input type="text" id="adm-ev-name" class="input sm" value="${ev.nombre || ''}">
                </div>
                <div class="form-group mb-3">
                    <label class="form-label-sm">Estado</label>
                    <select id="adm-ev-state" class="input sm">
                        ${['draft','inscripcion','activo','finalizado','cancelado'].map(s => `<option value="${s}" ${ev.estado === s ? 'selected' : ''}>${s}</option>`).join('')}
                    </select>
                </div>
                <button class="btn btn-sm btn-primary w-full" onclick="window.saveBasicEdits()">Guardar Cambios</button>
            </div>

            <div class="ed-admin-box">
                <h3>Gestión de Partidos</h3>
                <div class="flex-col gap-2">
                    <button class="btn btn-sm btn-ghost w-full" onclick="window.generarPartidosED()">
                        <i class="fas fa-magic mr-1"></i> Generar Calendario Completo
                    </button>
                    <button class="btn btn-sm btn-ghost w-full" onclick="window.addManualMatchED()">
                        <i class="fas fa-plus mr-1"></i> Añadir Partido Manual
                    </button>
                </div>
            </div>

            <div class="ed-admin-box border-sport-red/30">
                <h3 class="text-sport-red">Zona Peligrosa</h3>
                <button class="btn btn-sm btn-ghost text-sport-red w-full" onclick="window.deleteEventED()">
                    <i class="fas fa-trash mr-1"></i> Eliminar Evento Permanentemente
                </button>
            </div>
        </div>
    `;
}

/* ─── Actions ─── */
function renderActionBar() {
    const bar = document.getElementById('ed-action-bar');
    const content = document.getElementById('ed-action-content');
    const ev = currentEvent;
    const isInscribed = (ev.inscritos || []).some(i => i.uid === currentUser.uid);

    if (ev.estado === 'inscripcion' && !isInscribed) {
        bar.classList.remove('hidden');
        content.innerHTML = `<button class="btn-ed-primary" onclick="window.inscribirseEventoED()">INSCRIBIRSE AL EVENTO</button>`;
    } else if (isInscribed) {
        bar.classList.remove('hidden');
        content.innerHTML = `<div class="flex-row items-center justify-center gap-3 p-3 bg-sport-green/10 border border-sport-green/20 rounded-2xl">
            <i class="fas fa-check-circle text-sport-green"></i>
            <span class="text-[12px] font-black text-sport-green uppercase italic">Ya estás inscrito</span>
            <button class="text-[10px] text-sport-red/60 hover:text-sport-red font-bold" onclick="window.cancelInscripcionED()">Darse de baja</button>
        </div>`;
    } else {
        bar.classList.add('hidden');
    }
}

window.inscribirseEventoED = async () => {
    const ev = currentEvent;
    if ((ev.inscritos || []).length >= (ev.plazasMax || 16)) return showToast('Completo', 'No quedan plazas', 'warning');
    
    const entry = {
        uid: currentUser.uid,
        nombre: currentUserData?.nombreUsuario || currentUserData?.nombre || 'Jugador',
        nivel: Number(currentUserData?.nivel || 2.5),
        inscritoEn: serverTimestamp(),
    };

    try {
        const { arrayUnion } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js');
        await updateDoc(doc(db, 'eventos', eventId), { inscritos: arrayUnion(entry) });
        
        if (ev.formato !== 'knockout') {
            await setDoc(doc(db, 'eventoClasificacion', `${eventId}_${currentUser.uid}`), {
                eventoId: eventId, uid: currentUser.uid, nombre: entry.nombre,
                pj:0, ganados:0, perdidos:0, empates:0, puntos:0, diferencia:0
            }, { merge: true });
        }
        showToast('¡Inscrito!', 'Bienvenido a la competición', 'success');
    } catch (e) { showToast('Error', e.message, 'error'); }
};

window.cancelInscripcionED = async () => {
    if (!confirm('¿Darte de baja del evento?')) return;
    const entry = currentEvent.inscritos.find(i => i.uid === currentUser.uid);
    if (!entry) return;
    try {
        const { arrayRemove } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js');
        await updateDoc(doc(db, 'eventos', eventId), { inscritos: arrayRemove(entry) });
        showToast('Baja procesada', '', 'info');
    } catch (e) { showToast('Error', e.message, 'error'); }
};

window.saveBasicEdits = async () => {
    const name = document.getElementById('adm-ev-name')?.value;
    const state = document.getElementById('adm-ev-state')?.value;
    try {
        await updateDoc(doc(db, 'eventos', eventId), { nombre: name, estado: state });
        showToast('Guardado', 'Los datos básicos se han actualizado', 'success');
    } catch (e) { showToast('Error', e.message, 'error'); }
};

window.deleteEventED = async () => {
    if (!confirm('¿ELIMINAR PERMANENTEMENTE?')) return;
    try {
        await deleteDoc(doc(db, 'eventos', eventId));
        showToast('Eliminado', 'Redirigiendo...', 'info');
        setTimeout(() => window.location.href = 'eventos.html', 1500);
    } catch (e) { showToast('Error', e.message, 'error'); }
};

/* ─── Helpers ─── */
function fmtD(d) {
    if (!d) return '—';
    const date = d?.toDate ? d.toDate() : new Date(d);
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).toUpperCase();
}

function renderBracketHTML(rounds) {
    // simplified for now, as in eventos.js but cleaner
    return rounds.map((round, ri) => `
        <div class="bracket-round-v2">
            <h4 class="text-[9px] font-black text-muted mb-3">RONDA ${ri+1}</h4>
            ${round.map(m => `
                <div class="bracket-m-card ${m.winner ? 'finished' : ''}">
                    <div class="bm-team ${m.winner === 'A' ? 'win' : ''}">${m.teamA || '?'}</div>
                    <div class="bm-team ${m.winner === 'B' ? 'win' : ''}">${m.teamB || '?'}</div>
                    ${m.resultado ? `<div class="bm-res">${m.resultado}</div>` : ''}
                </div>
            `).join('')}
        </div>
    `).join('<div class="bracket-connector"></div>');
}
