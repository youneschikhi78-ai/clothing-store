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
