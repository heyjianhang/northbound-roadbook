import json
import tempfile
import unittest
from pathlib import Path
from langmem import create_manage_memory_tool, create_search_memory_tool
from langgraph.store.base import InvalidNamespaceError
from .memory import MemoryStore, TRIP


class SharedMemoryTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'memory.sqlite'
        self.a = {'id': 'a', 'name': '健航'}
        self.b = {'id': 'b', 'name': '旅伴'}

    def tearDown(self):
        self.directory.cleanup()

    def test_langmem_create_search_and_persist_for_all_members(self):
        store = MemoryStore(self.path, self.a)
        result = create_manage_memory_tool(store.namespace, store=store).invoke({'content': '健航喜欢清淡的食物'})
        self.assertIn('created', result)
        reopened = MemoryStore(self.path, self.b)
        found = create_search_memory_tool(reopened.namespace, store=reopened).invoke({'query': '清淡'})
        self.assertIn('清淡', found)
        self.assertIn('健航', found)

    def test_every_member_can_edit_delete_and_authorship_is_preserved(self):
        a = MemoryStore(self.path, self.a)
        b = MemoryStore(self.path, self.b)
        a.put(a.namespace, 'decision', {'content': '早上九点出发'})
        b.put(b.namespace, 'decision', {'content': '早上十点出发'})
        item = a.search(a.namespace)[0]
        self.assertEqual(item.value['content'], '早上十点出发')
        self.assertEqual(item.value['author'], '健航')
        self.assertEqual(item.value['updatedBy'], '旅伴')
        a.delete(a.namespace, 'decision')
        self.assertEqual(b.search(b.namespace), [])

    def test_namespace_cannot_escape_trip_or_reopen_private_data(self):
        store = MemoryStore(self.path, self.a)
        for namespace in [(), ('private', 'a'), ('private', 'b'), ('shared',), ('shared', 'other-trip')]:
            with self.assertRaises(PermissionError):
                store.search(namespace)
            with self.assertRaises(PermissionError):
                store.get(namespace, 'key')
            with self.assertRaises((PermissionError, InvalidNamespaceError)):
                store.put(namespace, 'key', {'content': 'cannot escape'})

    def test_legacy_shared_memories_migrate_without_publishing_private_entries(self):
        old = MemoryStore(self.path, self.a)
        with old.connect() as db:
            for namespace, key, content in [(('shared', TRIP, 'a'), 'old-shared', '共同约定'),
                                            (('private', 'a'), 'old-private', '私有内容')]:
                db.execute('INSERT INTO memories(namespace,key,value,author,created_at,updated_at) VALUES(?,?,?,?,?,?)',
                           (json.dumps(namespace), key, json.dumps({'content': content}), '健航',
                            '2026-09-09T00:00:00+00:00', '2026-09-09T00:00:00+00:00'))
        migrated = MemoryStore(self.path, self.b)
        items = migrated.search(migrated.namespace)
        self.assertEqual([i.key for i in items], ['old-shared'])
        migrated.put(migrated.namespace, 'old-shared', {'content': '旅伴更新的共同约定'})
        with migrated.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM memories WHERE key=?', ('old-private',)).fetchone()[0], 1)

    def test_semantic_search_indexes_existing_memories(self):
        class Embeddings:
            model = 'fixture-embedding'
            def embed_query(self, text):
                return [1.0, 0.0] if text in ('清淡口味', '少放调料') else [0.0, 1.0]
        plain = MemoryStore(self.path, self.a)
        plain.put(plain.namespace, 'food', {'content': '清淡口味'})
        plain.put(plain.namespace, 'view', {'content': '喜欢摄影'})
        semantic = MemoryStore(self.path, self.b, Embeddings())
        results = semantic.search(semantic.namespace, query='少放调料')
        self.assertEqual(results[0].key, 'food')
        self.assertEqual(results[0].score, 1.0)
        semantic.put(semantic.namespace, 'food', {'content': '喜欢摄影'})
        self.assertEqual(semantic.search(semantic.namespace, query='少放调料')[0].score, 0.0)


if __name__ == '__main__':
    unittest.main()
