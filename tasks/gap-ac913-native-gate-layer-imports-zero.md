---
id: gap-ac913-native-gate-layer-imports-zero
title: AC-913 native 经 gate/ 层的 import 归零：mcp-server 两条改指 core/ 真身 + 「provider →
  quay/src/gate/」棘轮
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-913
---
## Proposal

**机械事实（立案当轮实测，cwd = git 根 `/data/home/yale/work/quay`，2026-10-21）**：

1. AC-913 判据今天读 **红**：`grep -rnE 'quay/src/gate/' packages/quay-native/src/` 命中 **2** 行——
   - `packages/quay-native/src/mcp-server.ts:26` → `../../quay/src/gate/shared/acceptance-runner.ts`
   - `packages/quay-native/src/mcp-server.ts:32` → `../../quay/src/gate/gate-event-store.ts`
2. 这两条 gate/ 侧路径是**纯转发 shim**（正文仅 `export * from …`），真身早已在 core：
   - `packages/quay/src/core/acceptance-runner.ts` 导出 `runAcceptance`（:271）与 `verdictFromAcceptance`（:121）——native 用到的两个符号都在，不需要改实现；
   - `packages/quay/src/core/gate-event-store.ts` 导出 `appendGateEvent`（:77）。
   ⇒ 这是**路径改指**，不是搬家。
3. 同类先例：GOAL-907 / AC-911（`tasks/gap-ac911-src-root-forwarding-shim-deletion.md`，commit `fb1c1a240`）已把 src 根 10 个转发 shim 的消费方改指 `src/core/`；本任务对 gate/ 层这最后 2 条做同一件事。native 的 `mcp-server.ts:35` 现在已是 `../../quay/src/core/goal-store.ts` 形态，改完与它一致。
4. 另外两个 provider（`packages/quay-github`、`packages/quay-backlog`）今天对 `quay/src/gate/` **零命中** ⇒ 归零目标当下可达，不是要拆活机制。
5. 判据是**字面 grep**（不是按语句位置的解析），所以只要 `packages/quay-native/src/` 下留一行含 `quay/src/gate/` 的文本就计 1 并 exit 1。**这同时是一个坑**：改 import 时若在旁边留一句 `// moved from gate/…` 的注释，判据仍然红——执行时不要留这种注释。

**改动（三块）**：

- **A. 改指两条 import**：`packages/quay-native/src/mcp-server.ts` 的 :26 → `../../quay/src/core/acceptance-runner.ts`，:32 → `../../quay/src/core/gate-event-store.ts`；注释只改描述、不复制旧路径文本。
- **B. 加棘轮**：`plugin/scripts/import-graph-check.ts` 增一条「provider → Core gate 层」规则——`packages/quay-*`（即 provider 包；`packages/quay` 本体除外）下的 tracked 文件，不得 import 解析后落在 `packages/quay/src/gate/**` 的模块（relative 与 specifier 都算）。按该文件既有形态做成**硬零**（照 kernel 第四规则，不新增 baseline 计数键 ⇒ 不改 `plugin/import-graph-baseline.json`），并保持三态：新增的 checked/evaluated 标记与「零违规」不共用同一输出值（硬规则 3b）。`--selftest` 加两条用例：注入一条 provider→gate 边 ⇒ 违规 1 / exit 1；无该边 ⇒ 0 / exit 0。
- **C. 纯注释**：`packages/quay/src/gate/shared/acceptance-runner.ts` 与 `packages/quay/src/gate/gate-event-store.ts` 的头注释今天逐字把 `quay-native` 列为 supported consumer；改完后该说法过期，删掉 `quay-native` 一词即可（shim 本身保留——`packages/quay/src/cli/gate.ts` 与 `packages/quay/test` 仍消费它）。

**非目标**：不碰 native 的 `kernel/*`（合法共享叶）与 `abi.ts`（公开 ABI 面）import；不碰 core 内部实现；不删除两个 gate 转发 shim；不改 native 的 `quay:*` 运行时依赖声明。

