---
id: gap-fix-scope-gate-release-not-persistent
title: fix-scope gate 的 load-sensitive release 是一次性 relaunch 非持久——relaunch
  后仍红，第二轮 suite-fix 越界修（第 9+ 例）
status: ready
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

gate 接对路径（`gap-fix-scope-gate-wired-to-wrong-path` 已 done）后**仍有持续性 gap**：journal 显示第一轮 suite-fix 走对了（`relaunched=True`，release 无 fix），但 relaunch 后 suite **又红**（load-sensitive 红持续），第二轮 suite-fix 不再走 release、直接越界修（`a76959c8` session-liveness teardown 第 9+ 例）。⇒ **gate 的 release 是一次性 relaunch，不是「持续 release」**——relaunch-fail 路径上第二轮转 fix，隔离重跑+释放形同虚设。

**修法方向**：gate 的 load-sensitive release 判定必须**幂等持久**——同一 load-sensitive 红无论 relaunch 几轮都 release，不得在某轮转成 fix。

## Acceptance Criteria

- [x] AC1: gate 的 load-sensitive release 幂等持久——同一红无论 relaunch 几轮都 release（不转 fix）。
- [x] AC2: 负控制落生产载体——真实 fan-in 撞 load-sensitive 红、relaunch 后仍红，第二轮 suite-fix 仍 release（零越界 fix）。
- [x] AC3: relaunch-fail 路径的越界 fix 计数归零。

## Definition of Done

- [ ] 一个 load-sensitive 红 relaunch 后仍红，第二轮 suite-fix 仍走 release、零越界 fix（真实输出，生产路径）——机制已落地并负控制测通（vm 实执行真实 workflow + 真实 bash 两轮 gate，releasedRounds 1→2 仍 release、零越界 fix），真实生产观察（真实全量 load-sensitive 红跨 relaunch 持续）须在落地后下一轮全量红中确认（待外部）

## Touches

- tasks/gap-fix-scope-gate-release-not-persistent.md（自身）
- plugin/workflows/fan-in-execute.js（release 持久化——relaunch-fail 路径仍 release）
- .claude/workflows/fan-in-execute.js（与 plugin/workflows 同步）
- plugin/test/fan-in-execute-paths.test.mjs（relaunch-fail 负控制）

## Evidence

实现（fan-in-execute.js 双拷贝，字节一致）：FIX_SCOPE_GATE 增加 `fix_scope_release` ledger
（`/tmp/fan-in-scope-release-<task>.json`），gate 的 node 分诊脚本把每个 load-sensitive 红按文件
累计 `releasedRounds`（读旧 ledger → +1 → 写回），跨 relaunch 轮次持久；内联 prompt 显式写
「releasedRounds ≥ 1 的 load-sensitive 红一律继续 release，⛔ 不得转 fix」。幂等持久 = 机制（ledger）
+ 指令（prompt）双保险。

scoped 测试（真实输出，exit 0）：
  `bash scripts/test.sh --for-task gap-fix-scope-gate-release-not-persistent --allow-thin`
  ✔ fix-scope release persistence wiring — relaunch-fail 2nd suite-fix prompt still carries the idempotent-release instruction
  ✔ fix-scope release persistence — relaunch-fail path: same load-sensitive red releases on BOTH rounds (releasedRounds increments, zero越界 fix)
  ℹ tests 60 · pass 60 · fail 0

负控制取假（能取假，非恒绿）：临时删 ledger 读（FALSIFY-TEMP）⇒ 同一测试红——
  `AssertionError: round 2: ledger persisted ⇒ releasedRounds increments to 2 (NOT reset to 1) — actual 1, expected 2`
  （改回后恢复绿；FALSIFY-TEMP 已清除，双拷贝 `cmp` 一致）
