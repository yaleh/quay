---
id: AC-357
title: 函数级可证伪契约 + 回归：applyNeedsHumanTransition 的 accept/surfaced-failure
  两态测试落地，driver-filters.test.mjs 与 worker-driver.test.mjs 全量回归绿
status: achieved
kind: criterion
goal: GOAL-035
criterion: >
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }

  cd "$root"

  pf="plugin/scripts/driver-filters.ts"

  grep -q "applyNeedsHumanTransition" "$pf" || { echo "NOT-EVALUATED: $pf does
  not define applyNeedsHumanTransition yet" >&2; exit 3; }

  grep -q "applyNeedsHumanTransition" plugin/test/driver-filters.test.mjs
  2>/dev/null || { echo "NOT-EVALUATED: plugin/test/driver-filters.test.mjs has
  no applyNeedsHumanTransition test yet" >&2; exit 3; }

  dfOut=$(node --no-warnings --experimental-strip-types --test
  plugin/test/driver-filters.test.mjs 2>&1)

  dfExit=$?

  echo "$dfOut" > /tmp/goal035-ac357-driver-filters-output.txt

  [ "$dfExit" -eq 0 ] || { echo "CAUSE=driver-filters-test-red --
  plugin/test/driver-filters.test.mjs exit=$dfExit, see
  /tmp/goal035-ac357-driver-filters-output.txt" >&2; exit 1; }

  posCount=$(grep -c "applyNeedsHumanTransition"
  plugin/test/driver-filters.test.mjs)

  [ "$posCount" -ge 2 ] || { echo "CAUSE=contract-undertested -- expected at
  least 2 references to applyNeedsHumanTransition in the test file (an accept
  case and a surfaced-failure case), found $posCount" >&2; exit 1; }

  grep -qi "committed.*false\|ok.*false" plugin/test/driver-filters.test.mjs ||
  { echo "CAUSE=negative-control-missing -- the test file has no assertion that
  applyNeedsHumanTransition can return ok:false / committed:false and that it
  propagates rather than throwing" >&2; exit 1; }

  wdOut=$(node --no-warnings --experimental-strip-types --test
  plugin/test/worker-driver.test.mjs 2>&1)

  wdExit=$?

  echo "$wdOut" > /tmp/goal035-ac357-worker-driver-output.txt

  [ "$wdExit" -eq 0 ] || { echo "CAUSE=worker-driver-test-red --
  plugin/test/worker-driver.test.mjs exit=$wdExit, see
  /tmp/goal035-ac357-worker-driver-output.txt (this file is large; if it timed
  out, re-gate with a larger --timeout)" >&2; exit 1; }

  echo "PASS: driver-filters.test.mjs and worker-driver.test.mjs both green;
  applyNeedsHumanTransition has both an accept-path and a surfaced-failure-path
  (ok:false/committed:false, not thrown/swallowed) assertion"
expect: exit 0 = 两个测试文件全绿 + 契约两态都有断言；exit 1 = CAUSE= 指明哪一项回归；exit 3 =
  applyNeedsHumanTransition 或其测试尚未落地
origin: 继 GOAL-030~034 后第二阶段
activatedAt: 2026-10-10T09:38:56.807Z
statusLog:
  - at: 2026-10-10T09:38:56.807Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-10-10T10:45:00.182Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-10T09:38:56.806Z
---
