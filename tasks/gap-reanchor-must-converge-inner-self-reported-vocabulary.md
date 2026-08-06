---
id: gap-reanchor-must-converge-inner-self-reported-vocabulary
title: "the inner's OWN words — 'Batch of 3 fully merged' — persist despite
  batch-free drives for 3+ rounds, because its context history internalized
  batch-2/3/4 as its organizing form (reports/closes in batches); doc-side
  wording (gap-split-batch-vocabulary) alone can't fix internalized vocabulary;
  the landed re-anchor mechanism (gap-inner-has-no-periodic-anchor) proved
  're-anchor happens + deviations corrected' but NOT 'inner self-reports
  converge to factory semantics' — add an OBSERVABLE semantics-convergence
  criterion to the re-anchor cycle: after re-anchor cycles, the inner's
  self-reported wording (commit/fan-in notes) must use factory semantics
  (rolling dispatch / verification-round), batch-style reports flagged"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者指正（2026-08-05，比措辞区分更严重、性质不同）：**人担心的是 inner 自己嘴里说出的
「Batch of 3 fully merged」，不是文档里的词**。

**实测**：最近三次驱动文本（05:19/05:31/05:47）已经完全不含批字样，但 inner 仍按批汇报 ⇒
**不是散文传染**——inner 在复读自己上下文里几十轮 batch-2/3/4 的旧措辞，**已经把批内化成了自己的
组织方式**（按批汇报、按批收尾）。

**活标本**：外层 05:04:38 的驱动写「请按滚动派发语义派下批」——一句话里滚动和下批互相否定，
当时外层自己也在两套词汇之间。

**根因指向已立案的 `gap-inner-has-no-periodic-anchor-prose-only-drives-drift`（已 done）**，现在有了
**具体行为证据**、不再是理论风险：外层每 20 分钟被 cron 拉回出厂文档所以措辞能纠正；inner 只在被驱动
时接触新信息，**世界观由自己的上下文历史主导**，没有任何机制定期把它拉回出厂语义。

**⇒ 措辞任务（gap-split-batch-vocabulary，仍 todo）单独做解决不了这个**：改出厂文档改不到 inner 已
内化的措辞。**两条一起排**。

**锚点任务（已 done）缺的可观测判据**：AC6 只验「重锚发生了 + inner 修正了明确偏差」，**没验「重锚后
inner 的自述措辞与出厂语义一致」**。本任务补这个判据。

### 选定机制

**给重锚循环加「语义收敛」可观测判据**——不是「重锚发生了」，是「inner 自述措辞向出厂语义收敛」：

1. **自述措辞审计**：每次重锚后（或周期性地），审计 inner 最近的**自述措辞**（commit message /
   fan-in 注记 / 收尾汇报）——「Batch of N fully merged」式汇报 = **门控语义漂移**（应报
   verification-round-N / 滚动派发语义）；合规 = 收敛。
2. **收敛判据**：重锚机制的有效性以**语义收敛**度量（连续 N 轮自述无 batch 式汇报 = 收敛），不只
   「重锚发生了」。
3. **与措辞任务两条一起**：`gap-split-batch-vocabulary`（doc 侧：散文无门控语义）解决文档；本任务
   （inner 侧：自述向出厂语义收敛）解决内化。**一起排**，单独做任一条都解决不了完整问题。
4. **与锚点机制的关系**：锚点机制（已 done）提供「周期性拉回出厂语义」的通道；本任务是该通道的
   **有效性判据**——通道存在 ≠ 词汇收敛。

**管理者自陈（记录）**：管理者刚建了 17 分钟 manager cron 补同一个缺口——manager 层此前也是 Cron=0，
和 inner 同病。三层都需周期锚。

## Acceptance Criteria

- [x] AC1: **自述措辞审计**——重锚后审计 inner 最近自述（commit/fan-in 注记/收尾汇报）：
      「Batch of N fully merged」式门控汇报被标记；verification-round-N / 滚动派发语义 = 合规
      （`plugin/scripts/self-report-vocab-check.ts` + tick 文档 1c 第 6 条；实测见下方 Execute evidence）
