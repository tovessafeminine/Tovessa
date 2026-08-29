/* ============================================================
   TOVESSA — Invoices Routes
   ============================================================ */
const express = require('express');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');
const { getDB } = require('../utils/firebase');
const { requireAdmin } = require('../middleware/auth');
const store = require('../utils/store');
const { sendInvoiceEmail } = require('../utils/email');

const router = express.Router();

function isFirebaseAvailable() {
  try { return !!getDB(); } catch { return false; }
}

/* Ensure data/invoices directory exists */
const INVOICES_DIR = path.join(__dirname, '..', 'data', 'invoices');
if (!fs.existsSync(INVOICES_DIR)) {
  fs.mkdirSync(INVOICES_DIR, { recursive: true });
}

/* Helper to pad numbers */
const padNum = (num, size) => ('000000000' + num).substr(-size);

/* ── POST /api/invoices/generate ── */
router.post('/generate', requireAdmin, async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

    // Find the order
    let order = null;
    const isSocial = orderId.startsWith('SOC-');
    const colName = isSocial ? 'social_orders' : 'orders';
    if (isFirebaseAvailable()) {
      const doc = await getDB().collection(colName).doc(orderId).get();
      if (doc.exists) order = { id: doc.id, ...doc.data() };
    }
    if (!order) order = (isSocial ? store.socialOrders : store.orders).find(o => o.id === orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Invoice ID is EXACTLY the Order ID
    const invId = orderId;
    const pdfFileName = `${invId}.pdf`;
    const pdfPath = path.join(INVOICES_DIR, pdfFileName);

    const company = store.settings?.company || { name: 'Tovessa', address: '', phone: '', email: '', website: '' };
    const { buildPdf } = require('../utils/pdfGenerator');
    await buildPdf(pdfPath, invId, order, order, company);

    // Save Invoice Snapshot
    const invoiceRecord = {
      id: invId,
      orderId: order.id,
      type: 'standard',
      pdfUrl: `/api/invoices/${invId}/download`,
      pdfFilePath: pdfPath,
      customerName: order.customerName || `${order.delivery?.fname || ''} ${order.delivery?.lname || ''}`.trim(),
      total: order.total,
      snapshot: order,
      status: 'Generated',
      emailStatus: 'Not Sent',
      createdAt: new Date().toISOString(),
      createdBy: req.user?.email || 'System',
      downloadCount: 0,
      lastDownloadDate: null
    };

    if (isFirebaseAvailable()) {
      await getDB().collection('invoices').doc(invId).set(invoiceRecord);
    }
    store.invoices.unshift(invoiceRecord);

    store.logActivity({
      staffId: req.user?.uid,
      staffName: req.user?.email || 'System',
      staffRole: req.user?.role || 'system',
      action: 'invoice_generated',
      details: { invoiceId: invId, orderId: orderId }
    });

    return res.status(201).json({ message: 'Invoice generated.', invoice: invoiceRecord });
  } catch (err) {
    console.error('Invoice generate error:', err);
    return res.status(500).json({ error: 'Failed to generate invoice.' });
  }
});

