/* js/modules/push-notifications.js - OneSignal Push Channel */
import { showToast } from "../ui-core.js";
import { auth, db } from "../firebase-service.js";
import { analyticsCount, analyticsSetFlag, analyticsTiming } from "../core/analytics.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

import { getAppBase, getFullUrl } from "./path-utils.js";

const DEFAULT_ICON = "https://ui-avatars.com/api/?name=P&background=00d4ff&color=fff";
const ONESIGNAL_SDK_SRC =
  "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
const ONESIGNAL_APP_ID_STORAGE_KEY = "onesignal_app_id";
const DEVICE_ID_STORAGE_KEY = "onesignal_device_id";
const DEFAULT_ONESIGNAL_APP_ID = "0f270864-c893-4c44-95cc-393321937fb2";
const PUSH_DIAG_LOG_KEY = "push_diag_log_v1";
const PUSH_DIAG_STATE_KEY = "push_diag_state_v1";
const PUSH_DIAG_MAX = 120;
const SW_RETRY_ATTEMPTS = 4;
const SW_RETRY_BASE_MS = 350;

let notifPermission =
  typeof Notification !== "undefined" ? Notification.permission : "default";

// Proactive permission tracking
if (typeof navigator !== "undefined" && navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: "notifications" }).then((perm) => {
        perm.onchange = () => {
            notifPermission = Notification.permission;
            pushLog("info", "permission_changed_proactive", { permission: notifPermission });
            persistNotifPermissionFlag(notifPermission);
        };
    }).catch(() => {});
}

let oneSignalReady = false;
let oneSignalInitPromise = null;
let lastOneSignalLoginUid = null;
let oneSignalScriptURL = null; // prevent undefined reference
const pushInitByUid = new Map();

function pushLog(level, event, meta = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    meta: meta || {},
  };
  try {
    const prev = JSON.parse(localStorage.getItem(PUSH_DIAG_LOG_KEY) || "[]");
    prev.push(entry);
    if (prev.length > PUSH_DIAG_MAX) prev.splice(0, prev.length - PUSH_DIAG_MAX);
    localStorage.setItem(PUSH_DIAG_LOG_KEY, JSON.stringify(prev));
  } catch (_) {}
  if (level === "error") console.error("[PUSH]", event, meta);
  else if (level === "warn") console.warn("[PUSH]", event, meta);
}

