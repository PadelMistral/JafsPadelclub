import { db, auth, observerAuth, getDocument, updateDocument, addDocument } from "./firebase-service.js";
import { collection, query, orderBy, limit, serverTimestamp, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { injectHeader, injectNavbar } from "./modules/ui-loader.js?v=6.5";
import { initAppUI, showToast } from "./ui-core.js";
import { MAX_PLAYERS } from "./config/match-constants.js";
import { levelFromRating } from "./config/elo-system.js";
import { sendCoreNotification } from "./core/core-engine.js";

let users = [];
let matches = [];
let logs = [];
let events = [];
let me = null;

document.addEventListener("DOMContentLoaded", () => {
  initAppUI("admin");
  observerAuth(async (user) => {
    if (!user) return window.location.replace("index.html");

    me = await getDocument("usuarios", user.uid);
    const isAdmin = me?.rol === "Admin";
    if (!isAdmin) {
      showToast("Acceso denegado", "Solo admin", "error");
      return window.location.replace("home.html");
    }

    await injectHeader(me || {});
    injectNavbar("home");

    const idBox = document.getElementById("admin-identity");
    if (idBox && me) {
      const alias = me.nombreUsuario || me.nombre || me.email || me.id || "ADMIN";
      idBox.textContent = `Console · ${alias}`;
    }

    bindTabs();
    bindFilters();
    bindSystemActions();
    await refreshAll();
  });
});

function bindTabs() {
  document.querySelectorAll(".admin-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".admin-tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".admin-pane").forEach((p) => p.classList.add("hidden"));
      btn.classList.add("active");
      document.getElementById(`pane-${btn.dataset.pane}`)?.classList.remove("hidden");
    });
  });
}

function bindFilters() {
  document.getElementById("users-search")?.addEventListener("input", renderUsersTable);
  document.getElementById("users-role-filter")?.addEventListener("change", renderUsersTable);
  document.getElementById("matches-filter")?.addEventListener("change", renderMatchesTable);
  document.getElementById("matches-type-filter")?.addEventListener("change", renderMatchesTable);
  document.getElementById("matches-search")?.addEventListener("input", renderMatchesTable);
  document.getElementById("logs-search")?.addEventListener("input", renderLogs);
  document.getElementById("ev-search")?.addEventListener("input", renderEventsTable);
  document.getElementById("btn-refresh-admin")?.addEventListener("click", refreshAll);

  // Modal logic
  document.getElementById("admin-player-search")?.addEventListener("input", renderModalUserList);
  document.getElementById("btn-add-guest-admin")?.addEventListener("click", addGuestAction);
}

function bindSystemActions() {
  document.getElementById("btn-broadcast")?.addEventListener("click", runBroadcast);
  document.getElementById("btn-apply-elo-delta")?.addEventListener("click", applyGlobalEloDelta);
  document.getElementById("btn-recalc-levels")?.addEventListener("click", recalcGlobalLevels);
  document.getElementById("btn-cancel-stale")?.addEventListener("click", cancelStaleOpenMatches);
  document.getElementById("btn-reset-presence")?.addEventListener("click", resetPresenceState);
  document.getElementById("btn-nuke-logs")?.addEventListener("click", clearAllLogs);

  document.getElementById("btn-wipe-recalc")?.addEventListener("click", async () => {
    if (!confirm("⚠️ ¿ESTÁS SEGURO? Se borrará TODO el ranking actual y se recalcularán todos los partidos con el nuevo sistema V3. Este proceso puede tardar varios minutos.")) return;
    try {
      showToast("Ranking", "Iniciando recálculo masivo...", "info");
      const res = await window.WIPE_AND_RECALC_ALL_MATCHES();
      if (res.success) {
        showToast("ÉXITO", `Ranking reconstruido: ${res.processed} partidos procesados.`, "success");
        await refreshAll();
      }
    } catch (e) {
      console.error(e);
      showToast("Error", "Fallo en el recálculo masivo.", "error");
    }
  });
}

