/* ============================================================
   TOVESSA â€” Express Backend Server v2
   ============================================================ */
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const { initFirebase, getDB } = require('./utils/firebase');

const store            = require('./utils/store');

/* â”€â”€ Route modules â”€â”€ */
const authRoutes         = require('./routes/auth');
const productRoutes      = require('./routes/products');
const orderRoutes        = require('./routes/orders');
const contactRoutes      = require('./routes/contact');
const newsletterRoutes   = require('./routes/newsletter');
const adminRoutes        = require('./routes/admin');
const paymentsRoutes     = require('./routes/payments');
const uploadRoutes       = require('./routes/upload');
const reviewRoutes       = require('./routes/reviews');
const socialOrderRoutes  = require('./routes/socialOrders');
const couponRoutes       = require('./routes/coupons');
const settingsRoutes     = require('./routes/settings');
const invoiceRoutes      = require('./routes/invoices');
const spendingsRoutes    = require('./routes/spendings');

const app  = express();
const PORT = process.env.PORT || 3002;

/* â”€â”€ CORS â”€â”€ */
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3002',
    'http://127.0.0.1:3002',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'https://tovessa.com',
    'https://www.tovessa.com',
    'null',   /* file:// protocol */
  ],
  credentials: true,
}));

/* â”€â”€ Body parsers (exclude Stripe webhook which needs raw body) â”€â”€ */
app.use('/api/payments/stripe-webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/* â”€â”€ Security headers â”€â”€ */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

/* â”€â”€ Simple API rate limiter (no extra package needed) â”€â”€ */
app.set('trust proxy', 1);
const rateLimitStore = new Map();
app.use('/api/', (req, res, next) => {
  const ip  = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60 * 1000;  /* 1 minute */
  const maxReqs  = 1000;         /* per minute */
  const entry    = rateLimitStore.get(ip) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateLimitStore.set(ip, entry);
  if (entry.count > maxReqs) return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  next();
});

/* â”€â”€ Firebase init â”€â”€ */
initFirebase();



/* â”€â”€ Serve static frontend (clean URLs â€” .html extension hidden) â”€â”€
   extensions: ['html'] lets express.static resolve /shop -> shop.html
   on the server side, but the file is still also reachable as /shop.html
   directly. To make the BROWSER bar show /shop (not /shop.html), the
   internal <a href> links in the HTML files must point to the extension-
   less path too â€” see the .html link rewrite below. â”€â”€ */
/* â”€â”€ GET /robots.txt â€” Serve with no-cache headers â”€â”€ */
app.get('/robots.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(`User-agent: *
Allow: /sitemap.xml
Allow: /
Disallow: /admin/
Disallow: /api/
Disallow: /backend/
Disallow: /checkout
Disallow: /account

Sitemap: https://tovessa.com/sitemap.xml`);
});

