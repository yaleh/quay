---
id: gap-ac46-pool-criteria-in-gate-plus-revaluation-executor
title: AC46 未达成——pool 层静态判据移入 todo→ready 提升闸 + todo↔ready 双向重评缺执行者
status: done
labels:
  - gap
  - mechanism
  - ac46
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（2026-08-13，manager 按位置逐类核查 12 条 deferred）**：AC46 判定池层静态判据应全部移入
todo→ready 提升闸，且静态条件变质时 todo↔ready 双向重评要有周期与触发（不依赖任何人记得）。
**现状零任务在推进**（活跃集标题逐条读，命中 0；唯一沾边的 `gap-slot-refill-recommends-landed-code-complete-tasks`
[done] 做的是「不推荐」不是「清出 ready」——僵尸仍占池位，只是不再被推荐）。

**12 条 deferred 的构成（对照 AC46）**：

```
touches-overlap-in-flight   5   ✅ 安全约束，串行化正确，不必动
被取代                    2   ❌ 判据3（条件变质无人重评）→ 已第一层置终态
not-yet-flipped             2   ❌ 判据3 → 已第一层翻 done
landed-implementation       1   ❌ 判据3 → 已第一层翻 done
compound-not-dispatchable   1   ❌ 判据1【逐字点名「非 compound」】→ 已第一层 retreat 回 todo
self-touch-missing-c8       1   ❌ 判据1【逐字点名「self-touch 齐全」】→ 已第一层 retreat 回 todo+补 self-touch
```

**判据1 原文**：「原 pool 层的全部静态判据（非 fixture／非 parked／非 ac-record／**非 compound**／
**self-touch 齐全**／依赖已 done／`Touches` 指向的文件存在／产物齐全）**全部移入 todo→ready 提升闸**」。
**判据2**：「产出是"修好后晋级"或"明确的阻碍原因"，不是静默留在池里」。
**判据3**：「静态条件变质时 `todo↔ready` 双向重评有周期与触发，不依赖任何人记得——`lifecycle.ts` 的
`ready.back="todo"` 已是合法转换，**缺的是执行者**」。
**判据4**：pool=11 deficit=9 而 7 条不可派 ⇒ deficit 不可区分（第一层后 pool=4，此判据暂时恢复）。

**第一层已做（outer，2026-08-13）**：被取代×2 置终态 / not-yet-flipped×2 + landed×1 翻 done /
compound×1 retreat / self-touch×1 retreat+补 Touches ⇒ pool 9→4。**但这是手工一次性清——判据3 要的
是「周期与触发」，即下次再变质时有人自动做，不靠 outer 轮巡。**

## Plan

1. **判据1：把 compound / self-touch / deps / touches-resolve / artifacts 检查从 slot-refill 的
   step-4 defer 逻辑「提升」为 todo→ready 提升闸的准入门槛**——任务在 ready 之前就因这些条件被拒，
   而不是 ready 之后被 defer。（ready-pool-check 的 `--apply` 补晋路径已是闸的雏形，扩展它。）
2. **判据3：双向重评的执行者**——一个周期性机件（复用现有 tick/静态检查泳道），对 ready 池重跑
   判据1 的全部静态条件，条件变质（如被取代、被别任务实现取代、Touches 文件被删、self-touch
   缺失）⇒ 自动 `lifecycle.ts` 的 `ready.back="todo"`（转换已合法，缺的只是调用者）。**不得静默留在池里**：
   每次重评的产出是「修好后晋级」或「明确的阻碍原因 + 去向」。
3. **判据2 的产物**：重评的阻碍原因写进 tick-log / task 体，可 grep、可审计。
4. 判据4 回归：改造后 pool 里不应再有「条件变质却占池位」的任务（负控制：当前池为 4，改造后不变坏）。

## Acceptance Criteria

- [x] AC1 compound / self-touch / deps / touches-resolve / artifacts 检查进入 todo→ready 提升闸：
      不满足者在提升时即被拒（给出阻碍原因），而非 ready 后被 defer。
- [x] AC2 双向重评执行者存在：对 ready 池按周期重跑静态条件，条件变质 ⇒ `ready.back="todo"` 自动执行，
      产出「阻碍原因 + 去向」记录（tick-log 或 task 体），可 grep。
- [x] AC3 负控制：当前 pool（4）改造后不引入新的条件变质任务；不再出现「静默留池」形态。
- [x] AC4 既有 ready-pool-check / slot-refill 测试全绿；`--for-task` scoped 门绿。

