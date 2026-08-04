"""
Every tunable in the project lives here.

The point of this file is that you can change an assumption without reading the
pipeline. If you find yourself editing a number inside pipeline/*.py, that
number probably belongs here instead.

Vocabulary note: we follow DCAS's own words wherever DCAS has a word for it.
"Application Period" (not "filing window"), "Notice of Examination", "Open
Competitive", "Promotion", "Civil Service List", "List Number", "Adjusted Final
Average". The DCAS glossary is at
https://www.nyc.gov/site/dcas/employment/civil-service-glossary.page
"""

from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT = Path(__file__).parent
CACHE_DIR = ROOT / "data-raw"      # untouched API responses, gitignored
DOCS_DIR = ROOT / "docs"           # what GitHub Pages serves
DATA_DIR = DOCS_DIR / "data"       # the JSON the browser fetches


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

SOCRATA_DOMAIN = "data.cityofnewyork.us"

# NYC OpenData dataset IDs. If DCAS republishes a dataset under a new ID, this
# is the only place you change it.
DATASET_EXAM_SCHEDULE = "4ptz-hmtc"   # Annual Examination Schedule of Each Fiscal Year
DATASET_ACTIVE_LIST = "vx8i-nprf"     # Civil Service List (Active)
DATASET_CERTIFICATION = "a9md-ynri"   # Civil Service List Certification
DATASET_TITLES = "nzjr-3966"          # NYC Civil Service Titles, the full catalog

# An app token raises the Socrata rate limit. Optional: everything works
# without one, just slower and throttled harder. Set SOCRATA_APP_TOKEN in the
# environment (the GitHub Action passes it through as a secret if present).
SOCRATA_APP_TOKEN_ENV = "SOCRATA_APP_TOKEN"

# Salary context comes from thepaygap.nyc. We read the raw file from GitHub
# rather than the custom domain, because the custom domain currently has no
# working HTTPS certificate and a plain-HTTP fetch would be a bad dependency.
PAYGAP_TITLES_URL = (
    "https://raw.githubusercontent.com/jaramana/thepaygap.nyc/master/docs/data/titles-index.json"
)
# Deep link into thepaygap.nyc for a single title. This is that site's actual
# URL convention, taken from docs/js/lookup.js there, not a guess.
#
# Plain http on purpose, for now. thepaygap.nyc has no valid HTTPS certificate
# for its custom domain: https://thepaygap.nyc fails with a subject name
# mismatch. Linking over https would give every salary link on this site a
# certificate error. Switch this to https the moment that is fixed on the other
# repository, which is a GitHub Pages setting rather than a code change.
PAYGAP_TITLE_URL_TEMPLATE = "http://thepaygap.nyc/lookup.html?title={slug}"

# --- The fourth source, added deliberately. Read this before turning it off. --
#
# The OpenData exam schedule is the annual plan. When DCAS extends an
# application period mid-year, the live HTML tables are updated first and
# OpenData lags, sometimes by weeks. Checked 2026-08-01: DCAS listed 8 exams
# open for applications, OpenData showed 2. Four had been extended from 7/21 to
# 8/25 with OpenData still showing 7/21, and two were prior-fiscal-year exam
# numbers absent from the current snapshot entirely.
#
# Telling someone an exam is closed while DCAS is still accepting their
# application is the worst mistake this site could make, so we reconcile
# against these three tables and let them win on application dates.
#
# Set to False to run on OpenData alone. The pipeline still works, it is just
# wrong about what is open.
USE_DCAS_LIVE = True

DCAS_LIVE_PAGES = {
    # bucket name -> URL of a page whose first <table> is the exam table
    "open_competitive": "https://www.nyc.gov/site/dcas/employment/exam-schedules-open-competitive-exams.page",
    "promotion": "https://www.nyc.gov/site/dcas/employment/exam-schedules-promotion-exams.page",
    "qie": "https://www.nyc.gov/site/dcas/employment/exam-schedules-exams-for-provisional-employees.page",
}

# nyc.gov's edge blocks non-browser user agents with a 403. We would rather
# identify the pipeline honestly, and we tried: any user agent containing a
# "+https://..." contact URL, the usual polite-crawler convention, is refused.
# So this is a plain browser string with the project named in front, which is
# the most honest form nyc.gov will actually serve. Three page loads a day.
HTTP_USER_AGENT = (
    "civilservice.nyc pipeline"
    " Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/126 Safari/537.36"
)

HTTP_TIMEOUT_SECONDS = 120
HTTP_RETRIES = 3

# Where people actually apply. Every exam links here.
OASYS_URL = "https://www.nyc.gov/examsforjobs"


# ---------------------------------------------------------------------------
# What "now" means
# ---------------------------------------------------------------------------

