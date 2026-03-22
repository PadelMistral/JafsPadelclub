// js/admin.js - Premium Console v9.5 Logic (Unified & Accordion-Driven)
import { db, auth, observerAuth, getDocument, updateDocument, addDocument, getDocsSafe } from "./firebase-service.js";
import { collection, collectionGroup, query, orderBy, limit, serverTimestamp, deleteDoc, doc, setDoc, getDocs, deleteField } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI, showToast } from "./ui-core.js";
import { MAX_PLAYERS } from "./config/match-constants.js";
import { levelFromRating, ELO_SYSTEM_VERSION } from "./config/elo-system.js";
import { sendCoreNotification } from "./core/core-engine.js";
import { getFriendlyTeamName, isUnknownTeamName as sharedIsUnknownTeamName } from "./utils/team-utils.js";
import { openResultForm } from "./match-service.js";
import { logAdminAudit } from "./services/audit-service.js";
import { validateMatchAdminPayload } from "./services/admin-validator.js";
import { addPlayerHistoryEntry, addPlayerHistoryEntries } from "./services/player-history-service.js";

let users = [];
let matchesArr = [];
let eventsArr = [];
let apoingRecords = [];
let apoingByUid = new Map();
let deviceStatsByUid = new Map();
let me = null;
let proposalsArr = [];
let auditLogs = [];

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
    document.getElementById("matches-user-search")?.addEventListener("input", renderMatches);
    document.getElementById("pending-search")?.addEventListener("input", renderPending);
    document.getElementById("btn-refresh-admin")?.addEventListener("click", refreshAll);
    document.getElementById("btn-refresh-proposals")?.addEventListener("click", refreshProposals);
}

