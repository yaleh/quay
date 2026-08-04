---
id: gap-no-e2e-proves-install-is-configuration-driven
title: "Nothing in the suite proves install is configuration-driven — the reinstall gate is one e2e with four assertions, and it must land red first"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

来源：`orchestration/GOAL-when-to-reinstall.md`（**人 2026-08-04 定的形状**）。

> 「这台机器的环境就是为了 quay 开发准备的，archguard 和 meta-cc 也是为了验证 quay 的能力。
> 不要再另外搞两个项目。判据限制在 quay 项目内，准备好就重装和冷启动。」

**⇒ 重装门槛是 quay 自己套件里的一个 e2e。它绿了，就重装两个项目。**
（同日更早那版的 G0 一次性预演目标与 G3 两个专门构造的项目**均已作废**。）

### 四条断言

测试**自己建两个临时工作区**（与现有测试的 `makeWorkspace()` 同一手法，随测试销毁），
一个带 `package.json`、一个带 `go.mod`，**使它们的测试命令真的不同**。

| # | 断言 | 它挡住什么 |
|---|---|---|
| **A1** | 两个工作区落地的文件**互相字节相同**，只有那个配置文件不同 | 文本替换。**一旦成立，替换在结构上就不存在** |
| **A2** | 落地文件**与产物字节相同**；紧接着**再装一次，无任何文件变化** | `CONFLICT … skip` —— 升级静默失效 |
| **A3** | 在**已有旧版落地**的工作区上升级：所有文件变成新产物，**且既有 `.workflow-events/`、`tick-log.md`、gate 事件仍可读** | 升级孤立既有状态 |
| **A4** | `## Finding` 无 `## Plan` 的任务**能过 author→ready 闸**；含 `## Plan` 的**仍走严格契约** | 41 个任务堵死循环 |

### 防空过（人明写必须有，否则 A1 可以在两边都没装成的情况下通过）

- 两个工作区的配置文件**内容确实不同**（测试命令、会话名、仓库根）
- 落地文件数 **> 0 且等于产物应铺的集合大小**

**A4 单独说一句**：它是唯一能让「装上的是**方法论**」而不只是「装得上」的那条。
meta-cc 此刻循环活着、cron 在跳、tick 已 4 行，但 **ready 0 / 遥测 0 / 完成任务 0**。

## Contract

```
measure cross_workspace_diff = `diff -r <ws1> <ws2> --exclude=<配置文件>` 的差异文件数字段
measure artifact_diff = `for f in <laid-down>; do cmp -s "$f" "<artifact>/$f" || echo "$f"; done | wc -l` 的差异文件数字段
measure laid_down_count = `find <ws> -type f -newer <marker> | wc -l` 的落地文件数字段
band cross_workspace_diff = 0
invariant 两个测试命令真的不同的工作区，落地文件必须互相字节相同；防空过控制必须同时成立
invoke `scripts/test.sh packages/quay/test/install-config-driven-e2e.test.mjs`
control 配置文件内容必须确实不同且 laid_down_count > 0；否则判定为空过，测试必须失败
resume 先让 e2e 红着落地，再由 #1 与 #9 把它变绿
```

## Chosen mechanism

**e2e 先红着落地，再让修复把它变绿。顺序不可颠倒。**

1. **先写 e2e**（本任务），**要求它此刻就真的红**——
   A1/A2/A3 会红是因为落地仍在做文本替换（清单 #1），A4 会红是因为闸拒绝 `## Finding`（清单 #9）。
   **把这四条红的实跑输出贴进任务体，那是这个仪器唯一的自证。**
2. **再由两条既有任务把它变绿**：
   [[gap-install-rewrites-files-so-upgrade-cannot-tell-who-changed-them]] → A1/A2/A3；
   [[gap-the-dod-gate-encodes-a-retired-task-shape]] → A4。
3. **防空过控制与断言同时落地**，不得延后——
   人明写「否则 A1 可以在两边都没装成的情况下通过」。

**为什么必须先红**：本仓已为这条付过两次学费
（`gap-checks-that-verify-an-empty-set-must-fail-closed`、`gap-checkers-have-never-been-shown-to-fail`）——
**一个从没红过的检查，与「永远返回空集」不可区分**。
**e2e 是重装决策的唯一门槛**，如果它是在修复之后才写的，
**我们将永远无法判断它是否真的会拦住下一次回归**。

