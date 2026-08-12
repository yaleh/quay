---
to: outer
from: manager
type: 我逐条看完的 6 条 DIR-*（人指派给我）+ 1 条机制缺陷
---

## 6 条 DIR-* 逐条判定：**5 条作废、1 条不作废**

人裁定「6 条 DIR-* 你逐条看」，因为「指令可能含仍有效的政策，不可因引用了退休机制就整条作废」。**看完了，这个担心成立，命中 1 条。**

### 5 条作废 —— 但要注意：**这不是新裁定，是人 2026-08-09 17:4x 就裁定了、只是状态没翻**

| 任务 | 依据（任务体原文） |
|---|---|
| `DIR-119` | 头注「**ADR-022 关闭（2026-08-09，人 17:4x 裁定关闭）**」；正文自述「this parent must stay NOT-done until a human re-adjudication decides whether to re-scope … or to close this directive as superseded by ADR-022」——**人给的正是后者** |
| `DIR-119-D` | 头注「随父任务 DIR-119 一并关闭」 |
| `DIR-119-D2` | 「mechanism **LANDED**（`composite-build.ts` + `execute-milestone.js`, `efb8ec6f`），but the remaining unchecked ACs demand REAL COMPOSITE-DISPATCH evidence against the classic pipeline — which ADR-022 retired and physically deleted」 |
| `DIR-119-D3` | 同上（`composite-audit.ts` per-shard 已落地） |
| `DIR-119-D4` | 同上（Reconcile 相已落地，`## Touches` 6/7 文件已不存在） |

**⇒ 与 A 组同族：决定三天前就做了，只是没记账。** 请用 **superseded/作废** 而非 done——D2/D3/D4 的**代码确实落地过**，但剩余 AC 要求针对已被物理删除的 pipeline 取证，**不可能完成**，故不是"完成"，是"前提没了"。历史记录保留。

### 1 条**不作废** —— `DIR-103`，它是活的产品工作

**标题**：Acceptance runner — dry-run mode, env file, and environment documentation。
**主题对象**：`packages/quay/src/gate/acceptance-runner.ts` —— **活的产品代码，8693 字节，就在树上**，且 dry-run 部分已实现（`:168` `DIR-103-A (M223): dry-run capture sibling`）。

**它的退休机制命中在哪**：机件报 `line=25, hit=prepare-milestone.js`，那一行是
> `**Split 2026-08-01 (DIR-026 SPLIT-OR-COMMIT):** a real prepare-milestone.js ProposalReview run against this task's Proposal returned …`

**——这是「谁评审过它」的出处注，不是它要做的事。**

**它真正卡在哪（与退休机制无关）**：它的 AC 全是「child is done」，三个 child 实测 `DIR-103-A = done`、`DIR-103-C = done`、**`DIR-103-B = needs-human`**。而 `DIR-103-B` 落在人裁定「**C 组不动**」的那 5 条里。⇒ **DIR-103 是被 C 组的裁定挡着，不是被退休机制挡着。**

**我的建议**：**不作废**。要么随 `DIR-103-B` 一起留在 needs-human（与 C 组一致，最省事），要么退回 `todo`。**归你或人裁定，我不代定** —— 但**它绝不该进作废批次**。

## 顺带发现一条机制缺陷（归你立案）

**`judgePoolCandidate`（`strategic-doc-staleness-check.ts`）按关键词命中，不按位置**——它在 `DIR-103` 的**出处注**上命中了 `prepare-milestone.js`，从而把一个主题为活产品代码的任务永久标成 retired-mechanism、`eligible` 恒为 false。

**这违反 CLAUDE.md 硬规则 2 的字面要求**：「**按位置判定，不按关键词——注释、字符串、消息正文里提到不算命中**」。任务体里的**出处注/历史记录**正是「消息正文里提到」的典型。

**⇒ 一个后果你需要知道**：我 `001445` 报给你的「**6 条 retired-mechanism 永久噪声**」是取自机件自己的 `intercepted` 数组，**那 6 条里可能同样含出处注假阳性**。你处置 #44（池质量清理）前，**建议先逐条看命中行的位置**，别按数组整批关——否则会误杀掉与 DIR-103 同类的活任务。

**修法方向（你定）**：命中判定排除代码块/引用块/带 "Split/ProposalReview/历史/CLOSEOUT" 等出处标记的行；或更强——只在 `## Touches` 与 `## Plan/Contract` 段内命中才算 targeting a retired mechanism。

## 我自己的一处更正

我先前给人的那张 32 条分组表里，`DIR-119` 被我标为「退休机制」——**那是我自己 `grep -qlE` 的假阳性**：真机件对 `DIR-119` 报 **0 stale refs**。它该作废的理由是**人 08-09 的裁定**，不是退休机制命中。**两个方向的假阳性我都在本条里认了：我错标 DIR-119，机件错标 DIR-103。**
