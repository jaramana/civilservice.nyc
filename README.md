# civilservice.nyc

A website for New York City civil service exams and job titles.

Live at [jaramana.github.io/civilservice.nyc](https://jaramana.github.io/civilservice.nyc/).

The custom domain is not connected yet. When it is, add a `docs/CNAME` file
containing `civilservice.nyc` and point the DNS at GitHub Pages. `SITE_BASE_URL`
in `config.py` already assumes that domain, which is what the calendar files
link to.

## Background

The City of New York (the City) publishes exam and salary data across several
separate sources. This site combines that data into one place.

The site is for anyone who wants to apply for a City civil service job, or who
wants to check what a job title pays. Each exam shows its current status: open
for applications, coming soon, or closed. Each job title shows its pay range.

The site does not need an account. It does not track visitors. The code is
open source.

## Data sources

| Source | What it gives us |
|---|---|
| [Annual Examination Schedule](https://data.cityofnewyork.us/d/4ptz-hmtc) | Exams and application periods |
| [Civil Service List (Active)](https://data.cityofnewyork.us/d/vx8i-nprf) | Which lists exist and how large they are |
| [Civil Service List Certification](https://data.cityofnewyork.us/d/a9md-ynri) | Whether a list has been called, and hiring salaries |
| [NYC Civil Service Titles](https://data.cityofnewyork.us/d/nzjr-3966) | Every title, with hours, salary range and union |
| The DCAS exam pages | Application dates. The City updates these before its own open data. |
| [thepaygap.nyc](http://thepaygap.nyc) | Median salary actually paid, as separate context |

## Analysis

The pipeline joins and deduplicates the sources above, then works out which
exams are open, coming, or closed as of the current date.

**Data it will not show:**

- **No name search, and no list number lookup.** The active list dataset
  contains candidate names, exact scores, and flags marking who lost a parent
  or sibling in the line of duty. The fetch stage never requests, caches, or
  publishes those columns.
- **No email collection.** The calendar feed is how reminders work, and it
  runs entirely on the subscriber's own device.
- **No OCR of Notice of Examination PDFs.** The site links to the City's
  document instead of re-typing it and getting a requirement wrong.
- **No fuzzy title matching.** Putting the wrong salary on a job is worse than
  showing no salary. Only exact matches after normalization are linked.

**How the site stays current.** `.github/workflows/refresh.yml` runs the
pipeline daily and commits only when the output changed.

GitHub disables a scheduled workflow after 60 days with no repository
activity, and does not send a warning. The refresh then simply stops. Nothing
in this repository can prevent that, so the site is built to make it visible
instead: every page shows the date the City's data says it is current as of,
and a banner appears once the newest source is older than
`STALENESS_WARN_DAYS`. If the repository has had no activity for two months,
check that the workflow still has a recent run.

The date shown on each page is the dataset's own `data_current_as_of` value,
never the date of the last build. A build that runs every day against data
that stopped updating months earlier is exactly the failure this design is
meant to expose.

**When a source dataset changes.** The City sometimes renames a column or
republishes a dataset under a new identifier. The pipeline is built to fail
loudly when that happens, rather than publish a site with a field missing.

1. The run fails with a message naming the dataset and the missing column.
2. Find that dataset in `REQUIRED_COLUMNS` in `config.py`.
3. If a column was renamed, update the name there and in whichever stage reads
   it. If the dataset moved, update its `DATASET_*` identifier.
4. If a source genuinely shrank, the `MIN_ROWS_*` guard stops the run. Check
   whether the City actually published less before lowering the guard.

Confirm any exam date on [nyc.gov](https://www.nyc.gov/examsforjobs) before
you rely on it.

## Tools used

Python, pandas, and requests for the data pipeline. Vanilla HTML, CSS, and
JavaScript for the site — no framework, no build step. Claude for
development.

## Usage

You need Python 3.9 or newer. Nothing else, and no Node.

```bash
python3 -m venv .venv
.venv/bin/pip install pandas requests
.venv/bin/python run.py
```

This takes about a minute, mostly spent waiting on the City's API. It writes
everything under `docs/`.

To view the site locally:

```bash
python3 -m http.server -d docs 8000
```

Then open http://localhost:8000. The pages fetch JSON, so opening the HTML
files directly from the filesystem will not work. The site must be served.

To change how the data is shaped without downloading it again:

```bash
.venv/bin/python run.py --offline
```

This rebuilds from the copies in `data-raw/` left by the last real run.

### Changing a setting

Start in `config.py`. Every threshold, dataset ID, window, and URL lives there
with a comment saying why it is what it is. If you find yourself editing a
number inside `pipeline/`, that number probably belongs in the config file
instead.

| To do this | Change |
|---|---|
| Move the calendar reminder | `CALENDAR_REMINDER_DAYS_BEFORE_CLOSE` |
| See how the site looks on a future date | `AS_OF_DATE` |
| Publish more archive | `ARCHIVE_FLOOR`, and read the comment first |
| Stop reading the DCAS pages | `USE_DCAS_LIVE`, and read the comment first |

Colors are tokens at the top of `docs/css/site.css`, one set for light mode
and one for dark. After changing a color, run:

```bash
python3 tools/contrast.py
```

This checks every color pair in both themes against WCAG AA and exits with an
error if any pair fails. The ratios in the CSS comments come from this tool.
Do not edit those numbers by hand.

After changing anything in `docs/js/`, run:

```bash
python3 tools/checkjs.py
```

There is no build step and no compiler, so a helper function used without
being imported fails only in the browser, and only on the pages that reach
that line. This check catches that error early. Both checks also run in the
refresh workflow.

## Repository layout

```
config.py                every tunable in the project, each one commented
run.py                   runs the whole pipeline
pipeline/
  01_fetch.py            downloads from NYC Open Data and the DCAS exam pages
  02_prepare.py          joins, deduplicates, works out what is open today
  03_export.py           writes the JSON the browser reads
  04_calendar.py         writes the .ics calendar files
  common.py              shared helpers, no decisions
tools/
  contrast.py            checks every color pair against WCAG AA
docs/                    the website itself, served by GitHub Pages
  index.html             every exam, grouped by status, with search
  exam.html              one exam
  titles.html            every job title
  title.html             one job title
  how-to-apply.html      how the process works, in plain language
  methodology.html       sources, limits, and the field dictionary
  css/site.css           all the styling, colors as tokens
  js/                    one module per page, plus common.js
  data/                  generated, do not edit by hand
  calendar/              one .ics per exam, for the download buttons
  exams.ics              every open and upcoming exam in one subscribable
                         feed. Not linked from the front page: almost nobody
                         wants all 147 in their calendar. Kept because it is
                         one function call and it is the right thing for
                         anyone who wants it. Mentioned once, on the About page.
.github/workflows/
  refresh.yml            the daily rebuild
```

Nothing in `docs/data/` or `docs/calendar/` is written by hand. Both are
regenerated from scratch on every run.

## Credits

Data from [NYC Open Data](https://opendata.cityofnewyork.us/) and the New York
City Department of Citywide Administrative Services. Salary context from
[thepaygap.nyc](http://thepaygap.nyc).
