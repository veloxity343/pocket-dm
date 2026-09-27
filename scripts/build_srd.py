"""Build the bundled SRD reference data from a checkout of 5e-bits/5e-database.

Usage:
    git clone --depth 1 https://github.com/5e-bits/5e-database.git
    uv run python scripts/build_srd.py path/to/5e-database

Writes src/pocket_dm/data/srd.json.gz: a flat list of searchable entries, each
with a Markdown body plus a small structured ``data`` dict for the features
that need numbers (initiative tracker, spell filters, inventory).
"""

from __future__ import annotations

import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "pocket_dm" / "data" / "srd.json.gz"

ATTRIBUTION = (
    "This work includes material taken from the System Reference Document 5.1 "
    '("SRD 5.1") by Wizards of the Coast LLC and available at '
    "https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is "
    "licensed under the Creative Commons Attribution 4.0 International License "
    "available at https://creativecommons.org/licenses/by/4.0/legalcode."
)

ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"]
ORDINAL = {1: "1st", 2: "2nd", 3: "3rd"}


def ordinal(n: int) -> str:
    return ORDINAL.get(n, f"{n}th")


def paras(desc) -> str:
    if desc is None:
        return ""
    if isinstance(desc, str):
        return desc.strip()
    return "\n\n".join(str(p).strip() for p in desc)


def names(refs) -> str:
    return ", ".join(r["name"] for r in refs or [])


def mod(score: int) -> str:
    m = (score - 10) // 2
    return f"{score} ({'+' if m >= 0 else ''}{m})"


def entry(category, index, name, body, summary="", tags=(), data=None):
    return {
        "id": f"{category}/{index}",
        "category": category,
        "name": name,
        "summary": summary,
        "tags": [t for t in tags if t],
        "body": body.strip(),
        "data": data or {},
    }


def load(src: Path, name: str):
    return json.loads((src / f"5e-SRD-{name}.json").read_text(encoding="utf-8"))


def build_rules(src):
    out = []
    parents = {}
    for rule in load(src, "Rules"):
        for sub in rule.get("subsections", []):
            parents[sub["index"]] = rule["name"]
    for sec in load(src, "Rule-Sections"):
        parent = parents.get(sec["index"], "")
        out.append(entry("rules", sec["index"], sec["name"], paras(sec["desc"]), parent, [parent]))
    return out


def build_simple(src, file, category, summary_fn=None):
    out = []
    for item in load(src, file):
        body = paras(item.get("desc"))
        summary = summary_fn(item) if summary_fn else ""
        out.append(entry(category, item["index"], item.get("full_name") or item["name"], body, summary))
    return out


def build_skills(src):
    out = []
    for s in load(src, "Skills"):
        ability = s["ability_score"]["name"]
        out.append(
            entry("skills", s["index"], s["name"], paras(s["desc"]), ability, [ability], {"ability": ability.lower()})
        )
    return out


def build_languages(src):
    out = []
    for lang in load(src, "Languages"):
        body = (
            f"**Type:** {lang.get('type', '')}\n\n"
            f"**Typical speakers:** {', '.join(lang.get('typical_speakers', []))}\n\n"
            f"**Script:** {lang.get('script') or '—'}"
        )
        if lang.get("desc"):
            body += "\n\n" + paras(lang["desc"])
        out.append(entry("languages", lang["index"], lang["name"], body, lang.get("type", "")))
    return out


def build_spells(src):
    out = []
    for s in load(src, "Spells"):
        lvl = s["level"]
        school = s["school"]["name"]
        head = f"{school} cantrip" if lvl == 0 else f"{ordinal(lvl)}-level {school.lower()}"
        if s.get("ritual"):
            head += " (ritual)"
        comps = ", ".join(s.get("components", []))
        if s.get("material"):
            comps += f" ({s['material']})"
        duration = s.get("duration", "")
        if s.get("concentration"):
            duration = f"Concentration, {duration[0].lower()}{duration[1:]}" if duration else "Concentration"
        body = (
            f"*{head}*\n\n"
            f"**Casting Time:** {s.get('casting_time', '')}  \n"
            f"**Range:** {s.get('range', '')}  \n"
            f"**Components:** {comps}  \n"
            f"**Duration:** {duration}\n\n"
            f"{paras(s.get('desc'))}"
        )
        if s.get("higher_level"):
            body += f"\n\n**At Higher Levels.** {paras(s['higher_level'])}"
        classes = [c["name"] for c in s.get("classes", [])]
        body += f"\n\n**Classes:** {', '.join(classes)}"
        out.append(
            entry(
                "spells",
                s["index"],
                s["name"],
                body,
                head,
                [school, *classes, "ritual" if s.get("ritual") else "", "concentration" if s.get("concentration") else ""],
                {
                    "level": lvl,
                    "school": school,
                    "classes": classes,
                    "ritual": bool(s.get("ritual")),
                    "concentration": bool(s.get("concentration")),
                    "casting_time": s.get("casting_time", ""),
                    "range": s.get("range", ""),
                    "duration": s.get("duration", ""),
                    "components": s.get("components", []),
                },
            )
        )
    return out


