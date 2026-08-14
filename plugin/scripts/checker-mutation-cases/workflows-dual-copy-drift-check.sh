#!/usr/bin/env bash
# Mutation case for workflows-dual-copy-drift-check (gap-workflows-dual-copy-drift-unchecked,
# AC1 判据1 + AC2 判据2 能取假). Fixture: a temp root with all three dual-copy workflow pairs
# (.claude/workflows/ vs plugin/workflows/) byte-identical → GREEN. Inject: a ONE-SIDED edit of
# ONE copy (only .claude/workflows/fan-in-execute.js gets a new line) → the checker MUST go RED
# (判据2: 单边改回放红). Restore: back to byte-identical → GREEN.
set -u
name="workflows-dual-copy-drift-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root="${workdir}/root"
files="drain-directives.js fan-in-execute.js run-routines.js"

mkdir -p "${root}/.claude/workflows" "${root}/plugin/workflows"

write_baseline() {
  for f in $files; do
    printf '// %s — fixture dual-copy baseline\nmodule.exports = { id: "%s" };\n' "$f" "$f" \
      > "${root}/.claude/workflows/${f}"
    cp "${root}/.claude/workflows/${f}" "${root}/plugin/workflows/${f}"
  done
}

checker_cmd() {
  node --no-warnings --experimental-strip-types "${checker_dir}/workflows-dual-copy-drift-check.ts" --root "${root}" >/dev/null 2>&1
}

# GREEN baseline: all three pairs byte-identical → exit 0.
write_baseline
if checker_cmd; then :; else
  echo "baseline RED on byte-identical dual-copy pairs (checker always-red?)" >&2
  exit 4
fi

# INJECT: a one-sided edit — only the .claude/ copy of fan-in-execute.js gets a new line
# (改正本而落地副本不跟, the exact drift class the check exists to catch) → MUST go RED.
printf '%s\n' '// one-sided edit' >> "${root}/.claude/workflows/fan-in-execute.js"
if checker_cmd; then
  echo "STAYED-GREEN — a one-sided edit did not redden the drift check (判据2 能取假 violated)" >&2
  exit 3
fi

# RESTORE: back to byte-identical → GREEN again.
cp "${root}/.claude/workflows/fan-in-execute.js" "${root}/plugin/workflows/fan-in-execute.js"
if checker_cmd; then
  echo "workflows-dual-copy-drift-check mutation case: PASS (one-sided edit caught, byte-identical restored)" >&2
else
  echo "ALWAYS-RED — restored (byte-identical) pairs still redden the drift check" >&2
  exit 4
fi

# INJECT #2 (硬规则 3a): delete the plugin/ copy of run-routines.js entirely → the pair is a
# drift state (MISSING) → MUST go RED (an absent side must not silently stop being covered).
rm "${root}/plugin/workflows/run-routines.js"
if checker_cmd; then
  echo "STAYED-GREEN — a deleted side did not redden the drift check (absent ≠ 合格)" >&2
  exit 3
fi

# RESTORE #2 → GREEN.
cp "${root}/.claude/workflows/run-routines.js" "${root}/plugin/workflows/run-routines.js"
if checker_cmd; then :; else
  echo "ALWAYS-RED — restored (present) pair still reddens the drift check" >&2
  exit 4
fi

exit 0
