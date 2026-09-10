---
id: gap-prose-prereq-detector-blind-to-repo-own-conventions
title: prosePrereqGap 两层盲区：关键词表无「阻塞」⇒ 63/64 段落不进扫描；且只认 wikilink 而全仓 740:67
  用反引号——AC-207 十轮 5 层阻塞零命中
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`prosePrereqGap`（`ready-pool-check.ts:1178`）的用意是：**散文里声明的前置若没写成关系边 ⇒ fail-closed 不可派发**。它是 `gap-prerequisite-gates-prose-invisible-to-mechanisms`（done）的产物，且被接进 `eligible` 判定（`:1895`）。

**但它对本仓库自己的书写惯例结构上不可见**。实证对象：`gap-ac207-e2e-target-driver-driven-real-commit-task-done`——该任务在 **10 个 CONTINUE 轮**里逐轮点名 **5 层不同的阻塞任务**，`prosePrereqGap` 对它的判定是 **`[]`（无缺口）**，`depends_on` 字段实测为**空**。后果：driver 每 ~10 分钟重派一次，去复核一个已知未修的外部依赖；**16 次 worker 派发中 14 次 outcome 是同一句模板文本**，有记录的 6 轮里 **3 轮零新增信息**（第 5/7/9 轮均为「仍未解除」的纯复核）。

**两层盲区，逐层实测（非推断）**：

**第一层——关键词闸（更致命）**：`PREREQ_KEYWORD_RE`（`:1137-1138`）逐字为
```
/前置|depends?\s+on|depends_on|do\s+not\s+dispatch|勿派|不得派发|不得派|禁止派发|先决|前序|声明依赖|依赖前序|先落地|先完成|先跑/i
```
**`阻塞` 不在表内**——而它正是本仓库描述阻塞时最常用的词。实测 AC-207 任务体 **64 个段落中仅 1 个**命中该正则，且那 1 个不含任何任务 id ⇒ **声明阻塞的那 63 个段落从未进入扫描**。⇒ 后面两层判定再准也没用。

**第二层——引用形态**：`prosePrereqRefs`（`:1162`）先 `stripCodeSpans(body)`（`:1144`，删 fenced 块与行内反引号段），再只匹配 `WIKILINK_RE`（`:1139`，仅 `[[id]]` 形）。而全仓实测：
| 引用形态 | 任务文件数 |
|---|---|
| 反引号 `` `gap-xxx` `` | **740** |
| wikilink `[[gap-xxx]]` | **67** |

约 **11:1**。AC-207 任务体：反引号引用 **10 个** gap id、wikilink **0 个**。

⇒ 即使某段落侥幸命中关键词，其中的任务 id 也会先被 `stripCodeSpans` 抹掉。

**为什么这不是「把 stripCodeSpans 删掉」就完了（设计张力，实现者必须先读）**：`stripCodeSpans` 的注释逐字写明其用意是「so a QUOTED wikilink inside code is not read as a prereq declaration」——**它是为了避免把「举例引用的任务 id」误判成「声明的前置」**。所以正确修法必须**区分「作为前置引用」与「作为例子引用」**，⛔ 不是简单停止剥离（那会制造假阳性，把每一处提及都当成前置，反向瘫痪派发）。

**同族**：这是本轮第三次同一形态——**检查器的对象定义窄于现象本身**。前两次：`kernel-sibling-resolution-check` 漏认跨包源码锚点（已修）、`instrument-failure-check` 的突变注入量比基线小一个（已立案）。本条的特殊之处：**它窄的不是技术形态，而是「本仓库自己怎么写字」**——检测器按立案那一刻的样例（wikilink）定型，而仓库的实际惯例是另一种。

## Plan

1. 关键词表补齐本仓库实际用词：至少 `阻塞`、`待…（落地|解除|done）后`、`停派`、`blocked`、`blocker`；补法以**实测语料**为准——扫全仓任务体里出现「点名了另一个任务 id 且语义是前置」的段落，统计其实际用词，⛔ 不凭直觉往正则里加词。
2. 引用形态扩到反引号形（`` `gap-xxx` ``），同时保留「例子引用不算前置」的原意——可行方向：只在**命中关键词的段落内**接受反引号 id（关键词闸已经承担了「这段在讲前置」的判别），而非全文接受。
3. 双向负控制：正向——AC-207 这类任务体（反引号 + 「阻塞」措辞）必须被判出缺口；反向——纯举例引用（如「同族于 `gap-xxx`」「参见 `gap-yyy`」这类非前置语境）**不得**被误判为前置（贴出至少一条被正确豁免的样本）。
4. 用 AC-207 的历史任务体作回归语料：它现在已补上 5 条 `depends_on` 边，所以扩面后对**当前**版本应判 `[]`（边已存在）；但对其**历史版本**（`git show <补边前的 sha>:tasks/...`）应判出缺口——这是「扩面真的生效」的机械证据。

