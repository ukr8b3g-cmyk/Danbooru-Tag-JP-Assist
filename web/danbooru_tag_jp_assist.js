import { app } from "/scripts/app.js";
import { inputContext, snapshotMatches, insertionEdit } from "./lib/completion_core.js";

const API_URLS = ["/danbooru-tag-jp-assist/tags", "/jp-tag-autocomplete-test/tags"];
const FILES_API_URLS = ["/danbooru-tag-jp-assist/files", "/jp-tag-autocomplete-test/files"];
const HF_UPDATE_API_URLS = ["/danbooru-tag-jp-assist/hf-update", "/jp-tag-autocomplete-test/hf-update"];
const EXT_NAME = "Danbooru.Tag.JP.Assist";
const AUTOCOMPLETE_DEBOUNCE_MS = 80;
const SETTINGS = {
  behavior: "DanbooruTagJPAssist.CompletionBehavior",
  searchJapanese: "DanbooruTagJPAssist.SearchJapanese",
  showSourceType: "DanbooruTagJPAssist.ShowSourceType",
  showSourceFile: "DanbooruTagJPAssist.ShowSourceFile",
  showPostCount: "DanbooruTagJPAssist.ShowPostCount",
  underscoreExclusions: "DanbooruTagJPAssist.UnderscoreExclusions",
  enabled: "DanbooruTagJPAssist.Enabled",
  maxSuggestions: "DanbooruTagJPAssist.MaxSuggestions",
  showAll: "DanbooruTagJPAssist.ShowAll",
  autoComma: "DanbooruTagJPAssist.AutoComma",
  preserveFormatting: "DanbooruTagJPAssist.PreservePromptFormatting",
  showJapanese: "DanbooruTagJPAssist.ShowJapanese",
  spacesForUnderscores: "DanbooruTagJPAssist.SpacesForUnderscores",
  sortOrder: "DanbooruTagJPAssist.SortOrder",
  tagSource: "DanbooruTagJPAssist.TagSource",
  popupTheme: "DanbooruTagJPAssist.PopupTheme",
  tagFile: "DanbooruTagJPAssist.TagFile",
  translationFile: "DanbooruTagJPAssist.TranslationFile",
  tagSelectionMode: "DanbooruTagJPAssist.TagSelectionMode",
  translationSelectionMode: "DanbooruTagJPAssist.TranslationSelectionMode",
  tagFiles: "DanbooruTagJPAssist.TagFiles",
  translationFiles: "DanbooruTagJPAssist.TranslationFiles",
  autoUpdateHf: "DanbooruTagJPAssist.AutoUpdateHf",
};
const DEFAULTS = {
  behavior: "existing",
  searchJapanese: true,
  showSourceType: false,
  showSourceFile: false,
  showPostCount: false,
  underscoreExclusions: "",
  enabled: true,
  maxSuggestions: 10,
  showAll: true,
  autoComma: true,
  preserveFormatting: true,
  showJapanese: true,
  spacesForUnderscores: true,
  sortOrder: "match",
  tagSource: "both",
  popupTheme: "cyan",
  tagFile: "All",
  translationFile: "All",
  tagSelectionMode: "legacy",
  translationSelectionMode: "legacy",
  tagFiles: [],
  translationFiles: [],
  autoUpdateHf: true,
};
const resultCache = new Map();
const scheduledNodeScans = new WeakSet();
let fileListCache = null;
let activeAutocomplete = null;
let globalDismissInstalled = false;
let settingsRevision = 0;
let dictionaryRevision = null;
const controllers = new Set();
const textareaControllers = new WeakMap();
const nodeControllers = new WeakMap();
const removedNodes = new WeakSet();
const nodes = new Set();
const fileSelectionEditors = new Set();

function invalidateResults() {
  settingsRevision += 1;
  resultCache.clear();
  for (const controller of controllers) controller.invalidate();
}

function addSetting(definition) {
  app.ui?.settings?.addSetting?.({ ...definition, onChange: invalidateResults });
}

