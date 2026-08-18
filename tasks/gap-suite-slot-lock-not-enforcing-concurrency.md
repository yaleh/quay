---
id: gap-suite-slot-lock-not-enforcing-concurrency
title: "S=2 槽机制未生效——4 个 suite 并发跑（应限 2），full-suite.lock.0/.1 被同一组进程同时持有（排他性失效）"
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

SSOT 层 2（`gap-suite-concurrency-ff-gate-and-slot-ssot`，done——槽数由 S 生成）落地后，S=2 应限 2 个并发 suite（槽 `.0`/`.1` 排他），但实测 **4 个 suite 并发跑**（inner 核实 distinct worktree：closure-skips / full-suite-state / git-history-counts / git-history-route，4 个 `bash scripts/test.sh` PID）。`full-suite.lock.0` 与 `.1` 被同一组 7 进程（606544/1641984/2709977/2821100/3343922/3343927/3412440）**同时持有**——槽排他性失效（flock 非独占，或 slot 获取/等待逻辑错）。

**后果链（本轮实证）**：4 并发 suite → 16 核 2x 超订 → 负载敏感测试（session-liveness / test-isolation，均未标记族）高负载下红 → KNOWN-LOAD-SENSITIVE 放行机制又因未标记不可用（`load-sensitive-release-check` 报「release NOT permitted」）→ fan-in 卡死（dod-check-timing needs-human）。**修槽机制是当下最该先做的**——负载降下来，这两个未标记文件大概率不再红，fan-in 才能干净 land。

与 lane-control（S=2→1 的 policy 变更）**不同**：这是 S=2 本应限 2 却没限住（bug），不是改默认值。

## Acceptance Criteria

- [x] AC1: 修复 suite slot 获取的排他性——S=2 时并发 suite 数 ≤2（槽 `.0`/`.1` 排他，一个进程持一个槽，其余等待）。
- [x] AC2: 负控制——4 个 fan-in 同时跑时，实测并发 `scripts/test.sh` suite 数 = 2（非 4），2 个等待。
- [x] AC3: 行为层不变量加「运行时并发 suite 数 ≤ S」检查（`suite-slot-ssot-check.ts` 或新增），能取假（注入 4 并发 ⇒ 红）。

## Definition of Done

- [ ] S=2 下 4 个 fan-in 同时跑，实测并发 suite 数 = 2（非 4）、槽排他生效、行为层不变量检查绿（真实输出，非 fixture）。（待外部——需 4 个真实 fan-in 同时跑）

## Touches

- tasks/gap-suite-slot-lock-not-enforcing-concurrency.md（自身）
- plugin/scripts/suite-lock-slots.ts（槽唯一实现——排他性修复）
- plugin/scripts/suite-slot-lib.sh（bash 侧槽实现）
- scripts/test.sh（full_suite_lock_acquire/release 排他）
- plugin/scripts/suite-slot-ssot-check.ts（加「并发 suite 数 ≤ S」不变量）
- plugin/test/suite-slot-ssot-check.test.mjs（I5 行为层排他性单测）

## Test-Files

- plugin/test/suite-slot-ssot-check.test.mjs（I5 行为层排他性：S+2 并发获取者 ⇒ 恰 S 个持槽 + 能取假）
- plugin/test/resource-gate.test.mjs（scripts/test.sh 单飞锁结构性 pin：acquire/release/flock/escape hatch）
