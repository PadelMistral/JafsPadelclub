import { showToast } from "../ui-core.js";
import { registerBestServiceWorkerWithRetry } from "./push-notifications.js";

const INSTALL_BUTTON_ID = "pwa-install-launcher";
const APP_BANNER_ID = "app-shell-banner";
const PWA_INSTALLED_FLAG = "pwa_installed_v1";

function isStandaloneMode() {
  try {
    return (
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true
    );
  } catch {
    return false;
  }
}

function ensureInstallButton() {
  let button = document.getElementById(INSTALL_BUTTON_ID);
  if (button) return button;

  button = document.createElement("button");
  button.id = INSTALL_BUTTON_ID;
  button.type = "button";
  button.className = "pwa-install-launcher hidden";
  button.style.position = "fixed";
  button.style.top = "14px";
  button.style.left = "14px";
  button.style.right = "auto";
  button.style.zIndex = "10060";
  button.setAttribute("aria-label", "Instalar aplicacion");
  button.innerHTML = `
    <span class="pwa-install-launcher__icon"><i class="fas fa-mobile-screen-button"></i></span>
    <span class="pwa-install-launcher__text">Instalar App</span>
  `;
  document.body.appendChild(button);
  return button;
}

function ensureAppBanner() {
  let banner = document.getElementById(APP_BANNER_ID);
  if (banner) return banner;

  banner = document.createElement("div");
  banner.id = APP_BANNER_ID;
  banner.className = "app-shell-banner hidden";
  banner.innerHTML = `
    <div class="app-shell-banner__main">
      <span class="app-shell-banner__dot"></span>
      <div class="app-shell-banner__copy">
        <strong id="app-shell-banner-title">Estado de la app</strong>
        <span id="app-shell-banner-text">Preparando experiencia PWA...</span>
      </div>
    </div>
    <div class="app-shell-banner__actions">
      <button id="app-shell-banner-action" type="button" class="app-shell-banner__btn hidden">Abrir</button>
      <button id="app-shell-banner-close" type="button" class="app-shell-banner__ghost" aria-label="Cerrar">
        <i class="fas fa-times"></i>
      </button>
    </div>
  `;
  document.body.appendChild(banner);

  banner
    .querySelector("#app-shell-banner-close")
    ?.addEventListener("click", () => banner.classList.add("hidden"));

  return banner;
}

function normalizePWACopy() {
  const button = document.getElementById(INSTALL_BUTTON_ID);
  if (button) {
    button.setAttribute("aria-label", "Instalar aplicacion");
    const text = button.querySelector(".pwa-install-launcher__text");
    if (text) text.textContent = "Instalar App";
  }

  const bannerTitle = document.getElementById("app-shell-banner-title");
  const bannerText = document.getElementById("app-shell-banner-text");
  if (bannerTitle && /Ãƒ|Ã‚/.test(bannerTitle.textContent || "")) {
    bannerTitle.textContent = "Estado de la app";
  }
  if (bannerText && /Ãƒ|Ã‚/.test(bannerText.textContent || "")) {
    bannerText.textContent = "Preparando experiencia PWA...";
  }
}

function updateBanner({
  title,
  text,
  actionLabel = "",
  action = null,
  tone = "info",
  sticky = false,
} = {}) {
  const banner = ensureAppBanner();
  const titleEl = banner.querySelector("#app-shell-banner-title");
  const textEl = banner.querySelector("#app-shell-banner-text");
  const actionBtn = banner.querySelector("#app-shell-banner-action");

  if (titleEl) titleEl.textContent = title || "Estado de la app";
  if (textEl) textEl.textContent = text || "";

  banner.classList.remove("is-info", "is-success", "is-warning");
  banner.classList.add(
    tone === "success" ? "is-success" : tone === "warning" ? "is-warning" : "is-info",
  );
  banner.classList.remove("hidden");

  if (actionBtn) {
    if (actionLabel && typeof action === "function") {
      actionBtn.textContent = actionLabel;
      actionBtn.classList.remove("hidden");
      actionBtn.onclick = action;
    } else {
      actionBtn.classList.add("hidden");
      actionBtn.onclick = null;
    }
  }

  if (!sticky) {
    window.clearTimeout(window.__appShellBannerTimer);
    window.__appShellBannerTimer = window.setTimeout(() => {
      banner.classList.add("hidden");
    }, 4200);
  }
}

