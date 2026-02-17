/* =====================================================
   PADELUMINATIS NOTIFICATIONS LOGIC V5.1
   ===================================================== */

import { auth, db, observerAuth, subscribeCol, updateDocument } from './firebase-service.js';
import { collection, deleteDoc, doc, query, where, writeBatch } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, showToast } from './ui-core.js';

let currentUser = null;
let allNotifs = [];
let currentFilter = 'all';
let notifUnsub = null;
let notifBootUid = null;

document.addEventListener('DOMContentLoaded', () => {
    initAppUI('notifications');

    observerAuth(async (user) => {
        if (!user) {
            if (notifUnsub) {
                try { notifUnsub(); } catch (_) {}
                notifUnsub = null;
            }
            notifBootUid = null;
            window.location.href = 'index.html';
            return;
        }
        if (notifBootUid === user.uid) return;
        notifBootUid = user.uid;
        currentUser = user;

        if (notifUnsub) {
            try { notifUnsub(); } catch (_) {}
            notifUnsub = null;
        }

        const unsub = await subscribeCol(
            'notificaciones',
            (list) => {
                allNotifs = list.sort((a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0));
                renderList();
            },
            [['destinatario', '==', user.uid]]
        );
        notifUnsub = typeof unsub === 'function' ? unsub : null;
    });

    document.getElementById('btn-read-all')?.addEventListener('click', markAllAsRead);
    document.getElementById('btn-clear-all')?.addEventListener('click', clearAllNotifications);
    document.querySelectorAll('#filter-tabs .filter-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
            currentFilter = btn.dataset.filter || 'all';
            document.querySelectorAll('#filter-tabs .filter-tab').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            renderList();
        });
    });
});

async function markAllAsRead() {
    if (!currentUser) return;
    if (allNotifs.length === 0) {
        showToast('Sin cambios', 'No hay notificaciones para marcar.', 'info');
        return;
    }
    const batch = writeBatch(db);
    allNotifs.filter(n => n.leido !== true && n.read !== true).forEach(n => {
        const ref = doc(db, 'notificaciones', n.id);
        batch.update(ref, { leido: true, read: true, seen: true });
    });
    try {
        await batch.commit();
        showToast('¡Hecho!', 'Todas las notificaciones marcadas como leídas', 'success');
    } catch (e) {
        console.error(e);
        showToast('Error', 'No se pudieron marcar como leídas.', 'error');
    }
}

async function clearAllNotifications() {
    if (allNotifs.length === 0) {
        showToast('Sin cambios', 'La bandeja ya está vacía.', 'info');
        return;
    }
    if (!confirm('¿Estás seguro de que quieres vaciar toda tu bandeja de entrada? Esta acción es irreversible.')) return;
    
    try {
        showToast('Procesando...', 'Eliminando historial de notificaciones.', 'info');
        
        // Firestore batches are limited to 500 operations. Process in chunks.
        const CHUNK_SIZE = 450;
        for (let i = 0; i < allNotifs.length; i += CHUNK_SIZE) {
            const chunk = allNotifs.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);
            chunk.forEach(n => {
                batch.delete(doc(db, 'notificaciones', n.id));
            });
            await batch.commit();
        }
        
        showToast('Matrix Limpia', 'Se han eliminado todas las trazas de comunicación.', 'success');
    } catch (e) {
        console.error("Error clearing notifications:", e);
        showToast('Error', 'No se pudieron borrar todas las notificaciones.', 'error');
    }
}

function renderList() {
    const container = document.getElementById('notif-list');
    if (!container) return;

    const listToRender = allNotifs.filter((n) => {
        const isUnread = n.leido !== true && n.read !== true;
        if (currentFilter === 'unread') return isUnread;
        if (currentFilter === 'read') return !isUnread;
        return true;
    });

    if (listToRender.length === 0) {
        container.innerHTML = `
            <div class="empty-state-v5 py-20 opacity-30">
                <i class="fas fa-bell-slash text-4xl mb-4"></i>
                <p class="font-black uppercase tracking-widest text-xs">Bandeja de Entrada Vacía</p>
                <p class="text-[10px] font-bold mt-1">Sincronización completa. Sin alertas pendientes.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = listToRender.map(n => {
        const date = n.timestamp?.toDate?.() || new Date();
        const iconInfo = getIconInfo(n.tipo);
        const timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const dateStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).toUpperCase();
        const isUnread = n.leido !== true && n.read !== true;

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
        case 'match_opened':
            return { icon: 'fa-envelope-open-text', variant: 'type-match' };
        case 'match_join': 
            return { icon: 'fa-user-plus', variant: 'type-match' };
        case 'match_full':
            return { icon: 'fa-users', variant: 'type-match' };
        case 'match_cancelled':
            return { icon: 'fa-ban', variant: 'type-system' };
        case 'chat_mention':
            return { icon: 'fa-at', variant: 'type-match' };
        case 'new_rival':
            return { icon: 'fa-user-shield', variant: 'type-challenge' };
        case 'new_challenge':
            return { icon: 'fa-bolt-lightning', variant: 'type-challenge' };
        case 'match_result':
        case 'ranking_change':
        case 'ranking_up':
        case 'ranking_down':
        case 'level_up':
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
    try {
        showToast('Procesando...', 'Marcando notificación como leída.', 'info');
        await updateDocument('notificaciones', id, { leido: true, read: true, seen: true });
        if (link) {
            window.location.href = link;
            return;
        }
        showToast('Notificación', 'Marcada como leída.', 'success');
    } catch (e) {
        console.error(e);
        showToast('Error', 'No se pudo actualizar la notificación.', 'error');
    }
};

window.deleteNotification = async (id) => {
    if (!confirm('¿Borrar esta notificación?')) return;
    try {
        showToast('Procesando...', 'Eliminando notificación.', 'info');
        await deleteDoc(doc(db, 'notificaciones', id));
        showToast('Borrado', 'Notificación eliminada', 'info');
    } catch (e) {
        console.error(e);
        showToast('Error', 'No se pudo borrar la notificación.', 'error');
    }
};
