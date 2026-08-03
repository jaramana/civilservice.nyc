/* ==========================================================================
   About the data.

   The prose on this page is hand-written, but the source list and the field
   dictionary are drawn from the data files themselves. A methodology page that
   is maintained by hand goes stale quietly, and a stale methodology page is
   worse than none: it describes a site that no longer exists.
   ========================================================================== */

import { load, el, clear, fmtDate, freshness, markNav, failure } from "./common.js";

function renderSources(meta) {
  const dl = document.getElementById("sources");
  clear(dl);

  meta.sources.forEach((s) => {
    dl.append(el("dt", {}, [el("a", { href: s.url, text: s.name })]));
    const dd = el("dd", { text: `Updated ${fmtDate(s.updated, { alwaysYear: true })}` });
    dd.append(el("span", {
      class: "qualifier",
      text: `NYC OpenData, dataset ${s.dataset_id}.`,
    }));
    dl.append(dd);
  });

  // The DCAS pages are the fourth source and are not a dataset, so they are
  // easy to forget when listing where things came from. List them.
  if (meta.dcas_live && meta.dcas_live.used) {
    dl.append(el("dt", { text: "The DCAS exam pages" }));
    const dd = el("dd", {
      text: `Read directly, ${meta.dcas_live.exams_found} exams found on the last run`,
    });
    dd.append(el("span", {
      class: "qualifier",
      text: "The City updates these before the open data feed, so they decide " +
            "the application dates shown on this site when the two disagree.",
    }));
    dl.append(dd);
  }

  document.getElementById("sources-count").textContent =
    meta.sources.length + (meta.dcas_live && meta.dcas_live.used ? 1 : 0);
}

function renderDictionary(dict) {
  const dl = document.getElementById("dictionary");
  clear(dl);

  for (const [file, fields] of Object.entries(dict)) {
    if (file === "not_published") continue;

    dl.append(el("dt", { text: file }));
    const dd = el("dd", { text: fields._description || "" });
    const list = el("ul", { class: "prose", style: "margin:0.4rem 0 0;padding-left:1.1rem" });
    for (const [name, meaning] of Object.entries(fields)) {
      if (name.startsWith("_")) continue;
      const li = el("li", { style: "margin-bottom:0.35rem" });
      li.append(el("code", { text: name }));
      li.append(document.createTextNode(" " + meaning));
      list.append(li);
    }
    dd.append(list);
    dl.append(dd);
  }

  // What is deliberately absent is part of the method, so it renders here
  // rather than living only in a code comment.
  if (dict.not_published) {
    dl.append(el("dt", { text: "Never published" }));
    const dd = el("dd");
    const list = el("ul", { class: "prose", style: "margin:0;padding-left:1.1rem" });
    const items = Array.isArray(dict.not_published)
      ? dict.not_published
      : Object.entries(dict.not_published).map(([k, v]) => `${k}: ${v}`);
    items.forEach((t) => list.append(el("li", { text: t, style: "margin-bottom:0.35rem" })));
    dd.append(list);
    dl.append(dd);
  }
}

async function main() {
  markNav();
  const host = document.getElementById("main");

  try {
    const [dict, meta] = await Promise.all([
      load("dictionary.json"),
      freshness(document.getElementById("freshness")),
    ]);

    renderSources(meta);
    renderDictionary(dict);

    const windows = meta.windows || {};
    if (windows.archive_floor) {
      document.getElementById("refresh-line").textContent =
        `A scheduled job runs the pipeline once a day, rebuilds the files this ` +
        `site reads, and commits only when something actually changed. The ` +
        `archive starts at ${fmtDate(windows.archive_floor, { alwaysYear: true })}, ` +
        `the front page looks ${windows.upcoming_days} days ahead, and an exam ` +
        `stays under "recently closed" for ${windows.recently_closed_days} days.`;
    }
  } catch (err) {
    failure(host, err);
  }
}

main();
