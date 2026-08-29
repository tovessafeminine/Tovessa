/* ============================================================
   TOVESSA — Products Routes (uses shared store)
   ============================================================ */
const express = require('express');
const { getDB }       = require('../utils/firebase');
const { requireAdmin, requireRole } = require('../middleware/auth');
const store            = require('../utils/store');

const router = express.Router();

function isFirebaseAvailable() {
  try { return !!getDB(); } catch { return false; }
}

function makeSlug(name) {
  // Take first 5 words only for a clean short URL
  const words = name.trim().split(/\s+/).slice(0, 5).join(' ');
  return words.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function seedFirestore(db) {
  try {
    const snap = await db.collection('products').limit(1).get();
    if (!snap.empty) return;
    const batch = db.batch();
    store.products.forEach(p => batch.set(db.collection('products').doc(p.id), p));
    await batch.commit();
    console.log('✅ Seeded default products to Firestore.');
  } catch (e) { console.warn('Seed failed:', e.message); }
}

/* ── GET /api/products ── */
router.get('/', async (req, res) => {
  try {
    const { category, featured, search, limit: lim, admin } = req.query;

    if (isFirebaseAvailable()) {
      try {
        const db = getDB();
        await seedFirestore(db);
        let query = db.collection('products');
        if (category && category !== 'all') query = query.where('category', '==', category);
        if (featured === 'true') query = query.where('featured', '==', true);
        const snap = await query.get();
        let products = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        if (admin !== 'true') products = products.filter(p => !p.hidden);
        if (search) { const q = search.toLowerCase(); products = products.filter(p => p.name?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q)); }
        // For products we also need to sort by createdAt descending like the others if we want
        products.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        if (lim) products = products.slice(0, parseInt(lim));
        return res.json({ products, total: products.length });
      } catch (fbErr) {
        console.error('Firebase GET products failed, falling back to memory:', fbErr.message);
      }
    }

    /* In-memory (shared store) */
    let products = [...store.products];
    if (admin !== 'true') products = products.filter(p => !p.hidden);
    if (category && category !== 'all') products = products.filter(p => p.category === category);
    if (featured === 'true') products = products.filter(p => p.featured);
    if (search) { const q = search.toLowerCase(); products = products.filter(p => p.name?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q)); }
    products.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    if (lim) products = products.slice(0, parseInt(lim));
    return res.json({ products, total: products.length });

  } catch (err) {
    console.error('Get products error:', err);
    return res.status(500).json({ error: 'Failed to fetch products.' });
  }
});

