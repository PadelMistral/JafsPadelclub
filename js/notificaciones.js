/* =====================================================
   PADELUMINATIS NOTIFICATIONS LOGIC V9.0
   Inbox + unified Browser/SW/OneSignal health center
   ===================================================== */

import { observerAuth, subscribeCol, updateDocument, db } from "./firebase-service.js";
import { deleteDoc, doc, writeBatch } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI, showToast } from "./ui-core.js";
import { analyticsCount, analyticsSetFlag } from "./core/analytics.js";
import { logError } from "./core/app-logger.js";
import {
  initPushNotifications,
  relaunchOneSignal,
  requestNotificationPermission,
  checkNotificationStatus,
  showNotificationHelpModal,
} from "./modules/push-notifications.js";
import { getAppBase } from "./modules/path-utils.js";

let currentUser = null;
let allNotifs = [];
let currentFilter = "all";
let notifUnsub = null;
let notifBootUid = null;
let trackedPermissionState = null;

document.addEventListener("DOMContentLoaded", () => {
  initAppUI("notifications");
  bindInboxActions();
  window.showPushHelpGuide = async () => {
    const status = await checkNotificationStatus();
    showNotificationHelpModal(status);
  };
  
  // Simplificado: Solo escuchamos la bandeja de entrada y el permiso básico

  observerAuth(async (user) => {
    if (!user) {
      if (notifUnsub) {
        try { notifUnsub(); } catch (_) {}
        notifUnsub = null;
      }
      notifBootUid = null;
      window.location.href = "index.html";
      return;
    }

    if (notifBootUid === user.uid) return;
    notifBootUid = user.uid;
    currentUser = user;

    if (notifUnsub) {
      try { notifUnsub(); } catch (_) {}
      notifUnsub = null;
    }

    const unsub = await subscribeCol(
      "notificaciones",
      (list) => {
        allNotifs = list.sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0));
        renderList();
      },
      [["destinatario", "==", user.uid]],
    );
    notifUnsub = typeof unsub === "function" ? unsub : null;

    await initPushNotifications(user.uid).catch(() => false);
    refreshNotificationState();
  });
});

async function refreshNotificationState() {
  const status = await checkNotificationStatus().catch(() => null);
  if (!status) return;
  renderPermissionState(status);
}

function bindInboxActions() {
  document.getElementById("btn-read-all")?.addEventListener("click", markAllAsRead);
  document.getElementById("btn-clear-all")?.addEventListener("click", clearAllNotifications);
  document.getElementById("btn-request-push")?.addEventListener("click", handleRequestPushClick);
  document.querySelectorAll(".notif-tabs-v8 .filter-tab-v8").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentFilter = btn.dataset.filter || "all";
      document.querySelectorAll(".notif-tabs-v8 .filter-tab-v8").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderList();
    });
  });
}

