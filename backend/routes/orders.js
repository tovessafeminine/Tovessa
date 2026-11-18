/* ============================================================
   GOLNISÀ — Orders Routes (uses shared store)
   ============================================================ */
const express   = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB }       = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const store            = require('../utils/store');
const { sendOrderConfirmation, sendNewOrderNotification } = require('../utils/email');

const router = express.Router();
const STATUSES = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];

function isFirebaseAvailable() {
  try { return !!getDB(); } catch { return false; }
}

/* ── POST /api/orders — Place order ── */
router.post('/', async (req, res) => {
  try {
    const { items, delivery, paymentMethod, deliveryMethod, couponCode } = req.body;

    if (!items?.length || !delivery?.fname || !delivery?.email) {
      return res.status(400).json({ error: 'Order data is incomplete.' });
    }

    /* ── Snapshot productId + purchasePrice onto each line item ──
       The storefront cart only sends {name, price, emoji, variant, qty} —
       no product id — so we match by name against the live catalogue at
       checkout time and freeze the purchase price as it was then. This way
       later edits to a product's purchase price never change profit on
       past orders, and the daily/lifetime profit reports stay accurate. */
    const productSource = isFirebaseAvailable() ? null : store.products;
    let firestoreProducts = null;
    if (isFirebaseAvailable()) {
      const snap = await getDB().collection('products').get();
      firestoreProducts = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    }
    const catalogue = firestoreProducts || productSource || [];
    const enrichedItems = items.map(i => {
      const match = catalogue.find(p => p.name === i.name);
      return {
        ...i,
        productId:     match?.id ?? i.productId ?? null,
        purchasePrice: match?.purchasePrice ?? i.purchasePrice ?? 0,
      };
    });

    const subtotal   = enrichedItems.reduce((s, i) => s + (i.price * i.qty), 0);
    const payMethod  = paymentMethod || 'cod';
    /* ── Delivery fee rules ──
       Bank Deposit → PKR 250, waived once subtotal reaches PKR 1,000.
       COD          → PKR 250, waived once subtotal reaches PKR 5,000. */
    const deliveryFee = payMethod === 'bank_deposit'
      ? (subtotal >= 1000 ? 0 : 250)
      : (subtotal >= 5000 ? 0 : 250);

    /* ── Coupon (optional) ──
       Re-validate server-side even though the checkout page already
       called /api/coupons/validate — never trust a discount number sent
       from the browser. Discount is applied to the subtotal only, the
       delivery fee is unaffected. */
    let discount   = 0;
    let couponMeta = null;
    if (couponCode) {
      let couponDoc;
      if (isFirebaseAvailable()) {
        const cleanCode = String(couponCode).trim().toUpperCase();
        const snap = await getDB().collection('coupons').where('code', '==', cleanCode).limit(1).get();
        couponDoc = snap.empty ? null : { ...snap.docs[0].data(), id: snap.docs[0].id };
      } else {
        couponDoc = store.findCoupon(couponCode);
      }
      const check = store.checkCoupon(couponDoc, subtotal);
      if (!check.ok) return res.status(400).json({ error: check.error });
      discount   = check.discount;
      couponMeta = { code: check.coupon.code, type: check.coupon.type, value: check.coupon.value, discount };
    }

    const total       = Math.max(0, subtotal - discount) + deliveryFee;
    const orderRef    = 'ZH-' + uuidv4().replace(/-/g, '').toUpperCase().slice(0, 8);

    const order = {
      id: orderRef,
      items: enrichedItems,
      delivery,
      paymentMethod:  payMethod,
      deliveryMethod: deliveryMethod || 'standard',
      subtotal,
      discount,
      coupon: couponMeta,
      deliveryFee,
      total,
      status:    'Pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseAvailable()) {
      try { await getDB().collection('orders').doc(orderRef).set(order); }
      catch(e) { console.error('Failed to save order to Firebase:', e); }
    }
    store.orders.unshift(order);

    /* Record coupon usage only after the order is safely saved */
    if (couponMeta) {
      await store.recordCouponUse(couponMeta.code, isFirebaseAvailable, getDB).catch(e => console.error('recordCouponUse failed:', e.message));
    }

    /* Emit SSE notification to admin */
    store.emit('new_order', {
      id: orderRef,
      customer: `${delivery.fname} ${delivery.lname}`,
      total,
      paymentMethod: order.paymentMethod,
    });

    /* Send emails (non-blocking) */
    sendOrderConfirmation({ to: delivery.email, orderRef, items, delivery, total, paymentMethod: order.paymentMethod })
      .catch(e => console.error('Customer email failed:', e.message));
    sendNewOrderNotification({ orderRef, items, delivery, total, paymentMethod: order.paymentMethod })
      .catch(e => console.error('Owner email failed:', e.message));

    return res.status(201).json({ message: 'Order placed successfully! 🎉', orderRef, order });
  } catch (err) {
    console.error('Place order error:', err);
    return res.status(500).json({ error: 'Failed to place order. Please try again.' });
  }
});

