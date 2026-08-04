/* ==========================================================================
   The front page, which is also the exam search.

   One shape, held in every state. Three sections in a fixed order, always
   present, always drawn the same way:

     Accepting applications   what you can act on today
     Upcoming                 what is coming
     Closed                   what has already closed

   Searching or filtering changes what is inside those sections and how far
   each one reaches. It never rearranges the page and never redraws a row.

   Two rules this file exists to keep:

     1. A given exam looks the same everywhere. Its right-hand column is
        derived from the exam's own status and nothing else, so filtering
        cannot restyle a row that was already on screen. An earlier build drew
        a tag plus a small date while filtering and a bold date plus a
        countdown while not, which made a filter look like it had changed the
        data.

     2. A section never disappears on its own. It empties, and says so in a
        sentence. The only way a section leaves the page is if you explicitly
        ask for one group in the Show filter, which is a choice you made and
        can see in the control.

   Scope is the one thing that does change, because it has to. With nothing
   filtered the page is a bulletin: upcoming reaches UPCOMING_WINDOW_DAYS
   ahead and closed reaches RECENTLY_CLOSED_DAYS back. Search or filter for
   something and those windows open to the full published schedule, because
   someone searching for "Sanitation Worker" wants every one of them, not the
   ones inside an arbitrary window. Each section says which of the two it is
   currently showing.
   ========================================================================== */

import {
  load, el, clear, typeLabel, fmtDate, daysBetween, countdown,
  freshness, markNav, failure, count,
} from "./common.js";

/* No paging on this page. Rendering all 345 exams at once, layout included,
   measures at 11ms here and a few times that on a slow phone, which is not
   worth a button, a shown-count per section, and the state that goes with
   them. The title directory is a different case: 2,632 rows there do need it.
*/

const GROUPS = [
  // `label` reads after a count ("9 exams accepting applications"), `nothing`
  // reads as its own sentence when a section comes up empty. One string cannot
  // do both without producing "No accepting applications exams".
  { key: "accepting", label: "accepting applications", nothing: "No exams accepting applications" },
  { key: "upcoming",  label: "upcoming",               nothing: "No upcoming exams" },
  { key: "closed",    label: "closed",                 nothing: "No closed exams" },
];

const state = { q: "", status: "", type: "" };
let all = [];
let windows = {};

/* Any control with a value means the person is looking for something specific
   rather than reading the bulletin, which is what opens the date windows. */
function filtering() {
  return Boolean(state.q || state.status || state.type);
}

function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/* --------------------------------------------------------------------------
   The row. One function, no modes.
   -------------------------------------------------------------------------- */

/* The right-hand column answers the question the row's own status raises:
   an open exam has a deadline and a countdown, an upcoming one has an opening
   date and a wait, a closed one has the date it closed. No status tag, because
   the section heading directly above already says it and repeating it on every
   row is noise. */
function row(exam) {
  const link = el("a", { class: "row", href: `exam.html?exam=${exam.exam_no}` });
  link.append(el("span", { class: "name", text: exam.title }));
  link.append(el("span", {
    class: "meta",
    text: `Exam ${exam.exam_no} · ${typeLabel(exam.type)}`,
  }));

  const when = el("span", { class: "when" });
  if (exam.status === "accepting") {
    when.append(el("strong", { text: `Closes ${fmtDate(exam.end)}` }));
    when.append(el("br"));
    when.append(document.createTextNode(countdown(daysBetween(exam.end))));
  } else if (exam.status === "upcoming") {
    const days = daysBetween(exam.start);
    when.append(el("strong", { text: `Opens ${fmtDate(exam.start)}` }));
    when.append(el("br"));
    when.append(document.createTextNode(
      days <= 0 ? "any day now" : countdown(days, { verb: "away" })
    ));
  } else {
    when.append(el("strong", { text: `Closed ${fmtDate(exam.end)}` }));
  }
  link.append(when);

  return el("li", {}, link);
}

/* --------------------------------------------------------------------------
   Selecting what goes in each section
   -------------------------------------------------------------------------- */

