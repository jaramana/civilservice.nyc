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
        ? `This title has ${t.salary_bands} assignment levels. The range spans all of them, ` +
          `so the bottom and the top are usually different jobs in practice.`
        : "What the title is authorized to pay. Where someone lands in it depends on the job and their experience.");
  }

  if (t.paygap) {
    const link = el("a", { href: t.paygap.url, text: money(t.paygap.median_salary) });
    fact(dl, "Median actually paid", link,
      `Half of the ${count(t.paygap.employees)} people in this title earned more than this ` +
      `in fiscal year ${t.paygap.fiscal_year}, half earned less. From thepaygap.nyc, which reads the City payroll.`);
  }

  if (t.hours) fact(dl, "Standard hours", `${t.hours} a week`);
  if (t.union) fact(dl, "Union", t.union);
  if (t.bargaining_unit) fact(dl, "Bargaining unit", t.bargaining_unit);


  if (t.investigation) {
    fact(dl, "Background check", "Yes",
      "This title requires a background investigation before appointment.");
  }

  if (t.name_truncated) {
    fact(dl, "About the name", "The City's catalog cuts title names at 30 characters.",
      "Where an exam or a list spells this title out in full, that fuller spelling is what you see above.");
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

/* Whether a list has been called is the question people ask after they pass,
   and it is the one this data answers least well. Say what it means. */
function renderList(t) {
  if (!t.lists) return;
  const section = document.getElementById("list-section");
  const body = document.getElementById("list-body");
  clear(body);

  const p = el("p", { class: "note" });
  const lists = `${count(t.lists)} active list${t.lists === 1 ? "" : "s"}`;
  const people = t.candidates
    ? `, with ${count(t.candidates)} people on ${t.lists === 1 ? "it" : "them"}`
    : "";

  if (t.called === "yes") {
    p.append(document.createTextNode(
      `This title has ${lists}${people}. The City has certified from ${t.lists === 1 ? "it" : "at least one"} ` +
      `since it was established, which means the list is being used for hiring.`
    ));
  } else {
    p.append(document.createTextNode(
      `This title has ${lists}${people}. There is no certification on record yet, ` +
      `which usually means the list is new. It does not mean it will not be called.`
    ));
  }
  body.append(p);

  body.append(el("p", { class: "note", text:
    "A certification is the City pulling names off a list to fill a job. How " +
    "often it happens varies enormously by title and says more about how that " +
    "agency hires than about how fast the list moves." }));

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

    renderFacts(t);
    renderExams(t, exams);
    renderList(t);
  } catch (err) {
    failure(host, err);
  }
}

main();
