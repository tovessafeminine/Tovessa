/* ============================================================
   TOVESSA — Admin Routes (uses shared store for real stats)
   ============================================================ */
const express = require('express');
const fs      = require('fs');
const path    = require('path');
const { getDB }       = require('../utils/firebase');
const { requireAdmin, requireRole } = require('../middleware/auth');
const store = require('../utils/store');

const router = express.Router();

function isFirebaseAvailable() {
  try { return !!getDB(); } catch { return false; }
}

/* ── Serve admin dashboard HTML ── */
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin', 'index.html'));
});

/* ── Strip confidential earnings fields unless the caller is super_admin ──
   Mirrors the dashboard's client-side hiding, but enforced server-side so
   the figures never leave the server for admin/supervisor tokens. ── */
function maskRevenue(payload, role) {
  if (role === 'super_admin' || role === 'ceo') return payload;
  const { totalRevenue, todayRevenue, monthRevenue, todayProfit, ...rest } = payload;
  return rest;
}

/* ── POST /api/admin/fix-clips-category — ONE-TIME migration (super_admin + admin only) ──
   Renames any product with category/subcategory "catchers" to "clips".
   Safe to call more than once — only touches matching products.
   Remove this route once you've confirmed it worked. ── */
router.post('/fix-clips-category', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    if (!isFirebaseAvailable()) {
      return res.status(503).json({ error: 'Firebase not connected on this server.' });
    }
    const db = getDB();
    const snap = await db.collection('products').get();

    const report = [];
    const batch = db.batch();
    let count = 0;

    snap.docs.forEach(doc => {
      const data = doc.data();
      const updates = {};
      if (data.category === 'catchers') updates.category = 'clips';
      if (data.subcategory === 'catchers') updates.subcategory = 'clips';
      if (Object.keys(updates).length > 0) {
        batch.update(doc.ref, updates);
        count++;
        report.push({ id: doc.id, name: data.name || null, updates });
      }
    });

    if (count > 0) await batch.commit();

    return res.json({ message: `Updated ${count} product(s).`, updated: report });
  } catch (err) {
    console.error('fix-clips-category error:', err);
    return res.status(500).json({ error: 'Migration failed: ' + err.message });
  }
});

/* ── GET /api/admin/list-categories — diagnostic (super_admin + admin only) ──
   Lists every product's category/subcategory so you can see the exact
   values stored in Firestore. ── */
router.get('/list-categories', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    if (!isFirebaseAvailable()) {
      return res.status(503).json({ error: 'Firebase not connected on this server.' });
    }
    const db = getDB();
    const snap = await db.collection('products').get();
    const products = snap.docs.map(d => ({
      id: d.id,
      name: d.data().name || null,
      category: d.data().category,
      subcategory: d.data().subcategory || null,
    }));
    return res.json({ total: products.length, products });
  } catch (err) {
    return res.status(500).json({ error: 'Failed: ' + err.message });
  }
});



/* ── GET /api/admin/pinned — Public route to get pinned collections ── */
router.get('/pinned', async (req, res) => {
  try {
    if (store.pinned) return res.json({ pinned: store.pinned });
    
    if (isFirebaseAvailable()) {
      const doc = await getDB().collection('settings').doc('pinned').get();
      if (doc.exists) {
        store.pinned = doc.data().collections || [];
        return res.json({ pinned: store.pinned });
      }
    }

    const pinnedPath = path.join(__dirname, '..', 'data', 'pinned.json');
    if (fs.existsSync(pinnedPath)) {
      const data = JSON.parse(fs.readFileSync(pinnedPath, 'utf8'));
      store.pinned = data;
      return res.json({ pinned: data });
    }
    return res.json({ pinned: [] });
  } catch (err) {
    return res.json({ pinned: [] });
  }
});

/* ── POST /api/admin/pinned — Save pinned collections (admin only) ── */
router.post('/pinned', requireRole('super_admin', 'admin', 'ceo'), async (req, res) => {
  try {
    const { pinned } = req.body;
    if (!Array.isArray(pinned)) return res.status(400).json({ error: 'Expected array of pinned collections' });
    
    store.pinned = pinned;

    if (isFirebaseAvailable()) {
      try {
        await getDB().collection('settings').doc('pinned').set({ collections: pinned });
      } catch (fbErr) {
        console.warn('Firebase pinned update failed:', fbErr.message);
      }
    }
    
    try {
      const pinnedPath = path.join(__dirname, '..', 'data', 'pinned.json');
      if (!fs.existsSync(path.dirname(pinnedPath))) fs.mkdirSync(path.dirname(pinnedPath), { recursive: true });
      fs.writeFileSync(pinnedPath, JSON.stringify(pinned, null, 2));
    } catch (fsErr) {
      console.warn('Could not save pinned to local fs (likely read-only environment):', fsErr.message);
    }
    
    return res.json({ message: 'Pinned collections updated', pinned });
  } catch (err) {
    console.error('Pinned collections update error:', err);
    return res.status(500).json({ error: 'Failed to update pinned collections' });
  }
});

