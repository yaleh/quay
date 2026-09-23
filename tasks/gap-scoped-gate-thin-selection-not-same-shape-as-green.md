---
id: gap-scoped-gate-thin-selection-not-same-shape-as-green
title: scoped 门取零个测试文件时与「绿」同形：第三方契约缺「thin ⇒ not-evaluated」这一半
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-316
---
## Proposal

**机制**：机械 fan-in 的 scoped 门对「本仓库形态」的项目**无条件**传 `--for-task <task> --allow-thin`（`plugin/scripts/worker-fan-in.ts:151` `resolveScopedGateCommand`）；`plugin/scripts/integration-batch-merge.ts:916`（0.10.0 时在 `integration-batch-merge.sh:948`）也建议 worker 这样自测。在 quay 自己的 `scripts/test.sh` 里这不构成假绿：带 `--allow-thin` 取零个文件时会明确打印「nothing to run, full suite still runs at fan-in」（`scripts/test.sh:1621-1623`），不带时 exit 非零。但**这条契约只写在 quay 自己的实现里**，没有写成第三方可遵循的接口。

**生产实例（claudecodeui）**：项目 `scripts/test.sh:114` 照抄了「取零个文件 ⇒ `exit 0`」，打印 `no scoped test files for <id> (thin)`。对于交付物是 `scripts/*.sh` 的任务，`--for-task` 从 `## Touches` 抽到 0 个 `*.test.*` ⇒ **取不了假的绿**。项目不得不自造守卫 `scripts/suite-scope-check.sh`（`gap-worker-selfcheck-scoped`）来区分「scoped 语义成立」与「scoped 会被掏空」。fan-in 侧把这次 scoped 门记成 `ok`，与「真的跑了且全绿」**同形**（硬规则 3b）。

**修法（方向）**：
1. 把 scoped 契约写成接口：scoped 命令取零个文件时，必须输出一个**与绿可区分**的标记（例如 stdout 一行 `SCOPED-THIN selected=0`，或专用退出码）。由 `gap-repo-shape-inferred-from-test-sh-existence` 提供的 `loop.scoped_command` 声明来承载。
2. fan-in 把这种结果记成 `scoped=not-evaluated`（附原因），⛔ 不记 `green`；step trace 的 `scoped-gate` 记录带上这个取值。
3. 把 claudecodeui 的 (a)/(b) 分类规则（有测试文件 ⇒ 必须 scoped；无测试文件 ⇒ 跑自己交付的检查器）上收为 quay 的通用守卫或 `task check` 的一条校验，供第三方复用。
4. `plugin/skills/init/SKILL.md` 写明第三方 scoped 命令的输出契约。

<!-- dedup-ref -->相关：claudecodeui 的 `gap-worker-selfcheck-scoped`（done）是下游的自救；本任务把契约上收到 quay。本任务是 GOAL-027 / AC-316 的承载 task 之一。

## AC

- [ ] `node --test plugin/test/third-party-capability-degradation.test.mjs plugin/test/worker-driver.test.mjs` 退出 0，新增用例：第三方夹具的 scoped 命令输出 thin 标记并 exit 0 ⇒ fan-in 的 scoped 门取值为 `not-evaluated`（不是 `green`/`ok:true`），且 step trace 记录中可读出这个取值。
- [ ] 取假：scoped 命令真实执行 ≥1 个测试文件并全绿 ⇒ 取值为 `green`；执行了且有红 ⇒ `red`。三态两两不同形（同一用例文件内断言）。
- [ ] quay 自身 `bash scripts/test.sh --for-task <某个 Touches 无测试文件的任务> --allow-thin` 的行为不回归（附实跑输出）。
- [ ] `bash scripts/test.sh --for-task gap-scoped-gate-thin-selection-not-same-shape-as-green` 退出 0，且执行了 ≥1 个测试文件。

## DoD

真实落地判据：在一个第三方项目（claudecodeui）上，一个 Touches 不含测试文件的真实任务走完一次机械 fan-in，其 `.quay/fan-in-step-trace.jsonl` 中该任务的 `scoped-gate` 记录读出 `not-evaluated`（而不是 `ok:true`）。完成记录附该记录原文与任务 id。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/integration-batch-merge.ts
- plugin/skills/init/SKILL.md
- plugin/test/third-party-capability-degradation.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/gap-scoped-gate-thin-selection-not-same-shape-as-green.md
