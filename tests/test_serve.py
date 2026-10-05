"""The self-hosted fetch loop: its schedule and what it writes into the published folder."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from racetodutchfirst import serve
from racetodutchfirst.schedule import SCHEDULE, _values, due, next_run

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"


def at(s: str) -> datetime:
    return datetime.fromisoformat(s).replace(tzinfo=UTC)


@pytest.mark.parametrize(("when", "expected"), [
    ("2026-10-04 19:35", True),   # Sunday, raid evening: every 5 min
    ("2026-10-05 17:00", True),   # Monday
    ("2026-10-07 23:55", True),   # Wednesday, last slot
    ("2026-10-08 20:05", True),   # Thursday
    ("2026-10-04 19:37", False),  # not on a 5-minute mark
    ("2026-10-06 19:35", False),  # Tuesday: hourly only
    ("2026-10-06 19:00", True),
    ("2026-10-09 03:00", True),   # Friday night: hourly
    ("2026-10-09 03:05", False),
    ("2026-10-05 16:55", False),  # Monday, before the evening
])
def test_due(when, expected):
    assert due(at(when)) is expected


def test_raid_evening_is_twelve_runs_an_hour():
    runs = sum(due(at(f"2026-10-04 20:{m:02d}")) for m in range(60))
    assert runs == 12


def test_next_run():
    assert next_run(at("2026-10-04 19:35")) == at("2026-10-04 19:40")
    assert next_run(at("2026-10-06 19:35")) == at("2026-10-06 20:00")


def test_cron_fields():
    assert _values("*/5", 0, 59) == set(range(0, 60, 5))
    assert _values("17-23", 0, 23) == set(range(17, 24))
    assert _values("0,1,3,4", 0, 6) == {0, 1, 3, 4}
    with pytest.raises(ValueError):
        _values("60", 0, 59)
    assert SCHEDULE  # never empty: the loop would never fetch


def test_sync_keeps_generated_files(tmp_path):
    www = tmp_path / "www"
    assert serve.sync_static(SITE, www) > 0
    assert (www / "app.js").read_bytes() == (SITE / "app.js").read_bytes()
    assert (www / "data" / "season-1.json").exists()
    # A run's race.json and index.html survive a restart with a new image.
    (www / "data" / "race.json").write_text('{"mine": true}')
    (www / "index.html").write_text("rendered")
    (www / "app.js").write_text("old code")
    serve.sync_static(SITE, www)
    assert (www / "data" / "race.json").read_text() == '{"mine": true}'
    assert (www / "index.html").read_text() == "rendered"
    assert (www / "app.js").read_bytes() == (SITE / "app.js").read_bytes()
    assert serve.sync_static(SITE, www) == 0  # nothing left to copy


def test_render_fills_the_template_not_the_last_output(tmp_path):
    www = tmp_path / "www"
    serve.sync_static(SITE, www)
    assert serve.render(SITE, www)
    first = (www / "index.html").read_text(encoding="utf-8")
    assert 'class="board"' in first and "<li" in first
    # Rendering again starts from the template (its markers), so it never fails on its own output.
    assert serve.render(SITE, www)
    assert (www / "index.html").read_text(encoding="utf-8") == first
    assert (www / "sitemap.xml").exists()
    assert not list(www.rglob("*.tmp"))


def test_render_keeps_the_page_on_broken_data(tmp_path):
    www = tmp_path / "www"
    serve.sync_static(SITE, www)
    serve.render(SITE, www)
    before = (www / "index.html").read_text(encoding="utf-8")
    (www / "data" / "race.json").write_text("{broken")
    assert serve.render(SITE, www) is False
    assert (www / "index.html").read_text(encoding="utf-8") == before


def test_failed_fetch_keeps_race_json(tmp_path, monkeypatch):
    www = tmp_path / "www"
    serve.sync_static(SITE, www)
    before = (www / "data" / "race.json").read_text(encoding="utf-8")

    class Done:
        returncode = 1

    calls = []
    monkeypatch.setattr(serve.subprocess, "run", lambda cmd, **kw: calls.append(cmd) or Done())
    assert serve.fetch(www) is False
    assert "--history" in calls[0]  # its own last race.json, so killed bosses aren't refetched
    assert (www / "data" / "race.json").read_text(encoding="utf-8") == before
    json.loads(before)
