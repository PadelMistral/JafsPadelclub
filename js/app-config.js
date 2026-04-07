// GitHub Pages no puede ejecutar backend, asi que el envio push debe salir
// desde un worker externo. Recomendado: Cloudflare Worker gratuito.
// Worker de Cloudflare ya desplegado para el envio push.
export const APP_PUSH_API_URL = "https://jafs-padelclub-push.juanaanvlc22.workers.dev/send-push";

// Origen real de tu PWA en GitHub Pages.
// Ojo: aqui va solo el origen, sin la ruta /JafsPadelclub.
export const APP_ALLOWED_ORIGIN = "https://padelmistral.github.io";
export const APP_APK_URL = "./JafsPadelclub-mobile-release.apk";
