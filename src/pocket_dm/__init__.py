"""Pocket DM: an all-in-one Dungeons & Dragons table manager."""

__version__ = "0.1.0"


def main() -> None:
    from .cli import main as cli_main

    raise SystemExit(cli_main())
