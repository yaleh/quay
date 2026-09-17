---
id: AC-279
title: main/serial/lowconc 三阶段的15个实测>30秒的大测试文件全部被拆分/移走
status: draft
kind: criterion
goal: GOAL-022
criterion: >-
  bash <<'CRIT'

  set -euo pipefail

  # The 15 files below are the REAL measured >30s wall-clock files from two
  independent real runs

  # (CI run 35162872510 2026-09-16T23:34Z and a live tokyo-alpha re-run
  2026-09-17T00:34Z, both via

  # the suite's own __PERFILE__ duration_ms= telemetry) — not a guess, not a
  proxy metric like test()

  # count (a case-count ceiling was tried first and false-positived on 31 files
  whose total wall-clock

  # is actually fine, e.g. meta-driver.test.mjs's 128 cases finish fast; case
  count does not correlate

  # with wall-clock, only real per-file duration does). Each must be split
  (functional-boundary split,

  # per the fork analysis on ready-pool-check.test.mjs/slot-refill.test.mjs) or
  its slow tests

  # optimized, so node --test's cross-file parallelism can actually apply to
  them.

  OFFENDERS=(
    "plugin/test/ready-pool-check.test.mjs"
    "plugin/test/slot-refill.test.mjs"
    "plugin/test/full-suite-runner.test.mjs"
    "plugin/test/worker-driver-fan-in.test.mjs"
    "plugin/test/fan-in-execute-paths.test.mjs"
    "plugin/test/resource-gate.test.mjs"
    "plugin/test/worker-driver-resident.test.mjs"
    "plugin/test/promotion-driver.test.mjs"
    "plugin/test/driver-runtime.test.mjs"
    "packages/quay/test/server-partial-stop.test.mjs"
    "plugin/test/runner-grouping-list-groups.test.mjs"
    "plugin/test/goal-driver.test.mjs"
    "plugin/test/cap-from-gate-cli.test.mjs"
    "plugin/test/writestate-atomicity-split.test.mjs"
    "plugin/test/observer-registry.test.mjs"
  )

  STILL_PRESENT=()

  for f in "${OFFENDERS[@]}"; do
    if [ -f "$f" ]; then
      STILL_PRESENT+=("$f")
    fi
  done

  if [ "${#STILL_PRESENT[@]}" -gt 0 ]; then
    echo "CAUSE=offender-still-monolithic — ${#STILL_PRESENT[@]}/${#OFFENDERS[@]} of the real-measured >30s-wall-clock test files still exist unchanged at their original path: ${STILL_PRESENT[*]}" >&2; exit 1
  fi

  echo "OK — all ${#OFFENDERS[@]} originally-offending files have been
  split/removed from their monolithic form"

  exit 0

  CRIT
expect: criterion exits 0 once none of the 15 named offender files still exist
  at their original monolithic path
origin: GOAL-022 背景：15个文件实测 __PERFILE__ duration_ms 均 >30000，逐个点名
---
