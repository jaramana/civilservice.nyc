/* ==========================================================================
   Shared helpers.

   Everything on this site is a static file plus fetch. There is no framework
   and no build step, so this file is the closest thing to shared plumbing:
   loading JSON, formatting a date the way a person reads one, and drawing the
   freshness line that every page carries.

   One rule worth stating because it is easy to break later: values that came
   out of the pipeline are written with textContent, never innerHTML. The data
   is public and dull, but a title with an ampersand in it should render as an
   ampersand rather than start an entity, and the habit is what keeps that
   true when a field changes.
   ========================================================================== */

const DATA = "data/";

/* Every page needs meta.json and most need one more file, so a tiny cache
   keeps a page from fetching the same thing twice. */
const _cache = new Map();

export async function load(name) {
  if (!_cache.has(name)) {
    _cache.set(name, fetch(DATA + name).then((r) => {
      if (!r.ok) throw new Error(`${name}: ${r.status}`);
      return r.json();
    }));
  }
  return _cache.get(name);
}

/* --- dates ---------------------------------------------------------------
   The JSON carries plain ISO dates with no time. new Date("2026-08-07") parses
   as UTC midnight, which in New York is the evening of the 6th, so every date
   would render a day early. Splitting the string avoids the whole problem. */

export function parseDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* One format for a date, everywhere, year always included.
   It used to drop the year when it matched the current one, which meant a
   single column showed "Aug 7" on one row and "Jun 2, 2027" on the next. A
   field gets one format, and exam schedules routinely span two fiscal years,
   so the year is the part that cannot be dropped.

   The opts argument is kept, and ignored, so the call sites that pass
   { alwaysYear: true } still read correctly rather than looking like they
   are asking for something special. */
export function fmtDate(iso) {
  if (!iso) return "";
  const d = parseDate(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/* Both ends written in full. Collapsing a same-year range to "Jun 15 to Aug 7,
   2026" would reintroduce the thing above: two renderings of one field
   depending on the data. */
export function fmtRange(startIso, endIso) {
  if (!startIso) return fmtDate(endIso);
  if (!endIso) return fmtDate(startIso);
  return `${fmtDate(startIso)} to ${fmtDate(endIso)}`;
}

/* "today" is a function rather than a constant so that a tab left open
   overnight does not keep counting from yesterday. */
export function today() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function daysBetween(iso) {
  return Math.round((parseDate(iso) - today()) / 86400000);
}

/* Plain-language countdown. "3 days left" is the number people act on, and
   "today" and "tomorrow" are worth spelling out because a bare "0 days" reads
   as already closed. */
export function countdown(days, { verb = "left" } = {}) {
  if (days < 0) return "closed";
  if (days === 0) return "last day";
  if (days === 1) return `1 day ${verb}`;
  return `${days} days ${verb}`;
}

/* --- numbers ------------------------------------------------------------- */

export function money(n) {
  if (n === undefined || n === null) return "";
  return "$" + Math.round(n).toLocaleString("en-US");
}

export function count(n) {
  return (n || 0).toLocaleString("en-US");
}

/* --- small DOM helpers ---------------------------------------------------
   el() takes text, not HTML. See the note at the top of the file. */

export function el(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "text") node.textContent = v;
    else if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const kid of [].concat(kids)) {
    if (kid) node.append(kid);
  }
  return node;
}

export function param(name) {
  return new URLSearchParams(location.search).get(name);
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/* --- status -------------------------------------------------------------- */

/* Color never carries the meaning on its own. Each status renders as a word
   in a tag, and the tag's color is reinforcement. */
/* Wording follows DCAS where DCAS has a word. It does not have a status
   vocabulary: its pages simply list what is open under an "Application Period"
   column. So "Accepting applications" is ours, and it is used in every place
   the state appears, section heading, tag and filter alike. An earlier build
   said "Open now" in the tag and "Accepting applications" in the filter for
   the same thing, which reads as two different states. */
export const STATUS = {
  accepting: { label: "Accepting applications", cls: "tag-open" },
  upcoming:  { label: "Upcoming",               cls: "tag-soon" },
  closed:    { label: "Closed",                 cls: "tag-closed" },
};

/* Exam types, in DCAS's own words. One label per value, used in rows, in the
   filter and on an exam page alike. There used to be a second, longer form
   ("Open competitive: anyone who qualifies") shown in some of those places and
   not others, which made one field look like two. What it means for who can
   apply is said once, as the qualifier under Who can apply on an exam page. */
export const EXAM_TYPE = {
  open_competitive: "Open competitive",
  promotion: "Promotion",
  qie: "Provisional",
};

export function typeLabel(type) {
  return EXAM_TYPE[type] || type;
}

export function tag(status) {
  const s = STATUS[status] || STATUS.closed;
  return el("span", { class: `tag ${s.cls}`, text: s.label });
}

/* --- freshness -----------------------------------------------------------
   Silent staleness is the failure mode that matters here: a page that quietly
   keeps showing April's exams looks exactly like a page that is up to date.
   The date comes from the dataset's own data_current_as_of, not the build
   time, so it stays honest even if the refresh workflow keeps running while
   DCAS stops publishing.

   The date is provenance: it applies to the whole site, it is the same on
   every page, and it sits with the other provenance in the footer.

   There is no conditional warning banner any more. It watched datasets that
   carry no application dates, so its age was not evidence about the thing it
   warned about, and a box that appears on a normal day teaches people to
   ignore it. See the note in config.py. What protects application-date
   accuracy now is the daily DCAS reconciliation, which fails the build rather
   than publishing quietly, plus this always-visible date. */

export async function freshness() {
  const meta = await load("meta.json");
  const asof = meta.schedule_current_as_of || meta.as_of;

  const line = document.getElementById("asof");
  if (line) {
    line.textContent =
      `Exam schedule current as of ${fmtDate(asof, { alwaysYear: true })}, ` +
      `checked ${fmtDate(meta.generated_at, { alwaysYear: true })}.`;
  }

  return meta;
}

/* Mark the current page in the navigation. Every page ships the same nav
   markup by hand, so this is the one thing that has to be computed. */
export function markNav() {
  const here = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav a").forEach((a) => {
    if (a.getAttribute("href") === here) a.setAttribute("aria-current", "page");
  });
}

/* A page that fails to load its data should say so rather than sit empty. */
export function failure(node, err) {
  clear(node);
  node.append(el("div", { class: "banner", role: "alert" }, [
    el("strong", { text: "Could not load the data. " }),
    document.createTextNode("Reload the page. If it keeps happening the site is broken, not you."),
  ]));
  console.error(err);
}