/* ── GET /api/admin/stats — REAL stats from shared store (super_admin + admin only) ── */

router.get('/stats', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const base    = store.stats();
    const orders  = store.orders;
    const sOrders = store.socialOrders;
    const today      = new Date(); today.setHours(0,0,0,0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    /* Website */
    base.todayRevenue = Math.round(orders
      .filter(o => o.status !== 'Cancelled' && new Date(o.createdAt) >= today)
      .reduce((s, o) => s + (o.total || 0), 0));
    base.monthRevenue = Math.round(orders
      .filter(o => o.status !== 'Cancelled' && new Date(o.createdAt) >= monthStart)
      .reduce((s, o) => s + (o.total || 0), 0));
    base.todayProfit = store.dailyStatement().totals.profit;

    /* Social */
    const todaySocialOrders = sOrders.filter(o => o.status !== 'Cancelled' && new Date(o.createdAt) >= today);
    base.todaySocialRevenue  = Math.round(todaySocialOrders.reduce((s, o) => s + (o.total || 0), 0));
    base.monthSocialRevenue  = Math.round(sOrders
      .filter(o => o.status !== 'Cancelled' && new Date(o.createdAt) >= monthStart)
      .reduce((s, o) => s + (o.total || 0), 0));
    base.todaySocialProfit   = Math.round(todaySocialOrders.reduce((s, o) => {
      const orderDiscount = (o.discount || 0) + (o.customDiscount?.amount || 0);
      const itemProfit = (o.items || []).reduce((sum, i) => sum + ((i.price - (i.purchasePrice || 0)) * (i.qty || 1)), 0);
      return s + Math.max(0, itemProfit - orderDiscount);
    }, 0));
    base.totalSocialProfit   = Math.round(sOrders.filter(o => o.status !== 'Cancelled').reduce((s, o) => {
      const orderDiscount = (o.discount || 0) + (o.customDiscount?.amount || 0);
      const itemProfit = (o.items || []).reduce((sum, i) => sum + ((i.price - (i.purchasePrice || 0)) * (i.qty || 1)), 0);
      return s + Math.max(0, itemProfit - orderDiscount);
    }, 0));

    /* Combined */
    base.todayCombinedRevenue = base.todayRevenue + base.todaySocialRevenue;
    base.monthCombinedRevenue = base.monthRevenue + base.monthSocialRevenue;
    base.combinedRevenue      = base.totalRevenue + base.socialRevenue;
    base.todayCombinedProfit  = base.todayProfit  + base.todaySocialProfit;
    base.totalCombinedProfit  = (store.lifetimeEarnings().totals.profit || 0);
    base.todayCombinedProfit  = store.dailyStatement().totals.profit || 0;
    base.todayProfit = base.todayCombinedProfit - base.todaySocialProfit;
    base.totalProfit = base.totalCombinedProfit - base.totalSocialProfit;

    /* Invoices Breakdown */
    base.totalInvoices = store.invoices.length;
    base.webInvoicesCount = store.invoices.filter(i => orders.some(o => o.id === i.orderId)).length;
    base.socInvoicesCount = store.invoices.filter(i => sOrders.some(o => o.id === i.orderId)).length;

    /* COD Breakdown */
    const webCods = orders.filter(o => o.status !== 'Cancelled' && o.paymentMethod === 'cod');
    const socCods = sOrders.filter(o => o.status !== 'Cancelled' && o.paymentMethod === 'cod');

    base.webCodOrders = webCods.length;
    base.socCodOrders = socCods.length;
    base.totalCodOrders = base.webCodOrders + base.socCodOrders;

    base.webAdvanceReceived = webCods.reduce((sum, o) => sum + (Number(o.advanceAmount) || 0), 0);
    base.socAdvanceReceived = socCods.reduce((sum, o) => sum + (Number(o.advanceAmount) || 0), 0);
    base.totalAdvanceReceived = base.webAdvanceReceived + base.socAdvanceReceived;

    base.webOutstandingCod = webCods.reduce((sum, o) => sum + Math.max(0, (o.total || 0) - (Number(o.advanceAmount) || 0)), 0);
    base.socOutstandingCod = socCods.reduce((sum, o) => sum + Math.max(0, (o.total || 0) - (Number(o.advanceAmount) || 0)), 0);
    base.outstandingCodBalance = base.webOutstandingCod + base.socOutstandingCod;
    base.totalSpendings = store.spendings.reduce((s, x) => s + (Number(x.amount) || 0), 0);

    /* Add extra badge counts */
    if (isFirebaseAvailable()) {
      const db = getDB();
      try {
        const [reviewsSnap, resellersSnap, abandonedSnap, msgsSnap, prodsSnap, subsSnap, usersSnap] = await Promise.all([
          db.collection('reviews').where('approved', '==', false).count().get(),
          db.collection('resellers').where('read', '==', false).count().get(),
          db.collection('abandoned').where('status', '==', 'abandoned').count().get(),
          db.collection('contact_messages').where('read', '==', false).count().get(),
          db.collection('products').count().get(),
          db.collection('subscribers').count().get(),
          db.collection('users').count().get()
        ]);
        base.pendingReviews = reviewsSnap.data().count;
        base.unreadResellers = resellersSnap.data().count;
        base.abandonedCheckouts = abandonedSnap.data().count;
        base.unreadMessages = msgsSnap.data().count;
        base.products = { total: prodsSnap.data().count };
        base.subscribers = { total: subsSnap.data().count };
        base.users = { total: usersSnap.data().count };
      } catch (err) {
        console.error('Failed to fetch extra counts for stats:', err);
      }
    }

    return res.json(maskRevenue({ ...base, demoMode: false }, req.user?.role));

  } catch (err) {
    console.error('Stats error:', err);
    return res.json(maskRevenue({ ...store.stats(), demoMode: true }, req.user?.role));
  }
});

