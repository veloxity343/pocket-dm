import pytest
from pydantic import ValidationError

from pocket_dm import game
from pocket_dm.repo import NotFound, normalize


def test_normalize_fills_defaults():
    doc = normalize("characters", {"name": "Vex", "hp": {"max": 30}, "custom_field": 1})
    assert doc["hp"] == {"max": 30, "current": 10, "temp": 0}
    assert doc["abilities"]["str"] == 10
    assert "custom_field" not in doc


def test_normalize_coerces_and_rejects():
    doc = normalize("characters", {"ac": "15", "inspiration": 1, "campaign_id": None})
    assert doc["ac"] == 15 and doc["inspiration"] is True and doc["campaign_id"] == ""
    with pytest.raises(ValidationError):
        normalize("characters", {"inventory": "junk"})


def test_defaults_are_not_shared():
    a = normalize("sessions", {})
    a["encounter"]["combatants"].append({"name": "x"})
    assert normalize("sessions", {})["encounter"]["combatants"] == []


def test_handbook_tags_from_string():
    assert normalize("handbook", {"tags": "a, b ,,c"})["tags"] == ["a", "b", "c"]


def test_crud(repo):
    c = repo.create("campaigns", {"name": "Curse of Strahd"})
    assert repo.get("campaigns", c["id"])["name"] == "Curse of Strahd"
    repo.update("campaigns", c["id"], {"setting": "Barovia"})
    got = repo.get("campaigns", c["id"])
    assert got["setting"] == "Barovia" and got["created"] == c["created"]
    assert [x["id"] for x in repo.list("campaigns")] == [c["id"]]
    repo.delete("campaigns", c["id"])
    with pytest.raises(NotFound):
        repo.get("campaigns", c["id"])


def test_rejects_bad_ids_and_kinds(repo):
    with pytest.raises(NotFound):
        repo.get("characters", "../../etc/passwd")
    with pytest.raises(ValueError):
        repo.list("secrets")


def test_unknown_campaign_link_rejected(repo):
    with pytest.raises(ValueError, match="campaign"):
        repo.create("characters", {"campaign_id": "nope"})


def test_deleting_campaign_removes_sessions_and_unlinks(repo):
    c = repo.create("campaigns", {"name": "C"})
    s = repo.create("sessions", {"campaign_id": c["id"]})
    ch = repo.create("characters", {"campaign_id": c["id"]})
    hb = repo.create("handbook", {"campaign_id": c["id"]})
    repo.delete("campaigns", c["id"])
    assert not repo.exists("sessions", s["id"])
    assert repo.get("characters", ch["id"])["campaign_id"] == ""
    assert repo.get("handbook", hb["id"])["campaign_id"] == ""


def test_list_filters_and_sorts(repo):
    c = repo.create("campaigns", {"name": "C"})
    repo.create("sessions", {"campaign_id": c["id"], "number": 2})
    repo.create("sessions", {"campaign_id": c["id"], "number": 1})
    repo.create("sessions", {})
    assert [s["number"] for s in repo.list("sessions", campaign_id=c["id"])] == [1, 2]
    repo.create("characters", {"name": "bob"})
    repo.create("characters", {"name": "Alice"})
    assert [x["name"] for x in repo.list("characters")] == ["Alice", "bob"]


def test_advance_turn_and_rounds():
    enc = {"round": 0, "turn": 0, "active": False, "combatants": [
        {"name": "A", "initiative": 5, "init_bonus": 0},
        {"name": "B", "initiative": 15, "init_bonus": 0},
        {"name": "C", "initiative": 15, "init_bonus": 3},
    ]}
    game.advance_turn(enc)  # start
    assert enc["active"] and enc["round"] == 1 and [c["name"] for c in enc["combatants"]] == ["C", "B", "A"]
    game.advance_turn(enc)
    game.advance_turn(enc)
    game.advance_turn(enc)
    assert enc["round"] == 2 and enc["turn"] == 0
    game.advance_turn(enc, -1)
    assert enc["round"] == 1 and enc["turn"] == 2


def test_hp_changes_use_temp_hp_first():
    c = {"hp": 10, "max_hp": 12, "temp_hp": 5}
    game.apply_hp_change(c, -7)
    assert (c["hp"], c["temp_hp"]) == (8, 0)
    game.apply_hp_change(c, 100)
    assert c["hp"] == 12
    game.apply_hp_change(c, -50)
    assert c["hp"] == 0