async function handleRequestPushClick() {
  const btn = document.getElementById("btn-request-push");
  if (btn) btn.disabled = true;

  try {
    const health = await checkNotificationStatus().catch(() => null);
    
    // Si ya está funcionando
    if (health?.backgroundReady) {
      showToast("Correcto", "Tus notificaciones están activas.", "success");
      return;
    }

    // Si está bloqueado por el navegador
    if (health?.permission === "denied") {
      const modal = document.getElementById('notif-denied-guide');
      if (modal) {
        modal.classList.remove('hidden');
        modal.classList.add('active'); // show overlay
      }
      openBrowserNotificationSettings();
      showToast("Bloqueado", "Habilita el permiso en los ajustes del candado arriba.", "warning");
      return;
    }

    showToast("Sincronizando", "Vinculando con OneSignal. Espera...", "info");
    
    // Forzamos el reinicio de OneSignal para limpiar estados corruptos
    const ok = await relaunchOneSignal(currentUser?.uid);
    
    // Esperamos un poco a que el SDK asiente el estado
    await new Promise(r => setTimeout(r, 1500));
    const finalHealth = await checkNotificationStatus().catch(() => null);

    if (finalHealth?.backgroundReady) {
      showToast("¡Éxito!", "Notificaciones configuradas correctamente.", "success");
    } else if (finalHealth?.issues?.includes("onesignal_not_subscribed")) {
      showToast("Pendiente", "El navegador aún no ha confirmado la suscripción. Prueba a actualizar la página.", "warning");
    } else {
      showToast("Aviso", "Estado parcial. Revisa la guía inferior.", "info");
    }
    
    refreshNotificationState();
  } catch (e) {
    console.warn("UI refresh push failed:", e);
    showToast("Error", "Fallo al sincronizar. Reintenta en unos segundos.", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}




function updateTile(id, text, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.classList.remove("ok", "warn", "error");
  if (state === "granted" || state === true) el.classList.add("ok");
  else if (state === "denied" || state === false) el.classList.add("error");
  else el.classList.add("warn");
}

async function handleEnableNotifications() {
  analyticsCount("notifications.retry_attempt", 1);
  showToast("Notificaciones", "Intentando reactivar...", "info");
  const currentStatus = await checkNotificationStatus().catch(() => null);
  if (currentStatus?.backgroundReady) {
    await refreshNotificationHealth();
    showToast("Correcto", "Las notificaciones ya estan activas.", "success");
    return;
  }
  if (currentStatus?.permission === "denied") {
    openBrowserNotificationSettings();
    showToast("Bloqueado", "Debes habilitar permisos desde ajustes del navegador.", "warning");
    await refreshNotificationHealth();
    return;
  }

  const granted = await requestNotificationPermission(false);
  if (!granted) {
    const status = await checkNotificationStatus().catch(() => null);
    if (status?.permission === "denied") openBrowserNotificationSettings();
    showToast("Bloqueado", "Revisa permisos del navegador", "error");
    return;
  }
  await initPushNotifications(currentUser?.uid);
  await refreshNotificationHealth();
  showToast("Activo", "Notificaciones habilitadas", "success");
}

async function reconnectOneSignal() {
  await handleRequestPushClick();
}

async function forceReregisterServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  showToast("Worker", "Re-registrando SW...", "info");

  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  const regResult = await registerAppShellServiceWorker();
  if (!regResult.ok) {
    showToast("Error", "No se pudo re-registrar SW", "error");
    return;
  }

  await initPushNotifications(currentUser?.uid).catch(() => false);
  await refreshNotificationState(); // Changed from refreshNotificationHealth
  showToast("Listo", "SW re-registrado correctamente", "success");
}

async function registerAppShellServiceWorker() {
  try {
    const base = getAppBase();
    const cfg = { swPath: `${base}sw.js`, scope: base };
    
    try {
        const reg = await navigator.serviceWorker.register(cfg.swPath, {
          scope: cfg.scope,
          updateViaCache: "none",
        });
        return { ok: true, reg };
    } catch (_) {
        return { ok: false };
    }
  } catch (_) {
    return { ok: false };
  }
}

async function hardResetNotifications() {
  if (!confirm("Se limpiará caché local y Service Worker. ¿Continuar?")) return;
  analyticsSetFlag("notifications.permission", false);
  analyticsCount("notifications.hard_reset", 1);
  localStorage.clear();
  sessionStorage.clear();
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((r) => r.unregister()));
  window.location.reload();
}

function openBrowserNotificationSettings() {
  const ua = navigator.userAgent || "";
  if (/Edg\//.test(ua)) {
    window.open("edge://settings/content/notifications", "_blank");
    return;
  }
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) {
    window.open("chrome://settings/content/notifications", "_blank");
    return;
  }
  if (/Firefox\//.test(ua)) {
    window.open("about:preferences#privacy", "_blank");
    return;
  }
  showToast("Permisos", "Abre ajustes del navegador y permite notificaciones para este sitio.", "warning");
}

function getPlatformGuide(health) {
  const isIOS = health?.platform?.isIOS;
  const isSafari = health?.platform?.isSafari;
  const ua = navigator.userAgent || "";
  const isAndroid = /Android/i.test(ua);
  const isChrome = /Chrome\//.test(ua) && !/Edg\//.test(ua);
  const isDesktop = !isIOS && !isAndroid;

  if (health.permission === "denied") {
    if (isIOS && isSafari) {
      return "iOS Safari: Ajustes del sitio > Notificaciones > Permitir. Si es PWA, revisa permiso desde Safari.";
    }
    if (isAndroid && isChrome) {
      return "Android Chrome: candado en la barra URL > Permisos > Notificaciones > Permitir.";
    }
    if (isDesktop) {
      return "Desktop: pulsa el icono del candado en la barra de direcciones > Notificaciones > Permitir, y recarga la página.";
    }
    return "Permiso bloqueado. Abre ajustes del navegador y habilita notificaciones para este sitio.";
  }

  if (health.permission === "default") {
    return "Permiso pendiente. Pulsa el botón de arriba para solicitar acceso.";
  }
  if (health.backgroundReady) return "Push en segundo plano activo y sincronizado.";
  return "Configuración pendiente. Pulsa el botón para sincronizar con OneSignal.";
}

