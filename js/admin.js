// js/admin.js - Premium Console v9.5 Logic (Unified & Accordion-Driven)
import { db, auth, observerAuth, getDocument, updateDocument, addDocument, getDocsSafe } from "./firebase-service.js";
import { collection, collectionGroup, query, orderBy, limit, serverTimestamp, deleteDoc, doc, setDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI, showToast } from "./ui-core.js";
import { MAX_PLAYERS } from "./config/match-constants.js";
import { levelFromRating, ELO_SYSTEM_VERSION } from "./config/elo-system.js";
import { sendCoreNotification } from "./core/core-engine.js";

let users = [];
let matchesArr = [];
let eventsArr = [];
let apoingRecords = [];
let apoingByUid = new Map();
let deviceStatsByUid = new Map();
let me = null;
let proposalsArr = [];

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
    document.getElementById("btn-refresh-proposals")?.addEventListener("click", refreshProposals);
}

function bindSystemActions() {
    document.getElementById("btn-broadcast")?.addEventListener("click", runBroadcast);
    document.getElementById("btn-execute-maint")?.addEventListener("click", async () => {
        const action = document.getElementById("sys-maint-action")?.value;
        if (!action || action === "none") return showToast("Aviso", "Selecciona una tarea de mantenimiento", "info");
        
        if (action === "cancel_stale") await cancelStaleMatches();
        else if (action === "reset_presence") await resetPresence();
        else if (action === "clean_event_dupes") await cleanupEventDuplicates();
        else if (action === "clean_old_events") await cleanupOldEventMatches();
        else if (action === "nuke_logs") await clearLogs();
        else if (action === "sync_apoing") await window.syncApoingAdmin();
        
        await refreshAll();
    });
    document.getElementById("btn-save-elo-config")?.addEventListener("click", window.saveEloConfig);
    document.getElementById("btn-emergency-recover")?.addEventListener("click", recoverFromRankingLogs);
    document.getElementById("btn-recover-matches")?.addEventListener("click", recoverMatchesFromLogs);
    document.getElementById("btn-execute-delete-matches")?.addEventListener("click", () => {
        const action = document.getElementById("matches-delete-action")?.value;
        if (!action || action === "none") return showToast("Aviso", "Selecciona una opción de borrado", "info");
        window.deleteMatchesByFilter(action);
    });

    document.getElementById("btn-execute-elo-action")?.addEventListener("click", async () => {
        const action = document.getElementById("elo-action-select")?.value;
        if (!action || action === "none") return showToast("Aviso", "Selecciona una acción ELO", "info");

        if (action === "reset_base") {
            await window.resetEloToBase();
        } else if (action === "recalc_level") {
            if (!confirm("Se recalculará el ELO partiendo del nivel actual de cada usuario. ¿Continuar?")) return;
            showToast("Procesando...", "Recalculando desde nivel actual...", "info");
            try {
                const res = await window.RECALC_FROM_CURRENT_LEVELS();
                if (res.success) {
                    showToast("OK", "Recalculo completado.", "success");
                    showRecalcReport(res, "Recalculo desde nivel");
                    await refreshAll();
                }
            } catch (e) {
                showToast("Error", "Fallo en el recalculo.", "error");
            }
        } else if (action === "recalc_points") {
            if (!confirm("Se recalculará el histórico usando los puntos actuales como base. ¿Continuar?")) return;
            showToast("Procesando...", "Recalculando desde puntos actuales...", "info");
            try {
                const res = await window.RECALC_FROM_CURRENT_POINTS();
                if (res.success) {
                    showToast("OK", "Recalculo completado.", "success");
                    showRecalcReport(res, "Recalculo desde puntos");
                    await refreshAll();
                }
            } catch (e) {
                showToast("Error", "Fallo en el recalculo.", "error");
            }
        } else if (action === "historical") {
            if (!confirm("⚠️ ATENCIÓN: Se va a reconstruir todo el historial de puntos ELO desde el primer partido. ¿Continuar?")) return;
            showToast("Procesando...", "Recalculando ranking global...", "info");
            try {
                const res = await window.WIPE_AND_RECALC_ALL_MATCHES();
                if (res.success) {
                    showToast("ÉXITO", "Sincronización masiva completada.", "success");
                    showRecalcReport(res, "Recalculo total");
                    await refreshAll();
                }
            } catch (e) {
                showToast("Error", "Fallo en el recálculo.", "error");
            }
        }
    });

}

