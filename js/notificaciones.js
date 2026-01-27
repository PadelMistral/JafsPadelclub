// notificaciones.js - Definitive Pro Communication System
import { db, observerAuth, subscribeCol, updateDocument } from './firebase-service.js';
import { collection, query, where, writeBatch, getDocs } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';
import { initAppUI, showToast } from './ui-core.js';

initAppUI('notifications');

document.addEventListener('DOMContentLoaded', () => {
    const listEl = document.getElementById('notif-list');
    const readAllBtn = document.getElementById('btn-read-all');
    const clearAllBtn = document.getElementById('btn-clear-all');
    let currentFilter = 'all';
    let fullList = [];

    observerAuth((user) => {
        if (user) {
            startNotifSync(user.uid);
            setupActions(user.uid);
        }
    });

    function startNotifSync(uid) {
        subscribeCol("notificaciones", (list) => {
            fullList = list;
            applyFilter();
        }, [['uid', '==', uid]], [['createdAt', 'desc']]);
    }

    function applyFilter() {
        let filtered = fullList;
        if (currentFilter === 'unread') filtered = fullList.filter(n => !n.read);
        if (currentFilter === 'read') filtered = fullList.filter(n => n.read);
        renderNotifs(filtered);
    }

    function renderNotifs(list) {
        if (!listEl) return;
        if (list.length === 0) {
            listEl.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-satellite-dish text-4xl mb-4 text-matrix-cyan opacity-20"></i>
                    <p class="text-xs font-bold tracking-widest text-matrix-cyan opacity-30">SIN COMUNICACIONES EN EL NEXO</p>
                </div>
            `;
            return;
        }

        listEl.innerHTML = list.map(n => `
            <div class="n-item ${n.read ? '' : 'unread'} animate-up" onclick="handleNotifClick('${n.id}', '${n.link || ''}')">
                <div class="n-icon">
                    <i class="fas ${getIcon(n.type)}"></i>
                </div>
                <div class="n-content">
                    <div class="n-header">
                        <div class="n-title">${n.title.toUpperCase()}</div>
                        <div class="n-time">${timeAgo(n.createdAt)}</div>
                    </div>
                    <div class="n-body">${n.message}</div>
                </div>
            </div>
        `).join('');
    }

    function getIcon(type) {
        switch(type) {
            case 'match_invite': return 'fa-user-plus';
            case 'match_join': return 'fa-users-viewfinder';
            case 'match_today': return 'fa-calendar-check';
            case 'rank_up': return 'fa-angles-up';
            case 'rank_down': return 'fa-angles-down';
            case 'chat': return 'fa-comment-dots';
            case 'puntos': return 'fa-star';
            case 'success': return 'fa-shield-check';
            case 'warning': return 'fa-triangle-exclamation';
            default: return 'fa-satellite';
        }
    }

    function timeAgo(ts) {
        if (!ts) return 'NOW';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        const sec = Math.floor((new Date() - d) / 1000);
        if (sec < 60) return `${sec}S`;
        if (sec < 3600) return `${Math.floor(sec/60)}M`;
        if (sec < 86400) return `${Math.floor(sec/3600)}H`;
        return d.toLocaleDateString();
    }

    async function handleNotifClick(id, link) {
        await updateDocument("notificaciones", id, { read: true });
        if (link) window.location.href = link;
    }
    window.handleNotifClick = handleNotifClick;

    function setupActions(uid) {
        if (readAllBtn) {
            readAllBtn.onclick = async () => {
                const snap = await getDocs(query(collection(db, "notificaciones"), where("uid", "==", uid), where("read", "==", false)));
                if (snap.empty) return showToast("Info", "Sin lecturas pendientes.", "info");
                
                const batch = writeBatch(db);
                snap.forEach(d => batch.update(d.ref, { read: true }));
                await batch.commit();
                showToast("Sistemas OK", "Nexo silenciado.", "success");
            };
        }

        if (clearAllBtn) {
            clearAllBtn.onclick = async () => {
                if (!confirm("¿Borrar todo el historial de notificaciones?")) return;
                const snap = await getDocs(query(collection(db, "notificaciones"), where("uid", "==", uid)));
                if (snap.empty) return;
                
                const batch = writeBatch(db);
                snap.forEach(d => batch.delete(d.ref));
                await batch.commit();
                showToast("Historial Limpio", "Se han borrado todas las alertas.", "warning");
            };
        }

        // Filter tabs
        document.querySelectorAll('.btn-chip').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.btn-chip').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentFilter = btn.dataset.filter;
                applyFilter();
            };
        });
    }
});
