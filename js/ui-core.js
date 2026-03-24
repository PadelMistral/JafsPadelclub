// ui-core.js - Unified Application Guard & Portal Management (v2.0)
import { observerAuth, getDocument, subscribeCol, db, getDocsSafe } from './firebase-service.js';
import { logError, logInfo, logWarn } from './core/app-logger.js';

const PUBLIC_PAGES = ['index.html', 'registro.html', 'terms.html', 'privacy.html', 'offline.html'];
let onlineNexusCurrentUid = null;
let onlineNexusViewerIsAdmin = false;
let onlineNexusRoleResolvedFor = null;

function ensureGlobalBootStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('app-boot-inline-style')) return;
    const style = document.createElement('style');
    style.id = 'app-boot-inline-style';
    style.textContent = `
      body.app-boot-pending {
        overflow: hidden !important;
      }
      body.app-boot-pending > *:not(#app-boot-loader) {
        visibility: hidden;
      }
      .app-boot-loader {
        position: fixed;
        inset: 0;
        z-index: 12000;
        display: flex;
        align-items: center;
        justify-content: center;
        background: radial-gradient(circle at center, rgba(3, 7, 18, 0.98) 0%, rgba(2, 6, 23, 0.995) 70%, #020617 100%);
        opacity: 1;
        transition: opacity .45s cubic-bezier(0.4, 0, 0.2, 1), visibility .45s;
      }
      .app-boot-loader.hidden {
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
      }
      .app-boot-core {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 18px;
      }
      .app-boot-ring {
        width: 68px;
        height: 68px;
        border-radius: 999px;
        border: 2.5px solid rgba(0, 212, 255, 0.12);
        border-top-color: #00d4ff;
        animation: appBootSpin 0.8s linear infinite;
        box-shadow: 0 0 20px rgba(0,212,255,0.08);
      }
      .app-boot-logo {
        position: absolute;
        width: 38px;
        height: 38px;
        object-fit: contain;
        filter: drop-shadow(0 0 12px rgba(0,212,255,.25));
        animation: appBootPulse 2s ease-in-out infinite;
      }
      .app-boot-status {
        font-size: 9px;
        font-weight: 900;
        letter-spacing: 3px;
        text-transform: uppercase;
        color: rgba(255,255,255,.4);
        animation: appBootTextPulse 1.8s ease-in-out infinite;
      }
      @keyframes appBootSpin {
        to { transform: rotate(360deg); }
      }
      @keyframes appBootPulse {
        0%, 100% { opacity: 0.7; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.05); }
      }
      @keyframes appBootTextPulse {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 0.7; }
      }
    `;
    document.head.appendChild(style);
}

function ensureGlobalBackgroundLayer() {
    if (typeof document === 'undefined') return;
    if (!document.querySelector('.sport-bg')) {
        const bg = document.createElement('div');
        bg.className = 'sport-bg';
        document.body.prepend(bg);
    }
}

function ensureBootLoader() {
    if (typeof document === 'undefined') return null;
    ensureGlobalBootStyles();
    let loader = document.getElementById('app-boot-loader');
    document.body.classList.add('app-boot-pending');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'app-boot-loader';
        loader.className = 'app-boot-loader';
        const msgs = ['Sincronizando Datos', 'Cargando Campo', 'Preparando Sesión', 'Conectando...'];
        const msg = msgs[Math.floor(Math.random() * msgs.length)];
        loader.innerHTML = `
          <div class="app-boot-core">
            <div style="position:relative; display:flex; align-items:center; justify-content:center;">
              <div class="app-boot-ring"></div>
              <img class="app-boot-logo" src="./imagenes/Logojafs.png" alt="JafsPadel">
            </div>
            <div class="app-boot-status">${msg}</div>
          </div>
        `;
        document.body.appendChild(loader);
    } else {
        loader.classList.remove('hidden');
    }
    return loader;
}

function hideBootLoader(delay = 120) {
    if (typeof document === 'undefined') return;
    const loader = document.getElementById('app-boot-loader');
    if (!loader) return;
    setTimeout(() => {
        loader.classList.add('hidden');
        document.body.classList.remove('app-boot-pending');
        setTimeout(() => {
            if (loader?.parentNode) loader.remove();
        }, 420);
    }, delay);
}

