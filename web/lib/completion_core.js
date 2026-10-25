export function normalizeSearch(value) {
  return String(value ?? "").toLowerCase().replaceAll("_", " ").trim();
}

export function inputContext(value, selectionStart, selectionEnd = selectionStart, unit = 'tag') {
  const end = selectionStart ?? value.length;
  const before = value.slice(0, end);
  const start = Math.max(before.lastIndexOf(","), before.lastIndexOf("\n"), before.lastIndexOf("\r")) + 1;
  const raw = before.slice(start);
  const leading = raw.match(/^[ \t]*/)?.[0].length ?? 0;
  const trailing = raw.match(/[ \t]*$/)?.[0].length ?? 0;
  const tail = raw.match(/[^\s,]+$/)?.[0] ?? "";
  const right = value.slice(end);
  const wordEnd = end + (right.match(/^[^\s,]*/)?.[0].length ?? 0);
  const segmentRight = right.match(/^[^,\r\n]*/)?.[0] ?? "";
  const context = {
    start, end, replaceStart: start + leading,
    replaceEnd: Math.max(start + leading, end - trailing),
    segmentEnd: end + segmentRight.replace(/[ \t]+$/, "").length,
    wordStart: end - tail.length, wordEnd, tail, text: raw.trim(),
    value, selectionStart: end, selectionEnd: selectionEnd ?? end, unit,
  };
  if (unit === 'word') {
    const range = currentWordRange(context);
    context.replaceStart = range.start;
    context.replaceEnd = range.end;
    context.text = context.tail = value.slice(range.start, end);
  }
  return context;
}

export function snapshotMatches(context, value, start, end) {
  return context?.value === value && context.selectionStart === start && context.selectionEnd === end;
}

export function underscoreProtected(text, patterns = "") {
  if (text.startsWith("__") && text.endsWith("__") && text.length >= 4) return true;
  return String(patterns).split(/[,\r\n]+/).map(x => x.trim()).filter(Boolean).some(pattern => {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
    return new RegExp(`^${escaped}$`, "iu").test(text);
  });
}

function replaceUnderscores(text, patterns, protectWildcards) {
  return text.split(/(,[ \t]*)/).map(part => {
    if (!part || part.startsWith(",")) return part;
    if ((protectWildcards || patterns) && underscoreProtected(part, patterns)) return part;
    return part.replaceAll("_", " ");
  }).join("");
}

const wordPattern = /[\p{L}\p{M}\p{N}_]+(?:['’\-\u2010\u2011][\p{L}\p{M}\p{N}_]+)*/gu;

function currentWordRange(context) {
  const position = context.end - context.replaceStart;
  const current = [...context.value.slice(context.replaceStart, context.segmentEnd).matchAll(wordPattern)]
    .find(word => word.index < position && position <= word.index + word[0].length);
  return current
    ? {start: context.replaceStart + current.index, end: context.replaceStart + current.index + current[0].length}
    : {start: context.end, end: context.end};
}

function naturalRange(context, selected, wordMode = false) {
  const segment = context.value.slice(context.replaceStart, context.end);
  // Unicode letters/marks/numbers form words; internal hyphens and apostrophes
  // stay inside them. Punctuation and emoji remain outside the replacement.
  let start = context.wordStart, end = context.wordEnd;
  if (wordMode) {
    ({start, end} = currentWordRange(context));
  }
  const words = [...segment.matchAll(/\S+/gu)];
  if (wordMode) {
    // A literal symbol may belong to the selected candidate itself.
    words.push(...segment.matchAll(wordPattern));
    words.sort((a, b) => a.index - b.index);
  }
  for (const word of words) {
    const suffix = normalizeSearch(segment.slice(word.index));
    if (suffix && normalizeSearch(selected).startsWith(suffix)) {
      return {start: context.replaceStart + word.index, end};
    }
  }
  return {start, end};
}

export function insertionEdit(context, item, options = {}) {
  const csv = options.behavior === "csv";
  const meta = item.meta ?? {};
  const mode = csv ? (meta.insert_mode ?? "tag") : "tag";
  let inserted = csv ? (meta.insert_text ?? item.tag) : item.tag;
  if (mode !== "raw" && options.spacesForUnderscores) {
    inserted = replaceUnderscores(inserted, options.exclusions ?? "", csv);
  }
  let start = context.replaceStart;
  let end = context.replaceEnd;
  if (csv && context.unit !== 'word') {
    if (meta.source_type === "natural_language" || mode === "word") {
      ({start, end} = naturalRange(context, item.tag, mode === "word"));
    } else {
      end = Math.max(end, context.segmentEnd);
    }
  }
  const value = context.value;
  const after = value.slice(end);
  let replacement = inserted;
  if (!csv && options.preserveFormatting === false && context.unit !== 'word') {
    start = context.start;
    end = context.end + (value.slice(context.end).match(/^\s*/)?.[0].length ?? 0);
    const before = value.slice(0, start);
    replacement = (before && !/[,\n]\s*$/.test(before) ? ", " : "") + inserted + (options.autoComma ? ", " : " ");
  } else if (mode === "word") {
    if (!after || !/^[\s\p{P}\p{S}]/u.test(after)) replacement += " ";
  } else if (mode !== "raw" && options.autoComma && !/^[ \t]*,/.test(after)) {
    replacement += !after || !/^[\r\n \t]/.test(after) ? ", " : ",";
  }
  return {start, end, replacement, value: value.slice(0, start) + replacement + value.slice(end), caret: start + replacement.length};
}
