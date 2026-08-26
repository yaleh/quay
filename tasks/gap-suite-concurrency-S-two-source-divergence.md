---
id: gap-suite-concurrency-S-two-source-divergence
title: suite 单飞锁「槽数 S」两套读取链分叉——锁槽数读 .concurrency 文件、并发公式只读 env，改一处不改另一处静默分叉（S=2 落地实证 laneCount 未减半 → 32 lane 超订）
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

suite 单飞锁的「槽数 S」在仓库里有**两套读取链**，优先级不同，改一处不改另一处就**静默分叉**，且无任何检查报出来。

**实测坐实（S=2 首批落地 #655/#656，manager 直接量）**：
```
concurrentSuiteSlots=2（锁并行生效，lock_wait 1860s→9s）
但 laneCount=16（lane 未减半到 8）
⇒ 2 suite × 16 lane = 32 > 16 nproc 超订（load 20.3 佐证）
```

**根因（读码核实）**：两套 S 读取链，优先级不同：
```
① 锁槽数   suite_slot_count（plugin/scripts/suite-slot-lib.sh）：
     seam → .git/full-suite.lock.concurrency 文件 → env QUAY_MAX_CONCURRENT_SUITES → default 2
② 并发公式 default_concurrency_formula（scripts/test.sh:482）：
     slots="${RESOURCE_GATE_CONCURRENT_SUITES:-${QUAY_MAX_CONCURRENT_SUITES:-2}}"
     seam → env QUAY_MAX_CONCURRENT_SUITES → default 2（⛔ 不读 .concurrency 文件）
```
manager 受命「S 设为 2」时只 `printf '2' > .concurrency`（改锁槽数①），没改 `.claude/launch.settings.json` 的 `QUAY_MAX_CONCURRENT_SUITES=1`（并发公式②读它）⇒ 锁并行(2) + lane 不减半(16)。

**⊢ suite-slot-lib.sh 头注释自陈「The two canons therefore agree under ANY env AND any .concurrency file」**——这个断言在 .concurrency 文件与 env 不一致时**是假的**（① 读文件、② 不读文件），正是「恒绿检查伪装成真保证」（硬规则 3b/4 同源）。

**人裁定**：应用**统一的配置文件机制**——两套读取链应读同一个 S 来源（`.concurrency` 文件），让 SSoT 承诺真正成立，而不是靠「手动改两个地方保持一致」。

**manager 临时补齐（非根治）**：`.claude/launch.settings.json` `QUAY_MAX_CONCURRENT_SUITES` 1→2，让两处暂时一致（在飞 worker 旧 env=1 的 suite 仍 cc=16，新 spawn 才读 env=2）。

## Plan

1. `default_concurrency_formula` 的 slots 读取优先级加入 `.concurrency` 文件层（对齐 `suite_slot_count`），或抽出单一 S 读取函数两处共用——「改一个文件」同时改锁槽数 + lane 公式，分叉结构上不可能。

## Acceptance Criteria

- [ ] AC1（能取假，两处读同一来源）：`default_concurrency_formula` 与 `suite_slot_count` 读同一个 S 来源（`.concurrency` 文件），改一个文件同时改锁槽数 + lane 公式；（⛔ 两处仍读不同来源 ⇒ 假）。
- [ ] AC2（能取假，负控制分叉消除）：只 `printf '2' > .concurrency`（不改 env），`concurrentSuiteSlots=2` 且 `laneCount` 减半（16→8），不再超订；（⛔ laneCount 仍 16 ⇒ 假）。

## Definition of Done

S 单一来源（.concurrency 文件）；AC1-AC2 全勾；改一个文件同时生效锁槽数 + lane 公式，分叉结构上不可能。

## Touches

- scripts/test.sh（default_concurrency_formula 读 .concurrency 文件）
- plugin/scripts/suite-slot-lib.sh（若抽共用 S 读取函数）
- plugin/test/（S 单一来源 + 只改文件负控制）
- tasks/gap-suite-concurrency-S-two-source-divergence.md（自身）
