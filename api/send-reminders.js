// /api/send-reminders.js
// Triggered on a schedule by a free external cron pinger (e.g. cron-job.org).
// Finds leads who finished the form but never paid, and haven't been
// reminded yet, then sends one follow-up email each.
//
// Note: the Google Sheet claims each row the moment it's listed (see
// google-apps-script.js), so it's safe if this runs twice close together —
// a second run simply won't see rows the first one already claimed.
//
// Protect this endpoint with CRON_SECRET so randoms on the internet can't
// trigger it — call it like:
//   https://your-site.vercel.app/api/send-reminders?secret=YOUR_CRON_SECRET

export default async function handler(req, res) {
  if (req.query.secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const listRes = await fetch(
      `${process.env.GAS_WEB_APP_URL}?secret=${encodeURIComponent(process.env.GAS_SECRET)}&action=listPending&olderThanMinutes=120`
    );
    const { leads } = await listRes.json();

    if (!leads || leads.length === 0) {
      return res.status(200).json({ reminded: 0 });
    }

    const results = await Promise.allSettled(leads.map(sendReminderEmail));
    const reminded = results.filter(r => r.status === 'fulfilled').length;

    return res.status(200).json({ reminded, total: leads.length });
  } catch (err) {
    console.error('send-reminders failed:', err);
    return res.status(500).json({ error: 'Failed to send reminders' });
  }
}

async function sendReminderEmail(lead) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: [lead.email],
      subject: 'You started your Japa Roadmap — finish unlocking it',
      html: `
        <p>Hi ${lead.fullname || 'there'},</p>
        <p>You completed your Japa Assessment for ${lead.country || 'your destination'} but didn't unlock your roadmap yet.</p>
        <p><a href="${process.env.SITE_URL}#assessment">Go back and finish here</a></p>
      `
    })
  });
}
