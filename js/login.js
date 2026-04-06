import { login, loginWithGoogle, getDocument, observerAuth, auth } from './firebase-service.js';
import { showToast } from './ui-core.js';
import { initPushNotifications, requestNotificationPermission, showNotificationHelpModal, getPushStatusHuman } from './modules/push-notifications.js';
import { getAppBase } from './modules/path-utils.js';
import { APP_APK_URL } from './app-config.js';

const LOGIN_BOOT_FLAG = '__padelLoginBooted';
const LOGIN_SW_RELOAD_FLAG = '__padelLoginSwReloaded';
const INSTALL_MODAL_AUTOSHOW_KEY = 'padel_install_modal_last_seen';
let deferredInstallPrompt = null;
let resolvedApkUrl = '';

function isStandaloneDisplayMode() {
    return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
}

function isAndroidDevice() {
    return /android/i.test(window.navigator.userAgent || '');
}

function isIosDevice() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || '');
}

function shouldAutoOpenInstallModal() {
    if (isStandaloneDisplayMode()) return false;
    const lastSeen = Number(localStorage.getItem(INSTALL_MODAL_AUTOSHOW_KEY) || 0);
    return Date.now() - lastSeen > 12 * 60 * 60 * 1000;
}

function setInstallHint(message = '') {
    const hint = document.getElementById('installModalHint');
    if (hint) hint.textContent = message;
}

function normalizeApkUrl(url) {
    if (!url) return '';
    try {
        return new URL(url, window.location.href).toString();
    } catch (_) {
        return '';
    }
}

async function canReachApk(url) {
    if (!url) return false;
    try {
        const response = await fetch(url, {
            method: 'HEAD',
            cache: 'no-store',
        });
        return response.ok;
    } catch (_) {
        return false;
    }
}

function getGithubPagesApkCandidates() {
    const host = window.location.hostname || '';
    if (!host.endsWith('.github.io')) return [];

    const owner = host.split('.')[0];
    const parts = window.location.pathname.split('/').filter(Boolean);
    const repo = parts[0] || '';
    if (!owner || !repo) return [];

    return [
        `https://github.com/${owner}/${repo}/releases/latest/download/JafsPadelclub-mobile-release.apk`,
        `https://raw.githubusercontent.com/${owner}/${repo}/main/JafsPadelclub-mobile-release.apk`,
        `https://raw.githubusercontent.com/${owner}/${repo}/master/JafsPadelclub-mobile-release.apk`,
        `https://cdn.jsdelivr.net/gh/${owner}/${repo}@main/JafsPadelclub-mobile-release.apk`,
        `https://cdn.jsdelivr.net/gh/${owner}/${repo}@master/JafsPadelclub-mobile-release.apk`,
    ];
}

async function resolveApkUrl() {
    if (resolvedApkUrl) return resolvedApkUrl;

    const modal = document.getElementById('pwa-install-modal');
    const apkBtn = document.getElementById('downloadApkBtn');
    const modalUrl = modal?.dataset?.apkUrl || '';
    const buttonUrl = apkBtn?.getAttribute('href') || '';
    const candidates = [
        normalizeApkUrl(APP_APK_URL),
        normalizeApkUrl(modalUrl),
        normalizeApkUrl(buttonUrl),
        normalizeApkUrl('./JafsPadelclub-mobile-release.apk'),
        ...getGithubPagesApkCandidates(),
    ].filter(Boolean);

    for (const candidate of [...new Set(candidates)]) {
        if (await canReachApk(candidate)) {
            resolvedApkUrl = candidate;
            return candidate;
        }
    }

    resolvedApkUrl = normalizeApkUrl(modalUrl || buttonUrl || './JafsPadelclub-mobile-release.apk');
    return resolvedApkUrl;
}

