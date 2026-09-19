---
id: gap-arch-import-cycles-zero
title: 架构棘轮：import 环清零 —— 值级 SCC 1→0、类型级 SCC 2→0（由 import-graph-check 读出）
status: ready
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
（⚠️ 落地后 develop 把这段搬走了：枚举与硬闸改在 `plugin/scripts/capability-catalog.ts`，声明表改成
数据文件 `plugin/scripts/capability-catalog-declarations.json`；**注册点变成那个 JSON**。合并时的处理
见 ## Notes「合并 develop 的冲突处理」。）
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
- plugin/scripts/capability-catalog-declarations.json
- plugin/scripts/red-on-omission-audit.ts
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
- plugin/test/import-graph-check.test.mjs
- plugin/test/strategic-doc-staleness-check.test.mjs
- plugin/test/suite-state-trigger.test.mjs
- plugin/test/full-suite-runner-phases.test.mjs
- packages/quay/test/gate-config-loader.test.mjs
- packages/quay/test/goal-gate.test.mjs
- packages/quay/test/document-gate.test.mjs
- tasks/gap-arch-import-cycles-zero.md

（若实现者选择别的模块名或别的落点，新增与改动的文件仍属本任务 Touches，须在同一次编辑里补进本清单。）
（本次落地补进的是 `plugin/scripts/red-on-omission-audit.ts`：类型环 B 迁出 `SuiteState` 后它的
`scope_worktree_gate` invariant 按字面读 `full-suite-runner.ts` 转红（硬规则 5b 的连带修复），见 ## Notes。
另：⛔ 未取「放进 `gate-script-base.ts`」的替代路 —— 那会撑大 186 依赖的 hub，故 `code-span-strip.ts` 已落地。）

## AC

