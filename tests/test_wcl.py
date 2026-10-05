"""Warcraft Logs merged into Raider.IO, on recorded answers from 2026-10-02."""

from __future__ import annotations

from datetime import UTC, datetime

from racetodutchfirst.race import build_race, fetch_guild, merge_wcl, wcl_fights_for
from racetodutchfirst.wcl import API_URL, TOKEN_URL, RecordingTransport, WarcraftLogs, dedupe
from tests.conftest import FixtureWCL, Response, guild

NOW = datetime(2026, 10, 2, 21, 45, tzinfo=UTC)


def _wcl(sleeps=None, status=200):
    return WarcraftLogs(FixtureWCL(status), "id", "secret",
                        sleep=(sleeps.append if sleeps is not None else lambda _s: None))


def _fetch(rio, config, name, wcl=None):
    g = guild(config, name)
    gid, fights = wcl_fights_for(wcl or _wcl(), g, config.tier)
    return fetch_guild(rio, g, config.tier, wcl_fights=fights, wcl_id=gid)


def _boss(g, slug):
    return next(b for b in g["bosses"] if b["slug"] == slug)


def test_duplicate_reports_count_once(rio, config):
    # Several Kameraden members log the same night: 259 fights, 152 real pulls.
    g = guild(config, "Kameraden")
    _gid, fights = wcl_fights_for(_wcl(), g, config.tier)
    assert len(fights) == 152
    sszorak = [f for f in fights if f["encounter"] == 3420]
    assert len(sszorak) == 40 and min(f["percent"] for f in sszorak) == 43.73


def test_dedupe_keeps_the_kill_and_lowest_percent():
    a = {"encounter": 1, "kill": False, "percent": 12.5, "start": 0, "end": 300_000, "report": "a"}
    b = {"encounter": 1, "kill": True, "percent": 0.0, "start": 2_000, "end": 301_000, "report": "b"}
    nxt = {"encounter": 1, "kill": False, "percent": 50.0, "start": 400_000, "end": 500_000, "report": "a"}
    out = dedupe([a, b, nxt])
    assert len(out) == 2 and out[0]["kill"] and out[0]["percent"] == 0.0


def test_most_pulls_wins_per_boss(rio, config):
    g = _fetch(rio, config, "Kameraden")
    nek = _boss(g, "nekzali-the-soulcoiler")
    assert (nek["pullCount"], nek["pullSource"]) == (12, "warcraftlogs")  # Raider.IO saw 9
    cur = g["current"]
    assert (cur["slug"], cur["pullCount"], cur["pullSource"]) == ("sszorak", 41, "raiderio")
    assert cur["bestPercent"] == 43.73


def test_curve_comes_from_wcl_when_it_saw_more(rio, http, config):
    g = guild(config, "Kameraden")
    gid, fights = wcl_fights_for(_wcl(), g, config.tier)
    t = 1_759_430_000_000
    fights += [_fight(t + i * 600_000, pct=60.0) for i in range(5)]  # 40 + 5 > 41
    out = fetch_guild(rio, g, config.tier, wcl_fights=fights, wcl_id=gid)
    assert (out["current"]["pullCount"], out["current"]["pullSource"]) == (45, "warcraftlogs")
    assert len(out["current"]["pulls"]) == 45
    # The current boss's curve is WCL's: no Raider.IO boss-pulls for it (killed bosses still
    # get theirs, for the progress through each tread).
    cur = out["current"]["slug"]
    assert not any("boss-pulls" in u and f"boss={cur}&" in u for u in http.urls)


def test_earlier_raiderio_kill_beats_a_later_logged_one(rio, config):
    # Lelijkerds logged their first Mythic kills a week after Raider.IO's dates.
    g = _fetch(rio, config, "Lelijkerds")
    assert _boss(g, "nekzali-the-soulcoiler")["defeatedAt"].startswith("2026-09-21")
    assert _boss(g, "the-lost-explorers")["defeatedAt"].startswith("2026-09-24")
    entombed = _boss(g, "entombed-sentinels")
    assert (entombed["bestPercent"], entombed["pullCount"], entombed["pullSource"]) == (
        2.35, 48, "raiderio")
    assert g["racePosition"] == 2.9765


