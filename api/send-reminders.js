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
  const firstName = (lead.fullname || 'there').split(' ')[0];
  const country = lead.country || 'your destination';
  const assessmentUrl = `${process.env.SITE_URL}#assessment`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#F7F3EA;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F7F3EA;padding:32px 16px;">
<tr><td align="center">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E4DDCB;">

    <tr><td style="background-color:#0B1F3A;padding:26px 32px;">
      <span style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:3px;color:#FFB100;text-transform:uppercase;font-weight:bold;">JAPA ROADMAP</span>
    </td></tr>
    <tr><td style="height:4px;background-color:#FFB100;line-height:4px;font-size:0;">&nbsp;</td></tr>

    <tr><td style="padding:36px 32px 4px;">
      <div style="display:inline-block;background-color:#FDF0DC;color:#8A6510;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;padding:6px 12px;border-radius:100px;margin-bottom:16px;">⏳ Still Waiting For You</div>
      <h1 style="margin:14px 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:23px;line-height:1.3;color:#0B1F3A;">${firstName}, your roadmap to ${country} isn't finished yet</h1>
      <p style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.65;color:#14181F;">You completed your Japa Assessment, but you didn't unlock your personalised guide. It's still waiting for you — pick up right where you left off, it only takes a minute.</p>
    </td></tr>

    <tr><td style="padding:0 32px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="border-radius:10px;background-color:#FFB100;">
          <a href="${assessmentUrl}" style="display:inline-block;padding:15px 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#0B1F3A;text-decoration:none;">Finish Unlocking My Roadmap →</a>
        </td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:0 32px;"><div style="border-top:1px dashed #E4DDCB;line-height:1px;font-size:1px;">&nbsp;</div></td></tr>

    <tr><td style="padding:24px 32px 32px;">
      <p style="margin:0;font-family:Georgia,serif;font-size:13px;line-height:1.6;color:#5B6472;">Your 26-page guide covers the UK, USA, Canada, and Australia — with real requirements, official government links, and a step-by-step checklist for each pathway. It's a one-time payment, no subscription.</p>
    </td></tr>

  </table>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
  <tr><td align="center" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#9AA2AF;padding:16px 16px 8px;">
    You're receiving this because you started an assessment on the Japa Roadmap site.
  </td></tr>
  </table>

</td></tr>
</table>
</body>
</html>`;

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
      html
    })
  });
}