function renderPermissionState(health) {
  const card = document.getElementById("permission-area");
  const text = document.getElementById("perm-status-text");
  const guide = document.getElementById("perm-platform-guide");
  const btn = document.getElementById("btn-request-push");
  
  const banner = document.getElementById("push-status-banner");
  const bannerText = document.getElementById("global-push-status");

  if (card && text && guide && btn) {
    card.classList.remove("state-active", "state-default", "state-blocked");
    if (health.backgroundReady) {
      card.classList.add("state-active");
      text.textContent = "Estado: Sincronizado y Activo.";
      btn.textContent = "ESTADO OK";
      btn.disabled = true;
      btn.style.opacity = "0.5";
      // User request: hide if active
      card.style.display = "none"; 
      // Also hide reactivate box if active
      const reactivateBox = document.getElementById("denied-help-box");
      if (reactivateBox) reactivateBox.classList.add("hidden");
    } else if (health.permission === "denied") {
      card.style.display = "flex";
      card.classList.add("state-blocked");
      text.textContent = "Estado: Notificaciones silenciadas.";
      btn.textContent = "DESBLOQUEAR";
      btn.disabled = false;
      btn.style.opacity = "1";
    } else {
      card.style.display = "flex";
      card.classList.add("state-default");
      text.textContent = "Estado: Pendiente de activación.";
      btn.textContent = "ACTIVAR AHORA";
      btn.disabled = false;
      btn.style.opacity = "1";
    }
    guide.textContent = getPlatformGuide(health);
  }

  if (banner && bannerText) {
    banner.classList.remove("ok", "warn", "error");
    if (health.backgroundReady) {
      banner.classList.add("ok");
      bannerText.textContent = "CONFIGURACIÓN CORRECTA";
    } else if (health.permission === "denied") {
      banner.classList.add("error");
      bannerText.textContent = "BLOQUEADO POR NAVEGADOR";
    } else if (health.issues && health.issues.includes("onesignal_not_subscribed")) {
      banner.classList.add("warn");
      bannerText.textContent = "PENDIENTE DE REGISTRO";
    } else {
      banner.classList.add("warn");
      bannerText.textContent = "PENDIENTE DE ACTIVACIÓN";
    }
  }
}

function trackPermissionAdoption(health) {
  const state = String(health?.permission || "unknown");
  if (trackedPermissionState === state) return;
  trackedPermissionState = state;
  if (state === "granted") analyticsCount("notifications.permission_granted_state", 1);
  if (state === "denied") analyticsCount("notifications.permission_denied_state", 1);
}

async function markAllAsRead() {
  if (!currentUser || allNotifs.length === 0) return;
  const unread = allNotifs.filter((n) => !n.read && !n.leido);
  if (unread.length === 0) return;

  const batch = writeBatch(db);
  unread.forEach((n) => {
    batch.update(doc(db, "notificaciones", n.id), { read: true, leido: true });
  });
  await batch.commit();
  showToast("Bandeja", "Todo marcado como leído", "success");
}

async function clearAllNotifications() {
  if (!confirm("¿Vaciar toda la bandeja permanentemente?")) return;
  const batch = writeBatch(db);
  allNotifs.forEach((n) => {
    batch.delete(doc(db, "notificaciones", n.id));
  });
  await batch.commit();
  showToast("Bandeja", "Historial eliminado", "info");
}

