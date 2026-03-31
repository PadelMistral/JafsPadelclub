/* =====================================================
   PADELUMINATIS NOTIFICACIONES JS
   Bandeja + estado simple de avisos
   ===================================================== */

import { auth, db } from "./firebase-service.js";
import {
  collection,
  query,
  where,
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
  sendExternalPush,
} from "./modules/push-notifications.js";
import { toDateSafe } from "./utils/match-utils.js";

let currentUser = null;
let currentUserDoc = null;
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
  const sdk = document.getElementById("push-sdk-pill");
  if (sdk) sdk.textContent = "SDK: ---";
  const action = document.getElementById("push-action-pill");
  if (action) action.textContent = "Siguiente paso: ---";
}

function escapeHtml(raw = "") {
  const div = document.createElement("div");
  div.textContent = String(raw ?? "");
  return div.innerHTML;
}

function confirmNotificationsAction({
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
          <h3 class="modal-title">${escapeHtml(title)}</h3>
          <button class="close-btn" type="button">&times;</button>
        </div>
        <div class="modal-body">
          <p class="text-[11px] text-white/75 leading-relaxed">${escapeHtml(message)}</p>
          <div class="flex-row gap-2 mt-4">
            <button type="button" class="btn btn-ghost w-full" data-notif-cancel>Cancelar</button>
            <button type="button" class="btn w-full ${danger ? "btn-danger" : "btn-primary"}" data-notif-ok>${escapeHtml(confirmLabel)}</button>
          </div>
        </div>
      </div>
    `;
    const close = (accepted = false) => {
      overlay.remove();
      resolve(Boolean(accepted));
    };
    overlay.querySelector(".close-btn")?.addEventListener("click", () => close(false));
    overlay.querySelector("[data-notif-cancel]")?.addEventListener("click", () => close(false));
    overlay.querySelector("[data-notif-ok]")?.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false);
    });
    document.body.appendChild(overlay);
  });
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
    currentUserDoc = userDoc;
    try {
      applyNotificationPageCopy();
      await injectHeader(userDoc);
      injectNavbar("notificaciones");
      loadNotificationsSafeV2(user.uid);
      setupFilterTabs();
      setupGlobalActions();
      bindPushActions();
      window.showNotificationHelpModal = showNotificationHelpModal;
      
      // Safety timeout for status check
      const statusTimeout = setTimeout(() => {
        const title = document.getElementById("perm-title");
        if (title && title.textContent.includes("PREPARANDO")) {
           title.textContent = "CONEXIÓN LENTA";
           showToast("Avisos", "La conexión con el servidor de notificaciones está tardando más de lo habitual.", "info");
        }
      }, 8000);

      await updatePushStatusUI();
      clearTimeout(statusTimeout);
    } catch (err) {
      console.error("[Notificaciones] init error:", err);
      showToast("Error", "Error al inicializar la vista de notificaciones", "error");
    }
  },
});


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
        <p>Error al cargar las notificaciones. Revisa tu conexión.</p>
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
  if (!(await confirmNotificationsAction({
    title: "Eliminar aviso",
    message: "Se eliminará esta notificación de tu bandeja.",
    confirmLabel: "Eliminar",
    danger: true,
  }))) return;
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
    if (!(await confirmNotificationsAction({
      title: "Vaciar bandeja",
      message: "Se eliminarán todos los avisos guardados en esta bandeja.",
      confirmLabel: "Vaciar",
      danger: true,
    }))) return;
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

function getRecommendedActionLabel(status = {}) {
  switch (status.recommendedAction) {
    case "request_permission":
      return "Pulsa Activar";
    case "reregister_service_worker":
      return "Pulsa Reparar";
    case "reconnect_onesignal":
      return "Pulsa Reconectar";
    case "review_browser_settings":
      return "Abre la guia";
    default:
      return status.backgroundReady ? "Todo correcto" : "Revisar estado";
  }
}

function buildFriendlyState(status) {
  if (status.permission === "denied") {
    return {
      title: "Tus avisos están bloqueados",
      summary: "El navegador o el móvil tiene los avisos bloqueados para esta app.",
      support: "Abre la guía, desbloquéalos y vuelve a entrar. Si usas móvil, conviene tener la PWA instalada.",
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
      summary: "Solo falta aceptar el permiso del navegador para este dispositivo.",
      support: "Pulsa Activar y despues toca Permitir. En iPhone o Android conviene instalar primero la app.",
      primary: "Activar",
      tone: "pending",
    };
  }
  if (!status.swActive) {
    return {
      title: "Instala la app PWA",
      summary: "Para recibir avisos con la app cerrada necesitas tener la PWA instalada en el movil o navegador.",
      support: "Instalala desde el boton fijo de la app y vuelve luego aqui para activar los avisos.",
      primary: "Instalar app",
      tone: "pending",
    };
  }
  if (!status.oneSignalRegistered) {
    return {
      title: "Conectando avisos...",
      summary: "El sistema todavia esta preparando tu canal de notificaciones.",
      support: "Si tarda mucho, pulsa Reconectar debajo.",
      primary: "Reconectar",
      tone: "pending",
    };
  }
  return {
    title: "Sincronizando...",
    summary: "Se esta comprobando tu estado de conexion con el servidor.",
    support: "Casi listo. Pulsa Revisar para forzar actualizacion.",
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
      ["push-permission-pill", "push-background-pill", "push-channel-pill", "push-sdk-pill", "push-action-pill"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = cleanBrokenText(el.textContent);
      });
    });

    tagText("push-permission-pill", `Permiso: ${status.permission === "granted" ? "activo" : status.permission === "denied" ? "bloqueado" : "pendiente"}`);
    tagText("push-background-pill", `Segundo plano: ${status.backgroundReady ? "si" : "aun no"}`);
    tagText("push-channel-pill", `Canal: ${status.oneSignalRegistered ? "listo" : "pendiente"}`);
    tagText("push-sdk-pill", `SDK: ${status.oneSignalInitialized ? "activo" : status.oneSignalAvailable ? "cargando" : "no listo"}`);
    tagText("push-action-pill", `Siguiente paso: ${getRecommendedActionLabel(status)}`);

    btnRequestPush.onclick = async () => {
      if (status.permission === "denied" || status.recommendedAction === "review_browser_settings") {
        showNotificationHelpModal();
        document.getElementById("notif-denied-guide")?.classList.remove("hidden");
        return;
      }
      if (!status.swActive) {
        showToast("Instalar app", "Instala primero la PWA y luego vuelve a activar los avisos.", "info");
        return;
      }
      if (status.recommendedAction === "reregister_service_worker") {
        await registerBestServiceWorkerWithRetry();
        await updatePushStatusUI();
        return;
      }
      if (status.recommendedAction === "reconnect_onesignal") {
        await relaunchOneSignal(currentUser?.uid);
        if (currentUser?.uid) await initPushNotifications(currentUser.uid);
        await updatePushStatusUI();
        return;
      }
      const granted = await requestNotificationPermission(true);
      if (granted && currentUser?.uid) await initPushNotifications(currentUser.uid);
      await updatePushStatusUI();
    };

    const btnTestPush = document.getElementById("btn-test-push");
    const isAdmin = currentUserDoc?.rol === "Admin";

    if (btnTestPush) {
      btnTestPush.style.display = "flex";
      btnTestPush.onclick = async () => {
        console.group("[Push Test] Click en boton de prueba");
        console.log("[Push Test] currentUser:", currentUser);
        console.log("[Push Test] currentUserDoc:", currentUserDoc);
        console.log("[Push Test] isAdmin:", isAdmin);
        if (!currentUser?.uid) {
          console.warn("[Push Test] Abortado: currentUser.uid no disponible");
          showToast("Sesión no lista", "Espera un momento e intenta de nuevo.", "warning");
          console.groupEnd();
          return;
        }

        // 1. Prueba Local (App abierta)
        console.log("[Push Test] Enviando notificacion local...");
        const localPushResult = await sendPushNotification(
          isAdmin ? "PRUEBA LOCAL (ADMIN)" : "PRUEBA LOCAL",
          "Esta notificación confirma que el permiso del navegador funciona correctamente.",
          "https://ui-avatars.com/api/?name=P&background=00d4ff&color=fff",
        );
        console.log("[Push Test] Resultado notificacion local:", localPushResult);
        
        // 2. Prueba Externa (Segundo Plano / OneSignal)
        console.log("[Push Test] Programando push externa en 3000ms para UID:", currentUser.uid);
        showToast("Lanzando prueba real...", "En 3 segundos recibirás el aviso de segundo plano.", "info");
        
        setTimeout(async () => {
           console.group("[Push Test] Timeout push externa");
           try {
             const payload = {
               title: isAdmin ? "PRUEBA REAL (ADMIN)" : "PRUEBA SEGUNDO PLANO",
               message: "Excelente. Si ves esto con la app cerrada o el móvil bloqueado, todo está bien conectado.",
               uids: [currentUser.uid],
               url: "notificaciones.html",
                data: { type: "test", from: "diag_btn" }
             };
             console.log("[Push Test] Payload push externa:", payload);
             const externalPushResult = await sendExternalPush(payload);
             console.log("[Push Test] Resultado sendExternalPush:", externalPushResult);
           } catch (e) {
             console.error("External push test failed", e);
           } finally {
             console.groupEnd();
           }
        }, 3000);
        console.groupEnd();
      };
    }
  } catch (e) {
    console.warn("Push update UI fail:", e);
  }
}

setInterval(updatePushStatusUI, 30000);
