#!/usr/bin/env bash
# Counts extracted-skill artifacts and their line counts.
set -euo pipefail
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== $SKILL_DIR =="
for d in templates reference examples scripts; do
  n=$(find "$SKILL_DIR/$d" -type f 2>/dev/null | wc -l)
  echo "$d: $n files"
done

echo
echo "-- line counts --"
find "$SKILL_DIR" -maxdepth 1 -name "SKILL.md" -exec wc -l {} \;
find "$SKILL_DIR/reference" -maxdepth 1 -name "*.md" -exec wc -l {} \;