def fmt_cr(cr) -> str:
    return {0.125: "1/8", 0.25: "1/4", 0.5: "1/2"}.get(cr, str(int(cr)) if float(cr).is_integer() else str(cr))


def build_monsters(src):
    out = []
    for m in load(src, "Monsters"):
        ac_parts = []
        for ac in m.get("armor_class", []):
            label = ac.get("type", "")
            if ac.get("armor"):
                label = names(ac["armor"])
            elif ac.get("spell"):
                label = ac["spell"]["name"]
            ac_parts.append(f"{ac['value']}" + (f" ({label})" if label and label != "dex" else ""))
        ac_value = m["armor_class"][0]["value"] if m.get("armor_class") else 10
        speed = ", ".join(f"{k} {v}" if k != "walk" else str(v) for k, v in m.get("speed", {}).items() if k != "hover")
        if m.get("speed", {}).get("hover"):
            speed += " (hover)"
        subtype = f" ({m['subtype']})" if m.get("subtype") else ""
        kind = f"{m['size']} {m['type']}{subtype}, {m['alignment']}"
        cr = fmt_cr(m["challenge_rating"])
        lines = [f"*{kind}*", ""]
        lines.append(f"**Armor Class** {', '.join(ac_parts)}  ")
        lines.append(f"**Hit Points** {m['hit_points']} ({m.get('hit_points_roll') or m.get('hit_dice')})  ")
        lines.append(f"**Speed** {speed}")
        lines.append("")
        lines.append("| STR | DEX | CON | INT | WIS | CHA |")
        lines.append("|:---:|:---:|:---:|:---:|:---:|:---:|")
        lines.append("| " + " | ".join(mod(m[a]) for a in ABILITIES) + " |")
        lines.append("")
        saves = [p for p in m.get("proficiencies", []) if p["proficiency"]["index"].startswith("saving-throw")]
        skills = [p for p in m.get("proficiencies", []) if p["proficiency"]["index"].startswith("skill")]
        if saves:
            lines.append(
                "**Saving Throws** "
                + ", ".join(f"{p['proficiency']['name'].split(': ')[1].title()} +{p['value']}" for p in saves)
                + "  "
            )
        if skills:
            lines.append(
                "**Skills** " + ", ".join(f"{p['proficiency']['name'].split(': ')[1]} +{p['value']}" for p in skills) + "  "
            )
        for key, label in [
            ("damage_vulnerabilities", "Damage Vulnerabilities"),
            ("damage_resistances", "Damage Resistances"),
            ("damage_immunities", "Damage Immunities"),
        ]:
            if m.get(key):
                lines.append(f"**{label}** {', '.join(m[key])}  ")
        if m.get("condition_immunities"):
            lines.append(f"**Condition Immunities** {names(m['condition_immunities'])}  ")
        senses = ", ".join(
            f"{k.replace('_', ' ')} {v}" for k, v in m.get("senses", {}).items()
        )
        lines.append(f"**Senses** {senses}  ")
        lines.append(f"**Languages** {m.get('languages') or '—'}  ")
        lines.append(f"**Challenge** {cr} ({m.get('xp', 0):,} XP)")
        for key, label in [
            ("special_abilities", None),
            ("actions", "Actions"),
            ("reactions", "Reactions"),
            ("legendary_actions", "Legendary Actions"),
        ]:
            items = m.get(key) or []
            if not items:
                continue
            if label:
                lines.append(f"\n### {label}")
            for a in items:
                lines.append(f"\n***{a['name']}.*** {a.get('desc', '').strip()}")
        if m.get("desc"):
            lines.append("\n---\n\n" + paras(m["desc"]))
        dex_mod = (m["dexterity"] - 10) // 2
        out.append(
            entry(
                "monsters",
                m["index"],
                m["name"],
                "\n".join(lines),
                f"CR {cr} {m['size'].lower()} {m['type']}",
                [m["type"], m["size"], f"CR {cr}"],
                {
                    "cr": m["challenge_rating"],
                    "cr_label": cr,
                    "xp": m.get("xp", 0),
                    "type": m["type"],
                    "size": m["size"],
                    "ac": ac_value,
                    "hp": m["hit_points"],
                    "hp_roll": m.get("hit_points_roll") or m.get("hit_dice"),
                    "init_bonus": dex_mod,
                    "abilities": {a[:3]: m[a] for a in ABILITIES},
                },
            )
        )
    return out


