import asyncio
import csv
import heapq
import hashlib
import logging
import json
import os
import threading
from array import array
from bisect import bisect_left, bisect_right

import server
from aiohttp import web


WEB_DIRECTORY = "./web"
DATA_DIR = os.path.join(os.path.dirname(__file__), "tags")
TAG_FILES_DIR = os.path.join(DATA_DIR, "tag_files")
TRANSLATION_FILES_DIR = os.path.join(DATA_DIR, "translation_files")
HF_TAG_FILE = "danbooru_tags.csv"
LEGACY_HF_TAG_FILE = "hf_danbooru_tags.csv"

_TAG_CACHE_LOCK = threading.Lock()
_TAG_CACHE_KEY = None
_TAG_CACHE_ROWS = None
_TAG_CACHE_SEARCH = None
_TAG_CACHE_ERRORS = ()
# Do not publish an incomplete dictionary over the last successful index.
# Reuse failed selections until a file changes or Reload is explicitly requested.
_TAG_PARTIAL_CACHE = {}
_TAG_PARTIAL_CACHE_LIMIT = 2
_LOG = logging.getLogger(__name__)


class _SearchIndex(list):
    def __init__(self, rows):
        super().__init__(rows)
        self.alias_text = ["\0".join(aliases) for _, _, aliases, _, _ in rows]
        self.names = [str(row["tag"]).casefold() for row, _, _, _, _ in rows]
        positions = list(range(len(rows)))
        self.by_count = sorted(positions, key=lambda i: (rows[i][4], -rows[i][3], self.names[i]))
        self.by_name = sorted(positions, key=lambda i: (rows[i][4], self.names[i]))
        self.positions = {row["tag"]: i for i, (row, _, _, _, _) in enumerate(rows)}
        self.first_priority = min((row[4] for row in rows), default=0)
        self.terms = sorted((term, i, alias) for i, (_, tag, aliases, _, _) in enumerate(rows)
                            for alias, values in [(False, (tag,)), (True, aliases)] for term in values)
        parts = ["\1".join((tag, self.alias_text[i])) + "\0" for i, (_, tag, _, _, _) in enumerate(rows)]
        self.corpus = "".join(parts)
        self.ends = array("Q")
        end = 0
        for part in parts:
            end += len(part)
            self.ends.append(end)

    def candidates(self, needles, japanese, prefix=False):
        positions = set()
        for needle in needles:
            if "\0" in needle or "\1" in needle:
                return range(len(self))
            if prefix:
                start = bisect_left(self.terms, (needle, -1, False))
                for i in range(start, len(self.terms)):
                    term, position, alias = self.terms[i]
                    if not term.startswith(needle):
                        break
                    if japanese or not alias:
                        positions.add(position)
            else:
                start = 0
                while True:
                    hit = self.corpus.find(needle, start)
                    if hit < 0:
                        break
                    position = bisect_right(self.ends, hit)
                    positions.add(position)
                    start = self.ends[position]
        return sorted(positions)


class DanbooruTagJPAssist:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": ("STRING", {"multiline": True, "default": ""}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "run"
    CATEGORY = "Danbooru Tag JP Assist"

    def run(self, text):
        return (text,)


def _csv_files(folder):
    if not os.path.isdir(folder):
        return []
    return [
        os.path.join(folder, name)
        for name in sorted(os.listdir(folder))
        if name.lower().endswith(".csv") and name != LEGACY_HF_TAG_FILE
    ]


def _csv_file_names(folder):
    names = [os.path.basename(path) for path in _csv_files(folder)]
    return names


def _safe_csv_name(name):
    if not name or name in {"all", "All"}:
        return ""
    base = os.path.basename(name)
    if base != name or not base.lower().endswith(".csv"):
        return ""
    return base


def _selected_files(folder, selected):
    selected = _safe_csv_name(selected)
    if not selected:
        return _csv_files(folder)
    path = os.path.join(folder, selected)
    return [path] if os.path.isfile(path) else []


