/* =====================================================
   PADELUMINATIS NOTIFICACIONES JS
   Bandeja + estado simple de avisos
   ===================================================== */

import { auth, db } from "./firebase-service.js";
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  limit,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI, showToast } from "./ui-core.js";
import { injectHeader, injectNavbar } from "./modules/ui-loader.js";
import { observeCoreSession } from "./core/core-engine.js";
import {
  getPushStatusHuman,
  requestNotificationPermission,
  checkNotificationStatus,
  showNotificationHelpModal,
  registerBestServiceWorkerWithRetry,
  cleanupStaleServiceWorkers,
  initPushNotifications,
  relaunchOneSignal,
  sendPushNotification,
} from "./modules/push-notifications.js";
import { toDateSafe } from "./utils/match-utils.js";

let currentUser = null;
let currentFilter = "all";
let unsubNotifs = null;
let notifications = [];

const notifListEl = document.getElementById("notif-list");
const pushStatusBanner = document.getElementById("push-status-banner");
const globalPushStatusText = document.getElementById("global-push-status");
const permissionArea = document.getElementById("permission-area");
const permStatusText = document.getElementById("perm-status-text");
const btnRequestPush = document.getElementById("btn-request-push");
const btnReadAll = document.getElementById("btn-read-all");
const btnClearAll = document.getElementById("btn-clear-all");
const filterTabs = document.querySelectorAll(".filter-tab-v8");
const btnRefreshPush = document.getElementById("btn-refresh-push");
const btnReconnectPush = document.getElementById("btn-reconnect-push");
const btnReregisterSw = document.getElementById("btn-reregister-sw");
const btnCleanSw = document.getElementById("btn-clean-sw");
const btnReloadApp = document.getElementById("btn-reload-app");
const btnOpenGuide = document.getElementById("btn-open-guide");

function applyNotificationPageCopy() {
  if (document.title) document.title = "Notificaciones | JafsPadel";
  const sub = document.querySelector(".page-sub-pro");
  if (sub) sub.textContent = "Solo tus avisos importantes y su estado";
  const expl = document.getElementById("push-status-explanation");
  if (expl) expl.textContent = "Estamos mirando si tu movil puede recibir avisos de tus partidas y movimientos.";
  const helpGuide = document.getElementById("perm-platform-guide");
  if (helpGuide) helpGuide.textContent = "Te diremos aqui que hacer con frases simples.";
  const support = document.getElementById("push-support-copy");
  if (support) support.textContent = "Te diremos la causa mas probable y el boton que mas conviene probar.";
  const guideBtn = document.getElementById("btn-open-guide");
  if (guideBtn) guideBtn.textContent = "Ver guia";
  const readAll = document.getElementById("btn-read-all");
  if (readAll) readAll.title = "Marcar todo como leido";
  const clearAll = document.getElementById("btn-clear-all");
  if (clearAll) clearAll.title = "Vaciar bandeja";
  const guideTitle = document.querySelector(".denied-guide-header span");
  if (guideTitle) guideTitle.textContent = "Como volver a activarlas";
  document.querySelectorAll(".guide-step-title").forEach((node) => {
    node.textContent = String(node.textContent || "")
      .replace(/Añade/gi, "Anade")
      .replace(/Añadir/gi, "Anadir")
      .replace(/CÃ³mo/gi, "Como");
  });
  document.querySelectorAll(".guide-step-desc").forEach((node) => {
    node.textContent = String(node.textContent || "")
      .replace(/información/gi, "informacion")
      .replace(/cámbialo/gi, "cambialo")
      .replace(/allí/gi, "alli")
      .replace(/Está/gi, "Esta")
      .replace(/dirección/gi, "direccion");
  });
  const channel = document.getElementById("push-channel-pill");
  if (channel) channel.textContent = "Canal: ---";
}

function escapeHtml(raw = "") {
  const div = document.createElement("div");
  div.textContent = String(raw ?? "");
  return div.innerHTML;
}

function normalizeInternalLink(link = "") {
  const raw = String(link || "").trim();
  if (!raw) return "";
  if (/^\s*javascript:/i.test(raw)) return "";
  if (/^\s*data:/i.test(raw)) return "";
  if (/^\s*https?:/i.test(raw)) return raw;
  if (raw.startsWith("./") || raw.startsWith("../") || raw.startsWith("/") || /^[a-z0-9_-]+\.html/i.test(raw)) {
    return raw;
  }
  return "";
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    applyNotificationPageCopy();
    await initAppUI("notificaciones");
  } catch (e) {
    console.error("[Notificaciones] UI Core error:", e);
  }
});

