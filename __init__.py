import asyncio
import csv
import heapq
import json
import os
import threading
import urllib.request

import server
from aiohttp import web


__version__ = "1.0.1"

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
MAX_SEARCH_RESULTS = 50

_TAG_CACHE_LOCK = threading.Lock()
_TAG_CACHE_KEY = None
_TAG_CACHE_ROWS = None
_TAG_CACHE_SEARCH = None
_TAG_CACHE_PREFIX = None


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


def _legacy_csv_files():
    if not os.path.isdir(DATA_DIR):
        return []
    return [
        os.path.join(DATA_DIR, name)
        for name in sorted(os.listdir(DATA_DIR))
        if name.lower().endswith(".csv") and name not in {HF_TAG_FILE, LEGACY_HF_TAG_FILE}
    ]


def _resolve_tag_files(source="both", tag_file="all"):
    source = source if source in {"hf", "own", "both"} else "both"
    hf_path = os.path.join(TAG_FILES_DIR, HF_TAG_FILE)
    if not os.path.isfile(hf_path):
        hf_path = os.path.join(DATA_DIR, HF_TAG_FILE)

    hf_files = [hf_path] if os.path.isfile(hf_path) else []
    selected_tag = _safe_csv_name(tag_file)
    if selected_tag:
        selected_path = os.path.join(TAG_FILES_DIR, selected_tag)
        return [selected_path] if os.path.isfile(selected_path) else []

    own_candidates = _selected_files(TAG_FILES_DIR, "all")
    own_files = [
        path for path in own_candidates
        if os.path.basename(path) != HF_TAG_FILE
    ]
    own_files += _legacy_csv_files()

    if source == "hf":
        return hf_files
    if source == "own":
        return own_files
    return own_files + hf_files


def _resolve_translation_files(selected="all"):
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


def _read_tag_csv(path):
    rows = []
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            tag = (row.get("tag") or row.get("english") or "").strip()
            count = (row.get("count") or "").strip()
            if tag:
                rows.append({
                    "tag": tag,
                    "ja": "",
                    "aliases": "",
                    "count": count,
                })
    return rows


def _read_translation_map(paths):
    translations = {}
    for path in paths:
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                tag = (row.get("tag") or row.get("english") or "").strip()
                ja = (row.get("ja") or row.get("jp") or row.get("japanese") or row.get("alias") or "").strip()
                aliases = (row.get("aliases") or row.get("alias") or "").strip()
                if tag and (ja or aliases):
                    translations[tag] = {"ja": ja, "aliases": aliases}
    return translations


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
    except (TypeError, ValueError):
        try:
            return int(float(row.get("count") or 0))
        except (TypeError, ValueError):
            return 0


def _build_prefix_index(search_rows):
    prefix_index = {}
    for row_index, (_, tag, aliases, _) in enumerate(search_rows):
        keys = set()
        for term in (tag, *aliases):
            if not term:
                continue
            keys.add(term[:1])
            if len(term) > 1:
                keys.add(term[:2])
        for key in keys:
            prefix_index.setdefault(key, []).append(row_index)
    return prefix_index


def _clear_tag_cache():
    global _TAG_CACHE_KEY, _TAG_CACHE_ROWS, _TAG_CACHE_SEARCH, _TAG_CACHE_PREFIX
    with _TAG_CACHE_LOCK:
        _TAG_CACHE_KEY = None
        _TAG_CACHE_ROWS = None
        _TAG_CACHE_SEARCH = None
        _TAG_CACHE_PREFIX = None


