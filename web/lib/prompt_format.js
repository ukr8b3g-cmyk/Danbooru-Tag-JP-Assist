import { underscoreProtected } from './completion_core.js';

const keywords = /^(?:AND|BREAK|ADDROW|ADDCOL)$/;
const special = /[\\()[\]{}<>:"|]|(?:^|\s)@|__|embedding:/i;
const protectedTag = tag => special.test(tag) || tag.includes("'") || keywords.test(tag);

// Only commas outside syntax groups and quoted/escaped text are separators.
function chunks(line) {
  const parts = [];
  const stack = [];
  let quote = '', start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || (c === "'" && !/[\p{L}\p{N}]/u.test(line[i - 1] ?? ''))) { quote = c; continue; }
    // These Danbooru face tags are literal text, not angle brackets.
    if (line.slice(i, i + 3) === '> <') { i += 2; continue; }
    if ('([{<'.includes(c)) stack.push(c);
    else if (')]}>' .includes(c)) {
      if (stack.pop() !== '([{<'[')]}>'.indexOf(c)]) return null;
    } else if (c === ',' && !stack.length && !(/\d/.test(line[i - 1] ?? '') && /\d/.test(line[i + 1] ?? ''))) {
      parts.push(line.slice(start, i)); start = i + 1;
    }
  }
  if (stack.length || quote) return null;
  parts.push(line.slice(start));
  return parts;
}

export function formatPrompt(text, options = {}) {
  // Structured payloads and incomplete syntax are left intact.
  if (/^\s*```/.test(text)) return text;
  try { const value = JSON.parse(text); if (value && typeof value === 'object') return text; } catch {}
  const lines = text.split(/(\r\n|\n|\r)/);
  const parsed = lines.map((line, i) => i % 2 ? null : chunks(line));
  if (parsed.some((parts, i) => i % 2 === 0 && parts === null)) return text;
  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.match(/^[\t ]*/)[0];
    const seen = new Set();
    const tags = [];
    for (const part of parsed[i]) {
      let tag = part.trim();
      if (!tag) continue;
      if (!protectedTag(tag)) {
        tag = tag.replace(/[\t ]+/g, ' ');
        if (options.underscores && !underscoreProtected(tag, `score_*,${options.exclusions ?? ''}`)) tag = tag.replaceAll('_', ' ');
        if (options.duplicates && seen.has(tag)) continue;
        seen.add(tag);
      }
      tags.push(tag);
    }
    let result = tags.join(', ');
    const laterText = lines.slice(i + 2).some((s, j) => j % 2 === 0 && s.trim());
    const append = options.appendComma && laterText && !keywords.test(result) && !/[.!?]$/.test(result) && !/^<.*>$/.test(result);
    if (result && (/,\s*$/.test(line) || append)) result += ',';
    lines[i] = indent + result;
  }
  return lines.join('');
}

export function formatSelection(text, start, end, options = {}) {
  let offset = 0;
  // A partial selection inside a syntax token must not bypass its protection.
  for (const line of text.split(/(\r\n|\n|\r)/)) {
    const parts = chunks(line);
    if (parts === null) return text;
    let position = offset;
    for (const part of parts) {
      const tokenStart = position + part.length - part.trimStart().length;
      const tokenEnd = position + part.trimEnd().length;
      if (protectedTag(part.trim()) && start < tokenEnd && end > tokenStart
          && (start > tokenStart || end < tokenEnd)) return text;
      position += part.length + 1;
    }
    offset += line.length;
  }
  return text.slice(0, start) + formatPrompt(text.slice(start, end), options) + text.slice(end);
}

export function replacementEdit(before, after) {
  let start = 0, end = before.length, tail = after.length;
  while (start < end && start < tail && before[start] === after[start]) start++;
  while (end > start && tail > start && before[end - 1] === after[tail - 1]) { end--; tail--; }
  return { start, end, replacement: after.slice(start, tail),
    map: position => position <= start ? position : position >= end ? position + tail - end : Math.min(tail, start + position - start) };
}
