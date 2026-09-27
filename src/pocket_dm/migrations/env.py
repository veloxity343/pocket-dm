"""Alembic environment.

The app passes its engine in via ``config.attributes["engine"]``. When run from
the ``alembic`` command line, the database is taken from ``-x db=PATH``, else
``$POCKET_DM_DATA`` / the default data folder (the same one the app uses).
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from pocket_dm.db import DB_FILENAME, default_data_dir
from pocket_dm.models import Base

config = context.config
if config.config_file_name:  # command-line use: log per alembic.ini
    fileConfig(config.config_file_name)
target_metadata = Base.metadata


def _engine():
    engine = config.attributes.get("engine")
    if engine is not None:
        return engine
    path = context.get_x_argument(as_dictionary=True).get("db") or default_data_dir() / DB_FILENAME
    return create_engine(f"sqlite:///{path}")


def run_migrations_online() -> None:
    with _engine().connect() as connection:
        # SQLite can't ALTER most things, so batch mode rebuilds tables (copy, drop, rename).
        # Foreign keys must be off meanwhile, or dropping `campaigns` would cascade-delete
        # every session. The pragma only takes effect outside a transaction.
        connection.exec_driver_sql("PRAGMA foreign_keys = OFF")
        connection.commit()
        context.configure(connection=connection, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()
        connection.commit()
        connection.exec_driver_sql("PRAGMA foreign_keys = ON")
        connection.commit()


if context.is_offline_mode():
    raise SystemExit("Offline (--sql) migrations aren't supported; run against a database.")
run_migrations_online()
