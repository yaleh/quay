---
id: gap-slot-refill-discards-assemblebatch-deferred
title: "slot-refill 丢弃 assembleBatch deferred——「no dispatchable candidate passes step-4」误报（shared-state/learning/non-capability-growth 拒绝原因不可见）"
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`slot-refill.ts:859` 只解构 assembleBatch 的 `batch`，丢弃其 `deferred`（真实拒绝原因）：`const { batch } = assembleBatch(cliqueCandidates, { expand });`。后果：一个 candidate 通过全部 step-4（touches-resolve/deps/disjoint/self-touch/not-yet-flipped/landed 全过）但被 assembleBatch 拒（`touches shared exp5 state` / `learning-type` / `non-capability-growth`）时，slot-refill 输出 `recommended=[]` + `deferred=[]` + `no_refill_reason="no dispatchable candidate passes step-4 checks"`——**误报**（candidate 过了 step-4，只是被 assembleBatch 序列化），且真实原因不可见。

实证（2026-08-18，lane-control 定位全程）：`gap-ac101-lane-concurrency-control-round` 的 `## Touches` 含 `experiments/quay-perpetual-stream/**`，命中 SHARED_STATE_PATHS → assembleBatch 判「touches shared exp5 state — must serialize」→ batch 空；而 slot-refill 的 `deferred` 为空（step-4 无一失败），`no_refill_reason` 却报「no dispatchable candidate passes step-4」。排查者被迫逐条手测 step-4 才发现真因——一轮本可一条命令读到的原因被隐藏。

## Acceptance Criteria

- [ ] AC1: slot-refill 输出把 assembleBatch 的 `deferred`（拒绝原因）并入可见面（并入 `deferred` 或新增独立字段），使 shared-state/learning-type/non-capability-growth 三类拒绝各带可见 reason。
- [ ] AC2: `no_refill_reason` 在「candidate 过 step-4 但被 assembleBatch 拒」时不再报「no dispatchable candidate passes step-4」——改为报真实拒绝面（或区分「step-4 空」与「assembleBatch 空」两种空 recommended）。
- [ ] AC3: 负控制——一个 `## Touches` 命中 SHARED_STATE_PATHS 的 ready task，slot-refill 输出可读到「touches shared exp5 state」reason（非 `deferred=[]` + 误导 no_refill_reason）。

## Definition of Done

- [ ] 构造一个 shared-state-touch ready task 跑 slot-refill，输出直接可读其 assembleBatch 拒绝原因（真实输出，非 fixture），且不再报误导性「no dispatchable candidate passes step-4」。

## Touches

- tasks/gap-slot-refill-discards-assemblebatch-deferred.md（自身）
- plugin/scripts/slot-refill.ts（解构 assembleBatch deferred 并并入输出）
- plugin/test/slot-refill.test.mjs（测试：assembleBatch 拒绝面可见）
