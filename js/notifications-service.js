
import { db } from './firebase-service.js';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

/**
 * Crea una notificación para un usuario (o varios si uid es array).
 */
export async function createNotification(targetUid, title, message, type = 'info', link = null) {
    if (!targetUid) return;
    try {
        const targets = Array.isArray(targetUid) ? targetUid : [targetUid];
        const promises = targets.map(uid => {
            if (!uid) return Promise.resolve();
            return addDoc(collection(db, "notificaciones"), {
                uid: uid,
                title: title,
                message: message,
                type: type,
                link: link,
                read: false,
                createdAt: serverTimestamp()
            });
        });
        await Promise.all(promises);
    } catch (e) {
        console.error("Error enviando notificaciones:", e);
    }
}

/**
 * Marca una notificación como leída.
 */
export async function markAsRead(notifId) {
    try {
        await updateDoc(doc(db, "notificaciones", notifId), { read: true });
    } catch (e) { console.error(e); }
}
