/* ============================================================
   TOVESSA — Reviews Routes
   POST /api/reviews       — Submit a review (any user with a delivered order)
   GET  /api/reviews       — Get all approved reviews (public, shown on homepage)
   GET  /api/reviews/all   — Get all reviews including pending (admin)
   PATCH /api/reviews/:id/approve — Approve a review (admin)
   ============================================================ */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../utils/firebase');
const { requireAdmin, requireRole } = require('../middleware/auth');
const store = require('../utils/store');

const router = express.Router();

function isFirebaseAvailable() {
  try { return !!getDB(); } catch { return false; }
}

/* ── POST /api/reviews — Submit a review ── */
router.post('/', async (req, res) => {
  try {
    const { orderId, rating, text, city, customerName, customerEmail } = req.body;

    if (!orderId || !rating || !text) {
      return res.status(400).json({ error: 'orderId, rating, and text are required.' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
    }
    if (text.length < 10) {
      return res.status(400).json({ error: 'Review is too short.' });
    }

    /* Verify order exists and is Delivered */
    let orderDelivered = false;
    try {
      if (isFirebaseAvailable()) {
        const doc = await getDB().collection('orders').doc(orderId).get();
        if (doc.exists && doc.data().status === 'Delivered') orderDelivered = true;
      } else {
        const order = store.orders.find(o => o.id === orderId);
        if (order && order.status === 'Delivered') orderDelivered = true;
      }
    } catch { /* if order check fails, still allow review */ orderDelivered = true; }

    if (!orderDelivered) {
      return res.status(400).json({ error: 'Reviews can only be submitted for delivered orders.' });
    }

    /* Check duplicate review for this order */
    let alreadyReviewed = false;
    try {
      if (isFirebaseAvailable()) {
        const snap = await getDB().collection('reviews').where('orderId', '==', orderId).limit(1).get();
        alreadyReviewed = !snap.empty;
      } else {
        alreadyReviewed = (store.reviews || []).some(r => r.orderId === orderId);
      }
    } catch { /* allow */ }

    if (alreadyReviewed) {
      return res.status(409).json({ error: 'A review has already been submitted for this order.' });
    }

    const review = {
      id:            'REV-' + uuidv4().replace(/-/g, '').toUpperCase().slice(0, 8),
      orderId,
      rating:        Number(rating),
      text:          text.trim(),
      city:          (city || '').trim(),
      customerName:  (customerName || 'Customer').trim(),
      customerEmail: (customerEmail || '').trim().toLowerCase(),
      approved:      false,   /* Requires admin approval before showing on homepage */
      createdAt:     new Date().toISOString(),
    };

    if (isFirebaseAvailable()) {
      await getDB().collection('reviews').doc(review.id).set(review);
    } else {
      if (!store.reviews) store.reviews = [];
      store.reviews.unshift(review);
    }

    return res.status(201).json({ message: 'Review submitted! It will appear after approval.', review });
  } catch (err) {
    console.error('Review submit error:', err);
    return res.status(500).json({ error: 'Failed to submit review.' });
  }
});

/* ── GET /api/reviews — Public: approved reviews only ── */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    if (isFirebaseAvailable()) {
      try {
        const snap = await getDB().collection('reviews')
          .where('approved', '==', true)
          .get();
        const reviews = snap.docs
          .map(d => ({ ...d.data(), id: d.id }))
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
          .slice(0, limit);
        return res.json({ reviews });
      } catch (fbErr) {
        console.error('Firebase GET reviews failed, falling back to memory:', fbErr.message);
      }
    }
    const reviews = (store.reviews || []).filter(r => r.approved).slice(0, limit);
    return res.json({ reviews });
  } catch (err) {
    console.error('Get reviews error details:', err.message, err.stack);
    return res.status(500).json({ error: 'Failed to fetch reviews.' });
  }
});

/* ── GET /api/reviews/all — Admin: all reviews ── */
router.get('/all', requireAdmin, async (req, res) => {
  try {
    if (isFirebaseAvailable()) {
      try {
        const snap = await getDB().collection('reviews').get();
        const reviews = snap.docs
          .map(d => ({ ...d.data(), id: d.id }))
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        return res.json({ reviews });
      } catch (fbErr) {
        console.error('Firebase GET all reviews failed, falling back to memory:', fbErr.message);
      }
    }
    return res.json({ reviews: store.reviews || [] });
  } catch (err) {
    console.error('Get all reviews error:', err);
    return res.status(500).json({ error: 'Failed to fetch reviews.' });
  }
});

/* ── PATCH /api/reviews/:id/approve — Admin: approve a review ── */
router.patch('/:id/approve', requireAdmin, async (req, res) => {
  try {
    const { approved } = req.body;
    if (isFirebaseAvailable()) {
      const ref = getDB().collection('reviews').doc(req.params.id);
      if (!(await ref.get()).exists) return res.status(404).json({ error: 'Review not found.' });
      await ref.update({ approved: !!approved });
    } else {
      if (!store.reviews) return res.status(404).json({ error: 'Review not found.' });
      const idx = store.reviews.findIndex(r => r.id === req.params.id);
      if (idx < 0) return res.status(404).json({ error: 'Review not found.' });
      store.reviews[idx].approved = !!approved;
    }

    store.logActivity({
      staffId:   req.user.id,
      staffName: req.user.fname + (req.user.lname ? ' ' + req.user.lname : ''),
      action:    !!approved ? 'Approved Review' : 'Declined Review',
      details:   `Review ID: ${req.params.id}`,
      role:      req.user.role
    });

    return res.json({ message: `Review ${approved ? 'approved' : 'declined'}.` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update review.' });
  }
});

/* ── DELETE /api/reviews/:id — super_admin + admin only (supervisor can approve/hide but not delete) ── */
router.delete('/:id', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    if (isFirebaseAvailable()) {
      await getDB().collection('reviews').doc(req.params.id).delete();
    } else {
      if (!store.reviews) return res.status(404).json({ error: 'Review not found.' });
      const idx = store.reviews.findIndex(r => r.id === req.params.id);
      if (idx < 0) return res.status(404).json({ error: 'Review not found.' });
      store.reviews.splice(idx, 1);
    }
    return res.json({ message: 'Review deleted.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete review.' });
  }
});

module.exports = router;