function setInstallButtonVisible(visible) {
  const button = ensureInstallButton();
  button.classList.toggle("hidden", !visible || isStandaloneMode());
}

function showInstallFallback(pageName) {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);

  if (isStandaloneMode()) {
    showToast("App instalada", `${pageName} ya esta funcionando como app en este dispositivo.`, "success");
    return;
  }

  if (isIOS) {
    updateBanner({
      title: "Instala la app en iPhone",
      text: "Pulsa Compartir y luego Anadir a pantalla de inicio para usar la PWA completa.",
      tone: "info",
      sticky: true,
    });
    return;
  }

  if (isAndroid) {
    updateBanner({
      title: "Instala la app",
      text: "Si tu navegador lo permite, usa Anadir a inicio o Instalar aplicacion desde el menu.",
      actionLabel: "Entendido",
      action: () => ensureAppBanner().classList.add("hidden"),
      tone: "info",
      sticky: true,
    });
    return;
  }

  updateBanner({
    title: "Instalacion disponible",
    text: "Usa la opcion Instalar aplicacion de tu navegador para abrir esta app como PWA.",
    actionLabel: "Entendido",
    action: () => ensureAppBanner().classList.add("hidden"),
    tone: "info",
    sticky: true,
  });
}

async function watchServiceWorkerUpdates(pageName) {
  if (!("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;

    const showUpdate = () =>
      updateBanner({
        title: "Nueva version disponible",
        text: "Hay una actualizacion lista para esta app.",
        actionLabel: "Actualizar",
        action: () => reg.waiting?.postMessage({ type: "SKIP_WAITING" }),
        tone: "success",
        sticky: true,
      });

    const bindInstalling = (worker) => {
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          showUpdate();
        }
      });
    };

    if (reg.waiting) showUpdate();

    reg.addEventListener("updatefound", () => bindInstalling(reg.installing));
    bindInstalling(reg.installing);

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (window.__pwaControllerReloaded) return;
      window.__pwaControllerReloaded = true;
      showToast("App actualizada", `${pageName} ya esta usando la ultima version.`, "success");
      window.location.reload();
    });
  } catch (error) {
    console.warn("PWA update watcher failed:", error);
  }
}

export function initPWAShell(pageName = "app") {
  if (typeof window === "undefined" || window.__pwaShellReady) return;
  window.__pwaShellReady = true;

  let deferredInstallPrompt = null;
  const installButton = ensureInstallButton();
  ensureAppBanner();
  normalizePWACopy();

  registerBestServiceWorkerWithRetry().catch((error) => {
    console.warn("PWA SW register failed:", error);
  });
  watchServiceWorkerUpdates(pageName).catch(() => {});

  if (isStandaloneMode()) {
    try {
      localStorage.setItem(PWA_INSTALLED_FLAG, "1");
    } catch {}
    setInstallButtonVisible(false);
  } else {
    try {
      localStorage.removeItem(PWA_INSTALLED_FLAG);
    } catch {}
    window.setTimeout(() => setInstallButtonVisible(true), 900);
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    setInstallButtonVisible(true);
  });

  window.addEventListener("appinstalled", () => {
    try {
      localStorage.setItem(PWA_INSTALLED_FLAG, "1");
    } catch {}
    deferredInstallPrompt = null;
    setInstallButtonVisible(false);
    updateBanner({
      title: "App instalada",
      text: "La aplicacion ya esta instalada y lista para abrirse como PWA.",
      tone: "success",
    });
    showToast("PWA lista", "La aplicacion ya esta instalada en este dispositivo.", "success");
  });

  installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      showInstallFallback(pageName);
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    setInstallButtonVisible(false);
  });

  window.addEventListener("offline", () => {
    updateBanner({
      title: "Modo sin conexion",
      text: `${pageName} seguira funcionando con lo que ya tengas guardado en el dispositivo.`,
      tone: "warning",
    });
    showToast("Modo offline", `${pageName} seguira disponible con cache local.`, "warning");
  });

  window.addEventListener("online", () => {
    updateBanner({
      title: "Conexion recuperada",
      text: "La app vuelve a sincronizar datos en tiempo real.",
      tone: "success",
    });
    showToast("Conexion restablecida", "La app vuelve a sincronizar datos en tiempo real.", "success");
  });

  window.installPadelApp = async () => installButton.click();
}
