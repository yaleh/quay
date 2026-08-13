---
id: gap-ac51-assertion-surface-split
title: AC51 断言面拆分——文档检查在提交那一刻跑、不进全量套件（绿窗 60s 不可行 + override 作废认证 + 三层已付代价账）
status: todo
labels:
  - gap
  - defect
  - mechanism
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**AC51（正本 orchestration/manager-phase-goal.md:2767 + SPEC §13：文档检查在提交那一刻跑、不进全量套件）。
今晚实测把 AC51 从「更方便」抬成「没有别的可行选项」——两条绕开路都有成本，且随提交频率线性增长：**

**① 绿窗中位 60s ⇒ 等窗口必踏空**：`.quay/suite-state-events.jsonl` 全量（384 事件，08-12 03:28 → 08-13 04:48）——
SUITE-GREEN → 下一 SUITE-RUNNING 间隔 **n=66，中位 60s**（p25 40s / p75 121s / min 10s / max 488s；<120s 68%）。
任何「看见绿 → 跑完提交」>60s 的流程都会踏空。manager 本轮踏空 3 次 = 期望结果，不是运气差。

**② 守卫拦 commit 不拦 write**：跑轮读的是主检出工作树——断言面文档在**保存那一刻**就进入本轮视野，
提交与否不改变本轮所见。守卫在 commit 处拦截，拦的是一个已经发生过的风险的影子
（`gap-precommit-guard-blocks-commits-not-working-tree-edits`）。

**②' override 的代价 = 作废一轮认证（本条实证）**：`4676de07`（manager 的 SPEC 二次更正）落在 round 121
（verify `7139fc22`）轮中，用 `QUAY_ALLOW_DIRTY_ROUND=1` 提交 ⇒ 按 A15③ 冻结规则该轮须标
`treeMutatedMidRound/infra-error`——**它的绿既不能认证 7139fc22、也不覆盖 4676de07**。
override 让测试结果不受影响，但认证语义作废（manager 记账：推理只覆盖了「这轮会不会变红」，
没覆盖「这轮还算不算数」）。

```
绿窗中位 60s  ⇒  要么【踏空】
                ⇒  要么【override】——而 override 的代价是【作废一轮认证】
⇒ 两条路都有成本，且成本随提交频率线性增长
⇒ 唯一零成本的路：让文档编辑根本不进套件断言面（AC51）
```

**三层已付代价账（今晚，全部落在文档类改动上——而文档类改动不需要跑任何测试）**：
- manager：踏空 3 次 + 作废 1 轮认证（~450s 套件 + 一次 batch-merge freshness 门 fail-closed 等待）
- outer（本层）：round 84 / 109 / 110 三次文档错误各等 8 分钟（CLAUDE.md、SPEC 新建、quay-init 闸各一次）
- ⇒ 这些是**已经付出**的代价，不是预期收益——比「反馈从 8 分钟变秒级」更有说服力。

**断言面实测覆盖（SPEC §13，枚举 `@static-object` 声明，不是推测）**：`CLAUDE.md / orchestration/ / tasks/ /
docs/proposals/ / plugin/loop/*.md` ⇒ **正是三层每天写的地方**。

## Plan（正本 SPEC §13 断言面拆分，人 2026-08-13 裁定 (b)）

1. 文档类检查下沉到 **pre-commit / 提交那一刻**跑，移出全量套件（断言面拆分）。
2. 主检出编辑断言面文档不再使任何在跑的轮变红。
3. 文档编辑不需要窗口、守卫不需要管文档——① ② ②' 全部不再是问题。

## AC

- [ ] AC1: 文档类检查从全量套件移出（提交时刻跑 / pre-commit）
- [ ] AC2: 负控制——故意在主检出编辑一个断言面文档，确认**不再**使任何在跑的轮变红（SPEC :475 AC42 判据 3）
- [ ] AC3: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC3 全部勾上
- [ ] 负控制样例贴出（主检出编辑断言面文档、在跑轮不变红）
- [ ] 全量套件绿

## Touches

- plugin/scripts/（文档检查下沉 pre-commit 的实现）
- scripts/test.sh（全量套件移出文档类检查）
- tasks/gap-ac51-assertion-surface-split.md（自身）
