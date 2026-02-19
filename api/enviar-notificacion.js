export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { titulo, mensaje } = req.body;

  const response = await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${process.env.ONESIGNAL_REST_API_KEY}`
    },
    body: JSON.stringify({
      app_id: process.env.ONESIGNAL_APP_ID,
      included_segments: ["All"],
      headings: { en: titulo },
      contents: { en: mensaje }
    })
  });

  const data = await response.json();
  res.status(200).json(data);
}
