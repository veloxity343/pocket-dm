"""Pydantic schemas for API payloads and import/export documents.

Every field has a default, so partial payloads (a new record with just a
name, or an older export missing newer fields) validate into a complete shape.
Unknown keys are ignored.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from . import rules


def _none_to_empty(v: Any) -> Any:
    return "" if v is None else v


def _split_tags(v: Any) -> Any:
    if isinstance(v, str):
        return [t.strip() for t in v.split(",") if t.strip()]
    return v


# Strings that may arrive as null (e.g. an unset foreign key).
Str = Annotated[str, BeforeValidator(_none_to_empty)]


class Doc(BaseModel):
    model_config = ConfigDict(extra="ignore")


class Record(Doc):
    id: Str = ""
    created: Str = ""
    updated: Str = ""


# --------------------------------------------------------------------------- campaigns


class Player(Doc):
    name: Str = ""
    contact: Str = ""
    character_id: Str = ""
    notes: Str = ""


class Campaign(Record):
    name: Str = "New Campaign"
    system: Str = "D&D 5e (SRD 5.1)"
    description: Str = ""
    setting: Str = ""
    players: list[Player] = []
    notes: Str = ""


# --------------------------------------------------------------------------- sessions


class Combatant(Doc):
    id: Str = ""
    name: Str = ""
    kind: Literal["monster", "pc", "npc"] = "monster"
    initiative: int = 0
    init_bonus: int = 0
    ac: int = 10
    hp: int = 0
    max_hp: int = 0
    temp_hp: int = 0
    conditions: list[str] = []
    notes: Str = ""
    character_id: Str = ""
    srd_id: Str = ""
    xp: int = 0
    hidden: bool = False


class Encounter(Doc):
    round: int = 0
    turn: int = 0
    active: bool = False
    combatants: list[Combatant] = []


class LogEntry(Doc):
    id: Str = ""
    time: Str = ""
    kind: Str = "note"
    text: Str = ""


class LootItem(Doc):
    name: Str = ""
    qty: int = 1
    value: Str = ""
    assigned_to: Str = ""


class Session(Record):
    campaign_id: Str = ""
    number: int = 1
    title: Str = "New Session"
    date: Str = ""
    status: Literal["planned", "active", "done"] = "planned"
    attendance: list[str] = []
    prep: Str = ""
    recap: Str = ""
    log: list[LogEntry] = []
    encounter: Encounter = Encounter()
    loot: list[LootItem] = []
    xp_awarded: int = 0


# --------------------------------------------------------------------------- characters


class ClassLevel(Doc):
    name: Str = ""
    subclass: Str = ""
    level: int = 1


class HitPoints(Doc):
    max: int = 10
    current: int = 10
    temp: int = 0


class HitDice(Doc):
    total: Str = "1d10"
    remaining: int = 1


class DeathSaves(Doc):
    successes: int = 0
    failures: int = 0


class Proficiencies(Doc):
    armor: Str = ""
    weapons: Str = ""
    tools: Str = ""
    languages: Str = "Common"


class Attack(Doc):
    name: Str = ""
    bonus: Str = ""
    damage: Str = ""
    notes: Str = ""


class SpellSlot(Doc):
    max: int = 0
    used: int = 0


class Spell(Doc):
    name: Str = ""
    level: int = 0
    prepared: bool = False
    notes: Str = ""
    srd_id: Str = ""


class Spellcasting(Doc):
    ability: Str = ""
    slots: dict[str, SpellSlot] = {}
    spells: list[Spell] = []


class Resource(Doc):
    name: Str = ""
    current: int = 0
    max: int = 0
    reset: Literal["long", "short", "none"] = "long"


class Item(Doc):
    name: Str = ""
    qty: int = 1
    weight: float = 0
    equipped: bool = False
    notes: Str = ""


class Currency(Doc):
    cp: int = 0
    sp: int = 0
    ep: int = 0
    gp: int = 0
    pp: int = 0


class Feature(Doc):
    name: Str = ""
    source: Str = ""
    description: Str = ""


class Personality(Doc):
    traits: Str = ""
    ideals: Str = ""
    bonds: Str = ""
    flaws: Str = ""


SkillProficiency = Literal["none", "half", "proficient", "expertise"]


class Character(Record):
    name: Str = "New Character"
    player: Str = ""
    campaign_id: Str = ""
    race: Str = ""
    background: Str = ""
    alignment: Str = ""
    classes: list[ClassLevel] = Field(default_factory=lambda: [ClassLevel(name="Fighter")], min_length=1)
    xp: int = 0
    abilities: dict[str, int] = Field(default_factory=lambda: {a: 10 for a in rules.ABILITIES})
    save_proficiencies: list[str] = []
    skills: dict[str, SkillProficiency] = {}
    jack_of_all_trades: bool = False
    ac: int = 10
    initiative_misc: int = 0
    speed: int = 30
    hp: HitPoints = HitPoints()
    hit_dice: HitDice = HitDice()
    death_saves: DeathSaves = DeathSaves()
    inspiration: bool = False
    conditions: list[str] = []
    exhaustion: int = Field(0, ge=0, le=6)
    proficiencies: Proficiencies = Proficiencies()
    attacks: list[Attack] = []
    spellcasting: Spellcasting = Spellcasting()
    resources: list[Resource] = []
    inventory: list[Item] = []
    currency: Currency = Currency()
    features: list[Feature] = []
    personality: Personality = Personality()
    appearance: Str = ""
    backstory: Str = ""
    notes: Str = ""


# --------------------------------------------------------------------------- handbook


class HandbookEntry(Record):
    title: Str = "Untitled"
    category: Str = "House Rules"
    tags: Annotated[list[str], BeforeValidator(_split_tags)] = []
    campaign_id: Str = ""
    body: Str = ""


# --------------------------------------------------------------------------- request bodies


class EncounterAction(Doc):
    action: Literal[
        "add", "add_monster", "add_character", "update", "remove", "hp",
        "roll_initiative", "sort", "next", "prev", "end", "clear",
    ]
    id: str = ""
    combatant: dict[str, Any] = {}
    changes: dict[str, Any] = {}
    srd_id: str = ""
    count: int = Field(1, ge=1, le=50)
    average_hp: bool = True
    character_id: str = ""
    character_ids: list[str] = []
    amount: int = 0
    which: Literal["all", "monsters", "unset"] = "all"
    all: bool = False


class Award(Doc):
    xp: int | None = None
    character_ids: list[str] = []
    loot_index: int | None = None
    character_id: str = ""


class LogIn(Doc):
    text: str
    kind: str = "note"


class RestIn(Doc):
    type: Literal["short", "long"] = "long"


class Expression(Doc):
    expression: str


class MarkdownFile(Doc):
    filename: str = ""
    text: str = ""


class MarkdownImport(Doc):
    files: list[MarkdownFile] = []
    campaign_id: str = ""


class ClassesIn(Doc):
    classes: list[ClassLevel] = []
