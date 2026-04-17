// GitHub Pages no puede ejecutar backend, asi que el envio push debe salir
// desde un worker externo. Recomendado: Cloudflare Worker gratuito.
// Worker de Cloudflare ya desplegado para el envio push.
export const APP_PUSH_API_URL = "https://jafs-padelclub-push.juanaanvlc22.workers.dev/send-push";

// Origen real de tu PWA en GitHub Pages.
// Ojo: aqui va solo el origen, sin la ruta /JafsPadelclub.
export const APP_ALLOWED_ORIGIN = "https://padelmistral.github.io";
export const APP_APK_URL = `${APP_ALLOWED_ORIGIN}/app-release.apk`;
const APP_APK_CANDIDATES = [
  `${APP_ALLOWED_ORIGIN}/app-release.apk`,
  `${APP_ALLOWED_ORIGIN}/JafsPadeluminatis/app-release.apk`,
  `${APP_ALLOWED_ORIGIN}/JafsPadelclub/app-release.apk`,
  "./app-release.apk",
  "./mobile-capacitor/android/app/build/outputs/apk/release/app-release.apk",
];

async function canReachApk(url) {
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch (_) {
    return false;
  }
}

export async function resolveApkDownloadUrl() {
  for (const candidate of APP_APK_CANDIDATES) {
    if (await canReachApk(candidate)) return candidate;
  }
  return APP_APK_URL;
}