/* ── GET /api/invoices ── */
router.get('/', requireAdmin, async (req, res) => {
  try {
    let invoices = [];
    let liveOrders = [];
    if (isFirebaseAvailable()) {
      try {
        const snap = await getDB().collection('invoices').orderBy('createdAt', 'desc').get();
        invoices = snap.docs.map(d => d.data());
        const ordersSnap = await getDB().collection('orders').get();
        liveOrders = ordersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (fbErr) {
        console.error('Firebase GET invoices failed, falling back to memory:', fbErr.message);
        invoices = store.invoices;
        liveOrders = store.orders;
      }
    } else {
      invoices = store.invoices;
      liveOrders = store.orders;
    }

    invoices = invoices.map(inv => {
      const order = liveOrders.find(o => o.id === inv.orderId);
      if (order) {
        inv.liveStatus = order.status;
        inv.liveAdvanceStatus = order.advanceStatus;
        inv.liveAdvanceAmount = order.advanceAmount;
      }
      return inv;
    });

    return res.json({ invoices });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch invoices.' });
  }
});

/* ── GET /api/invoices/:id/download ── */
router.get('/:id/download', async (req, res) => {
  try {
    const invId = req.params.id;
    let inv = null;
    if (isFirebaseAvailable()) {
      const doc = await getDB().collection('invoices').doc(invId).get();
      if (doc.exists) inv = doc.data();
    }
    if (!inv) inv = store.invoices.find(i => i.id === invId);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });

    const pdfPath = inv.pdfFilePath || path.join(INVOICES_DIR, `${invId}.pdf`);

    let liveOrder = null;
    const isSocial = inv.orderId.startsWith('SOC-');
    const colName = isSocial ? 'social_orders' : 'orders';
    if (isFirebaseAvailable()) {
      const doc = await getDB().collection(colName).doc(inv.orderId).get();
      if (doc.exists) liveOrder = { id: doc.id, ...doc.data() };
    }
    if (!liveOrder) liveOrder = (isSocial ? store.socialOrders : store.orders).find(o => o.id === inv.orderId);

    const company = store.settings?.company || { name: 'Tovessa', address: '', phone: '', email: '', website: '' };
    const { buildPdf } = require('../utils/pdfGenerator');
    await buildPdf(pdfPath, invId, inv.snapshot || inv, liveOrder || inv.snapshot || inv, company);

    // Increment download count
    inv.downloadCount = (inv.downloadCount || 0) + 1;
    inv.lastDownloadDate = new Date().toISOString();
    if (isFirebaseAvailable()) {
      await getDB().collection('invoices').doc(invId).update({ downloadCount: inv.downloadCount, lastDownloadDate: inv.lastDownloadDate });
    }

    res.download(pdfPath, `${inv.orderId}.pdf`);
  } catch (err) {
    return res.status(500).json({ error: 'Download failed.' });
  }
});

/* ── POST /api/invoices/:id/email ── */
router.post('/:id/email', requireAdmin, async (req, res) => {
  try {
    const invId = req.params.id;
    let inv = null;
    if (isFirebaseAvailable()) {
      const doc = await getDB().collection('invoices').doc(invId).get();
      if (doc.exists) inv = doc.data();
    }
    if (!inv) inv = store.invoices.find(i => i.id === invId);
    if (!inv) return res.status(404).json({ error: 'Invoice not found.' });

    const pdfPath = inv.pdfFilePath || path.join(INVOICES_DIR, `${invId}.pdf`);
    const toEmail = inv.snapshot?.delivery?.email || inv.snapshot?.customerEmail;
    if (!toEmail) return res.status(400).json({ error: 'Customer email missing.' });

    let liveOrder = null;
    const isSocial = inv.orderId.startsWith('SOC-');
    const colName = isSocial ? 'social_orders' : 'orders';
    if (isFirebaseAvailable()) {
      const doc = await getDB().collection(colName).doc(inv.orderId).get();
      if (doc.exists) liveOrder = { id: doc.id, ...doc.data() };
    }
    if (!liveOrder) liveOrder = (isSocial ? store.socialOrders : store.orders).find(o => o.id === inv.orderId);

    // Regenerate PDF before emailing
    const company = store.settings?.company || { name: 'Tovessa', address: '', phone: '', email: '', website: '' };
    const { buildPdf } = require('../utils/pdfGenerator');
    await buildPdf(pdfPath, invId, inv.snapshot || inv, liveOrder || inv.snapshot || inv, company);

    // Send email
    await sendInvoiceEmail({
      to: toEmail,
      invoiceRef: invId,
      customerName: inv.customerName || 'Customer',
      pdfPath,
      liveOrder: liveOrder || inv.snapshot || inv
    });

    inv.emailStatus = `Sent on ${new Date().toLocaleString()}`;
    if (isFirebaseAvailable()) {
      await getDB().collection('invoices').doc(invId).update({ emailStatus: inv.emailStatus });
    }

    store.logActivity({
      staffId: req.user?.uid,
      staffName: req.user?.email || 'Unknown',
      staffRole: req.user?.role || 'admin',
      action: 'invoice_emailed',
      details: { invoiceId: invId, to: toEmail }
    });

    return res.json({ message: 'Email sent successfully!', emailStatus: inv.emailStatus });
  } catch (err) {
    console.error('Invoice email error:', err);
    return res.status(500).json({ error: 'Failed to email invoice.' });
  }
});

module.exports = router;
