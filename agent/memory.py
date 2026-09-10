"""带身份边界的 LangGraph 持久化 Store，供 LangMem 使用。"""
import asyncio
import json
import math
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from contextlib import contextmanager
from langgraph.store.base import BaseStore, GetOp, PutOp, SearchOp, SearchItem, Item

TRIP = 'northbound-2026'


class MemoryStore(BaseStore):
    def __init__(self, path, user, embedding=None):
        self.path, self.user, self.embedding = path, user, embedding
        self.embedding_id = f"{embedding.model}|{getattr(embedding, 'openai_api_base', '')}" if embedding else None
        self.namespace = ('shared', TRIP)
        with self.connect() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS memories (
                namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
                author TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                vector TEXT, embedding_model TEXT, updated_by TEXT NOT NULL DEFAULT '', PRIMARY KEY(namespace,key))''')
            if 'updated_by' not in {row['name'] for row in db.execute('PRAGMA table_info(memories)')}:
                db.execute("ALTER TABLE memories ADD COLUMN updated_by TEXT NOT NULL DEFAULT ''")
            # Consolidate only previously shared memories; private legacy data is never published.
            namespace = json.dumps(self.namespace)
            db.execute('BEGIN IMMEDIATE')
            for row in db.execute('SELECT * FROM memories WHERE namespace != ?', (namespace,)).fetchall():
                old = tuple(json.loads(row['namespace']))
                if old[:2] != self.namespace:
                    continue
                key = row['key']
                if db.execute('SELECT 1 FROM memories WHERE namespace=? AND key=?', (namespace, key)).fetchone():
                    key = str(uuid.uuid4())
                db.execute('UPDATE memories SET namespace=?,key=? WHERE namespace=? AND key=?',
                           (namespace, key, row['namespace'], row['key']))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def permits(self, namespace):
        return tuple(namespace) == self.namespace

    def embed(self, content):
        if not self.embedding:
            return None
        return self.embedding.embed_query(content)

    def batch(self, ops):
        return [self.execute(op) for op in ops]

    async def abatch(self, ops):
        return await asyncio.to_thread(self.batch, list(ops))

    def execute(self, op):
        if isinstance(op, PutOp):
            if not self.permits(op.namespace):
                raise PermissionError('只能修改这趟旅行的共同记忆')
            ns = json.dumps(op.namespace)
            if op.value is None:
                with self.connect() as db:
                    db.execute('DELETE FROM memories WHERE namespace=? AND key=?', (ns, op.key))
                return None
            content = op.value.get('content')
            if not isinstance(content, str) or not 1 <= len(content.strip()) <= 2000:
                raise ValueError('记忆内容需要 1–2000 个字符')
            vector = self.embed(content)
            now = datetime.now(timezone.utc).isoformat()
            with self.connect() as db:
                db.execute('''INSERT INTO memories VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(namespace,key)
                    DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,
                    updated_at=excluded.updated_at,vector=excluded.vector,embedding_model=excluded.embedding_model''',
                    (ns, op.key, json.dumps({'content': content}, ensure_ascii=False), self.user['name'], now, now,
                     json.dumps(vector) if vector else None, self.embedding_id, self.user['name']))
            return None
        if isinstance(op, GetOp):
            if not self.permits(op.namespace):
                raise PermissionError('只能读取这趟旅行的共同记忆')
            with self.connect() as db:
                row = db.execute('SELECT * FROM memories WHERE namespace=? AND key=?',
                                 (json.dumps(op.namespace), op.key)).fetchone()
            return self.item(row) if row else None
        if isinstance(op, SearchOp):
            if not self.permits(op.namespace_prefix):
                raise PermissionError('不能搜索这个记忆空间')
            with self.connect() as db:
                rows = db.execute('SELECT * FROM memories WHERE namespace=? ORDER BY updated_at DESC',
                                  (json.dumps(self.namespace),)).fetchall()
            if op.filter:
                rows = [r for r in rows if all(json.loads(r['value']).get(k) == v for k, v in op.filter.items())]
            query_vector = self.embed(op.query) if op.query and self.embedding else None
            items = []
            for row in rows:
                score = None
                if op.query:
                    content = json.loads(row['value'])['content'].lower()
                    terms = re.findall(r'[a-z0-9]+|[\u4e00-\u9fff]', op.query.lower())
                    score = sum(t in content for t in terms) / max(1, len(terms))
                    if query_vector:
                        # Lazily reindex old or changed-model memories without losing their content.
                        vector = json.loads(row['vector']) if row['vector'] and row['embedding_model'] == self.embedding_id else self.embed(content)
                        if len(vector) != len(query_vector):
                            vector = self.embed(content)
                        denominator = math.sqrt(sum(x*x for x in vector) * sum(x*x for x in query_vector))
                        score = sum(a*b for a, b in zip(vector, query_vector)) / denominator if denominator else 0
                        with self.connect() as db:
                            db.execute('UPDATE memories SET vector=?,embedding_model=? WHERE namespace=? AND key=?',
                                       (json.dumps(vector), self.embedding_id, row['namespace'], row['key']))
                    elif score == 0:
                        continue
                item = self.item(row, score, search=True)
                items.append(item)
            if op.query:
                items.sort(key=lambda i: i.score or 0, reverse=True)
            return items[max(0, op.offset):max(0, op.offset)+min(500, max(1, op.limit))]
        raise NotImplementedError('此 Store 只开放记忆读写与搜索')

    def item(self, row, score=None, search=False):
        data = dict(namespace=tuple(json.loads(row['namespace'])), key=row['key'],
                    value={**json.loads(row['value']), 'author': row['author'], 'updatedBy': row['updated_by'] or row['author']},
                    created_at=datetime.fromisoformat(row['created_at']), updated_at=datetime.fromisoformat(row['updated_at']))
        return SearchItem(**data, score=score) if search else Item(**data)