function normalizeTeamName(value) {
    return String(value || "").trim().toLowerCase();
}

function isUnknownTeamName(value) {
    const n = normalizeTeamName(value);
    if (!n) return true;
    const compact = n.replace(/\s+/g, "");
    if (["tbd", "tbd.", "tbd?", "tdb", "?", "unknown"].includes(n)) return true;
    if (["tbd", "tbd.", "tbd?", "tdb", "tbdvs", "tbdvstbd", "tbdtbd", "unknown"].includes(compact)) return true;
    if (["desconocido", "desconocidos", "por confirmar", "por definir", "pendiente"].includes(n)) return true;
    return false;
}

function getRealPlayerCount(match) {
    const players = (match?.jugadores || match?.playerUids || []).filter(Boolean);
    return players.filter((p) => !String(p).startsWith("GUEST_")).length;
}

function buildEventDedupKey(match) {
    const eventId = String(match?.eventoId || "");
    const court = String(match?.courtType || match?.pista || match?.court || "unknown").toLowerCase();
    const d = match?.fecha?.toDate ? match.fecha.toDate() : (match?.fecha ? new Date(match.fecha) : null);
    if (d && !Number.isNaN(d.getTime())) {
        const when = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
        return `${eventId}|${court}|${when}`;
    }
    const teamA = String(match?.teamAId || "");
    const teamB = String(match?.teamBId || "");
    const group = String(match?.group || "");
    const round = String(match?.round || "");
    const phase = String(match?.phase || "");
    const code = String(match?.matchCode || "");
    return `${eventId}|${phase}|${group}|${round}|${teamA}|${teamB}|${code}`;
}

function computeMatchScore(match) {
    let score = 0;
    const playerCount = getRealPlayerCount(match);
    score += playerCount * 10;
    if (match?.linkedMatchId) score += 1000;
    if (match?.resultado || String(match?.estado || "").toLowerCase() === "jugado") score += 50;
    if (match?.teamAId) score += 3;
    if (match?.teamBId) score += 3;
    if (!isUnknownTeamName(match?.teamAName)) score += 2;
    if (!isUnknownTeamName(match?.teamBName)) score += 2;
    return score;
}

function shouldDeleteDuplicate(keep, candidate) {
    if (candidate?.linkedMatchId && !keep?.linkedMatchId) return false;
    const cPlayers = getRealPlayerCount(candidate);
    const kPlayers = getRealPlayerCount(keep);
    const cUnknown = isUnknownTeamName(candidate?.teamAName) && isUnknownTeamName(candidate?.teamBName);
    if (cPlayers === 0 && cUnknown) return true;
    if (kPlayers > 0 && cPlayers === 0) return true;
    return false;
}

async function cleanupEventDuplicates() {
    if (!confirm("¿Analizar y limpiar duplicados de eventos (TBD vs TBD)?")) return;
    showToast("Limpieza", "Analizando eventoPartidos...", "info");
    try {
        const snap = await getDocsSafe(collection(db, "eventoPartidos"));
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const validEventIds = new Set(eventsArr.map((e) => e.id));
        const groups = new Map();
        rows.forEach((m) => {
            const key = buildEventDedupKey(m);
            const list = groups.get(key) || [];
            list.push(m);
            groups.set(key, list);
        });

        const toDelete = [];
        let dupGroups = 0;

        groups.forEach((list) => {
            if (list.length < 2) return;
            dupGroups += 1;
            const sorted = [...list].sort((a, b) => computeMatchScore(b) - computeMatchScore(a));
            const keep = sorted[0];
            sorted.slice(1).forEach((m) => {
                if (shouldDeleteDuplicate(keep, m)) toDelete.push(m);
            });
        });

        rows.forEach((m) => {
            const eventId = String(m?.eventoId || "");
            const hasPlayers = getRealPlayerCount(m) > 0;
            const unknownTeams = isUnknownTeamName(m?.teamAName) && isUnknownTeamName(m?.teamBName);
            if (eventId && !validEventIds.has(eventId)) toDelete.push(m);
            else if (!eventId && !hasPlayers && unknownTeams) toDelete.push(m);
            else if (unknownTeams && !hasPlayers && String(m?.estado || "").toLowerCase() !== "jugado") toDelete.push(m);
        });

        if (!toDelete.length) {
            showToast("Limpieza", `No hay duplicados eliminables. Grupos revisados: ${dupGroups}.`, "success");
            return;
        }

        if (!confirm(`Se eliminarán ${toDelete.length} registros duplicados/huérfanos (solo TBD/0 jugadores o eventos inexistentes). ¿Continuar?`)) return;

        for (const m of toDelete) {
            await deleteDoc(doc(db, "eventoPartidos", m.id));
        }
        showToast("Limpieza completada", `Eliminados ${toDelete.length} duplicados.`, "success");
        await refreshAll();
    } catch (e) {
        console.error(e);
        showToast("Error", "No se pudo limpiar duplicados de eventos.", "error");
    }
}

