"""SQLite engine and session setup."""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from .models import Base

DB_FILENAME = "pocket-dm.db"


def default_data_dir() -> Path:
    env = os.environ.get("POCKET_DM_DATA")
    if env:
        return Path(env).expanduser()
    base = os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share"
    return Path(base) / "pocket-dm"


class Database:
    """Owns the engine and hands out sessions. ``url`` overrides ``data_dir``."""

    def __init__(self, data_dir: Path | str | None = None, *, url: str | None = None):
        if url is None:
            self.data_dir = Path(data_dir) if data_dir else default_data_dir()
            self.data_dir.mkdir(parents=True, exist_ok=True)
            self.path: Path | None = self.data_dir / DB_FILENAME
            url = f"sqlite:///{self.path}"
        else:
            self.data_dir = None
            self.path = None
        self.engine: Engine = create_engine(url, connect_args={"check_same_thread": False})
        event.listen(self.engine, "connect", _sqlite_pragmas)
        Base.metadata.create_all(self.engine)
        self._sessions = sessionmaker(self.engine, expire_on_commit=False)

    @contextmanager
    def session(self) -> Iterator[Session]:
        """A unit of work: committed on success, rolled back on any error."""
        with self._sessions() as s:
            try:
                yield s
                s.commit()
            except BaseException:
                s.rollback()
                raise

    def dispose(self) -> None:
        self.engine.dispose()


def _sqlite_pragmas(dbapi_conn, _record) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys = ON")
    cur.execute("PRAGMA journal_mode = WAL")
    cur.close()
