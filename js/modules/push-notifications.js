/* js/modules/notifications.js - Push Notification System */
import { showToast } from "../ui-core.js";

let notifPermission = Notification.permission;

/**
 * Requests notification permission
 */
export async function requestNotificationPermission() {
  if (!("Notification" in window)) {
    console.log("Notifications not supported");
    return false;
  }

  if (notifPermission === "granted") return true;

  try {
    const result = await Notification.requestPermission();
    notifPermission = result;

    if (result === "granted") {
      showToast(
        "Notificaciones activadas",
        "Recibirás avisos de partidos y ranking.",
        "success",
      );
      return true;
    }
  } catch (e) {
    console.error("Notification permission error:", e);
  }

  return false;
}

/**
 * Sends a local push notification using Service Worker if available
 */
export async function sendPushNotification(
  title,
  body,
  icon = "./imagenes/Logojafs.png",
  meta = {},
) {
  if (notifPermission !== "granted") return;
  const targetUrl = meta?.url || "./home.html";
  const targetTag =
    meta?.tag ||
    `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const options = {
    body,
    icon,
    badge: icon,
    vibrate: [200, 100, 200],
    tag: targetTag,
    renotify: true,
    data: { url: targetUrl },
  };

  // Try via Service Worker (Better for background/mobile)
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await registration.showNotification(title, options);
        return;
      }
    } catch (swErr) {
      console.warn("SW notification fallback to window:", swErr);
    }
  }

  // Fallback to Window Notification API
  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch (e) {
    console.error("Notification error:", e);
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
      sendPushNotification(
        "Partido en 30 minutos",
        `Tu partido${matchInfo ? ` - ${matchInfo}` : ""} empieza pronto. Prepárate.`,
      );
    }, delay);
  }
}

/**
 * Notify ranking change
 */
export function notifyRankingChange(oldRank, newRank, pointsDiff) {
  if (newRank < oldRank) {
    sendPushNotification(
      "Has subido en el ranking",
      `Nueva posición: #${newRank} (+${pointsDiff} pts)`,
    );
  } else if (newRank > oldRank) {
    sendPushNotification(
      "Has bajado en el ranking",
      `Nueva posición: #${newRank} (${pointsDiff} pts)`,
    );
  }
}

/**
 * Notify new user joined a match
 */
export function notifyMatchJoin(userName, matchDate) {
  sendPushNotification(
    "Nuevo jugador",
    `${userName} se ha unido a tu partido del ${matchDate.toLocaleDateString("es-ES", { weekday: "short", day: "numeric" })}`,
  );
}

/**
 * Daily reminder check
 */
export async function checkDailyReminders(userId, matches) {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const morningCheckKey = `morning_notif_${userId}_${todayStr}`;

  // Check for matches today
  const todayMatches = matches.filter((m) => {
    const mDate = m.fecha?.toDate
      ? m.fecha.toDate()
      : m.fecha instanceof Date
        ? m.fecha
        : new Date(m.fecha);
    return mDate && mDate.toDateString() === now.toDateString();
  });

  // Morning Notification (from 7:30 AM)
  const isAfterMorningTime =
    now.getHours() > 7 || (now.getHours() === 7 && now.getMinutes() >= 30);
  const alreadySentToday = localStorage.getItem(morningCheckKey) === "true";

  if (todayMatches.length > 0 && isAfterMorningTime && !alreadySentToday) {
    sendPushNotification(
      "¡Hoy juegas!",
      `Tienes ${todayMatches.length} partido(s) programado(s) para hoy. ¡A por todas!`,
    );
    localStorage.setItem(morningCheckKey, "true");
  }

  if (todayMatches.length > 0) {
    // Schedule individual reminders (30 min before)
    todayMatches.forEach((m) => {
      const mDate = m.fecha?.toDate
        ? m.fecha.toDate()
        : m.fecha instanceof Date
          ? m.fecha
          : new Date(m.fecha);
      if (mDate) scheduleMatchReminder(mDate, m.type);
    });
  }
}