async function cleanupOldEventMatches() {
    if (!confirm("¿Borrar todos los partidos de eventos antiguos/no activos?")) return;
    const activeIds = new Set(
        eventsArr
            .filter(e => !["finalizado", "cancelado"].includes(String(e?.estado || "").toLowerCase()))
            .map(e => e.id)
    );
    showToast("Limpieza", "Eliminando partidos de eventos antiguos...", "info");
    try {
        const snap = await getDocsSafe(collection(db, "eventoPartidos"));
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        const toDelete = rows.filter(m => !activeIds.has(String(m.eventoId || "")));
        if (!toDelete.length) return showToast("OK", "No hay partidos antiguos", "success");
        if (!confirm(`Se eliminarán ${toDelete.length} partidos de eventos no activos. ¿Continuar?`)) return;
        for (const m of toDelete) {
            await deleteDoc(doc(db, "eventoPartidos", m.id));
            if (m.linkedMatchId && m.linkedMatchCollection) {
                await deleteDoc(doc(db, m.linkedMatchCollection, m.linkedMatchId));
            }
        }
        showToast("Limpieza completa", `Eliminados ${toDelete.length} partidos`, "success");
        await refreshAll();
    } catch (e) {
        console.error(e);
        showToast("Error", "No se pudo limpiar eventos antiguos.", "error");
    }
}

