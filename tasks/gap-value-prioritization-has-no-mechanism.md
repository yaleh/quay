---
id: gap-value-prioritization-has-no-mechanism
title: "which of the 54 todos matters most has no mechanical answer — every real priority decision tonight came from the human or ad-hoc outer/manager judgment; ready-pool-check only has the gap>DIR tiebreak + AC-queue quantity (not relevance); add a relevance signal (strategic-question traceability + blocking + cost) as the manager layer's prioritization function"
title: which of the 54 todos matters most has no mechanical answer — every real
  priority decision tonight came from the human or ad-hoc outer/manager
  judgment; ready-pool-check only has the gap>DIR tiebreak + AC-queue quantity
  (not relevance); add a relevance signal (strategic-question traceability +
  blocking + cost) as the manager layer's prioritization function
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`SYNTHESIS-four-gaps-2026-08-05.md` 缺口 2：**持续的整体价值判断——每一次排序都是人肉的**。实测：
今晚每个真实优先级决定都来自人或外层/管理者的临场判断，**没有一次来自机制**——gap-init-ships 优先
（理由：卡住自建目标）、closure-async vs 套件移外层排序、吞吐 vs 测量完整性、三块消除批次顺序。

**机制侧现状**：`ready-pool-check` 的排序规则只有 `gap-* > DIR-*`、`touches-resolve 的排前`——
**机械 tiebreak，不是价值判断**。`AC-queue` 只维护**数量**（≥3），不维护**相关性**。
⇒ **54 条 todo 里哪条对目标最重要，没有任何机制在回答。队列水位够了，但水里是什么无人过问。**

**归属**：价值排序是 manager 层的职能（`gap-productize-the-manager-layer` umbrella 的职能之一）；
本条实现该职能的机制，归属该层。

### 选定机制（外层裁定）

**给排序加「相关性」维度**，扩展现有 `ready-pool-check` 的晋级顺序（不替换 gap>DIR 机械 tiebreak，
在其上加一层价值信号）：

1. **相关性信号（每候选）**：
   - **战略追溯**：候选是否可追溯到写下来的战略问题（`FINDING-*.md` / 战略任务引用 / REVIEW-cadence
     的 (b) 清单）——有追溯的排前；
   - **阻塞性**：候选是否解除其他任务的阻塞（parent 关系 / 后续依赖）——解阻塞的排前；
   - **成本/收益**：候选的估计成本（touches 规模、spawn 密集度）与收益（战略贡献）——小成本高收益
     排前。
2. **优先级查询**：`ready-pool-check` 增加一个输出——「当前 todo 里价值最高的 N 条 + 理由」，不只
   是「池 <3 时补谁」。让「54 条里哪条最重要」有机械答案。
3. **价值信号来源写死**：战略追溯 = 任务体里对 `FINDING-*`/战略问题的引用（机械 grep）；阻塞 =
   `parent`/`children` 字段；成本 = touches 解析规模。**不引入人肉打分**。
4. **不削弱现有机制**：gap>DIR 顺序保留（AC-queue 数量逻辑不变）；本条只是增加一个相关性排序输出。

**与复盘节奏的关系**：REVIEW-cadence 的 (b)「gap-* 可追溯性」是价值信号的输入之一；本条把追溯从
「复盘时人工判」变成「排序时机械算」。

## Acceptance Criteria

- [x] AC1: `ready-pool-check` 增加**相关性信号**——每候选计算：战略追溯（任务体引用 FINDING-*/战略问题，
      机械 grep）+ 阻塞性（parent/children）+ 成本（touches 规模）；输出到 JSON
      → `plugin/scripts/ready-pool-check.ts` 新增 `computeRelevance()`：`strategicTrace`（body grep
      `FINDING-*`/`RESEARCH-*`/`GOAL-*`/`REVIEW-cadence`）、`unblocks`（非 done 的 children 数，
      `parent` 字段）、`costTouches`（`## Touches` 解析 glob 数）；每个 candidate 携带 `relevance`
      对象输出到 JSON。
- [x] AC2: **优先级查询输出**——「当前 todo 里价值最高的 N 条 + 理由」（非仅池<3 时补谁）；54 条里哪条
      最重要有机械答案（实跑输出贴任务体）
      → 新增 `--top <N>`：stdout 的 `top_relevance` 数组 = 当前 todo 按相关性信号排序的前 N 条 + 每条
      机械理由。实跑输出见下。
- [x] AC3: 价值信号来源**机械**（grep/字段/touches 规模），**不引入人肉打分**
      → 三个分量全部机械：战略追溯 = body 正则 grep；阻塞 = `parent`/`children` 字段遍历；成本 =
      `parseTouches` 解析规模（与 dispatch gate 同一 single-source parser）。无任何人工打分输入。
