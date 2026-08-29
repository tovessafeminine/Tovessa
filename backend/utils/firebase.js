/* ============================================================
   TOVESSA — Firebase Admin SDK Initialization
   Returns null safely when credentials are not configured.
   All routes check getDB() === null to use in-memory fallback.
   ============================================================ */
const admin = require('firebase-admin');

let db   = null;
let tried = false;  /* Only attempt init once */

/**
 * Robustly resolves the Firebase private key from environment variables.
 * Supports:
 * 1. FIREBASE_PRIVATE_KEY_B64  -> base64-encoded key (RECOMMENDED — immune
 *    to hosting panels like Hostinger mangling newlines/quotes)
 * 2. FIREBASE_PRIVATE_KEY      -> raw key with literal "\n" or real newlines
 */
function resolvePrivateKey() {
  if (process.env.FIREBASE_PRIVATE_KEY_B64) {
    return Buffer.from(process.env.FIREBASE_PRIVATE_KEY_B64, 'base64').toString('utf8').trim();
  }
  let key = process.env.FIREBASE_PRIVATE_KEY || '';
  if (key.startsWith('"') && key.endsWith('"')) key = key.slice(1, -1);
  if (key.includes('\\n')) key = key.replace(/\\n/g, '\n');
  return key.trim();
}

function initFirebase() {
  if (tried) return db;
  tried = true;

  /* Skip if already initialized */
  if (admin.apps.length > 0) {
    db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    return db;
  }

  /* Check that real credentials are present */
  const projectId  = process.env.FIREBASE_PROJECT_ID;
  const privateKey = resolvePrivateKey();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  const isMissing = !projectId || !privateKey || !clientEmail ||
    projectId === 'your-firebase-project-id' ||
    !privateKey.includes('BEGIN PRIVATE KEY') ||
    clientEmail.includes('your-project');

  if (isMissing) {
    console.warn('⚠️  Firebase credentials not configured.');
    console.warn('   Running in DEMO MODE — data stored in memory only.');
    console.warn('   Add Firebase credentials to .env to enable persistence.\n');
    return null;
  }

  try {
    const serviceAccount = {
      type:                        'service_account',
      project_id:                  projectId,
      private_key_id:              process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key:                 privateKey,
      client_email:                clientEmail,
      client_id:                   process.env.FIREBASE_CLIENT_ID,
      auth_uri:                    'https://accounts.google.com/o/oauth2/auth',
      token_uri:                   'https://oauth2.googleapis.com/token',
      auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
      client_x509_cert_url:        process.env.FIREBASE_CLIENT_CERT_URL,
    };

    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    console.log('✅ Firebase Admin initialized — Project:', projectId);
    return db;

  } catch (err) {
    console.warn('⚠️  Firebase init failed:', err.message);
    console.warn('   Running in DEMO MODE — data stored in memory only.\n');
    return null;
  }
}

/* Always safe — never throws, returns null when Firebase unavailable */
function getDB() {
  if (!tried) initFirebase();
  return db;
}

module.exports = { initFirebase, getDB, admin };