- [x] AC5 生产负控制样本（outer 2026-08-13 定向晋升操作产生，不构造——manager 裁定写进验收）：提升闸扩容后必须**拒**：
      `gap-quay-has-never-self-hosted-its-own-cold-start`（compound）· `gap-worktree-node-modules-inconsistent-self-verify`（self-touch 待定）；
      必须**放**：`gap-spec11-stage2-retest-with-concurrency` · `gap-slot-refill-clique-ignores-landed-touches` ·
      `gap-landing-target-branch-consistency-check`。这 5 条是「提升闸不查 compound/self-touch」缺口（AC46 判据1）的现成验收样本——
      第三例「负控制不必构造」（前两例：51699289/1f99e276 phantom 假阳性）。

## Definition of Done

- [x] 提升闸 + 双向重评执行者落地并有测试覆盖。
- [x] 当前池经一次重评扫描，无静默留池任务（或全部给出明确去向）——判据3 执行者已实现（881497a0）；按 manager 2026-08-13 收缩，判据3 降为【观察项】（其根因——翻 done 等外层绿轮——随停全局轮消失；观察判据：landed/not-yet-flipped deferred 再现 ⇒ 需求仍在、恢复；连续无此形态 ⇒ 判据3 标 cancelled 非达成）。
- [x] 判据4 的 deficit 读数在池变化时保持可区分。

**判据3 执行者的署名退出条件（manager 2026-08-13 修正其上一轮意见）**：本执行者是【过渡设施】，不是永久 sweeper。
`per-task 全量成为默认认证之日 ⇒ 翻 done 移交 inner ⇒ 本执行者退役`。理由：**认证在谁手上，状态权就在谁手上**
（fast-mode-loop-tick.md:456——inner 只读外层 full-suite-state.json，拿不到绿轮认证，故翻 done 归外层；per-task 全量一旦
成为默认，inner 在自己树里就有绿证，翻 done 必然移交 inner）。**若建成无期限 sweeper，会把过渡状态固化**——inner 永远不翻、
sweeper 永远清，而「认证已移交」再没人去改。退役判据随任务 AC 写死。

## Touches

- plugin/scripts/ready-pool-check.ts（提升闸扩展：静态判据准入）
- plugin/scripts/lifecycle.ts 或调用侧（`ready.back="todo"` 的自动调用者）
- plugin/scripts/slot-refill.ts（step-4 defer 逻辑收敛到闸，避免双套判据漂移）
- plugin/test/（提升闸 + 双向重评用例）
- tasks/gap-ac46-pool-criteria-in-gate-plus-revaluation-executor.md（自身）

## Evidence

**落地（worktree `task/gap-ac46-pool-criteria-in-gate-plus-revaluation-executor`，2026-08-13）**：

- **判据1 → AC1（提升闸扩容）**：`plugin/scripts/ready-pool-check.ts` 的 `buildCandidate`（bulk）与
  `buildTargetedPromotion`（targeted）现在在 `eligible` 里加查 **compound**（`isCompoundTask`，
  `role: compound` 聚合体永不提升）与 **self-touch**（`selfTouchCheck`，C8 自文件缺失即拒）——
  二者原在 slot-refill step-4 的 defer 逻辑（`compound-not-dispatchable` / `self-touch-missing-c8`），
  AC46 判据1 要求移入提升闸：**不满足者在提升时即被拒（给出阻碍原因），而非 ready 后被 defer**。
  阻碍原因随候选输出（`candidates[].compound` / `candidates[].selfTouchOk`）并记入 `intercepted`，
  与 retired-mechanism 同纪律（可追溯的不晋升，而非静默跳过）。`eligible` 已含 deps / touches-resolve /
  artifacts（既有），现全判据齐。
- **判据3 → AC2（双向重评执行者）**：`analyzeTasks` 输出新增 **`revaluation`** 检测器（对可派 ready 池
  重跑提升闸的全部静态条件——superseded marker / compound / self-touch / touches-majority-missing /
  deps-not-ready / four-artifacts-incomplete；not-yet-flipped / landed-implementation 是 done-flip 归 fan-in，
  非 retreat，天然不在 `ready` 集）。新 `retreatReadyToTodo(root, id, reasons)` 写 `status: ready → todo`
  （`lifecycle.ts` TRANSITIONS 的合法 `ready.back="todo"`——任务点名的【缺的只是调用者】）并追加
  **`## Revaluation`** 记录到 task 体（`去向：ready → todo` + `阻碍原因：…`，grep 面：`grep -n "## Revaluation"`）。
  新 `applyRevaluations(opts)` 是自动执行者（`--revaluate-apply` CLI）。署名退出条件随任务体：过渡设施，
  per-task 全量成默认认证之日退役。
