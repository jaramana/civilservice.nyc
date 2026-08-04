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

export function fmtDate(iso, opts = {}) {
  if (!iso) return "";
  const d = parseDate(iso);
  const year = opts.alwaysYear || d.getFullYear() !== today().getFullYear();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${year ? ", " + d.getFullYear() : ""}`;
}

export function fmtRange(startIso, endIso) {
  if (!startIso) return fmtDate(endIso);
  if (!endIso) return fmtDate(startIso);
  const a = parseDate(startIso), b = parseDate(endIso);
  const sameYear = a.getFullYear() === b.getFullYear();
  const start = sameYear ? fmtDate(startIso) : fmtDate(startIso, { alwaysYear: true });
  return `${start} to ${fmtDate(endIso, { alwaysYear: !sameYear })}`;
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

/* Exam types, in DCAS's own words. "Open Competitive" is the City's term and
   its page for those exams is headed "Open Competitive Exams for Anyone", so
   both halves are worth saying: the label people will see on the Notice, and
   what it actually means for who can apply. */
export const EXAM_TYPE = {
  open_competitive: { short: "Open competitive", who: "Open competitive: anyone who qualifies" },
  promotion:        { short: "Promotion",       who: "Promotion: current City employees" },
  qie:              { short: "Provisional",     who: "Qualified incumbent: provisional employees" },
};

export function typeLabel(type, form = "short") {
  const t = EXAM_TYPE[type];
  return t ? t[form] : type;
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
   DCAS stops publishing. */

export async function freshness(node) {
  const meta = await load("meta.json");
  const asof = meta.schedule_current_as_of || meta.as_of;

  node.append(el("p", {
    class: "asof",
    text: `Exam schedule current as of ${fmtDate(asof, { alwaysYear: true })}` +
          `, checked ${fmtDate(meta.generated_at, { alwaysYear: true })}.`,
  }));

  if (meta.staleness_warning || meta.staleness_notice) {
    const banner = el("div", { class: "banner", role: "status" });
    banner.append(el("strong", {
      text: meta.staleness_warning ? "This page may be out of date. " : "Heads up. ",
    }));
    banner.append(document.createTextNode(
      `The source data has not been updated in ${meta.source_age_days} days. ` +
      `Application dates below may have changed. Check nyc.gov before you rely on one.`
    ));
    node.prepend(banner);
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
