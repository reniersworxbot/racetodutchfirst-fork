"""Fixture recording (`--record DIR`) never writes outside DIR, whatever names guilds.toml holds."""

from __future__ import annotations

import pytest

from racetodutchfirst.fixtures import fixture_path, name_part
from racetodutchfirst.raiderio import RecordingHTTP
from racetodutchfirst.raiderio import fixture_name as rio_name
from racetodutchfirst.wcl import API_URL, RecordingTransport
from racetodutchfirst.wcl import fixture_name as wcl_name

EVIL = "../../../../site/data/race"


class Response:
    def __init__(self, status_code: int, body: dict) -> None:
        self.status_code = status_code
        self._body = body

    def json(self) -> dict:
        return self._body


def test_name_parts_keep_the_committed_form():
    assert name_part("Twisting Nether") == "twisting-nether"
    assert name_part("Kelderklasse") == "kelderklasse"
    assert name_part(797151) == "797151"


@pytest.mark.parametrize("bad", [EVIL, "..", ".", "a/b", "a\\b", "x\x00y"])
def test_name_parts_never_carry_a_path(bad):
    part = name_part(bad)
    assert "/" not in part and "\\" not in part and part.strip(".") != ""


def test_fixture_path_refuses_a_name_outside_the_directory(tmp_path):
    assert fixture_path(tmp_path, "a.json") == (tmp_path / "a.json").resolve()
    for name in ("../a.json", "sub/a.json", "/etc/a.json"):
        with pytest.raises(ValueError):
            fixture_path(tmp_path, name)


def test_raiderio_recording_stays_in_its_directory(tmp_path):
    rec_dir = tmp_path / "rec"

    class Inner:
        def get(self, url):
            return Response(200, {"name": "x"})

    url = ("https://raider.io/api/v1/guilds/profile?region=eu&realm=draenor"
           "&name=..%2F..%2F..%2F..%2Fsite%2Fdata%2Frace&fields=raid_progression")
    RecordingHTTP(Inner(), rec_dir).get(url)
    written = [p for p in tmp_path.rglob("*") if p.is_file()]
    assert [p.parent for p in written] == [rec_dir]
    assert written[0].name == rio_name(url)


def test_wcl_recording_stays_in_its_directory(tmp_path):
    rec_dir = tmp_path / "rec"

    class Inner:
        def post(self, url, **kw):
            return Response(200, {"data": {}})

    body = {"query": "guildData", "variables": {"s": "../..", "n": EVIL}}
    RecordingTransport(Inner(), rec_dir).post(API_URL, json=body)
    written = [p for p in tmp_path.rglob("*") if p.is_file()]
    assert [p.parent for p in written] == [rec_dir]
    assert written[0].name == wcl_name(body)
