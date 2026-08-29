/* ============================================================
   TOVESSA — Diagnostic script
   Lists every product's id, name, category, and subcategory
   currently stored in Firestore, plus a summary of all distinct
   category values found. Use this to find out the EXACT string
   being used for hair clips (it may not be "catchers").

   HOW TO RUN (from the backend/ folder):
     node scripts/list-categories.js
   ============================================================ */
require('dotenv').config();
const { getDB } = require('../utils/firebase');

async function run() {
  const db = getDB();
  if (!db) {
    console.error('❌ Firebase not configured / not reachable. Check your .env values (FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL).');
    process.exit(1);
  }

  const snap = await db.collection('products').get();
  if (snap.empty) {
    console.log('⚠️  No products found in the "products" collection at all.');
    return;
  }

  console.log(`Found ${snap.size} product(s):\n`);

  const catCounts = {};

  snap.docs.forEach(doc => {
    const d = doc.data();
    console.log(`- id: ${doc.id} | name: ${d.name || '(no name)'} | category: "${d.category}" | subcategory: "${d.subcategory || ''}"`);
    const key = String(d.category);
    catCounts[key] = (catCounts[key] || 0) + 1;
  });

  console.log('\n── Distinct category values ──');
  Object.entries(catCounts).forEach(([cat, count]) => {
    console.log(`  "${cat}" → ${count} product(s)`);
  });
}

run().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
