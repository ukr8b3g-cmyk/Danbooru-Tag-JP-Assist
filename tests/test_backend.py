import asyncio
import csv
import io
import threading
import time
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
routes = types.SimpleNamespace(get=lambda path: lambda fn: fn, post=lambda path: lambda fn: fn)
sys.modules['server'] = types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes)))
spec = importlib.util.spec_from_file_location('jp_assist_under_test', ROOT / '__init__.py')
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


class Dictionaries(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        backend.DATA_DIR = str(self.root)
        backend.TAG_FILES_DIR = str(self.root / 'tag_files')
        backend.TRANSLATION_FILES_DIR = str(self.root / 'translation_files')
        Path(backend.TAG_FILES_DIR).mkdir()
        Path(backend.TRANSLATION_FILES_DIR).mkdir()
        backend._clear_tag_cache()

    def tearDown(self):
        self.temp.cleanup()

    def tags(self, name, text):
        path = Path(backend.TAG_FILES_DIR) / name
        path.write_text(text, encoding='utf-8-sig', newline='')
        return path

    def test_usage_ranks_before_limit_and_preserves_csv_priority(self):
        self.tags('a.csv', ''.join(f'blue_{i:04d},0,{1000-i},青髪\n' for i in range(600)))
        self.tags('b.csv', 'blue_other,0,999999,青髪\n')
        options = dict(tag_files=['a.csv', 'b.csv'], translation_files=[], sort_order='count')
        rows = backend._read_tag_rows(tag_files=options['tag_files'], translation_files=[])
        target = next(row for row in rows if row['tag'] == 'blue_0599')
        other = next(row for row in rows if row['tag'] == 'blue_other')
        usage = {backend._usage_key(target): 3, backend._usage_key(other): 100}
        for query in ['blue', '青髪']:
            hits = backend._search_tag_rows(query, limit=1, usage=usage, **options)
            self.assertEqual(hits[0]['tag'], target['tag'])
        self.assertEqual(backend._search_tag_rows('blue', limit=1, **options)[0]['tag'], 'blue_0000')
        self.assertEqual(backend._search_tag_rows('blue', limit=1, usage={}, **options)[0]['tag'], 'blue_0000')
        self.assertEqual(backend._search_tag_rows('blue', tag_files=[], usage=usage), [])

    def test_index_matches_exhaustive_search_for_aliases_ties_phrases_and_usage(self):
        self.tags('a.csv', 'tag,category,count,aliases,source_type,insert_mode\n' + ''.join(
            f'{"Blue" if i % 2 else "blue"}_{i},0,{i % 4},"髪,azure_{i}",{ "natural_language" if i % 5 == 0 else "tag"},word\n'
            for i in range(80)))
        self.tags('b.csv', 'tag,category,count,aliases\nblue_extra,0,999,髪\nxblue,0,0,azure\n')
        for files in [['a.csv', 'b.csv'], ['b.csv', 'a.csv']]:
            _, index, _ = backend._load_cached_tag_data(tag_files=files, translation_files=[])
            usage = {backend._usage_key(index[-1][0]): 7, backend._usage_key(index[9][0]): 4}
            for query, tail in [('blue', 'blue 1'), ('azure', ''), ('髪', ''), ('1', ''), ('missing', '')]:
                for mode in ['count', 'match', 'az']:
                    for japanese in [False, True]:
                        for history in [None, usage]:
                            expected = []
                            for row, tag, aliases, count, priority in index:
                                needle = backend._normalize(tail if tail and (row['meta']['source_type'] == 'natural_language' or row['meta']['insert_mode'] == 'word') else query)
                                texts = (tag, *aliases) if japanese else (tag,)
                                scores = [0 if text == needle else 1 if text.startswith(needle) else 2 for text in texts if needle in text]
                                if not scores: continue
                                score = min(scores); name = row['tag'].casefold()
                                key = (priority, -count, score, name) if mode == 'count' else (priority, name, score, -count) if mode == 'az' else (priority, score, -count, name)
                                if history: key = (priority, -history.get(backend._usage_key(row), 0), *key[1:])
                                expected.append((key, row))
                            expected.sort(key=lambda pair: pair[0])
                            for limit in [1, 7, 500]:
                                with self.subTest(files=files, query=query, mode=mode, jp=japanese, usage=bool(history), limit=limit):
                                    actual = backend._search_tag_rows(query, tail=tail, behavior='csv', tag_files=files,
                                        translation_files=[], sort_order=mode, search_jp=japanese, usage=history, limit=limit)
                                    self.assertEqual(actual, [row for _, row in expected[:limit]])

    def test_usage_identity_does_not_leak_between_csvs_and_ties_use_sort_mode(self):
        self.tags('a.csv', 'blue,0,2,\nblue_other,0,50,\n')
        self.tags('b.csv', 'blue,0,2,\nblue_other,0,50,\n')
        a = backend._read_tag_rows(tag_files=['a.csv'], translation_files=[])[0]
        usage = {backend._usage_key(a): 1}
        self.assertEqual(backend._search_tag_rows('blue', tag_files=['a.csv'], sort_order='count', usage=usage)[0]['tag'], 'blue')
        self.assertEqual(backend._search_tag_rows('blue', tag_files=['b.csv'], sort_order='count', usage=usage)[0]['tag'], 'blue_other')
        for mode in ['match', 'count', 'az']:
            expected = backend._search_tag_rows('blue', tag_files=['a.csv'], sort_order=mode)
            equal = {backend._usage_key(row): 4 for row in expected}
            self.assertEqual(backend._search_tag_rows('blue', tag_files=['a.csv'], sort_order=mode, usage=equal), expected)

    def test_personalized_route_validates_body_and_does_not_pollute_normal_search(self):
        self.tags('a.csv', 'blue_top,0,999,\nblue_low,0,1,\n')
        row = backend._read_tag_rows(tag_files=['a.csv'], translation_files=[])[1]
        async def call(payload):
            async def body(): return payload
            return await backend.search_with_usage(types.SimpleNamespace(
                query={'q': 'blue', 'tag_files': '["a.csv"]', 'limit': '1', 'sort': 'count'}, json=body))
        key = json.dumps(list(backend._usage_key(row)), ensure_ascii=False, separators=(',', ':'))
        response = asyncio.run(call({'usage': [[key, 2]]}))
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(response.text)['tags'][0]['tag'], 'blue_low')
        self.assertEqual(backend._search_tag_rows('blue', tag_files=['a.csv'], sort_order='count', limit=1)[0]['tag'], 'blue_top')
        for invalid in [None, {}, {'usage': {}}, {'usage': [[key, True]]}, {'usage': [[key, -1]]},
                        {'usage': [['not-json', 1]]}, {'usage': [[key, 1]] * 2001}]:
            self.assertEqual(asyncio.run(call(invalid)).status, 400)

    def test_headerless_first_record_and_alias_column(self):
        rows = backend._read_tag_csv(self.tags('e621.csv', 'mammal,5,100,"mammals,ungulate"\nanthro,0,0,word\n'))
        self.assertEqual([r['tag'] for r in rows], ['mammal', 'anthro'])
        self.assertEqual([r['aliases'] for r in rows], ['mammals,ungulate', 'word'])
        self.assertEqual(rows[1]['meta']['insert_mode'], 'tag')
        self.assertEqual(rows[1]['meta']['post_count'], 0)

    def test_empty_normalized_search_keeps_result_contract(self):
        for query in ['', ' ', '\u3000', '_', '__', '___', ' _ ']:
            with self.subTest(query=query):
                self.assertEqual(backend._search_tag_rows(query), [])
                self.assertEqual(backend._search_tag_rows(query, _with_errors=True), ([], ()))

    def test_normalized_empty_api_search_differs_from_full_list_request(self):
        self.tags('fixture.csv', 'tag,count\nblue,1\n')
        for handler in [backend.get_danbooru_tag_jp_assist_tags, backend.get_legacy_jp_tag_autocomplete_tags]:
            for query in ['', ' ', '\u3000', '_', '__', '___', ' _ ']:
                with self.subTest(handler=handler.__name__, query=query):
                    response = asyncio.run(handler(types.SimpleNamespace(query={'q': query})))
                    self.assertEqual(response.status, 200)
                    payload = json.loads(response.body)
                    self.assertEqual([row['tag'] for row in payload['tags']], ['blue'] if query == '' else [])
                    self.assertEqual(payload['errors'], [])

    def test_raw_csv_cell_is_not_trimmed(self):
        rows = backend._read_tag_csv(self.tags('x.csv', 'tag,insert_mode,source_type\n"  A_B,\nC  ",raw,custom\n'))
        self.assertEqual(rows[0]['meta']['insert_text'], '  A_B,\nC  ')

    def test_natural_defaults_and_count_not_posts(self):
        row = backend._read_tag_csv(self.tags('natural_language_tags.csv', 'tag,category,count\nsoft natural lighting,0,90000\n'))[0]
        self.assertEqual(row['meta']['insert_mode'], 'word')
        self.assertIsNone(row['meta']['post_count'])

    def test_unknown_origin_is_not_danbooru(self):
        row = backend._read_tag_csv(self.tags('my.csv', 'tag,count,category\nfoo,0,1\n'))[0]
        self.assertEqual(row['meta']['category_scheme'], 'unknown')
        self.assertIsNone(row['meta']['post_count'])

    def test_missing_count_and_valid_zero(self):
        rows = backend._read_tag_csv(self.tags('danbooru_2025.csv', 'tag,count\na,\nb,0\nc,-1\nd,nan\n'))
        self.assertEqual([r['meta']['post_count'] for r in rows], [None, 0, None, None])

    def test_nonfinite_counts_do_not_stop_search(self):
        params = {'tag_files': '["danbooru_tags.csv"]', 'translation_files': '[]'}
        for value in ['Infinity', '-Infinity', '1e309', '-1e309', 'NaN', float('inf'), float('-inf')]:
            with self.subTest(count=value):
                self.assertEqual(backend._count_value({'count': value}), 0)
                self.tags('danbooru_tags.csv', f'tag,count\nsafe_tag,100\nbad_tag,{value}\n')
                backend._clear_tag_cache()
                data = backend._tag_response({**params, 'q': 'safe'})
                self.assertEqual([row['tag'] for row in data['tags']], ['safe_tag'])
                rows = backend._tag_response({**params, 'q': 'tag'})['tags']
                self.assertEqual([row['tag'] for row in rows], ['safe_tag', 'bad_tag'])
                self.assertIsNone(rows[1]['meta']['post_count'])

    def test_tag_csv_alias_search_with_and_without_headers(self):
        for header in [False, True]:
            with self.subTest(header=header):
                name = 'header.csv' if header else 'headerless.csv'
                text = ('tag,category,count,aliases\n' if header else '')
                self.tags(name, text + 'long_hair,0,100,"髪が長い,flowing locks;long locks"\n')
                params = {'tag_files': json.dumps([name]), 'translation_files': '[]'}
                for alias in ['髪が長い', 'flowing locks', 'long locks']:
                    rows = backend._tag_response({**params, 'q': alias})['tags']
                    self.assertEqual([row['tag'] for row in rows], ['long_hair'])
                    self.assertEqual(rows[0]['ja'], '')
                    self.assertEqual(backend._tag_response({**params, 'q': alias, 'search_jp': '0'})['tags'], [])
                self.assertEqual(backend._tag_response({**params, 'q': 'long', 'search_jp': '0'})['tags'][0]['tag'], 'long_hair')

    def test_tag_aliases_survive_translation_merge_and_csv_priority(self):
        self.tags('a.csv', 'tag,count,aliases\nlong_hair,100,髪が長い\n')
        self.tags('b.csv', 'tag,count,aliases\nlong_hair,200,長い毛髪\n')
        folder = Path(backend.TRANSLATION_FILES_DIR)
        (folder / 'ja.csv').write_text('tag,ja,aliases\nlong_hair,長髪,\n', encoding='utf-8')
        (folder / 'extra.csv').write_text('tag,ja,aliases\nlong_hair,ロングヘア,流れる髪\n', encoding='utf-8')
        options = {'tag_files': ['a.csv', 'b.csv'], 'translation_files': ['ja.csv', 'extra.csv']}
        self.assertEqual(backend._search_tag_rows('髪が長い', **options)[0]['ja'], '長髪')
        self.assertEqual(backend._search_tag_rows('長い毛髪', **options), [])
        self.assertEqual(backend._search_tag_rows('流れる髪', **options), [])
        options['translation_files'].reverse()
        for alias in ['髪が長い', '流れる髪']:
            self.assertEqual(backend._search_tag_rows(alias, **options)[0]['ja'], 'ロングヘア')
        options['tag_files'].reverse()
        self.assertEqual(backend._search_tag_rows('髪が長い', **options), [])
        for alias in ['長い毛髪', '流れる髪']:
            self.assertEqual(backend._search_tag_rows(alias, **options)[0]['meta']['source_file'], 'b.csv')

    def test_priority_winner_keeps_own_metadata(self):
        self.tags('a.csv', 'tag,count,category_scheme\nblue_hair,2,e621\n')
        self.tags('danbooru_tags.csv', 'tag,count,category_scheme\nblue_hair,999,danbooru\n')
        row = backend._search_tag_rows('blue', tag_file='a.csv')[0]
        self.assertEqual((row['count'], row['meta']['source_file'], row['meta']['category_scheme']), ('2', 'a.csv', 'e621'))
        self.assertEqual(backend._search_tag_rows('blue')[0]['count'], '999')

    def test_legacy_sort_orders(self):
        self.tags('a.csv', 'tag,count\nblue_hair,5\nblue_eyes,9\nxblue,20\n')
        self.assertEqual([r['tag'] for r in backend._search_tag_rows('blue')], ['blue_eyes', 'blue_hair', 'xblue'])
        self.assertEqual(backend._search_tag_rows('blue', sort_order='count')[0]['tag'], 'xblue')
        self.assertEqual(backend._search_tag_rows('blue', sort_order='az')[0]['tag'], 'blue_eyes')

    def test_japanese_search_can_be_disabled_without_removing_display(self):
        self.tags('a.csv', 'tag,count\nlong_hair,1\n')
        (Path(backend.TRANSLATION_FILES_DIR) / 'ja.csv').write_text('tag,ja,aliases\nlong_hair,長髪,髪が長い\n', encoding='utf-8')
        self.assertEqual(backend._search_tag_rows('長髪')[0]['ja'], '長髪')
        self.assertEqual(backend._search_tag_rows('長髪', search_jp=False), [])
        self.assertEqual(backend._search_tag_rows('long', search_jp=False)[0]['ja'], '長髪')

    def test_csv_natural_tail_search_only_when_enabled(self):
        self.tags('natural_language_tags.csv', 'tag,count\nblue,900\nsoft natural lighting,800\n')
        self.assertEqual(backend._search_tag_rows('a girl with blu', tail='blu'), [])
        self.assertEqual(backend._search_tag_rows('a girl with blu', behavior='csv', tail='blu')[0]['tag'], 'blue')
        self.assertEqual(backend._search_tag_rows('a girl with soft nat', behavior='csv', tail='nat')[0]['tag'], 'soft natural lighting')

    def test_malformed_file_does_not_publish_partial_rows(self):
        self.tags('good.csv', 'tag,count\ngood,2\n')
        self.tags('broken.csv', 'tag,count\npartial,1\n"unterminated,2\n')
        rows = backend._read_tag_rows()
        self.assertEqual([r['tag'] for r in rows], ['good'])
        self.assertIsNone(backend._TAG_CACHE_KEY)
        self.assertIn('broken.csv', backend._TAG_CACHE_ERRORS)
        self.tags('broken.csv', 'tag,count\nrepaired,3\n')
        self.assertIn('repaired', [r['tag'] for r in backend._read_tag_rows()])

    def test_file_change_invalidates_cache_and_revision(self):
        self.tags('a.csv', 'tag,count\nalpha,1\n')
        before = backend._tag_response({'q': 'a'})
        self.tags('a.csv', 'tag,count\nalpine,1000\n')
        after = backend._tag_response({'q': 'a'})
        self.assertNotEqual(before['revision'], after['revision'])
        self.assertEqual(after['tags'][0]['tag'], 'alpine')

    def test_api_and_legacy_route_contract(self):
        self.tags('a.csv', 'tag,count\nalpha,1\n')
        request = types.SimpleNamespace(query={'q': 'a', 'search_jp': '0'})
        result = asyncio.run(backend.get_legacy_jp_tag_autocomplete_tags(request))
        data = json.loads(result.body)
        self.assertEqual(data['tags'][0]['tag'], 'alpha')
        self.assertIn('revision', data)
        self.assertEqual(backend.DanbooruTagJPAssist().run('  a\n b  '), ('  a\n b  ',))

    def test_result_limit(self):
        self.tags('a.csv', 'tag,count\n' + ''.join(f'a{i},{i}\n' for i in range(600)))
        self.assertEqual(len(backend._search_tag_rows('a', limit=1000)), 500)

    def test_invalid_utf8_isolated(self):
        self.tags('a.csv', 'tag,count\na,1\n')
        (Path(backend.TAG_FILES_DIR) / 'bad.csv').write_bytes(b'\xff\xfe\xfa')
        self.assertEqual([r['tag'] for r in backend._read_tag_rows()], ['a'])

    def test_selected_tags_only_ignore_legacy_source_and_no_fallback(self):
        self.tags('a.csv', 'tag,count\nalpha,1\n')
        self.tags('b.csv', 'tag,count\nbeta,99\n')
        self.tags('danbooru_tags.csv', 'tag,count\nhf_tag,999\n')
        (self.root / 'legacy.csv').write_text('tag,count\nlegacy_tag,100\n', encoding='utf-8')
        rows = backend._read_tag_rows(source='hf', tag_file='b.csv', tag_files=['a.csv'])
        self.assertEqual([row['tag'] for row in rows], ['alpha'])
        self.assertEqual(backend._read_tag_rows(tag_files=[]), [])
        self.assertEqual(backend._read_tag_rows(tag_files=['removed.csv']), [])

    def test_selected_tag_order_controls_ranking_and_complete_winner(self):
        self.tags('a.csv', 'tag,count,category_scheme,insert_mode\nshared,1,e621,word\nshared_first,1,e621,word\n')
        self.tags('b.csv', 'tag,count,category_scheme,insert_mode\nshared,999,danbooru,tag\nshared_second,999,danbooru,tag\n')
        for sort in ['match', 'count', 'az']:
            rows = backend._search_tag_rows('shared', sort_order=sort, tag_files=['a.csv', 'b.csv'])
            self.assertEqual([row['tag'] for row in rows], ['shared', 'shared_first', 'shared_second'])
            self.assertEqual((rows[0]['count'], rows[0]['meta']['category_scheme'], rows[0]['meta']['insert_mode']), ('1', 'e621', 'word'))
        reversed_rows = backend._search_tag_rows('shared', tag_files=['b.csv', 'a.csv'])
        self.assertEqual(reversed_rows[0]['count'], '999')
        self.assertEqual([row['meta']['source_file'] for row in reversed_rows], ['b.csv', 'b.csv', 'a.csv'])

    def test_translation_selection_is_independent_ordered_and_exclusive(self):
        self.tags('a.csv', 'tag,count\nblue,1\ngreen,2\n')
        folder = Path(backend.TRANSLATION_FILES_DIR)
        (folder / 'a.csv').write_text('tag,ja,aliases\nblue,青,蒼\n', encoding='utf-8')
        (folder / 'b.csv').write_text('tag,ja,aliases\nblue,ブルー,藍\ngreen,緑,翠\n', encoding='utf-8')
        options = {'tag_files': ['a.csv'], 'translation_files': ['a.csv', 'b.csv']}
        row = backend._search_tag_rows('blue', **options)[0]
        self.assertEqual((row['ja'], row['aliases']), ('青', '蒼'))
        self.assertEqual(backend._search_tag_rows('藍', **options), [])
        options['translation_files'].reverse()
        self.assertEqual(backend._search_tag_rows('藍', **options)[0]['ja'], 'ブルー')
        self.assertEqual(backend._search_tag_rows('green', translation_files=[])[0]['ja'], '')
        self.assertEqual(backend._search_tag_rows('緑', translation_files=['a.csv']), [])
        self.assertEqual(backend._search_tag_rows('green', translation_file='b.csv', translation_files=['a.csv'])[0]['ja'], '')

    def test_selected_api_rejects_malformed_or_unlisted_names_without_all(self):
        self.tags('a.csv', 'tag,count\nalpha,1\n')
        for names in ['[]', 'null', '{}', 'broken', '["../outside.csv"]', '["missing.csv"]', '[null,{}]']:
            self.assertEqual(backend._tag_response({'q': 'a', 'tag_files': names})['tags'], [])
        data = backend._tag_response({'q': 'a', 'tag_files': '["a.csv","a.csv"]', 'translation_files': '[]'})
        self.assertEqual([row['tag'] for row in data['tags']], ['alpha'])

    def test_selected_cache_and_revision_follow_both_orders_and_reload(self):
        self.tags('a.csv', 'tag,count\nshared,1\n')
        self.tags('b.csv', 'tag,count\nshared,2\n')
        folder = Path(backend.TRANSLATION_FILES_DIR)
        (folder / 'a.csv').write_text('tag,ja\nshared,甲\n', encoding='utf-8')
        (folder / 'b.csv').write_text('tag,ja\nshared,乙\n', encoding='utf-8')
        first = {'q': 'shared', 'tag_files': '["a.csv","b.csv"]', 'translation_files': '["a.csv","b.csv"]'}
        a = backend._tag_response(first)
        b = backend._tag_response({**first, 'tag_files': '["b.csv","a.csv"]'})
        c = backend._tag_response({**first, 'translation_files': '["b.csv","a.csv"]'})
        self.assertEqual((a['tags'][0]['count'], b['tags'][0]['count'], c['tags'][0]['ja']), ('1', '2', '乙'))
        self.assertEqual(len({a['revision'], b['revision'], c['revision']}), 3)
        request = types.SimpleNamespace(query=first)
        stamp = json.loads(asyncio.run(backend.get_dictionary_revision(request)).body)
        self.assertEqual(stamp['revision'], a['revision'])
        self.assertTrue(stamp['ordered_selection'])
        asyncio.run(backend.reload_dictionaries(request))
        self.assertIsNone(backend._TAG_CACHE_KEY)
        self.assertEqual(backend._tag_response(first)['tags'], a['tags'])

    def test_unselected_changes_do_not_affect_selected_revision(self):
        self.tags('a.csv', 'tag,count\nalpha,1\n')
        self.tags('b.csv', 'tag,count\nbeta,2\n')
        before = backend._dictionary_revision(tag_files=['a.csv'], translation_files=[])
        self.tags('b.csv', 'tag,count\nchanged,9999\n')
        self.assertEqual(before, backend._dictionary_revision(tag_files=['a.csv'], translation_files=[]))
        self.tags('a.csv', 'tag,count\nalpine,3\n')
        self.assertNotEqual(before, backend._dictionary_revision(tag_files=['a.csv'], translation_files=[]))

    def test_selected_broken_file_does_not_enable_unselected_fallback(self):
        self.tags('a.csv', 'tag,count\nalpha,1\n')
        self.tags('broken.csv', 'tag,count\n"unterminated\n')
        result = backend._tag_response({'q': 'a', 'tag_files': '["broken.csv"]'})
        self.assertEqual(result['tags'], [])
        self.assertEqual(result['errors'], ['broken.csv'])


    def test_retired_remote_update_routes_never_download_or_overwrite_local_files(self):
        import urllib.request
        destination = self.tags('danbooru_tags.csv', 'tag,count\nlocal_tag,9\n')
        original = destination.read_bytes()
        for handler in [backend.update_danbooru_tag_jp_assist_hf_file, backend.update_legacy_jp_tag_autocomplete_hf_file]:
            with patch.object(urllib.request, 'urlopen', side_effect=AssertionError('Remote access is prohibited')) as network:
                response = asyncio.run(handler(types.SimpleNamespace()))
                payload = json.loads(response.body)
                self.assertEqual(response.status, 200)
                self.assertTrue(payload['disabled'])
                self.assertFalse(payload['updated'])
                network.assert_not_called()
            self.assertEqual(destination.read_bytes(), original)
        self.assertFalse((Path(backend.TAG_FILES_DIR) / 'danbooru_2025.csv').exists())
        self.assertEqual([r['tag'] for r in backend._read_tag_rows(tag_files=['danbooru_tags.csv'])], ['local_tag'])

    def test_missing_remote_dictionary_is_not_advertised_or_created(self):
        self.tags('tags_merged_dedup.csv', 'tag,count\nmerged,1\n')
        self.assertNotIn('danbooru_tags.csv', backend._csv_file_names(backend.TAG_FILES_DIR))
        self.assertEqual(backend._csv_file_names(backend.TAG_FILES_DIR), ['tags_merged_dedup.csv'])
        asyncio.run(backend.update_danbooru_tag_jp_assist_hf_file(types.SimpleNamespace()))
        self.assertEqual(backend._csv_file_names(backend.TAG_FILES_DIR), ['tags_merged_dedup.csv'])

    def test_broken_csv_cache_does_not_reparse_good_files_and_errors_are_scoped(self):
        self.tags('good.csv', 'tag,count\nvalid,1\n')
        broken = self.tags('broken.csv', 'tag,count\n"unfinished\n')
        good_params = {'q':'valid', 'tag_files':'["good.csv"]', 'translation_files':'[]'}
        bad_params = {'q':'valid', 'tag_files':'["good.csv","broken.csv"]', 'translation_files':'[]'}
        read_calls = []
        original = backend._read_tag_csv
        def counted(path):
            read_calls.append(os.path.basename(path))
            return original(path)
        with patch.object(backend, '_read_tag_csv', side_effect=counted):
            good_first = backend._tag_response(good_params)
            for _ in range(4):
                bad = backend._tag_response(bad_params)
            good_again = backend._tag_response(good_params)
        self.assertEqual(read_calls.count('good.csv'), 2)  # One per distinct selection.
        self.assertEqual(read_calls.count('broken.csv'), 1)
        self.assertEqual([r['tag'] for r in bad['tags']], ['valid'])
        self.assertEqual(bad['errors'], ['broken.csv'])
        self.assertEqual(good_first['errors'], [])
        self.assertEqual(good_again['errors'], [])
        broken.write_text('tag,count\nrepaired,2\n', encoding='utf-8')
        repaired = backend._tag_response({**bad_params,'q':'repaired'})
        self.assertEqual(repaired['errors'], [])
        self.assertEqual([r['tag'] for r in repaired['tags']], ['repaired'])

    def test_explicit_reload_clears_partial_cache(self):
        self.tags('good.csv', 'tag,count\nvalid,1\n')
        self.tags('broken.csv', 'tag,count\n"unfinished\n')
        params = {'q':'valid', 'tag_files':'["good.csv","broken.csv"]', 'translation_files':'[]'}
        backend._tag_response(params)
        self.assertTrue(backend._TAG_PARTIAL_CACHE)
        asyncio.run(backend.reload_dictionaries(types.SimpleNamespace(query={})))
        self.assertEqual(backend._TAG_PARTIAL_CACHE, {})

    def test_reload_does_not_block_asyncio_loop_when_csv_lock_is_held(self):
        held = threading.Event()
        def hold_lock():
            with backend._TAG_CACHE_LOCK:
                held.set()
                time.sleep(.23)
        holder = threading.Thread(target=hold_lock)
        holder.start()
        self.assertTrue(held.wait(2))
        async def run():
            started = time.perf_counter()
            async def heartbeat():
                await asyncio.sleep(.015)
                return time.perf_counter() - started
            beat = asyncio.create_task(heartbeat())
            await backend.reload_dictionaries(types.SimpleNamespace(query={}))
            return await beat
        elapsed = asyncio.run(run())
        holder.join(2)
        self.assertLess(elapsed, .12, 'reload blocked the event loop')



if __name__ == '__main__':
    unittest.main()
