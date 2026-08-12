---
id: gap-cold-start-skill-has-no-recovery-branch
title: "quay:cold-start only knows how to start fresh — it has no branch for recovering a workspace with mid-flight state after a crash, which is what actually happened twice tonight"
status: todo
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

- [ ] AC1: precondition check correctly routes to the recovery branch when mid-flight state
      exists, and to the fresh-start branch when it doesn't (both directions demonstrated, real
      fixture or real repo state, output pasted)
- [ ] AC2: all three state classes (unclosed merged task, orphaned worktree/branch, ghost
      telemetry) are detected using existing tools, not new ones — grep the diff for zero new
      detection logic beyond wiring
- [ ] AC3: recovery branch, once it converges, passes the SAME AC8c six-key checklist as
      fresh-start — no separate acceptance criteria invented
- [ ] AC4: negative control — a recovery run against a genuinely clean workspace (no mid-flight
      state) takes the fresh-start branch, not the recovery branch (must not false-positive)
- [ ] AC5: tests use `node:test`, `// @test-group product` (skill/operational infra)

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

- plugin/skills/cold-start/SKILL.md
- plugin/test/cold-start-skill.test.mjs

## Dispatch review

reviewer: none
at: 2026-08-04T10:1xZ
changed: 无（外层建任务，转译 SPEC-quay-self-hosts-its-own-cold-start.md 的 SH1；未经正式闸口审查）