function requestParams(query, tail = "") {
  const params = new URLSearchParams({
    source: tagSource(), tag_file: selectedTagFileName(), translation_file: selectedTranslationFileName(),
    sort: sortOrder(), limit: String(showAllSuggestions() ? 500 : maxSuggestions()),
    behavior: getSetting(SETTINGS.behavior, DEFAULTS.behavior),
    search_jp: getSetting(SETTINGS.searchJapanese, true) ? "1" : "0", q: query, tail,
  });
  for (const kind of ["tag", "translation"]) {
    if (getSetting(SETTINGS[`${kind}SelectionMode`], "legacy") === "selected") {
      params.set(`${kind}_files`, JSON.stringify(orderedNames(getSetting(SETTINGS[`${kind}Files`], []))));
    }
  }
  return params;
}

async function loadTags(context, signal, valid) {
  const params = requestParams(context.text, context.tail);
  const stamp = await fetchFirstJson(["/danbooru-tag-jp-assist/revision"], params, {signal});
  if ((params.has("tag_files") || params.has("translation_files")) && !stamp.ordered_selection) {
    throw new Error("Restart ComfyUI to enable selected CSVs");
  }
  if (!valid()) return [];
  if (dictionaryRevision !== stamp.revision) {
    dictionaryRevision = stamp.revision;
    resultCache.clear();
    for (const controller of controllers) controller.hide();
  }
  const key = JSON.stringify([dictionaryRevision, ...params.entries()]);
  if (resultCache.has(key)) return resultCache.get(key);
  const data = await fetchFirstJson(API_URLS, params, {signal});
  if (!valid() || data.retry || data.revision !== dictionaryRevision) return [];
  if (!Array.isArray(data.tags)) throw new Error("Invalid JP Assist response");
  if (!data.errors?.length) {
    if (resultCache.size >= 200) resultCache.delete(resultCache.keys().next().value);
    resultCache.set(key, data.tags);
  }
  return data.tags;
}

async function fetchFirstJson(urls, params = null, options = {}) {
  for (const baseUrl of urls) {
    const query = params ? `?${params.toString()}` : "";
    const response = await fetch(`${baseUrl}${query}`, { cache: "no-store", ...options });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`JP Assist HTTP ${response.status}`);
    return await response.json();
  }
  throw new Error("JP Assist API is unavailable");
}

async function loadFileList() {
  if (!fileListCache) {
    fileListCache = fetchFirstJson(FILES_API_URLS)
      .then((data) => ({
        tag_files: Array.isArray(data.tag_files) ? data.tag_files : ["All"],
        translation_files: Array.isArray(data.translation_files) ? data.translation_files : ["All"],
        ordered_selection: data.ordered_selection === true,
      })).catch(() => {
        fileListCache = null;
        return {tag_files: ["All"], translation_files: ["All"]};
      });
  }
  return fileListCache;
}

function orderedNames(value) {
  return Array.isArray(value) ? [...new Set(value.filter(name => typeof name === "string" && name !== "All" && name !== "all"))] : [];
}