def _ordered_files(folder, names):
    available = {os.path.basename(path): path for path in _csv_files(folder)}
    if folder == TAG_FILES_DIR and HF_TAG_FILE not in available:
        hf_path = os.path.join(DATA_DIR, HF_TAG_FILE)
        if os.path.isfile(hf_path):
            available[HF_TAG_FILE] = hf_path
    return list(dict.fromkeys(available[name] for name in names if name in available))


def _requested_files(params, key):
    if key not in params:
        return None
    try:
        names = json.loads(params[key])
    except (ValueError, TypeError):
        return []
    if not isinstance(names, list):
        return []
    return list(dict.fromkeys(name for name in names if isinstance(name, str) and _safe_csv_name(name)))


def _legacy_csv_files():
    if not os.path.isdir(DATA_DIR):
        return []
    return [
        os.path.join(DATA_DIR, name)
        for name in sorted(os.listdir(DATA_DIR))
        if name.lower().endswith(".csv") and name not in {HF_TAG_FILE, LEGACY_HF_TAG_FILE}
    ]


def _resolve_tag_file_groups(source="both", tag_file="all", tag_files=None):
    """Return (priority_files, fallback_files) for tag search.

    An explicitly selected Tag file is searched with higher priority. Remaining
    files are still available as fallbacks according to Tag source, so selecting
    one file no longer turns the search into a hard single-file filter.
    """
    if tag_files is not None:
        return _ordered_files(TAG_FILES_DIR, tag_files), []
    source = source if source in {"hf", "own", "both"} else "both"
    hf_path = os.path.join(TAG_FILES_DIR, HF_TAG_FILE)
    if not os.path.isfile(hf_path):
        hf_path = os.path.join(DATA_DIR, HF_TAG_FILE)

    hf_files = [hf_path] if os.path.isfile(hf_path) else []

    own_candidates = _selected_files(TAG_FILES_DIR, "all")
    own_files = [
        path for path in own_candidates
        if os.path.basename(path) != HF_TAG_FILE
    ]
    own_files += _legacy_csv_files()

    if source == "hf":
        fallback_files = list(hf_files)
    elif source == "own":
        fallback_files = list(own_files)
    else:
        fallback_files = list(own_files) + list(hf_files)

    priority_files = []
    selected_tag = _safe_csv_name(tag_file)
    if selected_tag:
        if selected_tag == HF_TAG_FILE and hf_files:
            priority_files = list(hf_files)
        else:
            selected_path = os.path.join(TAG_FILES_DIR, selected_tag)
            if os.path.isfile(selected_path):
                priority_files = [selected_path]

    if priority_files:
        priority_keys = {os.path.normcase(os.path.abspath(path)) for path in priority_files}
        fallback_files = [
            path for path in fallback_files
            if os.path.normcase(os.path.abspath(path)) not in priority_keys
        ]

    return priority_files, fallback_files


def _resolve_tag_files(source="both", tag_file="all", tag_files=None):
    priority_files, fallback_files = _resolve_tag_file_groups(source, tag_file, tag_files)
    return priority_files + fallback_files


def _resolve_translation_files(selected="all", translation_files=None):
    if translation_files is not None:
        return _ordered_files(TRANSLATION_FILES_DIR, translation_files)
    paths = _selected_files(TRANSLATION_FILES_DIR, selected)
    if not _safe_csv_name(selected):
        paths += _legacy_csv_files()
    return paths


def _file_signature(paths):
    signature = []
    for path in paths:
        try:
            stat = os.stat(path)
        except OSError:
            signature.append((path, None, None))
        else:
            signature.append((path, stat.st_mtime_ns, stat.st_size))
    return tuple(signature)


def _csv_rows(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f, strict=True)
        first = next((row for row in reader if any(cell.strip() for cell in row)), None)
        if first is None:
            return
        names = [cell.strip().lower() for cell in first]
        header = names if names[0] in {"tag", "english"} else None
        if header is None:
            yield {key: first[i] if i < len(first) else "" for i, key in enumerate(("tag", "category", "count", "aliases"))}
        for cells in reader:
            if not any(cell.strip() for cell in cells):
                continue
            keys = header or ("tag", "category", "count", "aliases")
            yield {key: cells[i] if i < len(cells) else "" for i, key in enumerate(keys)}


