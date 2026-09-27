from pocket_dm import rules
from pocket_dm.repo import normalize


def test_modifiers_and_proficiency():
    assert [rules.ability_modifier(s) for s in (1, 8, 9, 10, 11, 12, 20, 30)] == [-5, -1, -1, 0, 0, 1, 5, 10]
    assert [rules.proficiency_bonus(lv) for lv in (1, 4, 5, 8, 9, 13, 17, 20)] == [2, 2, 3, 3, 4, 5, 6, 6]


def test_levels_from_xp():
    assert rules.level_for_xp(0) == 1
    assert rules.level_for_xp(299) == 1
    assert rules.level_for_xp(300) == 2
    assert rules.level_for_xp(355000) == 20
    assert rules.xp_for_next_level(1) == 300
    assert rules.xp_for_next_level(20) is None


def test_point_buy():
    assert rules.point_buy_cost([15, 15, 15, 8, 8, 8]) == 27
    assert rules.point_buy_cost([8] * 6) == 0


def test_spell_slots():
    assert rules.spell_slots_for([{"name": "Wizard", "level": 5}]) == [4, 3, 2]
    assert rules.spell_slots_for([{"name": "Paladin", "level": 1}]) == []
    assert rules.spell_slots_for([{"name": "Paladin", "level": 2}]) == [2]
    assert rules.spell_slots_for([{"name": "Paladin", "level": 20}]) == [4, 3, 3, 3, 2]
    # multiclass: wizard 3 + paladin 4 -> caster level 3 + 2 = 5
    assert rules.spell_slots_for([{"name": "Wizard", "level": 3}, {"name": "Paladin", "level": 4}]) == [4, 3, 2]
    assert rules.spell_slots_for([{"name": "Fighter", "level": 10}]) == []


def test_derive_character():
    ch = normalize(
        "characters",
        {
            "classes": [{"name": "Rogue", "level": 5}],
            "abilities": {"str": 8, "dex": 18, "con": 14, "int": 12, "wis": 13, "cha": 10},
            "save_proficiencies": ["dex", "int"],
            "skills": {"stealth": "expertise", "perception": "proficient"},
            "spellcasting": {"ability": "int"},
        },
    )
    d = rules.derive(ch)
    assert d["level"] == 5 and d["proficiency_bonus"] == 3
    assert d["saves"]["dex"] == 7 and d["saves"]["str"] == -1
    assert d["skills"]["stealth"] == 4 + 6
    assert d["skills"]["perception"] == 1 + 3
    assert d["passive_perception"] == 14
    assert d["initiative"] == 4
    assert d["spell"] == {"save_dc": 12, "attack_bonus": 4}


def test_jack_of_all_trades():
    ch = normalize("characters", {"classes": [{"name": "Bard", "level": 2}], "jack_of_all_trades": True})
    assert rules.derive(ch)["skills"]["arcana"] == 1
