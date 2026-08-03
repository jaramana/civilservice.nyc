"""
Stage 3: export. Writes the JSON the browser fetches into docs/data/.

Nothing in docs/data/ contains a name, an individual score, or a credit flag.
That is not a filtering step here, it is a consequence of stage 1 never asking
for those columns. See FORBIDDEN_COLUMNS in config.py.

Files written:

  meta.json        freshness, counts, and any staleness warning the page shows
  exams.json       every exam we publish, with its status today
  lists.json       every established Civil Service List, with certification history
  titles.json      every civil service title in the catalog, exam and list attached
  dictionary.json  what every published field means, drives the methodology page

There is deliberately no per-candidate score distribution here. An earlier
build published one so a visitor could enter an exam number and their own list
number and see how many people ranked ahead of them. It used counts only and
named nobody, but it was still a list number lookup, and that feature is cut.
Adding it back is a new decision, not a restoration.
"""

import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config as cfg  # noqa: E402


def clean(value):
    """JSON-safe scalar. Drops NaN rather than writing null everywhere.

    Whole numbers are written as integers even when pandas is holding them as
    floats, which it does for any column containing a single missing value.
    Otherwise a fiscal year ships as 2027.0 and a day count as 24.0.
    """
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    if isinstance(value, (pd.Timestamp, datetime)):
        return c.iso(value)
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        if np.isnan(value):
            return None
        return int(value) if float(value).is_integer() else round(float(value), 2)
    if pd.isna(value):
        return None
    return value


def record(row, fields):
    """Build a dict, omitting empty fields. Most exams have no NOE link and most
    lists have no hourly rate, so writing those keys costs size for nothing."""
    out = {}
    for key, source in fields.items():
        v = clean(row[source] if isinstance(source, str) else source(row))
        if v is not None and v != "":
            out[key] = v
    return out


# ---------------------------------------------------------------------------

def export_exams(exams):
    c.stage("exams.json")
    today = c.as_of()
    floor = pd.Timestamp(cfg.ARCHIVE_FLOOR)

    # Publish the current picture plus a shallow archive. Below ARCHIVE_FLOOR
    # the record is too patchy to present as history: DCAS never published the
    # FY2025 schedule, so there is a twelve month hole.
    keep = exams[(exams.status.isin(["accepting", "upcoming"]))
                 | (exams.end.notna() & (exams.end >= floor))].copy()
    c.log(f"{len(keep):,} exams published, {len(exams) - len(keep):,} held back "
          f"as older than {cfg.ARCHIVE_FLOOR}")

    keep["days_left"] = (keep.end - today).dt.days
    keep["days_until"] = (keep.start - today).dt.days
    keep = keep.sort_values(["start", "title"], na_position="last")

    fields = {
        "exam_no": "exam_no",
        "title": "title",
        "slug": "title_slug",
        "type": "exam_type",
        "status": "status",
        "start": "start",
        "end": "end",
        "fiscal_year": "fiscal_year",
        "days_left": lambda r: r.days_left if r.status == "accepting" else None,
        "days_until": lambda r: r.days_until if r.status == "upcoming" else None,
        "noe_url": "noe_url",
        "source": "source",
    }
    payload = [record(r, fields) for _, r in keep.iterrows()]
    size = c.write_json(cfg.DATA_DIR / "exams.json", payload)
    c.log(f"{size/1024:.0f} KB")
    return keep


