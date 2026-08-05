#!/usr/bin/env python3
"""
Check every color pair in docs/css/site.css against WCAG AA.

    python3 tools/contrast.py

Exits non-zero if any pair fails, so it can go in the refresh workflow and
fail a build rather than shipping a color nobody can read. The project brief
asks for AA verified rather than assumed: this file is the verification.

Contrast is a property of a pair, not of a color, so the pairs have to be
listed by hand. Add a pair here whenever the CSS puts a new color on a new
background. Nothing can discover that automatically without rendering the page.
"""

import pathlib
import re
import sys

CSS = pathlib.Path(__file__).resolve().parent.parent / "docs" / "css" / "site.css"

# (foreground token, background token, minimum ratio)
#
# 4.5 is AA for body text. 3.0 is AA for text at 24px or 19px bold, which here
# means only the page title, and for the edges of interface components.
PAIRS = [
    ("ink",        "paper",       4.5),
    ("ink-soft",   "paper",       4.5),
    ("ink-faint",  "paper",       4.5),
    ("accent",     "paper",       4.5),
    ("ink",        "accent-soft", 4.5),   # a hovered bulletin row
    ("accent",     "accent-soft", 4.5),
    ("open",       "open-soft",   4.5),   # the status tags sit on their tint
    ("soon",       "soon-soft",   4.5),
    ("closed",     "closed-soft", 4.5),
    ("warn",       "warn-soft",   4.5),
    ("ink",        "warn-soft",   4.5),   # banner body text
    ("paper",      "accent",      4.5),   # the primary button, text on fill
    ("field",      "paper",       3.0),   # a form field's border is a component
    ("focus",      "paper",       3.0),   # focus ring against the sheet

    # The footer sits on the board rather than on the sheet, so every colour
    # used in it needs checking against that background too. Adding a surface
    # means adding its pairs: text on --board was never measured before the
    # footer moved out there.
    ("ink-soft",   "board",       4.5),   # footer body text
    ("ink-faint",  "board",       4.5),   # the freshness line
    ("accent",     "board",       4.5),   # footer links
    ("focus",      "board",       3.0),   # focus ring on a footer link
    # --rule-hair is deliberately not here. It separates rows that whitespace
    # already separates and carries no information, so it is decorative under
    # WCAG 1.4.11 and exempt. --field, which is what tells you an input exists,
    # is not exempt, which is why the two are different tokens.
]


def tokens(css, dark):
    """Pull the custom properties out of one of the two :root blocks."""
    head, _, tail = css.partition("@media (prefers-color-scheme: dark)")
    block = tail if dark else head
    return dict(re.findall(r"--([a-z-]+):\s*(#[0-9a-fA-F]{6})", block))


def _channel(value):
    v = value / 255
    return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4


def luminance(hex_color):
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


def ratio(a, b):
    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def main():
    css = CSS.read_text()
    failures = []

    for name, dark in (("light", False), ("dark", True)):
        theme = tokens(css, dark)
        print(f"--- {name}")
        for fg, bg, minimum in PAIRS:
            if fg not in theme or bg not in theme:
                failures.append(f"{name}: --{fg} or --{bg} is not defined")
                print(f"  {fg:>11} on {bg:<12}   missing")
                continue
            r = ratio(theme[fg], theme[bg])
            ok = r >= minimum
            grade = "AAA" if r >= 7 else "AA" if r >= 4.5 else "large only"
            print(f"  {fg:>11} on {bg:<12} {r:5.2f}  {grade}"
                  f"{'' if ok else f'   FAILS, needs {minimum}'}")
            if not ok:
                failures.append(f"{name}: --{fg} on --{bg} is {r:.2f}, needs {minimum}")

    if failures:
        print("\n" + "\n".join(failures))
        print(f"\n{len(failures)} pair(s) below WCAG AA.")
        return 1

    print(f"\nAll {len(PAIRS) * 2} pairs pass WCAG AA.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
