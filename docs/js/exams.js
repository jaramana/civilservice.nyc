/* ==========================================================================
   Every exam, searchable.

   The front page is a bulletin: what to do this month. This page is the
   reference table behind it, including the 111 exams scheduled beyond the
   front page's window and the ones that have already closed.

   Filters live in the query string so a filtered view can be linked to. The
   front page uses that to hand off: exams.html?status=upcoming.
   ========================================================================== */

import {
  load, el, clear, tag, typeLabel, fmtDate, count,
  freshness, markNav, failure, param,
} from "./common.js";

const PAGE = 100;

const state = { q: "", status: "", type: "", shown: PAGE, rows: [] };
let all = [];

function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function matches(e) {
  if (state.status && e.status !== state.status) return false;
  if (state.type && e.type !== state.type) return false;
  if (!state.q) return true;
  return e._n.includes(state.q) || e.exam_no.startsWith(state.q);
}

/* Sort depends on what is being shown. Open exams sort by the deadline you
   might miss, upcoming by when they arrive, closed by most recent. Mixing them
   all together sorts by whichever date is the live one for that exam. */
function sortKey(e) {
  if (e.status === "accepting") return [0, e.end];
  if (e.status === "upcoming") return [1, e.start];
  return [2, e.end.split("").reverse().join("")];   // closed: newest first
}

function compare(a, b) {
  const ka = sortKey(a), kb = sortKey(b);
  if (ka[0] !== kb[0]) return ka[0] - kb[0];
  return a.status === "closed" ? b.end.localeCompare(a.end) : ka[1].localeCompare(kb[1]);
}

function row(e) {
  const link = el("a", { class: "row", href: `exam.html?exam=${e.exam_no}` });
  link.append(el("span", { class: "name", text: e.title }));
  link.append(el("span", {
    class: "meta",
    text: `Exam ${e.exam_no} · ${typeLabel(e.type)}`,
  }));

  const when = el("span", { class: "when" }, [tag(e.status)]);
  when.append(el("br"));
  if (e.status === "accepting") {
    when.append(document.createTextNode(`closes ${fmtDate(e.end)}`));
  } else if (e.status === "upcoming") {
    when.append(document.createTextNode(`opens ${fmtDate(e.start)}`));
  } else {
    when.append(document.createTextNode(`closed ${fmtDate(e.end)}`));
  }
  link.append(when);

  return el("li", {}, link);
}

function render() {
  const list = document.getElementById("results");
  const slice = state.rows.slice(0, state.shown);

  clear(list);
  slice.forEach((e) => list.append(row(e)));

  const total = state.rows.length;
  const label = document.getElementById("result-count");
  if (!total) {
    label.textContent = "No exams match. Try clearing a filter.";
  } else if (total > slice.length) {
    label.textContent = `Showing ${count(slice.length)} of ${count(total)} exams`;
  } else {
    label.textContent = `${count(total)} exam${total === 1 ? "" : "s"}`;
  }
  document.getElementById("more-row").hidden = total <= slice.length;
}

function apply(push) {
  state.rows = all.filter(matches).sort(compare);
  state.shown = PAGE;
  render();

  if (push) {
    const q = new URLSearchParams();
    if (state.q) q.set("q", document.getElementById("q").value.trim());
    if (state.status) q.set("status", state.status);
    if (state.type) q.set("type", state.type);
    const url = q.toString() ? `?${q}` : location.pathname;
    history.replaceState(null, "", url);
  }
}

async function main() {
  markNav();
  const host = document.getElementById("main");

  try {
    const [exams, meta] = await Promise.all([
      load("exams.json"),
      freshness(document.getElementById("freshness")),
    ]);

    all = exams.map((e) => ({ ...e, _n: norm(e.title) }));

    const q = document.getElementById("q");
    const status = document.getElementById("status");
    const type = document.getElementById("type");

    // Build the type filter from the types actually present. The first option,
    // "Any exam type", is the no-filter case: an earlier build labeled it
    // "Anyone or City staff", which read as a third category rather than as
    // "do not filter".
    [...new Set(exams.map((e) => e.type))].sort().forEach((value) => {
      type.append(el("option", { value, text: typeLabel(value, "who") }));
    });

    // Restore state from the address bar so a shared link opens the same view.
    if (param("q")) { q.value = param("q"); state.q = norm(param("q")); }
    if (param("status")) { status.value = param("status"); state.status = status.value; }
    if (param("type")) { type.value = param("type"); state.type = type.value; }

    q.addEventListener("input", () => { state.q = norm(q.value); apply(true); });
    status.addEventListener("change", () => { state.status = status.value; apply(true); });
    type.addEventListener("change", () => { state.type = type.value; apply(true); });
    document.getElementById("more").addEventListener("click", () => {
      state.shown += PAGE;
      render();
    });

    const floor = (meta.windows && meta.windows.archive_floor) || null;
    if (floor) {
      document.getElementById("intro").textContent =
        `Every exam on the City's published schedule since ${fmtDate(floor, { alwaysYear: true })}, ` +
        `including the ones that have already closed.`;
    }

    apply(false);
  } catch (err) {
    failure(host, err);
  }
}

main();