// Simple report modal for ELO recalculation runs.
function showRecalcReport(res, title = "Recalculo") {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay active modal-stack-front";
    const errors = Array.isArray(res?.errorList) ? res.errorList : [];
    overlay.innerHTML = `
        <div class="modal-card glass-strong" style="max-width:520px;">
            <div class="modal-header">
                <h3 class="modal-title">${title}</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <div class="p-3 rounded-xl border border-white/10 bg-white/5 text-xs mb-4">
                    <div class="flex-row between"><span>Procesados</span><b>${res?.processed || 0}</b></div>
                    <div class="flex-row between"><span>Errores</span><b>${res?.errors || 0}</b></div>
                    <div class="flex-row between"><span>Tiempo</span><b>${res?.elapsed || "--"}s</b></div>
                </div>
                ${errors.length ? `
                    <div class="text-[10px] font-black text-muted uppercase tracking-widest mb-2">Errores recientes</div>
                    <div class="flex-col gap-2 max-h-[40vh] overflow-y-auto custom-scroll">
                        ${errors.map(e => `<div class="p-2 rounded-lg bg-white/5 border border-white/10 text-[10px]">
                            <div><b>${e.col}</b> · ${e.id}</div>
                            <div class="opacity-70">${e.error}</div>
                        </div>`).join("")}
                    </div>
                ` : `<div class="text-[10px] text-muted">Sin errores reportados.</div>`}
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
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
        const [uSnap, amSnap, reSnap, evSnapPartidos, evSnapTorneos, apoSnap, devicesSnap, propSnap] = await Promise.all([
            getDocsSafe(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"))),
            getDocsSafe(collection(db, "partidosAmistosos")),
            getDocsSafe(collection(db, "partidosReto")),
            getDocsSafe(collection(db, "eventoPartidos")),
            getDocsSafe(collection(db, "eventos")),
            getDocsSafe(collection(db, "apoingCalendars")),
            getDocsSafe(query(collectionGroup(db, "devices"), limit(2000))),
            getDocsSafe(query(collection(db, "propuestasPartido"), orderBy("createdAt", "desc"), limit(200))),
        ]);

        users = (uSnap?.docs || []).map(d => ({ id: d.id, ...d.data() }));
        matchesArr = [
            ...(amSnap?.docs || []).map(d => ({ id: d.id, col: "partidosAmistosos", ...d.data() })),
            ...(reSnap?.docs || []).map(d => ({ id: d.id, col: "partidosReto", ...d.data() })),
            ...(evSnapPartidos?.docs || []).map(d => ({ id: d.id, col: "eventoPartidos", ...d.data() })),
        ].sort((a, b) => toDate(b.fecha)?.getTime() - toDate(a.fecha)?.getTime());

        eventsArr = (evSnapTorneos?.docs || []).map(d => ({ id: d.id, ...d.data() }));
        apoingRecords = (apoSnap?.docs || []).map(d => ({ id: d.id, ...d.data() }));
        apoingByUid = new Map(apoingRecords.map(r => [r.id, r]));
        proposalsArr = (propSnap?.docs || []).map(d => ({ id: d.id, ...d.data() }));

        deviceStatsByUid = new Map();
        (devicesSnap?.docs || []).forEach((d) => {
            const parent = d.ref?.parent?.parent;
            const uid = parent ? parent.id : null;
            if (!uid) return;
            const data = d.data() || {};
            const stat = deviceStatsByUid.get(uid) || { count: 0, enabled: 0, lastSeenAt: null };
            stat.count += 1;
            if (data.enabled) stat.enabled += 1;
            const seen = data.lastSeenAt?.toDate ? data.lastSeenAt.toDate() : (data.lastSeenAt ? new Date(data.lastSeenAt) : null);
            if (seen && (!stat.lastSeenAt || seen > stat.lastSeenAt)) stat.lastSeenAt = seen;
            deviceStatsByUid.set(uid, stat);
        });

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
        renderProposals();
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

    container.innerHTML = data.map((u) => {
        const icsUrl = String(u.apoingCalendarUrl || apoingByUid.get(u.id)?.icsUrl || "").trim();
        const hasIcs = icsUrl.length > 0;
        const notifPermission = String(u.notifPermission || "unknown");
        const stat = deviceStatsByUid.get(u.id) || { count: 0, enabled: 0, lastSeenAt: null };
        let notifLabel = "Desconocido";
        let notifClass = "acc-badge";
        if (notifPermission === "denied") { notifLabel = "Bloqueadas"; notifClass = "acc-badge text-red-300"; }
        else if (notifPermission === "default") { notifLabel = "Sin permiso"; notifClass = "acc-badge text-amber-300"; }
        else if (notifPermission === "granted" && stat.enabled > 0) { notifLabel = "Activas"; notifClass = "acc-badge text-green-300"; }
        else if (notifPermission === "granted" && stat.count === 0) { notifLabel = "Sin dispositivo"; notifClass = "acc-badge text-amber-300"; }
        else if (notifPermission === "granted") { notifLabel = "Sin suscripción"; notifClass = "acc-badge text-amber-300"; }
        const seenStr = stat.lastSeenAt ? stat.lastSeenAt.toLocaleDateString("es-ES") : "N/D";
        return `
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
                    <div class="admin-field-group col-span-2">
                        <label>Foto Perfil (URL)</label>
                        <input type="text" class="input-v9" value="${u.fotoPerfil || u.fotoURL || ''}" id="u-photo-${u.id}" placeholder="https://...">
                    </div>
                    <div class="admin-field-group col-span-2">
                        <label><i class="fas fa-trophy mr-1"></i> Apoing ICS</label>
                        <input type="text" class="input-v9" value="${icsUrl}" id="u-ics-${u.id}" placeholder="https://www.apoing.com/calendars/... .ics">
                    </div>
                    <div class="admin-field-group">
                        <label>Estado ICS</label>
                        <div class="input-v9 flex-row between">
                            <span>${hasIcs ? "Conectado" : "Falta"}</span>
                            <span class="text-[10px] opacity-60">${hasIcs ? "OK" : "N/A"}</span>
                        </div>
                    </div>
                    <div class="admin-field-group">
                        <label>Notificaciones</label>
                        <div class="input-v9 flex-row between">
                            <span class="${notifClass}">${notifLabel}</span>
                            <span class="text-[10px] opacity-60">${stat.enabled || 0}/${stat.count || 0} · ${seenStr}</span>
                        </div>
                    </div>
                </div>
                <div class="flex-row gap-3 mt-6">
                    <button class="btn-v9 primary flex-1" onclick="window.saveUserAdmin('${u.id}')">ACTUALIZAR PERFIL</button>
                    ${u.id !== auth.currentUser.uid ? `<button class="btn-v9 danger" onclick="window.deleteUserAdmin('${u.id}')"><i class="fas fa-trash"></i></button>` : ''}
                </div>
            </div>
        </div>
    `;}).join("");
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
    let data = [...matchesArr].filter(m => {
        if (m.col === 'eventoPartidos') {
            const played = isPlayed(m);
            const hasDate = !!m.fecha;
            return played || hasDate;
        }
        return true;
    });

    if (mode === 'open') data = data.filter(m => !isPlayed(m));
    if (mode === 'played') data = data.filter(m => isPlayed(m));
    if (mode === 'upcoming') data = data.filter(m => !isPlayed(m) && toDate(m.fecha)?.getTime() >= Date.now());
    if (mode === 'orphan') data = data.filter(m => hasOrphanPlayers(m));
    if (type !== 'all') data = data.filter(m => m.col === type);

    const container = document.getElementById("matches-accordion-container");
    if (!container) return;

    container.innerHTML = data.map(m => {
        const date = toDate(m.fecha);
        const dateStr = date ? date.toLocaleString('es-ES', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : 'Sin Fecha';
        const typeLabel = m.col === 'eventoPartidos' ? 'TORNEO' : (m.col === 'partidosReto' ? 'RETO' : 'AMISTOSO');
        const res = m.resultado?.sets || m.resultado?.score || '--';
        const playerIds = getMatchPlayersNormalized(m).filter(Boolean);
        const playerNames = playerIds.map(uid => {
            if (String(uid).startsWith('GUEST_')) {
                const name = String(uid).split('_').slice(1).join(' ');
                return `<span class="text-[10px] text-amber-400">${name || 'Invitado'}</span>`;
            }
            const u = users.find(u => u.id === uid);
            return `<span class="text-[10px] text-white/70">${u?.nombreUsuario || u?.nombre || uid.slice(0,8)}</span>`;
        }).join(' · ') || '<span class="text-[10px] opacity-30">Sin jugadores</span>';
        const eloProcessed = m.rankingProcessedAt ? '✅ Procesado' : (isPlayed(m) ? '⚠️ Sin ELO' : '—');
        const eloStatusColor = m.rankingProcessedAt ? 'text-green-400' : (isPlayed(m) ? 'text-amber-400' : 'opacity-30');

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
                    <span class="acc-badge ${eloStatusColor}">${eloProcessed}</span>
                </div>
                <i class="fas fa-chevron-down acc-chevron"></i>
            </div>
            <div class="acc-content">
                <div class="admin-grid-v9">
                    <div class="admin-field-group col-span-2">
                        <label>Jugadores (${playerIds.length}/4)</label>
                        <div class="input-v9 flex-row flex-wrap gap-2">${playerNames}</div>
                    </div>
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
                <div class="flex-row gap-3 mt-6 flex-wrap">
                    <button class="btn-v9 primary flex-1" onclick="window.saveMatchAdmin('${m.id}','${m.col}')">GUARDAR + ELO</button>
                    ${isPlayed(m) && !m.rankingProcessedAt ? `<button class="btn-v9 ghost" onclick="window.recalcMatchElo('${m.id}','${m.col}',document.getElementById('m-res-${m.id}').value||'${res}')">⚡ RECALC ELO</button>` : ''}
                    <button class="btn-v9 danger" onclick="window.deleteMatchAdmin('${m.id}','${m.col}')">ELIMINAR</button>
                </div>
            </div>
        </div>
        `;
    }).join("");
}