function ensureErrorBoundaryLayer() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('app-error-boundary')) return;
    const node = document.createElement('div');
    node.id = 'app-error-boundary';
    node.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:13000',
        'display:none',
        'align-items:center',
        'justify-content:center',
        'background:rgba(2,6,23,.92)',
        'padding:18px',
    ].join(';');
    node.innerHTML = `
      <div style="max-width:360px;border:1px solid rgba(255,255,255,.14);border-radius:16px;background:rgba(15,23,42,.95);padding:16px;text-align:center;">
        <h3 style="font-size:14px;font-weight:900;letter-spacing:1px;color:#fff;margin:0 0 8px;">Se produjo un problema</h3>
        <p style="font-size:11px;color:rgba(255,255,255,.74);margin:0 0 12px;">Recarga la pantalla para continuar.</p>
        <button id="app-error-boundary-reload" style="border:1px solid rgba(198,255,0,.35);background:rgba(198,255,0,.12);color:#dfff8a;border-radius:10px;padding:8px 12px;font-size:10px;font-weight:900;">RECARGAR</button>
      </div>
    `;
    document.body.appendChild(node);
    node.querySelector('#app-error-boundary-reload')?.addEventListener('click', () => window.location.reload());
}

function showErrorBoundary() {
    const node = document.getElementById('app-error-boundary');
    if (!node) return;
    node.style.display = 'flex';
}

function initGlobalFeedbackHooks() {
    if (typeof window === 'undefined') return;
    if (window.__globalFeedbackHooksBound) return;
    window.__globalFeedbackHooksBound = true;

    let errorHits = 0;
    const showFriendlyError = (err) => {
        errorHits += 1;
        const msg = typeof err === 'string' ? err : (err?.message || 'Error desconocido');
        console.error("[CRITICAL UI ERROR]", err);
        showToast('Ups, algo salio mal', `Detalle: ${msg.slice(0, 50)}...`, 'error');
        if (errorHits >= 5) showErrorBoundary();
    };

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event?.reason?.message || String(event?.reason || 'unknown');
        logError('ui_unhandled_rejection', { reason });
        showFriendlyError(reason);
    });

    window.addEventListener('error', (event) => {
        const msg = event?.message || 'unknown';
        logError('ui_runtime_error', {
            message: msg,
            source: event?.filename || 'n/a',
            line: event?.lineno || 0,
        });
        showFriendlyError(msg);
    });


    window.addEventListener('offline', () => {
        showToast('Sin conexión', 'Verifica internet para sincronizar datos.', 'warning');
    });

    window.addEventListener('online', () => {
        showToast('Conexión restablecida', 'Sincronización reanudada.', 'success');
    });
}

function requestWaitingServiceWorkerActivation(reg) {
    if (!reg?.waiting) return;
    try {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    } catch (err) {
        logWarn('sw_waiting_activation_failed', { reason: err?.message || 'unknown' });
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

function safeNavigate(url) {
    if (typeof window === 'undefined') return;
    if (window.__appRedirectLock) return;
    const current = (window.location.pathname.split('/').pop() || '').toLowerCase();
    const target = String(url || '').split('?')[0].toLowerCase();
    if (!target || current === target) return;
    window.__appRedirectLock = true;
    window.location.replace(url);
}

function toLastSeenDate(value) {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

function formatLastSeen(value) {
    const d = toLastSeenDate(value);
    if (!d) return 'SIN REGISTRO';
    const datePart = d.toLocaleDateString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
    });
    const timePart = d.toLocaleTimeString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
    });
    return `${datePart} · ${timePart}`;
}

async function resolveOnlineNexusViewerRole() {
    if (!onlineNexusCurrentUid) return false;
    if (onlineNexusRoleResolvedFor === onlineNexusCurrentUid) return onlineNexusViewerIsAdmin;

    onlineNexusRoleResolvedFor = onlineNexusCurrentUid;
    onlineNexusViewerIsAdmin = false;
    try {
        const me = await getDocument('usuarios', onlineNexusCurrentUid);
        const email = String(me?.email || '').toLowerCase();
        onlineNexusViewerIsAdmin = me?.rol === 'Admin' || email === 'juanan221091@gmail.com';
    } catch (_) {
        onlineNexusViewerIsAdmin = false;
    }

    return onlineNexusViewerIsAdmin;
}