def export_lists(lists):
    c.stage("lists.json")
    df = lists.copy()

    # An exam split across agencies produces one list per agency and list
    # numbers restart at 1 on each. Certification is only reported per exam, so
    # for those we know the list was called but not how far down any one
    # agency's list. Saying so is better than implying a depth we cannot show.
    per_exam = df.groupby("exam_no").size()
    df["lists_for_exam"] = df.exam_no.map(per_exam)
    df["depth_known"] = (df.lists_for_exam == 1) & df.deepest_list_no.notna()

    # A handful of lists report certification deeper than their own highest
    # list number even after the recycled-number fix, because a single
    # certification can draw on more than one list. Cap the display and count
    # them so the methodology page can say how many.
    odd = int((df.depth_known & (df.deepest_list_no > df.list_no_max)).sum())
    df.loc[df.depth_known & (df.deepest_list_no > df.list_no_max), "depth_known"] = False
    c.log(f"{int(df.depth_known.sum()):,} lists report a usable certification depth; "
          f"{int((df.lists_for_exam > 1).sum()):,} suppressed as agency-split, "
          f"{odd} as inconsistent")

    df["annual_mean"] = df.annual_mean.round(0)
    df["hourly_mean"] = df.hourly_mean.round(2)
    df["score_mean"] = df.score_mean.round(1)
    df = df.sort_values("candidates", ascending=False)

    fields = {
        "exam_no": "exam_no",
        "title": "title",
        "slug": "title_slug",
        "agency": "agency",
        "candidates": "candidates",
        "list_no_max": "list_no_max",
        "score_min": "score_min",
        "score_max": "score_max",
        "score_mean": "score_mean",
        "established": "established_date",
        "published": "published_date",
        "anniversary": "anniversary_date",
        "extension": "extension_date",
        "expires": "expires",
        "days_left": "days_left",
        "called": "called",
        "cert_verified": "cert_verified",
        "certifications": "certifications",
        # certified_total is deliberately not published. It counts candidate
        # rows across certifications, and the same person appears in every
        # certification they are reached by, so Conductor reads 248,056 on a
        # list of 31,856 people. It looks like a headcount and is not one.
        "vacancies": "vacancies_total",
        "last_cert": "last_cert_date",
        "called_through": lambda r: r.deepest_list_no if r.depth_known else None,
        "depth_known": "depth_known",
        "salary_annual": "annual_mean",
        "salary_hourly": "hourly_mean",
    }
    payload = [record(r, fields) for _, r in df.iterrows()]
    size = c.write_json(cfg.DATA_DIR / "lists.json", payload)
    c.log(f"{len(payload):,} lists, {size/1024:.0f} KB")
    return df


