# 发现：quay-harness-crystallization-roadmap.md 的基础机制已被 ADR-022 废除

**日期**：2026-08-05（管理者，人问"outer 有在做整体分析/规划/设计吗"引出的调查）

---

## 触发问题

人的原话："我们在持续高速处理任务、修 bug、加功能，但没有整体的分析、规划和设计。outer 有在做这些整体工作吗？"

## 第一层发现：tick 循环和 outer 自己的 AC 都没有"整体复盘"这一步

- `fast-mode-loop-tick.md` 的 7 个步骤（哨兵→读状态→fan-in→检查停止条件→计量→就绪池维护→派发→写回→重排程）**全是机械执行**，没有一步是回头看方向。
- `outer-phase-goal.md` 的章节全是角色纪律（不静默退化、核实声称、拦截降级），**不是架构方向**。
- 实测：近 6 小时新建 6 条 `gap-*` 任务，同期 `docs/proposals/` 下设计文档改动 **0 次**。所有任务都是干活时顺手撞见的，没有一条来自"退一步看方向"。

## 第二层发现（更严重）：唯一存在的路线图已经过期，且没人回去核对过

`docs/proposals/quay-harness-crystallization-roadmap.md`（**2026-07-31**）是全仓库最近的、内容最扎实的战略文档——5 阶段、量化指标、依赖链。**但它整篇建立在经典 milestone 管线上**：`prepare-milestone.js`/`execute-milestone.js`、ProposalReview 轮次、PlanCheck、Prepare→Build→Audit→Land、DIR-124-C/D 的 kernel/policy 分离。

`ADR-022`（**2026-08-03**，只比路线图晚 3 天）明文废除了这整套机制："RETIRED: the classic milestone loop...is retired. The two-layer fast mode is the sole development mode."

**⇒ 路线图 Phase 0-4 全部指向已删除的代码**：
- Phase 0 要填的 `contentAgentMs` 字段在已删除的 `proposal-convergence.ts` 里
- Phase 1 的探测器要挂进已废除的 PlanCheck
- Phase 2 的 kernel/policy 分离针对已删除的 `prepare-milestone.js`
- **Phase 3（跨项目校准，人特别问到的这条）**描述的机制是"把 quay 的 milestone kernel 部署到 archguard，影子模式跑 10 个 milestone、拟合 policy profile"——**这套机制已经不存在了**

## 人的具体问题的答案：不是"偏离"，是框架本身失效了

Phase 3 想回答的战略问题本身**仍然成立、仍然重要**："这套机制是真的能跨项目迁移，还是只是在 quay 自己的任务格式上过拟合了？"

管理者今晚在推的 meta-cc 冷启动，本质上就是在回答同一个问题——只是用双层 fast-mode 循环这个新机制，不是路线图描述的那套。**不存在"在框架内"或"偏离框架"——框架本身在 3 天前失效了，没有人回去把它重写成 fast-mode 版本。** 今晚的工作在回答一个正确的战略问题，但完全没有对照任何写下来的路线图，纯粹是临场推的。

## 建议（供外层判断，不是管理者的裁定）

1. 这份路线图要么标记 `superseded`（指向 ADR-022），要么重写成 fast-mode 版本——现状是**沉默地过期**，比没有路线图更危险，因为它看起来还在，可能误导下一个读它的人（含未来的 outer 自己）。
2. Phase 3 的战略问题值得保留、重新表述：**fast-mode 双层循环是否真能跨项目迁移，还是过拟合了 quay？**——这正是 meta-cc/archguard 冷启动验证要回答的，值得显式立一份新文档或任务把这个问题钉住，而不是让它隐式散落在管理者和外层的对话里。
3. 是否需要在 tick 循环之外建立一个"整体复盘"节奏（多久一次、谁做、看什么）——这条不属于任何一个 `gap-*` 缺陷，是纯粹的方向性判断，交给外层和人裁定。

**这份文件本身不是任务体，不建 AC/DoD——管理者只如实记录发现，立案与优先级判断交给外层。**
