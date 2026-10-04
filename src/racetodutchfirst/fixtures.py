"""File names for recorded fixtures (`--record DIR`), safe whatever guilds.toml holds.

Guild, realm and boss names come from the configuration and from API answers. Used raw in a
file name, a name like `../../site/data/race` would write outside the recording directory, so
every part is reduced to [a-z0-9._-] and the finished path must stay directly in that
directory. Ordinary names keep the form the committed fixtures already use
("Twisting Nether" -> "twisting-nether").
"""

from __future__ import annotations

import re
from pathlib import Path

_UNSAFE = re.compile(r"[^a-z0-9._-]")


def name_part(value: object) -> str:
    """One part of a fixture name: lower case, spaces as dashes, anything else unsafe as a dash.

    A part made only of dots ("." or "..") becomes dashes too, so it can never name a directory."""
    part = _UNSAFE.sub("-", str(value).lower().replace(" ", "-"))
    return "-" * len(part) if part.strip(".") == "" else part


def fixture_path(directory: Path, name: str) -> Path:
    """`directory / name`, refusing any name that would land anywhere else."""
    base = directory.resolve()
    path = (base / name).resolve()
    if path.parent != base:
        raise ValueError(f"fixture name escapes the recording directory: {name!r}")
    return path
