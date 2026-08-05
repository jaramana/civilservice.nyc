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

/* Both filters are sets, because both are questions of the form "which of
   these values do I want", and a set of checkboxes says that exactly. The
   dropdown this replaces could only offer named combinations, which meant
   five of the seven possible ones and two invented names.

   Defaults: what you can act on and what is coming. Closed exams are
   reference rather than news, so that box starts unchecked. */
const DEFAULT_SHOW = ["accepting", "upcoming"];

const state = { q: "", show: new Set(DEFAULT_SHOW), type: new Set() };
let all = [];
let allTypes = [];
let archiveFloor = null;

/* What a closed menu says it is holding. A count rather than a list once more
   than one value is ticked, because "Accepting applications, Upcoming" does
   not fit on one line and truncating it would hide which values are on. */
function summarize(chosen, values, labelFor) {
  if (chosen.size === 0) return "None";
  if (chosen.size === values.length) return "All";
  if (chosen.size === 1) return labelFor([...chosen][0]);
  return `${chosen.size} of ${values.length}`;
}

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

/* Both sets read the same way: a value is kept only if it is ticked. Type used
   to treat an empty set as "no filter", which made the two menus behave
   differently from each other at the one moment a person is most likely to
   notice, when they have just unticked the last box. */
function matches(e) {
  if (!state.type.has(e.type)) return false;
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
  if (state.q || state.type.size < allTypes.length) return `${group.nothing} match your search.`;

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
  GROUPS.forEach((g) => renderGroup(g.key, state.show.has(g.key)));

  // Every box in either menu unticked is a legitimate thing to do and leaves
  // the page blank, which looks broken unless it says otherwise. Name the menu
  // that is empty, since the fix is in a panel that is probably closed.
  const nothingChosen = document.getElementById("nothing-chosen");
  const emptyMenus = [];
  if (!state.show.size) emptyMenus.push("Show");
  if (!state.type.size) emptyMenus.push("Who can apply");
  nothingChosen.hidden = emptyMenus.length === 0;
  nothingChosen.textContent = emptyMenus.length
    ? `Nothing is ticked under ${emptyMenus.join(" or ")}. Open ` +
      `${emptyMenus.length > 1 ? "those menus" : "that menu"} and choose at least one.`
    : "";

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
  const searching = Boolean(state.q || state.type.size < allTypes.length);
  const hiddenMatches = !searching ? [] : GROUPS
    .filter((g) => !state.show.has(g.key))
    .map((g) => ({ key: g.key, n: rowsFor(g.key).length }))
    .filter((g) => g.n > 0);

  hint.hidden = !hiddenMatches.length;
  if (hiddenMatches.length) {
    const total = hiddenMatches.reduce((n, g) => n + g.n, 0);
    const where = hiddenMatches.map((g) => g.key === "closed" ? "closed" : g.key).join(" and ");
    hint.append(document.createTextNode(
      `${count(total)} ${where} exam${total === 1 ? " also matches" : "s also match"}. `));
    // Ticks exactly the boxes that are hiding something, rather than turning
    // everything on.
    hint.append(el("button", {
      class: "linky", type: "button", id: "show-everything",
      text: hiddenMatches.length === 1
        ? `Show ${hiddenMatches[0].key === "closed" ? "closed" : hiddenMatches[0].key} exams too`
        : "Show those too",
    }));
  }
}

/* --------------------------------------------------------------------------
   Wiring
   -------------------------------------------------------------------------- */

/* Sets travel as comma-separated lists. The show parameter is written only
   when it differs from the default, so an untouched page keeps a clean URL. */
function pushUrl() {
  const params = new URLSearchParams();
  if (state.q) params.set("q", document.getElementById("q").value.trim());

  // Written only when it differs from the default, so an untouched page keeps
  // a clean address. For type the default is every value, which is why a full
  // set is silence here rather than a list of everything.
  const asList = (set) => [...set].sort().join(",");
  if (asList(state.show) !== [...DEFAULT_SHOW].sort().join(",")) {
    params.set("show", asList(state.show));
  }
  if (asList(state.type) !== [...allTypes].sort().join(",")) {
    params.set("type", asList(state.type));
  }

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

    allTypes = [...new Set(exams.map((e) => e.type))].sort();

    // One box per exam type actually present. All ticked to start: the filter
    // is "which types do I want", and to start with, all of them.
    const typeChecks = document.getElementById("type-checks");
    allTypes.forEach((value) => {
      const box = el("input", { type: "checkbox", value, checked: "checked" });
      const label = el("label", { class: "check" }, [box]);
      label.append(document.createTextNode(" " + typeLabel(value)));
      typeChecks.append(label);
    });
    state.type = new Set(allTypes);

    const showBoxes = GROUPS.map((g) => document.getElementById(`show-${g.key}`));
    const typeBoxes = [...typeChecks.querySelectorAll("input")];

    /* Read the address bar into the two sets.

       Both travel as comma-separated lists. The single values the old dropdown
       wrote, and the older `status` parameter, are still understood, so a link
       saved or shared before either change opens the view it always did.
       "all" was that dropdown's name for every group. */
    const params = new URLSearchParams(location.search);
    q.value = params.get("q") || "";
    state.q = norm(q.value);

    const readSet = (raw, valid) => new Set(
      (raw === "all" ? valid : raw.split(",").map((s) => s.trim()))
        .filter((v) => valid.includes(v)));

    const rawShow = params.get("show") ?? params.get("status");
    if (rawShow !== null) state.show = readSet(rawShow, GROUPS.map((g) => g.key));
    const rawType = params.get("type");
    if (rawType !== null) state.type = readSet(rawType, allTypes);

    showBoxes.forEach((box, i) => { box.checked = state.show.has(GROUPS[i].key); });
    typeBoxes.forEach((box) => { box.checked = state.type.has(box.value); });

    const groupLabel = (key) => document.querySelector(`#show-${key}`).parentElement.textContent.trim();

    const sync = () => {
      state.show = new Set(GROUPS.filter((g, i) => showBoxes[i].checked).map((g) => g.key));
      state.type = new Set(typeBoxes.filter((b) => b.checked).map((b) => b.value));
      document.getElementById("show-summary").textContent =
        summarize(state.show, GROUPS.map((g) => g.key), groupLabel);
      document.getElementById("type-summary").textContent =
        summarize(state.type, allTypes, typeLabel);
      render();
      pushUrl();
    };

    q.addEventListener("input", () => {
      state.q = norm(q.value);
      render();
      pushUrl();
    });
    [...showBoxes, ...typeBoxes].forEach((box) => box.addEventListener("change", sync));

    document.getElementById("hint").addEventListener("click", (e) => {
      if (e.target.id !== "show-everything") return;
      GROUPS.forEach((g, i) => {
        if (!state.show.has(g.key) && rowsFor(g.key).length) showBoxes[i].checked = true;
      });
      sync();
    });

    /* An open menu closes when you click away from it or press Escape, which
       details/summary does not do on its own. */
    const menus = [...document.querySelectorAll(".menu")];
    document.addEventListener("click", (e) => {
      menus.forEach((m) => { if (m.open && !m.contains(e.target)) m.open = false; });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      menus.forEach((m) => {
        if (!m.open) return;
        m.open = false;
        m.querySelector("summary").focus();
      });
    });

    sync();
  } catch (err) {
    failure(host, err);
  }
}

main();
