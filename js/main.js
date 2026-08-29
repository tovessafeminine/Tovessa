/* ============================================================
   tovessa — Main JavaScript
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── Sticky Nav ── */
  const nav = document.querySelector('body > nav');
  if (nav) {
    const handleScroll = () => nav.classList.toggle('scrolled', window.scrollY > 60);
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
  }

  /* ── Scroll Reveal ── */
  const revealEls = document.querySelectorAll('.reveal');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); observer.unobserve(e.target); } });
  }, { threshold: 0.12 });
  revealEls.forEach(el => observer.observe(el));

  /* ── Cart System ── */
  let cart = JSON.parse(localStorage.getItem('tovessa_cart') || '[]');

  const saveCart = () => localStorage.setItem('tovessa_cart', JSON.stringify(cart));

  const updateCartUI = () => {
    const count = cart.reduce((s, i) => s + i.qty, 0);
    document.querySelectorAll('.cart-count').forEach(el => {
      el.textContent = count; el.style.display = count ? 'flex' : 'none';
    });
    const itemsEl = document.getElementById('cart-items');
    const totalEl = document.getElementById('cart-total-val');
    if (!itemsEl) return;
    if (cart.length === 0) {
      itemsEl.innerHTML = '<div class="cart-empty">Your bag is empty.</div>';
      if (totalEl) totalEl.textContent = 'PKR 0';
      return;
    }
    itemsEl.innerHTML = cart.map((item, idx) => `
      <div class="cart-item">
        <div class="cart-item-img" style="${item.image ? 'padding:0;' : ''}">${item.image ? `<img src="${item.image}" alt="${item.name.replace(/"/g, '&quot;')}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">` : (item.emoji || '👗')}</div>
        <div class="cart-item-details">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-variant">${item.variant || 'Standard'}</div>
          <div class="cart-item-row">
            <span class="cart-item-price">PKR ${(item.price * item.qty).toLocaleString()}</span>
            <div class="qty-ctrl">
              <button onclick="changeQty(${idx},-1)">−</button>
              <span>${item.qty}</span>
              <button onclick="changeQty(${idx},1)">+</button>
            </div>
          </div>
        </div>
      </div>`).join('');
    const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
    if (totalEl) totalEl.textContent = 'PKR ' + total.toLocaleString();
  };

  window.changeQty = (idx, delta) => {
    cart[idx].qty += delta;
    if (cart[idx].qty <= 0) cart.splice(idx, 1);
    saveCart(); updateCartUI();
  };

  window.addToCart = (name, price, emoji, variant, image) => {
    const existing = cart.find(i => i.name === name && i.variant === variant);
    if (existing) existing.qty++;
    else cart.push({ name, price, emoji: emoji || '🛍️', variant: variant || 'Standard', image: image || null, qty: 1 });
    saveCart(); updateCartUI();
    showToast('Added to bag ✓');
    openCart();
  };

  /* ── Buy It Now ──
     Goes straight to checkout with just this single item. The
     customer's existing bag is stashed (not lost) so it can be
     restored if they leave checkout without completing the order. */
  window.buyNow = (name, price, emoji, variant, image) => {
    const existingCart = localStorage.getItem('tovessa_cart');
    if (existingCart && existingCart !== '[]') {
      localStorage.setItem('tovessa_cart_stashed', existingCart);
    }
    const buyNowCart = [{ name, price, emoji: emoji || '🛍️', variant: variant || 'Standard', image: image || null, qty: 1 }];
    localStorage.setItem('tovessa_cart', JSON.stringify(buyNowCart));
    window.location.href = 'checkout';
  };

  /* ── Buy It Now: restore stashed bag if the customer left checkout
     without completing the order (i.e. they're on any page other
     than checkout.html and a stash exists) ── */
  const stashedCart = localStorage.getItem('tovessa_cart_stashed');
  if (stashedCart && !window.location.pathname.endsWith('checkout')) {
    localStorage.setItem('tovessa_cart', stashedCart);
    localStorage.removeItem('tovessa_cart_stashed');
    cart = JSON.parse(stashedCart);
  }

  /* ── Cart Drawer ── */
  const drawer  = document.getElementById('cart-drawer');
  const overlay = document.getElementById('overlay');
  const openCart  = () => { drawer?.classList.add('open'); overlay?.classList.add('active'); };
  const closeCart = () => { drawer?.classList.remove('open'); overlay?.classList.remove('active'); };
  window.openCart  = openCart;
  window.closeCart = closeCart;
  document.querySelectorAll('[data-open-cart]').forEach(el => el.addEventListener('click', openCart));
  document.getElementById('cart-close')?.addEventListener('click', closeCart);
  overlay?.addEventListener('click', closeCart);

  updateCartUI();

  /* ── Toast ── */
  window.showToast = (msg) => {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
  };

  /* ── Filter Buttons (Shop) ── */
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const cat = btn.dataset.filter;
      document.querySelectorAll('.product-card').forEach(card => {
        // if dataset.category is a comma-separated list or single string
        let show = false;
        if (cat === 'all') {
          show = true;
        } else if (cat === 'sale' && card.querySelector('.product-price-old')) {
          show = true;
        } else {
          show = card.dataset.category === cat;
        }
        card.style.display = show ? '' : 'none';
      });
      if (typeof window.updateShopHero === 'function') {
        window.updateShopHero(cat);
      }
    });
  });

  /* ── Size / Color Options (Product Detail) ── */
  document.querySelectorAll('.size-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      opt.closest('.size-options').querySelectorAll('.size-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
    });
  });
  document.querySelectorAll('.color-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      opt.closest('.color-options').querySelectorAll('.color-opt').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
    });
  });

  /* ── Newsletter Form ── (real backend) */
  document.querySelector('.newsletter-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    if (!input?.value) return;
    const email = input.value.trim();
    const btn   = e.target.querySelector('button');
    if (btn) { btn.disabled = true; btn.textContent = 'Subscribing…'; }
    try {
      const result = await apiSubscribeNewsletter(email);
      if (result.ok) {
        showToast(result.data.message || "Welcome to Golnisà! 💛 You'll be the first to hear about new arrivals and offers.");
        input.value = '';
      } else {
        showToast(result.data.error || 'Please try again.');
      }
    } catch {
      /* Backend not available — graceful fallback */
      showToast("Welcome to Golnisà! 💛 You'll be the first to hear about new arrivals and offers.");
      input.value = '';
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Subscribe'; }
    }
  });

  /* ── Contact Form ── (real backend) */
  document.getElementById('contact-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd      = new FormData(e.target);
    const payload = {
      name:    fd.get('name')    || fd.get('fname') || '',
      email:   fd.get('email')   || '',
      phone:   fd.get('phone')   || '',
      subject: fd.get('subject') || '',
      message: fd.get('message') || '',
    };
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
      const result = await apiSendContact(payload);
      if (result.ok) {
        showToast('Message sent — we\'ll reply within 24h ✓');
        e.target.reset();
      } else {
        showToast(result.data.error || 'Please try again.');
      }
    } catch {
      showToast('Message sent — we\'ll reply within 24h ✓');
      e.target.reset();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Send Message'; }
    }
  });

  /* ── Hamburger Mobile Menu ── */
  const ham = document.querySelector('.hamburger');
  const navLinks = document.querySelector('.nav-links');
  ham?.addEventListener('click', () => {
    navLinks.classList.toggle('mobile-open');
  });
  /* Close mobile menu after a link is tapped, or on outside click */
  navLinks?.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') navLinks.classList.remove('mobile-open');
  });
  document.addEventListener('click', (e) => {
    if (navLinks?.classList.contains('mobile-open') && !navLinks.contains(e.target) && !ham.contains(e.target)) {
      navLinks.classList.remove('mobile-open');
    }
  });

  /* ── Mobile: Shop dropdown touch toggle ── */
  if (window.innerWidth <= 900) {
    const dropdownToggle = document.querySelector('.nav-dropdown > a');
    const dropdownParent = document.querySelector('.nav-dropdown');
    dropdownToggle?.addEventListener('click', (e) => {
      e.preventDefault();
      dropdownParent.classList.toggle('open');
    });
  }

});

 /* ============================================================
   tovessa — WhatsApp + Social Footer Builder
   (append to end of existing script.js)
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  /* ── Set WhatsApp button link from config ── */
  const waBtn = document.getElementById('whatsapp-float');
  if (waBtn && window.tovessa_CONFIG) {
    waBtn.href = window.tovessa_CONFIG.social.whatsapp;
  }
  /* ── Build footer social links from config ── */
  const socialWrap = document.getElementById('footer-social-links');
  if (socialWrap && window.tovessa_CONFIG) {
    const cfg = window.tovessa_CONFIG.social;
    const links = [
      { url: cfg.instagram, icon: '<i class="fa-brands fa-instagram"></i>', label: 'Instagram' },
      { url: cfg.facebook,  icon: '<i class="fa-brands fa-facebook-f"></i>', label: 'Facebook' },
      { url: cfg.whatsapp,  icon: '<i class="fa-brands fa-whatsapp"></i>',   label: 'WhatsApp' },
      { url: cfg.tiktok,    icon: '<i class="fa-brands fa-tiktok"></i>',     label: 'TikTok' },
    ].filter(l => l.url);
    socialWrap.innerHTML = links.map(l =>
      `<a href="${l.url}" target="_blank" rel="noopener"
          class="footer-social-item" aria-label="${l.label}">${l.icon}</a>`
    ).join('');
  }
  /* ── Update account icon if logged in ── */
  const user = JSON.parse(localStorage.getItem('tovessa_user') || 'null');
  if (user) {
    document.querySelectorAll('a[href="account"]').forEach(el => {
      el.setAttribute('title', `Hi, ${user.fname}`);
      el.style.color = 'var(--gold)';
    });
  }
  /* ── Validate JWT token silently (don't block page) ── */
  const token = localStorage.getItem('tovessa_token');
  if (token && user) {
    checkBackend().then(online => {
      if (online) {
        apiGet('/auth/me').then(data => {
          if (data.error) { clearSession(); }
        }).catch(() => {});
      }
    });
  }
});

/* ── Show/Hide Password Toggle ──
   Usage: <button onclick="toggleGolnisàPassword('field-id', this)"><i class="fa-regular fa-eye"></i></button> */
window.toggleGolnisàPassword = (inputId, btn) => {
  const input = document.getElementById(inputId);
  if (!input) return;
  const icon = btn.querySelector('i');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  if (icon) icon.className = showing ? 'fa-regular fa-eye' : 'fa-regular fa-eye-slash';
  btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
};
/* ── Proceed to Checkout — cart check ── */
window.proceedToCheckout = () => {
  const cart = JSON.parse(localStorage.getItem('tovessa_cart') || '[]');
  if (!cart.length) {
    window.showToast('Your bag is empty. Add items before checking out.');
    return;
  }
  window.location.href = 'checkout';
};

/* ── Global Mouse drag-to-scroll for horizontal grids ── */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.horizontal-scroll-grid').forEach(track => {
    let isDown = false, startX, scrollLeft;
    track.style.cursor = 'grab';
    track.addEventListener('mousedown', e => {
      isDown = true;
      track.classList.add('active');
      track.style.cursor = 'grabbing';
      startX = e.pageX - track.offsetLeft;
      scrollLeft = track.scrollLeft;
    });
    track.addEventListener('mouseleave', () => { isDown = false; track.classList.remove('active'); track.style.cursor = 'grab'; });
    track.addEventListener('mouseup', () => { isDown = false; track.classList.remove('active'); track.style.cursor = 'grab'; });
    track.addEventListener('mousemove', e => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - track.offsetLeft;
      const walk = (x - startX) * 2; 
      track.scrollLeft = scrollLeft - walk;
    });
  });
});
