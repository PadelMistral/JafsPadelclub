export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const {
      titulo,
      mensaje,
      externalIds = [],
      segmentos = [],
      url = "home.html",
      data = {},
    } = req.body || {};

    if (!titulo || !mensaje) {
      return res.status(400).json({ error: "Faltan titulo o mensaje" });
    }

    const appId = process.env.ONESIGNAL_APP_ID || "0f270864-c893-4c44-95cc-393321937fb2";
    const apiKey = process.env.ONESIGNAL_REST_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Falta ONESIGNAL_REST_API_KEY en Vercel" });
    }

    const cleanedExternalIds = Array.isArray(externalIds)
      ? externalIds.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    const cleanedSegments = Array.isArray(segmentos)
      ? segmentos.map((x) => String(x || "").trim()).filter(Boolean)
      : [];

    const payload = {
      app_id: appId,
      target_channel: "push",
      headings: { es: String(titulo), en: String(titulo) },
      contents: { es: String(mensaje), en: String(mensaje) },
      data: { ...data },
      url,
    };

    if (cleanedExternalIds.length) {
      payload.include_aliases = { external_id: cleanedExternalIds };
    } else {
      payload.included_segments = cleanedSegments.length ? cleanedSegments : ["All"];
    }

    const response = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const out = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: "Error OneSignal",
        details: out,
      });
    }

    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({
      error: "Internal server error",
      detail: err?.message || String(err),
    });
  }
}
