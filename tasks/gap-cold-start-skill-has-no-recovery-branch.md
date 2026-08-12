---
id: gap-cold-start-skill-has-no-recovery-branch
title: "quay:cold-start only knows how to start fresh — it has no branch for recovering a workspace with mid-flight state after a crash, which is what actually happened twice tonight"
status: ready
parent: gap-quay-has-never-self-hosted-its-own-cold-start
depends_on:
  - gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted
  - gap-retire-inner-state-one-observer-targets-by-parameter
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

Child of [[gap-quay-has-never-self-hosted-its-own-cold-start]] (SH1 in
`orchestration/SPEC-quay-self-hosts-its-own-cold-start.md`). Do not dispatch before
[[gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted]] and
[[gap-retire-inner-state-one-observer-targets-by-parameter]] have landed — those fix 2 of the
6 keys this task's new branch also has to satisfy.

`plugin/skills/cold-start/SKILL.md` has exactly one path: "mechanism not laid down → lay down →
mount → cron → drive → prove." Tonight's two real recoveries (documented, not hypothetical, in
`docs/analysis/two-oom-recoveries-compared.md`) both needed a fundamentally different thing: the
mechanism was ALREADY laid down, cron/monitors were already dead (session-scoped, died with the
crashed process), and there was real mid-flight state to resolve BEFORE any tick could safely
resume — merged-but-unclosed tasks, orphaned worktrees/branches, ghost telemetry `--task-start`
records with no matching `--task-end`, task `status:` fields drifted from what the code actually
shows. None of that is in the skill. Both recoveries did it by hand, from a manually-written
brief, because there was nowhere in the skill to point at.

## Chosen mechanism

Add a **recovery branch** to `quay:cold-start`, selected instead of the fresh-start branch when
the precondition check finds the mechanism already laid down AND at least one of:
- a `task/*` branch not reachable from `master` with telemetry showing `--task-start` and no
  matching `--task-end`
- `.workflow-events/*.jsonl` records whose `taskId` has no corresponding in-flight worktree
  (ghost telemetry)
- `task-status-drift-check.ts` reporting a status-drift suspect on a `task/*` branch that IS
  reachable from `master` (code landed, status field never followed)

Recovery-branch steps (converge to a trustworthy starting point, THEN enter the same tick loop
— not a parallel process):
1. Enumerate exactly the three checks above via existing tools (`task-status-drift-check.ts`,
   `fast-mode-telemetry.ts --report --json`, `git worktree list` + `git branch --list "task/*"`)
   — no new detection logic, reuse what's there
2. For each finding, resolve it (merged-but-unclosed → close properly with real evidence, per
   this session's own `gap-init-guesses-the-tmux-session...` fix as the worked example; orphaned
   worktree/branch → verify ancestor-of-master, remove if so; ghost telemetry → verify against
   real task state, delete the ghost record if the task is genuinely done/still-todo, never
   backfill a plausible-but-fabricated `--task-end`)
3. Only once all three checks come back clean does the recovery branch converge into the SAME
   AC8c six-key checklist the fresh-start branch uses — no second acceptance framework

**Not doing**: not writing a general-purpose "crash recovery" framework — scope this to the three
specific state classes both real recoveries actually hit tonight, not speculative ones.

## Acceptance Criteria

- [x] AC1: precondition check correctly routes to the recovery branch when mid-flight state
      exists, and to the fresh-start branch when it doesn't (both directions demonstrated, real
      fixture or real repo state, output pasted)
- [x] AC2: all three state classes (unclosed merged task, orphaned worktree/branch, ghost
      telemetry) are detected using existing tools, not new ones — grep the diff for zero new
      detection logic beyond wiring
- [x] AC3: recovery branch, once it converges, passes the SAME AC8c six-key checklist as
      fresh-start — no separate acceptance criteria invented
- [x] AC4: negative control — a recovery run against a genuinely clean workspace (no mid-flight
      state) takes the fresh-start branch, not the recovery branch (must not false-positive)
- [x] AC5: tests use `node:test`, `// @test-group product` (skill/operational infra)

## Definition of Done

- [ ] AC1/AC4 real-run outputs (both directions) pasted into this task body
- [ ] Full suite 2x green (`fail 0` and `cancelled 0`)

## Contract

measure   recovery_branch = `grep -c 'recovery' plugin/skills/cold-start/SKILL.md` 输出的计数（SKILL 中 recovery 分支提及数）
band      recovery_branch = ≥ 1（SKILL 含 recovery 分支）
invariant fresh_start_preserved = 1（fresh-start 分支仍在，recovery 分支不替代它）
invariant zero_new_detection = 1（recovery 分支复用既有工具，diff 无新检测逻辑）
invoke    `bash scripts/test.sh --for-task gap-cold-start-skill-has-no-recovery-branch`
control   scoped 门绿（fail 0 / cancelled 0）；AC1 双方向实跑输出贴任务体
resume    分支骨架 + 三状态类接线 + 负控制分步提交

## Touches