def export_titles(exams, lists, catalog, paygap):
    """One entry per civil service title in the City's catalog.

    The catalog is the spine, not the exam schedule. Keying this off exams and
    lists, as an earlier build did, meant a title only existed on this site
    while the City happened to be hiring for it: 2,625 titles collapsed to the
    ~430 with an active list. Emergency Preparedness Manager is a real job with
    real pay and no page at all under that arrangement.

    So every title gets an entry, and exam history, list status and salary are
    attached where they exist and simply absent where they do not. Absent is
    the normal case and the page should not read as an error.

    Exam and list counts come from the exams we actually published, never from
    the full deduplicated set. Counting the full set makes a title claim exams
    that no page on this site can show, because everything older than
    ARCHIVE_FLOOR is held back.
    """
    c.stage("titles.json")
    ex_by = exams.groupby("title_key")
    li_by = lists.groupby("title_key")

    payload = []
    for _, t in catalog.iterrows():
        key = t.title_key
        e = ex_by.get_group(key) if key in ex_by.groups else exams.iloc[0:0]
        l = li_by.get_group(key) if key in li_by.groups else lists.iloc[0:0]

        entry = {
            "slug": t.title_slug,
            "code": t.title_code,
            "title": t.title,
            # What the catalog knows about every title, exam or no exam. This is
            # the whole reason the dataset is here.
            "hours": clean(t.std_hrs),
            "salary_min": clean(t.salary_min),
            "salary_max": clean(t.salary_max),
            "union": clean(t.union_descr),
            "bargaining_unit": clean(t.barg_descr),
            "exams": int(len(e)),
            "open_now": int((e.status == "accepting").sum()),
            "upcoming": int((e.status == "upcoming").sum()),
            "lists": int(len(l)),
            "candidates": int(l.candidates.sum()) if len(l) else 0,
        }
        # Only set where true, so the browser can treat these as simple flags
        # and the file does not carry 2,625 copies of false.
        if t.name_truncated:
            entry["name_truncated"] = True
        if t.bands > 1:
            entry["salary_bands"] = int(t.bands)
        if str(t.investigation).strip().lower() == "yes":
            entry["investigation"] = True

        if len(e):
            # The exam numbers themselves, newest first, so the title page can
            # link to each exam without matching titles back up in the browser.
            # Exam and catalog slugs are built differently on purpose (a title
            # slug carries its code, an exam slug does not), so string surgery
            # in JavaScript would be a silent breakage waiting to happen.
            entry["exam_nos"] = list(
                e.sort_values("start", ascending=False).exam_no.astype(str)
            )
            nxt = e[e.status.isin(["accepting", "upcoming"])].sort_values("start")
            if len(nxt):
                entry["next_exam_no"] = nxt.exam_no.iloc[0]
                entry["next_start"] = c.iso(nxt.start.iloc[0])
                entry["next_status"] = nxt.status.iloc[0]
        if len(l):
            entry["called"] = "yes" if (l.called == "yes").any() else l.called.iloc[0]
            hiring = l.annual_mean.dropna()
            if len(hiring):
                entry["salary_hiring"] = int(round(hiring.mean()))

        # A payroll title with no median is one thepaygap.nyc suppressed for
        # small headcount. A match with no number is not salary context, so we
        # drop it rather than showing an empty field.
        if key in paygap.index and pd.notna(paygap.loc[key].median_salary):
            row = paygap.loc[key]
            entry["paygap"] = {
                "slug": row.slug,
                "median_salary": int(row.median_salary),
                "employees": int(row.n),
                "fiscal_year": int(row.fiscal_year),
                "url": cfg.PAYGAP_TITLE_URL_TEMPLATE.format(slug=row.slug),
            }
        payload.append({k: v for k, v in entry.items() if v is not None})

    payload.sort(key=lambda x: x["title"])
    size = c.write_json(cfg.DATA_DIR / "titles.json", payload)
    c.log(f"{len(payload):,} titles, "
          f"{sum(1 for x in payload if x['exams']):,} with an exam we publish, "
          f"{sum(1 for x in payload if x['lists']):,} with an active list, "
          f"{sum(1 for x in payload if 'paygap' in x):,} with payroll context, "
          f"{size/1024:.0f} KB")
    c.log(f"{sum(1 for x in payload if not x['exams'] and not x['lists']):,} titles "
          f"have neither an exam nor a list and exist here only because of the catalog")
    return payload


def export_titles_index(titles):
    """The slim file the directory page loads.

    titles.json is around 800 KB because every title carries its exam history,
    list status and payroll context. The directory needs none of that: it draws
    a name, a salary band and a couple of filter flags. Handing a phone the
    full file just to render an index is the kind of waste that makes a static
    site feel slow, so the index is its own file and the full record is fetched
    only when someone opens a title.

    Keys are short here, and only here. This file is read by one script and
    nobody hand-edits it. Everything a person or another program might read
    keeps its long names.
    """
    c.stage("titles-index.json")
    payload = []
    for t in titles:
        entry = {
            "s": t["slug"],
            "t": t["title"],
            "c": t["code"],
            "lo": t.get("salary_min"),
            "hi": t.get("salary_max"),
        }
        # Filter flags, present only when true. 2,227 of 2,632 titles have
        # neither an exam nor a list, so writing the false case 2,227 times
        # would cost more than the flags save.
        # Truncated names are flagged so the directory can mark them. Without
        # it "Accountant (Board of Elections" reads as a typo on our side
        # rather than the catalog's 30 character limit.
        if t.get("name_truncated"):
            entry["x"] = 1
        if t["exams"]:
            entry["e"] = 1
        if t["lists"]:
            entry["l"] = 1
        if t["open_now"]:
            entry["o"] = 1
        if t.get("next_status") == "upcoming":
            entry["u"] = 1
        payload.append({k: v for k, v in entry.items() if v is not None})

    size = c.write_json(cfg.DATA_DIR / "titles-index.json", payload)
    c.log(f"{len(payload):,} titles, {size/1024:.0f} KB "
          f"(the directory page loads this instead of titles.json)")


