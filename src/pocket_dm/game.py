"""Table-side game logic: the initiative tracker, rewards and rests."""

from __future__ import annotations

from . import dice, models, rules, schemas, srd
from .repo import NotFound, Repo


def _combatant(data: dict) -> dict:
    return schemas.Combatant.model_validate(data).model_dump()


def _log(session: dict, text: str, kind: str) -> None:
    session["log"].append({"id": models.new_id(), "time": models.now(), "kind": kind, "text": text})


# --------------------------------------------------------------------------- encounter helpers


def sort_initiative(encounter: dict) -> None:
    """Order combatants by initiative, breaking ties on initiative bonus."""
    encounter["combatants"].sort(key=lambda c: (-c["initiative"], -c["init_bonus"], c["name"]))


def advance_turn(encounter: dict, step: int = 1) -> None:
    combatants = encounter["combatants"]
    if not combatants:
        encounter.update(round=0, turn=0, active=False)
        return
    if not encounter["active"]:
        sort_initiative(encounter)
        encounter.update(active=True, round=1, turn=0)
        return
    turn = encounter["turn"] + step
    rnd = encounter["round"]
    while turn >= len(combatants):
        turn -= len(combatants)
        rnd += 1
    while turn < 0:
        if rnd <= 1:
            turn = 0
            break
        turn += len(combatants)
        rnd -= 1
    encounter.update(turn=turn, round=rnd)


def apply_hp_change(combatant: dict, amount: int) -> None:
    """Negative amount = damage (temp HP absorbs first), positive = healing."""
    if amount < 0:
        dmg = -amount
        absorbed = min(combatant.get("temp_hp", 0), dmg)
        combatant["temp_hp"] = combatant.get("temp_hp", 0) - absorbed
        combatant["hp"] = max(0, combatant["hp"] - (dmg - absorbed))
    else:
        cap = combatant["max_hp"] or combatant["hp"] + amount
        combatant["hp"] = min(cap, combatant["hp"] + amount)


def _roll_hp(entry: dict, average: bool) -> int:
    hp = entry["data"].get("hp", 1)
    if not average and entry["data"].get("hp_roll"):
        try:
            return max(1, int(dice.roll(entry["data"]["hp_roll"]).total))
        except dice.DiceError:
            pass
    return hp


def _sync_pc(repo: Repo, combatant: dict) -> None:
    """Keep a linked character sheet's HP in step with the tracker."""
    if combatant["kind"] != "pc" or not combatant["character_id"]:
        return
    try:
        ch = repo.get("characters", combatant["character_id"])
    except NotFound:
        return
    ch["hp"]["current"] = combatant["hp"]
    ch["hp"]["temp"] = combatant["temp_hp"]
    repo.save("characters", ch)


# --------------------------------------------------------------------------- encounter actions


