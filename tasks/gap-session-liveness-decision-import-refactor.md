---
id: gap-session-liveness-decision-import-refactor
title: session-liveness 决策层 import 化（①结构性——决策进 pane-state-classify.ts + 测试分层）
status: ready
labels:
  - gap
  - defect
  - test
  - mechanism
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**实证（manager 2026-08-12 结构查证）**：session-liveness.sh 1512 行 / 108 分支，35 处 IO 与时间调用，自身是轮询循环（sleep $INTERVAL）。**108 分支里绝大多数是纯判定**（pane 文本 + transcript 状态 + 阈值 → 发哪个事件），现在**只能靠起真 tmux 才覆盖得到**。

**pane-state-classify.ts**：58KB / 25 export，纯决策，**已可 import**（CLI-import run()/shell 同族先例：命令行为 import 直调、壳契约保留派生）。

**① 修法（结构性，与 CLI-import 同族）**：把 .sh 里剩下的判定推进 pane-state-classify.ts，然后：
- **决策测试**（pane 文本 + transcript 状态 + 阈值 → 该发哪个事件）= import 直调、零真实时间、对负载免疫
- **管道测试**（循环真在轮询吗、capture 真拿到吗、文件真写吗）= 少量几个真实时间用例，**预算只用来防挂死、不用来判对错**

**③ 副产品**：减少真 tmux 起用次数 ⇒ 顺带收掉 tmux server 泄漏部分（当前 8 个/42MB）。

**收益比 CLI 更大**：108 分支里绝大多数是纯判定，import 化后对负载免疫。

**注意**：session-liveness **不在今天废除范围内**——它用 capture-pane 做**观测**不是发消息；ADR-016 屏幕使用限制继续管着。① 只改测试与判定层，不动观测机制本身。

**验证锚**：(a) 判定分支 import 直调覆盖（零真实时间、负载免疫）；(b) 管道测试预算只防挂死；(c) 真 tmux 起用次数下降；(d) 全量套件绿。

## Plan

1. 读 session-liveness.sh 的 108 分支，识别纯判定（可 import 化）vs 管道（保留真实时间）。
2. 判定推进 pane-state-classify.ts（或新增分类函数）。
3. 测试分层：决策 import 直调 + 管道少量真实时间。
4. 验证：负载免疫 + tmux 起用下降 + 全量绿。

## AC

- [ ] AC1: 纯判定分支 import 直调覆盖（零真实时间、负载免疫）
- [ ] AC2: 管道测试预算只防挂死（不判对错）
- [ ] AC3: 真 tmux 起用次数下降（实测对比）
- [ ] AC4: 断言不变；`--for-task` scoped 门绿
- [ ] AC5: 全量套件绿 + 无回归

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 判定 import 化清单 + tmux 起用对比贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿——外层 verification-round 验证

## Touches

- plugin/scripts/pane-state-classify.ts（决策层扩展）
- plugin/scripts/session-liveness.sh（判定调用分类器）
- plugin/test/session-liveness-*（测试分层）
- tasks/gap-session-liveness-decision-import-refactor.md（自身）
