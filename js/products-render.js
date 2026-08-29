/* ============================================================
   tovessa — Dynamic Product Rendering
   ============================================================ */

const tovessa_CAT_LABELS = {
  // Cosmetics
  'face-cosmetics': 'Face Cosmetics',
  'eye-makeup': 'Eye Makeup',
  'lip-makeup': 'Lip Makeup',
  'nail-cosmetics': 'Nail Cosmetics',
  'skin-care': 'Skin Care',
  'hand-foot-care': 'Hand & Foot Care',
  'makeup-tools': 'Makeup Tools & Brushes',
  'makeup-accessories': 'Makeup Accessories',
  
  // Jewelry
  'bracelets':   'Bracelets',
  'rings':       'Rings',
  'earrings':    'Earrings',
  'necklace':    'Necklaces',
  'bangles':     'Bangles',
  'jewelry-sets': 'Jewelry Sets',
  
  // Deals
  'deals': 'Deals'
};

const CATEGORY_HIERARCHY = {
  'jewelry': ['bracelets', 'rings', 'earrings', 'necklace', 'bangles', 'jewelry-sets'],
  'cosmetics': ['face-cosmetics', 'eye-makeup', 'lip-makeup', 'nail-cosmetics', 'skin-care', 'hand-foot-care', 'makeup-tools', 'makeup-accessories'],
  'deals': ['deals']
};

function velorCatLabel(cat) {
  if (!cat) return '';
  return tovessa_CAT_LABELS[cat.toLowerCase()] || cat;
}

function tovessaProductCardHTML(p) {
  const badge = p.badge ? `<span class="product-badge${p.badge === 'New' ? ' new' : ''}">${p.badge}</span>` : '';
  const oldPrice = p.priceOld
    ? `<span class="product-price-old">PKR ${Number(p.priceOld).toLocaleString()}</span>`
    : '';
  const emoji = p.emoji || '🛍️';
  const variant = ((p.colors && p.colors[0]) || (p.sizes && p.sizes[0]) || 'Standard').replace(/\\/g, '\\\\').replace(/'/g, "\\''").replace(/"/g, '&quot;');
  const safeName = p.name.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  const mainImage = (p.images && p.images.length) ? p.images[0] : null;
  const hasVideo  = !!p.video;

  const cat = p.category === 'catchers' ? 'clips' : p.category;
  const subcat = p.subcategory === 'catchers' ? 'clips' : p.subcategory;
  const resolvedCat = subcat || cat;

  let mainCat = 'unknown';
  for (const [mc, subs] of Object.entries(CATEGORY_HIERARCHY)) {
    if (subs.includes(resolvedCat)) {
      mainCat = mc;
      break;
    }
  }

  const mediaHTML = mainImage
    ? `<img src="${mainImage}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;" loading="lazy"/>`
    : hasVideo
      ? `<video src="${p.video}#t=0.1" muted preload="metadata" playsinline style="width:100%;height:100%;object-fit:cover;"></video>`
      : `<div style="width:100%;height:100%;background:var(--gold-light);display:flex;align-items:center;justify-content:center;font-size:2rem;color:var(--gold);">${emoji}</div>`;

  // Encode data safely for data-attributes (JSON encoded)
  const cardData = encodeURIComponent(JSON.stringify({
    name: p.name,
    price: p.price,
    emoji: emoji,
    variant: variant,
    image: mainImage || ''
  }));

  return `
    <div class="product-card" data-cat="${resolvedCat}" data-main-cat="${mainCat}" data-additional-cats="${(p.additionalCategories || []).join(',')}">
      <div class="product-img-wrap">
        ${badge}
        <a href="product.html?id=${p.id}">${mediaHTML}</a>
      </div>
      <div class="product-info">
        <p class="product-cat">${velorCatLabel(subcat || cat)}</p>
        <h3 class="product-name"><a href="product.html?id=${p.id}">${p.name}</a></h3>
        <div class="product-price">PKR ${Number(p.price).toLocaleString()} ${oldPrice}</div>
        <div class="product-action-row" style="display:flex;gap:8px;margin-top:12px;">
          <button class="btn-primary product-add" style="flex:1;font-size:0.8rem;padding:8px;" data-card="${cardData}" data-action="add">Add to Bag</button>
          <button class="btn-outline product-buy" style="flex:1;font-size:0.8rem;padding:8px;" data-card="${cardData}" data-action="buy">Buy it Now</button>
        </div>
      </div>
    </div>
  `;
}

function tovessaEmptyState(msg) {
  return `<div style="grid-column:1/-1;text-align:center;padding:60px 20px;background:#fcfbf9;border-radius:12px;border:1px dashed #e5d5c5;color:var(--muted);"><i class="fa-solid fa-box-open" style="font-size:2rem;color:var(--gold);margin-bottom:16px;"></i><p>${msg}</p></div>`;
}

function tovessaReInitCards(container) {
  // Video hover
  container.querySelectorAll('.product-img-wrap').forEach(wrap => {
    const vid = wrap.querySelector('video');
    if (vid) {
      wrap.addEventListener('mouseenter', () => vid.play().catch(e=>e));
      wrap.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime=0; });
    }
  });

  // Button clicks via data attributes — avoids all inline onclick quoting issues
  container.querySelectorAll('button[data-card]').forEach(btn => {
    // Remove old listeners by cloning
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const d = JSON.parse(decodeURIComponent(fresh.dataset.card));
        const action = fresh.dataset.action;
        const tryAction = () => {
          if (action === 'add' && typeof window.addToCart === 'function') {
            window.addToCart(d.name, d.price, d.emoji, d.variant, d.image);
          } else if (action === 'buy' && typeof window.buyNow === 'function') {
            window.buyNow(d.name, d.price, d.emoji, d.variant, d.image);
          } else {
            /* addToCart not ready yet — wait for DOMContentLoaded */
            window.addEventListener('DOMContentLoaded', tryAction, { once: true });
          }
        };
        tryAction();
      } catch(err) {
        console.error('Button action error:', err);
      }
    });
  });
}

