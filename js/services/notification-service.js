/* =====================================================
   PADELUMINATIS NOTIFICATION SERVICE V2.0 (Unified)
   Centralized notification handling, listeners, and automation.
   ===================================================== */

import { auth, db, subscribeCol, subscribeDoc } from "../firebase-service.js";
import {
  collection,
  addDoc,
  serverTimestamp,
  updateDoc,
  doc,
  getDocs,
  query,
  where,
  limit,
  orderBy,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";

// Store active listeners to clean up
const activeListeners = [];

async function safeOnSnapshot(q, onNext) {
  if (window.getDocsSafe) {
    const warm = await window.getDocsSafe(q, "auto-notifications");
    if (warm?._errorCode === "failed-precondition") return () => {};
  }
  return onSnapshot(q, onNext, () => {});
}

// ─── CORE NOTIFICATION FUNCTIONS ───

/**
 * Send a notification to one or multiple users
 */
export async function createNotification(
  targetUids,
  title,
  message,
  type = "info",
  link = null,
  extraData = null,
) {
  if (!targetUids) return;
  const targets = Array.isArray(targetUids) ? targetUids : [targetUids];

  try {
    const promises = targets.map(async (uid) => {
      if (!uid) return;

      // Robust Anti-duplicate check (Persistent registry)
      const dedupId =
        extraData?.dedupId ||
        `${uid}_${type}_${title}_${message}`.replace(/\s/g, "_");
      const registryKey = `sent_notif_${dedupId}`;
      if (localStorage.getItem(registryKey)) return;

      // Database check as secondary safety
      const q = query(
        collection(db, "notificaciones"),
        where("destinatario", "==", uid),
        where("titulo", "==", title),
        where("mensaje", "==", message),
        limit(1),
      );
      const existing = await window.getDocsSafe(q);
      if (!existing.empty) {
        localStorage.setItem(registryKey, "true");
        return;
      }

      const docRef = await addDoc(collection(db, "notificaciones"), {
        destinatario: uid,
        remitente: auth.currentUser?.uid || "system",
        tipo: type,
        titulo: title,
        mensaje: message,
        enlace: link || null,
        data: { ...extraData, dedupId },
        leido: false,
        seen: false, // New flag for visibility tracking
        timestamp: serverTimestamp(),
        // compatibility fields (legacy)
        uid: uid,
        title: title,
        message: message,
        read: false,
        createdAt: serverTimestamp(),
      });

      if (docRef.id) localStorage.setItem(registryKey, "true");
      return docRef;
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
      read: true, // compatibility
      seen: true, // Read implies seen
    });
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

/**
 * Mark notification as seen (viewed in Home)
 */
export async function markAsSeen(notifId) {
  try {
    const ref = doc(db, "notificaciones", notifId);
    await updateDoc(ref, { seen: true });
    return true;
  } catch (e) {
    console.error("Error marking as seen:", e);
    return false;
  }
}

/**
 * Global listener for notifications
 */
export function listenToNotifications(callback) {
  if (!auth.currentUser) return null;
  return subscribeCol("notificaciones", callback, [
    ["destinatario", "==", auth.currentUser.uid],
    ["seen", "==", false], // NEW: only return unseen
  ]);
}

// ─── AUTOMATION LOGIC ───

import { sendPushNotification } from "../modules/push-notifications.js";

/**
 * Initialize auto notifications for a user
 * @param {string} uid - User ID
 */
export async function initAutoNotifications(uid) {
  if (!uid) return;

  console.log("🚀 Padeluminatis Notifications Active for:", uid);

  // 1. Existing Watchers
  watchMatchesFilling(uid);
  scheduleMatchReminders(uid);
  watchNewChallenges(uid);

  // 3. Native Background Pulse
  // Listen for new unread notifications and trigger local push
  let initialLoad = true;
  listenToNotifications((list) => {
    if (initialLoad) {
      initialLoad = false;
      return;
    }

    // Find the latest unread AND unseen and notify
    const newest = list
      .filter((n) => !n.seen)
      .sort(
        (a, b) =>
          (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0),
      )[0];
    if (newest) {
      sendPushNotification(newest.titulo || "Padeluminatis", newest.mensaje);
      // Mark as seen immediately so it doesn't repeat
      markAsSeen(newest.id);
    }
  });

  // 4. Daily Morning Pulse (7:30 AM)
  checkMorningMatchSummary(uid);

  // 2. New Elite Watchers
  watchRankingChanges(uid);
  watchVacancies(uid);
  watchNewGlobalMatches(uid);
}

/**
 * Watch for ELO changes and notify immediately
 */
function watchRankingChanges(uid) {
  subscribeDoc("usuarios", uid, (data) => {
    // We only care about rank changes if we have previous data
    if (!window._lastElo) window._lastElo = {};
    const prevElo = window._lastElo[uid];

    if (data && prevElo !== undefined && data.puntosRanking !== prevElo) {
      const diff = data.puntosRanking - prevElo;
      const sign = diff > 0 ? "+" : "";
      const icon = diff > 0 ? "📈" : "📉";

      createNotification(
        uid,
        `${icon} Actualización ELO`,
        `Tu puntuación ha cambiado: ${sign}${Number(diff).toFixed(1)}. Nuevo total: ${Number(data.puntosRanking || 0).toFixed(1)}`,
        diff > 0 ? "success" : "warning",
      );
    }
    if (data) window._lastElo[uid] = data.puntosRanking;
  });
}

/**
 * Watch for matches where a slot becomes free
 */
async function watchVacancies(uid) {
  const collections = ["partidosReto", "partidosAmistosos"];
  collections.forEach((col) => {
    const q = query(collection(db, col), where("estado", "==", "abierto"));
    safeOnSnapshot(q, (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type === "modified") {
          const m = change.doc.data();
          const realCount = (m.jugadores || []).filter((id) => id).length;
          if (realCount < 4) {
            // Vacancy detected — logic can be refined
          }
        }
      });
    });
  });
}

