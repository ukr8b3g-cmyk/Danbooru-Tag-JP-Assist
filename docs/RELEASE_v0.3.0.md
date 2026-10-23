# Danbooru Tag JP Assist v0.3.0 — Prompt formatting

## 日本語

**上部のFormatボタンで、プロンプトをまとめて整形できるようになりました。** 初期対象は`All recognized prompt inputs`です。現在のワークフロー内の対応するプロンプト欄を整形し、ノート・JSON・コード欄は一括対象から除外します。

- **使い方**：上部操作バーのFormat、または入力欄でAlt + Shift + F。1つの入力欄や選択文字列だけに適用する場合は、Settings → Danbooru Tag JP Assist → Formatting → Format targetで`Current input / selection`を選びます。選択ノードだけにも適用できます。
- **個別設定**：重複タグ削除、アンダースコア変換、行末カンマ追加は個別に有効化でき、初期OFFです。OFFでも余分なカンマ・空白は整えます。入力中・Queue実行時の自動整形は行いません。
- **特殊タグを保護**：重み、LoRA／Embedding、ワイルドカード、アーティスト接頭辞、引用文字列、エスケープ、`score_*`を保持します。JSON、不完全な構文、特殊タグの途中だけの選択は変更しません。
- **Undoと入力継続**：整形後のフォーカスを維持します。Undo／Redoは入力欄ごとに利用でき、IME変換中は整形しません。
- **補完の改善**：マウスで候補を確定した後も入力欄へフォーカスを維持。Sort modeの初期値は`Priority / count`になりました。
- **表示修正**：新しいComfyUI操作バーでFormatボタンが非表示メニューへ入る問題、Settingsの説明ポップアップが重複・残留する問題を修正しました。

保存済みの整形対象と並び順は維持します。以前の初期値が保存されている場合は、一度`All recognized prompt inputs`を選択してください。ノードID、既存ワークフロー形式、CSV選択順、同梱辞書は変更しません。追加のランタイム依存関係やモデルダウンロードはありません。

### 更新

ComfyUI ManagerでDanbooru Tag JP Assistを更新してください。Git導入の場合は、対象ComfyUIの`custom_nodes/Danbooru-Tag-JP-Assist`フォルダーで`git pull --ff-only`を実行します。作業中のワークフローを保存し、更新後はブラウザーを再読み込みしてください。古いフロントエンドが残る場合はCtrl + F5を使います。

## English

Use **Format** in the top action bar or **Alt + Shift + F** in a node input. The default target is **All recognized prompt inputs** in the current workflow. Settings also offer the current input/selected text and selected-node scopes. Saved target preferences are preserved.

- Normalize commas and whitespace while preserving paragraphs and indentation. Duplicate plain tags, underscore conversion and newline commas are independent options, all off by default.
- Protect weighted/grouped syntax, LoRA/Embedding references, wildcards, artist prefixes, quoted/escaped text, score tags and underscore exclusions. Incomplete syntax and JSON are left unchanged.
- Keep input focus and native per-input Undo/Redo; block formatting during IME composition. Formatting never runs automatically on typing or queue submission.
- Keep focus after mouse completion and default Sort mode to Priority / count without overriding saved choices.
- Mount Format on the current ComfyUI action bar, including delayed/replaced toolbars, and clean up orphaned or duplicate Settings tooltips.

No workflow schema, public node ID, dictionary order, bundled dictionary or runtime dependency changes. Update through ComfyUI Manager or run `git pull --ff-only` in the custom node folder, save workflows, and reload the browser.

The interaction design is inspired by [Haoming02/comfyui-prompt-format](https://github.com/Haoming02/comfyui-prompt-format). See the [README](https://github.com/ukr8b3g-cmyk/Danbooru-Tag-JP-Assist#readme) for all settings and underscore-exclusion examples.

## Verification

The release requires product regression and Registry configuration CI on the exact release commit before tagging. Local regression coverage includes 57 JavaScript tests; isolated browser checks cover formatting scopes, button placement, focus, native Undo/Redo and tooltip cleanup. Manual operation in ComfyUI was also confirmed before publication.
