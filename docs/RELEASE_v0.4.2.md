# Danbooru Tag JP Assist v0.4.2

2026-10-24 — 補完・Format・検索と公開前チェックの保守更新です。

## 修正内容

1. **自然言語補完で直後の句読点を保持**。CSV-awareのwordモードで、文末記号・閉じ括弧・隣接する絵文字を置換範囲に含めません。語中・複数語の接尾辞一致・日本語別名・UTF-16のカーソル位置、内部ハイフン／アポストロフィー、候補自体に含まれる記号を確認しました。tag／raw／phraseの既存規則は維持します。
2. **自身の公開ノードを一括Formatに含める**。`DanbooruTagJPAssist`の`text`欄をall／selectedの対象に追加。Note・JSON・コード等の除外、非選択・readonly・disabled・IME中の保護を維持します。
3. **製品だけの修正でも必須CIを起動**。Registry設定チェックをmainの全pushで実行します。正式公開には引き続き、同一SHAの製品テストとRegistry設定テストの成功が必要です。
4. **正規化で空になる検索を空候補として返す**。`_`、`__`、ASCII／全角空白等でも検索結果の戻り値契約を維持し、現行・旧互換APIの例外を防ぎます。空文字による全件取得は変更しません。

## 検証

- Pythonバックエンド32件・JavaScript68件・公開設定30件、計130件。
- 隔離Chromeで実際のフロントコードを読み込み、候補確定18ケース、ネイティブUndo／Redo、カーソル位置、all／selected／currentのFormat、除外と合成IMEイベントによる抑止を確認。
- 一時辞書を使った現行・旧互換APIへの実HTTP16要求を確認。
- 公開は同一コミットの既存2種のGitHub CIが成功した場合だけ行います。

ブラウザー検証のComfyUI・辞書APIは模擬環境です。実ComfyUIキャンバス、実PrimeVue、Windowsの実IME操作、GPU生成を検証済みとするものではありません。導入先のファイル更新と、稼働中プロセスへの読込は別です。

辞書CSV・保存済み設定・ノードID・ワークフロー形式・依存パッケージは変更していません。旧Releaseとタグは保持します。更新後の再起動・ブラウザー再読込は、作業を保存してから利用者のタイミングで行ってください。

## English

Preserve punctuation and Unicode boundaries in CSV-aware word completions, include the extension's own text node in bulk Format, run required Registry configuration CI on every main push, and return empty suggestions for normalized-empty searches. Keep dictionaries, saved settings, workflow formats and legacy insertion modes intact. Validation covers 130 automated tests, an isolated real-Chrome frontend fixture and 16 local HTTP requests. Live ComfyUI/PrimeVue, native Windows IME and GPU acceptance are separate checks. Exact-source CI is required before publication, and previous releases are preserved.
