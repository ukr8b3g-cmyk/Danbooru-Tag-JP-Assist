const tooltipSelector = '.p-tooltip[role="tooltip"][data-pc-name="tooltip"]';

export function removeStaleTooltips(root = document) {
  const tooltips = [...root.querySelectorAll(tooltipSelector)];
  if (!tooltips.length) return;
  const liveIds = new Set();
  for (const host of root.querySelectorAll('[data-pd-tooltip], [aria-describedby]')) {
    // PrimeVue puts the directive on a wrapper but owns input tooltips on its input.
    for (const owner of [host, host.querySelector?.('input')]) {
      if (!owner?.isConnected || !owner.getClientRects().length) continue;
      if (getComputedStyle(owner).visibility === 'hidden') continue;
      for (const id of [owner.$_ptooltipId, owner.$_ptooltipIdAttr,
        ...(owner.getAttribute('aria-describedby') ?? '').split(/\s+/)]) {
        if (id) liveIds.add(id);
      }
    }
  }
  const seen = new Set();
  for (const tooltip of tooltips) {
    // Duplicate IDs make PrimeVue position/remove only the first element. The
    // remaining unpositioned copies get stuck at the corner after Settings closes.
    if (!tooltip.id || !liveIds.has(tooltip.id) || !tooltip.hasAttribute('data-p-position') || seen.has(tooltip.id)) {
      tooltip.remove();
    } else seen.add(tooltip.id);
  }
}

export function installTooltipCleanup() {
  let pending = false;
  const schedule = () => {
    if (pending || !document.querySelector(tooltipSelector)) return;
    pending = true;
    // Let PrimeVue finish assigning ownership and placement before inspecting it.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pending = false;
      removeStaleTooltips();
    }));
  };
  const observer = new MutationObserver(records => {
    if (records.some(record => record.removedNodes.length || [...record.addedNodes].some(node =>
      node.nodeType === 1 && (node.matches(tooltipSelector) || node.querySelector(tooltipSelector))))) schedule();
  });
  observer.observe(document.body, {childList: true, subtree: true});
  document.addEventListener('pointerdown', schedule, true);
  document.addEventListener('keydown', event => {if (event.key === 'Escape') schedule();}, true);
  schedule();
}