<!-- dedup-ref --> 相关但不同一：`gap-native-provider-relative-imports-through-gate-layer`（status: done）只做了 16 条 relative import 的测量与 FACT/JUDGMENT 分类，明文「不实现、不开 goal」；全库 `goal_ac: AC-913` 零命中 ⇒ 本任务是该 finding 中 gate/ 那 2 条的实现载体。粒度：`task-granularity-advice.ts` 对本任务 Touches 返回 `peers: []`（无 open 任务触碰同批文件）⇒ 无需合并。

## Acceptance Criteria

- [x] **AC1（正向 + 逐字判据）**：在仓库根逐字执行 AC-913 的 criterion，exit 0 且输出 `OK: native imports 0 gate-layer paths`；且 `packages/quay-native/src/mcp-server.ts` 的两条 import 分别指向 `../../quay/src/core/acceptance-runner.ts` 与 `../../quay/src/core/gate-event-store.ts`（`grep -c 'core/acceptance-runner.ts'`、`grep -c 'core/gate-event-store.ts'` 各为 1）。
- [x] **AC2（反向负控，证明判据能取假）**：临时在 `packages/quay-native/src/` 保留一条 gate/ 层 import（把 mcp-server.ts:26 改回，或临时新增一行）⇒ criterion 输出计数 1、stderr 含 `native imports 1 gate-layer path(s) (want 0)`、exit 1；移除后重跑 ⇒ exit 0。两次读数、命令与退出码写进本任务 Execution record；负控改动不得留在落地树里（`git status --short packages/quay-native/src/` 只剩预期改动）。
- [x] **AC3（棘轮 + 其自身可证伪）**：`node --experimental-strip-types plugin/scripts/import-graph-check.ts` 在真树 exit 0，`--json` 输出含新的 provider→gate 轴且 `evaluated:true`、违规数 0；`--selftest` 含两条新用例并全绿：注入 provider→gate 边 ⇒ 违规 1 + exit 1，无该边 ⇒ 0 + exit 0；`plugin/test/import-graph-check.test.mjs` 覆盖该区分。
- [x] **AC4（scoped 门）**：`bash scripts/test.sh --for-task gap-ac913-native-gate-layer-imports-zero` exit 0（覆盖本任务 Touches 的 scoped static checks 与 `plugin/test/import-graph-check.test.mjs`）。

## Definition of Done

- 四条 AC 全绿，且 **AC2 的负控读数（1 → 红，0 → 绿）作为 Execution record 留在本任务体内**——只报「改完了」不算，判据必须被亲眼看到取假一次。
- **真实落地载体**：落地后的 `develop` 树上，AC-913 criterion 逐字读 0（`git show develop:packages/quay-native/src/mcp-server.ts | grep -c 'quay/src/gate/'` = 0）；`import-graph-check` 的 provider→gate 轴在**真树**读 `evaluated:true` / 0 违规（不是只在 selftest fixture 里读 0）。
- 两个 gate 转发 shim 的头注释不再声称 quay-native 是其 consumer（纯注释改动，shim 保留）。
- native 行为不变：`quay-native` 的 MCP 路径（`goal_gate` / `task_check` 等）在 suite 中照常通过，import 改指不改变运行时符号来源。

## Execution record

**Worker run — 2026-10-21**（worktree `/home/yale/work/quay-worktrees/gap-ac913-native-gate-layer-imports-zero`，branch `task/gap-ac913-native-gate-layer-imports-zero`，commit `e6a86b478`）

### A. 改指两条 import（AC1）

`packages/quay-native/src/mcp-server.ts`：
- :26 `../../quay/src/gate/shared/acceptance-runner.ts` → `../../quay/src/core/acceptance-runner.ts`
- :32 `../../quay/src/gate/gate-event-store.ts` → `../../quay/src/core/gate-event-store.ts`

