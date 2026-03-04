const admin = require("firebase-admin");
const { logger } = require("firebase-functions");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");

admin.initializeApp();

const MAX_PLAYERS = 4;
const RESULT_LOCK_MINUTES = 90;
const SCAN_PAGE_SIZE = 300;

function toStringMap(data = {}) {
  const out = {};
  Object.entries(data || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    out[k] = String(v);
  });
  return out;
}

function buildAbsoluteUrl(pathOrUrl) {
  const raw = String(pathOrUrl || "home.html").trim();
  if (/^https?:\/\//i.test(raw)) return raw;

  const base = String(process.env.APP_BASE_URL || "").trim();
  if (!base) return raw;

  const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const cleanPath = raw.startsWith("/") ? raw.slice(1) : raw;
  return `${cleanBase}/${cleanPath}`;
}

async function sendOneSignalPush({ appId, apiKey, subscriptionIds, title, body, data, url }) {
  if (!subscriptionIds.length) return { ok: true, skipped: true };

  const payload = {
    app_id: appId,
    include_subscription_ids: subscriptionIds,
    target_channel: "push",
    headings: { en: title },
    contents: { en: body },
    data: toStringMap(data),
  };

  if (url) payload.url = url;

  const response = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`onesignal_http_${response.status}: ${JSON.stringify(json)}`);
  }

  return { ok: true, result: json };
}

function hasValidResult(match = {}) {
  const sets = String(match?.resultado?.sets || "").trim();
  return sets.length > 0;
}

function isTerminalState(match = {}) {
  const state = String(match.estado || "").toLowerCase();
  return state === "jugado" || state === "jugada" || state === "cancelado" || state === "anulado";
}

function fullRoster(match = {}) {
  const players = Array.isArray(match.jugadores) ? match.jugadores : [];
  if (players.length !== MAX_PLAYERS) return false;
  return players.every((p) => p !== null && p !== undefined && String(p).trim() !== "");
}

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function shouldAutoMark(match, nowMs) {
  if (!match) return false;
  if (isTerminalState(match)) return false;
  if (hasValidResult(match)) return false;
  if (!fullRoster(match)) return false;

  const date = toDate(match.fecha);
  if (!date) return false;
  const unlockAt = date.getTime() + RESULT_LOCK_MINUTES * 60 * 1000;
  return nowMs >= unlockAt;
}

async function runAutoMarkForCollection(colName, nowMs) {
  const db = admin.firestore();
  let updated = 0;
  let scanned = 0;
  let cursor = null;

  while (true) {
    let q = db
      .collection(colName)
      .orderBy("fecha", "asc")
      .where("fecha", "<=", new Date(nowMs))
      .limit(SCAN_PAGE_SIZE);

    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchCount = 0;

    for (const d of snap.docs) {
      scanned += 1;
      const data = d.data() || {};
      if (!shouldAutoMark(data, nowMs)) continue;

      batch.update(d.ref, {
        estado: "jugada",
        autoPlayedAt: admin.firestore.FieldValue.serverTimestamp(),
        autoPlayedBy: "scheduler_v1",
      });
      batchCount += 1;
    }

    if (batchCount > 0) {
      await batch.commit();
      updated += batchCount;
    }

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < SCAN_PAGE_SIZE) break;
  }

  return { scanned, updated };
}

exports.autoMarkPlayedMatches = onSchedule(
  {
    schedule: "every 10 minutes",
    timeZone: "Europe/Madrid",
    region: "europe-west1",
    retry: false,
  },
  async () => {
    const nowMs = Date.now();
    const cols = ["partidosAmistosos", "partidosReto"];
    const summary = {};

    for (const col of cols) {
      summary[col] = await runAutoMarkForCollection(col, nowMs);
    }

    logger.info("autoMarkPlayedMatches run", {
      now: new Date(nowMs).toISOString(),
      summary,
      constraints: { MAX_PLAYERS, RESULT_LOCK_MINUTES },
    });
  },
);

exports.sendFirestoreNotificationPush = onDocumentCreated(
  {
    document: "notificaciones/{notifId}",
    region: "europe-west1",
    retry: true,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const notifId = event.params.notifId;
    const n = snap.data() || {};

    const uid = n.destinatario || n.receptorId || n.uid;
    if (!uid) {
      logger.warn("Push skipped: missing destinatario", { notifId });
      return;
    }

    const appId = String(process.env.ONESIGNAL_APP_ID || "").trim();
    const apiKey = String(process.env.ONESIGNAL_REST_API_KEY || "").trim();
    if (!appId || !apiKey) {
      logger.warn("Push skipped: missing OneSignal env vars", { notifId, hasAppId: !!appId, hasApiKey: !!apiKey });
      await snap.ref.set(
        {
          deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
          pushStatus: "onesignal_not_configured",
        },
        { merge: true },
      );
      return;
    }

    const title = String(n.titulo || n.title || "Padeluminatis");
    const body = String(n.mensaje || n.message || "Nueva notificación");
    const url = buildAbsoluteUrl(n.enlace || n.data?.url || "home.html");
    const type = String(n.tipo || n.type || "info");

    const devicesSnap = await admin
      .firestore()
      .collection("usuarios")
      .doc(uid)
      .collection("devices")
      .where("enabled", "==", true)
      .where("provider", "==", "onesignal")
      .get();

    if (devicesSnap.empty) {
      logger.info("No OneSignal devices for user", { uid, notifId });
      await snap.ref.set(
        {
          deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
          pushStatus: "no_devices",
        },
        { merge: true },
      );
      return;
    }

    const subscriptionIds = [...new Set(
      devicesSnap.docs
        .map((d) => d.data()?.oneSignalPlayerId)
        .filter((v) => typeof v === "string" && v.length > 10),
    )];

    if (!subscriptionIds.length) {
      await snap.ref.set(
        {
          deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
          pushStatus: "empty_subscription_ids",
        },
        { merge: true },
      );
      return;
    }

    try {
      const pushResponse = await sendOneSignalPush({
        appId,
        apiKey,
        subscriptionIds,
        title,
        body,
        url,
        data: {
          notifId,
          uid,
          type,
          title,
          body,
          url,
        },
      });

      await snap.ref.set(
        {
          deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
          pushStatus: "ok",
          pushProvider: "onesignal",
          pushAttemptedTokens: subscriptionIds.length,
          pushResult: pushResponse.result || null,
        },
        { merge: true },
      );

      logger.info("OneSignal push dispatched", {
        notifId,
        uid,
        subscriptions: subscriptionIds.length,
      });
    } catch (err) {
      logger.error("OneSignal push failed", { notifId, uid, error: err?.message || err });
      await snap.ref.set(
        {
          deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
          pushStatus: "error",
          pushProvider: "onesignal",
          pushError: String(err?.message || err).slice(0, 900),
        },
        { merge: true },
      );
      throw err;
    }
  },
);