/*  GET /api/admin/inventory - Inventory status (super_admin + admin only)  */
router.get('/inventory', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const inventory = store.calculateInventory();
    return res.json(inventory);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch inventory.' });
  }
});

/* ── GET /api/admin/recent-orders (super_admin + admin only — supervisor uses /api/orders) ── */
router.get('/recent-orders', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    
    const orders = store.orders.slice(0, limit);
    const socials = store.socialOrders.slice(0, limit).map(o => ({ ...o, isSocial: true }));
    let combined = [...orders, ...socials];

    combined.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const recent = combined.slice(0, limit);
    return res.json({ orders: recent.map(o => maskRevenue(o, req.user?.role)) });
  } catch (err) {
    console.error('Recent orders error:', err);
    return res.status(500).json({ error: 'Failed to fetch recent orders' });
  }
});


/* ── GET /api/admin/export/:type — Export data (super_admin ONLY — admin & supervisor blocked) ── */
router.get('/export/:type', requireRole('ceo', 'super_admin'), async (req, res) => {
  try {
    const { type } = req.params;
    let data = [];
    let filename = '';

    if (type === 'orders') {
      data = isFirebaseAvailable()
        ? (await getDB().collection('orders').orderBy('createdAt', 'desc').get()).docs.map(d => d.data())
        : store.orders;
      filename = 'tovessa-orders.json';
    } else if (type === 'subscribers') {
      data = isFirebaseAvailable()
        ? (await getDB().collection('subscribers').orderBy('subscribedAt', 'desc').get()).docs.map(d => d.data())
        : store.subscribers;
      filename = 'tovessa-subscribers.json';
    } else if (type === 'messages') {
      data = isFirebaseAvailable()
        ? (await getDB().collection('messages').orderBy('createdAt', 'desc').get()).docs.map(d => d.data())
        : store.messages;
      filename = 'tovessa-messages.json';
    } else {
      return res.status(400).json({ error: 'Invalid export type.' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Export failed.' });
  }
});

/* ── GET /api/admin/activity-logs — All staff activity (super_admin only) ── */
router.get('/activity-logs', requireRole('ceo', 'super_admin'), async (req, res) => {
  try {
    const { staffId, limit: lim } = req.query;
    let logs = store.activityLogs;
    if (req.user.role === 'super_admin') {
      logs = logs.filter(l => l.role !== 'ceo');
    }
    if (staffId) logs = logs.filter(l => l.staffId === staffId);
    if (lim) logs = logs.slice(0, parseInt(lim));
    return res.json({ logs, total: logs.length });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch activity logs.' });
  }
});

/* ── GET /api/admin/staff-summary — Per-staff performance (super_admin only) ── */
router.get('/staff-summary', requireRole('ceo', 'super_admin'), (req, res) => {
  try {
    return res.json({ staff: store.staffSummary() });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch staff summary.' });
  }
});

/* ── GET /api/admin/profit-summary — Lifetime profit/earnings (super_admin ONLY) ──
   Lifetime view never gets reset/filtered by date — it's the full history of
   every sale ever recorded in this server's lifetime. ── */
router.get('/profit-summary', requireRole('ceo', 'super_admin'), async (req, res) => {
  try {
    return res.json(store.lifetimeEarnings());
  } catch (err) {
    console.error('Profit summary error:', err);
    return res.status(500).json({ error: 'Failed to compute profit summary.' });
  }
});

/* ── GET /api/admin/daily-statement?date=YYYY-MM-DD — One day's statement (super_admin ONLY) ──
   Defaults to today (server local date) when no date is given. ── */
router.get('/daily-statement', requireRole('ceo', 'super_admin'), async (req, res) => {
  try {
    return res.json(store.dailyStatement(req.query.date));
  } catch (err) {
    console.error('Daily statement error:', err);
    return res.status(500).json({ error: 'Failed to compute daily statement.' });
  }
});

/* ── GET /api/admin/daily-statements/history?days=30 — Last N days of statements (super_admin ONLY) ──
   Capped at 30 days — older days should be pulled from previously
   downloaded Excel files (lifetime totals remain in /profit-summary). ── */
router.get('/daily-statements/history', requireRole('ceo', 'super_admin'), async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 30, 30);
    return res.json({ statements: store.dailyStatementHistory(days) });
  } catch (err) {
    console.error('Statement history error:', err);
    return res.status(500).json({ error: 'Failed to compute statement history.' });
  }
});

