// /api/capture-lead.js
// Called the moment someone finishes Step 5 (before payment). Logs them to
// Google Sheets as "pending" so you have their details even if they never pay —
// and so the reminder job can follow up with them later.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { reference, fullname, email, whatsapp, country, route, timeline } = req.body || {};

  if (!reference || !email) {
    return res.status(400).json({ error: 'Missing reference or email' });
  }

  try {
    await fetch(process.env.GAS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.GAS_SECRET,
        action: 'create',
        reference,
        fullname,
        email,
        whatsapp,
        country,
        route,
        timeline
      })
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('capture-lead failed:', err);
    // Don't block the user's flow over a logging failure
    return res.status(200).json({ ok: false });
  }
}
