/* js/modules/ui-loader.js - Dynamic Layout Injection v5.5 */
import { getDocument, updateDocument, auth, db, subscribeCol, getDocsSafe, observerAuth as guardAuth, logout } from '../firebase-service.js';
import { initThemeSystem } from './theme-manager.js';
import { logInfo } from '../core/app-logger.js';

// Initialize theme system immediately  
initThemeSystem();

const PUBLIC_PAGES = ['index.html', 'registro.html'];

function emitToast(title, body = '', type = 'info') {
    if (typeof window !== 'undefined' && typeof window.__appToast === 'function') {
        window.__appToast(title, body, type);
        return;
    }
    if (type === 'error') {
        try { alert(`${title}${body ? `: ${body}` : ''}`); } catch (_) {}
    }
}

/**
 * Checks if the current page is public
 */
function isPublicPage() {
    const path = window.location.pathname.toLowerCase();
    const publicPages = ['index.html', 'registro.html', 'terms.html', 'privacy.html'];
    
    // If it's explicitly public
    if (publicPages.some(p => path.includes(p))) return true;
    
    // Root is public
    if (path === '/' || path.endsWith('/') || path === '') return true;
    
    // Otherwise it's private
    return false;
}

function isStandalonePage() {
    return false;
}

function isNativeApp() {
    try {
        const cap = window.Capacitor;
        if (!cap) return false;
        if (typeof cap.isNativePlatform === "function") return !!cap.isNativePlatform();
        const platform = typeof cap.getPlatform === "function" ? cap.getPlatform() : "";
        return platform === "android" || platform === "ios";
    } catch (_) {
        return false;
    }
}

function ensureNativeAppStyles() {
    if (!isNativeApp() || document.getElementById("native-app-shell-styles")) return;
    const style = document.createElement("style");
    style.id = "native-app-shell-styles";
    style.textContent = `
        html.native-app-shell,
        body.native-app-shell {
            background: linear-gradient(180deg, #020617 0%, #071120 45%, #08182b 100%) !important;
        }
        body.native-app-shell .sport-bg {
            opacity: 0.88;
            filter: saturate(1.22) contrast(1.08) hue-rotate(-8deg);
        }
        body.native-app-shell .app-header {
            top: 0;
            padding-top: calc(env(safe-area-inset-top, 0px) + 10px) !important;
            height: calc(84px + env(safe-area-inset-top, 0px)) !important;
            background:
                radial-gradient(circle at top right, rgba(198, 255, 0, 0.16), transparent 34%),
                linear-gradient(180deg, rgba(4, 12, 24, 0.98), rgba(6, 20, 35, 0.86)) !important;
            border: 1px solid rgba(103, 232, 249, 0.18);
            box-shadow: 0 24px 42px rgba(2, 6, 23, 0.45), inset 0 1px 0 rgba(255,255,255,0.06);
            backdrop-filter: blur(26px);
        }
        body.native-app-shell .page-content {
            padding-top: calc(var(--app-header-h) + 12px) !important;
            padding-bottom: calc(var(--app-nav-h) + env(safe-area-inset-bottom, 0px) + 12px) !important;
            min-height: 100dvh;
        }
        body.native-app-shell .bottom-nav {
            position: fixed !important;
            bottom: calc(env(safe-area-inset-bottom, 0px) + 4px) !important;
            left: 0 !important;
            right: 0 !important;
            width: min(100%, 880px) !important;
            margin-inline: auto !important;
            transform: none !important;
            background:
                radial-gradient(circle at top center, rgba(0, 212, 255, 0.14), transparent 30%),
                linear-gradient(180deg, rgba(4, 12, 24, 0.95), rgba(7, 18, 34, 0.99)) !important;
            border: 1px solid rgba(148, 163, 184, 0.14);
            box-shadow: 0 22px 40px rgba(2, 6, 23, 0.5), inset 0 1px 0 rgba(255,255,255,0.04);
            backdrop-filter: blur(28px);
            animation: none !important;
        }
        body.native-app-shell .nav-dock-v8 {
            padding: 9px 12px 10px !important;
            gap: 6px !important;
            animation: none !important;
        }
        body.native-app-shell .nav-item-v8 {
            min-height: 60px;
            border-radius: 18px;
            transition: background-color .18s ease, transform .18s ease, color .18s ease !important;
            animation: none !important;
        }
        body.native-app-shell .nav-item-v8.active {
            background: linear-gradient(180deg, rgba(0, 212, 255, 0.1), rgba(198, 255, 0, 0.08));
            box-shadow: inset 0 0 18px rgba(0, 212, 255, 0.08);
        }
        body.native-app-shell .nav-icon-v8 {
            transform: scale(1.05);
        }
        body.native-app-shell .nav-label-v8 {
            color: rgba(255,255,255,0.82);
            font-weight: 900;
        }
        body.native-app-shell .card,
        body.native-app-shell .card-premium-v7,
        body.native-app-shell .notif-simple-card,
        body.native-app-shell .notif-status-hero,
        body.native-app-shell .profile-section,
        body.native-app-shell .stat-card-v9,
        body.native-app-shell .stat-card-v7 {
            border-color: rgba(103, 232, 249, 0.14) !important;
            box-shadow: 0 18px 38px rgba(2, 6, 23, 0.3);
        }
        body.native-app-shell .page-title-pro,
        body.native-app-shell .profile-name,
        body.native-app-shell .pane-title {
            text-shadow: 0 0 18px rgba(103, 232, 249, 0.12);
        }
        body.native-app-shell .header-brand,
        body.native-app-shell .header-actions {
            transform: translateY(1px);
        }
        body.native-app-shell .header-title {
            letter-spacing: 0.16em;
        }
        body.native-app-shell .header-subtitle {
            color: rgba(198,255,0,0.82);
        }
        body.native-app-shell .animate-fade-in,
        body.native-app-shell .animate-up,
        body.native-app-shell .animate-scale-in,
        body.native-app-shell .animate-slide-in {
            animation-duration: .24s !important;
            animation-iteration-count: 1 !important;
            animation-fill-mode: both !important;
            will-change: auto !important;
        }
        body.native-app-shell .sport-bg,
        body.native-app-shell .app-header,
        body.native-app-shell .bottom-nav,
        body.native-app-shell .nav-dock-v8,
        body.native-app-shell .card,
        body.native-app-shell .card-premium-v7 {
            transition: none !important;
        }
        body.native-app-shell .loading-overlay,
        body.native-app-shell .skeleton,
        body.native-app-shell .shimmer,
        body.native-app-shell .pulse,
        body.native-app-shell .loading-pulse {
            animation-duration: 1.2s !important;
        }
    `;
    document.head.appendChild(style);
}

