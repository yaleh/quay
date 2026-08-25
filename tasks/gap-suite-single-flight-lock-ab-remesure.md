---
id: gap-suite-single-flight-lock-ab-remesure
title: suite 单飞锁 S=1 A/B 复测——38% 等锁 vs 33% 核利用率，旧结论可能过时
status: todo
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

`.git/full-suite.lock.concurrency` = `1`（压代码默认 2，推测对应历史「2-slot 因 16 核争抢导致单轮变慢 ~2x」结论）。**代价已量化**（8h 34 轮）：带 `lock_wait_ms` 字段的 12 轮（全 full-bucket）总 12,983s 中 **4,937s（38%）纯等锁**；全 34 轮合计等锁占比 23%（4,937s/21,214s）。**但同批数据显示单 suite 独跑远未跑满机器**：`cpu_time_s` 换算均值 5.30/16 核（33%），`effective_parallelism` 均值 6.10/16（38%）——若 suite 本就吃不满机器，「2 并发会拖慢 2x」的历史结论在当前条件（LPT 已落地、worker cap 仍 5）下可能已不成立。⛔ 本任务只做 **A/B 复测**，不直接改 concurrency。

## Plan

受控 A/B：S=1 vs S=2，同 taskId / 同规模样本对照 makespan（用今天真实负载）——记录结果，产出 S 最优值结论。

## Acceptance Criteria

- [ ] AC1（能取假，A/B 执行）：S=1 vs S=2 各跑同规模样本，记录 makespan + lock_wait + cpu/parallelism 读数；（⛔ 未跑 A/B ⇒ 假）。
- [ ] AC2（能取假，结论产出）：产出 S 最优值结论（支持改则另立改配置任务，不支持则留 1 + 记录依据）；（⛔ 无结论 ⇒ 假）。

## Definition of Done

A/B 复测完成；AC1-2 全勾；S 最优值结论落记录（改不改 concurrency 另立任务）。

## Touches

- .quay/ 或测量产物（A/B 结果记录）
- tasks/gap-suite-single-flight-lock-ab-remesure.md（自身，结论落任务体 Evidence）