function renderList() {
  const container = document.getElementById("notif-list");
  if (!container) return;

  const list = allNotifs.filter((n) => {
    const isUnread = !n.read && !n.leido;
    if (currentFilter === "unread") return isUnread;
    if (currentFilter === "read") return !isUnread;
    return true;
  });

  if (list.length === 0) {
    container.innerHTML = `
      <div class="flex-col items-center py-20 opacity-30 text-center">
        <i class="fas fa-ghost text-5xl mb-4"></i>
        <h4 class="font-black italic tracking-widest text-sm">BANDEJA VACIA</h4>
        <p class="text-[10px] font-bold">Sin alertas en este sector.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map((n) => {
    const isUnread = !n.read && !n.leido;
    const date = n.timestamp?.toDate?.() || new Date();
    const icon = getIcon(n.tipo);
    return `
      <div class="notif-item-v7 ${isUnread ? "unread" : ""}" onclick="window.handleNotifClick('${n.id}', '${n.enlace || ""}')">
        <div class="notif-icon-v7 ${icon.type}">
          <i class="fas ${icon.fa}"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="notif-title-row">
            <span class="notif-title uppercase">${n.titulo || "ALERTA"}</span>
            <span class="notif-time">${date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
          </div>
          <p class="notif-msg line-clamp-2">${n.mensaje || ""}</p>
          <div class="notif-actions-row">
            <button class="notif-btn-s primary">ABRIR</button>
            <button class="notif-btn-s outline" onclick="event.stopPropagation(); window.deleteNotif('${n.id}')">BORRAR</button>
          </div>
        </div>
        ${isUnread ? '<div class="unread-dot"></div>' : ''}
      </div>
    `;
  }).join("");
}

function getIcon(type) {
  if (type?.includes("match") || type?.includes("pista")) return { fa: "fa-tennis-ball", type: "type-match" };
  if (type?.includes("reto") || type?.includes("rival")) return { fa: "fa-bolt", type: "type-challenge" };
  return { fa: "fa-microchip", type: "type-system" };
}

window.handleNotifClick = async (id, link) => {
  await updateDocument("notificaciones", id, { read: true, leido: true });
  if (link) window.location.href = link;
  else renderList();
};

window.deleteNotif = async (id) => {
  if (!confirm("¿Borrar alerta?")) return;
  await deleteDoc(doc(db, "notificaciones", id));
  showToast("Borrado", "Alerta eliminada", "info");
};

// GUI COMPLETA MODAL
window.showPushHelpGuide = () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.zIndex = '15000';
    overlay.innerHTML = `
        <div class="modal-card glass-strong animate-up" style="max-width:400px; padding:0; overflow:hidden; border-radius: 24px !important;">
            <div class="p-6 border-b border-white-05 flex items-center justify-between bg-white/02">
                <h3 class="text-sm font-black italic tracking-widest text-primary uppercase">Guía de Notificaciones</h3>
                <button class="text-white/40 hover:text-white" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body custom-scroll p-6" style="max-height: 70vh;">
                <div class="flex-col gap-6">
                    <div class="help-step">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="w-6 h-6 rounded-lg bg-primary/20 text-primary flex items-center justify-center text-xs font-black">1</span>
                            <h4 class="text-xs font-black uppercase text-white">Activar Permisos</h4>
                        </div>
                        <p class="text-[11px] text-white/50 leading-relaxed pl-9">Pulsa el botón "Sincronizar Dispositivo" en la parte superior. Si el navegador pregunta, selecciona "Permitir".</p>
                    </div>
                    
                    <div class="help-step">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="w-6 h-6 rounded-lg bg-primary/20 text-primary flex items-center justify-center text-xs font-black">2</span>
                            <h4 class="text-xs font-black uppercase text-white">Añadir a Inicio (iOS)</h4>
                        </div>
                        <p class="text-[11px] text-white/50 leading-relaxed pl-9">En iPhone, pulsa el botón compartir <i class="fas fa-arrow-up-from-bracket mx-1 text-primary"></i> y elige "Añadir a pantalla de inicio". Las notificaciones solo funcionan desde el icono del escritorio.</p>
                    </div>

                    <div class="help-step">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="w-6 h-6 rounded-lg bg-secondary/20 text-secondary flex items-center justify-center text-xs font-black">3</span>
                            <h4 class="text-xs font-black uppercase text-white">Desbloquear Bloqueo</h4>
                        </div>
                        <p class="text-[11px] text-white/50 leading-relaxed pl-9">Si denegaste el permiso por error, pulsa el icono del candado en la barra de direcciones <i class="fas fa-lock mx-1"></i> y restablece los permisos de Notificaciones.</p>
                    </div>

                    <div class="bg-primary/05 border border-primary/10 rounded-2xl p-4 mt-2">
                        <div class="flex items-start gap-3">
                            <i class="fas fa-bolt text-primary mt-1"></i>
                            <div class="flex-col gap-1">
                                <span class="text-[10px] font-black text-primary uppercase">Pro Tip</span>
                                <p class="text-[10px] text-white/60">Si nada funciona, usa el botón "Diagnóstico de Red" en esta página.</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="p-5 border-t border-white-05 text-center">
                <button class="btn btn-primary w-full py-3 uppercase text-[10px] font-black" onclick="this.closest('.modal-overlay').remove()">ENTENDIDO</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
};
