---
id: gap-lane-formula-ignores-phase-overlap-concurrency
title: "lane 公式分母算漏「阶段间并发」——overlap 开启后 serial+lowconc 并行，单 suite 重叠窗口 16 lane 超公式假设的 8"
status: ready
labels:
  - gap
  - performance
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

lane 公式 `max(1, floor(nproc×oversub/S))`（本机 16×1/2=8，main/serial/lowconc 全 8）的正当性依据是 `scripts/test.sh:969-970` 注释「纯计算下 S 个 suite 各拿 nproc×oversub/S ⇒ **Σ lane ≤ nproc×oversub 结构上不可能超**」。**但 QUAY_PHASE_OVERLAP 自 2026-08-16 默认开启后这句不成立**——`test.sh:1580-1586` 实证 serial 与 lowconc **并行跑、各用自己的 concurrency**（日志 `serial conc=8, lowconc conc=8`）⇒ 重叠窗口内**单个 suite 就在跑 16 条 lane**。

- 公式设计假设：单 suite 同时只有一个阶段 ⇒ 峰值 8，两 suite 共 16=nproc，不超。
- 实际：单 suite 重叠窗口峰值 **16**；S=2 时两 suite 可达 **32 lane = nproc 的 2 倍**。叠上实测 steal 27–56%（有效核约 11）⇒ 重叠窗口单 suite 已 **45% 超订**。

**⊢ 自洽证据**：manager 测得「一路 suite 独跑吃 8.7 核」——只跑 main(8 lane) 不该超 8，8.7 正是 serial+lowconc 重叠把它推上去的。数据与机制自洽。

**对 lane-control 的直接影响**（见该任务体补的判据）：若只改 S=1 不管 overlap，重叠窗口会变 16+16=32 lane，超订比现在更严重。

## Acceptance Criteria

- [x] AC1: lane 公式分母计入并发阶段数——overlap 开启时 serial/lowconc 各取半（或分母 S×并发阶段数），使重叠窗口 Σ lane ≤ nproc×oversub 恒成立。
- [x] AC2: 取假判据——`test.sh:969-970` 那句不变式现在能被一条命令证否（overlap 窗口 Σ concurrency > nproc×oversub），修复后该命令转真（不变式恢复为可守）。
- [x] AC3: 负控制——overlap 关闭时公式行为不变（单阶段峰值仍 8），只 overlap 开启路径改。

## Definition of Done

- [x] overlap 开启时重叠窗口 Σ lane ≤ nproc×oversub（真实输出，`test.sh:969-970` 不变式恢复可守），overlap 关闭时不变（scoped 绿）。

## Evidence

**实现**（分母计入并发阶段数 P）：
- `scripts/test.sh` `serial_lowconc_host_default()` 分母由 `S` 改为 `S×P`（`P=2` when `QUAY_PHASE_OVERLAP` 非 `0`，`P=1` when `0`）；`default_concurrency_formula` 内 `:969-970` 不变式注释补阶段间并发说明。
- `plugin/scripts/full-suite-runner.ts` 新增 `concurrentPhaseCount()`（读 `QUAY_PHASE_OVERLAP`，默认 1=overlap on ⇒ 2）；`DEFAULT_SERIAL_CONCURRENCY` / `DEFAULT_LOWCONC_CONCURRENCY` 分母改 `concurrentSuiteSlots() × concurrentPhaseCount()`。

**AC1/AC3 实测**（nproc=16, S=2）：
```
serial_lowconc_host_default: overlap=1 → 4（原 8，取半）；overlap=0 → 8（不变）
runner DEFAULT_SERIAL/LOWCONC:   overlap=1 → 4；overlap=0 → 8
```

**AC2 不变式一条命令（重叠窗口 Σ lane vs nproc×oversub）**：
```
overlap=1 phase_budget=4 S×(serial+lowconc)=16 cap=16 → ≤ (HOLDS)   # 修复前 S×(8+8)=32 > 16 证否
overlap=0 phase_budget=8 S×phase=16           cap=16 → ≤ (HOLDS)
```
负控制 `resource-gate.test.mjs`「判据2 NEGATIVE CONTROL」证 checker 能取假（旧 16+8=24 > 16 红）。

**测试**：
- `scripts/test.sh --for-task gap-lane-formula-ignores-phase-overlap-concurrency`：scoped 静态门全 PASS（concurrency-literal 0 violations / suite-slot-ssot 0 RED / test-impl-census 422 clean）+ 204 tests 0 fail，EXIT=0。
- 直跑 `node --test plugin/test/resource-gate.test.mjs` 53/53、`plugin/test/full-suite-runner.test.mjs` 151/151。

## Touches

- tasks/gap-lane-formula-ignores-phase-overlap-concurrency.md（自身）
- scripts/test.sh（lane 公式分母 + `:969-970` 不变式）
- plugin/scripts/full-suite-runner.ts（defaultLaneCount / serial_lowconc_host_default 同一公式）
- plugin/test/full-suite-runner.test.mjs（overlap 开启/关闭双路径）
- plugin/test/resource-gate.test.mjs（phaseConcurrencyDefault / 判据4 直接==runner 双路径同步）
