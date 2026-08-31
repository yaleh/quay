---
id: gap-b2-repo-root-unification
title: B2·repo-root 合一——findRepoRoot(14)+findWorkspaceRoot(4) 三策略并存，18 处 →
  1（bash+TS 成对）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

SPEC §1.6/§2.4 实测：`findRepoRoot`(14) + `findWorkspaceRoot`(4) 是**同一函数体在两个名字下逐字节重复**（5 份 body hash 相同；另有 4 处已跨文件 import 对方版本），TS 16 处 + bash 9 处三种策略并存。`path.resolve(__dirname,'..','..')` 已实测在 worktree 下解析正确（非正确性缺陷，是可维护性问题——三种策略并存）。目标是单一 `repoRoot` 实现（TS + bash 成对），其余全部引用它。

## Plan

抽 `repoRoot` 单一实现（TS 一份 `plugin/scripts/repo-root.ts` + bash 一份 `plugin/scripts/repo-root.sh`，成对）；18 处 TS 调用点逐批迁移（每批 Touches 可控，避免大范围移动触发 §4 的目录级 Touches 自阻塞）；棘轮：新代码禁用裸 `findRepoRoot`/`findWorkspaceRoot` 重定义。⛔ 不改 `packages/`（场景 A 架构合理，§3.1）。worktree 正确性 + 负控制测试放 `plugin/test/repo-root-unification.test.mjs`。⛔ 新建文件按上述命名落地，不另取名。

## Acceptance Criteria

- [x] AC1（能取假，单一来源）：`repoRoot` 单一实现（TS + bash 成对）存在，`findRepoRoot`/`findWorkspaceRoot` 的独立定义数从 18 → 1（grep 计数）；（⛔ 仍 18 处 ⇒ 假）。— `grep -rnE "function (findRepoRoot|findWorkspaceRoot)" plugin/scripts/*.ts` 得 **0** 处；`grep -rnE "function repoRoot" plugin/scripts/*.ts` 得 **1** 处（`repo-root.ts`）；test `AC1 — repoRoot is defined exactly once` + `AC1 — no findRepoRoot/findWorkspaceRoot survives`。
- [x] AC2（能取假，负控制）：删共享 `repoRoot` 模块，18 处调用点的编译/运行必须红；（⛔ 删了不红 ⇒ 假——说明没真引用）。— 22 处旧局部定义全删、36 处消费点改 import `repo-root.ts`（22 定义 + 13 跨文件 import + 1 `precommit-guard.ts` 预存 `repoRoot` 的 git-only 版）；test `AC2 — deleting the shared export makes a consumer import fail`（scratch 删导出 ⇒ SyntaxError 红，恢复 ⇒ 绿）+ `AC2 — the bash pair is real`（`repo-root.sh` 被 capability-catalog.sh 消费，非死代码）。
- [x] AC3（能取假，worktree 正确性不回归）：`repoRoot` 在 task worktree 下解析正确（`plugin/` 是真实目录非符号链接，`__dirname/../..` 到 worktree 根）——测试断言；（⛔ worktree 下解析错 ⇒ 假）。— test `AC3 — plugin/ is a real directory, not a symlink`（lstat 断言）+ `AC3 — repoRoot(__dirname) resolves to the worktree/repo root` + bundle/git 合成树各 1 断言；全 10 测试在 worktree 下绿。

## Definition of Done

`repoRoot` 单一实现（TS + bash）；18 处迁移完；AC1/AC2/AC3 全勾；worktree 下解析正确。

## Evidence

