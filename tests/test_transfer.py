import pytest

from pocket_dm import transfer
from pocket_dm.db import Database
from pocket_dm.repo import Repo


@pytest.fixture
def new_repo(tmp_path):
    """Open a fresh database; each call gets its own."""
    opened = []

    def make(name):
        db = Database(tmp_path / name)
        ctx = db.session()
        opened.append((db, ctx))
        return Repo(ctx.__enter__())

    yield make
    for db, ctx in opened:
        ctx.__exit__(None, None, None)
        db.dispose()


@pytest.fixture
def populated(new_repo):
    s = new_repo("a")
    camp = s.create("campaigns", {"name": "Phandelver"})
    ch = s.create("characters", {"name": "Thorin", "campaign_id": camp["id"], "classes": [{"name": "Fighter", "level": 3}]})
    camp["players"] = [{"name": "Sam", "character_id": ch["id"], "contact": "", "notes": ""}]
    s.save("campaigns", camp)
    sess = s.create("sessions", {"campaign_id": camp["id"], "title": "Goblin Arrows"})
    sess["encounter"]["combatants"] = [{"id": "x1", "name": "Thorin", "kind": "pc", "character_id": ch["id"]}]
    s.save("sessions", sess)
    s.create("handbook", {"title": "Crits", "campaign_id": camp["id"], "body": "Max the dice."})
    s.create("characters", {"name": "Unrelated"})
    return s, camp, ch


def test_full_roundtrip(populated, new_repo):
    s, camp, ch = populated
    bundle = transfer.export_bundle(s)
    assert bundle["format"] == "pocket-dm"
    assert len(bundle["collections"]["characters"]) == 2
    other = new_repo("b")
    summary = transfer.import_data(other, bundle)
    assert summary["imported"] == {"campaigns": 1, "sessions": 1, "characters": 2, "handbook": 1}
    assert other.get("characters", ch["id"])["name"] == "Thorin"
    assert other.get("campaigns", camp["id"])["created"] == camp["created"]


def test_campaign_export_only_includes_linked(populated):
    s, camp, _ = populated
    bundle = transfer.export_bundle(s, camp["id"])
    assert [c["name"] for c in bundle["collections"]["characters"]] == ["Thorin"]


def test_skip_mode_keeps_existing(populated):
    s, camp, ch = populated
    bundle = transfer.export_bundle(s)
    edited = s.get("characters", ch["id"])
    edited["name"] = "Thorin Renamed"
    s.save("characters", edited)
    summary = transfer.import_data(s, bundle, "skip")
    assert summary["skipped"]["characters"] == 2
    assert s.get("characters", ch["id"])["name"] == "Thorin Renamed"


def test_copy_mode_remaps_links(populated):
    s, camp, ch = populated
    bundle = transfer.export_bundle(s, camp["id"])
    transfer.import_data(s, bundle, "copy")
    camps = s.list("campaigns")
    assert len(camps) == 2
    new_camp = next(c for c in camps if c["id"] != camp["id"])
    new_char_id = new_camp["players"][0]["character_id"]
    assert new_char_id != ch["id"]
    assert s.get("characters", new_char_id)["campaign_id"] == new_camp["id"]
    new_sess = s.list("sessions", campaign_id=new_camp["id"])[0]
    assert new_sess["encounter"]["combatants"][0]["character_id"] == new_char_id


def test_single_record_export_import(populated, new_repo):
    s, _, ch = populated
    payload = transfer.export_one(s, "characters", ch["id"])
    assert payload["kind"] == "character"
    other = new_repo("c")
    assert transfer.import_data(other, payload)["imported"] == {"characters": 1}


@pytest.mark.parametrize(
    "payload",
    [[], {"format": "foundry"}, {"collections": "nope"}, {"kind": "dragon", "data": {}}, {"hello": 1}, {"version": 99, "collections": {}}],
)
def test_bad_payloads(repo, payload):
    with pytest.raises(transfer.TransferError):
        transfer.import_data(repo, payload)


def test_import_is_all_or_nothing(repo):
    s = repo
    with pytest.raises(transfer.TransferError):
        transfer.import_data(s, {"collections": {"handbook": [{"title": "ok"}], "characters": "not-a-list"}})
    assert s.list("handbook") == []


def test_markdown_handbook_import():
    e = transfer.markdown_to_handbook("# Flanking\n\nAdvantage when flanking.\n", "x.md")
    assert e["title"] == "Flanking" and e["body"] == "Advantage when flanking."
    e = transfer.markdown_to_handbook("no heading here", "my_rules.md")
    assert e["title"] == "my rules"


def test_character_markdown(populated):
    s, _, ch = populated
    md = transfer.character_markdown(s.get("characters", ch["id"]))
    assert md.startswith("# Thorin")
    assert "Fighter 3" in md and "Proficiency Bonus** +2" in md


def test_import_drops_links_to_missing_campaigns(repo):
    payload = {"kind": "character", "data": {"id": "abc123", "name": "Orphan", "campaign_id": "gone"}}
    transfer.import_data(repo, payload)
    assert repo.get("characters", "abc123")["campaign_id"] == ""
