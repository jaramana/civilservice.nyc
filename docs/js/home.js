/* ==========================================================================
   The front page.

   Three sections, in the order someone actually needs them: what you can apply
   for today, what is coming, what just closed. The middle one is the largest
   because it is the one that is reliably populated. DCAS opens most
   application periods on the first Wednesday of the month, so "accepting now"
   is legitimately empty for stretches, and an empty section at the top of a
   page reads as a broken site unless it says something true instead.
   ========================================================================== */

import {
  load, el, clear, typeLabel, fmtDate, daysBetween, countdown,
  freshness, markNav, failure, count,
} from "./common.js";

/* One row of the bulletin. The right-hand column carries the date and, where
   it helps, the number of days, because "closes Aug 7" and "3 days left" are
   answers to different questions and people ask both. */
function row(exam, mode) {
  const link = el("a", { class: "row", href: `exam.html?exam=${exam.exam_no}` });

  link.append(el("span", { class: "name", text: exam.title }));

  const meta = el("span", { class: "meta" });
  meta.append(document.createTextNode(
    `Exam ${exam.exam_no} · ${typeLabel(exam.type)}`
  ));
  link.append(meta);

  const when = el("span", { class: "when" });
  if (mode === "accepting") {
    const days = daysBetween(exam.end);
    when.append(el("strong", { text: `Closes ${fmtDate(exam.end)}` }));
    when.append(el("br"));
    when.append(document.createTextNode(countdown(days)));
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

/* The empty state carries the next real date. "Nothing is open" on its own
   invites someone to check back tomorrow and the day after: telling them the
   date saves the trips. */
function emptyAccepting(list, upcoming) {
  const next = upcoming[0];
  const node = el("p", { class: "empty" });
  node.append(el("strong", { text: "No exams are accepting applications today. " }));
  if (next) {
    node.append(document.createTextNode(
      `The City opens most application periods on the first Wednesday of the ` +
      `month. The next one is ${next.title}, opening ${fmtDate(next.start, { alwaysYear: true })}.`
    ));
  } else {
    node.append(document.createTextNode(
      "There is nothing scheduled to open in the published schedule either, " +
      "which usually means DCAS has not posted the coming year yet."
    ));
  }
  list.after(node);
}

async function main() {
  markNav();
  const host = document.getElementById("main");

  try {
    const [exams, meta] = await Promise.all([
      load("exams.json"),
      freshness(document.getElementById("freshness")),
    ]);

    const windows = meta.windows || {};
    const upcomingDays = windows.upcoming_days ?? 60;
    const closedDays = windows.recently_closed_days ?? 45;

    const accepting = exams
      .filter((e) => e.status === "accepting")
      .sort((a, b) => a.end.localeCompare(b.end));       // soonest deadline first

    const upcomingAll = exams
      .filter((e) => e.status === "upcoming")
      .sort((a, b) => a.start.localeCompare(b.start));

    // The front page shows the near window only. The rest stay on the exams
    // page, because 138 dates stretching into next fiscal year is a reference
    // table, not a front page.
    const upcoming = upcomingAll.filter((e) => daysBetween(e.start) <= upcomingDays);

    const closed = exams
      .filter((e) => e.status === "closed" && -daysBetween(e.end) <= closedDays)
      .sort((a, b) => b.end.localeCompare(a.end));

    const acceptingList = fill("accepting", "accepting-count", accepting, "accepting");
    if (!accepting.length) emptyAccepting(acceptingList, upcomingAll);

    fill("upcoming", "upcoming-count", upcoming, "upcoming");
    const note = document.getElementById("upcoming-note");
    const later = upcomingAll.length - upcoming.length;
    clear(note);
    note.append(document.createTextNode(
      `Exams opening in the next ${upcomingDays} days. `
    ));
    if (later > 0) {
      note.append(el("a", {
        href: "exams.html?status=upcoming",
        text: `${count(later)} more are scheduled further out.`,
      }));
    }

    fill("closed", "closed-count", closed, "closed");

    // The subscribe button uses webcal:// so a calendar app opens directly
    // rather than the browser downloading a file the person then has to find.
    // The plain https download link next to it is the fallback, and it is
    // deliberately not hidden: webcal:// does nothing on a desktop with no
    // calendar app registered.
    const cal = meta.calendar || {};
    if (cal.webcal) document.getElementById("subscribe").href = cal.webcal;
    if (cal.reminder_days) {
      document.getElementById("reminder-days").textContent = cal.reminder_days;
    }
  } catch (err) {
    failure(host, err);
  }
}

main();