def build_classes(src):
    features = {f["index"]: f for f in load(src, "Features")}
    levels = defaultdict(list)
    for lv in load(src, "Levels"):
        if "subclass" not in lv:
            levels[lv["class"]["index"]].append(lv)
    subclasses = defaultdict(list)
    for sc in load(src, "Subclasses"):
        subclasses[sc["class"]["index"]].append(sc)

    out = []
    for c in load(src, "Classes"):
        idx = c["index"]
        saves = [s["name"] for s in c.get("saving_throws", [])]
        profs = [p["name"] for p in c.get("proficiencies", []) if not p["index"].startswith("saving-throw")]
        lines = [
            f"**Hit Die:** d{c['hit_die']}  ",
            f"**Saving Throws:** {', '.join(saves)}  ",
            f"**Proficiencies:** {', '.join(profs) or '—'}  ",
        ]
        for choice in c.get("proficiency_choices", []):
            if choice.get("desc"):
                lines.append(f"**Skills:** {choice['desc']}  ")
        if c.get("starting_equipment"):
            lines.append(
                "**Starting Equipment:** "
                + ", ".join(f"{e['quantity']}× {e['equipment']['name']}" for e in c["starting_equipment"])
                + "  "
            )
        for opt in c.get("starting_equipment_options", []):
            if opt.get("desc"):
                lines.append(f"- {opt['desc']}")
        spell_levels = False
        rows = sorted(levels[idx], key=lambda lv: lv["level"])
        if any(lv.get("spellcasting") for lv in rows):
            spell_levels = True
        header = "| Level | Prof. | Features |"
        sep = "|---:|:---:|---|"
        if spell_levels:
            header += " Cantrips | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |"
            sep += "---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|"
        lines += ["", f"### The {c['name']}", "", header, sep]
        for lv in rows:
            feats = ", ".join(f["name"] for f in lv.get("features", [])) or "—"
            row = f"| {ordinal(lv['level'])} | +{lv.get('prof_bonus', '')} | {feats} |"
            if spell_levels:
                sp = lv.get("spellcasting") or {}
                row += f" {sp.get('cantrips_known', '—')} |" + "".join(
                    f" {sp.get(f'spell_slots_level_{i}', 0) or '—'} |" for i in range(1, 10)
                )
            lines.append(row)
        if c.get("spellcasting"):
            sc = c["spellcasting"]
            lines += ["", "### Spellcasting", f"**Spellcasting Ability:** {sc['spellcasting_ability']['name']}"]
            for info in sc.get("info", []):
                lines.append(f"\n**{info['name']}.** {paras(info['desc'])}")
        lines += ["", "### Class Features"]
        seen = set()
        for lv in rows:
            for ref in lv.get("features", []):
                f = features.get(ref["index"])
                if not f or f["name"] in seen:
                    continue
                seen.add(f["name"])
                lines.append(f"\n#### {f['name']} ({ordinal(f['level'])} level)\n\n{paras(f.get('desc'))}")
        for sc in subclasses.get(idx, []):
            lines.append(f"\n### {sc['subclass_flavor']}: {sc['name']}\n\n{paras(sc.get('desc'))}")
            for f in sorted(
                (f for f in features.values() if f.get("subclass", {}).get("index") == sc["index"]),
                key=lambda f: f["level"],
            ):
                lines.append(f"\n#### {f['name']} ({ordinal(f['level'])} level)\n\n{paras(f.get('desc'))}")
        slots = {}
        for lv in rows:
            sp = lv.get("spellcasting")
            if sp:
                slots[lv["level"]] = [sp.get(f"spell_slots_level_{i}", 0) for i in range(1, 10)]
        out.append(
            entry(
                "classes",
                idx,
                c["name"],
                "\n".join(lines),
                f"d{c['hit_die']} hit die · saves {', '.join(saves)}",
                [c["name"]],
                {
                    "hit_die": c["hit_die"],
                    "saves": [s.lower() for s in saves],
                    "spellcasting_ability": (c.get("spellcasting") or {}).get("spellcasting_ability", {}).get("index"),
                    "spell_slots": slots,
                    "subclasses": [sc["name"] for sc in subclasses.get(idx, [])],
                },
            )
        )
    return out


