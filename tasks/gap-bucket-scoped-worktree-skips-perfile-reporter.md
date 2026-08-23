---
id: gap-bucket-scoped-worktree-skips-perfile-reporter
title: bucket-scoped worktree 执行路径不触发 per-file reporter（perFile/ceiling/floor_ms 生产 0 命中）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager wiring 审计（webui/test-detail 群组，gap-test-detail-perfile-duration-failed 的 AC1 生产验证失败）。

**现象（实测，⛔ 非推断）**：`gap-test-detail-perfile-duration-failed` 实现落地（`7affdd43`, 06:57:20Z）后，`.quay/verification-round.jsonl` 全部 **15 条真实生产 round，`perFile` 字段命中数=0**。**非本任务引入回归**：同一 reporter 的姊妹字段 `ceiling`/`floor_ms`（更早上线、理应已验证）在这 15 条里**同样 0 命中** ⇒ 当前生产实际走的「bucket-scoped worktree」执行路径本身就不触发 per-file reporter 输出流入 round 记录——环境性/更早就存在的缺口，本任务只是撞上同一个洞。

**影响**：`perFile`/`ceiling`/`floor_ms` 等 per-file 字段生产全空，任何读这些字段的判据/展示都拿不到数据（不只是 test-detail 这条，是全套 per-file 指标的共同载体）。

**范围扩大（manager 2026-08-23 实测，⛔ 比 perFile 更大）**：`verification-round.jsonl` 自 round 453 @ 12:54 起 **3h39min 零 suite 记录**，而期间至少 6 个 worker 跑到过 suite 阶段（有 suite log 为证，如 bucket-scoped 那条 10437 行的 AC6 断言）。⇒ 不是「perFile 字段缺失」，是**整条 round 记录都没写**——bucket-scoped worktree 执行路径的 suite 根本不写 round 记录，本缺口范围比原立案时以为的大。

## Plan

1. 定位 bucket-scoped worktree 执行路径为什么不触发 per-file reporter（大概率 `full-suite-runner.ts` 某 scope 分支跳过了逐文件输出收集）。

**定位结果（实测，非推断）**：不是 `full-suite-runner.ts` 的 scope 分支——是**整条执行路径绕过了它**。bucket-scoped worktree 的 fan-in 走 `fan-in-execute.js` 的 detached `bash scripts/test.sh --buckets <task>`（不经 `full-suite-runner.ts`），其 round 记录由 **`pre-verified-round-record.ts`**（`# preverified-round-block`，step 4.5）写入。该 writer 已从 `--suite-log` 解析 `__OVERHEAD__`/`__BUCKETS__`/node:test summary，但**从未解析 `measure-suite-reporter.mjs` 的 `__PERFILE__`/`__CEILING__` 行** ⇒ 最常用的 landing 路径上 `perFile`/`ceiling`/`floor_ms` 恒缺（实测 `.quay/verification-round.jsonl` 453 轮 `perFile` 0 命中、bucket 启用后的每一轮 `ceiling`/`floor_ms` 0 命中）。

**修**：`pre-verified-round-record.ts` 增加 `parsePerFile`（复用 `measure-trend-check.parsePerFileLines`，与 `full-suite-runner.ts` 同口径）+ `parseCeilingFloor`（同 `full-suite-runner.ts:2630` 的 `^__CEILING__` 正则），并把 `perFile`/`ceiling`/`floor_ms` 写入 round 记录（absent-field 契约同 `full-suite-runner.ts:3340-3349`）。单测 `plugin/test/pre-verified-round-record.test.mjs` 正/负控制各覆盖。

**生产验证口径**：本任务自己的 fan-in（step 4 跑 `--buckets`、step 4.5 用 worktree 内已修 writer 写 round）即第一条带 `perFile` 的生产 round——fan-in 的「满足后勾框」在 step 4.5 后核验 `.quay/verification-round.jsonl` 末行含 `perFile` 再勾 AC1。

## Acceptance Criteria

- [ ] AC1：定位 bucket-scoped 路径跳过 round 记录写入的 scope 分支，并修（或确认设计如此并文档化）；生产 `verification-round.jsonl` 恢复增长、`perFile`/`ceiling`/`floor_ms` 命中数不再恒 0（⛔ 整条 round 记录仍不写 ⇒ 假）。

## Definition of Done

- [ ] bucket-scoped 路径 per-file reporter 缺口定位 + 修 + 生产 round 出现 per-file 字段；AC1 全勾；land 到 develop。

## Retires

- 无

## Touches

- plugin/scripts/pre-verified-round-record.ts（per-file/ceiling/floor 解析 + 写入）
- plugin/test/pre-verified-round-record.test.mjs（test）
- tasks/gap-bucket-scoped-worktree-skips-perfile-reporter.md（自身）
