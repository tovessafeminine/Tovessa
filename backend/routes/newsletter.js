/* ============================================================
   TOVESSA — Newsletter Routes (uses shared store)
   ============================================================ */
const express = require('express');
const { getDB }        = require('../utils/firebase');
const { requireAdmin, requireRole } = require('../middleware/auth');
const store             = require('../utils/store');
const { sendNewsletterWelcome, sendBulkPromotion } = require('../utils/email');

const router = express.Router();

function isFirebaseAvailable() {
  try { return !!getDB(); } catch { return false; }
}

/* ── POST /api/newsletter — Subscribe ── */
router.post('/', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }
    const normalEmail = email.trim().toLowerCase();

    if (isFirebaseAvailable()) {
      const db = getDB();
      const existing = await db.collection('subscribers').where('email', '==', normalEmail).limit(1).get();
      if (!existing.empty) return res.json({ message: "You're already part of the Tovessa Circle! 💛", alreadySubscribed: true });
      const ref = await db.collection('subscribers').add({ email: normalEmail, subscribedAt: new Date().toISOString(), active: true });
      sendNewsletterWelcome(normalEmail).catch(e => console.error('Welcome email failed:', e.message));
      return res.status(201).json({ message: "Welcome to Tovessa! 💛 You'll be the first to hear about new arrivals and offers.", id: ref.id });
    }

    /* In-memory via shared store */
    if (store.subscribers.find(s => s.email === normalEmail)) {
      return res.json({ message: "You're already part of the Tovessa Circle! 💛", alreadySubscribed: true });
    }
    const sub = { id: 'sub-' + Date.now(), email: normalEmail, subscribedAt: new Date().toISOString(), active: true };
    store.subscribers.unshift(sub);
    store.emit('new_subscriber', { email: normalEmail });
    sendNewsletterWelcome(normalEmail).catch(e => console.error('Welcome email failed:', e.message));
    return res.status(201).json({ message: "Welcome to Tovessa! 💛 You'll be the first to hear about new arrivals and offers.", id: sub.id });

  } catch (err) {
    console.error('Newsletter error:', err);
    return res.status(500).json({ error: 'Failed to subscribe.' });
  }
});

/* ── GET /api/newsletter (super_admin + admin only — not part of supervisor's job) ── */
router.get('/', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    if (isFirebaseAvailable()) {
      const snap = await getDB().collection('subscribers').orderBy('subscribedAt', 'desc').get();
      return res.json({ subscribers: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
    }
    return res.json({ subscribers: store.subscribers, total: store.subscribers.length });
  } catch (err) {
    return res.json({ subscribers: store.subscribers, total: store.subscribers.length });
  }
});

/* ── DELETE /api/newsletter/:id (super_admin + admin only) ── */
router.delete('/:id', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    if (isFirebaseAvailable()) {
      await getDB().collection('subscribers').doc(req.params.id).delete();
    } else {
      const idx = store.subscribers.findIndex(s => s.id === req.params.id);
      if (idx >= 0) store.subscribers.splice(idx, 1);
    }
    return res.json({ message: 'Subscriber removed.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to remove subscriber.' });
  }
});

/* ── POST /api/newsletter/send — Bulk promotional email to all active subscribers ── */
router.post('/send', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { subject, body, promoCode } = req.body;
    if (!subject?.trim() || !body?.trim()) {
      return res.status(400).json({ error: 'Subject and body are required.' });
    }

    let emails = [];
    if (isFirebaseAvailable()) {
      const snap = await getDB().collection('subscribers')
        .where('active', '==', true).get();
      emails = snap.docs.map(d => d.data().email).filter(Boolean);
    } else {
      emails = store.subscribers.filter(s => s.active !== false).map(s => s.email);
    }

    if (!emails.length) {
      return res.status(400).json({ error: 'No active subscribers found.' });
    }

    /* Send in background — return count immediately */
    res.json({ message: `Sending to ${emails.length} subscribers…`, total: emails.length });

    sendBulkPromotion({ subscribers: emails, subject, body, promoCode })
      .then(r => console.log(`Bulk email done — sent:${r.sent} failed:${r.failed}`))
      .catch(e => console.error('Bulk email error:', e.message));

  } catch (err) {
    console.error('Bulk send error:', err);
    return res.status(500).json({ error: 'Failed to send bulk email.' });
  }
});

/* ── GET /api/newsletter/unsubscribe — One-click unsubscribe link in emails ── */
router.get('/unsubscribe', async (req, res) => {
  try {
    const email = (req.query.email || '').trim().toLowerCase();
    if (!email) return res.status(400).send('Invalid unsubscribe link.');

    if (isFirebaseAvailable()) {
      const snap = await getDB().collection('subscribers')
        .where('email', '==', email).limit(1).get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({ active: false });
      }
    } else {
      const sub = store.subscribers.find(s => s.email === email);
      if (sub) sub.active = false;
    }

    return res.send(`<!DOCTYPE html><html><body style="font-family:Georgia,serif;text-align:center;padding:80px 24px;background:#faf7f2;color:#2c1f14;">
      <h2 style="color:#b8883a;">Tovessa</h2>
      <p style="margin-top:24px;">You have been successfully unsubscribed.</p>
      <p style="color:#9a8070;font-size:.85rem;">You will no longer receive promotional emails from us.</p>
      <a href="https://tovessa.com" style="display:inline-block;margin-top:32px;padding:12px 32px;background:#b8883a;color:#fff;text-decoration:none;font-size:.8rem;letter-spacing:.15em;">VISIT STORE</a>
    </body></html>`);
  } catch (err) {
    return res.status(500).send('Error processing unsubscribe. Please contact us directly.');
  }
});

module.exports = router;