function getMatchPlayersNormalized(m) {
    if (Array.isArray(m?.jugadores) && m.jugadores.length) return m.jugadores;
    if (Array.isArray(m?.playerUids) && m.playerUids.length) return m.playerUids;
    const teamA = Array.isArray(m?.equipoA) ? m.equipoA : [];
    const teamB = Array.isArray(m?.equipoB) ? m.equipoB : [];
    return [...teamA, ...teamB].filter(Boolean);
}

function hasOrphanPlayers(m) {
    const ids = getMatchPlayersNormalized(m).filter(Boolean);
    if (!ids.length) return false;
    const userIds = new Set(users.map((u) => u.id));
    return ids.some((uid) => uid && !String(uid).startsWith("GUEST_") && !userIds.has(uid));
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

async function refreshProposals() {
    try {
        const snap = await getDocs(query(collection(db, "propuestasPartido"), orderBy("createdAt", "desc"), limit(200)));
        proposalsArr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderProposals();
    } catch (e) {
        showToast("Error", "No se pudieron cargar las propuestas", "error");
    }
}

function renderProposals() {
    const container = document.getElementById("proposals-admin-list");
    if (!container) return;
    if (!proposalsArr.length) {
        container.innerHTML = `<div class="p-4 rounded-xl border border-white/10 bg-white/5 text-[11px] opacity-60">No hay propuestas registradas.</div>`;
        return;
    }

    const openList = proposalsArr.filter((p) => String(p.status || "open").toLowerCase() === "open");
    const closedList = proposalsArr.filter((p) => String(p.status || "open").toLowerCase() !== "open");

    const section = (title, list) => {
        if (!list.length) {
            return `
                <div class="p-3 rounded-xl border border-white/10 bg-white/5 text-[10px] opacity-60">
                    ${title}: sin registros.
                </div>
            `;
        }
        return `
            <div class="flex-row between mb-2 mt-4">
                <div class="text-[11px] font-black uppercase tracking-widest opacity-70">${title}</div>
                <div class="text-[10px] opacity-60">${list.length} total</div>
            </div>
            ${list.map((p) => {
                const names = Array.isArray(p.participantNames) ? p.participantNames.join(", ") : "";
                const status = String(p.status || "open").toUpperCase();
                const created = formatDateShort(p.createdAt);
                const updated = formatDateShort(p.updatedAt);
                const dates = updated !== "N/D" ? `${created} - act. ${updated}` : created;
                return `
                    <div class="admin-acc-v9">
                        <div class="admin-acc-head" onclick="this.parentElement.classList.toggle('active')">
                            <div class="flex-col">
                                <span class="admin-acc-title">${escapeHtml(p.title || "Propuesta")}</span>
                                <span class="admin-acc-sub">${status} � ${escapeHtml(names || "sin participantes")}</span>
                                <span class="text-[9px] opacity-50">${dates}</span>
                            </div>
                            <button class="btn-v9 ghost" onclick="event.stopPropagation(); window.openProposalAdminChat('${p.id}')">Ver chat</button>
                        </div>
                        <div class="admin-acc-body">
                            <div class="admin-field-group col-span-2">
                                <label>Estado</label>
                                <div class="text-xs">${status}</div>
                            </div>
                            <div class="admin-field-group col-span-2">
                                <label>Participantes</label>
                                <div class="text-xs">${escapeHtml(names || "N/D")}</div>
                            </div>
                        </div>
                    </div>
                `;
            }).join("")}
        `;
    };

    container.innerHTML = [
        section("Propuestas abiertas", openList),
        section("Historial de propuestas cerradas", closedList),
    ].join("");
}

window.openProposalAdminChat = async (proposalId) => {
    if (!proposalId) return;
    let modal = document.getElementById("modal-proposal-admin");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "modal-proposal-admin";
        modal.className = "modal-overlay active";
        modal.innerHTML = `
            <div class="modal-card glass-strong" style="max-width:520px;">
                <div class="modal-header">
                    <h3 class="modal-title">Chat de propuesta</h3>
                    <button class="close-btn" onclick="this.closest('.modal-overlay').remove()">&times;</button>
                </div>
                <div class="modal-body scroll-y" id="proposal-admin-body" style="max-height:70vh;"></div>
            </div>
        `;
        modal.addEventListener("click", (e) => {
            if (e.target === modal) modal.remove();
        });
        document.body.appendChild(modal);
    }
    modal.classList.add("active");
    const body = modal.querySelector("#proposal-admin-body");
    if (!body) return;
    body.innerHTML = `<div class="text-xs opacity-60">Cargando chat...</div>`;
    try {
        const snap = await getDocs(query(collection(db, "propuestasPartido", proposalId, "chat"), orderBy("createdAt", "asc")));
        if (snap.empty) {
            body.innerHTML = `<div class="text-xs opacity-60">Sin mensajes.</div>`;
            return;
        }
        body.innerHTML = snap.docs.map((d) => {
            const m = d.data() || {};
            return `
                <div class="p-2 rounded-xl border border-white/10 bg-white/5 mb-2">
                    <div class="text-[9px] opacity-60">${escapeHtml(m.name || "Jugador")}</div>
                    <div class="text-[11px]">${escapeHtml(m.text || "")}</div>
                </div>
            `;
        }).join("");
    } catch (e) {
        body.innerHTML = `<div class="text-xs opacity-60">No se pudo cargar el chat.</div>`;
    }
};