function matchesSearch(e) {
  if (state.type && e.type !== state.type) return false;
  if (!state.q) return true;
  return e._n.includes(state.q) || e.exam_no.startsWith(state.q);
}

/* The date windows, applied only while reading the bulletin. */
function inWindow(e) {
  if (filtering()) return true;
  if (e.status === "upcoming") {
    return daysBetween(e.start) <= (windows.upcoming_days ?? 60);
  }
  if (e.status === "closed") {
    return -daysBetween(e.end) <= (windows.recently_closed_days ?? 45);
  }
  return true;
}

function rowsFor(key) {
  const rows = all.filter((e) => e.status === key && matchesSearch(e) && inWindow(e));
  if (key === "closed") rows.sort((a, b) => b.end.localeCompare(a.end));
  else if (key === "accepting") rows.sort((a, b) => a.end.localeCompare(b.end));
  else rows.sort((a, b) => a.start.localeCompare(b.start));
  return rows;
}

/* --------------------------------------------------------------------------
   Notes under each section. These carry the scope, so the reader always knows
   whether they are seeing a window or everything.
   -------------------------------------------------------------------------- */

function noteFor(key, totalInGroup) {
  const wide = filtering();

  if (key === "upcoming") {
    if (wide) {
      return totalInGroup
        ? [document.createTextNode("Every upcoming exam on the published schedule, not only the next few weeks.")]
        : [];
    }
    const beyond = all.filter((e) => e.status === "upcoming" && !inWindow(e)).length;
    const parts = [document.createTextNode(
      `Exams opening in the next ${windows.upcoming_days ?? 60} days. `)];
    if (beyond > 0) {
      parts.push(el("a", {
        href: "?status=upcoming",
        text: `${count(beyond)} more are scheduled further out.`,
      }));
    }
    return parts;
  }

  if (key === "closed") {
    const meaning = "An exam that has closed still matters: the list it " +
                    "produces is how the City hires for that title for the " +
                    "next few years.";
    if (wide) {
      const floor = windows.archive_floor;
      return [document.createTextNode(
        `${meaning} Everything back to ` +
        `${floor ? fmtDate(floor, { alwaysYear: true }) : "the archive floor"}. ` +
        `The City never published its fiscal 2025 schedule as open data, so ` +
        `the record stops there rather than showing a partial archive that ` +
        `would look complete.`)];
    }
    return [document.createTextNode(
      `Exams that closed in the last ${windows.recently_closed_days ?? 45} days. ${meaning}`)];
  }

  return [];
}

/* The empty line for a section. Never a blank space: a section with nothing in
   it says why, and the accepting one says when that changes. */
function emptyFor(key) {
  if (filtering()) {
    const what = state.q
      ? `match “${document.getElementById("q").value.trim()}”`
      : "match those filters";
    return [document.createTextNode(
      `${GROUPS.find((g) => g.key === key).nothing} ${what}.`)];
  }

  if (key === "accepting") {
    const next = all
      .filter((e) => e.status === "upcoming")
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    const parts = [el("strong", { text: "No exams are accepting applications today. " })];
    parts.push(document.createTextNode(next
      ? `The City opens most application periods on the first Wednesday of the ` +
        `month. The next one is ${next.title}, opening ` +
        `${fmtDate(next.start, { alwaysYear: true })}.`
      : "There is nothing scheduled to open in the published schedule either, " +
        "which usually means DCAS has not posted the coming year yet."));
    return parts;
  }

  return [document.createTextNode("Nothing here right now.")];
}

/* --------------------------------------------------------------------------
   Render
   -------------------------------------------------------------------------- */

