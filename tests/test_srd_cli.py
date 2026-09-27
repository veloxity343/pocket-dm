from pocket_dm import cli, srd
from pocket_dm.db import Database
from pocket_dm.repo import Repo


def test_srd_bundle_is_complete():
    cats = {c["id"]: c["count"] for c in srd.categories()}
    assert cats["spells"] == 319 and cats["monsters"] == 334 and cats["conditions"] == 15
    assert "Creative Commons" in srd.meta()["attribution"]


def test_srd_ranking_prefers_names():
    res = srd.search("goblin")
    assert res["results"][0]["name"] == "Goblin"
    assert srd.search("cr", "monsters", cr_label="1/4")["total"] > 5


def test_cli_roll_calc_srd(capsys):
    assert cli.main(["roll", "2d6+1", "-v"]) == 0
    assert "2d6" in capsys.readouterr().out
    assert cli.main(["calc", "mod(20)", "+", "prof(20)"]) == 0
    assert capsys.readouterr().out.strip() == "11"
    assert cli.main(["roll", "2d"]) == 1
    assert cli.main(["srd", "-c", "conditions", "prone"]) == 0
    assert "prone" in capsys.readouterr().out.lower()


def _names(data_dir, kind, field):
    with Database(data_dir).session() as s:
        return [d[field] for d in Repo(s).list(kind)]


def test_cli_export_import(tmp_path, capsys):
    a, b = tmp_path / "a", tmp_path / "b"
    with Database(a).session() as s:
        Repo(s).create("characters", {"name": "Cli"})
    out = tmp_path / "backup.json"
    assert cli.main(["--data-dir", str(a), "export", str(out)]) == 0
    md = tmp_path / "rules.md"
    md.write_text("# Flanking\n\nYes.")
    assert cli.main(["--data-dir", str(b), "import", str(out), str(md)]) == 0
    assert _names(b, "characters", "name") == ["Cli"]
    assert _names(b, "handbook", "title") == ["Flanking"]