function bindNativeSwipeNavigation(activePageId, items = []) {
    if (!isNativeApp() || !activePageId || window.__nativeSwipeNavBound === activePageId) return;
    const activeIndex = items.findIndex((item) => item.id === activePageId);
    if (activeIndex === -1) return;
    window.__nativeSwipeNavBound = activePageId;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    const canHandleTarget = (target) => {
        if (!target) return false;
        const tag = String(target.tagName || "").toLowerCase();
        if (["input", "textarea", "select", "button", "label"].includes(tag)) return false;
        if (target.closest("a[href], button, input, textarea, select, [contenteditable='true'], .modal-overlay.active")) return false;
        return true;
    };

    document.addEventListener("touchstart", (event) => {
        const touch = event.changedTouches?.[0];
        if (!touch || !canHandleTarget(event.target)) {
            tracking = false;
            return;
        }
        tracking = true;
        startX = touch.clientX;
        startY = touch.clientY;
    }, { passive: true });

    document.addEventListener("touchend", (event) => {
        if (!tracking) return;
        tracking = false;
        const touch = event.changedTouches?.[0];
        if (!touch) return;
        const diffX = touch.clientX - startX;
        const diffY = touch.clientY - startY;
        if (Math.abs(diffX) < 72 || Math.abs(diffX) < Math.abs(diffY) * 1.3 || Math.abs(diffY) > 84) return;

        const nextIndex = diffX < 0 ? activeIndex + 1 : activeIndex - 1;
        const nextItem = items[nextIndex];
        if (!nextItem?.link) return;
        window.location.href = nextItem.link;
    }, { passive: true });
}

