---
id: gap-ac207-e2e-producer-section-never-landed-on-develop
title: AC-207 的记录产出者（--ac207-e2e 段，201 行）12 轮从未落
  develop——机制半边与端到端自证半边捆在一个任务里，fan-in 的 all-or-nothing AC 闸让前者永远等后者
status: todo
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-207
---
## Proposal

**实测（2026-09-10 22:4xZ，位置判定，非关键词）**：

| 读法 | `--ac207-e2e` | `GOAL-009-AC-207` | `--target-launcher` |
|---|---|---|---|
| `git show develop:plugin/scripts/verify-deliver-coldstart.sh` | **0** | **0** | 8 |
| worktree `gap-ac207-e2e-target-driver-driven-real-commit-task-done` 的同一文件 | **5** | **5** | 8 |

⇒ **AC-207 记录的唯一产出者不在 develop 上**。它完整地躺在那个 worktree 里——而且**两半已经合齐了**（该 worktree 现同时有 e2e 段与 `--target-launcher`，任务体第 11 轮记的「两半分居」已被解决），只是**从未 fan-in**。分支相对 merge-base（`b13ddc6b`）只改两个文件：`verify-deliver-coldstart.sh` +201 行、`verify-deliver-coldstart.test.mjs` +11 行；develop 期间只动过该脚本 **2 次** ⇒ 合并面很小。

**为什么它落不了地——一个结构性死锁，不是某次失误（逐环已按位置核实）**：

1. 代码只能经机械 fan-in 落 develop；
2. fan-in 的 **ac-precheck 读 `checked===total`，未全勾直接拒翻**（`plugin/scripts/worker-driver.ts:1154` 逐字：「fan-in 的 ac-precheck（suite 前 fail-fast，读 `checked===total`）会因未全勾拒翻」）；
3. AC-207 任务的 AC2/AC3/AC5 要求**一次成功的跨机 e2e + 证据落进驱动方载体**；
4. 而那次 e2e 需要的产出者，正是这个落不了地的 201 行。

⇒ **机制半边（产出者）与自证半边（端到端证明）被捆在同一个任务里，all-or-nothing 的 AC 闸让前者永远等后者。** 该任务已循环 12 轮、零落地。

**第二个独立缺陷（同一任务，Touches 欠声明）**：该任务的 `## Touches` **只有它自己的任务文件一行**，而其 worktree 改的是 `plugin/scripts/verify-deliver-coldstart.sh` + `plugin/test/verify-deliver-coldstart.test.mjs` —— **201 行改动全部在声明足迹之外**。⇒ 即便 AC 全勾，scoped 门/Touches 纪律也拦得住它。

**为什么现在必须先解这条**（不是「顺手也做一下」）：正在实现的回传机件 `gap-third-party-evidence-no-transport-to-driving-repo-carrier` 的做法是 **scp `verify-deliver-coldstart.sh` 到远端执行再取回证据**——**scp 的是 develop 那一份**。若 develop 那份没有 e2e 段，回传机件做得再对，`GOAL-009-AC-207` 记录也**结构上产不出来**。⇒ 本条是回传机件真正生效的前置，不只是 AC-207 的前置。

**范围纪律**：本任务**只**把产出者搬上 develop，⛔ **不跑 e2e、不勾 AC-207 的 AC2/AC3/AC5、不碰载体**——那些仍归 `gap-ac207-e2e-target-driver-driven-real-commit-task-done`。本任务的每一条 AC 都在本机可验，无任何跨机/远程依赖。

## Plan

1. 在任务 worktree 里 `git merge develop`（分支落后 164 提交），冲突用 Edit 解——**合并纪律：两边各加各的，取并集**；⛔ 特别不要丢掉 develop 侧 selfcheck 条件列表里的 `&& [ "$tp_ok" = "1" ]`（任务体第 11 轮点名「这一处最容易漏」）。
2. 同步镜像副本 `packages/quay/plugin/scripts/verify-deliver-coldstart.sh`（`mirror-pair-drift-check` 会拦单边改）。
3. 跑 `--help` 与 `--selfcheck` 验语法与语义；跑该脚本的单测。
4. 落 develop。⛔ 不动 `--ac207-e2e` 段的行为逻辑——它已在 worktree 里验证过（AC-207 任务的 AC1/AC4 已勾并留有 selfcheck 正/负控制证据），本任务只负责把它搬过去，不重写。

## Acceptance Criteria

- [ ] AC1 产出者已在 develop（能取假）：`git show develop:plugin/scripts/verify-deliver-coldstart.sh | grep -c 'ac207-e2e'` ≥ 1 且 `| grep -c 'GOAL-009-AC-207'` ≥ 1；贴**改前**两个读数（各为 0）与**改后**两个读数。
- [ ] AC2 两半兼有（防合并时丢掉 develop 侧）：同一份 develop 文件里 `--target-launcher` 命中数 ≥ 8 **且** `--ac207-e2e` 命中数 ≥ 1；贴两个计数。
- [ ] AC3 最易漏的那一处保留：develop 侧 selfcheck 条件列表逐字含 `[ "$tp_ok" = "1" ]`；贴该行及上下各 2 行。
- [ ] AC4 脚本自检绿：`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` exit 0，且输出含 ac207-record 的正控制与两条负控制（`produced_by_driver=false` refused / `gate_events=0` refused）；贴三行。
- [ ] AC5 单测绿：`node --test plugin/test/verify-deliver-coldstart.test.mjs` exit 0；贴 pass/fail 计数。
- [ ] AC6 镜像无漂移：`node --no-warnings --experimental-strip-types plugin/scripts/mirror-pair-drift-check.ts --root .` exit 0。
- [ ] AC7 全量绿：`scripts/test.sh` 全量绿。

## Definition of Done

`git show develop:plugin/scripts/verify-deliver-coldstart.sh` 同时含 `--ac207-e2e` 段与 `--target-launcher` 三 flag，`--selfcheck` 绿且 ac207-record 的正/负控制齐全，镜像副本同步。⛔ 本任务**不**产生任何 `ac="GOAL-009-AC-207"` 生产记录，也**不**勾 AC-207 任务的任何 AC——它只保证「产出者在 develop 上存在且自检通过」，跑不跑得出记录是 AC-207 那条任务的事（硬规则 4 推论三：本条证明的是「能产出」，⛔ 不冒充「已产出」）。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- packages/quay/plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac207-e2e-producer-section-never-landed-on-develop.md
