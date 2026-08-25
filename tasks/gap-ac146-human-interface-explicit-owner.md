---
id: gap-ac146-human-interface-explicit-owner
title: AC146 人机接口必须有【显式承接者】——needs-human 产生后人不读 transcript 就能从一个界面看到
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

取消 outer 后，到达人的通道只剩 `needs-human` 状态 + `escalations.md`；driver 不能 `AskUserQuestion`。该通道当前已在实际堵塞（manager 09:2xZ 直读：`.quay/promotion-outcome.jsonl` 里 `action="needs-human"` + `retry-cap-exhausted` 已 3 条，3 个真实任务打成 needs-human，没有任何界面主动让人看见，manager 巡检才发现）。

## Plan

落一个显式承接界面（web 页 / 文件 / 通知，形态落笔方定）：一条 `needs-human` 产生后，人**在不读任何 transcript 的前提下**能从一个可查界面看到它。

## Acceptance Criteria

- [ ] AC1（能取假，显式承接者）：一条 needs-human 产生后，人从不读 transcript 的界面（web/文件/通知）看到它；（⛔ 只能翻 transcript 或靠 manager 转述 ⇒ 假）。
- [ ] AC2（能取假，负控制）：造一条 needs-human（`.quay/promotion-outcome.jsonl` 已有 3 条现成样本），该界面须显示它；（⛔ 不显示 ⇒ 假）。

## Definition of Done

needs-human 显式承接界面落地；AC1/AC2 全勾；现有 3 条 needs-human 样本在该界面可见。

## Touches

- packages/quay/src/serve-needs-human.ts
- packages/quay/src/serve-handlers.ts
- packages/quay/src/serve-render.ts
- packages/quay/src/observation.ts
- packages/quay/test/serve-needs-human.test.mjs
- tasks/gap-ac146-human-interface-explicit-owner.md