async function fetchPresenceBuckets(limitOnline = 80, limitRecent = 140, includeOffline = true) {
    const { collection, query, where, limit, orderBy } = await import('https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js');
    const threshold = new Date(Date.now() - 5 * 60 * 1000);

    const onlineSnap = await getDocsSafe(
        query(
            collection(db, 'usuarios'),
            where('ultimoAcceso', '>', threshold),
            limit(limitOnline),
        ),
        'online-nexus-online',
    );

    const online = (onlineSnap?.docs || [])
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => Number(b.puntosRanking || 1000) - Number(a.puntosRanking || 1000));

    let offline = [];
    if (includeOffline) {
        const recentSnap = await getDocsSafe(
            query(
                collection(db, 'usuarios'),
                orderBy('ultimoAcceso', 'desc'),
                limit(limitRecent),
            ),
            'online-nexus-recent',
        );

        const onlineIds = new Set(online.map((u) => u.id));
        offline = (recentSnap?.docs || [])
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((u) => !onlineIds.has(u.id))
            .sort((a, b) => {
                const aMs = toLastSeenDate(a.ultimoAcceso)?.getTime() || 0;
                const bMs = toLastSeenDate(b.ultimoAcceso)?.getTime() || 0;
                return bMs - aMs;
            });
    }

    return { online, offline };
}

function ensureOnlineNexusStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('online-nexus-inline-style')) return;
    const style = document.createElement('style');
    style.id = 'online-nexus-inline-style';
    style.textContent = `
      .online-nexus-section { display:flex; flex-direction:column; gap:8px; margin-top: 2px; }
      .online-nexus-section-title { font-size: 10px; font-weight: 900; color: rgba(255,255,255,0.72); letter-spacing: 1.1px; text-transform: uppercase; }
      .online-nexus-item { display:flex; align-items:center; gap:10px; padding:8px; border-radius:12px; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.04); cursor:pointer; transition:all .2s ease; }
      .online-nexus-item:hover { border-color: rgba(198,255,0,0.4); background: rgba(198,255,0,0.08); }
      .online-nexus-item.me { border-color: rgba(198,255,0,0.4); background: rgba(198,255,0,0.1); }
      .online-nexus-item.offline { border-color: rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); }
      .online-nexus-avatar { width:32px; height:32px; border-radius:50%; object-fit:cover; border:1px solid rgba(255,255,255,0.2); }
      .online-nexus-main { min-width:0; display:flex; flex-direction:column; }
      .online-nexus-name { font-size:11px; font-weight:900; color:#fff; text-transform:uppercase; letter-spacing:.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .online-nexus-sub { font-size:9px; font-weight:800; color:rgba(255,255,255,0.62); text-transform:uppercase; letter-spacing:.6px; }
      .online-nexus-pill { margin-left:auto; font-size:9px; font-weight:900; color:#c6ff00; border:1px solid rgba(198,255,0,0.35); border-radius:999px; padding:2px 7px; }
      .online-nexus-pill.offline { color: rgba(255,255,255,0.74); border-color: rgba(255,255,255,0.16); }
      .online-nexus-empty { font-size:11px; font-weight:700; color: rgba(255,255,255,0.45); padding: 8px 4px; text-transform: uppercase; letter-spacing: .8px; }
    `;
    document.head.appendChild(style);
}

