---
id: AC-908
title: AC-361 的 post-merge 判据改为「按位置重跑 AC-359 的结构检查」：dispatch 窗口内恰一次
  computeDispatchExclusion、零次旧 inFlightTasks()（注释行不参与匹配），develop 尖端两个受影响测试文件全绿
status: achieved
kind: criterion
goal: GOAL-036
criterion: >-
  set -u

  root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "NOT-EVALUATED:
  not inside a git repository" >&2; exit 3; }

  cd "$root"

  mb=$(git merge-base develop HEAD 2>/dev/null) || mb=""

  tip=$(git rev-parse develop 2>/dev/null) || tip=""

  [ -n "$mb" ] && [ "$mb" = "$tip" ] || { echo "NOT-EVALUATED: GOAL-036 has not
  merged into develop yet (merge-base=$mb, develop=$tip)" >&2; exit 3; }

  df=plugin/scripts/driver-filters.ts

  grep -q "computeDispatchExclusion" "$df" || { echo
  "CAUSE=post-merge-regression -- computeDispatchExclusion missing on develop
  after a merge-base match, the slice did not carry" >&2; exit 1; }

  node -e '

  const fs = require("fs");

  const live = (f) => fs.readFileSync(f, "utf8").split("\n").filter((l) => {
  const s = l.trim(); return !(s.startsWith("//") || s.startsWith("*") ||
  s.startsWith("/*")); }).join("\n");

  const wf = live("plugin/scripts/worker-driver.ts");

  const stepIdx = wf.search(/step = "ready-pool"/);

  const applyIdx = wf.search(/step = "apply-filters"/);

  if (stepIdx < 0 || applyIdx < 0 || applyIdx < stepIdx) {
  console.error("CAUSE=nongoal-moved -- the ready-pool/apply-filters dispatch
  step markers are gone or reordered on develop"); process.exit(1); }

  const window = wf.slice(stepIdx, applyIdx + 400);

  const excl = (window.match(/computeDispatchExclusion\(/g) || []).length;

  if (excl !== 1) { console.error("CAUSE=not-converged -- expected exactly 1
  computeDispatchExclusion call in the ready-pool..apply-filters window on
  develop, found " + excl); process.exit(1); }

  const legacy = (window.match(/inFlightTasks\(\)/g) || []).length;

  if (legacy > 0) { console.error("CAUSE=not-converged -- the legacy
  inFlightTasks() closure is still called " + legacy + " time(s) inside the
  dispatch window on develop"); process.exit(1); }

  ' || { echo "CAUSE=window-scan-red -- the scan above printed the specific
  CAUSE" >&2; exit 1; }

  node --no-warnings --experimental-strip-types --test
  plugin/test/driver-filters.test.mjs > /tmp/goal036-ac361fix-df.txt 2>&1 || {
  echo "CAUSE=post-merge-test-regression -- driver-filters.test.mjs red on
  develop, see /tmp/goal036-ac361fix-df.txt" >&2; exit 1; }

  node --no-warnings --experimental-strip-types --test
  plugin/test/worker-driver.test.mjs > /tmp/goal036-ac361fix-wd.txt 2>&1 || {
  echo "CAUSE=post-merge-test-regression -- worker-driver.test.mjs red on
  develop, see /tmp/goal036-ac361fix-wd.txt (large file; re-gate with a bigger
  --timeout if this was a timeout, not a real failure)" >&2; exit 1; }

  echo "PASS: develop tip carries GOAL-036's slice -- the dispatch window reads
  exactly one computeDispatchExclusion result and calls the legacy
  inFlightTasks() closure zero times (measured on comment-stripped source, so a
  JSDoc line mentioning the literal cannot make this red), and both affected
  test files pass"
expect: develop 尖端重跑 AC-359 的结构检查通过（dispatch 窗口内恰 1 次 computeDispatchExclusion、0
  次旧 inFlightTasks()，按位置判定而非全文件字面量计数），且 driver-filters.test.mjs 与
  worker-driver.test.mjs 全绿；一行提到 inFlightTasks() 的 JSDoc 注释不会使它变红。
origin: 人裁定 2026-10-11：采纳接管 AC-361
activatedAt: 2026-10-10T19:43:53.625Z
statusLog:
  - at: 2026-10-10T19:43:53.625Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-10-10T19:47:22.090Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
supersedes:
  - AC-361
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-10T19:43:53.625Z
phase: post-merge
---