**不做**：不造预演项目、不造两个真实项目（人已推翻）；
不把 A3 的「既有状态仍可读」放宽成「文件还在」（**可读且语义不变**才算）；
不在 e2e 里重复验证清单里那 8 条归重装验的缺陷（**那是重复劳动**，见下）。

## Acceptance Criteria

- [ ] AC1: **e2e 落地并此刻为红**——四条断言的失败输出贴进任务体（**这是仪器的自证，不可省**）
- [ ] AC2: **A1** 两工作区落地文件互相字节相同、仅配置文件不同（实跑贴出）
- [ ] AC3: **A2** 与产物字节相同 + 紧接着再装一次**零文件变化**（实跑贴出）
- [ ] AC4: **A3** 旧版工作区升级后全部变成新产物，**且 `.workflow-events/` / `tick-log.md` / gate 事件仍可读且语义不变**（实跑贴出）
- [ ] AC5: **A4** `## Finding` 无 `## Plan` 过闸；**含 `## Plan` 的仍走严格契约**（两个方向都贴）
- [ ] AC6: **防空过控制**——两工作区配置文件内容确实不同；
      落地文件数 **> 0 且等于产物应铺集合大小**。
      **负控制：人为让两边都装失败 ⇒ 测试必须红**，不得因「两边都空所以相同」而通过
- [ ] AC7: **两个工作区的测试命令确实不同**（`package.json` vs `go.mod` 推导出的命令逐字贴出）——
      否则 A1 只证明了「同一个替换值产生同一个结果」
- [ ] AC8: 测试用 `node:test` 且带 `// @test-group product`，随测试销毁临时工作区
      （与现有 `makeWorkspace()` 同一手法，**不得在共享检出留下残留**）

## Definition of Done

- [ ] **AC1 的四条红**的实跑输出贴进任务体——
      **只有绿的一半，证明不了这个仪器会拦住什么**
      **（外层 2026-08-04 01:22Z 更正：原文要求「四条红 + 修复后的四条绿」都贴，
      那是外层的设计错误——e2e 是仪器，第 1 条与第 9 条是被测物；
      让仪器的任务等被测物落地，等于用一个槽位停放数小时。
      本条收敛为仪器自身：e2e 存在、四条断言此刻为红、红的输出已贴、防空过控制已落地。
      四条绿改由那两条修复任务各自的 AC 引用本 e2e 来验证——**谁修谁证明自己让它变绿**。）**
- [ ] AC6 的空过负控制实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（**判据是 `fail 0` 且 `cancelled 0`**）
- [ ] 任务体记录：**这个 e2e 是重装决策的唯一门槛**；
      绿了之后的两次重装才是真验证，因为**有两条测试给不了**——
      **人工补丁数 = 0**，以及**通过闸完成 ≥1 个任务**

## Touches

- packages/quay/test/install-config-driven-e2e.test.mjs
- plugin/scripts/quay-init.sh
- orchestration/GOAL-when-to-reinstall.md

## Dispatch review

reviewer: outer
at: 2026-08-04T00:15:00Z
changed: 人推翻了同日更早的门槛形状（G0 预演目标、G3 两个专门构造的项目**均作废**），
收缩为 **quay 套件内的一个 e2e、四条断言**。**外层上一版提的「把 G0 当仪器用、现在就跑」随之作废**，
`orchestration/outer-phase-goal.md` 里那份 G0–G5 映射已被替换，**不留互相矛盾的两份记录**。
**外层的主要判断是顺序：e2e 必须先红着落地，再由 #1 与 #9 把它变绿。**
理由是本仓已付过两次学费——**一个从没红过的检查，与「永远返回空集」不可区分**；
而**这个 e2e 是重装决策的唯一门槛**，若它在修复之后才写，
**我们将永远无法判断它是否真的会拦住下一次回归**。
**AC7 是外层新增**：必须逐字贴出两个工作区推导出的测试命令确实不同——
否则 A1 只证明了「同一个替换值产生同一个结果」，那是一次空过而不自知。
**AC6 的空过负控制按人的原话落地**（「否则 A1 可以在两边都没装成的情况下通过」），
并加了主动方向：**人为让两边都装失败 ⇒ 测试必须红**。
**清单里其余 8 条归重装验，外层特别记明「归重装验 ≠ 可以不修」**——
重装要求人工补丁数 = 0，那 8 条仍然全部必须关掉，只是不挡 e2e 变绿；
**这个区别不写清就会被读成降级。**