async function openOnlineNexusModal() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('online-nexus-modal')) return;
    ensureOnlineNexusStyles();
    const canSeeOffline = await resolveOnlineNexusViewerRole();

    const overlay = document.createElement('div');
    overlay.id = 'online-nexus-modal';
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
      <div class="modal-card glass-strong animate-up" style="max-width:420px; border:1px solid rgba(255,255,255,0.12);">
        <div class="modal-header">
          <div class="flex-col">
            <h3 class="modal-title font-black text-primary tracking-widest">NEXUS ONLINE</h3>
            <span id="online-nexus-count" class="text-[10px] text-muted font-bold uppercase">Sincronizando...</span>
          </div>
          <button class="close-btn" aria-label="Cerrar">&times;</button>
        </div>
        <div class="modal-body custom-scroll p-3 flex-col gap-2" style="max-height:68vh;">
          <div class="online-nexus-section">
            <div class="online-nexus-section-title">ONLINE</div>
            <div id="online-nexus-online-list" class="flex-col gap-2"></div>
          </div>
          ${canSeeOffline ? `<div class="online-nexus-section">
            <div class="online-nexus-section-title">OFFLINE (ULTIMA ACTIVIDAD)</div>
            <div id="online-nexus-offline-list" class="flex-col gap-2"></div>
          </div>` : ''}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const onlineListEl = overlay.querySelector('#online-nexus-online-list');
    const offlineListEl = canSeeOffline ? overlay.querySelector('#online-nexus-offline-list') : null;
    const countEl = overlay.querySelector('#online-nexus-count');

    const render = async () => {
      if (!onlineListEl || !countEl) return;
      let onlineUsers = [];
      let offlineUsers = [];
      try {
        const buckets = await fetchPresenceBuckets(80, 160, canSeeOffline);
        onlineUsers = buckets.online;
        offlineUsers = buckets.offline;
      } catch (_) {
        countEl.textContent = 'Sin conexión';
        onlineListEl.innerHTML = '<div class="online-nexus-empty">No se pudo cargar online</div>';
        if (offlineListEl) offlineListEl.innerHTML = '<div class="online-nexus-empty">No se pudo cargar offline</div>';
        return;
      }

      countEl.textContent = canSeeOffline
        ? `${onlineUsers.length} ONLINE · ${offlineUsers.length} OFFLINE RECIENTES`
        : `${onlineUsers.length} ONLINE AHORA`;

      onlineListEl.innerHTML = onlineUsers.length
        ? onlineUsers.map((u) => {
        const displayName = u.nombreUsuario || u.nombre || 'Jugador';
        const photo = u.fotoPerfil || u.fotoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random&color=fff`;
        const lvl = Number(u.nivel || 2.5).toFixed(2);
        const meCls = u.id === onlineNexusCurrentUid ? 'me' : '';
        return `
          <div class="online-nexus-item ${meCls}" onclick="window.viewProfile('${u.id}')">
            <img src="${photo}" alt="${u.nombreUsuario || u.nombre || 'Jugador'}" class="online-nexus-avatar" loading="lazy">
            <div class="online-nexus-main">
              <span class="online-nexus-name">${(u.nombreUsuario || u.nombre || 'Jugador').toUpperCase()}</span>
              <span class="online-nexus-sub">${(u.rol || 'Jugador').toUpperCase()} · ACTIVO AHORA</span>
            </div>
            <span class="online-nexus-pill">NV ${lvl}</span>
          </div>
        `;
      }).join('')
        : '<div class="online-nexus-empty">No hay usuarios online ahora</div>';

      if (offlineListEl) {
        offlineListEl.innerHTML = offlineUsers.length
          ? offlineUsers.map((u) => {
            const displayName = u.nombreUsuario || u.nombre || 'Jugador';
            const photo = u.fotoPerfil || u.fotoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random&color=fff`;
            const lvl = Number(u.nivel || 2.5).toFixed(2);
            const seen = formatLastSeen(u.ultimoAcceso);
            const meCls = u.id === onlineNexusCurrentUid ? 'me' : '';
            return `
              <div class="online-nexus-item offline ${meCls}" onclick="window.viewProfile('${u.id}')">
                <img src="${photo}" alt="${u.nombreUsuario || u.nombre || 'Jugador'}" class="online-nexus-avatar" loading="lazy">
                <div class="online-nexus-main">
                  <span class="online-nexus-name">${(u.nombreUsuario || u.nombre || 'Jugador').toUpperCase()}</span>
                  <span class="online-nexus-sub">${(u.rol || 'Jugador').toUpperCase()} · ${seen}</span>
                </div>
                <span class="online-nexus-pill offline">NV ${lvl}</span>
              </div>
            `;
        }).join('')
          : '<div class="online-nexus-empty">Sin offline recientes</div>';
      }
    };

    await render();
    const refreshId = setInterval(render, 60 * 1000);

    const close = () => {
      clearInterval(refreshId);
      overlay.remove();
    };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.close-btn')?.addEventListener('click', close);
}

