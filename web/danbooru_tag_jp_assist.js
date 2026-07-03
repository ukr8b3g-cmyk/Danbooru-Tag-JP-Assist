import { app } from "/scripts/app.js";

const API_URL = "/danbooru-tag-jp-assist/tags";
const FILES_API_URL = "/danbooru-tag-jp-assist/files";
const HF_UPDATE_API_URL = "/danbooru-tag-jp-assist/hf-update";
const EXT_NAME = "Danbooru.Tag.JP.Assist";
const SETTINGS = {
  enabled: "DanbooruTagJPAssist.Enabled",
  maxSuggestions: "DanbooruTagJPAssist.MaxSuggestions",
  showAll: "DanbooruTagJPAssist.ShowAll",
  autoComma: "DanbooruTagJPAssist.AutoComma",
  showJapanese: "DanbooruTagJPAssist.ShowJapanese",
  spacesForUnderscores: "DanbooruTagJPAssist.SpacesForUnderscores",
  sortOrder: "DanbooruTagJPAssist.SortOrder",
  tagSource: "DanbooruTagJPAssist.TagSource",
  popupTheme: "DanbooruTagJPAssist.PopupTheme",
  tagFile: "DanbooruTagJPAssist.TagFile",
  translationFile: "DanbooruTagJPAssist.TranslationFile",
  autoUpdateHf: "DanbooruTagJPAssist.AutoUpdateHf",
};
const DEFAULTS = {
  enabled: true,
  maxSuggestions: 10,
  showAll: false,
  autoComma: true,
  showJapanese: true,
  spacesForUnderscores: true,
  sortOrder: "match",
  tagSource: "both",
  popupTheme: "gray",
  tagFile: "danbooru_tags.csv",
  translationFile: "All",
  autoUpdateHf: true,
};
const tagCache = new Map();
let fileListCache = null;

async function loadTags() {
  const source = tagSource();
  const selectedTagFile = selectedTagFileName();
  const selectedTranslationFile = selectedTranslationFileName();
  const cacheKey = `${source}|${selectedTagFile}|${selectedTranslationFile}`;
  if (!tagCache.has(cacheKey)) {
    const params = new URLSearchParams({
      source,
      tag_file: selectedTagFile,
      translation_file: selectedTranslationFile,
    });
    const url = `${API_URL}?${params.toString()}`;
    tagCache.set(cacheKey, fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { tags: [] }))
      .then((data) => (Array.isArray(data.tags) ? data.tags : []))
      .catch(() => []));
  }
  return tagCache.get(cacheKey);
}

async function loadFileList() {
  if (!fileListCache) {
    fileListCache = fetch(FILES_API_URL, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { tag_files: ["All"], translation_files: ["All"] }))
      .catch(() => ({ tag_files: ["All"], translation_files: ["All"] }));
  }
  return fileListCache;
}

function normalize(text) {
  return String(text || "").toLowerCase().replace(/_/g, " ").trim();
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
  const end = textarea.selectionStart ?? textarea.value.length;
  const before = textarea.value.slice(0, end);
  const start = Math.max(before.lastIndexOf(","), before.lastIndexOf("\n")) + 1;
  return { start, end, text: before.slice(start).trim() };
}

