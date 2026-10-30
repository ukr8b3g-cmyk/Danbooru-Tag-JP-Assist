const tooltipSelector = '.p-tooltip[role="tooltip"][data-pc-name="tooltip"]';
const ownerSelector = '[data-pd-tooltip], [aria-describedby]';
const settingsSelector = '[data-setting-id^="DanbooruTagJPAssist."], [id^="DanbooruTagJPAssist."]';

function rememberOwnedTooltips(root, ownedIds) {
  const hosts = [...root.querySelectorAll(ownerSelector)];
  if (root.matches?.(ownerSelector)) hosts.push(root);
  for (const host of hosts) {
    if (!host.closest(settingsSelector)) continue;
    for (const owner of [host, host.querySelector?.('input')]) {
      if (!owner) continue;
      for (const id of [owner.$_ptooltipId, owner.$_ptooltipIdAttr,
        ...(owner.getAttribute('aria-describedby') ?? '').split(/\s+/)]) {
        if (id) ownedIds.add(id);
      }
    }
  }
}

export function removeStaleTooltips(root = document, ownedIds = new Set()) {
  rememberOwnedTooltips(root, ownedIds);
  const tooltips = [...root.querySelectorAll(tooltipSelector)].filter(tooltip => ownedIds.has(tooltip.id));
  if (!tooltips.length) { ownedIds.clear(); return; }
  const liveIds = new Set();
  for (const host of root.querySelectorAll(ownerSelector)) {
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
  for (const id of ownedIds) if (!seen.has(id)) ownedIds.delete(id);
}

export function installTooltipCleanup() {
  const ownedIds = new Set();
  let pending = false;
  const schedule = () => {
    rememberOwnedTooltips(document, ownedIds);
    if (pending || !ownedIds.size || !document.querySelector(tooltipSelector)) return;
    pending = true;
    // Let PrimeVue finish assigning ownership and placement before inspecting it.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      pending = false;
      removeStaleTooltips(document, ownedIds);
    }));
  };
  const observer = new MutationObserver(records => {
    for (const record of records) for (const node of record.removedNodes) {
      if (node.nodeType === 1) rememberOwnedTooltips(node, ownedIds);
    }
    if (records.some(record => record.removedNodes.length || [...record.addedNodes].some(node =>
      node.nodeType === 1 && (node.matches(tooltipSelector) || node.querySelector(tooltipSelector))))) schedule();
  });
  observer.observe(document.body, {childList: true, subtree: true});
  document.addEventListener('pointerdown', schedule, true);
  document.addEventListener('keydown', event => {if (event.key === 'Escape') schedule();}, true);
  schedule();
}
