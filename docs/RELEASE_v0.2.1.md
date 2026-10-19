# Danbooru Tag JP Assist v0.2.1 — Stability and performance

Maintenance release for the CSV-aware autocomplete and independently ordered tag/translation dictionaries introduced in v0.2.0.

## Fixes

- **Safe Hugging Face dictionary updates:** serialize overlapping update requests, use a unique temporary file per download and metadata write, and avoid mixing CSV contents with a different update's ETag.
- **Validate the full downloaded CSV:** reject malformed CSV bodies before replacing an existing working dictionary; preserve the old file and its metadata on failure.
- **Avoid repeated parsing of broken dictionaries:** cache partial search results for unchanged source signatures while keeping the last healthy cache intact; retry after a file changes or dictionaries are explicitly reloaded.
- **Isolate errors by dictionary selection:** switching source sets no longer inherits another selection's failure list.
- **Keep ComfyUI responsive:** acquire the dictionary reload lock in a worker thread, not on the asynchronous event loop.
- **Reduce frontend overhead:** changes to candidate color or visibility do not refetch tags; delayed DOM widget scans are coalesced into a single animation frame.
- **Harden malformed metadata handling:** a non-object cached HF metadata document is ignored safely.

## Compatibility

The `DanbooruTagJPAssist` node ID, public API, existing completion behavior, CSV precedence, selected-CSV ordering, and bundled dictionaries remain unchanged. No additional Python runtime dependencies or model downloads are introduced.

## Verification

The release source must pass the existing GitHub Actions product and Registry configuration checks before its immutable v0.2.1 tag is created. Regression coverage includes 30 Python tests and 33 JavaScript tests. The original v0.2.0 release remains unchanged.

Update your custom node through ComfyUI Manager or `git pull --ff-only`, restart ComfyUI, and use Ctrl+F5 in the browser if old frontend code remains cached.

Source: https://github.com/ukr8b3g-cmyk/Danbooru-Tag-JP-Assist
Merged maintenance changes: https://github.com/ukr8b3g-cmyk/Danbooru-Tag-JP-Assist/pull/3
