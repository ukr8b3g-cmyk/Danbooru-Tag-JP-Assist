# Danbooru Tag JP Assist

Danbooru Tag JP Assist は、ComfyUI ノードの複数行テキスト入力欄でタグ候補を表示する補完ノードです。

日本語で検索しながら、英語タグや英語の自然言語ワードをプロンプトへ入力できます。

[English README](#english-readme)

## What's New — v0.3.0（2026-10-23）

- **上部操作バーにFormatを追加**：ボタンを押すだけでプロンプトの余分なカンマ・空白を整えます。入力欄では **Alt + Shift + F** でも実行できます。
- **初期対象はAll recognized prompt inputs**：現在のワークフロー内の認識できるプロンプト欄を一括整形。現在欄／選択文字列、選択ノードにも切り替えられます。保存済みの対象設定は維持します。
- **設定は既存Settingsに集約**：`Danbooru Tag JP Assist → Formatting`から、重複削除・アンダースコア変換・行末カンマ追加を個別にON/OFFできます。3つとも初期OFFです。詳しい手順は[プロンプト整形](#プロンプト整形)を参照してください。
- **特殊タグ・Undo・フォーカスを保護**：重み、LoRA／Embedding、ワイルドカード等を維持し、整形後も続けて入力できます。Undo／Redoは入力欄ごとに利用できます。
- **補完操作を改善**：候補をマウスで確定した後も入力フォーカスを維持。Sort modeの初期値を`Priority / count`に変更し、保存済みの並び順は維持します。
- **表示不具合を修正**：新しいComfyUI操作バーでもFormatを表示。Settingsを閉じた後に残る重複・参照元消失の説明ポップアップを除去します。

ノードID、ワークフロー形式、CSV選択順は変更しません。入力中やQueue実行時に自動整形する機能ではありません。

## 配布

正式版は [GitHub Releases](https://github.com/ukr8b3g-cmyk/Danbooru-Tag-JP-Assist/releases) から取得できます。Comfy Registryへの公開・審査状態はGitHub ActionsとRegistry側で確認してください。Git cloneからのインストールも利用できます。

- Node ID: `danbooru-tag-jp-assist`
- Publisher ID: `ukr8b3g-cmyk`
- バージョン: `0.3.0`
- ComfyUI の Python 環境で動作します。`server` と `aiohttp` は ComfyUI 側の環境を使用するため、追加の pip 依存は宣言していません。
- 配布には本体 Python、`web/`、下記の同梱タグ5件・翻訳2件のCSV、README、LICENSE、THIRD_PARTY_NOTICES を含めます。`.comfyignore` は実行時ダウンロード、取得メタデータ、一時ファイル、利用者が追加したデータを除外します。公開準備は利用者データのないクリーンな checkout で行ってください。
- MIT はソースコードに適用され、第三者データの利用条件を置き換えません。[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。

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

## v0.2.1 — 辞書更新の安全性とパフォーマンス改善（2026-10-19）

- Hugging Face辞書の更新要求を直列化し、ダウンロード・メタデータ更新の一時ファイルを要求ごとに分離します。ダウンロードしたCSVは全行を厳密に検証し、異常があれば正常な辞書を上書きしません。
- 破損したCSVは候補から除外し、エラーと正常な候補を辞書選択ごとに保持します。同じファイル状態の繰り返し検索では正常なCSVを再解析せず、ファイル変更や「Reload dictionaries」で再試行します。保持する不完全選択のキャッシュは最大2件です。
- Reload時のファイル読込ロック待ちはComfyUIのイベントループからワーカースレッドへ移しました。
- 候補の色・表示項目のみの変更では検索キャッシュを消去せず、表示中の候補を再描画します。遅延DOM Widgetの検出はフレーム単位にまとめ、通常のノード生成時の検出は維持します。

**ノードID、補完確定操作、CSV選択順と優先順位は変更していません。** v0.2.0で追加された機能を維持し、v0.2.1では保守修正のみを反映します。

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

## プロンプト整形

通常画面の**上部操作バーにある Format** ボタン、または入力欄で **Alt + Shift + F** を押すと整形します。設定は **Settings → Danbooru Tag JP Assist → Formatting** にまとめています。この中にもFormatボタンがあります。

初期状態では、上部のFormatボタンを押すと、現在のワークフロー内の認識できるプロンプト欄をまとめて整形します。1つの欄だけを整える場合は、Settingsで対象を`Current input / selection`に変更し、入力欄をクリックしてからFormatを押してください。文字列の一部なら範囲選択して実行します。Settingsを毎回開く必要はありません。スイッチを切り替えただけでは文章は変わりません。

| 設定 | 実行時の動作 |
| --- | --- |
| Append comma on newline | 次の行にも文章があるとき、前の行末にカンマを追加。最後の行には追加しません。 |
| Replace underscores | `blue_hair` → `blue hair`。特殊タグと除外パターンは維持。 |
| Remove duplicate plain tags | 同じ行の `smile, smile` → `smile`。別の行や重み付きタグは削除しません。 |
| Format target: Current input / selection | 最後にクリックした入力欄、またはその選択文字列だけを整形。 |
| Format target: Selected nodes | 選択ノード内の対応するプロンプト欄を一括整形。 |
| Format target: All recognized prompt inputs | 初期値。現在のワークフロー内の、認識できるプロンプト欄を一括整形。 |

3つのスイッチがすべてOFFでも、`1girl,,  solo , smile` → `1girl, solo, smile` のように余分なカンマ・空白を整えます。戻すときは対象の入力欄で **Ctrl + Z** を押します。

- `Format target`：現在の入力欄／選択文字列、選択ノード、認識できる全プロンプト欄（初期値）を選べます。保存済みの選択は維持します。以前の初期値を保存している場合は、一度`All recognized prompt inputs`を選んでください。一括対象は既知のTextEncode・Prompt・String等の入力欄で、Note・JSON・コード欄は除外します。未対応のノードは現在の入力欄を指定してください。
- 通常はカンマの連続・前後の空白を整え、改行・空行・インデントを維持します。
- `Remove duplicate plain tags`、`Replace underscores`、`Append comma on newline` は個別に有効化できます。すべて初期OFFです。重複削除は同じ行の通常タグだけに適用します。行末カンマは後続行がある場合に追加し、BREAK等の制御行や文末の句読点は保護します。
- 重み・括弧内、LoRA／Embedding、ワイルドカード、`@artist`、エスケープ、引用文字列を保護します。`score_*`と既存の`Underscore exclusions`も変換しません。JSONや閉じていない構文は整形しません。特殊タグの途中だけを選択した場合も変更しません。
- 編集フォーカスを維持し、ブラウザーのUndo／Redoが利用できます。一括整形のUndoは**入力欄ごと**です。IME変換中は整形せず、実行後の文字列は通常の入力イベントでノードへ反映します。入力中・Queue実行時の自動整形は行いません。

操作構成は [Haoming02/comfyui-prompt-format](https://github.com/Haoming02/comfyui-prompt-format) を参考にし、整形処理はJP Assistの特殊タグ保護に合わせて実装しています。

### Underscore exclusionsの使い方

**Settings → Danbooru Tag JP Assist → Insert → Underscore exclusions** は、空白に変換したくないタグを指定する欄です。例えば `score_*, rating_*, my_custom_tag` とカンマ区切りで入力すると、該当するタグはアンダースコアを維持します。`*`は任意の文字列、`?`は任意の1文字に一致し、通常のタグ名は完全一致で指定できます。改行区切りにも対応しています。

補完の`Use spaces for underscores`、整形の`Replace underscores`がONのときに適用します。どちらもOFFなら変換しません。追加の除外が不要なら空欄で構いません。Formatでは`score_*`と特殊構文を空欄でも保護します。

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

ヘッダー付きCSVに加え、ヘッダーなしの `tag,category,count,aliases` 形式も読み込めます。ヘッダーなしの4列目は別名として扱う位置で、挿入モードには使いません。不正なCSVはファイル単位で除外し、正常な辞書と通常入力を継続します。

Settings → **Danbooru Tag JP Assist** 内の `Completion behavior` は初期値 `Existing` です。`CSV-aware` を選ぶと、CSVの任意列 `source_type` (`tag` / `natural_language` / `custom`)、`insert_mode` (`tag` / `phrase` / `word` / `raw`)、`category_scheme` を利用します。`tag` と `phrase` は既存のカンマ設定、`word` は空白のみ、`raw` はセルの文字列を変換せず挿入します。自然言語の `word` は複数語にも使えます。列のない利用者CSVは従来動作を維持し、同梱 `natural_language_tags.csv` はCSV-aware時に `natural_language` / `word` として扱います。

日本語表示と `Use JP aliases for search` は独立しています。`Show TAG / NL / CUSTOM`、`Show source CSV`、`Show post count` は初期OFFです。投稿数は確認できる辞書由来の値だけを表示し、0件と不明を区別します。同名タグの優先CSV・Allでの採用順は維持し、別の辞書の投稿数やカテゴリを混ぜません。

`Underscore exclusions` は `score_*` などのglobパターンをカンマまたは改行で指定できます。挿入文字列だけを保護し、ワイルドカードの実行はしません。`Reload dictionaries` はサーバーとブラウザーの検索キャッシュを無効化します。CSVの追加・削除後にファイル選択肢も更新する場合はブラウザーを再読込してください。

IME変換中の確定キーは補完で消費しません。Escape、選択位置変更、設定変更、ノード削除で古い候補を無効化し、補完確定前にも入力と位置を確認します。通常のChromiumではネイティブ編集を使ってUndo履歴を保持します。他ブラウザーの代替編集経路はUndo対応を保証しません。

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

タグ・翻訳の各 `Selection mode` で `Selected CSVs only` を選ぶと、チェックしたCSVだけを選択順に使用します。↑ / ↓ で優先順位を変更できます。空の選択は候補・翻訳なしです。旧 `Tag source` / `Tag file (priority)` / `Translation file` は表示を維持しますが、選択モードでは対応する旧設定を使用しません。

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

- `Settings → pysssss → Text Autocomplete` と併用すると、Embeddingなどの別候補が重なったり、スクロールバー操作でJP Assist候補が閉じる場合があります。その場合はpysssss側のText AutocompleteをOFFにしてください。JP AssistはEmbedding / LoRA候補を自動取得しません。

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

## What's New — v0.3.0 (2026-10-23)

- **Format in the top action bar**, also available through **Alt + Shift + F**. Format all recognized prompt inputs by default, or choose the current input/selection or selected nodes.
- **Options in the existing Settings category**: duplicate plain tags, underscore conversion and newline commas, all off by default. See [Prompt Formatting](#prompt-formatting) for usage.
- **Preserve special syntax, focus and per-input Undo/Redo**. No automatic formatting on typing or queue submission.
- **Better completion behavior**: keep focus after clicking a candidate and default sorting to `Priority / count`. Saved preferences take precedence.
- **UI fixes**: support delayed/replaced modern toolbars and remove orphaned or duplicate Settings tooltips.

Existing workflow formats, node IDs and CSV precedence are preserved.

## Distribution

Stable versions are available from [GitHub Releases](https://github.com/ukr8b3g-cmyk/Danbooru-Tag-JP-Assist/releases). Check GitHub Actions and Comfy Registry for publication and review status. Git clone installation is also supported.

- Node ID: `danbooru-tag-jp-assist`
- Publisher ID: `ukr8b3g-cmyk`
- Version: `0.3.0`
- Runs inside ComfyUI's Python environment. ComfyUI supplies `server` and `aiohttp`, so no additional pip dependencies are declared.
- The distribution includes the Python implementation, `web/`, the five bundled tag CSVs and two translation CSVs listed below, README, LICENSE, and THIRD_PARTY_NOTICES. `.comfyignore` excludes runtime downloads, download metadata, temporary files, and user-added data. Prepare any publication from a clean checkout without user data.
- MIT applies to the source code and does not replace third-party data terms. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

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

Headerless `tag,category,count,aliases` files are supported; the fourth column is not an insertion mode. Malformed files are isolated from healthy dictionaries.

All controls remain in Settings → **Danbooru Tag JP Assist**. `Completion behavior` defaults to `Existing`. Opt into `CSV-aware` to use optional `source_type`, `insert_mode`, and `category_scheme` columns. `tag` / `phrase` follow the comma preference, `word` inserts without a comma (including multi-word phrases), and `raw` preserves the decoded cell text. User CSVs without these columns retain tag behavior; the bundled natural-language dictionary uses word behavior in CSV-aware mode.

Japanese search and display are independent. Source labels, source filenames and post counts default to hidden. Zero and unknown counts are distinct, and metadata belongs to the winning CSV row. Underscore exclusions accept comma/newline-separated glob patterns. Reload dictionaries clears both server and browser search caches and refreshes the ordered CSV checklists; reload the browser to refresh the legacy single-file dropdown options after adding/removing CSVs. Active IME composition, stale input, Escape and node removal cannot commit obsolete suggestions. Chromium uses native edits for undo; fallback editing on other browsers may not preserve native undo history.

Developer checks (no additional dependencies):

```text
python -B tests/test_backend.py
node --test tests/test_completion_core.mjs tests/test_autocomplete.mjs
```

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

- `Tag selection mode` and `Translation selection mode`: independently choose the existing `All / single priority` (`All / single file` for translations) or `Selected CSVs only`. The default preserves existing settings.
- `Selected tag CSVs (ordered)` and `Selected translation CSVs (ordered)`: check files in priority order, then use ↑ / ↓ to reorder. In selected mode only checked files are read. The first selected tag CSV wins duplicate rows and its matches precede later files before `Sort mode`; the first selected translation CSV wins duplicate translations. Empty tag selection gives no suggestions; empty translation selection gives no translations. Missing selections remain visible as unavailable and never fall back to All.
- In selected mode the tag checklist controls search instead of `Tag source` and `Tag file (priority)`, and the translation checklist controls search instead of `Translation file`. The legacy controls remain visible but are not used in the corresponding selected mode. Switching back restores those existing choices. Settings are global and do not add workflow fields. Restart ComfyUI and reload the browser after updating to enable the new backend behavior.
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

## Prompt Formatting

Click **Format** in the top action bar to format all recognized prompt inputs by default, or press **Alt + Shift + F** in a node input. Choose `Current input / selection` and click an input (or select text) to limit the edit. You do not need to reopen Settings for each edit. **Settings → Danbooru Tag JP Assist → Formatting** contains the target selector, another Format action, and three independent options (all off by default): duplicate plain tags, underscore replacement, and newline commas. Changing an option does not edit text until Format is invoked. Even with all options off, `1girl,,  solo , smile` becomes `1girl, solo, smile`. Use **Ctrl + Z** in the input to undo.

The default target is all recognized prompt inputs. Saved target preferences are preserved; select `All recognized prompt inputs` once if the previous default was saved. Batch modes target selected nodes or all recognized TextEncode/Prompt/String inputs, excluding notes, JSON and code nodes. Unknown custom nodes can use the current-input mode. Commas and spacing are normalized while paragraphs and indentation remain intact. Syntax groups, model references, wildcards, artist prefixes, escapes, quoted text, score tags and underscore exclusions are protected. Incomplete syntax, JSON and partial selections inside protected tokens are left unchanged.

Focus and native browser Undo/Redo are preserved; batch edits are undone **per input**, not as one graph-wide action. Formatting is explicit, never on typing or queue submission, and is blocked during IME composition. The interaction design is inspired by [comfyui-prompt-format](https://github.com/Haoming02/comfyui-prompt-format).

`Insert → Underscore exclusions` accepts comma- or newline-separated patterns, such as `score_*, rating_*, my_custom_tag`. `*` matches any sequence and `?` one character; plain names match whole tags. These exclusions apply when insertion's `Use spaces for underscores` or formatting's `Replace underscores` is enabled. Leave the field empty if no additional exclusions are needed. Format always protects score tags and special syntax.

## Notes

- If suggestions overlap or dragging the suggestion scrollbar dismisses JP Assist, disable `Text Autocomplete` under `Settings → pysssss`. That separate extension provides Embedding/LoRA suggestions; JP Assist does not automatically fetch those model lists.

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
