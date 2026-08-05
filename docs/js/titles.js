/* ==========================================================================
   The title directory.

   2,632 titles, and 2,227 of them have no exam and no active list. Those are
   the reason this page exists. A directory that only listed titles the City
   happens to be hiring for would hide most of the civil service, and someone
   who does not already know that "Emergency Preparedness Manager" is a job
   would never find out.

   So everything is listed and browsable, and the filters are opt-in rather
   than the default view.

   This page loads titles-index.json, not titles.json. The index is a third of
   the size and carries exactly what a row needs. The full record is fetched by
   title.html when someone opens one.
   ========================================================================== */

import {
  load, el, clear, count, money, freshness, markNav, failure, param,
} from "./common.js";

/* How many rows to put in the document at once. The whole list renders fine on
   a laptop, but 2,632 rows is a visible pause on an older phone, and nobody
   scrolls to row 400 without searching first. */
const PAGE = 200;

const state = { q: "", active: false, open: false, shown: PAGE, rows: [] };
let all = [];

/* Search matches the title and the five-digit code. Normalizing to lower case
   and stripping punctuation means "asst." finds "Assistant" and a stray comma
   in the query does not empty the page. */
function norm(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function matches(t) {
  if (state.open && !t.o) return false;
  if (state.active && !(t.e || t.l)) return false;
  if (!state.q) return true;
  return t._n.includes(state.q) || t.c.startsWith(state.q);
}

function row(t) {
  const link = el("a", { class: "row", href: `title.html?title=${encodeURIComponent(t.s)}` });
  // An ellipsis where the City's catalog cut the name off at 30 characters.
  // "Accountant (Board of Elections" with nothing after it looks like our bug.
  link.append(el("span", { class: "name", text: t.x ? t.t + "…" : t.t }));

  // Bargaining unit first, because it is what distinguishes two rows with the
  // same name. The code alone cannot answer "which one am I".
  // The status field uses its own labels here, exactly as the exam tables and
  // the chips do. This row used to say "exam open now" and "exam coming",
  // which were a third set of words for a field that already has three.
  const bits = [t.u || `Title code ${t.c}`];
  if (t.o) bits.push("Accepting applications");
  else if (t.n) bits.push("Upcoming");
  else if (t.l) bits.push("Active list");
  link.append(el("span", { class: "meta", text: bits.join(" · ") }));

  const when = el("span", { class: "when" });
  if (t.lo && t.hi) {
    when.append(el("strong", { text: money(t.lo) }));
    when.append(el("br"));
    when.append(document.createTextNode(`to ${money(t.hi)}`));
  } else {
    // A title with no published range is normal, not an error. Say nothing
    // rather than showing a dash that looks like a broken field.
    when.append(document.createTextNode(""));
  }
  link.append(when);

  return el("li", {}, link);
}

function render() {
  const list = document.getElementById("results");
  const slice = state.rows.slice(0, state.shown);

  clear(list);
  slice.forEach((t) => list.append(row(t)));

  const total = state.rows.length;
  const label = document.getElementById("result-count");
  label.textContent = total
    ? `${count(total)} job title${total === 1 ? "" : "s"}`
    : "No job titles match your search.";

  // How many are on screen belongs on the button that changes it, not in a
  // second line reporting the same number in a different format.
  const remaining = total - slice.length;
  document.getElementById("more-row").hidden = remaining <= 0;
  if (remaining > 0) {
    document.getElementById("more").textContent =
      `Show ${count(Math.min(PAGE, remaining))} more`;
  }
}

function apply() {
  state.rows = all.filter(matches);
  state.shown = PAGE;
  render();
}

async function main() {
  markNav();
  const host = document.getElementById("main");

  try {
    const [index] = await Promise.all([
      load("titles-index.json"),
      freshness(),
    ]);

    // Precompute the searchable string once. Doing it inside the filter meant
    // normalizing 2,632 titles on every keystroke.
    all = index.map((t) => ({ ...t, _n: norm(t.t) }));

    const q = document.getElementById("q");
    // Deep link, so a search can be shared or bookmarked: titles.html?q=nurse
    const initial = param("q");
    if (initial) {
      q.value = initial;
      state.q = norm(initial);
    }

    q.addEventListener("input", () => {
      state.q = norm(q.value);
      apply();
    });
    document.getElementById("f-active").addEventListener("change", (e) => {
      state.active = e.target.checked;
      apply();
    });
    document.getElementById("f-open").addEventListener("change", (e) => {
      state.open = e.target.checked;
      apply();
    });
    document.getElementById("more").addEventListener("click", () => {
      state.shown += PAGE;
      render();
    });

    apply();
  } catch (err) {
    failure(host, err);
  }
}

main();
