"""
Stage 1: fetch. Nothing is transformed here beyond what the API had to do to
answer the query. Raw responses land in data-raw/ so stage 2 can be re-run
without hitting the network.

Five sources:

  1. Annual Examination Schedule (OpenData)      full table, 2,900 rows
  2. NYC Civil Service Titles (OpenData)         full table, 3,372 rows
  3. Civil Service List Active (OpenData)        aggregates only
  4. Civil Service List Certification (OpenData) aggregates only
  5. The three DCAS live exam tables (HTML)      see USE_DCAS_LIVE in config

Source 2 is the full title catalog and it is what lets this site show a title
that has no exam running and no active list. Without it the site can only
describe titles the City happens to be hiring for right now.

Sources 3 and 4 are person level and include names, exam scores, and veteran
and family legacy credit. We never download those rows. Every query names its
columns explicitly and common.soql() refuses any response that contains a
forbidden column, so the privacy guarantee is enforced by code rather than by
good intentions.
"""

import re
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config as cfg  # noqa: E402


# ---------------------------------------------------------------------------
# 1. Annual Examination Schedule
# ---------------------------------------------------------------------------

def fetch_exam_schedule():
    c.stage("Annual Examination Schedule (4ptz-hmtc)")
    df = c.soql(cfg.DATASET_EXAM_SCHEDULE, **{"$limit": 50000})
    c.require_columns(df, cfg.DATASET_EXAM_SCHEDULE, "Annual Examination Schedule")
    c.require_rows(df, cfg.MIN_ROWS_EXAM_SCHEDULE, "Annual Examination Schedule")
    c.log(f"{len(df):,} rows, {df.exam_number.nunique():,} distinct exam numbers")
    c.log(f"snapshots: {sorted(df.data_current_as_of.dropna().unique())[-3:]} (latest three)")
    c.write_cache("exam_schedule.json", df)
    return df


# ---------------------------------------------------------------------------
# 2. NYC Civil Service Titles, the full catalog
# ---------------------------------------------------------------------------

def fetch_titles():
    """Every civil service title the City has, not just the ones with a live
    exam or an active list.

    This is the only source that covers titles nothing else reaches. Emergency
    Preparedness Manager has no exam scheduled and no active list, so it exists
    in this dataset and nowhere else in what the site publishes.

    Two quirks handled in stage 2 rather than here, because this stage does not
    transform: `descr` is truncated at 30 characters, and a title code carries
    one row per assignment level salary band, so 3,372 rows are 2,625 titles.
    """
    c.stage("NYC Civil Service Titles (nzjr-3966)")
    df = c.soql(cfg.DATASET_TITLES, **{"$limit": 20000})
    c.require_columns(df, cfg.DATASET_TITLES, "NYC Civil Service Titles")
    c.require_rows(df, cfg.MIN_ROWS_TITLES, "NYC Civil Service Titles")
    c.log(f"{len(df):,} rows, {df.title.nunique():,} distinct title codes")
    c.write_cache("titles_catalog.json", df)
    return df


# ---------------------------------------------------------------------------
# 3. Civil Service List (Active), aggregated
# ---------------------------------------------------------------------------

def fetch_active_lists():
    """One row per exam: how many people are on the list, how it is numbered,
    and when it was established and expires. No candidate rows."""
    c.stage("Civil Service List Active (vx8i-nprf), aggregated by exam")
    df = c.soql(cfg.DATASET_ACTIVE_LIST, **{
        "$select": ", ".join([
            "exam_no",
            "list_title_code",
            "list_title_desc",
            "list_agency_desc",
            "count(1) as candidates",
            "min(list_no) as list_no_min",
            "max(list_no) as list_no_max",
            "min(adj_fa) as score_min",
            "max(adj_fa) as score_max",
            "avg(adj_fa) as score_mean",
            "min(established_date) as established_date",
            "min(anniversary_date) as anniversary_date",
            "max(extension_date) as extension_date",
            "min(published_date) as published_date",
        ]),
        "$group": "exam_no, list_title_code, list_title_desc, list_agency_desc",
        "$limit": 20000,
    })
    c.require_rows(df, cfg.MIN_ROWS_ACTIVE_LIST_TITLES, "Active list aggregate")
    c.log(f"{len(df):,} list groups, "
          f"{pd.to_numeric(df.candidates).sum():,} candidates, "
          f"{df.list_title_desc.nunique():,} titles")
    c.write_cache("active_lists.json", df)
    return df


# ---------------------------------------------------------------------------
# 4. Certification, aggregated
# ---------------------------------------------------------------------------

