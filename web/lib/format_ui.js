import { formatPrompt, formatSelection, replacementEdit } from './prompt_format.js';

function addFormatTooltip(button, app) {
  const update = () => {
    const locale = app.ui?.settings?.getSettingValue?.('Comfy.Locale')
      ?? app.extensionManager?.setting?.get?.('Comfy.Locale')
      ?? document.documentElement?.lang ?? 'en';
    // Use the browser tooltip so no floating panel remains after leaving the button.
    button.title = /^ja(?:-|$)/i.test(locale)
      ? 'プロンプトのカンマ・空白を整えます。対象・追加処理は設定に従います。'
      : 'Clean up prompt commas and spacing, using the configured target and options.';
  };
  update();
  button.addEventListener('mouseenter', update);
  button.addEventListener('focus', update);
}

export function isPromptController({node, textarea}) {
  const type = String(node?.comfyClass ?? node?.type ?? '');
  if (/json|script|codeeditor|codeinput|template|markdown|note/i.test(type)) return false;
  const widget = node?.widgets?.find(w => w.inputEl === textarea || w.element === textarea || w.element?.contains?.(textarea));
  if (type === 'DanbooruTagJPAssist') return widget?.name === 'text';
  return /CLIPTextEncode|TextEncode|Prompt|String|TextInput|Primitive/i.test(type)
    && /^(?:text|text_[gl]|string|value|prompt|positive|negative|positive_prompt|negative_prompt)$/i.test(widget?.name ?? '');
}

export function applyFormat(textarea, options, selectionOnly = false) {
  const original = textarea.value;
  const start = textarea.selectionStart, end = textarea.selectionEnd;
  const next = selectionOnly && start !== end ? formatSelection(original, start, end, options) : formatPrompt(original, options);
  if (next === original) return false;
  const edit = replacementEdit(original, next);
  const scrollTop = textarea.scrollTop, scrollLeft = textarea.scrollLeft;
  const direction = textarea.selectionDirection;
  textarea.focus({preventScroll: true});
  textarea.setSelectionRange(edit.start, edit.end);
  try {
    // Native editing preserves the browser's per-input Undo/Redo history.
    const ok = document.execCommand(edit.replacement ? 'insertText' : 'delete', false, edit.replacement);
    if (!ok || textarea.value !== next) throw new Error('Could not create an undoable prompt edit.');
    textarea.dispatchEvent(new Event('change', {bubbles: true}));
  } finally {
    const applied = textarea.value === next;
    textarea.setSelectionRange(applied ? edit.map(start) : start, applied ? edit.map(end) : end, direction);
    textarea.scrollTop = scrollTop; textarea.scrollLeft = scrollLeft;
  }
  return true;
}

export function installFormatting(app, {getControllers, begin, end}) {
  const prefix = 'DanbooruTagJPAssist.Format';
  const get = (name, fallback) => app.ui.settings.getSettingValue(prefix + name) ?? fallback;
  let lastInput = null;
  const composing = new WeakSet();
  const eligible = () => [...getControllers()].filter(c => c.textarea.isConnected && !c.textarea.disabled && !c.textarea.readOnly);
  const controllerFor = el => eligible().find(c => c.textarea === el);
  document.addEventListener('focusin', e => { if (controllerFor(e.target)) lastInput = e.target; });
  document.addEventListener('compositionstart', e => composing.add(e.target));
  document.addEventListener('compositionend', e => composing.delete(e.target));

  function run() {
    const current = controllerFor(document.activeElement) ? document.activeElement : lastInput;
    const savedScope = get('Scope', 'all');
    const scope = ['current', 'selected', 'all'].includes(savedScope) ? savedScope : 'current';
    const selected = new Set(Object.values(app.canvas?.selected_nodes ?? {}));
    const targets = eligible().filter(c => scope === 'current' ? c.textarea === current
      : scope === 'selected' ? selected.has(c.node) && isPromptController(c) : isPromptController(c));
    if (!targets.length || targets.some(c => composing.has(c.textarea))) return 0;
    const options = {duplicates: get('Duplicates', false), underscores: get('Underscores', false),
      appendComma: get('AppendComma', false), exclusions: app.ui.settings.getSettingValue('DanbooruTagJPAssist.UnderscoreExclusions') ?? ''};
    const restore = current?.isConnected ? current : document.activeElement;
    let changed = 0;
    begin();
    try {
      for (const {textarea} of targets) if (applyFormat(textarea, options, scope === 'current')) changed++;
    } catch (error) {
      app.extensionManager?.toast?.add({severity: 'warn', summary: 'JP Assist Format', detail: error.message, life: 4000});
      console.warn('JP Assist Format:', error);
    } finally {
      if (restore?.isConnected) restore.focus?.({preventScroll: true});
      end();
    }
    return changed;
  }

  app.ui.settings.addSetting({id: prefix + 'Scope', name: 'Format target', type: 'combo',
    category: ['Danbooru Tag JP Assist', 'Formatting', 'Target'], defaultValue: 'all',
    options: [{value: 'current', text: 'Current input / selection'}, {value: 'selected', text: 'Selected nodes'},
      {value: 'all', text: 'All recognized prompt inputs'}]});
  for (const [key, name] of [['Duplicates','Remove duplicate plain tags'], ['Underscores','Replace underscores'], ['AppendComma','Append comma on newline']]) {
    app.ui.settings.addSetting({id: prefix + key, name, type: 'boolean', defaultValue: false,
      category: ['Danbooru Tag JP Assist', 'Formatting', name]});
  }
  // Also expose the action in Settings if the main menu is hidden.
  app.ui.settings.addSetting({id: prefix + 'Now', name: 'Format', category: ['Danbooru Tag JP Assist','Formatting','Format'],
    type: () => {const button = document.createElement('button'); button.textContent = 'Format'; addFormatTooltip(button, app); button.onclick = run; return button;}});
  document.addEventListener('keydown', e => {
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyF'
        && !e.isComposing && e.keyCode !== 229 && controllerFor(document.activeElement)) {
      e.preventDefault(); e.stopImmediatePropagation(); run();
    }
  }, true);
  mountFormatButton(app, run);
  return {run};
}

export function mountFormatButton(app, run) {
  const button = document.createElement('button');
  button.id = 'jp-assist-format'; button.textContent = 'Format';
  addFormatTooltip(button, app);
  button.setAttribute('aria-label', 'JP Assist Format');
  button.className = 'comfyui-button';
  button.style.cssText = 'padding:6px 10px;white-space:nowrap;flex-shrink:0';
  button.addEventListener('mousedown', e => {e.preventDefault(); e.stopPropagation();});
  button.addEventListener('click', run);
  const visible = element => element?.isConnected && element.getClientRects().length > 0;
  function mount() {
    // Current ComfyUI mounts the action bar after extension setup. Its hidden
    // legacy menu also exists, so mere DOM presence is not a usable target.
    const modern = document.querySelector('[data-testid="action-bar-buttons"]');
    if (button.parentElement === modern && button.isConnected) return;
    if (visible(modern?.parentElement)) {
      modern.appendChild(button);
      return;
    }
    const actions = app.menu?.actionsGroup?.element;
    if (visible(actions)) {
      if (button.previousElementSibling !== actions) actions.after(button);
      return;
    }
    const legacy = document.querySelector('.comfy-menu');
    if (visible(legacy) && button.parentElement !== legacy) legacy.appendChild(button);
  }
  let frame = null;
  function schedule() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {frame = null; mount();});
  }
  mount();
  // Keep the same button/listeners when Vue replaces the toolbar container.
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {childList: true, subtree: true});
  window.addEventListener('resize', schedule);
  return button;
}
