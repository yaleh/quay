---
id: gap-native-provider-relative-imports-through-gate-layer
title: native provider 经 gate/ 层路径（relative import）触 Core —— 分层实测 +
  判断（ARCH-M93-004 清零的是 package-specifier 形式，本 finding 针对 relative 形式）
status: ready
labels:
  - gap
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Finding

实测（fresh archguard scope b4f87b21 @ HEAD 75198f775，2026-10-21，逐行核对源码）：quay-native（三个 provider 中唯一有运行时 `quay` 依赖的）以 relative 形式 import Core 深层：`../../quay/src/gate/shared/acceptance-runner.ts`（mcp-server.ts:26）、`../../quay/src/gate/gate-event-store.ts`（mcp-server.ts:32）、`../../quay/src/kernel/gate-run-options.ts`（mcp-server.ts:29）、`../../quay/src/kernel/task-transition.ts`（store.ts:40）、`../../quay/src/kernel/shape-sections.ts`（store.ts:75）、`../../quay/src/kernel/task-shape-artifacts.ts`（store.ts:89）。分类（FACT）：kernel/* 是设计上的共享叶（允许双向到达）；gate/shared/acceptance-runner.ts 与 gate/gate-event-store.ts 的 gate/ 侧是 `export * from "../../core/…"` 的转发 shim（gate/shared/acceptance-runner.ts:1 头注释）。注意：ARCH-M93-004（done）曾把 package-specifier 形式的 `"quay/src/…` 清零，但本 finding 针对的是尚未被它覆盖的 relative 形式。判断（JUDGMENT）：无代码复制，但 native 作为 provider 经由 `gate/` 层路径 import，绕过了「provider 只依赖 ABI 表面（core/types.ts + provider-client）」的分层意图——这是一个活的 layering 问题，不是已关闭事实。本 finding 只记录实测与判断，不实现改动、不开 goal。

**⚠️ 执行记录对上述 filed Finding 的测量更正（详见文末 Execution record）**：filed Finding 只列了 6 条（gate/kernel 子集）；同一基线上 native → Core 的 relative import/export 实现语句实际为 **16 条**。6 条与源码逐条一致但不完整。判断部分亦按 FACT / JUDGMENT 重新分离，并给出 AC2 要求的反事实对照。

## Acceptance Criteria

- [x] 「native → Core 的 relative import 清单」与当前源码逐条一致（可 `grep -rn '\.\./\.\./quay/src/' packages/quay-native/src/` 核对），且每条标出落在 kernel（合法共享叶）/ gate-side shim（转发）/ ABI 表面三类中的哪一类。
- [x] 判断标注 FACT / JUDGMENT，且「是否违反分层」明确是 JUDGMENT，附「若『provider 只依赖 ABI 表面』不是本仓库的分层意图，则本判断不成立」的反事实对照。

## Definition of Done

- 两条 AC 全绿；finding 落地为 done，其测量读数可被 `grep -rn '\.\./\.\./quay/src/' packages/quay-native/src/` 独立复核。
- 不开 goal、不写实现；若判断为「确属 layering 违规」，后续是否立案另行决定。

## Execution record（测量 + 判断，2026-10-21）

**执行基线**：worktree `/data/home/yale/work/quay-worktrees/gap-native-provider-relative-imports-through-gate-layer`，fork point `develop` = `c3d84ce29722b29a01d488843b01b12ede7313b7`。

### AC1 — 测量读数（FACT）

**命令 A（AC 原文给出的宽口径命令，逐字可复现）**：
```
$ grep -rn '\.\./\.\./quay/src/' packages/quay-native/src/
packages/quay-native/src/meta-store.ts:14:export { createMetaStore, VALID_META_STATUSES } from "../../quay/src/meta-store.ts";
packages/quay-native/src/goal-store.ts:26:} from "../../quay/src/goal-store.ts";
packages/quay-native/src/goal-store.ts:27:export type { DisposeOld } from "../../quay/src/goal-store.ts";
packages/quay-native/src/mcp-server.ts:26:import { runAcceptance, verdictFromAcceptance } from "../../quay/src/gate/shared/acceptance-runner.ts";
packages/quay-native/src/mcp-server.ts:29:import { resolveAcceptanceTimeout, timeoutKnobHint } from "../../quay/src/kernel/gate-run-options.ts";
packages/quay-native/src/mcp-server.ts:32:import { appendGateEvent } from "../../quay/src/gate/gate-event-store.ts";
packages/quay-native/src/mcp-server.ts:35:import { evaluationContext } from "../../quay/src/goal-store.ts";
packages/quay-native/src/store.ts:13:import { TASK_STATUSES, TASK_STATUS, isTaskStatus, type Task, type TaskStatus } from '../../quay/src/abi.ts';
packages/quay-native/src/store.ts:20:import { parseFrontmatterCompletely } from "../../quay/src/task-parsing.ts";
packages/quay-native/src/store.ts:26:import { commitStoreWrite, resolveCommitActor } from "../../quay/src/store-commit.ts";
packages/quay-native/src/store.ts:40:import { appendTaskStatusEvent, edgeKindFor, gitBlobSha, type TaskStatusEventActorKind } from "../../quay/src/kernel/task-transition.ts";
packages/quay-native/src/store.ts:48:import { GOAL_CARRIER_DIR_NAME, writeFaceRejectionOnCreate } from "../../quay/src/goal-ac-write-face.ts";
packages/quay-native/src/store.ts:55:import { stripHeadings } from "../../quay/src/search-index.ts";
packages/quay-native/src/store.ts:75:import { SHAPE_SECTIONS } from "../../quay/src/kernel/shape-sections.ts";
packages/quay-native/src/store.ts:89:} from "../../quay/src/kernel/task-shape-artifacts.ts";
packages/quay-native/src/store.ts:198:// definition in ../../quay/src/search-index.ts; gap-stripheadings-quadruple-
packages/quay-native/src/manifest.ts:10:import type { Manifest } from '../../quay/src/abi.ts';
```
→ 17 行 = **16 条 import/export 实现语句 + 1 条注释**（`store.ts:198`）。按硬规则 2「按位置判定」，注释里提到路径不算 import，不计入清单。

**命令 B（只取 import/export 语句的窄口径 = 下面的清单）**：
```
$ grep -rnE "(from[[:space:]]*['\"]|import[[:space:]]*\([[:space:]]*['\"])[^'\"]*\.\./\.\./quay/src/" packages/quay-native/src/
packages/quay-native/src/goal-store.ts:26:} from "../../quay/src/goal-store.ts";
packages/quay-native/src/goal-store.ts:27:export type { DisposeOld } from "../../quay/src/goal-store.ts";
packages/quay-native/src/manifest.ts:10:import type { Manifest } from '../../quay/src/abi.ts';
packages/quay-native/src/meta-store.ts:14:export { createMetaStore, VALID_META_STATUSES } from "../../quay/src/meta-store.ts";
packages/quay-native/src/mcp-server.ts:26:import { runAcceptance, verdictFromAcceptance } from "../../quay/src/gate/shared/acceptance-runner.ts";
packages/quay-native/src/mcp-server.ts:29:import { resolveAcceptanceTimeout, timeoutKnobHint } from "../../quay/src/kernel/gate-run-options.ts";
packages/quay-native/src/mcp-server.ts:32:import { appendGateEvent } from "../../quay/src/gate/gate-event-store.ts";
packages/quay-native/src/mcp-server.ts:35:import { evaluationContext } from "../../quay/src/goal-store.ts";
packages/quay-native/src/store.ts:13:import { TASK_STATUSES, TASK_STATUS, isTaskStatus, type Task, type TaskStatus } from '../../quay/src/abi.ts';
packages/quay-native/src/store.ts:20:import { parseFrontmatterCompletely } from "../../quay/src/task-parsing.ts";
packages/quay-native/src/store.ts:26:import { commitStoreWrite, resolveCommitActor } from "../../quay/src/store-commit.ts";
packages/quay-native/src/store.ts:40:import { appendTaskStatusEvent, edgeKindFor, gitBlobSha, type TaskStatusEventActorKind } from "../../quay/src/kernel/task-transition.ts";
packages/quay-native/src/store.ts:48:import { GOAL_CARRIER_DIR_NAME, writeFaceRejectionOnCreate } from "../../quay/src/goal-ac-write-face.ts";
packages/quay-native/src/store.ts:55:import { stripHeadings } from "../../quay/src/search-index.ts";
packages/quay-native/src/store.ts:75:import { SHAPE_SECTIONS } from "../../quay/src/kernel/shape-sections.ts";
packages/quay-native/src/store.ts:89:} from "../../quay/src/kernel/task-shape-artifacts.ts";
```
→ 16 条，分布在 `packages/quay-native/src/` 的全部 6 个文件。

**与 filed Finding 的差异（测量更正，FACT）**：Finding 正文列出 6 条（`mcp-server.ts:26/29/32`、`store.ts:40/75/89`），即 gate/kernel 子集；这 6 条与当前源码**逐条一致，但不完整**。filed Finding 写作时的 HEAD `75198f775` 上实现语句同样是 **16 条**（`git grep` 于该 commit 复核）——不是源码漂移，是 filed 清单漏计了 10 条。本执行记录以 16 条为完整清单。

### 逐条分类（FACT）

| # | 位置 | 目标 | 类别 |
|---|---|---|---|
| 1 | `manifest.ts:10` | `quay/src/abi.ts` | **ABI 表面**（转发 → `core/types.ts`） |
| 2 | `store.ts:13` | `quay/src/abi.ts` | **ABI 表面**（同上） |
| 3 | `mcp-server.ts:29` | `quay/src/kernel/gate-run-options.ts` | **kernel 共享叶** |
| 4 | `store.ts:40` | `quay/src/kernel/task-transition.ts` | **kernel 共享叶** |
| 5 | `store.ts:75` | `quay/src/kernel/shape-sections.ts` | **kernel 共享叶** |
| 6 | `store.ts:89` | `quay/src/kernel/task-shape-artifacts.ts` | **kernel 共享叶** |
| 7 | `mcp-server.ts:26` | `quay/src/gate/shared/acceptance-runner.ts` | **gate-side 转发 shim**（→ `core/acceptance-runner.ts`） |
| 8 | `mcp-server.ts:32` | `quay/src/gate/gate-event-store.ts` | **gate-side 转发 shim**（→ `core/gate-event-store.ts`） |
| 9 | `goal-store.ts:26` | `quay/src/goal-store.ts` | **src-root 转发 shim**（→ `core/goal-store.ts`） |
| 10 | `goal-store.ts:27` | `quay/src/goal-store.ts` | **src-root 转发 shim**（同上） |
| 11 | `mcp-server.ts:35` | `quay/src/goal-store.ts` | **src-root 转发 shim**（同上） |
| 12 | `store.ts:26` | `quay/src/store-commit.ts` | **src-root 转发 shim**（→ `core/store-commit.ts`） |
| 13 | `meta-store.ts:14` | `quay/src/meta-store.ts` | **Core 实现模块**（非 shim / 非 kernel / 非 ABI） |
| 14 | `store.ts:20` | `quay/src/task-parsing.ts` | **Core 实现模块** |
| 15 | `store.ts:48` | `quay/src/goal-ac-write-face.ts` | **Core 实现模块** |
| 16 | `store.ts:55` | `quay/src/search-index.ts` | **Core 实现模块** |

计数：ABI 表面 2 · kernel 共享叶 4 · gate-side 转发 shim 2 · src-root 转发 shim 4 · Core 实现模块 4 = **16**。

**⚠️ 关于 AC1 的「三类」口径（测量事实，不是口径选择）**：kernel / gate-side shim / ABI 表面三类只覆盖 16 条中的 **8 条**。剩余 8 条经现场核对，确实落在另外两类：**src-root 转发 shim 4 条**（`quay/src/goal-store.ts`、`quay/src/store-commit.ts` 都是 `export * from "./core/…"` 的转发 shim）与 **Core 实现模块 4 条**。按硬规则 3b，不把读不准的输入强行塞进三类伪装成合格；每条给出实际落点，口径需要扩成五类才与源码事实一致。AC1 的实体要求（清单逐条与当前源码一致 + 每条标出实际落点）由此满足。

### AC2 — FACT / JUDGMENT 分离

**FACT**

- **F1 清单**：16 条 import/export 语句，命令 A/B 可独立复现（上）。
- **F2 gate-side 两条是转发 shim**：`packages/quay/src/gate/shared/acceptance-runner.ts:1` 与 `gate/gate-event-store.ts:1` 头注释逐字写 "FORWARDING re-export"，实现体是 `export * from "../../core/…"` / `export * from "../core/…"`。两份头注释还逐字把 **quay-native 列为 supported consumer**（"stays as the supported import surface for external consumers (tests, quay-native, cli/)" / "stays for historical consumers (quay-native, plugin/scripts, plugin tests)"）。
- **F3 kernel 四条是合法共享叶**：`plugin/scripts/import-graph-check.ts` 第四规则只约束「kernel 文件不得 import kernel 之外」；四个 kernel 文件的 import 只有 `node:*` 与 kernel 内部（`shape-sections.ts` 与 `gate-run-options.ts` 均零 import）。
- **F4 ABI 表面两条**：`packages/quay/src/abi.ts` 本身也是转发 shim（`export * from "./core/types.ts"`），头注释把 quay-native 列为 supported import surface。
- **F5 src-root 转发 shim 四条**：`packages/quay/src/goal-store.ts` / `store-commit.ts` 同样是 `export * from "./core/…"` 的转发 shim，头注释同样把 quay-native 列为 supported consumer。
- **F6 无代码复制**：在 `packages/quay-native/src/` 内 grep `parseFrontmatterCompletely|runAcceptance|verdictFromAcceptance|appendGateEvent|resolveAcceptanceTimeout|timeoutKnobHint|evaluationContext|stripHeadings|createMetaStore|commitStoreWrite` 的**函数定义**，命中 **NONE**——依赖是 import，不是复制。native 自己的 `meta-store.ts` / `goal-store.ts` 也是**再导出 shim**，不是第二份实现。
- **F7 仓库内存在两条互相冲突的分层意图表述**：
  - ARCH-M93-004（M95，done）：`quay-native should not depend on Core's internal implementation modules, only the Provider ABI (quay/src/abi.ts)`。
  - 现行源码反复声明的方向：native `goal-store.ts` / `meta-store.ts` 头注释逐字写 "a Provider depending on Core's generic utility library, **NOT the reverse** — Core reaching into a Provider's internals by relative path is the ABI-violating direction"；gate/src-root shim 把 quay-native 列为 supported consumer；kernel 是两边都可用的共享叶。

**JUDGMENT**（「是否违反分层」是判断，不是事实）

- **J1（严格口径）**：若采用 ARCH-M93-004 的「provider 只依赖 `abi.ts`」，则 16 条中 **14 条**（除 2 条 `abi.ts`）绕过了该意图，含 gate 路径那 2 条 ⇒ 「确属 layering 违规」成立，且违规面比 filed Finding 的 6 条更大。
- **J2（源码声明的口径）**：若采用现行源码反复声明的方向（Provider → Core 合法；Core → Provider 才是 ABI-violating direction），则 **0/16 违规**——16 条都是该方向的实例，其中 12 条还落在头注释明确把 quay-native 列为 supported consumer 的路径上 ⇒ 原判断不成立。
- **J3（结论的性质）**：「是否违反分层」取决于哪条意图是权威，因此是 **JUDGMENT**。本任务只做测量与判断记录：不实现、不开 goal；若后续裁定严格口径为权威，需另行立案（范围应是 14 条，而非 6 条）。

**反事实对照（AC2 硬要求）**：

> 若「provider 只依赖 ABI 表面」**不是**本仓库的分层意图，则「native 经 `gate/` 层路径 relative import 触 Core，绕过分层意图 ⇒ 活的 layering 问题」这一判断**不成立**。

当前源码给出的反证据正好指向这一反事实：gate/src-root shim 的头注释逐字把 quay-native 列为 supported consumer（F2/F5），kernel 是设计上的共享叶（F3），native goal/meta-store shim 头注释逐字声明 Provider→Core 是合法方向、Core→Provider 才是违规方向（F7）。反之，若该原则确为约束性意图，则 J1 的 14 条违规成立，filed Finding 的 6 条只是其中一部分。

### 验证

- 本任务不写实现：worktree 相对 `develop` **零代码改动**（`git status --short` 空）。
- 任务体经 Provider ABI（`task_write`）更新；AC 复选框由 ABI 落盘，不手改。
- scoped 门：`bash scripts/test.sh --for-task gap-native-provider-relative-imports-through-gate-layer --allow-thin` → **EXIT=0**，`tests 118 · pass 118 · fail 0`，scoped static checks 已执行。

## Touches

- tasks/gap-native-provider-relative-imports-through-gate-layer.md
- packages/quay-native/src/mcp-server.ts
- packages/quay-native/src/store.ts
- packages/quay/src/gate/shared/acceptance-runner.ts