function addFileSelection(kind, files) {
  const id = SETTINGS[`${kind}Files`];
  addSetting({
    id, name: `Selected ${kind} CSVs (ordered)`, defaultValue: [],
    category: ["Danbooru Tag JP Assist", "Files", `Selected ${kind} CSVs`],
    type: (_name, setter, value) => {
      const root = document.createElement("div");
      root.className = "jp-csv-selection";
      root.style.cssText = "min-width:280px;width:100%;max-width:480px";
      let selected = orderedNames(value);
      for (const existing of fileSelectionEditors) if (!existing.root.isConnected) fileSelectionEditors.delete(existing);
      const editor = {root, refresh: updated => {files = updated; render();}};
      fileSelectionEditors.add(editor);
      const save = next => {selected = next; setter([...selected]); render();};
      function render() {
        root.replaceChildren();
        const help = document.createElement("p");
        help.textContent = files.ordered_selection
          ? `Used in Selected CSVs only mode. First selected wins. Empty: no ${kind === "tag" ? "suggestions" : "translations"}.`
          : "Restart ComfyUI to enable selected CSVs.";
        help.style.cssText = "margin:0 0 6px;color:var(--descrip-text,#aaa);font-size:12px";
        root.append(help);
        const available = orderedNames(files[`${kind}_files`]);
        const list = document.createElement("div");
        list.style.cssText = "max-height:150px;overflow:auto;border:1px solid var(--border-color,#555);border-radius:4px";
        for (const name of [...selected, ...available.filter(name => !selected.includes(name))]) {
          const index = selected.indexOf(name);
          const row = document.createElement("div");
          row.style.cssText = "display:flex;align-items:center;gap:6px;padding:4px 6px";
          const label = document.createElement("label");
          label.style.cssText = "display:flex;align-items:center;gap:6px;flex:1;min-width:0";
          const check = document.createElement("input");
          check.type = "checkbox";
          check.checked = index >= 0;
          check.setAttribute("aria-label", `Select ${kind} CSV ${name}`);
          check.addEventListener("change", () => save(check.checked ? [...selected, name] : selected.filter(item => item !== name)));
          const text = document.createElement("span");
          text.textContent = `${index >= 0 ? `${index + 1}. ` : ""}${name}${available.includes(name) ? "" : " (unavailable)"}`;
          text.title = text.textContent;
          text.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
          label.append(check, text);
          row.append(label);
          if (index >= 0) for (const [direction, delta, arrow] of [["up", -1, "↑"], ["down", 1, "↓"]]) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = arrow;
            button.setAttribute("aria-label", `Move ${kind} CSV ${name} ${direction}`);
            button.title = `Move ${direction}`;
            button.disabled = index + delta < 0 || index + delta >= selected.length;
            button.addEventListener("click", () => {
              const next = [...selected];
              [next[index], next[index + delta]] = [next[index + delta], next[index]];
              save(next);
            });
            row.append(button);
          }
          list.append(row);
        }
        root.append(list);
      }
      render();
      return root;
    },
  });
}

async function refreshFileSelections() {
  fileListCache = null;
  const files = await loadFileList();
  for (const editor of fileSelectionEditors) {
    if (editor.root.isConnected) editor.refresh(files);
    else fileSelectionEditors.delete(editor);
  }
}