def _nonnegative_int(value):
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _read_tag_csv(path):
    rows = []
    filename = os.path.basename(path)
    defaults = {
        "natural_language_tags.csv": ("natural_language", "word", "unknown"),
        "danbooru_2025.csv": ("tag", "tag", "danbooru"),
        HF_TAG_FILE: ("tag", "tag", "danbooru"),
        "e621.csv": ("tag", "tag", "e621"),
    }
    default_source, default_mode, default_scheme = defaults.get(filename, ("tag", "tag", "unknown"))
    for row in _csv_rows(path):
        original = row.get("tag") or row.get("english") or ""
        tag = original.strip()
        if not tag:
            continue
        source_type = (row.get("source_type") or default_source).strip().lower()
        if source_type not in {"tag", "natural_language", "custom"}:
            source_type = default_source
        insert_mode = (row.get("insert_mode") or ("word" if source_type == "natural_language" else default_mode)).strip().lower()
        if insert_mode not in {"tag", "phrase", "word", "raw"}:
            insert_mode = "tag"
        scheme = (row.get("category_scheme") or default_scheme).strip().lower()
        count = (row.get("count") or "").strip()
        category = _nonnegative_int(row.get("category"))
        rows.append({
            "tag": tag, "ja": "", "aliases": (row.get("aliases") or "").strip(), "count": count,
            "meta": {
                "insert_text": original if insert_mode == "raw" else tag,
                "source_file": filename, "source_type": source_type,
                "insert_mode": insert_mode, "category": category,
                "category_scheme": scheme or "unknown",
                "post_count": _nonnegative_int(count) if source_type == "tag" and scheme in {"danbooru", "e621"} else None,
            },
        })
    return rows


def _read_translation_map(paths):
    translations = {}
    errors = []
    for path in paths:
        try:
            file_translations = {}
            for row in _csv_rows(path):
                tag = (row.get("tag") or row.get("english") or "").strip()
                ja = (row.get("ja") or row.get("jp") or row.get("japanese") or row.get("translation") or row.get("alias") or "").strip()
                aliases = (row.get("aliases") or row.get("alias") or "").strip()
                if tag and (ja or aliases):
                    file_translations[tag] = {"ja": ja, "aliases": aliases}
            translations.update(file_translations)
        except (OSError, UnicodeError, csv.Error) as error:
            _LOG.warning("JP Assist: could not read %s: %s", os.path.basename(path), error)
            errors.append(os.path.basename(path))
    return translations, errors


def _normalize(text):
    return str(text or "").casefold().replace("_", " ").strip()


def _split_aliases(row):
    text = ",".join(value for value in (row.get("ja"), row.get("aliases")) if value)
    return tuple(
        _normalize(value)
        for value in text.replace(";", ",").split(",")
        if value.strip()
    )


def _count_value(row):
    try:
        return int(row.get("count") or 0)
    except (TypeError, ValueError, OverflowError):
        try:
            return int(float(row.get("count") or 0))
        except (TypeError, ValueError, OverflowError):
            return 0


def _clear_tag_cache():
    global _TAG_CACHE_KEY, _TAG_CACHE_ROWS, _TAG_CACHE_SEARCH, _TAG_CACHE_ERRORS
    with _TAG_CACHE_LOCK:
        _TAG_CACHE_KEY = None
        _TAG_CACHE_ROWS = None
        _TAG_CACHE_SEARCH = None
        _TAG_CACHE_ERRORS = ()
        _TAG_PARTIAL_CACHE.clear()


