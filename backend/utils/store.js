/* ============================================================
   TOVESSA — Shared Singleton Data Store
   THE single source of truth for all in-memory data.
   All routes import this module — they all share the SAME arrays.
   ============================================================ */

/* ── Default product catalogue — empty (products are managed via Firebase/admin panel) ── */
const DEFAULT_PRODUCTS = [];

/* ── The singleton store ── */
const store = {
  /* Data arrays — shared across ALL routes */
  products:     JSON.parse(JSON.stringify(DEFAULT_PRODUCTS)),
  orders:       [],
  socialOrders: [],   /* manually created social media orders */
  messages:     [],
  subscribers:  [],
  resellers:    [],
  users:        [],
  activityLogs: [],
  abandoned:    [],
  coupons:      [],   /* discount coupons — super_admin managed */
  invoices:     [],   /* generated invoices */
  spendings:    [],   /* tracked expenses/investments */
  settings: {
    company: {
      name: 'Tovessa',
      address: '',
      phone: '+92 315 0727131',
      email: 'tovessa@gmail.com',
      website: '',
      socials: ''
    },
    invoiceTrigger: 'manual' /* 'manual', 'on_creation', 'on_confirmation' */
  },

  /* Admin users with role support */
  adminUsers: [
    {
      id:          'super-admin-1',
      username:    (process.env.ADMIN_USERNAME || 'admin').toLowerCase(),
      email:       (process.env.ADMIN_USERNAME || 'admin').toLowerCase(),
      passwordHash: null,    /* hashed on first login attempt via initSuperAdmin */
      role:        'ceo',
      fname:       'Super',
      lname:       'Admin',
      active:      true,
      createdAt:   new Date().toISOString(),
      lastLogin:   null,
    },
  ],

  /* ── Site launch date ──
     Monthly/lifetime statements should only ever count from the day the
     store actually went live — not from whatever the server happened to
     boot on. Defaults to process.env.SITE_LAUNCH_DATE if set, otherwise
     falls back to "today" the first time the server starts (super_admin
     can correct this once from Settings → it's stored here so it persists
     for the life of the server process). */
  siteLaunchDate: (process.env.SITE_LAUNCH_DATE && !isNaN(new Date(process.env.SITE_LAUNCH_DATE)))
    ? new Date(process.env.SITE_LAUNCH_DATE).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10),

  setSiteLaunchDate(dateStr) {
    if (!dateStr || isNaN(new Date(dateStr))) throw new Error('Invalid date.');
    this.siteLaunchDate = new Date(dateStr).toISOString().slice(0, 10);
    return this.siteLaunchDate;
  },

  /* ── Live Visitor Tracking ── */
  _visitors: new Map(), /* sessionId → { page, lastSeen } */
  VISITOR_TIMEOUT_MS: 35000, /* 35s — frontend pings every 25s */

  visitorPing(sessionId, page) {
    this._visitors.set(sessionId, { page: page || '/', lastSeen: Date.now() });
    this._pruneVisitors();
    const count = this._visitors.size;
    this.emit('visitor_update', { count, visitors: this.visitorList() });
    return count;
  },

  visitorLeave(sessionId) {
    this._visitors.delete(sessionId);
    this._pruneVisitors();
    const count = this._visitors.size;
    this.emit('visitor_update', { count, visitors: this.visitorList() });
    return count;
  },

  _pruneVisitors() {
    const cutoff = Date.now() - this.VISITOR_TIMEOUT_MS;
    for (const [id, v] of this._visitors) {
      if (v.lastSeen < cutoff) this._visitors.delete(id);
    }
  },

  visitorCount() { this._pruneVisitors(); return this._visitors.size; },

  visitorList() {
    this._pruneVisitors();
    return Array.from(this._visitors.entries()).map(([id, v]) => ({
      id, page: v.page, secondsAgo: Math.round((Date.now() - v.lastSeen) / 1000),
    }));
  },

  /* ── SSE notification listeners ── */
  _notifListeners: new Set(),

  /* Push an event to all connected admin SSE clients */
  emit(event, data) {
    const payload = { event, data, time: new Date().toISOString() };
    this._notifListeners.forEach(fn => {
      try { fn(payload); } catch (_) {}
    });
  },

  /* Register an SSE listener — returns an unsubscribe function */
  subscribe(fn) {
    this._notifListeners.add(fn);
    return () => this._notifListeners.delete(fn);
  },

  /* ── Activity Logging ── */
  logActivity({ staffId, staffName, staffRole, action, details = {} }) {
    this.activityLogs.unshift({
      id:        'log-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      staffId,
      staffName,
      staffRole,
      action,
      details,
      timestamp: new Date().toISOString(),
    });
    /* Keep last 1000 logs in memory */
    if (this.activityLogs.length > 1000) this.activityLogs = this.activityLogs.slice(0, 1000);
  },

  /* ── Profit helpers (super_admin only — used by /admin/profit endpoints) ──
     Profit per sold item = (sale price the customer paid - purchasePrice that
     was snapshotted onto the order item at checkout time). Cancelled orders
     are excluded since nothing was actually sold. ── */
  _itemProfit(item) {
    /* purchasePrice is snapshotted onto the order item when the order is
       placed (see orders.js). Falls back to looking up the live product
       if an older order somehow lacks the snapshot. */
    let pp = item.purchasePrice;
    if (pp === undefined || pp === null) {
      const prod = this.findProduct(item.productId) || this.products.find(p => p.name === item.name);
      pp = prod?.purchasePrice ?? 0;
    }
    const qty = item.qty || 1;
    const revenue = (item.price || 0) * qty;
    const cost    = (Number(pp) || 0) * qty;
    return { revenue, cost, profit: revenue - cost };
  },

  /* Build a statement (list of sold line-items + totals) for orders matching a filter fn */
  _buildStatement(orderFilterFn) {
    const lines = [];
    let revenue = 0, cost = 0, profit = 0;
    const allOrders = [...this.orders, ...this.socialOrders];
    allOrders.filter(o => o.status !== 'Cancelled').filter(orderFilterFn).forEach(o => {
      /* Total discount on this order (coupon + custom discount) */
      const orderDiscount = (o.discount || 0) + (o.customDiscount?.amount || 0);
      /* Subtotal before discount - used to allocate discount proportionally per item */
      const orderSubtotal = (o.subtotal || 0) || (o.items || []).reduce((s, i) => s + ((i.price || 0) * (i.qty || 1)), 0);
      let orderItemCostSum = 0;
      (o.items || []).forEach(item => {
        const { revenue: r, cost: c } = this._itemProfit(item);
        /* Allocate discount proportionally */
        const itemRevenueFraction = orderSubtotal > 0 ? (r / orderSubtotal) : (1 / (o.items?.length || 1));
        const itemDiscount = Math.round(orderDiscount * itemRevenueFraction);
        const effectiveRevenue = Math.max(0, r - itemDiscount);
        const p = effectiveRevenue - c;

        orderItemCostSum += c;
        lines.push({
          orderId:   o.id,
          date:      o.createdAt,
          product:   item.name,
          qty:       item.qty || 1,
          salePrice: item.price || 0,
          purchasePrice: item.purchasePrice ?? (this.findProduct(item.productId)?.purchasePrice ?? null),
          revenue:   effectiveRevenue,
          cost:      c,
          profit:    p,
        });
      });
      
      const orderRevenue = (o.total || 0);
      const explicitDelivery = o.delivery?.fee !== undefined ? Number(o.delivery.fee) : o.deliveryFee;
      const deliveryCost = explicitDelivery !== undefined 
        ? explicitDelivery 
        : Math.max(0, orderRevenue - Math.max(0, orderSubtotal - orderDiscount));
        
      revenue += orderRevenue;
      cost    += (orderItemCostSum + deliveryCost);
      profit  += (orderRevenue - (orderItemCostSum + deliveryCost));
    });
    return { lines, totals: { revenue: Math.round(revenue), cost: Math.round(cost), profit: Math.round(profit), orders: allOrders.filter(o => o.status !== 'Cancelled').filter(orderFilterFn).length } };
  },

  /* Statement for one calendar day (dateStr = 'YYYY-MM-DD', server local time) */
  dailyStatement(target) {
    if (!target) {
      const d = new Date();
      d.setTime(d.getTime() + (5 * 60 * 60 * 1000));
      target = d.toISOString().slice(0, 10);
    }
    const stmt = this._buildStatement(o => {
      if (!o.createdAt) return false;
      const d = new Date(o.createdAt);
      if (isNaN(d.getTime())) return false;
      d.setTime(d.getTime() + (5 * 60 * 60 * 1000));
      return d.toISOString().slice(0, 10) === target;
    });
    return { date: target, ...stmt };
  },

  /* History of daily statements for the last N days (default 30), newest first.
     Never goes earlier than the site's launch date. */
  dailyStatementHistory(days = 30) {
    const out = [];
    const launch = this.siteLaunchDate;
    for (let i = 0; i < days; i++) {
      const d = new Date();
      d.setTime(d.getTime() + (5 * 60 * 60 * 1000));
      d.setUTCDate(d.getUTCDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      /* Skip days before launch — but do NOT break, keep going for full 30-day range */
      if (dateStr < launch) continue;
      out.push(this.dailyStatement(dateStr));
    }
    return out;
  },

  /* Statement for one calendar month (monthStr = 'YYYY-MM') */
  monthlyStatement(monthStr) {
    const stmt = this._buildStatement(o => {
      if (!o.createdAt) return false;
      const d = new Date(o.createdAt);
      if (isNaN(d.getTime())) return false;
      d.setTime(d.getTime() + (5 * 60 * 60 * 1000));
      return d.toISOString().slice(0, 7) === monthStr;
    });
    return { month: monthStr, ...stmt };
  },

  /* History of monthly statements, starting from the site's launch month up
     to the current month (newest first). This is the "monthly statement"
     view — unlike daily history it is NOT capped at 30 days; it always
     starts the count from siteLaunchDate, however long ago that was. */
  monthlyStatementHistory() {
    const launch = new Date(this.siteLaunchDate + 'T00:00:00');
    const launchMonth = new Date(launch.getFullYear(), launch.getMonth(), 1);
    const now = new Date();
    now.setTime(now.getTime() + (5 * 60 * 60 * 1000));
    const out = [];
    let cursor = new Date(now.getFullYear(), now.getMonth(), 1);
    while (cursor >= launchMonth) {
      const monthStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      out.push(this.monthlyStatement(monthStr));
      cursor.setMonth(cursor.getMonth() - 1);
    }
    return out;
  },

  /* Lifetime earnings — every sale ever recorded since launch, no other date filter */
  lifetimeEarnings() {
    const launch = this.siteLaunchDate;
    const stmt = this._buildStatement(o => {
      if (!o.createdAt) return false;
      const d = new Date(o.createdAt);
      if (isNaN(d.getTime())) return false;
      d.setTime(d.getTime() + (5 * 60 * 60 * 1000));
      return d.toISOString().slice(0, 10) >= launch;
    });
    /* Also bucket by day so the UI can show a quick trend if desired */
    const byDay = {};
    const allOrders = [...this.orders, ...this.socialOrders];
    allOrders.filter(o => o.status !== 'Cancelled').forEach(o => {
      if (!o.createdAt) return;
      const d = new Date(o.createdAt);
      if (isNaN(d.getTime())) return;
      d.setTime(d.getTime() + (5 * 60 * 60 * 1000));
      const day = d.toISOString().slice(0, 10);
      if (day >= launch) {
        if (!byDay[day]) byDay[day] = { date: day, revenue: 0, cost: 0, profit: 0 };
        (o.items || []).forEach(item => {
          const { revenue, cost, profit } = this._itemProfit(item);
          byDay[day].revenue += revenue;
          byDay[day].cost    += cost;
          byDay[day].profit  += profit;
        });
      }
    });
    const days = Object.values(byDay)
      .map(d => ({ ...d, revenue: Math.round(d.revenue), cost: Math.round(d.cost), profit: Math.round(d.profit) }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    return { ...stmt, byDay: days, since: launch };
  },

  /* ── Helpers ── */
  findProduct(id)     { return this.products.find(p => p.id === id); },
  findOrder(id)       { return this.orders.find(o => o.id === id); },
  findUser(email)     { return this.users.find(u => u.email === email?.toLowerCase()); },
  findAdminUser(usernameOrEmail) {
    const v = (usernameOrEmail || '').toLowerCase();
    return this.adminUsers.find(u => u.username === v || u.email === v);
  },
  findAdminUserById(id) {
    return this.adminUsers.find(u => u.id === id);
  },

  /* ── Coupons ── */
  findCoupon(code) {
    const v = (code || '').trim().toUpperCase();
    return this.coupons.find(c => c.code === v);
  },

  /* Pure validation — takes an already-fetched coupon object (or null/undefined
     if not found) plus the order subtotal, and returns either
     { ok:false, error } or { ok:true, coupon, discount, total }.
     Kept separate from lookup so callers can fetch the coupon fresh from
     Firebase (source of truth) and still share these exact rules. */
  checkCoupon(coupon, subtotal) {
    if (!coupon) return { ok: false, error: 'Invalid coupon code.' };
    if (coupon.active === false) return { ok: false, error: 'This coupon is no longer active.' };
    if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
      return { ok: false, error: 'This coupon has expired.' };
    }
    if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
      return { ok: false, error: 'This coupon has reached its usage limit.' };
    }
    if (coupon.minOrderAmount && subtotal < coupon.minOrderAmount) {
      return { ok: false, error: `This coupon requires a minimum order of PKR ${coupon.minOrderAmount.toLocaleString()}.` };
    }

    let discount = coupon.type === 'percent'
      ? Math.round(subtotal * (coupon.value / 100))
      : coupon.value;
    discount = Math.min(discount, subtotal); /* never discount below PKR 0 */

    return { ok: true, coupon, discount, total: subtotal - discount };
  },

  /* Convenience wrapper for in-memory mode: looks up by code in this.coupons
     then runs checkCoupon. Firebase-mode callers fetch the coupon themselves
     and call checkCoupon directly (see coupons.js /validate). */
  validateCoupon(code, subtotal) {
    return this.checkCoupon(this.findCoupon(code), subtotal);
  },

  /* Increments usedCount once an order is actually placed with this coupon.
     Called from orders.js / socialOrders.js AFTER the order is saved.
     Pass the live coupon doc id when known (Firebase mode) to avoid a
     second lookup-by-code query. */
  async recordCouponUse(code, isFirebaseAvailable, getDB, couponId) {
    if (isFirebaseAvailable && isFirebaseAvailable()) {
      try {
        let id = couponId;
        if (!id) {
          const cleanCode = String(code || '').trim().toUpperCase();
          const snap = await getDB().collection('coupons').where('code', '==', cleanCode).limit(1).get();
          if (snap.empty) return;
          id = snap.docs[0].id;
        }
        const { FieldValue } = require('firebase-admin/firestore');
        await getDB().collection('coupons').doc(id).update({ usedCount: FieldValue.increment(1) });
      } catch (e) { console.error('recordCouponUse Firestore update failed:', e.message); }
      return;
    }
    const coupon = this.findCoupon(code);
    if (coupon) coupon.usedCount = (coupon.usedCount || 0) + 1;
  },

  /* ── Staff summary (per-staff activity counts) ── */
  staffSummary() {
    const summary = {};
    this.adminUsers.forEach(u => {
      summary[u.id] = {
        id:           u.id,
        name:         `${u.fname} ${u.lname || ''}`.trim(),
        role:         u.role,
        username:     u.username,
        active:       u.active,
        lastLogin:    u.lastLogin,
        msgReplied:   this.activityLogs.filter(l => l.staffId === u.id && l.action === 'message_reply').length,
        ordersUpdated: this.activityLogs.filter(l => l.staffId === u.id && l.action === 'order_status_change').length,
        lastActive:   this.activityLogs.filter(l => l.staffId === u.id)[0]?.timestamp || null,
      };
    });
    return Object.values(summary);
  },

  calculateInventory() {
    const inventory = {};
    this.products.forEach(p => {
      inventory[p.id] = {
        product: p,
        stock_purchased: Number(p.stock_purchased) || 0,
        stock_sold: 0,
        current_stock: Number(p.stock_purchased) || 0
      };
    });

    this.orders.filter(o => o.status !== 'Cancelled').forEach(o => {
      (o.items || []).forEach(item => {
        if (item.productId && inventory[item.productId]) {
          inventory[item.productId].stock_sold += Number(item.qty || 1);
          inventory[item.productId].current_stock -= Number(item.qty || 1);
        }
      });
    });

    this.socialOrders.filter(o => o.status !== 'Cancelled').forEach(o => {
      (o.items || []).forEach(item => {
        if (item.productId && inventory[item.productId]) {
          inventory[item.productId].stock_sold += Number(item.qty || 1);
          inventory[item.productId].current_stock -= Number(item.qty || 1);
        }
      });
    });

    return Object.values(inventory);
  },

  /* Stats snapshot — used by /admin/stats */
  stats() {
    const orders  = this.orders;
    const sOrders = this.socialOrders;
    const revenue = orders
      .filter(o => o.status !== 'Cancelled')
      .reduce((s, o) => s + (o.total || 0), 0);
    const socialRevenue = sOrders
      .filter(o => o.status !== 'Cancelled')
      .reduce((s, o) => s + (o.total || 0), 0);
    const statusCounts = {};
    orders.forEach(o => {
      statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    });
    const socialStatusCounts = {};
    sOrders.forEach(o => {
      socialStatusCounts[o.status] = (socialStatusCounts[o.status] || 0) + 1;
    });
    const totalSpendings = this.spendings.reduce((s, x) => s + (Number(x.amount) || 0), 0);

    const inventory = this.calculateInventory();
    const stockNeeded = inventory.filter(i => i.current_stock < 0).length;

    return {
      orders:              { total: orders.length,  statuses: statusCounts },
      socialOrders:        { total: sOrders.length, statuses: socialStatusCounts },
      products:            { total: this.products.length },
      subscribers:         { total: this.subscribers.length },
      abandonedCheckouts:  this.abandoned.filter(a => a.status === 'abandoned').length,
      unreadMessages:      this.messages.filter(m => !m.read).length,
      totalRevenue:        Math.round(revenue),
      socialRevenue:       Math.round(socialRevenue),
      combinedRevenue:     Math.round(revenue + socialRevenue),
      totalSpendings:      Math.round(totalSpendings),
      users:               { total: this.users.length },
      stockNeeded:         stockNeeded,
    };
  },
};