function getUserInitials(name = "") {
    const clean = String(name || "").trim();
    if (!clean) return "JP";
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function escapeUiLoaderHtml(raw = "") {
    const div = document.createElement("div");
    div.textContent = String(raw || "");
    return div.innerHTML;
}

function confirmUiLoaderAction({
    title = "Confirmar",
    message = "¿Quieres continuar?",
    confirmLabel = "Continuar",
    danger = false,
} = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay active modal-stack-front";
        overlay.innerHTML = `
            <div class="modal-card glass-strong" style="max-width:380px;">
                <div class="modal-header">
                    <h3 class="modal-title">${escapeUiLoaderHtml(title)}</h3>
                    <button class="close-btn" type="button">&times;</button>
                </div>
                <div class="modal-body">
                    <p class="text-[11px] text-white/75 leading-relaxed">${escapeUiLoaderHtml(message)}</p>
                    <div class="flex-row gap-2 mt-4">
                        <button type="button" class="btn btn-ghost w-full" data-ui-loader-cancel>Cancelar</button>
                        <button type="button" class="btn w-full ${danger ? "btn-danger" : "btn-primary"}" data-ui-loader-ok>${escapeUiLoaderHtml(confirmLabel)}</button>
                    </div>
                </div>
            </div>
        `;
        const close = (accepted = false) => {
            overlay.remove();
            resolve(Boolean(accepted));
        };
        overlay.querySelector(".close-btn")?.addEventListener("click", () => close(false));
        overlay.querySelector("[data-ui-loader-cancel]")?.addEventListener("click", () => close(false));
        overlay.querySelector("[data-ui-loader-ok]")?.addEventListener("click", () => close(true));
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) close(false);
        });
        document.body.appendChild(overlay);
    });
}

