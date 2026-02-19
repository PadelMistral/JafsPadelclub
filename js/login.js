import { login, loginWithGoogle, getDocument, observerAuth, auth } from './firebase-service.js';
import { showToast } from './ui-core.js';
import { initPushNotifications } from './modules/push-notifications.js';

const LOGIN_BOOT_FLAG = '__padelLoginBooted';
const LOGIN_SW_RELOAD_FLAG = '__padelLoginSwReloaded';

function initAuthPageServiceWorker() {
    if (!('serviceWorker' in navigator) || window.__swRegisterBound) return;
    window.__swRegisterBound = true;

    const activateWaiting = (reg) => {
        if (!reg?.waiting) return;
        try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (_) {}
    };

    const bindInstall = (reg) => {
        if (!reg) return;
        const worker = reg.installing;
        if (!worker || worker.__authSwBound) return;
        worker.__authSwBound = true;
        worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                activateWaiting(reg);
            }
        });
    };

    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
        activateWaiting(reg);
        reg.addEventListener('updatefound', () => bindInstall(reg));
        bindInstall(reg);
        reg.update().catch(() => {});
    }).catch((err) => console.error('SW auth register error:', err));

    if (!window.__swControllerChangeBoundAuth) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (window[LOGIN_SW_RELOAD_FLAG]) return;
            window[LOGIN_SW_RELOAD_FLAG] = true;
            setTimeout(() => window.location.reload(), 120);
        });
        window.__swControllerChangeBoundAuth = true;
    }
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

document.addEventListener('DOMContentLoaded', () => {
    if (window[LOGIN_BOOT_FLAG]) return;
    window[LOGIN_BOOT_FLAG] = true;
    initAuthPageServiceWorker();
    initPushNotifications().catch(() => {});

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
                        return;
                    }
                    const isApproved = ud?.status === 'approved' || ud?.aprobado === true || ud?.rol === 'Admin';
                    if (isApproved) {
                        redirected = true;
                        safeNavigate('home.html');
                    } else {
                        // Force sign out if pending
                        auth.signOut().then(() => {
                            notifyUser('ACCESO DENEGADO', 'Tu cuenta está pendiente de aprobación.', 'warning');
                            authTransitionInProgress = false;
                        }).catch(() => {
                            authTransitionInProgress = false;
                        });
                    }
                })
                .catch(() => {
                    notifyUser('SIN CONEXIÓN', 'No se pudo comprobar el estado de tu cuenta.', 'error');
                    authTransitionInProgress = false;
                });
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
                notifyUser('ÉXITO', `Bienvenido de nuevo, ${userName.toUpperCase()}`, 'success');
                
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
                    redirected = true;
                    startSpectacularLoading(userName);
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

    if (!loader || !fill || !status) {
        localStorage.setItem('first_login_welcome', userName);
        safeNavigate('home.html');
        return;
    }

    if (loginCard) loginCard.style.opacity = '0';
    loader.style.display = 'flex';

    let progress = 0;
    const messages = [
        "Iniciando protocolos...",
        "Sincronizando con la red...",
        "Cargando estadísticas...",
        "Preparando pista central...",
        `BIENVENIDO, ${userName.toUpperCase()}`
    ];

    const interval = setInterval(() => {
        progress += Math.floor(Math.random() * 8) + 1;
        if (progress >= 100) {
            progress = 100;
            clearInterval(interval);
            setTimeout(() => {
                // Set flag to show welcome on home just once
                localStorage.setItem('first_login_welcome', userName);
                safeNavigate('home.html');
            }, 800);
        }

        fill.style.width = `${progress}%`;
        
        const msgIdx = Math.min(Math.floor(progress / 20), messages.length - 1);
        status.textContent = messages[msgIdx];
    }, 45);
}

/**
 * Maps Firebase Auth error codes to human-friendly Spanish messages.
 */
function getFriendlyErrorMessage(code) {
    console.log("Firebase Error Code:", code);
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


