/* =============================================================
   OneSignalSDKWorker.js — JafsPadel
   OneSignal maneja el push de fondo; sw.js añade caché PWA.
   El orden importa: OneSignal primero, luego nuestro SW.
   ============================================================= */

// 1. OneSignal SDK (gestiona push, suscripción y notificaciones de fondo)
importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");

// 2. Nuestro SW con caché PWA, fallback offline y mensajes PING.
//    Solo importamos lo que no interfiere con OneSignal (fetch, cache, message).
importScripts("./sw.js");