function tovessaSetupShopFilters(products, grid, mainCat) {
  const urlParams = new URLSearchParams(window.location.search);
  let activeMain = mainCat || 'all';
  let activeSub = urlParams.get('cat');
  let activeBrand = urlParams.get('brand');

  if (activeSub === 'catchers') activeSub = 'clips';

  // If initial URL param is actually a main category
  if (activeSub === 'jewelry' || activeSub === 'cosmetics') {
    activeMain = activeSub;
    activeSub = null;
  }
  // Check if initial URL param is actually a subcategory
  if (activeSub) {
    for (const [mc, subs] of Object.entries(CATEGORY_HIERARCHY)) {
      if (subs.includes(activeSub)) {
        activeMain = mc;
        break;
      }
    }
  }

  const collectionsBtns = document.querySelectorAll('#sidebar-collections .sidebar-link');
  const subContainer = document.getElementById('sub-filter-container');
  const subList = document.getElementById('sidebar-sub-collections');
  const sortBtns = document.querySelectorAll('#sidebar-sort .sidebar-link');
  const mobileToggle = document.getElementById('mobile-sidebar-toggle');
  
  // Hide Collections sidebar block if a brand is selected
  const collectionsBlock = document.getElementById('sidebar-collections')?.closest('.sidebar-block');
  if (collectionsBlock) {
    if (activeBrand) {
      collectionsBlock.style.display = 'none';
      subContainer.style.display = 'none';
    } else {
      collectionsBlock.style.display = 'block';
    }
  }
  const sidebar = document.querySelector('.shop-sidebar');

  if (mobileToggle && sidebar) {
    mobileToggle.addEventListener('click', () => {
      sidebar.classList.toggle('active');
    });
    // close on clicking outside
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('active') && !sidebar.contains(e.target) && e.target !== mobileToggle && !mobileToggle.contains(e.target)) {
        sidebar.classList.remove('active');
      }
    });
  }

  function renderSubFilters(mc) {
    if (mc === 'all' || mc === 'deals' || !CATEGORY_HIERARCHY[mc]) {
      if (subContainer) subContainer.style.display = 'none';
      if (subList) subList.innerHTML = '';
      return;
    }
    const subs = CATEGORY_HIERARCHY[mc];
    if (subList) {
      subList.innerHTML = `<li><button class="sidebar-link ${!activeSub ? 'active' : ''}" data-sub-filter="all-${mc}">All ${mc.charAt(0).toUpperCase() + mc.slice(1)}</button></li>` + 
      subs.map(s => {
        const isActive = activeSub === s ? 'active' : '';
        return `<li><button class="sidebar-link ${isActive}" data-sub-filter="${s}">${tovessa_CAT_LABELS[s.toLowerCase()] || s}</button></li>`;
      }).join('');
      
      subContainer.style.display = 'block';

      // Bind sub buttons
      subList.querySelectorAll('.sidebar-link').forEach(btn => {
        btn.addEventListener('click', () => {
          subList.querySelectorAll('.sidebar-link').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeSub = btn.dataset.subFilter;
          if (activeSub.startsWith('all-')) activeSub = null;
          applyFiltersAndSort();
          if (window.innerWidth <= 991 && sidebar) sidebar.classList.remove('active'); // auto-close on mobile
        });
      });
    }
  }

  let activeSort = 'featured';

  function applyFiltersAndSort() {
    let filtered = products.filter(p => {
      const c = p.category === 'catchers' ? 'clips' : p.category;
      const s = p.subcategory === 'catchers' ? 'clips' : p.subcategory;
      const additional = p.additionalCategories || [];
      
      let show = false;
      if (activeMain === 'all') {
        show = true;
      } else {
        const inMain = CATEGORY_HIERARCHY[activeMain]?.includes(s) || CATEGORY_HIERARCHY[activeMain]?.includes(c) || additional.some(a => CATEGORY_HIERARCHY[activeMain]?.includes(a));
        if (inMain) {
          if (!activeSub) show = true;
          else show = (s === activeSub || c === activeSub || additional.includes(activeSub));
        }
      }
      
      if (show && activeBrand) {
        show = (p.brand && p.brand.toLowerCase() === activeBrand.toLowerCase());
      }
      
      return show;
    });

    if (activeSort === 'price-asc') {
      filtered.sort((a, b) => Number(a.price) - Number(b.price));
    } else if (activeSort === 'price-desc') {
      filtered.sort((a, b) => Number(b.price) - Number(a.price));
    }

    if (filtered.length === 0) {
      grid.innerHTML = tovessaEmptyState('No products found in this category.');
    } else {
      grid.innerHTML = filtered.map(tovessaProductCardHTML).join('');
      tovessaReInitCards(grid);
    }

    // Update Hero Text if function exists
    if (window.updateShopHero) {
      window.updateShopHero(activeSub || activeMain, activeBrand);
    }
    
    // Update URL
    let urlStr = window.location.pathname;
    const newCat = activeSub || activeMain;
    let params = new URLSearchParams();
    
    if (newCat && newCat !== 'all' && newCat !== mainCat) {
      params.set('cat', newCat);
    }
    if (activeBrand) {
      params.set('brand', activeBrand);
    }
    
    const qs = params.toString();
    if (qs) urlStr += '?' + qs;
    
    window.history.replaceState(null, '', urlStr);
  }

  if (collectionsBtns.length > 0) {
    // Bind Main buttons
    collectionsBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetMain = btn.dataset.mainFilter;
        const isJewelryPage = window.location.pathname.includes('jewelry.html');
        const isCosmeticsPage = window.location.pathname.includes('cosmetics.html');

        if (targetMain === 'jewelry' && !isJewelryPage) { window.location.href = 'jewelry.html'; return; }
        if (targetMain === 'cosmetics' && !isCosmeticsPage) { window.location.href = 'cosmetics.html'; return; }
        if (targetMain === 'all' && (isJewelryPage || isCosmeticsPage)) { window.location.href = 'shop.html'; return; }

        collectionsBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeMain = targetMain;
        activeSub = null;
        renderSubFilters(activeMain);
        applyFiltersAndSort();
        if (window.innerWidth <= 991 && sidebar) sidebar.classList.remove('active');
      });
    });

    // Bind Sort buttons
    sortBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        sortBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeSort = btn.dataset.sort;
        applyFiltersAndSort();
        if (window.innerWidth <= 991 && sidebar) sidebar.classList.remove('active');
      });
    });

    // Init
    if (activeMain) {
      collectionsBtns.forEach(b => b.classList.remove('active'));
      const b = Array.from(collectionsBtns).find(x => x.dataset.mainFilter === activeMain);
      if (b) b.classList.add('active');
    }
    renderSubFilters(activeMain);
    applyFiltersAndSort();
  } else {
    // Fallback if no sidebar is found (just render all)
    applyFiltersAndSort();
  }
}