/* â”€â”€ GET /sitemap.xml â€” Dynamic sitemap including all live products â”€â”€ */
app.get('/sitemap.xml', async (req, res) => {
  const { getDB } = require('./utils/firebase');
  const today = new Date().toISOString().slice(0, 10);

  const DOMAIN = 'https://tovessa.com';
  const staticUrls = [
    { loc: `${DOMAIN}/`,                  priority: '1.0', changefreq: 'weekly'  },
    { loc: `${DOMAIN}/shop`,              priority: '0.9', changefreq: 'daily'   },
    { loc: `${DOMAIN}/jewelry`,           priority: '0.9', changefreq: 'daily'   },
    { loc: `${DOMAIN}/hair-accessories`,  priority: '0.9', changefreq: 'daily'   },
    { loc: `${DOMAIN}/clothing`,          priority: '0.9', changefreq: 'daily'   },
    { loc: `${DOMAIN}/about`,             priority: '0.7', changefreq: 'monthly' },
    { loc: `${DOMAIN}/contact`,           priority: '0.6', changefreq: 'monthly' },
    { loc: `${DOMAIN}/policy`,            priority: '0.5', changefreq: 'monthly' },
    { loc: `${DOMAIN}/reseller`,          priority: '0.6', changefreq: 'monthly' },
  ];

  const categories = [
    // Hair accessories
    'scrunchies','clips','hair-bands','pins','ponies','fancy','gift-items',
    // Jewelry
    'bracelets','rings','earrings','necklace',
    // Clothing
    'winter-collection','daily-pret','unstitched','g-prints','new-arrivals','trending-now',
    // Shop
    'sale'
  ];
  const catUrls = categories.map(c => ({
    loc: `${DOMAIN}/shop?cat=${c}`, priority: '0.8', changefreq: 'weekly'
  }));

  /* Fetch live products from Firestore */
  let productUrls = [];
  try {
    let db;
    try { db = getDB(); } catch(_) {}
    if (db) {
      const snap = await db.collection('products').get();
      productUrls = snap.docs.map(d => {
        const data = d.data();
        const name = data.name || '';
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const id   = slug || d.id;
        return {
          loc: `${DOMAIN}/product?id=${encodeURIComponent(d.id)}&name=${encodeURIComponent(slug)}`,
          priority: '0.7',
          changefreq: 'weekly',
          lastmod: data.createdAt ? new Date(data.createdAt).toISOString().slice(0,10) : today
        };
      }).filter(u => u.loc.includes('id=') && u.loc.length > 50);
    }
  } catch(e) { console.warn('Sitemap: could not fetch products', e.message); }

  const allUrls = [...staticUrls, ...catUrls, ...productUrls];

  const urlTags = allUrls.map(u => `  <url>
    <loc>${u.loc.replace(/&/g, '&amp;')}</loc>
    <lastmod>${u.lastmod || today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlTags}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(xml);
});



app.use(express.static(path.join(__dirname, '..'), { 
  extensions: ['html'],
  setHeaders: (res, path, stat) => {
    if (path.endsWith('.html') || path.endsWith('.css') || path.endsWith('.js')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

/* â”€â”€ SSE Notifications endpoint (/api/notifications/stream) â”€â”€ */
app.get('/api/notifications/stream', (req, res) => {
  /* Verify admin token from query param (SSE doesn't support custom headers) */
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'Token required.' });

  try {
    const jwt     = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "tovessa_secret_jwt_key_2024_fallback");
    if (!decoded.isAdmin) return res.status(403).end();
  } catch {
    return res.status(401).end();
  }

  /* Set SSE headers */
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  /* Send initial connected event */
  res.write(`data: ${JSON.stringify({ event: 'connected', time: new Date().toISOString() })}\n\n`);

  /* Subscribe to store events */
  const unsub = store.subscribe(payload => {
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (_) {}
  });

  /* Heartbeat every 25s to keep connection alive */
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat\n\n`); } catch (_) { clearInterval(heartbeat); }
  }, 25000);

  /* Cleanup on disconnect */
  req.on('close', () => {
    unsub();
    clearInterval(heartbeat);
  });
});

/* â”€â”€ API Routes â”€â”€ */
app.use('/api/auth',          authRoutes);
app.use('/api/products',      productRoutes);
app.use('/api/orders',        orderRoutes);
app.use('/api/social-orders', socialOrderRoutes);
app.use('/api/coupons',       couponRoutes);
app.use('/api/contact',       contactRoutes);
app.use('/api/newsletter',    newsletterRoutes);
app.use('/api/payments',      paymentsRoutes);
app.use('/api/upload',        uploadRoutes);
app.use('/api/reviews',       reviewRoutes);
app.use('/api/settings',      settingsRoutes);
app.use('/api/invoices',      invoiceRoutes);
app.use('/api/spendings',     spendingsRoutes);

/* â”€â”€ Abandoned Checkout Tracking â”€â”€
   Persisted to Firestore (collection: "abandoned") when Firebase is
   configured, so records survive server restarts/cold-starts (Render
   free tier resets in-memory data). Falls back to the in-memory store
   only in demo mode (no Firebase credentials configured). â”€â”€ */
