# Danbooru Tag JP Assist

Danbooru Tag JP Assist は、ComfyUI ノードの複数行テキスト入力欄でタグ候補を表示する補完ノードです。

日本語で検索しながら、英語タグや英語の自然言語ワードをプロンプトへ入力できます。

[English README](#english-readme)

## インストール

ComfyUI を停止してから、`custom_nodes` に clone します。

```powershell
cd D:\Codex\ComfyUI\custom_nodes
git clone https://github.com/ukr8b3g-cmyk/Danbooru-Tag-JP-Assist.git Danbooru-Tag-JP-Assist
```

すでにフォルダーがある場合は、通常は fast-forward のみで更新します。

```powershell
cd D:\Codex\ComfyUI\custom_nodes\Danbooru-Tag-JP-Assist
git pull --ff-only
```

ローカルでコードを編集しておらず、ブランチが分岐して更新できない場合は、GitHub の `origin/main` を正本として同期できます。

```powershell
git fetch origin
git reset --hard origin/main
```

> `git reset --hard origin/main` はローカルの未コミット変更・ローカルのみのコミットを破棄します。必要な変更がある場合は先に退避してください。

その後、ComfyUI を再起動し、古いUIが残る場合はブラウザを `Ctrl + F5` でハード更新してください。

## できること

- ComfyUI ノードの複数行テキスト欄でタグ候補を表示します。
- 日本語の別名や翻訳から英語タグを検索できます。
- 英語タグをプロンプトへ挿入します。
- `_` を空白に置き換えて、Krea系の自然言語プロンプト風に入力できます。
- カンマを自動で追加できます。
- 一致順、優先度/count順、A-Z順で並び替えできます。
- Danbooruタグ、自然言語辞書、自分のCSVを併用できます。
- 個別の `Tag file (priority)` を選ぶと、そのCSVの一致候補を最優先し、足りない分だけ `Tag source` で有効な他ファイルから補完します。
- 候補挿入時に既存の改行・空行・インデント・前後スペースを保持できます。
- Hugging Face の Danbooru CSV を起動時に確認し、更新があればローカルの `danbooru_tags.csv` を更新できます。
- 検索はサーバー側で行い、必要な候補だけをブラウザへ返します。
- 入力検索は80msデバウンスされ、候補の上下移動ではリスト全体を再描画しません。

`All` は複数のタグファイルや翻訳ファイルをまとめて使う簡単なモードです。個別ファイルを選んだ場合は「そのファイルだけ」に限定せず、選択ファイルを優先しつつ他の有効なソースをフォールバックとして利用します。

Hugging Face がオフライン、または元ファイルが消えている場合は、既存のローカルCSVをそのまま使います。

## 基本的な使い方

1. ComfyUI の Settings を開きます。
2. `Danbooru Tag JP Assist` を有効にします。
3. まずは `Tag file (priority): All`、`Translation file: All` のまま使います。
4. ノードの複数行プロンプト欄に英語または日本語を入力します。
5. 候補をキーボードまたはマウスで選択します。

初期設定では以下の動作になります。

- `Tag file (priority): All` は `tags/tag_files/` 内の同梱CSVと、ローカルにある Danbooru CSV をまとめて検索します。
- 個別の `Tag file (priority)` を選ぶと、そのファイルの一致候補が先に並び、候補上限に余りがある場合は `Tag source` で有効な他ファイルから補完します。
- `Translation file: All` は同梱の翻訳CSVをまとめて読みます。
- `Tag source: Both` はローカルファイルと Hugging Face 由来の Danbooru CSV を併用します。
- 同じタグが選択中の優先ファイルと他ファイルの両方にある場合は、優先ファイル側の行を採用します。優先ファイルを指定していない `All` では、従来どおり後から読み込まれる Danbooru CSV 側が重複時に優先されます。
- `natural_language_tags.csv` は軽量な英語辞書・プロンプト語彙です。Danbooruタグの代替ではありません。
- `merged_translations_dedup.csv` は Danbooru タグ用の日本語別名です。
- `natural_language_ja.csv` は自然言語辞書用の日本語別名です。
- CSVはサーバー側でキャッシュされます。大きな `All` 構成では最初の検索だけ読み込みに時間がかかる場合があります。

## ファイル構成

タグファイルと翻訳ファイルは別フォルダーに置きます。

- `tags/tag_files/`: 英語タグ・英語辞書CSVを置くフォルダー
- `tags/translation_files/`: 日本語翻訳・別名CSVを置くフォルダー

現在の同梱タグファイル:

- `tags/tag_files/anima_artists.csv`
- `tags/tag_files/anima_characters.csv`
- `tags/tag_files/danbooru_2025.csv`
- `tags/tag_files/e621.csv`
- `tags/tag_files/natural_language_tags.csv`: 軽量な英語辞書・プロンプト語彙

同梱翻訳ファイル:

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

## Tag file (priority) の動作

個別CSVを選んでも検索範囲はその1ファイルだけにはなりません。選択CSVの一致候補に優先度0、フォールバック候補に優先度1を付け、`Sort mode` の並び順より先に優先度を評価します。

たとえば `Suggestion count = 20` で、選択CSVに検索語と一致する候補が7件しかない場合、先頭7件は選択CSVから出し、残り最大13件を `Tag source` で有効な他CSVから補完します。選択CSVだけで20件以上一致すれば、表示上は選択CSVの候補だけになります。

## 主な設定

- `Tag file (priority)`: `tags/tag_files/` 内の1ファイル、または `All`。初期値は `All` です。個別ファイルを選ぶと、そのファイルの一致候補を優先し、候補が足りない場合は `Tag source` で有効な他ファイルから補完します。
- `Translation file`: `tags/translation_files/` 内の1ファイル、または `All`。
- `Update Danbooru CSV from Hugging Face`: Hugging Face 側を確認し、変更があれば `danbooru_tags.csv` を更新します。
- `List every match`: 候補を多めに表示します。上限は500件です。
- `Suggestion count`: `List every match` がOFFの時の表示数です。
- `Sort mode`: `Match first`、`Priority / count`、`Tag A-Z`。
- `Popup color`: 候補ポップアップの色です。
- `Use spaces for underscores`: `long_hair` を `long hair` として挿入します。
- `Append comma`: 候補挿入後にカンマを追加します。
- `Preserve prompt formatting`: 初期値はONです。候補挿入時に既存の改行・空行・インデント・前後スペースを保持します。OFFでは従来の自動整形動作になります。

入力検索は80msデバウンスされ、候補の上下移動ではリスト全体を再描画しません。Hugging Face のCSV更新確認もUI初期化をブロックせずバックグラウンドで実行されます。

CSVを追加・削除したあと、Settings のリストが更新されない場合は ComfyUI を再起動してください。

## 注意

- 補完対象は ComfyUI ノードに属する複数行テキスト欄です。Settings や一般的なモーダル内の textarea には取り付けません。
- GitHubリポジトリには `danbooru_tags.csv` を含めません。
- ダウンロード済みの `danbooru_tags.csv` は、元のファイル名と内容を維持します。
- Hugging Face からの更新は一時ファイルへストリーミング保存し、CSVヘッダーを確認してから置き換えます。
- Hugging Face から自動取得するCSVには128 MiBの上限を設けています。
- 自分のタグファイルは `tags/tag_files/` に置いてください。
- 自分の翻訳・別名ファイルは `tags/translation_files/` に置いてください。
- `All` で大きなCSVを複数読む場合、初回検索時は単一CSVより読み込みに時間がかかる場合があります。
- タグファイルがない場合、候補ポップアップは表示されません。

## ライセンス

ソースコードは [MIT License](LICENSE) で公開しています。

同梱するタグ・翻訳データには、改変した第三者データが含まれる場合があります。出典と利用条件は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。

---

## English README

Danbooru Tag JP Assist adds tag suggestions to multiline text areas that belong to ComfyUI nodes.

It is intended for users who want to search English Danbooru tags and English prompt vocabulary with optional Japanese aliases.

## Installation

Stop ComfyUI, then install into `custom_nodes`:

```powershell
cd D:\Codex\ComfyUI\custom_nodes
git clone https://github.com/ukr8b3g-cmyk/Danbooru-Tag-JP-Assist.git Danbooru-Tag-JP-Assist
```

If the folder already exists, normally update with fast-forward only:

```powershell
cd D:\Codex\ComfyUI\custom_nodes\Danbooru-Tag-JP-Assist
git pull --ff-only
```

If you do not keep local code changes and the local branch has diverged, you can sync it exactly to GitHub `origin/main`:

```powershell
git fetch origin
git reset --hard origin/main
```

> `git reset --hard origin/main` discards uncommitted changes and local-only commits. Back up anything you need first.

Restart ComfyUI and hard refresh the browser with `Ctrl + F5`.

## What It Does

- Shows suggestions while typing in multiline text boxes that belong to ComfyUI nodes.
- Inserts English tags into the prompt.
- Can display Japanese aliases next to suggestions.
- Can insert spaces instead of underscores for Krea-style natural prompts.
- Supports sorting by match, priority/count, or tag name.
- Supports local tag files, Hugging Face tag files, or both.
- Selecting a specific `Tag file (priority)` prioritizes matches from that CSV and fills any remaining slots from other sources enabled by `Tag source`.
- Can preserve existing line breaks, blank lines, indentation, and surrounding spaces when inserting a suggestion.
- Can check the Hugging Face source at startup and download/update the local `danbooru_tags.csv` when the remote file changes.
- Performs matching on the server and sends only the requested suggestions to the browser.
- Debounces input searches by 80 ms and updates keyboard selection without rebuilding the full suggestion list.

`All` is the simplest combined mode. Selecting a specific file no longer acts as a hard single-file filter: the selected file is treated as the priority source and other enabled sources remain available as fallback.

If Hugging Face is offline or the source file disappears, the node keeps using the local saved CSV.

## Basic Use

1. Open ComfyUI Settings.
2. Enable `Danbooru Tag JP Assist`.
3. Use the default `Tag file (priority): All` and `Translation file: All` first.
4. Type English or Japanese text in a multiline prompt box on a node.
5. Select a suggestion with the keyboard or mouse.

Default behavior:

- `Tag file (priority): All` searches bundled CSV files under `tags/tag_files/` plus the local Danbooru CSV when available.
- Selecting a specific `Tag file (priority)` puts matches from that file first, then fills unused result slots from other files enabled by `Tag source`.
- `Translation file: All` loads the bundled translation CSV files together.
- `Tag source: Both` uses local files and the Hugging Face Danbooru CSV together.
- If a tag exists in both the selected priority file and fallback files, the selected file wins. With `All` and no explicit priority file, the later-loaded Danbooru CSV keeps the existing duplicate-resolution behavior.
- `natural_language_tags.csv` is a lightweight English dictionary and prompt vocabulary, not a Danbooru tag replacement.
- `merged_translations_dedup.csv` is for Danbooru tag Japanese aliases.
- `natural_language_ja.csv` is only for the natural language dictionary.
- CSV data is cached on the server. A large `All` configuration may take longer on the first search while the cache is built.

## Tag Files

Use two separate folders:

- `tags/tag_files/`: English tag files.
- `tags/translation_files/`: Japanese translation or alias files.

Currently bundled tag files:

- `tags/tag_files/anima_artists.csv`
- `tags/tag_files/anima_characters.csv`
- `tags/tag_files/danbooru_2025.csv`
- `tags/tag_files/e621.csv`
- `tags/tag_files/natural_language_tags.csv`: lightweight English dictionary and prompt vocabulary

Bundled translation files:

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

## Tag file (priority) behavior

Selecting a specific CSV does not restrict search to that file alone. Matches from the selected CSV are assigned priority 0 and fallback matches priority 1, and this priority is evaluated before the selected `Sort mode`.

For example, with `Suggestion count = 20`, if the selected CSV has only 7 matches for the query, those 7 appear first and up to 13 additional matches are filled from other sources enabled by `Tag source`. If the selected CSV has 20 or more matches, only its matches will normally be visible within that result limit.

## Settings

- `Tag file (priority)`: one file in `tags/tag_files/` or `All`. The default is `All`. Selecting a file prioritizes matches from that file, then fills remaining suggestions from other files enabled by `Tag source`.
- `Translation file`: one file in `tags/translation_files/` or `All`.
- `Update Danbooru CSV from Hugging Face`: checks and updates `danbooru_tags.csv`.
- `List every match`: shows a larger result list, capped at 500 suggestions.
- `Suggestion count`: limits displayed suggestions when `List every match` is off.
- `Sort mode`: `Match first`, `Priority / count`, or `Tag A-Z`.
- `Popup color`: changes the suggestion popup color.
- `Use spaces for underscores`: inserts `long hair` instead of `long_hair`.
- `Append comma`: adds a comma after inserted suggestions.
- `Preserve prompt formatting`: enabled by default. Keeps existing line breaks, blank lines, indentation, and surrounding spaces when inserting a suggestion. Disable it to use the legacy whitespace-normalizing behavior.

Autocomplete searches are debounced by 80 ms, keyboard navigation no longer rebuilds the full suggestion list, and the Hugging Face CSV refresh check runs without blocking extension UI initialization.

## Notes

- Autocomplete is attached to multiline text areas owned by ComfyUI nodes, not general Settings or modal text areas.
- The GitHub repository does not include `danbooru_tags.csv`.
- The downloaded `danbooru_tags.csv` keeps the original filename and original content.
- Hugging Face updates are streamed into a temporary file and the CSV header is validated before replacement.
- Automatically downloaded CSV files are limited to 128 MiB.
- User tag files should be placed under `tags/tag_files/`.
- Japanese translation or alias files should be placed under `tags/translation_files/`.
- Large `All` combinations may take longer on the first search than choosing a single CSV.
- If no tag file is available, no suggestion popup is shown.

## License

The source code is released under the [MIT License](LICENSE).

Bundled tag and translation data may include modified third-party data. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for source attribution and usage terms.
