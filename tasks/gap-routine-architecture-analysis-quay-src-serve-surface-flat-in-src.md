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

- 24 个模块 `git mv` 进 `packages/quay/src/serve/`（git 识别为 24 条 rename，内容相似度 R098–R100，
  即「纯移动」由 git 的相似度判定直接给出，不是自述）。
- 新增 `packages/quay/src/serve/index.ts`：25 条 `export *`，**不是手维护的符号清单**
  （手维护清单在模块新增导出时会静默漏掉，硬规则 3b；`tsc` 是「barrel 完整」的判据）。
- 移动后 `packages/quay/src` 顶层文件数 52 → 29。

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
- 四个把「目录 + 文件名」拼起来的测试（`serve.test.mjs` 的 serve-* 枚举、`serve-task.test.mjs` 的
  三文件扫描、`serve-board.test.mjs` / `webui-modernist-sync.test.mjs` 的 source-text 检查）改为
  `src/serve` 基址；`gap-webui-tests-page-unpaginated-tables` 的 `<table>` 枚举命令改为
  `packages/quay/src/serve/serve-*.ts`；`host-repo-surface-ratchet.test.mjs` 的 fixture
  **mkdir 目标**也随之下沉一层（否则写 fixture 时 ENOENT）。

### 6. 移动暴露出的唯一真实运行时依赖（不是注释问题）

`serve-render.ts` 用 `new URL("./webui-modernist.css", import.meta.url)` 读设计 token 表 ——
模块下沉一层后该相对路径失效，样式表**静默变空**，`characterization-serve-routes` 当场红 21 条路由。
改为 `../webui-modernist.css` 后快照恢复逐字一致。
⛔ 没有把 `.css` 一起搬进 `serve/`：它不属于 serve* 家族，且 `build-dist.mjs`（`:84`）与
`webui-modernist-sync.test.mjs` 按 `src/webui-modernist.css` 钉住它。

### 7. 历史路径不回写

两处 `git show <rev>:<path>` 的注释指向**那个 rev 实际携带的旧路径**，保持旧路径并注明文件已移动 ——
把它们改成新路径会让注释对那个 rev 说谎。
（2026-10-22 续做轮更正：`gap-git-graph-...test.mjs` AC10 的 `303a94950^:packages/quay/src/serve-git.ts`
曾被误改成 `serve/serve-git.ts`，那是**把历史 rev 的路径回写**，已恢复为 flat 路径。）

### 8. 续做轮补齐的「移动随动点位」（suite 抓出的 9 处）

上一轮 scoped 门绿、但全量 suite 在下列位置抓到遗留的 flat 路径假设（全部是真 RED，不是环境噪声）：

- `plugin/test/ownership-active-loop.test.mjs`：输入串仍是 `./packages//quay/src/./serve.ts`，期望值却被
  改成 `serve/serve.ts` ⇒ 归一化器正确返回 flat 路径。改为输入也走进 `serve/`（被测的是 `//`/`./` 归一化，
  仍然能取假）。
- `packages/quay/test/serve-handlers.test.mjs`：注释已更新、断言正则还钉 flat `src/serve-send.ts`。
- `packages/quay/test/config-validate.test.mjs`：`targets` 仍按 `serve.ts` 读源码 ⇒ ENOENT；改为
  `path.join("serve","serve.ts")`。同文件的 archived-rev 注释同步改回 flat（见 §7）。
- `plugin/test/fan-in-execute-paths-s01.test.mjs`：code-delta 正则钉 flat `serve-handlers.ts`。
- `plugin/test/session-primitives-adoption.test.mjs`：serve-send 对 primitives 的 import 由 `./primitives/`
  变成 `../primitives/`，正则未随动。
- `packages/quay/test/serve.test.mjs`：stale-code fixture 只 mkdir 到 `src/`，写 `src/serve/serve.ts` ENOENT。
- `plugin/test/quay-init-characterization.test.mjs`：`generateConfigContent` 的 `# Section 4` 注释路径变了
  ⇒ fresh-install `.quay/config.yml` 的 pin 重新锚定（其余 5 个面 hash 未变，正是「改动被限制在配置写入器」的交叉核）。
- `goals/AC-146` / `goals/AC-253` 的 criterion 里钉着旧 carrier 路径 ⇒ 按
  `goal-criterion-import-specifiers-resolve` 的要求重新锚定到新 carrier（不是回退移动）。

### 9. 判据实跑读数（本任务分支，非自述）

- **scoped 门** `bash scripts/test.sh --for-task <id> --allow-thin`：上一轮 **EXIT=0**；
  全部 scoped 静态检查 PASS（含 `checker-mutation-check --check-changed`、
  `checked-in-write-check --changed`（148/212 delta 路径被判定，0 次写进树）、
  `import-graph-check`、`sh-census-check`、`suite-bucket-reattr-ratchet-check`、`landing-target-check`），
  测试阶段 `✔ 90 / ✖ 0`。
- **anti-drift Touches**：上一轮补入 `packages/quay/test/helpers/*.mjs`（真实随动文件，不回退）。
- 逐个复跑受影响的最大风险测试文件：`characterization-serve-routes`(3/3)、`serve-task`(12/12)、
  `serve-nav-inconsistent-routes`(12/12)、`webui-modernist-sync`(6/6)、
  `gap-webui-tests-page-unpaginated-tables`(5/5)、`host-repo-surface-ratchet`(9/9)、
  `serve-binding-literal-check`、`config-key-consumer-check`、`import-graph-check`、
  `delivery-status-single-source`、`suite-bucket-attribution`、`kernel-sibling-resolution-check`
  —— 全绿。
- 续做轮逐文件复跑 §8 的 9 处（含 `serve.test.mjs` 1/1、`serve-handlers.test.mjs` 63/63、
  `ownership-active-loop` 60/60、`config-validate` 65/65、`fan-in-execute-paths-s01` 10/10、
  `session-primitives-adoption` 10/10、`goal-criterion-import-specifiers-resolve` 14/14、
  `gap-git-graph-...` 14/14、`quay-init-characterization` 4/4）—— 全绿。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `quay-src-serve-surface-flat-in-src`（routine `architecture-analysis`，runId `architecture-analysis-1792599464308`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `packages/quay/src/serve/**`
- `packages/quay/src/*.ts`
- `packages/quay/src/cli/*.ts`
- `packages/quay/src/kernel/*.ts`
- `packages/quay/test/*.mjs`
- `packages/quay/test/helpers/*.mjs`
- `packages/quay/scripts/*.mjs`
- `packages/quay-native/src/*.ts`
- `plugin/scripts/*.ts`
- `plugin/scripts/checker-mutation-cases/*.sh`
- `plugin/test/*.mjs`
- `goals/AC-146-human-interface-explicit-owner.md`
- `goals/AC-253-会话读写原语统一到共享层-四个模块在本仓库可用且有非测试消费者-spec-阶段-a3.md`
- `docs/analysis/*.mjs`
- `experiments/quay-perpetual-stream/test/*.mjs`
- `experiments/quay-perpetual-stream/milestones/**`
- `tasks/gap-routine-architecture-analysis-quay-src-serve-surface-flat-in-src.md`

## Blocker

（上一轮的 exited-not-landed 已在续做轮定位并修复：suite 抓到的 9 处 flat 路径随动点位，见 §8。
真实原因不是环境噪声 —— delta 相关性提示里标 UNRELATED 的 `goal-criterion-import-specifiers-resolve`
同样由本次移动直接造成。）