/* ── POST /api/orders/from-abandoned — Convert abandoned checkout to real order (admin) ── */
router.post('/from-abandoned', requireAdmin, async (req, res) => {
  try {
    const { abandonedId } = req.body;
    if (!abandonedId) return res.status(400).json({ error: 'abandonedId is required.' });

    /* Fetch the abandoned record */
    let abandoned = null;
    if (isFirebaseAvailable()) {
      /* Try fetching by Firestore doc ID first */
      const doc = await getDB().collection('abandoned').doc(abandonedId).get();
      if (doc.exists) {
        abandoned = { id: doc.id, ...doc.data() };
      } else {
        /* Fallback: query by 'id' field in case doc ID differs */
        const snap = await getDB().collection('abandoned').where('id', '==', abandonedId).limit(1).get();
        if (!snap.empty) {
          const d = snap.docs[0];
          abandoned = { id: d.id, ...d.data() };
        }
      }
      /* Also check in-memory store as last resort */
      if (!abandoned) {
        abandoned = store.abandoned.find(a => a.id === abandonedId) || null;
      }
      if (!abandoned) return res.status(404).json({ error: 'Abandoned record not found.' });
    } else {
      abandoned = store.abandoned.find(a => a.id === abandonedId);
      if (!abandoned) return res.status(404).json({ error: 'Abandoned record not found.' });
    }

    if (abandoned.status === 'converted') {
      return res.status(409).json({ error: 'This checkout was already converted to an order.' });
    }

    const delivery = abandoned.delivery || {};
    const items    = abandoned.items    || [];

    if (!items.length || !delivery.fname || !delivery.email) {
      return res.status(400).json({ error: 'Abandoned record is missing delivery or items data.' });
    }

    /* Enrich items with purchasePrice from catalogue */
    const catalogue = isFirebaseAvailable()
      ? (await getDB().collection('products').get()).docs.map(d => ({ ...d.data(), id: d.id }))
      : (store.products || []);

    const enrichedItems = items.map(i => {
      const match = catalogue.find(p => p.name === i.name);
      return {
        ...i,
        productId:     match?.id ?? i.productId ?? null,
        purchasePrice: match?.purchasePrice ?? i.purchasePrice ?? 0,
      };
    });

    const subtotal   = enrichedItems.reduce((s, i) => s + (i.price * i.qty), 0);
    const payMethod  = delivery.paymentMethod || 'cod';
    const deliveryFee = payMethod === 'bank_deposit' ? (subtotal >= 1000 ? 0 : 250) : (subtotal >= 5000 ? 0 : 250);
    const total      = subtotal + deliveryFee;
    const orderRef    = 'ZH-' + uuidv4().replace(/-/g, '').toUpperCase().slice(0, 8);

    const order = {
      id:             orderRef,
      items:          enrichedItems,
      delivery,
      paymentMethod:  payMethod,
      deliveryMethod: delivery.delivery || 'standard',
      subtotal,
      deliveryFee,
      total,
      status:         'Pending',
      source:         'manual_recovery',   /* marks it as admin-recovered */
      abandonedId,                          /* link back to original abandoned record */
      createdAt:      new Date().toISOString(),
      updatedAt:      new Date().toISOString(),
    };

    if (isFirebaseAvailable()) {
      await getDB().collection('orders').doc(orderRef).set(order);
    } else {
      store.orders.unshift(order);
    }

    store.logActivity({
      staffId:   req.user.id || req.user.uid,
      staffName: req.user.fname + (req.user.lname ? ' ' + req.user.lname : ''),
      action:    'Recovered Abandoned Order',
      details:   `${orderRef} for ${delivery.fname}`,
      role:      req.user.role
    });

    /* Emit SSE so admin panel updates live */
    store.emit('new_order', {
      id:            orderRef,
      customer:      `${delivery.fname} ${delivery.lname}`,
      total,
      paymentMethod: payMethod,
      source:        'manual_recovery',
    });

    return res.status(201).json({ message: 'Order created from abandoned checkout.', orderRef, order });
  } catch (err) {
    console.error('from-abandoned error:', err);
    return res.status(500).json({ error: 'Failed to convert abandoned checkout to order.' });
  }
});