function bindSystemActions() {
    document.getElementById("btn-broadcast")?.addEventListener("click", runBroadcast);
    document.getElementById("btn-export-admin-snapshot")?.addEventListener("click", exportAdminSnapshot);
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
            if (!(await confirmAdminAction({ title: "Recalcular desde nivel", message: "Se recalculará el ELO partiendo del nivel actual de cada usuario.", confirmLabel: "Recalcular" }))) return;
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
            if (!(await confirmAdminAction({ title: "Recalcular desde puntos", message: "Se recalculará el histórico usando los puntos actuales como base.", confirmLabel: "Recalcular" }))) return;
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
            if (!(await confirmAdminAction({ title: "Reconstrucción histórica", message: "Se va a reconstruir todo el historial de puntos ELO desde el primer partido.", confirmLabel: "Reconstruir", danger: true }))) return;
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
    return sharedIsUnknownTeamName(value);
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
    if (!(await confirmAdminAction({ title: "Limpiar duplicados", message: "Se analizarán y limpiarán duplicados de eventos y partidos huérfanos.", confirmLabel: "Analizar", danger: true }))) return;
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

        if (!(await confirmAdminAction({ title: "Eliminar duplicados", message: `Se eliminarán ${toDelete.length} registros duplicados o huérfanos.`, confirmLabel: "Eliminar", danger: true }))) return;

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
    if (!(await confirmAdminAction({ title: "Limpiar eventos antiguos", message: "Se borrarán los partidos ligados a eventos antiguos o no activos.", confirmLabel: "Continuar", danger: true }))) return;
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
        if (!(await confirmAdminAction({ title: "Eliminar partidos antiguos", message: `Se eliminarán ${toDelete.length} partidos de eventos no activos.`, confirmLabel: "Eliminar", danger: true }))) return;
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
        const [uSnap, amSnap, reSnap, evSnapPartidos, evSnapTorneos, apoSnap, devicesSnap, propSnap, auditSnap] = await Promise.all([
            getDocsSafe(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"))),
            getDocsSafe(collection(db, "partidosAmistosos")),
            getDocsSafe(collection(db, "partidosReto")),
            getDocsSafe(collection(db, "eventoPartidos")),
            getDocsSafe(collection(db, "eventos")),
            getDocsSafe(collection(db, "apoingCalendars")),
            getDocsSafe(query(collectionGroup(db, "devices"), limit(2000))),
            getDocsSafe(query(collection(db, "propuestasPartido"), orderBy("createdAt", "desc"), limit(200))),
            getDocsSafe(query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(18))),
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
        auditLogs = (auditSnap?.docs || []).map(d => ({ id: d.id, ...d.data() }));

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
        renderAuditFeed();
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

function getUserMatches(uid) {
    if (!uid) return [];
    return matchesArr.filter((m) => getMatchPlayersNormalized(m).includes(uid));
}

function getUserLastSeenLabel(user) {
    const stat = deviceStatsByUid.get(user?.id) || {};
    if (stat.lastSeenAt instanceof Date) {
        return stat.lastSeenAt.toLocaleString("es-ES", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit"
        });
    }
    return "Sin registro";
}

function buildUserAdminSnapshot(user) {
    const matches = getUserMatches(user?.id);
    const played = matches.filter((m) => isPlayed(m));
    const open = matches.filter((m) => !isPlayed(m));
    const latestMatch = [...matches]
        .sort((a, b) => (toDate(b.fecha)?.getTime() || 0) - (toDate(a.fecha)?.getTime() || 0))[0] || null;
    const latestAudit = auditLogs.find((log) => log.entityId === user?.id || log.payload?.nickname === user?.nombreUsuario) || null;
    const aiMemory = user?.aiMemory || {};
    const lastInsight = Array.isArray(aiMemory?.insights) ? aiMemory.insights[0] : null;

    return {
        totalMatches: matches.length,
        playedMatches: played.length,
        openMatches: open.length,
        latestMatch,
        latestAudit,
        lastInsight,
    };
}

function renderUserAdminSnapshot(user) {
    const snapshot = buildUserAdminSnapshot(user);
    const latestDate = snapshot.latestMatch ? formatDateShort(snapshot.latestMatch.fecha) : "Sin partidos";
    const latestType = snapshot.latestMatch
        ? (snapshot.latestMatch.col === "eventoPartidos" ? "Torneo" : snapshot.latestMatch.col === "partidosReto" ? "Reto" : "Amistoso")
        : "Sin actividad";
    const insight = snapshot.lastInsight?.text || "La IA aún no tiene memoria suficiente para este jugador.";
    const auditText = snapshot.latestAudit
        ? `${String(snapshot.latestAudit.action || "acción").replace(/_/g, " ")} · ${formatAuditStamp(snapshot.latestAudit.createdAt)}`
        : "Sin cambios admin recientes";

    return `
        <div class="admin-grid-v9 mt-4">
            <div class="admin-field-group">
                <label>Actividad total</label>
                <div class="input-v9 flex-row between">
                    <span>${snapshot.totalMatches} partidos</span>
                    <span class="text-[10px] opacity-60">${snapshot.playedMatches} jugados</span>
                </div>
            </div>
            <div class="admin-field-group">
                <label>Último acceso</label>
                <div class="input-v9">${getUserLastSeenLabel(user)}</div>
            </div>
            <div class="admin-field-group">
                <label>Próximos partidos</label>
                <div class="input-v9">${snapshot.openMatches} pendientes</div>
            </div>
            <div class="admin-field-group">
                <label>Último partido</label>
                <div class="input-v9">${latestType} · ${latestDate}</div>
            </div>
            <div class="admin-field-group col-span-2">
                <label>Memoria IA reciente</label>
                <div class="input-v9" style="line-height:1.45;">${escapeHtml(insight)}</div>
            </div>
            <div class="admin-field-group col-span-2">
                <label>Último cambio admin</label>
                <div class="input-v9">${escapeHtml(auditText)}</div>
            </div>
            <div class="admin-field-group col-span-2">
                <label>Centro histórico</label>
                <div class="input-v9 flex-row between">
                    <span>Partidos, diario, IA y auditoría</span>
                    <button class="btn-v9 ghost sm" onclick="window.openUserAdminHistory('${user.id}'); event.stopPropagation();">
                        <i class="fas fa-timeline"></i> VER
                    </button>
                </div>
            </div>
        </div>
    `;
}

function formatShortText(value = "", max = 180) {
    const clean = String(value || "").replace(/\s+/g, " ").trim();
    if (!clean) return "Sin detalle";
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function getUserById(uid) {
    return users.find((u) => u.id === uid) || null;
}

function getUserTeamSide(match, uid) {
    const players = Array.isArray(match?.jugadores) ? match.jugadores.filter(Boolean) : [];
    const index = players.indexOf(uid);
    if (index === -1) return null;
    return index <= 1 ? "A" : "B";
}

function getMatchWinnerSide(match) {
    const winner = String(match?.ganador || "").toUpperCase();
    return winner === "A" || winner === "B" ? winner : null;
}

function renderUserHistoryModalContent(user) {
    const sortedMatches = getUserMatches(user?.id)
        .sort((a, b) => (toDate(b.fecha)?.getTime() || 0) - (toDate(a.fecha)?.getTime() || 0));
    const matches = sortedMatches
        .slice(0, 10);
    const diary = Array.isArray(user?.diario) ? [...user.diario].slice(-6).reverse() : [];
    const aiInsights = Array.isArray(user?.aiMemory?.insights) ? user.aiMemory.insights.slice(0, 6) : [];
    const relevantAudit = auditLogs
        .filter((log) => log.entityId === user?.id || log.payload?.nickname === user?.nombreUsuario)
        .slice(0, 8);
    const completedMatches = sortedMatches.filter((m) => getMatchWinnerSide(m));
    const wins = completedMatches.filter((m) => getUserTeamSide(m, user?.id) === getMatchWinnerSide(m)).length;
    const losses = Math.max(0, completedMatches.length - wins);
    const openMatches = sortedMatches.filter((m) => !isPlayed(m)).length;

    const matchHtml = matches.length ? matches.map((m) => {
        const type = m.col === "eventoPartidos" ? "Torneo" : m.col === "partidosReto" ? "Reto" : "Amistoso";
        const date = formatDateShort(m.fecha);
        const result = m.resultado?.sets || m.resultado?.score || (isPlayed(m) ? "Finalizado" : "Pendiente");
        const teamA = getFriendlyTeamName({ teamName: m.teamAName, teamId: m.teamAId, side: "A" });
        const teamB = getFriendlyTeamName({ teamName: m.teamBName, teamId: m.teamBId, side: "B" });
        return `
            <div class="audit-entry">
                <div class="audit-entry__meta">
                    <span>${type}</span>
                    <span>${date}</span>
                </div>
                <div class="audit-entry__title">${escapeHtml(teamA)} vs ${escapeHtml(teamB)}</div>
                <div class="audit-entry__body">${escapeHtml(result)}</div>
            </div>
        `;
    }).join("") : `<div class="audit-feed-empty">Sin partidos recientes en el sistema.</div>`;

    const diaryHtml = diary.length ? diary.map((entry) => `
        <div class="audit-entry">
            <div class="audit-entry__meta">
                <span>Diario</span>
                <span>${formatDateShort(entry?.fecha || entry?.timestamp || entry?.createdAt)}</span>
            </div>
            <div class="audit-entry__title">${escapeHtml(entry?.rival || entry?.title || "Entrada táctica")}</div>
            <div class="audit-entry__body">${escapeHtml(formatShortText(entry?.coachNote || entry?.memoryNote || entry?.tactica?.leccion || ""))}</div>
        </div>
    `).join("") : `<div class="audit-feed-empty">Sin entradas de diario registradas.</div>`;

    const aiHtml = aiInsights.length ? aiInsights.map((item) => `
        <div class="audit-entry">
            <div class="audit-entry__meta">
                <span>IA</span>
                <span>${formatAuditStamp(item?.updatedAt || item?.createdAt)}</span>
            </div>
            <div class="audit-entry__title">${escapeHtml(String(item?.type || "general").toUpperCase())}</div>
            <div class="audit-entry__body">${escapeHtml(formatShortText(item?.text || ""))}</div>
        </div>
    `).join("") : `<div class="audit-feed-empty">La IA aún no ha generado memoria útil para este jugador.</div>`;

    const auditHtml = relevantAudit.length ? relevantAudit.map((item) => `
        <div class="audit-entry">
            <div class="audit-entry__meta">
                <span>${escapeHtml(item.actorEmail || item.actorUid || "admin")}</span>
                <span>${formatAuditStamp(item.createdAt)}</span>
            </div>
            <div class="audit-entry__title">${escapeHtml(String(item.action || "acción").replace(/_/g, " ").toUpperCase())}</div>
            <div class="audit-entry__body">${escapeHtml(describeAuditLog(item))}</div>
        </div>
    `).join("") : `<div class="audit-feed-empty">Sin cambios administrativos recientes para este usuario.</div>`;

    return `
        <div class="admin-history-shell">
            <div class="admin-history-summary">
                <div class="kpi-card shadow-premium glow-primary">
                    <span class="kpi-label">Partidos</span>
                    <span class="kpi-value">${sortedMatches.length}</span>
                </div>
                <div class="kpi-card shadow-premium glow-green">
                    <span class="kpi-label">Victorias</span>
                    <span class="kpi-value">${wins}</span>
                </div>
                <div class="kpi-card shadow-premium glow-red">
                    <span class="kpi-label">Derrotas</span>
                    <span class="kpi-value">${losses}</span>
                </div>
                <div class="kpi-card shadow-premium glow-cyan">
                    <span class="kpi-label">Pendientes</span>
                    <span class="kpi-value">${openMatches}</span>
                </div>
                <div class="kpi-card shadow-premium glow-amber">
                    <span class="kpi-label">Diario</span>
                    <span class="kpi-value">${diary.length}</span>
                </div>
                <div class="kpi-card shadow-premium glow-green">
                    <span class="kpi-label">Memoria IA</span>
                    <span class="kpi-value">${aiInsights.length}</span>
                </div>
            </div>
            <div class="admin-history-grid">
                <section>
                    <div class="text-[11px] font-black uppercase tracking-widest opacity-70 mb-2">Últimos partidos</div>
                    <div class="audit-feed">${matchHtml}</div>
                </section>
                <section>
                    <div class="text-[11px] font-black uppercase tracking-widest opacity-70 mb-2">Diario táctico</div>
                    <div class="audit-feed">${diaryHtml}</div>
                </section>
                <section>
                    <div class="text-[11px] font-black uppercase tracking-widest opacity-70 mb-2">Memoria IA</div>
                    <div class="audit-feed">${aiHtml}</div>
                </section>
                <section>
                    <div class="text-[11px] font-black uppercase tracking-widest opacity-70 mb-2">Auditoría admin</div>
                    <div class="audit-feed">${auditHtml}</div>
                </section>
            </div>
        </div>
    `;
}

function formatAuditStamp(value) {
    const d = toDate(value);
    if (!d) return "Ahora";
    return d.toLocaleString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function describeAuditLog(item) {
    const payload = item?.payload || {};
    const parts = [];
    if (payload?.title) parts.push(`"${payload.title}"`);
    if (payload?.status) parts.push(`estado ${payload.status}`);
    if (payload?.result) parts.push(`resultado ${payload.result}`);
    if (payload?.points) parts.push(`${payload.points} pts`);
    if (payload?.count) parts.push(`${payload.count} registros`);
    if (payload?.role) parts.push(`rol ${payload.role}`);
    return parts.join(" · ") || "Sin detalle adicional";
}

function renderAuditFeed() {
    const container = document.getElementById("admin-audit-feed");
    if (!container) return;
    if (!auditLogs.length) {
        container.innerHTML = `<div class="audit-feed-empty">Aún no hay actividad registrada en el panel.</div>`;
        return;
    }

    container.innerHTML = auditLogs.map((item) => `
        <article class="audit-entry">
            <div class="audit-entry__meta">
                <span>${escapeHtml(item.actorEmail || item.actorUid || "admin")}</span>
                <span>${formatAuditStamp(item.createdAt)}</span>
            </div>
            <div class="audit-entry__title">${escapeHtml(String(item.action || "acción").replace(/_/g, " ").toUpperCase())}</div>
            <div class="audit-entry__body">
                <span class="status-highlight">${escapeHtml(item.entityType || "sistema")}</span>
                <span class="match-highlight">${escapeHtml(item.entityId || "global")}</span>
                · ${escapeHtml(describeAuditLog(item))}
            </div>
        </article>
    `).join("");
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
        const adminSnapshot = renderUserAdminSnapshot(u);
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
                ${adminSnapshot}
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
    const userKeyword = document.getElementById("matches-user-search")?.value.trim().toLowerCase() || "";
    
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

    // Filter by User
    if (userKeyword) {
        data = data.filter(m => {
            const teamA = String(m.teamAName || "").toLowerCase();
            const teamB = String(m.teamBName || "").toLowerCase();
            const participants = (m.jugadores || []).map(id => String(id).toLowerCase());
            return teamA.includes(userKeyword) || teamB.includes(userKeyword) || participants.includes(userKeyword) || m.id.toLowerCase().includes(userKeyword);
        });
    }

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
        const rosterNames = playerIds.map((uid) => {
            const u = users.find((entry) => entry.id === uid);
            return u?.nombreUsuario || u?.nombre || String(uid || "");
        });
        const usersVsLabel = getMatchUsersVsLabel(m);

        return `
        <div class="admin-acc-v9" id="match-acc-${m.id}">
            <div class="acc-header" onclick="window.toggleAcc('match-acc-${m.id}')">
                <div class="acc-icon-box"><i class="fas fa-table-tennis-paddle-ball"></i></div>
                <div class="acc-main">
                    <span class="acc-title">${escapeHtml(usersVsLabel)}</span>
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
                        <div class="input-v9 flex-row between items-center gap-2">
                            <span class="text-[11px] font-black text-white">${res === '--' ? 'Sin resultado' : escapeHtml(res)}</span>
                            <input type="hidden" value="${res === '--' ? '' : escapeHtml(res)}" id="m-res-${m.id}">
                            <button class="btn-v9 ghost" type="button" onclick="window.openAdminMatchResultModal('${m.id}','${m.col}')">ABRIR MARCADOR</button>
                        </div>
                    </div>
                    ${isPlayed(m) && m.eloSummary ? `
                    <div class="admin-field-group col-span-2">
                        <label>Resumen ELO</label>
                        ${formatAdminEloSummary(m)}
                    </div>` : ""}
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
                    ${isPlayed(m) ? `<button class="btn-v9 ghost" onclick="window.resetMatchAdmin('${m.id}','${m.col}')">RESETEAR</button>` : ''}
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

function getMatchUsersVsLabel(m) {
    const ids = getMatchPlayersNormalized(m).filter(Boolean);
    const names = ids.map((uid) => {
        if (String(uid).startsWith("GUEST_")) {
            const raw = String(uid).split("_").slice(1).join(" ").trim();
            return raw || "Invitado";
        }
        const u = users.find((entry) => entry.id === uid);
        return u?.nombreUsuario || u?.nombre || String(uid || "").slice(0, 8);
    });
    const teamA = names.slice(0, 2).filter(Boolean).join(" / ") || "Por definir";
    const teamB = names.slice(2, 4).filter(Boolean).join(" / ") || "Por definir";
    return `${teamA} vs ${teamB}`;
}

function formatAdminEloSummary(match) {
    const summary = match?.eloSummary;
    if (!summary || typeof summary !== "object") return "";
    const teamA = Number(summary.teamADelta || 0);
    const teamB = Number(summary.teamBDelta || 0);
    const expectedA = Number(summary.expectedA || 0);
    const kCombined = Number(summary.kCombined || 0);
    return `
        <div class="input-v9 flex-col gap-2">
            <div class="flex-row between text-[10px]">
                <span class="opacity-60">Total ELO equipo A</span>
                <span class="font-black ${teamA >= 0 ? "text-green-300" : "text-red-300"}">${teamA >= 0 ? "+" : ""}${teamA.toFixed(2)}</span>
            </div>
            <div class="flex-row between text-[10px]">
                <span class="opacity-60">Total ELO equipo B</span>
                <span class="font-black ${teamB >= 0 ? "text-green-300" : "text-red-300"}">${teamB >= 0 ? "+" : ""}${teamB.toFixed(2)}</span>
            </div>
            <div class="flex-row between text-[10px]">
                <span class="opacity-60">Probabilidad previa A</span>
                <span class="font-black text-cyan-300">${Math.round(expectedA * 100)}%</span>
            </div>
            <div class="flex-row between text-[10px]">
                <span class="opacity-60">K combinado</span>
                <span class="font-black text-white">${kCombined.toFixed(2)}</span>
            </div>
        </div>
    `;
}

function ensureAdminMatchModal() {
    let modal = document.getElementById("modal-admin-match-detail");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "modal-admin-match-detail";
    modal.className = "modal-overlay";
    modal.innerHTML = `
        <div class="modal-card glass-strong" style="max-width:820px; width:min(96vw,820px);">
            <div class="modal-header">
                <h3 class="modal-title">Resultado del partido</h3>
                <button class="close-btn" onclick="this.closest('.modal-overlay').classList.remove('active')">&times;</button>
            </div>
            <div class="modal-body scroll-y" id="admin-match-detail-body" style="max-height:82vh;"></div>
        </div>
    `;
    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.remove("active");
    });
    modal.addEventListener("click", (e) => {
        const closeHit = e.target === modal || e.target.closest(".close-btn");
        if (!closeHit) return;
        window.setTimeout(() => refreshAll(), 120);
    });
    document.body.appendChild(modal);
    return modal;
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
                                <span class="admin-acc-sub">${status} · ${escapeHtml(names || "sin participantes")}</span>
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

function confirmAdminAction({
    title = "Confirmar acción",
    message = "¿Quieres continuar?",
    confirmLabel = "Continuar",
    danger = false,
} = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay active";
        overlay.innerHTML = `
            <div class="admin-confirm-card">
                <div class="admin-confirm-card__icon ${danger ? "is-danger" : ""}">
                    <i class="fas ${danger ? "fa-triangle-exclamation" : "fa-circle-info"}"></i>
                </div>
                <h3 class="admin-confirm-card__title">${escapeHtml(title)}</h3>
                <p class="admin-confirm-card__copy">${escapeHtml(message)}</p>
                <div class="admin-confirm-card__actions">
                    <button type="button" class="btn-v9 ghost" data-admin-confirm-cancel>Cancelar</button>
                    <button type="button" class="btn-v9 ${danger ? "danger" : "primary"}" data-admin-confirm-ok>${escapeHtml(confirmLabel)}</button>
                </div>
            </div>
        `;

        const cleanup = (accepted) => {
            overlay.remove();
            resolve(Boolean(accepted));
        };

        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) cleanup(false);
        });
        overlay.querySelector("[data-admin-confirm-cancel]")?.addEventListener("click", () => cleanup(false));
        overlay.querySelector("[data-admin-confirm-ok]")?.addEventListener("click", () => cleanup(true));
        document.body.appendChild(overlay);
    });
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
    await logAdminAudit("update_user_profile", "usuarios", uid, {
        nickname: data.nombreUsuario || "",
        role: data.rol || "Jugador",
        level: data.nivel || 2.5,
        hasIcs: Boolean(icsUrl)
    }).catch(() => {});
    await addPlayerHistoryEntry({
        uid,
        kind: "admin_profile_update",
        title: "Perfil actualizado desde admin",
        text: `Rol ${data.rol || "Jugador"} · Nivel ${Number(data.nivel || 2.5).toFixed(2)}${icsUrl ? " · Calendario conectado" : ""}`,
        tag: "Admin",
        tone: "admin",
        entityId: uid,
        meta: {
            role: data.rol || "Jugador",
            level: Number(data.nivel || 2.5),
            hasIcs: Boolean(icsUrl)
        }
    }).catch(() => {});
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
    let resultStr = document.getElementById(`m-res-${id}`)?.value?.trim() || '';
    const dateVal = document.getElementById(`m-date-${id}`)?.value;
    const estadoVal = document.getElementById(`m-state-${id}`)?.value;
    if (!resultStr) {
        const cachedMatch = matchesArr.find((m) => m.id === id && m.col === col);
        const freshMatch = cachedMatch || await getDocument(col, id).catch(() => null);
        resultStr = String(freshMatch?.resultado?.sets || freshMatch?.resultado?.score || "").trim();
        const hiddenInput = document.getElementById(`m-res-${id}`);
        if (hiddenInput && resultStr) hiddenInput.value = resultStr;
    }
    const validation = validateMatchAdminPayload({ resultStr, dateVal, state: estadoVal });
    if (!validation.valid) {
        return showToast("VALIDACIÓN", validation.errors[0], "warning");
    }
    
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
        await logAdminAudit("update_match", col, id, {
            status: estadoVal,
            result: resultStr || "",
            date: dateVal || null
        }).catch(() => {});
        const existingMatch = matchesArr.find((m) => m.id === id && m.col === col) || null;
        const impactedUsers = (existingMatch?.jugadores || []).filter((uid) => uid && !String(uid).startsWith("GUEST_"));
        await addPlayerHistoryEntries(impactedUsers.map((uid) => ({
            uid,
            kind: "match_admin_update",
            title: resultStr ? "Resultado actualizado por admin" : "Partido actualizado por admin",
            text: resultStr
                ? `Marcador ${resultStr}${estadoVal ? ` · Estado ${estadoVal}` : ""}`
                : `Estado ${estadoVal || "actualizado"}${dateVal ? ` · ${dateVal}` : ""}`,
            tag: "Partido",
            tone: "match",
            matchId: id,
            matchCollection: col,
            entityId: id,
            meta: {
                status: estadoVal || "",
                result: resultStr || ""
            }
        }))).catch(() => {});
        
        if (resultStr) {
            showToast("SISTEMA", "Calculando ELO...", "info");
            const { processMatchResults } = await import('./ranking-service.js');
            const res = await processMatchResults(id, col, resultStr);
            if (res?.success && !res?.skipped) {
                const teamA = Number(res?.summary?.teamADelta || 0).toFixed(2);
                const teamB = Number(res?.summary?.teamBDelta || 0).toFixed(2);
                showToast("SISTEMA", `ELO actualizado · A ${teamA} / B ${teamB}`, "success");
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

window.openAdminMatchResultModal = async (id, col) => {
    try {
        await openResultForm(id, col);
        const resultModal = document.getElementById("modal-result-form");
        if (!resultModal) return;
        resultModal.classList.add("modal-stack-front");
        resultModal.style.zIndex = "12090";
        const syncInput = async () => {
            const freshMatch = await getDocument(col, id).catch(() => null);
            const resultValue = String(freshMatch?.resultado?.sets || freshMatch?.resultado?.score || "").trim();
            const hidden = document.getElementById(`m-res-${id}`);
            if (hidden) hidden.value = resultValue;
            window.setTimeout(() => refreshAll(), 120);
        };
        const observer = new MutationObserver(() => {
            const closed = !resultModal.classList.contains("active") || !document.body.contains(resultModal);
            if (!closed) return;
            observer.disconnect();
            window.setTimeout(syncInput, 60);
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
        resultModal.addEventListener("click", (event) => {
            const shouldSync = event.target === resultModal || event.target.closest(".close-btn");
            if (shouldSync) window.setTimeout(syncInput, 60);
        });
    } catch (e) {
        console.error("Admin result modal error:", e);
        showToast("ERROR", "No se pudo abrir el editor de resultado", "error");
    }
};

window.resetMatchAdmin = async (id, col) => {
    if (!(await confirmAdminAction({ title: "Resetear partido", message: "El partido volvera a estado abierto y se limpiaran marcador, ganador y resumen ELO.", confirmLabel: "Resetear", danger: true }))) return;
    try {
        await updateDocument(col, id, {
            estado: "abierto",
            resultado: {},
            ganador: deleteField(),
            ganadorTeamId: deleteField(),
            eloSummary: deleteField(),
            rankingProcessedAt: deleteField(),
            rankingProcessedResult: deleteField(),
            standingsProcessedAt: deleteField(),
            standingsProcessedResult: deleteField(),
        });
        await logAdminAudit("reset_match", col, id, { status: "abierto" }).catch(() => {});
        showToast("SISTEMA", "Partido reseteado como no jugado", "success");
    } catch (e) {
        console.error("Reset match admin error:", e);
        showToast("ERROR", "No se pudo resetear el partido", "error");
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

window.recalcMatchEloSafe = async (id, col, resultStr) => {
    if (!resultStr || resultStr === "--") {
        return showToast("ERROR", "No hay resultado para recalcular", "error");
    }
    const confirmed = await confirmAdminAction({
        title: "Recalcular ELO",
        message: `Se recalculara el ELO para el marcador ${resultStr}.`,
        confirmLabel: "Recalcular",
    });
    if (!confirmed) return;
    showToast("SISTEMA", "Recalculando ELO...", "info");
    try {
        await updateDocument(col, id, { rankingProcessedAt: null });
        const { processMatchResults } = await import("./ranking-service.js");
        const res = await processMatchResults(id, col, resultStr);
        if (res?.success && !res?.skipped) {
            showToast("EXITO", `ELO recalculado para ${res.changes?.length || 0} jugadores`, "success");
        } else {
            showToast("INFO", res?.error || "Respuesta inesperada del sistema", "warn");
        }
    } catch (e) {
        showToast("ERROR", e?.message || "Fallo en recalculo", "error");
    }
    refreshAll();
};

window.recalcMatchElo = window.recalcMatchEloSafe;

window.saveEventAdmin = async (id) => {
    const data = {
        estado: document.getElementById(`ev-state-${id}`).value,
        plazasMax: parseInt(document.getElementById(`ev-plazas-${id}`).value)
    };
    await updateDocument("eventos", id, data);
    await logAdminAudit("update_event", "eventos", id, data).catch(() => {});
    showToast("SISTEMA", "Torneo actualizado", "success");
    refreshAll();
};

window.openUserAdminHistory = (uid) => {
    const user = getUserById(uid);
    if (!user) return;

    let modal = document.getElementById("modal-user-history-admin");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "modal-user-history-admin";
        modal.className = "modal-overlay active";
        modal.innerHTML = `
            <div class="modal-card glass-strong" style="max-width:980px; width:min(96vw,980px);">
                <div class="modal-header">
                    <h3 class="modal-title" id="user-history-admin-title">Historial de usuario</h3>
                    <button class="close-btn" onclick="this.closest('.modal-overlay').classList.remove('active')">&times;</button>
                </div>
                <div class="modal-body scroll-y" id="user-history-admin-body" style="max-height:80vh;"></div>
            </div>
        `;
        modal.addEventListener("click", (e) => {
            if (e.target === modal) modal.classList.remove("active");
        });
        document.body.appendChild(modal);
    }

    modal.classList.add("active");
    const title = document.getElementById("user-history-admin-title");
    const body = document.getElementById("user-history-admin-body");
    if (title) title.textContent = `Historial · ${user.nombreUsuario || user.nombre || user.email || uid}`;
    if (body) body.innerHTML = renderUserHistoryModalContent(user);
};

window.approveUserAdmin = async (uid) => {
    await updateDocument("usuarios", uid, { status: "approved", aprobado: true });
    await logAdminAudit("approve_user", "usuarios", uid, { status: "approved" }).catch(() => {});
    await addPlayerHistoryEntry({
        uid,
        kind: "admin_approval",
        title: "Cuenta aprobada",
        text: "Tu acceso a la aplicacion fue validado desde el panel de administracion.",
        tag: "Admin",
        tone: "admin",
        entityId: uid
    }).catch(() => {});
    showToast("SISTEMA", "Acceso aprobado", "success");
    refreshAll();
};

window.deleteUserAdmin = async (uid) => {
    if (!(await confirmAdminAction({ title: "Eliminar usuario", message: "Esta acción borrará el usuario seleccionado del sistema.", confirmLabel: "Eliminar", danger: true }))) return;
    await deleteDoc(doc(db, "usuarios", uid));
    await logAdminAudit("delete_user", "usuarios", uid).catch(() => {});
    showToast("SISTEMA", "Usuario borrado", "warn");
    refreshAll();
};

window.deleteMatchAdmin = async (id, col) => {
    if (!(await confirmAdminAction({ title: "Eliminar partido", message: "Esta acción borrará el partido seleccionado.", confirmLabel: "Eliminar", danger: true }))) return;
    await deleteDoc(doc(db, col, id));
    await logAdminAudit("delete_match", col, id).catch(() => {});
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
    if (!(await confirmAdminAction({ title: "Borrado masivo", message: `Se borrarán ${data.length} partidos del bloque ${mode.toUpperCase()}.`, confirmLabel: "Borrar", danger: true }))) return;
    for (const m of data) await deleteDoc(doc(db, m.col, m.id));
    await logAdminAudit("bulk_delete_matches", type === "all" ? "matches" : type, mode, { count: data.length }).catch(() => {});
    showToast("SISTEMA", `Eliminados ${data.length} partidos`, "success");
    refreshAll();
};

window.saveUserRanking = async (uid) => {
    const pts = parseInt(document.getElementById(`r-points-${uid}`).value);
    await updateDocument("usuarios", uid, { puntosRanking: pts, nivel: levelFromRating(pts) });
    await logAdminAudit("update_user_ranking", "usuarios", uid, { points: pts }).catch(() => {});
    await addPlayerHistoryEntry({
        uid,
        kind: "ranking_admin_update",
        title: "Ranking ajustado por admin",
        text: `Nuevo ranking ${pts} puntos · Nivel ${levelFromRating(pts).toFixed(2)}`,
        tag: "Ranking",
        tone: "elo",
        entityId: uid,
        meta: {
            points: pts,
            level: levelFromRating(pts)
        }
    }).catch(() => {});
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
    const title = String(document.getElementById("sys-broadcast-title").value || "").trim().slice(0, 120);
    const msg = String(document.getElementById("sys-broadcast-message").value || "").trim().slice(0, 600);
    if (!title || !msg) return showToast("Aviso", "Escribe un título y un mensaje válidos.", "info");
    const uids = users.map(u => u.id);
    if (!uids.length) return showToast("Aviso", "No hay usuarios cargados para enviar el comunicado.", "info");
    await sendCoreNotification(uids, title, msg, "info", "home.html");
    await logAdminAudit("broadcast_notification", "system", "global", {
        title,
        count: uids.length
    }).catch(() => {});
    showToast("ANUNCIO", "Enviado con éxito", "success");
}

function buildAdminSnapshotPayload() {
    const localHealth = {
        online: navigator.onLine,
        standalone: window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true,
        notificationPermission: typeof Notification !== "undefined" ? Notification.permission : "unsupported",
        userAgent: navigator.userAgent,
        generatedFrom: "admin_console",
    };
    const approvedUsers = users.filter((u) => u.status === "approved" || u.aprobado === true || u.rol === "Admin");
    const openMatches = matchesArr.filter((m) => !isPlayed(m));
    const playedMatches = matchesArr.filter((m) => isPlayed(m));
    const systemSummary = {
        generatedAt: new Date().toISOString(),
        app: "JafsPadel Admin",
        version: "snapshot_v1",
        totals: {
            users: users.length,
            approvedUsers: approvedUsers.length,
            matches: matchesArr.length,
            openMatches: openMatches.length,
            playedMatches: playedMatches.length,
            events: eventsArr.length,
            proposals: proposalsArr.length,
            auditLogs: auditLogs.length,
        },
    };

    const usersLite = approvedUsers.slice(0, 500).map((u) => ({
        id: u.id,
        nombre: u.nombreUsuario || u.nombre || "Jugador",
        rol: u.rol || "Jugador",
        nivel: Number(u.nivel || 0),
        puntosRanking: Number(u.puntosRanking || 1000),
        posicionPreferida: u.posicionPreferida || u.sidePreference || u.posicion || "",
        notifPermission: u.notifPermission || "",
    }));

    const matchesLite = matchesArr.slice(0, 1200).map((m) => ({
        id: m.id,
        collection: m.col,
        estado: m.estado || "",
        fecha: toDate(m.fecha)?.toISOString?.() || null,
        jugadores: getMatchPlayersNormalized(m),
        resultado: m.resultado?.sets || m.resultado?.score || m.resultado || "",
        eventoId: m.eventoId || null,
    }));

    const eventsLite = eventsArr.slice(0, 300).map((e) => ({
        id: e.id,
        nombre: e.nombre || e.title || "Evento",
        estado: e.estado || "",
        formato: e.formato || e.type || "",
        inscritos: Array.isArray(e.inscritos) ? e.inscritos.length : 0,
    }));

    const auditLite = auditLogs.slice(0, 120).map((log) => ({
        id: log.id,
        action: log.action || "",
        entity: log.entity || "",
        entityId: log.entityId || "",
        createdAt: formatAuditStamp(log.createdAt),
    }));

    return {
        systemSummary,
        localHealth,
        users: usersLite,
        matches: matchesLite,
        events: eventsLite,
        audit: auditLite,
    };
}

async function exportAdminSnapshot() {
    try {
        const payload = buildAdminSnapshotPayload();
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `padeluminatis-admin-snapshot-${stamp}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        await logAdminAudit("export_admin_snapshot", "system", "snapshot", {
            users: payload.systemSummary.totals.users,
            matches: payload.systemSummary.totals.matches,
            events: payload.systemSummary.totals.events,
        }).catch(() => {});
        showToast("Exportación lista", "Se ha descargado un snapshot operativo del sistema.", "success");
    } catch (error) {
        console.error(error);
        showToast("Error", "No se pudo generar el snapshot del panel.", "error");
    }
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

    const validation = validateMatchAdminPayload({ dateVal: dateInput, state });
    if (!validation.valid) return showToast("VALIDACIÓN", validation.errors[0], "warning");

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
        const createdRef = await addDocument(col, matchData);
        await logAdminAudit("create_match", col, "new", {
            status: state,
            date: dateInput
        }).catch(() => {});
        await addPlayerHistoryEntry({
            uid: auth.currentUser?.uid,
            kind: "admin_match_created",
            title: "Partido manual creado",
            text: `Se creo una nueva partida en ${col} para ${dateInput}`,
            tag: "Admin",
            tone: "admin",
            matchId: createdRef?.id || null,
            matchCollection: col,
            entityId: createdRef?.id || null
        }).catch(() => {});
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
    if (!(await confirmAdminAction({ title: "Reset global ELO", message: "Se reseteará a todos los jugadores a 1000 puntos. Esta acción es irreversible.", confirmLabel: "Resetear", danger: true }))) return;
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
    await logAdminAudit("update_apoing_link", "apoingCalendars", id, { url }).catch(() => {});
    showToast("SISTEMA", "Enlace Apoing actualizado", "success");
    refreshAll();
};