const fs = require('fs');
const path = require('path');
const STORE_FILE = path.join(__dirname, '..', 'data', 'store.json');

try {
  if (fs.existsSync(STORE_FILE)) {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (data.adminUsers) {
      store.adminUsers = data.adminUsers;
      /* Ensure super-admin-1 always exists and stays active */
      const hasSuperAdmin = store.adminUsers.some(u => u.id === 'super-admin-1');
      if (!hasSuperAdmin) {
        store.adminUsers.unshift({
          id: 'super-admin-1', username: null, email: null,
          passwordHash: null, role: 'ceo', fname: 'Super', lname: 'Admin',
          active: true, createdAt: new Date().toISOString(), lastLogin: null,
        });
      } else {
        /* Always keep it active regardless of what was saved */
        const su = store.adminUsers.find(u => u.id === 'super-admin-1');
        if (su) su.active = true;
      }
    }
    if (data.users) store.users = data.users;
    if (data.orders) store.orders = data.orders;
    if (data.products && data.products.length > 0) store.products = data.products;
    if (data.messages) store.messages = data.messages;
    if (data.subscribers) store.subscribers = data.subscribers;
    if (data.settings) store.settings = data.settings;
    if (data.spendings) store.spendings = data.spendings;
    if (data.invoices) store.invoices = data.invoices;
    if (data.coupons) store.coupons = data.coupons;
    if (data.socialOrders) store.socialOrders = data.socialOrders;
    if (data.resellers) store.resellers = data.resellers;
    if (data.activityLogs) store.activityLogs = data.activityLogs;
    if (data.abandoned) store.abandoned = data.abandoned;
  }
} catch (err) {
  console.error('Failed to load local store.json backup:', err);
}

setInterval(() => {
  try {
    const toSave = {
      adminUsers: store.adminUsers,
      users: store.users,
      orders: store.orders,
      products: store.products,
      messages: store.messages,
      subscribers: store.subscribers,
      settings: store.settings,
      spendings: store.spendings,
      invoices: store.invoices,
      coupons: store.coupons,
      socialOrders: store.socialOrders,
      resellers: store.resellers,
      activityLogs: store.activityLogs,
      abandoned: store.abandoned
    };
    if (!fs.existsSync(path.dirname(STORE_FILE))) {
      fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
    }
    fs.writeFileSync(STORE_FILE, JSON.stringify(toSave, null, 2));
  } catch (err) {}
}, 30000); // Auto-save every 30 seconds

module.exports = store;