/* ── GET /api/orders (admin) ── */
router.get('/', requireAdmin, async (req, res) => {
  try {
    const { status, limit: lim } = req.query;
    if (isFirebaseAvailable()) {
      try {
        const db = getDB();
        let q = db.collection('orders').orderBy('createdAt', 'desc');
        if (status) q = q.where('status', '==', status);
        if (lim) q = q.limit(parseInt(lim));
        const snap = await q.get();
        const orders = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        return res.json({ orders, total: orders.length });
      } catch (fbErr) {
        console.error('Firebase GET orders failed, falling back to memory:', fbErr.message);
      }
    }
    let orders = [...store.orders];
    if (status) orders = orders.filter(o => o.status === status);
    if (lim) orders = orders.slice(0, parseInt(lim));
    return res.json({ orders, total: orders.length });
  } catch (err) {
    console.error('Get orders error:', err);
    return res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

/* ── GET /api/orders/user/:email — Orders by customer ── */
router.get('/user/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    if (isFirebaseAvailable()) {
      /* Note: no orderBy here to avoid requiring a composite index in Firebase */
      const snap = await getDB().collection('orders')
        .where('delivery.email', '==', email)
        .get();
      const orders = snap.docs
        .map(d => ({ ...d.data(), id: d.id }))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return res.json({ orders });
    }
    const orders = store.orders
      .filter(o => o.delivery?.email?.toLowerCase() === email)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ orders, total: orders.length });
  } catch (err) {
    console.error('Get user orders error:', err);
    return res.status(500).json({ error: 'Failed to fetch orders.' });
  }
});

/* ── GET /api/orders/track/:ref — Public order tracking ── */
router.get('/track/:ref', async (req, res) => {
  try {
    const ref = req.params.ref.toUpperCase();
    if (isFirebaseAvailable()) {
      const doc = await getDB().collection('orders').doc(ref).get();
      if (!doc.exists) return res.status(404).json({ error: 'Order not found.' });
      const o = doc.data();
      return res.json({ order: { id: doc.id, status: o.status, createdAt: o.createdAt, updatedAt: o.updatedAt, items: o.items, total: o.total, deliveryMethod: o.deliveryMethod } });
    }
    const order = store.findOrder(ref);
    if (!order) return res.status(404).json({ error: 'Order not found. Check your order reference.' });
    return res.json({ order: { id: order.id, status: order.status, createdAt: order.createdAt, updatedAt: order.updatedAt, items: order.items, total: order.total, deliveryMethod: order.deliveryMethod } });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to track order.' });
  }
});

/* ── GET /api/orders/:id — Single order ── */
router.get('/:id', async (req, res) => {
  try {
    if (isFirebaseAvailable()) {
      const doc = await getDB().collection('orders').doc(req.params.id).get();
      if (!doc.exists) return res.status(404).json({ error: 'Order not found.' });
      return res.json({ order: { ...doc.data(), id: doc.id } });
    }
    const order = store.findOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    return res.json({ order });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch order.' });
  }
});

