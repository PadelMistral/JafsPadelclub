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

    const title = String(n.titulo || n.title || "Padeluminatis");
    const body = String(n.mensaje || n.message || "Nueva notificación");
    const url = String(n.enlace || n.data?.url || "home.html");
    const type = String(n.tipo || n.type || "info");

    const devicesRef = admin
      .firestore()
      .collection("usuarios")
      .doc(uid)
      .collection("devices")
      .where("enabled", "==", true);

    const devicesSnap = await devicesRef.get();
    if (devicesSnap.empty) {
      logger.info("No push devices for user", { uid, notifId });
      await snap.ref.set(
        { deliveredAt: admin.firestore.FieldValue.serverTimestamp(), pushStatus: "no_devices" },
        { merge: true },
      );
      return;
    }

    const tokenDocs = devicesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((d) => typeof d.token === "string" && d.token.length > 20);

    const tokens = [...new Set(tokenDocs.map((d) => d.token))];
    if (!tokens.length) {
      await snap.ref.set(
        { deliveredAt: admin.firestore.FieldValue.serverTimestamp(), pushStatus: "empty_tokens" },
        { merge: true },
      );
      return;
    }

    const message = {
      tokens,
      notification: {
        title,
        body,
      },
      data: toStringMap({
        notifId,
        uid,
        type,
        url,
        title,
        body,
      }),
      webpush: {
        fcmOptions: {
          link: url,
        },
        notification: {
          icon: "./imagenes/Logojafs.png",
          badge: "./imagenes/Logojafs.png",
          tag: `notif_${notifId}`,
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    const invalidCodes = new Set([
      "messaging/invalid-registration-token",
      "messaging/registration-token-not-registered",
    ]);

    const cleanupTasks = [];
    response.responses.forEach((r, idx) => {
      if (r.success) return;
      const code = r.error?.code;
      if (!invalidCodes.has(code)) return;
      const badToken = tokens[idx];
      const docs = tokenDocs.filter((d) => d.token === badToken);
      docs.forEach((d) => {
        cleanupTasks.push(
          admin
            .firestore()
            .collection("usuarios")
            .doc(uid)
            .collection("devices")
            .doc(d.id)
            .set({ enabled: false, disabledAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }),
        );
      });
    });

    if (cleanupTasks.length) await Promise.allSettled(cleanupTasks);

    await snap.ref.set(
      {
        deliveredAt: admin.firestore.FieldValue.serverTimestamp(),
        pushStatus: response.failureCount > 0 ? "partial" : "ok",
        pushAttemptedTokens: tokens.length,
        pushSuccessCount: response.successCount,
        pushFailureCount: response.failureCount,
      },
      { merge: true },
    );

    logger.info("Push dispatched", {
      notifId,
      uid,
      tokens: tokens.length,
      success: response.successCount,
      failure: response.failureCount,
    });
  },
);