- **superseded 检测修正（position-based，硬规则②）**：`ready-pool-check.ts:1410` 的 `/SUPERSEDED/i` 曾匹配
  任何出现该词的 body（含仅讨论 superseded 类别者）；改为 `SUPERSEDED_MARKER_RE`（行首加粗 marker，
  可带 blockquote 前缀——与真实 store 里 outer 写的 `> **SUPERSEDED / 作废…**` 形态一致，与
  PARKED_MARKER_RE 同构；行内提及如「文档里提到 SUPERSEDED 类别」不命中）。三处使用点全改：
  `buildCandidate` / `buildTargetedPromotion` / `slot-refill.ts` step-4。**before→after**：
  `gap-slot-refill-clique-ignores-landed-touches`（body 提及 `superseded-capability`）从「被拒
  (superseded)」翻转为「放行」（AC5 必放样本）——正是该 bug 的现成真样本。**自证**：本任务 Evidence
  里描述本修正的段落不含行首 marker，故不会被自身 revaluation 误判为 superseded（2026-08-13 实测
  修正前被自误判、修正后消除）。
- **测试**：`plugin/test/ready-pool-check.test.mjs` 新增 SUPERSEDED_MARKER_RE 双向、AC46 marker-fix 双向、
  AC5 生产负控制（读真实任务体，compound/self-touch 拒 + 三个干净任务放）、AC1 bulk 闸（compound/self-touch
  拒 + clean 放 + intercepted 记录）、AC2 重评检测器（clean pool=0 / superseded 变质=1）、AC2 applyRevaluations
  落盘 + retreatReadyToTodo fail-closed；`plugin/test/slot-refill.test.mjs` 新增 SUPERSEDED FILTER marker 双向。
  全部通过（ready-pool-check 108/108、slot-refill 71/71）。
- **AC5 实读真样本判定**（`buildTargetedPromotion` × 真实 tasks/）：
  拒 `gap-quay-has-never-self-hosted-its-own-cold-start`（compound:true）· `gap-worktree-node-modules-inconsistent-self-verify`
  （selfTouchOk:false）；放 `gap-spec11-stage2-retest-with-concurrency` · `gap-slot-refill-clique-ignores-landed-touches`
  （superseded:false）· `gap-landing-target-branch-consistency-check`（皆 eligible:true）。

**DoD 未勾项**：「当前池经一次重评扫描」是操作动作（对主 checkout 活池跑 `--revaluate-apply`），
worktree 子代理不触碰主 checkout 状态——检测器/执行者已落地并测试，扫描动作归 outer 在活池上执行。


## Closure（2026-08-13，manager 收缩——只判据1 是必须，其余重分类）

- **判据1（提升闸扩容）＝必需，已实现**（881497a0，scoped 226/0）：promotion 集 6 条 2 条不该放行（33% 实测），新划分「尽力晋」下是前提——不修则违规灌进 ready。
- **判据4（deficit 语义可区分）＝已达成**：实测 pool=1 deficit=19 candidates=12，「能晋而未晋」vs「真的都被阻塞」可区分——无需再做，标达成。
- **判据3（双向重评执行者）＝已实现但降【观察项】**：其需求根因（翻 done 等外层绿轮，fast-mode-loop-tick.md:456）随停全局轮消失——per-task 绿轮在 fan-in 前就有，inner 可在 fan-in 当时翻 done。停轮后实测 landed/not-yet-flipped deferred = 0（AC46 自身的 not-yet-flipped 是它自己落地未翻）。**退出条件「per-task 全量成为默认认证之日 ⇒ 执行者退役」——那天就是今天**。观察判据（可取假，非新任务）：landed/not-yet-flipped 再现 ⇒ 需求仍在恢复判据3；连续无此形态 ⇒ 标 cancelled 非达成。
- **判据2（能修则修）＝视残留再定**：今日 ready 池 7/11 僵尸是手工清掉的；其价值是「不靠人」非「现在有问题」——等判据1 落地后看残留再定，不与判据1 捆绑。