function isAbandonedFirebaseAvailable() {
  try { return !!getDB(); } catch { return false; }
}

/* POST /api/abandoned â€” save/update abandoned checkout (public, called from checkout.js) */
app.post('/api/abandoned', async (req, res) => {
  try {
    const { id, delivery, items, total } = req.body || {};
    if (!delivery || !items) return res.status(400).json({ error: 'delivery and items required' });

    if (isAbandonedFirebaseAvailable()) {
      const db = getDB();

      /* If id sent, update existing record */
      if (id) {
        const ref = db.collection('abandoned').doc(id);
        const doc = await ref.get();
        if (doc.exists && doc.data().status !== 'converted') {
          await ref.update({ delivery, items, total: total || 0, updatedAt: new Date().toISOString() });
          /* Keep in-memory in sync */
          const mem = store.abandoned.find(a => a.id === id);
          if (mem) { mem.delivery = delivery; mem.items = items; mem.total = total || 0; }
          return res.json({ id });
        }
      }

      /* Create new */
      const newId = 'ab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      const record = {
        id:        newId,
        delivery,
        items:     items || [],
        total:     total || 0,
        status:    'abandoned',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await db.collection('abandoned').doc(newId).set(record);
      /* Also keep in memory for this session */
      store.abandoned.unshift(record);
      try { store.emit('new_abandoned', record); } catch {}
      console.log('âœ… Abandoned saved to Firebase:', newId);
      return res.status(201).json({ id: newId });
    }

    /* â”€â”€ No Firebase â€” persist to JSON file so restarts don't wipe data â”€â”€ */
    const fs   = require('fs');
    const path = require('path');
    const AB_FILE = path.join(__dirname, 'data', 'abandoned.json');

    /* Load existing from file */
    let fileData = [];
    try {
      if (fs.existsSync(AB_FILE)) fileData = JSON.parse(fs.readFileSync(AB_FILE, 'utf8'));
    } catch { fileData = []; }

    if (id) {
      const existing = fileData.find(a => a.id === id) || store.abandoned.find(a => a.id === id);
      if (existing && existing.status !== 'converted') {
        existing.delivery = delivery;
        existing.items    = items;
        existing.total    = total || 0;
        existing.updatedAt = new Date().toISOString();
        /* Sync to file */
        const idx = fileData.findIndex(a => a.id === id);
        if (idx !== -1) fileData[idx] = existing; else fileData.unshift(existing);
        try { fs.mkdirSync(path.dirname(AB_FILE), { recursive: true }); fs.writeFileSync(AB_FILE, JSON.stringify(fileData)); } catch {}
        return res.json({ id: existing.id });
      }
    }

    const record = {
      id:        'ab-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      delivery,
      items:     items || [],
      total:     total || 0,
      status:    'abandoned',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.abandoned.unshift(record);
    fileData.unshift(record);
    if (store.abandoned.length > 500) store.abandoned = store.abandoned.slice(0, 500);
    if (fileData.length > 500) fileData = fileData.slice(0, 500);
    try { fs.mkdirSync(path.dirname(AB_FILE), { recursive: true }); fs.writeFileSync(AB_FILE, JSON.stringify(fileData)); } catch {}
    try { store.emit('new_abandoned', record); } catch {}
    console.log('âœ… Abandoned saved to file (demo mode):', record.id);
    return res.status(201).json({ id: record.id });

  } catch (err) {
    console.error('Abandoned save error:', err);
    return res.status(500).json({ error: 'Failed to save abandoned checkout.' });
  }
});

/* PATCH /api/abandoned/:id/converted â€” mark as converted when order placed */
app.patch('/api/abandoned/:id/converted', async (req, res) => {
  try {
    if (isAbandonedFirebaseAvailable()) {
      const db  = getDB();
      const ref = db.collection('abandoned').doc(req.params.id);
      const doc = await ref.get();
      if (doc.exists) {
        await ref.update({ status: 'converted', convertedAt: new Date().toISOString() });
      } else {
        /* Fallback: find by id field */
        const snap = await db.collection('abandoned').where('id', '==', req.params.id).limit(1).get();
        if (!snap.empty) {
          await snap.docs[0].ref.update({ status: 'converted', convertedAt: new Date().toISOString() });
        }
      }
    } else {
      const record = store.abandoned.find(a => a.id === req.params.id);
      if (record) { record.status = 'converted'; record.convertedAt = new Date().toISOString(); }
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Abandoned converted-mark error:', err);
    res.json({ ok: true });
  }
});

/* GET /api/abandoned â€” admin only */
app.get('/api/abandoned', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "tovessa_secret_jwt_key_2024_fallback");
    if (!decoded.isAdmin) return res.status(403).json({ error: 'Forbidden' });
  } catch { return res.status(401).json({ error: 'Invalid token' }); }

  try {
    if (isAbandonedFirebaseAvailable()) {
      const snap = await getDB().collection('abandoned').limit(500).get();
      const abandoned = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      abandoned.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return res.json({ abandoned, total: abandoned.length });
    }
    /* No Firebase â€” load from file + memory merged */
    const fs   = require('fs');
    const path = require('path');
    const AB_FILE = path.join(__dirname, 'data', 'abandoned.json');
    let fileData = [];
    try { if (fs.existsSync(AB_FILE)) fileData = JSON.parse(fs.readFileSync(AB_FILE, 'utf8')); } catch {}
    /* Merge: file records + any in-memory not yet in file */
    const allIds = new Set(fileData.map(a => a.id));
    const merged = [...fileData, ...store.abandoned.filter(a => !allIds.has(a.id))];
    merged.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ abandoned: merged, total: merged.length });
  } catch (err) {
    console.error('Abandoned fetch error:', err);
    return res.json({ abandoned: store.abandoned, total: store.abandoned.length });
  }
});

