---
id: gap-task-file-static-syntax-should-not-block-product-verification
title: 任务文件 Contract/AC 语法静态违规吃验证机会——近 48h 21/119 轮（18%）被 task-file 语法吃掉、28
  条失败全是 tasks/*.md 零代码；每 5-6 次验证机会就有 1
  次被前者消耗；「任务文件语法」与「产品代码可用」是两类风险，前者不该有权停掉后者的验证；修法=①降级为只增不减 ratchet 记账不置红，或 ②只阻断
  fan-in 不阻断验证轮
status: done
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

- [x] AC1: **复现固化**——任务体记录 21/119（18%）static-check 轮 + 28 条失败全 task-file + Top 对象 + 284s 机器时间（本任务 Proposal 已含）
- [x] AC2: **任务文件语法不阻塞产品验证**——（选①）违规 ratchet 记账不置红，或（选②）只阻断 fan-in 不阻断验证轮
- [x] AC3: **违规仍可查**——记账/门在（ratchet 只增不减或 fan-in 门）
- [x] AC4: **既有不回归**——`--for-task` scoped 门绿；任务文件语法仍被跟踪

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 修后实跑：构造任务文件 Contract 语法违规 ⇒ 验证轮照跑（贴轮次记录）+ 违规被记账
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
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

## 实跑证据（inner 2026-08-11，选定 ① 只增不减 ratchet 记账，不置红）

**选择 ① 的理由**（裁定权在 outer，inner 实现选①）：
- C14 早已写「task-contract-check.ts（报出不阻断）」——文档是"报出不阻断"，代码（ratchet growth → exit 1）落后；①让代码追上文档（`orchestration/orchestrator-tick-core.md` C14 已注明验证轮判据）。
- ①直接满足 Contract 两条 invariant：`product_verification_not_blocked = 1`（任务文件语法违规不再阻断验证轮）+ `syntax_still_tracked = 1`（违规被 `.quay/task-file-violation-ledger.jsonl` 只增不减记账）。
- ②（只阻断 fan-in）要把「任务文件违规存在」的信号从验证轮线程到 fan-in 门，跨机制耦合更大；①在检查器层就地降级，改动最小、可测性最好。

**实现（3 个 commit，worktree `task/gap-task-file-static-syntax-should-not-block-product-verification`，fork develop 2060210c）**：
- `8b626097` — 实现：`task-contract-check.ts` + `task-ac-carryover-check.ts` 增 `--no-block`（新违规记账不置红，输出避开 runner 的 `new since baseline: N` 失败标记）；`scripts/test.sh` `run_static_checks` 两个任务文件检查器接 `--no-block`（scoped tier 经解析命令行继承）。默认（无 `--no-block`）保持阻断——维护/变异测试路径不变。
- `2cc91934` — 测试：`task-contract-check.test.mjs` / `task-ac-carryover-check.test.mjs`（--no-block 不置红 + ledger 去重）、`scoped-static-checks.test.mjs`（scoped 命令继承 --no-block）、`full-suite-runner.test.mjs`（--no-block 任务文件轮 = state=green，非 reason=static-check）。
- `c33ca7f4` — 文档：`orchestrator-tick-core.md` C14 验证轮判据 + `gap-full-suite-state-red-no-failure-detail-static-check-invisible.md` 交叉标注。

**AC1 复现固化**：本任务 Proposal「实证」段已含 21/119（18%）+ 28 条全 task-file + Top 对象 + 284s——确认即可。

**AC2 任务文件语法不阻塞产品验证（选①）**：`--no-block` 下 ratchet growth（新违规）exit 0、验证轮照跑。实跑（synthetic workspace，`task-contract-check.ts`，新违规 measure-no-command 等 2 条）：
```
node --no-warnings --experimental-strip-types plugin/scripts/task-contract-check.ts --root <ws> --no-block
# => exit 0；输出：recorded (non-blocking, grow-only ledger): 2 new task-file violation(s) — task-file syntax does NOT block the verification round
```
对照：同 store 无 `--no-block` → `new since baseline: 2` + exit 1（既有阻断路径不变）。

**AC3 违规仍可查（ratchet 只增不减记账）**：新违规写 `.quay/task-file-violation-ledger.jsonl`（gitignored 运行时记账，与 verification-round.jsonl 同族），按 `(checker, violation)` 去重、只增不减。实跑：首次 2 行 → 重跑仍 2 行（不重复追加）。`task-ac-carryover-check.ts --no-block` 同（key `task-ac-carryover-check|bad: AC1`）。

**AC4 既有不回归 + scoped 门绿**：`bash scripts/test.sh --for-task gap-task-file-static-syntax-should-not-block-product-verification --allow-thin` → **EXIT 0，71 tests / 69 pass / 0 fail / 0 cancelled / 2 skipped**（governance real-store opt-in）。scoped 静态层含 `task-contract-check.ts --no-block --strict-subset <touched task files>`（确认 --no-block 继承；本任务 + 兄弟姐妹任务文件均干净）。既有测试原样绿：AC6 ratchet 阻断（`new since baseline: 7` → exit 1）、AC4-i strict-subset 阻断（`measure-no-field` → exit 1）。

**DoD 修后实跑（构造任务文件 Contract 语法违规 ⇒ 验证轮照跑 + 违规被记账）**：
- 检查器层：违反任务 → `--no-block` exit 0 + ledger 记账（AC2/AC3 实跑即此）。
- runner 层：`full-suite-runner.test.mjs` 新增用例「--no-block 任务文件轮（VIOLATION + recorded-not-blocking + 绿测试相）→ state=green，非 reason=static-check」——验证轮不被任务文件语法吃掉。

**DoD 全量套件绿**：外层 verification-round 的批量合边界闸门，非任务级（`gap-suite-green-gate-duplicated-in-task-dod-and-batch-merge` 已移除任务级那份）；本任务只跑 `--for-task` scoped。
