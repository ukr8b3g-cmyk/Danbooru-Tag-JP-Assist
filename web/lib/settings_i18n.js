// Keep IDs and stored option values stable; only translate presentation.
const entries = {
  Enabled: ['Enable suggestions', '補完候補を有効にする', 'Show suggestions while typing. Disable to use ordinary text input.', '入力中に候補を表示します。OFFにすると通常の文字入力になります。'],
  CompletionUnit: ['Completion unit', '検索する入力範囲', 'Word searches after spaces or commas. Tag searches the whole comma-separated tag.', '「単語」はスペース・カンマの後を検索。「タグ」はカンマで区切ったタグ全体を検索します。'],
  CompletionBehavior: ['Completion behavior', '候補の挿入方法', 'Existing uses the comma and underscore settings for tags. CSV-aware follows each CSV row: tag/phrase use the comma setting, word uses spaces, raw inserts unchanged.', '「従来のタグ挿入」はカンマ・アンダースコアの設定に従います。「CSVごとの挿入方法」はtag/phraseならカンマ設定、wordなら空白のみ、rawなら原文のまま挿入します。'],
  SearchJapanese: ['Use JP aliases for search', '日本語の別名でも検索する', 'Search Japanese aliases as well as English tags. Independent of alias display.', '英語タグに加えて日本語の別名も検索します。日本語の表示設定とは独立しています。'],
  MaxSuggestions: ['Candidate limit (when expanded list is off)', '候補の表示件数（最大500件表示がOFFのとき）', 'Maximum candidates when Show up to 500 candidates is off (1–200). This is a display limit, not the number of search hits.', '「候補を最大500件表示」がOFFのときの表示上限です（1～200件）。検索に一致した総件数ではありません。'],
  ShowAll: ['Show up to 500 candidates', '候補を最大500件表示', 'On: show up to 500 matches, ignoring Candidate limit. Off: use Candidate limit. This does not guarantee every match.', 'ON：表示件数の指定を使わず、最大500件を表示。OFF：指定した件数を表示します。すべての検索結果を表示する機能ではありません。'],
  UsageRanking: ['Prioritize frequently used candidates', 'よく使う候補を優先する', 'Off by default. While on, count successful completions and rank by your use count within each CSV priority, before limiting results. Alias searches share the same candidate count. Equal counts use Sort mode; searches alone are not recorded.', '初期OFF。ON中に確定した候補の回数を記録し、CSVの優先順を保って、その中で使用回数順にします。件数を絞る前に適用。別名からの確定も同じ候補に加算。同回数なら「候補の並び順」に従い、検索だけでは記録しません。'],
  ClearUsageHistory: ['Clear usage history', '候補の使用履歴を消去', 'Erase only JP Assist usage counts for this browser and ComfyUI address. Does not change CSVs, settings or prompts. Turning usage ranking off retains history but stops recording and ranking.', 'このブラウザー・ComfyUI接続先のJP Assist使用回数だけを消去します。CSV・設定・プロンプトは変更しません。使用頻度をOFFにするだけなら履歴を残し、記録と順位への反映を停止します。'],
  LegacyFiles: ['Legacy CSV settings', '従来のCSV設定', 'Compatibility controls for All / single-file modes. Normally use the ordered CSV checklists. Saved legacy choices are retained and inactive in Selected CSVs only mode.', '以前の「すべて／単一CSV」モード用です。通常は優先順付きチェックリストを使います。従来の設定値は保持し、「選択したCSVのみ」では使用しません。'],
  SortOrder: ['Sort mode', '候補の並び順', 'Priority / count sorts by selected CSV order then count. Match first favors exact/prefix matches. A–Z sorts names within each priority group.', '「CSV優先順／件数順」は選択CSVの順序を優先して件数順に表示。「一致度優先」は完全一致・前方一致を優先。「タグ名A–Z」は優先グループ内で名前順に表示します。'],
  TagSource: ['Tag source (legacy mode)', 'タグの取得元（従来モード）', 'Only affects All / single priority mode. All sources are local files; no Hugging Face download. Selected CSVs only ignores this option.', '「すべて／単一CSV優先」モードだけに適用します。すべてローカルファイルを使用し、Hugging Faceには接続しません。「選択したCSVのみ」では使いません。'],
  TagFile: ['1. Tag file (priority)', '1. 優先するタグCSV（従来モード）', 'In legacy mode, search this file first and other local sources as fallback. All uses all local sources.', '従来モードでこのCSVを優先し、他のローカル辞書を補完に使います。「すべて」は全辞書を対象にします。'],
  TranslationFile: ['2. Translation file', '2. 翻訳CSV（従来モード）', 'Translation file used in legacy mode. All merges local translation files.', '従来モードで使用する翻訳CSVです。「すべて」はローカルの翻訳CSVを統合します。'],
  TagSelectionMode: ['Tag selection mode', 'タグCSVの選択方法', 'Selected CSVs only uses the checked tag files in order. An empty selection gives no suggestions. Legacy mode uses All / single priority.', '「選択したCSVのみ」はチェックしたタグCSVを順番どおり使用。未選択なら候補なし。「従来モード」はすべて／単一CSV優先の設定を使います。'],
  TranslationSelectionMode: ['Translation selection mode', '翻訳CSVの選択方法', 'Select translation files independently of tag files. First selected wins; an empty selection gives no translations.', 'タグCSVとは別に翻訳CSVを選択します。先に選んだCSVが優先され、未選択なら翻訳なしになります。'],
  TagFiles: ['Selected tag CSVs (ordered)', '使用するタグCSV（優先順）', 'Only checked files are used in Selected CSVs only mode. Use ↑/↓ for priority. Select all keeps the current order and appends other available CSVs. Clear selection gives no candidates.', '「選択したCSVのみ」でチェックした辞書だけを使用。↑／↓で優先順を変更します。「すべて選択」は現在の順序を保って残りを末尾に追加。「選択解除」は候補なしにします。'],
  TranslationFiles: ['Selected translation CSVs (ordered)', '使用する翻訳CSV（優先順）', 'Select translations separately; the first selected wins. Select all keeps the order and adds other available files. Clear selection gives no translations.', 'タグとは別に選び、上のCSVの翻訳を優先します。「すべて選択」は現在の順序を保って残りを末尾に追加。「選択解除」は翻訳なしにします。'],
  ReloadDictionaries: ['Reload dictionaries', '辞書を再読み込み', 'Reload local CSV files and clear server/browser search caches. Does not download files or restart ComfyUI.', 'ローカルCSVを再読み込みし、サーバーとブラウザーの検索キャッシュを更新します。ダウンロード・ComfyUI再起動は行いません。'],
  PopupHeight: ['Suggestion popup height (px)', '候補一覧の高さ（px）', 'Default 240 px. Drag the popup edge to resize (120–4096 px); screen space limits the actual height.', '初期値240px。候補一覧の端をドラッグして変更できます（120～4096px）。実際の高さは画面の空き領域に収まります。'],
  PopupTheme: ['Popup color', '候補一覧の色', 'Choose the suggestion popup color.', '候補一覧の配色を選びます。'],
  ShowJapanese: ['Display JP aliases', '日本語の別名を表示', 'Show Japanese translations/aliases below candidates. Does not turn Japanese search on or off.', '候補の下に日本語訳・別名を表示します。日本語で検索するかどうかは別設定です。'],
  ShowSourceType: ['Show TAG / NL / CUSTOM', '辞書の種類を表示（TAG／NL／CUSTOM）', 'Show TAG (tags), NL (natural language), or CUSTOM (custom dictionary).', 'TAG＝タグ、NL＝自然言語、CUSTOM＝独自辞書を候補に表示します。'],
  ShowSourceFile: ['Show source CSV', '出典CSVを表示', 'Show which CSV supplied each candidate.', '候補の読み込み元のCSV名を表示します。'],
  ShowPostCount: ['Show post count', '投稿数を表示', 'Show known post counts. Zero and unknown are displayed separately; natural-language counts are not post counts.', '確認できる投稿数を表示します。0件と不明を区別し、自然言語辞書の件数は投稿数として扱いません。'],
  AutoComma: ['Append comma', '確定時にカンマを追加', 'Add a comma after tag/phrase completion. CSV-aware word/raw modes keep their own insertion rules.', 'タグ・語句の確定後にカンマを追加します。CSV指定のword／rawでは各挿入ルールを優先します。'],
  PreservePromptFormatting: ['Preserve prompt formatting', '既存の改行・空白を保持', 'Keep surrounding lines, indentation and spacing when inserting a candidate.', '候補を挿入するとき、周囲の改行・インデント・空白を保持します。'],
  SpacesForUnderscores: ['Use spaces for underscores', 'アンダースコアを空白にする', 'Insert blue_hair as blue hair, except excluded tags and CSV-aware raw text.', 'blue_hairをblue hairとして挿入します。除外タグとCSV指定のraw文字列は変換しません。'],
  UnderscoreExclusions: ['Underscore exclusions', 'アンダースコア変換の除外', 'Keep underscores in matching tags, e.g. score_*, rating_*, my_tag. Separate with commas or newlines; * matches any text, ? one character. Applies to insertion and Format.', 'score_*, rating_*, my_tagのようにカンマまたは改行で指定します。*は任意の文字列、?は1文字に一致。補完と整形でアンダースコアを保持します。'],
  FormatScope: ['Format target', '整形する対象', 'All: recognized prompt inputs. Selected: prompt inputs of selected nodes. Current: last focused input or selected text. Notes/code are excluded from batch formatting.', '「すべて」は認識できるプロンプト欄、「選択ノード」は選択したノードのプロンプト欄、「現在」は最後に入力した欄または選択文字列を整形。一括整形ではメモ・コードを除外します。'],
  FormatAppendComma: ['Append comma on newline', '改行の前にカンマを追加', 'Add a comma before a following nonempty line, but not at the end of the final line.', '次に文章のある行が続く場合、前の行末にカンマを追加します。最後の行には付けません。'],
  FormatUnderscores: ['Replace underscores', '整形時にアンダースコアを空白へ変換', 'Change blue_hair to blue hair. Preserve special syntax, score_* and configured exclusions.', 'blue_hairをblue hairに変換します。特殊構文・score_*・設定した除外パターンは保持します。'],
  FormatDuplicates: ['Remove duplicate plain tags', '同じ行の通常タグの重複を削除', 'Remove repeated plain tags on the same line. Preserve weighted/special tags and repetitions on different lines.', '同じ行の通常タグだけ重複を削除します。重み付き・特殊タグや別の行の繰り返しは保持します。'],
  FormatNow: ['Format', '整形', 'Clean up commas and spacing using the configured target and options. Also available on the toolbar or Alt+Shift+F in a prompt input. Undo is per input.', '設定した対象のカンマ・空白を整えます。上部の整形ボタン、または入力欄でAlt＋Shift＋Fでも実行できます。Undoは入力欄ごとです。'],
};