/**
 * Watch for new public matches
 */
async function watchNewGlobalMatches(uid) {
  const q = query(
    collection(db, "partidosAmistosos"),
    where("estado", "==", "abierto"),
    limit(5),
  );
  safeOnSnapshot(q, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added") {
        const m = change.doc.data();
        if (m.creador !== uid) {
          createNotification(
            uid,
            "🎾 ¡Nueva Partida!",
            `Un jugador ha abierto una partida. ¡Únete!`,
            "info",
          );
        }
      }
    });
  });
}

/**
 * Watch for matches that fill up
 */
async function watchMatchesFilling(uid) {
  const collections = ["partidosReto", "partidosAmistosos"];

  collections.forEach((colName) => {
    const q = query(
      collection(db, colName),
      where("jugadores", "array-contains", uid),
      where("estado", "==", "abierto"),
    );

    safeOnSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === "modified") {
          const match = change.doc.data();
          const matchId = change.doc.id;
          const realCount = (match.jugadores || []).filter((id) => id).length;

          if (realCount === 4) {
            const fecha = match.fecha?.toDate?.() || new Date(match.fecha);
            const fechaStr = fecha.toLocaleDateString("es-ES", {
              weekday: "short",
              day: "numeric",
              month: "short",
            });
            const horaStr = fecha.toLocaleTimeString("es-ES", {
              hour: "2-digit",
              minute: "2-digit",
            });

            await createNotification(
              uid,
              "🏆 ¡Partido Completo!",
              `El partido del ${fechaStr} a las ${horaStr} ya tiene 4 jugadores. ¡Prepárate!`,
              "success",
              null,
              { matchId, type: "match_full" },
            );
          }
        }
      });
    });
  });
}

/**
 * Schedule reminders for upcoming matches (1 hour before)
 */
