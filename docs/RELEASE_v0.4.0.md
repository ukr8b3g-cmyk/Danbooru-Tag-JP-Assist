# Danbooru Tag JP Assist v0.4.0

## What's New — v0.4.0（2026-10-24）

- 自然言語辞書を整理し、MOSS向けの英語語句CSV `moss_image_natural_language.csv` と対応する日本語検索用CSV `moss_image_natural_language_ja.csv` を追加しました。
- **使い方**：Settings → Danbooru Tag JP Assistで、タグと翻訳の各チェックリストから上記CSVを選びます。追加ファイルは保存済みの選択に自動追加されません。`CSV-aware`では通常のMOSS語句はphraseとしてカンマ設定に従い、raw指定のテンプレートはそのまま挿入します。
- 新規設定のCSV選択モードはタグ・翻訳とも `Selected CSVs only`。未保存のチェックリストは利用可能なCSVで初期化し、保存済みのモード・選択・空選択を維持します。
- 候補のスクロールバーを左クリックしても候補が閉じないよう修正。実際に入力欄からフォーカスが外れた場合は閉じます。
- Formatのマウスオーバー説明は日本語UIで日本語、それ以外は英語。設定画面の画像と各項目の説明も掲載しました。

## What's New — v0.4.0 (2026-10-24)

- Reorganize natural-language vocabulary and add `moss_image_natural_language.csv` with matching Japanese search translations in `moss_image_natural_language_ja.csv`.
- Select these files independently in the tag and translation checklists under Settings → Danbooru Tag JP Assist. New files are not added to saved selections automatically. In CSV-aware mode, Ordinary MOSS phrases follow the comma preference; raw templates are inserted unchanged.
- New tag and translation selection modes default to `Selected CSVs only`; unsaved lists start with available CSVs. Saved modes, order, and empty selections are preserved.
- Keep suggestions open while dragging their scrollbar, while dismissing them on genuine input focus loss.
- Format hover help follows the ComfyUI language: Japanese for Japanese UI, English otherwise. The README includes a Settings screenshot and usage explanations.

## Update / 更新

ComfyUI ManagerからJP Assistを更新するか、既存のcustom_nodes/Danbooru-Tag-JP-Assistフォルダーで `git pull --ff-only` を実行してください。作業を保存してご自身で再起動・ブラウザ再読み込みを行ってください。

Update JP Assist in ComfyUI Manager, or run `git pull --ff-only` in its existing custom_nodes folder. Save your work before restarting and reloading the browser.
