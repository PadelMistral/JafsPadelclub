// ui-core.js - Unified Application Guard & Portal Management (v2.0)
import { observerAuth, getDocument, subscribeCol } from './firebase-service.js';

const PUBLIC_PAGES = ['index.html', 'registro.html', 'recuperar.html'];

function requestWaitingServiceWorkerActivation(reg) {
    if (!reg?.waiting) return;
    try {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch (err) {
        console.warn('SW waiting activation failed:', err);
    }
}

function bindServiceWorkerUpdateFlow(reg) {
    if (!reg || reg.__autoUpdateBound) return;
    reg.__autoUpdateBound = true;

    const bindInstalling = (worker) => {
        if (!worker || worker.__swStateBound) return;
        worker.__swStateBound = true;
        worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                requestWaitingServiceWorkerActivation(reg);
            }
        });
    };

    if (reg.installing) bindInstalling(reg.installing);
    reg.addEventListener('updatefound', () => bindInstalling(reg.installing));

    if (reg.waiting) {
        requestWaitingServiceWorkerActivation(reg);
    }
}

function triggerSingleSwReload(reason = 'sw-update') {
    if (typeof window === 'undefined') return;
    if (window.__swReloadTriggered) return;
    window.__swReloadTriggered = true;
    console.log(`SW reload trigger: ${reason}`);
    setTimeout(() => window.location.reload(), 150);
}

function safeNavigate(url) {
    if (typeof window === 'undefined') return;
    if (window.__appRedirectLock) return;
    const current = (window.location.pathname.split('/').pop() || '').toLowerCase();
    const target = String(url || '').split('?')[0].toLowerCase();
    if (!target || current === target) return;
    window.__appRedirectLock = true;
    window.location.replace(url);
}

if (typeof window !== 'undefined' && !window.viewProfile) {
    window.viewProfile = (uid) => {
        if (!uid) return;
        window.location.href = `perfil.html?uid=${uid}`;
    };
}

/**
 * Shared UI Initialization
 */
export function initAppUI(activePageName) {
    if (typeof window !== 'undefined') {
        const currentPath = (window.location.pathname || '').toLowerCase();
        if (window.__appUIInitPath === currentPath) return;
        window.__appUIInitPath = currentPath;
    }

    // Register Service Worker for PWA + automatic updates
    if ('serviceWorker' in navigator && !window.__swRegisterBound) {
        window.__swRegisterBound = true;

        if (!window.__swControllerChangeBound) {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                triggerSingleSwReload('controllerchange');
            });
            window.__swControllerChangeBound = true;
        }

        const registerSW = () => {
            navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
                .then(reg => {
                    window.__swRegisteredByCore = true;
                    window.__swRegRef = reg;
                    console.log('🚀 Service Worker Register: Active', reg.scope);

                    bindServiceWorkerUpdateFlow(reg);
                    reg.update().catch(() => {});

                    if (!window.__swPeriodicUpdateBound) {
                        window.__swPeriodicUpdateBound = true;
                        setInterval(() => {
                            const currentReg = window.__swRegRef;
                            if (currentReg?.update) currentReg.update().catch(() => {});
                        }, 5 * 60 * 1000);

                        document.addEventListener('visibilitychange', () => {
                            if (document.visibilityState !== 'visible') return;
                            const currentReg = window.__swRegRef;
                            if (currentReg?.update) currentReg.update().catch(() => {});
                        });
                    }

                    navigator.serviceWorker.ready
                        .then((readyReg) => bindServiceWorkerUpdateFlow(readyReg))
                        .catch(() => {});
                })
                .catch(err => console.error('SW Register Error:', err));
        };

        if (document.readyState === 'complete') registerSW();
        else window.addEventListener('load', registerSW, { once: true });
    }

    const path = window.location.pathname.toLowerCase();
    const isPublic = PUBLIC_PAGES.some(p => path.includes(p)) || path.endsWith('/') || path === '';

    // Only inject UI in PRIVATE pages if not already present
    if (!isPublic) {
        // Smooth reveal instead of harsh opacity swap (prevents flicker)
        document.body.style.transition = 'opacity 0.35s ease';
        document.body.style.opacity = '0';
        document.body.style.pointerEvents = 'none';
    }

    let authResolved = false;
    // Safety net: if auth never resolves, at least render the shell
    if (!isPublic) {
        setTimeout(() => {
            if (!authResolved) {
                console.warn("Auth did not resolve in time. Showing UI shell.");
                document.body.style.opacity = '1';
                document.body.style.pointerEvents = 'auto';
            }
        }, 2000);
    }

    observerAuth(async (user) => {
        authResolved = true;
        console.log("Auth State Changed. User:", !!user, "Path:", path);

        if (user) {
            document.body.style.opacity = '1';
            document.body.style.pointerEvents = 'auto';
            // Logged in user on index/login -> Redirect to Home
            if (isPublic && !path.includes('registro.html') && !path.includes('recuperar.html') && !path.includes('terms.html')) {
                console.log("Redirecting to home (Logged in)");
                safeNavigate('home.html');
                return;
            }
            
            // Fill data
            try {
                const { injectHeader, injectNavbar, updateHeader } = await import('./modules/ui-loader.js?v=6.5');
                const userData = await getDocument("usuarios", user.uid);
                
                // Always inject for private pages
                if (!isPublic) {
                    injectHeader(userData);
                    injectNavbar(activePageName || 'home');
                }

                if (userData) {
                    updateHeader(userData);
                    listenToGlobalNotifs(user.uid);
                }
            } catch (e) {
                console.error("Error loading user data:", e);
            }
        } else {
            // Guest user on private page -> Redirect to Index
            if (!isPublic) {
                console.log("Redirecting to login (Not logged in)");
                safeNavigate('index.html');
            }
        }
    });
}