def _load_cached_tag_data(source="both", tag_file="all", translation_file="all", tag_files=None, translation_files=None):
    global _TAG_CACHE_KEY, _TAG_CACHE_ROWS, _TAG_CACHE_SEARCH, _TAG_CACHE_ERRORS

    source = source if source in {"hf", "own", "both"} else "both"
    priority_paths, fallback_paths = _resolve_tag_file_groups(source, tag_file, tag_files)
    tag_paths = priority_paths + fallback_paths
    translation_paths = _resolve_translation_files(translation_file, translation_files)
    cache_key = (
        source,
        _safe_csv_name(tag_file) or "all",
        _safe_csv_name(translation_file) or "all",
        tag_files is not None,
        translation_files is not None,
        _file_signature(tag_paths),
        _file_signature(translation_paths),
    )

    with _TAG_CACHE_LOCK:
        if cache_key == _TAG_CACHE_KEY and _TAG_CACHE_ROWS is not None:
            _TAG_CACHE_ERRORS = ()
            return _TAG_CACHE_ROWS, _TAG_CACHE_SEARCH, ()
        if cache_key in _TAG_PARTIAL_CACHE:
            rows, search_rows, errors = _TAG_PARTIAL_CACHE[cache_key]
            _TAG_CACHE_ERRORS = errors
            return rows, search_rows, errors

        merged = {}
        errors = []
        priority_tags = set()
        tag_priorities = {}
        load_paths = list(reversed(priority_paths)) if tag_files is not None else fallback_paths + priority_paths
        for path in load_paths:
            file_priority = priority_paths.index(path) if tag_files is not None else 0
            try:
                file_rows = _read_tag_csv(path)
            except (OSError, UnicodeError, csv.Error) as error:
                _LOG.warning("JP Assist: could not read %s: %s", os.path.basename(path), error)
                errors.append(os.path.basename(path))
                continue
            for row in file_rows:
                merged[row["tag"]] = row
                if path in priority_paths:
                    priority_tags.add(row["tag"])
                if tag_files is not None:
                    tag_priorities[row["tag"]] = file_priority

        translation_load_paths = list(reversed(translation_paths)) if translation_files is not None else translation_paths
        translations, translation_errors = _read_translation_map(translation_load_paths)
        errors.extend(translation_errors)
        for tag, text in translations.items():
            if tag in merged:
                merged[tag]["ja"] = text["ja"]
                merged[tag]["aliases"] = ",".join(value for value in (merged[tag]["aliases"], text["aliases"]) if value)

        rows = list(merged.values())
        if tag_files is not None:
            rows.sort(key=lambda row: tag_priorities[row["tag"]])
        has_priority = bool(priority_paths)
        search_rows = _SearchIndex([
            (
                row,
                _normalize(row["tag"]),
                _split_aliases(row),
                _count_value(row),
                tag_priorities[row["tag"]] if tag_files is not None else (0 if (not has_priority or row["tag"] in priority_tags) else 1),
            )
            for row in rows
        ])

        # A failed file cannot replace the healthy cache, but successful files
        # need not be reparsed for every keystroke while the broken file is unchanged.
        if errors:
            errors = tuple(sorted(set(errors)))
            _TAG_PARTIAL_CACHE[cache_key] = (rows, search_rows, errors)
            if len(_TAG_PARTIAL_CACHE) > _TAG_PARTIAL_CACHE_LIMIT:
                _TAG_PARTIAL_CACHE.pop(next(iter(_TAG_PARTIAL_CACHE)))
            _TAG_CACHE_ERRORS = errors
            return rows, search_rows, errors
        _TAG_CACHE_KEY = cache_key
        _TAG_CACHE_ROWS = rows
        _TAG_CACHE_SEARCH = search_rows
        _TAG_CACHE_ERRORS = ()
        return rows, search_rows, ()


def _read_tag_rows(source="both", tag_file="all", translation_file="all", tag_files=None, translation_files=None, _with_errors=False):
    rows, _, errors = _load_cached_tag_data(source, tag_file, translation_file, tag_files, translation_files)
    return (rows, errors) if _with_errors else rows


def _usage_key(row):
    meta = row["meta"]
    return (meta["source_file"], meta["source_type"], meta["category_scheme"], meta["insert_mode"], row["tag"])


def _parse_usage(payload):
    entries = payload.get("usage") if isinstance(payload, dict) else None
    if not isinstance(entries, list) or len(entries) > 2000:
        raise ValueError("Expected at most 2000 usage entries")
    counts = {}
    for entry in entries:
        if not isinstance(entry, list) or len(entry) != 2:
            raise ValueError("Invalid usage entry")
        key, count = entry
        if not isinstance(key, str) or len(key) > 8192 or type(count) is not int or not 1 <= count <= 2147483647:
            raise ValueError("Invalid usage count")
        parts = json.loads(key)
        if not isinstance(parts, list) or len(parts) != 5 or not all(isinstance(part, str) for part in parts) or not parts[4]:
            raise ValueError("Invalid candidate identity")
        counts[tuple(parts)] = count
    return counts


