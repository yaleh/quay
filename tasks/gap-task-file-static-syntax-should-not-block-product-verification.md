---
id: gap-task-file-static-syntax-should-not-block-product-verification
title: "任务文件 Contract/AC 语法静态违规吃验证机会——近 48h 21/119 轮（18%）被 task-file 语法吃掉、28 条失败全是 tasks/*.md 零代码；每 5-6 次验证机会就有 1 次被前者消耗；「任务文件语法」与「产品代码可用」是两类风险，前者不该有权停掉后者的验证；修法=①降级为只增不减 ratchet 记账不置红，或 ②只阻断 fan-in 不阻断验证轮"
status: todo
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**任务文件的 Contract/AC 语法静态违规在消耗验证机会——量化实证（manager 2026-08-11 08:3x）。** 近 48h `reason` 分布 = failed 71 / **static-check 21** / aborted 10 / None 17；逐条查那 21 轮的失败对象——**28 条失败全部是 `tasks/*.md` 的 Contract/AC 语法，零条代码或脚本**。Top 对象（各 2 次）：gap-crosscut-checks / gap-install-upgrade-verification / gap-session-liveness-busy-mask / gap-suite-empty-wait / gap-suite-fix-merge-subagent / gap-suite-round-record / gap-verify-delivery-surface / gap-worktree-leak。⇒ **18% 的验证尝试（21/119 轮）被任务文件语法吃掉。** 机器时间只有 284s（均 14s，静态检查前置正确），但**每一轮消耗掉一次验证机会**——48h 内跑满全量的只有 25 轮 ⇒ **每 5-6 次验证机会就有 1 次被前者消耗**。

**这是 manager 05:38 结构建议的量化版**：「任务文件的 Contract 语法」与「产品代码是否可用」是两类风险，前者不该有权停掉后者的验证——现在有数了。

### 实证（manager 2026-08-11 08:3x 量化 + outer 复核）

- **reason 分布（近 48h，119 轮口径）**：failed 71 / static-check 21 / aborted 10 / None 17。
- **static-check 轮失败对象**：28 条全为 tasks/*.md Contract/AC 语法，零代码/脚本。
- **18% 消耗率**：21/119 验证尝试被任务文件语法吃掉；机器时间仅 284s（静态检查前置对），但消耗的是验证机会。
- **修正**：aborted 只占 8%（10/119、87s），是突发非常态（manager 差点误把 aborted 当 CPUQuota 论据，已更正——CPUQuota 理由是 main 相耗时，不是 aborted 频次）。

### 选定机制方向（实现归 inner，判定归 outer——裁定权在 outer）

**修法两条之一（manager 05:38 原给，裁定权在本任务）**：
1. **① 任务文件类静态违规降级为只增不减的 ratchet 记账，不置红**——违规记账但放行验证轮；ratchet 只增不减防静默恶化。
2. **② 或让它只阻断 fan-in、不阻断验证轮**——任务文件写错不让产品代码等下一轮 28 分钟；验证轮照跑，fan-in 前修。

**验证锚**：修后 (a) 任务文件 Contract 语法违规不再让整轮 red（或不再阻断验证轮）；(b) 违规仍被记账（ratchet 或 fan-in 门）；(c) 产品代码验证不被任务文件语法阻塞；(d) `--for-task` scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 21/119（18%）static-check 轮 + 28 条失败全 task-file + Top 对象 + 284s 机器时间（本任务 Proposal 已含）
- [ ] AC2: **任务文件语法不阻塞产品验证**——（选①）违规 ratchet 记账不置红，或（选②）只阻断 fan-in 不阻断验证轮
- [ ] AC3: **违规仍可查**——记账/门在（ratchet 只增不减或 fan-in 门）
- [ ] AC4: **既有不回归**——`--for-task` scoped 门绿；任务文件语法仍被跟踪

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：构造任务文件 Contract 语法违规 ⇒ 验证轮照跑（贴轮次记录）+ 违规被记账
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- scripts/test.sh（run_static_checks：任务文件类静态违规降级/分流的判定）
- plugin/scripts/task-contract-check.ts（任务文件类静态检查——降级/分流落点）
- plugin/scripts/task-ac-carryover-check.ts（任务文件类静态检查——降级/分流落点）
- orchestration/orchestrator-tick-core.md（C14 或验证轮判据注明）
- tasks/gap-full-suite-state-red-no-failure-detail-static-check-invisible.md（交叉标注——同一静态检查层，本任务治「该不该阻断」）
- tasks/gap-task-file-static-syntax-should-not-block-product-verification.md（自身：勾 AC + 贴证据）

## Contract

measure   static_check_rounds = `python3 -c "import json; from collections import Counter; c=Counter(); [c.update([json.loads(l).get('reason') or 'None']) for l in open('.quay/verification-round.jsonl')]; print(c.get('static-check',0))"` 的 stdout 数字
band      static_check_ratio_reduced = (static_check_rounds / total_rounds < 0.05)（48h 基线 18%→目标 <5%——AC2 引用名）
invariant product_verification_not_blocked = 1（任务文件语法违规不再阻断验证轮）
invariant syntax_still_tracked = 1（违规仍被 ratchet 记账或 fan-in 门跟踪）
invoke    `bash scripts/test.sh --for-task gap-task-file-static-syntax-should-not-block-product-verification --allow-thin`（贴 scoped 门绿）
control   任务文件语法不阻断验证；违规仍可查；既有不回归
resume    降级/分流实现 / scoped 门 / 全量验证分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-11
changed: manager 08:3x——近 48h 21/119 轮（18%）被任务文件 Contract/AC 语法吃掉、28 条失败全 task-file 零代码；每 5-6 次验证机会 1 次被消耗；「任务文件语法」与「产品代码可用」两类风险，前者不该停掉后者验证。修法二选一（①ratchet 记账不置红 / ②只阻断 fan-in）：裁定权在 outer。实现归 inner，判定归 outer
