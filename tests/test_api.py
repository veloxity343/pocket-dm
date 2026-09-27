import pytest


@pytest.fixture
def api(client):
    def call(method, path, body=None, headers=None, raw=False):
        res = client.request(method, path, json=body, headers=headers)
        return res.status_code, (res.text if raw else res.json())

    return call


def test_ui_and_spa_fallback(api):
    status, html = api("GET", "/", raw=True)
    assert status == 200 and "Pocket DM" in html
    assert api("GET", "/assets/app.js", raw=True)[0] == 200
    assert "Pocket DM" in api("GET", "/characters/abc", raw=True)[1]  # client-side route
    assert api("GET", "/api/nope")[0] == 404
    assert "Pocket DM" in api("GET", "/../pyproject.toml", raw=True)[1]


def test_openapi_docs(api):
    status, spec = api("GET", "/openapi.json")
    assert status == 200 and "/api/characters/{doc_id}" in spec["paths"]


def test_meta_and_roll(api):
    status, meta = api("GET", "/api/meta")
    assert status == 200 and "perception" in meta["skills"] and len(meta["conditions"]) == 15
    status, r = api("POST", "/api/roll", {"expression": "2d6+3"})
    assert status == 200 and 5 <= r["total"] <= 15
    status, r = api("GET", "/api/roll?expr=d20&times=3")
    assert len(r["results"]) == 3
    status, r = api("POST", "/api/roll", {"expression": "2d"})
    assert status == 400 and "detail" in r


def test_srd_search(api):
    _, r = api("GET", "/api/srd/search?q=fireball&category=spells")
    assert r["results"][0]["name"] == "Fireball"
    _, r = api("GET", "/api/srd/search?category=spells&level=0&classes=Wizard&limit=500")
    assert r["total"] > 5 and all(e["data"]["level"] == 0 and "Wizard" in e["data"]["classes"] for e in r["results"])
    _, e = api("GET", "/api/srd/entry?id=conditions/prone")
    assert "prone" in e["body"].lower()
    assert api("GET", "/api/srd/entry?id=nope")[0] == 404


def test_crud_and_cross_origin_block(api):
    status, c = api("POST", "/api/campaigns", {"name": "Tomb"})
    assert status == 201
    _, got = api("PUT", f"/api/campaigns/{c['id']}", {"notes": "traps"})
    assert got["notes"] == "traps" and got["name"] == "Tomb"
    _, lst = api("GET", "/api/campaigns")
    assert len(lst["campaigns"]) == 1
    status, _ = api("POST", "/api/campaigns", {"name": "evil"}, headers={"Origin": "http://evil.example"})
    assert status == 403
    assert api("DELETE", f"/api/campaigns/{c['id']}")[0] == 200
    assert api("GET", f"/api/campaigns/{c['id']}")[0] == 404


def test_encounter_flow(api):
    _, camp = api("POST", "/api/campaigns", {"name": "C"})
    _, ch = api("POST", "/api/characters", {"name": "Hero", "campaign_id": camp["id"], "hp": {"max": 20, "current": 20, "temp": 0}})
    _, s = api("POST", "/api/sessions", {"campaign_id": camp["id"]})
    path = f"/api/sessions/{s['id']}/encounter"
    _, s = api("POST", path, {"action": "add_character", "character_ids": [ch["id"]]})
    _, s = api("POST", path, {"action": "add_monster", "srd_id": "monsters/goblin", "count": 2})
    names = [c["name"] for c in s["encounter"]["combatants"]]
    assert names == ["Hero", "Goblin 1", "Goblin 2"]
    assert s["encounter"]["combatants"][1]["xp"] == 50
    _, s = api("POST", path, {"action": "roll_initiative"})
    assert all(c["initiative"] for c in s["encounter"]["combatants"])
    _, s = api("POST", path, {"action": "next"})
    assert s["encounter"]["active"] and s["encounter"]["round"] == 1
    hero = next(c for c in s["encounter"]["combatants"] if c["kind"] == "pc")
    _, s = api("POST", path, {"action": "hp", "id": hero["id"], "amount": -8})
    _, sheet = api("GET", f"/api/characters/{ch['id']}")
    assert sheet["hp"]["current"] == 12  # synced back to the character sheet
    for _ in range(3):
        _, s = api("POST", path, {"action": "next"})
    assert s["encounter"]["round"] == 2
    _, s = api("POST", path, {"action": "end"})
    assert not s["encounter"]["active"]
    assert any("Combat begins" in e["text"] for e in s["log"])
    assert api("POST", path, {"action": "explode"})[0] == 422


def test_award_xp_and_loot(api):
    _, ch = api("POST", "/api/characters", {"name": "Hero"})
    _, s = api("POST", "/api/sessions", {"loot": [{"name": "Potion of Healing", "qty": 2}]})
    _, s = api("POST", f"/api/sessions/{s['id']}/award", {"xp": 150, "character_ids": [ch["id"]]})
    assert s["xp_awarded"] == 150
    _, s = api("POST", f"/api/sessions/{s['id']}/award", {"loot_index": 0, "character_id": ch["id"]})
    assert s["loot"][0]["assigned_to"] == "Hero"
    _, sheet = api("GET", f"/api/characters/{ch['id']}")
    assert sheet["xp"] == 150 and sheet["inventory"][0]["name"] == "Potion of Healing"


def test_rest(api):
    _, ch = api("POST", "/api/characters", {
        "classes": [{"name": "Wizard", "level": 4}],
        "hp": {"max": 22, "current": 3, "temp": 2},
        "hit_dice": {"total": "4d6", "remaining": 0},
        "spellcasting": {"slots": {"1": {"max": 4, "used": 4}}},
        "resources": [{"name": "Arcane Recovery", "current": 0, "max": 1, "reset": "long"}, {"name": "Thing", "current": 0, "max": 2, "reset": "short"}],
    })
    _, short = api("POST", f"/api/characters/{ch['id']}/rest", {"type": "short"})
    assert [r["current"] for r in short["resources"]] == [0, 2]
    _, long_ = api("POST", f"/api/characters/{ch['id']}/rest", {"type": "long"})
    assert long_["hp"]["current"] == 22 and long_["hp"]["temp"] == 0
    assert long_["hit_dice"]["remaining"] == 2
    assert long_["spellcasting"]["slots"]["1"]["used"] == 0
    assert long_["resources"][0]["current"] == 1


def test_export_import_endpoints(api):
    _, ch = api("POST", "/api/characters", {"name": "Exported"})
    _, bundle = api("GET", "/api/export")
    assert bundle["collections"]["characters"][0]["name"] == "Exported"
    status, md = api("GET", f"/api/export/characters/{ch['id']}?format=md", raw=True)
    assert status == 200 and md.startswith("# Exported")
    _, single = api("GET", f"/api/export/characters/{ch['id']}")
    _, summary = api("POST", "/api/import?mode=copy", single)
    assert summary["imported"] == {"characters": 1}
    _, res = api("POST", "/api/import/markdown", {"files": [{"filename": "a.md", "text": "# Hello\n\nworld"}]})
    assert res["created"][0]["title"] == "Hello"
    assert api("POST", "/api/import", {"format": "other"})[0] == 400


def test_bad_campaign_link_is_400(api):
    status, r = api("POST", "/api/characters", {"campaign_id": "missing"})
    assert status == 400 and "campaign" in r["detail"]


def test_failed_import_writes_nothing(api):
    status, _ = api("POST", "/api/import", {"collections": {"handbook": [{"title": "ok"}], "characters": [{"classes": "bad"}]}})
    assert status == 400
    assert api("GET", "/api/handbook")[1]["handbook"] == []
