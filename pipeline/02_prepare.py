"""
Stage 2: prepare. Turns the cached responses into the shapes the site needs.

Three things happen here that are not obvious, so they are worth stating up
front:

  1. The exam schedule is deduplicated. It is not a table of exams, it is a
     stack of published snapshots that grows rather than replacing itself.
     2,901 rows resolve to about 1,280 real exams.

  2. The DCAS live tables win on application dates. OpenData carries the annual
     plan; when DCAS extends an application period the live page is updated
     first. See USE_DCAS_LIVE in config.py for the numbers.

  3. Everything joins on a normalized title string, because title_code is null
     on 87% of exam schedule rows.
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config as cfg  # noqa: E402


# ---------------------------------------------------------------------------
# Exams
# ---------------------------------------------------------------------------

def fiscal_year(d):
    """NYC fiscal years run 1 July to 30 June and are named for the year they
    end in, so 1 July 2026 falls in FY2027."""
    if pd.isna(d):
        return None
    return int(d.year + 1 if d.month >= 7 else d.year)


def clean_exam_type(raw, title):
    """Collapse the type column to four values.

    The source carries the same value in two spellings ('Canceled' and
    'CANCELED', 'QIE' and 'Qualified Incumbent Exam') because each published
    snapshot was typed by hand. The title suffix is the tiebreak when the type
    column and the title disagree.
    """
    s = str(raw).upper().strip()
    if "CANCEL" in s:
        return "canceled"
    if "POSTPON" in s:
        return "postponed"
    if "QIE" in s or "INCUMBENT" in s:
        return "qie"
    if "PROMOTION" in s or c.is_promotion_title(title):
        return "promotion"
    if "OPEN COMPETITIVE" in s:
        return "open_competitive"
    return "unknown"


def display_title(raw):
    """DCAS writes titles in ALL CAPS in some snapshots and Title Case in
    others, for the same exam. Title Case is the house style on the DCAS
    website, so we follow it, and we keep the parenthetical qualifiers because
    they are load bearing: 'Caseworker' and 'Caseworker (NYC H+H)' are
    different exams for different employers."""
    s = str(raw).strip()
    # 71 titles in the catalog are prefixed with an asterisk. The City does not
    # say what it marks and it is not part of the name, so it goes: leaving it
    # sorts those titles above the As and reads as a footnote to nothing.
    s = s.lstrip("*").strip()
    if not s.isupper():
        return s
    small = {"of", "and", "the", "for", "a", "an", "in", "to", "or"}
    keep_upper = {"h+h", "cuny", "dep", "doe", "dot", "nyc", "hhc", "qie",
                  "n.y.c.", "hra", "dcas", "mta", "nypd", "fdny",
                  # Levels are written in Roman numerals throughout DCAS's
                  # material, and "Level Ii" is a typo the reader has to undo.
                  "i", "ii", "iii", "iv", "v", "vi"}
    out = []
    for i, word in enumerate(s.split()):
        low = word.lower()
        bare = low.strip("(),.")
        if bare in keep_upper:
            out.append(word.upper() if bare in {"i", "ii", "iii", "iv", "v", "vi"}
                       else word)
        elif i > 0 and bare in small:
            out.append(low)
        else:
            out.append(_capitalize_first_letter(low))
    return " ".join(out).replace("(Pro)", "(Prom)")


def _capitalize_first_letter(word):
    """str.capitalize() uppercases position zero, which on "(board" is the
    bracket, so the word stays lowercase. Capitalize the first letter instead."""
    for i, ch in enumerate(word):
        if ch.isalpha():
            return word[:i] + ch.upper() + word[i + 1:]
    return word


def build_exams():
    c.stage("Exams: deduplicating the snapshot stack")
    raw = c.read_cache("exam_schedule.json")
    for col in ["application_period_start", "application_period_end_date", "data_current_as_of"]:
        raw[col] = c.to_date(raw[col])

    before = len(raw)
    # Keep the most recently published version of each exam. na_position="first"
    # matters: the 429 undated pre-2023 rows must sort below the dated ones or
    # they would win the keep="last" and reinstate stale dates.
    df = (raw.sort_values("data_current_as_of", na_position="first")
             .drop_duplicates(subset=["exam_number", "exam_title"], keep="last")
             .copy())
    c.log(f"{before:,} published rows -> {len(df):,} distinct exams")

    df["exam_no"] = df.exam_number.map(lambda v: c.pad_exam_no(v, cfg.EXAM_NO_WIDTH_SCHEDULE))
    df["title"] = df.exam_title.map(display_title)
    df["title_key"] = df.exam_title.map(c.normalize_title)
    df["title_slug"] = df.title_key.map(c.slugify)
    df["exam_type"] = [clean_exam_type(t, n) for t, n in zip(df.open_competitive_promotion, df.exam_title)]
    df["start"] = df.application_period_start
    df["end"] = df.application_period_end_date
    df["fiscal_year"] = df.start.map(fiscal_year)
    df["source"] = "opendata"
    df["noe_url"] = None
    df = df[["exam_no", "title", "title_key", "title_slug", "exam_type", "start", "end",
             "fiscal_year", "data_current_as_of", "source", "noe_url"]]

    df = reconcile_with_dcas(df)
    df["status"] = derive_status(df)
    return df


def reconcile_with_dcas(df):
    """Let the DCAS live tables override application dates, and add any exam
    DCAS is running that OpenData does not carry at all."""
    c.stage("Exams: reconciling against the DCAS live tables")
    live = c.read_cache("dcas_live.json")
    if live.empty:
        c.log("no live rows, running on OpenData alone")
        return df

    live["exam_no"] = live.exam_no.map(lambda v: c.pad_exam_no(v, cfg.EXAM_NO_WIDTH_SCHEDULE))
    live["start_live"] = c.to_date(live.start_live)
    live["end_live"] = c.to_date(live.end_live)

    # Exam numbers recycle every ten years, so match against the most recently
    # published row for a number rather than any row that happens to share it.
    df = df.sort_values("data_current_as_of", na_position="first")
    newest = df.drop_duplicates(subset=["exam_no"], keep="last").set_index("exam_no")

    changed, added = [], []
    for _, row in live.iterrows():
        if row.exam_no in newest.index:
            mask = (df.exam_no == row.exam_no) & (df.title == newest.at[row.exam_no, "title"])
            old_end = df.loc[mask, "end"].iloc[0]
            if pd.notna(row.end_live) and (pd.isna(old_end) or row.end_live.date() != old_end.date()):
                changed.append((row.exam_no, newest.at[row.exam_no, "title"],
                                c.iso(old_end), c.iso(row.end_live)))
            if pd.notna(row.start_live):
                df.loc[mask, "start"] = row.start_live
            if pd.notna(row.end_live):
                df.loc[mask, "end"] = row.end_live
            df.loc[mask, "source"] = "dcas_live"
            df.loc[mask, "noe_url"] = row.noe_url
        else:
            added.append(row.exam_no)
            df = pd.concat([df, pd.DataFrame([{
                "exam_no": row.exam_no,
                "title": row.title_live,
                "title_key": c.normalize_title(row.title_live),
                "title_slug": c.slugify(c.normalize_title(row.title_live)),
                "exam_type": {"open_competitive": "open_competitive",
                              "promotion": "promotion",
                              "qie": "qie"}[row.bucket],
                "start": row.start_live,
                "end": row.end_live,
                "fiscal_year": fiscal_year(row.start_live),
                "data_current_as_of": pd.NaT,
                "source": "dcas_live",
                "noe_url": row.noe_url,
            }])], ignore_index=True)

    for exam_no, title, old, new in changed:
        c.log(f"extended  {exam_no} {title[:38]:<40} {old} -> {new}")
    if added:
        c.log(f"added     {len(added)} exam(s) DCAS is running that OpenData does "
              f"not carry: {', '.join(added)}")
    if not changed and not added:
        c.log("OpenData and DCAS agree today")
    return df


def derive_status(df):
    """open_competitive / promotion / qie exams get a date-based status.
    Canceled and postponed are carried through from the type column, because a
    canceled exam with a future date is still canceled."""
    today = c.as_of()
    status = pd.Series("unknown", index=df.index)
    start, end = df.start, df.end
    status[start.notna() & (start > today)] = "upcoming"
    status[start.notna() & end.notna() & (start <= today) & (end >= today)] = "accepting"
    status[end.notna() & (end < today)] = "closed"
    status[df.exam_type == "postponed"] = "postponed"
    status[df.exam_type == "canceled"] = "canceled"
    return status


# ---------------------------------------------------------------------------
# Civil Service Lists
# ---------------------------------------------------------------------------

def build_lists():
    """One row per established list.

    An exam can produce more than one list. Promotion exams produce a separate
    list per appointing agency, and list numbers restart at 1 on each, so exam
    number alone is not enough to place someone. 76 of 854 exams are split this
    way and the lookup page has to ask which agency.
    """
    c.stage("Civil Service Lists")
    df = c.read_cache("active_lists.json")
    for col in ["candidates", "list_no_min", "list_no_max", "score_min", "score_max", "score_mean"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    for col in ["established_date", "anniversary_date", "extension_date", "published_date"]:
        df[col] = c.to_date(df[col])

    df["exam_no"] = df.exam_no.map(lambda v: c.pad_exam_no(v, cfg.EXAM_NO_WIDTH_LIST))
    df["title"] = df.list_title_desc.map(display_title)
    df["title_key"] = df.list_title_desc.map(c.normalize_title)
    df["title_slug"] = df.title_key.map(c.slugify)

    # "OPEN COMPETITIVE" sits in the agency column as a placeholder for lists
    # that are not agency specific. It is not an agency.
    df["agency"] = df.list_agency_desc.where(
        df.list_agency_desc.str.upper() != "OPEN COMPETITIVE", None).map(
        lambda v: display_title(v) if isinstance(v, str) else None)

    split = df.groupby("exam_no").agency.nunique()
    c.log(f"{len(df):,} lists across {df.exam_no.nunique():,} exams, "
          f"{(split > 1).sum()} exams split across agencies")

    # An established list runs one to four years from establishment. The
    # anniversary date is the scheduled expiry, extension_date supersedes it.
    df["expires"] = df.extension_date.fillna(df.anniversary_date)
    today = c.as_of()
    df["expired"] = df.expires.notna() & (df.expires < today)
    df["days_left"] = (df.expires - today).dt.days.where(~df.expired)
    c.log(f"{int(df.expired.sum())} lists past their expiry date, "
          f"{int(((df.days_left >= 0) & (df.days_left <= 365)).sum())} expiring within a year")

    return attach_certification(df)


def attach_certification(df):
    """Has this list actually been called, and how far down.

    This is the difference between a list that leads to a job and one that does
    not, and no other dataset shows it. Two traps here, both silent:

      1. Padding. The certification file zero pads exam_no to five characters
         and the active list to four. The City's own column documentation says
         four for both. Joined raw you get zero matches and no error.

      2. Recycled exam numbers. Exam numbers are reused every ten years and
         this file starts in 2016, so an exam number can carry certifications
         from a previous, unrelated exam. We only count certification years at
         or after the current list was established.
    """
    c.stage("Certification history")
    cert = c.read_cache("certification.json")
    for col in ["candidates_certified", "deepest_list_no", "vacancies", "certified_count"]:
        cert[col] = pd.to_numeric(cert[col], errors="coerce")
    for col in ["first_cert_date", "last_cert_date", "cert_year"]:
        cert[col] = c.to_date(cert[col])
    cert["join_key"] = cert.exam_no.map(lambda v: c.pad_exam_no(v, cfg.EXAM_NO_WIDTH_LIST))

    # Attach every certification to its list, then drop the ones issued before
    # the list existed. An unestablished list keeps nothing.
    pairs = df[["exam_no", "established_date"]].drop_duplicates().merge(
        cert.drop(columns=["exam_no"]), left_on="exam_no", right_on="join_key", how="inner")

    # Only drop where we know the list's establishment date. About 8% of lists
    # do not publish one, and dropping their certifications too would leave
    # them reading "no one has been certified", which is a false statement
    # rather than a missing number. Those keep everything and are flagged.
    known = pairs.established_date.notna()
    stale = known & (pairs.cert_year.dt.year < pairs.established_date.dt.year)
    dropped = int(stale.sum())
    pairs = pairs[~stale]
    c.log(f"dropped {dropped:,} certifications predating the current list "
          f"(recycled exam numbers)")
    unknown = int((~known).sum())
    if unknown:
        c.log(f"{unknown:,} certifications belong to lists with no published "
              f"establishment date, kept but flagged as unverified")

    cert = pairs.groupby("exam_no").agg(
        certifications=("cert_issue_no", "nunique"),
        deepest_list_no=("deepest_list_no", "max"),
        first_cert_date=("first_cert_date", "min"),
        last_cert_date=("last_cert_date", "max"),
        vacancies_total=("vacancies", "sum"),
        certified_total=("certified_count", "sum"),
    ).reset_index()
    cert["join_key"] = cert.exam_no

    sal = c.read_cache("certification_salary.json")
    for col in [x for x in sal.columns if x != "exam_no"]:
        sal[col] = pd.to_numeric(sal[col], errors="coerce")
    sal["join_key"] = sal.exam_no.map(lambda v: c.pad_exam_no(v, cfg.EXAM_NO_WIDTH_LIST))

    out = (df.merge(cert.drop(columns=["exam_no"]), left_on="exam_no", right_on="join_key", how="left")
             .drop(columns=["join_key"])
             .merge(sal.drop(columns=["exam_no"]), left_on="exam_no", right_on="join_key", how="left")
             .drop(columns=["join_key"]))

    matched = out.certifications.notna().sum()
    c.log(f"{matched:,} of {len(out):,} lists have certification history")
    if matched == 0:
        raise RuntimeError(
            "No list matched any certification record. This is the exam_no "
            "padding trap: check EXAM_NO_WIDTH_LIST and EXAM_NO_WIDTH_CERT in "
            "config.py against the actual values in the two datasets."
        )

    # How deep has the City gone. Deliberately not published as a percentage:
    # candidates drop off the active list once appointed, so the denominator
    # shrinks and some lists compute to over 100%. We publish both numbers and
    # let the reader see the shape.
    #
    # Three states, not two. "unknown" is for a list with no published
    # establishment date and no certification record: we cannot tell an
    # untouched list from one whose history we could not attribute, and saying
    # "never" there would be asserting something we do not know.
    has_certs = out.certifications.notna() & (out.certifications > 0)
    out["called"] = np.where(
        has_certs, "yes",
        np.where(out.established_date.notna(), "never", "unknown"))
    out["cert_verified"] = out.established_date.notna()
    c.log(f"called: {(out.called == 'yes').sum():,} yes, "
          f"{(out.called == 'never').sum():,} never, "
          f"{(out.called == 'unknown').sum():,} unknown")
    over = (out.deepest_list_no > out.list_no_max).sum()
    c.log(f"{int(over)} lists certified past their current highest list number "
          f"(appointees leave the active list, so this is expected)")
    return out


# ---------------------------------------------------------------------------
# Titles
# ---------------------------------------------------------------------------

def build_catalog(lists, exams):
    """The full title catalog, one row per title code.

    This is the spine of the title directory. Every other frame in this
    pipeline only knows about titles the City is currently examining or has an
    active list for, which is a minority of what exists. A title with no exam
    and no list still has hours, a salary band, and a union, and this is where
    they live.

    Two source quirks are resolved here:

      1. A title code carries one row per assignment level salary band, so 3,372
         rows are 2,625 titles. We collapse to one row per code and keep the
         full span of the bands: the lowest minimum and the highest maximum.
         Reporting a single band's range as the title's range understates it.

      2. `descr` is hard truncated at 30 characters, and 49% of rows hit the
         limit exactly. Names are recovered from fuller sources in two passes,
         and what cannot be recovered is flagged rather than quietly shown as
         if it were complete. See recover_titles().
    """
    c.stage("Title catalog")
    raw = c.read_cache("titles_catalog.json")
    for col in ["std_hrs", "min_rate", "max_rate"]:
        raw[col] = pd.to_numeric(raw[col], errors="coerce")
    raw["title_code"] = raw.title.astype(str).str.strip().str.zfill(5)

    truncated = (raw.descr.astype(str).str.len() >= cfg.TITLE_DESCR_TRUNCATION_LENGTH).mean()
    c.log(f"{len(raw):,} rows, {raw.title_code.nunique():,} title codes, "
          f"{truncated:.0%} of descriptions hit the 30 character truncation")

    df = raw.groupby("title_code").agg(
        descr=("descr", "first"),
        std_hrs=("std_hrs", "max"),
        salary_min=("min_rate", "min"),
        salary_max=("max_rate", "max"),
        bands=("asg_lvl", "nunique"),
        union_descr=("union_descr", "first"),
        barg_descr=("barg_descr", "first"),
        investigation=("investigation_before_appointment", "first"),
    ).reset_index()
    c.log(f"collapsed to {len(df):,} titles, "
          f"{int((df.bands > 1).sum()):,} spanning more than one assignment level")

    df = recover_titles(df, lists, exams)

    df["title_key"] = df.title.map(c.normalize_title)

    # The title code goes in every slug, not only where a name collides.
    #
    # 161 names in the catalog belong to more than one code, and they are not
    # duplicates: Administrative Graphic Artist is code 10003, a non-union
    # managerial title capped at $293,038, and also code 1000D, a District
    # Council 37 title capped at $201,607. Same name, different job.
    #
    # Suffixing only the collisions would give cleaner URLs today and break them
    # later, because a name that is unique now stops being unique the first time
    # the City adds a variant, and this site rebuilds daily. The code is also
    # DCAS's own identifier and appears on the Notice of Examination, so it is
    # not noise to the person reading it.
    df["title_slug"] = [f"{c.slugify(k)}-{code.lower()}"
                        for k, code in zip(df.title_key, df.title_code)]
    assert df.title_slug.is_unique, "title slugs must be unique, they are URLs"
    return df


def recover_titles(df, lists, exams):
    """Undo as much of the 30 character truncation as the other sources allow.

    Two passes, both exact, neither fuzzy. A fuzzy match here would put the
    wrong salary and the wrong union on a title page, which is worse than
    showing a name the City itself publishes cut short.

      Pass 1, title code. The active list carries `list_title_code`, the only
      column anywhere that shares the catalog's five digit key. An exact code
      match is unambiguous.

      Pass 2, exact prefix. A truncated name is a literal prefix of its full
      name, so a full name from another source that starts with those 30
      characters is a candidate. Only accepted where exactly one candidate
      exists. Two titles starting the same way ("Assistant Commissioner
      (DEPART...") stay truncated rather than being assigned one at random.

      Pass 2 also clears the flag rather than only replacing names. A source
      name that is exactly the 30 characters and stops there is evidence the
      name was complete and merely happens to be 30 long. Emergency
      Preparedness Manager is exactly 30 characters and entirely intact, and
      marking it "may be cut short" would be a false warning.

    The comparison pool deliberately excludes the catalog's own `descr`. Every
    truncated string trivially matches itself, and treating that as evidence of
    completeness would clear the flag on exactly the rows that need it.

    What is left over is not a matching failure. Most of these titles have no
    exam and no active list in any dataset, which is precisely the population
    this catalog exists to reveal, so no fuller spelling exists anywhere to
    recover. Those keep the City's string and carry name_truncated, and the
    page says so rather than presenting a fragment as a complete title.
    """
    by_code = (lists[lists.list_title_code.notna()]
               .assign(title_code=lambda d: d.list_title_code.astype(str).str.strip().str.zfill(5))
               .drop_duplicates("title_code")
               .set_index("title_code").title)
    matched = df.title_code.map(by_code)
    with_list = int(matched.notna().sum())
    c.log(f"{with_list:,} titles named from an active list by title code "
          f"({with_list / len(by_code):.0%} of the {len(by_code):,} titles that have one)")

    paygap = c.read_cache("paygap_titles.json")
    pool = set()
    for series in (lists.list_title_desc, exams.title, paygap.title):
        pool |= {str(v).strip().upper() for v in series.dropna()}

    hit_limit = df.descr.astype(str).str.len() >= cfg.TITLE_DESCR_TRUNCATION_LENGTH
    recovered, confirmed = {}, set()
    ambiguous = 0
    for idx, descr in df.descr[hit_limit & matched.isna()].items():
        prefix = str(descr).strip().upper()
        candidates = {p for p in pool if p.startswith(prefix)}
        longer = {p for p in candidates if len(p) > len(prefix)}
        if prefix in candidates and not longer:
            confirmed.add(idx)
        elif len(longer) == 1:
            recovered[idx] = longer.pop()
        elif len(longer) > 1:
            ambiguous += 1
    c.log(f"{len(recovered):,} names recovered by exact prefix, "
          f"{len(confirmed):,} confirmed complete at exactly 30 characters, "
          f"{ambiguous:,} left truncated because several titles share the prefix")

    df["title"] = matched.fillna(pd.Series(recovered)).fillna(df.descr).map(display_title)
    df["name_truncated"] = (hit_limit & matched.isna()
                            & ~df.index.isin(recovered) & ~df.index.isin(confirmed))
    c.log(f"{int(df.name_truncated.sum()):,} titles keep a name that may be cut short "
          f"at 30 characters, flagged for the page to say so")
    return df


def build_titles(exams, lists, catalog):
    """Salary context, keyed the same way every other join here is keyed."""
    c.stage("Salary context")
    paygap = c.read_cache("paygap_titles.json")
    paygap["title_key"] = paygap.title.map(c.normalize_title)
    paygap = paygap.sort_values("fiscal_year").drop_duplicates("title_key", keep="last")

    keys = pd.Index(sorted(set(exams.title_key) | set(lists.title_key)
                           | set(catalog.title_key)))
    matched = keys.isin(set(paygap.title_key))
    c.log(f"{len(keys):,} distinct titles across all sources, {matched.sum():,} "
          f"with a payroll counterpart ({matched.mean():.0%})")

    covered = lists[lists.title_key.isin(set(paygap.title_key))].candidates.sum()
    total = lists.candidates.sum()
    c.log(f"{covered:,.0f} of {total:,.0f} candidates ({covered/total:.0%}) are on a "
          f"list whose title has salary context")
    return paygap.set_index("title_key")


# ---------------------------------------------------------------------------

def main():
    exams = build_exams()
    lists = build_lists()
    catalog = build_catalog(lists, exams)
    paygap = build_titles(exams, lists, catalog)

    c.stage("Summary as of " + c.as_of().strftime("%Y-%m-%d"))
    for name, n in exams.status.value_counts().items():
        c.log(f"{name:<12} {n:>5}")

    cfg.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    exams.to_pickle(cfg.CACHE_DIR / "prepared_exams.pkl")
    lists.to_pickle(cfg.CACHE_DIR / "prepared_lists.pkl")
    catalog.to_pickle(cfg.CACHE_DIR / "prepared_catalog.pkl")
    paygap.to_pickle(cfg.CACHE_DIR / "prepared_paygap.pkl")
    print(f"\nPrepared frames written to {cfg.CACHE_DIR}/. Run pipeline/03_export.py next.")


if __name__ == "__main__":
    main()