function persistPushState(state = {}) {
  try {
    localStorage.setItem(
      PUSH_DIAG_STATE_KEY,
      JSON.stringify({
        ...state,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch (_) {}
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function persistNotifPermissionFlag(state) {
  try {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const ref = doc(db, "usuarios", uid);
    await setDoc(
      ref,
      {
        notifPermission: state,
        notifPermissionUpdatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (e) {
    pushLog("warn", "notif_permission_persist_failed", {
      error: e?.message || String(e),
    });
  }
}

async function retryWithBackoff(task, { attempts = SW_RETRY_ATTEMPTS, baseMs = SW_RETRY_BASE_MS } = {}) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await task(i + 1);
    } catch (e) {
      lastError = e;
      if (i >= attempts - 1) break;
      const delay = Math.min(baseMs * Math.pow(2, i), 5000) + Math.floor(Math.random() * 120);
      await wait(delay);
    }
  }
  throw lastError || new Error("retry-failed");
}

function uniqueBy(arr, keyFn) {
  const seen = new Set();
  return arr.filter((x) => {
    const key = keyFn(x);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getWorkerCandidates() {
  const base = getAppBase();
  pushLog("info", "detecting_app_base", { base, pathname: window.location.pathname });

  const candidates = [
    {
      base,
      swPath: "./sw.js",
      updaterPath: "./sw.js",
      scope: "./",
    },
    {
      base,
      swPath: getFullUrl("sw.js"),
      updaterPath: getFullUrl("sw.js"),
      scope: base,
    },
    {
      base,
      swPath: "sw.js",
      updaterPath: "sw.js",
      scope: "/",
    },
  ];

  return uniqueBy(candidates, (cfg) => `${cfg.swPath}|${cfg.scope}`);
}

async function filterReachableWorkerCandidates(candidates = []) {
  const currentDir = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}`;
  return candidates
    .slice()
    .sort((a, b) => {
      const aScore = String(a?.swPath || "").startsWith(currentDir) || String(a?.swPath || "").startsWith("./") ? 1 : 0;
      const bScore = String(b?.swPath || "").startsWith(currentDir) || String(b?.swPath || "").startsWith("./") ? 1 : 0;
      return bScore - aScore;
    });
}

async function getServiceWorkerDiagnostics() {
  if (!("serviceWorker" in navigator)) {
    return { regs: [], appShell: null, oneSignal: null, conflict: false };
  }
  const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
  const appShell =
    regs.find((r) => String(r?.active?.scriptURL || r?.installing?.scriptURL || "").includes("/sw.js")) || null;
  // Now they are unified
  const oneSignal = appShell;

  const appScope = appShell?.scope || null;
  const oneSignalScope = oneSignal?.scope || null;
  const conflict = false; // Unified worker so no scope conflicts
  return { regs, appShell, oneSignal, conflict };
}

export async function registerBestServiceWorkerWithRetry(customCandidates = null) {
  if (!("serviceWorker" in navigator)) {
    return { ok: false, reason: "sw_unsupported" };
  }
  
  if (window.__swRegisteredByCore || window.__swRegisterBound) {
    pushLog("info", "sw_register_skipped_already_bound");
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) return { ok: true, reg };
  }

  const candidates = customCandidates || getWorkerCandidates();
  const swDiag = await getServiceWorkerDiagnostics();
  const appScope = swDiag?.appShell?.scope || null;
  let lastError = null;
  for (const cfg of candidates) {
    const targetScope = cfg.scope || cfg.swScope || "/";
    if (appScope && targetScope === appScope) {
      pushLog("warn", "sw_register_scope_conflict_skip", { targetScope, appScope, swPath: cfg.swPath });
      continue;
    }
    try {
      const reg = await retryWithBackoff(
        () =>
          navigator.serviceWorker.register(cfg.swPath, {
            scope: cfg.scope || cfg.swScope || "/",
            updateViaCache: "none",
          }),
        { attempts: SW_RETRY_ATTEMPTS, baseMs: SW_RETRY_BASE_MS },
      );
      pushLog("info", "sw_register_ok", { swPath: cfg.swPath, scope: cfg.scope || cfg.swScope || "/" });
      persistPushState({ sw: { ok: true, scope: reg?.scope || null, path: cfg.swPath } });
      return { ok: true, reg, cfg };
    } catch (e) {
      lastError = e;
      pushLog("warn", "sw_register_candidate_fail", { swPath: cfg.swPath, error: e?.message || String(e) });
    }
  }
  pushLog("error", "sw_register_failed", { error: lastError?.message || String(lastError) });
  persistPushState({ sw: { ok: false, error: lastError?.message || "sw_register_failed" } });
  return { ok: false, reason: "sw_register_failed", error: lastError?.message || String(lastError) };
}

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!id) {
    id = `dev_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
  }
  return id;
}

function getConfiguredOneSignalAppId() {
  const fromWindow =
    typeof window !== "undefined" ? window.__ONESIGNAL_APP_ID : null;
  const fromStorage = localStorage.getItem(ONESIGNAL_APP_ID_STORAGE_KEY);
  return (fromWindow || fromStorage || DEFAULT_ONESIGNAL_APP_ID).trim();
}

async function ensureOneSignalScript() {
  if (window.OneSignal && window.OneSignalDeferred) return true;
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[src=\"${ONESIGNAL_SDK_SRC}\"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("onesignal-sdk-load-failed")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = ONESIGNAL_SDK_SRC;
    script.defer = true;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error("onesignal-sdk-load-failed"));
    document.head.appendChild(script);
  });
}

function oneSignalExec(fn) {
  window.OneSignalDeferred = window.OneSignalDeferred || [];
  return new Promise((resolve, reject) => {
    window.OneSignalDeferred.push(async (OneSignal) => {
      try {
        const out = await fn(OneSignal);
        resolve(out);
      } catch (e) {
        reject(e);
      }
    });
  });
}

function safeGetSubscription(OneSignal) {
  try {
    const user = OneSignal?.User;
    if (!user || typeof user !== "object") return { id: null, token: null, optedIn: false };
    const sub = user?.PushSubscription;
    if (!sub || typeof sub !== "object") return { id: null, token: null, optedIn: false };
    
    // Legacy support for some SDK versions where sub.id might be sub.playerId
    const subId = sub.id || sub.playerId || null;
    const isOptedIn = Boolean(sub.optedIn);
    
    return {
      id: subId,
      token: sub.token ?? null,
      optedIn: isOptedIn,
    };
  } catch (err) {
    console.warn("⚠️ Error accessing OneSignal subscription details:", err);
    return { id: null, token: null, optedIn: false };
  }
}

async function ensureOneSignalInitialized() {
  if (oneSignalReady) return true;
  if (oneSignalInitPromise) return oneSignalInitPromise;

  oneSignalInitPromise = (async () => {
    const appId = getConfiguredOneSignalAppId();
    if (!appId) {
      if (!window.__oneSignalAppIdWarned) {
        window.__oneSignalAppIdWarned = true;
        showToast(
          "Push pendiente",
          "Falta configurar el OneSignal App ID para activar push en segundo plano.",
          "warning",
        );
      }
      return false;
    }

    await ensureOneSignalScript();

    // 1. Cleanup stale workers first
    await cleanupStaleServiceWorkers();

    const candidates = await filterReachableWorkerCandidates(getWorkerCandidates());
    const swDiag = await getServiceWorkerDiagnostics();
    const appScope = swDiag?.appShell?.scope || null;
    let initOk = false;
    let lastError = null;

    for (const cfg of candidates) {
      try {
        await retryWithBackoff(async () => {
          await oneSignalExec(async (OneSignal) => {
            await OneSignal.init({
              appId: appId,
              safari_web_id: "web.onesignal.auto.10a9c80d-13fc-463d-9d41-3838ae45a6c3",
              notifyButton: { enable: false },
              serviceWorkerParam: { scope: cfg.scope },
              serviceWorkerPath: cfg.swPath,
              serviceWorkerUpdaterPath: cfg.updaterPath,
              allowLocalhostAsSecureOrigin: true,
            });

            // Listen for state changes
            if (OneSignal.Notifications && OneSignal.Notifications.addEventListener) {
              OneSignal.Notifications.addEventListener("permissionChange", (permission) => {
                console.log("🔔 [Push Event] Permission Changed:", permission);
                checkNotificationStatus().catch(() => {});
              });
            }
            if (OneSignal.User && OneSignal.User.PushSubscription && OneSignal.User.PushSubscription.addEventListener) {
              OneSignal.User.PushSubscription.addEventListener("change", (change) => {
                console.log("🔔 [Push Event] Subscription Changed:", change);
                checkNotificationStatus().catch(() => {});
              });
            }
          });
        }, { attempts: 3 });

        window.__pushWorkerConfig = cfg;
        pushLog("info", "onesignal_init_ok", { swPath: cfg.swPath, scope: cfg.scope });
        persistPushState({ oneSignal: { initialized: true, swPath: cfg.swPath, scope: cfg.scope } });
        initOk = true;
        break;
      } catch (e) {
        lastError = e;
        const msg = String(e?.message || e || "").toLowerCase();
        if (msg.includes("already initialized")) {
          window.__pushWorkerConfig = cfg;
          pushLog("info", "onesignal_already_initialized_reuse", {
            swPath: cfg.swPath,
            scope: cfg.scope,
          });
          persistPushState({ oneSignal: { initialized: true, reused: true, swPath: cfg.swPath, scope: cfg.scope } });
          initOk = true;
          break;
        }
        pushLog("warn", "onesignal_init_candidate_fail", {
          swPath: cfg.swPath,
          scope: cfg.scope,
          error: e?.message || String(e),
        });
      }
    }

    if (!initOk) {
      persistPushState({ oneSignal: { initialized: false, error: lastError?.message || "onesignal-init-failed" } });
      throw lastError || new Error("onesignal-init-failed");
    }

    oneSignalReady = true;
    return true;
  })();

  try {
    return await oneSignalInitPromise;
  } finally {
    oneSignalInitPromise = null;
  }
}

async function persistDeviceSubscription(uid) {
  if (!uid) return;

  const subscription = await oneSignalExec(async (OneSignal) => safeGetSubscription(OneSignal));

  const deviceId = getDeviceId();
  const ref = doc(db, "usuarios", uid, "devices", deviceId);
  await setDoc(
    ref,
    {
      provider: "onesignal",
      oneSignalPlayerId: subscription.id,
      token: subscription.token || null,
      enabled: !!subscription.id && subscription.optedIn,
      platform: "web",
      userAgent: navigator.userAgent || "unknown",
      updatedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function relaunchOneSignal(uid = null) {
  pushLog("info", "onesignal_relaunch_triggered", { uid });
  lastOneSignalLoginUid = null;
  oneSignalReady = false;
  oneSignalInitPromise = null;
  pushInitByUid.clear();
  return await initPushNotifications(uid);
}

async function safeLoginToOneSignal(userId) {
    if (!userId) return false;
    try {
        await oneSignalExec(async (OneSignal) => {
            if (!OneSignal || typeof OneSignal.login !== "function") {
                pushLog("warn", "onesignal_login_method_missing", { uid: userId });
                return false;
            }
            
            // Login unconditionally so OneSignal links the device to the User ID from the start.
            await OneSignal.login(userId);
            lastOneSignalLoginUid = userId;
            pushLog("info", "onesignal_login_ok_unconditional", { uid: userId });
            
            const subId = OneSignal.User?.PushSubscription?.id || "unknown";
            const optedIn = OneSignal.User?.PushSubscription?.optedIn || false;
            pushLog("info", "onesignal_login_state_post", { sub_id: subId, optedIn });
        });
        return true;
    } catch(e) {
        pushLog("error", "onesignal_safe_login_error", { error: e?.message || String(e) });
        return false;
    }
}

async function getPushSystemState() {
    return {
        permission: typeof Notification !== "undefined" ? Notification.permission : "default",
        initializationReady: await ensureOneSignalInitialized(),
    };
}

async function processPushStateMachine(userId) {
    try {
        const state = await getPushSystemState();
        
        // Estado 3: Permiso concedido
        if (state.permission === "granted") {
            // Ya tenemos el userId como parametro
            
            // Estado 4: Suscrito
            await persistDeviceSubscription(userId);
            
            // Estado 5: Login Ejecutado (Solo si está suscrito y permitido)
            if (userId && lastOneSignalLoginUid !== userId) {
                await safeLoginToOneSignal(userId);
            }
            return true;
        } else if (state.permission === "default") {
            scheduleSoftPrompt();
            return false;
        }
    } catch (e) {
        pushLog("error", "onesignal_subscription_verification_failed", { error: e?.message });
    }
    return false;
}

export async function initPushNotifications(uid = null) {
  if (!("Notification" in window)) return false;

  const userId = uid || auth.currentUser?.uid;
  if (userId && pushInitByUid.has(userId)) return pushInitByUid.get(userId);

  const t0 = performance.now();
  const runInit = (async () => {
      // Estado 1: Asegurarnos de Initialized
      const ok = await ensureOneSignalInitialized();
      if (!ok) return false;
      
      try {
          // Estado 2-5: Permisos, Suscripción y Login Seguro
          await processPushStateMachine(userId);
            
          persistPushState({
              permission: notifPermission,
              oneSignalReady: true,
              uid: userId,
          });
          
          analyticsTiming("notifications.init_ms", performance.now() - t0);
          return true;
      } catch (e) {
          pushLog("error", "onesignal_runtime_error_state_machine", { uid: userId, error: e?.message || String(e) });
          return false;
      }
  })();

  if (userId) pushInitByUid.set(userId, runInit);
  try {
    return await runInit;
  } finally {
    if (userId) pushInitByUid.delete(userId);
  }
}

function scheduleSoftPrompt() {
    if (sessionStorage.getItem('notif_soft_prompt_dismissed')) return;
    if (localStorage.getItem('notif_soft_prompt_completed') === 'true') return;
    
    setTimeout(() => {
        showSoftPrompt().catch(() => {});
    }, 6000); // 6 seconds delay
}

async function showSoftPrompt() {
    notifPermission = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
    if (document.getElementById('notif-soft-prompt')) return;
    if (localStorage.getItem('notif_soft_prompt_completed') === 'true') return;
    if (notifPermission === 'denied' || notifPermission === 'unsupported') return;
    if (notifPermission === 'granted') {
        try {
            const status = await checkNotificationStatus();
            if (status?.backgroundReady || status?.oneSignalRegistered) {
                localStorage.setItem('notif_soft_prompt_completed', 'true');
                document.getElementById('notif-soft-prompt')?.remove();
            }
        } catch (_) {}
        return;
    }
    if (notifPermission !== 'default') return;
    
    const div = document.createElement('div');
    div.id = 'notif-soft-prompt';
    div.className = 'soft-prompt-card animate-up';
    div.style.position = 'fixed';
    div.style.left = '50%';
    div.style.right = 'auto';
    div.style.transform = 'translateX(-50%)';
    div.style.bottom = window.innerWidth <= 640
        ? 'calc(88px + env(safe-area-inset-bottom, 0px))'
        : 'calc(112px + env(safe-area-inset-bottom, 0px))';
    div.style.width = window.innerWidth <= 640 ? 'calc(100vw - 28px)' : 'min(92vw, 430px)';
    div.style.maxWidth = '430px';
    div.style.zIndex = '999999';
    div.innerHTML = `
        <div class="soft-prompt-content">
            <div class="soft-prompt-icon">
                <i class="fas fa-bell"></i>
            </div>
            <div class="soft-prompt-text">
                <h3>Mantente al día</h3>
                <p>Activa las notificaciones para avisos de retos y partidos.</p>
            </div>
        </div>
        <div class="soft-prompt-actions">
            <button class="btn-soft later" id="btn-notif-later">Más tarde</button>
            <button class="btn-soft active" id="btn-notif-activate">Activar</button>
        </div>
    `;
    
    document.body.appendChild(div);
    
    document.getElementById('btn-notif-later').onclick = () => {
        div.classList.add('fade-out-down');
        sessionStorage.setItem('notif_soft_prompt_dismissed', 'true');
        setTimeout(() => div.remove(), 400);
    };
    
    document.getElementById('btn-notif-activate').onclick = async () => {
        const btn = document.getElementById('btn-notif-activate');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Activando...';
        }
        const ok = await requestNotificationPermission(true);
        if (ok) {
            localStorage.setItem('notif_soft_prompt_completed', 'true');
            div.remove();
            showToast('Avisos activados para este dispositivo.', 'success');
            return;
        }
        const permissionNow = typeof Notification !== "undefined" ? Notification.permission : notifPermission;
        if (permissionNow === 'granted') {
            localStorage.setItem('notif_soft_prompt_completed', 'true');
            div.remove();
            showToast('Permiso concedido. Terminando de enlazar avisos en segundo plano...', 'info');
            return;
        }
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Activar';
        }
        showToast('No se pudo activar el permiso de avisos en este momento.', 'warning');
    };
}

async function showDeniedGuide() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal-card glass-strong p-0 animate-up" style="max-width:360px;">
            <div class="modal-header bg-gradient-to-r from-red-500/10 to-transparent">
                <span class="modal-title" style="color:#f87171"><i class="fas fa-bell-slash mr-2"></i> PERMISO DENEGADO</span>
                <button class="close-btn" onclick="this.closest('.modal-overlay').remove()"><i class="fas fa-times"></i></button>
            </div>
            <div class="modal-body p-6 flex-col gap-5">
                <div class="flex-col gap-4">
                    <div class="flex-row items-start gap-4 p-4 bg-white/5 rounded-2xl border border-white/10">
                        <div class="w-10 h-10 rounded-xl bg-primary/20 text-primary flex center shrink-0 font-black">1</div>
                        <div class="flex-col">
                            <span class="text-[12px] font-black uppercase text-white">Activa el permiso</span>
                            <p class="text-[10px] text-white/50 leading-relaxed mt-1">Pulsa en el icono del <i class="fas fa-lock mx-1 text-primary"></i> candado arriba (en la URL) y activa <b>Notificaciones</b>.</p>
                        </div>
                    </div>

                    <div class="flex-row items-start gap-4 p-4 bg-sport-green/20 border border-sport-green/30 rounded-2xl">
                        <div class="w-10 h-10 rounded-xl bg-sport-green text-black flex center shrink-0 font-black">2</div>
                        <div class="flex-col">
                            <span class="text-[12px] font-black uppercase text-black">Pulsa el botón de abajo</span>
                            <p class="text-[10px] text-black/70 font-bold leading-relaxed mt-1">Recargar aplicará el cambio inmediatamente.</p>
                        </div>
                    </div>
                </div>

                <button class="btn-booking-v7 w-full py-5 text-[11px] font-black tracking-[2px]" onclick="window.location.reload()">
                    <i class="fas fa-sync-alt mr-2 animate-spin-slow"></i> RECARGAR Y ACTIVAR
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}

/**
 * Requests notification permission
 */
export async function requestNotificationPermission(autoInit = true) {
  notifPermission = Notification.permission;

  if (notifPermission === "granted") {
    localStorage.setItem("notif_soft_prompt_completed", "true");
    document.getElementById("notif-soft-prompt")?.remove();
    analyticsSetFlag("notifications.permission", true);
    analyticsCount("notifications.enabled", 1);
    persistNotifPermissionFlag("granted").catch(() => {});
    if (autoInit && auth.currentUser?.uid)
      initPushNotifications(auth.currentUser.uid).catch(() => {});
    return true;
  }

  if (notifPermission === "denied") {
      analyticsSetFlag("notifications.permission", false);
      analyticsCount("notifications.denied", 1);
      showDeniedGuide();
      persistNotifPermissionFlag("denied").catch(() => {});
      return false;
  }

  try {
    const ok = await ensureOneSignalInitialized();
    if (!ok) return false;

    await oneSignalExec(async (OneSignal) => {
      // In OneSignal v16, optIn handles everything if permission isn't denied
      await OneSignal.Notifications.requestPermission();
    });

    notifPermission = Notification.permission;

    if (notifPermission === "granted") {
      localStorage.setItem("notif_soft_prompt_completed", "true");
      document.getElementById("notif-soft-prompt")?.remove();
      analyticsSetFlag("notifications.permission", true);
      analyticsCount("notifications.enabled", 1);
      showToast(
        "¡Conexión establecida!",
        "Notificaciones activadas correctamente.",
        "success",
      );
      persistNotifPermissionFlag("granted").catch(() => {});
      if (autoInit && auth.currentUser?.uid)
        initPushNotifications(auth.currentUser.uid).catch(() => {});
      return true;
    }
  } catch (e) {
    pushLog("error", "permission_request_error", { error: e?.message || String(e) });
  }

  if (notifPermission === "denied") {
    analyticsSetFlag("notifications.permission", false);
    analyticsCount("notifications.denied", 1);
    persistNotifPermissionFlag("denied").catch(() => {});
  }
  return false;
}

/**
 * Sends a local push notification using Service Worker if available
 */
export async function sendPushNotification(
  title,
  body,
  icon = DEFAULT_ICON,
  meta = {},
) {
  if (notifPermission !== "granted") return;
  const targetUrl = meta?.url || "./home.html";
  const targetTag =
    meta?.tag ||
    `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const options = {
    body,
    icon,
    badge: icon,
    vibrate: [200, 100, 200],
    tag: targetTag,
    renotify: true,
    data: { url: targetUrl },
  };

  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(title, options);
        return;
      }
    } catch (swErr) {
      console.warn("SW notification fallback to window:", swErr);
    }
  }

  try {
    const notification = new Notification(title, options);
    notification.onclick = (e) => {
      e.preventDefault(); // Prevent default focus if needed
      window.focus();
      if (targetUrl) {
          window.location.href = targetUrl;
      }
      notification.close();
    };
  } catch (e) {
    console.error("Notification error:", e);
  }
}

export function scheduleMatchReminder(matchDate, matchInfo) {
  const now = new Date();
  const reminderTime = new Date(matchDate.getTime() - 30 * 60 * 1000);

  if (reminderTime > now) {
    const delay = reminderTime.getTime() - now.getTime();

    setTimeout(() => {
      sendPushNotification(
        "Partido en 30 minutos",
        `Tu partido${matchInfo ? ` - ${matchInfo}` : ""} empieza pronto. Prepárate.`,
      );
    }, delay);
  }
}

export function notifyRankingChange(oldRank, newRank, pointsDiff) {
  if (newRank < oldRank) {
    sendPushNotification(
      "Has subido en el ranking",
      `Nueva posición: #${newRank} (+${pointsDiff} pts)`,
    );
  } else if (newRank > oldRank) {
    sendPushNotification(
      "Has bajado en el ranking",
      `Nueva posición: #${newRank} (${pointsDiff} pts)`,
    );
  }
}

export function notifyMatchJoin(userName, matchDate) {
  sendPushNotification(
    "Nuevo jugador",
    `${userName} se ha unido a tu partido del ${matchDate.toLocaleDateString("es-ES", { weekday: "short", day: "numeric" })}`,
  );
}

export async function checkDailyReminders(userId, matches) {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const morningCheckKey = `morning_notif_${userId}_${todayStr}`;

  const todayMatches = matches.filter((m) => {
    const mDate = m.fecha?.toDate
      ? m.fecha.toDate()
      : m.fecha instanceof Date
        ? m.fecha
        : new Date(m.fecha);
    return mDate && mDate.toDateString() === now.toDateString();
  });

  const isAfterMorningTime =
    now.getHours() > 7 || (now.getHours() === 7 && now.getMinutes() >= 30);
  const alreadySentToday = localStorage.getItem(morningCheckKey) === "true";

  if (todayMatches.length > 0 && isAfterMorningTime && !alreadySentToday) {
    sendPushNotification(
      "¡Hoy juegas!",
      `Tienes ${todayMatches.length} partido(s) programado(s) para hoy. ¡A por todas!`,
    );
    localStorage.setItem(morningCheckKey, "true");
  }

  if (todayMatches.length > 0) {
    todayMatches.forEach((m) => {
      const mDate = m.fecha?.toDate
        ? m.fecha.toDate()
        : m.fecha instanceof Date
          ? m.fecha
          : new Date(m.fecha);
      if (mDate) scheduleMatchReminder(mDate, m.type);
    });
  }
}

export function setOneSignalAppId(appId) {
  if (!appId) return;
  const clean = String(appId).trim();
  localStorage.setItem(ONESIGNAL_APP_ID_STORAGE_KEY, clean);
  window.__ONESIGNAL_APP_ID = clean;
}

export async function checkNotificationStatus() {
  console.log(`📡 [Push Health] Iniciando chequeo...`);
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua) && !/CriOS\//.test(ua) && !/Edg\//.test(ua);
  const browserSupported = typeof Notification !== "undefined";
  const permission = browserSupported ? Notification.permission : "unsupported";
  const swSupported = "serviceWorker" in navigator;

  console.log(`📱 [Push Health] Plataforma: iOS=${isIOS}, Safari=${isSafari}`);
  console.log(`🌐 [Push Health] Navegador Soporta Push: ${browserSupported}, Permiso: ${permission}`);
  console.log(`⚙️ [Push Health] Service Worker Soportado: ${swSupported}`);

  let swActive = false;
  let swScope = null;
  let swCount = 0;
  let swConflict = false;
  let appShellActive = false;
  let oneSignalWorkerActive = false;
  let appShellScope = null;
  let oneSignalScope = null;
  if (swSupported) {
    try {
      const swDiag = await getServiceWorkerDiagnostics();
      const regs = swDiag.regs || [];
      swCount = regs.length;
      const activeReg = regs.find((r) => r.active) || regs[0] || null;
      swActive = !!activeReg?.active;
      swScope = activeReg?.scope || null;
      swConflict = Boolean(swDiag?.conflict);
      appShellActive = Boolean(swDiag?.appShell?.active || swDiag?.appShell?.installing || swDiag?.appShell?.waiting);
      oneSignalWorkerActive = Boolean(swDiag?.oneSignal?.active || swDiag?.oneSignal?.installing || swDiag?.oneSignal?.waiting);
      const oneSignalActiveWorker = swDiag?.oneSignal?.active || swDiag?.oneSignal?.installing || swDiag?.oneSignal?.waiting;
      oneSignalScriptURL = oneSignalActiveWorker?.scriptURL || null;
      appShellScope = swDiag?.appShell?.scope || null;
      oneSignalScope = swDiag?.oneSignal?.scope || null;
      
      console.log(`🛠️ [Push Health] SW Registros Activos: ${swCount}`);
      if (oneSignalScope) console.log(`🛰️ [Push Health] OneSignal Scope: ${oneSignalScope} | URL: ${oneSignalScriptURL}`);
      if (swConflict) console.warn(`⚠️ [Push Health] Conflicto de SW detectado!`);
    } catch (e) {
      console.error(`❌ [Push Health] Error leyendo Service Workers:`, e);
    }
  }

  let oneSignalAvailable = !!(window.OneSignal || window.OneSignalDeferred);
  let oneSignalInitialized = !!oneSignalReady;
  let oneSignalRegistered = false;
  let oneSignalSubscriptionId = null;
  let oneSignalError = null;

  console.log(`🔔 [Push Health] OneSignal Disponible: ${oneSignalAvailable}, Inicializado: ${oneSignalInitialized}`);

  try {
    if (!oneSignalInitialized && oneSignalAvailable) {
      oneSignalInitialized = await ensureOneSignalInitialized();
    }
    if (oneSignalInitialized) {
      const sub = await oneSignalExec(async (OneSignal) => safeGetSubscription(OneSignal));
      oneSignalSubscriptionId = sub?.id || null;
      oneSignalRegistered = Boolean(sub?.id && sub?.optedIn);
      console.log(`✅ [Push Health] OneSignal Suscripción: ${oneSignalSubscriptionId}, OptedIn: ${sub?.optedIn}`);
    }
  } catch (e) {
    oneSignalError = e?.message || "onesignal-status-error";
    console.error(`❌ [Push Health] Error consultando OneSignal:`, e);
  }

  const blocked = permission === "denied";
  const backgroundReady =
    browserSupported &&
    permission === "granted" &&
    swSupported &&
    swActive &&
    oneSignalRegistered;

  console.log(`📊 [Push Health] Listo en 2o Plano: ${backgroundReady}, Bloqueado por Usuario: ${blocked}`);

  const issues = [];
  if (!browserSupported) issues.push("browser_unsupported");
  if (permission === "default") issues.push("permission_default");
  if (blocked) issues.push("permission_denied");
  if (swSupported && !swActive) issues.push("sw_inactive");
  if (swConflict) issues.push("sw_scope_conflict");
  if (!oneSignalAvailable) issues.push("onesignal_sdk_missing");
  if (oneSignalAvailable && !oneSignalInitialized) issues.push("onesignal_not_initialized");
  if (oneSignalAvailable && oneSignalInitialized && !oneSignalRegistered) issues.push("onesignal_not_subscribed");
  if (oneSignalError) issues.push("onesignal_error");
  if (isIOS && isSafari) issues.push("ios_safari_mode");

  let recommendedAction = "none";
  if (blocked) recommendedAction = "open_browser_settings";
  else if (permission === "default") recommendedAction = "request_permission";
  else if (!swActive) recommendedAction = "reregister_service_worker";
  else if (swConflict) recommendedAction = "resolve_sw_conflict";
  else if (!oneSignalRegistered) recommendedAction = "reconnect_onesignal";

  if (issues.length > 0) {
    console.warn(`🔍 [Push Health] Problemas encontrados:`, issues);
    console.warn(`💡 [Push Health] Acción recomendada: ${recommendedAction}`);
  } else {
    console.log(`🌟 [Push Health] Todo perfecto!`);
  }

  const status = {
    browserSupported,
    permission,
    blocked,
    swSupported,
    swActive,
    swScope,
    swCount,
    swConflict,
    appShellActive,
    oneSignalWorkerActive,
    oneSignalScriptURL,
    appShellScope,
    oneSignalScope,
    oneSignalAvailable,
    oneSignalInitialized,
    oneSignalRegistered,
    oneSignalSubscriptionId,
    oneSignalError,
    backgroundReady,
    issues,
    recommendedAction,
    workerConfig: window.__pushWorkerConfig || null,
    platform: { isIOS, isSafari },
  };
  persistPushState({
    permission,
    backgroundReady,
    issues,
    recommendedAction,
    oneSignalRegistered,
    swActive,
  });
  return status;
}

const HUMAN_MESSAGES = {
  ok: { title: "Todo listo", message: "Recibirás avisos de partidos y retos en tu móvil aunque no tengas la app abierta.", steps: [] },
  permission_default: { title: "Activa los avisos", message: "Para no perderte ningún partido, permite que la app te envíe notificaciones.", steps: ["Pulsa el botón «Activar» debajo.", "En la ventana del navegador, elige «Permitir»."] },
  permission_denied: { title: "Avisos desactivados", message: "Has bloqueado los avisos. Para volver a recibirlos:", steps: ["Abre la configuración de tu navegador (icono de candado o información en la barra de la dirección).", "Busca «Notificaciones» para esta página y cámbialo a «Permitir».", "Vuelve aquí y recarga la app si hace falta."] },
  sw_inactive: { title: "Actualiza la app", message: "Para recibir avisos en segundo plano, instala o actualiza la app desde tu navegador.", steps: ["En el menú del navegador (tres puntos), elige «Instalar aplicación» o «Añadir a pantalla de inicio».", "Abre la app desde el icono instalado y activa de nuevo los avisos."] },
  sw_scope_conflict: { title: "Conflicto de versión", message: "Hay dos versiones de la app en uso. Usa solo la instalada (icono en el móvil).", steps: ["Cierra pestañas abiertas de la app en el navegador.", "Abre solo la app instalada (icono en la pantalla de inicio)."] },
  onesignal_sdk_missing: { title: "Cargando avisos...", message: "El sistema de notificaciones está arrancando. Si ves este mensaje mucho tiempo, recarga la app.", steps: [] },
  onesignal_not_initialized: { title: "Sincronizando...", message: "Conectando con el servidor de avisos en segundo plano.", steps: [] },
  onesignal_not_subscribed: { title: "Activa los avisos", message: "Parece que no tienes los avisos activados para este dispositivo.", steps: ["Pulsa el botón «Reconectar» o «Activar» debajo."] },
  onesignal_error: { title: "Conexión en pausa", message: "Hubo un pequeño corte con nuestro servidor de avisos. Prueba a cerrar y abrir la app de nuevo.", steps: [] },
  default: { title: "Estado de los avisos", message: "Comprueba que tienes la app instalada y que has permitido las notificaciones.", steps: [] },
};

export async function getPushStatusHuman() {
  const status = await checkNotificationStatus();
  const canReceive = status.backgroundReady;
  const firstIssue = status.issues?.[0] || "default";
  const human = HUMAN_MESSAGES[firstIssue] || HUMAN_MESSAGES.default;
  return { ok: canReceive, ...human, status };
}

let notificationHelpModalEl = null;

export function showNotificationHelpModal() {
  if (notificationHelpModalEl && document.body.contains(notificationHelpModalEl)) {
    notificationHelpModalEl.classList.add("active");
    (async () => {
      const { ok, title, message, steps } = await getPushStatusHuman();
      const t = notificationHelpModalEl.querySelector("#notif-help-title");
      const m = notificationHelpModalEl.querySelector("#notif-help-message");
      const sEl = notificationHelpModalEl.querySelector("#notif-help-steps");
      const btn = notificationHelpModalEl.querySelector("#notif-help-activate");
      if (t) t.textContent = title;
      if (m) m.textContent = message;
      if (sEl) {
        const stepList = Array.isArray(steps) ? steps : [];
        sEl.innerHTML = stepList.map((s) => `<li>${s}</li>`).join("");
        sEl.style.display = stepList.length ? "" : "none";
      }
      if (btn) {
        if (!ok) { btn.classList.remove("hidden"); btn.onclick = async () => { await requestNotificationPermission(true); notificationHelpModalEl.classList.remove("active"); }; }
        else btn.classList.add("hidden");
      }
    })();
    return;
  }
  notificationHelpModalEl = document.createElement("div");
  notificationHelpModalEl.id = "modal-notification-help";
  notificationHelpModalEl.className = "modal-overlay";
  notificationHelpModalEl.innerHTML = `
    <div class="modal-card glass-strong slide-up" style="max-width:400px;">
      <div class="modal-header">
        <span class="modal-title"><i class="fas fa-bell mr-2"></i><span id="notif-help-title">Estado de avisos</span></span>
        <button type="button" class="close-btn" aria-label="Cerrar">&times;</button>
      </div>
      <div class="modal-body p-4 flex-col gap-4">
        <p id="notif-help-message" class="text-sm text-white/90"></p>
        <ul id="notif-help-steps" class="list-decimal text-xs text-white/70 space-y-2 pl-4"></ul>
        <button type="button" id="notif-help-activate" class="btn-premium-v7 w-full py-2 uppercase text-[9px] font-black hidden">Activar avisos</button>
      </div>
    </div>
  `;
  document.body.appendChild(notificationHelpModalEl);
  const close = () => notificationHelpModalEl.classList.remove("active");
  notificationHelpModalEl.querySelector(".close-btn").onclick = close;
  notificationHelpModalEl.addEventListener("click", (e) => { if (e.target === notificationHelpModalEl) close(); });
  (async () => {
    const { ok, title, message, steps } = await getPushStatusHuman();
    notificationHelpModalEl.querySelector("#notif-help-title").textContent = title;
    notificationHelpModalEl.querySelector("#notif-help-message").textContent = message;
    const stepsEl = notificationHelpModalEl.querySelector("#notif-help-steps");
    const stepList = Array.isArray(steps) ? steps : [];
    stepsEl.innerHTML = stepList.map((s) => `<li>${s}</li>`).join("");
    stepsEl.style.display = stepList.length ? "" : "none";
    const btn = notificationHelpModalEl.querySelector("#notif-help-activate");
    if (!ok && typeof requestNotificationPermission === "function") {
      btn.classList.remove("hidden");
      btn.onclick = async () => { await requestNotificationPermission(true); close(); };
    }
  })();
  notificationHelpModalEl.classList.add("active");
}

/**
 * Sends a real background push notification via the server-side bridge (OneSignal).
 * REACHES CLOSED BROWSERS/PWA.
 */
export async function sendExternalPush({ title, message, uids = [], url = "home.html", data = {} }) {
  try {
    const endpoint = "https://europe-west1-padeluminatis.cloudfunctions.net/sendPush";
    if (window.location.protocol === "file:") return;

    console.log("Enviando push externo via Firebase Functions...");
    const payload = {
      titulo: title,
      mensaje: message,
      externalIds: Array.isArray(uids) ? uids.filter(Boolean) : [],
      url: url || "home.html",
      data: data || {},
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    return res.ok;
  } catch (e) {
    console.warn("External push trigger failed:", e);
    return false;
  }
}

/**
 * Unregisters any Service Workers that are not at the correct base or are known legacy paths.
 */
export async function cleanupStaleServiceWorkers() {
    if (!('serviceWorker' in navigator)) return;
    try {
        const regs = await navigator.serviceWorker.getRegistrations();
        const correctBase = getAppBase();
        const legacyPaths = [
            'legacy-sw.js',
            '/JafsPadelclub/',
            '/JafPadel/',
            'OneSignalSDKWorker.js', // Remove all legacy traces of this separated file
            'OneSignalSDKUpdaterWorker.js'
        ];

        for (const reg of regs) {
            const scriptURL = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || "";
            const scope = reg.scope;

            const isLegacyPath = legacyPaths.some(lp => scriptURL.includes(lp) || scope.includes(lp));
            const isWrongScope = !scope.startsWith(window.location.origin + correctBase);

            if (isLegacyPath || isWrongScope) {
                pushLog("info", "cleaning_stale_sw", { scriptURL, scope, reason: isLegacyPath ? 'legacy' : 'wrong_scope' });
                await reg.unregister();
            }
        }
    } catch (e) {
        pushLog("error", "cleanup_sw_failed", { error: e?.message });
    }
}

/**
 * Diagnostic health check for development
 */
export async function runPushDiagnostics() {
    const base = getAppBase();
    const status = await checkNotificationStatus();
    
    console.group("🚀 [OneSignal Diagnostics]");
    console.log("App Base Path (Detected):", base);
    console.log("Full Origin:", window.location.origin);
    console.log("-----------------------------------");
    console.log("OneSignal SW ScriptURL:", status.oneSignalScriptURL || "NOT REGISTERED");
    console.log("OneSignal SW Scope:", status.oneSignalScope || "NOT REGISTERED");
    console.log("-----------------------------------");
    
    const expectedScope = window.location.origin + base;
    const scopeOk = status.oneSignalScope === expectedScope;
    
    if (status.oneSignalScope) {
        if (scopeOk) {
            console.log("✅ Scope Validation: MATCH (Correct)");
        } else {
            console.error(`❌ Scope Validation: MISMATCH! \nExpected: ${expectedScope}\nActual:   ${status.oneSignalScope}`);
        }
    }
    
    if (status.issues.length > 0) {
        console.warn("Issues detected:", status.issues);
    }
    
    if (status.oneSignalScope && status.appShellScope && status.oneSignalScope === status.appShellScope) {
        console.warn("Co-existence warning: Both OneSignal and App SW share the same scope.");
    }
    
    console.groupEnd();
    return status;
}

