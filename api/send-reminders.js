// /api/send-reminders.js
// Triggered on a schedule by a free external cron pinger (e.g. cron-job.org).
// Finds leads who finished the form but never paid, and haven't been
// reminded yet, then sends one follow-up email + WhatsApp message each.
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

    let reminded = 0;
    for (const lead of leads) {
      await Promise.allSettled([
        sendReminderEmail(lead),
        lead.whatsapp ? sendReminderWhatsApp(lead) : Promise.resolve(),
        markReminded(lead.reference)
      ]);
      reminded++;
    }

    return res.status(200).json({ reminded });
  } catch (err) {
    console.error('send-reminders failed:', err);
    return res.status(500).json({ error: 'Failed to send reminders' });
  }
}

async function markReminded(reference) {
  return fetch(process.env.GAS_WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: process.env.GAS_SECRET, action: 'markReminded', reference })
  });
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

async function sendReminderWhatsApp(lead) {
  const to = normalizePhone(lead.whatsapp);
  if (!to) return;

  // Also requires an approved WhatsApp template — e.g. "reminder_unlock":
  // "Hi {{1}}, your Japa Roadmap is still waiting — finish here: {{2}}"
  return fetch(
    `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: process.env.WHATSAPP_REMINDER_TEMPLATE_NAME || 'reminder_unlock',
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: lead.fullname || 'there' },
                { type: 'text', text: process.env.SITE_URL }
              ]
            }
          ]
        }
      })
    }
  );
}

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return '234' + digits.slice(1);
  if (digits.startsWith('234')) return digits;
  return digits;
}
