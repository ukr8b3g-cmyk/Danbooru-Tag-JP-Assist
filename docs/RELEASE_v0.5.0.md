# Danbooru Tag JP Assist v0.5.0

2026-10-30 — 500件補完の検索・描画を軽量化し、検証済みのSettings改善をまとめました。

## 変更内容と使い方

- 検索の並び順・接頭語・部分一致データを辞書ごとに再利用。候補一覧は表示範囲と周辺だけを描画し、最大500件すべてのスクロール・キー選択を維持します。軽量化の追加設定はありません。
- SettingsでタグCSVと翻訳CSVを別々に選び、↑／↓で優先順を変更します。選択解除は空の選択を保持。従来モードは折りたたみ欄で利用できます。
- 「よく使う候補を優先する」は初期OFF。ON中に成功した補完だけをブラウザー内に記録し、CSV優先順の次に使用回数を評価します。検索しただけでは加算せず、プロンプト全文は保存しません。
- ComfyUIの日本語UIではSettingsとヘルプを日本語表示し、それ以外は英語表示。独自のツールチップだけを処理し、他拡張の説明を消しません。非表示入力の不要な配置計算も抑制します。
- Hugging Faceの辞書取得を廃止。`danbooru_2025.csv`をダウンロードしません。新しい辞書は手動配置後、「辞書を再読み込み」で反映します。
- 完了済みの旧版専用Releaseワークフローを整理し、既存の汎用Release／Registry検証経路を維持します。旧タグと旧Releaseは保持します。

## 検証と制約

- Pythonバックエンド35件、JavaScript105件、公開設定30件。検索の全探索比較360条件、隔離Chrome13項目を確認。
- 447,638件の辞書を使うCPU比較で、件数順検索はa約385→10ms、blue約404→21ms、temple約383→13ms。隔離描画は500件約13.2→1.2ms。
- 起動中のComfyUI_test / Chrome実画面で、500件目までのスクロール、スクロールバーのドラッグ、500件目のマウス確定、↓＋Enter、Undo／Redo、フォーカス維持、連続入力、Escapeを確認しました。表示付近の8行だけを描画していました。
- 実HTTP補助測定は初回約7秒、同条件の再利用時約35〜38ms。初回の辞書準備は残ります。CPU測定・HTTP応答・隔離描画は、実画面のキー入力から描画までの時間とは別です。
- 物理日本語IME・GPU生成・他のComfyUI環境での実画面動作は今回未確認。既存の自動IME保護テストは維持します。

## 更新方法

作業を保存し、利用者のタイミングで次回ComfyUIを起動してブラウザーを再読み込みしてください。配布／配置の作業は再起動しません。起動中のPythonバックエンドは更新前のコードを使い続けます。

保存済みのCSV選択・順序・設定・ワークフロー形式・ノードIDを維持します。辞書CSVの内容はこのリリースで変更しません。追加の依存ライブラリや検索DBは不要です。

## English

Reuse dictionary search data and virtualize candidate rendering while keeping all 500 choices. Includes localized Settings/help, ordered CSV checklists, opt-in browser-local usage ranking, scoped tooltip cleanup and removal of Hugging Face dictionary downloads. No new performance switch, dependencies, search database or workflow fields.

Validated with 35 backend, 105 JavaScript and 30 publication tests, 360 exhaustive-search comparisons, 13 isolated browser checks, and live ComfyUI_test Chrome scrolling/completion/focus/Undo checks. Initial dictionary preparation remains; CPU, HTTP and isolated-render timings are not keystroke-to-paint guarantees. Native Windows IME, GPU generation and other installed runtimes were not live-tested. Preserve saved settings, workflows and dictionary bytes; activate on the next user-planned restart and browser reload.
