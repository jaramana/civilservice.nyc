#!/usr/bin/env python3
"""
Check the browser modules for the mistakes a static site has no compiler to
catch.

    python3 tools/checkjs.py

Exits non-zero on a problem, so the refresh workflow fails instead of
publishing a page that throws on load.

This exists because of a real bug: title.js called fmtDate() without importing
it. Nothing failed at build time, nothing failed on most title pages, and the
error only appeared on titles that happen to have an exam, because that is the
one branch reaching that call. The page caught the exception and showed "Could
not load the data", which reads like a broken link rather than a typo.

Two checks:

  1. Every name imported from common.js is actually exported by it.
  2. Every common.js helper a module calls is in that module's import list.

Neither replaces opening the page. They catch the class of error that hides in
a branch nobody clicked.
"""

import pathlib
import re
import sys

JS = pathlib.Path(__file__).resolve().parent.parent / "docs" / "js"


def exports(source):
    return (set(re.findall(r"export (?:async )?function (\w+)", source))
            | set(re.findall(r"export const (\w+)", source)))


def main():
    common = (JS / "common.js").read_text()
    exported = exports(common)
    problems = []

    for path in sorted(JS.glob("*.js")):
        if path.name == "common.js":
            continue
        src = path.read_text()
        match = re.search(
            r"import\s*\{([^}]*)\}\s*from\s*[\"']\./common\.js[\"']", src)
        imported = ({x.strip() for x in match.group(1).split(",") if x.strip()}
                    if match else set())

        for name in sorted(imported - exported):
            problems.append(
                f"{path.name}: imports {name}, which common.js does not export")

        # Only look after the import statement, so the import list itself is
        # not mistaken for a call site.
        body = src[match.end():] if match else src
        for name in sorted(exported - imported):
            if re.search(rf"(?<![\w.]){re.escape(name)}\s*\(", body):
                problems.append(
                    f"{path.name}: calls {name}() but never imports it")

    if problems:
        print("\n".join(problems))
        print(f"\n{len(problems)} problem(s).")
        return 1

    modules = len(list(JS.glob("*.js"))) - 1
    print(f"{modules} modules checked, all imports resolve.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
