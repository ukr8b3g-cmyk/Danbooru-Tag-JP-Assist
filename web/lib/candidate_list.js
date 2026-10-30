// Candidate rows do not wrap: measure each visible line combination once.
export function createCandidateList(popup, handle, signal) {
  const document = popup.ownerDocument ?? globalThis.document;
  const content = document.createElement('div');
  content.style.overflowAnchor = 'none';
  const top = document.createElement('div');
  const bottom = document.createElement('div');
  for (const spacer of [top, bottom]) spacer.setAttribute('aria-hidden', 'true');
  popup.replaceChildren(content, handle);
  let count = 0, offsets = [0], rows = new Map(), renderRow;
  let first = -1, last = -1;

  function indexAt(y) {
    let low = 0, high = count;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (offsets[middle + 1] <= y) low = middle + 1;
      else high = middle;
    }
    return Math.min(count - 1, low);
  }

  function refresh(force = false) {
    if (!count) return;
    const scroll = popup.scrollTop;
    const start = Math.max(0, indexAt(Math.max(0, scroll - 120)));
    const end = Math.min(count, indexAt(scroll + (popup.clientHeight || 240) + 120) + 1);
    if (!force && start === first && end === last) return;
    first = start; last = end;
    const next = new Map();
    const fragment = document.createDocumentFragment();
    top.style.height = `${offsets[start]}px`;
    bottom.style.height = `${offsets[count] - offsets[end]}px`;
    fragment.append(top);
    for (let i = start; i < end; i++) {
      const row = rows.get(i) ?? renderRow(i);
      next.set(i, row); fragment.append(row);
    }
    fragment.append(bottom);
    content.replaceChildren(fragment);
    rows = next;
  }

  function clear() {
    count = 0; offsets = [0]; rows.clear(); first = last = -1;
    content.replaceChildren();
  }

  popup.addEventListener('scroll', () => refresh(), {passive: true, signal});
  const ResizeObserver = document.defaultView?.ResizeObserver ?? globalThis.ResizeObserver;
  const observer = ResizeObserver ? new ResizeObserver(() => refresh()) : null;
  observer?.observe(popup);
  signal.addEventListener('abort', () => {observer?.disconnect(); clear();}, {once: true});
  return {
    clear, refresh,
    row: index => rows.get(index),
    setItems(length, kindAt, createRow) {
      const scroll = popup.scrollTop;
      clear(); renderRow = createRow;
      if (!length) return;
      const probes = new Map();
      for (let i = 0; i < length; i++) {
        const kind = kindAt(i);
        if (!probes.has(kind)) probes.set(kind, createRow(i));
      }
      content.replaceChildren(...probes.values());
      const heights = new Map([...probes].map(([kind, row]) => [kind, row.getBoundingClientRect().height]));
      count = length;
      offsets = [0];
      for (let i = 0; i < count; i++) offsets.push(offsets[i] + heights.get(kindAt(i)));
      top.style.height = '0px'; bottom.style.height = `${offsets[count]}px`;
      content.replaceChildren(top, bottom);
      popup.scrollTop = scroll;
      refresh(true);
    },
    reveal(index) {
      if (index < 0 || index >= count) return;
      const height = popup.clientHeight || 240;
      if (offsets[index] < popup.scrollTop) popup.scrollTop = offsets[index];
      else if (offsets[index + 1] > popup.scrollTop + height) popup.scrollTop = offsets[index + 1] - height;
      refresh();
    },
  };
}