async function refreshInstallModalStatus() {
    const modeStatus = document.getElementById('installModeStatus');
    const pushStatus = document.getElementById('installPushStatus');
    const installBtn = document.getElementById('installPwaBtn');
    const apkBtn = document.getElementById('downloadApkBtn');
    const summary = document.getElementById('installModalSummary');
    if (!modeStatus || !pushStatus || !installBtn || !apkBtn) return;
    const apkUrl = await resolveApkUrl();
    if (apkUrl) {
        apkBtn.href = apkUrl;
    }

    const standalone = isStandaloneDisplayMode();
    const hasPrompt = Boolean(deferredInstallPrompt);
    const android = isAndroidDevice();
    const ios = isIosDevice();

    if (standalone) {
        modeStatus.textContent = 'Ya instalada';
        installBtn.disabled = true;
        installBtn.innerHTML = '<i class="fas fa-check"></i> App ya instalada';
    } else if (hasPrompt) {
        modeStatus.textContent = 'Instalable ahora';
        installBtn.disabled = false;
        installBtn.innerHTML = '<i class="fas fa-download"></i> Instalar app web';
    } else if (ios) {
        modeStatus.textContent = 'Añadir a inicio';
        installBtn.disabled = false;
        installBtn.innerHTML = '<i class="fas fa-share-square"></i> Ver pasos para iPhone';
    } else {
        modeStatus.textContent = 'Disponible desde navegador';
        installBtn.disabled = false;
        installBtn.innerHTML = '<i class="fas fa-plus-square"></i> Ver cómo instalar';
    }

    apkBtn.style.display = android ? 'inline-flex' : 'none';
    if (summary) {
        summary.textContent = android
            ? 'Puedes instalar la PWA al instante o bajar la APK Android release si prefieres versión nativa.'
            : 'Instala la PWA desde el navegador y revisa desde aquí si los avisos en segundo plano están listos.';
    }

    try {
        const pushHuman = await getPushStatusHuman();
        pushStatus.textContent = pushHuman.ok ? 'Listos en 2o plano' : pushHuman.title;
        setInstallHint(pushHuman.ok ? 'Tus avisos deberían llegar aunque no tengas la portada abierta.' : pushHuman.message);
    } catch (_) {
        pushStatus.textContent = 'Revisar permisos';
        setInstallHint('Comprueba permisos y vuelve a pulsar en avisos si no te llegan en segundo plano.');
    }
}

function openInstallModal() {
    const modal = document.getElementById('pwa-install-modal');
    if (!modal) return;
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    localStorage.setItem(INSTALL_MODAL_AUTOSHOW_KEY, String(Date.now()));
    refreshInstallModalStatus().catch(() => {});
}

function closeInstallModal() {
    const modal = document.getElementById('pwa-install-modal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
}

async function handleInstallAction() {
    if (isStandaloneDisplayMode()) {
        notifyUser('APP INSTALADA', 'Ya puedes abrirla desde el icono de tu móvil.', 'success');
        closeInstallModal();
        return;
    }

    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice.catch(() => null);
        deferredInstallPrompt = null;
        await refreshInstallModalStatus();
        if (choice?.outcome === 'accepted') {
            notifyUser('INSTALACIÓN LISTA', 'La app se está añadiendo a tu dispositivo.', 'success');
            closeInstallModal();
        } else {
            setInstallHint('Puedes instalarla más tarde desde este mismo botón o descargar la APK si estás en Android.');
        }
        return;
    }

    if (isIosDevice()) {
        setInstallHint('En iPhone usa Compartir > Añadir a pantalla de inicio para instalar la app.');
        notifyUser('INSTALACIÓN EN IPHONE', 'Abre compartir y elige “Añadir a pantalla de inicio”.', 'info');
        return;
    }

    setInstallHint('Si el navegador no muestra instalación automática, usa el menú de los 3 puntos y elige “Instalar aplicación”.');
    notifyUser('INSTALACIÓN MANUAL', 'Busca “Instalar aplicación” o “Añadir a pantalla de inicio” en tu navegador.', 'info');
}

