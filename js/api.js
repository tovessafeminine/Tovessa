/* ============================================================
   TOVESSA — Shared API Helper
   Used by all frontend pages to talk to the backend.
   ============================================================ */

const TOVESSA_API = (function() {
  const origin = window.location.origin || '';
  if (origin.includes('localhost') || origin.includes('127.0.0.1') || origin === 'null' || origin.startsWith('file')) {
    return 'http://localhost:3002/api';
  }
  return origin + '/api';
})();

/* ── Get stored JWT token ── */
function getToken() {
  return localStorage.getItem('tovessa_token');
}

/* ── Auth headers ── */
function apiHeaders(includeAuth = true) {
  const h = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (includeAuth && token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

/* ── Generic GET ── */
async function apiGet(endpoint) {
  const res = await fetch(`${TOVESSA_API}${endpoint}`, {
    headers: apiHeaders(),
  });
  return res.json();
}

/* ── Generic POST ──
   NOTE: our backend is on Render's free tier, which can take 30-60s
   to wake up after being idle. We give it generous time before giving
   up, so a slow cold-start doesn't look like "nothing happened". */
async function apiPost(endpoint, data, requireAuth = false) {
  let res;
  try {
    res = await fetch(`${TOVESSA_API}${endpoint}`, {
      method: 'POST',
      headers: apiHeaders(requireAuth),
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(75000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return { ok: false, status: 0, data: { error: 'Server took too long to respond. Please try again in a moment.' } };
    }
    throw err;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    body = { error: 'Server returned an unexpected response. Please try again.' };
  }
  return { ok: res.ok, status: res.status, data: body };
}

/* ── Generic PATCH ── */
async function apiPatch(endpoint, data) {
  const res = await fetch(`${TOVESSA_API}${endpoint}`, {
    method: 'PATCH',
    headers: apiHeaders(),
    body: JSON.stringify(data),
  });
  return { ok: res.ok, data: await res.json() };
}

/* ── Auth: Register ── */
async function apiRegister({ fname, lname, email, phone, password }) {
  return apiPost('/auth/register', { fname, lname, email, phone, password });
}

/* ── Auth: Login ── */
async function apiLogin({ email, password }) {
  return apiPost('/auth/login', { email, password });
}

/* ── Save auth session ── */
function saveSession(token, user) {
  localStorage.setItem('tovessa_token', token);
  localStorage.setItem('tovessa_user', JSON.stringify(user));
}

/* ── Clear auth session ── */
function clearSession() {
  localStorage.removeItem('tovessa_token');
  localStorage.removeItem('tovessa_user');
}

/* ── Get current user from localStorage ── */
function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('tovessa_user') || 'null');
  } catch { return null; }
}

/* ── Place order ── */
async function apiPlaceOrder({ items, delivery, paymentMethod, deliveryMethod, couponCode }) {
  return apiPost('/orders', { items, delivery, paymentMethod, deliveryMethod, couponCode });
}

/* ── Validate a coupon code against a subtotal — public, no auth needed ── */
async function apiValidateCoupon(code, subtotal) {
  return apiPost('/coupons/validate', { code, subtotal });
}

/* ── Get orders by user email ── */
async function apiGetUserOrders(email) {
  return apiGet(`/orders/user/${encodeURIComponent(email)}`);
}

/* ── Newsletter subscribe ── */
async function apiSubscribeNewsletter(email) {
  return apiPost('/newsletter', { email });
}

/* ── Contact form ── */
async function apiSendContact({ name, email, phone, subject, message }) {
  return apiPost('/contact', { name, email, phone, subject, message });
}

/* ── Check if backend is reachable ── */
async function checkBackend() {
  try {
    const res = await fetch(`${TOVESSA_API}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/* ── Submit a review ── */
async function apiSubmitReview({ orderId, rating, text, city, customerName, customerEmail }) {
  return apiPost('/reviews', { orderId, rating, text, city, customerName, customerEmail });
}

/* ── Get all approved reviews ── */
async function apiGetReviews() {
  return apiGet('/reviews');
}

/* ══════════════════════════════════════════════
   LIVE VISITOR TRACKING
   Har page load par automatically start hota hai.
   ══════════════════════════════════════════════ */
(function initVisitorTracking() {
  /* Generate a unique session ID for this browser tab */
  let sessionId = sessionStorage.getItem('tovessa_sid');
  if (!sessionId) {
    sessionId = 'v-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
    sessionStorage.setItem('tovessa_sid', sessionId);
  }

  const page = window.location.pathname.replace(/.*\//, '/') || '/';

  function ping() {
    fetch(`${TOVESSA_API}/visitors/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, page }),
    }).catch(() => {}); /* silent fail — don't break site */
  }

  /* Ping immediately on page load */
  ping();

  /* Ping every 25 seconds to keep session alive */
  const interval = setInterval(ping, 25000);

  /* Tell server when tab closes */
  window.addEventListener('beforeunload', () => {
    clearInterval(interval);
    navigator.sendBeacon(
      `${TOVESSA_API}/visitors/leave`,
      JSON.stringify({ sessionId })
    );
  });
})();