/* ── GET /api/products/:id ── */
router.get('/:id', async (req, res) => {
  try {
    if (isFirebaseAvailable()) {
      const db = getDB();
      const doc = await db.collection('products').doc(req.params.id).get();
      if (!doc.exists) return res.status(404).json({ error: 'Product not found.' });
      return res.json({ product: { ...doc.data(), id: doc.id } });
    }
    const product = store.findProduct(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    return res.json({ product });
  } catch (err) {
    console.error('Get product error:', err);
    return res.status(500).json({ error: 'Failed to fetch product.' });
  }
});

/* ── POST /api/products (super_admin + admin only — product catalogue is not supervisor's job) ── */
router.post('/', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const { name, brand, category, subcategory, additionalCategories, price, priceOld, purchasePrice, emoji, badge, description, sizes, colors, inStock, featured, hidden, images, video } = req.body;
    if (!name || !category || !price) return res.status(400).json({ error: 'Name, category, and price are required.' });
    if (purchasePrice === undefined || purchasePrice === null || purchasePrice === '') {
      return res.status(400).json({ error: 'Purchase price is required.' });
    }

    let baseSlug = makeSlug(name);
    let slug = baseSlug;
    let counter = 1;
    while (store.products.find(p => p.id === slug)) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    const productData = {
      id:          slug,
      name:        name.trim(),
      brand:       brand || '',
      category,
      subcategory: subcategory || '',
      additionalCategories: additionalCategories || [],
      price:       Number(price),
      priceOld:    priceOld ? Number(priceOld) : null,
      purchasePrice: Number(purchasePrice),
      emoji:       emoji || '🛍️',
      badge:       badge || null,
      description: description || '',
      sizes:       Array.isArray(sizes) ? sizes : (sizes || '').split(',').map(s => s.trim()).filter(Boolean),
      colors:      Array.isArray(colors) ? colors : (colors || '').split(',').map(s => s.trim()).filter(Boolean),
      images:      Array.isArray(images) ? images.filter(Boolean) : [],
      video:       video || null,
      inStock:     inStock !== false,
      featured:    !!featured,
      hidden:      !!hidden,
      createdAt:   new Date().toISOString(),
    };

    if (isFirebaseAvailable()) {
      await getDB().collection('products').doc(slug).set(productData);
    }
    const existingIdx = store.products.findIndex(p => p.id === slug);
    if (existingIdx >= 0) store.products[existingIdx] = productData;
    else store.products.push(productData);
    store.emit('product_added', { name: productData.name });

    store.logActivity({
      staffId:   req.user.id,
      staffName: req.user.fname + (req.user.lname ? ' ' + req.user.lname : ''),
      action:    'Added Product',
      details:   `${productData.name} (ID: ${slug})`,
      role:      req.user.role
    });

    return res.status(201).json({ message: 'Product created successfully.', product: productData });
  } catch (err) {
    console.error('Create product error:', err);
    return res.status(500).json({ error: 'Failed to create product: ' + err.message });
  }
});
/*  POST /api/products/:id/stock (super_admin + admin only)  */
router.post('/:id/stock', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const qty = Number(req.body.qty);
    const type = req.body.type || 'add'; // 'add' or 'set'
    if (isNaN(qty)) return res.status(400).json({ error: 'Quantity is required' });

    if (isFirebaseAvailable()) {
      const db = getDB();
      const ref = db.collection('products').doc(req.params.id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Product not found' });
      
      const currentPurchased = Number(snap.data().stock_purchased || 0);
      const newPurchased = type === 'set' ? qty : currentPurchased + qty;
      await ref.update({ stock_purchased: newPurchased, updatedAt: new Date().toISOString() });
    }

    const idx = store.products.findIndex(p => p.id === req.params.id);
    if (idx !== -1) {
      const currentPurchased = Number(store.products[idx].stock_purchased) || 0;
      store.products[idx].stock_purchased = type === 'set' ? qty : currentPurchased + qty;
      store.products[idx].updatedAt = new Date().toISOString();
    } else if (!isFirebaseAvailable()) {
      return res.status(404).json({ error: 'Product not found' });
    }

    store.logActivity({
      staffId:   req.user.id || req.user.uid,
      staffName: req.user.fname + (req.user.lname ? ' ' + req.user.lname : ''),
      action:    'Added Stock',
      details:   `Added ${qty} to ${req.params.id}`,
      role:      req.user.role
    });

    return res.json({ message: 'Stock updated successfully.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update stock.' });
  }
});

/* ── PUT /api/products/:id (super_admin + admin only) ── */
router.put('/:id', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    const updates = { ...req.body, updatedAt: new Date().toISOString() };
    if (updates.price) updates.price = Number(updates.price);
    if (updates.priceOld) updates.priceOld = Number(updates.priceOld);
    if (updates.purchasePrice !== undefined && updates.purchasePrice !== null && updates.purchasePrice !== '') {
      updates.purchasePrice = Number(updates.purchasePrice);
    }

    let updatedProductData = null;

    if (isFirebaseAvailable()) {
      const db = getDB();
      const ref = db.collection('products').doc(req.params.id);
      const doc = await ref.get();
      if (!doc.exists) return res.status(404).json({ error: 'Product not found.' });
      await ref.update(updates);
      updatedProductData = { ...doc.data(), ...updates };
    }

    const idx = store.products.findIndex(p => p.id === req.params.id);
    if (idx >= 0) {
      store.products[idx] = { ...store.products[idx], ...updates };
      updatedProductData = updatedProductData || store.products[idx];
    } else if (!isFirebaseAvailable()) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    return res.json({ message: 'Product updated.', product: updatedProductData });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update product.' });
  }
});

/* ── DELETE /api/products/:id (super_admin + admin only) ── */
router.delete('/:id', requireRole('super_admin', 'admin'), async (req, res) => {
  try {
    let productName = 'Unknown';
    if (isFirebaseAvailable()) {
      const db = getDB();
      const ref = db.collection('products').doc(req.params.id);
      const doc = await ref.get();
      if (!doc.exists) return res.status(404).json({ error: 'Product not found.' });
      productName = doc.data().name;
      await ref.delete();
    } 
    
    const idx = store.products.findIndex(p => p.id === req.params.id);
    if (idx >= 0) {
      if (productName === 'Unknown') productName = store.products[idx].name;
      store.products.splice(idx, 1);
    } else if (!isFirebaseAvailable()) {
      return res.status(404).json({ error: 'Product not found.' });
    }
    
    store.logActivity({
      staffId:   req.user.id,
      staffName: req.user.fname + (req.user.lname ? ' ' + req.user.lname : ''),
      action:    'Deleted Product',
      details:   `Product: ${productName} (ID: ${req.params.id})`,
      role:      req.user.role
    });

    return res.json({ message: 'Product deleted.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete product.' });
  }
});

module.exports = router;