async function scheduleMatchReminders(uid) {
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const collections = ["partidosReto", "partidosAmistosos"];

  for (const colName of collections) {
    try {
      const q = query(
        collection(db, colName),
        where("jugadores", "array-contains", uid),
        where("estado", "==", "abierto"),
      );

      const snapshot = await window.getDocsSafe(q);

      snapshot.forEach((d) => {
        const match = d.data();
        const matchId = d.id;

        let matchDate;
        if (match.fecha?.toDate) {
          matchDate = match.fecha.toDate();
        } else if (match.fecha) {
          matchDate = new Date(match.fecha);
        }

        if (!matchDate) return;

        // hora is already embedded in fecha (Timestamp includes time)
        // No separate 'hora' field exists — fecha already has the correct time

        if (matchDate >= inOneHour && matchDate <= inTwoHours) {
          const timeUntil = Math.round((matchDate - now) / (60 * 1000));

          createNotification(
            uid,
            "⏰ Partido en 1 hora",
            `Tu partido empieza en ${timeUntil} minutos. ¡Calienta esos músculos!`,
            "warning",
            null,
            { matchId, type: "match_reminder" },
          );
        }
      });
    } catch (e) {
      console.error(`Error scheduling reminders for ${colName}:`, e);
    }
  }
}

/**
 * Watch for new challenges directed at user
 */
function watchNewChallenges(uid) {
  // Simplified query: uses real fields (jugadores, estado, timestamp)
  // instead of non-existent 'retado' and 'creadoEn'
  const q = query(
    collection(db, "partidosReto"),
    where("estado", "==", "abierto"),
  );

  safeOnSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      if (change.type === "added") {
        const reto = change.doc.data();
        const retoId = change.doc.id;

        // Only notify if user is in the match but NOT the creator
        const isInMatch = (reto.jugadores || []).includes(uid);
        const isCreator = reto.creador === uid;
        if (!isInMatch || isCreator) return;

        const createdAt = reto.timestamp?.toDate?.() || new Date();
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

        if (createdAt >= fiveMinAgo) {
          await createNotification(
            uid,
            "⚔️ ¡Nuevo Reto!",
            `Te han incluido en un reto oficial. ¿Aceptas el desafío?`,
            "challenge",
            null,
            { matchId: retoId, type: "new_challenge" },
          );
        }
      }
    });
  });
}

/**
 * Check and send daily match summary (Today you play!)
 */
async function checkMorningMatchSummary(uid) {
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();

  // Condition: After 7:30 AM
  const isAfter730 = hour > 7 || (hour === 7 && min >= 30);
  if (!isAfter730) return;

  const todayStr = now.toISOString().split("T")[0];
  const lastKey = `morning_match_notif_${uid}_${todayStr}`;
  if (localStorage.getItem(lastKey)) return;

  try {
    const collections = ["partidosReto", "partidosAmistosos"];
    let matchesToday = 0;

    for (const col of collections) {
      const q = query(
        collection(db, col),
        where("jugadores", "array-contains", uid),
        where("estado", "==", "abierto"),
      );
      const snap = await window.getDocsSafe(q);
      snap.forEach((d) => {
        const m = d.data();
        const mDate = m.fecha?.toDate?.() || new Date(m.fecha);
        if (mDate.toDateString() === now.toDateString()) {
          matchesToday++;
        }
      });
    }

    if (matchesToday > 0) {
      const { getDocument } = await import("../firebase-service.js");
      const user = await getDocument("usuarios", uid);
      const name = user?.nombreUsuario?.split(" ")[0] || "Campeón";

      await createNotification(
        uid,
        `☀️ ¡Hoy juegas, ${name}!`,
        `Tienes ${matchesToday} partido(s) programado(s) para hoy en la Matrix. ¡A por todas!`,
        "info",
        null,
        { type: "morning_matches" },
      );
      localStorage.setItem(lastKey, "true");
    }
  } catch (e) {
    console.error("Error checkMorningMatchSummary:", e);
  }
}

