/* ==========================================================================
   One exam.

   This is the page a calendar event links to, so its address is effectively
   permanent once anyone has subscribed: exam.html?exam=6311. The shape is set
   in config.py as EXAM_URL_TEMPLATE. Changing it breaks links that are already
   sitting in people's calendars.

   The page answers three questions in order: can I still apply, when is the
   deadline, and where do I actually apply. Everything else is below that.
   ========================================================================== */

import {
  load, el, clear, tag, typeLabel, fmtDate, fmtRange, daysBetween,
  freshness, markNav, failure, param,
} from "./common.js";

function fact(dl, term, value, qualifier) {
  if (value === undefined || value === null || value === "") return;
  dl.append(el("dt", { text: term }));
  const dd = el("dd");
  dd.append(typeof value === "object" ? value : document.createTextNode(String(value)));
  if (qualifier) dd.append(el("span", { class: "qualifier", text: qualifier }));
  dl.append(dd);
}

/* The one line under the title, in plain words. This is the sentence someone
   reads before deciding whether to keep reading. */
function statusLine(exam) {
  const p = document.getElementById("status-line");
  clear(p);
  p.append(tag(exam.status));
  p.append(document.createTextNode(" "));

  if (exam.status === "accepting") {
    const days = daysBetween(exam.end);
    const phrase = days === 0
      ? "Today is the last day to apply."
      : days === 1
        ? "Applications close tomorrow."
        : `Applications close in ${days} days, on ${fmtDate(exam.end, { alwaysYear: true })}.`;
    p.append(document.createTextNode(phrase));
  } else if (exam.status === "upcoming") {
    const days = daysBetween(exam.start);
    p.append(document.createTextNode(
      days <= 0
        ? "Applications open any day now."
        : `Applications open ${fmtDate(exam.start, { alwaysYear: true })}, in ${days} days.`
    ));
  } else {
    p.append(document.createTextNode(
      `Applications closed ${fmtDate(exam.end, { alwaysYear: true })}. ` +
      `You cannot apply to this exam now.`
    ));
  }
}

function actions(exam, meta) {
  const row = document.getElementById("actions");
  clear(row);

  if (exam.status === "accepting") {
    row.append(el("a", {
      class: "btn btn-primary",
      href: meta.oasys_url,
      text: "Apply through OASys",
    }));
  }

  if (exam.noe_url) {
    row.append(el("a", {
      class: "btn",
      href: exam.noe_url,
      text: "Notice of Examination (PDF)",
    }));
  }

  // A calendar file is only useful while a date is still ahead of you.
  if (exam.status !== "closed") {
    const dir = (meta.calendar && meta.calendar.dir) || "calendar";
    row.append(el("a", {
      class: "btn",
      href: `${dir}/${exam.slug}-${exam.exam_no}.ics`,
      download: "",
      text: "Add to my calendar",
    }));
  }
}

function facts(exam, title) {
  const dl = document.getElementById("facts");
  clear(dl);

  fact(dl, "Application period", fmtRange(exam.start, exam.end));

  fact(dl, "Who can apply", typeLabel(exam.type, "who"),
    exam.type === "promotion"
      ? "A promotion exam is only open to people already working for the City in a related title."
      : exam.type === "qie"
        ? "A qualified incumbent exam is for people already doing the job provisionally."
        : "Open competitive means open to the public. You do not need to work for the City to take it.");

  fact(dl, "Exam number", exam.exam_no);

  if (exam.fiscal_year) {
    // Spell out the year actually on screen. A fixed example meant an exam in
    // fiscal 2027 sat under a sentence explaining fiscal 2026.
    fact(dl, "Fiscal year", exam.fiscal_year,
      `The City's fiscal year runs July to June, so fiscal ${exam.fiscal_year} ` +
      `means July ${exam.fiscal_year - 1} through June ${exam.fiscal_year}.`);
  }

  if (title) {
    fact(dl, "Job title", el("a", {
      href: `title.html?title=${encodeURIComponent(title.slug)}`,
      text: title.title,
    }));
  } else {
    // About one exam in six has no exact match in the City's title catalog.
    // Two honest reasons: CUNY and Health + Hospitals run their own exams for
    // titles the City catalog does not carry, and the catalog cuts names at 30
    // characters so a longer exam title has nothing to match against. We do
    // not guess: putting the wrong salary on a job is worse than showing none.
    // Search is offered instead of a link.
    fact(dl, "Job title", el("a", {
      href: `titles.html?q=${encodeURIComponent(exam.title.replace(/\s*\(.*$/, ""))}`,
      text: "Search job titles",
    }), "No exact match in the City's title catalog, usually because the exam " +
        "is run by CUNY or Health + Hospitals.");
  }

  if (!exam.noe_url) {
    fact(dl, "Notice of Examination", "Not published yet",
      "DCAS posts it when the application period opens. It carries the " +
      "requirements, the fee and what is tested.");
  }

  fact(dl, "Source", exam.source === "dcas"
    ? "The DCAS exam pages"
    : "NYC OpenData, reconciled against the DCAS exam pages",
    exam.source === "dcas"
      ? "This exam is on the DCAS website but not yet in the OpenData schedule."
      : null);
}

function whatNext(exam) {
  const body = document.getElementById("what-next-body");
  clear(body);
  body.append(el("p", { text:
    "Passing puts you on a civil service list for this title, in score order. " +
    "Agencies hire from the top of that list. For entry-level and uniformed " +
    "jobs your number is most of the story. For professional and managerial " +
    "titles it works more like eligibility: being reachable is what lets you " +
    "be considered, and you still interview." }));
  body.append(el("p", { text: "Lists usually last four years and can be extended." }));
  body.append(el("p", {}, [
    el("a", { href: "how-to-apply.html", text: "More on how the process works" }),
  ]));
}

async function main() {
  markNav();
  const host = document.getElementById("main");
  const wanted = param("exam");

  try {
    const [exams, titles, meta] = await Promise.all([
      load("exams.json"),
      load("titles.json"),
      freshness(document.getElementById("freshness")),
    ]);

    // Exam numbers repeat across fiscal years as the City recycles them, so
    // prefer the one that is still live before falling back to the newest.
    const candidates = exams.filter((e) => e.exam_no === wanted);
    const exam = candidates.find((e) => e.status === "accepting")
      || candidates.find((e) => e.status === "upcoming")
      || candidates.sort((a, b) => (b.start || "").localeCompare(a.start || ""))[0];

    if (!exam) {
      document.getElementById("exam-title").textContent = "Exam not found";
      document.getElementById("exam-no").textContent = "";
      clear(document.getElementById("status-line"));
      document.getElementById("what-next").hidden = true;
      document.getElementById("facts").after(el("p", { class: "empty" }, [
        document.createTextNode(
          "No published exam has that number. Exams older than the archive " +
          "floor are not on this site, and the number may belong to one of those. "),
        el("a", { href: "index.html", text: "See the current exams" }),
        document.createTextNode("."),
      ]));
      return;
    }

    document.title = `${exam.title}, Exam ${exam.exam_no} | NYC civil service`;
    document.getElementById("exam-no").textContent = `Exam ${exam.exam_no}`;
    document.getElementById("exam-title").textContent = exam.title;

    const title = titles.find((t) => (t.exam_nos || []).includes(exam.exam_no));

    statusLine(exam);
    actions(exam, meta);
    facts(exam, title);
    whatNext(exam);
  } catch (err) {
    failure(host, err);
  }
}

main();
