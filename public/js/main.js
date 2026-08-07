function changeQty(delta) {
  const input = document.getElementById('qty');
  if (!input) return;
  const val = parseInt(toEnDigits(input.value), 10) || 1;
  const max = parseInt(input.max, 10) || 999;
  const next = Math.max(1, Math.min(max, val + delta));
  input.value = next;
}

function toEnDigits(s) {
  return String(s)
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

document.addEventListener('click', (e) => {
  const drop = document.getElementById('userDrop');

  const toggle = e.target.closest('[data-toggle-dropdown]');
  if (toggle && drop) {
    drop.classList.toggle('open');
    return;
  }

  const qtyBtn = e.target.closest('[data-qty]');
  if (qtyBtn) {
    changeQty(parseInt(qtyBtn.getAttribute('data-qty'), 10));
    return;
  }

  if (drop && !e.target.closest('.user-menu')) drop.classList.remove('open');
});

const nav = document.getElementById('mainNav');
const navToggle = document.querySelector('[data-nav-toggle]');
if (navToggle && nav) {
  navToggle.addEventListener('click', () => nav.classList.toggle('open'));
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) nav.classList.remove('open');
  });
}

const adminSidebar = document.getElementById('adminSidebar');
const adminToggle = document.querySelector('[data-admin-toggle]');
if (adminToggle && adminSidebar) {
  adminToggle.addEventListener('click', () => adminSidebar.classList.toggle('open'));
  adminSidebar.addEventListener('click', (e) => {
    if (e.target.closest('a')) adminSidebar.classList.remove('open');
  });
  document.addEventListener('click', (e) => {
    if (adminSidebar.classList.contains('open') && !e.target.closest('.admin-sidebar') && !e.target.closest('[data-admin-toggle]')) {
      adminSidebar.classList.remove('open');
    }
  });
}