/* DELETE /api/abandoned/:id â€” admin only */
app.delete('/api/abandoned/:id', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "tovessa_secret_jwt_key_2024_fallback");
    if (!decoded.isAdmin) return res.status(403).json({ error: 'Forbidden' });
  } catch { return res.status(401).json({ error: 'Invalid token' }); }

  try {
    if (isAbandonedFirebaseAvailable()) {
      await getDB().collection('abandoned').doc(req.params.id).delete();
    } else {
      const idx = store.abandoned.findIndex(a => a.id === req.params.id);
      if (idx !== -1) store.abandoned.splice(idx, 1);
    }
    
    store.logActivity({
      staffId:   decoded.id || decoded.uid,
      staffName: decoded.fname ? (decoded.fname + (decoded.lname ? ' ' + decoded.lname : '')) : (decoded.email || 'Admin'),
      action:    'Rejected Abandoned Order',
      details:   req.params.id,
      role:      decoded.role
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Abandoned delete error:', err);
    res.status(500).json({ error: 'Failed to delete.' });
  }
});
/* POST /api/visitors/ping  â€” frontend calls every 25s */
app.post('/api/visitors/ping', (req, res) => {
  const { sessionId, page } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const count = store.visitorPing(sessionId, page);
  res.json({ count });
});

/* POST /api/visitors/leave  â€” frontend calls on beforeunload */
app.post('/api/visitors/leave', (req, res) => {
  const { sessionId } = req.body || {};
  if (sessionId) store.visitorLeave(sessionId);
  res.json({ ok: true });
});

/* GET /api/visitors  â€” admin: get current count + list */
app.get('/api/visitors', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "tovessa_secret_jwt_key_2024_fallback");
    if (!decoded.isAdmin) return res.status(403).json({ error: 'Forbidden' });
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
  res.json({ count: store.visitorCount(), visitors: store.visitorList() });
});

/* â”€â”€ Admin dashboard HTML â”€â”€ serve the file directly to avoid router path issues */
app.get(['/admin', '/admin/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'index.html'));
});

/* â”€â”€ Admin API endpoints â”€â”€ */
app.use('/api/admin', adminRoutes);
app.use('/admin',     adminRoutes);  /* also serve sub-routes like /admin/stats (not used but safe) */