function escapeHtml(raw = "") {
    const div = document.createElement("div");
    div.textContent = String(raw || "");
    return div.innerHTML;
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
    const photoUrl = String(document.getElementById(`u-photo-${uid}`)?.value || "").trim();
    const icsUrl = String(document.getElementById(`u-ics-${uid}`)?.value || "").trim();
    const data = {
        nombreUsuario: document.getElementById(`u-nick-${uid}`).value,
        nivel: parseFloat(document.getElementById(`u-lvl-${uid}`).value),
        rol: document.getElementById(`u-rol-${uid}`).value
    };
    if (photoUrl) {
        data.fotoPerfil = photoUrl;
        data.fotoURL = photoUrl;
    }
    if (icsUrl || icsUrl === "") {
        data.apoingCalendarUrl = icsUrl;
    }
    await updateDocument("usuarios", uid, data);
    if (icsUrl) {
        await setDoc(doc(db, "apoingCalendars", uid), {
            icsUrl,
            nombre: data.nombreUsuario || "",
            updatedAt: serverTimestamp(),
            updatedBy: auth.currentUser.uid
        }, { merge: true });
    }
    showToast("SISTEMA", "Perfil actualizado", "success");
    refreshAll();
};

window.saveMatchAdmin = async (id, col) => {
    const resultStr = document.getElementById(`m-res-${id}`)?.value?.trim() || '';
    const dateVal = document.getElementById(`m-date-${id}`)?.value;
    const estadoVal = document.getElementById(`m-state-${id}`)?.value;
    
    const data = {
        estado: estadoVal,
        resultado: resultStr ? { sets: resultStr } : {}
    };
    if (dateVal) data.fecha = new Date(dateVal);
    if (resultStr && data.estado === 'abierto') data.estado = 'jugado';
    
    try {
        // Clear rankingProcessedAt so we can re-process ELO if needed
        if (resultStr) data.rankingProcessedAt = null;
        await updateDocument(col, id, data);
        
        if (resultStr) {
            showToast("SISTEMA", "Calculando ELO...", "info");
            const { processMatchResults } = await import('./ranking-service.js');
            const res = await processMatchResults(id, col, resultStr);
            if (res?.success && !res?.skipped) {
                showToast("SISTEMA", "ELO actualizado correctamente", "success");
            } else if (res?.skipped) {
                showToast("SISTEMA", "ELO ya procesado (mismo resultado)", "info");
            } else {
                console.warn("processMatchResults did not succeed:", res);
            }
            // Sync event standings if applicable
            if (col !== 'eventoPartidos') {
                try {
                    const { syncLinkedEventMatchFromRegularMatch } = await import('./match-service.js');
                    await syncLinkedEventMatchFromRegularMatch(id, col, resultStr);
                } catch(e) { console.warn("Event sync error", e); }
            }
        }
        showToast("SISTEMA", "Partido guardado", "success");
    } catch(e) {
        console.error("Error saving match admin:", e);
        showToast("ERROR", "No se pudo guardar el partido", "error");
    }
    refreshAll();
};

