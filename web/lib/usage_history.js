// Browser-local history for this ComfyUI address. No prompt text is stored.
export const USAGE_STORAGE_KEY = 'DanbooruTagJPAssist.usage.v1';
export const MAX_USAGE_ENTRIES = 2000;
const MAX_COUNT = 2147483647;

export function candidateKey(item) {
  const meta = item.meta ?? {};
  return JSON.stringify([meta.source_file ?? '', meta.source_type ?? 'tag',
    meta.category_scheme ?? 'unknown', meta.insert_mode ?? 'tag', item.tag]);
}

function validEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(-MAX_USAGE_ENTRIES).filter(entry => {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    const [key, count] = entry;
    if (typeof key !== 'string' || key.length > 8192 || !Number.isSafeInteger(count) || count < 1 || count > MAX_COUNT) return false;
    try {
      const parts = JSON.parse(key);
      return Array.isArray(parts) && parts.length === 5 && parts.every(part => typeof part === 'string') && !!parts[4];
    } catch { return false; }
  });
}

export function createUsageHistory({storage = () => globalThis.localStorage, onChange = () => {}, events = globalThis.window} = {}) {
  let fallback = [];
  let storageFailed = false;
  function entries() {
    if (storageFailed) return fallback;
    try {
      const saved = JSON.parse(storage()?.getItem(USAGE_STORAGE_KEY) ?? 'null');
      return saved?.version === 1 ? validEntries(saved.entries) : [];
    } catch { return fallback; }
  }
  function save(next) {
    fallback = next;
    try {
      if (next.length) storage().setItem(USAGE_STORAGE_KEY, JSON.stringify({version: 1, entries: next}));
      else storage().removeItem(USAGE_STORAGE_KEY);
      storageFailed = false;
    } catch {
      storageFailed = true; // Private browsing / quota: keep input and session history usable.
    }
    onChange();
  }
  const storageChanged = event => {
    if (event.key === USAGE_STORAGE_KEY || event.key === null) {fallback = []; storageFailed = false; onChange();}
  };
  events?.addEventListener('storage', storageChanged);
  return {
    entries,
    record(item) {
      if (typeof item?.tag !== 'string' || !item.tag) return;
      const key = candidateKey(item);
      const counts = new Map(entries());
      const count = Math.min(MAX_COUNT, (counts.get(key) ?? 0) + 1);
      if (!validEntries([[key, count]]).length) return;
      counts.delete(key);
      counts.set(key, count);
      save([...counts].slice(-MAX_USAGE_ENTRIES));
    },
    clear() { save([]); },
    dispose() { events?.removeEventListener('storage', storageChanged); },
  };
}
