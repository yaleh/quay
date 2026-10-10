---
id: AC-908
title: AC-361 的 post-merge 判据改为「按位置重跑 AC-359 的结构检查」：dispatch 窗口内恰一次
  computeDispatchExclusion、零次旧 inFlightTasks()（注释行不参与匹配），develop 尖端两个受影响测试文件全绿
status: draft
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
origin: 'criteria[2]=AC-361（active）本轮 verdict=fail，reason 逐字为
  `CAUSE=post-merge-regression -- worker-driver.ts still has 4 inFlightTasks()
  call(s) on develop, expected at most 1`；同一棵树上
  criteria[0]=AC-359（窗口内判据）verdict=pass。该 4
  个字面量命中里，plugin/scripts/worker-driver.ts:1666 是一行 JSDoc（`/** 本轮在飞的 task id（… =
  inFlightTasks() 的返回值）… */`）——grep -c 把散文当成了调用；三个真实调用点（:5229 在
  computeGoalBranchReading、:5269 writeRound、:5317
  writeErrorRound）都是同一个共享闭包（:5224）的**记录装配**消费者，位于 dispatch 决策之外。GOAL-036
  自己的记录（goals/GOAL-036-workerpool-在飞排除集合-inflight-retryexhausted-收敛到单一纯函数计算点-同一轮内两次.md
  的「范围」与「退出条件」）把本刀范围逐字限定为「在 step = \"ready-pool\" 之后…调用它恰一次…移除两处各自独立调用
  inFlightTasks() 的写法」，且 AC-361 自己的标题就写着「重跑 AC-359
  的结构检查」——全文件字面量计数与它自己声明的检查不一致，也与 GOAL-036 的范围不一致（按关键词而非按位置判定）。后果是结构性的：退出条件要求
  AC-359/360/361 全部 achieved，这条判据对正确实现恒红 ⇒ GOAL-036 无法关闭；timeSeries 的
  goal:AC-361:verdict 已连续 7 轮 mode=unchanged。执行面已存在——AC-361 的载体任务
  tasks/goal-036-merge-and-postmerge-verify.md 现为 status: ready，它的 worker
  会撞上这条误导性的红，若照字面去「修」develop 就可能去删记录的装配调用点（把记录面打坏）而不是修判据。因此本条不是新增一条新判据，而是用
  supersedes 声明「新判据接管 AC-361 的地面」；旧 AC 的 status 保持不变，退役它仍是人的决定。'
supersedes:
  - AC-361
---