def fetch_certification():
    """Certification activity per exam per year.

    This is the question the site exists to answer. A list of 20,000 people that
    has never been certified and a list of 4,000 that has been called to the
    bottom look identical in every other dataset.

    Grouped by year rather than by exam alone for a specific reason: DCAS
    recycles exam numbers every ten years and this file goes back to 2016, so
    an exam number can carry certifications belonging to an entirely different
    exam that reused the number. Stage 2 keeps only the years at or after the
    current list was established. Grouping by exam alone silently credits a new
    list with a decade-old list's hiring.
    """
    c.stage("Civil Service List Certification (a9md-ynri), by exam and certification")
    limit = 200000
    df = c.soql(cfg.DATASET_CERTIFICATION, **{
        "$select": ", ".join([
            "exam_no",
            "cert_issue_no",
            "date_trunc_y(cert_date) as cert_year",
            "count(1) as candidates_certified",
            "max(list_no) as deepest_list_no",
            "min(cert_date) as first_cert_date",
            "max(cert_date) as last_cert_date",
            # no_vacancies and no_certified describe the certification, and the
            # file repeats them on every candidate row within it. Taking the max
            # within a certification reads the value once. Summing across raw
            # rows instead multiplies it by the number of people, which turned
            # 800 Conductor vacancies into 87 million.
            "max(no_vacancies) as vacancies",
            "max(no_certified) as certified_count",
        ]),
        "$group": "exam_no, cert_issue_no, date_trunc_y(cert_date)",
        "$limit": limit,
    })
    if len(df) >= limit:
        raise RuntimeError(
            f"Certification query hit the {limit:,} row limit, so the result is "
            f"truncated and every count downstream would be too low. Paginate "
            f"this query before trusting the output."
        )
    c.require_rows(df, cfg.MIN_ROWS_CERT_EXAMS, "Certification aggregate")
    c.log(f"{len(df):,} certifications across {df.exam_no.nunique():,} exams")
    c.write_cache("certification.json", df)
    return df


def fetch_certification_salary():
    """Hiring salary per exam, split into annual and hourly.

    Two queries rather than one because the salary column mixes annual salaries
    and hourly rates with no flag, and averaging across both is meaningless.
    Recent rows only: a 2017 hiring salary is not useful context in 2026.
    """
    c.stage("Hiring salary at certification, recent years")
    since = (c.as_of() - pd.DateOffset(years=cfg.CERT_LOOKBACK_YEARS)).strftime("%Y-%m-%d")
    frames = {}
    for label, where in [
        ("annual", f"salary >= {cfg.HOURLY_SALARY_THRESHOLD}"),
        ("hourly", f"salary > 0 AND salary < {cfg.HOURLY_SALARY_THRESHOLD}"),
    ]:
        df = c.soql(cfg.DATASET_CERTIFICATION, **{
            "$select": (f"exam_no, count(1) as n_{label}, min(salary) as {label}_min, "
                        f"max(salary) as {label}_max, avg(salary) as {label}_mean"),
            "$where": f"{where} AND cert_date >= '{since}'",
            "$group": "exam_no",
            "$limit": 20000,
        })
        c.log(f"{label}: {len(df):,} exams since {since}")
        frames[label] = df
    out = frames["annual"].merge(frames["hourly"], on="exam_no", how="outer")
    c.write_cache("certification_salary.json", out)
    return out


# ---------------------------------------------------------------------------
# 5. The DCAS live exam tables
# ---------------------------------------------------------------------------

_TABLE = re.compile(r"(?is)<table.*?</table>")
_ROW = re.compile(r"(?is)<tr.*?</tr>")
_CELL = re.compile(r"(?is)<t[dh][^>]*>(.*?)</t[dh]>")
_TAG = re.compile(r"(?s)<[^>]+>")
_NOE_HREF = re.compile(r'(?is)href="([^"]*\.pdf[^"]*)"')

# "7/1/2026 – 8/25/2026", en dash, occasionally a hyphen or a stray space
_PERIOD = re.compile(r"(\d{1,2}/\d{1,2}/\d{4})\s*[–—-]\s*(\d{1,2}/\d{1,2}/\d{4})")


def _cell_text(html):
    import html as htmlmod
    return re.sub(r"\s+", " ", htmlmod.unescape(_TAG.sub(" ", html))).strip()


