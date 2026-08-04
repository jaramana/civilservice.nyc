# civilservice.nyc

A plain website for New York City civil service exams: what is open now, what
is coming, what closed recently, and what each job title actually pays.

Free, no accounts, no tracking, open source. Built on data the City publishes.

Live at [civilservice.nyc](https://civilservice.nyc).

## What is here

```
config.py                every tunable in the project, each one commented
run.py                   runs the whole pipeline
pipeline/
  01_fetch.py            downloads from NYC OpenData and the DCAS exam pages
  02_prepare.py          joins, deduplicates, works out what is open today
  03_export.py           writes the JSON the browser reads
  04_calendar.py         writes the .ics calendar files
  common.py              shared helpers, no decisions
tools/
  contrast.py            checks every color pair against WCAG AA
docs/                    the website itself, served by GitHub Pages
  index.html             front page
  exams.html             every exam, searchable
  exam.html              one exam
  titles.html            every job title
  title.html             one job title
  how-to-apply.html      how the process works, in plain language
  methodology.html       sources, limits, and the field dictionary
  css/site.css           all the styling, colors as tokens
  js/                    one module per page, plus common.js
  data/                  generated, do not edit by hand
  exams.ics              the calendar feed people subscribe to
  calendar/              one .ics per exam, for the download buttons
.github/workflows/
  refresh.yml            the daily rebuild
```

Nothing in `docs/data/` or `docs/calendar/` is written by hand. Both are
regenerated from scratch every run.

## Running it

You need Python 3.9 or newer. Nothing else, and no Node, no build step.

```bash
python3 -m venv .venv
.venv/bin/pip install pandas requests
.venv/bin/python run.py
```

That takes about a minute, mostly waiting on the City's API. It writes
everything under `docs/`.

To look at the site:

```bash
python3 -m http.server -d docs 8000
```

Then open http://localhost:8000. The pages fetch JSON, so opening the HTML
files directly from the filesystem will not work. It has to be served.

While changing how the data is shaped, skip the download:

```bash
.venv/bin/python run.py --offline
```

That rebuilds from the copies in `data-raw/` left by the last real run.

## Changing something

**Start in `config.py`.** Every threshold, dataset ID, window and URL lives
there with a comment saying why it is what it is. If you find yourself editing
a number inside `pipeline/`, that number probably belongs in the config file
instead.

Things you might reasonably want to change:

| To do this | Change |
|---|---|
| Show more or fewer upcoming exams on the front page | `UPCOMING_WINDOW_DAYS` |
| Keep closed exams listed for longer | `RECENTLY_CLOSED_DAYS` |
| Move the calendar reminder | `CALENDAR_REMINDER_DAYS_BEFORE_CLOSE` |
| See how the site looks on a future date | `AS_OF_DATE` |
| Publish more archive | `ARCHIVE_FLOOR`, and read the comment first |
| Stop reading the DCAS pages | `USE_DCAS_LIVE`, and read the comment first |

**Colors are tokens** at the top of `docs/css/site.css`, once for light and
once for dark. After changing one, run:

```bash
python3 tools/contrast.py
```

It measures every pair in both themes and exits non-zero if anything drops
below WCAG AA. The ratios in the CSS comments come from it. Do not hand-edit
those numbers.

## When a source dataset changes

The City occasionally renames a column or republishes a dataset under a new
identifier. The pipeline is built to fail loudly when that happens rather than
publishing a site with a silently missing field.

1. The run fails with a message naming the dataset and the missing column.
2. Find that dataset in `REQUIRED_COLUMNS` in `config.py`.
3. If a column was renamed, update the name there and in whichever stage reads
   it. If the dataset moved, update its `DATASET_*` identifier.
4. If a source genuinely shrank, the `MIN_ROWS_*` guard will stop the run. Do
   not lower the guard to make the run pass without first checking whether the
   City actually published less.

## How the data updates

`.github/workflows/refresh.yml` runs the pipeline daily and commits only when
the output actually changed.

**Known gotcha, worth knowing before it bites you:** GitHub disables scheduled
workflows after 60 days with no activity in the repository, and does not warn
you. The refresh simply stops. Nothing in this repository can prevent that, so
the site is built to make it visible instead: every page carries the date the
City's data says it is current as of, and a banner appears once the newest
source is more than `STALENESS_WARN_DAYS` old. If you have not touched the repo
in two months, check that the workflow still has a recent run.

The date shown is the dataset's own `data_current_as_of`, never the build date.
A build that runs perfectly every day against data that stopped updating in
April is exactly the failure this design is meant to expose.

## Data sources

| Source | What it gives us |
|---|---|
| [Annual Examination Schedule](https://data.cityofnewyork.us/d/4ptz-hmtc) | Exams and application periods |
| [Civil Service List (Active)](https://data.cityofnewyork.us/d/vx8i-nprf) | Which lists exist and how large they are |
| [Civil Service List Certification](https://data.cityofnewyork.us/d/a9md-ynri) | Whether a list has been called, and hiring salaries |
| [NYC Civil Service Titles](https://data.cityofnewyork.us/d/nzjr-3966) | Every title, with hours, salary range and union |
| The DCAS exam pages | Application dates, which the City updates before its own open data |
| [thepaygap.nyc](http://thepaygap.nyc) | Median salary actually paid, as separate context |

## What this deliberately does not do

- **No name search, and no list number lookup.** The active list dataset
  contains candidate names, exact scores, and flags marking who lost a parent
  or sibling in the line of duty. Those columns are never requested, never
  cached, and never published. That is enforced in the fetch stage, not
  promised in prose.
- **No accounts, no email collection, no tracking.** The calendar feed is how
  reminders work, and it runs entirely on the subscriber's own device.
- **No OCR of Notice of Examination PDFs.** We link to the City's document
  rather than re-typing it and getting a requirement wrong.
- **No fuzzy title matching.** Putting the wrong salary on a job is worse than
  showing no salary, so only exact matches after normalization are linked.

## Credits

Data from [NYC OpenData](https://opendata.cityofnewyork.us/) and the New York
City Department of Citywide Administrative Services. Salary context from
[thepaygap.nyc](http://thepaygap.nyc). Built with Python, pandas and Claude.

This is not a City website and the people who made it do not work for the City.
Confirm any date on [nyc.gov](https://www.nyc.gov/examsforjobs) before you rely
on it.
