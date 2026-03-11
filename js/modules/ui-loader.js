/* js/modules/ui-loader.js - Dynamic Layout Injection v5.5 */
import { getDocument, auth, db, subscribeCol, getDocsSafe, observerAuth as guardAuth } from '../firebase-service.js';
import { initThemeSystem } from './theme-manager.js';
import { logInfo } from '../core/app-logger.js';

// Initialize theme system immediately  
initThemeSystem();

// --- GLOBAL SESSION GUARD ---
// Redirect to login if unauthenticated on a private page
if (typeof window !== 'undefined') {
    guardAuth((user) => {
        const path = window.location.pathname.toLowerCase();
        const publicPages = ['index.html', 'registro.html', 'terms.html', 'privacy.html'];
        const isPublic = publicPages.some(p => path.includes(p)) || path === '/' || path.endsWith('/') || path === '';
        
        if (!user && !isPublic) {
            logInfo('session_guard_redirect_login', { path });
            window.location.replace('index.html');
        }
    });
}

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

function getUserInitials(name = "") {
    const clean = String(name || "").trim();
    if (!clean) return "JP";
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function buildHeaderAvatarMarkup(userData = null) {
    const displayName = userData?.nombreUsuario || userData?.nombre || "Jugador";
    const photo = (userData?.fotoPerfil || userData?.fotoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0f172a&color=fff&size=96`).trim();
    return `<img src="${photo}" alt="Perfil" id="header-avatar-img">`;
}

function isAdminUser(userData) {
    const role = String(userData?.rol || userData?.role || "").toLowerCase();
    return role.includes("admin") || (auth.currentUser?.email === "Juanan221091@gmail.com");
}

function getCurrentPageMeta() {
    const currentPage = (window.location.pathname.split('/').pop() || 'home.html').toLowerCase();
    const pageMap = {
        'home.html': { id: 'home', subtitle: 'INICIO' },
        'calendario.html': { id: 'calendar', subtitle: 'CALENDARIO' },
        'diario.html': { id: 'events', subtitle: 'DIARIO' },
        'ranking-v3.html': { id: 'ranking', subtitle: 'RANKING' },
        'puntosranking.html': { id: 'ranking', subtitle: 'RANKING' },
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
    if (isPublicPage() || document.querySelector('.app-header')) return;
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
                <img src="./imagenes/Logojafs.png" alt="Padeluminatis">
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
 
            <div class="header-notif" onclick="window.location.href='notificaciones.html'" title="Notificaciones">
                <i class="fas fa-bell"></i>
                <span class="notification-badge" id="notif-badge" style="display:none">0</span>
            </div>
            <div class="header-avatar avatar-premium" onclick="window.location.href='perfil.html'" id="header-avatar-container" title="Mi Perfil">
                ${buildHeaderAvatarMarkup(userData)}
            </div>
        </div>
    `;
    
    document.body.prepend(header);
    
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
    if (isPublicPage() || document.querySelector('.bottom-nav')) return;
    
    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    
    const icons = {
        home: `<i class="fa-solid fa-house"></i>`,
        ranking: `<i class="fa-solid fa-ranking-star"></i>`,
        calendar: `<i class="fa-solid fa-calendar-day"></i>`,
        events: `<i class="fa-solid fa-book-open-reader"></i>`,
        history: `<i class="fa-solid fa-clock-rotate-left"></i>`
    };

    const currentFromPath = getCurrentPageMeta().id;
    const resolvedActivePage = currentFromPath || activePage;

    const items = [
        { id: 'home', icon: icons.home, label: 'Inicio', link: 'home.html', color: '#2bbcff' },
        { id: 'ranking', icon: icons.ranking, label: 'Ranking', link: 'ranking-v3.html', color: '#93ea08' },
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
    nav.querySelectorAll('a.nav-item-v8').forEach((a) => {
        a.addEventListener('click', (e) => {
            const href = a.getAttribute('href');
            if (!href) return;
            e.preventDefault();
            window.location.href = href;
        });
    });
    
    // Presence Heartbeat
    if (auth.currentUser) {
        const { updatePresence } = await import('../firebase-service.js?v=6.5');
        updatePresence(auth.currentUser.uid);
        setInterval(() => updatePresence(auth.currentUser.uid), 5 * 60 * 1000); // Every 5 mins
    }
    
    // Initialize AI Coach Chat (creates its own FAB)
    try {
        const { initVecinaChat } = await import('./vecina-chat.js?v=6.5');
        initVecinaChat();
    } catch(e) {
        logInfo('ai_chat_not_available', { reason: e?.message || 'unknown' });
    }
}

/**
 * Initialize Galaxy Background using centralized module
 */
export async function initBackground() {
    const { initGalaxyBackground } = await import('./galaxy-bg.js?v=6.5');
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
    if (!confirm('¿Vaciar toda la bandeja de entrada?')) return;
    
    const { writeBatch, collection, query, where, getDocs, doc } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js');
    const q = query(collection(db, 'notificaciones'), where('destinatario', '==', auth.currentUser.uid));
    const snap = await getDocs(q);
    
    if (snap.empty) return emitToast('Info', 'Ya está todo limpio', 'info');
    
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(doc(db, 'notificaciones', d.id)));
    await batch.commit();
    emitToast('Limpieza Completa', 'Se han borrado todas las notificaciones.', 'success');
};
window.toggleAdminSidebar = () => {
    const sb = document.querySelector('.admin-sidebar');
    if (sb) sb.classList.toggle('active');
};
