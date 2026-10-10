---
id: AC-361
title: post-merge 生产验证：develop 尖端持有本刀全部结构改动，两个受影响测试文件回归全绿
status: active
kind: criterion
goal: GOAL-036
criterion: >
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }

  cd "$root"

  merge_base=$(git merge-base develop HEAD 2>/dev/null) || merge_base=""

  dev_tip=$(git rev-parse develop 2>/dev/null) || dev_tip=""

  [ -n "$merge_base" ] && [ "$merge_base" = "$dev_tip" ] || { echo
  "NOT-EVALUATED: GOAL-036 has not merged into develop yet
  (merge-base=$merge_base, develop=$dev_tip)" >&2; exit 3; }

  df="plugin/scripts/driver-filters.ts"

  grep -q "computeDispatchExclusion" "$df" || { echo
  "CAUSE=post-merge-regression -- computeDispatchExclusion missing on develop
  after a merge-base match, the landing did not actually carry the slice" >&2;
  exit 1; }

  callCount=$(grep -c "inFlightTasks()" plugin/scripts/worker-driver.ts || true)

  [ "${callCount:-0}" -le 1 ] || { echo "CAUSE=post-merge-regression --
  worker-driver.ts still has $callCount inFlightTasks() call(s) on develop,
  expected at most 1 (or 0 if the closure itself was removed)" >&2; exit 1; }

  dfOut=$(node --no-warnings --experimental-strip-types --test
  plugin/test/driver-filters.test.mjs 2>&1)

  dfExit=$?

  echo "$dfOut" > /tmp/goal036-ac361-driver-filters-output.txt

  [ "$dfExit" -eq 0 ] || { echo "CAUSE=post-merge-test-regression --
  driver-filters.test.mjs exit=$dfExit on develop, see
  /tmp/goal036-ac361-driver-filters-output.txt" >&2; exit 1; }

  wdOut=$(node --no-warnings --experimental-strip-types --test
  plugin/test/worker-driver.test.mjs 2>&1)

  wdExit=$?

  echo "$wdOut" > /tmp/goal036-ac361-worker-driver-output.txt

  [ "$wdExit" -eq 0 ] || { echo "CAUSE=post-merge-test-regression --
  worker-driver.test.mjs exit=$wdExit on develop, see
  /tmp/goal036-ac361-worker-driver-output.txt (large file; re-gate with a bigger
  --timeout if this was a timeout, not a real failure)" >&2; exit 1; }

  echo "PASS: develop tip carries the slice (single pure exclusion source, no
  duplicate inFlightTasks() call) and both affected test files pass"
expect: exit 0 = develop 尖端结构检查 + 两个测试文件全绿；exit 1 = CAUSE= 指明哪一项回归；exit 3 =
  GOAL-036 尚未并入 develop
origin: 用户 2026-10-11 批准三轨①
activatedAt: 2026-10-10T18:35:03.665Z
statusLog:
  - at: 2026-10-10T18:35:03.665Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-10T18:35:03.665Z
phase: post-merge
---