/* ── GET /api/admin/monthly-statements — Month-by-month statements since launch (super_admin ONLY) ──
   Unlike the 30-day daily history, this always starts from siteLaunchDate,
   however long ago that was — it is never capped.
   Optional ?month=YYYY-MM to fetch a SINGLE month's detailed statement. ── */
router.get('/monthly-statements', requireRole('ceo', 'super_admin'), async (req, res) => {
  try {
    /* Single-month detailed view (for per-month export) */
    if (req.query.month) {
      const stmt = store.monthlyStatement(req.query.month);
      return res.json({ statements: [stmt], since: store.siteLaunchDate, single: true });
    }
    return res.json({ statements: store.monthlyStatementHistory(), since: store.siteLaunchDate });
  } catch (err) {
    console.error('Monthly statements error:', err);
    return res.status(500).json({ error: 'Failed to compute monthly statements.' });
  }
});

/* ── GET /api/admin/daily-statements?month=YYYY-MM — All days of a specific month ── */
router.get('/daily-statements', requireRole('ceo', 'super_admin'), async (req, res) => {
  try {
    const { month } = req.query;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month param required (YYYY-MM).' });
    }
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const statements = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      statements.push(store.dailyStatement(dateStr));
    }
    return res.json({ statements, month });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to compute monthly daily breakdown.' });
  }
});

/* ── GET /api/admin/site-launch-date — Read the configured launch date (super_admin ONLY) ── */
router.get('/site-launch-date', requireRole('ceo', 'super_admin'), (req, res) => {
  return res.json({ siteLaunchDate: store.siteLaunchDate });
});

/* ── PUT /api/admin/site-launch-date — Set/correct the launch date (super_admin ONLY) ──
   All daily/monthly/lifetime statements key off this date, so super_admin
   can set it once to match the real go-live day of the store. ── */
router.put('/site-launch-date', requireRole('ceo', 'super_admin'), async (req, res) => {
  try {
    const { date } = req.body;
    if (!date) return res.status(400).json({ error: 'A date is required.' });
    const saved = store.setSiteLaunchDate(date);
    /* Persist to Firestore so it survives server restarts */
    if (isFirebaseAvailable()) {
      try {
        await getDB().collection('settings').doc('global').set({ siteLaunchDate: saved }, { merge: true });
      } catch (e) { console.warn('Could not persist launch date to Firestore:', e.message); }
    }
    store.logActivity({
      staffId: req.user.uid, staffName: req.user.email || 'Unknown',
      staffRole: req.user.role, action: 'launch_date_updated', details: { date: saved }
    });
    return res.json({ message: 'Site launch date updated.', siteLaunchDate: saved });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Invalid date.' });
  }
});

router.get('/debug-product', async (req, res) => {
  const { getDB } = require('../utils/firebase');
  const db = getDB();
  if (!db) return res.json({ error: 'Firebase is not initialized' });
  try {
    const snap = await db.collection('products').where('name', '==', 'Colorful Seamless Mini Hair Elastics - 50 Ponies').get();
    const prods = snap.docs.map(d => d.data());
    return res.json({ success: true, count: prods.length, prods: prods });
  } catch (err) {
    return res.json({ success: false, error: err.message });
  }
});

module.exports = router;



