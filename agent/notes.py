"""共同地点笔记：身份由后端提供，所有写入检查版本。"""
import json
import os
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROADBOOK = json.loads((ROOT / 'data/roadbook.json').read_text())
PLACES, ALIASES = {}, {}
for day in ROADBOOK['days']:
    for stop in day['stops']:
        place = next((p for p in PLACES.values() if p['name'] == stop['name']), None)
        if place is None:
            place = {'placeId': stop['id'], 'name': stop['name'], 'days': []}
            PLACES[place['placeId']] = place
        if day['id'] not in place['days']:
            place['days'].append(day['id'])
        ALIASES[stop['id']] = place['placeId']


class NoteError(ValueError):
    def __init__(self, message, status=400, current=None):
        super().__init__(message)
        self.status, self.current = status, current


def identity(user):
    if not isinstance(user, dict) or user.get('role') != 'member' or not user.get('id') or not user.get('name'):
        raise NoteError('只有已登录旅伴可以访问笔记', 403)
    return {'id': user['id'], 'name': user['name']}


class NoteStore:
    def __init__(self, directory, user):
        self.user = identity(user)
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = directory / 'notes.sqlite'
        with closing(self.connect()) as db:
            db.execute('CREATE TABLE IF NOT EXISTS place_notes (place_id TEXT PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_name TEXT NOT NULL, updated_at TEXT NOT NULL)')
        os.chmod(self.path, 0o600)

    def connect(self):
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        db.row_factory = sqlite3.Row
        return db

    def place(self, place_id):
        if not isinstance(place_id, str) or place_id not in ALIASES:
            raise NoteError('路书中没有这个地点', 404)
        return PLACES[ALIASES[place_id]]

    def read(self, place_id, db=None):
        place = self.place(place_id)
        if db is None:
            with closing(self.connect()) as connection:
                return self.read(place_id, connection)
        row = db.execute('SELECT * FROM place_notes WHERE place_id=?', (place['placeId'],)).fetchone()
        return {**place, 'content': row['content'] if row else '', 'version': row['version'] if row else 0,
                'updatedBy': row['updated_by'] if row else '', 'updatedName': row['updated_name'] if row else '',
                'updatedAt': row['updated_at'] if row else ''}

    def list(self, query='', day_id=''):
        if not isinstance(query, str) or len(query) > 200 or (day_id and day_id not in [d['id'] for d in ROADBOOK['days']]):
            raise NoteError('地点筛选条件无效')
        with closing(self.connect()) as db:
            notes = [self.read(p['placeId'], db) for p in PLACES.values() if not day_id or day_id in p['days']]
        return [{k: v for k, v in note.items() if k != 'content'} | {'preview': note['content'][:180]} for note in notes if query.casefold() in (note['name'] + '\n' + note['content']).casefold()]

    def save(self, place_id, content, expected_version):
        if not isinstance(content, str) or len(content) > 20000 or len(content.encode('utf-8')) > 60000 or '\x00' in content:
            raise NoteError('笔记最多 20000 个字符，且不能包含空字符')
        if type(expected_version) is not int or expected_version < 0:
            raise NoteError('请先读取笔记，携带有效版本号保存')
        with closing(self.connect()) as db:
            db.execute('BEGIN IMMEDIATE')
            try:
                current = self.read(place_id, db)
                if current['version'] != expected_version:
                    raise NoteError('笔记已有新版本，你的草稿已保留，请读取最新内容后合并修改', 409, current)
                if current['content'] != content:
                    db.execute('INSERT INTO place_notes VALUES(?,?,?,?,?,?) ON CONFLICT(place_id) DO UPDATE SET content=excluded.content,version=excluded.version,updated_by=excluded.updated_by,updated_name=excluded.updated_name,updated_at=excluded.updated_at',
                               (current['placeId'], content, expected_version + 1, self.user['id'], self.user['name'], datetime.now(timezone.utc).isoformat()))
                result = self.read(place_id, db)
                db.execute('COMMIT')
                return result
            except BaseException:
                db.execute('ROLLBACK')
                raise

    def edit(self, place_id, old_text, new_text, expected_version):
        current = self.read(place_id)
        if current['version'] != expected_version:
            raise NoteError('笔记已有新版本，请重新读取后修改', 409, current)
        if not isinstance(old_text, str) or not old_text or current['content'].count(old_text) != 1:
            raise NoteError('替换内容必须在笔记中精确出现一次，请扩大原文范围或重新读取')
        if not isinstance(new_text, str):
            raise NoteError('替换内容需要文本')
        return self.save(place_id, current['content'].replace(old_text, new_text, 1), expected_version)


def note_result(operation):
    try:
        return {'ok': True, 'note': operation()}
    except NoteError as error:
        return {'ok': False, 'error': str(error), 'status': error.status, 'note': error.current}
