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
    if (allNotifs.length === 0) return;
    if (!confirm('¿Estás seguro de que quieres vaciar toda tu bandeja de entrada? Esta acción es irreversible.')) return;
    
    const batch = writeBatch(db);
    allNotifs.forEach(n => {
        const ref = doc(db, 'notificaciones', n.id);
        batch.delete(ref);
    });
    
    try {
        await batch.commit();
        showToast('Matrix Limpia', 'Se han eliminado todas las trazas de comunicación.', 'info');
    } catch (e) {
        console.error("Error clearing notifications:", e);
        showToast('Error', 'No se pudieron borrar todas las notificaciones.', 'error');
    }
}

function renderList() {
    const container = document.getElementById('notif-list');
    if (!container) return;

    if (allNotifs.length === 0) {
        container.innerHTML = `
            <div class="empty-state-v5 py-20 opacity-30">
                <i class="fas fa-bell-slash text-4xl mb-4"></i>
                <p class="font-black uppercase tracking-widest text-xs">Bandeja de Entrada Vacía</p>
                <p class="text-[10px] font-bold mt-1">Sincronización completa. Sin alertas pendientes.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = allNotifs.map(n => {
        const date = n.timestamp?.toDate?.() || new Date();
        const iconInfo = getIconInfo(n.tipo);
        const timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const dateStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).toUpperCase();
        const isUnread = !n.leido;

        return `
            <div class="notif-item-v7 ${isUnread ? 'unread' : ''} animate-up" onclick="handleNotifClick('${n.id}', '${n.enlace || ''}')">
                <div class="notif-icon-v7 ${iconInfo.variant}">
                    <i class="fas ${iconInfo.icon}"></i>
                </div>
                
                <div class="notif-body">
                    <div class="notif-title-row">
                        <span class="notif-title">${n.titulo || 'Notificación'}</span>
                        <span class="notif-time">${timeStr} · ${dateStr}</span>
                    </div>
                    <p class="notif-msg">${n.mensaje || ''}</p>
                    
                    <div class="notif-actions-row">
                        ${isUnread ? `<button class="notif-btn-s primary" onclick="event.stopPropagation(); handleNotifClick('${n.id}')">LEER</button>` : ''}
                        <button class="notif-btn-s outline" onclick="event.stopPropagation(); deleteNotification('${n.id}')">
                            <i class="fas fa-trash-can"></i>
                        </button>
                    </div>
                </div>
                
                ${isUnread ? '<div class="unread-dot"></div>' : ''}
            </div>
        `;
    }).join('');
}

function getIconInfo(type) {
    switch (type) {
        case 'match_invite':
        case 'private_invite': 
            return { icon: 'fa-envelope-open-text', variant: 'type-match' };
        case 'match_join': 
            return { icon: 'fa-user-plus', variant: 'type-match' };
        case 'match_result':
        case 'ranking_change': 
            return { icon: 'fa-trophy', variant: 'type-challenge' };
        case 'reto': 
            return { icon: 'fa-bolt-lightning', variant: 'type-challenge' };
        case 'match_reminder': 
            return { icon: 'fa-clock-rotate-left', variant: 'type-system' };
        case 'warning': 
            return { icon: 'fa-triangle-exclamation', variant: 'type-system' };
        default: 
            return { icon: 'fa-ghost', variant: 'type-system' };
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

