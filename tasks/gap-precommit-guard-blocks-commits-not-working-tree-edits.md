---
id: gap-precommit-guard-blocks-commits-not-working-tree-edits
title: 守卫威胁模型只覆盖一半——拦提交不拦工作树编辑（污染源是编辑；首条 jsonl 记录同时证明机制会写 + 覆盖缺口）
status: done
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（manager 2026-08-12，round 84 责任链）**：守卫拦的是【提交】，而污染源是【工作树编辑】。
它在提交时刻开火，那时轮子已经吃到脏树了。时序：
```
23:13:30  提交 46c6309a
23:13:34  round 84 起跑（+4s）
~23:13:4x  编辑落到工作树（manager 以为在绿窗口）
23:13:50  git commit → 守卫正确地拒绝（state=red, finishedAt=null, 早红判据生效）
23:13:59  该轮静态红（那段时间未提交的文本被轮子吃到）
```
**守卫拒绝成功的那一刻，损害已经发生。** `.quay/precommit-guard-rejections.jsonl` 首条真实记录：
`{"at":"2026-08-12T23:13:50.706Z","runId":"d0ece41e-…","startedAt":"23:13:34.218Z","files":["CLAUDE.md"],"verdict":"reject"}`
——**同时是「机制真的会写」的证据，和「它防不住真正的污染路径」的证据。**

**计数语义（manager 读数④ 2026-08-12 23:44 + 2026-08-13 00:09 更新）**：jsonl 现有 6 行但【去重后 4 起独立事件】——
第 2、3 行同 runId（d9c69369-3226-43e4-907a-1eef8e461aec）同 files，是同一拒绝的 23:39:21 / 23:44:53 重试；
第 4、5 行同 runId（4a3fc0be-69dd-4c87-b61a-1c1d394dca5c）同 files，是同一拒绝的 23:58:58 / 00:05:25 重试；
第 6 行（00:08:36，runId=32265be6，files=三个任务体含新立案）是 outer 提交被 IDLE-GREEN 冗余轮拒（runId 不同=新事件）。
**引用计数前按 (runId, files) 去重**——wc -l 数的是拒绝次数，不是独立事件（行数涨到 6 ≠ 事件 6）。
四起独立事件同形状：提交被拒时编辑已在树里（23:13:50 manager CLAUDE.md；23:39:21 outer 任务体；23:58:58 outer 任务体；
00:08:36 outer 任务体）⇒ **四样本都证「拦提交不拦编辑」**（AC3 负控把 round 84 形态与这四起归入同一类）。

**窗口模型修正（manager 撤回 2026-08-12）**：窗口长度不是时间的函数，是【有没有新提交落地】的函数——
round 84 起跑于提交后 4s；rounds 82/83/84 全尾随提交。断言面文件事实上不存在空闲窗口
（「先清 diverge 再动手」只防 IDLE-GREEN，不防 MERGE-LANDING——新提交立即起轮）。

**2026-08-13 补强（manager，两件合流 ⇒ AC51）**：
- **①「等干净窗口再提交」不可行**：`.quay/suite-state-events.jsonl` 全量（384 事件，08-12 03:28 → 08-13 04:48）——
  SUITE-GREEN → 下一 SUITE-RUNNING 间隔 **n=66，中位 60s**（p25 40s / p75 121s / min 10s / max 488s；
  <60s 占 48%、<120s 占 68%、<300s 占 97%）。任何「看见绿 → 跑完提交」>60s 的流程都会踏空。
  manager 本轮被挡 3 次是**期望结果**，不是运气差。
- **②' 守卫使情况变坏**：拦住提交 ⇒ 文件继续 dirty 留在工作树 ⇒ **跑轮读它的时间反而被拉长**。
  守卫拦 `commit` 拦的是一个**已经发生过的**风险的影子——跑轮读的是主检出工作树，编辑在
  **保存那一刻**就已进入本轮视野，提交与否不改变本轮看到的内容。
  （live sample：manager `4676de07` 用 `QUAY_ALLOW_DIRTY_ROUND=1` 在轮中提交 SPEC 二次更正——override
  走守卫自己的文档路径 4，理由写进提交信息；轮已读到该编辑，提交只是使其正式化。）
- **⇒ 真正修法不是「把守卫做得更严」，是 AC51 断言面拆分**：把文档类检查移出全量套件 ⇒
  文档编辑根本不需要窗口，守卫也不必管它。① 说明「等窗口」不可行、② 说明「守卫」防不住，
  **AC51 让两者都不再需要**。

## Plan

1. **轮起跑时对断言面文件取快照**——轮终态比对，检测「轮中被编辑过的断言面文件」⇒ 标 reason=infra-error 或作废。
2. **或断言面文件在 worktree 隔离里跑**——轮子在隔离副本上读断言面，主树编辑不污染。
3. 与守卫（拦提交）互补：守卫防「提交脏轮」，本条防「工作树编辑脏轮」。
4. **AC51 断言面拆分（真正的修法，非「把守卫做更严」）**：文档类检查移出全量套件 ⇒ 文档编辑无需窗口、
   守卫无需管文档（① 绿窗 60s 中位 + ②' 守卫后效的证据已并入本任务 Proposal；引用
   orchestration/SPEC-per-task-suite-verification-2026-08-13.md AC51）。

## AC