# The reference date for open/upcoming/closed. None means "use today's date at
# build time". Set to an ISO date string like "2026-08-05" to see how the site
# will look on a given day, which is the only sane way to test a Wednesday.
#
# Simulating a future date replays today's data against that date. It does not
# know about extensions DCAS has not published yet, so it shows the shape of the
# page rather than a forecast. Useful states to check:
#   2026-08-05  19 exams accepting, the busiest kind of day
#   2026-12-25   0 exams accepting, which really does happen
AS_OF_DATE = None

# Reporting windows for the counts in meta.json. The site itself no longer
# uses them: the front page groups every exam by status and lets the reader
# choose which groups to see, rather than silently windowing the list. These
# stay because "how many exams opened in the last 60 days" is a useful number
# to have in the published metadata.
UPCOMING_WINDOW_DAYS = 60      # counts only: exams opening within this many days
RECENTLY_CLOSED_DAYS = 45      # counts only: exams closed within this many days

# The exam schedule dataset stacks published snapshots rather than replacing
# rows, and there is a twelve month hole where DCAS never published the FY2025
# schedule (no application period starts between 2024-07 and 2025-06). Below
# this date the archive is too patchy to present as a record of anything, so we
# do not publish it. Raise this if you would rather show less and claim less.
ARCHIVE_FLOOR = "2025-07-01"


# ---------------------------------------------------------------------------
# Join keys and data quirks
# ---------------------------------------------------------------------------

# exam_no is zero padded to a different width in each dataset. The City's own
# column documentation says "four (4) digit" in both, which is wrong for the
# certification file. Join them raw and you get zero rows back with no error,
# which is exactly the kind of silent failure this project should not have.
EXAM_NO_WIDTH_SCHEDULE = 4     # 4ptz-hmtc stores this as a plain number
EXAM_NO_WIDTH_LIST = 4         # vx8i-nprf, e.g. "6601"
EXAM_NO_WIDTH_CERT = 5         # a9md-ynri, e.g. "06601"

# DCAS recycles exam numbers every ten years. Our archive floor keeps us well
# inside one cycle, but never treat an exam number as a permanent identifier.
EXAM_NO_RECYCLE_YEARS = 10

# The certification salary column mixes annual salaries and hourly rates in one
# field with no flag. About 8% of recent rows are hourly. Anything below this is
# read as an hourly rate.
HOURLY_SALARY_THRESHOLD = 200

# Full time equivalent hours, used only to show an hourly rate as an approximate
# annual figure. Always labeled as approximate on the site.
ANNUAL_HOURS = 2080

# Certification counts get noisy going back to 2016. This is how far back we
# look when answering "has this list actually been called".
CERT_LOOKBACK_YEARS = 5


# ---------------------------------------------------------------------------
# Title matching
# ---------------------------------------------------------------------------

# title_code is null on 87% of exam schedule rows, so the numeric join between
# an exam and a civil service title does not exist. Everything matches on the
# normalized title string instead. These are the suffixes stripped before
# comparing. Order matters: longest first.
TITLE_SUFFIXES_TO_STRIP = ["(PROM)", "(PRO)"]

# Abbreviations DCAS uses inconsistently between the exam schedule and the
# payroll data. Applied during normalization, left side is what we see.
TITLE_ALIASES = {
    "NYC H+H": "NYC HEALTH + HOSPITALS",
    "NYC HEALTH AND HOSPITALS": "NYC HEALTH + HOSPITALS",
}

# Only exact matches after normalization become a salary link. A fuzzy match
# that puts the wrong salary on a title is worse than no salary at all, so
# there is deliberately no fuzzy fallback here.

# The title catalog (nzjr-3966) is the one dataset with a usable numeric key.
# Its five digit `title` column joins directly to the active list's
# `list_title_code` for 84% of titles, so we try the code first and fall back
# to the normalized title string only for the remainder. This is the reverse of
# everywhere else in the pipeline, where no code exists to try.
TITLE_CODE_JOIN_FIRST = True

# `descr` in the title catalog is hard truncated at 30 characters and 49% of
# rows hit the limit exactly, cutting words mid-syllable ("ASSISTANT SYSTEMS
# ANALYST (HHC" with no closing bracket). Where an exam or list carries the
# same title spelled in full we display that instead, and fall back to `descr`
# only when it is the only name we have.
TITLE_DESCR_TRUNCATION_LENGTH = 30


# ---------------------------------------------------------------------------
# Freshness and failure
# ---------------------------------------------------------------------------

# GitHub disables scheduled workflows after 60 days of repository inactivity.
# If that happens the refresh stops silently, so the site says so out loud.
STALENESS_NOTICE_DAYS = 14     # page shows a quiet "checked N days ago" note
STALENESS_WARN_DAYS = 30       # page shows a visible warning banner

