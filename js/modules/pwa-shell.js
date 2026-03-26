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
  button.setAttribute("aria-label", "Instalar aplicación");
  button.setAttribute("title", "Instalar App");

  // FAB pequeño circular en esquina inferior derecha
  const style = document.createElement("style");
  style.textContent = `
    #pwa-install-launcher {
      position: fixed !important;
      bottom: calc(88px + env(safe-area-inset-bottom, 8px)) !important;
      right: 20px !important;
      z-index: 999999 !important;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 1.5px solid rgba(198,255,0,0.5);
      background: rgba(8, 14, 30, 0.94);
      color: #c6ff00;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 12px rgba(198,255,0,0.15);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      transition: opacity 0.3s ease, transform 0.3s ease;
      animation: fabPulse 3s ease-in-out infinite;
    }
    #pwa-install-launcher.hidden {
      opacity: 0 !important;
      transform: scale(0.7) translateY(20px) !important;
      pointer-events: none !important;
    }
    #pwa-install-launcher:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 24px rgba(0,0,0,0.6), 0 0 20px rgba(198,255,0,0.3);
    }
    @keyframes fabPulse {
      0%, 100% { box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 8px rgba(198,255,0,0.15); }
      50% { box-shadow: 0 4px 24px rgba(0,0,0,0.5), 0 0 18px rgba(198,255,0,0.35); }
    }
  `;
  document.head.appendChild(style);

  button.innerHTML = `<i class="fas fa-download" style="font-size:16px"></i>`;
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
      <div class="app-shell-banner__icon-wrap">
        <span class="app-shell-banner__dot"></span>
        <i class="fas fa-microchip app-shell-banner__bg-icon"></i>
      </div>
      <div class="app-shell-banner__copy">
        <strong id="app-shell-banner-title" class="font-display uppercase tracking-widest text-[11px]">Sistema</strong>
        <span id="app-shell-banner-text" class="font-body text-[10px] opacity-70">Sincronizando...</span>
      </div>
    </div>
    <div class="app-shell-banner__actions">
      <button id="app-shell-banner-action" type="button" class="app-shell-banner__btn hidden">Actualizar</button>
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
      // Avoid reload loops: check if we already reloaded in this session or very recently
      if (window.__pwaControllerReloaded) return;
      
      const lastReload = sessionStorage.getItem('pwa_auto_reload_ts');
      const now = Date.now();
      if (lastReload && (now - parseInt(lastReload)) < 10000) {
        console.warn("Skipping PWA auto-reload to prevent loop.");
        return;
      }
      
      window.__pwaControllerReloaded = true;
      sessionStorage.setItem('pwa_auto_reload_ts', now.toString());
      
      showToast("Actualizando", `Aplicando nueva version del sistema...`, "success");
      setTimeout(() => {
        window.location.reload();
      }, 800);
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