function setupInstallModal() {
    const trigger = document.getElementById('openInstallModal');
    const modal = document.getElementById('pwa-install-modal');
    const closeBtn = document.getElementById('closeInstallModal');
    const installBtn = document.getElementById('installPwaBtn');
    const pushBtn = document.getElementById('enablePushBtn');
    const apkBtn = document.getElementById('downloadApkBtn');
    if (!trigger || !modal || !closeBtn || !installBtn || !pushBtn || !apkBtn) return;

    trigger.addEventListener('click', openInstallModal);
    closeBtn.addEventListener('click', closeInstallModal);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeInstallModal();
    });
    installBtn.addEventListener('click', () => {
        handleInstallAction().catch(() => {
            setInstallHint('No se pudo abrir la instalación automática. Usa el menú del navegador o la APK Android.');
        });
    });
    pushBtn.addEventListener('click', async () => {
        try {
            await requestNotificationPermission(true);
            await refreshInstallModalStatus();
            showNotificationHelpModal();
        } catch (_) {
            showNotificationHelpModal();
        }
    });
    apkBtn.addEventListener('click', () => {
        const apkUrl = apkBtn.getAttribute('href') || '';
        if (!apkUrl) {
            setInstallHint('No encontré la APK publicada todavía. Revisa la ruta de descarga.');
            return;
        }
        setInstallHint('Android descargará la APK. Si te lo pide, permite instalar apps desde este navegador.');
    });

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferredInstallPrompt = event;
        refreshInstallModalStatus().catch(() => {});
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        notifyUser('APP INSTALADA', 'Padeluminatis ya aparece como app en tu dispositivo.', 'success');
        refreshInstallModalStatus().catch(() => {});
        closeInstallModal();
    });

    refreshInstallModalStatus().catch(() => {});
    if ((isAndroidDevice() || isIosDevice()) && shouldAutoOpenInstallModal()) {
        setTimeout(() => openInstallModal(), 900);
    }
}

function initAuthPageServiceWorker() {
    if (window.Capacitor?.isNativePlatform?.()) return;
    if (!('serviceWorker' in navigator) || window.__swRegisterBound) return;
    window.__swRegisterBound = true;

    const base = getAppBase();
    const swPath = `${base}OneSignalSDKWorker.js`;

    navigator.serviceWorker.register(swPath, { 
        scope: base,
        updateViaCache: 'none' 
    }).then((reg) => {
        reg.update().catch(() => {});
    }).catch((err) => console.error('SW auth register error:', err));
}

function withTimeout(promise, ms = 15000) {
    let timer = null;
    const timeoutErr = { code: 'auth/network-timeout' };
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutErr), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function safeNavigate(url) {
    if (typeof window === 'undefined') return;
    if (window.__appRedirectLock) return;
    const current = (window.location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const target = String(url || '').split('?')[0].toLowerCase();
    if (!target || current === target) return;
    window.__appRedirectLock = true;
    window.location.replace(url);
}

function ensureLoginNoticeNode() {
    let node = document.getElementById('login-notice');
    if (node) return node;

    const host = document.getElementById('login-form-card') || document.querySelector('.auth-card') || document.body;
    node = document.createElement('div');
    node.id = 'login-notice';
    node.style.display = 'none';
    node.style.marginBottom = '12px';
    node.style.padding = '12px 14px';
    node.style.borderRadius = '12px';
    node.style.fontSize = '0.82rem';
    node.style.fontWeight = '700';
    node.style.lineHeight = '1.35';
    node.style.border = '1px solid rgba(255,255,255,0.2)';
    node.style.background = 'rgba(15,23,42,0.75)';
    node.style.color = '#e2e8f0';
    node.setAttribute('role', 'alert');
    node.setAttribute('aria-live', 'assertive');
    host.prepend(node);
    return node;
}

function hideLoginNotice() {
    const node = document.getElementById('login-notice');
    if (!node) return;
    node.style.display = 'none';
    node.textContent = '';
}

function showLoginNotice(title, msg, type = 'error') {
    const node = ensureLoginNoticeNode();
    const palette = {
        error: { bg: 'rgba(127,29,29,0.55)', border: 'rgba(239,68,68,0.75)', color: '#fecaca' },
        warning: { bg: 'rgba(120,53,15,0.55)', border: 'rgba(245,158,11,0.75)', color: '#fde68a' },
        info: { bg: 'rgba(8,47,73,0.55)', border: 'rgba(14,165,233,0.75)', color: '#bae6fd' },
    };
    const tone = palette[type] || palette.error;
    node.style.background = tone.bg;
    node.style.borderColor = tone.border;
    node.style.color = tone.color;
    node.textContent = msg ? `${title}: ${msg}` : title;
    node.style.display = 'block';
}

function notifyUser(title, msg = '', type = 'info') {
    try { showToast(title, msg, type); } catch (_) {}
    if (type === 'error' || type === 'warning') showLoginNotice(title, msg, type);
    else hideLoginNotice();
}

function showCenteredWelcomeToast(userName) {
    const existing = document.getElementById('welcome-entry-toast');
    if (existing) existing.remove();
    const node = document.createElement('div');
    node.id = 'welcome-entry-toast';
    node.className = 'welcome-entry-toast';
    node.innerHTML = `
        <div class="welcome-entry-card">
            <div class="welcome-entry-title">Bienvenido de nuevo</div>
            <div class="welcome-entry-sub">${String(userName || 'Jugador').toUpperCase()}</div>
        </div>
    `;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2100);
}