def encounter_action(repo: Repo, session_id: str, body: schemas.EncounterAction) -> dict:
    session = repo.get("sessions", session_id)
    enc = session["encounter"]
    combatants = enc["combatants"]
    action = body.action

    def find(cid: str) -> dict:
        for c in combatants:
            if c["id"] == cid:
                return c
        raise NotFound("combatant not found")

    if action == "add":
        c = _combatant(body.combatant)
        c["id"] = models.new_id()
        c["max_hp"] = c["max_hp"] or c["hp"]
        combatants.append(c)
    elif action == "add_monster":
        entry = srd.get(body.srd_id)
        if not entry or entry["category"] != "monsters":
            raise NotFound("monster not found")
        existing = sum(1 for c in combatants if c["srd_id"] == entry["id"])
        for i in range(body.count):
            hp = _roll_hp(entry, body.average_hp)
            n = existing + i + 1
            combatants.append(
                _combatant(
                    {
                        "id": models.new_id(),
                        "name": entry["name"] if body.count == 1 and existing == 0 else f"{entry['name']} {n}",
                        "kind": "monster",
                        "ac": entry["data"]["ac"],
                        "hp": hp,
                        "max_hp": hp,
                        "init_bonus": entry["data"]["init_bonus"],
                        "srd_id": entry["id"],
                        "xp": entry["data"].get("xp", 0),
                        "notes": entry["summary"],
                    }
                )
            )
    elif action == "add_character":
        for cid in body.character_ids or [body.character_id]:
            ch = repo.get("characters", cid)
            combatants.append(
                _combatant(
                    {
                        "id": models.new_id(),
                        "name": ch["name"],
                        "kind": "pc",
                        "ac": ch["ac"],
                        "hp": ch["hp"]["current"],
                        "max_hp": ch["hp"]["max"],
                        "temp_hp": ch["hp"]["temp"],
                        "init_bonus": rules.derive(ch)["initiative"],
                        "character_id": ch["id"],
                        "conditions": list(ch["conditions"]),
                    }
                )
            )
    elif action == "update":
        c = find(body.id)
        changes = {k: v for k, v in body.changes.items() if k in c and k != "id"}
        c.update(_combatant({**c, **changes}))
    elif action == "remove":
        c = find(body.id)
        idx = combatants.index(c)
        combatants.remove(c)
        if enc["active"] and idx < enc["turn"]:
            enc["turn"] -= 1
        if enc["turn"] >= len(combatants):
            enc["turn"] = 0
    elif action == "hp":
        c = find(body.id)
        before = c["hp"]
        apply_hp_change(c, body.amount)
        verb = "takes" if body.amount < 0 else "heals"
        _log(session, f"{c['name']} {verb} {abs(body.amount)} ({before} → {c['hp']} HP)", "combat")
        if c["hp"] == 0 and before > 0:
            _log(session, f"{c['name']} drops to 0 HP", "combat")
        _sync_pc(repo, c)
    elif action == "roll_initiative":
        for c in combatants:
            if body.which == "monsters" and c["kind"] == "pc":
                continue
            if body.which == "unset" and c["initiative"]:
                continue
            c["initiative"] = int(dice.roll(f"d20{c['init_bonus']:+d}").total)
        sort_initiative(enc)
    elif action == "sort":
        sort_initiative(enc)
    elif action == "next":
        was_active, prev_round = enc["active"], enc["round"]
        advance_turn(enc, 1)
        if not was_active and enc["active"]:
            _log(session, "Combat begins — round 1", "combat")
        elif enc["round"] != prev_round:
            _log(session, f"Round {enc['round']} begins", "combat")
    elif action == "prev":
        advance_turn(enc, -1)
    elif action == "end":
        if enc["active"]:
            _log(session, f"Combat ends after {enc['round']} round(s)", "combat")
        for c in combatants:
            _sync_pc(repo, c)
        enc.update(active=False, round=0, turn=0)
    elif action == "clear":
        kept = [] if body.all else [c for c in combatants if c["kind"] == "pc"]
        enc.update(active=False, round=0, turn=0, combatants=kept)
    return repo.save("sessions", session)


# --------------------------------------------------------------------------- rewards, log, rests


def award(repo: Repo, session_id: str, body: schemas.Award) -> dict:
    """Give XP to characters, or hand a loot item to a character's inventory."""
    session = repo.get("sessions", session_id)
    if body.xp is not None:
        if not body.character_ids:
            raise ValueError("choose at least one character")
        names = []
        for cid in body.character_ids:
            ch = repo.get("characters", cid)
            ch["xp"] = max(0, ch["xp"] + body.xp)
            repo.save("characters", ch)
            names.append(ch["name"])
        session["xp_awarded"] += body.xp
        _log(session, f"{body.xp} XP awarded to {', '.join(names)}", "loot")
    elif body.loot_index is not None:
        if not 0 <= body.loot_index < len(session["loot"]):
            raise NotFound("loot item not found")
        item = session["loot"][body.loot_index]
        ch = repo.get("characters", body.character_id)
        ch["inventory"].append(
            {"name": item["name"], "qty": item["qty"] or 1, "weight": 0, "equipped": False, "notes": item["value"]}
        )
        repo.save("characters", ch)
        item["assigned_to"] = ch["name"]
        _log(session, f"{ch['name']} receives {item['name']}", "loot")
    else:
        raise ValueError("nothing to award")
    return repo.save("sessions", session)


def add_log(repo: Repo, session_id: str, body: schemas.LogIn) -> dict:
    session = repo.get("sessions", session_id)
    text = body.text.strip()
    if not text:
        raise ValueError("empty log entry")
    _log(session, text, body.kind or "note")
    return repo.save("sessions", session)


def rest(repo: Repo, character_id: str, kind: str) -> dict:
    """Apply a short or long rest to a character sheet."""
    ch = repo.get("characters", character_id)
    if kind == "long":
        ch["hp"]["current"] = ch["hp"]["max"]
        ch["hp"]["temp"] = 0
        level = rules.total_level(ch)
        ch["hit_dice"]["remaining"] = min(level, ch["hit_dice"]["remaining"] + max(1, level // 2))
        for slot in ch["spellcasting"]["slots"].values():
            slot["used"] = 0
        ch["death_saves"] = {"successes": 0, "failures": 0}
        ch["exhaustion"] = max(0, ch["exhaustion"] - 1)
        resets = ("long", "short")
    elif kind == "short":
        resets = ("short",)
    else:
        raise ValueError("rest type must be short or long")
    for r in ch["resources"]:
        if r["reset"] in resets:
            r["current"] = r["max"]
    return repo.save("characters", ch)