def _load_cached_tag_data(source="both", tag_file="all", translation_file="all"):
    global _TAG_CACHE_KEY, _TAG_CACHE_ROWS, _TAG_CACHE_SEARCH, _TAG_CACHE_PREFIX

    source = source if source in {"hf", "own", "both"} else "both"
    tag_paths = _resolve_tag_files(source, tag_file)
    translation_paths = _resolve_translation_files(translation_file)
    cache_key = (
        source,
        _safe_csv_name(tag_file) or "all",
        _safe_csv_name(translation_file) or "all",
        _file_signature(tag_paths),
        _file_signature(translation_paths),
    )

    with _TAG_CACHE_LOCK:
        if cache_key == _TAG_CACHE_KEY and _TAG_CACHE_ROWS is not None:
            return _TAG_CACHE_ROWS, _TAG_CACHE_SEARCH, _TAG_CACHE_PREFIX

        merged = {}
        for path in tag_paths:
            for row in _read_tag_csv(path):
                merged[row["tag"]] = row

        translations = _read_translation_map(translation_paths)
        for tag, text in translations.items():
            if tag in merged:
                merged[tag]["ja"] = text["ja"]
                merged[tag]["aliases"] = text["aliases"]

        rows = list(merged.values())
        search_rows = [
            (row, _normalize(row["tag"]), _split_aliases(row), _count_value(row))
            for row in rows
        ]
        prefix_index = _build_prefix_index(search_rows)

        _TAG_CACHE_KEY = cache_key
        _TAG_CACHE_ROWS = rows
        _TAG_CACHE_SEARCH = search_rows
        _TAG_CACHE_PREFIX = prefix_index
        return rows, search_rows, prefix_index


def _read_tag_rows(source="both", tag_file="all", translation_file="all"):
    rows, _, _ = _load_cached_tag_data(source, tag_file, translation_file)
    return rows


def _score_search_row(search_row, query, sort_order):
    row, tag, aliases, count = search_row
    if tag == query or query in aliases:
        score = 0
    elif tag.startswith(query) or any(alias.startswith(query) for alias in aliases):
        score = 1
    elif query in tag or any(query in alias for alias in aliases):
        score = 2
    else:
        return None

    tag_name = str(row["tag"]).casefold()
    if sort_order == "count":
        key = (-count, score, tag_name)
    elif sort_order == "az":
        key = (tag_name, score, -count)
    else:
        key = (score, -count, tag_name)
    return key, row, score


def _search_tag_rows(query, source="both", tag_file="all", translation_file="all", sort_order="match", limit=20):
    query = _normalize(query)
    if not query:
        return []

    try:
        limit = max(1, min(MAX_SEARCH_RESULTS, int(limit)))
    except (TypeError, ValueError):
        limit = 20

    sort_order = sort_order if sort_order in {"match", "count", "az"} else "match"
    _, search_rows, prefix_index = _load_cached_tag_data(source, tag_file, translation_file)

    if sort_order == "match":
        prefix_key = query[:2] if len(query) > 1 else query
        prefix_scored = []
        for row_index in prefix_index.get(prefix_key, ()):
            scored = _score_search_row(search_rows[row_index], query, sort_order)
            if scored is not None and scored[2] <= 1:
                prefix_scored.append((scored[0], scored[1]))
        if len(prefix_scored) >= limit:
            return [
                row
                for _, row in heapq.nsmallest(
                    limit,
                    prefix_scored,
                    key=lambda item: item[0],
                )
            ]

    def scored_rows():
        for search_row in search_rows:
            scored = _score_search_row(search_row, query, sort_order)
            if scored is not None:
                yield scored[0], scored[1]

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


@server.PromptServer.instance.routes.get("/danbooru-tag-jp-assist/tags")
async def get_danbooru_tag_jp_assist_tags(request):
    source = request.query.get("source", "both")
    tag_file = request.query.get("tag_file", "all")
    translation_file = request.query.get("translation_file", "all")
    query = request.query.get("q", "")

    if query:
        sort_order = request.query.get("sort", "match")
        limit = request.query.get("limit", "20")
        tags = await asyncio.to_thread(
            _search_tag_rows,
            query,
            source,
            tag_file,
            translation_file,
            sort_order,
            limit,
        )
    else:
        # Keep the no-query response for compatibility with older frontends.
        tags = await asyncio.to_thread(_read_tag_rows, source, tag_file, translation_file)

    return web.json_response({"tags": tags})


@server.PromptServer.instance.routes.get("/jp-tag-autocomplete-test/tags")
async def get_legacy_jp_tag_autocomplete_tags(request):
    return await get_danbooru_tag_jp_assist_tags(request)


@server.PromptServer.instance.routes.get("/danbooru-tag-jp-assist/files")
async def get_danbooru_tag_jp_assist_files(request):
    return web.json_response({
        "tag_files": _csv_file_names(TAG_FILES_DIR) + ["All"],
        "translation_files": _csv_file_names(TRANSLATION_FILES_DIR) + ["All"],
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

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY", "__version__"]
