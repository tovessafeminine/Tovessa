/* ============================================================
   Tovessa - Search System
   Searches all products, pages, categories, keywords
   ============================================================ */
const TOVESSA_SEARCH_INDEX = [
  /* Categories */
  { type: 'category', title: 'All Collections',   keywords: 'all shop products catalog browse', url: 'shop.html',     badge: 'Category' },
  { type: 'category', title: 'Jewelry',            keywords: 'jewelry rings bracelets necklaces earrings bangles sets gold silver', url: 'jewelry.html', badge: 'Category' },
  { type: 'category', title: 'Cosmetics',          keywords: 'cosmetics beauty makeup lipstick blush foundation skincare', url: 'cosmetics.html', badge: 'Category' },
  { type: 'category', title: 'Sale Items',         keywords: 'sale discount offer reduced price deal', url: 'shop.html?cat=sale', badge: 'Sale' },
  /* Pages */
  { type: 'page', title: 'Our Story',        keywords: 'about tovessa story brand lahore founded history',   url: 'about.html',                  badge: 'Page' },
  { type: 'page', title: 'Contact Us',       keywords: 'contact email phone whatsapp address location',           url: 'contact.html',                badge: 'Page' },
  { type: 'page', title: 'Shipping Info',    keywords: 'shipping delivery days free standard',                    url: 'policy.html?page=shipping',   badge: 'Policy' },
  { type: 'page', title: 'Returns Policy',   keywords: 'returns refund exchange 14 day policy',                   url: 'policy.html?page=returns',    badge: 'Policy' },
  { type: 'page', title: 'FAQs',             keywords: 'faq questions answers help support',                      url: 'policy.html?page=faqs',       badge: 'Help'   },
  { type: 'page', title: 'Track Your Order', keywords: 'track order tracking status delivery shipment',           url: 'policy.html?page=track',      badge: 'Tool'   },
  { type: 'page', title: 'My Account',       keywords: 'account login signin signup register profile',            url: 'account.html',                badge: 'Account'}
];

/* Icons per type */
const TYPE_ICON = { product: '📦', category: '📂', page: '📄' };

/* build index on page load */
(async function buildIndex() {
  try {
    const data = typeof apiGet === 'function' ? await apiGet('/products') : await fetch('https://tovessa.onrender.com/api/products').then(r=>r.json());
    const products = data.products || [];
    if (!products.length) return;
    products.forEach(p => {
      TOVESSA_SEARCH_INDEX.push({
        type: 'product',
        title: p.name,
        keywords: (p.name + ' ' + (p.category||'') + ' ' + (p.subcategory||'')).toLowerCase(),
        url: 'product.html?id=' + p.id,
        badge: p.badge || 'Product'
      });
    });
  } catch(err) {
    console.log('Search index fetch error:', err);
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  const toggles   = document.querySelectorAll('#search-toggle, .search-toggle, [aria-label="Search"]');
  const overlay   = document.getElementById('search-overlay');
  const closeBtn  = document.getElementById('search-close');
  const input     = document.getElementById('search-input');
  const results   = document.getElementById('search-results');
  
  if (!overlay) return;

  /* open */
  toggles.forEach(toggle => {
    toggle.addEventListener('click', (e) => {
      e.preventDefault();
      overlay.classList.add('active');
      setTimeout(() => input?.focus(), 120);
    });
  });

  /* close */
  const closeSearch = () => {
    overlay.classList.remove('active');
    if (input) input.value = '';
    if (results) results.innerHTML = '';
  };
  closeBtn?.addEventListener('click', closeSearch);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSearch(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSearch(); });

  /* search */
  input?.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q || q.length < 2) { results.innerHTML = ''; return; }
    
    const matches = TOVESSA_SEARCH_INDEX.filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.keywords.toLowerCase().includes(q)
    );
    
    if (matches.length === 0) {
      results.innerHTML = `<div class="search-no-results">No results for "<em>${q}</em>"</div>`;
      return;
    }
    
    results.innerHTML = matches.map(item => `
      <a href="${item.url}" class="search-result-item" onclick="closeSearchOverlay()">
        <span class="sr-icon">${TYPE_ICON[item.type] || '🔍'}</span>
        <span class="sr-info">
          <span class="sr-title">${highlight(item.title, q)}</span>
          <span class="sr-badge">${item.badge}</span>
        </span>
      </a>`).join('');
  });

  /* Enter key navigation */
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const first = results.querySelector('.search-result-item');
      if (first) first.click();
    }
  });
});

/* highlight matched text */
function highlight(text, query) {
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')})`, 'gi');
  return text.replace(re, '<mark>$1</mark>');
}

/* called from onclick in results */
function closeSearchOverlay() {
  document.getElementById('search-overlay')?.classList.remove('active');
}
