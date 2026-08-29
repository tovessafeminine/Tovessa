/* ============================================================
   TOVESSA — Site Configuration
   Edit this file to update your WhatsApp number, social links, etc.
   ============================================================ */
const TOVESSA_CONFIG = {
  /* ── WhatsApp ──
     Format: country code + number, no spaces, no +
     Example: Pakistan 0315-0727131 → '923150727131'          */
  whatsapp: {
    number:  '923150727131',
    message: 'Hi! I found you on Tovessa and I have a question.',
  },
  /* ── Social Media ──
     Replace these URLs with your actual profile links         */
  social: {
    instagram: 'https://www.instagram.com/tovessa/',
    facebook:  'https://www.facebook.com/tovessa',
    whatsapp:  '',                                    // auto-built from number above
    tiktok:    '',                                    // optional — leave blank to hide
  },
  /* ── Contact ── */
  contact: {
    email:    'hello@tovessa.com',
    phone:    '+92 315 0727131',
    location: 'Lahore, Punjab, Pakistan',
    hours:    'Monday – Saturday: 10am – 7pm',
  },
};
/* Auto-build WhatsApp URL */
TOVESSA_CONFIG.social.whatsapp =
  `https://wa.me/${TOVESSA_CONFIG.whatsapp.number}` +
  `?text=${encodeURIComponent(TOVESSA_CONFIG.whatsapp.message)}`;
/* Make globally available */
window.TOVESSA_CONFIG = TOVESSA_CONFIG;

/* ============================================================
   AUTO-FILL CONTACT DETAILS
   Any element with data-tovessa="email" / "phone" / "location" / "hours"
   gets its text (and href, for <a> tags) filled in automatically from
   TOVESSA_CONFIG.contact above.
   ============================================================ */
function applyTovessaContactInfo(root) {
  root = root || document;
  const c = TOVESSA_CONFIG.contact;

  root.querySelectorAll('[data-tovessa="email"]').forEach(el => {
    el.textContent = c.email;
    if (el.tagName === 'A') el.href = `mailto:${c.email}`;
  });
  root.querySelectorAll('[data-tovessa="phone"]').forEach(el => {
    el.textContent = c.phone;
    if (el.tagName === 'A') el.href = `tel:${c.phone.replace(/\s+/g, '')}`;
  });
  root.querySelectorAll('[data-tovessa="location"]').forEach(el => {
    el.textContent = c.location;
  });
  root.querySelectorAll('[data-tovessa="hours"]').forEach(el => {
    el.textContent = c.hours;
  });
}
/* Run once the page loads */
document.addEventListener('DOMContentLoaded', () => applyTovessaContactInfo());
/* Expose globally so pages that inject HTML later (like policy.html)
   can re-run it on the newly added content */
window.applyTovessaContactInfo = applyTovessaContactInfo;