- **单一来源**：`plugin/scripts/repo-root.ts`（TS，bundle→consumer→plain-git 三种标记向上走 + `git rev-parse --show-toplevel` + `process.cwd()` 兜底）+ `plugin/scripts/repo-root.sh`（bash 成对，同标记集）。`precommit-guard.ts` 预存的 `repoRoot`（git-only，`git rev-parse --show-toplevel`）一并迁移到共享实现——否则 `repoRoot` 仍 2 定义，违背「单一来源」。
- **36 处 TS 迁移**：22 处局部 `findRepoRoot`/`findWorkspaceRoot` 定义删除改 import（其中 17 findRepoRoot + 5 findWorkspaceRoot）+ 13 处跨文件 import 改直连 `repo-root.ts` + 1 处 `precommit-guard.ts` 预存 `repoRoot`。`select-tests-for-touches.ts` 有 findRepoRoot 定义但原 Touches 漏列，已补列。
- **棘轮 + 负控制 + worktree**：`plugin/test/repo-root-unification.test.mjs`（10 测试全绿）。
- **镜像双副本**：`task-status-drift-check.ts` 是 experiments↔plugin **真实字节一致副本**（非 symlink），已同步两副本 + 新建 `experiments/quay-perpetual-stream/scripts/repo-root.ts` symlink（→ plugin）供其 import 解析；其余 6 个 Touches 文件是 symlink 镜像（改 plugin 即同步）。
- **bash 侧**：`capability-catalog.sh` 的 `cd "${SELF_DIR}/../.."` 改 `repoRoot "${SELF_DIR}"`（`--superseded-check` 实测 PASS）。`refresh-worktree-quay.sh` 的 `git rev-parse --git-common-dir` 是**主检出推导**（非 repo-root 走查），无迁移面，Touches 保留但未改动。
- **新脚本注册（续轮补齐——首轮漏 4 处注册面 ⇒ scoped 门 red）**：① `capability-catalog.sh` 六表补 `repo-root.sh`/`repo-root.ts`（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER——unclassified 2→0，`--summary`/`--entry-surface` 全 PASS）；② `quay-init.sh` `_derive_loop_scripts_once` 显式清单补 `repo-root.sh`/`repo-root.ts`（closure (d) 只扫 `${SCRIPT_DIR}/` 且 ESM `./` import 不可见 ⇒ laid-down catalog/precommit-guard 缺依赖）；③ `docs/proposals/quay-product-outline.md` §6 快照 `--write-inventory` 再生（scripts 296→298）；④ `precommit-guard.test.mjs`/`select-static-checks-for-touches.test.mjs` 的 copy 清单补 repo-root（AC1 e2e / AC2 复制真实 catalog 到临时树需依赖）。scoped 门 932/932 绿，catalog/laydown-closure/entry-surface/quay-init-loop 全绿。
- **mutation 夹具补齐（续轮——上轮 scoped 门绿但 suite red，机械 fan-in 于 step=suite 折返）**：`capability-catalog.sh` 顶部无条件 `. "${SELF_DIR}/repo-root.sh"` 引入硬依赖，但两个 mutation 夹具只孤立 copy `capability-catalog.sh` ⇒ ① `checker-mutation-cases/capability-catalog.sh` 夹具里 catalog source 失败（`set -e`）⇒ `--superseded-check` baseline 恒红（mutations_that_always_red=1）；② `checker-mutation-cases/rhythm-consumer-check.sh` 夹具里 catalog `--json` 死于 source 行 ⇒ `loadCatalogDecls` 解析 0 行 ⇒ 判据1 空转 ⇒ stayed-green（mutations_that_stayed_green=1）。修法：两夹具补 `cp repo-root.sh`；capability-catalog 夹具再补 `.git` marker（`repoRoot` 走 bundle→consumer→git 向上，无 marker 会落到调用方 `git rev-parse` 查真仓而非合成树）。实测 `checker-mutation-check.sh --check` 52/52 全绿（stayed-green=0、always-red=0）。
- **driver-cli 夹具补齐（续轮——上轮 mutation 补齐后 suite 仍 red，机械 fan-in 于 step=suite 折返）**：`driver-cli.test.mjs` 的 `KERNEL_DEPS` 是 driver-runtime.ts 的**固定闭集**，但 B2 迁移让其中 5 脚本（`gate-script-base`/`touches-orthogonality-check`/`concurrent-batch-scheduler`/`derive-touches-heuristic`/`fast-mode-telemetry`）import 共享 `repo-root.ts` ⇒ hermetic temp root 未 copy `repo-root.ts` ⇒ `ERR_MODULE_NOT_FOUND`，6 测试全红（AC1 start/stop/worker-stop、AC3 status、AC1 resume、AC2 start-halted）。修法：`KERNEL_DEPS` 补 `repo-root.ts`（零依赖 Node built-ins）。实测 `node --test plugin/test/driver-cli.test.mjs` 9/9 绿。
- **merge develop 带入的 3 个 cross-import 消费者补齐（续轮——上轮 driver-cli 补齐后 scoped 门仍 red，机械 fan-in 于 step=scoped-gate 折返）**：`git merge develop` 带入 `gap-suite-bucket-dynamic-truth-drift-detector` 的 3 个文件（`suite-fs-trace.ts`/`suite-bucket-drift-check.ts`/`suite-bucket-reattr-ratchet-check.ts`），它们仍 `import { findRepoRoot } from "./suite-bucket-attribution.ts"`，而 B2 迁移已从该模块删除 `findRepoRoot` 导出 ⇒ scoped 门 `suite-bucket-drift-check` 运行时 `SyntaxError: ... does not provide an export named 'findRepoRoot'`（exit=1）。修法：3 文件 import 改 `repoRoot` from `./repo-root.ts` + 各调用点 `findRepoRoot()`→`repoRoot()`；`repo-root-unification.test.mjs` 的 `FORMER_IMPORTERS` 10→13 补列（棘轮完备）。实测 `suite-bucket-drift-check --gate`（NOT-EVALUATED exit 0）、`suite-bucket-reattr-ratchet-check --gate`（PASS exit 0）、`repo-root-unification.test.mjs` 10/10 绿、`suite-bucket-drift-check.test.mjs` 12/12 绿、`suite-bucket-reattr-ratchet-check.test.mjs` 5/5 绿。
- **越界同名词（非本任务收口）**：`plugin/scripts/workflow-event-schema.mjs`（`.mjs`，零依赖 Node built-ins only、`node --no-warnings` 直跑无法 import `.ts`；且是 experiments 真实字节一致镜像——语言边界，SPEC §2.4「TS+bash 成对」不含 `.mjs`）；`packages/quay-native/bin/quay-native.ts`（⛔ 不改 packages/）；`experiments/quay-perpetual-stream/scripts/it0-*.ts`（经典循环 it0 脚本，非 plugin/scripts）；`plugin/test/*.mjs` 的测试本地 `findRepoRoot` helper（夹具非生产）。

