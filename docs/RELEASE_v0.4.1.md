# Danbooru Tag JP Assist v0.4.1

## What’s New — v0.4.1（2026-10-24）

- **候補を入力中の文字・カーソルのすぐ下に表示**するよう変更しました。プロンプト欄の下端まで視線を移す必要がなくなります。
- 改行、日本語の折り返し、入力欄内のスクロール、ComfyUIの拡大率を位置計算に反映します。
- 画面下端で候補が入り切らないときは文字の上側へ表示し、左右の画面端では位置を調整します。
- 入力位置がスクロールで見えなくなったときは候補を隠します。既存の候補確定・IME・CSV設定は維持します。

## What’s New — v0.4.1 (2026-10-24)

- Show autocomplete suggestions directly below the current text caret instead of the bottom of the prompt box.
- Account for newlines, Japanese text wrapping, textarea scrolling, and ComfyUI canvas scaling.
- Place suggestions above the text near the bottom of the viewport, and keep the popup within horizontal viewport edges.
- Hide suggestions when the caret scrolls out of view. Existing completion, IME, and CSV preferences are preserved.

## Update / 更新

ComfyUI ManagerでJP Assistを更新するか、既存の `custom_nodes/Danbooru-Tag-JP-Assist` で `git pull --ff-only` を実行します。作業を保存して、ご自身で再起動・ブラウザ再読み込みを行ってください。

Update through ComfyUI Manager or run `git pull --ff-only` in the existing installation folder. Save your work before restarting and reloading.

Validation: 25 autocomplete tests, isolated Chromium layout checks, and user-confirmed ComfyUI operation. Source CI must pass before publication.
