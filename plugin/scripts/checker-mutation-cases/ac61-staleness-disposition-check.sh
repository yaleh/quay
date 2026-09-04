#!/usr/bin/env bash
# Mutation case for ac61-staleness-disposition-check (tasks/gap-ac61-staleness-list-item-disposition,
# AC61 DoD 负控制: 某条无处置记录 ⇒ 红).
# Fixture: the REAL task file → GREEN. Inject: DELETE the `### A-3` disposition record (the exact
# "一条无处置记录" shape the DoD requires the checker to go RED on) → MUST go RED. Restore: put the
# full record back → back to GREEN.
set -u
name="ac61-staleness-disposition-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
task_file="${repo_root}/tasks/gap-ac61-staleness-list-item-disposition.md"

mkdir -p "${workdir}"
cd "${workdir}"

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/ac61-staleness-disposition-check.ts" --root "$1" ${2:+--task-file "$2"} >/dev/null 2>&1
}

# GREEN baseline: the real task file (all 11 disposition records) → exit 0.
if checker_cmd "${repo_root}"; then :; else
  echo "baseline RED on the real task file (checker always-red?)" >&2
  exit 4
fi

# INJECT: copy the real task file, delete the `### A-3` disposition record (heading + content, through
# the next `### `) → the task file now carries a list item with NO disposition record → MUST go RED.
python3 - "$task_file" "$workdir/injected.md" <<'PY'
import re, sys
src, out = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8").read()
# Delete from the `### A-3` heading to the next `### ` heading (the A-3 record).
m = re.search(r'(?m)^### A-3 .*\n(?:.*?\n)*?(?=^### A-4 )', text)
if not m:
    print("could not locate ### A-3 record", file=sys.stderr); sys.exit(2)
text = text[:m.start()] + text[m.end():]
open(out, "w", encoding="utf-8").write(text)
PY
if checker_cmd "${repo_root}" "${workdir}/injected.md"; then
  echo "STAYED-GREEN — a task file missing the A-3 disposition record did not redden the checker" >&2
  exit 3
fi

# RESTORE: the real file again (the record is back) → back to GREEN.
if checker_cmd "${repo_root}"; then :; else
  echo "ALWAYS-RED — restored real task file still reddens the checker" >&2
  exit 4
fi

exit 0
