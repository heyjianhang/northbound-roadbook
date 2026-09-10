"""使用临时数据库和真实 stdio MCP 验证笔记，不访问商家或模型服务。"""
import asyncio
import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from .notes import NoteStore, NoteError
from .notes_client import note_tools

A = {'id': 'a', 'name': '健航', 'role': 'member'}
B = {'id': 'b', 'name': '旅伴', 'role': 'member'}


class NoteStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.a, self.b = NoteStore(self.temp.name, A), NoteStore(self.temp.name, B)

    def tearDown(self): self.temp.cleanup()

    def test_shared_aliases_persistence_identity_and_exact_edit(self):
        self.assertEqual(self.a.read('visit-3')['placeId'], 'visit-2')
        first = self.a.save('visit-3', '# 海拉尔\n\n- 晚上吃手把肉\n- 九点出发', 0)
        self.assertEqual(first['version'], 1)
        self.assertEqual(self.b.read('visit-17')['content'], first['content'])
        edited = self.b.edit('visit-18', '九点出发', '十点出发', 1)
        self.assertEqual(edited['updatedBy'], 'b')
        self.assertIn('手把肉', edited['content'])
        self.assertIn('十点', edited['content'])
        self.assertEqual(NoteStore(self.temp.name, A).read('visit-2')['version'], 2)
        self.assertEqual(self.a.list('手把肉', 'd5')[0]['name'], '海拉尔')
        with self.assertRaises(NoteError): self.a.edit('visit-2', '不存在', '替换', 2)
        self.assertEqual(self.a.read('visit-2')['version'], 2)

    def test_concurrent_writers_do_not_overwrite_each_other(self):
        barrier = threading.Barrier(2)
        def write(store, text):
            barrier.wait()
            try: return store.save('visit-2', text, 0)
            except NoteError as error: return error
        with ThreadPoolExecutor(2) as pool:
            futures = [pool.submit(write, self.a, '健航写的'), pool.submit(write, self.b, '旅伴写的')]
            results = [f.result() for f in futures]
        conflicts = [r for r in results if isinstance(r, NoteError)]
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0].status, 409)
        self.assertEqual(conflicts[0].current['version'], 1)
        self.assertEqual(self.a.read('visit-3')['content'], conflicts[0].current['content'])

    def test_invalid_member_place_length_and_version_never_write(self):
        for user in [{}, {**A, 'role': 'admin'}]:
            with self.assertRaises(NoteError): NoteStore(self.temp.name, user)
        for place_id, content, version in [('../escape', 'text', 0), ('visit-2', 'x' * 20001, 0), ('visit-2', 'a\x00b', 0), ('visit-2', 'text', -1), ('visit-2', 'text', True)]:
            with self.assertRaises(NoteError): self.a.save(place_id, content, version)
        self.assertEqual(self.a.read('visit-2')['version'], 0)
        self.assertFalse((Path(self.temp.name).parent / 'escape').exists())


class NoteMcpTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_stdio_tools_edit_the_same_store_and_bind_author(self):
        with tempfile.TemporaryDirectory() as directory:
            a_tools, b_tools = await asyncio.gather(note_tools(directory, A), note_tools(directory, B))
            a = {t.name: t for t in a_tools}; b = {t.name: t for t in b_tools}
            self.assertEqual(len(a), 4)
            self.assertTrue(a['notes_read_place_note'].metadata['readOnlyHint'])
            self.assertFalse(a['notes_write_place_note'].metadata['readOnlyHint'])
            self.assertNotIn('user', a['notes_write_place_note'].args_schema['properties'])
            result = await a['notes_write_place_note'].ainvoke({'place_id': 'visit-2', 'content': '# 攻略\n\n九点出发', 'expected_version': 0})
            self.assertTrue(json.loads(result[0]['text'])['ok'])
            await b['notes_edit_place_note'].ainvoke({'place_id': 'visit-3', 'old_text': '九点出发', 'new_text': '十点出发', 'expected_version': 1})
            note = NoteStore(directory, A).read('visit-17')
            self.assertEqual(note['content'], '# 攻略\n\n十点出发')
            self.assertEqual(note['updatedBy'], 'b')
            # Tool-call form reports MCP errors to the agent as errors, not successful writes.
            stale = await a['notes_write_place_note'].ainvoke({'type': 'tool_call', 'id': 'stale-call', 'name': 'notes_write_place_note', 'args': {'place_id': 'visit-2', 'content': '旧内容', 'expected_version': 0}})
            self.assertEqual(stale.status, 'error')
            self.assertIn('新版本', str(stale.content))
            self.assertEqual(NoteStore(directory, A).read('visit-2')['version'], 2)


if __name__ == '__main__': unittest.main()