def _search_tag_rows(query, source="both", tag_file="all", translation_file="all", sort_order="match", limit=20, search_jp=True, behavior="existing", tail="", tag_files=None, translation_files=None, _with_errors=False, usage=None):
    tail = _normalize(tail)
    query = _normalize(query)
    if not query:
        return ([], ()) if _with_errors else []

    try:
        limit = max(1, min(500, int(limit)))
    except (TypeError, ValueError):
        limit = 20

    sort_order = sort_order if sort_order in {"match", "count", "az"} else "match"
    _, search_rows, errors = _load_cached_tag_data(source, tag_file, translation_file, tag_files, translation_files)

    def scored_rows(positions, ordered=False, prefix_only=False, use_usage=False):
        found = 0
        boundary = None
        for position in positions:
            row, tag, aliases, count, priority = search_rows[position]
            tag_name = search_rows.names[position]
            primary = (priority, -count) if sort_order == "count" else (priority, tag_name)
            # Finish the boundary bucket so match-score ties retain their old order.
            if boundary is not None and primary != boundary:
                break
            needle = tail if behavior == "csv" and tail and (row["meta"]["source_type"] == "natural_language" or row["meta"]["insert_mode"] == "word") else query
            if needle not in tag and (not search_jp or needle not in search_rows.alias_text[position]):
                continue
            search_aliases = aliases if search_jp else ()
            if tag == needle or needle in search_aliases:
                score = 0
            elif tag.startswith(needle) or any(alias.startswith(needle) for alias in search_aliases):
                score = 1
            elif needle in tag or any(needle in alias for alias in search_aliases):
                score = 2
            else:
                continue

            if prefix_only and score > 1:
                continue

            if sort_order == "count":
                key = (priority, -count, score, tag_name)
            elif sort_order == "az":
                key = (priority, tag_name, score, -count)
            else:
                key = (priority, score, -count, tag_name)
            if use_usage:
                # Keep CSV priority first; apply personal usage before the result cap.
                key = (priority, -usage.get(_usage_key(row), 0), *key[1:])
            found += 1
            if ordered and found == limit:
                boundary = primary
            yield key, row

    needles = {query, tail} if behavior == "csv" and tail else {query}

    def normal_matches():
        if sort_order == "match":
            prefix = heapq.nsmallest(limit, scored_rows(search_rows.candidates(needles, search_jp, prefix=True), prefix_only=True), key=lambda item: item[0])
            if len(prefix) == limit and prefix[-1][0][0] == search_rows.first_priority:
                return prefix
        # Broad queries can stop early in the stored rank order. Selective queries
        # use C substring search, then score only the matching dictionary rows.
        ordered = sort_order in {"count", "az"} and sum(search_rows.corpus.count(needle) for needle in needles) >= limit * 8
        positions = (search_rows.by_count if sort_order == "count" else search_rows.by_name) if ordered else search_rows.candidates(needles, search_jp)
        return heapq.nsmallest(limit, scored_rows(positions, ordered=ordered), key=lambda item: item[0])

    ranked = normal_matches()
    if usage:
        positions = {search_rows.positions[row["tag"]] for _, row in ranked}
        for identity in usage:
            position = search_rows.positions.get(identity[-1])
            if position is not None and _usage_key(search_rows[position][0]) == identity:
                positions.add(position)
        ranked = heapq.nsmallest(limit, scored_rows(sorted(positions), use_usage=True), key=lambda item: item[0])
    matches = [row for _, row in ranked]
    return (matches, errors) if _with_errors else matches


def _dictionary_revision(source="both", tag_file="all", translation_file="all", tag_files=None, translation_files=None):
    tag_paths = _resolve_tag_files(source, tag_file, tag_files)
    translation_paths = _resolve_translation_files(translation_file, translation_files)
    signature = (tag_files is not None, translation_files is not None, _file_signature(tag_paths), _file_signature(translation_paths))
    return hashlib.sha256(repr(signature).encode("utf-8")).hexdigest()[:20]