window.recalcMatchElo = async (id, col, resultStr) => {
    if (!resultStr || resultStr === '--') {
        return showToast("ERROR", "No hay resultado para recalcular", "error");
    }
    if (!confirm(`¿Recalcular ELO para el partido?\nResultado: ${resultStr}`)) return;
    showToast("SISTEMA", "Recalculando ELO...", "info");
    try {
        await updateDocument(col, id, { rankingProcessedAt: null });
        const { processMatchResults } = await import('./ranking-service.js');
        const res = await processMatchResults(id, col, resultStr);
        if (res?.success && !res?.skipped) {
            showToast("ÉXITO", `ELO recalculado para ${res.changes?.length || 0} jugadores`, "success");
        } else {
            showToast("INFO", res?.error || "Respuesta inesperada del sistema", "warn");
        }
    } catch(e) {
        showToast("ERROR", e?.message || "Fallo en recálculo", "error");
    }
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

window.deleteMatchesByFilter = async (mode = "all") => {
    const type = document.getElementById("matches-type-filter")?.value || "all";
    let data = [...matchesArr];
    if (mode === "open") data = data.filter(m => !isPlayed(m));
    if (mode === "played") data = data.filter(m => isPlayed(m));
    if (mode === "upcoming") data = data.filter(m => !isPlayed(m) && toDate(m.fecha)?.getTime() >= Date.now());
    if (mode === "orphan") data = data.filter(m => hasOrphanPlayers(m));
    if (type !== "all") data = data.filter(m => m.col === type);

    if (!data.length) return showToast("SISTEMA", "No hay partidos para borrar", "info");
    if (!confirm(`Se borrarán ${data.length} partidos (${mode.toUpperCase()}). ¿Continuar?`)) return;
    for (const m of data) await deleteDoc(doc(db, m.col, m.id));
    showToast("SISTEMA", `Eliminados ${data.length} partidos`, "success");
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
function formatDateShort(v) {
    const d = toDate(v);
    if (!d) return "N/D";
    return d.toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
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

async function recoverFromRankingLogs() {
    if (!confirm("¿Intentar recuperar niveles y ELO desde los registros (Logs)? Esta acción buscará el último estado conocido de cada jugador en la base de datos.")) return;
    showToast("RECUPERACIÓN", "Consultando registros históricos...", "info");
    try {
        const snap = await getDocsSafe(query(collection(db, "rankingLogs"), orderBy("timestamp", "desc")));
        if (!snap || snap.empty) {
            return showToast("AVISO", "No hay registros disponibles para recuperar", "warn");
        }
        
        const latestStates = new Map();
        snap.docs.forEach(d => {
            const data = d.data();
            const dateStr = data.timestamp?.toDate ? data.timestamp.toDate().toLocaleString() : 'N/A';
            if (data.uid && !latestStates.has(data.uid)) {
                latestStates.set(data.uid, {
                    elo: data.newTotal || 1000,
                    level: data.details?.levelAfter || data.details?.nivelAfter || 2.5,
                    date: dateStr
                });
            }
        });

        if (latestStates.size === 0) {
            return showToast("AVISO", "No se encontraron datos válidos en los logs", "warn");
        }

        if (!confirm(`Se han localizado datos de ${latestStates.size} usuarios. ¿Quieres aplicarlos ahora?`)) return;

        let ok = 0;
        for (const [uid, st] of latestStates) {
            await updateDocument("usuarios", uid, {
                puntosRanking: st.elo,
                rating: st.elo,
                nivel: st.level
            });
            ok++;
        }
        
        showToast("ÉXITO", `Recuperación completada: ${ok} usuarios actualizados.`, "success");
        await refreshAll();
    } catch (e) {
        console.error("Recovery Error:", e);
        showToast("ERROR", "No se pudo completar la recuperación", "error");
    }
}

async function recoverMatchesFromLogs() {
    if (!confirm("¿Reconstruir partidos borrados desde los registros de puntos? Solo se pueden recuperar partidos finalizados que generaron ELO.")) return;
    showToast("RECONSTRUCCIÓN", "Analizando fragmentos de datos...", "info");
    try {
        let snap = await getDocsSafe(collection(db, "rankingLogs"));
        if (!snap || snap.empty) {
            showToast("SISTEMA", "Buscando en fragmentos de puntos...", "info");
            snap = await getDocsSafe(collection(db, "matchPointDetails"));
        }
        if (!snap || snap.empty) return showToast("AVISO", "No hay registros para reconstruir", "warn");
        
        const logsByMatch = new Map();
        snap.docs.forEach(d => {
            const data = d.data();
            const mId = data.matchId;
            if (!mId) return;
            const list = logsByMatch.get(mId) || [];
            list.push(data);
            logsByMatch.set(mId, list);
        });

        let restored = 0;
        let skipped = 0;
        
        for (const [mId, logs] of logsByMatch) {
            const exists = matchesArr.some(m => m.id === mId);
            if (exists) { skipped++; continue; }
            
            const first = logs[0];
            const col = first.matchCollection || "partidosAmistosos";
            const details = first.details || {};
            
            const winners = logs.filter(l => l.details?.won).map(l => l.uid);
            const losers = logs.filter(l => !l.details?.won).map(l => l.uid);
            const players = [...winners, ...losers];
            while(players.length < 4) players.push(null);
            
            const matchData = {
                fecha: details.timestamp ? new Date(details.timestamp) : (first.timestamp?.toDate?.() || new Date()),
                estado: "jugado",
                resultado: { sets: details.sets || (details.normalizedResult) || "" },
                jugadores: players,
                playerUids: players,
                reconstructed: true,
                rankingProcessedAt: first.timestamp || serverTimestamp(),
                createdAt: serverTimestamp()
            };
            
            await setDoc(doc(db, col, mId), matchData);
            restored++;
        }
        
        showToast("ÉXITO", `Restauración completa: ${restored} partidos recuperados, ${skipped} ya existían.`, "success");
        await refreshAll();
    } catch (e) {
        console.error("Match Recovery Error:", e);
        showToast("ERROR", "Fallo al reconstruir partidos", "error");
    }
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





