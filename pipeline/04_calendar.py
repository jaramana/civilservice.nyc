"""
Stage 4: calendar. Turns the published exams into iCalendar files.

Two outputs, one generator:

  docs/exams.ics            every exam still open or still coming, one file,
                            meant to be subscribed to so it keeps updating
  docs/calendar/<exam>.ics  one file per exam, meant to be downloaded once
                            from that exam's page

Each exam becomes two all-day events, "applications open" and "last day to
apply", and the closing one carries a reminder a few days ahead. Missing a
close date can cost someone a year, so that is the event worth alarming on.

Why a calendar file and not an email list: the reminder fires from the
subscriber's own phone. There is no server, no address to store, and no
account, which is the whole point of the project. Nothing here knows who
subscribed.

Format notes, since iCalendar is fussier than it looks:

  * Lines end CRLF and fold at 75 octets, RFC 5545 section 3.1. Readers do
    reject long unfolded lines, so this is not cosmetic.
  * An all-day event's DTEND is exclusive. A one day event ends the next day.
  * UID must be stable forever for a given event. Change the scheme and every
    subscriber gets a duplicate instead of an update.
  * DTSTAMP is deliberately not "now". It tracks the source data's own
    currency date, so a run that changes nothing writes a byte-identical file
    and the refresh workflow has nothing to commit.
"""

import json
import shutil
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import config as cfg  # noqa: E402


# SEQUENCE has to rise when an event changes and never fall. Counting days from
# a fixed point gives that for free: it advances only when DCAS republishes,
# and it is the same number on every machine.
SEQUENCE_EPOCH = date(2020, 1, 1)


# ---------------------------------------------------------------------------
# Writing the format
# ---------------------------------------------------------------------------

def escape(text):
    """Escape a value for an iCalendar TEXT property (RFC 5545 3.3.11).

    Backslash first, or the escapes we add get escaped again.
    """
    return (str(text)
            .replace("\\", "\\\\")
            .replace(";", "\\;")
            .replace(",", "\\,")
            .replace("\r\n", "\\n")
            .replace("\n", "\\n"))


def fold(line):
    """Fold one content line to 75 octets, continuing with a leading space.

    The limit counts bytes, not characters, so this walks the UTF-8 encoding
    and never splits a multi-byte character across two lines.
    """
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line

    out, start, width = [], 0, 75
    while start < len(raw):
        end = min(start + width, len(raw))
        # Back off until we are on a character boundary. Continuation bytes are
        # 10xxxxxx.
        while end < len(raw) and (raw[end] & 0xC0) == 0x80:
            end -= 1
        out.append(raw[start:end].decode("utf-8"))
        start = end
        width = 74          # continuation lines lose one octet to the space
    return "\r\n ".join(out)


def prop(name, value, **params):
    """One property line: NAME;PARAM=value:VALUE, folded."""
    for key, val in params.items():
        name = f"{name};{key.replace('_', '-')}={val}"
    return fold(f"{name}:{value}")


def as_date(value):
    return datetime.strptime(value, "%Y-%m-%d").date()


def ical_date(value):
    return value.strftime("%Y%m%d")


# ---------------------------------------------------------------------------
# Building the events
# ---------------------------------------------------------------------------

def exam_url(exam):
    return cfg.EXAM_URL_TEMPLATE.format(base=cfg.SITE_BASE_URL,
                                        exam_no=exam["exam_no"])


def describe(exam, kind):
    """The body of the event. Plain sentences, because this lands in a phone
    notification with no styling and often no link preview."""
    lines = []
    if kind == "open":
        lines.append(f"Applications open for {exam['title']}, "
                     f"Exam {exam['exam_no']}.")
    else:
        lines.append(f"Today is the last day to apply for {exam['title']}, "
                     f"Exam {exam['exam_no']}.")

    if exam.get("start") and exam.get("end"):
        lines.append(f"Application period: {exam['start']} to {exam['end']}.")

    lines.append(f"Apply through OASys: {cfg.OASYS_URL}")
    if exam.get("noe_url"):
        lines.append(f"Notice of Examination: {exam['noe_url']}")
    lines.append(f"Exam details: {exam_url(exam)}")
    lines.append("Dates come from DCAS and can be extended. "
                 "Confirm on nyc.gov before relying on this.")
    return "\n".join(lines)


