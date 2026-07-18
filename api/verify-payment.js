// /api/verify-payment.js
// Verifies the Paystack transaction server-side, then delivers the guide by
// email (Resend), and marks the lead as paid in Google Sheets. Never trust
// the client-side "success" callback alone.

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

    // Run side effects in parallel — neither should block the user's response
    const results = await Promise.allSettled([
      markPaidInSheet(reference, fullname, email),
      sendGuideEmail(email, fullname)
    ]);
    const [sheetResult, emailResult] = results;
    console.log('markPaidInSheet result:', sheetResult.status, sheetResult.value ?? sheetResult.reason);
    console.log('sendGuideEmail result:', emailResult.status, emailResult.value ?? emailResult.reason);

    return res.status(200).json({
      verified: true,
      email,
      reference,
      downloadUrl: process.env.GUIDE_DOWNLOAD_URL
    });
  } catch (err) {
    console.error('Paystack verification failed:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}

async function markPaidInSheet(reference, fullname, email) {
  return fetch(process.env.GAS_WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: process.env.GAS_SECRET,
      action: 'markPaid',
      reference, fullname, email
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