const options = {
  'Existing': '従来のタグ挿入', 'CSV-aware': 'CSVごとの挿入方法',
  'Tag (comma separated)': 'タグ（カンマ区切り）', 'Word (after spaces)': '単語（スペースの後も検索）',
  'Hugging Face': '保存済みのdanbooru_tags.csv', 'Own tag file': 'その他のローカルCSV', 'Both': '両方のローカルCSV',
  'All': 'すべて', 'All / single priority': '従来モード：すべて／単一CSV優先',
  'All / single file': '従来モード：すべて／単一CSV', 'Selected CSVs only': '選択したCSVのみ',
  'Match first': '一致度優先', 'Priority / count': 'CSV優先順／件数順', 'Tag A-Z': 'タグ名A–Z',
  'Gray': 'グレー', 'Blue': 'ブルー', 'Cyan': 'シアン', 'Purple': 'パープル', 'Amber': 'アンバー',
  'Current input / selection': '現在の入力欄／選択文字列', 'Selected nodes': '選択したノード',
  'All recognized prompt inputs': '認識できるすべてのプロンプト欄',
};
const groups = {Autocomplete: '補完', Display: '表示', Files: 'CSVファイル', Insert: '挿入', Formatting: '整形'};
const states = new WeakMap();

export function isJapanese(app) {
  const locale = app.ui?.settings?.getSettingValue?.('Comfy.Locale')
    ?? app.extensionManager?.setting?.get?.('Comfy.Locale') ?? globalThis.document?.documentElement?.lang ?? 'en';
  return /^ja(?:[-_]|$)/i.test(locale);
}