observeCoreSession({
  onSignedOut: () => {
    window.location.replace("index.html");
  },
  onReady: async ({ user, userDoc }) => {
    currentUser = user;
    try {
      applyNotificationPageCopy();
      await injectHeader(userDoc);
      injectNavbar("notificaciones");
      loadNotificationsSafeV2(user.uid);
      setupFilterTabs();
      setupGlobalActions();
      bindPushActions();
      window.showNotificationHelpModal = showNotificationHelpModal;
      await updatePushStatusUI();
    } catch (err) {
      console.error("[Notificaciones] init error:", err);
      showToast("Error", "Error al inicializar la vista de notificaciones", "error");
    }
  },
});

function loadNotifications(uid) {
  if (unsubNotifs) unsubNotifs();
  const q = query(
    collection(db, "notificaciones"),
    where("destinatario", "==", uid),
    orderBy("timestamp", "desc"),
    limit(80),
  );

  unsubNotifs = onSnapshot(
    q,
    (snapshot) => {
      notifications = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderNotifications();
    },
    (err) => {
      console.error("Firestore error (notificaciones):", err);
      notifListEl.innerHTML = `
        <div class="empty-state-v8">
          <i class="fas fa-exclamation-triangle opacity-20 text-red-400 mb-4 text-4xl"></i>
          <p>Error al cargar las notificaciones. Revisa tu conexión.</p>
          <code class="text-[9px] opacity-40 mt-2">${err.message}</code>
        </div>
      `;
    },
  );
}

function loadNotificationsSafe(uid) {
  if (unsubNotifs) unsubNotifs();
  const orderedQuery = query(
    collection(db, "notificaciones"),
    where("destinatario", "==", uid),
    orderBy("timestamp", "desc"),
    limit(80),
  );
  const fallbackQuery = query(
    collection(db, "notificaciones"),
    where("destinatario", "==", uid),
    limit(80),
  );

  const applyRows = (docs = []) => {
    notifications = docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (toDateSafe(b.timestamp || b.createdAt)?.getTime() || 0) - (toDateSafe(a.timestamp || a.createdAt)?.getTime() || 0));
    renderNotifications();
  };

  const bind = (useFallback = false) =>
    onSnapshot(
      useFallback ? fallbackQuery : orderedQuery,
      (snapshot) => applyRows(snapshot.docs),
      async (err) => {
        console.error("Firestore error (notificaciones):", err);
        if (!useFallback && err?.code === "failed-precondition") {
          try {
            const warm = await getDocs(fallbackQuery);
            applyRows(warm.docs);
          } catch {}
          unsubNotifs = bind(true);
          showToast("Notificaciones listas", "He activado un modo compatible mientras falta el índice de Firestore.", "info");
          return;
        }
        notifListEl.innerHTML = `
          <div class="empty-state-v8">
            <i class="fas fa-exclamation-triangle opacity-20 text-red-400 mb-4 text-4xl"></i>
            <p>Error al cargar las notificaciones. Revisa tu conexión.</p>
            <code class="text-[9px] opacity-40 mt-2">${escapeHtml(err?.message || "Error desconocido")}</code>
          </div>
        `;
      },
    );

  unsubNotifs = bind(false);
}

function loadNotificationsSafeV2(uid) {
  if (unsubNotifs) unsubNotifs();
  const fallbackQuery = query(
    collection(db, "notificaciones"),
    where("destinatario", "==", uid),
    limit(80),
  );

  const applyRows = (docs = []) => {
    notifications = docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (toDateSafe(b.timestamp || b.createdAt)?.getTime() || 0) - (toDateSafe(a.timestamp || a.createdAt)?.getTime() || 0));
    renderNotifications();
  };

  const renderLoadError = (err) => {
    console.error("Firestore error (notificaciones):", err);
    notifListEl.innerHTML = `
      <div class="empty-state-v8">
        <i class="fas fa-exclamation-triangle opacity-20 text-red-400 mb-4 text-4xl"></i>
        <p>Error al cargar las notificaciones. Revisa tu conexiÃ³n.</p>
        <code class="text-[9px] opacity-40 mt-2">${escapeHtml(err?.message || "Error desconocido")}</code>
      </div>
    `;
  };

  const bindFallback = () =>
    onSnapshot(
      fallbackQuery,
      (snapshot) => applyRows(snapshot.docs),
      (err) => renderLoadError(err),
    );

  (async () => {
    try {
      const orderedQuery = query(
        collection(db, "notificaciones"),
        where("destinatario", "==", uid),
        orderBy("timestamp", "desc"),
        limit(80),
      );
      const warmOrdered = await getDocs(orderedQuery);
      applyRows(warmOrdered.docs);
      unsubNotifs = onSnapshot(
        orderedQuery,
        (snapshot) => applyRows(snapshot.docs),
        async (err) => {
          if (err?.code === "failed-precondition") {
            try {
              const warmFallback = await getDocs(fallbackQuery);
              applyRows(warmFallback.docs);
            } catch {}
            unsubNotifs = bindFallback();
            return;
          }
          renderLoadError(err);
        },
      );
    } catch (err) {
      if (err?.code === "failed-precondition") {
        try {
          const warmFallback = await getDocs(fallbackQuery);
          applyRows(warmFallback.docs);
        } catch {}
        unsubNotifs = bindFallback();
        return;
      }
      renderLoadError(err);
    }
  })();
}