def _teams(race):
    return {g["name"]: g for g in race["guilds"] if g.get("team")}


def test_royalteam_races_as_two_teams_from_their_own_logs(rio, config):
    # Raider.IO only knows RoyalTeam; its teams log to their own WCL guilds (recorded 2026-10-05).
    race = build_race(rio, config, NOW, log=lambda _m: None, wcl=_wcl())
    teams = _teams(race)
    assert set(teams) == {"RoyalTeam Crusaders", "RoyalTeam Templars"}
    assert "RoyalTeam" not in [g["name"] for g in race["guilds"]]
    cru, tem = teams["RoyalTeam Crusaders"], teams["RoyalTeam Templars"]
    assert cru["sources"] == ["warcraftlogs"] and cru["team"] == {"of": "RoyalTeam"}
    assert cru["wclUrl"] == "https://www.warcraftlogs.com/guild/id/744461"
    assert cru["worldRank"] is None  # Raider.IO ranks the guild, not a team
    assert cru["mythicKills"] == 1 and cru["current"]["slug"] == "the-lost-explorers"
    assert cru["current"]["bestPercent"] == 0.49 and len(cru["current"]["pulls"]) == 26
    assert tem["mythicKills"] == 2 and tem["current"]["slug"] == "entombed-sentinels"
    assert _boss(tem, "the-lost-explorers")["defeatedAt"].startswith("2026-10-01T20:30")


def test_raiderio_rosters_go_to_the_team_whose_kill_matches(rio, config):
    race = build_race(rio, config, NOW, log=lambda _m: None, wcl=_wcl())
    fame = {b["slug"]: {t["guild"]: t for t in b["teams"]} for b in race["hallOfFame"]["bosses"]}
    # Raider.IO's RoyalTeam kills: Nek'zali 14 Sep (Crusaders), The Lost Explorers 1 Oct (Templars).
    assert fame["nekzali-the-soulcoiler"]["RoyalTeam Crusaders"]["rosterKnown"] is True
    assert fame["nekzali-the-soulcoiler"]["RoyalTeam Templars"]["rosterKnown"] is False
    assert fame["the-lost-explorers"]["RoyalTeam Templars"]["rosterKnown"] is True


def test_without_wcl_royalteam_races_as_one(rio, config):
    race = build_race(rio, config, NOW, log=lambda _m: None)
    names = [g["name"] for g in race["guilds"]]
    assert "RoyalTeam" in names and not _teams(race)


def test_nymrissa_matched_by_encounter_not_zone(rio, config):
    # Zone 53 lists Nymrissa; she belongs to The Tidebound Grotto.
    g = _fetch(rio, config, "Knikkerende Krijgers")
    nym = _boss(g, "nymrissa-wavecaller")
    assert nym["raid"] == "the-tidebound-grotto"
    assert nym["state"] == "progress" and nym["pullCount"] == 11
    assert g["raids"]["the-venomous-abyss"]["mythic"] == 4


def _states(**kw):
    st = {"raid": "the-venomous-abyss", "slug": "sszorak", "name": "Sszorak",
          "state": "progress", "defeatedAt": None, "pullCount": 10,
          "pullSource": "raiderio", "bestPercent": 40.0}
    st.update(kw)
    return {"the-venomous-abyss/sszorak": st}


def _fight(start, kill=False, pct=50.0, enc=3420):
    return {"encounter": enc, "kill": kill, "percent": pct, "start": start, "end": start + 60_000,
            "report": "x"}


def test_logged_kill_raiderio_does_not_know_yet(config):
    states = _states()
    t = datetime(2026, 10, 2, 20, tzinfo=UTC).timestamp() * 1000
    merge_wcl(states, config.tier, [_fight(t + i * 600_000, pct=30.0 - i) for i in range(11)]
              + [_fight(t + 11 * 600_000, kill=True, pct=0.0)])
    st = states["the-venomous-abyss/sszorak"]
    assert st["state"] == "killed" and st["bestPercent"] is None
    assert st["defeatedAt"] == "2026-10-02T21:51:00.000Z"
    assert (st["pullCount"], st["pullSource"]) == (12, "warcraftlogs")


