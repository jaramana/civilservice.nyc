/* ==========================================================================
   One job title.

   The honest shape of this page is that most titles have very little to say:
   a name, a salary band, a union, and no exam. That is not a degraded version
   of the page, it is the normal one, so nothing here renders an empty field or
   apologizes for what the catalog does not carry.

   Two numbers on this page could be mistaken for each other and are kept
   apart on purpose:

     salary range   what the title is authorized to pay, from the catalog
     median         what people in the job are actually paid, from
                    thepaygap.nyc, which is a median and is labeled as one

   Calling either of them "the salary" would be wrong, so neither is.

   A third number is deliberately not shown. The certification data carries
   the salary the City reported when it hired off a list, averaged over the
   last few years of certifications. It is still exported as salary_hiring for
   anyone reading the JSON, but it does not belong on this page: it is a mean
   of past hires, some of them years old and none of them adjusted, so putting
   it next to a current salary range invites someone to read a stale figure as
   what the job pays today. Two salary numbers with different meanings is
   already the most this page can carry honestly.
   ========================================================================== */

import {
  load, el, clear, tag, typeLabel, fmtRange, money, count,
  freshness, markNav, failure, param,
} from "./common.js";

function fact(dl, term, value, qualifier) {
  if (value === undefined || value === null || value === "") return;
  dl.append(el("dt", { text: term }));
  const dd = el("dd");
  dd.append(typeof value === "string" || typeof value === "number"
    ? document.createTextNode(String(value))
    : value);
  if (qualifier) dd.append(el("span", { class: "qualifier", text: qualifier }));
  dl.append(dd);
}

function renderFacts(t) {
  const dl = document.getElementById("facts");
  clear(dl);

  if (t.salary_min && t.salary_max) {
    fact(dl, "Salary range", `${money(t.salary_min)} to ${money(t.salary_max)}`,
      t.salary_bands > 1
        ? `Spans ${t.salary_bands} assignment levels, so the bottom and the top are different jobs.`
        : "What the title is authorized to pay, not what a posting will offer.");
  }

  if (t.paygap) {
    const link = el("a", { href: t.paygap.url, text: money(t.paygap.median_salary) });
    fact(dl, "Median actually paid", link,
      `${count(t.paygap.employees)} people held this title in fiscal ` +
      `${t.paygap.fiscal_year}. Half earned more, half less. From thepaygap.nyc.`);
  }

  if (t.hours) fact(dl, "Standard hours", `${t.hours} a week`);
  if (t.union) fact(dl, "Union", t.union);
  if (t.bargaining_unit) fact(dl, "Bargaining unit", t.bargaining_unit);


  if (t.investigation) {
    fact(dl, "Background check", "Required before appointment");
  }

  if (t.name_truncated) {
    fact(dl, "Name", "Cut short in the City's catalog, which stops at 30 characters");
  }
}

function renderExams(t, exams) {
  const mine = (t.exam_nos || [])
    .map((no) => exams.find((e) => e.exam_no === no))
    .filter(Boolean);
  if (!mine.length) return;

  const section = document.getElementById("exams-section");
  const list = document.getElementById("exams");
  clear(list);

  mine.forEach((e) => {
    const link = el("a", { class: "row", href: `exam.html?exam=${e.exam_no}` });
    link.append(el("span", { class: "name", text: `Exam ${e.exam_no}` }));
    link.append(el("span", { class: "meta", text: typeLabel(e.type, "who") }));
    const when = el("span", { class: "when" }, [tag(e.status)]);
    when.append(el("br"));
    when.append(document.createTextNode(fmtRange(e.start, e.end)));
    link.append(when);
    list.append(el("li", {}, link));
  });

  document.getElementById("exams-count").textContent = count(mine.length);
  section.hidden = false;
}

/* Where this title stands, in one sentence, above the fields. Every persona
   who tried the site arrived with this question and had to infer the answer
   from which sections happened to be present. */
function situation(t, exams) {
  const line = document.getElementById("situation");
  clear(line);

  const open = (t.exam_nos || [])
    .map((no) => exams.find((e) => e.exam_no === no))
    .filter(Boolean)
    .filter((e) => e.status !== "closed")
    .sort((a, b) => a.start.localeCompare(b.start))[0];

  const people = t.candidates ? `${count(t.candidates)} people are on it` : null;

  let text;
  if (open && open.status === "accepting") {
    text = `An exam for this title is accepting applications until ${fmtDate(open.end, { alwaysYear: true })}.`;
  } else if (open) {
    text = `The next exam for this title opens ${fmtDate(open.start, { alwaysYear: true })}.`;
  } else if (t.lists) {
    text = t.lists === 1
      ? `No exam is scheduled. There is one active list${people ? `, and ${people}` : ""}.`
      : `No exam is scheduled. There are ${count(t.lists)} active lists` +
        `${t.candidates ? `, with ${count(t.candidates)} people on them` : ""}.`;
  } else {
    text = "No exam is scheduled and there is no active list. The title exists and can be filled other ways.";
  }

  line.append(document.createTextNode(text));
  line.hidden = false;
}

/* The list section adds only what the situation line does not already say. */
function renderList(t) {
  if (!t.lists) return;
  const section = document.getElementById("list-section");
  const body = document.getElementById("list-body");
  clear(body);

  const one = t.lists === 1;
  body.append(el("p", { class: "note", text: t.called === "yes"
    ? `The City has certified from ${one ? "this list" : "at least one of these lists"}, ` +
      `so ${one ? "it is" : "they are"} being used for hiring.`
    : `No certification on record yet, which usually means ${one ? "the list is" : "the lists are"} new.` }));

  section.hidden = false;
}

async function main() {
  markNav();
  const host = document.getElementById("main");
  const slug = param("title");

  try {
    const [titles, exams] = await Promise.all([
      load("titles.json"),
      load("exams.json"),
      freshness(document.getElementById("freshness")),
    ]);

    const t = titles.find((x) => x.slug === slug);
    if (!t) {
      document.getElementById("title-name").textContent = "Title not found";
      document.getElementById("title-code").textContent = "";
      const dl = document.getElementById("facts");
      clear(dl);
      dl.after(el("p", { class: "empty" }, [
        document.createTextNode("No title in the City's catalog matches that address. "),
        el("a", { href: "titles.html", text: "Search all job titles" }),
        document.createTextNode("."),
      ]));
      return;
    }

    document.title = `${t.title} | NYC civil service`;
    document.getElementById("title-name").textContent =
      t.name_truncated ? t.title + "…" : t.title;
    document.getElementById("title-code").textContent = `Title code ${t.code}`;

    situation(t, exams);
    renderFacts(t);
    renderExams(t, exams);
    renderList(t);
  } catch (err) {
    failure(host, err);
  }
}

main();