function getSetting(id, fallback) {
  try {
    const value = app.extensionManager?.setting?.get?.(id)
      ?? app.ui?.settings?.getSettingValue?.(id)
      ?? app.ui?.settings?.settingsValues?.[id];
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function isEnabled() {
  return !!getSetting(SETTINGS.enabled, DEFAULTS.enabled);
}

function maxSuggestions() {
  const value = Number(getSetting(SETTINGS.maxSuggestions, DEFAULTS.maxSuggestions));
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : DEFAULTS.maxSuggestions;
}

function showAllSuggestions() {
  return !!getSetting(SETTINGS.showAll, DEFAULTS.showAll);
}

function autoComma() {
  return !!getSetting(SETTINGS.autoComma, DEFAULTS.autoComma);
}

function preservePromptFormatting() {
  return !!getSetting(SETTINGS.preserveFormatting, DEFAULTS.preserveFormatting);
}

function showJapanese() {
  return !!getSetting(SETTINGS.showJapanese, DEFAULTS.showJapanese);
}

function spacesForUnderscores() {
  return !!getSetting(SETTINGS.spacesForUnderscores, DEFAULTS.spacesForUnderscores);
}

function sortOrder() {
  return String(getSetting(SETTINGS.sortOrder, DEFAULTS.sortOrder) || DEFAULTS.sortOrder);
}

function tagSource() {
  return String(getSetting(SETTINGS.tagSource, DEFAULTS.tagSource) || DEFAULTS.tagSource);
}

function selectedTagFileName() {
  return String(getSetting(SETTINGS.tagFile, DEFAULTS.tagFile) || DEFAULTS.tagFile);
}

function selectedTranslationFileName() {
  return String(getSetting(SETTINGS.translationFile, DEFAULTS.translationFile) || DEFAULTS.translationFile);
}

function autoUpdateHf() {
  return !!getSetting(SETTINGS.autoUpdateHf, DEFAULTS.autoUpdateHf);
}

function popupTheme() {
  return String(getSetting(SETTINGS.popupTheme, DEFAULTS.popupTheme) || DEFAULTS.popupTheme);
}

function popupColors() {
  const themes = {
    gray: { border: "#5a5a5a", active: "#3a3a3a" },
    blue: { border: "#3c78d8", active: "#244a86" },
    cyan: { border: "#35d0c8", active: "#116b68" },
    purple: { border: "#8b5cf6", active: "#4c2f86" },
    amber: { border: "#d89b28", active: "#6f4c12" },
  };
  return themes[popupTheme()] || themes.gray;
}

function currentToken(textarea) {
  return inputContext(textarea.value, textarea.selectionStart, textarea.selectionEnd);
}

function insertTag(textarea, token, item) {
  const edit = insertionEdit(token, item, {
    behavior: getSetting(SETTINGS.behavior, DEFAULTS.behavior),
    spacesForUnderscores: spacesForUnderscores(), preserveFormatting: preservePromptFormatting(),
    autoComma: autoComma(), exclusions: getSetting(SETTINGS.underscoreExclusions, ""),
  });
  textarea.setSelectionRange(edit.start, edit.end);
  // Chromium's native edit command keeps a completion in the textarea undo history.
  const edited = document.execCommand("insertText", false, edit.replacement);
  if (!edited) {
    textarea.setRangeText(edit.replacement, edit.start, edit.end, "end");
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: edit.replacement }));
  }
  textarea.setSelectionRange(edit.caret, edit.caret);
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function shouldAttach(el) {
  if (!(el instanceof HTMLTextAreaElement)) return false;
  if (!el.isConnected) return false;
  if (el.readOnly || el.disabled) return false;
  if (el.closest(".jp-tag-ac-popup")) return false;
  return true;
}

function makePopup() {
  const popup = document.createElement("div");
  const colors = popupColors();
  popup.className = "jp-tag-ac-popup";
  popup.style.cssText = [
    "position:fixed",
    "z-index:999999",
    "display:none",
    "max-height:240px",
    "overflow:auto",
    "min-width:280px",
    "background:#181818",
    `border:1px solid ${colors.border}`,
    "border-radius:6px",
    "box-shadow:0 8px 24px rgba(0,0,0,.5)",
    "font:12px sans-serif",
    "color:#ddd",
  ].join(";");
  document.body.appendChild(popup);
  return popup;
}

