---
id: gap-not-evaluated-harness-third-state
title: NOT-EVALUATED 在 harness 层结构上无法兑现——run_checker 只有二值，exit 2 承载三种互不相容含义（硬规则 3b 架构级缺口）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

硬规则 3b（「读不懂输入时不得返回与合格同形的值」）在单个 checker 层有纪律，但 **harness 层只有二值**，第三态结构上兑现不了：
- `checker-cost-lib.sh run_checker` 把【任何非零】一律当 fail-closed RED（`|| _rc=$?` → `STATIC_CHECK_FAILED exit=...`），无第三态概念；
- `exit 2` 当前同时承载三种互不相容含义：
  - `spec-declaration-point-check.ts:33,179` — exit 2 = NOT-EVALUATED；
  - 另外 6 个 checker — exit 2 = usage/env error；
  - `fan-in-materialize` / `per-task-suite` / `inner-wakeup-heartbeat` — NOT-EVALUATED = exit 0 + 一个 JSON 字段（harness 根本看不见）。

⇒ spec-declaration-point 的「无法评估」会把套件判红；另三个的「无法评估」是绿色 + 一个 harness 看不见的字段。无论单个 checker 多守纪律，硬规则 3b 在 harness 层都兑现不了。全 population：17/77 有 marker、16/77 有字段，但编码互不相容。

## Plan

`run_checker`（`checker-cost-lib.sh`）识别第三态：约定一个独立退出码（如 exit 3 = NOT-EVALUATED，或解析结构化 marker 字段），该态既不判红也不算通过、单独计数。落地后把三类 checkers 的 NOT-EVALUATED 编码统一到该约定（spec-declaration-point 的 exit 2、另三个的 JSON 字段都迁移）。⛔ 保持三态可区分，不压成布尔。

## Acceptance Criteria

- [x] AC1（能取假，第三态识别）：`run_checker` 识别 NOT-EVALUATED 第三态，既不判红也不算通过、单独计数（grep 到第三态分支）；（⛔ 仍二值 ⇒ 假）。
- [x] AC2（能取假，负控制）：一个故意读不到输入的 checker，改造前它要么误红要么误绿，改造后被记为「未评估」（fail-closed 但取值可区分，硬规则 3b）；（⛔ 仍误红或误绿 ⇒ 假）。
- [x] AC3（能取假，编码统一）：spec-declaration-point 的 exit 2 与另三个的 JSON 字段 NOT-EVALUATED 都迁到统一约定（grep 无互不相容的 exit 2 语义残留）；（⛔ 仍三种编码 ⇒ 假）。

## Definition of Done

`run_checker` 三态落地（pass/fail/not-evaluated 可区分）；三类 NOT-EVALUATED 编码统一；AC1/AC2/AC3 全勾；`checker-cost-lib` 相关测试绿。

## Touches

- plugin/scripts/checker-cost-lib.sh（run_checker 三态识别）
- plugin/scripts/spec-declaration-point-check.ts（exit 2 迁移）
- plugin/scripts/fan-in-materialize-check.ts（JSON 字段 NOT-EVALUATED 迁移）
- plugin/scripts/per-task-suite-record-check.ts（JSON 字段 NOT-EVALUATED 迁移）
- plugin/scripts/inner-wakeup-heartbeat-check.ts（JSON 字段 NOT-EVALUATED 迁移）
- plugin/test/checker-cost.test.mjs（三态测试 + 负控制）
- plugin/test/spec-declaration-point-check.test.mjs（exit 3 断言）
- plugin/test/fan-in-materialize-check.test.mjs（exit 3 断言）
- plugin/test/per-task-suite-record-check.test.mjs（exit 3 断言）
- plugin/test/inner-wakeup-heartbeat-check.test.mjs（exit 3 断言）
- tasks/gap-not-evaluated-harness-third-state.md（自身）
