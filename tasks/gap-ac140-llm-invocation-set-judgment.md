---
id: gap-ac140-llm-invocation-set-judgment
title: AC140-4 isLlmInvocation 改读命令集（⛔ 不靠 claude 字面量）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：manager 投立案（判据正本在 `orchestration/manager-phase-goal.md` `### AC140`，提交 `38dd3294`，⛔ 不在此复制，读那一段）。

**缺口（最优先修，⛔ 假读数缺陷）**：`promotion-driver.ts:110-117` `isLlmInvocation(argv)` 判定 `base === "claude"`——一旦按人要求把 wrapper 配成 `claude-fjdac`，该判定返回 false ⇒ fix worker（确实是 LLM 调用）被记成 `llm_invoked:false`，而它与「该路径确实零 LLM」**完全同形**（硬规则 4b）。即昨天生产里那条 `llm_invoked:false`（AC131 证据）在换 wrapper 当天就变不可信。

## Plan

1. `isLlmInvocation` 改由**配置声明的 LLM 命令集**判定（⛔ 命令字面量 `base === "claude"`）；配置集暂缺省 `["claude"]`（形态改对即可，后续 AC140-2 把集做成可配）。
2. 取假验证：**直接对判定函数取假**——配 wrapper 后 `isLlmInvocation(<wrapper argv>)` 必须返回 true（⛔ 非「跑 fix worker 看 round 记录 llm_invoked」——`llm_invoked` 是晋升路径限定字段，fix worker spawn 不进它，见 manager 6f91cfb6 更正）。

## Acceptance Criteria

- [x] AC1（判定读集合）：`isLlmInvocation` 由配置声明的 LLM 命令集判定（⛔ 不靠 `base === "claude"` 字面量）。
- [x] AC2（能取假）：配 wrapper 后 `isLlmInvocation(<wrapper argv>)` 必须返回 true（直接对判定函数取假；⛔ 非「跑 fix worker 看 round 记录 llm_invoked」——该字段是晋升路径限定，fix worker spawn 不进它）。

## Definition of Done

- [x] isLlmInvocation 集合化判定 + 负控制取假通过；AC1-2 全勾；land 到 develop。

## Retires

- 无（修正判定形态）

## Touches

- plugin/scripts/promotion-driver.ts（isLlmInvocation 集合化）
- plugin/test/promotion-driver.test.mjs（负控制：claude-fjdac ⇒ llm_invoked=true）
- tasks/gap-ac140-llm-invocation-set-judgment.md（自身）

> **注意**：本任务独立于 AC140-1/2/3（配置面），可先落——即便配置集暂缺省 `["claude"]`，判定形态改对了就是对的；它修的是 AC131 证据链，越早越好。
