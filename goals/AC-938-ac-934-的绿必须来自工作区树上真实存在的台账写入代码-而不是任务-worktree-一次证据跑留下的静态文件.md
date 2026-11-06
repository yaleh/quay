---
id: AC-938
title: AC-934 的绿必须来自工作区树上真实存在的台账写入代码，而不是任务 worktree 一次证据跑留下的静态文件
status: active
kind: criterion
goal: GOAL-914
criterion: node --experimental-strip-types --input-type=module -e "import fs
  from 'node:fs'; import { reconcileGoalFiling } from
  './plugin/scripts/goal-driver.ts'; if (typeof reconcileGoalFiling !==
  'function') { console.error('workspace goal-driver has no ledger writer');
  process.exit(1) } const rows =
  fs.readFileSync('.quay/goal-filing.jsonl','utf8').split('\n').filter(Boolean).map(s=>JSON.parse(s));
  const term = rows.filter(r=>r.state==='filed'||r.state==='not-filed'); if
  (term.length < 1) { console.error('no terminal goal-filing row');
  process.exit(1) }
  console.log(JSON.stringify({writer:'present',terminal:term.length}));"
expect: 当且仅当工作区树里的 goal-driver 导出台账写入函数 reconcileGoalFiling，且
  .quay/goal-filing.jsonl 至少有一条终态行时退出 0；今天因为在工作区树上没有该导出而必然非零。
origin: readings 里 AC-934 是 status=achieved / verdict=pass（唯一非红
  AC），但它的真值来自一份没有被本工作区代码产出的文件：commit 840956f44（goal-filing 台账写入实现）只存在于分支
  task/gap-goal-driver-filing-ledger，`git merge-base --is-ancestor 840956f44
  develop` 为假，工作区树枝上 `reconcileGoalFiling` 零出现；而 `.quay/goal-filing.jsonl`（mtime
  2026-11-06T15:57:41+08:00，未入 git）里的 spawned/filed 两行被 worktree 内
  docs/evidence/2026-11-06-goal-filing-ledger.md 逐字抄录为「实现落地之后的 live 证据」，时间落在该
  worker 07:35–09:20Z 的会话内。也就是说：AC-934 的判据只读一个静态、未跟踪、由未落地分支的证据跑写的文件，既不能察觉生产
  goal-driver 从不写它，也会在清除 .quay/ 或换机时无代码变更地翻红（硬规则 4
  推论三的反例判据）。本条只声明替代关系；是否退役旧判据仍由人裁定。
activatedAt: 2026-11-06T11:02:28.369Z
statusLog:
  - at: 2026-11-06T11:02:28.369Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
supersedes:
  - AC-934
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-11-06T11:02:28.369Z
---
