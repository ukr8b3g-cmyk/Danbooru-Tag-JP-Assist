import { app } from "/scripts/app.js";
import { inputContext, snapshotMatches, insertionEdit } from "./lib/completion_core.js";

import { installFormatting } from "./lib/format_ui.js";
import { installPopupResize } from "./lib/caret_popup.js";
import { addLocalizedSetting, localizedDefinition, uiText, onLocaleChange } from "./lib/settings_i18n.js";
import { createUsageHistory } from "./lib/usage_history.js";
import { createCandidateList } from "./lib/candidate_list.js";
import { installTooltipCleanup } from "./lib/tooltip_cleanup.js";

const API_URLS = ["/danbooru-tag-jp-assist/tags", "/jp-tag-autocomplete-test/tags"];
const FILES_API_URLS = ["/danbooru-tag-jp-assist/files", "/jp-tag-autocomplete-test/files"];
const EXT_NAME = "Danbooru.Tag.JP.Assist";
const AUTOCOMPLETE_DEBOUNCE_MS = 80;
const SETTINGS = {
  behavior: "DanbooruTagJPAssist.CompletionBehavior",
  completionUnit: "DanbooruTagJPAssist.CompletionUnit",
  searchJapanese: "DanbooruTagJPAssist.SearchJapanese",
  showSourceType: "DanbooruTagJPAssist.ShowSourceType",
  showSourceFile: "DanbooruTagJPAssist.ShowSourceFile",
  showPostCount: "DanbooruTagJPAssist.ShowPostCount",
  underscoreExclusions: "DanbooruTagJPAssist.UnderscoreExclusions",
  enabled: "DanbooruTagJPAssist.Enabled",
  maxSuggestions: "DanbooruTagJPAssist.MaxSuggestions",
  showAll: "DanbooruTagJPAssist.ShowAll",
  usageRanking: "DanbooruTagJPAssist.UsageRanking",
  autoComma: "DanbooruTagJPAssist.AutoComma",
  preserveFormatting: "DanbooruTagJPAssist.PreservePromptFormatting",
  showJapanese: "DanbooruTagJPAssist.ShowJapanese",
  spacesForUnderscores: "DanbooruTagJPAssist.SpacesForUnderscores",
  sortOrder: "DanbooruTagJPAssist.SortOrder",
  tagSource: "DanbooruTagJPAssist.TagSource",
  popupTheme: "DanbooruTagJPAssist.PopupTheme",
  popupHeight: "DanbooruTagJPAssist.PopupHeight",
  tagFile: "DanbooruTagJPAssist.TagFile",
  translationFile: "DanbooruTagJPAssist.TranslationFile",
  tagSelectionMode: "DanbooruTagJPAssist.TagSelectionMode",
  translationSelectionMode: "DanbooruTagJPAssist.TranslationSelectionMode",
  tagFiles: "DanbooruTagJPAssist.TagFiles",
  translationFiles: "DanbooruTagJPAssist.TranslationFiles",
};
const DEFAULTS = {
  behavior: "existing",
  completionUnit: "word",
  searchJapanese: true,
  showSourceType: false,
  showSourceFile: false,
  showPostCount: false,
  underscoreExclusions: "",
  enabled: true,
  maxSuggestions: 10,
  showAll: true,
  usageRanking: false,
  autoComma: true,
  preserveFormatting: true,
  showJapanese: true,
  spacesForUnderscores: true,
  sortOrder: "count",
  tagSource: "both",
  popupTheme: "cyan",
  popupHeight: 240,
  tagFile: "All",
  translationFile: "All",
  tagSelectionMode: "selected",
  translationSelectionMode: "selected",
  tagFiles: [],
  translationFiles: [],
};
const resultCache = new Map();
const scheduledNodeScans = new WeakSet();
let fileListCache = null;
let activeAutocomplete = null;
let formattingActive = false;
const observedDocuments = new WeakSet();
const iframeBindings = new WeakMap();
const nodeIframes = new WeakMap();
let settingsRevision = 0;
let dictionaryRevision = null;
const controllers = new Set();
const textareaControllers = new WeakMap();
const nodeControllers = new WeakMap();
const removedNodes = new WeakSet();
const nodes = new Set();
const fileSelectionEditors = new Set();
const legacyEditors = new Set();
const usageHistory = createUsageHistory({onChange: invalidateResults});