def export_meta(exams, lists, published_exams, catalog):
    c.stage("meta.json")
    src = c.read_cache("source_metadata.json")
    src["rows_updated_at"] = c.to_date(src.rows_updated_at)
    today = c.as_of()

    schedule_asof = exams.data_current_as_of.max()
    watched = src[src.source.isin(cfg.STALENESS_SOURCES)]
    if watched.empty:
        raise RuntimeError(
            "STALENESS_SOURCES in config.py matches none of the fetched "
            f"sources {sorted(src.source)}. The staleness warning would never "
            "fire, which is the one failure this site is built to avoid."
        )
    oldest_source = watched.rows_updated_at.min()
    age = (today - oldest_source).days

    warnings = []
    if age >= cfg.STALENESS_WARN_DAYS:
        warnings.append(
            f"The City has not refreshed one of these datasets in {age} days. "
            f"Application dates below may be out of date. Check with DCAS."
        )
    if not cfg.USE_DCAS_LIVE:
        warnings.append(
            "This build did not check the DCAS exam pages, so an exam whose "
            "application period was extended may show as closed here."
        )

    live_rows = c.read_cache("dcas_live.json")
    payload = {
        "generated_at": c.iso(today),
        "as_of": c.iso(today),
        "schedule_current_as_of": c.iso(schedule_asof),
        "source_age_days": int(age),
        "staleness_notice": age >= cfg.STALENESS_NOTICE_DAYS,
        "staleness_warning": age >= cfg.STALENESS_WARN_DAYS,
        "warnings": warnings,
        "sources": [
            {"key": r.source, "name": r["name"], "dataset_id": r.dataset_id,
             "updated": c.iso(r.rows_updated_at), "url": r.url}
            for _, r in src.iterrows()
        ],
        "dcas_live": {
            "used": bool(cfg.USE_DCAS_LIVE),
            "exams_found": int(len(live_rows)),
            "pages": list(cfg.DCAS_LIVE_PAGES.values()),
        },
        "counts": {
            "accepting": int((exams.status == "accepting").sum()),
            "upcoming": int((exams.status == "upcoming").sum()),
            "upcoming_in_window": int(((exams.status == "upcoming")
                                       & ((exams.start - today).dt.days <= cfg.UPCOMING_WINDOW_DAYS)).sum()),
            "recently_closed": int(((exams.status == "closed")
                                    & ((today - exams.end).dt.days <= cfg.RECENTLY_CLOSED_DAYS)).sum()),
            "exams_published": int(len(published_exams)),
            "lists": int(len(lists)),
            "candidates": int(lists.candidates.sum()),
            "titles": int(len(catalog)),
            "titles_without_exam_or_list": int(
                (~catalog.title_key.isin(set(exams.title_key) | set(lists.title_key))).sum()),
        },
        "windows": {
            "upcoming_days": cfg.UPCOMING_WINDOW_DAYS,
            "recently_closed_days": cfg.RECENTLY_CLOSED_DAYS,
            "archive_floor": cfg.ARCHIVE_FLOOR,
        },
        "oasys_url": cfg.OASYS_URL,
        # Where stage 4 put the calendar files, so the pages can build a
        # subscribe link without a second copy of these paths in JavaScript.
        "calendar": {
            "feed": cfg.CALENDAR_FEED_FILENAME,
            "dir": cfg.CALENDAR_DIR_NAME,
            "webcal": (f"webcal://{cfg.SITE_BASE_URL.split('//')[-1]}"
                       f"/{cfg.CALENDAR_FEED_FILENAME}"),
            "reminder_days": cfg.CALENDAR_REMINDER_DAYS_BEFORE_CLOSE,
        },
    }
    c.write_json(cfg.DATA_DIR / "meta.json", payload)
    for k, v in payload["counts"].items():
        c.log(f"{k:<20} {v:>9,}")
    for w in warnings:
        c.log(f"WARNING: {w}")
    return payload


