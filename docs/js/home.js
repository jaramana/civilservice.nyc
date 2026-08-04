/* ==========================================================================
   The front page, which is also the exam search.

   These were two pages. The front page showed a curated 54 rows in three
   sections, the exams page showed all 345 with a search box, and they drew the
   same rows in the same style. One page with two states is less to maintain
   and puts the search where people arrive.

   Untouched, the page is a bulletin:

     accepting now   what you can act on today. First even when empty, because
                     "nothing is open" is an answer, and DCAS opens most
                     application periods on the first Wednesday of the month so
                     empty is a normal Tuesday rather than a broken page.
     opening soon    the substantial section, within UPCOMING_WINDOW_DAYS
     recently closed within RECENTLY_CLOSED_DAYS

   Type anything, or pick a filter, and the same page lists every exam we
   publish. Filters live in the query string, so a filtered view can be linked
   to and the browser back button behaves.
   ========================================================================== */

import {
  load, el, clear, tag, typeLabel, fmtDate, daysBetween, countdown,
  freshness, markNav, failure, count,
} from "./common.js";

/* Rows added to the document at once in search mode. 345 is fine on a laptop
   and a visible pause on an old phone, and nobody reads to row 300 without
   narrowing first. */
const PAGE = 100;

const state = { q: "", status: "", type: "", shown: PAGE, rows: [] };
let all = [];
let windows = {};

/* Searching is on as soon as any control has a value. That is the whole state
   machine: no mode switch to click, and clearing the box brings the bulletin
   back. */
function searching() {
  return Boolean(state.q || state.status || state.type);
}

function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/* --------------------------------------------------------------------------
   Rows
   -------------------------------------------------------------------------- */

/* Two shapes for the same exam. In the bulletin the section heading already
   says the status, so the row spends its right-hand column on the date and the
   countdown, which is what someone is actually deciding on. In search results
   the rows are mixed, so each carries its own status tag instead. */