function splitAlias(item) {
  return [item.ja, item.aliases]
    .filter(Boolean)
    .join(",")
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function ensureGlobalDismissHandler() {
  if (globalDismissInstalled) return;
  globalDismissInstalled = true;
  document.addEventListener("mousedown", (ev) => {
    const current = activeAutocomplete;
    if (current && !current.popup.contains(ev.target)) current.invalidate();
  });
  document.addEventListener("selectionchange", () => {
    textareaControllers.get(document.activeElement)?.selectionChanged();
  });
  new MutationObserver(records => {
    for (const controller of controllers) {
      if (!controller.textarea.isConnected) controller.destroy();
    }
    if (records.some(record => [...record.addedNodes].some(el => el instanceof HTMLTextAreaElement || (el instanceof Element && el.querySelector("textarea"))))) {
      for (const node of nodes) scheduleNodeTextareaScan(node);
    }
  }).observe(document.body, {childList: true, subtree: true});
}

function attachAutocomplete(textarea, node) {
  if (!shouldAttach(textarea) || textareaControllers.has(textarea)) return;
  const popup = makePopup();
  const listeners = new AbortController();
  const listen = (type, handler) => textarea.addEventListener(type, handler, {signal: listeners.signal});
  let items = [];
  let active = 0;
  let token = null;
  let requestSerial = 0;
  let updateTimer = null;
  let request = null;
  let rowElements = [];
  let composing = false;
  let committing = false;
  let destroyed = false;
  let compositionKeyPending = false;

  function hide() {
    popup.style.display = "none";
    popup.replaceChildren();
    items = [];
    token = null;
    active = 0;
    rowElements = [];
    if (activeAutocomplete === controller) activeAutocomplete = null;
  }

  function invalidate() {
    requestSerial += 1;
    if (updateTimer !== null) clearTimeout(updateTimer);
    updateTimer = null;
    request?.abort();
    request = null;
    hide();
  }

  function selectionChanged() {
    if (!committing && token && !snapshotMatches(token, textarea.value, textarea.selectionStart, textarea.selectionEnd)) invalidate();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    invalidate();
    listeners.abort();
    popup.remove();
    controllers.delete(controller);
    textareaControllers.delete(textarea);
    nodeControllers.get(node)?.delete(controller);
  }

  function canCommit() {
    return !destroyed && !composing && isEnabled() && textarea.isConnected && !textarea.readOnly && !textarea.disabled
      && document.activeElement === textarea && token?.settingsRevision === settingsRevision
      && token?.dictionaryRevision === dictionaryRevision
      && snapshotMatches(token, textarea.value, textarea.selectionStart, textarea.selectionEnd);
  }

  function commit(item, event) {
    if (!canCommit()) { invalidate(); return; }
    event.preventDefault();
    committing = true;
    try { insertTag(textarea, token, item); }
    finally { committing = false; invalidate(); }
  }

  const controller = {textarea, popup, hide, invalidate, destroy, selectionChanged};
  controllers.add(controller);
  textareaControllers.set(textarea, controller);
  if (!nodeControllers.has(node)) nodeControllers.set(node, new Set());
  nodeControllers.get(node).add(controller);
  ensureGlobalDismissHandler();

  function render() {
    popup.replaceChildren();
    rowElements = [];
    const colors = popupColors();
    const fragment = document.createDocumentFragment();
    popup.style.borderColor = colors.border;
    items.forEach((item, index) => {
      const row = document.createElement("div");
      row.style.cssText = `display:block;padding:6px 8px;cursor:pointer;background:${index === active ? colors.active : "transparent"}`;
      const tag = document.createElement("span");
      tag.textContent = item.tag;
      tag.style.cssText = "display:block;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      row.append(tag);
      const labels = [];
      const meta = item.meta ?? {};
      if (getSetting(SETTINGS.showSourceType, false)) labels.push(({tag: "TAG", natural_language: "NL", custom: "CUSTOM"})[meta.source_type] ?? "?");
      if (getSetting(SETTINGS.showSourceFile, false) && meta.source_file) labels.push(meta.source_file);
      if (getSetting(SETTINGS.showPostCount, false)) labels.push(meta.post_count === null || meta.post_count === undefined ? "Posts: unknown" : `Posts: ${meta.post_count}`);
      if (labels.length) {
        const info = document.createElement("span");
        info.textContent = labels.join(" · ");
        info.title = info.textContent;
        info.style.cssText = "display:block;color:#aaa;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
        row.append(info);
      }
      const aliases = splitAlias(item).join(", ");
      if (showJapanese() && aliases) {
        const ja = document.createElement("span");
        ja.textContent = aliases;
        ja.title = aliases;
        ja.style.cssText = "display:block;color:#bde;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px";
        row.append(ja);
      }
      row.addEventListener("mousedown", ev => commit(item, ev));
      rowElements.push(row);
      fragment.append(row);
    });
    popup.append(fragment);
  }

  function setActive(index) {
    const next = Math.max(0, Math.min(items.length - 1, index));
    if (next === active) return;
    if (rowElements[active]) rowElements[active].style.background = "transparent";
    active = next;
    if (rowElements[next]) {
      rowElements[next].style.background = popupColors().active;
      rowElements[next].scrollIntoView?.({block: "nearest"});
    }
  }

  async function update(serial) {
    if (destroyed || composing || serial !== requestSerial || !isEnabled()
        || !textarea.isConnected || textarea.readOnly || textarea.disabled || document.activeElement !== textarea) return;
    const context = currentToken(textarea);
    if (!context.text || context.selectionStart !== context.selectionEnd) return;
    context.settingsRevision = settingsRevision;
    const valid = () => !destroyed && !composing && serial === requestSerial && isEnabled()
      && settingsRevision === context.settingsRevision && textarea.isConnected
      && document.activeElement === textarea
      && snapshotMatches(context, textarea.value, textarea.selectionStart, textarea.selectionEnd);
    request = new AbortController();
    try {
      const tags = await loadTags(context, request.signal, valid);
      if (!valid() || !tags.length) return;
      token = {...context, dictionaryRevision};
      items = tags;
      active = 0;
      if (activeAutocomplete && activeAutocomplete !== controller) activeAutocomplete.invalidate();
      activeAutocomplete = controller;
      const rect = textarea.getBoundingClientRect();
      popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 300))}px`;
      popup.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 250))}px`;
      popup.style.width = `${Math.max(300, Math.min(rect.width, window.innerWidth - 16))}px`;
      popup.style.display = "block";
      render();
    } catch (error) {
      if (valid()) hide();
      if (error.name !== "AbortError") console.debug("JP Assist search unavailable", error.message);
    }
  }

  function scheduleUpdate() {
    invalidate();
    if (committing || composing || destroyed) return;
    const serial = requestSerial;
    updateTimer = setTimeout(() => { updateTimer = null; void update(serial); }, AUTOCOMPLETE_DEBOUNCE_MS);
  }

  listen("input", ev => {
    if (ev.isComposing) { invalidate(); return; }
    scheduleUpdate();
  });
  listen("focus", () => { invalidate(); void update(requestSerial); });
  listen("blur", invalidate);
  listen("select", selectionChanged);
  listen("compositionstart", () => { composing = true; compositionKeyPending = true; invalidate(); });
  listen("compositionend", () => { composing = false; scheduleUpdate(); });
  listen("keyup", ev => {
    if (!composing && (ev.key === "Enter" || ev.keyCode === 229)) compositionKeyPending = false;
  });
  listen("keydown", ev => {
    if (composing || ev.isComposing || ev.keyCode === 229) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (compositionKeyPending) {
      if (ev.key === "Enter" || ev.key === "Tab") return;
      compositionKeyPending = false;
    }
    if (["Escape", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(ev.key)) { invalidate(); return; }
    if (popup.style.display === "none" || !items.length) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      if (!canCommit()) { invalidate(); return; }
      ev.preventDefault();
      setActive(active + (ev.key === "ArrowDown" ? 1 : -1));
    } else if (ev.key === "Enter" || ev.key === "Tab") {
      commit(items[active], ev);
    }
  });
}

