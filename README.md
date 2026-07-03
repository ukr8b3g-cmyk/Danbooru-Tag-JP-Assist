# Danbooru Tag JP Assist

Danbooru Tag JP Assist adds Danbooru-style tag suggestions to ComfyUI multiline text areas.

It is intended for users who want English Danbooru tags with optional Japanese alias search/display. The main tag CSV and Japanese translation/alias CSV are stored separately, so users can replace or add their own files without editing the node code.

## Installation

Stop ComfyUI, then install into `custom_nodes`:

```powershell
cd D:\Codex\ComfyUI\custom_nodes
git clone https://github.com/ukr8b3g-cmyk/Danbooru-Tag-JP-Assist.git Danbooru-Tag-JP-Assist
```

If the folder already exists:

```powershell
cd D:\Codex\ComfyUI\custom_nodes\Danbooru-Tag-JP-Assist
git pull
```

Restart ComfyUI and hard refresh the browser with `Ctrl + F5`.

## What It Does

- Shows tag suggestions while typing in multiline text boxes.
- Inserts English tags into the prompt.
- Can display Japanese aliases next to suggestions.
- Can insert spaces instead of underscores for Krea-style natural prompts.
- Supports sorting by match, popularity count, or tag name.
- Supports local tag files, Hugging Face tag files, or both.
- Can check the Hugging Face source at startup and download/update the local `danbooru_tags.csv` when the remote file changes.

If Hugging Face is offline or the source file disappears, the node keeps using the local saved CSV.

## Tag Files

Use two separate folders:

- `tag_files/`: English tag files. Put Danbooru-style tag CSV files here.
- `translation_files/`: Japanese translation or alias files. Put Japanese search/display CSV files here.

Built-in source files:

- `tag_files/danbooru_tags.csv`: downloaded from Hugging Face at runtime. It is not bundled in Git.
- `translation_files/ja_alias_sample.csv`: small Japanese alias sample.

Tag file format:

```csv
tag,category,count
1girl,0,4974288
long_hair,0,3608339
```

- `tag`: English tag inserted into the prompt.
- `category`: Danbooru-style category number. It is kept for compatibility.
- `count`: Sort/count value. Used by Popularity sort.

Translation file format:

```csv
tag,ja,aliases
1girl,"少女,女の子,おんなのこ","少女,女の子,若い女性,girl"
long_hair,"長髪,ロングヘア","長髪,ロングヘア,髪が長い"
```

- `tag`: English tag matched to the tag file.
- `ja`: Japanese label text.
- `aliases`: Japanese translations and extra search words. Separate multiple aliases with commas.

Settings can select `Hugging Face`, `Own tag file`, or `HF local + own file`. In the combined mode, local tag files override the same HF tag.

Settings can also select a specific CSV:

- `Tag file`: one file in `tag_files/` or `All`. The default is `danbooru_tags.csv`.
- `Translation file`: `All` or one file in `translation_files/`.
- `Auto update HF file`: checks the Hugging Face source and replaces `danbooru_tags.csv` only when the remote file changed.

After adding or deleting CSV files, restart ComfyUI if the Settings list does not update.

Old CSV files placed directly in this folder are still read as local files for compatibility.

## Notes

- The GitHub repository does not include `danbooru_tags.csv`; it is downloaded from Hugging Face.
- The downloaded `danbooru_tags.csv` is kept with the original filename and original content.
- User tag files should be placed under `tags/tag_files/`.
- Japanese translation or alias files should be placed under `tags/translation_files/`.
- Large `All` combinations may be slower than choosing a single CSV.
- If no tag file is available, no suggestion popup is shown.
