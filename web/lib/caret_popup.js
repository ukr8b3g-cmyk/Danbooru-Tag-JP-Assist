// Measure textarea text in an untransformed mirror; convert back to viewport pixels.
export function caretRect(textarea) {
  const rect = textarea.getBoundingClientRect();
  const style = getComputedStyle(textarea);
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

export function positionPopup(textarea, popup) {
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
  const upwards = below < Math.min(240, popup.scrollHeight) && above > below;
  const height = Math.min(240, upwards ? above : below);
  popup.style.maxHeight = `${height}px`;
  popup.style.top = `${upwards ? Math.max(margin, caret.top - gap - Math.min(height, popup.scrollHeight + 2)) : Math.max(margin, caret.bottom + gap)}px`;
}