def export_dictionary():
    """What every published field means, in DCAS's own words where DCAS has
    words for it. The methodology page renders this, so the definitions on the
    site cannot drift from the definitions in the pipeline."""
    c.stage("dictionary.json")
    payload = {
        "exams.json": {
            "_description": "One entry per civil service exam we publish.",
            "exam_no": "The number DCAS assigns to an exam. DCAS reuses exam numbers every ten years, so a number is not a permanent identifier.",
            "title": "The civil service title the exam leads to. Parenthetical qualifiers matter: Caseworker and Caseworker (NYC H+H) are different exams for different employers.",
            "type": "open_competitive (anyone meeting the minimum qualifications), promotion (permanent or 55-a City employees only), qie (qualified incumbent exam, for provisional employees), canceled, or postponed.",
            "status": "accepting, upcoming, closed, canceled, or postponed, as of the date in meta.json.",
            "start": "Application Period start. The first day DCAS accepts applications.",
            "end": "Application Period end. DCAS does not accept applications after this date.",
            "fiscal_year": "NYC fiscal years run 1 July to 30 June and are named for the year they end in, so 1 July 2026 is FY2027.",
            "noe_url": "The Notice of Examination, the official document with the minimum qualifications, fee, and test date. Present only for exams currently open.",
            "source": "opendata if the dates come from the published schedule, dcas_live if they come from the DCAS exam pages, which are updated first when a period is extended.",
        },
        "lists.json": {
            "_description": "One entry per established Civil Service List. A list is everyone who passed an exam, ranked in score order.",
            "candidates": "How many people are still on the list. People drop off when appointed, so this falls over time.",
            "list_no_max": "The highest list number currently on the list.",
            "score_min": "Lowest Adjusted Final Average on the list. The Adjusted Final Average is a candidate's test score plus any additional credits granted.",
            "established": "The date the list became available for certification to agencies.",
            "anniversary": "The date the list is scheduled to expire. A list runs no less than one year and no more than four years from establishment.",
            "extension": "A later expiry date, where the list has been extended. Where present, this supersedes the anniversary date.",
            "called": "yes if any certification has been issued from this list since it was established, never if not. Read this alongside certifications rather than on its own: a list that has never been certified is common in both worlds described below, and on a new list it usually means nothing yet.",
            "certifications": (
                "How many separate certifications have been issued. A certification is the list, "
                "or part of it, formally sent to an agency so it can hire. This number means "
                "different things in different parts of City service. For most office titles the "
                "list sits behind ordinary job postings and agencies pull a certification against "
                "each one, so the count runs into the hundreds: Principal Administrative Associate "
                "has been certified 390 times. For uniformed titles a certification is the hiring "
                "event itself, rare and very large, so the count stays in the teens: Conductor has "
                "been certified 17 times. A low number is not a slow list, and a high number is not "
                "a fast one. The date of the most recent certification is the more comparable signal."
            ),
            "called_through": "The highest list number reached by any certification. Absent where we cannot attribute depth reliably, see depth_known.",
            "depth_known": "False where an exam produced separate lists for several agencies, because list numbers restart at 1 on each and certification is only reported per exam. Also false for a handful of lists whose reported depth exceeds their own highest list number.",
            "vacancies": "Total vacancies agencies were approved to fill across all certifications from this list.",
            "salary_annual": "Mean hiring salary at certification over the last few years. This is what the job pays at the point of hire. It is the number this site leads with, because it is what someone deciding whether to apply is actually deciding about, and because it exists for titles the payroll data cannot reach, including every MTA title.",
            "salary_hourly": "Mean hourly rate where the title is paid hourly. The source mixes annual and hourly figures in one column with no flag, so we split them on a threshold.",
        },
        "titles.json": {
            "_description": "One entry per civil service title in the City's catalog, whether or not an exam is running and whether or not a list exists. Most titles have neither. A title with no exam and no list is the normal case, not a gap in the data.",
            "code": "The five character title code DCAS assigns. Unlike an exam number this is stable, and it is what appears on a Notice of Examination. It is in every page address on this site because 161 titles share a name with a different title code: Administrative Graphic Artist is both code 10003, a non-union managerial title, and code 1000D, a District Council 37 title, with different pay.",
            "title": "The name of the title. See name_truncated.",
            "name_truncated": "True where the City's catalog stores this name cut off at 30 characters and no other dataset spells it in full. We show what the City published rather than guessing at the rest. Titles with an exam or an active list are named from those fuller sources instead, so this mostly affects titles nothing else covers.",
            "hours": "Standard weekly hours for the title.",
            "salary_min": "The bottom of the title's salary range, as the City sets it. This is the range attached to the title itself, not what any individual is paid, and not what a job posting will offer.",
            "salary_max": "The top of the title's salary range. Where a title has several assignment levels this is the highest maximum across all of them, so the span can be wide. See salary_bands.",
            "salary_bands": "Present where a title has more than one assignment level, each with its own salary range. The range shown spans all of them, so a title with several bands looks wider than any single band a person would actually sit in.",
            "union": "The union that represents the title, in the City's own wording.",
            "bargaining_unit": "The bargaining unit the title falls under. Non-Union covers managerial and some exempt titles.",
            "investigation": "True where the City requires a background investigation before appointment.",
            "salary_hiring": "Mean hiring salary at certification, where this title has a list that has been certified. This is what the job paid at the point of hire, and it is a different question from the title's salary range.",
            "exam_nos": "The exam numbers we publish for this title, newest first. Present so a title page can link to its exams directly. About one exam in six has no title here at all: CUNY and Health + Hospitals run exams for titles the City catalog does not carry, and the catalog's 30 character name limit means some longer exam names have nothing to match. We leave those unlinked rather than attaching pay to a guess.",
            "paygap": "Median salary for the matching payroll title from thepaygap.nyc, where an exact title match exists. This is what people already in the title earn, which is a third thing again, separate from both the title's range and the hiring salary. Many titles have no match: MTA titles such as Conductor and Train Operator are absent because the MTA is a State authority and does not appear in City payroll data at all.",
        },
        "titles-index.json": {
            "_description": "The same titles as titles.json, cut down to what the directory page draws so a phone does not download 800 KB to render an index. Keys are single letters here and only here, because one script reads this file and nothing else does. Every field below also exists in titles.json under its full name.",
            "s": "slug, the title's address on this site.",
            "t": "title, the name.",
            "c": "code, the five character title code.",
            "lo": "salary_min.",
            "hi": "salary_max.",
            "x": "name_truncated. The directory adds an ellipsis so a cut-off name does not read as our typo.",
            "e": "Present where the title has at least one exam we publish.",
            "l": "Present where the title has at least one active list.",
            "o": "Present where an exam for this title is accepting applications today.",
            "u": "Present where an exam for this title is scheduled but not yet open.",
        },
        "not_published": {
            "_description": "Deliberately absent.",
            "names": "The Civil Service List datasets include every candidate's first name, last name, and middle initial. We never request those columns.",
            "individual_scores": "A named person's Adjusted Final Average is public in the source data. We do not publish it, and we do not publish the score distribution either.",
            "credits": "Veteran, disabled veteran, parent legacy, sibling legacy, and residency credit flags identify who lost a parent or sibling in the line of duty. We never request those columns.",
            "list_number_lookup": "There is no way to enter a list number here and find out where you stand. Your own standing is between you and DCAS, and a lookup that answers it for anyone who guesses a number is not a private one. Check your status through DCAS directly.",
        },
    }
    size = c.write_json(cfg.DATA_DIR / "dictionary.json", payload)
    c.log(f"{size/1024:.0f} KB")


# ---------------------------------------------------------------------------

def main():
    exams = pd.read_pickle(cfg.CACHE_DIR / "prepared_exams.pkl")
    lists = pd.read_pickle(cfg.CACHE_DIR / "prepared_lists.pkl")
    catalog = pd.read_pickle(cfg.CACHE_DIR / "prepared_catalog.pkl")
    paygap = pd.read_pickle(cfg.CACHE_DIR / "prepared_paygap.pkl")

    published = export_exams(exams)
    exported_lists = export_lists(lists)
    titles = export_titles(published, lists, catalog, paygap)
    export_titles_index(titles)
    export_meta(exams, exported_lists, published, catalog)
    export_dictionary()

    total = sum(p.stat().st_size for p in cfg.DATA_DIR.glob("*.json"))
    print(f"\nWrote {len(list(cfg.DATA_DIR.glob('*.json')))} files, "
          f"{total/1024:.0f} KB total, to {cfg.DATA_DIR}/")


if __name__ == "__main__":
    main()
