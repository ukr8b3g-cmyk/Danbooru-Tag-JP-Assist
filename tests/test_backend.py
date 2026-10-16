import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest

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

    def test_headerless_first_record_and_alias_column(self):
        rows = backend._read_tag_csv(self.tags('e621.csv', 'mammal,5,100,"mammals,ungulate"\nanthro,0,0,word\n'))
        self.assertEqual([r['tag'] for r in rows], ['mammal', 'anthro'])
        self.assertEqual(rows[1]['meta']['insert_mode'], 'tag')
        self.assertEqual(rows[1]['meta']['post_count'], 0)

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


if __name__ == '__main__':
    unittest.main()
