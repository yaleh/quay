---
id: gap-fan-in-ac-precheck-before-suite
title: fan-in 前 AC 全勾 fail-fast 预检——未全勾直接拒翻跳过 suite，省注定无效的 9-11min/cycle
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

机械 fan-in 在 suite 前没有 AC 全勾预检——suite 跑完（~9-11min）才在 ac-gate 拒翻。已全勾预检应在 suite 前做（fail-fast）：未全勾直接拒翻重派、跳过 suite。实证 gap-execution-loop 08-30 两次 ac-gate 拒各耗 542s/684s 的注定无效 suite（AC 1/6，suite 全绿但 ac-gate 拒）。落点 worker-driver.ts:2398（suite）→ :2421（ac-gate）。

## Plan

worker-driver.ts 机械 fan-in 在 suite 前加 `isLandedCodeComplete`（或等价 AC 全勾判定）预检：未全勾直接 return red（step=ac-precheck，reason 带 checked/total），跳过 suite。

## Acceptance Criteria

- [x] AC1（能取假，fail-fast）：AC 未全勾时 fan-in 在 suite 前拒翻（step=ac-precheck，无 suite 运行记录）；（⛔ 仍跑 suite 再拒 ⇒ 假）。
- [x] AC2（能取假，负控制）：AC 全勾时正常进 suite（预检不误挡）。
- [x] AC3（能取假，单测）：worker-driver.test.mjs 断言「未全勾 → 预检拒、不 spawn suite」，改掉任一 ⇒ 红。

## Definition of Done

suite 前 AC 全勾预检落地；AC1-AC3 全勾；全量 suite 绿；ac-gate 拒不再耗注定无效的 suite。

## Touches

- plugin/scripts/worker-driver.ts（suite 前加 isLandedCodeComplete 预检）
- plugin/test/worker-driver.test.mjs（AC3 单测）
- tasks/gap-fan-in-ac-precheck-before-suite.md（自身）
