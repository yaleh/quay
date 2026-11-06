---
id: gap-goal-driver-filing-throttle
title: goal-driver 立案节流：每 AC 冷却与日上限，用台账算 lastFiledAt
status: ready
labels:
  - gap
  - goal-driver
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-goal-driver-filing-ledger
goal_ac: AC-934
---
## Proposal

`workable` 缺口（关联任务全 done 而 AC 仍假）每轮都可以再立案，只有每轮全局 `spawn_cap=3`，没有每 AC 的冷却。生产读数（消费者侧，仅作证据）：AC-090 名下 12 个任务、AC-109 6 个、AC-115 6 个，集中在 1–3 天；这不是"重复任务"，而是同一 AC 的重复立案成本。本任务用任务 1 的 `.quay/goal-filing.jsonl` 计算每个 AC 的 `lastFiledAt`，加每 AC 冷却与每天上限；超限写 `filing-throttled` 事实（具名、不静默）。

## Plan

1. 在 `driver-config.ts` 的 goal kind 增加 `filing: { perAcCooldownMs, perAcPerDay }`（从 `drivers.yml kinds.goal.filing` 解析；缺失取缺省，非法值 fail-closed）。
2. 在 `runGapSpawnPass` 的选取面加节流：对每个候选 AC，读台账的最近 `filed`/`not-filed` 时间；未过冷却或超日上限 ⇒ 不 spawn，写 `{ac, reason, nextEligibleAt}`。
3. 节流不改变缺口读数（`goal-gaps` 仍报原态），只改变"本轮是否立案"；被节流的条数进轮 fact。
4. 测试：冷却边界、日上限、缺省回落、非法配置、与 spawn_cap 的叠加。
5. live 证据：一次真实节流（或连续两次立案之间的冷却读数），写进证据文档。

## AC

- [x] `node --test plugin/test/goal-driver.test.mjs plugin/test/driver-config.test.mjs` 退出码 0。
- [x] `drivers.yml kinds.goal.filing.perAcCooldownMs/perAcPerDay` 可配置；缺失取缺省，非法值 fail-closed。
- [x] 同一 AC 在上次立案后未过冷却时不再 spawn，轮 fact 出现 `filing-throttled` 行（含 `nextEligibleAt`）。
- [x] 负控：冷却已过 + 未超日上限 ⇒ 仍可立案；节流不得改变 `goal-gaps` 的状态取值。
- [x] live 证据：真实轮次中的一条节流读数或两次立案的间隔读数，逐字写入证据文档。

## DoD

真实交付物是 config 的 filing 键、goal-driver 的节流选取面与一份 live 证据。证据必须来自真实轮次（轮 fact 的 `filing-throttled` 行或两次立案的间隔），不能只用 fixture；负控必须证明冷却已过时仍能立案。全量 `bash scripts/test.sh` 绿。

## ADR-007 dark axis

- 该轴仍暗,理由:本任务只增加 goal-driver 的立案节流，不改变模块依赖图，未产生 L_D/L_G 数值读数。

## Touches

- plugin/scripts/goal-driver.ts
- plugin/scripts/driver-config.ts
- plugin/test/goal-driver.test.mjs
- plugin/test/driver-config.test.mjs
- docs/evidence/2026-11-06-goal-filing-throttle.md (new)
- tasks/gap-goal-driver-filing-throttle.md