def build_races(src):
    traits = {t["index"]: t for t in load(src, "Traits")}
    subraces = defaultdict(list)
    for sr in load(src, "Subraces"):
        subraces[sr["race"]["index"]].append(sr)
    out = []
    for r in load(src, "Races"):
        bonuses = ", ".join(f"{b['ability_score']['name']} +{b['bonus']}" for b in r.get("ability_bonuses", []))
        lines = [
            f"**Ability Score Increase:** {bonuses or 'see below'}  ",
            f"**Speed:** {r['speed']} ft.  ",
            f"**Size:** {r['size']}. {r.get('size_description', '')}",
            "",
            f"**Age.** {r.get('age', '')}",
            "",
            f"**Alignment.** {r.get('alignment', '')}",
            "",
            f"**Languages.** {r.get('language_desc', '')}",
        ]
        for ref in r.get("traits", []):
            t = traits.get(ref["index"])
            if t:
                lines.append(f"\n**{t['name']}.** {paras(t.get('desc'))}")
        for sr in subraces.get(r["index"], []):
            b = ", ".join(f"{x['ability_score']['name']} +{x['bonus']}" for x in sr.get("ability_bonuses", []))
            lines.append(f"\n### {sr['name']}\n\n{paras(sr.get('desc'))}\n\n**Ability Score Increase:** {b}")
            for ref in sr.get("racial_traits", []):
                t = traits.get(ref["index"])
                if t:
                    lines.append(f"\n**{t['name']}.** {paras(t.get('desc'))}")
        out.append(
            entry(
                "races",
                r["index"],
                r["name"],
                "\n".join(lines),
                f"{r['size']} · {r['speed']} ft. · {bonuses}",
                [r["size"]],
                {"speed": r["speed"], "size": r["size"], "subraces": [s["name"] for s in subraces.get(r["index"], [])]},
            )
        )
    return out


def build_backgrounds(src):
    out = []
    for b in load(src, "Backgrounds"):
        lines = [f"**Skill Proficiencies:** {names(b.get('starting_proficiencies'))}"]
        if b.get("starting_equipment"):
            lines.append(
                "\n**Equipment:** "
                + ", ".join(f"{e['quantity']}× {e['equipment']['name']}" for e in b["starting_equipment"])
                + (f", {b['starting_gold']['quantity']} {b['starting_gold']['unit']}" if b.get("starting_gold") else "")
            )
        f = b.get("feature")
        if f:
            lines.append(f"\n### Feature: {f['name']}\n\n{paras(f.get('desc'))}")
        for key, label in [
            ("personality_traits", "Personality Traits"),
            ("ideals", "Ideals"),
            ("bonds", "Bonds"),
            ("flaws", "Flaws"),
        ]:
            opts = (b.get(key) or {}).get("from", {}).get("options", [])
            if opts:
                lines.append(f"\n**{label}**\n")
                for i, o in enumerate(opts, 1):
                    lines.append(f"{i}. {o.get('string') or o.get('desc', '')}")
        out.append(entry("backgrounds", b["index"], b["name"], "\n".join(lines)))
    return out


def build_feats(src):
    out = []
    for f in load(src, "Feats"):
        pre = ", ".join(
            f"{p['ability_score']['name']} {p['minimum_score']}+" for p in f.get("prerequisites", []) if "ability_score" in p
        )
        body = (f"*Prerequisite: {pre}*\n\n" if pre else "") + paras(f.get("desc"))
        out.append(entry("feats", f["index"], f["name"], body, pre))
    return out