逐字判据（仓库根执行）：
```sh
n=$(grep -rnE 'quay/src/gate/' packages/quay-native/src/ 2>/dev/null | wc -l)
if [ "$n" -ne 0 ]; then echo "native imports $n gate-layer path(s) (want 0)" >&2; exit 1; fi
echo "OK: native imports 0 gate-layer paths"
```
读数：`OK: native imports 0 gate-layer paths`，**exit 0**。

```
grep -c 'core/acceptance-runner.ts' packages/quay-native/src/mcp-server.ts  → 1
grep -c 'core/gate-event-store.ts'  packages/quay-native/src/mcp-server.ts  → 1
```

### B. AC2 负控（判据被亲眼看到取假一次）

把 `mcp-server.ts:26` 临时改回 `../../quay/src/gate/shared/acceptance-runner.ts`，逐字执行同一 criterion：

| 状态 | n | stderr | exit |
|---|---|---|---|
| 负控在树（mcp-server.ts:26 改回 gate/ 路径） | **1** | `native imports 1 gate-layer path(s) (want 0)` | **1** |
| 移除负控后重跑 | **0** | —（`OK: native imports 0 gate-layer paths`） | **0** |

负控命中行（原始读数）：`packages/quay-native/src/mcp-server.ts:26:import { runAcceptance, verdictFromAcceptance } from "../../quay/src/gate/shared/acceptance-runner.ts";`

负控改动已移除，落地树里 `git status --short packages/quay-native/src/` 只剩 ` M packages/quay-native/src/mcp-server.ts`（预期改动）。

### C. AC3 棘轮 + 其自身可证伪

- 真树：`node --experimental-strip-types plugin/scripts/import-graph-check.ts --root .` → exit 0；`--json` 读：
  `evaluated:true, gateLayerChecked:true, gateLayerViolations:0, gateLayerReason:null, verdict.gateLayerBlocked:false`。
- `--selftest` → `PASS — all 14 case(s) behaved`（exit 0），含两条新用例：
  - `provider-imports-core-gate (… /x.ts → …/gate/y.ts ⇒ FAIL)`：`gateLayerChecked=true gateLayerViolations=1 exit=1`（违规 1 ⇒ 红）；
  - `provider-imports-core-outside-gate (…/core/y.ts ⇒ PASS)`：`gateLayerChecked=true gateLayerViolations=0 exit=0`（无该边 ⇒ 绿）。
- `plugin/test/import-graph-check.test.mjs` 新增 6 条 AC-913 用例（相对说明符；core/ 负控；注释不算；裸包名 `quay/src/gate/…` 与 `exports` 映射两种形态；`gateLayerChecked` 三态区分；真树读数），`node --test` **31/31 pass**。
- 硬零：**未改** `plugin/import-graph-baseline.json`（不新增计数键）；`gateLayerChecked` 与「零违规」不共用输出值（无 provider 文件 / gate 目录缺失 ⇒ `checked:false` + reason）。

### D. AC4 scoped 门

`bash scripts/test.sh --for-task gap-ac913-native-gate-layer-imports-zero --allow-thin` → **exit 0**（`tests 132 / pass 132 / fail 0`），覆盖 Touches 的 scoped static checks 与 `plugin/test/import-graph-check.test.mjs`。

### E. 非目标核对

未改 native 的 `kernel/*` / `abi.ts` import；未删除两个 gate 转发 shim（`packages/quay/src/cli/gate.ts` 与 `packages/quay/test` 仍消费）；未改 `packages/quay-native/package.json`；两个 shim 头注释仅删除 `quay-native` 一词。

## Touches

- tasks/gap-ac913-native-gate-layer-imports-zero.md
- packages/quay-native/src/mcp-server.ts
- plugin/scripts/import-graph-check.ts
- plugin/test/import-graph-check.test.mjs
- packages/quay/src/gate/shared/acceptance-runner.ts
- packages/quay/src/gate/gate-event-store.ts
