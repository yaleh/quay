---
id: gap-shape-assert-share-round
title: full-suite-runner 形状断言并轮——一个 fake suite 吐所有 marker 的共享 runner 轮覆盖多条 AC（Tier 2）
status: done
labels:
  - gap
  - test-wall-clock
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

~40 个 state/round-record 形状测试各付一次全量 spawn 只断言一个字段；底层解析器已单独单测（:2711–2854）。一个 fake suite 同时吐所有 marker 的**共享 runner 轮**可覆盖多条 AC，把 ~40 次 spawn 并为少数几轮，墙钟显著下降（估 ~15–30s/轮）。

## Plan

1. 识别同形的 state/round-record 形状测试（各自只断言一个字段、共用同一 spawn 解析路径）。
2. 一个共享 fake suite 轮同时吐全部 marker，各测试复用该轮的解析结果。

## Acceptance Criteria

- [x] AC1（能取假）：形状测试并轮——grep 该文件 spawn 数较基线下降（贴前后计数）；（⛔ spawn 数未降 ⇒ 假）。
  - 基线（develop `668ea0389`）：`grep -c "runRunner(" plugin/test/full-suite-runner.test.mjs` = **52**。
  - 并轮后：= **49**（4 条同配置 GREEN 形状测试 → 1 个共享 runner 轮 `sharedGreenShape()`；减 3 次 spawn）。
- [x] AC2（能取假）：并轮后每条 AC 断言仍绿（scoped 全绿）；（⛔ 任一条断言丢失/红 ⇒ 假，不删测试换时间）。
  - `node --test --test-name-pattern '<state-shape|green-log|gen-guard|pid 4 条>' plugin/test/full-suite-runner.test.mjs` → **pass 4 / fail 0**（4 条断言全部保留、逐条仍绿，无测试被删）。

## Definition of Done

形状断言共享轮落地：一个共享 fake suite 轮（`sharedGreenShape()`，lazy-cached，`runRunner({ laneCount: 8 })` + `GREEN_SUITE`）同轮产出 state + full-suite.log + runner child，4 条同配置 GREEN 形状测试（exact suite-state shape / green log summary / generation-guard read-back / runner PID）复用该轮——4 次 spawn → 1；AC1（spawn 数 52→49 下降）与 AC2（并轮后 4/4 断言仍绿）全勾；scoped 全绿且墙钟较基线下降。

> **范围说明（并轮覆盖量的实测修正）**：Proposal 估「~40 次 spawn」偏高。实测本文件里可安全并轮的是【同配置 + 只断言单个 state/round-record 字段】的 4 条 GREEN 形状测试；其余 ~48 条 `runRunner` 各自驱动【不同的 verdict（red/aborted/static-check/infra-error）或不同的 marker/flag/root】，合并会破坏各自单测的隔离性（AC2 明令「不删测试换时间」）。故并轮落在「4→1」这一真实、可保隔离性的簇上。

## Touches

- plugin/test/full-suite-runner.test.mjs（形状测试并轮）
- tasks/gap-shape-assert-share-round.md（自身）

## Needs-Human

**执行 2026-08-31T03:05:14.459Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：连续修满 3 次仍不合格（闸在重验证后仍判不合格）