function attachTextareasInElement(el, node) {
  if (el instanceof HTMLTextAreaElement) {
    attachAutocomplete(el, node);
    return;
  }
  if (!(el instanceof Element)) return;
  el.querySelectorAll("textarea").forEach(textarea => attachAutocomplete(textarea, node));
}

function attachNodeTextareas(node) {
  for (const widget of node?.widgets || []) {
    attachTextareasInElement(widget?.inputEl, node);
    if (widget?.element !== widget?.inputEl) attachTextareasInElement(widget?.element, node);
  }
}

function scheduleNodeTextareaScan(node) {
  if (!node || removedNodes.has(node)) return;
  nodes.add(node);
  if (!nodeControllers.has(node)) {
    nodeControllers.set(node, new Set());
    const onRemoved = node.onRemoved;
    node.onRemoved = function (...args) {
      removedNodes.add(this);
      nodes.delete(this);
      for (const controller of [...(nodeControllers.get(this) ?? [])]) controller.destroy();
      return onRemoved?.apply(this, args);
    };
  }
  attachNodeTextareas(node);
  if (!node || scheduledNodeScans.has(node) || typeof requestAnimationFrame !== "function") return;
  scheduledNodeScans.add(node);
  requestAnimationFrame(() => {
    scheduledNodeScans.delete(node);
    if (!removedNodes.has(node)) attachNodeTextareas(node);
  });
}

