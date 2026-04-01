import { auth, db } from "../firebase-service.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

const NATIVE_PUSH_TOKEN_KEY = "native_push_token_v1";
const NATIVE_PUSH_DEVICE_KEY = "native_push_device_v1";

let listenersBound = false;
let currentRegistrationPromise = null;
let latestUid = null;

function getCapacitor() {
  return window.Capacitor || null;
}

function getPlugins() {
  return getCapacitor()?.Plugins || {};
}

function getPushNotificationsPlugin() {
  return getPlugins().PushNotifications || null;
}

function getLocalNotificationsPlugin() {
  return getPlugins().LocalNotifications || null;
}

export function isNativePlatform() {
  try {
    if (typeof window === "undefined") return false;
    const cap = getCapacitor();
    if (!cap) return false;
    if (typeof cap.isNativePlatform === "function") return !!cap.isNativePlatform();
    const platform = typeof cap.getPlatform === "function" ? cap.getPlatform() : "";
    return platform === "android" || platform === "ios";
  } catch (_) {
    return false;
  }
}

export function getNativePlatform() {
  try {
    const cap = getCapacitor();
    return typeof cap?.getPlatform === "function" ? cap.getPlatform() : "web";
  } catch (_) {
    return "web";
  }
}

function getDeviceId() {
  let id = localStorage.getItem(NATIVE_PUSH_DEVICE_KEY);
  if (!id) {
    id = `native_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    localStorage.setItem(NATIVE_PUSH_DEVICE_KEY, id);
  }
  return id;
}

async function persistNativeDeviceToken(uid, token) {
  if (!uid || !token) return false;
  const platform = getNativePlatform();
  const deviceId = getDeviceId();
  const ref = doc(db, "usuarios", uid, "devices", deviceId);
  await setDoc(
    ref,
    {
      provider: "fcm",
      token,
      enabled: true,
      platform: `${platform}-native`,
      userAgent: navigator.userAgent || "unknown",
      updatedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    },
    { merge: true },
  );
  await setDoc(
    doc(db, "usuarios", uid),
    {
      notifPermission: "granted",
      notifPermissionUpdatedAt: serverTimestamp(),
      nativePushPlatform: platform,
      nativePushEnabled: true,
      nativePushLastSeenAt: serverTimestamp(),
    },
    { merge: true },
  );
  localStorage.setItem(NATIVE_PUSH_TOKEN_KEY, token);
  window.__nativePushToken = token;
  return true;
}

function bindNativePushListeners() {
  if (listenersBound || !isNativePlatform()) return;
  const PushNotifications = getPushNotificationsPlugin();
  if (!PushNotifications?.addListener) return;

  PushNotifications.addListener("registration", async (token) => {
    const value = token?.value || "";
    if (!value) return;
    try {
      await persistNativeDeviceToken(latestUid || auth.currentUser?.uid || null, value);
    } catch (err) {
      console.warn("native_push_persist_failed", err);
    }
    if (currentRegistrationPromise?.resolve) currentRegistrationPromise.resolve(value);
    currentRegistrationPromise = null;
  });

  PushNotifications.addListener("registrationError", (error) => {
    if (currentRegistrationPromise?.reject) currentRegistrationPromise.reject(error);
    currentRegistrationPromise = null;
    console.warn("native_push_registration_error", error);
  });

  PushNotifications.addListener("pushNotificationReceived", async (notification) => {
    try {
      const LocalNotifications = getLocalNotificationsPlugin();
      if (!LocalNotifications?.schedule) return;
      await LocalNotifications.schedule({
        notifications: [
          {
            id: Date.now() % 2147483647,
            title: notification?.title || "JafsPadelClub",
            body: notification?.body || "",
            extra: notification?.data || {},
          },
        ],
      });
    } catch (err) {
      console.warn("native_local_notification_failed", err);
    }
  });

  PushNotifications.addListener("pushNotificationActionPerformed", (event) => {
    const targetUrl =
      event?.notification?.data?.url ||
      event?.notification?.data?.link ||
      "home.html";
    if (targetUrl) window.location.href = targetUrl;
  });

  listenersBound = true;
}

async function waitForNativeRegistration(timeoutMs = 12000) {
  if (window.__nativePushToken) return window.__nativePushToken;
  if (localStorage.getItem(NATIVE_PUSH_TOKEN_KEY)) {
    return localStorage.getItem(NATIVE_PUSH_TOKEN_KEY);
  }
  if (currentRegistrationPromise?.promise) return currentRegistrationPromise.promise;

  currentRegistrationPromise = {};
  currentRegistrationPromise.promise = new Promise((resolve, reject) => {
    currentRegistrationPromise.resolve = resolve;
    currentRegistrationPromise.reject = reject;
    window.setTimeout(() => {
      if (currentRegistrationPromise?.resolve === resolve) {
        reject(new Error("native_push_registration_timeout"));
        currentRegistrationPromise = null;
      }
    }, timeoutMs);
  });
  return currentRegistrationPromise.promise;
}

export async function initNativePushNotifications(uid = null) {
  if (!isNativePlatform()) return false;
  const PushNotifications = getPushNotificationsPlugin();
  if (!PushNotifications) return false;

  latestUid = uid || auth.currentUser?.uid || null;
  bindNativePushListeners();

  const permState = await PushNotifications.checkPermissions();
  let receive = permState?.receive || "prompt";
  if (receive === "prompt") {
    const requested = await PushNotifications.requestPermissions();
    receive = requested?.receive || receive;
  }
  if (receive !== "granted") return false;

  await PushNotifications.register();
  const token = await waitForNativeRegistration().catch(() => "");
  if (!token) return false;
  await persistNativeDeviceToken(latestUid, token);
  return true;
}

export async function requestNativePushPermission(uid = null) {
  if (!isNativePlatform()) return false;
  return initNativePushNotifications(uid);
}

export async function getNativePushStatus() {
  if (!isNativePlatform()) {
    return {
      available: false,
      permission: "unsupported",
      registered: false,
      token: null,
      platform: "web",
    };
  }
  const PushNotifications = getPushNotificationsPlugin();
  if (!PushNotifications?.checkPermissions) {
    return {
      available: false,
      permission: "unsupported",
      registered: false,
      token: null,
      platform: getNativePlatform(),
    };
  }
  const permissionState = await PushNotifications.checkPermissions().catch(() => ({ receive: "prompt" }));
  const token = window.__nativePushToken || localStorage.getItem(NATIVE_PUSH_TOKEN_KEY) || null;
  return {
    available: true,
    permission: permissionState?.receive || "prompt",
    registered: Boolean(token),
    token,
    platform: getNativePlatform(),
  };
}

export async function sendNativeLocalNotification(title, body, meta = {}) {
  if (!isNativePlatform()) return false;
  const LocalNotifications = getLocalNotificationsPlugin();
  if (!LocalNotifications?.schedule) return false;
  if (LocalNotifications.requestPermissions) {
    const perms = await LocalNotifications.requestPermissions().catch(() => ({ display: "granted" }));
    if (perms?.display === "denied") return false;
  }
  await LocalNotifications.schedule({
    notifications: [
      {
        id: Date.now() % 2147483647,
        title: title || "JafsPadelClub",
        body: body || "",
        extra: meta || {},
      },
    ],
  });
  return true;
}