function insertTag(textarea, token, tag) {
  const before = textarea.value.slice(0, token.start);
  const after = textarea.value.slice(token.end);
  const prefix = before && !/[,\n]\s*$/.test(before) ? `${before}, ` : before;
  const suffix = autoComma() ? ", " : " ";
  const inserted = spacesForUnderscores() ? tag.replace(/_/g, " ") : tag;
  textarea.value = `${prefix}${inserted}${suffix}${after.replace(/^\s+/, "")}`;
  const pos = `${prefix}${inserted}${suffix}`.length;
  textarea.setSelectionRange(pos, pos);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function shouldAttach(el) {
  if (!el || el.tagName !== "TEXTAREA") return false;
  if (!isEnabled()) return false;
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

function scoreItem(item, query) {
  const q = normalize(query);
  const tag = normalize(item.tag);
  const aliases = splitAlias(item).map(normalize);
  if (tag === q || aliases.includes(q)) return 0;
  if (tag.startsWith(q) || aliases.some((a) => a.startsWith(q))) return 1;
  if (tag.includes(q) || aliases.some((a) => a.includes(q))) return 2;
  return 99;
}

function countValue(item) {
  return Number(item.count) || 0;
}

function compareSuggestions(a, b) {
  const order = sortOrder();
  if (order === "count") {
    return countValue(b.item) - countValue(a.item) || a.score - b.score || String(a.item.tag).localeCompare(String(b.item.tag));
  }
  if (order === "az") {
    return String(a.item.tag).localeCompare(String(b.item.tag)) || a.score - b.score || countValue(b.item) - countValue(a.item);
  }
  return a.score - b.score || countValue(b.item) - countValue(a.item) || String(a.item.tag).localeCompare(String(b.item.tag));
}

function attachAutocomplete(textarea) {
  if (!shouldAttach(textarea) || textarea.__jpTagAutocompleteAttached) return;
  textarea.__jpTagAutocompleteAttached = true;

  const popup = makePopup();
  let items = [];
  let active = 0;
  let token = null;

  function hide() {
    popup.style.display = "none";
    popup.innerHTML = "";
    items = [];
    active = 0;
  }

  function render() {
    popup.innerHTML = "";
    const colors = popupColors();
    popup.style.borderColor = colors.border;
    items.forEach((item, index) => {
      const row = document.createElement("div");
      row.style.cssText = [
        "display:grid",
        "grid-template-columns:minmax(95px,1fr) minmax(160px,1.6fr)",
        "gap:8px",
        "padding:6px 8px",
        "cursor:pointer",
        "align-items:center",
        index === active ? `background:${colors.active}` : "background:transparent",
      ].join(";");
      const tag = document.createElement("span");
      tag.textContent = item.tag;
      tag.style.cssText = "font-weight:700;color:#fff;white-space:nowrap";
      const ja = document.createElement("span");
      ja.textContent = splitAlias(item).join(", ");
      ja.title = ja.textContent;
      ja.style.cssText = showJapanese()
        ? "color:#bde;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
        : "display:none";
      row.style.gridTemplateColumns = showJapanese() ? "minmax(95px,1fr) minmax(160px,1.6fr)" : "1fr";
      row.append(tag);
      if (showJapanese()) row.append(ja);
      row.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        insertTag(textarea, token, item.tag);
        hide();
      });
      popup.append(row);
    });
  }

  async function update() {
    if (!isEnabled()) {
      hide();
      return;
    }
    token = currentToken(textarea);
    const query = token.text;
    if (!query) {
      hide();
      return;
    }

    const tags = await loadTags();
    items = tags
      .map((item) => ({ item, score: scoreItem(item, query) }))
      .filter((x) => x.score < 99)
      .sort(compareSuggestions)
      .slice(0, showAllSuggestions() ? 500 : maxSuggestions())
      .map((x) => x.item);

    if (!items.length) {
      hide();
      return;
    }

    active = 0;
    const rect = textarea.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 300))}px`;
    popup.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 250))}px`;
    popup.style.width = `${Math.max(300, Math.min(rect.width, window.innerWidth - 16))}px`;
    popup.style.display = "block";
    render();
  }

  textarea.addEventListener("input", update);
  textarea.addEventListener("focus", update);
  textarea.addEventListener("blur", () => setTimeout(hide, 120));
  document.addEventListener("mousedown", (ev) => {
    if (ev.target === textarea || popup.contains(ev.target)) return;
    hide();
  });
  textarea.addEventListener("keydown", (ev) => {
    if (popup.style.display === "none" || !items.length) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      active = Math.min(items.length - 1, active + 1);
      render();
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      active = Math.max(0, active - 1);
      render();
    } else if (ev.key === "Enter" || ev.key === "Tab") {
      ev.preventDefault();
      insertTag(textarea, token, items[active].tag);
      hide();
    } else if (ev.key === "Escape") {
      hide();
    }
  });
}

function attachAllTextareas(root = document) {
  root.querySelectorAll?.("textarea")?.forEach(attachAutocomplete);
}

function startObserver() {
  attachAllTextareas();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.tagName === "TEXTAREA") attachAutocomplete(node);
        attachAllTextareas(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("focus", () => attachAllTextareas());
}

