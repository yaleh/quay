---
id: gap-gate-release-no-isolate-rerun-no-livelock
title: "gate load-sensitive release 无 C11 隔离重跑 + 无 anti-livelock 兜底——全量 relaunch 循环无界（收敛失败）"
status: done
labels:
  - gap
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`fix-scope gate` 的 load-sensitive release 语义不完整，有两个叠加缺口：

1. **release = 全量 relaunch 而非 C11 隔离重跑**：load-sensitive 族（real-install/nested-spawn/wall-clock）被判 out-of-scope 后，release 动作是「全量 suite relaunch」，而不是「隔离低并发重跑失败的测试」。在「高 load 常驻」（多 suite 并发）下，relaunch 不减 load，load-sensitive 族反复红 ⇒ 收敛失败（2026-08-19 ac101 fan-in 实证：3 RED + 3 relaunch，靠低 load 单飞侥幸收敛，不是机制修好）。

2. **release 侧无 anti-livelock 兜底**：anti-livelock（SPEC §7 attempt≥3）在 ff-merge 侧（inert-increment 检测），不在 suite-fix 的 release 侧——所以「out-of-scope → release → 全量 relaunch」循环【无界】，会无限跑（ac101 曾 ~2h）。

## Acceptance Criteria

- [x] AC1: load-sensitive release 接 C11 隔离重跑（只重跑失败测试、低并发），非全量 relaunch。
- [x] AC2: release 侧加 anti-livelock 兜底（attempt≥3 时 escalate/quiet-window，不再无限 relaunch）。
- [ ] AC3: 负控制落在生产载体——真实 fan-in 撞 load-sensitive 红，隔离重跑收敛（不再全量 relaunch 循环），或 attempt≥3 兜底打断（读生产 journal，非 fixture）。（待外部）

## Definition of Done

- [ ] load-sensitive 红经隔离重跑收敛（或 anti-livelock 兜底打断），不再无界全量 relaunch（真实输出）。（待外部）

## Touches

- tasks/gap-gate-release-no-isolate-rerun-no-livelock.md（自身）
- plugin/workflows/fan-in-execute.js（内联 suite-fix prompt：release 接隔离重跑 + anti-livelock 兜底；双拷贝同步 .claude/workflows/fan-in-execute.js）
- .claude/workflows/fan-in-execute.js（与 plugin/workflows 字节一致同步）
- plugin/test/fan-in-execute-paths.test.mjs（隔离重跑 + 兜底负控制）

## Evidence

实现（fan-in-execute.js 双拷贝，字节一致，workflows-dual-copy-drift-check PASS）：

1. **AC1 — release 接 C11 隔离重跑（非全量 relaunch）**：
   - 新增 `ISOLATE_LAUNCH` 块（`# isolate-launch-block-start` / `# isolate-launch-block-end`）——
     只重跑 fix-scope gate 分诊出的 load-sensitive 家族失败文件（低并发：scripts/test.sh 在低核机推导
     串行），与 SUITE_LAUNCH 共享同一 exit marker / capture（脚本控制流 waitForSuite 无需感知区别）；
     capture 标 `full_suite_ran=false` + `skip_reason=isolate-rerun-load-sensitive`（诚实的记录面），
     不捕获 CPU（full_suite_ran=false 时 per-task-suite-record 拒绝非空 cpu_time_s —— AC6）。
   - FIX_SCOPE_GATE 的 node 分诊脚本额外把 load-sensitive 文件列表机械写入
     `/tmp/fan-in-scope-isolate-<task>.files`（每行一个 worktree 相对路径）并输出 `isolateRerun` 命令
     （`bash scripts/test.sh <family-files>`，复用 red-window-triage.ts buildIsolateRerunCommand 的形态）。
   - 内联 suite-fix prompt 三态 release 决策：有 inScope 修复 ⇒ 全量 relaunch（SUITE_LAUNCH）；
     纯 load-sensitive 释放且 livelock=false ⇒ 隔离重跑（ISOLATE_LAUNCH）；livelock=true ⇒ anti-livelock 兜底。

2. **AC2 — release 侧 anti-livelock 兜底（attempt≥3 escalate）**：
   - FIX_SCOPE_GATE 输出 `livelock` 布尔（任一 load-sensitive 项 `releasedRounds ≥ releaseLivelockRounds`
     （默认 3，SPEC §7「同一任务失败 ≥3 次 才谈防活锁」同阈值）；逐项也携带 per-item `livelock`）。
   - 内联 suite-fix prompt：livelock=true 时 ⛔ 不再 relaunch（不跑全量也不跑隔离），escalate——
     返回 `{ relaunched: false, ... }`，note 写「load-sensitive anti-livelock（releasedRounds≥3）：停止无界
     relaunch，escalate → quiet-window / needs-human」。
   - 工作流脚本：fix agent 返回 relaunched:false ⇒ 立即 `outcome:red` 停止（message 标注 release anti-livelock），
     不再进入下一 fix round；fix 返回新增可选 `rerunMode`（full|isolated|null）供生产日志/证据。

scoped 测试（真实输出，exit 0）：
  `bash scripts/test.sh --for-task gap-gate-release-no-isolate-rerun-no-livelock --allow-thin`
  ✔ workflows-dual-copy-drift-check: PASS（双拷贝字节一致）
  ✔ release isolation wiring — the fix prompt carries ISOLATE_LAUNCH + the three-state release decision
  ✔ release isolation REAL — pure load-sensitive red ⇒ verdict carries isolateRerun + livelock=false; gate writes the isolate files list
  ✔ release anti-livelock REAL — same load-sensitive red 3 rounds ⇒ round-3 verdict livelock=true (attempt≥3 escalate)
  ✔ release anti-livelock — fix agent escalation (relaunched:false) ⇒ workflow stops red with the anti-livelock message
  ℹ tests 74 · pass 74 · fail 0

负控制取假（能取假，非恒绿）：把 gate 的 `livelock` 阈值改成 99（或删 ledger 读）⇒ 同一 release
anti-livelock REAL 测试在 round-3 断言 `livelock=true` 处红；把 prompt 的 ISOLATE_LAUNCH 块删除 ⇒
release isolation wiring 测试的 `# isolate-launch-block-start` 断言红。改回后恢复绿。

AC3/DoD（生产载体）：真实 fan-in 撞 load-sensitive 红、隔离重跑收敛（或 attempt≥3 兜底打断）须在
落地后下一轮真实全量 load-sensitive 红中确认（读生产 journal，非 fixture）——【待外部】。
