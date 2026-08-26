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

- [x] AC1（能取假，非 god-object）：上述四项不被并入同一个 driver kind（B15/B17 驱动化，B16-C/B18 归语义面）；（⛔ 四项并入同一 kind ⇒ 假）。
- [x] AC2（能取假，语义不伪装机械）：B16-C 类 / B18 不被声称"已驱动化"而无 LLM 参与（把语义判断伪装成机械判断）；（⛔ 声称驱动化而无 LLM ⇒ 假）。
- [x] AC3（能取假，B15/B17 真驱动化）：B15（pool-quality-judge）调用方从 outer tick 换成 driver，B17（judgment-consumer-check）由 driver 跑——grep 到 driver 里的调用；（⛔ 仍 outer tick 手动跑 ⇒ 假）。

## Definition of Done

B15/B17 驱动化、B16-C/B18 明确归 AC145；AC1/AC2/AC3 全勾；无 god-object。

## Touches

- plugin/scripts/quality-gate-driver.ts（新增：质量把关例程型 driver，B15/B17 两条例程）
- plugin/scripts/driver-runtime.ts（quality kind 进 DRIVER_KINDS registry + DriverKind 类型）
- plugin/scripts/capability-catalog.sh（新脚本六表注册）
- plugin/test/quality-gate-driver.test.mjs（新增单测）
- plugin/test/driver-runtime.test.mjs（KNOWN_KINDS 断言补 quality）
- plugin/test/launch-settings.test.mjs（profiles.yml 新增 pool-judge role ⇒ role 计数 6→7）
- .gitignore（quality-driver 运行时态 gitignore）
- .quay/profiles.yml（pool-judge role）
- orchestration/orchestrator-tick-core.md（B15/B17 标退役 → driver 承接）
- plugin/loop/orchestrator-tick-core.md（双拷贝镜像，tick-core-drift-check 要求 byte-identical）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY scripts= 计数）
- tasks/gap-ac144-quality-gate-shape-separated-driver.md（自身）

## Invoke Evidence

**修后实跑（inner worktree）**：
- 单测 `plugin/test/quality-gate-driver.test.mjs`：14 pass / 0 fail（`node --experimental-strip-types --test`）。
- `plugin/test/driver-runtime.test.mjs`：15 pass / 0 fail（KNOWN_KINDS 断言补 quality）。
- `plugin/test/pool-quality-judge.test.mjs`：23 pass / 0 fail（orchestrator-tick-core 退役后 doc-contract AC3 仍绿）。
- `bash plugin/scripts/capability-catalog.sh --summary`：`287 scripts | 287 declared | 0 unclassified`（新脚本六表注册，AC1c 闸过）。
- `node plugin/scripts/verify-delivery-surface.ts --write-inventory`：`inventory_drift=0`（DELIVERY-INVENTORY scripts= 计数 bump）。

**B15/B17 驱动化 grep 取证（AC3）**：
```
$ grep -n "pool-quality-judge\|judgment-consumer-check" plugin/scripts/quality-gate-driver.ts
（defaultPoolQualityPlanArgv / runPoolQualityJudge / defaultJudgmentConsumerArgv / runJudgmentConsumerCheck
  四处调用 + aggregateVerdicts 单一聚合 import）

$ grep -c "已随 AC144 退役" orchestration/orchestrator-tick-core.md
（B15/B17 两条标退役 → driver 承接）
```