def test_reclears_after_the_kill_are_not_pulls(config):
    states = _states(pullCount=None, pullSource=None, bestPercent=None, state="untouched")
    t = 1_758_000_000_000
    merge_wcl(states, config.tier, [_fight(t), _fight(t + 600_000, kill=True),
                                    _fight(t + 7 * 86_400_000, kill=True)])
    assert states["the-venomous-abyss/sszorak"]["pullCount"] == 2


def test_lowest_best_percent_of_both_sources(config):
    states = _states(bestPercent=40.0)
    merge_wcl(states, config.tier, [_fight(1, pct=35.5), _fight(2, pct=None)])
    assert states["the-venomous-abyss/sszorak"]["bestPercent"] == 35.5
    states = _states(bestPercent=20.0)
    merge_wcl(states, config.tier, [_fight(1, pct=35.5)])
    assert states["the-venomous-abyss/sszorak"]["bestPercent"] == 20.0


def test_unknown_encounters_are_ignored(config):
    states = _states()
    merge_wcl(states, config.tier, [_fight(1, kill=True, enc=3513)])  # Kith'ix
    assert states["the-venomous-abyss/sszorak"]["state"] == "progress"


def test_new_wcl_kill_raises_the_kill_count(rio, config):
    g = guild(config, "Kameraden")
    gid, fights = wcl_fights_for(_wcl(), g, config.tier)
    fights.append(_fight(1_759_440_000_000, kill=True, pct=0.0))  # 2026-10-02 21:20Z
    out = fetch_guild(rio, g, config.tier, wcl_fights=fights, wcl_id=gid)
    assert out["mythicKills"] == 5
    assert _boss(out, "sszorak")["state"] == "killed"
    assert out["current"]["slug"] != "sszorak"


def test_wcl_down_means_raiderio_only(rio, config, capsys):
    race = build_race(rio, config, NOW, log=lambda _m: None, wcl=_wcl(status=503))
    assert race["sources"]["warcraftlogs"] is False
    assert [g["racePosition"] for g in race["guilds"]] == [5.7298, 4.5627, 4.3304, 2.9765, 2.0]
    assert "Warcraft Logs overgeslagen" in capsys.readouterr().err


def test_full_run_with_wcl(rio, config):
    race = build_race(rio, config, NOW, log=lambda _m: None, wcl=_wcl())
    assert race["sources"]["warcraftlogs"] is True
    assert [g["name"] for g in race["guilds"]][:3] == [
        "Kelderklasse", "Kameraden", "Knikkerende Krijgers"]
    kk = race["guilds"][2]["current"]
    assert (kk["pullCount"], kk["pullSource"]) == (24, "raiderio")
    kel = race["guilds"][0]
    assert (_boss(kel, "sszorak")["pullCount"], _boss(kel, "sszorak")["pullSource"]) == (
        82, "warcraftlogs")


def test_wcl_requests_are_paced():
    sleeps = []
    wcl = _wcl(sleeps)
    wcl.mythic_fights(797151, 53, "2026-08-19")
    assert wcl.requests == len(sleeps) == 2  # token + one page
    assert all(s >= 0.3 for s in sleeps)


def test_recording_never_saves_the_token(tmp_path):
    class Inner:
        def post(self, url, **kw):
            if url == TOKEN_URL:
                return Response(200, {"access_token": "SECRET-TOKEN"})
            return Response(200, {"data": {}})

    rec = RecordingTransport(Inner(), tmp_path)
    rec.post(TOKEN_URL, data={})
    rec.post(API_URL, json={"query": "guildData", "variables": {"s": "draenor", "n": "Kelderklasse"}})
    files = list(tmp_path.iterdir())
    assert [f.name for f in files] == ["wcl__guild__draenor__kelderklasse.json"]
    assert "SECRET-TOKEN" not in files[0].read_text()
