---
id: gap-batch-merge-freshness-gate-doc-only-exemption
title: "批量合 freshness gate 连续 3 次被 doc-only 提交挡（round-155/157/158 起点的 SPEC/doc 编辑）——纯文档提交无需重测，机械 gate 无法区分「文档」与「代码」"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**integration-batch-merge.sh 的 freshness gate（gap-batch-merge-gate-reads-stale-green 产物）要求 suite 起点 ≥ 最近 integration fan-in。但连续 3 次被 doc-only 提交挡——文档编辑无需重测，机械 gate 无法区分「文档」与「代码」，每挡一次浪费 17 分钟套件。**

### 实证（outer 2026-08-09）

| 轮 | 被挡的 doc-only 提交 | 文件 |
|---|---|---|
| round-153 后 | 2f3bf9ac（manager AC35 phase-goal） | orchestration/manager-phase-goal.md |
| round-157 后 | 4dde77eb（MILESTONE-NNN 裁定） | orchestration/SPEC-goal-store.md |
| round-158 起点 | （manager 持续编辑 SPEC） | orchestration/*.md |

每次：套件 GREEN 测了全部代码，但一个 doc-only 提交落在套件起点后 ⇒ freshness fail-closed ⇒ 重跑 17 分钟。**这是「验证成本 vs 机械严格」的失衡——文档编辑不影响测试结果，却触发完整重测。**

**为什么重要**：SPEC 活跃期（manager 持续写 SPEC / 迁 AC）doc-only 提交是常态，每绿必被挡 ⇒ ff 几乎无法推进。且与 `--skip-freshness-gate` 的设计意图冲突——那个开关是给「测试 OTHER gates 隔离」的调用方，不是给「bookkeeping-only 提交骑绿」。

**修的方向（实现归内层）**：
- 候选 A：**doc-only 豁免**——freshness gate 检查「未测的提交是否全 doc-only」（`git diff --name-only <suite-tip>..<integration-tip>` 全是 `.md`/`.jsonl`）⇒ 豁免（文档不改变测试面）；含任一代码文件 ⇒ fail-closed。
- 候选 B：**--skip 语义扩展**——`--skip-freshness-gate=doc-only` 显式白名单：调用方（外层）判断本批是否 doc-only 后传参。**风险**：把判断留给调用方，可被滥用。
- 候选 C：**分两笔合**——doc-only 提交单独 ff（无需套件），代码提交走 freshness gate；但两线模型下 integration 必须整体 ff，分笔会破坏不变式。

**验证锚**：修后，(a) doc-only 提交落在套件起点后 ⇒ 批量合仍通过（不重跑）；(b) 含代码文件的提交落在套件起点后 ⇒ 仍 fail-closed（不回归）；(c) 现有 freshness gate 测试全绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 3 次 doc-only 挡实例（phase-goal / SPEC-goal-store / 持续 SPEC 编辑）+ 每次重跑 17min 成本（本任务 Proposal 已含；内层补构造：doc-only 提交 vs 代码提交各一次）
- [ ] AC2: **doc-only 豁免**——freshness gate 检查未测提交是否全 doc-only（`git diff --name-only` 全 `.md`/`.jsonl`）⇒ 豁免不重跑
- [ ] AC3: **代码提交不豁免**——含任一代码文件 ⇒ 仍 fail-closed（负控制）
- [ ] AC4: **--skip 语义不混淆**——现有 `--skip-freshness-gate` 调用方（OTHER gates 隔离）不受影响
- [ ] AC5: **既有机制不回归**——`--for-task` scoped 门绿（integration-batch-merge 相关测试）

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：doc-only 提交骑绿通过（不重跑）、代码提交仍挡（贴任务体）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/integration-batch-merge.sh（freshness gate 加 doc-only 检测）
- plugin/test/integration-batch-merge.test.mjs（新增：doc-only 豁免 + 代码不豁免）
- tasks/gap-batch-merge-freshness-gate-doc-only-exemption.md（自身：勾 AC + 贴证据）

## Contract

measure   doc_only_merge_passes = `bash plugin/scripts/integration-batch-merge.sh --root <ws> --develop develop --integration integration --dry-run 2>&1 | grep -c "FRESHNESS-GATE FAIL-CLOSED"` 的 stdout 数字
band      doc_only_merge_passes = 0（doc-only 骑绿通过，不重跑）
invariant code_commit_still_fail_closed = 1（含代码文件 ⇒ 仍挡）
invariant skip_semantics_preserved = 1（现有 --skip 调用方不受影响）
invoke    `bash plugin/scripts/integration-batch-merge.sh --root <ws> --develop develop --integration integration --dry-run`（doc-only 与代码构造各一次贴回）
control   doc-only ⇒ 通过；代码 ⇒ 挡；--skip 语义不变
resume    doc-only 检测 + 豁免 + 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-09
changed: 建任务（freshness gate 连续 3 次被 doc-only 提交挡——SPEC 活跃期 doc-only 是常态，每绿必挡、每挡 17min；机械 gate 无法区分文档与代码。实现归内层）
