---
id: gap-ac144-quality-gate-shape-separated-driver
title: AC144 质量把关按【形状】分开驱动化——B15/B17 驱动化，B16-C/B18 归语义面（⛔ 不得塞进 promotion-driver）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

「质量把关」不是一件事，一股脑并入 promotion-driver 会造 god-object。四形状分派：
- B15 pool 质量语义闸——已是 ADR-033「机械触发 + schema'd LLM judge」形态 ⇒ 现成模板，把调用方从 outer tick 换成 driver；
- B17 判据消费纪律——纯机械审计（judgment-consumer-check.ts）⇒ 直接驱动化；
- B16 冲突归因——A/B 类可机械（per-hunk 取并集）；C 类要读两边意图 ⇒ 保留语义面（归 AC145）；
- B18 止损义务——活场景判断 ⇒ 保留语义面（归 AC145）。

## Plan

B15/B17 落 driver（B15 换调用方、B17 直接机械驱动化）；B16-A/B 类机械化、B16-C 类 + B18 明确归 AC145（语义面 subagent），不在本任务驱动化。

## Acceptance Criteria

- [ ] AC1（能取假，非 god-object）：上述四项不被并入同一个 driver kind（B15/B17 驱动化，B16-C/B18 归语义面）；（⛔ 四项并入同一 kind ⇒ 假）。
- [ ] AC2（能取假，语义不伪装机械）：B16-C 类 / B18 不被声称"已驱动化"而无 LLM 参与（把语义判断伪装成机械判断）；（⛔ 声称驱动化而无 LLM ⇒ 假）。
- [ ] AC3（能取假，B15/B17 真驱动化）：B15（pool-quality-judge）调用方从 outer tick 换成 driver，B17（judgment-consumer-check）由 driver 跑——grep 到 driver 里的调用；（⛔ 仍 outer tick 手动跑 ⇒ 假）。

## Definition of Done

B15/B17 驱动化、B16-C/B18 明确归 AC145；AC1/AC2/AC3 全勾；无 god-object。

## Touches

- plugin/scripts/driver-runtime.ts / driver-*.ts（质量把关 kind）
- plugin/scripts/（B15/B17 调用方迁移）
- orchestration/manager-phase-goal.md（B16-C/B18 归属指针，如需）
- tasks/gap-ac144-quality-gate-shape-separated-driver.md（自身）
