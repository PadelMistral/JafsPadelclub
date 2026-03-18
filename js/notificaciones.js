/* =====================================================
   PADELUMINATIS NOTIFICACIONES JS
   Lógica para la bandeja de entrada y gestión de Push
   ===================================================== */

import { auth, db } from "./firebase-service.js";
import { 
    collection, 
    query, 
    where, 
    orderBy, 
    onSnapshot, 
    getDocs, 
    doc, 
    updateDoc, 
    deleteDoc, 
    writeBatch,
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import { initAppUI, showToast } from "./ui-core.js";
import { injectHeader, injectNavbar } from "./modules/ui-loader.js";
import { observeCoreSession } from "./core/core-engine.js";
import { 
    getPushStatusHuman, 
    requestNotificationPermission, 
    checkNotificationStatus,
    showNotificationHelpModal 
} from "./modules/push-notifications.js";
import { toDateSafe } from "./utils/match-utils.js";

let currentUser = null;
let currentFilter = "all";
let unsubNotifs = null;
let notifications = [];

// DOM Elements
const notifListEl = document.getElementById("notif-list");
const pushStatusBanner = document.getElementById("push-status-banner");
const globalPushStatusText = document.getElementById("global-push-status");
const permissionArea = document.getElementById("permission-area");
const permStatusText = document.getElementById("perm-status-text");
const btnRequestPush = document.getElementById("btn-request-push");
const btnReadAll = document.getElementById("btn-read-all");
const btnClearAll = document.getElementById("btn-clear-all");
const filterTabs = document.querySelectorAll(".filter-tab-v8");

// Init
initAppUI("notificaciones");

observeCoreSession({
    onSignedOut: () => {
        console.warn("[Notificaciones] No session found, redirecting to index...");
        window.location.replace("index.html");
    },
    onReady: async ({ user, userDoc }) => {
        console.log("[Notificaciones] Session ready for user:", user.uid);
        currentUser = user;
        try {
            await injectHeader(userDoc);
            injectNavbar("notificaciones");
            
            loadNotifications(user.uid);
            updatePushStatusUI();
            setupFilterTabs();
            setupGlobalActions();
            window.showNotificationHelpModal = showNotificationHelpModal;
            console.log("[Notificaciones] Initialization complete.");
        } catch (err) {
            console.error("[Notificaciones] Error in onReady initialization:", err);
            showToast("Error", "Error al inicializar la vista de notificaciones", "error");
        }
    }
});

/**
 * Carga las notificaciones del usuario
 */
function loadNotifications(uid) {
    if (unsubNotifs) unsubNotifs();

    const q = query(
        collection(db, "notificaciones"),
        where("destinatario", "==", uid),
        orderBy("timestamp", "desc")
    );

    unsubNotifs = onSnapshot(q, (snapshot) => {
        notifications = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderNotifications();
    }, (err) => {
        console.error("Error loading notifications:", err);
        notifListEl.innerHTML = `
            <div class="empty-state-v8">
                <i class="fas fa-exclamation-triangle"></i>
                <p>No pudimos cargar tus notificaciones. Reintenta en unos instantes.</p>
            </div>`;
    });
}

/**
 * Renderiza la lista según el filtro activo
 */
function renderNotifications() {
    if (!notifications.length) {
        notifListEl.innerHTML = `
            <div class="empty-state-v8 animate-fade-in">
                <div class="empty-icon-v8"><i class="fas fa-bell-slash"></i></div>
                <h3>Bandeja vacía</h3>
                <p>No tienes notificaciones por ahora.</p>
            </div>`;
        return;
    }

    let filtered = notifications;
    if (currentFilter === "unread") {
        filtered = notifications.filter(n => !n.leido && !n.read);
    } else if (currentFilter === "read") {
        filtered = notifications.filter(n => n.leido || n.read);
    }

    if (!filtered.length) {
        notifListEl.innerHTML = `
            <div class="empty-state-v8 animate-fade-in">
                <i class="fas fa-filter"></i>
                <p>No hay notificaciones con este filtro.</p>
            </div>`;
        return;
    }

    notifListEl.innerHTML = filtered.map(n => {
        const date = toDateSafe(n.timestamp || n.createdAt);
        const timeStr = date ? date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "";
        const dayStr = date ? date.toLocaleDateString("es-ES", { day: "numeric", month: "short" }).toUpperCase() : "";
        const isRead = n.leido || n.read;
        const typeIcon = getTypeIcon(n.tipo || n.type);

        return `
            <div class="notif-item-v8 ${isRead ? 'read' : 'unread'} animate-up" data-id="${n.id}">
                <div class="notif-icon-v8 ${n.tipo || 'info'}">
                    <i class="fas ${typeIcon}"></i>
                </div>
                <div class="notif-body-v8">
                    <div class="notif-top">
                        <span class="notif-title-v8">${n.titulo || n.title || 'Aviso'}</span>
                        <span class="notif-time-v8">${dayStr} · ${timeStr}</span>
                    </div>
                    <p class="notif-msg-v8">${n.mensaje || n.message || ''}</p>
                    <div class="notif-actions-v8">
                        ${n.enlace ? `<button class="btn-notif-action primary" data-link="${n.enlace}"><i class="fas fa-external-link-alt mr-1"></i> VER DETALLE</button>` : ''}
                        ${!isRead ? `<button class="btn-notif-action mark-read" data-id="${n.id}"><i class="fas fa-check mr-1"></i> LEER</button>` : ''}
                        <button class="btn-notif-action delete" data-id="${n.id}"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </div>
            </div>
        `;
    }).join("");

    // Bind item actions
    notifListEl.querySelectorAll(".primary").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            if (btn.dataset.link) window.location.href = btn.dataset.link;
        };
    });

    notifListEl.querySelectorAll(".mark-read").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            markAsRead(btn.dataset.id);
        };
    });

    notifListEl.querySelectorAll(".delete").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            deleteNotification(btn.dataset.id);
        };
    });
}

