/* ============================================================
   TOVESSA — One-time migration script
   Renames category "catchers" -> "clips" (and subcategory too)
   for every product in Firestore.

   HOW TO RUN (from the backend/ folder):
     node scripts/migrate-catchers-to-clips.js

   Safe to run more than once — it only touches products that
   still have the old "catchers" value.
   ============================================================ */
require('dotenv').config();
const { getDB } = require('../utils/firebase');

async function migrate() {
  const db = getDB();
  if (!db) {
    console.error('❌ Firebase not configured / not reachable. Check your .env values.');
    process.exit(1);
  }

  const snap = await db.collection('products').get();
  if (snap.empty) {
    console.log('No products found in Firestore.');
    return;
  }

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
      console.log(`  → ${doc.id} (${data.name || 'unnamed'}): catchers → clips`);
    }
  });

  if (count === 0) {
    console.log('✅ Nothing to migrate — no products had category "catchers".');
    return;
  }

  await batch.commit();
  console.log(`✅ Done. Updated ${count} product(s) from "catchers" to "clips".`);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
