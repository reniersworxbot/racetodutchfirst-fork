"""When the self-hosted site fetches (serve.py): cron lines in UTC, matched per minute.

Raid evenings (Sun, Mon, Wed, Thu; 17-23 h UTC = 19-01 h in summer, 18-00 h in winter) every
5 minutes, otherwise on the hour. Faster is pointless: Raider.IO answers with
`Cache-Control: max-age=240`, so it has new data at most every 4 minutes. A run costs ~80
Raider.IO requests (paced) and ~120 of Warcraft Logs' 3600 points an hour.
"""

from __future__ import annotations

from datetime import datetime, timedelta

SCHEDULE = (
    "0 * * * *",
    "*/5 17-23 * * 0,1,3,4",
)


def _values(field: str, lo: int, hi: int) -> set[int]:
    """The values a cron field allows: *, n, a-b, lists and /steps."""
    out: set[int] = set()
    for part in field.split(","):
        step = 1
        if "/" in part:
            part, s = part.split("/")
            step = int(s)
        if part == "*":
            a, b = lo, hi
        elif "-" in part:
            a, b = (int(x) for x in part.split("-"))
        else:
            a = b = int(part)
        if not (lo <= a <= b <= hi) or step < 1:
            raise ValueError(f"cron field out of range: {field!r}")
        out.update(range(a, b + 1, step))
    return out


def _parse(line: str) -> tuple[set[int], set[int], set[int], set[int], set[int]]:
    minute, hour, dom, month, dow = line.split()
    return (_values(minute, 0, 59), _values(hour, 0, 23), _values(dom, 1, 31),
            _values(month, 1, 12), _values(dow, 0, 6))


def due(at: datetime, lines: tuple[str, ...] = SCHEDULE) -> bool:
    """Whether any line fires in the minute of `at` (a UTC datetime). Weekday 0 = Sunday."""
    dow = (at.weekday() + 1) % 7
    for line in lines:
        m, h, d, mo, w = _parse(line)
        if at.minute in m and at.hour in h and at.day in d and at.month in mo and dow in w:
            return True
    return False


def next_run(after: datetime, lines: tuple[str, ...] = SCHEDULE) -> datetime:
    """The first scheduled minute strictly after `after`."""
    t = after.replace(second=0, microsecond=0) + timedelta(minutes=1)
    for _ in range(8 * 24 * 60):
        if due(t, lines):
            return t
        t += timedelta(minutes=1)
    raise ValueError("no run in the next week")
