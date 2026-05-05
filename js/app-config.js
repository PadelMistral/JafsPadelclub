// GitHub Pages no puede ejecutar backend, asi que el envio push debe salir
// desde un worker externo. Recomendado: Cloudflare Worker gratuito.
// Worker de Cloudflare ya desplegado para el envio push.
export const APP_PUSH_API_URL = "https://jafs-padelclub-push.juanaanvlc22.workers.dev/send-push";
export const APP_PUSH_API_CANDIDATES = [
  APP_PUSH_API_URL,
  "./api/send-push",
  "/api/send-push",
];
export const APP_PUSH_API_BEARER_TOKEN = "";

// Origen real de tu PWA en GitHub Pages.
// Ojo: aqui va solo el origen, sin la ruta /JafsPadelclub.
export const APP_ALLOWED_ORIGIN = "https://padelmistral.github.io";
export const APP_GITHUB_PAGES_PATH = "/JafsPadeluminatis";
export const APP_APK_FILENAME = "app-release.apk";
export const APP_APK_DOWNLOAD_ENABLED = true;

function getRuntimeBaseApkUrl() {
  if (typeof window === "undefined") return "";
  const pathname = String(window.location.pathname || "/");
  const basePath = pathname.replace(/\/[^/]*$/, "/");
  return `${window.location.origin}${basePath}${APP_APK_FILENAME}`;
}

export const APP_APK_URL =
  getRuntimeBaseApkUrl() || `${APP_ALLOWED_ORIGIN}${APP_GITHUB_PAGES_PATH}/${APP_APK_FILENAME}`;
const APP_APK_CANDIDATES = [
  APP_APK_URL,
  `${APP_ALLOWED_ORIGIN}${APP_GITHUB_PAGES_PATH}/${APP_APK_FILENAME}`,
  `${APP_ALLOWED_ORIGIN}/JafsPadelclub/${APP_APK_FILENAME}`,
  `${APP_ALLOWED_ORIGIN}/${APP_APK_FILENAME}`,
  `./${APP_APK_FILENAME}`,
];

function isLocalRuntime() {
  if (typeof window === "undefined") return false;
  return /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname || "");
}

async function canReachApk(url) {
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (response.ok) return true;
    if (response.status === 405) {
      const fallback = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: { range: "bytes=0-0" },
      });
      return fallback.ok || fallback.status === 206;
    }
    return false;
  } catch (_) {
    return false;
  }
}

export async function resolveApkDownloadUrl() {
  if (!APP_APK_DOWNLOAD_ENABLED) return "";
  const candidates = isLocalRuntime() ? [`./${APP_APK_FILENAME}`] : APP_APK_CANDIDATES;
  for (const candidate of candidates) {
    if (await canReachApk(candidate)) return candidate;
  }
  return "";
}
