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
      sendGuideEmail(email, fullname, reference)
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

async function sendGuideEmail(email, fullname, reference) {
  const firstName = (fullname || 'there').split(' ')[0];
  const downloadUrl = process.env.GUIDE_DOWNLOAD_URL;

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
      <div style="display:inline-block;background-color:#EAF5EE;color:#158443;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;padding:6px 12px;border-radius:100px;margin-bottom:16px;">✓ Payment Confirmed</div>
      <h1 style="margin:14px 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:23px;line-height:1.3;color:#0B1F3A;">Your Japa Roadmap is ready, ${firstName}</h1>
      <p style="margin:0 0 24px;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.65;color:#14181F;">Thank you for your payment. Your complete 26-page relocation guide — covering the UK, USA, Canada, and Australia — is ready to download below.</p>
    </td></tr>

    <tr><td style="padding:0 32px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="border-radius:10px;background-color:#FFB100;">
          <a href="${downloadUrl}" style="display:inline-block;padding:15px 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#0B1F3A;text-decoration:none;">Download Your Guide →</a>
        </td>
      </tr></table>
    </td></tr>

    <tr><td style="padding:14px 32px 28px;">
      <p style="margin:0;font-family:Georgia,serif;font-size:13px;line-height:1.6;color:#5B6472;">Keep this email — the link above works any time. If the button doesn't work, copy this link into your browser:<br>
      <a href="${downloadUrl}" style="color:#0B1F3A;word-break:break-all;">${downloadUrl}</a></p>
    </td></tr>

    <tr><td style="padding:0 32px;"><div style="border-top:1px dashed #E4DDCB;line-height:1px;font-size:1px;">&nbsp;</div></td></tr>

    <tr><td style="padding:24px 32px 8px;">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#0B1F3A;font-weight:bold;text-transform:uppercase;margin-bottom:12px;">What To Do Next</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="font-family:Georgia,serif;font-size:13.5px;color:#14181F;">
        <tr><td valign="top" style="padding:0 8px 10px 0;color:#158443;font-weight:bold;">1.</td><td style="padding:0 0 10px;line-height:1.55;">Open the guide and read the section for your chosen destination first</td></tr>
        <tr><td valign="top" style="padding:0 8px 10px 0;color:#158443;font-weight:bold;">2.</td><td style="padding:0 0 10px;line-height:1.55;">Work through the "Start This Today" checklist for the one pathway that fits you</td></tr>
        <tr><td valign="top" style="padding:0 8px 0 0;color:#158443;font-weight:bold;">3.</td><td style="line-height:1.55;">Save this email — it's your receipt and backup download link</td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:28px 32px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="background-color:#F7F3EA;border-radius:8px;width:100%;">
        <tr><td style="padding:12px 16px;font-family:'Courier New',monospace;font-size:11px;color:#5B6472;">ORDER REFERENCE<br><span style="color:#14181F;font-size:12.5px;">${reference}</span></td></tr>
      </table>
    </td></tr>

  </table>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
  <tr><td align="center" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.6;color:#9AA2AF;padding:16px 16px 8px;">
    This guide provides general relocation information and is not immigration or legal advice.
  </td></tr>
  </table>

</td></tr>
</table>
</body>
</html>`;

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
      html
    })
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`Resend ${r.status}: ${JSON.stringify(body)}`);
  }
  return body;
}
