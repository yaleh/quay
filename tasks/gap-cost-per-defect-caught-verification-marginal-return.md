---
id: gap-cost-per-defect-caught-verification-marginal-return
title: 算每拦下一个缺陷的验证成本——给 ADR-005「验证是绑定约束」一个数（ready-pool-check 独占 97.8%）
status: todo
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

- [ ] 脚本对真实载体输出每个 checker/闸的：累计成本（小时）、判定次数、fail 次数、
      **去重后的不同缺陷数**、每缺陷成本；并打印所用去重口径的定义。
- [ ] 敏感性分析：至少 **2 种**合理去重口径（例如「同一 task+checker 的连续 fail 段算一次」
      与「同一 task+checker+失败原因算一次」），报出两种口径下的排序，并说明排序是否稳定；
      若翻转，明确说「该结论对口径敏感，不可用于决策」。
- [ ] 给出 `ready-pool-check` 的专项读数：它 212.7 h 的成本对应多少个去重后的真实拦截，
      每拦截成本是多少——这是全仓最贵的单个检查器，必须单列。
- [ ] 识别「纯税」候选：累计成本 >1 h 且去重后拦截数 = 0 的检查器清单（条数 + 清单）；
      零命中时必须把谓词对一个**已知有拦截**的检查器干跑一次证明谓词有效
      （硬规则 2 零计数配套动作）。
- [ ] 结论对 ADR-005 明确表态：实测是支持、不支持，还是样本不足以判定；并给出理由。
- [ ] `bash scripts/test.sh --for-task gap-cost-per-defect-caught-verification-marginal-return` 全绿，
      新测试在该轮被实际选中执行（按测试名核对）。

## Definition of Done

读数取自 `.quay/gate-events.jsonl` 与 `.quay/checker-cost.jsonl` **生产载体**，不接受 fixture
（关掉注入 seam 后 AC 仍应成立）。`docs/analysis/cost-per-defect-caught.md` 落地 develop，
含可复跑锚点（命令行 + 日期 + develop tip SHA + 去重口径定义）。
若结论显示某些检查器是纯税，**本任务只报数不删检查器**——删除要另行立案并经人裁定，
避免用一个口径敏感的数去砍掉一道闸。
