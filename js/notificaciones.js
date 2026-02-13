/* =====================================================
   PADELUMINATIS NOTIFICATIONS LOGIC V5.1
   ===================================================== */

import { auth, db, observerAuth, subscribeCol, updateDocument } from './firebase-service.js';
import { collection, deleteDoc, doc, query, where, writeBatch } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, showToast } from './ui-core.js';

let currentUser = null;
let allNotifs = [];

document.addEventListener('DOMContentLoaded', () => {
    initAppUI('notifications');

    observerAuth((user) => {
        if (!user) {
            window.location.href = 'index.html';
            return;
        }
        currentUser = user;

        subscribeCol(
            'notificaciones',
            (list) => {
                allNotifs = list.sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0));
                renderList();
            },
            [['destinatario', '==', user.uid]]
        );
    });

    document.getElementById('btn-read-all')?.addEventListener('click', markAllAsRead);
    document.getElementById('btn-clear-all')?.addEventListener('click', clearAllNotifications);
});

async function markAllAsRead() {
    if (!currentUser || allNotifs.length === 0) return;
    const batch = writeBatch(db);
    allNotifs.filter(n => !n.leido).forEach(n => {
        const ref = doc(db, 'notificaciones', n.id);
        batch.update(ref, { leido: true, read: true });
    });
    try {
        await batch.commit();
        showToast('¡Hecho!', 'Todas las notificaciones marcadas como leídas', 'success');
    } catch (e) {
        console.error(e);
    }
}

async function clearAllNotifications() {
    if (!confirm('¿Estás seguro de que quieres borrar todas las notificaciones?')) return;
    const batch = writeBatch(db);
    allNotifs.forEach(n => {
        const ref = doc(db, 'notificaciones', n.id);
        batch.delete(ref);
    });
    try {
        await batch.commit();
        showToast('Historial Limpio', 'Se han borrado todas las notificaciones', 'info');
    } catch (e) {
        console.error(e);
    }
}

function renderList() {
    const container = document.getElementById('notif-list');
    if (!container) return;

    if (allNotifs.length === 0) {
        container.innerHTML = `
            <div class="empty-state-v5">
                <i class="fas fa-bell-slash"></i>
                <p class="font-bold text-white">Bandeja Vacía</p>
                <p class="text-xs">No tienes notificaciones nuevas por ahora.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = allNotifs.map(n => {
        const date = n.timestamp?.toDate?.() || new Date();
        const iconInfo = getIconInfo(n.tipo);
        const timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const dateStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).toUpperCase();

        return `
            <div class="notif-item-v5 ${n.leido ? '' : 'unread'}" onclick="handleNotifClick('${n.id}', '${n.enlace || ''}')">
                <div class="ni-icon-v5 ${n.tipo || 'system'}">
                    <i class="fas ${iconInfo.icon}"></i>
                </div>
                <div class="ni-content-v5">
                    <div class="ni-top-v5">
                        <span class="ni-title-v5">${n.titulo || 'Notificación'}</span>
                        <span class="ni-time-v5">${timeStr} · ${dateStr}</span>
                    </div>
                    <p class="ni-msg-v5">${n.mensaje || ''}</p>
                </div>
                <div class="ni-actions-v5" onclick="event.stopPropagation(); deleteNotification('${n.id}')">
                    <i class="fas fa-trash-can opacity-20 hover:opacity-100 hover:text-red-500 transition-all"></i>
                </div>
            </div>
        `;
    }).join('');
}

function getIconInfo(type) {
    switch (type) {
        case 'match_invite': return { icon: 'fa-envelope-open-text' };
        case 'match_join': return { icon: 'fa-user-plus' };
        case 'match_result': return { icon: 'fa-trophy' };
        case 'reto': return { icon: 'fa-bolt' };
        case 'info': return { icon: 'fa-circle-info' };
        case 'private_invite': return { icon: 'fa-lock' };
        case 'warning': return { icon: 'fa-triangle-exclamation' };
        case 'ranking_change': return { icon: 'fa-chart-line' };
        case 'match_reminder': return { icon: 'fa-clock' };
        case 'system': return { icon: 'fa-gear' };
        default: return { icon: 'fa-bell' };
    }
}

window.handleNotifClick = async (id, link) => {
    await updateDocument('notificaciones', id, { leido: true, read: true });
    if (link) window.location.href = link;
};

window.deleteNotification = async (id) => {
    if (!confirm('¿Borrar esta notificación?')) return;
    try {
        await deleteDoc(doc(db, 'notificaciones', id));
        showToast('Borrado', 'Notificación eliminada', 'info');
    } catch (e) {
        console.error(e);
    }
};

