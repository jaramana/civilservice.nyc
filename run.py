#!/usr/bin/env python3
"""
Run the whole pipeline: fetch, prepare, export.

    python run.py              fetch fresh data and rebuild everything
    python run.py --offline    rebuild from data-raw/ without touching the network

The offline mode is what you want while changing how the data is shaped. The
fetch takes about a minute and hits four public APIs, so there is no reason to
repeat it every time you adjust a threshold in config.py.
"""

import runpy
import sys
from pathlib import Path

HERE = Path(__file__).parent
STAGES = [
    ("01_fetch.py", "Fetching from NYC OpenData, DCAS and The Pay Gap"),
    ("02_prepare.py", "Preparing"),
    ("03_export.py", "Exporting to docs/data/"),
    ("04_calendar.py", "Writing the calendar feed"),
]


def main():
    offline = "--offline" in sys.argv
    stages = STAGES[1:] if offline else STAGES
    if offline:
        print("Offline: rebuilding from data-raw/, not fetching.")

    for filename, description in stages:
        print(f"\n{'=' * 72}\n{description}\n{'=' * 72}")
        runpy.run_path(str(HERE / "pipeline" / filename), run_name="__main__")

    print("\nDone. Serve the site locally with:\n"
          "    python -m http.server -d docs 8000")


if __name__ == "__main__":
    main()
