"""SQLite 连接封装。"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from .schema import init_db


class Database:
    def __init__(self, db_path: str | Path):
        self.db_path = str(db_path)
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA busy_timeout = 5000")
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.execute("PRAGMA synchronous = NORMAL")
        init_db(self.conn)

    def close(self) -> None:
        self.conn.close()
