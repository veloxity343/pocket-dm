"""Command-line interface.

    pocket-dm                      start the app in your browser (same as ``serve``)
    pocket-dm roll 4d6dl1 adv+5    roll dice
    pocket-dm calc "mod(16) + prof(5)"
    pocket-dm srd fireball         look something up in the SRD
    pocket-dm export backup.json   export everything (or --campaign ID)
    pocket-dm import backup.json   import a bundle / single record / .md files
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__, dice, srd, transfer
from .db import Database
from .repo import Repo


def _db(args) -> Database:
    return Database(args.data_dir)


def cmd_serve(args) -> int:
    import threading
    import webbrowser

    import uvicorn

    from .app import create_app

    db = _db(args)
    url = f"http://{'localhost' if args.host in ('127.0.0.1', '0.0.0.0', '') else args.host}:{args.port}/"
    print(f"Pocket DM {__version__} running at {url}")
    print(f"Database: {db.path}")
    print("Press Ctrl+C to stop.")
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    uvicorn.run(create_app(db), host=args.host, port=args.port, log_level="info" if args.verbose else "warning")
    return 0


def cmd_roll(args) -> int:
    ok = True
    for expr in args.expressions:
        for _ in range(args.times):
            try:
                r = dice.roll(expr)
            except dice.DiceError as exc:
                print(f"{expr}: error: {exc}", file=sys.stderr)
                ok = False
                break
            flag = "  CRIT!" if r.critical else "  fumble" if r.fumble else ""
            print(f"{expr}: {r.breakdown.replace('~~', '')}{flag}" if args.verbose else f"{expr}: {r.total}{flag}")
    return 0 if ok else 1


def cmd_calc(args) -> int:
    expr = " ".join(args.expression)
    try:
        print(dice.calculate(expr))
    except dice.DiceError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


def cmd_srd(args) -> int:
    res = srd.search(" ".join(args.query), args.category or "", limit=args.limit)
    if not res["results"]:
        print("No matches.")
        return 1
    if len(res["results"]) == 1 or args.show:
        print(srd.get(res["results"][0]["id"])["body"])
        return 0
    for e in res["results"]:
        print(f"{e['id']:<40} {e['summary']}")
    if res["total"] > len(res["results"]):
        print(f"... {res['total'] - len(res['results'])} more")
    return 0


def cmd_export(args) -> int:
    with _db(args).session() as s:
        bundle = transfer.export_bundle(Repo(s), args.campaign)
    text = json.dumps(bundle, indent=2, ensure_ascii=False)
    if args.output == "-":
        print(text)
    else:
        Path(args.output).write_text(text, encoding="utf-8")
        counts = ", ".join(f"{len(v)} {k}" for k, v in bundle["collections"].items())
        print(f"Exported {counts} to {args.output}")
    return 0


def cmd_import(args) -> int:
    db = _db(args)
    status = 0
    for name in args.files:
        path = Path(name)
        text = path.read_text(encoding="utf-8")
        if path.suffix.lower() in (".md", ".markdown", ".txt"):
            with db.session() as s:
                entry = Repo(s).create("handbook", transfer.markdown_to_handbook(text, path.name))
            print(f"{name}: added handbook entry '{entry['title']}'")
            continue
        try:
            with db.session() as s:
                summary = transfer.import_data(Repo(s), json.loads(text), args.mode)
        except ValueError as exc:  # includes JSON, transfer and validation errors
            print(f"{name}: error: {exc}", file=sys.stderr)
            status = 1
            continue
        done = ", ".join(f"{v} {k}" for k, v in summary["imported"].items()) or "nothing"
        skipped = ", ".join(f"{v} {k}" for k, v in summary["skipped"].items())
        print(f"{name}: imported {done}" + (f" (skipped {skipped})" if skipped else ""))
    return status


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="pocket-dm", description="All-in-one D&D table manager.")
    p.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    p.add_argument("--data-dir", help="folder for the SQLite database (env: POCKET_DM_DATA)")
    sub = p.add_subparsers(dest="command")

    s = sub.add_parser("serve", help="start the web app (default)")
    s.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 to let players on your network connect")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--no-browser", action="store_true", help="don't open a browser window")
    s.add_argument("-v", "--verbose", action="store_true", help="log every request")
    s.set_defaults(func=cmd_serve)

    r = sub.add_parser("roll", help="roll dice, e.g. 2d20kh1+5, 8d6, 4d6dl1")
    r.add_argument("expressions", nargs="+")
    r.add_argument("-n", "--times", type=int, default=1)
    r.add_argument("-v", "--verbose", action="store_true", help="show individual dice")
    r.set_defaults(func=cmd_roll)

    c = sub.add_parser("calc", help="calculator; supports dice, mod(score), prof(level)")
    c.add_argument("expression", nargs="+")
    c.set_defaults(func=cmd_calc)

    q = sub.add_parser("srd", help="search the System Reference Document")
    q.add_argument("query", nargs="*")
    q.add_argument("-c", "--category", help="e.g. spells, monsters, rules, conditions")
    q.add_argument("-n", "--limit", type=int, default=20)
    q.add_argument("-s", "--show", action="store_true", help="print the best match in full")
    q.set_defaults(func=cmd_srd)

    e = sub.add_parser("export", help="export data to a JSON bundle")
    e.add_argument("output", nargs="?", default="-", help="file to write (default: stdout)")
    e.add_argument("--campaign", help="export only this campaign and its linked records")
    e.set_defaults(func=cmd_export)

    i = sub.add_parser("import", help="import JSON exports or Markdown handbook files")
    i.add_argument("files", nargs="+")
    i.add_argument("--mode", choices=transfer.IMPORT_MODES, default="overwrite")
    i.set_defaults(func=cmd_import)
    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if not args.command:
        args.host, args.port, args.no_browser, args.verbose = "127.0.0.1", 8765, False, False
        args.func = cmd_serve
    return args.func(args)
