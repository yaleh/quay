---
id: gap-arch-import-cycles-zero
title: 架构棘轮：import 环清零 —— 值级 SCC 1→0、类型级 SCC 2→0（由 import-graph-check 读出）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-arch-import-graph-check
goal_ac: AC-308
---
**type:** execution

## Proposal

**把 `import-graph-check` 读出的两组 import 环清零：值级 SCC 1→0（`ready-pool-check.ts` ↔ `strategic-doc-staleness-check.ts`），类型级 SCC 2→0（gate 类型簇 / suite 类型簇）。手段是把「被环上双方共享的类型或函数」抽到第三个模块，使环上的一条边消失。**

来源：`orchestration/SPEC-architecture-consolidation-ts-and-shell-2026-09-19.md` §1.2 T2/T3 / §5 Phase 3；GOAL-025 AC-308。⚠️ SPEC 此刻可能未在 develop 上（分支 `worktree-spec-architecture-refactor`）——**本任务体自足，不依赖读到它**。

**为什么需要它**：这两个环不是「看起来不干净」，而是**真实的值依赖互相咬合**，使两个模块无法分别测试、无法分别搬迁（Phase 5/6 的前置）。archguard 对这三个 SCC 报 0（它把 `plugin/scripts` 当成单个 `(root)` 包）——**「0 环」只能读作「未评估」**。环一行 import 即可回升 ⇒ 长期棘轮（`long-term:true`，goal-mechanism §12b）。

### 已核实的三处环（2026-09-19 本条立案时按 import 语句位置实机复核，非关键词）

**① 值级环 SCC=2（AC-308 原文行号全部命中）**
```
plugin/scripts/ready-pool-check.ts:238             → strategic-doc-staleness-check.ts  (judgePoolCandidate, 值导入)
plugin/scripts/strategic-doc-staleness-check.ts:55 → ready-pool-check.ts             (stripCodeSpans, 值导入)
plugin/scripts/ready-pool-check.ts:1221            ← stripCodeSpans 的定义处（唯一外部消费者 = :55）
```
⇒ 破环只需让**一条**边消失。AC-308 判据选的是把 `stripCodeSpans`（小、纯函数、单消费者）抽出去，**方向正确**——`judgePoolCandidate` 与该检查器的内部状态耦合，抽它代价高得多。

