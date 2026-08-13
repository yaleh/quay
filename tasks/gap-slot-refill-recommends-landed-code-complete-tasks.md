---
id: gap-slot-refill-recommends-landed-code-complete-tasks
title: slot-refill recommended 恒含 landed-but-not-flipped（实现已在树）任务——step-4
  只看声明不看树事实，加机械判据（manager 2026-08-13 建，6 真样本验证 + 负控制）
status: ready
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

**slot-refill 的 recommended 恒含 landed-but-not-flipped（实现已在树）任务——step-4 只看【声明】不看【树事实】。**

**实证（2026-08-13 同日 4-5 次同形）**：slot-refill recommended 顶格 5 条全这种——`gap-ac53-end-invariant-gate` / `gap-src-n-anchor-coupling` / `gap-npm-pack-ac3-gate-counter-example-refs` / `gap-precommit-guard-blocks-commits-not-working-tree-edits` / `gap-capability-catalog-backtick-command-substitution`（已合）——全部「代码已合进 develop、ACs 全勾、只差绿轮验证后的 closure」。**`should_refill=true` 挂着 B9 强制派发链，实派过去是 code-complete，零实现工作**。

**根因（manager 2026-08-13 独立同源发现）**：池的判据只看【声明】（touches 声明 / deps 声明 / C8 自 touch），不看【树上的事实】（实现在不在 develop）。`ready-pool-check.ts:22-27` 的 `dispatchable_disjoint` 是「两两 touches-不相交的最大子集大小」——`:222` 自证 "answers ONLY 'are there ≥cap mutually-disjoint candidates' … reads NO merge/landing state" ⇒ **它结构上看不见 deps-ready 与实现落地，是上界不是实测值**。**另一个上界误读**：`nyf`（not-yet-flipped）数不到 ready 池里的 landed 任务（它们不进 `excluded[]`）⇒ 上界/下界都被当实测用过。

**机械判据（manager 已建，6 真样本全判对 + 负控制可取假）**：
```
实现已在树(id) := ∃ develop 提交，其 message 含 <task-id>
                且 git show --name-only -m --first-parent 的文件里有 tasks/ 以外者
```
**两个坑（已踩过并修掉）**：
1. 只 `--grep` 不看文件 ⇒ 假阳性（建任务/改任务体的提交也含 id）——必须要求「改了 `tasks/` 以外的文件」。
2. 不加 `-m --first-parent` ⇒ 假阴性——**落地提交往往是 merge，`git show --name-only` 对 merge 默认输出空**（实测 7418c615：不加 -m 得 0 文件，加了得 4-5）。这一条最阴：只在 fan-in 落地的任务上取假——判据会在它唯一有用的场合失效。

**裁定（manager 2026-08-13，裁定权 outer）**：先落机械判据，**不加 agent 判**（pool-quality-judge 语义范畴）——判据是纯 git、单次调用、可取假、已在真样本验证；agent 的成本只在判据失效的场合值得付。先把机械判据挡不住的剩余攒出来，再决定要不要 agent（硬规则 4 推论：成本结构未知前不设方案）。

## Plan

1. `plugin/scripts/slot-refill.ts`（或 ready-pool-check.ts 的 recommended 计算）：step-4 增加「实现已在树 ⇒ 不进 recommended」——用上述 git 判据（含 -m --first-parent + 文件在 tasks/ 外两个坑的实现）。
2. 判据须可取假（负控制：不存在的 id ⇒ 不进）。不命中则维持现状。
3. 测试：构造 landed 任务 fixture ⇒ recommended 排除；未落地任务 ⇒ 保留。
4. closure 后若该批仍出现在 recommended，是判据缺失的直接证据。

## AC

- [ ] AC1: slot-refill/ready-pool 的 recommended 对「实现已在树」任务排除（git 判据：message 含 id + `-m --first-parent` 文件在 tasks/ 外）
- [ ] AC2: 判据可取假——负控制（不存在 id / 仅任务文件）⇒ 不排除
- [ ] AC3: merge 落地提交正确识别（`-m --first-parent` 使 merge 的文件列表可见；不加时 0 文件——实证 7418c615）
- [ ] AC4: 任务体/文档提交不误判为「实现」（文件必须在 tasks/ 外）
- [ ] AC5: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修正前 5 条 phantom recommended vs 修正后 0 条 的对照贴出
- [ ] **真实负控制（manager 2026-08-13 建议）：round 146 绿窗 closure 后，若 inner 侧有过「被告知有货、实际派过去是 code-complete」的轮次，作为判据的真实样本——比构造的检验更有说服力，不用额外造数据**
- [ ] 全量套件绿

## Touches

- plugin/scripts/slot-refill.ts（或 ready-pool-check.ts 的 recommended 计算）
- plugin/test/slot-refill.test.mjs（或 ready-pool-check.test.mjs：landed 排除 + 负控制用例）
- tasks/gap-slot-refill-recommends-landed-code-complete-tasks.md（自身）