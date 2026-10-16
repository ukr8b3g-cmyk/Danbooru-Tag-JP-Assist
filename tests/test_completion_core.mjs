import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inputContext, insertionEdit, snapshotMatches, underscoreProtected} from '../web/lib/completion_core.js';

const options = {behavior: 'csv', autoComma: true, spacesForUnderscores: true, preserveFormatting: true};
const nl = tag => ({tag, meta: {source_type: 'natural_language', insert_mode: 'word', insert_text: tag}});
const edit = (text, item, opts = options, pos = text.length) => insertionEdit(inputContext(text, pos, pos), item, opts);

test('word insertion preserves the preceding sentence', () => assert.equal(edit('a girl with blu', nl('blue')).value, 'a girl with blue '));
test('longest matching phrase suffix, without duplicate words', () => assert.equal(edit('a girl with soft nat', nl('soft natural lighting')).value, 'a girl with soft natural lighting '));
test('alias replacement changes only the tail', () => assert.equal(edit('a girl with 長髪', nl('long hair')).value, 'a girl with long hair '));
test('mid-word completion replaces the unfinished word, not the next word', () => assert.equal(edit('a bluish sky', nl('blue'), options, 5).value, 'a blue sky'));
test('word mode supports multi-word insertion and keeps punctuation', () => assert.equal(edit('soft, next', nl('soft natural lighting'), options, 4).value, 'soft natural lighting, next'));
test('tag mode preserves layout outside its range', () => assert.equal(edit('head,\n\n  blu  \nnext', {tag:'blue_hair'}, options, 12).value, 'head,\n\n  blue hair,  \nnext'));
test('raw keeps CSV text and adds no separator', () => assert.equal(edit('a', {tag:'snippet',meta:{insert_mode:'raw',insert_text:'  A_B,$1\n  '}}).value, '  A_B,$1\n  '));
test('explicit phrase stays comma separated', () => assert.equal(edit('foo', {tag:'foo, bar',meta:{insert_mode:'phrase'}}).value, 'foo, bar, '));
test('score exclusion applies per comma-delimited component', () => assert.equal(edit('s', {tag:'score_9, long_hair'}, {...options,exclusions:'score_*'}).value, 'score_9, long hair, '));
test('wildcard syntax is preserved, not executed', () => assert.equal(edit('x',{tag:'__wildcards/eye_color__'}).value, '__wildcards/eye_color__, '));
test('glob metacharacters are literals except star and question', () => {assert.equal(underscoreProtected('score_9','score_*'), true); assert.equal(underscoreProtected('x[1]','x[1]'),true);assert.equal(underscoreProtected('x1','x[1]'),false);});
test('legacy mode ignores CSV insertion modes', () => assert.equal(edit('blu', nl('blue'),{...options,behavior:'existing'}).value, 'blue, '));
test('legacy non-format-preserving path is maintained', () => assert.equal(edit('foo\n  blu  next',{tag:'blue_hair'},{...options,behavior:'existing',preserveFormatting:false},10).value,'foo\nblue hair, next'));
test('zero and nonzero selection changes invalidate snapshots', () => {const c=inputContext('blu',3); assert.ok(snapshotMatches(c,'blu',3,3));assert.ok(!snapshotMatches(c,'blu',1,1));assert.ok(!snapshotMatches(c,'blx',3,3));});
test('emoji offsets use original UTF-16 positions', () => assert.equal(edit('😀 a blu',nl('blue')).value,'😀 a blue '));