def build_equipment(src):
    out = []
    for e in load(src, "Equipment"):
        cat = e["equipment_category"]["name"]
        cost = f"{e['cost']['quantity']} {e['cost']['unit']}" if e.get("cost") else "—"
        lines = [f"*{e.get('category_range') or (e.get('armor_category', '') + ' Armor' if e.get('armor_category') else cat)}*", ""]
        lines.append(f"**Cost:** {cost}  ")
        if e.get("weight") is not None:
            lines.append(f"**Weight:** {e['weight']} lb.  ")
        summary = cost
        if e.get("damage"):
            dmg = f"{e['damage']['damage_dice']} {e['damage']['damage_type']['name'].lower()}"
            lines.append(f"**Damage:** {dmg}  ")
            summary = f"{dmg} · {cost}"
        if e.get("two_handed_damage"):
            lines.append(f"**Two-Handed Damage:** {e['two_handed_damage']['damage_dice']}  ")
        if e.get("range") and e.get("weapon_range") == "Ranged":
            r = e["range"]
            lines.append(f"**Range:** {r.get('normal')}/{r.get('long')} ft.  ")
        if e.get("throw_range"):
            lines.append(f"**Thrown Range:** {e['throw_range']['normal']}/{e['throw_range']['long']} ft.  ")
        if e.get("properties"):
            lines.append(f"**Properties:** {names(e['properties'])}  ")
        if e.get("armor_class"):
            ac = e["armor_class"]
            txt = f"{ac['base']}"
            if ac.get("dex_bonus"):
                txt += " + Dex modifier" + (f" (max {ac['max_bonus']})" if ac.get("max_bonus") else "")
            if e["index"] == "shield":
                txt = f"+{ac['base']}"
            lines.append(f"**Armor Class:** {txt}  ")
            summary = f"AC {txt} · {cost}"
            if e.get("str_minimum"):
                lines.append(f"**Strength:** {e['str_minimum']}  ")
            if e.get("stealth_disadvantage"):
                lines.append("**Stealth:** Disadvantage  ")
        if e.get("speed"):
            lines.append(f"**Speed:** {e['speed']['quantity']} {e['speed']['unit']}  ")
        if e.get("contents"):
            lines.append("\n**Contents:** " + ", ".join(f"{c['quantity']}× {c['item']['name']}" for c in e["contents"]))
        if e.get("desc"):
            lines.append("\n" + paras(e["desc"]))
        if e.get("special"):
            lines.append("\n" + paras(e["special"]))
        out.append(
            entry(
                "equipment",
                e["index"],
                e["name"],
                "\n".join(lines),
                summary,
                [cat, e.get("weapon_category", ""), e.get("armor_category", "")],
                {"category": cat, "weight": e.get("weight"), "cost": cost, "damage": (e.get("damage") or {}).get("damage_dice")},
            )
        )
    return out


def build_magic_items(src):
    out = []
    for m in load(src, "Magic-Items"):
        if m.get("variant"):
            continue
        desc = m.get("desc") or []
        head, rest = (desc[0], desc[1:]) if desc else ("", [])
        rarity = m["rarity"]["name"]
        body = f"*{head}*\n\n{paras(rest)}"
        if m.get("variants"):
            body += f"\n\n**Variants:** {names(m['variants'])}"
        out.append(
            entry(
                "magic-items",
                m["index"],
                m["name"],
                body,
                head,
                [rarity, m["equipment_category"]["name"], "attunement" if "attunement" in head else ""],
                {"rarity": rarity},
            )
        )
    return out


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    src = Path(argv[1]) / "src" / "2014" / "en"
    entries = []
    entries += build_rules(src)
    entries += build_simple(src, "Conditions", "conditions")
    entries += build_simple(src, "Ability-Scores", "abilities", lambda a: a["name"])
    entries += build_skills(src)
    entries += build_classes(src)
    entries += build_races(src)
    entries += build_backgrounds(src)
    entries += build_feats(src)
    entries += build_spells(src)
    entries += build_monsters(src)
    entries += build_equipment(src)
    entries += build_magic_items(src)
    entries += build_simple(src, "Weapon-Properties", "weapon-properties")
    entries += build_simple(src, "Damage-Types", "damage-types")
    entries += build_simple(src, "Magic-Schools", "magic-schools")
    entries += build_simple(src, "Alignments", "alignments", lambda a: a["abbreviation"])
    entries += build_languages(src)
    payload = {
        "meta": {
            "title": "System Reference Document 5.1",
            "license": "CC-BY-4.0",
            "attribution": ATTRIBUTION,
            "source": "Converted from https://github.com/5e-bits/5e-database (MIT) by scripts/build_srd.py",
        },
        "entries": entries,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    OUT.write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    counts = defaultdict(int)
    for e in entries:
        counts[e["category"]] += 1
    print(f"wrote {OUT} ({len(entries)} entries, {OUT.stat().st_size // 1024} KiB)")
    for k, v in counts.items():
        print(f"  {k}: {v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