function renderGroup(key) {
  const rows = rowsFor(key);

  const list = document.getElementById(`list-${key}`);
  clear(list);
  rows.forEach((e) => list.append(row(e)));

  document.getElementById(`count-${key}`).textContent = count(rows.length);

  const empty = document.getElementById(`empty-${key}`);
  clear(empty);
  empty.hidden = rows.length > 0;
  if (!rows.length) emptyFor(key).forEach((n) => empty.append(n));

  const note = document.getElementById(`note-${key}`);
  clear(note);
  const parts = noteFor(key, rows.length);
  parts.forEach((n) => note.append(n));
  note.hidden = parts.length === 0;

  // A section only leaves the page when the Show control asks for one group.
  document.getElementById(`section-${key}`).hidden =
    Boolean(state.status) && state.status !== key;

  return rows.length;
}

function render() {
  const totals = {};
  GROUPS.forEach((g) => { totals[g.key] = renderGroup(g.key); });

  // One line above everything saying what the page is currently showing, so
  // the state is legible without reading three section headings.
  const summary = document.getElementById("summary");
  const visible = GROUPS
    .filter((g) => !state.status || state.status === g.key)
    .reduce((n, g) => n + totals[g.key], 0);

  if (!filtering()) {
    summary.textContent =
      `${count(totals.accepting)} exam${totals.accepting === 1 ? "" : "s"} ` +
      `accepting applications right now. Search or filter to see the whole schedule.`;
    return;
  }

  // Built as a sentence rather than a list of clauses. The exam type is an
  // adjective ("100 promotion exams"), not a trailing fragment, because
  // "100 exams promotion" is what you get if you just join everything.
  const kind = state.type ? `${typeLabel(state.type).toLowerCase()} ` : "";
  const qualifiers = [];
  if (state.q) qualifiers.push(`matching “${document.getElementById("q").value.trim()}”`);
  if (state.status) qualifiers.push(GROUPS.find((g) => g.key === state.status).label);
  const tail = qualifiers.length ? ` ${qualifiers.join(", ")}` : "";

  summary.textContent = visible
    ? `${count(visible)} ${kind}exam${visible === 1 ? "" : "s"}${tail}.`
    : `No ${kind}exams${tail}.`;
}

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */

function pushUrl() {
  const params = new URLSearchParams();
  if (state.q) params.set("q", document.getElementById("q").value.trim());
  if (state.status) params.set("status", state.status);
  if (state.type) params.set("type", state.type);
  history.replaceState(null, "", params.toString() ? `?${params}` : location.pathname);
}

function readUrl(controls) {
  const params = new URLSearchParams(location.search);
  const q = params.get("q") || "";
  controls.q.value = q;
  state.q = norm(q);
  state.status = params.get("status") || "";
  state.type = params.get("type") || "";
  controls.status.value = state.status;
  controls.type.value = state.type;
}

async function main() {
  markNav();
  const host = document.getElementById("main");

  try {
    const [exams, meta] = await Promise.all([
      load("exams.json"),
      freshness(document.getElementById("freshness")),
    ]);

    windows = meta.windows || {};
    all = exams.map((e) => ({ ...e, _n: norm(e.title) }));

    const controls = {
      q: document.getElementById("q"),
      status: document.getElementById("status"),
      type: document.getElementById("type"),
    };

    [...new Set(exams.map((e) => e.type))].sort().forEach((value) => {
      controls.type.append(el("option", { value, text: typeLabel(value, "who") }));
    });

    const change = (fn) => () => { fn(); render(); pushUrl(); };
    controls.q.addEventListener("input", change(() => { state.q = norm(controls.q.value); }));
    controls.status.addEventListener("change", change(() => { state.status = controls.status.value; }));
    controls.type.addEventListener("change", change(() => { state.type = controls.type.value; }));

    // The "more are scheduled further out" link points at ?status=upcoming on
    // this same page. Handled here rather than followed, so it does not
    // refetch JSON the page is already holding.
    document.addEventListener("click", (e) => {
      const link = e.target.closest('a[href^="?"]');
      if (!link) return;
      e.preventDefault();
      history.replaceState(null, "", link.getAttribute("href"));
      readUrl(controls);
      render();
      document.getElementById("section-upcoming").scrollIntoView({ block: "start" });
    });

    readUrl(controls);
    render();
  } catch (err) {
    failure(host, err);
  }
}

main();
