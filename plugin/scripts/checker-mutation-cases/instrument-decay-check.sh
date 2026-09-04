#!/usr/bin/env bash
# Mutation case for instrument-decay-check (gap-archguard-p5-instrument-decay-standing-guard):
# the defect is a jsonl carrier whose writer split to another file — the expected groups stop
# writing while companion groups in the SAME carrier keep writing (P5 "写入速率归零，产生路径仍在
# 运行" 的字面实例, docs/proposals/archguard-generation-era-primitives.md §3). The checker must
# go RED on companion contrast (never-wrote), and must NOT use an absolute rate threshold (AC2
# reverse: a genuinely-low-frequency-but-still-writing carrier must stay green). This case proves
# both wired directions on a hermetic temp .quay/:
#   GREEN baseline — both manifest carriers complete & recent → default exits 0; --no-block exits 0
#   INJECT         — drop the 4 suite-decision steps from fan-in-step-trace.jsonl (writer split)
#                    → default exits 1 (fail-closed RED); --no-block exits 0 AND prints
#                    INSTRUMENT-DECAY + ac-precheck (the report-only wired path)
#   RESTORE        — re-add the 4 steps → default exits 0 again
# A masking fix (or a checker that only watches an absolute rate threshold) stays green forever
# and fails exit 3.
set -u
name="instrument-decay-check"
workdir="${1:?usage: $name.sh <workdir>}"
checker_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── hermetic .quay/ (the two manifest carriers, see instrument-decay-check.ts MANIFEST) ─────────
repo="${workdir}/repo"
trace="${repo}/.quay/fan-in-step-trace.jsonl"
lock="${repo}/.quay/fan-in-lock-events.jsonl"
mkdir -p "$(dirname "$trace")"

RECENT="2026-09-04T12:00:00.000Z"
COMPANION_STEPS="merge-develop anti-drift typecheck scoped-gate doc-check anti-drift-land ac-gate ff"
SUITE_STEPS="ac-precheck suite-start suite-end suite-skip"

write_trace() {  # $1 = include_suite (1|0)
  local inc="${1:-1}" s
  : > "$trace"
  for s in $COMPANION_STEPS; do
    printf '{"event":"step-end","step":"%s","task":"gap-x","runId":"wk-prod-1","ts":"%s","ok":true}\n' "$s" "$RECENT" >> "$trace"
  done
  if [ "$inc" = "1" ]; then
    for s in $SUITE_STEPS; do
      printf '{"event":"step-end","step":"%s","task":"gap-x","runId":"wk-prod-1","ts":"%s","ok":true}\n' "$s" "$RECENT" >> "$trace"
    done
  fi
}

write_lock() {
  printf '{"event":"acquire","ts":"%s","taskId":"gap-x","pid":1,"runId":"wk-prod-1"}\n' "$RECENT" > "$lock"
  printf '{"event":"release","ts":"%s","taskId":"gap-x","pid":1,"runId":"wk-prod-1"}\n' "$RECENT" >> "$lock"
}

checker_run() {  # default (fail-closed) — rest of args forwarded
  node --no-warnings --experimental-strip-types "${checker_dir}/instrument-decay-check.ts" --root "$repo" "$@" >/dev/null 2>&1
}
checker_no_block() {
  node --no-warnings --experimental-strip-types "${checker_dir}/instrument-decay-check.ts" --root "$repo" --no-block
}

# GREEN baseline: both carriers complete & recent → default exits 0 AND --no-block exits 0.
write_trace 1
write_lock
if checker_run; then :; else
  echo "baseline RED on complete/recent carriers (checker always-red?)" >&2
  exit 4
fi
if checker_run --no-block; then :; else
  echo "baseline --no-block RED on complete/recent carriers (checker always-red?)" >&2
  exit 4
fi

# INJECT: drop the 4 suite-decision steps (writer split) → default MUST go red (exit 1);
# --no-block MUST exit 0 but print the INSTRUMENT-DECAY signal + name a decayed group.
write_trace 0
if checker_run; then
  echo "STAYED-GREEN — dropping the 4 suite-decision steps did not redden the default (fail-closed) checker" >&2
  exit 3
fi
if ! checker_run --no-block; then
  echo "STAYED-GREEN (wrong direction) — --no-block still reddened after the split (report-only must exit 0)" >&2
  exit 3
fi
if ! checker_no_block | grep -q "INSTRUMENT-DECAY"; then
  echo "STAYED-GREEN — --no-block did not print INSTRUMENT-DECAY for the split carrier" >&2
  exit 3
fi
if ! checker_no_block | grep -q "ac-precheck"; then
  echo "STAYED-GREEN — --no-block did not name the decayed suite-decision group" >&2
  exit 3
fi

# RESTORE: re-add the 4 steps → default GREEN again.
write_trace 1
if checker_run; then :; else
  echo "ALWAYS-RED — restored complete carriers still redden the checker" >&2
  exit 4
fi

exit 0