- [x] AC4: **不削弱现有机制**——gap>DIR 顺序保留、AC-queue 数量逻辑不变（既有行为回归证明）
      → `promotions` 排序（disjointness-first → gap>DIR → touches-resolve）与 candidate 扫描门
      （`deficit > 0`）**字节未动**；`top_relevance` 是独立附加输出。既有 20 用例全绿 + 新增 AC4
      回归断言（`top_relevance` 不影响 `candidates`/`promotions` 顺序）。
- [x] AC5: 归属 manager 层——与 `gap-productize-the-manager-layer` 交叉标注（排序职能挂该层）
      → 已在 `tasks/gap-productize-the-manager-layer.md` 增加「## 排序职能挂接」节：排序职能由本条
      落地，manager SKILL §2 排序行挂本任务。
- [x] AC6: **真实使用**——至少一次用相关性排序回答「下一条该派谁」（非 gap>DIR 平局），实跑证据
      → 实跑 `--top 5`：DIR-119-D（dir 类、无追溯、unblocks 4、score 40）排第 2，在
      gap-quay-has-never-self-hosted（gap 类、unblocks 3、score 35，第 3）之前——**相关性（阻塞）
      越过 kind 平局**，非 gap>DIR 机械答案。实跑输出见下。
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`
      → 测试在既有 `plugin/test/ready-pool-check.test.mjs`（已 `node:test` + `// @test-group
      governance`）新增 6 用例：AC1 信号、AC2 查询、AC6 排序、AC3 机械来源、AC4 回归、CLI `--top`；
      scoped 运行 `pass 26 / fail 0`。

**AC2/AC6 实跑输出**（`node --experimental-strip-types plugin/scripts/ready-pool-check.ts --top 5`，
2026-08-06，本任务已 `status: ready` 故不再在 todo 排名中）：

```
 1 gap-quality-criteria-are-point-in-time-no-trend-criteria | kind gap | eligible true  | score 101 | strategic-traceable (REVIEW-cadence) · unblocks 0 · cost 4 touches · eligible
 2 DIR-119-D                                                | kind dir | eligible false | score  40 | no-strategic-trace · unblocks 4 · cost 5 touches · deps NOT-ready
 3 gap-quay-has-never-self-hosted-its-own-cold-start        | kind gap | eligible false | score  35 | no-strategic-trace · unblocks 3 · cost 0 touches · four-artifacts INCOMPLETE
 4 DIR-124-B                                                | kind dir | eligible false | score  20 | no-strategic-trace · unblocks 2 · cost 15 touches · deps NOT-ready
 5 DIR-124-F                                                | kind dir | eligible false | score  20 | no-strategic-trace · unblocks 2 · cost 9 touches · deps NOT-ready
```

AC6 实例：**第 2 名 DIR-119-D（dir 类）在 gap-quay-has-never-self-hosted（gap 类，第 3 名）之前**——
纯 gap>DIR 机械 tiebreak 会把 gap 排前；相关性信号（unblocks 4 > 3）把它推前 = 非 gap>DIR 的机械答案。
AC2 实例：`top_relevance[0]` 的答案「gap-quality-criteria（战略可追溯、score 101）」带完整价值理由，
不是「池<3 补谁」。

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC2/AC6 实跑输出贴任务体
- [ ] 「54 条 todo 里哪条最重要」有机械答案（非人肉）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches
- tasks/gap-value-prioritization-has-no-mechanism.md（自身文件：勾 AC + 贴 invoke 证据授权）


- tasks/gap-value-prioritization-has-no-mechanism.md（self-touch：AC 勾选 + invoke 实跑证据）
- plugin/scripts/ready-pool-check.ts（相关性信号 + 优先级查询输出）
- plugin/test/ready-pool-check.test.mjs（AC4 既有行为回归 + AC1/AC2 断言）
- tasks/gap-productize-the-manager-layer.md（AC5 交叉标注）
- orchestration/SYNTHESIS-four-gaps-2026-08-05.md（引用）

## Contract

measure   top_n_relevance = `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --top 5` stdout 的价值排序数组
band      top_n_relevance >= 1（至少一条有理由的相关性排序，非 gap>DIR 平局）
invariant relevance_is_mechanical = 1（信号来源 grep/字段/touches 规模，无人肉打分）
invoke    `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --top 5`
control   战略追溯候选 ⇒ 排前（AC6 实例）；gap>DIR 顺序保留（AC4 回归）
resume    信号计算与查询输出分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T03:3xZ
changed: 外层读 SYNTHESIS 缺口 2 裁定立案。四处收紧：
(1) **相关性是 manager 层职能**——归属 productize-the-manager-layer umbrella；
(2) **价值信号机械来源**——战略追溯/阻塞/成本全机械（grep/字段/touches 规模），不引入人肉打分；
(3) **不削弱现有**——gap>DIR + AC-queue 数量逻辑保留（AC4 回归证明）；
(4) **优先级查询是硬输出**——「54 条哪条最重要」有机械答案，不只是补池 tiebreak。
status: todo——排 manager 层 umbrella 之后；战略层职能机制。
