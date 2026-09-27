# Pocket DM

An all-in-one Dungeons & Dragons table manager that runs locally in your browser:
campaigns, live sessions with an initiative tracker, character sheets, the full
5e System Reference Document, your own handbook, and a dice roller and calculator.
Everything can be exported and imported.

- **Backend:** Python, [FastAPI](https://fastapi.tiangolo.com/), [SQLAlchemy](https://www.sqlalchemy.org/) ORM on SQLite
- **Frontend:** [React](https://react.dev/) + TypeScript, built with [Vite](https://vite.dev/)

## Quick start

```sh
cd frontend && npm install && npm run build && cd ..   # build the UI once
uv run pocket-dm                                       # starts the app and opens http://localhost:8765
```

Other options:

```sh
uv run pocket-dm serve --port 9000 --no-browser
uv run pocket-dm serve --host 0.0.0.0     # let devices on your network connect
uv run pocket-dm --data-dir ./my-table    # store the database somewhere specific
```

Data lives in a single SQLite file, `pocket-dm.db`, under `~/.local/share/pocket-dm`
(or `$POCKET_DM_DATA` / `--data-dir`).

## What's inside

| Area | What it does |
|---|---|
| **Campaigns** | Player roster (with linked characters and contact info), setting, DM notes, sessions, party overview. |
| **Sessions** | Initiative tracker (add the party, SRD monsters or custom NPCs; roll initiative; turn and round tracking; damage/heal with temp HP; conditions; statblocks in a side drawer). PC HP syncs back to their character sheet. Also a timestamped session log, prep and recap notes (Markdown), a loot table that hands items to characters, and XP awards. |
| **Characters** | Full 5e sheet: multiclassing, abilities and saves, skills (proficiency, expertise, half, Jack of All Trades), HP, hit dice, death saves, conditions, exhaustion, attacks with to-hit/damage/crit rolls, spellcasting (DC, attack, slots auto-filled from class levels, spells from the SRD), class resources, inventory with carrying weight, coins, features, personality. Short and long rests. Click any number to roll it. |
| **Rules & SRD** | All of SRD 5.1: rules, conditions, classes, races, spells (319), monsters (334), equipment, magic items and more, with search and filters (spell level, class, school, ritual, concentration; monster CR and type; item rarity). Dice in the text are clickable, e.g. "2d6" or "+5 to hit". |
| **Handbook** | Your own Markdown documents (house rules, NPCs, locations, factions, random tables and so on), with templates, live preview, tags and per-campaign scope. They show up in Rules & SRD search results. |
| **Dice & Calculator** | Dice pool builder, advantage/disadvantage, macros, roll history (which you can send to the session log), a calculator that understands dice, and quick calculators for ability modifiers, point buy, encounter XP, XP to level, coin splitting and spell DC. Press **R** anywhere to open the quick roller. |
| **Import / Export** | A full backup, or one campaign with everything linked to it, as JSON. Single characters, sessions and handbook entries export as JSON or Markdown. Imports accept any of these, plus `.md` files, in *overwrite*, *skip* or *copy* mode (copy gives records new ids and rewires the links between them, which suits sharing between DMs). Imports run in a single transaction: a bad file changes nothing. |

### Dice syntax

```
d20  3d6+2  2d20kh1 (advantage)  2d20kl1 (disadvantage)  adv+5  dis
4d6dl1 (drop lowest)  3d6! (exploding)  2d6ro2 (reroll ≤2 once)  2d6r1
d%  4dF  (1d8+3)*2  floor(8d6/2)  mod(16)  prof(5)
```

## Command line

```sh
uv run pocket-dm roll 2d20kh1+5 8d6 -v
uv run pocket-dm calc "mod(18) + prof(9)"
uv run pocket-dm srd fireball
uv run pocket-dm srd -c monsters dragon
uv run pocket-dm export backup.json [--campaign ID]
uv run pocket-dm import backup.json house-rules.md --mode skip
```

## Development

Run the API and the Vite dev server side by side for hot reloading:

```sh
uv run pocket-dm serve --no-browser     # API on :8765
cd frontend && npm run dev              # UI on :5173, proxies /api to :8765
```

Interactive API docs are at http://localhost:8765/docs.

```sh
uv run pytest                  # backend tests
cd frontend && npm run typecheck
```

### Layout

- `src/pocket_dm/app.py`: FastAPI app, routes and static UI serving
- `src/pocket_dm/models.py`: SQLAlchemy tables (campaigns, sessions, characters, handbook)
- `src/pocket_dm/schemas.py`: Pydantic schemas for API payloads and exports
- `src/pocket_dm/db.py`, `repo.py`: engine/session setup and record access
- `src/pocket_dm/game.py`: initiative tracker, rewards and rests
- `src/pocket_dm/dice.py`: dice and arithmetic parser/evaluator (no `eval`)
- `src/pocket_dm/rules.py`: 5e numbers and derived character stats
- `src/pocket_dm/transfer.py`: import and export (JSON bundles, Markdown)
- `frontend/src/`: the React UI (`views/` per page, `context/` for app-wide state)
- `scripts/build_srd.py`: regenerates `src/pocket_dm/data/srd.json.gz` from
  [5e-bits/5e-database](https://github.com/5e-bits/5e-database)

The database schema is created on startup. Nested sheet data (inventory, spells,
the encounter, etc.) is stored in JSON columns; links between records are real
foreign keys (deleting a campaign deletes its sessions and unlinks characters and
handbook entries).

## License and attribution

This work includes material taken from the System Reference Document 5.1
("SRD 5.1") by Wizards of the Coast LLC and available at
https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is
licensed under the Creative Commons Attribution 4.0 International License
available at https://creativecommons.org/licenses/by/4.0/legalcode.

The SRD data was converted from [5e-bits/5e-database](https://github.com/5e-bits/5e-database) (MIT).
