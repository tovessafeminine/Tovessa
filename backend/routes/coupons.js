/* ============================================================
   TOVESSA — Discount Coupons Routes
   Coupons are created and managed exclusively by super_admin.
   Validation (checking if a code works) is public so customers
   can apply a coupon at checkout without being logged in.
   ============================================================ */
const express          = require('express');
const { v4: uuidv4 }   = require('uuid');
const { getDB }        = require('../utils/firebase');
const { requireRole }  = require('../middleware/auth');
const store             = require('../utils/store');

const router = express.Router();

function isFirebaseAvailable() {
  try { return !!getDB(); } catch { return false; }
}

/* ── POST /api/coupons — Create a coupon (super_admin ONLY) ── */
router.post('/', requireRole('super_admin'), async (req, res) => {
  try {
    const { code, type, value, minOrderAmount, maxUses, expiresAt, active } = req.body;

    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode) return res.status(400).json({ error: 'Coupon code is required.' });
    if (!/^[A-Z0-9_-]{3,24}$/.test(cleanCode)) {
      return res.status(400).json({ error: 'Coupon code must be 3–24 characters: letters, numbers, "-" or "_" only.' });
    }
    if (!['percent', 'fixed'].includes(type)) {
      return res.status(400).json({ error: 'Type must be "percent" or "fixed".' });
    }
    const numValue = Number(value);
    if (!numValue || numValue <= 0) return res.status(400).json({ error: 'Discount value must be greater than 0.' });
    if (type === 'percent' && numValue > 100) return res.status(400).json({ error: 'Percentage discount cannot exceed 100.' });

    if (store.findCoupon(cleanCode)) {
      return res.status(409).json({ error: `Coupon "${cleanCode}" already exists.` });
    }

    const coupon = {
      id:             'cpn-' + uuidv4().replace(/-/g, '').slice(0, 10),
      code:           cleanCode,
      type,                                    /* 'percent' | 'fixed' */
      value:          numValue,                /* % (0-100) or flat PKR amount */
      minOrderAmount: minOrderAmount != null && minOrderAmount !== '' ? Number(minOrderAmount) : null,
      maxUses:        maxUses != null && maxUses !== '' ? Number(maxUses) : null,
      usedCount:      0,
      expiresAt:      expiresAt || null,       /* ISO date string or null = never expires */
      active:         active !== false,
      createdAt:      new Date().toISOString(),
      createdBy:       req.user?.email || req.user?.uid || 'super_admin',
    };

    if (isFirebaseAvailable()) {
      await getDB().collection('coupons').doc(coupon.id).set(coupon);
    } else {
      store.coupons.unshift(coupon);
    }

    store.logActivity({
      staffId:   req.user.id,
      staffName: req.user.fname + (req.user.lname ? ' ' + req.user.lname : ''),
      action:    'Generated Coupon',
      details:   `${coupon.code} (${coupon.type} - ${coupon.value})`,
      role:      req.user.role
    });

    return res.status(201).json({ message: `Coupon "${coupon.code}" created.`, coupon });
  } catch (err) {
    console.error('Create coupon error:', err);
    return res.status(500).json({ error: 'Failed to create coupon.' });
  }
});

/* ── GET /api/coupons — List all coupons (super_admin ONLY) ── */
router.get('/', requireRole('super_admin'), async (req, res) => {
  try {
    if (isFirebaseAvailable()) {
      try {
        const snap = await getDB().collection('coupons').orderBy('createdAt', 'desc').get();
        const coupons = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        return res.json({ coupons, total: coupons.length });
      } catch (fbErr) {
        console.error('Firebase GET coupons failed, falling back to memory:', fbErr.message);
      }
    }
    const coupons = [...store.coupons].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ coupons, total: coupons.length });
  } catch (err) {
    console.error('List coupons error:', err);
    return res.json({ coupons: store.coupons, total: store.coupons.length });
  }
});

/* ── PATCH /api/coupons/:id — Update a coupon (super_admin ONLY) ──
   Accepts any subset of: type, value, minOrderAmount, maxUses, expiresAt, active */
router.patch('/:id', requireRole('super_admin'), async (req, res) => {
  try {
    const { type, value, minOrderAmount, maxUses, expiresAt, active } = req.body;
    const updates = {};
    if (type !== undefined) {
      if (!['percent', 'fixed'].includes(type)) return res.status(400).json({ error: 'Type must be "percent" or "fixed".' });
      updates.type = type;
    }
    if (value !== undefined) {
      const numValue = Number(value);
      if (!numValue || numValue <= 0) return res.status(400).json({ error: 'Discount value must be greater than 0.' });
      updates.value = numValue;
    }
    if (minOrderAmount !== undefined) updates.minOrderAmount = minOrderAmount === '' || minOrderAmount === null ? null : Number(minOrderAmount);
    if (maxUses !== undefined)        updates.maxUses        = maxUses === '' || maxUses === null ? null : Number(maxUses);
    if (expiresAt !== undefined)      updates.expiresAt      = expiresAt || null;
    if (active !== undefined)         updates.active         = !!active;

    if (isFirebaseAvailable()) {
      const ref = getDB().collection('coupons').doc(req.params.id);
      if (!(await ref.get()).exists) return res.status(404).json({ error: 'Coupon not found.' });
      await ref.update(updates);
    } else {
      const idx = store.coupons.findIndex(c => c.id === req.params.id);
      if (idx < 0) return res.status(404).json({ error: 'Coupon not found.' });
      Object.assign(store.coupons[idx], updates);
    }

    return res.json({ message: 'Coupon updated.' });
  } catch (err) {
    console.error('Update coupon error:', err);
    return res.status(500).json({ error: 'Failed to update coupon.' });
  }
});

/* ── DELETE /api/coupons/:id — Delete a coupon (super_admin ONLY) ── */
router.delete('/:id', requireRole('super_admin'), async (req, res) => {
  try {
    if (isFirebaseAvailable()) {
      await getDB().collection('coupons').doc(req.params.id).delete();
    } else {
      const idx = store.coupons.findIndex(c => c.id === req.params.id);
      if (idx < 0) return res.status(404).json({ error: 'Coupon not found.' });
      store.coupons.splice(idx, 1);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('Delete coupon error:', err);
    return res.status(500).json({ error: 'Failed to delete coupon.' });
  }
});

/* ── POST /api/coupons/validate — PUBLIC: check if a code works for a given subtotal ──
   Used by the storefront checkout page. No auth required — a customer is
   not logged in as admin. Does NOT increment usedCount; that only happens
   once an order is actually placed (see orders.js / socialOrders.js). ── */
router.post('/validate', async (req, res) => {
  try {
    const { code, subtotal } = req.body;
    if (!code) return res.status(400).json({ error: 'Coupon code is required.' });
    const sub = Number(subtotal) || 0;

    let coupon;
    if (isFirebaseAvailable()) {
      const cleanCode = String(code).trim().toUpperCase();
      const snap = await getDB().collection('coupons').where('code', '==', cleanCode).limit(1).get();
      coupon = snap.empty ? null : { ...snap.docs[0].data(), id: snap.docs[0].id };
    } else {
      coupon = store.findCoupon(code);
    }

    const result = store.checkCoupon(coupon, sub);
    if (!result.ok) return res.status(400).json({ error: result.error });

    return res.json({
      valid:    true,
      code:     result.coupon.code,
      type:     result.coupon.type,
      value:    result.coupon.value,
      discount: result.discount,
      total:    result.total,
    });
  } catch (err) {
    console.error('Validate coupon error:', err);
    return res.status(500).json({ error: 'Failed to validate coupon.' });
  }
});

module.exports = router;
