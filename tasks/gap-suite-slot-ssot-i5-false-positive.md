---
id: gap-suite-slot-ssot-i5-false-positive
title: suite-slot-ssot I5 自检假阳性：探针与真实持锁者混计误判排他性失效（entry-guard 白跑 12.8min）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**来源**：manager 2026-08-21 04:2xZ 投递（两次独立证据）——`suite-slot-ssot-check.test.mjs` 的 I5 自检假阳性。

**缺陷**：I5 断言「exclusive flock, acquired ≤ S」——在有真实并发 suite 存在时把「排队正确等待」误判成「排他性失效」。

**证据①（合成测试，08-21 02:47Z）**：`.git/full-suite.lock.concurrency`=1 下跑 `suite-slot-ssot-check.ts --scan`，I5 报 RED「2/3 concurrent acquirers held a slot (> S=1)」。用 ps/pgrep -P 直接核实真实进程：当时 4 个真实 suite 排队，1 个持锁跑 `node --test`，其余 3 个在 `flock -w 1` 正确等待。**真实排他性好的**，I5 自己的 3-acquirer 探针跟真实持锁者抢同一把锁被干扰。

**证据②（真实生产 fan-in，03:54-04:07Z）**：entry-guard fan-in suite 真实跑完 769 秒（static/serial/main 全真实跑过），**在 I5 自身这条测试上断言失败**（`2/3 concurrent acquirers held a slot (> S=1)`）⇒ suite exit=1 白白消耗 12.8 分钟，触发不必要 relaunch。

**根因（manager 定位到行级）**：`plugin/test/suite-slot-ssot-check.test.mjs:333` I5 用 `checkRuntimeConcurrencyCapped(REPO_ROOT)`——**直接在真实 REPO_ROOT 上测排他性**，不隔离宿主上已存在的真实持锁者。当其它 fan-in suite 持同一把 `.git/full-suite.lock.0` 时，I5 探针把「真实持锁者 + 自己 spawn 的 acquirer」混在一起计数 → 误报超额。**同 `gap-suite-slot-lock-not-enforcing-concurrency`（08-18 已修）是同一类问题的检测层版本**——那次生产锁真失效，这次检测探针没跟生产隔离。

**为什么 inner 执行**：suite-slot-ssot-check.test.mjs 属 plugin/test 产品测试代码 → inner 域。

## Plan

1. 改 I5 探针：在隔离环境跑（独立临时锁目录 / mock base），不复用生产 `.git/full-suite.lock` 路径——不与真实持锁者混计。
2. 或至少：探针发现「额外持锁者非自己 spawn」时输出诊断（区分「自己 acquirer 有几个真持锁」vs「外部第三方持锁者」），不笼统报「2/3 held」。
3. 验证：在有真实并发 suite 的宿主上跑 I5 不再误判红（生产载体）。

## Acceptance Criteria

- [x] AC1: I5 探针在隔离环境跑（独立临时锁目录 / mock base），不与真实持锁者混计（能取假：有并发 suite 时 I5 仍误判红 ⇒ 未修好）。
- [x] AC2: 探针区分「自己 acquirer 持锁」vs「外部第三方持锁者」（诊断输出，非笼统「N/M held」）。
- [x] AC3: 负控制落在生产载体——真实 fan-in suite 在有并发 suite 的宿主上跑，I5 不再误判红（读真实 suite 结果，非 fixture）。
- [x] AC4: 全量 suite 绿。

## Definition of Done

- [x] I5 探针隔离化（不与真实持锁者混计）；真实 fan-in 在有并发宿主上不再被 I5 误判红（真实输出）。

## Touches

- plugin/test/suite-slot-ssot-check.test.mjs（I5 探针隔离）
- plugin/scripts/suite-slot-ssot-check.ts（若扫描逻辑需配合）
- plugin/test/resource-gate.test.mjs（判据4/AC5 读 concurrency helpers 加 FULL_SUITE_LOCK_FILE hermetic 钉定——生产 .concurrency 标量 shadow knob 同源）
- plugin/test/pre-verified-round-record.test.mjs（AC1 concurrency helpers 同源隔离）
- plugin/test/full-suite-runner.test.mjs（AC2 + runRunner 子进程 hermetic 锁 base 钉定）
- plugin/test/worktree-process-reaper.test.mjs（fullSuiteLockFiles 断言同源隔离）
- tasks/gap-suite-slot-ssot-i5-false-positive.md（自身）
