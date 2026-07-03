import csv
import json
import os
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


def _read_translation_map(selected="all"):
    translations = {}
    paths = _selected_files(TRANSLATION_FILES_DIR, selected)
    if not _safe_csv_name(selected):
        paths += _legacy_csv_files()
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


def _read_tag_rows(source="both", tag_file="all", translation_file="all"):
    source = source if source in {"hf", "own", "both"} else "both"
    hf_path = os.path.join(TAG_FILES_DIR, HF_TAG_FILE)
    if not os.path.isfile(hf_path):
        hf_path = os.path.join(DATA_DIR, HF_TAG_FILE)

    hf_files = [hf_path] if os.path.isfile(hf_path) else []
    selected_tag = _safe_csv_name(tag_file)
    own_candidates = _selected_files(TAG_FILES_DIR, selected_tag or "all")
    own_files = [
        path for path in own_candidates
        if os.path.basename(path) != HF_TAG_FILE
    ]
    if not selected_tag:
        own_files += _legacy_csv_files()

    if source == "hf":
        files = hf_files
    elif source == "own":
        files = own_files
    else:
        files = hf_files + own_files

    merged = {}
    for path in files:
        for row in _read_tag_csv(path):
            merged[row["tag"]] = row

    translations = _read_translation_map(translation_file)
    for tag, text in translations.items():
        if tag in merged:
            merged[tag]["ja"] = text["ja"]
            merged[tag]["aliases"] = text["aliases"]

    return list(merged.values())


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
        return {
            "etag": response.headers.get("ETag", ""),
            "last_modified": response.headers.get("Last-Modified", ""),
            "content_length": response.headers.get("Content-Length", ""),
            "url": HF_TAG_URL,
        }


def _download_hf_tag_file(remote_meta):
    os.makedirs(TAG_FILES_DIR, exist_ok=True)
    path = os.path.join(TAG_FILES_DIR, HF_TAG_FILE)
    tmp_path = path + ".tmp"
    with urllib.request.urlopen(HF_TAG_URL, timeout=60) as response:
        with open(tmp_path, "wb") as f:
            f.write(response.read())
    os.replace(tmp_path, path)
    remote_meta["local_size"] = str(os.path.getsize(path))
    _save_hf_meta(remote_meta)
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
    return web.json_response({"tags": _read_tag_rows(source, tag_file, translation_file)})


@server.PromptServer.instance.routes.get("/danbooru-tag-jp-assist/files")
async def get_danbooru_tag_jp_assist_files(request):
    return web.json_response({
        "tag_files": _csv_file_names(TAG_FILES_DIR) + ["All"],
        "translation_files": _csv_file_names(TRANSLATION_FILES_DIR) + ["All"],
    })


@server.PromptServer.instance.routes.post("/danbooru-tag-jp-assist/hf-update")
async def update_danbooru_tag_jp_assist_hf_file(request):
    try:
        return web.json_response(_update_hf_tag_file())
    except Exception as e:
        return web.json_response({"updated": False, "error": str(e)}, status=500)


NODE_CLASS_MAPPINGS = {
    "DanbooruTagJPAssist": DanbooruTagJPAssist,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DanbooruTagJPAssist": "Danbooru Tag JP Assist",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
