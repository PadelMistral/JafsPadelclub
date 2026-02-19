const admin = require("firebase-admin");
const { logger } = require("firebase-functions");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");

admin.initializeApp();

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
      Authorization: `Key ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`onesignal_http_${response.status}: ${JSON.stringify(json)}`);
  }

  return { ok: true, result: json };
}

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