document.addEventListener('DOMContentLoaded', () => {
    if (window[LOGIN_BOOT_FLAG]) return;
    window[LOGIN_BOOT_FLAG] = true;
    initAuthPageServiceWorker();
    initPushNotifications().catch(() => {});
    setupInstallModal();

    let authTransitionInProgress = false;
    let redirected = false;

    // Check if redirecting due to pending status
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('msg') === 'pending') {
        notifyUser('ACCESO RESTRINGIDO', 'Tu cuenta está pendiente de aprobación por el administrador.', 'warning');
    }

    // Check if already logged in
    observerAuth((user) => {
        if (redirected || authTransitionInProgress) return;

        if (user) {
            // But verify approval if already logged in
            getDocument('usuarios', user.uid)
                .then(ud => {
                    if (!ud) {
                        notifyUser('SINCRONIZACIÓN', 'No se pudo validar tu perfil. Revisa conexión y vuelve a intentar.', 'warning');
                        authTransitionInProgress = false;
                        const ldr = document.getElementById('master-loader');
                        if (ldr) ldr.style.display = 'none';
                        return;
                    }
                    const isApproved = ud?.status === 'approved' || ud?.aprobado === true || ud?.rol === 'Admin';
                    if (isApproved) {
                        redirected = true;
                        startSpectacularLoading(ud?.nombreUsuario || ud?.nombre || 'JUGADOR');
                    } else {
                        // Force sign out if pending
                        auth.signOut().then(() => {
                            notifyUser('ACCESO DENEGADO', 'Tu cuenta está pendiente de aprobación.', 'warning');
                            authTransitionInProgress = false;
                            const ldr = document.getElementById('master-loader');
                            if (ldr) ldr.style.display = 'none';
                        }).catch(() => {
                            authTransitionInProgress = false;
                            const ldr = document.getElementById('master-loader');
                            if (ldr) ldr.style.display = 'none';
                        });
                    }
                })
                .catch(() => {
                    notifyUser('SIN CONEXIÓN', 'No se pudo comprobar el estado de tu cuenta.', 'error');
                    authTransitionInProgress = false;
                    const ldr = document.getElementById('master-loader');
                    if (ldr) ldr.style.display = 'none';
                });
        } else {
            // No user, hide loader to show login form
            const ldr = document.getElementById('master-loader');
            if (ldr) ldr.style.display = 'none';
        }
    });

    const loginForm = document.getElementById('loginForm');
    const googleBtn = document.getElementById('googleLogin');
    const togglePass = document.getElementById('togglePassword');
    const passInp = document.getElementById('password');

    if (togglePass) {
        togglePass.onclick = () => {
            const isPass = passInp.type === 'password';
            passInp.type = isPass ? 'text' : 'password';
            togglePass.classList.toggle('fa-eye');
            togglePass.classList.toggle('fa-eye-slash');
        };
    }

    if (loginForm) {
        loginForm.onsubmit = async (e) => {
            e.preventDefault();
            const identifier = document.getElementById('email').value.trim();
            const password = passInp.value;
            const submitBtn = loginForm.querySelector('button[type="submit"]');

            if (!identifier || !password) {
                notifyUser('DATOS INCOMPLETOS', 'Introduce usuario/email y contraseña.', 'warning');
                return;
            }

            // Feedback: Disable button and show loading
            const originalBtnContent = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span>ACCEDIENDO...</span><i class="fas fa-spinner fa-spin text-xs opacity-50"></i>`;
            notifyUser('ACCEDIENDO...', 'Verificando credenciales en la Matrix.', 'info');
            authTransitionInProgress = true;

            try {
                // Use central login helper (supports Username or Email)
                const userCred = await withTimeout(login(identifier, password), 15000);
                const userDoc = await getDocument('usuarios', userCred.user.uid);
                if (!userDoc) {
                    await auth.signOut().catch(() => {});
                    notifyUser('SINCRONIZACIÓN', 'No se pudo validar tu perfil. Intenta de nuevo cuando tengas red estable.', 'error');
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnContent;
                    authTransitionInProgress = false;
                    return;
                }
                
                // AUDIT: Check Approval Status
                const isApproved = userDoc?.status === 'approved' || userDoc?.rol === 'Admin'; 
                if (!isApproved) {
                    await auth.signOut();
                    notifyUser('ACCESO RESTRINGIDO', 'Tu cuenta está pendiente de aprobación por el administrador.', 'warning');
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnContent;
                    authTransitionInProgress = false;
                    return;
                }

                const userName = userDoc?.nombreUsuario || userDoc?.nombre || 'JUGADOR';
                showCenteredWelcomeToast(userName);
                
                setTimeout(() => {
                    redirected = true;
                    startSpectacularLoading(userName);
                }, 800);

            } catch (err) {
                console.error("Login fail:", err);
                let { title, msg } = getFriendlyErrorMessage(err.code);
                
                notifyUser(title, msg, 'error');
                
                // Restore button
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnContent;
                authTransitionInProgress = false;
            }
        };
    }

    if (googleBtn) {
        googleBtn.onclick = async () => {
            const originalGoogleContent = googleBtn.innerHTML;
            googleBtn.disabled = true;
            googleBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Conectando...`;
            notifyUser('ACCEDIENDO...', 'Iniciando autenticación con Google.', 'info');
            authTransitionInProgress = true;
            try {
                const user = await withTimeout(loginWithGoogle(), 20000);
                if (user) {
                    const userDoc = await getDocument('usuarios', user.uid);
                    if (!userDoc) {
                        await auth.signOut().catch(() => {});
                        notifyUser('SINCRONIZACIÓN', 'No se pudo validar el perfil de Google. Reintenta con conexión estable.', 'error');
                        authTransitionInProgress = false;
                        return;
                    }
                    
                    // AUDIT: Check Approval Status
                    const isApproved = userDoc?.status === 'approved' || userDoc?.rol === 'Admin';
                    if (!isApproved) {
                        await auth.signOut();
                        notifyUser('ACCESO RESTRINGIDO', 'Tu cuenta está pendiente de aprobación por el administrador.', 'warning');
                        authTransitionInProgress = false;
                        return;
                    }

                    const userName = userDoc?.nombreUsuario || userDoc?.nombre || 'LEYENDA';
                    showCenteredWelcomeToast(userName);
                    redirected = true;
                    setTimeout(() => startSpectacularLoading(userName), 700);
                }
            } catch (err) {
                if (err.code !== 'auth/popup-closed-by-user') {
                    notifyUser('FALLA EN GOOGLE', 'No se pudo sincronizar.', 'error');
                }
                authTransitionInProgress = false;
            } finally {
                googleBtn.disabled = false;
                googleBtn.innerHTML = originalGoogleContent;
            }
        };
    }
});

