/* ==========================================================================
   The front page, which is also the exam search.

   One rule, statable in a sentence:

     Show picks the groups. Search filters within them. Nothing else changes.

   No date windows. Every exam we publish sits in one of the three groups all
   the time, and the only thing deciding what is on screen is a control you
   can see. The previous version showed 60 days of upcoming exams until you
   typed something and then silently showed all 138, which made the table look
   like it had changed its own mind.

   One row function, no modes: an exam's right-hand column comes from its own
   status, so filtering can never restyle a row already on screen.

   All 345 rows render in about 11ms including layout, so there is no paging.
   ========================================================================== */

import {
  load, el, clear, typeLabel, fmtDate, daysBetween, countdown,
  freshness, markNav, failure, count,
} from "./common.js";

const GROUPS = [
  { key: "accepting", nothing: "No exams accepting applications" },
  { key: "upcoming", nothing: "No upcoming exams" },
  { key: "closed", nothing: "No closed exams" },
];

/* Which groups each Show option puts on the page. "" is the default: what you
   can act on and what is coming. Closed exams are reference rather than news,
   so they are one choice away instead of on the page by default. */
const SHOWS = {
  "": ["accepting", "upcoming"],
  accepting: ["accepting"],
  upcoming: ["upcoming"],
  closed: ["closed"],
  all: ["accepting", "upcoming", "closed"],
};

const state = { q: "", show: "", type: "" };
let all = [];
let archiveFloor = null;

function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/* --------------------------------------------------------------------------
   The row
   -------------------------------------------------------------------------- */

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
   Render
   -------------------------------------------------------------------------- */

function matches(e) {
  if (state.type && e.type !== state.type) return false;
  if (!state.q) return true;
  return e._n.includes(state.q) || e.exam_no.startsWith(state.q);
}

function rowsFor(key) {
  const rows = all.filter((e) => e.status === key && matches(e));
  if (key === "closed") return rows.sort((a, b) => b.end.localeCompare(a.end));
  if (key === "accepting") return rows.sort((a, b) => a.end.localeCompare(b.end));
  return rows.sort((a, b) => a.start.localeCompare(b.start));
}

/* One line, and only where it tells someone something they can act on: the
   next opening date saves checking back daily. */
function emptyText(key) {
  const group = GROUPS.find((g) => g.key === key);
  if (state.q || state.type) return `${group.nothing} match your search.`;

  if (key === "accepting") {
    const next = all
      .filter((e) => e.status === "upcoming")
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    return next
      ? `Nothing is accepting applications today. Next to open: ${next.title}, ` +
        `${fmtDate(next.start, { alwaysYear: true })}.`
      : "Nothing is accepting applications, and nothing is scheduled.";
  }
  return `${group.nothing} right now.`;
}

function renderGroup(key, visible) {
  document.getElementById(`section-${key}`).hidden = !visible;
  if (!visible) return;

  const rows = rowsFor(key);

  const list = document.getElementById(`list-${key}`);
  clear(list);
  rows.forEach((e) => list.append(row(e)));

  document.getElementById(`count-${key}`).textContent = count(rows.length);

  const empty = document.getElementById(`empty-${key}`);
  empty.textContent = rows.length ? "" : emptyText(key);
  empty.hidden = rows.length > 0;
}

function render() {
  const visible = SHOWS[state.show] || SHOWS[""];
  GROUPS.forEach((g) => renderGroup(g.key, visible.includes(g.key)));

  const note = document.getElementById("note-closed");
  note.textContent = archiveFloor
    ? `Back to ${fmtDate(archiveFloor, { alwaysYear: true })}. The City never ` +
      `published its fiscal 2025 schedule, so the record stops there.`
    : "";

  // Matches sitting in a group the current Show is hiding. Silence there reads
  // as "no such exam", which is a different and wrong answer.
  //
  // Only while searching. With nothing typed there is no "also": the Show
  // control already says the page is not listing closed exams, and a standing
  // line announcing 198 of them is noise on every visit.
  const hint = document.getElementById("hint");
  clear(hint);
  const searching = Boolean(state.q || state.type);
  const hiddenMatches = !searching ? [] : GROUPS
    .filter((g) => !visible.includes(g.key))
    .map((g) => ({ key: g.key, n: rowsFor(g.key).length }))
    .filter((g) => g.n > 0);

  hint.hidden = !hiddenMatches.length;
  if (hiddenMatches.length) {
    const total = hiddenMatches.reduce((n, g) => n + g.n, 0);
    const where = hiddenMatches.map((g) => g.key === "closed" ? "closed" : g.key).join(" and ");
    hint.append(document.createTextNode(
      `${count(total)} ${where} exam${total === 1 ? " also matches" : "s also match"}. `));
    hint.append(el("button", {
      class: "linky", type: "button", id: "show-everything",
      text: "Show all exams",
    }));
  }
}

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */

function pushUrl() {
  const params = new URLSearchParams();
  if (state.q) params.set("q", document.getElementById("q").value.trim());
  if (state.show) params.set("show", state.show);
  if (state.type) params.set("type", state.type);
  history.replaceState(null, "", params.toString() ? `?${params}` : location.pathname);
}

async function main() {
  markNav();
  const host = document.getElementById("main");

  try {
    const [exams, meta] = await Promise.all([
      load("exams.json"),
      freshness(),
    ]);

    archiveFloor = (meta.windows || {}).archive_floor || null;
    all = exams.map((e) => ({ ...e, _n: norm(e.title) }));

    const q = document.getElementById("q");
    const show = document.getElementById("status");
    const type = document.getElementById("type");

    [...new Set(exams.map((e) => e.type))].sort().forEach((value) => {
      type.append(el("option", { value, text: typeLabel(value) }));
    });

    const params = new URLSearchParams(location.search);
    q.value = params.get("q") || "";
    state.q = norm(q.value);
    // `status` is still read so links shared before the control was renamed
    // keep working.
    state.show = params.get("show") ?? params.get("status") ?? "";
    if (!(state.show in SHOWS)) state.show = "";
    state.type = params.get("type") || "";
    show.value = state.show;
    type.value = state.type;

    const on = (node, event, fn) => node.addEventListener(event, () => {
      fn();
      render();
      pushUrl();
    });
    on(q, "input", () => { state.q = norm(q.value); });

    document.getElementById("hint").addEventListener("click", (e) => {
      if (e.target.id !== "show-everything") return;
      state.show = "all";
      show.value = "all";
      render();
      pushUrl();
    });
    on(show, "change", () => { state.show = show.value; });
    on(type, "change", () => { state.type = type.value; });

    render();
  } catch (err) {
    failure(host, err);
  }
}

main();