function getTypeIcon(type) {
    switch (type) {
        case "match_join": return "fa-user-plus";
        case "match_leave": return "fa-user-minus";
        case "match_full": return "fa-users";
        case "result_uploaded": return "fa-trophy";
        case "match_cancelled": return "fa-calendar-times";
        case "ranking_up": return "fa-arrow-up";
        case "ranking_down": return "fa-arrow-down";
        case "level_up": return "fa-bolt";
        case "system": return "fa-cog";
        default: return "fa-bell";
    }
}

async function markAsRead(id) {
    try {
        await updateDoc(doc(db, "notificaciones", id), { 
            leido: true, 
            read: true, 
            seen: true 
        });
    } catch (e) {
        console.error(e);
    }
}

async function deleteNotification(id) {
    try {
        await deleteDoc(doc(db, "notificaciones", id));
    } catch (e) {
        console.error(e);
    }
}

/**
 * Filtros de la bandeja
 */
function setupFilterTabs() {
    filterTabs.forEach(tab => {
        tab.onclick = () => {
            filterTabs.forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            currentFilter = tab.dataset.filter;
            renderNotifications();
        };
    });
}

/**
 * Acciones globales (Leer todo, Borrar todo)
 */
function setupGlobalActions() {
    btnReadAll.onclick = async () => {
        const unread = notifications.filter(n => !n.leido && !n.read);
        if (!unread.length) return;
        
        try {
            const batch = writeBatch(db);
            unread.forEach(n => {
                batch.update(doc(db, "notificaciones", n.id), { leido: true, read: true, seen: true });
            });
            await batch.commit();
            showToast("Hecho", "Todas las notificaciones marcadas como leídas.", "success");
        } catch (e) {
            console.error(e);
        }
    };

    btnClearAll.onclick = async () => {
        if (!notifications.length) return;
        if (!confirm("¿Seguro que quieres vaciar toda la bandeja?")) return;

        try {
            const batch = writeBatch(db);
            notifications.forEach(n => {
                batch.delete(doc(db, "notificaciones", n.id));
            });
            await batch.commit();
            showToast("Bandeja vacía", "Se han eliminado todas las notificaciones.", "info");
        } catch (e) {
            console.error(e);
        }
    };
}

/**
 * Gestión visual del estado del Push
 */
async function updatePushStatusUI() {
    try {
        const human = await getPushStatusHuman();
        const { ok, title, message, status } = human;

        globalPushStatusText.textContent = ok ? "ACTIVO Y CONECTADO" : title.toUpperCase();
        
        if (ok) {
            pushStatusBanner.classList.add("active");
            permissionArea.classList.add("hidden");
        } else {
            pushStatusBanner.classList.remove("active");
            permissionArea.classList.remove("hidden");
            permStatusText.textContent = message;

            if (status.permission === "denied") {
                btnRequestPush.innerHTML = `<i class="fas fa-info-circle mr-2"></i> VER CÓMO ACTIVAR`;
            } else {
                btnRequestPush.innerHTML = `<i class="fas fa-bell mr-2"></i> ACTIVAR NOTIFICACIONES`;
            }
        }

        btnRequestPush.onclick = async () => {
            if (status.permission === "denied") {
                // Show the guide modal already in HTML
                document.getElementById('notif-denied-guide')?.classList.remove('hidden');
            } else {
                const granted = await requestNotificationPermission(true);
                if (granted) window.location.reload();
            }
        };

        // Test button
        const btnTestPush = document.getElementById("btn-test-push");
        if (btnTestPush) {
            btnTestPush.onclick = async () => {
                const { sendPushNotification } = await import("./modules/push-notifications.js");
                sendPushNotification(
                    "¡Prueba Exitosa!", 
                    "Tu canal de notificaciones está funcionando correctamente.",
                    "https://ui-avatars.com/api/?name=P&background=00d4ff&color=fff"
                );
            };
        }

    } catch (e) {
        console.warn("Push update UI fail:", e);
    }
}

// Check status periodically
setInterval(updatePushStatusUI, 30000);
