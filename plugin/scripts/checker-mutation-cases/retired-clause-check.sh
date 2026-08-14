#!/usr/bin/env bash
# Mutation case for retired-clause-check (AC58 判据3 负控制,
# gap-ac58-retired-clauses-delete-and-archive). Fixture: the REAL archive + a clean source file
# (no retired body) → GREEN. INJECT: drop R05's marker from the ARCHIVE copy — the retired body was
# "deleted but never archived" (判据3 的「删了但没进 archive」样本) → the checker MUST go RED.
# RESTORE: put the marker back → GREEN.
set -u
name="retired-clause-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo_root="$(cd "${checker_dir}/../.." && pwd)"

mkdir -p "${workdir}/orchestration/archive" "${workdir}/plugin/loop"
cd "${workdir}"

# real archive as the fixture baseline (every migrated body HAS a home in it)
cp "${repo_root}/orchestration/archive/AC58-retired-clauses.md" orchestration/archive/AC58-retired-clauses.md
# clean source: no retired body (markers absent from source ⇒ correctly migrated as long as archived)
: > plugin/loop/fast-mode-loop-tick.md

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/retired-clause-check.ts" --root "$1" >/dev/null 2>&1
}

# GREEN baseline: archive has every marker; clean source has none.
if checker_cmd "${workdir}"; then :; else
  echo "baseline RED on a fully-archived repo (checker always-red?)" >&2
  exit 4
fi

# INJECT: strip R05's marker from the ARCHIVE copy — the body was "deleted but never archived".
python3 - <<'PYEOF'
p = "orchestration/archive/AC58-retired-clauses.md"
s = open(p, encoding="utf-8").read()
probe = "`.claude/loop.md` 已删除——exp5 退役"
assert probe in s, "fixture: R05 marker must exist in the real archive"
s = s.replace(probe, "`PROBE-STRIPPED`")
open(p, "w", encoding="utf-8").write(s)
PYEOF
if checker_cmd "${workdir}"; then
  echo "STAYED-GREEN — a retired body deleted without an archive home did not redden the checker" >&2
  exit 3
fi

# RESTORE: put the marker back → GREEN.
cp "${repo_root}/orchestration/archive/AC58-retired-clauses.md" orchestration/archive/AC58-retired-clauses.md
if checker_cmd "${workdir}"; then :; else
  echo "ALWAYS-RED — restored archive still reddens the checker" >&2
  exit 4
fi

exit 0