function initOnlineNexusBindings(uid) {
    if (uid && uid !== onlineNexusCurrentUid) {
        onlineNexusRoleResolvedFor = null;
    }
    onlineNexusCurrentUid = uid || onlineNexusCurrentUid;
    if (typeof window === 'undefined') return;
    if (window.__onlineNexusBound) return;
    window.__onlineNexusBound = true;

    window.showOnlineNexus = () => openOnlineNexusModal();
    window.showOnlineUsers = () => openOnlineNexusModal();
}

if (typeof window !== 'undefined' && !window.viewProfile) {
    window.viewProfile = (uid) => {
        if (!uid) return;
        window.location.href = `perfil.html?uid=${uid}`;
    };
}

import { getAppBase } from './modules/path-utils.js';

/**
 * UTILS & CONFIG
 */
export function initAppUI(activePageName) {
    if (typeof window !== 'undefined') {
        const currentPath = (window.location.pathname || '').toLowerCase();
        if (window.__appUIInitPath === currentPath) return;
        window.__appUIInitPath = currentPath;
    }

    initGlobalFeedbackHooks();
    ensureGlobalBackgroundLayer();
    ensureErrorBoundaryLayer();
    ensureBootLoader();
    if (typeof window !== 'undefined' && !window.__globalGalaxyBooted) {
        window.__globalGalaxyBooted = true;
        import('./modules/galaxy-bg.js?v=6.5')
            .then((m) => m?.initGalaxyBackground?.())
            .catch(() => {});
    }
    if (typeof window !== 'undefined' && !window.__bootFallbackTimerSet) {
        window.__bootFallbackTimerSet = true;
        setTimeout(() => hideBootLoader(0), 5000);
    }

    // Keep visual stack deterministic across pages:
    // master-polish -> ux-enhance -> padel-fusion (last)
    const ensureStylesheetAsLast = (href, key) => {
        const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
        let link = links.find((el) => String(el.getAttribute('href') || '').includes(key));
        if (!link) {
            link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = href;
            link.setAttribute('data-ui-core-style', key);
            document.head.appendChild(link);
            return;
        }
        if (link.parentNode === document.head) {
            document.head.appendChild(link);
        }
    };

    ensureStylesheetAsLast('./css/master-polish.css', 'master-polish.css');
    ensureStylesheetAsLast('./css/ux-enhance.css', 'ux-enhance.css');
    ensureStylesheetAsLast('./css/padel-fusion.css', 'padel-fusion.css');

    // Register Service Worker for PWA + automatic updates
    if ('serviceWorker' in navigator && !window.__swRegisterBound) {
        window.__swRegisterBound = true;

        const registerSW = () => {
            const host = window.location.hostname || '';
            const isLocal = host === 'localhost' || host === '127.0.0.1';
            const base = getAppBase();
            const candidates = [
                { swPath: `${base}sw.js`, swScope: base }
            ];

            let attempt = Promise.reject(new Error('sw-init'));
            candidates.forEach((cfg) => {
                attempt = attempt.catch(() => navigator.serviceWorker.register(cfg.swPath, {
                    scope: cfg.swScope,
                    updateViaCache: 'none'
                }).then((reg) => ({ reg, cfg })));
            });

            attempt
                .then(({ reg, cfg }) => {
                    window.__swRegisteredByCore = true;
                    window.__swRegRef = reg;
                    window.__swConfig = cfg;
                    logInfo('sw_registered', { scope: reg.scope, swPath: cfg.swPath });

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
                .catch((err) => logError('sw_register_failed', { reason: err?.message || 'unknown' }));
        };

        if (document.readyState === 'complete') registerSW();
        else window.addEventListener('load', registerSW, { once: true });
    }

    const path = window.location.pathname.toLowerCase();
    const isPublic = PUBLIC_PAGES.some(p => path.includes(p)) || path.endsWith('/') || path === '';

    // Only inject UI in PRIVATE pages if not already present
    // If we're not public, we hide the content until auth is ready via the boot-loader
    if (!isPublic) {
        // We use the existing boot loader to avoid the harsh "blank screen" flicker
        document.body.style.opacity = '1'; 
    }

    observerAuth(async (user) => {
        if (!window.__authResolvedFlag) window.__authResolvedFlag = false;
        window.__authResolvedFlag = true;
        logInfo('auth_state_changed', { hasUser: !!user, path });

        if (user) {
            initOnlineNexusBindings(user.uid);
            try {
                const { initPushNotifications } = await import('./modules/push-notifications.js');
                initPushNotifications(user.uid).catch(() => {});
            } catch (_) {}
            document.body.style.opacity = '1';
            document.body.style.pointerEvents = 'auto';
            hideBootLoader();
            // Logged in user on index/login -> Redirect to Home
            if (isPublic && !path.includes('registro.html') && !path.includes('recuperar.html') && !path.includes('terms.html')) {
                logInfo('redirect_home_logged_in', { path });
                try {
                    if (path.includes('index.html') || path === '/' || path.endsWith('/')) {
                        sessionStorage.setItem('show_home_welcome', '1');
                    }
                } catch (_) {}
                safeNavigate('home.html');
                return;
            }
            
            // Fill data
            try {
                const { injectHeader, injectNavbar, updateHeader } = await import('./modules/ui-loader.js?v=6.5');
                const userData = await getDocument("usuarios", user.uid);
                
                // Always inject for private pages
                if (!isPublic) {
                    await injectHeader(userData);
                    await injectNavbar(activePageName || 'home');
                }


                if (userData) {
                    updateHeader(userData);
                    listenToGlobalNotifs(user.uid);
                }
            } catch (e) {
                logError('load_user_data_failed', { reason: e?.message || 'unknown' });
                hideBootLoader();
            }
        } else {
            onlineNexusCurrentUid = null;
            onlineNexusViewerIsAdmin = false;
            onlineNexusRoleResolvedFor = null;
            // Guest user on private page -> Redirect to Index
            if (!isPublic) {
                logInfo('redirect_login_guest', { path });
                safeNavigate('index.html');
            } else {
                hideBootLoader();
            }
        }
    });

    if (isPublic && typeof window !== 'undefined') {
        const done = () => hideBootLoader(60);
        if (document.readyState === 'complete') done();
        else window.addEventListener('load', done, { once: true });
    }
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

/**
 * Modal de preferencia de lado (inscripción eventos).
 * @returns {Promise<'derecha'|'reves'|'flex'|null>}
 */
export function showSidePreferenceModal() {
    if (typeof document === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay modal-side-pref';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'side-pref-title');
        overlay.innerHTML = `
            <div class="modal-card modal-side-pref-card">
                <div class="modal-header">
                    <h3 id="side-pref-title" class="modal-title"><i class="fas fa-hand-point-up"></i> Posición preferida</h3>
                    <button type="button" class="modal-close" aria-label="Cerrar">&times;</button>
                </div>
                <div class="modal-body">
                    <p class="side-pref-desc">Elige tu lado preferido para el emparejamiento:</p>
                    <div class="side-pref-btns">
                        <button type="button" class="btn-side-opt" data-value="derecha"><i class="fas fa-hand-point-right"></i> Derecha</button>
                        <button type="button" class="btn-side-opt" data-value="reves"><i class="fas fa-hand-point-left"></i> Revés</button>
                        <button type="button" class="btn-side-opt btn-side-opt-flex" data-value="flex"><i class="fas fa-arrows-left-right"></i> Me da igual</button>
                    </div>
                </div>
            </div>
        `;
        const close = (value) => {
            overlay.classList.remove('active');
            overlay.style.animation = 'modalFadeOut 0.25s ease forwards';
            setTimeout(() => {
                overlay.remove();
                resolve(value);
            }, 260);
        };
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close(null);
        });
        overlay.querySelector('.modal-close')?.addEventListener('click', () => close(null));
        overlay.querySelectorAll('.btn-side-opt').forEach((btn) => {
            btn.addEventListener('click', () => close(btn.dataset.value));
        });
        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') close(null);
        });
        document.body.appendChild(overlay);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => overlay.classList.add('active'));
        });
    });
}

if (typeof window !== 'undefined') {
    window.showSidePreferenceModal = showSidePreferenceModal;
}
