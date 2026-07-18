// /api/capture-lead.js
// Called the moment someone finishes Step 5 (before payment). Logs them to
// Google Sheets as "pending" so you have their details even if they never pay —
// and so the reminder job can follow up with them later.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { reference, fullname, email, country, route, timeline, concern } = req.body || {};

  if (!reference || !email) {
    return res.status(400).json({ error: 'Missing reference or email' });
  }

  try {
    const r = await fetch(process.env.GAS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.GAS_SECRET,
        action: 'create',
        reference,
        fullname,
        email,
        country,
        route,
        timeline,
        concern
      })
    });
    const body = await r.json().catch(() => ({}));
    console.log('capture-lead → Apps Script response:', JSON.stringify(body));

    if (body.error) {
      console.error('capture-lead: Apps Script rejected the request:', body.error);
      return res.status(200).json({ ok: false, reason: body.error });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('capture-lead failed:', err);
    // Don't block the user's flow over a logging failure
    return res.status(200).json({ ok: false });
  }
}
