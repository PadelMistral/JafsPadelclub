import { auth, db } from "../firebase-service.js";
import {
  doc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

const NATIVE_PUSH_TOKEN_KEY = "native_push_token_v1";
const NATIVE_PUSH_DEVICE_KEY = "native_push_device_v1";
const NATIVE_ONESIGNAL_SUB_KEY = "native_onesignal_subscription_v1";
const NATIVE_ONESIGNAL_ID_KEY = "native_onesignal_id_v1";

let listenersBound = false;
let currentRegistrationPromise = null;
let latestUid = null;
let oneSignalListenersBound = false;

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

function getOneSignalPlugin() {
  try {
    // Priority: Capacitor/Cordova plugin vs Web SDK
    const plugin = window.plugins?.OneSignal || window.OneSignal || null;
    // On native, if window.OneSignal is just the Web SDK (it has .init but not .initialize)
    // we should be careful. The native plugin has .initialize and .Notifications
    if (isNativePlatform() && plugin && !plugin.initialize && window.plugins?.OneSignal) {
        return window.plugins.OneSignal;
    }
    return plugin;
  } catch (_) {
    return null;
  }
}

async function waitForCordovaReady(timeoutMs = 9000) {
  if (typeof window === "undefined") return false;
  if (window.cordova && getOneSignalPlugin()) return true;
  return await new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = window.setTimeout(() => done(!!getOneSignalPlugin()), timeoutMs);
    document.addEventListener("deviceready", () => {
      window.clearTimeout(timer);
      window.setTimeout(() => done(!!getOneSignalPlugin()), 350);
    }, { once: true });
    if (window.cordova) {
      window.setTimeout(() => {
        window.clearTimeout(timer);
        done(!!getOneSignalPlugin());
      }, 800);
    }
  });
}

