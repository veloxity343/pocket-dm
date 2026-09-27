"""SQLAlchemy ORM tables.

Top-level fields are real columns and links between records are foreign keys.
Nested structures that are always read and written as a whole (a character's
inventory, a session's encounter, and so on) are stored in JSON columns.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, ForeignKey, MetaData, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class Base(DeclarativeBase):
    # Named constraints let Alembic's batch mode alter them on SQLite.
    metadata = MetaData(
        naming_convention={
            "ix": "ix_%(column_0_label)s",
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
            "pk": "pk_%(table_name)s",
        }
    )
    type_annotation_map = {dict[str, Any]: JSON, list[Any]: JSON}


class Record(Base):
    __abstract__ = True

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
    created: Mapped[str] = mapped_column(default=now)
    updated: Mapped[str] = mapped_column(default=now)


def _campaign_fk(ondelete: str) -> Mapped[str | None]:
    return mapped_column(ForeignKey("campaigns.id", ondelete=ondelete), index=True)


class Campaign(Record):
    __tablename__ = "campaigns"

    name: Mapped[str]
    system: Mapped[str]
    description: Mapped[str]
    setting: Mapped[str]
    players: Mapped[list[Any]]
    notes: Mapped[str]

    sessions: Mapped[list[Session]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan", passive_deletes=True
    )
    characters: Mapped[list[Character]] = relationship(back_populates="campaign", passive_deletes=True)
    handbook: Mapped[list[HandbookEntry]] = relationship(back_populates="campaign", passive_deletes=True)


class Session(Record):
    __tablename__ = "sessions"

    campaign_id: Mapped[str | None] = _campaign_fk("CASCADE")
    number: Mapped[int]
    title: Mapped[str]
    date: Mapped[str]
    status: Mapped[str]
    attendance: Mapped[list[Any]]
    prep: Mapped[str]
    recap: Mapped[str]
    log: Mapped[list[Any]]
    encounter: Mapped[dict[str, Any]]
    loot: Mapped[list[Any]]
    xp_awarded: Mapped[int]

    campaign: Mapped[Campaign | None] = relationship(back_populates="sessions")


class Character(Record):
    __tablename__ = "characters"

    campaign_id: Mapped[str | None] = _campaign_fk("SET NULL")
    name: Mapped[str]
    player: Mapped[str]
    race: Mapped[str]
    background: Mapped[str]
    alignment: Mapped[str]
    classes: Mapped[list[Any]]
    xp: Mapped[int]
    abilities: Mapped[dict[str, Any]]
    save_proficiencies: Mapped[list[Any]]
    skills: Mapped[dict[str, Any]]
    jack_of_all_trades: Mapped[bool]
    ac: Mapped[int]
    initiative_misc: Mapped[int]
    speed: Mapped[int]
    hp: Mapped[dict[str, Any]]
    hit_dice: Mapped[dict[str, Any]]
    death_saves: Mapped[dict[str, Any]]
    inspiration: Mapped[bool]
    conditions: Mapped[list[Any]]
    exhaustion: Mapped[int]
    proficiencies: Mapped[dict[str, Any]]
    attacks: Mapped[list[Any]]
    spellcasting: Mapped[dict[str, Any]]
    resources: Mapped[list[Any]]
    inventory: Mapped[list[Any]]
    currency: Mapped[dict[str, Any]]
    features: Mapped[list[Any]]
    personality: Mapped[dict[str, Any]]
    appearance: Mapped[str]
    backstory: Mapped[str]
    notes: Mapped[str]

    campaign: Mapped[Campaign | None] = relationship(back_populates="characters")


class HandbookEntry(Record):
    __tablename__ = "handbook"

    campaign_id: Mapped[str | None] = _campaign_fk("SET NULL")
    title: Mapped[str]
    category: Mapped[str]
    tags: Mapped[list[Any]]
    body: Mapped[str]

    campaign: Mapped[Campaign | None] = relationship(back_populates="handbook")