def _tag_response(params, usage=None):
    source = params.get("source", "both")
    tag_file = params.get("tag_file", "all")
    translation_file = params.get("translation_file", "all")
    tag_files = _requested_files(params, "tag_files")
    translation_files = _requested_files(params, "translation_files")
    query = params.get("q", "")
    revision = _dictionary_revision(source, tag_file, translation_file, tag_files, translation_files)
    if query:
        tags, errors = _search_tag_rows(
            query, source, tag_file, translation_file,
            params.get("sort", "match"), params.get("limit", "20"),
            params.get("search_jp", "1") != "0",
            params.get("behavior", "existing"), params.get("tail", ""),
            tag_files, translation_files, _with_errors=True, usage=usage,
        )
    else:
        tags, errors = _read_tag_rows(source, tag_file, translation_file, tag_files, translation_files, _with_errors=True)
    if revision != _dictionary_revision(source, tag_file, translation_file, tag_files, translation_files):
        return {"tags": [], "retry": True, "revision": revision}
    return {"tags": tags, "revision": revision, "errors": list(errors)}


@server.PromptServer.instance.routes.get("/danbooru-tag-jp-assist/tags")
async def get_danbooru_tag_jp_assist_tags(request):
    return web.json_response(await asyncio.to_thread(_tag_response, dict(request.query)))


@server.PromptServer.instance.routes.get("/jp-tag-autocomplete-test/tags")
async def get_legacy_jp_tag_autocomplete_tags(request):
    return await get_danbooru_tag_jp_assist_tags(request)


@server.PromptServer.instance.routes.post("/danbooru-tag-jp-assist/tags")
async def search_with_usage(request):
    try:
        usage = _parse_usage(await request.json())
    except (ValueError, TypeError, RecursionError):
        return web.json_response({"error": "Invalid usage history"}, status=400)
    return web.json_response(await asyncio.to_thread(_tag_response, dict(request.query), usage))


@server.PromptServer.instance.routes.get("/danbooru-tag-jp-assist/revision")
async def get_dictionary_revision(request):
    return web.json_response({"revision": _dictionary_revision(
        request.query.get("source", "both"), request.query.get("tag_file", "all"),
        request.query.get("translation_file", "all"),
        _requested_files(request.query, "tag_files"), _requested_files(request.query, "translation_files"),
    ), "ordered_selection": True, "usage_ranking": True})


@server.PromptServer.instance.routes.post("/danbooru-tag-jp-assist/reload")
async def reload_dictionaries(request):
    await asyncio.to_thread(_clear_tag_cache)
    return web.json_response({"reloaded": True})


@server.PromptServer.instance.routes.get("/danbooru-tag-jp-assist/files")
async def get_danbooru_tag_jp_assist_files(request):
    return web.json_response({
        "tag_files": _csv_file_names(TAG_FILES_DIR) + ["All"],
        "translation_files": _csv_file_names(TRANSLATION_FILES_DIR) + ["All"],
        "ordered_selection": True,
        "usage_ranking": True,
    })


@server.PromptServer.instance.routes.get("/jp-tag-autocomplete-test/files")
async def get_legacy_jp_tag_autocomplete_files(request):
    return await get_danbooru_tag_jp_assist_files(request)


@server.PromptServer.instance.routes.post("/danbooru-tag-jp-assist/hf-update")
async def update_danbooru_tag_jp_assist_hf_file(request):
    # Old browser clients may still call this endpoint with AutoUpdateHf saved.
    # Keep it inert: no network request, file creation, or settings migration.
    return web.json_response({"updated": False, "disabled": True,
                              "reason": "Local CSV dictionaries only; remote downloads are disabled."})


@server.PromptServer.instance.routes.post("/jp-tag-autocomplete-test/hf-update")
async def update_legacy_jp_tag_autocomplete_hf_file(request):
    return await update_danbooru_tag_jp_assist_hf_file(request)


NODE_CLASS_MAPPINGS = {
    "DanbooruTagJPAssist": DanbooruTagJPAssist,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DanbooruTagJPAssist": "Danbooru Tag JP Assist",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
