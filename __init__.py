import asyncio
import csv
import heapq
import hashlib
import logging
import json
import os
import threading
import urllib.request

import server
from aiohttp import web


WEB_DIRECTORY = "./web"
DATA_DIR = os.path.join(os.path.dirname(__file__), "tags")
TAG_FILES_DIR = os.path.join(DATA_DIR, "tag_files")
TRANSLATION_FILES_DIR = os.path.join(DATA_DIR, "translation_files")
HF_TAG_FILE = "danbooru_tags.csv"
LEGACY_HF_TAG_FILE = "hf_danbooru_tags.csv"
HF_TAG_URL = "https://huggingface.co/datasets/SpadeA/danbooru-tag-csv/resolve/main/danbooru_tags.csv?download=true"
HF_META_FILE = os.path.join(TAG_FILES_DIR, ".danbooru_tags_meta.json")
HF_MAX_BYTES = 128 * 1024 * 1024
HF_DOWNLOAD_CHUNK = 1024 * 1024

_TAG_CACHE_LOCK = threading.Lock()
_TAG_CACHE_KEY = None
_TAG_CACHE_ROWS = None
_TAG_CACHE_SEARCH = None
_TAG_CACHE_ERRORS = ()
_LOG = logging.getLogger(__name__)


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
    if folder == TAG_FILES_DIR and HF_TAG_FILE not in names:
        names.insert(0, HF_TAG_FILE)
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
            return _TAG_CACHE_ROWS, _TAG_CACHE_SEARCH

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
        search_rows = [
            (
                row,
                _normalize(row["tag"]),
                _split_aliases(row),
                _count_value(row),
                tag_priorities[row["tag"]] if tag_files is not None else (0 if (not has_priority or row["tag"] in priority_tags) else 1),
            )
            for row in rows
        ]

        # Failed files are retried, and a partial build never replaces a good cache.
        if errors:
            _TAG_CACHE_ERRORS = tuple(sorted(set(errors)))
            return rows, search_rows
        _TAG_CACHE_KEY = cache_key
        _TAG_CACHE_ROWS = rows
        _TAG_CACHE_SEARCH = search_rows
        _TAG_CACHE_ERRORS = ()
        return rows, search_rows


def _read_tag_rows(source="both", tag_file="all", translation_file="all", tag_files=None, translation_files=None):
    rows, _ = _load_cached_tag_data(source, tag_file, translation_file, tag_files, translation_files)
    return rows


def _search_tag_rows(query, source="both", tag_file="all", translation_file="all", sort_order="match", limit=20, search_jp=True, behavior="existing", tail="", tag_files=None, translation_files=None):
    tail = _normalize(tail)
    query = _normalize(query)
    if not query:
        return []

    try:
        limit = max(1, min(500, int(limit)))
    except (TypeError, ValueError):
        limit = 20

    sort_order = sort_order if sort_order in {"match", "count", "az"} else "match"
    _, search_rows = _load_cached_tag_data(source, tag_file, translation_file, tag_files, translation_files)

    def scored_rows():
        for row, tag, aliases, count, priority in search_rows:
            needle = tail if behavior == "csv" and tail and (row["meta"]["source_type"] == "natural_language" or row["meta"]["insert_mode"] == "word") else query
            search_aliases = aliases if search_jp else ()
            if tag == needle or needle in search_aliases:
                score = 0
            elif tag.startswith(needle) or any(alias.startswith(needle) for alias in search_aliases):
                score = 1
            elif needle in tag or any(needle in alias for alias in search_aliases):
                score = 2
            else:
                continue

            tag_name = str(row["tag"]).casefold()
            if sort_order == "count":
                key = (priority, -count, score, tag_name)
            elif sort_order == "az":
                key = (priority, tag_name, score, -count)
            else:
                key = (priority, score, -count, tag_name)
            yield key, row

    return [row for _, row in heapq.nsmallest(limit, scored_rows(), key=lambda item: item[0])]