- tasks/gap-cold-start-skill-has-no-recovery-branch.md（自身：勾 AC + 贴证据）
- plugin/skills/cold-start/SKILL.md
- plugin/test/cold-start-recovery.test.mjs（recovery 分支用例，`// @test-group product` per AC5）
- plugin/test/cold-start-skill.test.mjs（fresh-start 既有 pins 保持绿，未改动）

## Dispatch review

reviewer: none
at: 2026-08-04T10:1xZ
changed: 无（外层建任务，转译 SPEC-quay-self-hosts-its-own-cold-start.md 的 SH1；未经正式闸口审查）

## Evidence

### Contract measure（worktree 内实跑）

- `recovery_branch = grep -c 'recovery' plugin/skills/cold-start/SKILL.md` → **4**（≥ 1）
- `fresh_start_preserved` → **1**：`### 1.`…`### 9.` 与 AC8c 七键表原样保留；recovery 是新加 `### 0b.` 分支，不替代 fresh-start
- `zero_new_detection` → **1**：`git diff` 只有 SKILL.md 文本接线（+48 行）与新增测试文件；recovery 分支只引用既有工具
  （`task-status-drift-check.ts`、`fast-mode-telemetry.ts --report --json` / `--reconcile`、`git worktree list`、
  `git branch --list "task/*"`、`git merge-base --is-ancestor`）——零新检测脚本
- scoped 门 `bash scripts/test.sh --for-task gap-cold-start-skill-has-no-recovery-branch` → **14 pass / 0 fail / 0 cancelled**
  （6 个新 recovery 用例 + 8 个既有 cold-start-skill 用例含 rehearsal）

### AC1/AC4 双方向实跑（真实 fixture，输出原样）

**Recovery 方向（mid-flight 状态存在 → recovery 分支）**：`git init` + `task/mid-flight-demo` 分支（含一个
不在 `integration` 上的提交）+ 一条真实 `--task-start`（无 `--task-end`）遥测记录；三个既有检查原样跑：

```
--- check 1a: task/* branches ---
  task/mid-flight-demo
--- check 1b: is task/mid-flight-demo reachable from integration? ---
NOT ancestor (MID-FLIGHT signal fires)
--- check 2: telemetry --report --json ---
inProgress: [{"taskId":"mid-flight-demo","runId":"fm-mid-flight-demo-1786507328083-ftwcts","startedAtMs":1786507328095,"startedAtMsUnreliable":false}]
orphaned: 0
--- check 3: task-status-drift-check.ts --stranded ---
stranded-branch-check: 1 STRANDED branch(es) — work is preserved on a branch NOT on master
  stranded: task/mid-flight-demo (has-commits, ? commit(s) ahead, ? lines, last commit 2026-08-12T04:02:07Z)
```

→ 检查 1（分支不在 landing ref 上）+ 检查 2（`inProgress` 含 mid-flight-demo，`--task-start` 无 `--task-end`）
+ 检查 3（stranded 报告 it）三条均触发 ⇒ **recovery 分支被选中**。

**Fresh-start 方向 / 负控制（genuinely clean workspace → fresh-start 分支，AC4 不误报）**：`git init` + 无
`task/*` 分支 + 无 `.workflow-events` + 0 个任务；三个既有检查原样跑：

```
--- check 1a: task/* branches (expect none) ---
(none)
--- check 2: telemetry --report --json (expect empty inProgress / orphaned) ---
inProgress: []
orphaned: 0
--- check 3: task-status-drift-check.ts --stranded + full scan ---
stranded-branch-check: no stranded worktree branches (all milestone/* and task/* branches are cleanly merged into master)
task-status-drift: no suspects among 0 tasks (todo/ready drift + done closed-without-work + done-reverse-drift + stranded-branch all clean)
```

→ 三条检查全部干净（无分支、无 inProgress、无 stranded/drift）⇒ **fresh-start 分支被选中**——负控制不误报（AC4）。

### 说明

- **AC3**：SKILL 现状的 AC8c 是七键（TOPOLOGY-IN-PLACE 后来加入），任务正文的「six-key」是建任务时的旧称；recovery
  分支收敛进**同一份** AC8c 清单（`SAME AC8c checklist` + `no second acceptance framework`），未发明第二套验收框架。
- **`--for-task` 非 thin**：原 Touches 只有 1/3 能解析到测试（thin）；新测试文件加入 Touches 后 2/4 = 0.5，selector 不再 thin，
  Contract 的 invoke 命令原样可跑。
- **测试文件分组**：AC5 要求 `@test-group product`，而既有 `cold-start-skill.test.mjs` 是负载敏感的 `lowconc`（含真实
  quay-init --loop rehearsal）；分组是文件级的，故 recovery 用例放在同目录的 `product` 组新文件
  `plugin/test/cold-start-recovery.test.mjs`，不破坏既有负载敏感路由。
- **DoD「Full suite 2x green」**：按 C1 只跑 scoped `--for-task` 选中集（绿），全量 2x 留待 fan-in 验证轮（scoped 门把全量静态
  检查 deferred 到全量门，未丢弃）。