## Touches

- plugin/scripts/repo-root.ts (new)（repoRoot TS 单一实现）
- plugin/scripts/repo-root.sh (new)（repoRoot bash 单一实现）
- plugin/test/repo-root-unification.test.mjs (new)（worktree 正确性 + 负控制）
- plugin/scripts/axis-generator.ts（迁移）
- plugin/scripts/cap-from-gate.ts（迁移）
- plugin/scripts/capability-catalog.sh（迁移 + repo-root 注册）
- docs/proposals/quay-product-outline.md（DELIVERY-INVENTORY 注册 + 快照再生）
- plugin/scripts/quay-init.sh（--loop laydown 显式清单补 repo-root.sh/repo-root.ts——closure 扫不到 SELF_DIR/ESM 引用）
- plugin/scripts/check-set-after-change-check.ts（迁移）
- plugin/scripts/concurrent-batch-scheduler.ts（迁移）
- plugin/scripts/derive-touches-heuristic.ts（迁移）
- plugin/scripts/fan-in-runid-check.ts（迁移）
- plugin/scripts/fan-in-ts-typecheck-gate.ts（迁移）
- plugin/scripts/fast-mode-telemetry.ts（迁移）
- plugin/scripts/gate-dispatch-coverage.ts（迁移）
- plugin/scripts/gate-staleness-check.ts（迁移）
- plugin/scripts/inner-blocked-signal.ts（迁移）
- plugin/scripts/inner-exec-mode-report.ts（迁移）
- plugin/scripts/known-load-sensitive.ts（迁移）
- plugin/scripts/malformed-task-check.ts（迁移）
- plugin/scripts/manager-liveness-independent-check.ts（迁移——merge develop 带入 gap-ac147 新文件，本地 `repoRoot` 定义改 import）
- plugin/scripts/precommit-guard.ts（迁移——预存 repoRoot 合一）
- plugin/scripts/prod-data-audit.ts（迁移）
- plugin/scripts/ready-pool-check.ts（迁移）
- plugin/scripts/red-window-triage.ts（迁移）
- plugin/scripts/refresh-worktree-quay.sh（无迁移面，未改动）
- plugin/scripts/select-static-checks-for-touches.ts（迁移）
- plugin/scripts/select-tests-for-touches.ts（迁移——原 Touches 漏列）
- plugin/scripts/self-report-vocab-audit.ts（迁移）
- plugin/scripts/slot-refill.ts（迁移）
- plugin/scripts/suite-bucket-attribution.ts（迁移）
- plugin/scripts/suite-bucket-hub-list.ts（迁移）
- plugin/scripts/suite-bucket-select.ts（迁移）
- plugin/scripts/suite-fs-trace.ts（迁移——merge develop 带入，findRepoRoot import 改 repo-root.ts）
- plugin/scripts/suite-bucket-drift-check.ts（迁移——同上）
- plugin/scripts/suite-bucket-reattr-ratchet-check.ts（迁移——同上）
- plugin/scripts/supervisor-preempt-candidates.ts（迁移）
- plugin/scripts/task-ac-carryover-check.ts（迁移）
- plugin/scripts/task-contract-check.ts（迁移）
- plugin/scripts/task-status-drift-check.ts（迁移）
- plugin/scripts/threshold-scope-check.ts（迁移）
- plugin/scripts/touches-orthogonality-check.ts（迁移）
- plugin/scripts/trend-check.ts（迁移）
- plugin/scripts/verify-delivery-surface.ts（迁移）
- plugin/test/touches-orthogonality-check.test.mjs（改 import）
- plugin/test/task-contract-check.test.mjs（改 import）
- plugin/test/task-status-drift-check.test.mjs（改 import）
- plugin/test/precommit-guard.test.mjs（copyGuardScripts 补 repo-root.ts）
- plugin/test/select-static-checks-for-touches.test.mjs（AC2 补 copy repo-root.sh）
- plugin/test/driver-cli.test.mjs（KERNEL_DEPS 补 repo-root.ts——首轮漏列，gate-script-base/touches-orthogonality-check/concurrent-batch-scheduler/derive-touches-heuristic/fast-mode-telemetry 5 脚本 import repo-root.ts，hermetic temp root 未 copy ⇒ suite red）
- plugin/scripts/checker-mutation-cases/capability-catalog.sh（补 copy repo-root.sh + .git marker）
- plugin/scripts/checker-mutation-cases/rhythm-consumer-check.sh（补 copy repo-root.sh）
- experiments/quay-perpetual-stream/scripts/repo-root.ts (new symlink)（供实验镜像 import 解析）
- experiments/quay-perpetual-stream/scripts/task-status-drift-check.ts（字节一致镜像同步）
- experiments/quay-perpetual-stream/scripts/derive-touches-heuristic.test.ts（改 import）
- tasks/gap-b2-repo-root-unification.md（自身）

## Needs-Human

**执行 2026-08-28T23:06:35.876Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）

## Needs-Human

**执行 2026-08-29T23:50:08.803Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