**② 类型级环 A：`gate/registry.ts` ↔ `gate/factories/*`**
```
packages/quay/src/gate/registry.ts:20-22   定义 GateVerdict / GateDefinition / GateFn
packages/quay/src/gate/registry.ts:7-8     值导入 factories/document-contract.ts、factories/goal.ts
9 个 factories/*.ts 各自 import type { GateFn } from "../registry.ts"
另 packages/quay/src/gate/config/loader.ts:12 同样 import type GateFn
```
⚠️ **AC-308 原文写「11 个 gate/factories/*」，本条立案时实测为 9 个 import 者**（8 个具体工厂 + `index.ts`；`factories/` 下的 `loader.ts`、`utils.ts` 不导入 GateFn），再加 `config/loader.ts` 共 10 处。**以 `import-graph-check --json` 的 `typeSccs` 真实读数为准**；差异逐条对账写进 notes，⛔ 不得调检查器去凑 11。

**③ 类型级环 B：`full-suite-runner.ts` ↔ `runner-state-write.ts` / `runner-red-parse.ts`**
```
plugin/scripts/runner-state-write.ts:19  import type { SuiteState, SuiteRoundRecord } from "./full-suite-runner.ts"
plugin/scripts/runner-red-parse.ts:17    import type { SuiteFailure, StaticCheckViolation, FailClosedChecker } from "./full-suite-runner.ts"
plugin/scripts/full-suite-runner.ts:174  值导入 runner-red-parse.ts (gateScanCause, isFailureLine, buildStaticCheckFailures)
（full-suite-runner.ts 亦从 runner-state-write.ts 取值）
```
类型定义集中在同一文件，**必须整簇迁出**：`SuiteStateValue:205` / `SuiteStateReason:220` / `SuiteFailure:238` / `SuiteStateStaticCheck:296` / `SuiteState:314` / `SuiteRoundRecord:815`。

⚠️ **以检查器读数为准**：若 `--json` 报出上述之外的 SCC，**它们同属这一个 0 目标，必须一并清零**——AC-308 判据要求两个数组都为**空数组**，不是「≤ 原文那几个」。多出来的逐个对账写进 notes。

### ⚠️ 三条必须当场避开的陷阱

**陷阱一（最重要）：只搬 `GateFn` 会造出一个新环。**
`gate/types.ts` 若只放 `GateFn`，它仍引用 `GateVerdict`；而 `GateVerdict` 若留在 `registry.ts`，就得到 `types.ts → registry.ts`（为 GateVerdict）与 `registry.ts → types.ts`（为 GateFn）——**环只是换了条边继续存在，而 `valueSccs` 看起来「没变差」**。
⇒ **必须把 `GateVerdict`、`GateDefinition`、`GateFn` 三个一起迁进 `gate/types.ts`**，并核实 `gate/types.ts` 自身**不**从 `registry.ts` / `factories/*` / `config/*` 导入任何东西（只应 `import type { Task } from "../abi.ts"`，以及 `node:*`）。AC3 会取假这一点。

**陷阱二：`SuiteState` 有同名不同源的第二个定义，别合并错。**
`plugin/scripts/full-suite-runner.ts:134` 已经 `import { runOnce, isRunnerInFlight, type SuiteState as TriggerSuiteState } from "./suite-state-trigger.ts"`——**`suite-state-trigger.ts` 有自己的 `SuiteState`**。迁出时只搬 `full-suite-runner.ts` 自己定义的那个簇，⛔ 不要把两者合并（会静默改变类型语义）。AC4 会取假这一点。

**陷阱三：新增 `plugin/scripts/*.ts` 会被 capability-catalog 的文件系统枚举抓到，但它不是检查器。**
`capability-catalog.sh:2109` 用 `find "$SELF_DIR" -mindepth 1 -type f \( -name '*.sh' -o -name '*.ts' -o -name '*.mjs' \)` 枚举，`:2198` 硬闸 `UNCLASSIFIED=0`（缺 QUESTION 行即 exit 1）。
⇒ 新增的文件**必须**在六张声明表补行；**⛔ 但不适用 AC-304 任务的「检查器四件套」**（无 `--selftest`、无 `checker-mutation-cases/*.sh`、不入 `runner-static-gate.ts` 的 `run_static_checks`、`# @checker-count` **不 +1**）。AC-304 把两者写在同一段，本条只取「声明表」那一半。

### 落点裁定（实现者须在 notes 写出选择与理由）

- **类型环 A** → `packages/quay/src/gate/types.ts`（AC-308 原文指定；在 `packages/` 内，**不触发 catalog 义务**）。
- **类型环 B** → `plugin/scripts/full-suite-runner-types.ts`（AC-308 原文指定；**触发上一条 catalog 义务**）。⚠️ 可行替代是放进一个**双方都已依赖且不回指**的既有模块——**仅当**它同样把读数压到 0 **且**不把一个 186 依赖的 hub 撑得更大时才可取，理由写进 notes。
- **值环 `stripCodeSpans` 落点**——AC-308 只说「独立小模块」，未指定位置。**默认 `plugin/scripts/code-span-strip.ts`**（plugin 局部小叶子，同样触发 catalog 义务）。
  **⛔ 明确排除 `packages/quay/src/kernel/`**：kernel/ 是 AC-309 为**跨层共享**原语设的（`write-json-atomic`/`shape-sections`/`worktree-process-reaper` 两侧都消费），而 `stripCodeSpans` **只有 plugin 侧两个消费者、产品层零消费者** ⇒ 放进去等于让产品包背一个方法学层专属 helper，与 AC-309 的范围相反。
  另一个**无需新文件**的替代：`ready-pool-check.ts:216` 与 `strategic-doc-staleness-check.ts:51` **都已值导入 `gate-script-base.ts`** ⇒ 把 `stripCodeSpans` 放进它即破环、零新文件、零 catalog 义务。**但它是一个 186 依赖者的 hub，且本 GOAL 的方向是拆小叶子、不是撑大 hub** ⇒ 取此路必须在 notes 里正面论证，不得默认。

### 边界（⛔ 不得越界）

- **纯重构**：只改 import/export 与类型定义位置，**⛔ 不改任何运行期行为**（`stripCodeSpans` 函数体、各 gate 工厂返回逻辑、suite 状态机逻辑逐字不变）。
- **⛔ 不得修改 `plugin/scripts/import-graph-check.ts` 的判定语义，也不得靠调基线凑 0**——本任务的目标是**读数真降到 0**。（棘轮本身只允许基线下降，「调高基线」另有用例守；但放松 SCC 判据 = 伪造仪器，那属 AC-304 的职责范围。）
- **⛔ 不拆 `ready-pool-check.ts`（3719 行）/ `full-suite-runner.ts`（4153 行）这两个巨型文件本身**（Phase 6，另案）。
- 不修改 Provider ABI 与公开 CLI/MCP 表面。

### ⚠️ 派发序列约束（AC-308 原文的「注意」，本条立案时已复核）

`ready-pool-check.ts` 与 `full-suite-runner.ts` 是**热文件**——本条必须与任何碰这两个文件的在飞任务**串行**。立案时实测：在飞 worktree = `gap-arch-coverage-self-report` / `gap-context-slim-p0-baseline-readings` / `gap-release-cut-via-workflow-dispatch` / `ac207fix-build`，**无一触碰这两个文件**；就绪的 arch 任务中 `gap-arch-import-graph-check`（建仪器）与 `gap-arch-reverse-edges-zero`（AC-307）是最近邻。
**`plugin/import-graph-baseline.json` 三个任务都要写**（仪器建它、AC-307 降 `reverseEdges`、本条降 `valueSccs`/`typeSccs`）⇒ 三者的 Touches 都声明了它，**由派发器的 touches 互斥自动串行**，不另设关系边（硬规则 12：不给未测量的前置设阻塞）。

<!-- dedup-ref -->
**与相邻任务的分工（仅追溯）**：`gap-arch-import-graph-check`（AC-304）**建仪器**，本条**用仪器把环读数降到 0**；`gap-arch-reverse-edges-zero`（AC-307）降的是**跨层反向边**（`reverseEdges`），本条降的是**同层内环**（`valueSccs`/`typeSccs`）——两个量、两个判据、文件集几乎不相交（除基线文件）。AC-309 判「kernel/ 建成且有消费者」，本条**既不创建也不消费 kernel/**。

## Touches

- plugin/scripts/ready-pool-check.ts
- plugin/scripts/strategic-doc-staleness-check.ts
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/runner-state-write.ts
- plugin/scripts/runner-red-parse.ts
- plugin/scripts/full-suite-runner-types.ts (new)
- plugin/scripts/code-span-strip.ts (new；若取「放进 gate-script-base.ts」的替代路则无此文件)
- plugin/scripts/capability-catalog.sh
- packages/quay/src/gate/types.ts (new)
- packages/quay/src/gate/registry.ts
- packages/quay/src/gate/factories/adr.ts
- packages/quay/src/gate/factories/coverage-floor.ts
- packages/quay/src/gate/factories/document-contract.ts
- packages/quay/src/gate/factories/fixed-script.ts
- packages/quay/src/gate/factories/goal.ts
- packages/quay/src/gate/factories/index.ts
- packages/quay/src/gate/factories/it0.ts
- packages/quay/src/gate/factories/red-green.ts
- packages/quay/src/gate/factories/test-pass.ts
- packages/quay/src/gate/config/loader.ts
- plugin/import-graph-baseline.json
- plugin/test/strategic-doc-staleness-check.test.mjs
- plugin/test/suite-state-trigger.test.mjs
- plugin/test/full-suite-runner-phases.test.mjs
- packages/quay/test/gate-config-loader.test.mjs
- packages/quay/test/goal-gate.test.mjs
- packages/quay/test/document-gate.test.mjs
- tasks/gap-arch-import-cycles-zero.md

（若实现者选择别的模块名或别的落点，新增与改动的文件仍属本任务 Touches，须在同一次编辑里补进本清单。）

## AC

- [ ] AC1（判据取假，负控制）在任务 worktree 里**临时**注入一个值环与一个类型环（例：让两个 plugin 脚本互相值导入；让一个 `gate/factories/*.ts` 用**值**导入 `GateFn` 所在模块），`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` 的 `valueSccs`/`typeSccs` 变为非空且命令 exit 1；撤销后 `evaluated===true` 且两数组均为空、exit 0。**两次输出（含两数组 length）贴进 notes。** ⛔ 若撤销前后读数相同 ⇒ 判据未取假，本任务不算完成。
- [ ] AC2（目标读数，两个独立读法互校）在真实仓库根逐字跑 AC-308 的判据本体 ⇒ exit 0；**同时**用位置判据独立复核：`grep -c 'from "\./ready-pool-check\.ts"' plugin/scripts/strategic-doc-staleness-check.ts` = 0 **且** `grep -c 'from "\./strategic-doc-staleness-check\.ts"' plugin/scripts/ready-pool-check.ts` = 0，且 `grep -rn 'import type .*GateFn.*from "\.\./registry\.ts"' packages/quay/src/gate/ | wc -l` = 0。**两条读数不一致 ⇒ 报仪器故障，不得只信其一**（硬规则 4 推论二检测半边）。
- [ ] AC3（陷阱一取假：新环未生成）`packages/quay/src/gate/types.ts` 同时定义 `GateVerdict`/`GateDefinition`/`GateFn` **三者**，且该文件**不**从 `registry.ts`/`factories/*`/`config/*` 导入任何东西（只允许 `import type { Task } from "../abi.ts"` 与 `node:*`）；`grep -rn 'GateVerdict\|GateFn' packages/quay/src/gate/types.ts` 显示为定义而非导入。⛔ 若「只搬 GateFn、GateVerdict 留在 registry」⇒ 本条红（这正是新环的形态）。
- [ ] AC4（陷阱二取假：同名类型未被合并）迁出后的 suite 类型簇**不是** `suite-state-trigger.ts` 的那个：`grep -n "TriggerSuiteState" plugin/scripts/full-suite-runner.ts` 非空，且该导入行仍指向 `./suite-state-trigger.ts`。
- [ ] AC5（落点与注册义务）若新增了 `plugin/scripts/*.ts`：`bash plugin/scripts/capability-catalog.sh --summary` exit 0 且 **UNCLASSIFIED=0**，其脚本数自报值 = 落地前 + 新增文件数；**并且**未把新文件当检查器登记（`grep -n "<新文件名>" plugin/scripts/runner-static-gate.ts` 命中 0，`# @checker-count` 未变）。若所有改动都落在既有模块内 ⇒ 本条的 catalog 部分记 `NOT-APPLICABLE` 并写出理由。
- [ ] AC6（棘轮方向）`plugin/import-graph-baseline.json` 的 `valueSccs` 与 `typeSccs` 两个值均为 0（**降低**而非抬高，notes 写明），`node --experimental-strip-types plugin/scripts/import-graph-check.ts --selftest` exit 0（含「把基线任一值调高相对 HEAD 基线 ⇒ exit 1」用例仍通过）。
- [ ] AC7（回归面不破）`scripts/test.sh` 的 scoped/静态入口（读其头注释取用法）在本任务 Touches 上全绿；另**单独贴出**与本次改动直接相关的套件输出：`plugin/test/strategic-doc-staleness-check.test.mjs`、`plugin/test/suite-state-trigger.test.mjs`、`plugin/test/full-suite-runner-phases.test.mjs`、`packages/quay/test/gate-config-loader.test.mjs`、`packages/quay/test/goal-gate.test.mjs`、`packages/quay/test/document-gate.test.mjs`（scoped 入口会按 Touches 派生其余 ready-pool-check 套件）。
- [ ] AC8（生产载体，非 fixture；纯重构不变行为）落地后 `import-graph-check` 作为**套件静态层的一员在真实仓库根真实执行**且判定 PASS（不是仅被登记）；且本次改动**未改变运行期行为**——`git diff` 中 `stripCodeSpans` 函数体、各 gate 工厂返回逻辑、suite 状态机逻辑均**逐字未变**（只有 import/export 行与定义位置移动）。把该次命令与输出关键行贴进 notes。

## DoD

真实落地标准（DIR-026 Reading A）：**环读数已在真实仓库上取到 0，且负控制已实做并留证**（AC1 的注入-撤销两次输出）；`valueSccs` 与 `typeSccs` 两个数组在真实仓库根均为空——不是「在 fixture 上绿了」（硬规则 4 推论三）。**纯重构**：不改运行期行为、不改检查器判定语义、不靠基线凑数。**热文件串行约束已遵守**（与碰 `ready-pool-check.ts`/`full-suite-runner.ts` 的任务串行，由 Touches 互斥保证）。落点选择与理由（尤其值环 `stripCodeSpans` 与类型环 B 的位置）写进提交信息与 notes。不修改 Provider ABI 与公开 CLI/MCP 表面；不建、不消费 `packages/quay/src/kernel/`（AC-309 的范围）；不拆两个巨型文件（Phase 6）。