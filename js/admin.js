// js/admin.js - Premium Console v9.5 Logic (Unified & Accordion-Driven)
import { db, auth, observerAuth, getDocument, updateDocument, addDocument, getDocsSafe } from "./firebase-service.js";
import { collection, query, orderBy, limit, serverTimestamp, deleteDoc, doc, setDoc } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI, showToast } from "./ui-core.js";
import { MAX_PLAYERS } from "./config/match-constants.js";
import { levelFromRating } from "./config/elo-system.js";
import { sendCoreNotification } from "./core/core-engine.js";

let users = [];
let matchesArr = [];
let eventsArr = [];
let apoingRecords = [];
let me = null;

document.addEventListener("DOMContentLoaded", () => {
    initAppUI("admin");
    observerAuth(async (user) => {
        if (!user) return window.location.replace("index.html");

        me = await getDocument("usuarios", user.uid);
        const isAdmin = me?.rol === "Admin";
        if (!isAdmin) {
            showToast("Acceso denegado", "No tienes permisos de administrador", "error");
            return window.location.replace("home.html");
        }

        bindTabs();
        bindFilters();
        bindSystemActions();
        await refreshAll();
    });
});

function bindTabs() {
    const tabs = document.querySelectorAll(".admin-tab");
    tabs.forEach((btn) => {
        btn.addEventListener("click", () => {
            const paneName = btn.dataset.pane;
            
            document.querySelectorAll(".admin-tab").forEach(x => {
                if (x.dataset.pane === paneName) x.classList.add('active');
                else x.classList.remove('active');
            });

            document.querySelectorAll(".admin-pane").forEach((p) => p.classList.remove("active"));
            
            const paneId = `pane-${paneName}`;
            const pane = document.getElementById(paneId);
            if (pane) pane.classList.add("active");
            
            // Sync scroll for tabs
            btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        });
    });
}

function bindFilters() {
    document.getElementById("users-search")?.addEventListener("input", renderUsers);
    document.getElementById("users-role-filter")?.addEventListener("change", renderUsers);
    document.getElementById("matches-filter")?.addEventListener("change", renderMatches);
    document.getElementById("matches-type-filter")?.addEventListener("change", renderMatches);
    document.getElementById("pending-search")?.addEventListener("input", renderPending);
    document.getElementById("btn-refresh-admin")?.addEventListener("click", refreshAll);
}

function bindSystemActions() {
    document.getElementById("btn-broadcast")?.addEventListener("click", runBroadcast);
    document.getElementById("btn-cancel-stale")?.addEventListener("click", cancelStaleMatches);
    document.getElementById("btn-reset-presence")?.addEventListener("click", resetPresence);
    document.getElementById("btn-nuke-logs")?.addEventListener("click", clearLogs);
    document.getElementById("btn-save-elo-config")?.addEventListener("click", window.saveEloConfig);
    
    document.getElementById("btn-wipe-recalc")?.addEventListener("click", async () => {
        if (!confirm("☢️ ATENCIÓN: Se va a reconstruir todo el historial de puntos ELO desde el primer partido. ¿Continuar?")) return;
        showToast("Procesando...", "Recalculando ranking global...", "info");
        try {
            const res = await window.WIPE_AND_RECALC_ALL_MATCHES();
            if (res.success) {
                showToast("ÉXITO", "Sincronización masiva completada.", "success");
                await refreshAll();
            }
        } catch (e) {
            showToast("Error", "Fallo en el recálculo.", "error");
        }
    });

    document.getElementById("btn-reset-elo-base")?.addEventListener("click", async () => {
        if (!confirm("¿Resetear a todos los jugadores a 1000 puntos?")) return;
        for(let u of users) {
            await updateDocument("usuarios", u.id, { puntosRanking: 1000, nivel: 2.5 });
        }
        showToast("OK", "Reset completado", "success");
        refreshAll();
    });
}

window.saveEloConfig = async () => {
    const win = Number(document.getElementById("cfg-elo-win")?.value || 25);
    const loss = Number(document.getElementById("cfg-elo-loss")?.value || -15);
    const k = Number(document.getElementById("cfg-elo-k")?.value || 32);

    try {
        showToast("Guardando...", "Actualizando parámetros de puntuación", "info");
        await setDoc(doc(db, "systemConfigs", "elo"), {
            victoryPoints: win,
            lossPoints: loss,
            kFactor: k,
            updatedAt: serverTimestamp(),
            updatedBy: auth.currentUser.uid
        }, { merge: true });
        
        showToast("Configuración Guardada", "Los nuevos valores se aplicarán a futuros cálculos.", "success");
    } catch (e) {
        showToast("Error", "No se pudo guardar la configuración", "error");
    }
};