function getConfiguredOneSignalAppId() {
  try {
    return (
      window.__ONESIGNAL_APP_ID ||
      localStorage.getItem("onesignal_app_id") ||
      "0f270864-c893-4c44-95cc-393321937fb2"
    );
  } catch (_) {
    return "0f270864-c893-4c44-95cc-393321937fb2";
  }
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

async function persistNativeOneSignalSubscription(uid, details = {}) {
  if (!uid) return false;
  const platform = getNativePlatform();
  const deviceId = getDeviceId();
  const ref = doc(db, "usuarios", uid, "devices", deviceId);
  await setDoc(
    ref,
    {
      provider: "onesignal",
      enabled: !!details.subscriptionId && details.optedIn !== false,
      platform: `${platform}-native`,
      oneSignalPlayerId: details.subscriptionId || null,
      oneSignalId: details.oneSignalId || null,
      token: details.token || null,
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
      nativePushProvider: "onesignal",
      nativePushLastSeenAt: serverTimestamp(),
    },
    { merge: true },
  );
  if (details.subscriptionId) localStorage.setItem(NATIVE_ONESIGNAL_SUB_KEY, details.subscriptionId);
  if (details.oneSignalId) localStorage.setItem(NATIVE_ONESIGNAL_ID_KEY, details.oneSignalId);
  return true;
}

async function getNativeOneSignalState() {
  await waitForCordovaReady().catch(() => false);
  const OneSignal = getOneSignalPlugin();
  if (!OneSignal) {
    return {
      available: false,
      initialized: false,
      permission: "unsupported",
      subscribed: false,
      subscriptionId: localStorage.getItem(NATIVE_ONESIGNAL_SUB_KEY) || null,
      oneSignalId: localStorage.getItem(NATIVE_ONESIGNAL_ID_KEY) || null,
      token: localStorage.getItem(NATIVE_PUSH_TOKEN_KEY) || null,
    };
  }

  let permission = "prompt";
  let canRequest = true;
  let subscriptionId = localStorage.getItem(NATIVE_ONESIGNAL_SUB_KEY) || null;
  let oneSignalId = localStorage.getItem(NATIVE_ONESIGNAL_ID_KEY) || null;
  let token = localStorage.getItem(NATIVE_PUSH_TOKEN_KEY) || null;
  let optedIn = false;

  try {
    const permissionGranted = await OneSignal.Notifications.getPermissionAsync();
    permission = permissionGranted ? "granted" : "prompt";
  } catch (_) {}
  try {
    canRequest = await OneSignal.Notifications.canRequestPermission();
  } catch (_) {}
  if (permission !== "granted" && canRequest === false) permission = "denied";

  try {
    subscriptionId = await OneSignal.User.pushSubscription.getIdAsync();
  } catch (_) {}
  try {
    token = await OneSignal.User.pushSubscription.getTokenAsync();
  } catch (_) {}
  try {
    optedIn = await OneSignal.User.pushSubscription.getOptedInAsync();
  } catch (_) {}
  try {
    oneSignalId = await OneSignal.User.getOnesignalId();
  } catch (_) {}

  if (subscriptionId) localStorage.setItem(NATIVE_ONESIGNAL_SUB_KEY, subscriptionId);
  if (oneSignalId) localStorage.setItem(NATIVE_ONESIGNAL_ID_KEY, oneSignalId);
  if (token) localStorage.setItem(NATIVE_PUSH_TOKEN_KEY, token);

  return {
    available: true,
    initialized: true,
    permission,
    subscribed: !!subscriptionId && !!optedIn,
    subscriptionId,
    oneSignalId,
    token,
    optedIn,
  };
}

async function initNativeOneSignal(uid = null) {
  if (!isNativePlatform()) return { ok: false, reason: "not_native" };
  await waitForCordovaReady().catch(() => false);
  const OneSignal = getOneSignalPlugin();
  if (!OneSignal) return { ok: false, reason: "plugin_missing" };

  try {
    OneSignal.Debug?.setLogLevel?.(6);
    OneSignal.Debug?.setAlertLevel?.(0);
  } catch (_) {}

  try {
    const appId = getConfiguredOneSignalAppId();
    console.log("[NativeOneSignal] Initializing with App ID:", appId);
    OneSignal.initialize(appId);
  } catch (err) {
    console.error("[NativeOneSignal] Initialization failed:", err);
  }

  try {
    if (uid) OneSignal.login(uid);
  } catch (_) {}

  if (!oneSignalListenersBound) {
    try {
      OneSignal.Notifications.addEventListener("click", (event) => {
        const targetUrl =
          event?.notification?.additionalData?.url ||
          event?.notification?.additionalData?.link ||
          event?.notification?.launchURL ||
          "home.html";
        if (targetUrl) window.location.href = targetUrl;
      });
    } catch (_) {}

    try {
      OneSignal.Notifications.addEventListener("permissionChange", () => {});
    } catch (_) {}

    try {
      OneSignal.User.pushSubscription.addEventListener("change", async () => {
        try {
          const state = await getNativeOneSignalState();
          await persistNativeOneSignalSubscription(uid || latestUid || auth.currentUser?.uid || null, state);
        } catch (_) {}
      });
    } catch (_) {}
    oneSignalListenersBound = true;
  }

  let permission = "prompt";
  try {
    const permissionGranted = await OneSignal.Notifications.getPermissionAsync();
    permission = permissionGranted ? "granted" : "prompt";
  } catch (_) {}

  if (permission !== "granted") {
    try {
      const granted = await OneSignal.Notifications.requestPermission(true);
      permission = granted ? "granted" : "prompt";
    } catch (_) {}
  }

  if (permission === "granted") {
    try {
      OneSignal.User?.pushSubscription?.optIn?.();
    } catch (_) {}
  }

  let state = await getNativeOneSignalState();
  if (permission === "granted" && !state.subscriptionId) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 12000) {
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      try {
        OneSignal.User?.pushSubscription?.optIn?.();
      } catch (_) {}
      state = await getNativeOneSignalState();
      if (state.subscriptionId || state.token) break;
    }
  }

  if (uid && state.subscriptionId) {
    try {
      OneSignal.login(uid);
    } catch (_) {}
  }
  if (uid && state.subscriptionId) {
    await persistNativeOneSignalSubscription(uid, state).catch(() => {});
  }
  return {
    ok: state.subscribed || state.permission === "granted",
    ...state,
  };
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
            title: notification?.title || "PADELUMINATIS",
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
  latestUid = uid || auth.currentUser?.uid || null;
  const oneSignalState = await initNativeOneSignal(latestUid).catch(() => ({ ok: false }));

  const PushNotifications = getPushNotificationsPlugin();
  if (!PushNotifications) {
    return !!oneSignalState?.ok;
  }

  bindNativePushListeners();

  const permState = await PushNotifications.checkPermissions().catch(() => ({ receive: "prompt" }));
  let receive = permState?.receive || "prompt";
  if (receive === "prompt" && oneSignalState?.permission !== "granted") {
    const requested = await PushNotifications.requestPermissions().catch(() => ({ receive }));
    receive = requested?.receive || receive;
  } else if (oneSignalState?.permission === "granted") {
    receive = "granted";
  }
  if (receive !== "granted" && !oneSignalState?.ok) return false;

  await PushNotifications.register().catch(() => {});
  const token = await waitForNativeRegistration().catch(() => "");
  if (token) {
    await persistNativeDeviceToken(latestUid, token);
  }
  const refreshedOneSignalState = await initNativeOneSignal(latestUid).catch(() => oneSignalState || ({ ok: false }));
  return Boolean(token || refreshedOneSignalState?.ok);
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
  const permissionState = await PushNotifications?.checkPermissions?.().catch(() => ({ receive: "prompt" }));
  const token = window.__nativePushToken || localStorage.getItem(NATIVE_PUSH_TOKEN_KEY) || null;
  const oneSignal = await getNativeOneSignalState().catch(() => ({
    available: false,
    initialized: false,
    permission: permissionState?.receive || "prompt",
    subscribed: false,
    subscriptionId: null,
    oneSignalId: null,
    token: null,
  }));
  return {
    available: true,
    permission: oneSignal.permission === "granted" ? "granted" : (permissionState?.receive || oneSignal.permission || "prompt"),
    registered: Boolean(token || oneSignal.subscriptionId),
    token: token || oneSignal.token,
    platform: getNativePlatform(),
    oneSignalAvailable: oneSignal.available,
    oneSignalInitialized: oneSignal.initialized,
    oneSignalRegistered: oneSignal.subscribed,
    oneSignalSubscriptionId: oneSignal.subscriptionId,
    oneSignalId: oneSignal.oneSignalId,
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
        title: title || "PADELUMINATIS",
        body: body || "",
        extra: meta || {},
      },
    ],
  });
  return true;
}
