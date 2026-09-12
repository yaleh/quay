---
id: gap-arch-review-judge-verdicts-never-reach-the-existing-gap-filing-channel
title: architecture-review judge 一周 25+ 次同一结论从未立案 —— 立案通道存在，但只接机械漂移、不接语义结论
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**症状（2026-09-12 实测）**：`architecture-review-judge` 探针每小时运行一次；2026-09-06→09-09 期间 **25+ 次独立运行给出几乎相同的结论**——P1 簇的 `deletion-closure` 数值（DC=3200~3570，随时间递增）被 `.archguard/output/*`（archguard 自己的生成产物）与 `.claude/worktrees/*`（git worktree 全仓快照）灌入依赖图而污染，**建议在计算 closure 前排除这些目录**。**每一次都被判为「coincidental / 不采取行动」，`task_list` 检索确认无对应任务。**

**⚠️ 本条的前提经查证被修正过一次，⛔ 不要照抄「无人消费」那个说法**：立案通道**是存在的**——`plugin/scripts/quality-gate-driver.ts:314` 逐字写着「gap-filing（AC3）：drift 非空且未 halt 且资源门 GO ⇒ spawn 短命 agent 经 ABI 立案」，走 `quay-file-task` 且带**机制查重**（`:255`）。

**真正的缺口是接线，不是缺通道**：
- 立案通道的触发条件是 `report.drift.length > 0`（`:315`），而 `report.drift` 来自 **packaging-hygiene 的机械检测**（`config-key-consumer-check` / `shipped-entry-runnable`，见 `:254`），其 argv 构造器是 `buildPackagingGapWorkerArgv`（`:318`）。
- 而 architecture-review judge 走的是另一条路：`:618` `return launchArgv("pool-judge", archReviewJudgePrompt(clusters, root), root)`。

⇒ **两条路不通**：语义 judge 的结论**结构上到不了那个立案通道**。成本全付（每小时一次 LLM 调用），收益为零。

**为什么这条应先于「加更多语义检查」**：当前证据指向**语义产出没有去处**，而非检查数量不足。⛔ 在接线查明之前新增语义检查，只会按比例放大这个浪费。

## Plan

1. **先取直接量**：列出该探针最近 ≥20 次运行的**结论原文与各自处置**（打印原文与时间戳，⛔ 不只报计数）。
2. **定位接线缺口的确切位置**：`archReviewJudge` 的返回值流向何处、在哪一步被判为「不采取行动」、与 `report.drift` 的构造点相距多远。**用最小改动验证你的定位**（改一个条件看结论是否变化，再改回）。
3. **决定接法**：是把语义结论并入 `report.drift`，还是给语义结论单开一条同构的 gap-filing 路径。**给出选择理由**，⛔ 不要两条都做。
4. **防重复立案**：既有通道已带机制查重（`:255`），接线后必须复用它，⛔ 不新造第二套查重。
5. **防噪声**：25 次同一结论若接上通道会不会变成 25 条重复任务——说明你的去重/节流设计，并给出它**能取假**的验证。

## Acceptance Criteria

- [ ] AC1 枚举而非布尔：给出该探针最近 ≥20 次运行的结论清单与各自处置（含时间戳，打印原文）。
- [ ] AC2 接线可取假：构造一次「语义 judge 给出 actionable 结论」的输入 ⇒ 必须产生**恰好一条**立案（或命中既有任务的查重报告）；不给出 actionable 结论时 ⇒ **零立案**。两态输出贴出。
- [ ] AC3 复用既有查重：立案路径经 `quay-file-task` 的机制查重，⛔ 无第二套查重实现（grep 计数 + 打印命中内容）。
- [ ] AC4 节流可取假：同一结论连续出现 N 次只产生一条任务——贴出 N 次输入与最终任务数的实际读数。

## Definition of Done

- 四条 AC 满足，AC2/AC4 有实际两态输出留档。
- ⛔ **本任务只接线与去重，不修 deletion-closure 本身**——「排除 `.archguard/output/` 与 `.claude/worktrees/`」是那 25 次结论的**内容**，它该由接线后自动立出的任务去做；在本任务里顺手修掉会让 AC2 失去被验证的对象。
- 项目自身闸门（scoped 门 + 全量套件绿）。

## Touches

- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/architecture-review-cluster.ts
- plugin/test/quality-gate-driver.test.mjs
- plugin/test/architecture-review-cluster.test.mjs
- tasks/gap-arch-review-judge-verdicts-never-reach-the-existing-gap-filing-channel.md
