#!/usr/bin/env python3
"""Emit the frontmatter (name + description) for this extracted Skill as JSON,
parsed directly from SKILL.md, so downstream tooling doesn't need to
re-parse markdown itself."""
import re
import json
import sys
from pathlib import Path

SKILL_MD = Path(__file__).resolve().parent.parent / "SKILL.md"


def main():
    text = SKILL_MD.read_text()
    m = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    if not m:
        print(json.dumps({"error": "no frontmatter block found"}))
        return 1
    fm_text = m.group(1)
    fm = {}
    for line in fm_text.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            fm[k.strip()] = v.strip()
    print(json.dumps(fm, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
