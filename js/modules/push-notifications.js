/* js/modules/push-notifications.js - OneSignal Push Channel */
import { showToast } from "../ui-core.js";
import { auth, db } from "../firebase-service.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

const DEFAULT_ICON = "./imagenes/Logojafs.png";
const ONESIGNAL_SDK_SRC =
  "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
const ONESIGNAL_APP_ID_STORAGE_KEY = "onesignal_app_id";
const DEVICE_ID_STORAGE_KEY = "onesignal_device_id";
const DEFAULT_ONESIGNAL_APP_ID = "0f270864-c893-4c44-95cc-393321937fb2";

let notifPermission =
  typeof Notification !== "undefined" ? Notification.permission : "default";
let oneSignalReady = false;
let oneSignalInitPromise = null;

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

    await oneSignalExec(async (OneSignal) => {
      await OneSignal.init({
        appId,
        serviceWorkerPath: "/JafsPadelclub/OneSignalSDKWorker.js",
        serviceWorkerUpdaterPath: "/JafsPadelclub/OneSignalSDKUpdaterWorker.js",
        serviceWorkerParam: { scope: "/JafsPadelclub/" },
        notifyButton: { enable: true },
      });
    });

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

  const subscription = await oneSignalExec(async (OneSignal) => ({
    id: OneSignal.User?.PushSubscription?.id || null,
    token: OneSignal.User?.PushSubscription?.token || null,
    optedIn: Boolean(OneSignal.User?.PushSubscription?.optedIn),
  }));

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

export async function initPushNotifications(uid = null) {
  if (!("Notification" in window)) return false;

  const userId = uid || auth.currentUser?.uid;
  const ok = await ensureOneSignalInitialized();
  if (!ok) return false;
  if (!userId) return true;

  try {
    await oneSignalExec(async (OneSignal) => {
      await OneSignal.login(userId);
      await OneSignal.Notifications.requestPermission();
    });

    notifPermission = Notification.permission;
    if (notifPermission !== "granted") return false;

    await persistDeviceSubscription(userId);
    return true;
  } catch (e) {
    console.error("OneSignal init error:", e);
    return false;
  }
}

/**
 * Requests notification permission
 */
export async function requestNotificationPermission(autoInit = true) {
  if (!("Notification" in window)) {
    console.log("Notifications not supported");
    return false;
  }

  if (notifPermission === "granted") {
    if (autoInit && auth.currentUser?.uid)
      initPushNotifications(auth.currentUser.uid).catch(() => {});
    return true;
  }

  try {
    const ok = await ensureOneSignalInitialized();
    if (!ok) return false;

    await oneSignalExec(async (OneSignal) => {
      await OneSignal.Notifications.requestPermission();
    });

    notifPermission = Notification.permission;

    if (notifPermission === "granted") {
      showToast(
        "Notificaciones activadas",
        "Recibirás avisos incluso sin tener la app abierta.",
        "success",
      );
      if (autoInit && auth.currentUser?.uid)
        initPushNotifications(auth.currentUser.uid).catch(() => {});
      return true;
    }
  } catch (e) {
    console.error("Notification permission error:", e);
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

/**
 * Sends a real background push notification via the server-side bridge (OneSignal).
 * REACHES CLOSED BROWSERS/PWA.
 */
export async function sendExternalPush({ title, message, uids = [], url = "home.html", data = {} }) {
  try {
    const endpoint = window.__PUSH_API_URL || "/api/send-push";
    if (window.location.protocol === "file:") return;

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