# Which sources the staleness warning watches.
#
# Deliberately not all of them. The warning tells someone the application dates
# below may be wrong, so it should track the datasets that carry application
# dates. The title catalog is republished roughly monthly by its nature, and
# including it meant a normal 32 day old catalog raised a banner claiming exam
# dates were unreliable, which was false and would have trained people to
# ignore the banner that matters.
STALENESS_SOURCES = ["exam_schedule", "active_list", "certification"]

# Row counts below these mean a source has changed shape or a fetch was
# truncated. The pipeline raises rather than writing a half-empty site.
MIN_ROWS_EXAM_SCHEDULE = 1000
MIN_ROWS_ACTIVE_LIST_TITLES = 200
MIN_ROWS_CERT_EXAMS = 500
MIN_ROWS_TITLES = 3000          # catalog held 3,372 rows on 2026-07-01

# Columns we require. If DCAS renames or drops one, fail loudly here rather
# than producing JSON with a silently missing field.
REQUIRED_COLUMNS = {
    DATASET_EXAM_SCHEDULE: [
        "exam_title", "exam_number", "application_period_start",
        "application_period_end_date", "open_competitive_promotion",
        "data_current_as_of",
    ],
    DATASET_ACTIVE_LIST: [
        "exam_no", "list_no", "adj_fa", "list_title_code", "list_title_desc",
        "list_agency_desc", "established_date", "anniversary_date",
        "extension_date",
    ],
    DATASET_CERTIFICATION: [
        "exam_no", "list_no", "list_title_desc", "cert_date", "salary",
        "no_certified", "no_vacancies",
    ],
    DATASET_TITLES: [
        "title", "descr", "std_hrs", "asg_lvl", "union_descr", "barg_descr",
        "min_rate", "max_rate",
    ],
}

# Personal columns. These are never requested from the API, never cached, and
# never written. Listed here so the guarantee is checkable rather than implied.
# 01_fetch.py asserts that no fetched frame contains any of these.
FORBIDDEN_COLUMNS = [
    "first_name", "last_name", "mi",
    "veteran_credit", "parent_lgy_credit",
    "sibling_lgy_credit", "residency_credit",
]


# ---------------------------------------------------------------------------
# Calendar feed
# ---------------------------------------------------------------------------
#
# DCAS has no per-exam alert. The closest thing it offers is the NYC Jobs
# Newsletter, a periodic roundup rather than a "this closes Friday" notice:
# https://www.nyc.gov/site/dcas/about/citywide-administrative-services-newsletter-sign-up.page
# Email reminders would need a backend and a list of addresses, which this
# project does not want. A calendar feed gets the same result with a static
# file: the reminder fires from the reader's own phone, we never learn who
# subscribed, and there is nothing to run.

SITE_BASE_URL = "https://civilservice.nyc"

# Where the calendar files go, relative to docs/.
CALENDAR_FEED_FILENAME = "exams.ics"    # the whole feed, meant to be subscribed to
CALENDAR_DIR_NAME = "calendar"          # one file per exam, meant to be downloaded

# UIDs must be globally unique and must never change for a given event, or a
# subscriber gets a duplicate instead of an update. This is the domain part.
CALENDAR_UID_DOMAIN = "civilservice.nyc"

# What the subscribed feed carries. Closed exams are left out on purpose: a
# calendar full of deadlines that have already passed is noise, and the reader
# keeps whatever it already downloaded for exams it saw while they were open.
CALENDAR_FEED_STATUSES = ["accepting", "upcoming"]

# Days before the last day to apply that the reminder fires. Applications go
# through OASys and can need documents, so this is not a same-day nudge.
CALENDAR_REMINDER_DAYS_BEFORE_CLOSE = 3

# How often a calendar reader should re-check the feed. Readers treat this as a
# hint and Google Calendar in particular refreshes on its own schedule, often
# closer to a day. The pipeline runs daily, so asking for more is pointless.
CALENDAR_REFRESH_HOURS = 12

# Where a calendar event points when someone clicks through. The site has to
# honor this shape, so if the exam page ever moves, this is the one line that
# changes and the next refresh rewrites every event.
EXAM_URL_TEMPLATE = "{base}/exam.html?exam={exam_no}"

CALENDAR_NAME = "NYC Civil Service Exams"
CALENDAR_DESCRIPTION = (
    "Application periods for New York City civil service exams. "
    "Dates come from DCAS. Always confirm on nyc.gov before relying on one."
)


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

# Round floats and drop nulls on write. The browser fetches these over a phone
# connection, so size is a feature.
JSON_INDENT = None             # None for compact, 2 while debugging