- [x] AC1（判据取假，负控制）在任务 worktree 里**临时**注入一个值环与一个类型环（例：让两个 plugin 脚本互相值导入；让一个 `gate/factories/*.ts` 用**值**导入 `GateFn` 所在模块），`node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` 的 `valueSccs`/`typeSccs` 变为非空且命令 exit 1；撤销后 `evaluated===true` 且两数组均为空、exit 0。**两次输出（含两数组 length）贴进 notes。** ⛔ 若撤销前后读数相同 ⇒ 判据未取假，本任务不算完成。（实测：注入 ⇒ valueSccs length=1 / typeSccs length=1 / exit 1；撤销 ⇒ 0/0、exit 0。见 ## Notes「AC1 负控制」。⚠️ 该负控制还揭出一个**空转陷阱**：新建文件在 `git add` 前不在 `git ls-files` 图里，会让环「看起来清零」——见 ## Notes。）
- [x] AC2（目标读数，两个独立读法互校）在真实仓库根逐字跑 AC-308 的判据本体 ⇒ exit 0；**同时**用位置判据独立复核：`grep -c 'from "\./ready-pool-check\.ts"' plugin/scripts/strategic-doc-staleness-check.ts` = 0 **且** `grep -c 'from "\./strategic-doc-staleness-check\.ts"' plugin/scripts/ready-pool-check.ts` = 0，且 `grep -rn 'import type .*GateFn.*from "\.\./registry\.ts"' packages/quay/src/gate/ | wc -l` = 0。**两条读数不一致 ⇒ 报仪器故障，不得只信其一**（硬规则 4 推论二检测半边）。（实测：判据本体 exit 0；位置读数 #1 = 0、#3 = 0；**#2 = 1** —— 该 grep 的期望值与 AC-308 权威判据冲突，且**任何单边破环都只能让两条 grep 之一归零**，见 ## Notes「AC2 不一致」，如实记录未去凑。）
- [x] AC3（陷阱一取假：新环未生成）`packages/quay/src/gate/types.ts` 同时定义 `GateVerdict`/`GateDefinition`/`GateFn` **三者**，且该文件**不**从 `registry.ts`/`factories/*`/`config/*` 导入任何东西（只允许 `import type { Task } from "../abi.ts"` 与 `node:*`）；`grep -rn 'GateVerdict\|GateFn' packages/quay/src/gate/types.ts` 显示为定义而非导入。⛔ 若「只搬 GateFn、GateVerdict 留在 registry」⇒ 本条红（这正是新环的形态）。（实测：三者在 types.ts:22-24 定义；该文件唯一 import 是 `import type { Task } from "../abi.ts"`；`gate/types.ts` 不在任何 typeScc 里。）
- [x] AC4（陷阱二取假：同名类型未被合并）迁出后的 suite 类型簇**不是** `suite-state-trigger.ts` 的那个：`grep -n "TriggerSuiteState" plugin/scripts/full-suite-runner.ts` 非空，且该导入行仍指向 `./suite-state-trigger.ts`。（实测：`full-suite-runner.ts:134` 仍 `type SuiteState as TriggerSuiteState` from `./suite-state-trigger.ts`，另有 :1337/:1338 两处使用；`suite-state-trigger.ts` 自己的 `SuiteState`/`SuiteStateValue`/`SuiteStateReason`/`SuiteFailure`/`SuiteStateStaticCheck`（:92-173）**逐字未动**。）
- [x] AC5（落点与注册义务）若新增了 `plugin/scripts/*.ts`：`bash plugin/scripts/capability-catalog.sh --summary` exit 0 且 **UNCLASSIFIED=0**，其脚本数自报值 = 落地前 + 新增文件数；**并且**未把新文件当检查器登记（`grep -n "<新文件名>" plugin/scripts/runner-static-gate.ts` 命中 0，`# @checker-count` 未变）。若所有改动都落在既有模块内 ⇒ 本条的 catalog 部分记 `NOT-APPLICABLE` 并写出理由。（实测：新增 2 个 plugin/scripts 文件 ⇒ `344 scripts | 344 declared | 0 unclassified | 339 ship`，exit 0，落地前 342 ⇒ 344 = 342 + 2；两个新文件在 `runner-static-gate.ts` 命中 0，`# @checker-count 63` / `11` 未变；六张声明表各补两行。）
- [x] AC6（棘轮方向）`plugin/import-graph-baseline.json` 的 `valueSccs` 与 `typeSccs` 两个值均为 0（**降低**而非抬高，notes 写明），`node --experimental-strip-types plugin/scripts/import-graph-check.ts --selftest` exit 0（含「把基线任一值调高相对 HEAD 基线 ⇒ exit 1」用例仍通过）。（实测：基线 1→0、2→0（只降）；`--selftest` exit 0；scoped 静态层的实跑输出里 `baseline` 与 `headBaseline` 均为 `{valueSccs:0,typeSccs:0,reverseEdges:0}`。）
- [x] AC7（回归面不破）`scripts/test.sh` 的 scoped/静态入口（读其头注释取用法）在本任务 Touches 上全绿；另**单独贴出**与本次改动直接相关的套件输出：`plugin/test/strategic-doc-staleness-check.test.mjs`、`plugin/test/suite-state-trigger.test.mjs`、`plugin/test/full-suite-runner-phases.test.mjs`、`packages/quay/test/gate-config-loader.test.mjs`、`packages/quay/test/goal-gate.test.mjs`、`packages/quay/test/document-gate.test.mjs`（scoped 入口会按 Touches 派生其余 ready-pool-check 套件）。（实测：`bash scripts/test.sh --for-task gap-arch-import-cycles-zero --allow-thin` ⇒ **267 tests / 0 fail / exit 0**（含 scoped 静态层 25 个 checker 全 PASS）；六个文件单独跑 ⇒ **167 tests / 0 fail**；`red-on-omission-audit.test.mjs` ⇒ 18 tests / 0 fail。见 ## Notes。）
- [x] AC8（生产载体，非 fixture；纯重构不变行为）落地后 `import-graph-check` 作为**套件静态层的一员在真实仓库根真实执行**且判定 PASS（不是仅被登记）；且本次改动**未改变运行期行为**——`git diff` 中 `stripCodeSpans` 函数体、各 gate 工厂返回逻辑、suite 状态机逻辑均**逐字未变**（只有 import/export 行与定义位置移动）。把该次命令与输出关键行贴进 notes。（实测：scoped 静态层实跑 `import-graph-check: files=436 edges=1055 (value 939 / type 116)` + `valueSccs=0 typeSccs=0 reverseEdges=0`，gate exit 0；逐字未变已**机械核验**：三个函数体与 HEAD 逐字相同、`HEAD 减去迁出块 + 插入片段 == 新文件`。见 ## Notes。）

## DoD