function startSpectacularLoading(userName) {
    const loader = document.getElementById('master-loader');
    const fill = document.getElementById('progress-fill');
    const status = document.getElementById('loader-status');
    const loginCard = document.getElementById('login-form-card');
    const authScreen = document.querySelector('.auth-screen');
    const percentEl = document.querySelector('.loader-percentage');

    if (!loader || !fill || !status) {
        localStorage.setItem('first_login_welcome', userName);
        safeNavigate('home.html');
        return;
    }

    document.documentElement.classList.add('auth-transitioning');
    document.body.classList.add('auth-transitioning');
    if (loginCard) loginCard.style.opacity = '0';
    if (authScreen) authScreen.style.display = 'none';
    document.body.style.overflow = 'hidden';
    loader.style.display = 'flex';

    let progress = 0;
    const messages = [
        "Iniciando protocolos...",
        "Sincronizando con la red...",
        "Cargando estadísticas...",
        "Preparando pista central...",
        `BIENVENIDO DE NUEVO, ${userName.toUpperCase()}`
    ];

    const interval = setInterval(() => {
        progress += Math.floor(Math.random() * 8) + 1;
        if (progress >= 100) {
            progress = 100;
            clearInterval(interval);
            status.textContent = `Bienvenido de nuevo ${userName}`;
            setTimeout(() => {
                // Set flag to show welcome on home just once
                localStorage.setItem('first_login_welcome', userName);
                sessionStorage.setItem('home_entry_welcome', userName);
                safeNavigate('home.html');
            }, 800);
        }

        fill.style.width = `${progress}%`;
        if (percentEl) percentEl.textContent = `${progress}%`;
        
        const msgIdx = Math.min(Math.floor(progress / 20), messages.length - 1);
        status.textContent = messages[msgIdx];
    }, 45);
}

