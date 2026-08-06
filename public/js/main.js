function changeQty(delta) {
  const input = document.getElementById('qty');
  if (!input) return;
  const val = parseInt(input.value, 10) || 1;
  const max = parseInt(input.max, 10) || 999;
  const next = Math.max(1, Math.min(max, val + delta));
  input.value = next;
}

document.addEventListener('click', (e) => {
  const drop = document.getElementById('userDrop');
  if (drop && !e.target.closest('.user-menu')) drop.classList.remove('open');
});