/**
 * Check and send daily summary
 */
async function checkDailySummary(uid) {
  const today = new Date().toISOString().split("T")[0];
  const lastSummaryKey = `lastDailySummary_${uid}`;
  const lastSummary = localStorage.getItem(lastSummaryKey);

  if (lastSummary === today) return;

  try {
    const { getDocument } = await import("../firebase-service.js");
    const userData = await getDocument("usuarios", uid);

    if (!userData) return;

    const stats = {
      points: userData.puntosRanking || 1000,
      wins: userData.victorias || 0,
      streak: userData.rachaActual || 0,
    };

    let message = `📊 Resumen: ${stats.points} ELO | ${stats.wins} victorias`;
    if (stats.streak >= 3) message += ` | 🔥 Racha de ${stats.streak}!`;

    await createNotification(
      uid,
      `☀️ Buenos días, ${userData.nombreUsuario?.split(" ")[0] || "Campeón"}`,
      message,
      "info",
      null,
      { type: "daily_summary" },
    );

    localStorage.setItem(lastSummaryKey, today);
  } catch (e) {
    console.error("Error generating daily summary:", e);
  }
}

/**
 * Cleanup all listeners
 */
export function cleanupAutoNotifications() {
  activeListeners.forEach((unsub) => {
    if (typeof unsub === "function") {
      unsub();
    }
  });
  activeListeners.length = 0;
  console.log("🛑 Auto-notifications cleaned up");
}

/**
 * Calculate points preview before a match
 */
export async function calculatePointsPreview(matchId, colName, uid) {
  try {
    const { getDocument } = await import("../firebase-service.js");
    const { predictEloImpact } = await import("../ranking-service.js");

    const match = await getDocument(colName, matchId);
    const user = await getDocument("usuarios", uid);

    if (
      !match ||
      !user ||
      !match.jugadores ||
      match.jugadores.filter((id) => id).length < 4
    ) {
      return { win: 15, loss: -10 };
    }

    const players = await Promise.all(
      match.jugadores.map((pid) => getDocument("usuarios", pid)),
    );

    const myIndex = match.jugadores.indexOf(uid);
    const partnerIndex =
      myIndex < 2 ? (myIndex === 0 ? 1 : 0) : myIndex === 2 ? 3 : 2;
    const rival1Index = myIndex < 2 ? 2 : 0;
    const rival2Index = myIndex < 2 ? 3 : 1;

    const prediction = predictEloImpact({
      myLevel: user.nivel || 2.5,
      myPoints: user.puntosRanking || 1000,
      partnerLevel: players[partnerIndex]?.nivel || 2.5,
      rival1Level: players[rival1Index]?.nivel || 2.5,
      rival2Level: players[rival2Index]?.nivel || 2.5,
      streak: user.rachaActual || 0,
      matchesPlayed: user.partidosJugados || 0,
    });

    return {
      win: prediction.win,
      loss: prediction.loss,
      winrate: prediction.expectedWinrate,
      streakBonus: prediction.streakBonus,
    };
  } catch (e) {
    console.error("Error calculating points preview:", e);
    return { win: 15, loss: -10 };
  }
}

/**
 * Auto-suggest diary entry after match result
 */
export async function suggestDiaryEntry(uid, matchId, won) {
  const message = won
    ? "🎾 ¡Gran victoria! ¿Quieres registrar los detalles en tu diario táctico?"
    : "🎾 Buen partido. ¿Registramos qué funcionó y qué mejorar?";

  await createNotification(
    uid,
    "📝 Registrar en Diario",
    message,
    "info",
    null,
    { matchId, type: "diary_suggestion", action: "open_diary" },
  );
}

export default {
  initAutoNotifications,
  createNotification,
  markAsRead,
  listenToNotifications,
  calculatePointsPreview,
  suggestDiaryEntry,
  cleanupAutoNotifications,
};