async function addSettings() {
  addSetting({
    id: SETTINGS.behavior, name: "Completion behavior", type: "combo",
    category: ["Danbooru Tag JP Assist", "Autocomplete", "Completion behavior"],
    options: [{value: "existing", text: "Existing"}, {value: "csv", text: "CSV-aware"}], defaultValue: "existing",
  });
  for (const [key, name, group] of [
    ["searchJapanese", "Use JP aliases for search", "Autocomplete"],
    ["showSourceType", "Show TAG / NL / CUSTOM", "Display"],
    ["showSourceFile", "Show source CSV", "Display"],
    ["showPostCount", "Show post count", "Display"],
  ]) addSetting({id: SETTINGS[key], name, category: ["Danbooru Tag JP Assist", group, name], type: "boolean", defaultValue: DEFAULTS[key]});
  addSetting({id: SETTINGS.underscoreExclusions, name: "Underscore exclusions", type: "text",
    category: ["Danbooru Tag JP Assist", "Insert", "Underscore exclusions"], defaultValue: "",
  });
  app.ui?.settings?.addSetting?.({id: "DanbooruTagJPAssist.ReloadDictionaries", name: "Reload dictionaries", type: () => {
    const button = document.createElement("button");
    button.textContent = "Reload dictionaries";
    button.className = "p-button p-component";
    button.onclick = async () => {
      button.disabled = true;
      invalidateResults();
      try {
        await fetchFirstJson(["/danbooru-tag-jp-assist/reload"], null, {method: "POST"});
        dictionaryRevision = null;
        await refreshFileSelections();
        button.textContent = "Dictionaries reloaded";
      } catch { button.textContent = "Reload failed — retry"; }
      finally { button.disabled = false; }
    };
    return button;
  }, category: ["Danbooru Tag JP Assist", "Files", "Reload dictionaries"]});
  const files = await loadFileList();
  const tagFiles = Array.isArray(files.tag_files) && files.tag_files.length ? files.tag_files : ["All"];
  const translationFiles = Array.isArray(files.translation_files) && files.translation_files.length ? files.translation_files : ["All"];
  addSetting({
    id: SETTINGS.enabled,
    name: "Enable suggestions",
    category: ["Danbooru Tag JP Assist", "Autocomplete", "Enable"],
    type: "boolean",
    defaultValue: DEFAULTS.enabled,
  });
  addSetting({
    id: SETTINGS.maxSuggestions,
    name: "Suggestion count",
    category: ["Danbooru Tag JP Assist", "Autocomplete", "Suggestion count"],
    type: "number",
    defaultValue: DEFAULTS.maxSuggestions,
    attrs: { min: 1, max: 200, step: 1 },
  });
  addSetting({
    id: SETTINGS.tagSource,
    name: "Tag source",
    category: ["Danbooru Tag JP Assist", "Autocomplete", "Tag source"],
    type: "combo",
    options: [
      { value: "hf", text: "Hugging Face" },
      { value: "own", text: "Own tag file" },
      { value: "both", text: "Both" },
    ],
    defaultValue: DEFAULTS.tagSource,
  });
  addSetting({
    id: SETTINGS.tagFile,
    name: "1. Tag file (priority)",
    category: ["Danbooru Tag JP Assist", "Files", "1. Tag file"],
    type: "combo",
    options: tagFiles.map((name) => ({ value: name, text: name })),
    defaultValue: DEFAULTS.tagFile,
  });
  addSetting({
    id: SETTINGS.translationFile,
    name: "2. Translation file",
    category: ["Danbooru Tag JP Assist", "Files", "2. Translation file"],
    type: "combo",
    options: translationFiles.map((name) => ({ value: name, text: name })),
    defaultValue: DEFAULTS.translationFile,
  });
  addSetting({
    id: SETTINGS.autoUpdateHf,
    name: "3. Update Danbooru CSV from Hugging Face",
    category: ["Danbooru Tag JP Assist", "Files", "3. Danbooru CSV update"],
    type: "boolean",
    defaultValue: DEFAULTS.autoUpdateHf,
  });
  for (const kind of ["translation", "tag"]) {
    addFileSelection(kind, files);
    addSetting({
      id: SETTINGS[`${kind}SelectionMode`], name: `${kind === "tag" ? "Tag" : "Translation"} selection mode`, type: "combo",
      category: ["Danbooru Tag JP Assist", "Files", `${kind} selection mode`],
      options: [{value: "legacy", text: kind === "tag" ? "All / single priority" : "All / single file"}, {value: "selected", text: "Selected CSVs only"}],
      defaultValue: "legacy",
    });
  }
  addSetting({
    id: SETTINGS.popupTheme,
    name: "Popup color",
    category: ["Danbooru Tag JP Assist", "Display", "Popup color"],
    type: "combo",
    options: [
      { value: "gray", text: "Gray" },
      { value: "blue", text: "Blue" },
      { value: "cyan", text: "Cyan" },
      { value: "purple", text: "Purple" },
      { value: "amber", text: "Amber" },
    ],
    defaultValue: DEFAULTS.popupTheme,
  });
  addSetting({
    id: SETTINGS.sortOrder,
    name: "Sort mode",
    category: ["Danbooru Tag JP Assist", "Autocomplete", "Sort mode"],
    type: "combo",
    options: [
      { value: "match", text: "Match first" },
      { value: "count", text: "Priority / count" },
      { value: "az", text: "Tag A-Z" },
    ],
    defaultValue: DEFAULTS.sortOrder,
  });
  addSetting({
    id: SETTINGS.showAll,
    name: "List every match",
    category: ["Danbooru Tag JP Assist", "Autocomplete", "Show all"],
    type: "boolean",
    defaultValue: DEFAULTS.showAll,
  });
  addSetting({
    id: SETTINGS.autoComma,
    name: "Append comma",
    category: ["Danbooru Tag JP Assist", "Insert", "Auto comma"],
    type: "boolean",
    defaultValue: DEFAULTS.autoComma,
  });
  addSetting({
    id: SETTINGS.preserveFormatting,
    name: "Preserve prompt formatting",
    category: ["Danbooru Tag JP Assist", "Insert", "Preserve formatting"],
    type: "boolean",
    defaultValue: DEFAULTS.preserveFormatting,
  });
  addSetting({
    id: SETTINGS.showJapanese,
    name: "Display JP aliases",
    category: ["Danbooru Tag JP Assist", "Display", "Japanese aliases"],
    type: "boolean",
    defaultValue: DEFAULTS.showJapanese,
  });
  addSetting({
    id: SETTINGS.spacesForUnderscores,
    name: "Use spaces for underscores",
    category: ["Danbooru Tag JP Assist", "Insert", "Underscore format"],
    type: "boolean",
    defaultValue: DEFAULTS.spacesForUnderscores,
  });
}

async function maybeUpdateHfFile() {
  if (!autoUpdateHf()) return;
  try {
    await fetchFirstJson(HF_UPDATE_API_URLS, null, { method: "POST" });
    fileListCache = null;
    dictionaryRevision = null;
    invalidateResults();
  } catch {
    // Network or server errors should not block normal autocomplete use.
  }
}

app.registerExtension({
  name: EXT_NAME,
  async init() {
    ensureGlobalDismissHandler();
    await addSettings();
    // Remote CSV refresh can take seconds; do not block the extension UI on it.
    void maybeUpdateHfFile();
  },
  nodeCreated(node) {
    removedNodes.delete(node);
    scheduleNodeTextareaScan(node);
  },
  loadedGraphNode(node) {
    removedNodes.delete(node);
    scheduleNodeTextareaScan(node);
  },
});