/* â”€â”€ Health check â”€â”€ */
app.get('/api/health', (req, res) => {
  let firebaseStatus = 'demo';
  try { firebaseStatus = getDB() ? 'connected' : 'demo'; } catch { firebaseStatus = 'demo'; }
  res.json({
    status:    'ok',
    service:   'Tovessa Backend',
    version:   '2.0.0',
    firebase:  firebaseStatus,
    demoMode:  firebaseStatus === 'demo',
    timestamp: new Date().toISOString(),
    endpoints: {
      products:      '/api/products',
      orders:        '/api/orders',
      socialOrders:  '/api/social-orders',
      auth:          '/api/auth',
      contact:       '/api/contact',
      newsletter:    '/api/newsletter',
      payments:      '/api/payments',
      notifications: '/api/notifications/stream',
      reviews:       '/api/reviews',
      admin:         '/admin',
    },
  });
});


/* â”€â”€ Catch-all â”€â”€ */
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API endpoint not found.' });
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

/* â”€â”€ Global error handler â”€â”€ */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

/* â”€â”€ Start â”€â”€ */
(async () => {
  /* â”€â”€ On startup: load persisted abandoned records from file into memory â”€â”€ */
  try {
    const fs   = require('fs');
    const path = require('path');
    const AB_FILE = path.join(__dirname, 'data', 'abandoned.json');
    if (fs.existsSync(AB_FILE)) {
      const saved = JSON.parse(fs.readFileSync(AB_FILE, 'utf8'));
      store.abandoned = saved;
      console.log(`âœ… Loaded ${saved.length} abandoned records from file.`);
    }
  } catch (e) { console.warn('Could not load abandoned.json:', e.message); }

  /* â”€â”€ Load Global Settings (like Site Launch Date) from Firebase â”€â”€ */
  try {
    const db = getDB();
    if (db) {
      const doc = await db.collection('settings').doc('global').get();
      if (doc.exists) {
        const data = doc.data();
        if (data.siteLaunchDate) store.setSiteLaunchDate(data.siteLaunchDate);
        if (data.company) store.settings = { ...store.settings, company: data.company };
        console.log(`âœ… Loaded global settings from Firestore.`);
      }

      /* Load all orders into memory for store.js statement calculations */
      const [ordersSnap, socialSnap, spendingsSnap, invoicesSnap, productsSnap] = await Promise.all([
        db.collection('orders').get(),
        db.collection('social_orders').get(),
        db.collection('spendings').get(),
        db.collection('invoices').get(),
        db.collection('products').get()
      ]);
        if (ordersSnap.docs.length > 0) {
          store.orders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
        if (socialSnap.docs.length > 0) {
          store.socialOrders = socialSnap.docs.map(d => ({ id: d.id, ...d.data(), isSocial: true }));
        }
        if (spendingsSnap.docs.length > 0) {
          store.spendings = spendingsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
        if (invoicesSnap.docs.length > 0) {
          store.invoices = invoicesSnap.docs.map(d => d.data());
        }
        if (productsSnap.docs.length > 0) {
          store.products = productsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        }
      console.log(`âœ… Loaded ${store.orders.length} orders, ${store.socialOrders.length} social orders, ${store.spendings.length} spendings, ${store.invoices.length} invoices from Firestore.`);

      /* Migration already completed â€” block removed to prevent accidental user deletion on restart */
    }
  } catch (e) { console.warn('Could not load data from Firestore:', e.message); }

  app.listen(PORT, () => {
    console.log('\nâ•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—');
    console.log('â•‘       TOVESSA BACKEND v2.0                     â•‘');
    console.log('â• â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•£');
    console.log(`â•‘  Website:  http://localhost:${PORT}               â•‘`);
    console.log(`â•‘  Admin:    http://localhost:${PORT}/admin          â•‘`);
    console.log(`â•‘  API:      http://localhost:${PORT}/api/health     â•‘`);
    console.log('â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n');
  });
})();

module.exports = app;

