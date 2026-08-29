/* ============================================================
   TOVESSA — Email Utility (Resend)
   ============================================================ */
const { Resend } = require('resend');

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

const FROM = 'Tovessa <orders@tovessa.com>';
const TO   = process.env.EMAIL_TO;

/* ── Order Confirmation Email (to customer) ── */
async function sendOrderConfirmation({ to, orderRef, items, delivery, total, paymentMethod }) {
  const resend = getResend();
  const itemRows = items.map(i =>
    `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;">${i.emoji || '🛍️'} ${i.name} × ${i.qty}</td>
      <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;text-align:right;">PKR ${(i.price * i.qty).toLocaleString()}</td>
    </tr>`
  ).join('');

  await resend.emails.send({
    from: FROM,
    to,
    subject: `Order Confirmed — ${orderRef} | Tovessa`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:40px;background:#1a0f15;font-family:Georgia,serif;color:#ccc;">
      <h1 style="color:#602442;">TOVESSA</h1>
      <h2 style="color:#fff;">Order Confirmed ✓</h2>
      <p>Thank you ${delivery.fname}! Your order <strong style="color:#602442;">${orderRef}</strong> has been placed.</p>
      <table width="100%" style="margin:24px 0;">${itemRows}</table>
      <p><strong style="color:#602442;">Total: PKR ${total.toLocaleString()}</strong></p>
      <p style="color:#888;">Delivering to: ${delivery.address}, ${delivery.city}</p>
      <p style="color:#888;">Payment: ${paymentMethod === 'cod' ? 'Cash on Delivery' : paymentMethod === 'bank_deposit' ? 'Bank Deposit' : paymentMethod}</p>
      ${paymentMethod === 'bank_deposit' ? `
      <div style="margin:18px 0;padding:16px 20px;background:#1a0f15;border:1px solid #2a2a2a;">
        <p style="color:#602442;margin:0 0 8px;font-weight:bold;">Bank Deposit Details</p>
        <p style="margin:2px 0;">Bank: Bank Alfalah</p>
        <p style="margin:2px 0;">Account Title: MUHAMMAD SUBHAN</p>
        <p style="margin:2px 0;">Account Number: 09601009896691</p>
        <p style="margin:2px 0;">IBAN: PK45ALFH0960001009896691</p>
        <p style="margin:10px 0 0;color:#aaa;">After placing your order, please send a screenshot of the payment to our WhatsApp.</p>
      </div>` : ''}
      <p style="color:#555;font-size:.8rem;">Questions? Email tovessa@gmail.com</p>
    </body></html>`,
  });
}

/* ── New Order Notification (to store owner) ── */
async function sendNewOrderNotification({ orderRef, items, delivery, total, paymentMethod }) {
  if (!TO) return;
  const resend = getResend();
  const itemList = items.map(i => `<li>${i.name} × ${i.qty} — PKR ${(i.price * i.qty).toLocaleString()}</li>`).join('');

  await resend.emails.send({
    from: FROM,
    to: TO,
    subject: `🛍️ New Order — ${orderRef} | PKR ${total.toLocaleString()}`,
    html: `<body style="font-family:sans-serif;background:#1a0f15;color:#ccc;padding:32px;">
      <h2 style="color:#602442;">🛍️ New Order — ${orderRef}</h2>
      <p><strong>Customer:</strong> ${delivery.fname} ${delivery.lname} (${delivery.email})</p>
      <p><strong>Phone:</strong> ${delivery.phone}</p>
      <p><strong>Address:</strong> ${delivery.address}, ${delivery.city}</p>
      <p><strong>Payment:</strong> ${paymentMethod === 'cod' ? 'Cash on Delivery' : paymentMethod === 'bank_deposit' ? 'Bank Deposit' : paymentMethod}</p>
      <ul>${itemList}</ul>
      <p style="color:#602442;font-size:1.2rem;"><strong>Total: PKR ${total.toLocaleString()}</strong></p>
    </body>`,
  });
}

/* ── Contact Form Notification (to store owner) ── */
async function sendContactNotification({ name, email, phone, subject, message }) {
  if (!TO) return;
  const resend = getResend();

  await resend.emails.send({
    from: FROM,
    to: TO,
    subject: `📬 Contact: ${subject || 'New Message'} — from ${name}`,
    html: `<body style="font-family:sans-serif;background:#1a0f15;color:#ccc;padding:32px;">
      <h2 style="color:#602442;">New Contact Message</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ''}
      ${subject ? `<p><strong>Subject:</strong> ${subject}</p>` : ''}
      <p><strong>Message:</strong></p>
      <blockquote style="border-left:3px solid #602442;padding:12px 20px;background:#1a0f15;">${message}</blockquote>
    </body>`,
  });
}

/* ── Newsletter Welcome ── */
async function sendNewsletterWelcome(email) {
  const resend = getResend();

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: '💛 Welcome to Tovessa',
    html: `<body style="margin:0;padding:40px;background:#1a0f15;font-family:Georgia,serif;text-align:center;color:#ccc;">
      <h1 style="color:#602442;">TOVESSA</h1>
      <h2 style="color:#fff;">Welcome to the Circle 💛</h2>
      <p style="color:#888;">You're now part of Tovessa's exclusive circle. You'll be the first to know about new arrivals, fresh collections, and special offers.</p>
      <p style="color:#888;font-size:.85rem;margin-top:24px;">Questions? tovessa@gmail.com</p>
    </body>`,
  });
}



/* ── Reply Email (to customer, from admin) ── */
async function sendReplyEmail({ to, customerName, originalMessage, replyText }) {
  const resend = getResend();
  await resend.emails.send({
    from: FROM,
    to,
    subject: `Re: Your message to Tovessa`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:40px;background:#fdf8fb;font-family:Georgia,serif;color:#2c1f14;">
      <h2 style="color:#602442;">TOVESSA</h2>
      <p>Dear ${customerName || 'Valued Customer'},</p>
      <p style="line-height:1.8;">${replyText.replace(/\n/g, '<br>')}</p>
      <hr style="border:none;border-top:1px solid #d4a0c0;margin:24px 0;"/>
      <p style="color:#9a8070;font-size:.82rem;">Your original message:</p>
      <blockquote style="border-left:3px solid #602442;padding:10px 16px;background:#f5eef2;color:#5a4030;font-size:.85rem;margin:8px 0;">
        ${originalMessage}
      </blockquote>
      <p style="color:#9a8070;font-size:.78rem;margin-top:24px;">
        Tovessa — tovessa@gmail.com
      </p>
    </body></html>`,
  });
}

