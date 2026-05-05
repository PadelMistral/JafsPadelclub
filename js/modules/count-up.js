/* ═══════════════════════════════════════════════════════════
   MEJORA 1: COUNT-UP ANIMATION — Números que suben de 0
   ═══════════════════════════════════════════════════════════ */
export function animateCountUp(element, endValue, duration = 1200) {
  if (!element) return;
  const isFloat = String(endValue).includes('.');
  const end = parseFloat(endValue) || 0;
  if (end === 0 || isNaN(end)) { element.textContent = endValue; return; }

  const start = 0;
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease-out cubic for natural deceleration
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + (end - start) * eased;

    if (isFloat) {
      element.textContent = current.toFixed(2);
    } else {
      element.textContent = Math.round(current);
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = endValue; // Ensure exact final value
    }
  }

  requestAnimationFrame(update);
}

/**
 * Auto-detect and animate all stat elements on the page.
 * Call after data has been rendered.
 */
export function animateAllStats(selector = '.hv2-xp-val, .lb-pts, .rank-number') {
  document.querySelectorAll(selector).forEach(el => {
    const raw = el.textContent.trim();
    if (raw === '---' || raw === '--' || raw === '?' || raw === '') return;
    const num = parseFloat(raw);
    if (isNaN(num)) return;
    animateCountUp(el, raw, 1400);
  });
}
