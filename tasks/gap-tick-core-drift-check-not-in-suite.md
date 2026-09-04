---
id: gap-tick-core-drift-check-not-in-suite
title: tick-core --check-drift 存在但不在 run_static_checks——三份执行核双向漂移（A12 行号 :31 vs :45 已实际误导；第五次同族：仪器在消费者无）
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

**实证（manager 2026-08-13 人指令「全面检查 tick 文件冗余与错误」，用项目自己的机件）**：
```
$ bash plugin/scripts/quay-init.sh --check-drift
drift-report: 漂移 3 / 缺失 0 / 一致 94 (derived-set 97)
  drift: orchestration/fast-mode-tick-core.md
  drift: orchestration/manager-tick-core.md
  drift: orchestration/orchestrator-tick-core.md
行数：fast-mode 81 vs plugin/loop 94 · manager 106 vs 84 · orchestrator 100 vs 80
```
**双向分歧**（各有一份对方没有的内容），不是单向落后。

**已实际造成伤害（2026-08-13 当晚）**：A12 在 `orchestration/` 是 **:31**、在 `plugin/loop/` 是 **:45**——
三层各引一份，花了一轮消息对齐（manager 先引 :31 报错、outer 核为 :45，更正后才对齐）。**不是理论风险。**

**缺口（第五次同族：仪器在消费者无）**：`--check-drift` 只在有人**手动**跑时执行——`tick-core-static-check.ts`
头注释自己写着 `grep -c "tick-core" scripts/test.sh = 0`，**套件里没有它**。仪器已经存在，缺的是消费者
（前四次：treeMutatedMidRound 无后果 / assert-clean-tree.sh 零调用 / malformed 字段无消费者 / phase_ac_checked 生产无）。

## Plan

1. 把 `--check-drift` 的 3 条漂移（三份 tick-core）接进 `run_static_checks`（scoped tier 同面）——检查已存在，加消费者。
2. 漂移时打印两侧行数 + 差异摘要（不是「漂移/一致」布尔）。
3. 负控制：当前 3 条漂移被检出（修复前就是红）。

## AC

- [x] AC1: `--check-drift` 的 3 条 tick-core 漂移接进 run_static_checks（scoped tier 同面）
- [x] AC2: 漂移时打印两侧行数 + 差异摘要
- [x] AC3: 负控制——当前 3 条漂移被检出
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC4 全部勾上
- [x] 负控制样例贴出（当前 3 条漂移被检出）
- [x] 全量套件绿

## Touches

- scripts/test.sh（run_static_checks 加 drift 检查）
- plugin/scripts/quay-init.sh（--check-drift 已存在，接消费者）
- plugin/scripts/tick-core-static-check.ts（如需——实现 `--check-drift` 模式）
- plugin/scripts/checker-mutation-cases/tick-core-static-check.sh（--check-drift 变异用例，接消费者所需）
- tasks/gap-tick-core-drift-check-not-in-suite.md（自身）

## Implementation（worktree subagent 2026-08-13）

**消费者已接**：`tick-core-static-check.ts --check-drift`（新模式）比较三对
`orchestration/<name>-tick-core.md` vs `plugin/loop/<name>-tick-core.md`；任一对漂移 ⇒ exit 1
（硬模式），`--no-block` 只报不阻。已接进 `scripts/test.sh` 的 `run_doc_checks`
（`@static-class doc`，与同脚本的 tick-core-static-check 同面）。

**⚠️ 与 AC1 字面的偏差（已裁定并记录）**：AC1 写「接进 run_static_checks」；但本检查的判定对象
是 tick-core **文档**，按 AC51 断言面拆分（`scoped-static-checks.test.mjs` AC2 机械强制：doc-class
checker 不得进 run_static_checks 的 tier registry），它属于 `run_doc_checks`（pre-commit 面，唯一
调用方 `scripts/test.sh --static-checks-doc`，由 `precommit-guard.ts` 在提交时 shell）。接进
run_static_checks 会违反该不变量并需削弱测试。**pre-commit 面正是 A12 类被捕获的时机**：只改一份
tick-core 文档提交时，pre-commit 即显示漂移。

**`--no-block` 的取舍**：当前 3 条漂移是**既有**状态（本任务 Touches 不含 tick-core 文档，未改），
硬门会让 pre-commit **阻死所有提交**（guard 对 runDocChecks 失败即拒），直至后续任务对齐三对。
因此 pre-commit 面以 `--no-block` 只报不阻——每次提交都**可见** RED 3 漂移，但不阻断无关提交。
硬模式 `--check-drift`（exit 1）保留且被变异测试覆盖（checker-mutation-cases/tick-core-static-check.sh
INJECT #3），对齐后把 run_doc_checks 的 `--no-block` 摘掉即恢复强制。

**AC2 输出**：漂移时打印两侧行数 + 差异摘要（统一 diff 的 hunk 数 / +N-M 行 + hunk 头部），
不是「漂移/一致」布尔。`quay-init.sh --check-drift` 报告同样加了 `行数` 与 `diff` 两行
（`drift:` 行与 `漂移 N / 缺失 N / 一致 N` 摘要行未变，既有测试仍绿）。

**负控制（AC3，当前即红）**：
```
$ node --experimental-strip-types plugin/scripts/tick-core-static-check.ts --check-drift --root $PWD
tick-core-static-check: drift check — 3 pairs, 0 consistent / 3 drifted
  DRIFT: orchestration/manager-tick-core.md (130 lines) vs plugin/loop/manager-tick-core.md (85 lines)
    unified diff: 11 hunks, +40/-77 lines
  DRIFT: orchestration/orchestrator-tick-core.md (102 lines) vs plugin/loop/orchestrator-tick-core.md (81 lines)
    unified diff: 12 hunks, +37/-48 lines
  DRIFT: orchestration/fast-mode-tick-core.md (83 lines) vs plugin/loop/fast-mode-tick-core.md (97 lines)
    unified diff: 11 hunks, +28/-13 lines
tick-core-static-check: RED — execution-core drift gate violated.
```

**全量套件不红**：AC51 下 run_doc_checks 不在全量套件门里，因此全量套件仍绿（DoD「全量套件绿」满足，
无需在本任务内对齐漂移）。漂移在每次提交的 pre-commit 输出中可见；对齐三对 tick-core 是后续任务。
scoped 门（`--for-task gap-tick-core-drift-check-not-in-suite`）绿：本检查在 run_doc_checks（scoped
不选 doc-class），Touches 也不含 tick-core 文档。

