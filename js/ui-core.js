// ui-core.js - Unified Application Guard & Portal Management (v2.0)
import { observerAuth, getDocument, subscribeCol } from './firebase-service.js';
import { injectHeader, injectNavbar } from './modules/ui-loader.js?v=6.5';

const PUBLIC_PAGES = ['index.html', 'registro.html', 'recuperar.html'];

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
    // Register Service Worker for PWA & Background Notifications
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => {
                    console.log('🚀 Service Worker Register: Active', reg.scope);
                    // Check for updates
                    reg.onupdatefound = () => {
                        const installingWorker = reg.installing;
                        installingWorker.onstatechange = () => {
                            if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                console.log('Matrix Update Available. Please refresh.');
                            }
                        };
                    };
                })
                .catch(err => console.error('SW Register Error:', err));
        });
    }

    const path = window.location.pathname.toLowerCase();
    const isPublic = PUBLIC_PAGES.some(p => path.includes(p)) || path.endsWith('/') || path === '';

    // Only inject UI in PRIVATE pages if not already present
    if (!isPublic) {
        // We defer injection to the Auth state to have user data
        // Immediate protection
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
        }, 4000);
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
                window.location.href = 'home.html';
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
                window.location.href = 'index.html';
            }
        }
    });
}

function listenToGlobalNotifs(uid) {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    
    subscribeCol("notificaciones", (list) => {
        const unread = list.filter(n => !n.leido && !n.read).length;
        if (unread > 0) {
            badge.style.display = 'flex';
            badge.textContent = unread > 9 ? '9+' : unread;
            badge.classList.add('animate-pulse');
        } else {
            badge.style.display = 'none';
        }
    }, [['destinatario', '==', uid]]);
}

/**
 * Spectacular Toast System
 */
export function showToast(title, body, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-info-circle';
    if(type === 'success') icon = 'fa-check-circle';
    if(type === 'error') icon = 'fa-exclamation-triangle';
    if(type === 'warning') icon = 'fa-exclamation-circle';

    toast.innerHTML = `
        <i class="fas ${icon} toast-icon"></i>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-msg">${body}</div>
        </div>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.4s forwards';
        setTimeout(() => toast.remove(), 400);
    }, 4000);
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