def _parse_dcas_table(html, bucket):
    """Pull the exam table out of a DCAS page.

    The markup is a plain <table> with a stable three column header, which is
    why this is worth doing at all. If DCAS restyles these pages this function
    returns nothing and the pipeline says so rather than silently reverting to
    stale OpenData dates.
    """
    rows = []
    for table_html in _TABLE.findall(html):
        parsed = []
        for row_html in _ROW.findall(table_html):
            cells_html = _CELL.findall(row_html)
            cells = [_cell_text(x) for x in cells_html]
            if len(cells) < 3 or not any(cells):
                continue
            parsed.append((cells, cells_html))
        if not parsed:
            continue
        header = [x.lower() for x in parsed[0][0]]
        if "exam no." not in " ".join(header) and "exam no" not in " ".join(header):
            continue
        for cells, cells_html in parsed[1:]:
            title, exam_cell, period = cells[0], cells[1], cells[2]
            exam_no = re.sub(r"[^0-9]", "", exam_cell)
            # DCAS leaves placeholder rows like "Xxxx / 0000 / Canceled" in the
            # markup when a table is empty. They are hidden in the browser.
            if not exam_no or exam_no == "0000" or title.lower().startswith("xxxx"):
                continue
            match = _PERIOD.search(period)
            noe = _NOE_HREF.search(cells_html[1]) if len(cells_html) > 1 else None
            rows.append({
                "bucket": bucket,
                "exam_no": exam_no,
                "title_live": title,
                "period_raw": period,
                "start_live": match.group(1) if match else None,
                "end_live": match.group(2) if match else None,
                "status_live": None if match else period or None,
                "noe_url": ("https://www.nyc.gov" + noe.group(1)) if noe and noe.group(1).startswith("/") else (noe.group(1) if noe else None),
            })
    return rows


def fetch_dcas_live():
    c.stage("DCAS live exam tables")
    if not cfg.USE_DCAS_LIVE:
        c.log("USE_DCAS_LIVE is False. Running on OpenData alone, which means "
              "application periods extended since the last OpenData refresh "
              "will show as closed.")
        empty = pd.DataFrame(columns=["bucket", "exam_no", "title_live", "period_raw",
                                      "start_live", "end_live", "status_live", "noe_url"])
        c.write_cache("dcas_live.json", empty)
        return empty

    rows = []
    for bucket, url in cfg.DCAS_LIVE_PAGES.items():
        html = c.get(url, expect_json=False)
        found = _parse_dcas_table(html, bucket)
        c.log(f"{bucket:<18} {len(found):>3} exams  <- {url.rsplit('/', 1)[-1]}")
        rows.extend(found)

    df = pd.DataFrame(rows)
    if df.empty:
        raise RuntimeError(
            "Parsed zero exams from all three DCAS pages.\n"
            "  Either every application period is genuinely closed, which has "
            "not happened before, or DCAS changed the markup and "
            "_parse_dcas_table() needs updating.\n"
            "  Set USE_DCAS_LIVE = False in config.py to ship on OpenData "
            "alone while you fix it, and accept that the site will understate "
            "what is open."
        )
    c.log(f"{len(df)} exams currently accepting applications per DCAS")
    c.write_cache("dcas_live.json", df)
    return df


# ---------------------------------------------------------------------------
# 6. Salary context from The Pay Gap
# ---------------------------------------------------------------------------

def fetch_paygap():
    c.stage("Salary context from The Pay Gap")
    rows = c.get(cfg.PAYGAP_TITLES_URL)
    df = pd.DataFrame(rows)
    c.log(f"{len(df):,} payroll titles, fiscal year "
          f"{sorted(df.fiscal_year.unique()) if 'fiscal_year' in df else 'unknown'}")
    c.write_cache("paygap_titles.json", df)
    return df


# ---------------------------------------------------------------------------

def fetch_source_metadata():
    """When each source was last refreshed, according to the source.

    The site's "as of" line has to come from the data, not from the build date.
    A build that runs daily against a dataset that stopped updating in March
    would otherwise look fresh forever, and silent staleness is the failure
    mode that matters most here.
    """
    c.stage("Source freshness")
    rows = []
    for label, dataset_id in [
        ("exam_schedule", cfg.DATASET_EXAM_SCHEDULE),
        ("titles", cfg.DATASET_TITLES),
        ("active_list", cfg.DATASET_ACTIVE_LIST),
        ("certification", cfg.DATASET_CERTIFICATION),
    ]:
        meta = c.get(f"https://{cfg.SOCRATA_DOMAIN}/api/views/{dataset_id}.json")
        updated = pd.to_datetime(meta.get("rowsUpdatedAt"), unit="s")
        rows.append({
            "source": label,
            "dataset_id": dataset_id,
            "name": meta.get("name"),
            "rows_updated_at": updated,
            "url": f"https://{cfg.SOCRATA_DOMAIN}/d/{dataset_id}",
        })
        c.log(f"{label:<16} updated {updated:%Y-%m-%d}  {meta.get('name')}")
    df = pd.DataFrame(rows)
    c.write_cache("source_metadata.json", df)
    return df


def main():
    fetch_source_metadata()
    fetch_exam_schedule()
    fetch_titles()
    fetch_active_lists()
    fetch_certification()
    fetch_certification_salary()
    fetch_dcas_live()
    fetch_paygap()
    print(f"\nDone. Raw responses cached in {cfg.CACHE_DIR}/")


if __name__ == "__main__":
    main()
