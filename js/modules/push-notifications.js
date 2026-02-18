/* js/modules/push-notifications.js - Firebase Cloud Messaging Push System */
import { showToast } from "../ui-core.js";
import { app, auth, db } from "../firebase-service.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-messaging.js";

const DEFAULT_ICON = "./imagenes/Logojafs.png";
const VAPID_STORAGE_KEY = "fcm_vapid_public_key";
const DEVICE_ID_STORAGE_KEY = "fcm_device_id";

let notifPermission = typeof Notification !== "undefined" ? Notification.permission : "default";
let messagingInstance = null;
let foregroundListenerBound = false;

function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (!id) {
    id = `dev_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, id);
  }
  return id;
}

function getConfiguredVapidKey() {
  const fromWindow = typeof window !== "undefined" ? window.__FCM_VAPID_PUBLIC_KEY : null;
  const fromStorage = localStorage.getItem(VAPID_STORAGE_KEY);
  return (fromWindow || fromStorage || "").trim();
}

async function ensureMessagingInstance() {
  if (messagingInstance) return messagingInstance;
  const supported = await isSupported().catch(() => false);
  if (!supported) return null;
  messagingInstance = getMessaging(app);
  return messagingInstance;
}

async function ensureServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register("./sw.js", { scope: "./" });
}

async function persistDeviceToken(uid, token) {
  if (!uid || !token) return;
  const deviceId = getDeviceId();
  const ref = doc(db, "usuarios", uid, "devices", deviceId);
  await setDoc(
    ref,
    {
      token,
      enabled: true,
      platform: "web",
      userAgent: navigator.userAgent || "unknown",
      updatedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    },
    { merge: true },
  );
}

function bindForegroundListener() {
  if (foregroundListenerBound || !messagingInstance) return;
  foregroundListenerBound = true;

  onMessage(messagingInstance, async (payload) => {
    const title = payload?.notification?.title || payload?.data?.title || "Padeluminatis";
    const body = payload?.notification?.body || payload?.data?.body || "Nueva notificación";
    const url = payload?.data?.url || "./home.html";

    // Evita duplicar toast local: la app ya renderiza feed/badge al estar visible.
    if (document.visibilityState === "visible") return;

    if (document.visibilityState === "hidden" && notifPermission === "granted") {
      try {
        const reg = await ensureServiceWorkerRegistration();
        if (reg) {
          await reg.showNotification(title, {
            body,
            icon: DEFAULT_ICON,
            badge: DEFAULT_ICON,
            tag: `fcm_fg_${Date.now()}`,
            data: { url },
          });
        }
      } catch (e) {
        console.warn("Foreground SW notification fallback failed:", e);
      }
    }
  });
}

export async function initPushNotifications(uid = null) {
  if (!("Notification" in window)) return false;

  const userId = uid || auth.currentUser?.uid;
  if (!userId) return false;

  const granted = await requestNotificationPermission(false);
  if (!granted) return false;

  try {
    const messaging = await ensureMessagingInstance();
    if (!messaging) return false;

    const vapidKey = getConfiguredVapidKey();
    if (!vapidKey) {
      console.warn("FCM disabled: missing VAPID public key.");
      if (!window.__vapidWarned) {
        window.__vapidWarned = true;
        showToast("Push pendiente", "Falta configurar la VAPID key de Firebase para activar notificaciones en segundo plano.", "warning");
      }
      return false;
    }

    const swReg = await ensureServiceWorkerRegistration();
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: swReg || undefined,
    });

    if (!token) return false;

    await persistDeviceToken(userId, token);
    bindForegroundListener();
    return true;
  } catch (e) {
    console.error("FCM init error:", e);
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
    if (autoInit && auth.currentUser?.uid) initPushNotifications(auth.currentUser.uid).catch(() => {});
    return true;
  }

  try {
    const result = await Notification.requestPermission();
    notifPermission = result;

    if (result === "granted") {
      showToast(
        "Notificaciones activadas",
        "Recibirás avisos incluso sin tener la app abierta.",
        "success",
      );
      if (autoInit && auth.currentUser?.uid) initPushNotifications(auth.currentUser.uid).catch(() => {});
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
      const registration = await ensureServiceWorkerRegistration();
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
    notification.onclick = () => {
      window.focus();
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

// Helper for setup without redeploy (dev/prod hotfix)
export function setPushVapidKey(vapidKey) {
  if (!vapidKey) return;
  localStorage.setItem(VAPID_STORAGE_KEY, String(vapidKey).trim());
}