/* ── Bulk Promotion Email (to all subscribers) ── */
async function sendBulkPromotion({ subscribers, subject, body, promoCode }) {
  const resend = getResend();
  const results = { sent: 0, failed: 0, errors: [] };

  for (const email of subscribers) {
    try {
      await resend.emails.send({
        from: FROM,
        to: email,
        subject,
        html: `<!DOCTYPE html><html><body style="margin:0;padding:40px;background:#fdf8fb;font-family:Georgia,serif;color:#2c1f14;text-align:center;">
          <h2 style="color:#602442;letter-spacing:.15em;">TOVESSA</h2>
          <hr style="border:none;border-top:1px solid #d4a0c0;margin:20px auto;width:80px;"/>
          <div style="max-width:520px;margin:0 auto;text-align:left;line-height:1.9;color:#5a4030;">
            ${body.replace(/\n/g, '<br>')}
          </div>
          ${promoCode ? `
          <div style="margin:32px auto;max-width:300px;border:1px solid #602442;padding:20px;text-align:center;background:#fff;">
            <p style="font-size:.65rem;letter-spacing:.3em;text-transform:uppercase;color:#9a8070;margin:0 0 10px;">Your Exclusive Code</p>
            <p style="font-family:monospace;font-size:1.6rem;color:#602442;font-weight:700;letter-spacing:.2em;margin:0;">${promoCode}</p>
          </div>` : ''}
          <p style="color:#9a8070;font-size:.72rem;margin-top:32px;">
            You're receiving this because you subscribed to Tovessa.<br/>
            <a href="https://tovessa.com/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}" 
               style="color:#602442;">Unsubscribe</a>
          </p>
        </body></html>`,
      });
      results.sent++;
      /* Small delay to avoid rate limiting */
      await new Promise(r => setTimeout(r, 120));
    } catch (err) {
      results.failed++;
      results.errors.push({ email, error: err.message });
    }
  }
  return results;
}

/* 🧾 Invoice Email (to customer) 🧾 */
async function sendInvoiceEmail({ to, invoiceRef, customerName, pdfPath, liveOrder }) {
  const fs = require('fs');
  const resend = getResend();

  let attachments = [];
  if (pdfPath && fs.existsSync(pdfPath)) {
    const fileBuffer = fs.readFileSync(pdfPath);
    attachments = [{
      filename: `Invoice_${invoiceRef}.pdf`,
      content: fileBuffer
    }];
  }

  await resend.emails.send({
    from: FROM,
    to,
    subject: `Invoice ${invoiceRef} | Tovessa`,
    attachments,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:40px;background:#fdf8fb;font-family:Georgia,serif;color:#2c1f14;">
      <h2 style="color:#602442;">TOVESSA</h2>
      <p>Dear ${customerName || 'Customer'},</p>
      <p>Thank you for shopping with Tovessa. Please find attached the invoice for your order <strong>${invoiceRef}</strong>.</p>
      <p style="color:#9a8070;font-size:.78rem;margin-top:24px;">
        Tovessa — tovessa@gmail.com
      </p>
    </body></html>`,
  });
}

module.exports = {
  sendOrderConfirmation,
  sendNewOrderNotification,
  sendContactNotification,
  sendNewsletterWelcome,
  sendReplyEmail,
  sendBulkPromotion,
  sendInvoiceEmail,
};
