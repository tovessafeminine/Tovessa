/* ============================================================
   TOVESSA — Upload Routes
   Uploads to Cloudinary (persistent) → Firebase Storage → Local disk
   ============================================================ */
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { requireRole } = require('../middleware/auth');
const { admin, getDB } = require('../utils/firebase');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'images', 'products');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) return cb(null, true);
    cb(new Error('Only image or video files are allowed.'));
  },
});

/* ── POST /api/upload ── */
router.post('/', requireRole('super_admin', 'admin'), (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large. Max 100MB.' });
      return res.status(400).json({ error: err.message || 'Upload failed.' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file provided.' });

    const resourceType = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
    const ext = path.extname(req.file.originalname) || '';
    const uniqueName = 'product-' + Date.now() + '-' + Math.round(Math.random() * 1e9);

    /* ── 1. Try Cloudinary first (persistent, free 25GB) ── */
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
      try {
        const cloudinary = require('cloudinary').v2;
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key:    process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET,
        });

        const result = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { public_id: uniqueName, resource_type: resourceType, folder: 'tovessa/products' },
            (error, result) => error ? reject(error) : resolve(result)
          );
          stream.end(req.file.buffer);
        });

        console.log('✅ Uploaded to Cloudinary:', result.secure_url);
        return res.status(201).json({ url: result.secure_url, type: resourceType, publicId: result.public_id });
      } catch (e) {
        console.error('Cloudinary upload failed, trying Firebase:', e.message);
      }
    }

    /* ── 2. Try Firebase Storage ── */
    if (admin && getDB()) {
      try {
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.appspot.com`;
        const bucket = admin.storage().bucket(bucketName);
        const fileName = uniqueName + ext;
        const file = bucket.file(`products/${fileName}`);
        const uuid = uuidv4();

        await file.save(req.file.buffer, {
          metadata: { contentType: req.file.mimetype, metadata: { firebaseStorageDownloadTokens: uuid } }
        });

        const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/products%2F${encodeURIComponent(fileName)}?alt=media&token=${uuid}`;
        console.log('✅ Uploaded to Firebase Storage:', fileUrl);
        return res.status(201).json({ url: fileUrl, type: resourceType, publicId: fileName });
      } catch (fbErr) {
        console.error('Firebase Storage failed, falling back to local:', fbErr.message);
      }
    }

    /* ── 3. Local disk fallback (ephemeral on Render free tier) ── */
    const localName = uniqueName + ext;
    const localPath = path.join(uploadDir, localName);
    fs.writeFileSync(localPath, req.file.buffer);
    const fileUrl = `/images/products/${localName}`;
    console.warn('⚠️ Saved locally (ephemeral):', fileUrl);
    return res.status(201).json({ url: fileUrl, type: resourceType, publicId: localName });
  });
});

module.exports = router;
