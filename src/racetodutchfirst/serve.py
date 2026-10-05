"""The self-hosted site's fetch loop (the container's main process; nginx serves WWW).

The image carries the code: site/ as a template. The data lives in WWW, a volume that
nginx serves read-only. On start, and on every image update, the static files are copied
from the template into WWW; then, on the schedule in schedule.py, one run:

1. the fetcher writes WWW/data/race.json (atomically, never on failure; its own
   race.json is the --history, so killed bosses aren't fetched again);
2. prerender fills the board + tier pills into a copy of the template index.html, written
   atomically to WWW (and sitemap.xml);
3. at most hourly, and only on new data, scripts/og-image.sh draws WWW/og.png.

A failed step keeps what WWW had: the site always shows the last good data. Nothing here
needs a deploy: a new race.json is live on the next request.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from .config import load_config
from .prerender import prerender, season_index, sitemap
from .schedule import due, next_run

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE = ROOT / "site"
WWW = Path(os.environ.get("RTDF_WWW", "/srv/www"))
CONFIG = ROOT / "guilds.toml"
HEARTBEAT = Path(os.environ.get("RTDF_HEARTBEAT", "/tmp/heartbeat"))  # for the healthcheck, not in WWW
OG_EVERY_S = 3600
FETCH_TIMEOUT_S = 600
# Made by a run, so never overwritten from the template once WWW has them.
GENERATED = {"index.html", "og.png", "sitemap.xml", "data/race.json"}


def log(msg: str) -> None:
    print(f"{datetime.now(UTC):%Y-%m-%dT%H:%M:%SZ} {msg}", flush=True)


def _copy_atomic(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".tmp")
    shutil.copyfile(src, tmp)
    os.replace(tmp, dst)


def _write_atomic(dst: Path, text: str) -> None:
    tmp = dst.with_name(dst.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, dst)


def sync_static(template: Path = TEMPLATE, www: Path = WWW) -> int:
    """Copy the template's files into WWW. Generated files only when WWW lacks them (first
    start: the plain index.html, the committed og.png and the sample race.json stand in)."""
    n = 0
    for src in sorted(p for p in template.rglob("*") if p.is_file()):
        rel = src.relative_to(template).as_posix()
        dst = www / rel
        if rel in GENERATED and dst.exists():
            continue
        if dst.exists() and dst.stat().st_size == src.stat().st_size and dst.read_bytes() == src.read_bytes():
            continue
        _copy_atomic(src, dst)
        n += 1
    return n


def fetch(www: Path = WWW) -> bool:
    out = www / "data" / "race.json"
    cmd = [sys.executable, "-m", "racetodutchfirst", "--output", str(out)]
    if out.exists():
        cmd += ["--history", str(out)]
    try:
        res = subprocess.run(cmd, cwd=ROOT, timeout=FETCH_TIMEOUT_S, check=False)
    except subprocess.TimeoutExpired:
        log(f"fetch: no answer within {FETCH_TIMEOUT_S} s; race.json unchanged")
        return False
    if res.returncode != 0:
        log(f"fetch: exit {res.returncode}; race.json unchanged")
        return False
    return True


def render(template: Path = TEMPLATE, www: Path = WWW, config: Path = CONFIG) -> bool:
    try:
        data = json.loads((www / "data" / "race.json").read_text(encoding="utf-8"))
        html = prerender((template / "index.html").read_text(encoding="utf-8"), data)
        seasons = season_index(load_config(config))
    except Exception as exc:  # noqa: BLE001 - the plain or previous index.html stays
        log(f"prerender: {exc}; index.html unchanged")
        return False
    _write_atomic(www / "index.html", html)
    _write_atomic(www / "sitemap.xml", sitemap(seasons))
    return True


def og_image(www: Path = WWW) -> bool:
    env = {**os.environ, "SITE_DIR": str(www)}
    try:
        res = subprocess.run([str(ROOT / "scripts" / "og-image.sh"), str(www / "og.png")],
                             env=env, timeout=120, check=False, capture_output=True, text=True)
    except subprocess.TimeoutExpired:
        log("og-image: timed out; og.png unchanged")
        return False
    if res.returncode != 0:
        log(f"og-image: exit {res.returncode}; og.png unchanged: {res.stderr.strip()[-300:]}")
        return False
    return True


def generated_at(www: Path = WWW) -> str | None:
    try:
        return json.loads((www / "data" / "race.json").read_text(encoding="utf-8")).get("generatedAt")
    except (OSError, ValueError):
        return None


class Loop:
    def __init__(self, www: Path = WWW) -> None:
        self.www = www
        self.og_at = 0.0
        self.og_for: str | None = None

    def run(self) -> None:
        t0 = time.monotonic()
        if fetch(self.www):
            render(www=self.www)
            stamp = generated_at(self.www)
            if stamp != self.og_for and time.time() - self.og_at >= OG_EVERY_S and og_image(self.www):
                self.og_at, self.og_for = time.time(), stamp
        log(f"run done in {time.monotonic() - t0:.0f} s; next {next_run(datetime.now(UTC)):%H:%M} UTC")
        HEARTBEAT.write_text(str(int(time.time())))

    def forever(self) -> None:
        log(f"start: {sync_static(www=self.www)} static files updated in {self.www}")
        render(www=self.www)  # a new image's index.html with the data WWW already has
        stamp = generated_at(self.www)
        age = (datetime.now(UTC) - datetime.fromisoformat(stamp)).total_seconds() if stamp else None
        if age is None or age > 300:
            self.run()
        while True:
            now = datetime.now(UTC)
            time.sleep(60 - now.second - now.microsecond / 1e6 + 0.5)
            if due(datetime.now(UTC)):
                self.run()
            else:
                HEARTBEAT.write_text(str(int(time.time())))


def main() -> int:
    Loop().forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