真实落地标准（DIR-026 Reading A）：**环读数已在真实仓库上取到 0，且负控制已实做并留证**（AC1 的注入-撤销两次输出）；`valueSccs` 与 `typeSccs` 两个数组在真实仓库根均为空——不是「在 fixture 上绿了」（硬规则 4 推论三）。**纯重构**：不改运行期行为、不改检查器判定语义、不靠基线凑数。**热文件串行约束已遵守**（与碰 `ready-pool-check.ts`/`full-suite-runner.ts` 的任务串行，由 Touches 互斥保证）。落点选择与理由（尤其值环 `stripCodeSpans` 与类型环 B 的位置）写进提交信息与 notes。不修改 Provider ABI 与公开 CLI/MCP 表面；不建、不消费 `packages/quay/src/kernel/`（AC-309 的范围）；不拆两个巨型文件（Phase 6）。

## Notes

### 落点选择与理由（DoD 要求）

- **值环 `stripCodeSpans`** → `plugin/scripts/code-span-strip.ts`（新建）。理由：AC-308 范围①原文即
  「`stripCodeSpans` 下沉到独立小模块」。该族实为三个纯字符串函数（`stripFences` /
  `stripInlineCodeSpans` / `stripCodeSpans`）——`stripFences`/`stripInlineCodeSpans` 在
  `ready-pool-check.ts` 内还有第二、三处消费者（:1446 / :1447），故**三个一起迁出**（否则要在两处留
  平行副本，违反单一真相源）。⛔ 未取「放进 `gate-script-base.ts`」的替代路：那是 **219 个导入者**的
  hub，而本 GOAL 的方向是拆小叶子、不是撑大 hub。⛔ 未取 `packages/quay/src/kernel/`：那是 AC-309 的
  跨层共享范围，而 `stripCodeSpans` 产品层零消费者。
- **类型环 A** → `packages/quay/src/gate/types.ts`（新建，AC-308 原文指定）。`GateVerdict` /
  `GateDefinition` / `GateFn` **三者一起迁出**（只搬 `GateFn` 会造出新环 —— 陷阱一）。
- **类型环 B** → `plugin/scripts/full-suite-runner-types.ts`（新建，AC-308 原文指定）。迁出
  `full-suite-runner.ts` **自己定义的** 10 个类型声明。⛔ 未合并 `suite-state-trigger.ts` 的同名类型族
  （陷阱二）。⛔ 未取「放进既有 hub」的替代路（同样撑大 hub，且不满足 AC-308 的落点指定）。

### 实测读数（真实仓库根 = 本任务 worktree；**文件已 git add 之后**读取）

| 读数 | 落地前 | 落地后 |
|---|---|---|
| `valueSccs` | 1 | **0** |
| `typeSccs` | 2 | **0** |
| `reverseEdges` | 0 | 0 |
| 命令 | `node --experimental-strip-types plugin/scripts/import-graph-check.ts --json` | 同左 |
| exit | 0 | 0 |

### ⚠️ AC1 负控制，以及它揭出的「空转陷阱」（本条最重要的一条）

⚠️ **数据源是 `git ls-files` ⇒ 新建文件在 `git add` 之前不在图里。** 第一次读数是
`valueSccs:0 / typeSccs:0` —— 那是**空转**（新模块不可见 ⇒ 边悬空 ⇒ 环「消失」），**不是真读数**；
同一次读数下注入的负控制**没有变红**，才把它暴露出来。**所有正式读数都是在 `git add` + `commit`
之后重取的**（这正是 AC1 负控制的价值）。

注入（值环：`code-span-strip.ts` 值导入 `ready-pool-check.ts`；类型环：`gate/types.ts` 类型导入 `registry.ts`）：
```
evaluated: true   valueSccs length: 1   typeSccs length: 1   EXIT=1
  value: ['plugin/scripts/code-span-strip.ts','plugin/scripts/ready-pool-check.ts','plugin/scripts/strategic-doc-staleness-check.ts']
  type : [12 files: gate/config/loader.ts + 9 factories + gate/registry.ts + gate/types.ts]
  verdict.ok: false   over: ['valueSccs','typeSccs']
```
撤销后：
```
evaluated: true   valueSccs length: 0   typeSccs length: 0   reverseEdges length: 0   EXIT=0   verdict.ok: true
```
⛔ 两次读数不同 ⇒ 判据确实取假。

### ⚠️ AC2 的一处不一致（如实记录，未静默、未去凑）

