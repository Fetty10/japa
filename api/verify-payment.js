// /api/verify-payment.js
// Vercel serverless function — verifies a Paystack transaction server-side.
// Never trust the client-side "success" callback alone; Paystack can be spoofed
// in the browser, so the real confirmation has to come from this server call.

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
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
        }
      }
    );

    const data = await paystackRes.json();
    const tx = data && data.data;

    const isSuccess = data.status === true && tx && tx.status === 'success';
    const isCorrectAmount = tx && tx.amount === GUIDE_PRICE_KOBO;

    if (!isSuccess || !isCorrectAmount) {
      return res.status(200).json({ verified: false });
    }

    // At this point payment is confirmed. This is where you'd trigger delivery —
    // e.g. call your n8n webhook to log the sale to Google Sheets and send the
    // guide via email + WhatsApp. Example:
    //
    // await fetch(process.env.N8N_WEBHOOK_URL, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({
    //     email: tx.customer.email,
    //     reference: tx.reference,
    //     amount: tx.amount,
    //     metadata: tx.metadata
    //   })
    // });

    return res.status(200).json({
      verified: true,
      email: tx.customer.email,
      reference: tx.reference
    });
  } catch (err) {
    console.error('Paystack verification failed:', err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}