function listenToGlobalNotifs(uid) {
    const badge = document.getElementById('notif-badge');
    if (!badge || !uid) return;

    if (window.__notifBadgeUid === uid && typeof window.__notifBadgeUnsub === 'function') return;

    if (typeof window.__notifBadgeUnsub === 'function') {
        try { window.__notifBadgeUnsub(); } catch (_) {}
        window.__notifBadgeUnsub = null;
    }

    window.__notifBadgeUid = uid;
    window.__notifBadgeManagedByUICore = true;

    Promise.resolve(
        subscribeCol("notificaciones", (list) => {
            const unread = list.filter(n => !n.leido && !n.read).length;
            if (unread > 0) {
                badge.style.display = 'flex';
                badge.textContent = unread > 9 ? '9+' : unread;
                badge.classList.add('animate-pulse');
            } else {
                badge.style.display = 'none';
                badge.classList.remove('animate-pulse');
            }
        }, [['destinatario', '==', uid]])
    ).then((unsub) => {
        if (window.__notifBadgeUid !== uid) {
            if (typeof unsub === 'function') {
                try { unsub(); } catch (_) {}
            }
            return;
        }
        window.__notifBadgeUnsub = typeof unsub === 'function' ? unsub : null;
    }).catch(() => {});
}

function ensureToastContainerStyles(container) {
    if (!container || typeof window === 'undefined') return;
    const styles = window.getComputedStyle(container);
    const needsFallback = styles.position === 'static' || Number(styles.zIndex || 0) < 1000;
    if (!needsFallback) return;

    container.style.position = 'fixed';
    container.style.top = 'calc(72px + env(safe-area-inset-top, 0px))';
    container.style.right = '12px';
    container.style.left = window.innerWidth <= 640 ? '12px' : 'auto';
    container.style.maxWidth = window.innerWidth <= 640 ? 'none' : '360px';
    container.style.zIndex = '99999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '10px';
    container.style.pointerEvents = 'none';
}

function getOrCreateToastContainer() {
    if (typeof document === 'undefined') return null;

    let container = document.getElementById('app-toast-root');
    const allContainers = Array.from(document.querySelectorAll('.toast-container'));

    if (!container) {
        container = allContainers[0] || document.createElement('div');
        if (!container.parentNode) document.body.appendChild(container);
        container.id = 'app-toast-root';
        container.classList.add('toast-container');
    }

    allContainers.forEach((node) => {
        if (node === container) return;
        while (node.firstChild) container.appendChild(node.firstChild);
        node.remove();
    });

    ensureToastContainerStyles(container);
    return container;
}

