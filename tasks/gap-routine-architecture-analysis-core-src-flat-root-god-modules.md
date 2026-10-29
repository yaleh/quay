---
id: gap-routine-architecture-analysis-core-src-flat-root-god-modules
title: "architecture-analysis: archguard flags the packages/quay/src root as a
  god package (29 files, 334 entities, tooManyFiles+tooManyEntities): init.ts
  4,154 lines/79 exports, observati"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
archguard flags the packages/quay/src root as a god package (29 files, 334 entities, tooManyFiles+tooManyEntities): init.ts 4,154 lines/79 exports, observation.ts 3,907 lines/169 exports, mcp-handlers.ts 1,228 lines, serve-i18n.ts 2,780 lines/65 exports — no domain grouping.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793251760204` · ts `2026-10-29T05:29:20.204Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`init`、`observation`、`mcp-handlers`、`buildInitReport`
- 涉及文件：
- `packages/quay/src/init.ts:1`
- `packages/quay/src/observation.ts:1`
- `packages/quay/src/mcp-handlers.ts:1`
- `packages/quay/src/serve/view/serve-i18n.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Group the 29 root modules into domain subpackages (init/, observation/, mcp/) and split observation.ts's 169 exports and init.ts by phase, leaving explicit index surfaces.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-29T05:29:20.204Z

## Disposition（复核 + 处置，2026-10-29）

### 复核：在改动前的树上重测，不复述 finding

| 主张 | 实测（改动前，`d047b0156^`） |
|---|---|
| 根目录 29 个 top-level 模块 | `ls packages/quay/src/*.ts \| wc -l` → **29** ✅ |
| 「no domain grouping」 | ❌ 不准确：同一目录下**已有 9 个领域子目录**（`cli/ core/ fan-in/ gate/ kernel/ observation/ primitives/ serve/ ts-demo/`）。根上的 29 个是**尚未收编的剩余集**，不是「完全没有分组」 |
| `init.ts` 4,154 行 / 79 exports | **4,157 行** / `grep -c '^export '` = **79** ✅ |
| `observation.ts` 3,907 行 / 169 exports | 3,907 行 / **169** ✅ |
| `mcp-handlers.ts` 1,228 行 | 1,228 行 / 11 导出 ✅ |
| `serve-i18n.ts` 2,780 行 / 65 exports | 2,780 行 / **80** 导出（口径不同，finding 的 65 无法用 `^export ` 复现） |

archguard 0.1.44，本 worktree，`packages/quay/src` scope（manifest key `4d135286`）：
- **改动后** `(root)` 包：`fileCount=29 / entityCount=284`，flag 仍为 `tooManyFiles+tooManyEntities`。
- 同一 instrument 在 finding 的 runId 记的是 **334 entities** ⇒ 本轮把根包实体数 **334 → 284（−47，等于搬走的顶层声明数）**，但**没有清掉 flag**。

**该 flag 的阈值不可校准——这不是本任务的新判断，是仓内既有结论**：`plugin/scripts/archguard-runner.ts`
头注释写明「god-package / 重复抽象是需要阈值的维度，留待数据积累」。本次实测佐证：同一 scope **41 个包里
18 个被 flag**（`core` 212 entities、`kernel` 90、`cli` 80、`gate/factories` 9……），默认阈值
（minFiles=20 / minEntities=50）在本仓几乎每个目录都命中 ⇒ 它不是一个「哪个目录出了问题」的判别器。

### 处置：取 finding 的可执行半边（按相位切开 god module）

`packages/quay/src/init.ts` 按三条**相位缝** verbatim 切开，`init.ts` 留成编排模块 + 显式 re-export 面
（即 requested action 要的 "leaving explicit index surfaces"）：

| 相位 | 新模块 | 行数 |
|---|---|---|
| 载体目录 pin（`ensure_provider_carrier_env`）+ 行级 YAML 块助手 | `packages/quay/src/init/carrier-env.ts` | 177 |
| provider 相位：enabled 文本翻转 / 项目内插件链接 / 陈旧 MCP entry 迁移 / loop-scripts 推导 / provider entry file | `packages/quay/src/init/provider-maintenance.ts` | 669 |
| 交付面相位：L1 delivery / runtime existence / `.claude/settings` / closed set / install steps | `packages/quay/src/init/delivery-surface.ts` | 479 |

依赖方向单向：`init.ts → delivery-surface → provider-maintenance → carrier-env`；相位模块只 import
`../core/*` / `../kernel/*`，⛔ 永不 import `../init.ts`（会成环）。

**可核读数（同一棵树，实现提交 `d047b0156`）：**
- `init.ts` **4,157 → 2,841 行**；导出行 **79 → 48**。
- **运行时导出集合逐字比对**（`import()` 旧/新模块后比对 `Object.keys`）：old **53** / new **53**，`missing=0`，`added=0`。
- **类型导出 26 个**逐一仍可从 `./init.ts` import（生成 `import type {...} from "./init.ts"` 后 `tsc --noEmit` exit 0）。
- `npx tsc --noEmit -p tsconfig.json` → exit 0。
- 测试批（`init` / `init-install-steps-user-scope` / `init-provider-registry` / `install-config-driven-e2e` /
  `branch-model` / `architecture-boundaries` / `cli` / `server-status-web-control-same-pid`）：181 pass，
  唯一红是 `server-status-web-control-same-pid.test.mjs` 的 **AC4「built dist bundle」**——该 worktree
  没有 `packages/quay/dist`（`scripts/test.sh` 会先 build），报错文本即
  `the CLI entry under test is the prebuilt bundle`；同一文件的 `loaded_version` 判据全绿（见下）。

### 没做的那半边，以及「已有机制在管、失败在哪一步」

1. **「29 个根模块搬进 init/ observation/ mcp/ 三个领域包」不是这个 flag 度量的东西。** flag 量的是
   **每目录**的 file/entity 计数；搬家只把计数从一个目录挪到另一个。证据：`core`(27 文件/212 实体)、
   `kernel`(23/90)、`cli`(30/80) 已经在「已分组」状态，**被同一个判据同样 flag** ⇒ 分组不是该判据的解。
2. **搬家有实测的结构风险，本轮真撞上了。** 第一版切分让 `init/` 里的相位模块 import `../config.ts` /
   `../loaded-version.ts`（都在 src 根）⇒ `archguard-runner` 立刻报
   `src — directoryCycleCount=1 directoryCycles=["init",""]`（`init ↔ ""` 目录环），exit 1。
   修法：`loaded-version.ts` 的实现**下沉**到 `core/loaded-version.ts`，根路径留转发 shim（与
   `config.ts` 在 `gap-src-root-gate-cycle-break` 之后的形态逐字同构）；`../config.ts` 同理改指
   `../core/config.ts`。修完 archguard-runner **六个 scope 全 PASS**（`directoryCycleCount=0`、
   `entitySccCount=0`，`evaluated=true`）。
   ⇒ 这就是「已有机制在管」的那一步：**目录环闸在管，而失败点是「把根模块下沉」这个动作本身**——
   每搬一个模块都要先证明它不制造 根↔子目录 的 SCC，不能按目录清单批量搬。
3. **剩余未切**：`observation.ts` 3,907 行（**已有独立任务在管**：
   `gap-routine-architecture-analysis-observation-ts-multi-responsibility-god-module`，2026-10-22 已切四道缝
   并留 seam map）、`mcp-handlers.ts` 1,228 行、`serve-i18n.ts` 2,780 行。后两者不在本任务的处置范围
   （finding 的 requested action 只点名 init 与 observation 的拆分）。

### 探测边界（如实写）
本任务处置了 finding 点名的 `init.ts` 一个文件 + 根包实体数（334→284）。`(root)` 的
`tooManyFiles+tooManyEntities` **flag 仍在**，且按上面读数它在本仓不具判别力（18/41 命中）；
不宣称「god package 已消除」。

### ADR-007 暗轴记录
- L_G archguard: cycles=0（archguard 0.1.44，本 worktree，六 scope 全 `evaluated=true`：
  src / scripts / quay-native-src / quay-github-src / quay-backlog-src / experiments-scripts；
  读数追加在 `.archguard/metrics-history.jsonl`。本改动新增 `src/init/` 子目录并把
  `loaded-version.ts` 的实体下沉到 `core/`，约束即「不新增 根↔子目录 SCC」，故该读数可作前后对照）
- L_G archguard: entitySccCount=0（同一轮六 scope）
- 相关包读数：`packages/quay/src` scope `4d135286`，`(root)` entityCount=284、`init` 包 fanIn=21/fanOut=27/cycleCount=0

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `core-src-flat-root-god-modules`（routine `architecture-analysis`，runId `architecture-analysis-1793251760204`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/init.ts`
- `packages/quay/src/init/carrier-env.ts`
- `packages/quay/src/init/provider-maintenance.ts`
- `packages/quay/src/init/delivery-surface.ts`
- `packages/quay/src/loaded-version.ts`
- `packages/quay/src/core/loaded-version.ts`
- `tasks/gap-routine-architecture-analysis-core-src-flat-root-god-modules.md`