async function refreshAll() {
  const [uSnap, amSnap, reSnap, lSnap, evSnap] = await Promise.all([
    window.getDocsSafe(query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"))),
    window.getDocsSafe(collection(db, "partidosAmistosos")),
    window.getDocsSafe(collection(db, "partidosReto")),
    window.getDocsSafe(query(collection(db, "adminLogs"), orderBy("timestamp", "desc"), limit(100))),
    window.getDocsSafe(collection(db, "eventos")),
  ]);

  users = (uSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
  matches = [
    ...(amSnap?.docs || []).map((d) => ({ id: d.id, col: "partidosAmistosos", ...d.data() })),
    ...(reSnap?.docs || []).map((d) => ({ id: d.id, col: "partidosReto", ...d.data() })),
  ].sort((a, b) => (toDate(b.fecha) - toDate(a.fecha)));
  logs = (lSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));
  events = (evSnap?.docs || []).map((d) => ({ id: d.id, ...d.data() }));

  renderDashboard();
  renderUsersTable();
  renderMatchesTable();
  renderEventsTable();
  renderRankingTable();
  renderLogs();
}

function renderDashboard() {
  const approved = users.filter((u) => u.status === "approved" || u.aprobado === true || u.rol === "Admin");
  const active = matches.filter((m) => (m.jugadores || []).filter(Boolean).length > 0 && !isPlayed(m)).length;
  const avg = approved.length ? Math.round(approved.reduce((s, u) => s + Number(u.puntosRanking || 1000), 0) / approved.length) : 0;
  const withApoing = approved.filter((u) => String(u.apoingCalendarUrl || "").trim().length > 0).length;
  const notifOn = approved.filter((u) => String(u.notifPermission || "").toLowerCase() === "granted").length;

  setText("kpi-users", String(approved.length));
  setText("kpi-matches", String(matches.length));
  setText("kpi-active", String(active));
  setText("kpi-avg", String(avg));
  setText("kpi-apoing", String(withApoing));
  setText("kpi-notif-on", String(notifOn));
}

function renderUsersTable() {
  const search = String(document.getElementById("users-search")?.value || "").toLowerCase();
  const roleFilter = String(document.getElementById("users-role-filter")?.value || "all");
  const data = users.filter((u) => {
    const n = String(u.nombreUsuario || u.nombre || "").toLowerCase();
    const e = String(u.email || "").toLowerCase();
    const roleOk = roleFilter === "all" || String(u.rol || "Jugador") === roleFilter;
    return roleOk && (n.includes(search) || e.includes(search));
  });

  const body = document.getElementById("users-body");
  if (!body) return;
  body.innerHTML = data.map((u) => {
    const name = u.nombreUsuario || u.nombre || "Sin nombre";
    const hasApoing = String(u.apoingCalendarUrl || "").trim().length > 0;
    const notifState = String(u.notifPermission || "").toLowerCase();

    const apoingHtml = hasApoing
      ? `<span class="badge-mini badge-apoing"><i class="fa-solid fa-calendar-check"></i> ICS</span>`
      : `<span class="badge-mini badge-apoing off">Sin ICS</span>`;

    let notifLabel = "Sin dato";
    let notifClass = "badge-notif-unknown";
    if (notifState === "granted") {
      notifLabel = "ON";
      notifClass = "badge-notif-on";
    } else if (notifState === "denied" || notifState === "blocked") {
      notifLabel = "Bloqueado";
      notifClass = "badge-notif-off";
    }
    const notifHtml = `<span class="badge-mini ${notifClass}">${notifLabel}</span>`;

    return `
      <tr>
        <td>${name}</td>
        <td>${u.email || "-"}</td>
        <td>${apoingHtml}</td>
        <td>${notifHtml}</td>
        <td><input type="number" step="0.01" value="${Number(u.nivel || 2.5).toFixed(2)}" data-u="${u.id}" data-k="nivel" class="inl"></td>
        <td><input type="number" value="${Math.round(Number(u.puntosRanking || 1000))}" data-u="${u.id}" data-k="puntosRanking" class="inl"></td>
        <td>
          <select data-u="${u.id}" data-k="rol" class="inl">
            <option value="Jugador" ${u.rol === "Jugador" ? "selected" : ""}>Jugador</option>
            <option value="Admin" ${u.rol === "Admin" ? "selected" : ""}>Admin</option>
          </select>
        </td>
        <td>
          <div class="flex-row gap-1">
            <button class="btn-mini" onclick="window.saveUserInline('${u.id}')">Guardar</button>
            <button class="btn-mini ${u.status === "blocked" ? "" : "danger"}" onclick="window.toggleUserBlock('${u.id}')">${u.status === "blocked" ? "Desbloquear" : "Bloquear"}</button>
            <button class="btn-mini danger" onclick="window.deleteUserAdmin('${u.id}')">Eliminar</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderMatchesTable() {
  const mode = document.getElementById("matches-filter")?.value || "all";
  const typeFilter = document.getElementById("matches-type-filter")?.value || "all";
  const search = String(document.getElementById("matches-search")?.value || "").toLowerCase();

  let data = [...matches];
  if (mode === "open") data = data.filter((m) => !isPlayed(m) && (m.jugadores || []).filter(Boolean).length < MAX_PLAYERS);
  if (mode === "played") data = data.filter((m) => isPlayed(m));
  if (typeFilter !== "all") data = data.filter((m) => String(m.col || "") === typeFilter);
  if (search) {
    data = data.filter((m) => {
      const date = toDate(m.fecha);
      const dateText = date ? date.toLocaleString("es-ES").toLowerCase() : "";
      const state = String(m.estado || "").toLowerCase();
      return dateText.includes(search) || state.includes(search);
    });
  }

  const body = document.getElementById("matches-body");
  if (!body) return;
  body.innerHTML = data.map((m) => {
    const date = toDate(m.fecha);
    const filled = (m.jugadores || []).filter(Boolean).length;
    return `
      <tr>
        <td>${m.col === "partidosReto" ? "Reto" : "Amistoso"}</td>
        <td>${date ? date.toLocaleString("es-ES") : "-"}</td>
        <td>
          <div class="flex-row items-center gap-2">
            <span>${filled}/${MAX_PLAYERS}</span>
            <button class="btn-mini" title="Añadir jugador" onclick="window.openAddPlayerToMatch('${m.id}','${m.col}')"><i class="fas fa-user-plus"></i></button>
          </div>
        </td>
        <td>
          <select data-m="${m.id}" data-col="${m.col}" data-k="estado" class="inl">
            ${["abierto", "jugada", "jugado", "cancelado", "anulado"].map((s) => `<option value="${s}" ${String(m.estado || "").toLowerCase() === s ? "selected" : ""}>${s}</option>`).join("")}
          </select>
        </td>
        <td>
          <input type="text" value="${m.resultado?.sets || ""}" placeholder="6-2 6-4" data-m="${m.id}" data-col="${m.col}" data-k="resultado" class="inl">
        </td>
        <td>
          <div class="flex-row gap-1">
            <button class="btn-mini" onclick="window.saveMatchInline('${m.id}','${m.col}')">Guardar</button>
            <button class="btn-mini danger" onclick="window.deleteMatchAdmin('${m.id}','${m.col}')">Eliminar</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function renderEventsTable() {
    const area = document.getElementById("ev-body-admin");
    if (!area) return;
    const search = String(document.getElementById("ev-search")?.value || "").toLowerCase();
    
    const data = events.filter(e => e.nombre?.toLowerCase().includes(search));
    
    area.innerHTML = data.map(e => `
        <tr>
            <td class="font-bold">${e.nombre || 'Sin nombre'}</td>
            <td><span class="badge ghost">${e.formato?.toUpperCase() || 'LIGA'}</span></td>
            <td>${(e.inscritos || []).length} / ${e.plazasMax || 16}</td>
            <td><span class="badge ${e.estado === 'activo' ? 'success' : 'warning'}">${e.estado?.toUpperCase() || 'DRAFT'}</span></td>
            <td>
                <div class="flex-row gap-1">
                    <button class="btn-mini" onclick="window.location.href='evento-detalle.html?id=${e.id}&admin=1'"><i class="fas fa-cog"></i> GESTIONAR</button>
                    <button class="btn-mini primary-glow" onclick="window.openAddPlayerToEvent('${e.id}')"><i class="fas fa-user-plus"></i></button>
                </div>
            </td>
        </tr>
    `).join('') || '<tr><td colspan="5" class="text-center opacity-50 py-4">No hay eventos que coincidan</td></tr>';
}

function renderRankingTable() {
  const body = document.getElementById("ranking-body");
  if (!body) return;
  const sorted = [...users].sort((a, b) => Number(b.puntosRanking || 0) - Number(a.puntosRanking || 0)).slice(0, 100);
  body.innerHTML = sorted.map((u, idx) => `
    <tr>
      <td>#${idx + 1}</td>
      <td>${u.nombreUsuario || u.nombre || "-"}</td>
      <td>${Math.round(Number(u.puntosRanking || 1000))}</td>
      <td>${Number(u.nivel || 2.5).toFixed(2)}</td>
      <td>
        <input type="number" step="0.01" value="${Number(u.nivel || 2.5).toFixed(2)}" data-u="${u.id}" data-k="nivel" class="inl sm">
        <input type="number" value="${Math.round(Number(u.puntosRanking || 1000))}" data-u="${u.id}" data-k="puntosRanking" class="inl sm">
        <button class="btn-mini" onclick="window.saveUserInline('${u.id}')">Aplicar</button>
      </td>
    </tr>
  `).join("");
}

function renderLogs() {
  const box = document.getElementById("logs-list");
  if (!box) return;

  const search = String(document.getElementById("logs-search")?.value || "").toLowerCase();
  const filtered = !search
    ? logs
    : logs.filter((l) => {
      const action = String(l.action || "").toLowerCase();
      const detail = String(l.detail || "").toLowerCase();
      return action.includes(search) || detail.includes(search);
    });

  if (!filtered.length) {
    box.innerHTML = '<div class="empty-admin">Sin logs administrativos.</div>';
    return;
  }

  box.innerHTML = filtered.map((l) => {
    const d = l.timestamp?.toDate ? l.timestamp.toDate() : new Date();
    return `<div class="log-row"><b>${l.action || "ACTION"}</b> · ${l.detail || "-"} <span>${d.toLocaleString("es-ES")}</span></div>`;
  }).join("");
}

async function addAdminLog(action, detail) {
  try {
    await addDocument("adminLogs", {
      action,
      detail,
      actorUid: auth.currentUser?.uid || null,
      actorEmail: auth.currentUser?.email || null,
      timestamp: serverTimestamp(),
    });
  } catch (_) {}
}

window.saveUserInline = async (uid) => {
  const inputs = Array.from(document.querySelectorAll(`[data-u="${uid}"]`));
  const payload = {};
  inputs.forEach((el) => {
    const k = el.dataset.k;
    if (!k) return;
    payload[k] = el.type === "number" ? Number(el.value) : el.value;
  });

  await updateDocument("usuarios", uid, payload);
  await addAdminLog("UPDATE_USER", `${uid} -> ${JSON.stringify(payload)}`);
  showToast("Guardado", "Usuario actualizado", "success");
  await refreshAll();
};

window.saveMatchInline = async (id, col) => {
  const select = document.querySelector(`[data-m="${id}"][data-col="${col}"][data-k="estado"]`);
  const resInput = document.querySelector(`[data-m="${id}"][data-col="${col}"][data-k="resultado"]`);
  if (!select) return;
  
  const payload = {
    estado: String(select.value || "abierto").toLowerCase()
  };
  if (resInput) {
    payload.resultado = { sets: resInput.value.trim() };
    if (payload.resultado.sets && (payload.estado === 'abierto' || payload.estado === 'jugada')) {
        payload.estado = 'jugado';
    }
  }

  await updateDocument(col, id, payload);
  await addAdminLog("UPDATE_MATCH", `${col}/${id} -> ${JSON.stringify(payload)}`);
  showToast("Guardado", "Partido actualizado", "success");
  await refreshAll();
};

window.toggleUserBlock = async (uid) => {
  const u = users.find((x) => x.id === uid);
  if (!u) return;
  const blocked = u.status === "blocked";
  await updateDocument("usuarios", uid, {
    status: blocked ? "approved" : "blocked",
    bloqueado: !blocked,
    aprobado: blocked ? true : false,
  });
  await addAdminLog(blocked ? "UNBLOCK_USER" : "BLOCK_USER", `${uid}`);
  showToast("Usuarios", blocked ? "Usuario desbloqueado" : "Usuario bloqueado", "success");
  await refreshAll();
};

window.deleteUserAdmin = async (uid) => {
  if (!confirm("¿Eliminar usuario? Esta acción no se puede deshacer.")) return;
  await deleteDoc(doc(db, "usuarios", uid));
  await addAdminLog("DELETE_USER", uid);
  showToast("Usuarios", "Usuario eliminado", "success");
  await refreshAll();
};

window.deleteMatchAdmin = async (id, col) => {
  if (!confirm("¿Eliminar partido? Esta acción no se puede deshacer.")) return;
  await deleteDoc(doc(db, col, id));
  await addAdminLog("DELETE_MATCH", `${col}/${id}`);
  showToast("Partidos", "Partido eliminado", "success");
  await refreshAll();
};

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isPlayed(m) {
  const s = String(m.estado || "").toLowerCase();
  return s === "jugado" || s === "jugada" || s === "cancelado" || s === "anulado" || !!m.resultado?.sets;
}

function getTargetUserUids() {
  return users
    .filter((u) => (u.status === "approved" || u.aprobado === true || u.rol === "Admin"))
    .map((u) => u.id)
    .filter(Boolean);
}

async function runBroadcast() {
  const title = String(document.getElementById("sys-broadcast-title")?.value || "").trim();
  const message = String(document.getElementById("sys-broadcast-message")?.value || "").trim();
  const link = String(document.getElementById("sys-broadcast-link")?.value || "home.html").trim();
  const type = String(document.getElementById("sys-broadcast-type")?.value || "info");
  if (!title || !message) {
    showToast("Campos incompletos", "Título y mensaje son obligatorios", "warning");
    return;
  }
  const uids = getTargetUserUids();
  if (!uids.length) {
    showToast("Sin destinatarios", "No hay usuarios aprobados", "warning");
    return;
  }
  const ok = await sendCoreNotification(uids, title, message, type, link, { source: "admin_broadcast" });
  if (!ok) {
    showToast("Error", "No se pudo enviar el broadcast", "error");
    return;
  }
  await addAdminLog("BROADCAST", `${title} -> ${uids.length} usuarios`);
  showToast("Enviado", `Broadcast enviado a ${uids.length} usuarios`, "success");
}

async function applyGlobalEloDelta() {
  const delta = Number(document.getElementById("sys-elo-delta")?.value || 0);
  const minMatches = Number(document.getElementById("sys-min-matches")?.value || 0);
  if (!Number.isFinite(delta) || delta === 0) {
    showToast("Delta inválido", "Introduce un valor distinto de 0", "warning");
    return;
  }
  const target = users.filter((u) => Number(u.partidosJugados || 0) >= Math.max(0, minMatches));
  for (const u of target) {
    const nextPts = Math.round(Number(u.puntosRanking || 1000) + delta);
    await updateDocument("usuarios", u.id, { puntosRanking: nextPts });
  }
  await addAdminLog("GLOBAL_ELO_DELTA", `delta=${delta}, minMatches=${minMatches}, users=${target.length}`);
  showToast("Aplicado", `Delta aplicado a ${target.length} usuarios`, "success");
  await refreshAll();
}

async function recalcGlobalLevels() {
  for (const u of users) {
    const pts = Number(u.puntosRanking || 1000);
    const lvl = Number(levelFromRating(pts).toFixed(2));
    await updateDocument("usuarios", u.id, { nivel: lvl });
  }
  await addAdminLog("RECALC_LEVELS", `users=${users.length}`);
  showToast("Recalculado", "Niveles sincronizados con ELO", "success");
  await refreshAll();
}

async function cancelStaleOpenMatches() {
  const now = Date.now();
  const stale = matches.filter((m) => {
    if (isPlayed(m)) return false;
    const d = toDate(m.fecha);
    if (!d) return false;
    return d.getTime() < now - (2 * 60 * 60 * 1000);
  });
  for (const m of stale) {
    await updateDocument(m.col, m.id, {
      estado: "anulado",
      cancelReason: "admin_cleanup",
      updatedAt: serverTimestamp(),
    });
  }
  await addAdminLog("CANCEL_STALE_OPEN", `matches=${stale.length}`);
  showToast("Mantenimiento", `${stale.length} partidos anulados`, "success");
  await refreshAll();
}

async function resetPresenceState() {
  for (const u of users) {
    await updateDocument("usuarios", u.id, {
      enLinea: false,
      ultimaActividad: serverTimestamp(),
    });
  }
  await addAdminLog("RESET_PRESENCE", `users=${users.length}`);
  showToast("Presencia", "Estado de presencia reiniciado", "success");
}

async function clearAllLogs() {
  if (!confirm("¿Borrar todos los logs administrativos y de ranking?")) return;
  const [adminSnap, rankSnap] = await Promise.all([
    window.getDocsSafe(collection(db, "adminLogs")),
    window.getDocsSafe(collection(db, "rankingLogs")),
  ]);
  for (const d of adminSnap.docs || []) await deleteDoc(doc(db, "adminLogs", d.id));
  for (const d of rankSnap.docs || []) await deleteDoc(doc(db, "rankingLogs", d.id));
  showToast("Sistema", "Logs eliminados", "success");
  await refreshAll();
}

/* ═══ ADMIN ADD PLAYER LOGIC ═══ */
let adminAddTarget = { type: null, id: null, col: null };

window.openAddPlayerToMatch = (matchId, col) => {
  adminAddTarget = { type: 'match', id: matchId, col };
  document.getElementById("add-player-target-title").textContent = "Añadir a Partida";
  document.getElementById("admin-player-search").value = "";
  document.getElementById("admin-guest-name").value = "";
  renderModalUserList();
  document.getElementById("modal-admin-add-player").classList.add("active");
};

window.openAddPlayerToEvent = (eventId) => {
  adminAddTarget = { type: 'event', id: eventId };
  document.getElementById("add-player-target-title").textContent = "Añadir a Evento";
  document.getElementById("admin-player-search").value = "";
  document.getElementById("admin-guest-name").value = "";
  renderModalUserList();
  document.getElementById("modal-admin-add-player").classList.add("active");
};

function renderModalUserList() {
  const query = String(document.getElementById("admin-player-search")?.value || "").toLowerCase();
  const box = document.getElementById("admin-user-list-results");
  if (!box) return;

  const filtered = users.filter(u => {
    const name = String(u.nombreUsuario || u.nombre || "").toLowerCase();
    const email = String(u.email || "").toLowerCase();
    return name.includes(query) || email.includes(query);
  }).slice(0, 20);

  box.innerHTML = filtered.map(u => {
    const name = u.nombreUsuario || u.nombre || 'Sin nombre';
    const photo = u.fotoPerfil || u.fotoURL || u.photoURL || "";
    const initials = (u.nombreUsuario || u.nombre || "?").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
    const avatarHtml = photo 
        ? `<img src="${photo}" class="admin-user-avatar">` 
        : `<span class="admin-user-avatar avatar-fallback">${initials}</span>`;
    
    return `
      <div class="admin-user-item">
        ${avatarHtml}
        <div class="admin-user-info">
          <span class="admin-user-name">${name}</span>
          <span class="admin-user-email">${u.email || '-'}</span>
        </div>
        <button class="btn-mini" onclick="window.confirmAddPlayerAdmin('${u.id}')">ELEGIR</button>
      </div>
    `;
  }).join("") || '<div class="empty-admin">No se encontraron usuarios</div>';
}

window.confirmAddPlayerAdmin = async (uid) => {
  const user = users.find(u => u.id === uid);
  if (!user) return;
  
  if (adminAddTarget.type === 'match') {
    await executeAddPlayerToMatch(uid, user);
  } else if (adminAddTarget.type === 'event') {
    await executeAddPlayerToEvent(uid, user);
  }
};

async function addGuestAction() {
  const name = String(document.getElementById("admin-guest-name")?.value || "").trim();
  if (!name) return showToast("Admin", "Indica un nombre para el invitado", "warning");

  const guestId = `GUEST_${Date.now()}_${Math.floor(Math.random()*1000)}`;
  const guestUser = { id: guestId, nombreUsuario: name, nombre: name, nivel: 2.5, puntosRanking: 1000, isGuest: true };

  if (adminAddTarget.type === 'match') {
    await executeAddPlayerToMatch(guestId, guestUser);
  } else if (adminAddTarget.type === 'event') {
    await executeAddPlayerToEvent(guestId, guestUser);
  }
}

async function executeAddPlayerToMatch(uid, userData) {
  const m = matches.find(x => x.id === adminAddTarget.id && x.col === adminAddTarget.col);
  if (!m) return;

  const jugs = [...(m.jugadores || [null, null, null, null])];
  const firstFree = jugs.indexOf(null);
  if (firstFree === -1) return showToast("Admin", "Partido lleno", "warning");

  jugs[firstFree] = uid;
  try {
    const payload = { jugadores: jugs };
    // update equipoA/B if they exist
    if (firstFree < 2) payload.equipoA = [jugs[0], jugs[1]];
    else payload.equipoB = [jugs[2], jugs[3]];

    await updateDocument(adminAddTarget.col, adminAddTarget.id, payload);
    await addAdminLog("ADMIN_ADD_PLAYER_MATCH", `Added ${uid} to ${adminAddTarget.id}`);
    showToast("Admin", "Jugador añadido al partido", "success");
    document.getElementById("modal-admin-add-player").classList.remove("active");
    await refreshAll();
  } catch (e) {
    showToast("Error", "No se pudo añadir al jugador", "error");
  }
}

async function executeAddPlayerToEvent(uid, userData) {
  const ev = events.find(x => x.id === adminAddTarget.id);
  if (!ev) return;

  const currentInscritos = ev.inscritos || [];
  if (currentInscritos.some(i => i.uid === uid)) return showToast("Admin", "Ya está inscrito", "info");

  const entry = {
    uid,
    nombre: userData.nombreUsuario || userData.nombre || "Jugador",
    nivel: Number(userData.nivel || 2.5),
    sidePreference: "flex",
    pairCode: "",
    inscritoEn: new Date().toISOString(),
    adminAdded: true
  };

  try {
    await updateDocument("eventos", adminAddTarget.id, {
      inscritos: [...currentInscritos, entry]
    });
    await addAdminLog("ADMIN_ADD_PLAYER_EVENT", `Added ${uid} to event ${adminAddTarget.id}`);
    showToast("Admin", "Jugador inscrito al evento", "success");
    document.getElementById("modal-admin-add-player").classList.remove("active");
    await refreshAll();
  } catch (e) {
    showToast("Error", "No se pudo inscribir al jugador", "error");
  }
}
