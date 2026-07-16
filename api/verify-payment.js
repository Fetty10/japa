// /api/verify-payment.js
// Verifies the Paystack transaction server-side, then delivers the guide by
// email (Resend) and WhatsApp (Meta Cloud API), and marks the lead as paid
// in Google Sheets. Never trust the client-side "success" callback alone.

const GUIDE_PRICE_KOBO = 2500000; // ₦25,000 — must match the amount charged on the frontend

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { reference } = req.body || {};
  if (!reference) {
    return res.status(400).json({ error: 'Missing transaction reference' });
  }

  try {
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const data = await paystackRes.json();
    const tx = data && data.data;

    const isSuccess = data.status === true && tx && tx.status === 'success';
    const isCorrectAmount = tx && (tx.requested_amount ?? tx.amount) === GUIDE_PRICE_KOBO;

    if (!isSuccess || !isCorrectAmount) {
      console.log('Verification failed. Paystack response:', JSON.stringify(data));
      console.log('isSuccess:', isSuccess, 'isCorrectAmount:', isCorrectAmount, 'tx.status:', tx && tx.status, 'tx.amount:', tx && tx.amount);
      return res.status(200).json({ verified: false });
    }

    const email = tx.customer.email;
    const fields = {};
    (tx.metadata?.custom_fields || []).forEach(f => { fields[f.variable_name] = f.value; });
    const fullname = fields.full_name || 'there';
    const whatsapp = fields.whatsapp || '';

    // Run all three side effects in parallel — none of them should block the user's response
    const results = await Promise.allSettled([
      markPaidInSheet(reference, fullname, email, whatsapp),
      sendGuideEmail(email, fullname),
      whatsapp ? sendGuideWhatsApp(whatsapp, fullname) : Promise.resolve({ skipped: true })
    ]);
    const [sheetResult, emailResult, whatsappResult] = results;
    console.log('markPaidInSheet result:', sheetResult.status, sheetResult.value ?? sheetResult.reason);
    console.log('sendGuideEmail result:', emailResult.status, emailResult.value ?? emailResult.reason);
    console.log('sendGuideWhatsApp result:', whatsappResult.status, whatsappResult.value ?? whatsappResult.reason);

    return res.status(200).json({ verified: true, email, reference });
  } catch (err) {
    console.error('Paystack verification failed:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}

async function markPaidInSheet(reference, fullname, email, whatsapp) {
  return fetch(process.env.GAS_WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: process.env.GAS_SECRET,
      action: 'markPaid',
      reference, fullname, email, whatsapp
    })
  });
}

async function sendGuideEmail(email, fullname) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL, // e.g. "Japa Roadmap <guide@yourdomain.com>"
      to: [email],
      subject: 'Your Japa Roadmap is ready 🎉',
      html: `
        <p>Hi ${fullname},</p>
        <p>Thank you for your payment — your personalised Japa Roadmap is ready.</p>
        <p><a href="${process.env.GUIDE_DOWNLOAD_URL}">Click here to download your guide</a></p>
        <p>Keep this email — you can come back to this link any time.</p>
        <p>Good luck with the journey!</p>
      `
    })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Resend ${r.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function sendGuideWhatsApp(whatsappNumber, fullname) {
  const to = normalizePhone(whatsappNumber);
  if (!to) return;

  // Requires an approved WhatsApp message template (business-initiated messages
  // outside a 24h customer session must use a template). Example template body:
  // "Hi {{1}}, your Japa Roadmap is ready! Download it here: {{2}}"
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
          name: process.env.WHATSAPP_TEMPLATE_NAME || 'guide_ready',
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: fullname },
                { type: 'text', text: process.env.GUIDE_DOWNLOAD_URL }
              ]
            }
          ]
        }
      })
    }
  );
}

function normalizePhone(raw) {
  // Converts a Nigerian local number (0803...) into E.164 (234803...)
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('0')) return '234' + digits.slice(1);
  if (digits.startsWith('234')) return digits;
  return digits;
}
