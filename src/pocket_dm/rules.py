"""D&D 5e (SRD 5.1) numbers and helper calculations."""

from __future__ import annotations

import math

ABILITIES = ["str", "dex", "con", "int", "wis", "cha"]
ABILITY_NAMES = {
    "str": "Strength",
    "dex": "Dexterity",
    "con": "Constitution",
    "int": "Intelligence",
    "wis": "Wisdom",
    "cha": "Charisma",
}

SKILLS = {
    "acrobatics": "dex",
    "animal-handling": "wis",
    "arcana": "int",
    "athletics": "str",
    "deception": "cha",
    "history": "int",
    "insight": "wis",
    "intimidation": "cha",
    "investigation": "int",
    "medicine": "wis",
    "nature": "int",
    "perception": "wis",
    "performance": "cha",
    "persuasion": "cha",
    "religion": "int",
    "sleight-of-hand": "dex",
    "stealth": "dex",
    "survival": "wis",
}

CONDITIONS = [
    "blinded",
    "charmed",
    "deafened",
    "exhaustion",
    "frightened",
    "grappled",
    "incapacitated",
    "invisible",
    "paralyzed",
    "petrified",
    "poisoned",
    "prone",
    "restrained",
    "stunned",
    "unconscious",
]

# Character advancement: XP required to reach each level.
XP_BY_LEVEL = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
               85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000]

CR_XP = {
    "0": 10, "1/8": 25, "1/4": 50, "1/2": 100, "1": 200, "2": 450, "3": 700, "4": 1100,
    "5": 1800, "6": 2300, "7": 2900, "8": 3900, "9": 5000, "10": 5900, "11": 7200,
    "12": 8400, "13": 10000, "14": 11500, "15": 13000, "16": 15000, "17": 18000,
    "18": 20000, "19": 22000, "20": 25000, "21": 33000, "22": 41000, "23": 50000,
    "24": 62000, "25": 75000, "26": 90000, "27": 105000, "28": 120000, "29": 135000,
    "30": 155000,
}

POINT_BUY_COST = {8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9}
POINT_BUY_BUDGET = 27
STANDARD_ARRAY = [15, 14, 13, 12, 10, 8]

HIT_DICE = {
    "barbarian": 12, "bard": 8, "cleric": 8, "druid": 8, "fighter": 10, "monk": 8,
    "paladin": 10, "ranger": 10, "rogue": 8, "sorcerer": 6, "warlock": 8, "wizard": 6,
}

# Multiclass spellcaster slot table (also the full-caster table), indexed by caster level.
SPELL_SLOTS = [
    [],
    [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2],
    [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1],
    [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
    [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
    [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
]

CASTER_PROGRESSION = {
    "bard": 1, "cleric": 1, "druid": 1, "sorcerer": 1, "wizard": 1,
    "paladin": 0.5, "ranger": 0.5,
}


def ability_modifier(score: int) -> int:
    return math.floor((int(score) - 10) / 2)


def proficiency_bonus(level: int) -> int:
    level = max(1, min(int(level), 20))
    return 2 + (level - 1) // 4


def level_for_xp(xp: int) -> int:
    level = 1
    for i, needed in enumerate(XP_BY_LEVEL, start=1):
        if xp >= needed:
            level = i
    return level


def xp_for_next_level(level: int) -> int | None:
    return XP_BY_LEVEL[level] if 1 <= level < 20 else None


def point_buy_cost(scores: list[int]) -> int:
    total = 0
    for s in scores:
        if s not in POINT_BUY_COST:
            raise ValueError(f"point-buy scores must be 8-15, got {s}")
        total += POINT_BUY_COST[s]
    return total


def carrying_capacity(strength: int, size: str = "medium") -> dict:
    mult = {"tiny": 0.5, "small": 1, "medium": 1, "large": 2, "huge": 4, "gargantuan": 8}.get(size.lower(), 1)
    cap = strength * 15 * mult
    return {"capacity": cap, "push_drag_lift": cap * 2}


def jump(strength: int, running: bool = True) -> dict:
    mod = ability_modifier(strength)
    return {
        "long_jump_ft": strength if running else strength // 2,
        "high_jump_ft": max(0, 3 + mod) if running else max(0, 3 + mod) // 2,
    }


def caster_level(classes: list[dict]) -> int:
    """Combined caster level for the multiclass slot table (warlock excluded)."""
    total = 0.0
    for c in classes:
        weight = CASTER_PROGRESSION.get(str(c.get("name", "")).lower(), 0)
        lvl = int(c.get("level") or 0)
        if weight == 0.5 and len(classes) == 1:
            # single-class half casters round up from 2nd level
            total += math.ceil(lvl / 2) if lvl >= 2 else 0
        else:
            total += math.floor(lvl * weight)
    return int(total)


def spell_slots_for(classes: list[dict]) -> list[int]:
    lvl = caster_level(classes)
    return list(SPELL_SLOTS[min(lvl, 20)]) if lvl > 0 else []


def encounter_xp(monster_crs: list[str]) -> int:
    return sum(CR_XP.get(str(cr), 0) for cr in monster_crs)


def total_level(character: dict) -> int:
    return sum(int(c.get("level") or 0) for c in character.get("classes", [])) or 1


def derive(character: dict) -> dict:
    """Compute modifiers, bonuses and passives for a character sheet."""
    abilities = character.get("abilities", {})
    mods = {a: ability_modifier(abilities.get(a, 10)) for a in ABILITIES}
    level = total_level(character)
    pb = proficiency_bonus(level)
    saves = {}
    save_profs = set(character.get("save_proficiencies", []))
    for a in ABILITIES:
        saves[a] = mods[a] + (pb if a in save_profs else 0)
    skills = {}
    skill_profs = character.get("skills", {})
    jack = bool(character.get("jack_of_all_trades"))
    for skill, ability in SKILLS.items():
        prof = skill_profs.get(skill, "none")
        bonus = mods[ability]
        if prof == "expertise":
            bonus += pb * 2
        elif prof == "proficient":
            bonus += pb
        elif prof == "half" or jack:
            bonus += pb // 2
        skills[skill] = bonus
    spell_ability = character.get("spellcasting", {}).get("ability") or None
    spell = {}
    if spell_ability in mods:
        spell = {"save_dc": 8 + pb + mods[spell_ability], "attack_bonus": pb + mods[spell_ability]}
    return {
        "level": level,
        "proficiency_bonus": pb,
        "modifiers": mods,
        "saves": saves,
        "skills": skills,
        "initiative": mods["dex"] + int(character.get("initiative_misc") or 0),
        "passive_perception": 10 + skills["perception"],
        "passive_investigation": 10 + skills["investigation"],
        "passive_insight": 10 + skills["insight"],
        "spell": spell,
        "carrying_capacity": abilities.get("str", 10) * 15,
        "next_level_xp": xp_for_next_level(level),
    }