/* ── PATCH /api/orders/:id/status (admin) ── */
router.patch('/:id/status', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: `Status must be one of: ${STATUSES.join(', ')}` });

    if (isFirebaseAvailable()) {
      const db = getDB();
      const ref = db.collection('orders').doc(req.params.id);
      if (!(await ref.get()).exists) return res.status(404).json({ error: 'Order not found.' });
      await ref.update({ status, updatedAt: new Date().toISOString() });
    }
    const idx = store.orders.findIndex(o => o.id === req.params.id);
    if (idx !== -1) {
      store.orders[idx].status    = status;
      store.orders[idx].updatedAt = new Date().toISOString();
    } else if (!isFirebaseAvailable()) return res.status(404).json({ error: 'Order not found.' });

    /* ── Log activity for ALL staff (including super admins tracking each other) ── */
    store.logActivity({
      staffId:   req.user.id || req.user.uid,
      staffName: req.user.fname + (req.user.lname ? ' ' + req.user.lname : ''),
      action:    'Updated Order Status',
      details:   `${req.params.id} -> ${status}`,
      role:      req.user.role
    });

    store.emit('order_status_changed', { id: req.params.id, status });
    return res.json({ message: `Order updated to "${status}".`, status });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update order.' });
  }
});

/* ── PATCH /api/orders/:id/advance (admin) ── */
router.patch('/:id/advance', requireAdmin, async (req, res) => {
  try {
    const { advanceStatus, advanceAmount, advanceDate, advanceMethod, advanceRef } = req.body;

    if (isFirebaseAvailable()) {
      const db = getDB();
      const ref = db.collection('orders').doc(req.params.id);
      if (!(await ref.get()).exists) return res.status(404).json({ error: 'Order not found.' });
      await ref.update({
        advanceStatus: advanceStatus || 'Pending',
        advanceAmount: Number(advanceAmount) || 0,
        advanceDate: advanceDate || '',
        advanceMethod: advanceMethod || '',
        advanceRef: advanceRef || '',
        updatedAt: new Date().toISOString()
      });
    }
    const idx = store.orders.findIndex(o => o.id === req.params.id);
    if (idx !== -1) {
      store.orders[idx].advanceStatus = advanceStatus || 'Pending';
      store.orders[idx].advanceAmount = Number(advanceAmount) || 0;
      store.orders[idx].advanceDate = advanceDate || '';
      store.orders[idx].advanceMethod = advanceMethod || '';
      store.orders[idx].advanceRef = advanceRef || '';
      store.orders[idx].updatedAt = new Date().toISOString();
    } else if (!isFirebaseAvailable()) return res.status(404).json({ error: 'Order not found.' });

    store.logActivity({
      staffId:   req.user.id || req.user.uid,
      staffName: req.user.fname + (req.user.lname ? ' ' + req.user.lname : ''),
      action:    'Updated Advance Payment',
      details:   `${req.params.id} -> ${advanceAmount} (${advanceStatus})`,
      role:      req.user.role
    });

    store.emit('order_advance_changed', { id: req.params.id });
    return res.json({ message: `Advance payment updated for order ${req.params.id}.` });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update advance payment.' });
  }
});

/* ── DELETE /api/orders/:id (super_admin only) ── */
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    if (isFirebaseAvailable()) {
      const ref = getDB().collection('orders').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Order not found.' });
      await ref.delete();
    }
    const idx = store.orders.findIndex(o => o.id === id);
    if (idx !== -1) store.orders.splice(idx, 1);
    else if (!isFirebaseAvailable()) return res.status(404).json({ error: 'Order not found.' });
    store.logActivity({
      staffId:   req.user.id || req.user.uid,
      staffName: req.user.fname + (req.user.lname ? ' ' + req.user.lname : ''),
      action:    'Deleted Web Order',
      details:   id,
      role:      req.user.role
    });
    return res.json({ message: `Order ${id} deleted.` });
  } catch (err) {
    console.error('Delete order error:', err);
    return res.status(500).json({ error: 'Failed to delete order.' });
  }
});

module.exports = router;
