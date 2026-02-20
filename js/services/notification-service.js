/* =====================================================
   PADELUMINATIS NOTIFICATION SERVICE V2.0 (Unified)
   Centralized notification handling, listeners, and automation.
   ===================================================== */

import { auth, db, subscribeDoc, getDocument } from "../firebase-service.js";
import {
  collection,
  addDoc,
  serverTimestamp,
  updateDoc,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.7.3/firebase-firestore.js";
import {
  isFinishedMatch,
  isCancelledMatch,
  getResultSetsString,
} from "../utils/match-utils.js";

// Store active listeners to clean up
const activeListeners = [];
const NOTIF_DEDUP_TTL_MS = 1000 * 60 * 60 * 6; // Session-based filtering
export const SESSION_START_TIME = Date.now();
const notifiedDuringSession = new Set();
const LISTENER_POLL_INTERVAL_MS = 25000;
const NOTIF_TYPES = Object.freeze({
  INFO: "info",
  WARNING: "warning",
  MATCH_OPENED: "match_opened",
  PRIVATE_INVITE: "private_invite",
  MATCH_FULL: "match_full",
  MATCH_REMINDER: "match_reminder",
  RESULT_PENDING: "result_pending",
  MATCH_JOIN: "match_join",
  MATCH_LEAVE: "match_leave",
  MATCH_CLOSED: "match_closed",
  RESULT_UPLOADED: "result_uploaded",
  MATCH_CANCELLED: "match_cancelled",
  RANKING_UP: "ranking_up",
  RANKING_DOWN: "ranking_down",
  LEVEL_UP: "level_up",
  LEVEL_DOWN: "level_down",
  NEW_RIVAL: "new_rival",
  CHAT_MENTION: "chat_mention",
  NEW_CHALLENGE: "new_challenge",
});

function normalizeType(type) {
  const raw = String(type || "").trim().toLowerCase();
  if (!raw) return NOTIF_TYPES.INFO;
  return raw.replace(/\s+/g, "_");
}

function readDedupStamp(key) {
  try {
    if (!key) return 0;
    const raw = localStorage.getItem(key);
    const val = Number(raw);
    return Number.isFinite(val) ? val : 0;
  } catch {
    return 0;
  }
}

function writeDedupStamp(key) {
  try {
    if (!key) return;
    localStorage.setItem(key, String(Date.now()));
  } catch {
    // Ignore storage restrictions (private mode / quota).
  }
}

function isUnseenNotif(n) {
  return n?.seen !== true;
}

function normalizeNotifList(list = [], onlyUnseen = true) {
  const sorted = [...list].sort(
    (a, b) => (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0),
  );
  const filtered = onlyUnseen ? sorted.filter(isUnseenNotif) : sorted;
  return filtered.slice(0, 80);
}

function listSignature(list = []) {
  return list
    .map(
      (n) =>
        `${n.id || "x"}:${n.seen === true ? 1 : 0}:${n.leido === true ? 1 : 0}:${n.read === true ? 1 : 0}:${n.timestamp?.toMillis?.() || 0}`,
    )
    .join("|");
}

function safeOnSnapshot(q, onNext) {
  let unsub = () => {};

  const attach = () => {
    unsub = onSnapshot(q, onNext, () => {});
    if (typeof unsub === "function") activeListeners.push(unsub);
  };

  if (window.getDocsSafe) {
    window
      .getDocsSafe(q, "auto-notifications")
      .then((warm) => {
        if (warm?._errorCode !== "failed-precondition") attach();
      })
      .catch(() => attach());
  } else {
    attach();
  }

  return () => {
    if (typeof unsub === "function") unsub();
  };
}

// â”€â”€â”€ CORE NOTIFICATION FUNCTIONS â”€â”€â”€

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
  if (!auth.currentUser?.uid) {
    console.warn("createNotification skipped: no authenticated sender");
    return false;
  }
  const targets = Array.isArray(targetUids) ? targetUids : [targetUids];
  const notifType = normalizeType(type);
  const safeTitle = String(title || "Padeluminatis").trim().slice(0, 120);
  const safeMessage = String(message || "").trim().slice(0, 600);

  try {
    const promises = targets.map(async (uid) => {
      if (!uid) return;

      // Anti-duplicate with TTL (prevents permanent blocking of future alerts)
      const dedupIdRaw =
        extraData?.dedupId ||
        `${uid}_${notifType}_${safeTitle}_${safeMessage}_${extraData?.matchId || ""}`;
      const dedupId = dedupIdRaw
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9:_-]/g, "")
        .slice(0, 180);

      const registryKey = `sent_notif_${dedupId}`;
      const lastSentTs = readDedupStamp(registryKey);
      if (Date.now() - lastSentTs < NOTIF_DEDUP_TTL_MS) return;

      // Database check as secondary safety
      const q = query(
        collection(db, "notificaciones"),
        where("dedupKey", "==", dedupId),
        limit(1),
      );
      const existing = window.getDocsSafe
        ? await window.getDocsSafe(q)
        : await getDocs(q);
      if (!existing.empty) {
        const hasRecentTwin = existing.docs?.some((d) => {
          const data = typeof d.data === "function" ? d.data() : d;
          const ts =
            data?.timestamp?.toMillis?.() ||
            data?.createdAt?.toMillis?.() ||
            0;
          return ts > 0 && Date.now() - ts < NOTIF_DEDUP_TTL_MS;
        });
        if (hasRecentTwin) {
          writeDedupStamp(registryKey);
          return;
        }
      }

      const docRef = await addDoc(collection(db, "notificaciones"), {
        destinatario: uid,
        receptorId: uid,
        remitente: auth.currentUser.uid,
        tipo: notifType,
        type: notifType,
        titulo: safeTitle,
        mensaje: safeMessage,
        enlace: link || null,
        data: { ...extraData, dedupId, type: notifType },
        leido: false,
        seen: false,
        timestamp: serverTimestamp(),
        dedupKey: dedupId,
        dedupTTLms: NOTIF_DEDUP_TTL_MS,
        // compatibility fields (legacy)
        uid: uid,
        title: safeTitle,
        message: safeMessage,
        read: false,
        createdAt: serverTimestamp(),
      });

      if (docRef.id) writeDedupStamp(registryKey);
      return docRef;
    });
    await Promise.all(promises);

    // TRIGGER EXTERNAL BACKGROUND PUSH (REACHES CLOSED BROWSERS/PWA)
    sendExternalPush({
      title: safeTitle,
      message: safeMessage,
      uids: targets,
      url: link || "home.html",
      data: { ...extraData, type: notifType }
    }).catch(e => console.warn("Background push skip:", e));

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
export function listenToNotifications(callback, options = {}) {
  if (!auth.currentUser || typeof callback !== "function") return null;

  const uid = auth.currentUser.uid;
  const onlyUnseen = options.onlyUnseen !== false;
  const pollIntervalMs = options.pollIntervalMs || LISTENER_POLL_INTERVAL_MS;
  const q = query(collection(db, "notificaciones"), where("destinatario", "==", uid));

  let stopped = false;
  let lastSig = "__INIT__";
  let pollTimer = null;
  let hasRealtimeSignal = false;

  const emit = (rawList) => {
    if (stopped) return;
    const list = normalizeNotifList(rawList, onlyUnseen);
    const sig = listSignature(list);
    if (sig === lastSig) return;
    lastSig = sig;
    callback(list);
  };

  const fetchAndEmit = async () => {
    try {
      const snap = window.getDocsSafe ? await window.getDocsSafe(q, "notif-poll") : await getDocs(q);
      const docs = snap.docs?.map((d) => ({ id: d.id, ...d.data() })) || [];
      emit(docs);
    } catch (e) {
      console.warn("Notification polling fallback failed:", e?.code || e?.message || e);
    }
  };

  const startPolling = () => {
    if (pollTimer || stopped) return;
    pollTimer = setInterval(fetchAndEmit, pollIntervalMs);
    fetchAndEmit();
  };

  const stopPolling = () => {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  };

  const unsubSnapshot = onSnapshot(
    q,
    (snap) => {
      hasRealtimeSignal = true;
      stopPolling();
      emit(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (err) => {
      console.warn("Notification realtime listener degraded. Switching to polling.", err?.code || err?.message || err);
      startPolling();
    },
  );

  // Warm load + guaranteed fallback for flaky mobile listeners.
  fetchAndEmit();
  setTimeout(() => {
    if (!hasRealtimeSignal) startPolling();
  }, 5000);

  return () => {
    stopped = true;
    stopPolling();
    if (typeof unsubSnapshot === "function") unsubSnapshot();
  };
}

// â”€â”€â”€ AUTOMATION LOGIC â”€â”€â”€

import { sendPushNotification, sendExternalPush } from "../modules/push-notifications.js";

/**
 * Initialize auto notifications for a user
 * @param {string} uid - User ID
 */
export async function initAutoNotifications(uid) {
  if (!uid) return;
  if (window.__autoNotifUid === uid && activeListeners.length > 0) return;
  cleanupAutoNotifications();
  window.__autoNotifUid = uid;

  console.log("ðŸš€ Padeluminatis Notifications Active for:", uid);

  // 1. Existing Watchers
  watchMatchesFilling(uid);
  scheduleMatchReminders(uid);
  const remindersInterval = setInterval(() => scheduleMatchReminders(uid), 10 * 60 * 1000);
  activeListeners.push(() => clearInterval(remindersInterval));
  schedulePendingResultAlerts(uid);
  const resultAlertInterval = setInterval(() => schedulePendingResultAlerts(uid), 15 * 60 * 1000);
  activeListeners.push(() => clearInterval(resultAlertInterval));
  watchNewChallenges(uid);

  // 3. Native Background Pulse
  // Listen for new unread notifications and trigger local push
  let initialLoad = true;
  if (!window.__notifPushSentIds) window.__notifPushSentIds = new Set();
  const stopPushBridge = listenToNotifications((list) => {
    if (initialLoad) {
      initialLoad = false;
      return;
    }

    // Find the latest unread AND unseen and notify
    const newest = list
      .filter((n) => {
        const ts = n.timestamp?.toMillis?.() || n.createdAt?.toMillis?.() || 0;
        return !n.seen && ts > SESSION_START_TIME - 30000; // Only recent ones
      })
      .sort(
        (a, b) =>
          (b.timestamp?.toMillis?.() || 0) - (a.timestamp?.toMillis?.() || 0),
      )[0];
    if (newest && !notifiedDuringSession.has(newest.id)) {
      sendPushNotification(
        newest.titulo || "Padeluminatis",
        newest.mensaje,
        "./imagenes/Logojafs.png",
        { tag: `notif_${newest.id}`, url: newest.enlace || "./home.html" },
      );
      notifiedDuringSession.add(newest.id);
    }
  });
  if (typeof stopPushBridge === "function") activeListeners.push(stopPushBridge);

  // 4. Daily Morning Pulse (7:30 AM)
  checkMorningMatchSummary(uid);

  // 2. New Elite Watchers
  watchRankingChanges(uid);
  watchVacancies(uid);
  watchNewGlobalMatches(uid);
  watchMatchParticipationEvents(uid);
}

/**
 * Watch for ELO changes and notify immediately
 */
function watchRankingChanges(uid) {
  const state = { last: null, busy: false, queuedData: null };

  const handle = async (data) => {
    if (!data) return;
    if (state.busy) {
      state.queuedData = data;
      return;
    }

    state.busy = true;
    try {
      const prev = state.last;
      const pointsNow = Number(data.puntosRanking || 0);
      const levelNow = Number(data.nivel || 2.5);

      if (prev) {
        const pointsPrev = Number(prev.puntosRanking || 0);
        const levelPrev = Number(prev.nivel || 2.5);
        const diff = pointsNow - pointsPrev;

        if (diff !== 0) {
          const posNow = await resolveRankPosition(uid);
          const posPrev = prev.rankPos || posNow;

          if (posNow && posPrev && posNow < posPrev) {
            const gain = posPrev - posNow;
            await createNotification(
              uid,
              "Ranking actualizado",
              `Has subido ${gain} ${gain === 1 ? "posición" : "posiciones"} en el ranking.`,
              NOTIF_TYPES.RANKING_UP,
              "puntosRanking.html",
              { type: NOTIF_TYPES.RANKING_UP, rankDelta: gain, rank: posNow },
            );
          } else if (posNow && posPrev && posNow > posPrev) {
            const loss = posNow - posPrev;
            await createNotification(
              uid,
              "Ranking actualizado",
              `Has bajado ${loss} ${loss === 1 ? "puesto" : "puestos"} en el ranking.`,
              NOTIF_TYPES.RANKING_DOWN,
              "puntosRanking.html",
              { type: NOTIF_TYPES.RANKING_DOWN, rankDelta: -loss, rank: posNow },
            );
          }

          if (levelNow > levelPrev + 0.001) {
            await createNotification(
              uid,
              "Evolución desbloqueada",
              `Has subido de nivel: ${levelPrev.toFixed(2)} -> ${levelNow.toFixed(2)}.`,
              NOTIF_TYPES.LEVEL_UP,
              "perfil.html",
              { type: NOTIF_TYPES.LEVEL_UP, from: levelPrev, to: levelNow },
            );
          } else if (levelNow < levelPrev - 0.001) {
            await createNotification(
              uid,
              "Ajuste de nivel",
              `Tu nivel bajó: ${levelPrev.toFixed(2)} -> ${levelNow.toFixed(2)}. Revisa tu diario para recuperar ritmo.`,
              NOTIF_TYPES.LEVEL_DOWN,
              "perfil.html",
              { type: NOTIF_TYPES.LEVEL_DOWN, from: levelPrev, to: levelNow },
            );
          }

          state.last = { ...data, rankPos: posNow || prev.rankPos || null };
          return;
        }
      }

      const rankPos = await resolveRankPosition(uid);
      state.last = { ...data, rankPos: rankPos || null };
    } finally {
      state.busy = false;
      if (state.queuedData) {
        const next = state.queuedData;
        state.queuedData = null;
        queueMicrotask(() => handle(next));
      }
    }
  };

  const unsub = subscribeDoc("usuarios", uid, (data) => {
    handle(data).catch((e) => console.warn("watchRankingChanges error:", e));
  });

  if (typeof unsub === "function") activeListeners.push(unsub);
}

async function resolveRankPosition(uid) {
  try {
    const q = query(collection(db, "usuarios"), orderBy("puntosRanking", "desc"), limit(500));
    const snap = window.getDocsSafe
      ? await window.getDocsSafe(q, "rank-position")
      : await getDocs(q);
    const docs = snap.docs || [];
    const idx = docs.findIndex((d) => d.id === uid);
    return idx >= 0 ? idx + 1 : null;
  } catch {
    return null;
  }
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
          const matchId = change.doc.id;
          const realCount = (m.jugadores || []).filter((id) => id).length;
          const isMine = (m.jugadores || []).includes(uid) || m.creador === uid;
          const isPublic = !m.visibility || m.visibility === "public";

          if (!isMine && isPublic && realCount > 0 && realCount < 4) {
            // Check if match was recently updated or created
            const updateTs = m.timestamp?.toMillis?.() || m.fecha?.toMillis?.() || 0;
            if (updateTs < SESSION_START_TIME - 120000) return; // Ignore old match vacancies on boot

            createNotification(
              uid,
              "Nuevo rival disponible",
              `Se ha liberado plaza en una partida ${col === "partidosReto" ? "de reto" : "amistosa"} (${realCount}/4).`,
              NOTIF_TYPES.NEW_RIVAL,
              "calendario.html",
              { type: NOTIF_TYPES.NEW_RIVAL, matchId, dedupId: `vacancy_${matchId}_${realCount}` },
            );
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
    where("visibility", "==", "public"),
    limit(5),
  );
  safeOnSnapshot(q, (snap) => {
    snap.docChanges().forEach(async (change) => {
      if (change.type === "added") {
        const m = change.doc.data();
        if (m.creador !== uid) {
          const matchId = change.doc.id;
          const fecha = m.fecha?.toDate?.() || (m.fecha ? new Date(m.fecha) : null);
          const hora = fecha
            ? fecha.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
            : "--:--";
          let creatorName = "Un jugador";
          try {
            const createTs = m.timestamp?.toMillis?.() || m.fecha?.toMillis?.() || 0;
            if (createTs < SESSION_START_TIME - 30000) return; // Skip initial fire

            const creator = await getDocument("usuarios", m.creador);
            creatorName = creator?.nombreUsuario || creator?.nombre || creatorName;
          } catch (_) {}

          createNotification(
            uid,
            "Nueva partida disponible",
            `${creatorName} ha abierto una partida a las ${hora}.`,
            NOTIF_TYPES.MATCH_OPENED,
            "calendario.html",
            { type: NOTIF_TYPES.MATCH_OPENED, matchId, dedupId: `match_opened_${matchId}` },
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

            const matchTs = match.timestamp?.toMillis?.() || match.fecha?.toMillis?.() || 0;
            if (matchTs < SESSION_START_TIME - 60000) return; // Only notify if it filled AFTER login or very recently

            await createNotification(
              uid,
              "Partido completo",
              `La partida del ${fechaStr} a las ${horaStr} ya está completa (4/4).`,
              NOTIF_TYPES.MATCH_FULL,
              "calendario.html",
              { matchId, type: NOTIF_TYPES.MATCH_FULL, dedupId: `match_full_${matchId}` },
            );
          }
        }
      });
    });
  });
}

function watchMatchParticipationEvents(uid) {
  const collections = ["partidosReto", "partidosAmistosos"];

  collections.forEach((colName) => {
    const q = query(collection(db, colName), where("jugadores", "array-contains", uid));
    const stateById = new Map();

    safeOnSnapshot(q, async (snapshot) => {
      const currentIds = new Set();

      for (const d of snapshot.docs) {
        const matchId = d.id;
        const curr = d.data() || {};
        currentIds.add(matchId);

        const prev = stateById.get(matchId);
        stateById.set(matchId, curr);
        if (!prev) continue;

        const prevPlayers = (prev.jugadores || []).filter((p) => p && !String(p).startsWith("GUEST_"));
        const currPlayers = (curr.jugadores || []).filter((p) => p && !String(p).startsWith("GUEST_"));
        const joined = currPlayers.find((p) => !prevPlayers.includes(p));
        const left = prevPlayers.find((p) => !currPlayers.includes(p));

        if (joined && joined !== uid) {
          const actor = await getDocument("usuarios", joined);
          const actorName = actor?.nombreUsuario || actor?.nombre || "Un jugador";
          await createNotification(
            uid,
            "Nuevo jugador en tu partido",
            `${actorName} se ha unido a tu partido.`,
            NOTIF_TYPES.MATCH_JOIN,
            "calendario.html",
            { type: NOTIF_TYPES.MATCH_JOIN, matchId, dedupId: `join_evt_${matchId}_${joined}` },
          );
        }

        if (left && left !== uid) {
          const actor = await getDocument("usuarios", left);
          const actorName = actor?.nombreUsuario || actor?.nombre || "Un jugador";
          await createNotification(
            uid,
            "Cambio en el partido",
            `${actorName} se ha salido de tu partido.`,
            NOTIF_TYPES.MATCH_LEAVE,
            "calendario.html",
            { type: NOTIF_TYPES.MATCH_LEAVE, matchId, dedupId: `leave_evt_${matchId}_${left}` },
          );
        }

        if (!isFinishedMatch(prev) && isFinishedMatch(curr)) {
          const sets = getResultSetsString(curr) || "resultado actualizado";
          await createNotification(
            uid,
            "Resultado registrado",
            `Se ha subido resultado en tu partido: ${sets}.`,
            NOTIF_TYPES.RESULT_UPLOADED,
            "puntosRanking.html",
            { type: NOTIF_TYPES.RESULT_UPLOADED, matchId, dedupId: `result_evt_${matchId}` },
          );
        }

        if (!isCancelledMatch(prev) && isCancelledMatch(curr)) {
          await createNotification(
            uid,
            "Partido cerrado",
            "Este partido ha sido cerrado/anulado.",
            NOTIF_TYPES.MATCH_CLOSED,
            "calendario.html",
            { type: NOTIF_TYPES.MATCH_CLOSED, matchId, dedupId: `closed_evt_${matchId}` },
          );
        }
      }

      for (const oldId of [...stateById.keys()]) {
        if (!currentIds.has(oldId)) stateById.delete(oldId);
      }
    });
  });
}

/**
 * Schedule reminders for upcoming matches (1 hour before)
 */
async function scheduleMatchReminders(uid) {
  const now = new Date();
  const minReminderMs = 55 * 60 * 1000;
  const maxReminderMs = 65 * 60 * 1000;

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
        // No separate 'hora' field exists â€” fecha already has the correct time

        const msUntil = matchDate.getTime() - now.getTime();
        if (msUntil >= minReminderMs && msUntil <= maxReminderMs) {
          const timeUntil = Math.max(1, Math.round(msUntil / (60 * 1000)));
          const dayStr = matchDate.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
          const hourStr = matchDate.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

          createNotification(
            uid,
            "Partido en 1 hora",
            `Tu partido de ${dayStr} a las ${hourStr} empieza en ${timeUntil} minutos.`,
            NOTIF_TYPES.MATCH_REMINDER,
            "calendario.html",
            { matchId, type: NOTIF_TYPES.MATCH_REMINDER, dedupId: `match_reminder_${matchId}_${matchDate.toISOString().slice(0,13)}` },
          );
        }
      });
    } catch (e) {
      console.error(`Error scheduling reminders for ${colName}:`, e);
    }
  }
}

