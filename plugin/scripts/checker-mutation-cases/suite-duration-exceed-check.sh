#!/usr/bin/env bash
# Mutation case for suite-duration-exceed-check (gap-suite-duration-exceed-check-not-wired): the
# defect is a full-suite verification round that exceeds AC101's 600s target with NO alert — the
# pre-verified-suite path bypassed the 10min foreground cap and the duration ledger went silent
# (round227 936.5s). The checker reads the ledger and goes RED (exit 1, SUITE-DURATION-EXCEEDED)
# when the latest round's durationMs > 600000. This case proves BOTH the wired directions on a
# hermetic temp ledger:
#   GREEN baseline  — a fast round (500.8s) → default exits 0; --no-block exits 0
#   INJECT          — a slow round (900s) → default exits 1 (fail-closed RED); --no-block exits 0
#                     AND prints SUITE-DURATION-EXCEEDED (the report-only wired path)
#   RESTORE         — fast round → default exits 0 again
# A masking fix (or a checker that never reads the ledger) stays green forever and fails exit 3.
set -u
name="suite-duration-exceed-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── hermetic ledger (the .quay/verification-round.jsonl shape full-suite-runner writes) ──────────
repo="${workdir}/repo"
ledger="${repo}/.quay/verification-round.jsonl"
mkdir -p "$(dirname "$ledger")"

write_round() {  # $1=round $2=durationMs
  printf '{"round":%s,"startedAt":"2026-08-19T00:00:00.000Z","durationMs":%s,"scope":"worktree","state":"green","commit":"abc"}\n' "$1" "$2" > "$ledger"
}

checker_run() {  # default (fail-closed) — rest of args forwarded
  node --experimental-strip-types "${checker_dir}/suite-duration-exceed-check.ts" --root "$repo" "$@" >/dev/null 2>&1
}
checker_no_block() {
  node --experimental-strip-types "${checker_dir}/suite-duration-exceed-check.ts" --root "$repo" --no-block
}

# GREEN baseline: a fast round (500s) → default exits 0 AND --no-block exits 0.
write_round 224 500803
if checker_run; then :; else
  echo "baseline RED on a fast round (checker always-red?)" >&2
  exit 4
fi
if checker_run --no-block; then :; else
  echo "baseline --no-block RED on a fast round (checker always-red?)" >&2
  exit 4
fi

# INJECT: a slow round (900s) → default MUST go red (exit 1); --no-block MUST exit 0 but print the signal.
write_round 300 900000
if checker_run; then
  echo "STAYED-GREEN — a 900s round did not redden the default (fail-closed) checker" >&2
  exit 3
fi
if ! checker_run --no-block; then
  echo "STAYED-GREEN (wrong direction) — --no-block still reddened on a 900s round (report-only must exit 0)" >&2
  exit 3
fi
if ! checker_no_block | grep -q "SUITE-DURATION-EXCEEDED"; then
  echo "STAYED-GREEN — --no-block did not print SUITE-DURATION-EXCEEDED for the 900s round" >&2
  exit 3
fi

# RESTORE: fast round → default GREEN again.
write_round 301 500803
if checker_run; then :; else
  echo "ALWAYS-RED — restored fast round still reddens the checker" >&2
  exit 4
fi

exit 0