function row(exam, mode) {
  const link = el("a", { class: "row", href: `exam.html?exam=${exam.exam_no}` });
  link.append(el("span", { class: "name", text: exam.title }));
  link.append(el("span", {
    class: "meta",
    text: `Exam ${exam.exam_no} · ${typeLabel(exam.type)}`,
  }));

  const when = el("span", { class: "when" });

  if (mode === "results") {
    when.append(tag(exam.status));
    when.append(el("br"));
    when.append(document.createTextNode(
      exam.status === "accepting" ? `closes ${fmtDate(exam.end)}`
      : exam.status === "upcoming" ? `opens ${fmtDate(exam.start)}`
      : `closed ${fmtDate(exam.end)}`
    ));
  } else if (mode === "accepting") {
    when.append(el("strong", { text: `Closes ${fmtDate(exam.end)}` }));
    when.append(el("br"));
    when.append(document.createTextNode(countdown(daysBetween(exam.end))));
  } else if (mode === "upcoming") {
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

function fill(listId, countId, exams, mode) {
  const list = document.getElementById(listId);
  clear(list);
  exams.forEach((e) => list.append(row(e, mode)));
  document.getElementById(countId).textContent = count(exams.length);
  return list;
}

/* --------------------------------------------------------------------------
   The bulletin
   -------------------------------------------------------------------------- */

/* The empty state carries the next real date. "Nothing is open" on its own
   invites someone to check back tomorrow and the day after: naming the date
   saves them the trips. */
function emptyAccepting(list, upcoming) {
  const next = upcoming[0];
  const node = el("p", { class: "empty" });
  node.append(el("strong", { text: "No exams are accepting applications today. " }));
  node.append(document.createTextNode(next
    ? `The City opens most application periods on the first Wednesday of the ` +
      `month. The next one is ${next.title}, opening ${fmtDate(next.start, { alwaysYear: true })}.`
    : "There is nothing scheduled to open in the published schedule either, " +
      "which usually means DCAS has not posted the coming year yet."));
  list.after(node);
}

function renderBulletin() {
  const upcomingDays = windows.upcoming_days ?? 60;
  const closedDays = windows.recently_closed_days ?? 45;

  const accepting = all
    .filter((e) => e.status === "accepting")
    .sort((a, b) => a.end.localeCompare(b.end));          // soonest deadline first

  const upcomingAll = all
    .filter((e) => e.status === "upcoming")
    .sort((a, b) => a.start.localeCompare(b.start));

  const upcoming = upcomingAll.filter((e) => daysBetween(e.start) <= upcomingDays);

  const closed = all
    .filter((e) => e.status === "closed" && -daysBetween(e.end) <= closedDays)
    .sort((a, b) => b.end.localeCompare(a.end));

  const acceptingList = fill("accepting", "accepting-count", accepting, "accepting");
  document.querySelectorAll("#bulletin .empty").forEach((n) => n.remove());
  if (!accepting.length) emptyAccepting(acceptingList, upcomingAll);

  fill("upcoming", "upcoming-count", upcoming, "upcoming");

  // The rest of the schedule is not on another page any more, it is one
  // filter away on this one.
  const note = document.getElementById("upcoming-note");
  const later = upcomingAll.length - upcoming.length;
  clear(note);
  note.append(document.createTextNode(`Exams opening in the next ${upcomingDays} days. `));
  if (later > 0) {
    note.append(el("a", {
      href: "?status=upcoming",
      text: `${count(later)} more are scheduled further out.`,
    }));
  }

  fill("closed", "closed-count", closed, "closed");
}

/* --------------------------------------------------------------------------
   Search results
   -------------------------------------------------------------------------- */

function matches(e) {
  if (state.status && e.status !== state.status) return false;
  if (state.type && e.type !== state.type) return false;
  if (!state.q) return true;
  return e._n.includes(state.q) || e.exam_no.startsWith(state.q);
}

/* Accepting first, then upcoming, then closed newest first. Within a group,
   by the date that is still ahead of you. */
function compare(a, b) {
  const rank = { accepting: 0, upcoming: 1, closed: 2 };
  const ra = rank[a.status] ?? 3, rb = rank[b.status] ?? 3;
  if (ra !== rb) return ra - rb;
  if (a.status === "closed") return b.end.localeCompare(a.end);
  const key = a.status === "accepting" ? "end" : "start";
  return a[key].localeCompare(b[key]);
}

function renderResults() {
  state.rows = all.filter(matches).sort(compare);
  const slice = state.rows.slice(0, state.shown);
  const total = state.rows.length;

  const list = document.getElementById("results");
  clear(list);
  slice.forEach((e) => list.append(row(e, "results")));

  document.getElementById("results-count").textContent = count(total);

  // "All exams" would be a lie the moment a filter is on, and this section
  // only ever appears with a filter on.
  document.getElementById("results-heading").textContent =
    state.q ? `Exams matching “${document.getElementById("q").value.trim()}”`
            : "Matching exams";

  const summary = document.getElementById("result-summary");
  if (!total) {
    summary.textContent = "No exams match. Try clearing a filter.";
  } else if (total > slice.length) {
    summary.textContent = `Showing ${count(slice.length)} of ${count(total)} exams`;
  } else {
    summary.textContent = `${count(total)} exam${total === 1 ? "" : "s"}`;
  }

  document.getElementById("more-row").hidden = total <= slice.length;
}

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */

function apply({ push = true } = {}) {
  const on = searching();
  document.getElementById("bulletin").hidden = on;
  document.getElementById("search").hidden = !on;

  if (on) renderResults();
  else renderBulletin();

  if (!push) return;
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
  state.shown = PAGE;
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

    if (windows.archive_floor) {
      document.getElementById("archive-note").textContent =
        `Everything on the City's published schedule since ` +
        `${fmtDate(windows.archive_floor, { alwaysYear: true })}. The City never ` +
        `published its fiscal 2025 schedule as open data, so there is a twelve ` +
        `month hole before that and we do not show a partial archive that would ` +
        `look complete.`;
    }

    controls.q.addEventListener("input", () => {
      state.q = norm(controls.q.value);
      state.shown = PAGE;
      apply();
    });
    controls.status.addEventListener("change", () => {
      state.status = controls.status.value;
      state.shown = PAGE;
      apply();
    });
    controls.type.addEventListener("change", () => {
      state.type = controls.type.value;
      state.shown = PAGE;
      apply();
    });
    document.getElementById("more").addEventListener("click", () => {
      state.shown += PAGE;
      renderResults();
    });

    // The "more are scheduled further out" link is a plain href to ?status=…
    // on this same page, so it has to be caught rather than followed. A real
    // navigation would work too, but it would reload 77 KB of JSON to show
    // rows the page is already holding.
    document.addEventListener("click", (e) => {
      const link = e.target.closest('a[href^="?"]');
      if (!link) return;
      e.preventDefault();
      history.replaceState(null, "", link.getAttribute("href"));
      readUrl(controls);
      apply({ push: false });
      document.getElementById("search").scrollIntoView({ block: "start" });
    });

    readUrl(controls);
    apply({ push: false });
  } catch (err) {
    failure(host, err);
  }
}

main();
