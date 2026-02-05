/* =====================================================
   PADELUMINATIS NOTIFICATIONS - ALERT SYSTEM V5.0
   Centralized notification handling and listeners.
   ===================================================== */

import { auth, db, subscribeCol } from '../firebase-service.js';
import { collection, addDoc, serverTimestamp, updateDoc, doc } from 'https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js';

/**
 * Send a notification to one or multiple users
 */
export async function sendNotification(targetUids, title, message, type = 'info', link = null) {
    if (!targetUids) return;
    const targets = Array.isArray(targetUids) ? targetUids : [targetUids];
    
    try {
        const promises = targets.map(uid => {
            if (!uid) return Promise.resolve();
            return addDoc(collection(db, "notificaciones"), {
                destinatario: uid,
                remitente: auth.currentUser?.uid || 'system',
                tipo: type,
                titulo: title,
                mensaje: message,
                enlace: link,
                leido: false,
                timestamp: serverTimestamp(),
                // compatibility fields (legacy)
                uid: uid, 
                title: title,
                message: message,
                read: false,
                createdAt: serverTimestamp()
            });
        });
        await Promise.all(promises);
        return true;
    } catch (e) {
        console.error("Error sending notifications:", e);
        return false;
    }
}

/**
 * Mark notification as read
 */
export async function markAsRead(notifId) {
    try {
        const ref = doc(db, "notificaciones", notifId);
        await updateDoc(ref, { 
            leido: true,
            read: true // compatibility
        });
        return true;
    } catch (e) {
        console.error(e);
        return false;
    }
}

/**
 * Global listener for notifications
 */
export function listenToNotifications(callback) {
    if (!auth.currentUser) return null;
    return subscribeCol("notificaciones", callback, [['destinatario', '==', auth.currentUser.uid]]);
}