async function tovessaRenderShopGrid() {
  const grid = document.querySelector('#shop-products-grid, .products-grid');
  if (!grid) return;

  const mainCat = grid.getAttribute('data-main-cat');

  try {
    const data = await apiGet('/products');
    let products = data.products || [];
    
    // STRICTLY FILTER OUT ANYTHING THAT IS NOT JEWELRY OR COSMETICS
    products = products.filter(p => {
      const c = p.category === 'catchers' ? 'clips' : p.category;
      const s = p.subcategory === 'catchers' ? 'clips' : p.subcategory;
      const resolvedCat = s || c;
      return CATEGORY_HIERARCHY['jewelry'].includes(resolvedCat) || CATEGORY_HIERARCHY['cosmetics'].includes(resolvedCat);
    });

    // We do NOT pre-filter products here anymore, so that the sidebar "All Collections" works correctly on any page!
    // The sorting/filtering logic inside tovessaSetupShopFilters will handle all filtering!

    if (!products.length) {
      grid.innerHTML = tovessaEmptyState('No products available right now. Please check back soon.');
      return;
    }

    tovessaSetupShopFilters(products, grid, mainCat);
  } catch (err) {
    console.error('Failed to load products:', err);
    grid.innerHTML = tovessaEmptyState('No products available');
  }
}