/**
 * Maps Firebase Auth error codes to human-friendly Spanish messages.
 */
function getFriendlyErrorMessage(code) {
    switch (code) {
        case 'auth/user-not-found': 
            return { title: 'USUARIO INEXISTENTE', msg: 'Ese usuario no existe en la base de datos.' };
        case 'auth/wrong-password': 
            return { title: 'CONTRASEÑA ERRÓNEA', msg: 'La contraseña introducida es incorrecta.' };
        case 'auth/invalid-email':
            return { title: 'FORMATO INVÁLIDO', msg: 'El formato del email no es correcto.' };
        case 'auth/invalid-credential': 
            return { title: 'ERROR DE ACCESO', msg: 'Credenciales inválidas o expiradas.' };
        case 'auth/too-many-requests': 
            return { title: 'BLOQUEO TEMPORAL', msg: 'Demasiados intentos. Prueba en unos minutos.' };
        case 'auth/network-request-failed':
            return { title: 'FALLO DE RED', msg: 'Sin conexión. Revisa tu internet.' };
        case 'auth/network-timeout':
            return { title: 'TIEMPO DE ESPERA', msg: 'El servidor tardó demasiado. Revisa tu conexión e inténtalo de nuevo.' };
        case 'permission-denied':
        case 'auth/insufficient-permission':
            return { title: 'PERMISOS', msg: 'Tu cuenta no tiene permisos para completar esta acción.' };
        case 'failed-precondition':
            return { title: 'CONFIGURACIÓN', msg: 'Falta configuración de Firebase (índices/reglas) para completar la operación.' };
        default: 
            return { title: 'ERROR DESCONOCIDO', msg: 'No se pudo iniciar sesión. Revisa los datos.' };
    }
}
