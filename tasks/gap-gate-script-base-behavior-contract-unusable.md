---
id: gap-gate-script-base-behavior-contract-unusable
title: 共享基座的行为契约无人取用（emitPass/emitFail 0 处、parseArgs 5/88），120 个 checker
  各自手搓退出码——先修接口让它装得下真实 checker 形状，再谈迁移
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**现场实测（2026-09-04）**：`plugin/scripts/` 有 **120 个 checker**，全部实现同一份契约（解析参数 →
求值 → 输出裁决 → 按约定退出码退出）。这份契约是**真实且被机械验证**的——实跑
`checker-mechanical-spine-check.ts --json` → `{"ok": true, "checkers": 114}`。共享基座
`gate-script-base.ts`（201 行）确实存在、被广泛 import。但取用分布是：

| 基座导出 | 取用文件数 | 性质 |
|---|---|---|
| `isDirectEntry` | 100 | 样板 |
| `helpExit` | 50 | 样板 |
| `parseArgs` | **5**（另 83 个手搓 `process.argv`） | **行为契约** |
| `emitPass` / `emitFail` | **0**（83 个手搓 `process.exit`/`exitCode`） | **行为契约** |

**⇒ 共享的是帮助文本和入口判断，不是行为。参数解析 94% 手搓，裁决输出 100% 手搓。**

**这个缺失的抽象有可点名的账单**：CLAUDE.md 硬规则 3b 记录，判定机件在**读不懂输入时**返回了与
**合格**同形的值——一天内三个互不相关的机件同时中招（`task-status-drift-check.ts:126`、
`slot-refill.ts:373`、`outer-tick-log-check.sh` 每条分支都跳过却打印 PASS）。**这三个缺陷之所以
可能发生，正是因为每个 checker 自己手搓裁决输出**；若裁决必须经由基座的
`emitPass`/`emitFail`/`emitNotEvaluated`（第三态是一等公民），"读不懂 ⇒ 输出得像合格"在结构上做不到。

**范围声明（本任务只做接口，不做 120 文件迁移）**：`emitPass`/`emitFail` 取用为 0，最可能的解释
**不是"大家偷懒"，而是接口装不下真实 checker 的形状**（多数 checker 要输出结构化 `--json`
verdict、要带 violations/exemptions 列表、要区分三态，而 `emitPass(message)` 只收一个字符串）。
**所以第一步是修接口，不是催迁移**——先让契约能装下现有 114 个通过机械验证的 checker 的真实输出
形状，迁移作为后续任务（其 Touches 宽度需分批，不在本任务内）。

**本任务不声明 `extra.consolidates`**：它本身不消灭任何重复实现，只是让后续消灭成为可能。
按 [[gap-dispatch-value-has-no-consolidation-axis]] 的反刷分要求，**没有真实收敛就不该拿那条轴的
权重**——此处按该纪律执行，作为该机制的第一个正面用例。

## AC

- [ ] AC1（先量清楚接口为什么装不下）：抽样 ≥10 个现有 checker 的裁决输出路径，列出它们各自实际
      产出的形状（纯文本 / 结构化 JSON / violations 列表 / 三态），并对照 `emitPass(message)` 的
      现有签名，逐条说明装不下的具体原因——贴真实代码片段，不是概括
- [ ] AC2：重设计基座的行为契约，使其能装下 AC1 列出的全部形状，且**必须包含 not-evaluated 第三态**
      （硬规则 3b：无法评估不得与合格同形）；新接口须能表达 `--json` 结构化 verdict
- [ ] AC3（用真实 checker 验证接口可用，不是用 fixture）：把 **≥5 个真实 checker** 迁移到新接口
      （挑选覆盖 AC1 里不同输出形状的样本），迁移后它们的
      `checker-mechanical-spine-check.ts --json` 仍报 `ok:true`，且各自既有单测全绿
- [ ] AC4（取用率真实上升，可核验）：`grep -rl "emitPass\|emitFail" plugin/scripts/*.ts | wc -l`
      从 **0** 升到 ≥5（贴改动前后真实输出）——这条是本任务是否真的落地的硬判据
- [ ] AC5：`bash scripts/test.sh` 全量绿

## DoD

AC1 的形状清单（真实代码片段）、AC4 的 0→≥5 前后读数贴进任务体。**不是"改好了接口"就算**——
接口若无人取用，它就是今天这个状态的第二版；AC3/AC4 要求用 ≥5 个真实 checker 证明新接口装得下，
否则本任务的产出与现状不可区分。迁移剩余 checker 属后续任务，不在本 DoD 内。

## Touches

- plugin/scripts/gate-script-base.ts（行为契约重设计）
- plugin/scripts/checker-mechanical-spine-check.ts（契约验证器随之对齐）
- plugin/test/gate-script-base.test.mjs
- plugin/test/checker-mechanical-spine-check.test.mjs
- tasks/gap-gate-script-base-behavior-contract-unusable.md