/* ── Load & render featured and pinned grids (index.html homepage) ── */
async function tovessaRenderHomepageGrids() {
  const isHome = document.getElementById('featured-jewelry');
  if (!isHome) return;

  try {
    const data = await apiGet('/products');
    let allProducts = data.products || [];

    // STRICTLY FILTER OUT ANYTHING THAT IS NOT JEWELRY OR COSMETICS
    allProducts = allProducts.filter(p => {
      const c = p.category === 'catchers' ? 'clips' : p.category;
      const s = p.subcategory === 'catchers' ? 'clips' : p.subcategory;
      const resolvedCat = s || c;
      return CATEGORY_HIERARCHY['jewelry'].includes(resolvedCat) || CATEGORY_HIERARCHY['cosmetics'].includes(resolvedCat);
    });

    // --- 1. Render Pinned Collections ---
    const pinnedRes = await apiGet('/admin/pinned').catch(e => null);
    const pinnedData = pinnedRes && pinnedRes.pinned ? pinnedRes.pinned : [];
    const pinnedContainer = document.getElementById('pinned-collections-wrapper');
    if (pinnedContainer && pinnedData.length > 0) {
      pinnedContainer.innerHTML = '';
      pinnedData.forEach(pin => {
        const pinProducts = allProducts.filter(p => {
          const c = p.category === 'catchers' ? 'clips' : p.category;
          const s = p.subcategory === 'catchers' ? 'clips' : p.subcategory;
          const additional = p.additionalCategories || [];
          return (c === pin.id || s === pin.id || additional.includes(pin.id));
        });
        if (pinProducts.length > 0) {
          const section = document.createElement('section');
          section.className = 'collection-section';
          section.style.padding = '40px 0 0 0';

          const catUrl = (() => {
            if (CATEGORY_HIERARCHY['jewelry'].includes(pin.id)) return `jewelry.html?cat=${pin.id}`;
            if (CATEGORY_HIERARCHY['cosmetics'].includes(pin.id)) return `cosmetics.html?cat=${pin.id}`;
            return `shop.html?cat=${pin.id}`;
          })();

          const rowId = `pinrow-${pin.id}`;
          section.innerHTML = `
            <div class="container">
              <div class="section-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
                <h2 style="font-size:1.6rem;margin:0;">${pin.name}</h2>
                <div style="display:flex; gap: 8px; align-items:center;">
                  <a href="${catUrl}" style="font-size:0.75rem;letter-spacing:0.12em;text-transform:uppercase;color:var(--gold);text-decoration:none;font-family:var(--font-ui); margin-left: 12px;">View All →</a>
                </div>
              </div>
              <div class="pinned-scroll-track" id="${rowId}" style="display:flex;overflow-x:auto;gap:12px;padding-bottom:20px;scroll-snap-type:x mandatory;cursor:grab;-webkit-overflow-scrolling:touch;scrollbar-width:none;-ms-overflow-style:none;">
                ${pinProducts.map(p => {
                  let html = tovessaProductCardHTML(p);
                  return html.replace('class="product-card"', 'class="product-card pin-card" style="flex:0 0 220px;min-width:220px;scroll-snap-align:start;"');
                }).join('')}
              </div>
            </div>
          `;
          pinnedContainer.appendChild(section);
          tovessaReInitCards(section);

          /* ── Mouse drag-to-scroll ── */
          const track = section.querySelector(`#${rowId}`);
          if (track) {
            let isDown = false, startX, scrollLeft;
            track.addEventListener('mousedown', e => {
              isDown = true; track.style.cursor = 'grabbing';
              startX = e.pageX - track.offsetLeft;
              scrollLeft = track.scrollLeft;
            });
            track.addEventListener('mouseleave', () => { isDown = false; track.style.cursor = 'grab'; });
            track.addEventListener('mouseup',    () => { isDown = false; track.style.cursor = 'grab'; });
            track.addEventListener('mousemove',  e => {
              if (!isDown) return;
              e.preventDefault();
              const x = e.pageX - track.offsetLeft;
              track.scrollLeft = scrollLeft - (x - startX) * 1.5;
            });
          }
        }
      });
    }

    // --- 2. Render Featured Rows (grouped by Main Category) ---
    const featuredProducts = allProducts.filter(p => p.featured);
    
    // Jewelry
    const jewGrid = document.getElementById('featured-jewelry-grid');
    if (jewGrid) {
      const jProds = featuredProducts.filter(p => CATEGORY_HIERARCHY['jewelry'].includes(p.subcategory || p.category));
      
      if (jProds.length) {
        jewGrid.innerHTML = jProds.map(p => tovessaProductCardHTML(p).replace('class="product-card"', 'class="product-card" style="flex: 0 0 280px; scroll-snap-align: start;"')).join('');
        document.getElementById('featured-jewelry').style.display = 'block';
      } else {
        document.getElementById('featured-jewelry').style.display = 'none';
      }
      tovessaReInitCards(jewGrid);
    }

    // Cosmetics
    const cosGrid = document.getElementById('featured-cosmetics-grid');
    if (cosGrid) {
      const cProds = featuredProducts.filter(p => {
        const additional = p.additionalCategories || [];
        return CATEGORY_HIERARCHY['cosmetics'].includes(p.subcategory || p.category) || additional.some(a => CATEGORY_HIERARCHY['cosmetics'].includes(a));
      });
      
      if (cProds.length) {
        cosGrid.innerHTML = cProds.map(p => tovessaProductCardHTML(p).replace('class="product-card"', 'class="product-card" style="flex: 0 0 280px; scroll-snap-align: start;"')).join('');
        document.getElementById('featured-cosmetics').style.display = 'block';
      } else {
        document.getElementById('featured-cosmetics').style.display = 'none';
      }
      tovessaReInitCards(cosGrid);
    }

  } catch (err) {
    console.error('Failed to load homepage products:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('shop-products-grid') || document.querySelector('.shop-layout')) {
    tovessaRenderShopGrid();
  }
  if (document.getElementById('featured-jewelry')) {
    tovessaRenderHomepageGrids();
  }
});
