/* ============================================================
   TOVESSA — Settings Routes (Company & Invoice Config)
   ============================================================ */
const express = require('express');
const { getDB } = require('../utils/firebase');
const { requireAdmin, requireRole } = require('../middleware/auth');
const store = require('../utils/store');

const router = express.Router();

function isFirebaseAvailable() {
  try { return !!getDB(); } catch { return false; }
}

/* ── GET /api/settings ── */
router.get('/', requireAdmin, async (req, res) => {
  try {
    if (isFirebaseAvailable()) {
      const db = getDB();
      const doc = await db.collection('settings').doc('global').get();
      if (doc.exists) {
        return res.json({ settings: doc.data() });
      } else {
        // Fallback to defaults
        return res.json({ settings: store.settings });
      }
    }
    return res.json({ settings: store.settings });
  } catch (err) {
    console.error('Settings fetch error:', err);
    return res.status(500).json({ error: 'Failed to load settings.' });
  }
});

/* ── PUT /api/settings (super_admin only for security) ── */
router.put('/', requireRole('super_admin'), async (req, res) => {
  try {
    const newSettings = req.body.settings;
    if (!newSettings) return res.status(400).json({ error: 'Settings object required.' });

    if (isFirebaseAvailable()) {
      const db = getDB();
      await db.collection('settings').doc('global').set(newSettings, { merge: true });
    }
    
    // Update memory store
    store.settings = { ...store.settings, ...newSettings };
    
    // Log Activity
    store.logActivity({
      staffId: req.user.uid,
      staffName: req.user.email || 'Unknown',
      staffRole: req.user.role,
      action: 'settings_updated',
      details: { keys: Object.keys(newSettings) }
    });

    return res.json({ message: 'Settings updated successfully.', settings: store.settings });
  } catch (err) {
    console.error('Settings update error:', err);
    return res.status(500).json({ error: 'Failed to update settings.' });
  }
});

module.exports = router;