AC2 的位置复核要两条 grep 都为 0，实测：
- `grep -c 'from "\./ready-pool-check\.ts"' plugin/scripts/strategic-doc-staleness-check.ts` = **0** ✓
- `grep -c 'from "\./strategic-doc-staleness-check\.ts"' plugin/scripts/ready-pool-check.ts` = **1** ✗

第二条**不可能为 0**：权威判据 `goals/AC-308-…md` 的 `criterion:` 只要求
`valueSccs.length===0 && typeSccs.length===0`（且 exit 0），其「范围①」原文指定的是**单边**破环
（「`stripCodeSpans` 下沉到独立小模块」）；而 `ready-pool-check.ts → strategic-doc-staleness-check.ts`
（`judgePoolCandidate`）是**保留**的那条边（任务体自身也写明该方向「代价高得多」）。**任何单边破环都
只能让两条 grep 中的一条归零** ⇒ AC2 第二条 grep 的期望值与它自己的权威判据冲突，是**过度指定**。
⇒ 本条按「至少一条边消失 ⇒ 2-环不可能存在」复核：instrument 读数（0 个 value SCC、exit 0）与位置读数
（一条边已消失）**一致**，不是仪器故障。按硬规则 12 与本任务「⛔ 不得调检查器/判据去凑」的纪律，
**未**为此多迁 `judgePoolCandidate`（那会越出 AC-308 的指定范围并放大爆炸半径）。

### AC5 catalog 义务

`bash plugin/scripts/capability-catalog.sh --summary` ⇒ `344 scripts | 344 declared | 0 unclassified | 339 ship`，exit 0。
落地前 342 ⇒ 344 = 342 + 2（新增两个文件）。六张表各补两行（QUESTION / CADENCE / INVALIDATION /
LAST_REAFFIRMED / MATCHING / CONSUMER）；`code-span-strip.ts` 的 QUESTION 行按 catalog 的自检要求
（值内禁反引号 / `$(`）改写为纯文本。⛔ 未当检查器登记：`grep -n "code-span-strip\|full-suite-runner-types"
plugin/scripts/runner-static-gate.ts` 命中 0，`# @checker-count 63` / `11` 未变。

### AC7 回归面（另：与任务体的差异对账）

- `bash scripts/test.sh --for-task gap-arch-import-cycles-zero --allow-thin` ⇒ **267 tests / 0 fail / exit 0**。
- 与 AC7 点名的六个文件 ⇒ **167 tests / 0 fail**；`plugin/test/red-on-omission-audit.test.mjs` ⇒ 18 / 0。

### AC8 生产载体（scoped 静态层实跑，非仅登记）

```
scoped check: run_checker "import-graph-check" node --no-warnings --experimental-strip-types \
    ".../plugin/scripts/import-graph-check.ts" --root ".../gap-arch-import-cycles-zero"
import-graph-check: files=436 edges=1055 (value 939 / type 116)
  valueSccs=0 typeSccs=0 reverseEdges=0
  kernelChecked=true (violations=0)
  baseline:     {"valueSccs":0,"typeSccs":0,"reverseEdges":0}
  headBaseline: {"valueSccs":0,"typeSccs":0,"reverseEdges":0}
```
（gate exit 0 ⇒ PASS；`headBaseline == baseline` ⇒ 棘轮「相对 git HEAD 只许降」成立。）

**纯重构的机械核验**（不是印象）：
- `stripFences` / `stripInlineCodeSpans` / `stripCodeSpans` **函数体** 与 HEAD 逐字相同（仅两个私有 helper
  加 `export`，属 export 行变更）。
- `HEAD 的 full-suite-runner.ts 减去 10 个迁出块` + 插入片段 == 新文件（0 上下文 diff 只剩该片段）。
- `HEAD 的 ready-pool-check.ts 减去迁出块` + 插入片段 == 新文件（逐行相等）。
- 各 gate 工厂 diff 只有 `../registry.ts` → `../types.ts` 一行；`registry.ts` 只有三行类型定义
  换成 `import type` + `export type`。

### 类型环 B 的对账（任务体写 3 个文件，实测 5 个）

