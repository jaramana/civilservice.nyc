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

  // The value is the same short label the rows and the filter use. This is the
  // one place the meaning is spelled out.
  fact(dl, "Who can apply", typeLabel(exam.type),
    exam.type === "promotion"
      ? "Only City employees who already hold permanent Civil Service status in a related title."
      : exam.type === "qie"
        ? "Only people already doing the job provisionally."
        : "Anyone who meets the minimum qualifications. You do not need to already work for the City.");

  fact(dl, "Exam number", exam.exam_no);

  if (exam.fiscal_year) {
    // Spell out the year actually on screen. A fixed example meant an exam in
    // fiscal 2027 sat under a sentence explaining fiscal 2026.
    fact(dl, "Fiscal year", exam.fiscal_year,
      `The City's fiscal year runs from July to June. So fiscal ` +
      `${exam.fiscal_year} means July ${exam.fiscal_year - 1} through June ` +
      `${exam.fiscal_year}.`);
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
    }), "No exact match in the City's title catalog. This is usually " +
        "because the exam is run by the City University of New York " +
        "(CUNY) or by Health + Hospitals, not by the City government " +
        "itself.");
  }

  if (!exam.noe_url) {
    fact(dl, "Notice of Examination", "Not published yet",
      "DCAS posts it once the application period opens. It lists the " +
      "requirements, the fee, and what the exam tests.");
  }

  fact(dl, "Source", exam.source === "dcas"
    ? "The DCAS exam pages"
    : "NYC OpenData, reconciled against the DCAS exam pages",
    exam.source === "dcas"
      ? "This exam is on the DCAS website but not yet in the OpenData schedule."
      : null);
}

/* One line, not a section. Everything else that used to sit here is on the
   How to apply page, which is in the nav on every page, and repeating it on
   345 exam pages made each one longer without making any one of them more
   useful. This single idea stays because it is the one someone about to pay an
   application fee most often has wrong. */
function whatNext() {
  const body = document.getElementById("what-next-body");
  clear(body);
  body.append(document.createTextNode(
    "Passing puts you on a list for this title, in score order. It does not "
    + "get you the job by itself. "));
  body.append(el("a", { href: "how-to-apply.html", text: "How the process works" }));
  body.append(document.createTextNode("."));
}

async function main() {
  markNav();
  const host = document.getElementById("main");
  const wanted = param("exam");

  try {
    const [exams, titles, meta] = await Promise.all([
      load("exams.json"),
      load("titles.json"),
      freshness(),
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
      document.getElementById("what-next-body").hidden = true;
      document.getElementById("facts").after(el("p", { class: "empty" }, [
        document.createTextNode(
          "No exam on this site has that number. Very old exams are not " +
          "included here, and this number may belong to one of those. "),
        el("a", { href: "index.html", text: "See all exams" }),
        document.createTextNode("."),
      ]));
      return;
    }

    document.title = `${exam.title}, Exam ${exam.exam_no} | NYC Civil Service Exams`;
    document.getElementById("exam-no").textContent = `Exam ${exam.exam_no}`;
    document.getElementById("exam-title").textContent = exam.title;

    const title = titles.find((t) => (t.exam_nos || []).includes(exam.exam_no));

    statusLine(exam);
    actions(exam, meta);
    facts(exam, title);
    whatNext();
  } catch (err) {
    failure(host, err);
  }
}

main();