- [x] AC2: **收敛判据**——重锚机制有效性以语义收敛度量（连续 N 轮自述无 batch 式汇报 = 收敛），
      不只「重锚发生了」（`nextConvergenceState`：连续 N 轮 count=0 ⇒ `converged: true`；任一轮
      count>0 清零，收敛非单调）
- [x] AC3: **与措辞任务两条一起**——`gap-split-batch-vocabulary`（doc 侧）+ 本任务（inner 侧内化）；
      任务体交叉标注「单独做任一条都解决不了」（本任务 Proposal「单独做任一条都解决不了完整问题」+
      tick 文档 1c 第 6 条交叉标注 + 措辞任务 AC8 已反向引用本任务——双向标注齐全）
- [x] AC4: **真实使用**——重锚循环下 inner 自述措辞向出厂语义收敛（batch 式汇报消失，实测输出贴任务体）
      （本次实测：inner 最近 29 条自述 grep 零命中 batch 式措辞，审计 `count=0`；控制用例「Batch of 3
      fully merged」被审计标记——判据真实区分）
- [x] AC5: 测试用 `node:test` 且带 `// @test-group governance`（`plugin/test/self-report-vocab-check.test.mjs`，
      16/16 pass）

## Definition of Done

- [ ] AC1–AC5 全部勾上；AC4 实测输出贴任务体
- [ ] 重锚有效性以语义收敛度量；inner 自述不再「按批」组织（commit/fan-in 注记用 verification-round/
      滚动语义）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/loop/orchestrator-loop-tick.md（重锚步 1c：加自述措辞审计/收敛判据，步骤 6 + 必报 + 相关文件表）
- plugin/scripts/self-report-vocab-check.ts（新：自述措辞审计 helper + 收敛判据状态机）
- plugin/test/self-report-vocab-check.test.mjs（新：AC1/AC2/AC4 审计与收敛判据 fixture + AC5）
- tasks/gap-reanchor-must-converge-inner-self-reported-vocabulary.md（本任务：AC 勾选 + 证据）

> **交叉标注（AC3，不改动已 done 任务文件）**：措辞任务
> `gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round` 的 AC8 已反向引用本任务
> （「必须与 gap-reanchor-must-converge-inner-self-reported-vocabulary（inner 侧自述向出厂语义收敛）
> 一起排……单独做任一条都解决不了」）；锚点机制
> `gap-inner-has-no-periodic-anchor-prose-only-drives-drift`（done）在 tick 文档 1c 已被本判据引用为
> 「通道提供方」——双向标注齐全，无需改 done 任务。

## Test-Files

- plugin/test/self-report-vocab-check.test.mjs

## Execute evidence（2026-08-06，inner executor）

### 机制落点

- **审计 helper**：`plugin/scripts/self-report-vocab-check.ts` —— `flagBatchVocab`（纯函数）标记
  「Batch of N」/「batch N/M」/批次编号（batch-4）/「按批」式自述；`nextConvergenceState`（纯函数）
  实现收敛判据（连续 N 轮 count=0 ⇒ `converged: true`，任一轮 count>0 清零）。git-log 模式只审计
  inner 自述面（`inner:` fan-in 注记 + `merge task/` 合并提交），白名单自然豁免（任务 id、机件真名
  `concurrent-batch-scheduler.ts`/`{batch, deferred}`、历史名 `batch2-queue-state.md`/`batch4a/b/c`）。
- **tick 文档接线**：`plugin/loop/orchestrator-loop-tick.md` 1c 重锚步新增**第 6 条「自述措辞审计 +
  语义收敛判据」**，并写入「每个 tick 必报」与「相关文件表」；锚点机制（已 done）被引用为「通道提供方」，
  本判据是通道的**有效性判据**——通道存在 ≠ 词汇收敛。

### Contract measure / invoke（inner 自述来源 = 最近 40 提交中 inner/merge 提交，共 29 条）

```text
$ git log --format='%s' -40 | grep -E '^(inner:|merge )' | grep -c 'Batch of'
0
$ git log --format='%s' -40 | grep -E '^(inner:|merge )' | grep -n 'Batch of\|batch-2/3/4\|按批'
（无输出，exit 1 = 零命中）⇒ inner_self_report_vocab = 0（当前窗口收敛）
```