def _load_hf_meta():
    try:
        with open(HF_META_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_hf_meta(meta):
    os.makedirs(TAG_FILES_DIR, exist_ok=True)
    with open(HF_META_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


def _hf_remote_meta():
    request = urllib.request.Request(HF_TAG_URL, method="HEAD")
    with urllib.request.urlopen(request, timeout=20) as response:
        content_length = response.headers.get("Content-Length", "")
        if content_length:
            try:
                if int(content_length) > HF_MAX_BYTES:
                    raise ValueError("Remote Danbooru CSV exceeds the 128 MiB safety limit.")
            except ValueError:
                if content_length.isdigit():
                    raise
        return {
            "etag": response.headers.get("ETag", ""),
            "last_modified": response.headers.get("Last-Modified", ""),
            "content_length": content_length,
            "url": HF_TAG_URL,
        }


def _validate_downloaded_tag_file(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fields = set(reader.fieldnames or [])
        if not ({"tag", "english"} & fields):
            raise ValueError("Downloaded CSV does not contain a tag or english column.")


def _download_hf_tag_file(remote_meta):
    os.makedirs(TAG_FILES_DIR, exist_ok=True)
    path = os.path.join(TAG_FILES_DIR, HF_TAG_FILE)
    tmp_path = path + ".tmp"
    total = 0

    try:
        with urllib.request.urlopen(HF_TAG_URL, timeout=60) as response:
            with open(tmp_path, "wb") as f:
                while True:
                    chunk = response.read(HF_DOWNLOAD_CHUNK)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > HF_MAX_BYTES:
                        raise ValueError("Downloaded Danbooru CSV exceeds the 128 MiB safety limit.")
                    f.write(chunk)

        _validate_downloaded_tag_file(tmp_path)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise

    remote_meta["local_size"] = str(os.path.getsize(path))
    _save_hf_meta(remote_meta)
    _clear_tag_cache()
    return remote_meta


def _update_hf_tag_file():
    path = os.path.join(TAG_FILES_DIR, HF_TAG_FILE)
    try:
        remote_meta = _hf_remote_meta()
    except Exception as e:
        return {
            "updated": False,
            "file": HF_TAG_FILE,
            "error": str(e),
            "using_existing": os.path.isfile(path),
        }

    local_meta = _load_hf_meta()
    needs_update = not os.path.isfile(path)
    for key in ("etag", "last_modified", "content_length"):
        if remote_meta.get(key) and remote_meta.get(key) != local_meta.get(key):
            needs_update = True
            break

    if needs_update:
        meta = _download_hf_tag_file(remote_meta)
        return {"updated": True, "file": HF_TAG_FILE, "meta": meta}
    return {"updated": False, "file": HF_TAG_FILE, "meta": local_meta}


def _dictionary_revision(source="both", tag_file="all", translation_file="all", tag_files=None, translation_files=None):
    tag_paths = _resolve_tag_files(source, tag_file, tag_files)
    translation_paths = _resolve_translation_files(translation_file, translation_files)
    signature = (tag_files is not None, translation_files is not None, _file_signature(tag_paths), _file_signature(translation_paths))
    return hashlib.sha256(repr(signature).encode("utf-8")).hexdigest()[:20]


def _tag_response(params):
    source = params.get("source", "both")
    tag_file = params.get("tag_file", "all")
    translation_file = params.get("translation_file", "all")
    tag_files = _requested_files(params, "tag_files")
    translation_files = _requested_files(params, "translation_files")
    query = params.get("q", "")
    revision = _dictionary_revision(source, tag_file, translation_file, tag_files, translation_files)
    if query:
        tags = _search_tag_rows(
            query, source, tag_file, translation_file,
            params.get("sort", "match"), params.get("limit", "20"),
            params.get("search_jp", "1") != "0",
            params.get("behavior", "existing"), params.get("tail", ""),
            tag_files, translation_files,
        )
    else:
        tags = _read_tag_rows(source, tag_file, translation_file, tag_files, translation_files)
    if revision != _dictionary_revision(source, tag_file, translation_file, tag_files, translation_files):
        return {"tags": [], "retry": True, "revision": revision}
    return {"tags": tags, "revision": revision, "errors": list(_TAG_CACHE_ERRORS)}


@server.PromptServer.instance.routes.get("/danbooru-tag-jp-assist/tags")
async def get_danbooru_tag_jp_assist_tags(request):
    return web.json_response(await asyncio.to_thread(_tag_response, dict(request.query)))


@server.PromptServer.instance.routes.get("/jp-tag-autocomplete-test/tags")
async def get_legacy_jp_tag_autocomplete_tags(request):
    return await get_danbooru_tag_jp_assist_tags(request)


@server.PromptServer.instance.routes.get("/danbooru-tag-jp-assist/revision")
async def get_dictionary_revision(request):
    return web.json_response({"revision": _dictionary_revision(
        request.query.get("source", "both"), request.query.get("tag_file", "all"),
        request.query.get("translation_file", "all"),
        _requested_files(request.query, "tag_files"), _requested_files(request.query, "translation_files"),
    ), "ordered_selection": True})


@server.PromptServer.instance.routes.post("/danbooru-tag-jp-assist/reload")
async def reload_dictionaries(request):
    _clear_tag_cache()
    return web.json_response({"reloaded": True})


@server.PromptServer.instance.routes.get("/danbooru-tag-jp-assist/files")
async def get_danbooru_tag_jp_assist_files(request):
    return web.json_response({
        "tag_files": _csv_file_names(TAG_FILES_DIR) + ["All"],
        "translation_files": _csv_file_names(TRANSLATION_FILES_DIR) + ["All"],
        "ordered_selection": True,
    })


@server.PromptServer.instance.routes.get("/jp-tag-autocomplete-test/files")
async def get_legacy_jp_tag_autocomplete_files(request):
    return await get_danbooru_tag_jp_assist_files(request)


@server.PromptServer.instance.routes.post("/danbooru-tag-jp-assist/hf-update")
async def update_danbooru_tag_jp_assist_hf_file(request):
    try:
        result = await asyncio.to_thread(_update_hf_tag_file)
        return web.json_response(result)
    except Exception as e:
        return web.json_response({"updated": False, "error": str(e)}, status=500)


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
