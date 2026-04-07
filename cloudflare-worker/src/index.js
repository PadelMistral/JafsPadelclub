const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

function corsHeaders(origin, env) {
  const allowed = String(env.APP_ORIGIN || "").trim();
  const safeOrigin = allowed && origin === allowed ? origin : allowed || "*";
  return {
    "access-control-allow-origin": safeOrigin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

async function verifyFirebaseUser(request, env) {
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("missing_bearer_token");
  }

  const idToken = authHeader.slice("Bearer ".length).trim();
  const apiKey = String(env.FIREBASE_WEB_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("missing_firebase_web_api_key");
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ idToken }),
    },
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data.users) || !data.users[0]?.localId) {
    throw new Error("invalid_firebase_token");
  }

  return {
    uid: data.users[0].localId,
    email: data.users[0].email || null,
  };
}

function normalizePayload(body = {}) {
  const title = String(body.titulo || body.title || "Padeluminatis").trim().slice(0, 120);
  const message = String(body.mensaje || body.message || "Nueva notificacion").trim().slice(0, 600);
  const externalIds = Array.isArray(body.externalIds)
    ? body.externalIds.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 2000)
    : [];
  const url = typeof body.url === "string" ? body.url.trim() : "home.html";
  const data = body.data && typeof body.data === "object" ? body.data : {};

  if (!title || !message || !externalIds.length) {
    throw new Error("invalid_payload");
  }

  return { title, message, externalIds, url, data };
}

async function sendOneSignalPush(env, payload) {
  const appId = String(env.ONESIGNAL_APP_ID || "").trim();
  const apiKey = String(env.ONESIGNAL_REST_API_KEY || "").trim();
  if (!appId || !apiKey) {
    throw new Error("missing_onesignal_credentials");
  }

  const response = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      Authorization: `Basic ${apiKey}`,
    },
    body: JSON.stringify({
      app_id: appId,
      include_aliases: {
        external_id: payload.externalIds,
      },
      target_channel: "push",
      headings: { en: payload.title, es: payload.title },
      contents: { en: payload.message, es: payload.message },
      data: payload.data || {},
      url: payload.url || "home.html",
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`onesignal_error_${response.status}:${JSON.stringify(data)}`);
  }

  return data;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin") || "";
    const headers = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "jafs-push-worker" }, 200, headers);
    }

    if (request.method !== "POST" || url.pathname !== "/send-push") {
      return json({ ok: false, error: "not_found" }, 404, headers);
    }

    try {
      const sender = await verifyFirebaseUser(request, env);
      const body = await request.json().catch(() => ({}));
      const payload = normalizePayload(body);
      const result = await sendOneSignalPush(env, {
        ...payload,
        data: {
          ...payload.data,
          senderUid: sender.uid,
          sentAt: new Date().toISOString(),
        },
      });

      return json(
        {
          ok: true,
          senderUid: sender.uid,
          targetedUsers: payload.externalIds.length,
          onesignalId: result.id || null,
          recipients: result.recipients || 0,
        },
        200,
        headers,
      );
    } catch (error) {
      return json(
        {
          ok: false,
          error: error?.message || "push_worker_error",
        },
        400,
        headers,
      );
    }
  },
};
