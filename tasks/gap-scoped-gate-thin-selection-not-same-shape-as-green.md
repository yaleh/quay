---
id: gap-scoped-gate-thin-selection-not-same-shape-as-green
title: scoped 门取零个测试文件时与「绿」同形：第三方契约缺「thin ⇒ not-evaluated」这一半
status: done
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

- [x] `node --test plugin/test/third-party-capability-degradation.test.mjs plugin/test/worker-driver.test.mjs` 退出 0，新增用例：第三方夹具的 scoped 命令输出 thin 标记并 exit 0 ⇒ fan-in 的 scoped 门取值为 `not-evaluated`（不是 `green`/`ok:true`），且 step trace 记录中可读出这个取值。
- [x] 取假：scoped 命令真实执行 ≥1 个测试文件并全绿 ⇒ 取值为 `green`；执行了且有红 ⇒ `red`。三态两两不同形（同一用例文件内断言）。
- [x] quay 自身 `bash scripts/test.sh --for-task <某个 Touches 无测试文件的任务> --allow-thin` 的行为不回归（附实跑输出）。
- [x] `bash scripts/test.sh --for-task gap-scoped-gate-thin-selection-not-same-shape-as-green` 退出 0，且执行了 ≥1 个测试文件。

## 判定读数（实现完成当轮实测，worktree 内；完整证据 → `.quay/ac316-scoped-thin-evidence.md`）

**实现**：`worker-fan-in.ts` 新增 `SCOPED_THIN_MARKER` / `parseScopedThin`（按【行首】位置判定）/ `scopedGateVerdict`（skip·cache-hit·run 三入口的单一真相源）；`step()` 加 `endExtra` 形参，使取值与 `ok`/`durationMs` 落在同一条 `step-end` 记录里；step 6 三个分支都写 `verdict`（`ok` 保持控制流语义，取值由 `verdict` 承载）。`not-evaluated` ⛔ 不让 fan-in 失败（全量 suite 照跑）。`SKILL.md` 增「The scoped gate's output contract」节（含 (a)/(b) 分类规则与四取值记录表）；`integration-batch-merge.ts` 的自测提示补一句「scoped 一个文件都没选中不是自测绿」。

- **AC1**：`node --test third-party-capability-degradation.test.mjs worker-driver.test.mjs` → `pass 113 / fail 0`，exit 0。新增用例走**真 fan-in**（`runMechanicalFanIn`）+ 真 `node --test` 执行（输出落盘断言 `pass 1`/`fail 1`）+ 真 trace 读回（共享载体 `.quay/fan-in-step-trace.jsonl` 与 per-run 日志同取值）。
- **AC2**：三 arm 取值 `not-evaluated` / `green` / `red`，`new Set(...).size === 3`；且 `{verdict:'not-evaluated', ok:true}` ≠ `{verdict:'green', ok:true}`（修复前二者都是 `{ok:true}`）。
- **AC3**：`bash scripts/test.sh --for-task DIR-079 --allow-thin` → exit 0，末行原文 `scripts/test.sh: --for-task DIR-079 — selector selected 0 test files (thin allowed); nothing to run, full suite still runs at fan-in`（未回归；`scripts/test.sh:1667-1670` 未动，不在本任务 Touches 内）。
- **AC4**：选择面 3 个测试文件（`plugin/test/{integration-batch-merge,third-party-capability-degradation,worker-driver}.test.mjs`）⇒ `bash scripts/test.sh --for-task <本任务> [--allow-thin]` → `tests 160 / pass 160 / fail 0`，exit 0（合并 develop `936e7f0bf` 后重跑同值）。
- **DoD（真实落地）**：在 claudecodeui 的 scratch 副本（活工作区不得被 worker 触碰）上，用**本任务 worktree 的代码**跑 `worker-driver.ts --mechanical-fan-in`，任务 `gap-voice-upload-leg-unmeasured-under-shipped-recogniser`（真实任务，Touches 无任何 `*.test.*`）：
  - 采纳前（同一代码）：`{"step":"scoped-gate","runId":"ac316-prod-read-1",…,"ok":true,…,"verdict":"green"}` ← 缺陷在真实第三方面复现；
  - 采纳后（`scripts/test.sh` thin 分支加一行 `echo "SCOPED-THIN selected=0"`，提交 `486ceec6`，其余逐字未改）：走完全程（merge-develop→anti-drift→typecheck/doc-check→scoped-gate→suite-skip→anti-drift-land→ac-gate→ff，`outcome:"landed"`）且记录原文为
    `{"event":"step-end","step":"scoped-gate","task":"gap-voice-upload-leg-unmeasured-under-shipped-recogniser","runId":"ac316-prod-read-2","ts":"2026-09-23T16:53:03.952Z","epoch":1790182383,"ok":true,"durationMs":219,"verdict":"not-evaluated","reason":"scoped-thin(selected=0)"}`。
- **残留（如实记录，均在本任务 Touches 之外）**：① 未采纳该接口的第三方仍与绿同形——契约的代价，⛔ 不做「无标记即 not-evaluated」的 fail-closed（须先有发生率读数，硬规则 12）；② quay 自身 `scripts/test.sh` 未打该标记（其 stderr 明说 thin，仅人可读），建议随下一次触碰该文件的任务带上；③ worker 侧 pre-merge scoped 缓存在 thin 轮仍会写绿条目（`worker-driver.ts --write-scoped-gate-cache`），develop 前进即自然失配照跑。

## DoD

真实落地判据：在一个第三方项目（claudecodeui）上，一个 Touches 不含测试文件的真实任务走完一次机械 fan-in，其 `.quay/fan-in-step-trace.jsonl` 中该任务的 `scoped-gate` 记录读出 `not-evaluated`（而不是 `ok:true`）。完成记录附该记录原文与任务 id。

**已达成**（见上「判定读数 → DoD」）：任务 id `gap-voice-upload-leg-unmeasured-under-shipped-recogniser`，记录原文逐字附于证据文件 `.quay/ac316-scoped-thin-evidence.md`。执行承载 = scratch 副本（活工作区由它自己的 driver 驱动，worker 不得介入），采纳动作 = DoD 要求的第三方那一行改动，其余逐字未改。

## Touches

- plugin/scripts/worker-fan-in.ts
- plugin/scripts/integration-batch-merge.ts
- plugin/skills/init/SKILL.md
- plugin/test/third-party-capability-degradation.test.mjs
- plugin/test/worker-driver.test.mjs
- tasks/gap-scoped-gate-thin-selection-not-same-shape-as-green.md
