---
id: AC-358
title: post-merge 生产验证：develop 尖端持有本刀全部结构改动，两个受影响测试文件回归全绿
status: active
kind: criterion
goal: GOAL-035
criterion: >
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }

  cd "$root"

  merge_base=$(git merge-base develop HEAD 2>/dev/null) || merge_base=""

  dev_tip=$(git rev-parse develop 2>/dev/null) || dev_tip=""

  [ -n "$merge_base" ] && [ "$merge_base" = "$dev_tip" ] || { echo
  "NOT-EVALUATED: GOAL-035 has not merged into develop yet
  (merge-base=$merge_base, develop=$dev_tip)" >&2; exit 3; }

  pf="plugin/scripts/driver-filters.ts"

  grep -q "applyNeedsHumanTransition" "$pf" || { echo
  "CAUSE=post-merge-regression -- applyNeedsHumanTransition missing on develop
  after a merge-base match, the landing did not actually carry the slice" >&2;
  exit 1; }

  directAdd=$(grep -c "retryState\.needsHuman\.add("
  plugin/scripts/worker-driver.ts || true)

  [ "${directAdd:-0}" -eq 0 ] || { echo "CAUSE=post-merge-regression --
  worker-driver.ts has $directAdd direct retryState.needsHuman.add( call(s)
  again on develop" >&2; exit 1; }

  dfOut=$(node --no-warnings --experimental-strip-types --test
  plugin/test/driver-filters.test.mjs 2>&1)

  dfExit=$?

  echo "$dfOut" > /tmp/goal035-ac358-driver-filters-output.txt

  [ "$dfExit" -eq 0 ] || { echo "CAUSE=post-merge-test-regression --
  driver-filters.test.mjs exit=$dfExit on develop, see
  /tmp/goal035-ac358-driver-filters-output.txt" >&2; exit 1; }

  wdOut=$(node --no-warnings --experimental-strip-types --test
  plugin/test/worker-driver.test.mjs 2>&1)

  wdExit=$?

  echo "$wdOut" > /tmp/goal035-ac358-worker-driver-output.txt

  [ "$wdExit" -eq 0 ] || { echo "CAUSE=post-merge-test-regression --
  worker-driver.test.mjs exit=$wdExit on develop, see
  /tmp/goal035-ac358-worker-driver-output.txt (large file; re-gate with a bigger
  --timeout if this was a timeout, not a real failure)" >&2; exit 1; }

  echo "PASS: develop tip carries the slice (single mutator, no direct
  retryState mutation outside it) and both affected test files pass"
expect: exit 0 = develop 尖端结构检查 + 两个测试文件全绿；exit 1 = CAUSE= 指明哪一项回归；exit 3 =
  GOAL-035 尚未并入 develop
origin: 继 GOAL-030~034 后第二阶段
activatedAt: 2026-10-10T09:38:58.191Z
statusLog:
  - at: 2026-10-10T09:38:58.191Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-10T09:38:58.190Z
phase: post-merge
---
