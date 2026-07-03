# Danbooru Tag JP Assist

Danbooru Tag JP Assist は、ComfyUI の複数行テキスト入力欄でタグ候補を表示する補完ノードです。

日本語で検索しながら、英語タグや英語の自然言語ワードをプロンプトへ入力できます。

[English README](#english-readme)

## インストール

ComfyUI を停止してから、`custom_nodes` に clone します。

```powershell
cd D:\Codex\ComfyUI\custom_nodes
git clone https://github.com/ukr8b3g-cmyk/Danbooru-Tag-JP-Assist.git Danbooru-Tag-JP-Assist
```

すでにフォルダーがある場合は更新します。

```powershell
cd D:\Codex\ComfyUI\custom_nodes\Danbooru-Tag-JP-Assist
git pull
```

その後、ComfyUI を再起動し、古いUIが残る場合はブラウザを `Ctrl + F5` でハード更新してください。

## できること

- 複数行テキスト欄でタグ候補を表示します。
- 日本語の別名や翻訳から英語タグを検索できます。
- 英語タグをプロンプトへ挿入します。
- `_` を空白に置き換えて、Krea系の自然言語プロンプト風に入力できます。
- カンマを自動で追加できます。
- 一致順、優先度/count順、A-Z順で並び替えできます。
- Danbooruタグ、自然言語辞書、自分のCSVを併用できます。
- Hugging Face の Danbooru CSV を起動時に確認し、更新があればローカルの `danbooru_tags.csv` を更新できます。

Hugging Face がオフライン、または元ファイルが消えている場合は、既存のローカルCSVをそのまま使います。

## 基本的な使い方

1. ComfyUI の Settings を開きます。
2. `Danbooru Tag JP Assist` を有効にします。
3. まずは `Tag file: All`、`Translation file: All` のまま使います。
4. 複数行プロンプト欄に英語または日本語を入力します。
5. 候補をキーボードまたはマウスで選択します。

初期設定では以下の動作になります。

- `Tag file: All` は同梱の自然言語辞書と、ローカルにある Danbooru CSV を読みます。
- `Translation file: All` は同梱の翻訳CSVを両方読みます。
- `Tag source: Both` はローカルファイルと Hugging Face 由来の Danbooru CSV を併用します。
- 同じタグが複数ファイルにある場合は、Danbooru CSV 側を優先します。
- `natural_language_tags.csv` は軽量な英語辞書・プロンプト語彙です。Danbooruタグの代替ではありません。
- `merged_translations_dedup.csv` は Danbooru タグ用の日本語別名です。
- `natural_language_ja.csv` は自然言語辞書用の日本語別名です。

## ファイル構成

タグファイルと翻訳ファイルは別フォルダーに置きます。

- `tags/tag_files/`: 英語タグ・英語辞書CSVを置くフォルダー
- `tags/translation_files/`: 日本語翻訳・別名CSVを置くフォルダー

同梱ファイル:

- `tags/tag_files/natural_language_tags.csv`: 軽量な英語辞書・プロンプト語彙
- `tags/translation_files/natural_language_ja.csv`: 自然言語辞書の一部に対応した日本語別名
- `tags/translation_files/merged_translations_dedup.csv`: Danbooruタグ用の日本語別名

同梱しないファイル:

- `tags/tag_files/danbooru_tags.csv`: Hugging Face から実行時に取得します。Gitには含めません。

## CSV形式

タグファイル:

```csv
tag,category,count
1girl,0,4974288
long_hair,0,3608339
```

- `tag`: プロンプトへ挿入される英語タグ
- `category`: Danbooru互換のカテゴリ番号
- `count`: 優先度や人気順ソートに使う数値

翻訳ファイル:

```csv
tag,ja,aliases
1girl,"少女,女の子,おんなのこ","少女,女の子,若い女性,girl"
long_hair,"長髪,ロングヘア","長髪,ロングヘア,髪が長い"
```

- `tag`: 対応する英語タグ
- `ja`: 日本語表示用テキスト
- `aliases`: 検索用の日本語別名。複数ある場合はカンマ区切り

## 主な設定

- `Tag file`: `tags/tag_files/` 内の1ファイル、または `All`。初期値は `All` です。
- `Translation file`: `tags/translation_files/` 内の1ファイル、または `All`。
- `Update Danbooru CSV from Hugging Face`: Hugging Face 側を確認し、変更があれば `danbooru_tags.csv` を更新します。
- `List every match`: 候補を多めに表示します。
- `Suggestion count`: `List every match` がOFFの時の表示数です。
- `Sort mode`: `Match first`、`Priority / count`、`Tag A-Z`。
- `Popup color`: 候補ポップアップの色です。
- `Use spaces for underscores`: `long_hair` を `long hair` として挿入します。
- `Append comma`: 候補挿入後にカンマを追加します。

CSVを追加・削除したあと、Settings のリストが更新されない場合は ComfyUI を再起動してください。

## 注意

- GitHubリポジトリには `danbooru_tags.csv` を含めません。
- ダウンロード済みの `danbooru_tags.csv` は、元のファイル名と内容を維持します。
- 自分のタグファイルは `tags/tag_files/` に置いてください。
- 自分の翻訳・別名ファイルは `tags/translation_files/` に置いてください。
- `All` で大きなCSVを複数読むと、単一CSVより重くなる場合があります。
- タグファイルがない場合、候補ポップアップは表示されません。

---

## English README

Danbooru Tag JP Assist adds tag suggestions to ComfyUI multiline text areas.

It is intended for users who want to search English Danbooru tags and English prompt vocabulary with optional Japanese aliases.

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

- Shows suggestions while typing in multiline text boxes.
- Inserts English tags into the prompt.
- Can display Japanese aliases next to suggestions.
- Can insert spaces instead of underscores for Krea-style natural prompts.
- Supports sorting by match, priority/count, or tag name.
- Supports local tag files, Hugging Face tag files, or both.
- Can check the Hugging Face source at startup and download/update the local `danbooru_tags.csv` when the remote file changes.

If Hugging Face is offline or the source file disappears, the node keeps using the local saved CSV.

## Basic Use

1. Open ComfyUI Settings.
2. Enable `Danbooru Tag JP Assist`.
3. Use the default `Tag file: All` and `Translation file: All` first.
4. Type English or Japanese text in a multiline prompt box.
5. Select a suggestion with the keyboard or mouse.

Default behavior:

- `Tag file: All` loads the bundled natural language dictionary and the local Danbooru CSV if available.
- `Translation file: All` loads both bundled translation files.
- `Tag source: Both` uses local files and the Hugging Face Danbooru CSV together.
- If the same tag exists in multiple files, the Danbooru CSV wins.
- `natural_language_tags.csv` is a lightweight English dictionary and prompt vocabulary, not a Danbooru tag replacement.
- `merged_translations_dedup.csv` is for Danbooru tag Japanese aliases.
- `natural_language_ja.csv` is only for the natural language dictionary.

## Tag Files

Use two separate folders:

- `tags/tag_files/`: English tag files.
- `tags/translation_files/`: Japanese translation or alias files.

Bundled files:

- `tags/tag_files/natural_language_tags.csv`: lightweight English dictionary and prompt vocabulary.
- `tags/translation_files/natural_language_ja.csv`: Japanese aliases for part of the natural language dictionary.
- `tags/translation_files/merged_translations_dedup.csv`: Japanese aliases for Danbooru tags.

Not bundled:

- `tags/tag_files/danbooru_tags.csv`: downloaded from Hugging Face at runtime.

## CSV Format

Tag file:

```csv
tag,category,count
1girl,0,4974288
long_hair,0,3608339
```

Translation file:

```csv
tag,ja,aliases
1girl,"少女,女の子,おんなのこ","少女,女の子,若い女性,girl"
long_hair,"長髪,ロングヘア","長髪,ロングヘア,髪が長い"
```

## Settings

- `Tag file`: one file in `tags/tag_files/` or `All`. The default is `All`.
- `Translation file`: one file in `tags/translation_files/` or `All`.
- `Update Danbooru CSV from Hugging Face`: checks and updates `danbooru_tags.csv`.
- `List every match`: shows a larger result list.
- `Suggestion count`: limits displayed suggestions when `List every match` is off.
- `Sort mode`: `Match first`, `Priority / count`, or `Tag A-Z`.
- `Popup color`: changes the suggestion popup color.
- `Use spaces for underscores`: inserts `long hair` instead of `long_hair`.
- `Append comma`: adds a comma after inserted suggestions.

## Notes

- The GitHub repository does not include `danbooru_tags.csv`.
- The downloaded `danbooru_tags.csv` keeps the original filename and original content.
- The natural language tag file and both translation files are bundled with the repository.
- User tag files should be placed under `tags/tag_files/`.
- Japanese translation or alias files should be placed under `tags/translation_files/`.
- Large `All` combinations may be slower than choosing a single CSV.
- If no tag file is available, no suggestion popup is shown.
