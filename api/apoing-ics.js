export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const rawUrl = String(req.query?.url || "").trim();
    if (!rawUrl) return res.status(400).json({ error: "Missing url" });
    if (!/^https:\/\/www\.apoing\.com\/calendars\/.+\.ics$/i.test(rawUrl)) {
      return res.status(400).json({ error: "Invalid Apoing URL" });
    }

    const r = await fetch(rawUrl, { method: "GET" });
    if (!r.ok) return res.status(r.status).json({ error: "Fetch failed", status: r.status });
    const text = await r.text();
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    return res.status(200).send(text);
  } catch (e) {
    return res.status(500).json({ error: "Internal server error", detail: e?.message || String(e) });
  }
}

