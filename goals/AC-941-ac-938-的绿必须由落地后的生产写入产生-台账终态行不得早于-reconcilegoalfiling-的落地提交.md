---
id: AC-941
title: AC-938 的绿必须由落地后的生产写入产生：台账终态行不得早于 reconcileGoalFiling 的落地提交
status: achieved
kind: criterion
goal: GOAL-914
criterion: "node --experimental-strip-types --input-type=module -e \"import fs
  from 'node:fs'; import { execSync } from 'node:child_process'; const mod =
  await import('./plugin/scripts/goal-driver.ts'); if (typeof
  mod.reconcileGoalFiling !== 'function') { console.error('workspace goal-driver
  has no ledger writer'); process.exit(1); } const rows =
  fs.readFileSync('.quay/goal-filing.jsonl','utf8').split('\\n').filter(Boolean\
  ).map(s=>JSON.parse(s)); const term =
  rows.filter(r=>r.state==='filed'||r.state==='not-filed'); if (term.length < 1)
  { console.error('no terminal goal-filing row'); process.exit(1); } const log =
  execSync('git log --format=%cI -S reconcileGoalFiling --
  plugin/scripts/goal-driver.ts',{encoding:'utf8'}).trim().split('\\n').filter(\
  Boolean); const land = log.length ? Date.parse(log[log.length-1]) : NaN; if
  (!Number.isFinite(land)) { console.error('writer symbol not yet committed to
  the workspace tree'); process.exit(1); } const fresh =
  term.filter(r=>Number.isFinite(Date.parse(r.at)) && Date.parse(r.at) > land);
  if (fresh.length < 1) { console.error(JSON.stringify({landedAt:new
  Date(land).toISOString(), terminal:term.map(r=>r.at)})); process.exit(1); }
  console.log(JSON.stringify({landedAt:new Date(land).toISOString(), fresh:
  fresh.length}));\""
expect: 台账里至少有一条 filed/not-filed 行的 at 晚于写入函数落地的那个提交 ⇒ AC-938
  的绿来自工作区树内的生产写入，而不是任务 worktree 一次证据跑留下的静态行（硬规则 4 推论三：N 只计实现落地之后的时间窗）
origin: readings.criteria 里 AC-938 的 criterion 只做两件事：断言 typeof
  reconcileGoalFiling==='function'，以及 `.quay/goal-filing.jsonl` 里已有一条
  filed/not-filed 行；它不建立两者之间的因果。同一轮 AC-934 verdict=pass（同一台账已有 filed 行）而 AC-938
  verdict=fail（写入方不在工作区树）⇒ 一旦函数落地，AC-938 会拿【实现之前】就存在的终态行变绿——正是 AC-938
  自身标题要排除的「一次证据跑留下的静态文件」。当前 `.quay/goal-filing.jsonl` 的唯一终态行
  at=2026-11-06T07:57:41.597Z 与
  tasks/gap-goal-filing-ledger-landing.md（status=ready，尚未落地）一致地表明该行早于实现。
activatedAt: 2026-11-06T12:22:33.334Z
statusLog:
  - at: 2026-11-06T12:22:33.334Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-11-06T13:10:47.287Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-11-06T12:22:33.334Z
---
