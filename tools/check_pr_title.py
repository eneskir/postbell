"""Fails when a pull request title is not a Conventional Commits subject.

Pull requests are squash-merged, so the title becomes the commit subject on main.
The title is read from the TITLE environment variable.

Exit code: 0 valid, 1 invalid, 2 no title given.
"""

import os
import re
import sys

TYPES = ("build", "chore", "ci", "docs", "feat", "fix", "perf", "refactor", "revert", "style", "test")
PATTERN = re.compile(r"^(?:" + "|".join(TYPES) + r")(?:\([a-z0-9-]+\))?!?: \S")
# Same limit as commitlint's config-conventional. Dependabot titles a single update in a
# group as "ci: Bump <action> from <old> to <new> in the actions group across 1 directory",
# which is longer than 72.
MAX_LENGTH = 100


def problems(title: str) -> list[str]:
    found = []
    if not PATTERN.match(title):
        found.append("start with a type (" + ", ".join(TYPES) + "), a colon and a space, for example 'fix: keep the alarm after a restart'")
    if len(title) > MAX_LENGTH:
        found.append(f"be at most {MAX_LENGTH} characters (it has {len(title)})")
    if title.endswith("."):
        found.append("not end with a period")
    return found


def main() -> int:
    title = os.environ.get("TITLE", "").strip()
    if not title:
        print("ERROR: TITLE is empty")
        return 2
    found = problems(title)
    for problem in found:
        print(f"The title should {problem}.")
    if not found:
        print("Title OK.")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
