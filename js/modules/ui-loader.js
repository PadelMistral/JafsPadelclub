/* js/modules/ui-loader.js - Dynamic Layout Injection v5.5 */
import { getDocument, auth, db, subscribeCol, getDocsSafe, observerAuth as guardAuth } from '../firebase-service.js';
import { initThemeSystem } from './theme-manager.js';

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
            console.log("🔒 Access Denied: Redirecting to Login");
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

/**
 * Injects the App Header with logo, admin link (if admin), and profile
 */
export async function injectHeader(userData = null) {
    if (isPublicPage() || document.querySelector('.app-header')) return;
    
    const header = document.createElement('header');
    header.className = 'app-header';
    
    const currentPage = (window.location.pathname.split('/').pop() || 'home.html').toLowerCase();
    const sectionMap = {
        'home.html': 'HOME',
        'calendario.html': 'CALENDARIO',
        'diario.html': 'DIARIO',
        'puntosranking.html': 'RANKING',
        'historial.html': 'HISTORIAL',
        'perfil.html': 'PERFIL',
        'palas.html': 'PALAS',
        'eventos.html': 'EVENTOS',
        'normas.html': 'NORMAS',
        'notificaciones.html': 'NOTIFICACIONES',
        'admin.html': 'ADMIN'
    };
    const pageTitle = sectionMap[currentPage] || 'SECCIÓN';
    
    // Check Admin rights locally
    const isAdmin = userData?.rol === 'Admin' || (auth.currentUser?.email === 'Juanan221091@gmail.com');
    
    header.innerHTML = `
        <div class="header-brand" onclick="window.location.href='home.html'">
            <div class="header-logo">
                <img src="./imagenes/Logojafs.png" alt="Padeluminatis">
            </div>
            <div class="header-text">
                <span class="header-title">PADELUMINATIS</span>
                <span class="header-subtitle">${pageTitle}</span>
            </div>
        </div>
        
        <div class="header-actions">
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
        if (roleLink) {
            const isAdmin = userData.rol === 'Admin' || (auth.currentUser?.email === 'Juanan221091@gmail.com');
            roleLink.style.display = isAdmin ? 'flex' : 'none';
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
        home: `<i class="fas fa-house-chimney-window"></i>`,
        ranking: `<i class="fas fa-ranking-star"></i>`,
        calendar: `<i class="fas fa-calendar-days"></i>`,
        events: `<i class="fas fa-book-open"></i>`,
        history: `<i class="fas fa-clock-rotate-left"></i>`
    };

    const items = [
        { id: 'home', icon: icons.home, label: 'Inicio', link: 'home.html', color: 'cyan' },
        { id: 'ranking', icon: icons.ranking, label: 'Ranking', link: 'puntosRanking.html', color: 'gold' },
        { id: 'calendar', icon: icons.calendar, label: 'Pistas', link: 'calendario.html', center: true },
        { id: 'events', icon: icons.events, label: 'Diario', link: 'diario.html', color: 'magenta' },
        { id: 'history', icon: icons.history, label: 'Historial', link: 'historial.html', color: 'lime' }
    ];


    nav.innerHTML = items.map(item => {
        if (item.center) {
            return `
                <a href="${item.link}" class="nav-item center-item ${activePage === item.id ? 'active' : ''}">
                    <div class="nav-icon-wrap shadow-glow-primary">
                        ${item.icon}
                    </div>
                </a>
            `;
        }
        return `
            <a href="${item.link}" class="nav-item ${activePage === item.id ? 'active' : ''}" data-color="${item.color}">
                <div class="nav-icon-box">
                    ${item.icon}
                </div>
                <span>${item.label}</span>
            </a>
        `;
    }).join('');

    document.body.appendChild(nav);
    
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
        console.log('AI Chat not available:', e);
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
