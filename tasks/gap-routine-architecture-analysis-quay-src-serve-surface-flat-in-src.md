---
id: gap-routine-architecture-analysis-quay-src-serve-surface-flat-in-src
title: "architecture-analysis: packages/quay/src carries fanIn 259 / fanOut 662
  / 52 top-level files, of which 24 are serve*/server-state (~15795 lines:
  serve-i18n 2779, serve-dashboard 19"
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
packages/quay/src carries fanIn 259 / fanOut 662 / 52 top-level files, of which 24 are serve*/server-state (~15795 lines: serve-i18n 2779, serve-dashboard 1965, serve-render 1303) — the whole web surface sits flat in src/ while cli/, core/, gate/, kernel/ are real subpackages.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792599464308` · ts `2026-10-21T16:17:44.308Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`handleAllRoutes`、`startDashboardSnapshotRefresh`、`startBoardSnapshotRefresh`、`resolveServeBinding`
- 涉及文件：
- `packages/quay/src/serve.ts:19`
- `packages/quay/src/serve-handlers.ts:1`
- `packages/quay/src/serve-dashboard.ts:1`
- `packages/quay/src/serve-i18n.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Mechanically move the serve* family into packages/quay/src/serve/ (matching the cli/core/gate/kernel convention) and re-export from a serve/index.ts; no behavior change.

## Disposition

复核结论：finding **成立（不是误报、不是已过期）**，Requested action **已逐字执行**。

### 1. 复核（按位置，不按关键词）

`packages/quay/src` 顶层当时 52 个文件，其中 **24 个**属 web/HTTP 面（`serve.ts` + 22 × `serve-*.ts` +
`server-state.ts`），而 `cli/`(28)、`core/`(15)、`gate/`(11)、`kernel/`(16)、`primitives/`(9) 都是真子包。
探测点名的四个符号全部落在这批文件里（`handleAllRoutes` → serve-handlers、`startDashboardSnapshotRefresh`
→ serve-dashboard、`startBoardSnapshotRefresh` → serve-board、`resolveServeBinding` → serve-binding）。
层次混淆是真实的：读 `src/` 的人无法从位置区分「Core 库」与「web 面」。

### 2. 处置（= Requested action）

- 24 个模块 `git mv` 进 `packages/quay/src/serve/`（git 识别为 24 条 rename，内容改动比 R098–R100）。
- 新增 `packages/quay/src/serve/index.ts`：25 条 `export *`，**不是手维护的符号清单**
  （手维护清单在模块新增导出时会静默漏掉，硬规则 3b；`tsc` 是「barrel 完整」的判据）。

### 3. 「no behavior change」不是自证，有两个直接量

- **类型层**：`tsc --noEmit` 对 `packages/quay`、`quay-native`、`quay-github`、`quay-backlog` 四个包
  全部 EXIT=0（含新 barrel ⇒ 无重名导出冲突）。
- **字节层**：`packages/quay/test/characterization-serve-routes.test.mjs` 的逐路由响应快照
  （147 条 GET 路由的归一化字节 vs 已提交基线）逐字一致 —— 这是「渲染输出没变」的直接量，
  不是「我觉得没变」。

### 4. import 重写用「解析后重算」，不是字符串替换

被移动文件内部：对非 serve 模块的 `./x.js` → `../x.js`，对兄弟 serve 模块的 `./serve-x.js`
**保持不动**（仍在同目录）。外部 importer 的 specifier 按「旧位置解析 → 新位置重算相对路径」得出。
共 **299 条 specifier**（147 个文件）+ **160 处** repo-relative 字面路径 + **24 处**
`path.join(..., "src", "<file>.ts")` 段式路径。

### 5. 成簇的随动点位（硬规则 5b：修一个不等于只存在一个）

移动会让「按字面路径读源文件」的检查**静默读空**（读不懂 ≠ 合格，硬规则 3b）。同一批改动覆盖：

- `plugin/scripts/` 的 checker 常量：`HOLDER_REL` / `ADVISORY_ALLOWLIST`（serve-binding-literal-check）、
  `WEB_ROUTE_FILES`（host-repo-surface-ratchet）、`SERVE_READER_REL`（config-wiring-check）、
  `enum-surface-parity-check` 的 4 条 file 字段、`runner-static-gate` 的 `@static-object` 依赖面、
  以及 `driver-runtime` / `start-drivers` / `send-to-session` 的静态与动态 import。
- 两个 checker-mutation-case（`host-repo-surface-ratchet.sh`、`serve-binding-literal-check.sh`）的
  **fixture 布局**：它们把被测 checker 指向的路径在临时根下重建，路径不同步则 case 会在错误的位置
  注入（表现为 INFRASTRUCTURE 或假绿）。两者改动后实跑 EXIT=0。
- 三个把「目录 + 文件名」拼起来的测试（`serve.test.mjs` 的 serve-* 枚举、`serve-task.test.mjs` 的
  三文件扫描、`serve-board.test.mjs` / `webui-modernist-sync.test.mjs` 的 source-text 检查）改为
  `src/serve` 基址；`gap-webui-tests-page-unpaginated-tables` 的 `<table>` 枚举命令改为
  `packages/quay/src/serve/serve-*.ts`。

### 6. 移动暴露出的唯一真实运行时依赖（不是注释问题）

`serve-render.ts` 用 `new URL("./webui-modernist.css", import.meta.url)` 读设计 token 表 ——
模块下沉一层后该相对路径失效，样式表**静默变空**，`characterization-serve-routes` 当场红 21 条路由。
改为 `../webui-modernist.css` 后快照恢复逐字一致。
⛔ 没有把 `.css` 一起搬进 `serve/`：它不属于 serve* 家族，且 `build-dist.mjs`（`:84`）与
`webui-modernist-sync.test.mjs` 按 `src/webui-modernist.css` 钉住它。

### 7. 历史路径不回写

两处 `git show <rev>:<path>` 的注释指向**那个 rev 实际携带的旧路径**，保持旧路径并注明文件已移动 ——
把它们改成新路径会让注释对那个 rev 说谎。

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `quay-src-serve-surface-flat-in-src`（routine `architecture-analysis`，runId `architecture-analysis-1792599464308`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/serve/**`
- `packages/quay/src/*.ts`
- `packages/quay/src/cli/*.ts`
- `packages/quay/src/kernel/*.ts`
- `packages/quay/test/*.mjs`
- `packages/quay/scripts/*.mjs`
- `packages/quay-native/src/*.ts`
- `plugin/scripts/*.ts`
- `plugin/scripts/checker-mutation-cases/*.sh`
- `plugin/test/*.mjs`
- `docs/analysis/*.mjs`
- `experiments/quay-perpetual-stream/test/*.mjs`
- `experiments/quay-perpetual-stream/milestones/**`
- `tasks/gap-routine-architecture-analysis-quay-src-serve-surface-flat-in-src.md`
