/* js/modules/ui-loader.js - Dynamic Layout Injection v5.0 */
import { getDocument, auth, subscribeCol } from '../firebase-service.js';

const PUBLIC_PAGES = ['index.html', 'registro.html', 'recuperar.html'];

/**
 * Checks if the current page is public
 */
function isPublicPage() {
    const path = window.location.pathname.toLowerCase();
    // Default to public if root
    if (path === '/' || path.endsWith('/') || path === '') return true;
    // Check if filename is in public list
    return PUBLIC_PAGES.some(page => path.endsWith(page) || path.includes('/' + page));
}

/**
 * Injects the App Header with logo, admin link (if admin), and profile
 */
export async function injectHeader(userData = null) {
    if (isPublicPage() || document.querySelector('.app-header')) return;
    
    const header = document.createElement('header');
    header.className = 'app-header';
    
    const photo = userData?.fotoPerfil || userData?.fotoURL || './imagenes/default-avatar.png';
    const pageTitle = document.title.includes('-') ? document.title.split('-')[1].trim() : 
                      document.title.includes('|') ? document.title.split('|')[0].trim() : 'Inicio';
    
    // Check Admin rights locally
    const isAdmin = userData?.rol === 'Admin' || (auth.currentUser?.email === 'Juanan221091@gmail.com');
    
    header.innerHTML = `
        <div class="header-brand" onclick="window.location.href='home.html'" style="cursor:pointer">
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
                <span class="dot" id="notif-dot" style="display:none"></span>
            </div>
            <div class="header-avatar" onclick="window.location.href='perfil.html'" id="header-avatar-container" title="Mi Perfil">
                <img src="${photo}" alt="Perfil" id="header-avatar-img">
            </div>
        </div>
    `;
    
    document.body.prepend(header);
    
    if (auth.currentUser) {
        subscribeCol("notificaciones", (list) => {
            const unread = list.filter(n => !n.read).length;
            const dot = document.getElementById('notif-dot');
            if (dot) {
                dot.style.display = unread > 0 ? 'block' : 'none';
            }
        }, [['uid', '==', auth.currentUser.uid]]);
    }
}

/**
 * Updates header with live user data
 */
export function updateHeader(userData) {
    const img = document.getElementById('header-avatar-img');
    const roleLink = document.getElementById('admin-header-link');
    if (img && userData) {
        const photo = userData.fotoPerfil || userData.fotoURL || './imagenes/default-avatar.png';
        img.src = photo;
        
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
export function injectNavbar(activePage) {
    if (isPublicPage() || document.querySelector('.bottom-nav')) return;
    
    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    
    const items = [
        { id: 'home', icon: 'fa-house-chimney', label: 'Home', link: 'home.html', color: 'blue' },
        { id: 'ranking', icon: 'fa-ranking-star', label: 'Ranking', link: 'puntosRanking.html', color: 'purple' },
        { id: 'calendar', icon: 'fa-calendar-plus', label: 'Calendario', link: 'calendario.html', center: true },
        { id: 'palas', icon: 'fa-table-tennis-paddle-ball', label: 'Palas', link: 'palas.html', color: 'green' }, // Use valid FA 6 icon
        { id: 'history', icon: 'fa-history', label: 'Historial', link: 'historial.html', color: 'orange' }
    ];


    nav.innerHTML = items.map(item => {
        if (item.center) {
            return `
                <a href="${item.link}" class="nav-item center-item ${activePage === item.id ? 'active' : ''}">
                    <div class="nav-icon-wrap">
                        <i class="fas ${item.icon}"></i>
                    </div>
                </a>
            `;
        }
        return `
            <a href="${item.link}" class="nav-item ${activePage === item.id ? 'active' : ''}" data-color="${item.color}">
                <div class="nav-icon-box">
                    <i class="fas ${item.icon}"></i>
                </div>
                <span>${item.label}</span>
            </a>
        `;
    }).join('');

    document.body.appendChild(nav);
    
    // FAB Logic for IA Vecina
    if (!document.querySelector('.ai-fab')) {
        const fab = document.createElement('div');
        fab.className = 'ai-fab';
        fab.innerHTML = '<i class="fas fa-comment-dots"></i>';
        fab.onclick = async () => {
            const { initVecinaChat, toggleChat } = await import('./vecina-chat.js');
            initVecinaChat();
            toggleChat();
        };
        document.body.appendChild(fab);
    }
}

/**
 * Initialize Galaxy Background & Glassmorphism Check
 */
export function initBackground() {
    const bg = document.querySelector('.sport-bg');
    if (!bg) {
        const newBg = document.createElement('div');
        newBg.className = 'sport-bg';
        document.body.prepend(newBg);
        initBackground();
        return;
    }
    if (bg.dataset.init) return;
    bg.dataset.init = 'true';

    const stars = document.createElement('div');
    stars.className = 'starfield';
    
    for (let i = 0; i < 150; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 100}%`;
        const size = Math.random() * 2 + 0.5;
        star.style.width = `${size}px`;
        star.style.height = `${size}px`;
        star.style.setProperty('--duration', `${Math.random() * 5 + 2}s`);
        stars.appendChild(star);
    }
    bg.appendChild(stars);

    // Glow effects
    const glow1 = document.createElement('div');
    glow1.className = 'bg-glow blue';
    const glow2 = document.createElement('div');
    glow2.className = 'bg-glow purple';
    bg.appendChild(glow1);
    bg.appendChild(glow2);
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

export function showLoading(message = 'Cargando...') {
    let loader = document.getElementById('global-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'global-loader';
        loader.className = 'global-loader active';
        loader.innerHTML = `<div class="spinner-galaxy"></div><span class="mt-4 text-white font-bold">${message}</span>`;
        document.body.appendChild(loader);
    } else {
        loader.classList.add('active');
    }
}

export function hideLoading() {
    document.getElementById('global-loader')?.classList.remove('active');
}