function renderNotifications() {
  if (!notifications.length) {
    notifListEl.innerHTML = `
      <div class="empty-state-v8 animate-fade-in">
        <div class="empty-icon-v8"><i class="fas fa-bell-slash"></i></div>
        <h3>Bandeja vacía</h3>
        <p>No tienes notificaciones por ahora.</p>
      </div>`;
    return;
  }

  let filtered = notifications;
  if (currentFilter === "unread") filtered = notifications.filter((n) => !n.leido && !n.read);
  if (currentFilter === "read") filtered = notifications.filter((n) => n.leido || n.read);

  if (!filtered.length) {
    notifListEl.innerHTML = `
      <div class="empty-state-v8 animate-fade-in">
        <i class="fas fa-filter"></i>
        <p>No hay notificaciones con este filtro.</p>
      </div>`;
    return;
  }

  notifListEl.innerHTML = filtered
    .map((n) => {
      const date = toDateSafe(n.timestamp || n.createdAt);
      const timeStr = date ? date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
      const dayStr = date ? date.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).toUpperCase() : "";
      const isRead = n.leido || n.read;
      const typeIcon = getTypeIcon(n.tipo || n.type);
      const safeTitle = escapeHtml(n.titulo || n.title || "Aviso");
      const safeMessage = escapeHtml(n.mensaje || n.message || "");
      const safeLink = normalizeInternalLink(n.enlace || "");

      return `
        <div class="notif-item-v8 ${isRead ? "read" : "unread"} animate-up" data-id="${n.id}">
          <div class="notif-icon-v8 ${n.tipo || "info"}">
            <i class="fas ${typeIcon}"></i>
          </div>
          <div class="notif-body-v8">
            <div class="notif-top">
              <span class="notif-title-v8">${safeTitle}</span>
              <span class="notif-time-v8">${dayStr} · ${timeStr}</span>
            </div>
            <p class="notif-msg-v8">${safeMessage}</p>
            <div class="notif-actions-v8">
              ${safeLink ? `<button class="btn-notif-action primary" data-link="${safeLink}"><i class="fas fa-external-link-alt mr-1"></i> VER</button>` : ""}
              ${!isRead ? `<button class="btn-notif-action mark-read" data-id="${n.id}"><i class="fas fa-check mr-1"></i> LEÍDA</button>` : ""}
              <button class="btn-notif-action delete" data-id="${n.id}"><i class="fas fa-trash-alt"></i></button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  notifListEl.querySelectorAll(".primary").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      if (btn.dataset.link) window.location.href = btn.dataset.link;
    };
  });
  notifListEl.querySelectorAll(".mark-read").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      markAsRead(btn.dataset.id);
    };
  });
  notifListEl.querySelectorAll(".delete").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      deleteNotification(btn.dataset.id);
    };
  });
}

function getTypeIcon(type) {
  switch (type) {
    case "match_join": return "fa-user-plus";
    case "match_leave": return "fa-user-minus";
    case "match_full": return "fa-users";
    case "result_uploaded": return "fa-trophy";
    case "match_cancelled": return "fa-calendar-times";
    case "ranking_up": return "fa-arrow-up";
    case "ranking_down": return "fa-arrow-down";
    case "level_up": return "fa-bolt";
    case "system": return "fa-cog";
    default: return "fa-bell";
  }
}

async function markAsRead(id) {
  if (!auth.currentUser) return;
  try {
    await updateDoc(doc(db, "notificaciones", id), {
      leido: true,
      read: true,
      seen: true,
      readAt: serverTimestamp(),
    });
  } catch (e) {
    console.error("Firestore error (markAsRead):", e);
  }
}

async function deleteNotification(id) {
  if (!auth.currentUser) return;
  if (!confirm("¿Eliminar esta notificación?")) return;
  try {
    await deleteDoc(doc(db, "notificaciones", id));
    showToast("Eliminado", "Notificación borrada", "success");
  } catch (e) {
    console.error("Firestore error (deleteNotification):", e);
    showToast("Error", "No se pudo borrar", "error");
  }
}

function setupFilterTabs() {
  filterTabs.forEach((tab) => {
    tab.onclick = () => {
      filterTabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.dataset.filter;
      renderNotifications();
    };
  });
}

function setupGlobalActions() {
  btnReadAll.onclick = async () => {
    const unread = notifications.filter((n) => !n.leido && !n.read);
    if (!unread.length) return;
    try {
      const batch = writeBatch(db);
      unread.forEach((n) => {
        batch.update(doc(db, "notificaciones", n.id), {
          leido: true,
          read: true,
          seen: true,
          readAt: serverTimestamp(),
        });
      });
      await batch.commit();
      showToast("Hecho", "Todas las notificaciones marcadas como leídas.", "success");
    } catch (e) {
      console.error("Firestore error (markAllAsRead):", e);
    }
  };

  btnClearAll.onclick = async () => {
    if (!notifications.length) return;
    if (!confirm("¿Seguro que quieres vaciar toda la bandeja?")) return;
    try {
      const batch = writeBatch(db);
      notifications.forEach((n) => batch.delete(doc(db, "notificaciones", n.id)));
      await batch.commit();
      showToast("Bandeja vacía", "Se han eliminado todas las notificaciones.", "info");
    } catch (e) {
      console.error("Firestore error (clearAll):", e);
    }
  };
}

function setHeroState(ok) {
  pushStatusBanner.classList.remove("is-ok", "is-warn", "is-error");
  pushStatusBanner.classList.add(ok ? "is-ok" : "is-warn");
}

function tagText(label, value) {
  const el = document.getElementById(label);
  if (el) el.textContent = value;
}

function buildFriendlyState(status) {
  if (status.permission === "denied") {
    return {
      title: "Tus avisos estan bloqueados",
      summary: "Solo hace falta volver a permitirlos en tu navegador o movil.",
      support: "Si alguna vez pulsaste Bloquear, abre la guia y luego recarga la app.",
      primary: "Ver como activar",
      tone: "blocked",
    };
  }
  if (status.backgroundReady) {
    return {
      title: "Todo esta bien conectado",
      summary: "Deberias recibir avisos del club sin hacer nada mas.",
      support: "Si quieres puedes hacer una prueba rapida con el boton Probar.",
      primary: "Avisos activos",
      tone: "ok",
    };
  }
  if (status.permission === "default") {
    return {
      title: "Activa los avisos",
      summary: "Solo falta aceptar el permiso cuando lo pida el navegador.",
      support: "Pulsa Activar y despues toca Permitir.",
      primary: "Activar",
      tone: "pending",
    };
  }
  if (!status.swActive || !status.oneSignalRegistered) {
    return {
      title: "Falta terminar la conexion",
      summary: "La app aun no termino de preparar los avisos en segundo plano.",
      support: "Prueba primero con Reconectar. Si no cambia, usa Reparar o Recargar.",
      primary: "Reintentar",
      tone: "pending",
    };
  }
  return {
    title: "Estamos revisando tus avisos",
    summary: "La app esta comprobando el estado actual.",
    support: "Pulsa Revisar para actualizar la informacion.",
    primary: "Revisar",
    tone: "pending",
  };
}

function bindPushActions() {
  if (btnRefreshPush) btnRefreshPush.onclick = () => updatePushStatusUI();
  if (btnOpenGuide) btnOpenGuide.onclick = () => showNotificationHelpModal();
  if (btnReloadApp) btnReloadApp.onclick = () => window.location.reload();

  if (btnCleanSw) {
    btnCleanSw.onclick = async () => {
      await cleanupStaleServiceWorkers();
      showToast("Listo", "Hemos limpiado restos antiguos y vuelto a revisar.", "success");
      await updatePushStatusUI();
    };
  }

  if (btnReregisterSw) {
    btnReregisterSw.onclick = async () => {
      const repaired = await registerBestServiceWorkerWithRetry();
      showToast(
        repaired?.ok ? "Listo" : "No ha terminado",
        repaired?.ok ? "La app ha reparado el servicio de avisos." : "Prueba ahora con Recargar o con la guía.",
        repaired?.ok ? "success" : "warning",
      );
      await updatePushStatusUI();
    };
  }

  if (btnReconnectPush) {
    btnReconnectPush.onclick = async () => {
      const okReconnect = await relaunchOneSignal(currentUser?.uid);
      if (!okReconnect && currentUser?.uid) await initPushNotifications(currentUser.uid);
      showToast(
        okReconnect ? "Conectado" : "Todavía no del todo",
        okReconnect ? "La conexión de avisos se ha reiniciado correctamente." : "Puede que aún falte permiso o una recarga.",
        okReconnect ? "success" : "warning",
      );
      await updatePushStatusUI();
    };
  }
}

function cleanBrokenText(value = "") {
  return String(value || "")
    .replaceAll("Ã¡", "á")
    .replaceAll("Ã©", "é")
    .replaceAll("Ã­", "í")
    .replaceAll("Ã³", "ó")
    .replaceAll("Ãº", "ú")
    .replaceAll("Ã±", "ñ")
    .replaceAll("Ã“", "Ó")
    .replaceAll("Ã‰", "É")
    .replaceAll("Ã", "Í")
    .replaceAll("Ãš", "Ú")
    .replaceAll("Ã‘", "Ñ")
    .replaceAll("Â·", "·")
    .replaceAll("Â¿", "¿");
}

async function updatePushStatusUI() {
  try {
    const human = await getPushStatusHuman();
    const status = await checkNotificationStatus();
    const baseFriendly = buildFriendlyState(status);
    const friendly = {
      title: cleanBrokenText(baseFriendly.title),
      summary: cleanBrokenText(baseFriendly.summary),
      support: cleanBrokenText(baseFriendly.support),
      primary: cleanBrokenText(baseFriendly.primary),
      tone: baseFriendly.tone,
    };
    const pushStatusExplanation = document.getElementById("push-status-explanation");
    const supportTitle = document.getElementById("push-support-title");
    const supportCopy = document.getElementById("push-support-copy");
    const guide = document.getElementById("perm-platform-guide");

    globalPushStatusText.textContent = status.backgroundReady ? "AVISOS ACTIVOS" : human.title.toUpperCase();
    if (pushStatusExplanation) pushStatusExplanation.textContent = friendly.summary;
    if (supportTitle) supportTitle.textContent = friendly.title;
    if (supportCopy) supportCopy.textContent = friendly.support;
    if (guide) guide.textContent = friendly.support;
    if (permStatusText) permStatusText.textContent = friendly.title;
    if (btnRequestPush) btnRequestPush.textContent = friendly.primary;
    const permTitle = document.getElementById("perm-title");
    if (permTitle) permTitle.textContent = friendly.title;

    permissionArea.classList.remove("state-active", "state-default", "state-blocked");
    permissionArea.classList.add(
      friendly.tone === "ok" ? "state-active" : friendly.tone === "blocked" ? "state-blocked" : "state-default",
    );
    setHeroState(status.backgroundReady);

    window.requestAnimationFrame(() => {
      ["push-permission-pill", "push-background-pill", "push-channel-pill"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = cleanBrokenText(el.textContent);
      });
    });

    tagText("push-permission-pill", `Permiso: ${status.permission === "granted" ? "activo" : status.permission === "denied" ? "bloqueado" : "pendiente"}`);
    tagText("push-background-pill", `Segundo plano: ${status.backgroundReady ? "si" : "aun no"}`);
    tagText("push-channel-pill", `Conexion: ${status.oneSignalRegistered ? "lista" : "revisar"}`);

    btnRequestPush.onclick = async () => {
      if (status.permission === "denied") {
        document.getElementById("notif-denied-guide")?.classList.remove("hidden");
        return;
      }
      const granted = await requestNotificationPermission(true);
      if (granted && currentUser?.uid) await initPushNotifications(currentUser.uid);
      await updatePushStatusUI();
    };

    const btnTestPush = document.getElementById("btn-test-push");
    if (btnTestPush) {
      btnTestPush.onclick = async () => {
        await sendPushNotification(
          "Prueba completada",
          "Tus avisos parecen estar funcionando correctamente.",
          "https://ui-avatars.com/api/?name=P&background=00d4ff&color=fff",
        );
        showToast("Prueba enviada", "Si no la ves, abre la ayuda de esta misma pantalla.", "info");
      };
    }
  } catch (e) {
    console.warn("Push update UI fail:", e);
  }
}

setInterval(updatePushStatusUI, 30000);