def event(exam, kind, stamp, sequence):
    """One VEVENT, as a list of lines.

    kind is "open" or "close". Both are all-day events on a single day rather
    than one event spanning the period: a multi-week block reads as a smear in
    month view, and the reminder that matters hangs off the closing date.
    """
    day = as_date(exam["start"] if kind == "open" else exam["end"])
    verb = "Applications open" if kind == "open" else "Last day to apply"

    lines = [
        "BEGIN:VEVENT",
        prop("UID", f"exam-{exam['exam_no']}-{exam['fiscal_year']}-{kind}"
                    f"@{cfg.CALENDAR_UID_DOMAIN}"),
        prop("DTSTAMP", stamp),
        prop("DTSTART", ical_date(day), VALUE="DATE"),
        # Exclusive end. A single all-day event ends on the following day.
        prop("DTEND", ical_date(day + timedelta(days=1)), VALUE="DATE"),
        prop("SUMMARY", escape(f"{verb}: {exam['title']} "
                               f"(Exam {exam['exam_no']})")),
        prop("DESCRIPTION", escape(describe(exam, kind))),
        prop("URL", exam_url(exam)),
        prop("CATEGORIES", escape(cfg.CALENDAR_NAME)),
        prop("SEQUENCE", sequence),
        # Free, not busy. An application deadline should not make someone look
        # unavailable to their colleagues all day.
        "TRANSP:TRANSPARENT",
        "STATUS:CONFIRMED",
    ]

    if kind == "close":
        days = cfg.CALENDAR_REMINDER_DAYS_BEFORE_CLOSE
        lines += [
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            prop("TRIGGER", f"-P{days}D", RELATED="START"),
            prop("DESCRIPTION", escape(
                f"{exam['title']} (Exam {exam['exam_no']}) closes in "
                f"{days} days. Apply at {cfg.OASYS_URL}")),
            "END:VALARM",
        ]

    lines.append("END:VEVENT")
    return lines


def calendar(exams, stamp, sequence, name):
    """Wrap events in a VCALENDAR and return the finished file as text."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        prop("PRODID", f"-//{cfg.CALENDAR_UID_DOMAIN}//NYC civil service "
                       f"exams//EN"),
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        # NAME and DESCRIPTION are the standard properties (RFC 7986). The
        # X-WR- pair is the old Apple convention, kept because Google Calendar
        # still reads those and ignores the standard ones.
        prop("NAME", escape(name)),
        prop("X-WR-CALNAME", escape(name)),
        prop("DESCRIPTION", escape(cfg.CALENDAR_DESCRIPTION)),
        prop("X-WR-CALDESC", escape(cfg.CALENDAR_DESCRIPTION)),
        prop("X-WR-TIMEZONE", "America/New_York"),
        prop("REFRESH-INTERVAL", f"PT{cfg.CALENDAR_REFRESH_HOURS}H",
             VALUE="DURATION"),
        prop("X-PUBLISHED-TTL", f"PT{cfg.CALENDAR_REFRESH_HOURS}H"),
        prop("SOURCE", f"{cfg.SITE_BASE_URL}/{cfg.CALENDAR_FEED_FILENAME}",
             VALUE="URI"),
    ]

    for exam in exams:
        for kind in ("open", "close"):
            if exam.get("start" if kind == "open" else "end"):
                lines += event(exam, kind, stamp, sequence)

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    # newline="" so the CRLF endings built above survive on every platform.
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    return len(text.encode("utf-8"))


# ---------------------------------------------------------------------------

def main():
    c.stage("calendar")

    exams = json.loads((cfg.DATA_DIR / "exams.json").read_text())
    meta = json.loads((cfg.DATA_DIR / "meta.json").read_text())

    # Not the build time. See the note at the top of this file: pinning the
    # stamp to the data's own currency date is what keeps a no-change run from
    # producing a commit every day.
    currency = meta.get("schedule_current_as_of") or meta["as_of"]
    stamp = f"{as_date(currency).strftime('%Y%m%d')}T000000Z"
    sequence = (as_date(currency) - SEQUENCE_EPOCH).days

    live = [e for e in exams if e["status"] in cfg.CALENDAR_FEED_STATUSES]
    if not live:
        # Legitimately possible for a day or two between application periods,
        # so this is a note rather than a failure. An empty VCALENDAR is valid
        # and subscribers simply see nothing.
        c.log("no open or upcoming exams, writing an empty feed")

    feed = cfg.DOCS_DIR / cfg.CALENDAR_FEED_FILENAME
    size = write(feed, calendar(live, stamp, sequence, cfg.CALENDAR_NAME))
    c.log(f"{feed.name}: {len(live):,} exams, "
          f"{sum(1 for e in live for k in ('start', 'end') if e.get(k)):,} "
          f"events, {size/1024:.0f} KB")

    # One file per exam. The directory is rebuilt rather than added to, so an
    # exam that has closed since the last run loses its file instead of
    # leaving a stale download link behind.
    per_exam = cfg.DOCS_DIR / cfg.CALENDAR_DIR_NAME
    if per_exam.exists():
        shutil.rmtree(per_exam)
    per_exam.mkdir(parents=True)

    for exam in live:
        name = f"{exam['slug']}-{exam['exam_no']}.ics"
        write(per_exam / name,
              calendar([exam], stamp, sequence,
                       f"{exam['title']} (Exam {exam['exam_no']})"))
    c.log(f"{cfg.CALENDAR_DIR_NAME}/: {len(live):,} single-exam files")

    c.log(f"subscribe URL: webcal://{cfg.SITE_BASE_URL.split('//')[1]}"
          f"/{cfg.CALENDAR_FEED_FILENAME}")


if __name__ == "__main__":
    main()