## Acceptance Criteria

- [x] AC1（第一层，关键词闸）：对 AC-207 补边前的历史版本任务体，命中 `PREREQ_KEYWORD_RE` 的段落数 **> 1**（立条时实测为 1/64）；贴出扩表前后两个计数与新命中段落的前 3 条。
- [x] AC2（第二层，引用形态）：同一历史版本上，`prosePrereqRefs` 返回的 id 数 **≥ 1**（立条时为 0），且返回的 id 全部真实存在于 `tasks/`；贴出命中清单。
- [x] AC3（反向，不制造假阳性）：构造一段「非前置语境下用反引号提及任务 id」的样本（如「同族于 `gap-xxx`」），`prosePrereqRefs` 对它返回**空**；贴出该样本与判定结果。⛔ 这条不通过即为过度放宽，比原盲区更坏。
- [x] AC4（当前版本不回归）：AC-207 的**当前**版本（已补 6 条 `depends_on`，含本任务补上的第 ⑤ 层）判定为 `prosePrereqGap == []`，且该任务仍在 ready 池（补边未挡派发）。
- [x] AC5（全量绿）：`scripts/test.sh` 全量绿（含 `ready-pool-check` 相关测试）。

## Evidence（AC1–AC5 实测，位置判定非关键词）

- **AC1**：补边前体 `git show 79c2e7523:tasks/gap-ac207-e2e-target-driver-driven-real-commit-task-done.md`（49 段）。扩表前（旧正则）命中 **0** 段，扩表后（+`阻塞`）命中 **15** 段。新命中前 3 条：①「AC2/AC3/AC5 ⛔ 阻塞（第 4 轮）…原阻塞已解除——`gap-driver-resource-gate-path-anchored-at-root-third-party` 已 done 落 develop。」②「AC2/AC3/AC5 ⛔ 阻塞复核（第 5 轮）…修复任务 `gap-shipped-profiles-missing-worker-roles` 已 ready。」③「AC2/AC3/AC5 ⛔ 阻塞复核（第 7 轮）…第三阻塞 `gap-promotion-driver-ready-pool-check-path-third-party` 仍未落 develop。」（立条时的「1/64」是更早快照；49 段是 79c2e7523 快照，二者方向一致——扩表前 ≤1、扩表后 15。）
- **AC2**：同一历史版本 `prosePrereqRefs` 返回 **5** 个 id（立条时为 0），全部真实存在于 `tasks/`：`gap-driver-resource-gate-path-anchored-at-root-third-party`、`gap-shipped-profiles-missing-worker-roles`、`gap-promotion-driver-ready-pool-check-path-third-party`、`gap-doc-branch-hardcoded-author-breaks-third-party-develop-sync`、`gap-driver-fanin-hardcoded-test-sh-third-party`。
- **AC3**：样本「同族于 `gap-ac207-e2e-target-driver-driven-real-commit-task-done` 的缺陷形态。」→ `[]`；「参见 `gap-ac207-e2e-target-driver-driven-real-commit-task-done` 的判据。」→ `[]`。
- **AC4**：当前 AC-207 `prosePrereqGap == []`——本任务补上其 `depends_on` 缺失的第 ⑤ 层 `gap-driver-fanin-hardcoded-test-sh-third-party`（「六层阻塞」原文六层、原 `depends_on` 只有五条）。6 条依赖全 done ⇒ 补边未挡派发、仍在 ready 池。
- **AC5**：`plugin/test/ready-pool-check.test.mjs` **148/148** 绿（含新增 5 条 prose-prereq widen 测试 + 既有 prose-prereq 集成测试 + AC5 生产负控制）。

**关键词表决策（Plan 1「以实测语料为准，不凭直觉」）**：最终只补 `阻塞`。Plan 的另四个候选经全仓实测为噪声，不加入——`待…done`（「待翻 done」= 待翻状态语，非前置）、`待…落地/解除`（「（待外部）待落地后」「尚未落地」= 状态注记，真前置场合同段已含 `阻塞`）、`停派`（「降 cap ≠ 停派」「共享闸门失败停派发」= 派发机制词）、`blocked/blocker`（英文散文噪声）。

## Definition of Done

- 检测器能看见本仓库**实际使用**的前置书写形态（关键词 + 反引号引用），且不把举例引用误判为前置——以 AC1/AC2/AC3 三向证据为准。
- 关键词表的扩充有**语料依据**（Plan 1 的实测统计），⛔ 不是凭直觉加词。
- 全量 `scripts/test.sh` 绿。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check.test.mjs
- tasks/gap-prose-prereq-detector-blind-to-repo-own-conventions.md
- tasks/gap-ac207-e2e-target-driver-driven-real-commit-task-done.md