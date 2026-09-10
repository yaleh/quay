---
id: gap-suite-single-flight-lock-ab-remesure
title: suite 单飞锁 S=1 A/B 复测——38% 等锁 vs 33% 核利用率，旧结论可能过时
status: superseded
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

## Closure（2026-09-06，人裁定取消）

**结论：不做 A/B 复测，任务作废（superseded）。**

原前提（`.git/full-suite.lock.concurrency`=1 是压过代码默认值 2 的可疑遗留、可能对应过时的历史结论）已被后续证据推翻：

`gap-fan-in-workflow-lock-and-S1`（done, delivery-critical, 2026-08-26）基于 24 小时真实生产数据（52 个 suite / 28 个任务）做出了同一个 S 值的裁定，但依据是**正确性**而非吞吐：
- S=2 下 suite 本身 52/52 全绿，但 **ff-race 27 次，命中 96.4% 的任务**，46% 次数 / 62% 墙钟被整份作废（含 2 次升级为 needs-human）；
- 裁定：S=1 + fan-in workflow 锁——墙钟仅慢 7.7%（28×时长 vs 26×时长），但结构性消除 ff-race；
- 该裁定已把 S=1 写入代码默认值本身（`suite-slot-lib.sh` / `suite-lock-slots.ts` / `.claude/launch.settings.json` 2→1），且其 AC2 明确「suite 锁 S 改 1（fan-in 锁已串行化 fan-in 内的 suite）」——S=1 现在是 fan-in 锁设计的组成部分，不是可独立复原的旋钮。

⇒ 本任务想解的问题（S=1 是否为过时的吞吐妥协、该不该改回 2）已被一个更强的证据（真实生产数据、且是正确性而非吞吐维度）盖过；重新做 S=2 的 A/B 会重新引入已被结构性消除的 ff-race 风险，收益（吞吐，~7.7%）已知且小。人 2026-09-06 裁定取消，不再要求执行 AC1/AC2 原定的合成 A/B。

AC1/AC2 保持未勾选，如实记录——前提作废，非达成；DoD 中的 A/B 复测目标一并撤销。