/**
 * Notify when match should be finished but result is still missing (90 min after start).
 */
async function schedulePendingResultAlerts(uid) {
  const now = Date.now();
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
        const m = d.data();
        const matchId = d.id;
        const date = m.fecha?.toDate?.() || new Date(m.fecha);
        if (!date || Number.isNaN(date.getTime())) return;

        const filled = (m.jugadores || []).filter(Boolean).length;
        if (filled < 4) return;

        const elapsedMs = now - date.getTime();
        if (elapsedMs < 90 * 60 * 1000) return;

        const isOwner = m.creador === uid || m.organizerId === uid;
        const bucket = Math.floor(now / (30 * 60 * 1000));
        const title = isOwner ? "Resultado pendiente" : "Partido sin cerrar";
        const body = isOwner
          ? "Tu partido ya debería haber terminado. Añade el resultado para actualizar ranking."
          : "Tu partido terminó y aún no tiene resultado. Recuerda al organizador que lo registre.";

        createNotification(
          uid,
          title,
          body,
          NOTIF_TYPES.RESULT_PENDING,
          "home.html",
          { type: NOTIF_TYPES.RESULT_PENDING, matchId, dedupId: `result_pending_${matchId}_${uid}_${bucket}` },
        );
      });
    } catch (e) {
      console.warn(`Result pending alerts failed for ${colName}:`, e);
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
            "Nuevo reto",
            "Te han incluido en un reto oficial. ¿Aceptas el desafío?",
            NOTIF_TYPES.NEW_CHALLENGE,
            "calendario.html",
            { matchId: retoId, type: NOTIF_TYPES.NEW_CHALLENGE, dedupId: `new_challenge_${retoId}` },
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
      const name = user?.nombreUsuario?.split(" ")[0] || "CampeÃ³n";

      await createNotification(
        uid,
        `â˜€ï¸ Â¡Hoy juegas, ${name}!`,
        `Tienes ${matchesToday} partido(s) programado(s) para hoy en la Matrix. Â¡A por todas!`,
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

    let message = `ðŸ“Š Resumen: ${stats.points} ELO | ${stats.wins} victorias`;
    if (stats.streak >= 3) message += ` | ðŸ”¥ Racha de ${stats.streak}!`;

    await createNotification(
      uid,
      `â˜€ï¸ Buenos dÃ­as, ${userData.nombreUsuario?.split(" ")[0] || "CampeÃ³n"}`,
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
  window.__autoNotifUid = null;
  console.log("ðŸ›‘ Auto-notifications cleaned up");
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
    ? "ðŸŽ¾ Â¡Gran victoria! Â¿Quieres registrar los detalles en tu diario tÃ¡ctico?"
    : "ðŸŽ¾ Buen partido. Â¿Registramos quÃ© funcionÃ³ y quÃ© mejorar?";

  await createNotification(
    uid,
    "ðŸ“ Registrar en Diario",
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





