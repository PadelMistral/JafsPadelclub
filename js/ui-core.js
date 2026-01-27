// ui-core.js - Unified Application Guard & Portal Management (v2.0)
import { observerAuth, getDocument, subscribeCol } from './firebase-service.js';
import { injectHeader, injectNavbar } from './modules/ui-loader.js';

const PUBLIC_PAGES = ['index.html', 'registro.html', 'recuperar.html'];

/**
 * Shared UI Initialization
 */
export function initAppUI(activePageName) {
    const path = window.location.pathname.toLowerCase();
    const isPublic = PUBLIC_PAGES.some(p => path.includes(p)) || path.endsWith('/') || path === '';

    // Only inject UI in PRIVATE pages
    if (!isPublic) {
        injectHeader();
        injectNavbar(activePageName || 'home');
    }

    observerAuth(async (user) => {
        console.log("Auth State Changed. User:", !!user, "Path:", path);

        if (user) {
            // Logged in user on index/login -> Redirect to Home
            if (isPublic && !path.includes('registro.html') && !path.includes('recuperar.html')) {
                const loader = document.getElementById('master-loader');
                if (!loader || loader.style.display !== 'flex') {
                    console.log("Redirecting to home (Logged in)");
                    window.location.href = 'home.html';
                }
            }
            
            // Fill data
            try {
                const userData = await getDocument("usuarios", user.uid);
                if (userData) {
                    const { updateHeader } = await import('./modules/ui-loader.js');
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
    const dot = document.getElementById('notif-dot');
    if (!dot) return;
    
    subscribeCol("notificaciones", (list) => {
        const unread = list.filter(n => !n.read).length;
        dot.style.display = unread > 0 ? 'block' : 'none';
    }, [['uid', '==', uid]]);
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
    const endValue = parseFloat(target);
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
