/* =============================================================
   OneSignalSDKWorker.js - JafsPadel
   OneSignal gestiona el push de fondo y nuestro sw.js la PWA.
   El orden importa: OneSignal primero, luego nuestro SW.
   ============================================================= */

importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js");
importScripts("./sw.js");