function ensureToastItemStyles(toast, type) {
    if (!toast || typeof window === 'undefined') return;
    const styles = window.getComputedStyle(toast);
    const looksUnstyled = styles.backgroundColor === 'rgba(0, 0, 0, 0)' || styles.borderStyle === 'none';
    if (!looksUnstyled) return;

    const borders = {
        success: '#22c55e',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#00d4ff',
    };

    toast.style.display = 'flex';
    toast.style.alignItems = 'flex-start';
    toast.style.gap = '12px';
    toast.style.padding = '14px 16px';
    toast.style.borderRadius = '14px';
    toast.style.background = 'rgba(15, 23, 42, 0.96)';
    toast.style.border = `1px solid ${borders[type] || borders.info}`;
    toast.style.color = '#e2e8f0';
    toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.45)';
    toast.style.pointerEvents = 'auto';
}

/**
 * Spectacular Toast System
 */
export function showToast(title, body, type = 'info') {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const TOAST_TYPES = new Set(['success', 'error', 'warning', 'info']);
    let normalizedTitle = typeof title === 'string' ? title.trim() : '';
    let normalizedBody = typeof body === 'string' ? body.trim() : '';
    let normalizedType = typeof type === 'string' ? type.trim().toLowerCase() : 'info';

    // Backward compatibility:
    // showToast("Mensaje", "success")
    if (!normalizedBody && typeof body === 'string' && TOAST_TYPES.has(body.toLowerCase())) {
        normalizedType = body.toLowerCase();
    }

    // Another legacy pattern: showToast("Mensaje", "warning")
    if (typeof body === 'string' && TOAST_TYPES.has(body.toLowerCase()) && (type === undefined || type === 'info')) {
        normalizedType = body.toLowerCase();
        normalizedBody = '';
    }

    if (!TOAST_TYPES.has(normalizedType)) normalizedType = 'info';
    if (!normalizedTitle) normalizedTitle = 'Notificación';

    if (!window.__toastDedupMap) window.__toastDedupMap = new Map();
    const dedupKey = `${normalizedType}|${normalizedTitle}|${normalizedBody}`;
    const now = Date.now();
    const prev = window.__toastDedupMap.get(dedupKey) || 0;
    if (now - prev < 700) return;
    window.__toastDedupMap.set(dedupKey, now);

    const container = getOrCreateToastContainer();
    if (!container) return;

    const isAuthPage = !!document.body?.classList?.contains('body-auth');
    if (isAuthPage) {
        container.querySelectorAll('.toast').forEach((t) => t.remove());
    }

    const toast = document.createElement('div');
    toast.className = `toast ${normalizedType}`;
    toast.setAttribute('role', normalizedType === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', normalizedType === 'error' ? 'assertive' : 'polite');
    
    let icon = 'fa-info-circle';
    if(normalizedType === 'success') icon = 'fa-check-circle';
    if(normalizedType === 'error') icon = 'fa-exclamation-triangle';
    if(normalizedType === 'warning') icon = 'fa-exclamation-circle';

    const esc = (v) => String(v || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    toast.innerHTML = `
        <i class="fas ${icon} toast-icon"></i>
        <div class="toast-content">
            <div class="toast-title">${esc(normalizedTitle)}</div>
            ${normalizedBody ? `<div class="toast-msg">${esc(normalizedBody)}</div>` : ''}
        </div>
        <button class="toast-close-btn" aria-label="Cerrar notificación">&times;</button>
    `;
    ensureToastItemStyles(toast, normalizedType);

    container.appendChild(toast);
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        toast.style.animation = 'toastOut 0.4s forwards';
        setTimeout(() => toast.remove(), 400);
    };

    toast.querySelector('.toast-close-btn')?.addEventListener('click', close);
    const ttl = isAuthPage ? 4600 : (normalizedType === 'error' || normalizedType === 'warning' ? 5200 : 3800);
    setTimeout(close, ttl);

}

if (typeof window !== 'undefined') {
    window.__appToast = showToast;
}

/**
 * Text Animation Utils
 */
export function countUp(el, target, duration = 2000) {
    if (!el) return;
    const endValue = Number(target);
    if (isNaN(endValue)) { el.textContent = target; return; }

    let startTime = null;
    function animation(currentTime) {
        if (!startTime) startTime = currentTime;
        const progress = Math.min((currentTime - startTime) / duration, 1);
        const current = progress * endValue;
        el.textContent = endValue % 1 === 0 ? Math.floor(current) : current.toFixed(2);
        if (progress < 1) requestAnimationFrame(animation);
    }
    requestAnimationFrame(animation);
}

