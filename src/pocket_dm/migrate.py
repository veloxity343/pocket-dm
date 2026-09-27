"""Database migrations (Alembic), applied automatically when the app opens a database."""

from __future__ import annotations

from importlib import resources

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, inspect

from .models import Base

# The revision that matches the schema Pocket DM created before migrations existed.
BASELINE = "0001"


def alembic_config(engine: Engine | None = None) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(resources.files("pocket_dm").joinpath("migrations")))
    if engine is not None:
        cfg.attributes["engine"] = engine
    return cfg


def upgrade(engine: Engine, revision: str = "head") -> None:
    """Bring the database schema up to date."""
    cfg = alembic_config(engine)
    tables = set(inspect(engine).get_table_names())
    if "alembic_version" not in tables and tables & set(Base.metadata.tables):
        # A database created before migrations were added: it already has the baseline schema.
        command.stamp(cfg, BASELINE)
    command.upgrade(cfg, revision)