async function refreshAll() {
    const btn = document.getElementById("btn-refresh-admin");
    if (btn) btn.classList.add("fa-spin");

    try {
        const [uSnap, amSnap, reSnap, evSnapPartidos, evSnapTorneos, apoSnap] = await Promise.all([
            getDocsSafe(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"))),
            getDocsSafe(collection(db, "partidosAmistosos")),
            getDocsSafe(collection(db, "partidosReto")),
            getDocsSafe(collection(db, "eventoPartidos")),
            getDocsSafe(collection(db, "eventos")),
            getDocsSafe(collection(db, "apoingCalendars")),
        ]);

        users = (uSnap?.docs || []).map(d => ({ id: d.id, ...d.data() }));
        matchesArr = [
            ...(amSnap?.docs || []).map(d => ({ id: d.id, col: "partidosAmistosos", ...d.data() })),
            ...(reSnap?.docs || []).map(d => ({ id: d.id, col: "partidosReto", ...d.data() })),
            ...(evSnapPartidos?.docs || []).map(d => ({ id: d.id, col: "eventoPartidos", ...d.data() })),
        ].sort((a, b) => toDate(b.fecha)?.getTime() - toDate(a.fecha)?.getTime());

        eventsArr = (evSnapTorneos?.docs || []).map(d => ({ id: d.id, ...d.data() }));
        apoingRecords = (apoSnap?.docs || []).map(d => ({ id: d.id, ...d.data() }));

        const pendingCount = users.filter(u => u.status !== 'approved' && !u.aprobado && u.rol !== 'Admin').length;
        const dot = document.getElementById("dot-pending");
        if (dot) dot.classList.toggle("hidden", pendingCount === 0);

        renderDashboard();
        renderUsers();
        renderPending();
        renderMatches();
        renderEvents();
        renderRanking();
        renderApoing();
    } catch (e) {
        console.error("Refresh Error:", e);
        showToast("Error", "Error al sincronizar con Firebase", "error");
    } finally {
        if (btn) btn.classList.remove("fa-spin");
    }
}

function renderDashboard() {
    const approved = users.filter((u) => u.status === "approved" || u.aprobado === true || u.rol === "Admin");
    const active = matchesArr.filter((m) => !isPlayed(m)).length;
    const avg = approved.length ? Math.round(approved.reduce((s, u) => s + Number(u.puntosRanking || 1000), 0) / approved.length) : 0;

    setText("kpi-users", String(approved.length));
    setText("kpi-matches", String(matchesArr.length));
    setText("kpi-active", String(active));
    setText("kpi-avg", String(avg));
}

function renderUsers() {
    const search = String(document.getElementById("users-search")?.value || "").toLowerCase();
    const roleFilter = document.getElementById("users-role-filter")?.value || "all";
    const data = users.filter((u) => {
        const okApp = u.status === "approved" || u.aprobado === true || u.rol === "Admin";
        if (!okApp) return false;
        const roleOk = roleFilter === "all" || u.rol === roleFilter;
        const matchStr = `${u.nombre} ${u.nombreUsuario} ${u.email}`.toLowerCase();
        return roleOk && matchStr.includes(search);
    });

    const container = document.getElementById("users-accordion-container");
    if (!container) return;

    container.innerHTML = data.map((u) => `
        <div class="admin-acc-v9" id="user-acc-${u.id}">
            <div class="acc-header" onclick="window.toggleAcc('user-acc-${u.id}')">
                <div class="acc-icon-box">
                    <img src="${u.fotoPerfil || u.fotoURL || './imagenes/Logojafs.png'}" onerror="this.src='./imagenes/Logojafs.png'">
                </div>
                <div class="acc-main">
                    <span class="acc-title">${u.nombreUsuario || u.nombre || "SIN NOMBRE"}</span>
                    <span class="acc-sub">${u.email}</span>
                </div>
                <div class="acc-badges">
                    <span class="acc-badge">${u.puntosRanking || 1000} Pts</span>
                    <span class="acc-badge">${u.rol || 'Jugador'}</span>
                </div>
                <i class="fas fa-chevron-down acc-chevron"></i>
            </div>
            <div class="acc-content">
                <div class="admin-grid-v9">
                    <div class="admin-field-group">
                        <label>Nombre Público</label>
                        <input type="text" class="input-v9" value="${u.nombreUsuario || ''}" id="u-nick-${u.id}">
                    </div>
                    <div class="admin-field-group">
                        <label>Email (ID)</label>
                        <input type="text" class="input-v9" value="${u.email || ''}" readonly>
                    </div>
                    <div class="admin-field-group">
                        <label>Nivel Manual</label>
                        <input type="number" step="0.01" class="input-v9" value="${u.nivel || 2.5}" id="u-lvl-${u.id}">
                    </div>
                    <div class="admin-field-group">
                        <label>Rol</label>
                        <select class="input-v9" id="u-rol-${u.id}">
                            <option value="Jugador" ${u.rol === 'Jugador' ? 'selected' : ''}>JUGADOR</option>
                            <option value="Admin" ${u.rol === 'Admin' ? 'selected' : ''}>ADMIN</option>
                        </select>
                    </div>
                </div>
                <div class="flex-row gap-3 mt-6">
                    <button class="btn-v9 primary flex-1" onclick="window.saveUserAdmin('${u.id}')">ACTUALIZAR PERFIL</button>
                    ${u.id !== auth.currentUser.uid ? `<button class="btn-v9 danger" onclick="window.deleteUserAdmin('${u.id}')"><i class="fas fa-trash"></i></button>` : ''}
                </div>
            </div>
        </div>
    `).join("");
}

function renderPending() {
    const search = String(document.getElementById("pending-search")?.value || "").toLowerCase();
    const data = users.filter(u => (u.status !== 'approved' && !u.aprobado && u.rol !== 'Admin') && (u.email||"").toLowerCase().includes(search));
    const body = document.getElementById("pending-body");
    if (!body) return;

    body.innerHTML = data.map(u => `
        <tr>
            <td>
                <div class="flex-col">
                    <span class="font-black text-white text-xs">${u.nombre || "Nuevo Registro"}</span>
                    <span class="text-[9px] opacity-40 uppercase">${u.email}</span>
                </div>
            </td>
            <td>${u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString() : 'N/A'}</td>
            <td><span class="acc-badge" style="background:rgba(245,158,11,0.1); color:#f59e0b">PENDIENTE</span></td>
            <td class="text-right">
                 <div class="flex-row gap-2 justify-end">
                    <button class="btn-v9 ghost sm text-green-400" onclick="window.approveUserAdmin('${u.id}')"><i class="fas fa-check"></i></button>
                    <button class="btn-v9 ghost sm text-red-400" onclick="window.deleteUserAdmin('${u.id}')"><i class="fas fa-times"></i></button>
                 </div>
            </td>
        </tr>
    `).join("") || '<tr><td colspan="4" class="text-center opacity-30 py-8">No hay solicitudes hoy</td></tr>';
}

function renderMatches() {
    const mode = document.getElementById("matches-filter")?.value || "all";
    const type = document.getElementById("matches-type-filter")?.value || "all";
    let data = [...matchesArr];
    if (mode === 'open') data = data.filter(m => !isPlayed(m));
    if (mode === 'played') data = data.filter(m => isPlayed(m));
    if (type !== 'all') data = data.filter(m => m.col === type);

    const container = document.getElementById("matches-accordion-container");
    if (!container) return;

    container.innerHTML = data.map(m => {
        const date = toDate(m.fecha);
        const dateStr = date ? date.toLocaleString('es-ES', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : 'Sin Fecha';
        const typeLabel = m.col === 'eventoPartidos' ? 'TORNEO' : (m.col === 'partidosReto' ? 'RETO' : 'AMISTOSO');
        const res = m.resultado?.sets || m.resultado?.score || '--';

        return `
        <div class="admin-acc-v9" id="match-acc-${m.id}">
            <div class="acc-header" onclick="window.toggleAcc('match-acc-${m.id}')">
                <div class="acc-icon-box"><i class="fas fa-table-tennis-paddle-ball"></i></div>
                <div class="acc-main">
                    <span class="acc-title">${m.teamAName || 'TBD'} vs ${m.teamBName || 'TBD'}</span>
                    <span class="acc-sub">${dateStr} · ${typeLabel}</span>
                </div>
                <div class="acc-badges">
                    <span class="acc-badge">${isPlayed(m) ? res : 'ABIERTO'}</span>
                </div>
                <i class="fas fa-chevron-down acc-chevron"></i>
            </div>
            <div class="acc-content">
                <div class="admin-grid-v9">
                    <div class="admin-field-group col-span-2">
                        <label>Resultado del Partido</label>
                        <input type="text" class="input-v9" value="${res === '--' ? '' : res}" id="m-res-${m.id}" placeholder="Ej: 6-4 6-2">
                    </div>
                    <div class="admin-field-group">
                        <label>Fecha y Hora</label>
                        <input type="datetime-local" class="input-v9" value="${date ? date.toISOString().slice(0, 16) : ''}" id="m-date-${m.id}">
                    </div>
                    <div class="admin-field-group">
                        <label>Estado</label>
                        <select class="input-v9" id="m-state-${m.id}">
                            <option value="abierto" ${m.estado === 'abierto' ? 'selected' : ''}>Abierto</option>
                            <option value="jugado" ${m.estado === 'jugado' ? 'selected' : ''}>Finalizado</option>
                            <option value="cancelado" ${m.estado === 'cancelado' ? 'selected' : ''}>Cancelado</option>
                        </select>
                    </div>
                </div>
                <div class="flex-row gap-3 mt-6">
                    <button class="btn-v9 primary flex-1" onclick="window.saveMatchAdmin('${m.id}','${m.col}')">GUARDAR CAMBIOS</button>
                    <button class="btn-v9 danger" onclick="window.deleteMatchAdmin('${m.id}','${m.col}')">ELIMINAR</button>
                </div>
            </div>
        </div>
        `;
    }).join("");
}

function renderEvents() {
    const container = document.getElementById("events-accordion-container");
    if (!container) return;

    container.innerHTML = eventsArr.map(e => `
        <div class="admin-acc-v9" id="ev-acc-${e.id}">
            <div class="acc-header" onclick="window.toggleAcc('ev-acc-${e.id}')">
                <div class="acc-icon-box"><i class="fas fa-trophy"></i></div>
                <div class="acc-main">
                    <span class="acc-title">${e.nombre}</span>
                    <span class="acc-sub">${e.formato?.toUpperCase()} · ${e.estado?.toUpperCase()}</span>
                </div>
                <div class="acc-badges">
                    <span class="acc-badge">${(e.inscritos||[]).length} INSCRITOS</span>
                </div>
                <i class="fas fa-chevron-down acc-chevron"></i>
            </div>
            <div class="acc-content">
                <div class="admin-grid-v9">
                    <div class="admin-field-group">
                        <label>Estado del Torneo</label>
                        <select class="input-v9" id="ev-state-${e.id}">
                            <option value="inscripcion" ${e.estado === 'inscripcion' ? 'selected' : ''}>Inscripciones</option>
                            <option value="activo" ${e.estado === 'activo' ? 'selected' : ''}>Activo (En Juego)</option>
                            <option value="finalizado" ${e.estado === 'finalizado' ? 'selected' : ''}>Cerrado</option>
                        </select>
                    </div>
                    <div class="admin-field-group">
                        <label>Máximo de Plazas</label>
                        <input type="number" class="input-v9" value="${e.plazasMax || 16}" id="ev-plazas-${e.id}">
                    </div>
                </div>
                <div class="flex-row gap-3 mt-6">
                    <button class="btn-v9 primary flex-1" onclick="window.saveEventAdmin('${e.id}')">ACTUALIZAR CONFIGURACIÓN</button>
                    <button class="btn-v9 ghost" onclick="window.location.href='evento-detalle.html?id=${e.id}&admin=1'">MODIFICAR EQUIPOS / BRACKET</button>
                </div>
            </div>
        </div>
    `).join("");
}

function renderRanking() {
    const body = document.getElementById("ranking-body");
    if (!body) return;
    const data = [...users].sort((a,b) => (b.puntosRanking||1000) - (a.puntosRanking||1000)).slice(0, 50);
    
    body.innerHTML = data.map((u, i) => `
        <tr>
            <td>#${i+1}</td>
            <td class="font-black text-white">${u.nombreUsuario || u.nombre}</td>
            <td><input type="number" class="inl w-20" value="${u.puntosRanking||1000}" id="r-points-${u.id}"></td>
            <td>${(u.nivel||2.5).toFixed(1)}</td>
            <td class="text-right">
                <button class="btn-v9 ghost sm" onclick="window.saveUserRanking('${u.id}')"><i class="fas fa-save"></i></button>
            </td>
        </tr>
    `).join("");
}

function renderApoing() {
    const body = document.getElementById("apoing-body");
    if (!body) return;
    body.innerHTML = apoingRecords.map(a => `
        <tr>
            <td>${a.nombre || a.id}</td>
            <td><input type="text" class="inl w-full text-[10px]" value="${a.icsUrl}" id="ap-url-${a.id}"></td>
            <td class="text-right">
                <button class="btn-v9 ghost sm" onclick="window.saveApoingAdmin('${a.id}')"><i class="fas fa-save"></i></button>
            </td>
        </tr>
    `).join("");
}

/* API ACTIONS */
window.toggleAcc = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const isActive = el.classList.contains('active');
    document.querySelectorAll('.admin-acc-v9').forEach(x => x.classList.remove('active'));
    if (!isActive) el.classList.add('active');
};

window.saveUserAdmin = async (uid) => {
    const data = {
        nombreUsuario: document.getElementById(`u-nick-${uid}`).value,
        nivel: parseFloat(document.getElementById(`u-lvl-${uid}`).value),
        rol: document.getElementById(`u-rol-${uid}`).value
    };
    await updateDocument("usuarios", uid, data);
    showToast("SISTEMA", "Perfil actualizado", "success");
    refreshAll();
};

window.saveMatchAdmin = async (id, col) => {
    const data = {
        estado: document.getElementById(`m-state-${id}`).value,
        fecha: document.getElementById(`m-date-${id}`).value,
        resultado: { sets: document.getElementById(`m-res-${id}`).value }
    };
    if (data.resultado.sets && data.estado === 'abierto') data.estado = 'jugado';
    await updateDocument(col, id, data);
    showToast("SISTEMA", "Partido guardado", "success");
    refreshAll();
};

window.saveEventAdmin = async (id) => {
    const data = {
        estado: document.getElementById(`ev-state-${id}`).value,
        plazasMax: parseInt(document.getElementById(`ev-plazas-${id}`).value)
    };
    await updateDocument("eventos", id, data);
    showToast("SISTEMA", "Torneo actualizado", "success");
    refreshAll();
};

window.approveUserAdmin = async (uid) => {
    await updateDocument("usuarios", uid, { status: "approved", aprobado: true });
    showToast("SISTEMA", "Acceso aprobado", "success");
    refreshAll();
};

window.deleteUserAdmin = async (uid) => {
    if (!confirm("¿Eliminar usuario?")) return;
    await deleteDoc(doc(db, "usuarios", uid));
    showToast("SISTEMA", "Usuario borrado", "warn");
    refreshAll();
};

window.deleteMatchAdmin = async (id, col) => {
    if (!confirm("¿Borrar partido?")) return;
    await deleteDoc(doc(db, col, id));
    refreshAll();
};

window.saveUserRanking = async (uid) => {
    const pts = parseInt(document.getElementById(`r-points-${uid}`).value);
    await updateDocument("usuarios", uid, { puntosRanking: pts, nivel: levelFromRating(pts) });
    showToast("SISTEMA", "Puntos sincronizados", "success");
    refreshAll();
};

/* HELPERS */
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function toDate(v) { 
    if (!v) return null; 
    if (v.toDate) return v.toDate(); 
    if (v instanceof Date) return v;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
}
function isPlayed(m) { 
    const s = String(m.estado || "").toLowerCase(); 
    return s === 'jugado' || !!m.resultado?.sets || !!m.resultado?.score; 
}

async function runBroadcast() {
    const title = document.getElementById("sys-broadcast-title").value;
    const msg = document.getElementById("sys-broadcast-message").value;
    if (!title || !msg) return;
    const uids = users.map(u => u.id);
    await sendCoreNotification(uids, title, msg, "info", "home.html");
    showToast("ANUNCIO", "Enviado con éxito", "success");
}

async function cancelStaleMatches() {
    const now = Date.now();
    const stale = matchesArr.filter(m => !isPlayed(m) && toDate(m.fecha)?.getTime() < now - (2 * 3600 * 1000));
    for (const m of stale) await updateDocument(m.col, m.id, { estado: "anulado" });
    showToast("OK", "Mantenimiento realizado");
    refreshAll();
}

async function resetPresence() {
    for (const u of users) await updateDocument("usuarios", u.id, { enLinea: false });
    showToast("OK", "Presencia reseteada");
}

async function clearLogs() {
    showToast("SISTEMA", "Función no disponible en esta build", "info");
}


/* --- MODAL & WIZARD ACTIONS --- */
window.openCreateMatchAdmin = () => {
    const modal = document.getElementById('modal-admin-create-match');
    if (modal) modal.classList.add('active');
};

window.confirmCreateMatchAdmin = async () => {
    const col = document.getElementById('adm-create-col').value;
    const dateInput = document.getElementById('adm-create-date').value;
    const state = document.getElementById('adm-create-state').value;

    if (!dateInput) return showToast("ERROR", "Selecciona una fecha válida", "error");

    const matchData = {
        fecha: new Date(dateInput),
        estado: state,
        jugadores: [null, null, null, null],
        equipoA: [null, null],
        equipoB: [null, null],
        creador: auth.currentUser?.uid,
        organizerId: auth.currentUser?.uid,
        createdAt: serverTimestamp(),
        visibilidad: 'public'
    };

    try {
        await addDocument(col, matchData);
        showToast("ÉXITO", "Partido creado manualmente", "success");
        document.getElementById('modal-admin-create-match').classList.remove('active');
        refreshAll();
    } catch (e) {
        showToast("ERROR", "No se pudo crear el partido", "error");
    }
};

window.openCreateEventWizard = () => {
    // Redirect to event creation or open a simplified modal
    showToast("EVENTOS", "Redirigiendo al creador de eventos...", "info");
    setTimeout(() => window.location.href = 'eventos.html?create=1', 800);
};

window.syncApoingAdmin = async () => {
    showToast("APOING", "Iniciando sincronización forzada...", "info");
    try {
        const { syncApoingReservations } = await import('./calendario.js');
        await syncApoingReservations(true);
        showToast("APOING", "Sincronización completada", "success");
        refreshAll();
    } catch (e) {
        showToast("ERROR", "Fallo al sincronizar Apoing", "error");
    }
};

window.saveEloConfig = async () => {
    const win = parseInt(document.getElementById('cfg-elo-win').value);
    const loss = parseInt(document.getElementById('cfg-elo-loss').value);
    const k = parseInt(document.getElementById('cfg-elo-k').value);

    // Guardar en una colección de configuración global si existe, o localmente para esta sesión
    // Por ahora, simulamos persistencia en una colección 'config'
    try {
        await setDoc(doc(db, "config", "elo"), { win, loss, k, updatedAt: serverTimestamp() });
        showToast("SISTEMA", "Configuración ELO guardada globalmente", "success");
    } catch (e) {
        showToast("ERROR", "No tienes permisos para cambiar la config global", "error");
    }
};

window.resetEloToBase = async () => {
    if (!confirm("¿Resetear a todos los jugadores a 1000 puntos? Esta acción es irreversible.")) return;
    showToast("PROCESANDO", "Reseteando ranking global...", "info");
    
    const { ELO_CONFIG } = await import("./config/elo-system.js");
    const base = ELO_CONFIG.BASE_RATING || 1000;

    let count = 0;
    for (let u of users) {
        await updateDocument("usuarios", u.id, { 
            puntosRanking: base, 
            nivel: 2.5,
            victorias: 0,
            partidosJugados: 0
        });
        count++;
    }
    showToast("COMPLETO", `${count} jugadores reseteados a ${base} pts`, "success");
    refreshAll();
};

window.saveApoingAdmin = async (id) => {
    const url = document.getElementById(`ap-url-${id}`).value;
    if (!url.includes('.ics')) return showToast("ERROR", "URL ICS no válida", "error");
    
    await updateDocument("apoingCalendars", id, { icsUrl: url });
    showToast("SISTEMA", "Enlace Apoing actualizado", "success");
    refreshAll();
};

