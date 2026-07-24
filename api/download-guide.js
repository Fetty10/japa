// /api/download-guide.js
// Serves the personalised PDF: verifies the payment reference is genuinely
// paid (re-checks with Paystack, same as verify-payment.js), picks the PDF
// variant that leads with the buyer's chosen destination, stamps their name
// on the cover, and streams the result back.
//
// Used both by the "Download Your Guide Now" button on the success screen
// and as the link sent in the delivery email.

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const GUIDE_PRICE_KOBO = 2500000;

// Base PDF variants — one per destination, each with that country's chapter
// first. Hosted on Cloudinary; update these to your actual URLs.
const GUIDE_VARIANTS = {
  UK: process.env.GUIDE_URL_UK,
  USA: process.env.GUIDE_URL_USA,
  CANADA: process.env.GUIDE_URL_CANADA,
  AUSTRALIA: process.env.GUIDE_URL_AUSTRALIA,
};

export default async function handler(req, res) {
  const { reference } = req.query;
  if (!reference) {
    return res.status(400).send('Missing reference');
  }

  try {
    // Re-verify with Paystack directly, rather than trusting the query string,
    // so this endpoint can't be used to fetch a paid guide without having paid.
    const paystackRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const data = await paystackRes.json();
    const tx = data && data.data;
    const isSuccess = data.status === true && tx && tx.status === 'success';
    const isCorrectAmount = tx && (tx.requested_amount ?? tx.amount) === GUIDE_PRICE_KOBO;

    if (!isSuccess || !isCorrectAmount) {
      return res.status(403).send('Payment not verified for this reference.');
    }

    const fields = {};
    (tx.metadata?.custom_fields || []).forEach(f => { fields[f.variable_name] = f.value; });
    const fullname = fields.full_name || 'there';
    const firstName = fullname.split(' ')[0];
    const destinationRaw = (fields.destination || 'UK').toUpperCase();
    const destination = GUIDE_VARIANTS[destinationRaw] ? destinationRaw : 'UK'; // fallback if "Not sure" was selected

    const baseUrl = GUIDE_VARIANTS[destination];
    if (!baseUrl) {
      return res.status(500).send('Guide file not configured for this destination.');
    }

    // Fetch the correct base PDF and stamp the buyer's name on the cover
    const baseBytes = await (await fetch(baseUrl)).arrayBuffer();
    const pdfDoc = await PDFDocument.load(baseBytes);
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const coverPage = pdfDoc.getPage(0);
    const { width } = coverPage.getSize();

    const label = `PREPARED FOR ${firstName.toUpperCase()}`;
    const fontSize = 11;
    const textWidth = font.widthOfTextAtSize(label, fontSize);
    coverPage.drawText(label, {
      x: (width - textWidth) / 2,
      y: 150, // just below the "4 DESTINATIONS · ..." line on the cover
      size: fontSize,
      font,
      color: rgb(0.49, 0.55, 0.65), // matches the cover's muted slate-blue tone
    });

    const finalBytes = await pdfDoc.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="japa-roadmap-${firstName.toLowerCase()}.pdf"`);
    return res.status(200).send(Buffer.from(finalBytes));
  } catch (err) {
    console.error('download-guide failed:', err);
    return res.status(500).send('Something went wrong generating your guide. Please contact support with reference: ' + reference);
  }
}
