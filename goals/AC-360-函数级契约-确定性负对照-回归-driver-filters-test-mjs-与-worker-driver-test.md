---
id: AC-360
title: 函数级契约 + 确定性负对照 + 回归：driver-filters.test.mjs 与 worker-driver.test.mjs 全量回归绿
status: active
kind: criterion
goal: GOAL-036
criterion: >
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }

  cd "$root"

  df="plugin/scripts/driver-filters.ts"

  grep -q "computeDispatchExclusion" "$df" || { echo "NOT-EVALUATED: $df does
  not define computeDispatchExclusion yet" >&2; exit 3; }

  grep -q "computeDispatchExclusion" plugin/test/driver-filters.test.mjs
  2>/dev/null || { echo "NOT-EVALUATED: plugin/test/driver-filters.test.mjs has
  no computeDispatchExclusion test yet" >&2; exit 3; }

  posCount=$(grep -c "computeDispatchExclusion"
  plugin/test/driver-filters.test.mjs)

  [ "$posCount" -ge 2 ] || { echo "CAUSE=contract-undertested -- expected at
  least 2 references to computeDispatchExclusion in the test file (a
  basic-correctness case and a determinism/purity case), found $posCount" >&2;
  exit 1; }

  grep -qi "deepStrictEqual\|deepEqual" plugin/test/driver-filters.test.mjs || {
  echo "CAUSE=purity-untested -- no deep-equality assertion found; the
  determinism check (same inputs twice -> identical output) is the negative
  control for this slice and must exist" >&2; exit 1; }

  dfOut=$(node --no-warnings --experimental-strip-types --test
  plugin/test/driver-filters.test.mjs 2>&1)

  dfExit=$?

  echo "$dfOut" > /tmp/goal036-ac360-driver-filters-output.txt

  [ "$dfExit" -eq 0 ] || { echo "CAUSE=driver-filters-test-red --
  plugin/test/driver-filters.test.mjs exit=$dfExit, see
  /tmp/goal036-ac360-driver-filters-output.txt" >&2; exit 1; }

  wdOut=$(node --no-warnings --experimental-strip-types --test
  plugin/test/worker-driver.test.mjs 2>&1)

  wdExit=$?

  echo "$wdOut" > /tmp/goal036-ac360-worker-driver-output.txt

  [ "$wdExit" -eq 0 ] || { echo "CAUSE=worker-driver-test-red --
  plugin/test/worker-driver.test.mjs exit=$wdExit, see
  /tmp/goal036-ac360-worker-driver-output.txt (large file; re-gate with a bigger
  --timeout if this was a timeout, not a real failure)" >&2; exit 1; }

  echo "PASS: computeDispatchExclusion has a basic-correctness test and a
  determinism/purity negative control; driver-filters.test.mjs and
  worker-driver.test.mjs both green"
expect: exit 0 = 两个测试文件全绿 + 确定性负对照存在；exit 1 = CAUSE= 指明哪一项回归；exit 3 =
  computeDispatchExclusion 或其测试尚未落地
origin: 用户 2026-10-11 批准三轨①
activatedAt: 2026-10-10T18:35:02.330Z
statusLog:
  - at: 2026-10-10T18:35:02.330Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-10T18:35:02.330Z
---