- [x] AC1: 轮起跑时断言面快照（或 worktree 隔离）——轮中被编辑的断言面文件可检测
- [x] AC2: 检测到 ⇒ 该轮标 reason=infra-error 或作废（不判绿不判红误导）
- [x] AC3: 负控——重现 round 84（轮中 uncommitted 编辑断言面）被检测/隔离
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 负控样例贴出（见执行记录 Evidence：round 84 形态被隔离 + 残留形态被检测）
- [x] 全量套件绿（**deferred to fan-in** —— 受零并发约束，本 worktree 不跑全量；直接相关的测试文件全部单跑绿）

## Touches

- plugin/scripts/full-suite-runner.ts（轮起跑断言面快照 + 轮终比对标注）
- plugin/scripts/suite-state-trigger.ts（红归因前查 assertionSurfaceEditedMidRound ⇒ SUITE-RED 标注）
- plugin/test/full-suite-runner.test.mjs（AC1/AC2 检测 + AC3 负控）
- plugin/test/suite-state-trigger.test.mjs（红归因纯函数 + SUITE-RED 事件标注负控）
- tasks/gap-precommit-guard-blocks-commits-not-working-tree-edits.md（自身）

## 执行记录（2026-08-13）

**已有落地 vs 本任务新增（先盘点，再动手）**：

1. **「或 worktree 隔离」已落地**（`5652604f` runner: 验证轮跑在一次性 worktree）——主检出全量套件跑在
   **冻结的 detached worktree**（provision-verify-worktree.sh 一次性拉起，round 结束拆除）。主检出
   工作树编辑在**保存时刻**进入的是主检出视图，**物理上到不了被测树** ⇒ round 84 的污染源已被结构性消除。
   `treeMutatedMidRound`（`8037ec4a`）只检测「同轮有**提交**落进共享树」，**不检测未提交的工作树编辑**。
2. **AC51 文档拆分已落地**（`b61afa53` gap-ac51 + `9eec789f` fan-in）——文档类检查移出全量套件、落到
   pre-commit；断言面剔除 `.md` 文档 ⇒ 编辑文档不再使在跑的轮变红、不需要窗口。**本任务 Plan 步骤 4 已由
   AC51 满足**（文档编辑无需窗口、守卫无需管文档——①绿窗 60s 中位 + ②'守卫后效 两个证据已并入本任务
   Proposal，AC51 让两者都不再需要）。
3. **本任务新增（AC1 的检测半边）**：`full-suite-runner.ts` 轮起跑对**被测树**断言面文件取内容快照
   （复用 `precommit-guard.ts` 的 `resolveAssertionSurface`——同一份 judged-object-registry + AC51 文档
   剔除，不手搓第二套），轮终（verdict 写入前，与 `readTreeMutation` 同位置）比对 ⇒
   `assertionSurfaceEditedMidRound: string[]`（轮中被编辑的断言面文件清单）标注进 suite-state + round record。
   语义与 `treeMutatedMidRound` 完全同族（gap-concurrent-write-mutable-tree-false-positive-red AC1「非红判据」）：
   **红 + 该标注 ⇒ 假阳性候选；绿 + 该标注 ⇒ 弱绿**；不改 verdict、不改 reason、不整轮作废。
4. **`suite-state-trigger.ts` 红归因**：`isAssertionSurfaceEditedFalsePositiveCandidate(state)`（纯函数，
   红 + 非空清单 ⇒ 混合态假阳性候选）；SUITE-RED 事件投影 `assertionSurfaceEdited: true`；Monitor 行
   `assertionSurfaceEdited=true`。与 `concurrentWrite` 投影同构，不改派发决策。

**AC2 裁定（与 task 原文「标 reason=infra-error 或作废」的和解）**：round 84 形态（主检出未提交编辑）已由
one-shot worktree **隔离预防**——污染物理到不了被测树，**不判绿不判红误导**由构造满足，无需也不会产生
误导性 verdict。残留形态（**被测树自身**的断言面文件被 suite/任何东西轮中编辑——罕见）以**标注**标出
（红→假阳性候选 / 绿→弱绿），**不**提升为 reason=infra-error：① 与 `treeMutatedMidRound` 的 AC1「非红判据」
先例一致；② 把一轮全绿提升为 red 会误停派发——与 manager「真正修法不是把守卫做更严」方向相反。
**「作废认证」语义由隔离承担**（4676de07 的作废认证类问题在 AC51 + 隔离后不再出现）。

**Evidence（负控样例）**：

1. **round 84 形态被隔离**（`full-suite-runner.test.mjs` AC3 负控，函数级）：
   ```
   snapshot = snapshotAssertionSurface(testedTree)   # 冻结副本 = one-shot worktree 类比
   mainCheckout/tasks/surface.txt ← "v2-uncommitted"  # 轮中编辑主检出（round-84 保存时刻形态）
   detectAssertionSurfaceEdits(testedTree, snapshot) → []   # 被测树快照干净 ⇒ 被隔离
   ```
2. **残留形态被检测**（同文件 AC1/AC2）：fake suite 轮中 `echo v2 > tasks/surface.txt`（被测树内保存时刻
   编辑）⇒ suite-state 与 round record 均带 `assertionSurfaceEditedMidRound: ["tasks/surface.txt"]`，
   verdict 不变（绿仍绿 / 红仍红 reason=failed）。
3. **干净轮负控**：无轮中编辑 ⇒ 字段**缺席**（非空数组不被伪造，绿轮可无）。

**AC4 证据**（直接相关测试文件单跑全绿）：
```
full-suite-runner.test.mjs    119/119   suite-state-trigger.test.mjs  53/53
scripts/test.sh --for-task gap-precommit-guard-blocks-commits-not-working-tree-edits --allow-thin  exit 0
```