function buildHeaderAvatarMarkup(userData = null) {
    const displayName = userData?.nombreUsuario || userData?.nombre || "Jugador";
    const photo = (userData?.fotoPerfil || userData?.fotoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0f172a&color=fff&size=96`).trim();
    return `<img src="${photo}" alt="Perfil" id="header-avatar-img">`;
}

function ensureHeaderProfileMenuStyles() {
    if (document.getElementById("header-profile-menu-styles")) return;
    const style = document.createElement("style");
    style.id = "header-profile-menu-styles";
    style.textContent = `
        .header-profile-wrap{position:relative}
        .header-avatar-btn{background:transparent;border:0;padding:0;cursor:pointer}
        .header-profile-menu{position:absolute;top:calc(100% + 12px);right:0;min-width:240px;padding:10px;border-radius:18px;border:1px solid rgba(255,255,255,.1);background:linear-gradient(180deg,rgba(5,10,22,.98),rgba(2,6,23,.98));box-shadow:0 20px 48px rgba(2,6,23,.42);display:none;z-index:450;backdrop-filter:blur(18px)}
        .header-profile-wrap.open .header-profile-menu{display:block}
        .header-menu-user{padding:10px 12px 12px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:8px}
        .header-menu-name{display:block;color:#fff;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}
        .header-menu-sub{display:block;color:rgba(255,255,255,.5);font-size:10px;text-transform:uppercase;letter-spacing:.12em;margin-top:4px}
        .header-menu-action{width:100%;display:flex;align-items:center;gap:10px;padding:12px 12px;border-radius:14px;border:0;background:transparent;color:#e2e8f0;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;cursor:pointer}
        .header-menu-action:hover{background:rgba(255,255,255,.06)}
        .header-menu-action.danger{color:#fca5a5}
        .header-menu-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px}
    `;
    document.head.appendChild(style);
}

function bindHeaderProfileMenu(userData = null) {
    ensureHeaderProfileMenuStyles();
    const wrap = document.getElementById("header-profile-wrap");
    const toggle = document.getElementById("header-avatar-container");
    const adminViewBtn = document.getElementById("header-toggle-admin-view");
    const profileBtn = document.getElementById("header-go-profile");
    const historyBtn = document.getElementById("header-go-history");
    const racketsBtn = document.getElementById("header-go-palas");
    const logoutBtn = document.getElementById("header-logout");
    if (!wrap || !toggle) return;

    const closeMenu = () => wrap.classList.remove("open");
    toggle.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        wrap.classList.toggle("open");
    };
    profileBtn?.addEventListener("click", () => {
        closeMenu();
        window.location.href = "perfil.html";
    });
    historyBtn?.addEventListener("click", () => {
        closeMenu();
        window.location.href = "historial.html";
    });
    racketsBtn?.addEventListener("click", () => {
        closeMenu();
        window.location.href = "palas.html";
    });
    adminViewBtn?.addEventListener("click", async () => {
        closeMenu();
        const currentRole = String(userData?.rol || userData?.role || "").toLowerCase();
        const isAdmin = currentRole.includes("admin");
        const newRole = isAdmin ? "User" : "Admin";
        
        try {
            // Update Firestore role
            await updateDocument("usuarios", auth.currentUser.uid, { 
                rol: newRole,
                // Ensure they can toggle back if they were an admin
                ...(isAdmin ? { canToggleAdmin: true } : {})
            });
            emitToast("MODO " + newRole.toUpperCase(), "Cambiando permisos...", "success");
            
            // Redirect after a short delay to allow Firestore to propagate
            setTimeout(() => {
                const onAdminPage = /(^|\/)admin\.html$/i.test(window.location.pathname || "");
                if (newRole === "Admin") {
                    window.location.href = "admin.html";
                } else {
                    window.location.href = onAdminPage ? "home.html" : window.location.href;
                }
            }, 800);
        } catch (e) {
            console.error("Error toggling admin view:", e);
            emitToast("ERROR", "No se pudo cambiar el modo de vista.", "error");
        }
    });
    logoutBtn?.addEventListener("click", async () => {
        closeMenu();
        const ok = await confirmUiLoaderAction({
            title: "Cerrar sesión",
            message: "Vas a salir de tu cuenta en este dispositivo.",
            confirmLabel: "Salir",
            danger: true,
        });
        if (!ok) return;
        await logout().catch(() => {});
        window.location.href = "index.html";
    });
    document.addEventListener("click", (event) => {
        if (!wrap.contains(event.target)) closeMenu();
    }, { passive: true });
}

function isAdminUser(userData) {
    const role = String(userData?.rol || userData?.role || "").toLowerCase();
    const canToggle = userData?.canToggleAdmin === true;
    const isMaster = (auth.currentUser?.email === "Juanan221091@gmail.com");
    return role.includes("admin") || canToggle || isMaster;
}

function getCurrentPageMeta() {
    const currentPage = (window.location.pathname.split('/').pop() || 'home.html').toLowerCase();
    const pageMap = {
        'home.html': { id: 'home', subtitle: 'INICIO' },
        'calendario.html': { id: 'calendar', subtitle: 'CALENDARIO' },
        'diario.html': { id: 'diary', subtitle: 'DIARIO' },
        'ranking.html': { id: 'ranking', subtitle: 'RANKING' },
        'historial.html': { id: 'history', subtitle: 'HISTORIAL' },
        'perfil.html': { id: 'profile', subtitle: 'PERFIL' },
        'palas.html': { id: 'palas', subtitle: 'PALAS' },
        'eventos.html': { id: 'events', subtitle: 'EVENTOS' },
        'evento-detalle.html': { id: 'events', subtitle: 'EVENTO' },
        'evento-sorteo.html': { id: 'events', subtitle: 'SORTEO' },
        'notificaciones.html': { id: 'notifications', subtitle: 'NOTIFICACIONES' },
        'admin.html': { id: 'admin', subtitle: 'ADMIN' },
    };
    return pageMap[currentPage] || { id: '', subtitle: 'SECCIÓN' };
}

/**
 * Injects the App Header with logo, admin link (if admin), and profile
 */
export async function injectHeader(userData = null) {
    if (isPublicPage() || isStandalonePage() || document.querySelector('.app-header')) return;
    ensureNativeAppStyles();
    if (!userData && auth.currentUser?.uid) {
        try { userData = await getDocument("usuarios", auth.currentUser.uid); } catch (_) {}
    }
    
    const header = document.createElement('header');
    header.className = 'app-header';
    
    const pageMeta = getCurrentPageMeta();
    
    // Check Admin rights locally
    const isAdmin = isAdminUser(userData);
    
    header.innerHTML = `
        <div class="header-brand" onclick="window.location.href='home.html'">
            <div class="header-logo">
                <img src="./imagenes/Logojafs.png" alt="JafsPadel">
            </div>
            <div class="header-text">
                <span class="header-title">PADELUMINATIS</span>
                <span class="header-subtitle">${pageMeta.subtitle}</span>
            </div>
        </div>
        
        <div class="header-actions">
            <div class="header-mobile-toggle" onclick="window.toggleAdminSidebar()" id="admin-mobile-btn" style="display:none">
                <i class="fas fa-bars"></i>
            </div>
            ${isAdmin ? `
                <div class="header-admin" onclick="window.location.href='admin.html'" id="admin-header-link" title="Panel Admin">
                    <i class="fas fa-shield-halved"></i>
                </div>
            ` : ''}
            <div class="header-online" onclick="window.showOnlineNexus && window.showOnlineNexus()" title="Usuarios conectados">
                <span class="header-online-dot"></span>
                <i class="fas fa-satellite-dish"></i>
            </div>
 
            <div class="header-notif" onclick="window.location.href='notificaciones.html'" title="Notificaciones">
                <i class="fas fa-bell"></i>
                <span class="notification-badge" id="notif-badge" style="display:none">0</span>
            </div>
            <div class="header-profile-wrap" id="header-profile-wrap">
                <button class="header-avatar avatar-premium header-avatar-btn" id="header-avatar-container" title="Perfil y sesión">
                    ${buildHeaderAvatarMarkup(userData)}
                </button>
                <div class="header-profile-menu" id="header-profile-menu">
                    <div class="header-menu-user">
                        <span class="header-menu-name">${escapeUiLoaderHtml(userData?.nombreUsuario || userData?.nombre || "Jugador")}</span>
                        <span class="header-menu-sub">${escapeUiLoaderHtml(pageMeta.subtitle)}</span>
                    </div>
                    <div class="header-menu-grid">
                        <button class="header-menu-action" id="header-go-history"><i class="fas fa-clock-rotate-left"></i> Historial</button>
                        <button class="header-menu-action" id="header-go-palas"><i class="fas fa-table-tennis-paddle-ball"></i> Palas</button>
                    </div>
                    ${isAdmin ? `
                        <button class="header-menu-action" id="header-toggle-admin-view" style="color:var(--sport-gold); border: 1px solid rgba(var(--sport-gold-rgb), 0.2); background: rgba(var(--sport-gold-rgb), 0.05); margin-top: 10px;">
                            <i class="fas fa-shield-halved"></i> 
                            ${String(userData?.rol || "").toLowerCase() === 'admin' ? 'Ver como Usuario' : 'Activar Admin'}
                        </button>
                    ` : ``}
                    <button class="header-menu-action" id="header-go-profile"><i class="fas fa-user"></i> Ir a perfil</button>
                    <button class="header-menu-action danger" id="header-logout"><i class="fas fa-right-from-bracket"></i> Cerrar sesión</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.prepend(header);
    document.documentElement.style.setProperty('--app-header-h', '70px');
    bindHeaderProfileMenu(userData);
    
    if (auth.currentUser && !window.__notifBadgeManagedByUICore) {
        Promise.resolve(
            subscribeCol("notificaciones", (list) => {
                const unread = list.filter(n => !n.leido && !n.read).length;
                const badge = document.getElementById('notif-badge');
                if (!badge) return;
                if (unread > 0) {
                    badge.style.display = 'flex';
                    badge.textContent = unread > 9 ? '9+' : unread;
                } else {
                    badge.style.display = 'none';
                }
            }, [['destinatario', '==', auth.currentUser.uid]])
        ).then((unsub) => {
            if (typeof unsub === 'function') window.__headerNotifUnsub = unsub;
        }).catch(() => {});
    }

    if (window.__headerOnlineInterval) clearInterval(window.__headerOnlineInterval);
}

/**
 * Updates header with live user data
 */
export function updateHeader(userData) {
    const container = document.getElementById('header-avatar-container');
    const roleLink = document.getElementById('admin-header-link');
    if (container && userData) {
        container.innerHTML = buildHeaderAvatarMarkup(userData);
        
        // Show/Hide admin link based on current data
        const isAdmin = isAdminUser(userData);
        if (roleLink) {
            roleLink.style.display = isAdmin ? 'flex' : 'none';
        } else if (isAdmin) {
            const actions = document.querySelector('.header-actions');
            if (actions) {
                const node = document.createElement('div');
                node.className = 'header-admin';
                node.id = 'admin-header-link';
                node.title = 'Panel Admin';
                node.innerHTML = '<i class=\"fas fa-shield-halved\"></i>';
                node.onclick = () => { window.location.href = 'admin.html'; };
                actions.prepend(node);
            }
        }
    }
}

/**
 * Injects Bottom Navigation - Redesigned for Beauty
 */
export async function injectNavbar(activePage) {
    if (isPublicPage() || isStandalonePage() || document.querySelector('.bottom-nav')) return;
    ensureNativeAppStyles();
    
    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    
    const icons = {
        home: `<i class="fa-solid fa-house"></i>`,
        ranking: `<i class="fa-solid fa-ranking-star"></i>`,
        calendar: `<i class="fa-solid fa-calendar-day"></i>`,
        events: `<i class="fa-solid fa-book-open-reader"></i>`,
        history: `<i class="fa-solid fa-medal"></i>`
    };

    const currentFromPath = getCurrentPageMeta().id;
    const resolvedActivePage = currentFromPath || activePage;

    const items = [
        { id: 'home', icon: icons.home, label: 'Inicio', link: 'home.html', color: '#2bbcff' },
        { id: 'ranking', icon: icons.ranking, label: 'Ranking', link: 'ranking.html', color: '#93ea08' },
        { id: 'calendar', icon: icons.calendar, label: 'Calendario', link: 'calendario.html', center: true },
        { id: 'diary', icon: icons.events, label: 'Diario', link: 'diario.html', color: '#ae00ff' },
        { id: 'events', icon: icons.history, label: 'Eventos', link: 'eventos.html', color: '#c6ff00' }
    ];


    nav.innerHTML = `
        <div class="nav-dock-v8">
            ${items.map(item => {
                if (item.center) {
                    return `
                        <a href="${item.link}" class="nav-item-v8 center-item ${resolvedActivePage === item.id ? 'active' : ''}" aria-current="${resolvedActivePage === item.id ? 'page' : 'false'}">
                            <div class="nav-icon-v8 main-action">
                                ${item.icon}
                            </div>
                        </a>
                    `;
                }
                return `
                    <a href="${item.link}" class="nav-item-v8 ${resolvedActivePage === item.id ? 'active' : ''}" style="--item-clr: ${item.color}" aria-current="${resolvedActivePage === item.id ? 'page' : 'false'}">
                        <div class="nav-icon-v8">
                            ${item.icon}
                        </div>
                        <span class="nav-label-v8">${item.label}</span>
                        <div class="nav-active-dot"></div>
                    </a>
                `;
            }).join('')}
        </div>
    `;

    document.body.appendChild(nav);
    document.documentElement.style.setProperty('--app-nav-h', '80px');
    nav.querySelectorAll('a.nav-item-v8').forEach((a) => {
        a.addEventListener('click', (e) => {
            const href = a.getAttribute('href');
            if (!href) return;
            e.preventDefault();
            window.location.href = href;
        });
    });
    bindNativeSwipeNavigation(resolvedActivePage, items);
    
    // Presence Heartbeat
    if (auth.currentUser) {
        const { updatePresence } = await import('../firebase-service.js');
        updatePresence(auth.currentUser.uid);
        setInterval(() => updatePresence(auth.currentUser.uid), 5 * 60 * 1000); // Every 5 mins
    }
    
    // Initialize AI Coach Chat (creates its own FAB)
    try {
        const { initVecinaChat } = await import('./vecina-chat.js');
        initVecinaChat();
    } catch(e) {
        logInfo('ai_chat_not_available', { reason: e?.message || 'unknown' });
    }
}

/**
 * Initialize Galaxy Background using centralized module
 */
export async function initBackground() {
    const { initGalaxyBackground } = await import('./galaxy-bg.js');
    initGalaxyBackground();
}

export function setupModals() {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
    });
}

/**
 * Loading Manager with Session Storage to avoid repeat on Home
 */
export function showLoading(message = 'Sincronizando Circuito...', force = false) {
    // Removed session storage check to prevent flickering on internal navigation
    
    let loader = document.getElementById('global-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'global-loader';
        loader.className = 'global-loader active';
        loader.innerHTML = `
            <div class="loader-galactic-bg">
                <div class="starfield-mini"></div>
            </div>
            <div class="loader-content">
                <div class="logo-pulse-container">
                    <img src="./imagenes/Logojafs.png" class="loader-logo-pulse" alt="Logo">
                    <div class="logo-ring"></div>
                </div>
                <div class="loader-text-box">
                    <span class="loader-text">${message}</span>
                    <div class="loader-bar-container">
                        <div class="loader-bar-fill"></div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(loader);
        
        // Add some stars dynamically to the loader
        const field = loader.querySelector('.starfield-mini');
        if (field) {
            for(let i=0; i<30; i++) {
                const s = document.createElement('div');
                s.className = 'loader-star';
                s.style.left = Math.random()*100+'%';
                s.style.top = Math.random()*100+'%';
                s.style.animationDelay = Math.random()*2+'s';
                field.appendChild(s);
            }
        }
    } else {
        loader.classList.add('active');
        loader.querySelector('.loader-text').textContent = message;
    }

    if (window.__globalLoaderTimeoutId) {
        clearTimeout(window.__globalLoaderTimeoutId);
    }
    window.__globalLoaderTimeoutId = setTimeout(() => {
        const activeLoader = document.getElementById('global-loader');
        if (!activeLoader || !activeLoader.classList.contains('active')) return;
        activeLoader.classList.remove('active', 'fade-out');
        if (typeof window.__appToast === 'function') {
            window.__appToast('Carga extendida', 'Mostrando contenido para evitar bloqueo visual.', 'warning');
        }
    }, 9000);
}

export function hideLoading() {
    const loader = document.getElementById('global-loader');
    if (window.__globalLoaderTimeoutId) {
        clearTimeout(window.__globalLoaderTimeoutId);
        window.__globalLoaderTimeoutId = null;
    }
    if (loader) {
        loader.classList.add('fade-out');
        sessionStorage.setItem('initial_load_done', 'true');
        setTimeout(() => {
            loader.classList.remove('active', 'fade-out');
        }, 500);
    }
}


window.clearGlobalNotifications = async () => {
    if (!auth.currentUser) return;
    if (!(await confirmUiLoaderAction({
        title: "Vaciar bandeja",
        message: "Se eliminaran todos los avisos de tu bandeja de entrada.",
        confirmLabel: "Vaciar",
        danger: true,
    }))) return;
    
    const { writeBatch, collection, query, where, getDocs, doc } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js');
    const q = query(collection(db, 'notificaciones'), where('destinatario', '==', auth.currentUser.uid));
    const snap = await getDocs(q);
    
    if (snap.empty) return emitToast('Info', 'Ya esta todo limpio', 'info');
    
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(doc(db, 'notificaciones', d.id)));
    await batch.commit();
    emitToast('Limpieza completa', 'Se han borrado todas las notificaciones.', 'success');
};
window.toggleAdminSidebar = () => {
    const sb = document.querySelector('.admin-sidebar');
    if (sb) sb.classList.toggle('active');
};

// Global Listener for Force App Updates
try {
    const loaderLoadTime = Date.now();
    let updateShown = false;
    import('https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js').then(({ doc, onSnapshot }) => {
        onSnapshot(doc(db, "systemConfigs", "forceUpdate"), (snap) => {
            if (!snap.exists()) return;
            const data = snap.data();
            if (data.versionStamp && data.versionStamp > loaderLoadTime && !updateShown) {
                updateShown = true;
                const msg = data.message || "Nueva versión obligatoria de la aplicación. Haz clic para actualizar el dispositivo ahora y corregir errores recientes.";
                if (confirm("ACTUALIZACIÓN OBLIGATORIA DEL SISTEMA:\\n\\n" + msg)) {
                    // Limpieza severa
                    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
                    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
                        window.location.reload(true);
                    }).catch(() => window.location.reload(true));
                } else {
                    window.location.reload(true);
                }
            }
        });
    });
} catch(e) {
    console.warn("Could not attach forceUpdate listener", e);
}