async function addSettings() {
  const files = await loadFileList();
  const tagFiles = Array.isArray(files.tag_files) && files.tag_files.length ? files.tag_files : ["All"];
  const translationFiles = Array.isArray(files.translation_files) && files.translation_files.length ? files.translation_files : ["All"];
  app.ui?.settings?.addSetting?.({
    id: SETTINGS.enabled,
    name: "Enable suggestions / 補完を有効化",
    category: ["Danbooru Tag JP Assist", "Autocomplete / 補完", "Enable / 有効化"],
    type: "boolean",
    defaultValue: DEFAULTS.enabled,
  });
  app.ui?.settings?.addSetting?.({
    id: SETTINGS.maxSuggestions,
    name: "Suggestion count / 表示数",
    category: ["Danbooru Tag JP Assist", "Autocomplete / 補完", "Suggestion count / 表示数"],
    type: "number",
    defaultValue: DEFAULTS.maxSuggestions,
    attrs: { min: 1, max: 200, step: 1 },
  });
  app.ui?.settings?.addSetting?.({
    id: SETTINGS.tagSource,
    name: "Tag source / タグ元",
    category: ["Danbooru Tag JP Assist", "Autocomplete / 補完", "Tag source / タグ元"],
    type: "combo",
    options: [
      { value: "hf", text: "Hugging Face" },
      { value: "own", text: "Own tag file / 自分のタグ" },
      { value: "both", text: "Both / 両方" },
    ],
    defaultValue: DEFAULTS.tagSource,
  });
  app.ui?.settings?.addSetting?.({
    id: SETTINGS.tagFile,
    name: "1. Tag file / タグファイル",
    category: ["Danbooru Tag JP Assist", "Files / ファイル", "1. Tag file / タグファイル"],
    type: "combo",
    options: tagFiles.map((name) => ({ value: name, text: name })),
    defaultValue: DEFAULTS.tagFile,
  });
  app.ui?.settings?.addSetting?.({
    id: SETTINGS.autoUpdateHf,
    name: "3. Auto update HF file / HF更新チェック",
    category: ["Danbooru Tag JP Assist", "Files / ファイル", "3. Auto update HF / HF更新"],
    type: "boolean",
    defaultValue: DEFAULTS.autoUpdateHf,
  });
  app.ui?.settings?.addSetting?.({
    id: SETTINGS.translationFile,
    name: "2. Translation file / 翻訳ファイル",
    category: ["Danbooru Tag JP Assist", "Files / ファイル", "2. Translation file / 翻訳ファイル"],
    type: "combo",
    options: translationFiles.map((name) => ({ value: name, text: name })),
    defaultValue: DEFAULTS.translationFile,
  });
  app.ui?.settings?.addSetting?.({
    id: SETTINGS.popupTheme,
    name: "Popup color / 候補色",
    category: ["Danbooru Tag JP Assist", "Display / 表示", "Popup color / 候補色"],
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
  app.ui?.settings?.addSetting?.({
    id: SETTINGS.sortOrder,
    name: "Sort mode / 並び順",
    category: ["Danbooru Tag JP Assist", "Autocomplete / 補完", "Sort mode / 並び順"],
    type: "combo",
    options: [
      { value: "match", text: "Match first" },
      { value: "count", text: "Popularity count" },
      { value: "az", text: "Tag A-Z" },
    ],
    defaultValue: DEFAULTS.sortOrder,
  });
  app.ui?.settings?.addSetting?.({
    id: SETTINGS.showAll,
    name: "List every match / 全候補表示",
    category: ["Danbooru Tag JP Assist", "Autocomplete / 補完", "Show all / 全表示"],
    type: "boolean",
    defaultValue: DEFAULTS.showAll,
  });
  app.ui?.settings?.addSetting?.({
    id: SETTINGS.autoComma,
    name: "Append comma / カンマ追加",
    category: ["Danbooru Tag JP Assist", "Insert / 挿入", "Auto comma / カンマ"],
    type: "boolean",
    defaultValue: DEFAULTS.autoComma,
  });
  app.ui?.settings?.addSetting?.({
    id: SETTINGS.showJapanese,
    name: "Display JP aliases / 日本語表示",
    category: ["Danbooru Tag JP Assist", "Display / 表示", "Japanese aliases / 日本語"],
    type: "boolean",
    defaultValue: DEFAULTS.showJapanese,
  });
  app.ui?.settings?.addSetting?.({
    id: SETTINGS.spacesForUnderscores,
    name: "Use spaces for underscores / _を空白に",
    category: ["Danbooru Tag JP Assist", "Insert / 挿入", "Underscore format / 空白変換"],
    type: "boolean",
    defaultValue: DEFAULTS.spacesForUnderscores,
  });
}

async function maybeUpdateHfFile() {
  if (!autoUpdateHf()) return;
  try {
    await fetch(HF_UPDATE_API_URL, { method: "POST", cache: "no-store" });
    fileListCache = null;
    tagCache.clear();
  } catch {
    // Network or server errors should not block normal autocomplete use.
  }
}

app.registerExtension({
  name: EXT_NAME,
  async init() {
    await maybeUpdateHfFile();
    await addSettings();
  },
  setup() {
    startObserver();
  },
});