export function uiText(app, en, ja) { return isJapanese(app) ? ja : en; }

function stateFor(app) {
  if (states.has(app)) return states.get(app);
  const state = {definitions: new Map(), registered: new Map(), listeners: new Set(), japanese: isJapanese(app)};
  states.set(app, state);
  const refresh = () => {
    const japanese = isJapanese(app);
    if (japanese === state.japanese) return;
    state.japanese = japanese;
    for (const [id, definition] of state.definitions) {
      const localized = translate(app, definition);
      // ComfyUI exposes its reactive settings registry through this public getter.
      const registered = app.ui.settings.settingsLookup?.[id] ?? state.registered.get(id);
      Object.assign(registered, localized);
    }
    for (const listener of state.listeners) listener();
  };
  app.ui?.settings?.addEventListener?.('Comfy.Locale.change', refresh);
  if (globalThis.document?.documentElement && globalThis.MutationObserver) {
    new MutationObserver(refresh).observe(document.documentElement, {attributes: true, attributeFilter: ['lang']});
  }
  return state;
}

function translate(app, definition) {
  const key = definition.id.replace('DanbooruTagJPAssist.', '');
  const entry = entries[key];
  if (!entry) throw new Error(`Missing JP Assist setting help: ${key}`);
  const japanese = isJapanese(app);
  const category = [...definition.category];
  if (japanese) category[1] = groups[category[1]] ?? category[1];
  const name = entry[japanese ? 1 : 0];
  category[2] = name;
  const result = {...definition, name, category, tooltip: entry[japanese ? 3 : 2]};
  if (Array.isArray(definition.options)) result.options = definition.options.map(option => ({...option,
    text: japanese ? options[option.text] ?? option.text : option.text === 'Hugging Face' ? 'Saved danbooru_tags.csv' : option.text === 'Both' ? 'Both local sources' : option.text === 'Own tag file' ? 'Other local CSVs' : option.text}));
  return result;
}

export function addLocalizedSetting(app, definition) {
  const state = stateFor(app);
  // Retain the original English definition for switching back without value changes.
  state.definitions.set(definition.id, {...definition});
  const localized = translate(app, definition);
  state.registered.set(definition.id, localized);
  app.ui.settings.addSetting(localized);
}

export function localizedDefinition(app, id) { return translate(app, stateFor(app).definitions.get(id)); }

export function onLocaleChange(app, listener) { stateFor(app).listeners.add(listener); }