function invalidateResults() {
  settingsRevision += 1;
  resultCache.clear();
  for (const controller of controllers) controller.invalidate();
}

const APPEARANCE_ONLY_SETTINGS = new Set([
  SETTINGS.showSourceType, SETTINGS.showSourceFile, SETTINGS.showPostCount,
  SETTINGS.showJapanese, SETTINGS.popupTheme, SETTINGS.popupHeight,
]);

function addSetting(definition) {
  addLocalizedSetting(app, { ...definition, onChange: () => {
    if (APPEARANCE_ONLY_SETTINGS.has(definition.id)) {
      for (const controller of controllers) controller.refreshAppearance();
    } else {
      invalidateResults();
    }
    if ([SETTINGS.tagSelectionMode, SETTINGS.translationSelectionMode, SETTINGS.tagFiles, SETTINGS.translationFiles].includes(definition.id)) {
      for (const editor of fileSelectionEditors) if (editor.root.isConnected) editor.refreshCurrent();
      for (const editor of legacyEditors) if (editor.root.isConnected) editor.refresh();
    }
  }});
}

function requestParams(query, tail = "") {
  const params = new URLSearchParams({
    source: tagSource(), tag_file: selectedTagFileName(), translation_file: selectedTranslationFileName(),
    sort: sortOrder(), limit: String(showAllSuggestions() ? 500 : maxSuggestions()),
    behavior: getSetting(SETTINGS.behavior, DEFAULTS.behavior),
    search_jp: getSetting(SETTINGS.searchJapanese, true) ? "1" : "0", q: query, tail,
  });
  for (const kind of ["tag", "translation"]) {
    if (getSetting(SETTINGS[`${kind}SelectionMode`], DEFAULTS[`${kind}SelectionMode`]) === "selected") {
      params.set(`${kind}_files`, JSON.stringify(orderedNames(getSetting(SETTINGS[`${kind}Files`], DEFAULTS[`${kind}Files`]))));
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
  const useHistory = !!getSetting(SETTINGS.usageRanking, DEFAULTS.usageRanking) && stamp.usage_ranking === true;
  const usage = useHistory ? usageHistory.entries() : [];
  const key = JSON.stringify([dictionaryRevision, usage, ...params.entries()]);
  if (resultCache.has(key)) return resultCache.get(key);
  const data = await fetchFirstJson(useHistory ? [API_URLS[0]] : API_URLS, params, useHistory
    ? {signal, method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({usage})}
    : {signal});
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
        usage_ranking: data.usage_ranking === true,
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

function defaultTagFiles(files) {
  const names = orderedNames(files);
  return names.includes("tags_merged_dedup.csv") ? ["tags_merged_dedup.csv"] : names;
}

function addFileSelection(kind, files) {
  const id = SETTINGS[`${kind}Files`];
  addSetting({
    id, name: `Selected ${kind} CSVs (ordered)`, defaultValue: files.ordered_selection ? DEFAULTS[`${kind}Files`] : undefined,
    category: ["Danbooru Tag JP Assist", "Files", `Selected ${kind} CSVs`],
    type: (_name, setter, value) => {
      const root = document.createElement("div");
      root.className = "jp-csv-selection";
      root.style.cssText = "min-width:280px;width:100%;max-width:480px";
      let selected = orderedNames(value ?? DEFAULTS[`${kind}Files`]);
      for (const existing of fileSelectionEditors) if (!existing.root.isConnected) fileSelectionEditors.delete(existing);
      const editor = {root, refreshCurrent: () => {
        selected = orderedNames(getSetting(id, selected)); render();
      }, refresh: updated => {
        files = updated;
        if (getSetting(id, null) === null) selected = orderedNames(DEFAULTS[`${kind}Files`]);
        render();
      }};
      fileSelectionEditors.add(editor);
      const save = next => {selected = next; setter([...selected]); render();};
      function render() {
        root.replaceChildren();
        const legacy = getSetting(SETTINGS[`${kind}SelectionMode`], DEFAULTS[`${kind}SelectionMode`]) === "legacy";
        const help = document.createElement("p");
        help.textContent = legacy ? uiText(app, "Legacy mode is active. This checklist is not used.", "従来モードを使用中。このチェックリストは使われていません。") : files.ordered_selection
          ? uiText(app, `Used in Selected CSVs only mode. First selected wins. Empty: no ${kind === "tag" ? "suggestions" : "translations"}.`, `「選択したCSVのみ」モードで使用。上から順に優先。未選択なら${kind === "tag" ? "候補なし" : "翻訳なし"}。`)
          : uiText(app, "Restart ComfyUI to enable selected CSVs.", "複数CSV選択にはComfyUIの再起動が必要です。");
        help.style.cssText = "margin:0 0 6px;color:var(--descrip-text,#aaa);font-size:12px";
        root.append(help);
        const available = orderedNames(files[`${kind}_files`]);
        const actions = document.createElement("div");
        actions.style.cssText = "display:flex;gap:6px;margin-bottom:6px";
        for (const [en, ja, action] of legacy ? [
          ["Use selected CSVs", "選択したCSVを使う", () => savePreference(SETTINGS[`${kind}SelectionMode`], "selected")],
        ] : [
          ["Select all", "すべて選択", () => save([...selected, ...available.filter(name => !selected.includes(name))])],
          ["Clear selection", "選択解除", () => save([])],
        ]) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = uiText(app, en, ja);
          button.title = legacy ? uiText(app, "Switch to this ordered checklist without changing its selection.", "選択内容を変えず、このチェックリストを使用するモードに切り替えます。")
            : en === "Select all" ? uiText(app, "Keep the current order and append all other available CSVs.", "現在の優先順を保ち、残りの利用可能なCSVを末尾に追加します。")
              : uiText(app, "Uncheck every CSV. An empty selection stays empty.", "すべてのチェックを外します。空の選択はそのまま保持します。");
          button.onclick = action;
          button.disabled = !files.ordered_selection;
          actions.append(button);
        }
        root.append(actions);
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
          check.disabled = legacy || !files.ordered_selection;
          check.setAttribute("aria-label", uiText(app, `Select ${kind} CSV ${name}`, `${kind === "tag" ? "タグ" : "翻訳"}CSV ${name}を選択`));
          check.title = uiText(app, "Check to use this CSV; uncheck to exclude it.", "チェックすると使用します。外すと検索対象から除外します。");
          check.addEventListener("change", () => save(check.checked ? [...selected, name] : selected.filter(item => item !== name)));
          const text = document.createElement("span");
          text.textContent = `${index >= 0 ? `${index + 1}. ` : ""}${name}${available.includes(name) ? "" : uiText(app, " (unavailable)", "（ファイルなし）")}`;
          text.title = text.textContent;
          text.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
          label.append(check, text);
          row.append(label);
          if (index >= 0) for (const [direction, delta, arrow] of [["up", -1, "↑"], ["down", 1, "↓"]]) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = arrow;
            button.setAttribute("aria-label", uiText(app, `Move ${kind} CSV ${name} ${direction}`, `${name}の優先順位を${delta < 0 ? "上げる" : "下げる"}`));
            button.title = uiText(app, `Move ${direction}`, `優先順位を${delta < 0 ? "上げる" : "下げる"}`);
            button.disabled = legacy || !files.ordered_selection || index + delta < 0 || index + delta >= selected.length;
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
  DEFAULTS.tagFiles = defaultTagFiles(files.tag_files);
  DEFAULTS.translationFiles = orderedNames(files.translation_files);
  for (const editor of fileSelectionEditors) {
    if (editor.root.isConnected) editor.refresh(files);
    else fileSelectionEditors.delete(editor);
  }
  for (const editor of legacyEditors) if (editor.root.isConnected) editor.refresh(files);
}

async function savePreference(id, value) {
  const settings = app.ui.settings;
  if (settings.setSettingValueAsync) await settings.setSettingValueAsync(id, value);
  else await settings.setSettingValue(id, value);
}

function addLegacySettings(files) {
  addLocalizedSetting(app, {id: "DanbooruTagJPAssist.LegacyFiles", name: "Legacy CSV settings",
    category: ["Danbooru Tag JP Assist", "Files", "Legacy CSV settings"], type: () => {
      const root = document.createElement("details");
      root.className = "jp-csv-legacy";
      root.style.cssText = "min-width:280px;width:100%;max-width:480px";
      root.open = ["tag", "translation"].some(kind => getSetting(SETTINGS[`${kind}SelectionMode`], DEFAULTS[`${kind}SelectionMode`]) === "legacy");
      function render() {
        root.replaceChildren();
        const summary = document.createElement("summary");
        summary.textContent = uiText(app, "Legacy CSV settings (compatibility)", "従来のCSV設定（互換用）");
        summary.title = uiText(app, "Keep old All / single-file settings. The corresponding legacy mode must be enabled to use them.", "以前の「すべて／単一CSV」の設定です。使うには対象の従来モードを有効にします。");
        root.append(summary);
        for (const kind of ["tag", "translation"]) {
          const legacy = getSetting(SETTINGS[`${kind}SelectionMode`], DEFAULTS[`${kind}SelectionMode`]) === "legacy";
          const keys = kind === "tag" ? ["tagSelectionMode", "tagSource", "tagFile"] : ["translationSelectionMode", "translationFile"];
          for (const key of keys) {
            const definition = localizedDefinition(app, SETTINGS[key]);
            const label = document.createElement("label");
            label.style.cssText = "display:flex;flex-direction:column;gap:4px;margin:8px 0";
            const text = document.createElement("span");
            text.textContent = definition.name;
            const select = document.createElement("select");
            select.setAttribute("aria-label", definition.name);
            label.title = select.title = definition.tooltip;
            select.disabled = !key.endsWith("SelectionMode") && !legacy;
            const current = getSetting(SETTINGS[key], DEFAULTS[key]);
            const choices = key === "tagFile" || key === "translationFile"
              ? [...orderedNames(files[`${kind}_files`]).map(name => ({value: name, text: name})), {value: "All", text: uiText(app, "All", "すべて")}]
              : definition.options;
            if (!choices.some(option => option.value === current)) choices.push({value: current, text: `${current}${uiText(app, " (unavailable)", "（ファイルなし）")}`});
            for (const choice of choices) {
              const option = document.createElement("option");
              option.value = choice.value; option.textContent = choice.text;
              select.append(option);
            }
            select.value = current;
            select.onchange = async () => {await savePreference(SETTINGS[key], select.value); render();};
            label.append(text, select); root.append(label);
          }
        }
      }
      for (const editor of legacyEditors) if (!editor.root.isConnected) legacyEditors.delete(editor);
      legacyEditors.add({root, refresh: updated => {if (updated) files = updated; render();}});
      render();
      return root;
    }});
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
  return inputContext(textarea.value, textarea.selectionStart, textarea.selectionEnd,
    getSetting(SETTINGS.completionUnit, DEFAULTS.completionUnit));
}

function insertTag(textarea, token, item) {
  const document = textarea.ownerDocument ?? globalThis.document;
  const edit = insertionEdit(token, item, {
    behavior: getSetting(SETTINGS.behavior, DEFAULTS.behavior),
    spacesForUnderscores: spacesForUnderscores(), preserveFormatting: preservePromptFormatting(),
    autoComma: autoComma(), exclusions: getSetting(SETTINGS.underscoreExclusions, ""),
  });
  const expected = textarea.value.slice(0, edit.start) + edit.replacement + textarea.value.slice(edit.end);
  textarea.setSelectionRange(edit.start, edit.end);
  // Chromium's native edit command keeps a completion in the textarea undo history.
  const edited = document.execCommand("insertText", false, edit.replacement);
  if (!edited) {
    textarea.setRangeText(edit.replacement, edit.start, edit.end, "end");
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: edit.replacement }));
  }
  textarea.setSelectionRange(edit.caret, edit.caret);
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
  return textarea.value === expected;
}

function isTextarea(el) {
  return el instanceof (el?.ownerDocument?.defaultView?.HTMLTextAreaElement ?? HTMLTextAreaElement);
}

function shouldAttach(el) {
  if (!isTextarea(el)) return false;
  if (!el.isConnected) return false;
  if (el.readOnly || el.disabled) return false;
  if (el.closest(".jp-tag-ac-popup")) return false;
  return true;
}

function makePopup(document = globalThis.document) {
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

function ensureGlobalDismissHandler(document = globalThis.document, ownerNode = null) {
  if (observedDocuments.has(document)) return;
  observedDocuments.add(document);
  document.addEventListener("mousedown", (ev) => {
    const current = activeAutocomplete;
    if (current && !current.popup.contains(ev.target)) current.invalidate();
  });
  document.addEventListener("selectionchange", () => {
    textareaControllers.get(document.activeElement)?.selectionChanged();
  });
  new MutationObserver(records => {
    for (const controller of controllers) {
      if (!controller.textarea.isConnected || (controller.frame && !controller.frame.isConnected)) controller.destroy();
    }
    if (records.some(record => record.removedNodes?.length)) {
      for (const node of nodes) for (const binding of [...(nodeIframes.get(node) ?? [])]) {
        if (!binding.frame.isConnected) binding.destroy();
      }
    }
    if (records.some(record => [...record.addedNodes].some(el => isTextarea(el) || el.tagName === "IFRAME" || el.querySelector?.("textarea,iframe")))) {
      // Batch delayed DOM widget discovery into one frame; nodeCreated and
      // loadedGraphNode still scan immediately to preserve normal attachment.
      if (ownerNode) scheduleNodeTextareaScan(ownerNode, true);
      else for (const node of nodes) scheduleNodeTextareaScan(node, true);
    }
  }).observe(document.body, {childList: true, subtree: true});
}

function attachAutocomplete(textarea, node) {
  if (!shouldAttach(textarea) || textareaControllers.has(textarea)) return;
  const document = textarea.ownerDocument ?? globalThis.document;
  const window = document.defaultView ?? globalThis.window;
  const popup = makePopup(document);
  const listeners = new AbortController();
  const resize = installPopupResize(textarea, popup, {
    getHeight: () => getSetting(SETTINGS.popupHeight, DEFAULTS.popupHeight),
    saveHeight: height => {
      const saved = app.ui.settings.setSettingValue(SETTINGS.popupHeight, height);
      Promise.resolve(saved).catch(error => console.warn('JP Assist: could not save popup height', error));
    },
    signal: listeners.signal,
  });
  const candidateList = createCandidateList(popup, resize.handle, listeners.signal);
  // Keep scrollbar presses away from ComfyUI's outside-widget blur handler.
  popup.addEventListener("mousedown", ev => ev.stopPropagation(), {signal: listeners.signal});
  const listen = (type, handler) => textarea.addEventListener(type, handler, {signal: listeners.signal});
  let items = [];
  let active = 0;
  let token = null;
  let requestSerial = 0;
  let updateTimer = null;
  let request = null;
  let composing = false;
  let committing = false;
  let destroyed = false;
  let compositionKeyPending = false;

  function hide() {
    resize.cancel();
    popup.style.display = "none";
    candidateList.clear();
    items = [];
    token = null;
    active = 0;
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
    // ComfyUI's document mousedown handler blurs widgets clicked from outside.
    if (event.type === "mousedown") event.stopPropagation();
    committing = true;
    try {
      if (insertTag(textarea, token, item) && getSetting(SETTINGS.usageRanking, DEFAULTS.usageRanking)) usageHistory.record(item);
    }
    finally { committing = false; invalidate(); }
  }

  function refreshAppearance() {
    if (!destroyed && items.length && popup.style.display !== "none") {render(); resize.place();}
  }

  const controller = {textarea, node, frame: window.frameElement, popup, hide, invalidate, destroy, selectionChanged, refreshAppearance};
  controllers.add(controller);
  textareaControllers.set(textarea, controller);
  if (!nodeControllers.has(node)) nodeControllers.set(node, new Set());
  nodeControllers.get(node).add(controller);
  ensureGlobalDismissHandler();

  function render() {
    const colors = popupColors();
    popup.style.borderColor = colors.border;
    const showJP = showJapanese();
    const type = getSetting(SETTINGS.showSourceType, false);
    const file = getSetting(SETTINGS.showSourceFile, false);
    const count = getSetting(SETTINGS.showPostCount, false);
    const views = items.map(item => {
      const labels = [];
      const meta = item.meta ?? {};
      if (type) labels.push(({tag: "TAG", natural_language: "NL", custom: "CUSTOM"})[meta.source_type] ?? "?");
      if (file && meta.source_file) labels.push(meta.source_file);
      if (count) labels.push(meta.post_count === null || meta.post_count === undefined ? "Posts: unknown" : `Posts: ${meta.post_count}`);
      return {info: labels.join(" · "), aliases: showJP ? splitAlias(item).join(", ") : ""};
    });
    candidateList.setItems(items.length, index => `${!!views[index].info}:${!!views[index].aliases}`, index => {
      const item = items[index];
      const view = views[index];
      const row = document.createElement("div");
      row.style.cssText = `display:block;padding:6px 8px;cursor:pointer;background:${index === active ? colors.active : "transparent"}`;
      const tag = document.createElement("span");
      tag.textContent = item.tag;
      tag.style.cssText = "display:block;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      row.append(tag);
      if (view.info) {
        const info = document.createElement("span");
        info.textContent = view.info;
        info.title = info.textContent;
        info.style.cssText = "display:block;color:#aaa;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
        row.append(info);
      }
      if (view.aliases) {
        const ja = document.createElement("span");
        ja.textContent = view.aliases;
        ja.title = view.aliases;
        ja.style.cssText = "display:block;color:#bde;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px";
        row.append(ja);
      }
      row.addEventListener("mousedown", ev => commit(item, ev));
      return row;
    });
  }

  function setActive(index) {
    const next = Math.max(0, Math.min(items.length - 1, index));
    if (next === active) return;
    const previous = candidateList.row(active);
    if (previous) previous.style.background = "transparent";
    active = next;
    candidateList.reveal(next);
    const row = candidateList.row(next);
    if (row) {
      row.style.background = popupColors().active;
      row.scrollIntoView?.({block: "nearest"});
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
      popup.style.display = "block";
      render();
      popup.scrollTop = 0;
      resize.place();
      candidateList.refresh();
    } catch (error) {
      if (valid()) hide();
      if (error.name !== "AbortError") console.debug("JP Assist search unavailable", error.message);
    }
  }

  function scheduleUpdate() {
    invalidate();
    if (committing || composing || destroyed || formattingActive) return;
    const serial = requestSerial;
    updateTimer = setTimeout(() => { updateTimer = null; void update(serial); }, AUTOCOMPLETE_DEBOUNCE_MS);
  }

  listen("input", ev => {
    if (ev.isComposing) { invalidate(); return; }
    scheduleUpdate();
  });
  listen("focus", () => { invalidate(); if (!formattingActive) void update(requestSerial); });
  listen("blur", invalidate);
  listen("select", selectionChanged);
  const reposition = () => {
    if (!destroyed && items.length) {
      popup.style.display = "block";
      resize.place();
    }
  };
  let repositionPending = false;
  const scheduleReposition = () => {
    if (destroyed || !items.length || repositionPending) return;
    repositionPending = true;
    requestAnimationFrame(() => {
      repositionPending = false;
      reposition();
    });
  };
  listen("scroll", reposition);
  window.addEventListener("resize", reposition, {signal: listeners.signal});
  window.addEventListener("wheel", ev => {
    if (!popup.contains(ev.target)) scheduleReposition();
  }, {passive: true, signal: listeners.signal});
  window.addEventListener("pointermove", ev => {
    if (ev.buttons && !popup.contains(ev.target)) scheduleReposition();
  }, {signal: listeners.signal});
  // Capture page/panel scrolling, but do not relayout when the candidate list scrolls.
  document.addEventListener("scroll", ev => {
    if (ev.target !== popup && !popup.contains(ev.target)) reposition();
  }, {capture: true, signal: listeners.signal});
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
  // A newly rendered card can receive focus/input before the batched scan.
  if (document.activeElement === textarea) scheduleUpdate();
}

function attachIframe(frame, node) {
  const existing = iframeBindings.get(frame);
  if (existing) { existing.scan(); return; }
  let currentDocument = null;
  const clearDocument = () => {
    for (const controller of [...(nodeControllers.get(node) ?? [])]) {
      if (controller.textarea.ownerDocument === currentDocument) controller.destroy();
    }
  };
  const scan = () => {
    // Cross-origin frames are intentionally inaccessible and are skipped.
    let document;
    try { document = frame.contentDocument; } catch { document = null; }
    if (currentDocument && currentDocument !== document) clearDocument();
    currentDocument = document;
    if (!document?.body) return;
    ensureGlobalDismissHandler(document, node);
    attachTextareasInElement(document.body, node);
  };
  const binding = {frame, scan, destroy() {
    frame.removeEventListener("load", scan);
    clearDocument();
    iframeBindings.delete(frame);
    nodeIframes.get(node)?.delete(binding);
  }};
  iframeBindings.set(frame, binding);
  nodeIframes.get(node)?.add(binding);
  frame.addEventListener("load", scan);
  scan();
}

function attachTextareasInElement(el, node) {
  if (isTextarea(el)) {
    attachAutocomplete(el, node);
    return;
  }
  if (!(el instanceof (el?.ownerDocument?.defaultView?.Element ?? Element))) return;
  if (el.tagName === "IFRAME") { attachIframe(el, node); return; }
  el.querySelectorAll("textarea").forEach(textarea => attachAutocomplete(textarea, node));
  el.querySelectorAll("iframe").forEach(frame => attachIframe(frame, node));
}

function attachNodeTextareas(node) {
  for (const widget of node?.widgets || []) {
    attachTextareasInElement(widget?.inputEl, node);
    if (widget?.element !== widget?.inputEl) attachTextareasInElement(widget?.element, node);
  }
}

function scheduleNodeTextareaScan(node, frameOnly = false) {
  if (!node || removedNodes.has(node)) return;
  nodes.add(node);
  if (!nodeControllers.has(node)) {
    nodeControllers.set(node, new Set());
    nodeIframes.set(node, new Set());
    const onRemoved = node.onRemoved;
    node.onRemoved = function (...args) {
      removedNodes.add(this);
      nodes.delete(this);
      for (const controller of [...(nodeControllers.get(this) ?? [])]) controller.destroy();
      for (const binding of [...(nodeIframes.get(this) ?? [])]) binding.destroy();
      return onRemoved?.apply(this, args);
    };
  }
  if (!frameOnly) attachNodeTextareas(node);
  if (!scheduledNodeScans.has(node) && typeof requestAnimationFrame === "function") {
    scheduledNodeScans.add(node);
    requestAnimationFrame(() => {
      scheduledNodeScans.delete(node);
      if (!removedNodes.has(node)) attachNodeTextareas(node);
    });
  }
}

async function addSettings() {
  addSetting({id: SETTINGS.popupHeight, name: "Suggestion popup height (px)", type: "number",
    defaultValue: DEFAULTS.popupHeight, attrs: {min:120, max:4096, step:10},
    category: ["Danbooru Tag JP Assist", "Display", "Suggestion popup height"]});
  addSetting({
    id: SETTINGS.completionUnit, name: "Completion unit", type: "combo",
    category: ["Danbooru Tag JP Assist", "Autocomplete", "Completion unit"],
    options: [{value: "tag", text: "Tag (comma separated)"}, {value: "word", text: "Word (after spaces)"}],
    defaultValue: DEFAULTS.completionUnit,
  });
  addSetting({
    id: SETTINGS.behavior, name: "Completion behavior", type: "combo",
    category: ["Danbooru Tag JP Assist", "Autocomplete", "Completion behavior"],
    options: [{value: "existing", text: "Existing"}, {value: "csv", text: "CSV-aware"}], defaultValue: "existing",
  });
  for (const [key, name, group] of [
    ["usageRanking", "Prioritize frequently used candidates", "Autocomplete"],
    ["searchJapanese", "Use JP aliases for search", "Autocomplete"],
    ["showSourceType", "Show TAG / NL / CUSTOM", "Display"],
    ["showSourceFile", "Show source CSV", "Display"],
    ["showPostCount", "Show post count", "Display"],
  ]) addSetting({id: SETTINGS[key], name, category: ["Danbooru Tag JP Assist", group, name], type: "boolean", defaultValue: DEFAULTS[key]});
  addSetting({id: SETTINGS.underscoreExclusions, name: "Underscore exclusions", type: "text",
    category: ["Danbooru Tag JP Assist", "Insert", "Underscore exclusions"], defaultValue: "",
  });
  addLocalizedSetting(app, {id: "DanbooruTagJPAssist.ReloadDictionaries", name: "Reload dictionaries", type: () => {
    const button = document.createElement("button");
    let status = "ready";
    const updateButton = () => {
      button.textContent = status === "done" ? uiText(app, "Dictionaries reloaded", "辞書を再読み込みしました")
        : status === "failed" ? uiText(app, "Reload failed — retry", "再読み込み失敗・再試行")
        : uiText(app, "Reload dictionaries", "辞書を再読み込み");
      button.title = uiText(app, "Reload local CSVs and clear search caches. No download or restart.", "ローカルCSVと検索キャッシュを更新します。ダウンロード・再起動はしません。");
    };
    updateButton();
    onLocaleChange(app, () => {if (button.isConnected) updateButton();});
    button.className = "p-button p-component";
    button.onclick = async () => {
      button.disabled = true;
      invalidateResults();
      try {
        await fetchFirstJson(["/danbooru-tag-jp-assist/reload"], null, {method: "POST"});
        dictionaryRevision = null;
        await refreshFileSelections();
        status = "done"; updateButton();
      } catch { status = "failed"; updateButton(); }
      finally { button.disabled = false; }
    };
    return button;
  }, category: ["Danbooru Tag JP Assist", "Files", "Reload dictionaries"]});
  onLocaleChange(app, () => {
    for (const editor of fileSelectionEditors) {
      if (editor.root.isConnected) editor.refreshCurrent();
      else fileSelectionEditors.delete(editor);
    }
    for (const editor of legacyEditors) {
      if (editor.root.isConnected) editor.refresh();
      else legacyEditors.delete(editor);
    }
  });
  const files = await loadFileList();
  addLocalizedSetting(app, {id: "DanbooruTagJPAssist.ClearUsageHistory", name: "Clear usage history",
    category: ["Danbooru Tag JP Assist", "Autocomplete", "Clear usage history"], type: () => {
      const root = document.createElement("div");
      const button = document.createElement("button");
      button.type = "button";
      let cleared = false;
      const update = () => {
        button.textContent = cleared ? uiText(app, "Usage history cleared", "使用履歴を消去しました") : uiText(app, "Clear usage history", "使用履歴を消去");
        button.title = localizedDefinition(app, "DanbooruTagJPAssist.ClearUsageHistory").tooltip;
      };
      button.onclick = () => {usageHistory.clear(); cleared = true; update();};
      update(); root.append(button);
      const help = document.createElement("p");
      const updateHelp = () => {
        help.textContent = files.usage_ranking ? uiText(app, "Saved in this browser for this ComfyUI address.", "履歴はこのブラウザー・ComfyUI接続先ごとに保存します。")
          : uiText(app, "Usage ranking needs the updated server on your next restart. Normal completion remains available.", "使用頻度による順位付けは次回のComfyUI再起動後に有効です。通常の補完は使えます。");
      };
      updateHelp(); help.style.cssText = "font-size:12px;color:var(--descrip-text,#aaa)"; root.append(help);
      onLocaleChange(app, () => {if (root.isConnected) {update(); updateHelp();}});
      return root;
    }});
  const tagFiles = Array.isArray(files.tag_files) && files.tag_files.length ? files.tag_files : ["All"];
  const translationFiles = Array.isArray(files.translation_files) && files.translation_files.length ? files.translation_files : ["All"];
  DEFAULTS.tagFiles = defaultTagFiles(tagFiles);
  DEFAULTS.translationFiles = orderedNames(translationFiles);
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
    type: "hidden",
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
    type: "hidden",
    options: tagFiles.map((name) => ({ value: name, text: name })),
    defaultValue: DEFAULTS.tagFile,
  });
  addSetting({
    id: SETTINGS.translationFile,
    name: "2. Translation file",
    category: ["Danbooru Tag JP Assist", "Files", "2. Translation file"],
    type: "hidden",
    options: translationFiles.map((name) => ({ value: name, text: name })),
    defaultValue: DEFAULTS.translationFile,
  });
  for (const kind of ["translation", "tag"]) {
    addFileSelection(kind, files);
    addSetting({
      id: SETTINGS[`${kind}SelectionMode`], name: `${kind === "tag" ? "Tag" : "Translation"} selection mode`, type: "hidden",
      category: ["Danbooru Tag JP Assist", "Files", `${kind} selection mode`],
      options: [{value: "legacy", text: kind === "tag" ? "All / single priority" : "All / single file"}, {value: "selected", text: "Selected CSVs only"}],
      defaultValue: DEFAULTS[`${kind}SelectionMode`],
    });
  }
  addLegacySettings(files);
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

app.registerExtension({
  name: EXT_NAME,
  setup() {
    installTooltipCleanup();
    installFormatting(app, {getControllers: () => controllers,
      begin: () => { formattingActive = true; for (const c of controllers) c.invalidate(); },
      end: () => { formattingActive = false; },
    });
  },
  async init() {
    ensureGlobalDismissHandler();
    await addSettings();
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