### Control（AC1/AC4，构造 inner 自述 ⇒ 审计必标记）

```text
$ node --experimental-strip-types plugin/scripts/self-report-vocab-check.ts --text 'inner: Batch of 3 fully merged' --json --no-state
{ "count": 1, "flagged": [ { "pattern": "batch-of", "match": "Batch of 3" } ], ... }

$ node --experimental-strip-types plugin/scripts/self-report-vocab-check.ts --text 'inner: verification-round-1 fan-in complete; 滚动派发; worktrees cleaned' --json --no-state
{ "count": 0, ... }   # 出厂语义（verification-round-N / 滚动派发）= 合规，不标记
```

**判据非空转（AC4 反证）**：宽窗（--count 200，112 条 inner 自述）审计**标记**历史 batch 式自述
「batch 5/5 all landed」（2 处），窄窗（默认 40）为 0——审计真实区分「历史批式自述」与「当前收敛」，
不是恒 0 的装饰判据：

```text
$ node --experimental-strip-types plugin/scripts/self-report-vocab-check.ts --root . --count 200 --json --no-state
{ "count": 2, "windowCount": 112, ... }
  FLAG: inner: DIR-124-B2 fan-in (...); batch 5/5 all landed, in-flight 0   (batch-count | batch 5/5)
```

### Convergence（AC2，连续 N=3 轮无 batch 式自述 ⇒ converged，收敛非单调）

```text
round 1: roundsClean=1 converged=False
round 2: roundsClean=2 converged=False
round 3: roundsClean=3 converged=True
（任一轮 count>0 ⇒ roundsClean 清零，见测试 AC2「flagged round resets」）
```

### Scoped test（AC5，`node:test` + `// @test-group governance`，16/16 pass）

```text
$ bash scripts/test.sh plugin/test/self-report-vocab-check.test.mjs plugin/test/batch-vocabulary-check.test.mjs plugin/test/reanchor-prompt.test.mjs
ℹ tests 37   ℹ pass 37   ℹ fail 0   ℹ cancelled 0
```

（16 新 + 8 既有 batch-vocabulary + 5 既有 reanchor-prompt + 8 由 selector 附带 —— 见下方 scoped run）

### 与措辞任务/锚点机制的交叉（AC3）

- 措辞任务 `gap-split-batch-vocabulary-dispatch-rolling-vs-verification-round`（done）AC8 已反向引用本
  任务（「必须一起排……单独做任一条都解决不了」）——本任务 Proposal 与 tick 文档 1c 第 6 条双向标注。
- 锚点机制 `gap-inner-has-no-periodic-anchor-prose-only-drives-drift`（done）提供重锚通道；本判据
  （`converged`）是其有效性度量。

## Contract

measure   inner_self_report_vocab = `grep -c 'Batch of' <最近 inner commit messages 或 fan-in 注记>` stdout 数字段
band      inner_self_report_vocab = 0（连续 N 轮无 batch 式自述 = 收敛）
invariant reanchor_effectiveness_is_convergence = 1（有效性以语义收敛度量，非「重锚发生了」）
invoke    `grep -rn 'Batch of\|batch-2/3/4\|按批' <inner 自述来源>`
control   构造 inner 自述含「Batch of 3 fully merged」⇒ 审计必标记；重锚循环后合规 ⇒ 不标记（收敛）
resume    审计判据与收敛阈值分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T06:0xZ
changed: 外层受管理者指正裁定立案（比措辞区分更严重）。四处收紧：
(1) **根因 = inner 内化的词汇**——三次 batch-free 驱动后仍按批汇报，是上下文历史主导、非散文传染；
(2) **措辞任务单独解决不了**——doc 侧改不到 inner 已内化的措辞，两条一起排；
(3) **锚点有效性 = 语义收敛**——AC6 只验「重锚发生了」不够，须验「自述向出厂语义收敛」；
(4) **三层同病**——manager 也 Cron=0（管理者已自建 17 分钟 cron），三层都需周期锚。
status: todo——与 gap-split-batch-vocabulary 一起排；锚点机制的收敛判据，高优先。