`--json` 的 `typeSccs[1]` 文件集 = {`full-suite-runner.ts`, `pre-verified-round-record.ts`,
`runner-red-parse.ts`, `runner-state-write.ts`, `suite-state-trigger.ts`} —— 比任务体列的 3 个多
`pre-verified-round-record.ts` 与 `suite-state-trigger.ts`（后者的入环路径是
`full-suite-runner → suite-state-trigger → pre-verified-round-record → runner-red-parse →(type) full-suite-runner`）。
按任务体「以检查器读数为准、多出来的一并清零」的要求，这 5 个文件同属一个 0 目标，已一并清零；**未**改动
`suite-state-trigger.ts` / `pre-verified-round-record.ts` 本身（破它们入环的那条 type 边即可）。
类型环 A 的文件集 = 11 个（9 factories + `gate/registry.ts` + `gate/config/loader.ts`），与任务体实测的 10 处
import 者一致。**类型环 A 的 import 者计数对账**：任务体原文「9 个 import 者 + config/loader.ts = 10 处」
经复核**成立**（8 个具体工厂 + `factories/index.ts` = 9，加 `config/loader.ts` = 10）；AC-308 原文的
「11 个 gate/factories/*」是把 `factories/` 下**不**导入 GateFn 的 `loader.ts`/`utils.ts` 也算进去了 ⇒
按任务体要求**以检查器读数为准**，未调检查器去凑 11。

### 一处连带修复（硬规则 5b：修好 X ≠ X 只在那一处）

类型环 B 把 `SuiteState` 迁出后，**`plugin/scripts/red-on-omission-audit.ts` 的 `scope_worktree_gate`
invariant 转红**——它按字面在 `full-suite-runner.ts` 里找 `scope?: "main" | "worktree"`。**pre-commit 守卫
在提交时抓到了它**（`STATIC_CHECK_FAILED: red-on-omission-audit exit=1`）。修法：该字段改在
**runner 的声明面（`full-suite-runner.ts` 或 `full-suite-runner-types.ts`）任一处**存在即可
（`readUnder` 缺文件返回 `""` ⇒ 仍 FAIL，**未放松**判定）。该检查器的 mutation case 用**自己的 fixture**，
注入仍变红、恢复仍变绿，已复跑 exit 0 ⇒ `plugin/scripts/red-on-omission-audit.ts` 已补进 ## Touches。
（同轮另行核实 `config-wiring-check` / `eligible-no-goal-source-check` / `suite-slot-ssot-check` /
`task-file-bypass-check` / `judgment-consumer-check` 等按字面读这些文件的检查器**未受影响**，逐个实跑通过；
`task-file-bypass-check` 的两条 allowlist WARN 在**主检出上同样存在**，非本次引入。）

### 未越界

未改 Provider ABI / 公开 CLI-MCP 表面；未创建或消费 `packages/quay/src/kernel/`；未拆两个巨型文件；
**未修改 `import-graph-check.ts` 的判定语义**（只降基线数值，且降低也如实提交）。

### 第二处连带修复（硬规则 5b 的第二个实例）：AC4 的「空转守卫」是一条不随棘轮走的字面钉

**症状（落地上报）**：整轮 fan-in 的全量 suite 红 —— `# tests 9038 / # pass 9037 / # fail 1`，唯一红点
`plugin/test/import-graph-check.test.mjs:374`
`AssertionError [ERR_ASSERTION]: the real reading must name at least one node`
（日志 `.quay/fan-in-suite-gap-arch-import-cycles-zero~wk-prod-anchor~1789810992180-11260d.log`
第 9391-9392 行；`__PERFILE__ …/plugin/test/import-graph-check.test.mjs passed=false`）。

**根因（本任务造成的、且是**目标态**本身）**：AC4 把「真实读数必须点名至少一个节点」写成**无条件**断言，
而它点名的面 = SCC 成员 ∪ 反向边端点 ∪ kernel 违规端点。本条把 `valueSccs` 1→0、`typeSccs` 2→0，
AC-307 已把 `reverseEdges` 降到 0 ⇒ **三个来源同时为空**（实机读数：`files=437 edges=1055`、
`valueSccs=[] typeSccs=[] reverseEdges=[] kernelViolations=[]`、`verdict.ok=true`）⇒ `named.size===0`。
即：**该守卫在棘轮到达目标态那一刻变成不可满足**。这与该测试文件自己的设计声明直接冲突 ——
其头注释写着「when a cycle is repaired the baseline is lowered (the sanctioned act) and these assertions
follow it automatically; **a literal pin here would fight the ratchet's own reason to exist**」。
AC2/AC3 都按这条纪律写了 baseline-as-oracle 守卫（`:330` / `:336` / `:349`），**AC4 是唯一的例外**。

**修法（改测试的空转守卫，⛔ 不动检查器判定语义、⛔ 不调基线）**：空 `named` 只在**读数确实取到、
且确实是已修复的那一份**时方可放行 —— 四条各自可取假的合取，不是屏蔽：
`REAL.evaluated===true`、`REAL.files>0`、`countsOf(REAL)=== {0,0,0}`、`REAL.kernelViolations===[]`；
一旦有任何东西被点名，原来的逐节点卫生断言（无 `..` / 无 `.claude/worktrees/` / 无 symlink 别名）
**逐字照跑**。该文件因此补进 ## Touches（它现在是本分支 delta 的一部分）。

**负控制（证明这是「分叉」而不是「绕过」）**：临时把值环注回去
（`code-span-strip.ts` 值导入 `ready-pool-check.ts` 的 `judgePoolCandidate`）⇒
检查器读数 `valueSccs=[[code-span-strip, ready-pool-check, strategic-doc-staleness-check]]`、
`verdict.ok=false over:['valueSccs']`；此时 AC4 **走非空分支并仍绿**（3 个被点名文件，逐节点卫生断言真的执行），
**同一注入下 AC2 转红**（计数 1 ≠ 基线 0）⇒ 该文件的判据面没有失明。撤销后
`git status --short plugin/scripts/code-span-strip.ts` 为空（逐字节还原），
`node --experimental-strip-types --test plugin/test/import-graph-check.test.mjs` ⇒ **20 tests / 20 pass / 0 fail**。

### 合并 develop 的冲突处理（capability-catalog 声明表迁出 bash）

本轮 fan-in 前 `git merge develop` 撞上**一个**冲突：`plugin/scripts/capability-catalog.sh`。
develop 侧同月落了 `gap-arch-catalog-declarations-leave-bash`——把六张 `declare -A` 声明表**整表搬出**
到数据文件 `plugin/scripts/capability-catalog-declarations.json`，`.sh` 变成只做「解析自身目录 → 缺件
fail-closed → exec 渲染器」的**薄入口**，渲染器为新文件 `plugin/scripts/capability-catalog.ts`。
本条分支则是在那六张表里各插了两行。

⇒ 按「代码文件取**语义并集**」处理：**取 develop 的 `.sh`**（`git checkout develop --
plugin/scripts/capability-catalog.sh`），并把我的两处声明**逐字**重新表达进**新的注册点** JSON
（6 张表 × 2 键 = 12 行；`QUESTION` / `CADENCE` / `INVALIDATION` / `LAST_REAFFIRMED` / `MATCHING` /
`CONSUMER`）。**不是**「取 develop 版本就完事」——那会**静默丢掉**新脚本的声明。

**机械核对（不是印象）**：
- 抽取方式：从本分支落地版 `.sh`（`git show 5367a6b34:plugin/scripts/capability-catalog.sh`）按
  `[key]="value"` 逐行解析取值；**解析器先对 344 个既有键与 JSON 逐字比对**，差异全部由 develop
  侧自己的后改（9 处）与 bash 转义反解（`\"`→`"`）解释，无解析伪影；我的 12 个取值**不含反斜杠**
  ⇒ 无需转义处理。
- 结果：`bash plugin/scripts/capability-catalog.sh --summary` ⇒
  **`346 scripts | 346 declared | 0 unclassified | 341 ship`**，exit 0（合并前**实测**为
  `346 scripts | 344 declared | 2 unclassified` —— 正是我的两个新文件）；`bash
  plugin/scripts/capability-catalog.sh`（硬闸模式）同样 exit 0。
  ⚠️ 计数相对落地轮的 344 变了（346）：develop 自己新增了 `sh-census-check.ts` 与
  `capability-catalog.ts` 两个脚本 —— AC5 的判据是「自报值 = 落地前 + 新增数」，与该差值无关，
  此处如实记录口径变化。
- JSON diff 只有 **12 行新增**（无重排、无格式漂移）；`git diff develop...HEAD --name-only` 与
  ## Touches 对照 ⇒ 唯一新增成员是 `plugin/scripts/capability-catalog-declarations.json`，已补进 Touches。
