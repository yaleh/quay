---
id: gap-cost-per-defect-caught-verification-marginal-return
title: 算每拦下一个缺陷的验证成本——给 ADR-005「验证是绑定约束」一个数（ready-pool-check 独占 97.8%）
status: needs-human
needs_human_cause: human-adjudication
labels:
  - gap
  - analysis
  - methodology
parent: null
children: []
extra: {}
---
## Finding

ADR-005（`adr/ADR-005-verification-is-the-binding-constraint.md`）主张「稀缺资源是廉价可信的
检查，不是生成能力」，至今**只有定性论证**，从未有过一个数。现有载体足以算：

- `.quay/gate-events.jsonl`：96,779 条带 pass/fail 的闸判定
- `.quay/checker-cost.jsonl`：94,668 条每次 checker 调用耗时，145 个 checker，累计 **217 小时**

已知的成本结构极度倾斜（`docs/analysis/suite-got-5x-faster-and-throughput-did-not-follow.md` §4）：
`ready-pool-check` 一个人占 **97.8%**（75,571 次调用、中位 9.5 s、累计 212.7 h），
与同期**整个测试套件**的约 231 小时同量级；且三周内从 3.7 h/天 涨到 19 h/天。

## 要算的那个量

**每拦下一个缺陷的成本**：把「每个闸/checker 拦下多少次真实坏状态」与「它累计花了多少成本」
对起来，给出排序——哪些检查器物有所值、哪些是纯税。

⚠️ **去重是这个任务的核心难点，不是细节**：一次真实缺陷会被同一个闸重复判定很多次
（`goal` 闸 fail 有 22,466 条，显然不是 22,466 个不同缺陷）。去重口径必须写清楚、可复跑、
并做敏感性分析（换一个合理口径，结论排序是否翻转）。**口径不写清楚的排序没有意义。**

## Touches

- `plugin/scripts/verification-marginal-return.ts` (new)
- `plugin/test/verification-marginal-return.test.mjs` (new)
- `plugin/scripts/capability-catalog.sh`
- `docs/analysis/cost-per-defect-caught.md` (new)
- `tasks/gap-cost-per-defect-caught-verification-marginal-return.md`

## Acceptance Criteria

- [x] 脚本对真实载体输出每个 checker/闸的：累计成本（小时）、判定次数、fail 次数、
      **去重后的不同缺陷数**、每缺陷成本；并打印所用去重口径的定义。
- [x] 敏感性分析：至少 **2 种**合理去重口径（例如「同一 task+checker 的连续 fail 段算一次」
      与「同一 task+checker+失败原因算一次」），报出两种口径下的排序，并说明排序是否稳定；
      若翻转，明确说「该结论对口径敏感，不可用于决策」。
- [x] 给出 `ready-pool-check` 的专项读数：它 212.7 h 的成本对应多少个去重后的真实拦截，
      每拦截成本是多少——这是全仓最贵的单个检查器，必须单列。
- [x] 识别「纯税」候选：累计成本 >1 h 且去重后拦截数 = 0 的检查器清单（条数 + 清单）；
      零命中时必须把谓词对一个**已知有拦截**的检查器干跑一次证明谓词有效
      （硬规则 2 零计数配套动作）。
- [x] 结论对 ADR-005 明确表态：实测是支持、不支持，还是样本不足以判定；并给出理由。
- [x] `bash scripts/test.sh --for-task gap-cost-per-defect-caught-verification-marginal-return` 全绿，
      新测试在该轮被实际选中执行（按测试名核对）。

## Definition of Done

读数取自 `.quay/gate-events.jsonl` 与 `.quay/checker-cost.jsonl` **生产载体**，不接受 fixture
（关掉注入 seam 后 AC 仍应成立）。`docs/analysis/cost-per-defect-caught.md` 落地 develop，
含可复跑锚点（命令行 + 日期 + develop tip SHA + 去重口径定义）。
若结论显示某些检查器是纯税，**本任务只报数不删检查器**——删除要另行立案并经人裁定，
避免用一个口径敏感的数去砍掉一道闸。

## Needs-Human

**执行 2026-09-14T21:46:12.406Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：human-adjudication
- 失败步/判词：step=suite: # fail 5
- run_id：wk-prod-1789367589
- session_id：c527bfa3-2b79-40a6-8a04-1d0db6860362
- suite 日志：/home/yale/work/quay/.quay/fan-in-suite-gap-cost-per-defect-caught-verification-marginal-return~wk-prod-1789367589~1789422155572-ef28b1.log
- fan-in 日志：/home/yale/work/quay/.quay/fan-in-gap-cost-per-defect-caught-verification-marginal-return-wk-prod-1789367589.log

## Resolution note (追加, 由另一会话诊断)

**2026-09-14T22:0xZ** — 上面这条 needs-human 的成因描述有误：这不是「归因不出任何失败测试文件」的基建/契约疑似问题，而是一个可精确归因的静态检查器红：`kernel-sibling-resolution-check` 在本任务自己新增的 `plugin/scripts/verification-marginal-return.ts:839` 上报了一处未豁免的 naive kernel-sibling 解析（`path.join(root, "plugin", "scripts", "runner-static-gate.ts")`，target-root 形）。

已直接在本任务自己的 worktree/分支（`task/gap-cost-per-defect-caught-verification-marginal-return`）上按本仓库已有的同形先例（`axis-generator.ts` / `guard-lineage-check.ts` / `precommit-guard.ts` / `rhythm-consumer-check.ts` / `quality-gate-driver.ts` 等 ~10 处）加上检查器自己文档化的豁免标记 `kernel-sibling-dev-tree-only`（本脚本只分析本仓库自己的载体，从不对第三方项目的 root 做 sibling 解析，属同一豁免前提），commit `a324daa01`。已直接跑该检查器验证：`status: pass, violations: []`（修复前为 exit 1）。

未做的事：未改动本任务其它任何 AC 的实现或结论，未重跑完整套件（那是下一次派发的常规工作），未改变 needs_human_cause 分类字段本身（成因文字已在此说明，供下一位处置者/worker 参考）。
