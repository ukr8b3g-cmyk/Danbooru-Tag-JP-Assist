// Measure textarea text in an untransformed mirror; convert back to viewport pixels.
export function caretRect(textarea) {
  const document = textarea.ownerDocument ?? globalThis.document;
  const view = document.defaultView ?? globalThis.window;
  const rect = textarea.getBoundingClientRect();
  const style = view.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  for (const key of ['fontFamily','fontSize','fontWeight','fontStyle','fontVariant','fontStretch',
    'lineHeight','letterSpacing','wordSpacing','textAlign','textIndent','textTransform',
    'direction','tabSize','paddingTop','paddingRight','paddingBottom','paddingLeft','wordBreak']) {
    mirror.style[key] = style[key];
  }
  Object.assign(mirror.style, {position:'fixed', left:'0', top:'0', visibility:'hidden',
    pointerEvents:'none', boxSizing:'border-box', width:`${textarea.clientWidth}px`,
    whiteSpace:textarea.wrap === 'off' ? 'pre' : 'pre-wrap', overflowWrap:'break-word'});
  mirror.textContent = textarea.value.slice(0, textarea.selectionEnd);
  const marker = document.createElement('span');
  marker.textContent = textarea.value.slice(textarea.selectionEnd) || '\u200b';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  try {
    const line = marker.getClientRects()[0];
    const origin = mirror.getBoundingClientRect();
    const sx = rect.width / textarea.offsetWidth, sy = rect.height / textarea.offsetHeight;
    const left = rect.left + (textarea.clientLeft + line.left - origin.left - textarea.scrollLeft) * sx;
    const top = rect.top + (textarea.clientTop + line.top - origin.top - textarea.scrollTop) * sy;
    const bottom = top + line.height * sy;
    const clipTop = rect.top + textarea.clientTop * sy;
    const clipBottom = clipTop + textarea.clientHeight * sy;
    const clipLeft = rect.left + textarea.clientLeft * sx;
    const clipRight = clipLeft + textarea.clientWidth * sx;
    if (bottom <= clipTop || top >= clipBottom || left < clipLeft - 1 || left > clipRight + 1) return null;
    return {left, top:Math.max(top, clipTop), bottom:Math.min(bottom, clipBottom)};
  } finally {
    mirror.remove();
  }
}

export function popupHeight(value) {
  const height = Number(value);
  return Number.isFinite(height) && height > 0 ? Math.max(120, Math.min(4096, height)) : 240;
}

export function positionPopup(textarea, popup, preferredHeight = 240, direction = null) {
  const window = textarea.ownerDocument?.defaultView ?? globalThis.window;
  const caret = caretRect(textarea);
  if (!caret) {popup.style.display = 'none'; return;}
  const margin = 8, gap = 4;
  const width = Math.min(Math.max(300, Math.min(600, textarea.getBoundingClientRect().width)), window.innerWidth - margin * 2);
  popup.style.minWidth = '0';
  popup.style.boxSizing = 'border-box';
  popup.style.width = `${Math.max(0, width)}px`;
  popup.style.left = `${Math.max(margin, Math.min(caret.left, window.innerWidth - width - margin))}px`;
  const below = Math.max(0, window.innerHeight - margin - caret.bottom - gap);
  const above = Math.max(0, caret.top - margin - gap);
  const desired = popupHeight(preferredHeight);
  const upwards = direction ?? (below < Math.min(desired, popup.scrollHeight) && above > below);
  const height = Math.min(desired, upwards ? above : below);
  popup.style.maxHeight = `${height}px`;
  popup.style.top = `${upwards ? Math.max(margin, caret.top - gap - Math.min(height, popup.scrollHeight + 2)) : Math.max(margin, caret.bottom + gap)}px`;
  return upwards;
}

export function installPopupResize(textarea, popup, {getHeight, saveHeight, signal}) {
  const document = textarea.ownerDocument ?? globalThis.document;
  const handle = document.createElement('div');
  handle.className = 'jp-tag-ac-resize';
  handle.title = 'Drag to resize / ドラッグで高さを変更';
  handle.style.cssText = 'position:fixed;height:8px;cursor:ns-resize;touch-action:none;user-select:none;z-index:1000000;background:linear-gradient(transparent,rgba(128,128,128,.5),transparent);border-radius:4px';
  let drag = null;
  const stop = e => {e.preventDefault(); e.stopPropagation();};
  function place() {
    const up = positionPopup(textarea, popup, drag?.height ?? getHeight(), drag?.up);
    if (popup.style.display === 'none') return;
    const rect = popup.getBoundingClientRect();
    Object.assign(handle.style, {left:`${rect.left + 2}px`, width:`${Math.max(0, rect.width - 4)}px`,
      top:`${up ? rect.top : rect.bottom - 8}px`});
    return up;
  }
  function cancel() {
    if (drag && handle.hasPointerCapture(drag.id)) handle.releasePointerCapture(drag.id);
    drag = null;
  }
  handle.addEventListener('mousedown', stop, {signal});
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    stop(e);
    const up = place();
    drag = {id:e.pointerId, y:e.clientY, initial:popup.getBoundingClientRect().height, up};
    drag.height = drag.initial;
    handle.setPointerCapture(e.pointerId);
  }, {signal});
  handle.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    stop(e);
    drag.height = popupHeight(drag.initial + (e.clientY - drag.y) * (drag.up ? -1 : 1));
    place();
  }, {signal});
  handle.addEventListener('pointerup', e => {
    if (!drag || drag.id !== e.pointerId) return;
    stop(e);
    const height = drag.height;
    cancel();
    saveHeight(Math.round(popupHeight(height)));
    place();
  }, {signal});
  handle.addEventListener('pointercancel', () => {cancel(); place();}, {signal});
  handle.addEventListener('lostpointercapture', () => {if (drag) {drag = null; place();}}, {signal});
  signal.addEventListener('abort', cancel, {once:true});
  return {handle, place, cancel};
}
