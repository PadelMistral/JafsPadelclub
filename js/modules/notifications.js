/* js/modules/notifications.js - Push Notification System */
import { showToast } from '../ui-core.js';

let notifPermission = Notification.permission;

/**
 * Requests notification permission
 */
export async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.log('Notifications not supported');
        return false;
    }
    
    if (notifPermission === 'granted') return true;
    
    try {
        const result = await Notification.requestPermission();
        notifPermission = result;
        
        if (result === 'granted') {
            showToast('Notificaciones Activadas', 'Recibirás avisos de partidos y ranking.', 'success');
            return true;
        }
    } catch (e) {
        console.error('Notification permission error:', e);
    }
    
    return false;
}

/**
 * Sends a local push notification
 */
export function sendNotification(title, body, icon = './imagenes/Logojafs.png') {
    if (notifPermission !== 'granted') return;
    
    const options = {
        body,
        icon,
        badge: icon,
        vibrate: [200, 100, 200],
        tag: 'padeluminatis',
        renotify: true,
        data: { url: window.location.href }
    };
    
    try {
        const notification = new Notification(title, options);
        
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    } catch (e) {
        console.error('Notification error:', e);
    }
}

/**
 * Schedule reminder for upcoming match
 */
export function scheduleMatchReminder(matchDate, matchInfo) {
    const now = new Date();
    const reminderTime = new Date(matchDate.getTime() - 30 * 60 * 1000); // 30 min before
    
    if (reminderTime > now) {
        const delay = reminderTime.getTime() - now.getTime();
        
        setTimeout(() => {
            sendNotification(
                '⏰ Partido en 30 minutos',
                `Tu partido${matchInfo ? ` - ${matchInfo}` : ''} empieza pronto. ¡Prepárate!`
            );
        }, delay);
    }
}

/**
 * Notify ranking change
 */
export function notifyRankingChange(oldRank, newRank, pointsDiff) {
    if (newRank < oldRank) {
        sendNotification(
            '🎉 ¡Has subido en el ranking!',
            `Nueva posición: #${newRank} (+${pointsDiff} pts)`
        );
    } else if (newRank > oldRank) {
        sendNotification(
            '📉 Has bajado en el ranking',
            `Nueva posición: #${newRank} (${pointsDiff} pts)`
        );
    }
}

/**
 * Notify new user joined a match
 */
export function notifyMatchJoin(userName, matchDate) {
    sendNotification(
        '👋 Nuevo jugador',
        `${userName} se ha unido a tu partido del ${matchDate.toLocaleDateString('es-ES', {weekday:'short', day:'numeric'})}`
    );
}

/**
 * Daily reminder check
 */
export async function checkDailyReminders(userId, matches) {
    const today = new Date();
    
    // Check for matches today
    const todayMatches = matches.filter(m => {
        const mDate = m.fecha?.toDate();
        return mDate && mDate.toDateString() === today.toDateString();
    });
    
    if (todayMatches.length > 0) {
        sendNotification(
            '🏓 ¡Tienes partido hoy!',
            `${todayMatches.length} partido(s) programado(s) para hoy.`
        );
        
        // Schedule individual reminders
        todayMatches.forEach(m => {
            scheduleMatchReminder(m.fecha.toDate(), m.type);
        });
    }
}
