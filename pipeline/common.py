"""
Shared helpers for the pipeline stages.

Nothing here makes decisions. Decisions live in config.py.
"""

import json
import os
import re
import sys
import time
from datetime import date, datetime

import pandas as pd
import requests

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
import config as cfg  # noqa: E402


# ---------------------------------------------------------------------------
# Talking to the outside world
# ---------------------------------------------------------------------------

def _session():
    s = requests.Session()
    s.headers["User-Agent"] = cfg.HTTP_USER_AGENT
    s.headers["Accept"] = "text/html,application/json;q=0.9,*/*;q=0.8"
    s.headers["Accept-Language"] = "en-US,en;q=0.9"
    token = os.environ.get(cfg.SOCRATA_APP_TOKEN_ENV)
    if token:
        s.headers["X-App-Token"] = token
    return s


SESSION = _session()


def get(url, params=None, expect_json=True):
    """GET with retries. Raises on the last failure rather than returning None,
    because a half-fetched build is worse than no build."""
    last = None
    for attempt in range(cfg.HTTP_RETRIES):
        try:
            r = SESSION.get(url, params=params, timeout=cfg.HTTP_TIMEOUT_SECONDS)
            r.raise_for_status()
            return r.json() if expect_json else r.text
        except Exception as exc:  # noqa: BLE001
            last = exc
            if attempt < cfg.HTTP_RETRIES - 1:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"GET failed after {cfg.HTTP_RETRIES} tries: {url}\n  {last}")


def soql(dataset_id, **params):
    """Run a SoQL query and return a DataFrame.

    Aggregating server side is not an optimization here, it is the design. The
    certification file is 6.7 million person-level rows including names. We ask
    Socrata for group counts so those rows never reach this machine.
    """
    url = f"https://{cfg.SOCRATA_DOMAIN}/resource/{dataset_id}.json"
    rows = get(url, params=params)
    df = pd.DataFrame(rows)
    forbidden = set(df.columns) & set(cfg.FORBIDDEN_COLUMNS)
    if forbidden:
        raise RuntimeError(
            f"Refusing to continue: query on {dataset_id} returned personal "
            f"columns {sorted(forbidden)}. Fix the $select in 01_fetch.py."
        )
    return df


# ---------------------------------------------------------------------------
# Loud failure
# ---------------------------------------------------------------------------

def require_columns(df, dataset_id, label):
    missing = [c for c in cfg.REQUIRED_COLUMNS.get(dataset_id, []) if c not in df.columns]
    if missing:
        raise RuntimeError(
            f"{label} ({dataset_id}) is missing expected columns {missing}.\n"
            f"  Got: {sorted(df.columns)}\n"
            f"  The dataset schema has changed. Update REQUIRED_COLUMNS in "
            f"config.py and check what else moved before trusting the output."
        )


def require_rows(df, minimum, label):
    if len(df) < minimum:
        raise RuntimeError(
            f"{label} returned {len(df)} rows, expected at least {minimum}.\n"
            f"  Either the source shrank or the fetch was truncated. Not "
            f"writing a half-empty site. Adjust the MIN_ROWS_* floor in "
            f"config.py only if you have confirmed the source really changed."
        )


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------

def as_of():
    """The reference date for open/upcoming/closed."""
    if cfg.AS_OF_DATE:
        return pd.Timestamp(cfg.AS_OF_DATE)
    return pd.Timestamp(date.today())


def to_date(series):
    return pd.to_datetime(series, errors="coerce").dt.tz_localize(None)


def iso(value):
    """Date to 'YYYY-MM-DD', or None. Used everywhere we write JSON."""
    if value is None or pd.isna(value):
        return None
    if isinstance(value, str):
        value = pd.Timestamp(value)
    return value.strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Titles
# ---------------------------------------------------------------------------

_WS = re.compile(r"\s+")
_NONWORD = re.compile(r"[^A-Z0-9+ ]")


def normalize_title(raw):
    """Reduce a title to a comparable key.

    The exam schedule writes the same title as 'CHILD PROTECTIVE SPECIALIST
    SUPERVISOR (PRO)' in one snapshot and 'Child Protective Specialist
    Supervisor (Prom)' in the next, so every cross-dataset join runs through
    here. title_code would be the right key but it is null on 87% of rows.
    """
    s = str(raw).upper().strip()
    for suffix in cfg.TITLE_SUFFIXES_TO_STRIP:
        if s.endswith(suffix):
            s = s[: -len(suffix)].strip()
    for a, b in cfg.TITLE_ALIASES.items():
        s = s.replace(a.upper(), b.upper())
    s = _NONWORD.sub(" ", s)
    return _WS.sub(" ", s).strip()


def is_promotion_title(raw):
    """DCAS marks promotion exams with a suffix on the title as well as in the
    type column, and the two disagree often enough to check both."""
    s = str(raw).upper().strip()
    return any(s.endswith(x) for x in cfg.TITLE_SUFFIXES_TO_STRIP)


_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def slugify(raw):
    s = _SLUG_STRIP.sub("-", str(raw).lower()).strip("-")
    return s or "untitled"


def pad_exam_no(value, width):
    """Exam numbers are stored zero padded to different widths per dataset."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    s = str(value).strip()
    if s.endswith(".0"):
        s = s[:-2]
    s = s.lstrip("0") or "0"
    return s.zfill(width)


# ---------------------------------------------------------------------------
# Money
# ---------------------------------------------------------------------------

def split_salary(value):
    """Return (annual, hourly). The certification salary column mixes both in
    one field with no flag, so we split on a threshold. Conductors appear as
    25.81 and Administrative Managers as 68213, side by side."""
    if value is None or pd.isna(value):
        return None, None
    v = float(value)
    if v < cfg.HOURLY_SALARY_THRESHOLD:
        return None, round(v, 2)
    return int(round(v)), None


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------

def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=cfg.JSON_INDENT, ensure_ascii=False,
                  separators=(",", ":") if cfg.JSON_INDENT is None else None)
    return path.stat().st_size


def read_cache(name):
    path = cfg.CACHE_DIR / name
    if not path.exists():
        raise RuntimeError(
            f"{path} is missing. Run pipeline/01_fetch.py first."
        )
    return pd.read_json(path, dtype=False)


def write_cache(name, df):
    cfg.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = cfg.CACHE_DIR / name
    df.to_json(path, orient="records", date_format="iso")
    return path


def log(message):
    print(f"  {message}", flush=True)


def stage(name):
    print(f"\n[{datetime.now():%H:%M:%S}] {name}", flush=True)
