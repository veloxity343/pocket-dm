import pytest
from fastapi.testclient import TestClient

from pocket_dm.app import create_app
from pocket_dm.db import Database
from pocket_dm.repo import Repo


@pytest.fixture
def db(tmp_path):
    database = Database(tmp_path / "data")
    yield database
    database.dispose()


@pytest.fixture
def repo(db):
    with db.session() as s:
        yield Repo(s)


@pytest.fixture
def web_dir(tmp_path):
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<!doctype html><title>Pocket DM</title>")
    (web / "assets" / "app.js").write_text("console.log('hi')")
    return web


@pytest.fixture
def client(db, web_dir):
    with TestClient(create_app(db, web_dir)) as c:
        yield c
