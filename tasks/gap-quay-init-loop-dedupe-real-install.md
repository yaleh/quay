---
id: gap-quay-init-loop-dedupe-real-install
title: "quay-init 族去重复真装——文件级 before 钩子 1 次真装 + 文件拷贝副本（不含 check-drift，已另案退休）"
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

`quay-init-loop-*` 系列测试文件内，多个 `test()` 各自独立调用 `runLoop(ws, src)` 从零做一次完整真实安装（`spawnSync` 真跑 `quay-init.sh --loop`，真实文件系统拷贝几十个衍生脚本）。单文件至少 4 次独立「从零真装」，是同族耗时大头（今晚统计该族单文件 395-525s，是当轮最慢文件）。该族测试自带 `@load-sensitive real-install` 注释，测试设计者已知「又慢又 flaky」，现有对策是「隔离降并发」，没动「减少重复安装次数」。

real-install 族单文件耗时 5 天涨 4-6 倍（measure-history.jsonl 887 条：driver 32s→271s、vendor 61s→425s），趋势真实。**问题不在「测得太真实」（这些测试保护真实缺陷类 delivery-surface 冻结不更新 + 数据完整性），在「重复测太多遍同一件昂贵的事」。**

## Acceptance Criteria

- [ ] AC1: 文件级只做 1 次真实 `quay-init.sh --loop`（`before` 钩子产出一份干净基线快照），每条用例用文件系统拷贝（远快于重新跑安装子进程）复制工作副本，在副本上做各自破坏性操作 + 验证。全文件从 4 次真装降到 1 次。
- [ ] AC2: 覆盖率不丢——每条用例仍验证真实 drift-check/upgrade 行为（只不再重复「装」这个前置），**不改 mock/fixture**。
- [ ] AC3: scoped 绿 + 单文件耗时显著下降 + flakiness 同步降（spawn 越少资源争抢越少，真实输出）。

## Definition of Done

- [ ] 单文件 4→1 次真装，耗时显著下降 + flakiness 降，覆盖率不丢（真实输出，非 mock）。

## Touches

- tasks/gap-quay-init-loop-dedupe-real-install.md（自身）
- plugin/test/quay-init-loop-core.test.mjs（before 钩子真装 + 文件拷贝）
- plugin/test/quay-init-loop-vendor.test.mjs（同上）
- plugin/test/quay-init-loop-runtime.test.mjs（同上）
- plugin/test/quay-init-loop-helpers.mjs（共享 fixture 手法复用）
