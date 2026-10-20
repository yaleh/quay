---
id: gap-routine-architecture-analysis-dup-parseflags-three-bins
title: "architecture-analysis: Three byte-identical 20-line --flag/positional
  parsers (archguard dup hash 0894cf83d4e2ca49, 174 tokens) across the three
  provider CLI bins, so --flag=value "
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
Three byte-identical 20-line --flag/positional parsers (archguard dup hash 0894cf83d4e2ca49, 174 tokens) across the three provider CLI bins, so --flag=value or bool semantics changes need three edits.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1792481915389` · ts `2026-10-20T07:38:35.389Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseFlags`
- 涉及文件：
- `packages/quay-backlog/bin/quay-backlog.ts:23`
- `packages/quay-github/bin/quay-github.ts:33`
- `packages/quay-native/bin/quay-native.ts:83`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract one parseFlags into a shared bin util and import it from all three bins; AC: one definition under `git grep -n 'function parseFlags'` and three bin smoke tests (`--help`) stay green.

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-parseflags-three-bins`（routine `architecture-analysis`，runId `architecture-analysis-1792481915389`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence
处置 = **修掉**（不是「已注意到」）：三个 bin 各自的 20 行 `parseFlags` 已删除，改为 import 仓库里**唯一**的
定义 `packages/quay/src/cli/flags.ts` 的 `export function parseFlags`（core 已有的共享 util，不新造第四份）。

实跑读数（worktree `packages/quay-backlog|quay-github|quay-native/bin/*.ts` 改动，commit `d8dde59fe`）：

1. `git grep -nE '^[[:space:]]*(export[[:space:]]+)?function[[:space:]]+parseFlags' -- '*.ts' '*.mjs' '*.js'`
   → **count=1**，唯一命中 `packages/quay/src/cli/flags.ts:84`（改前为 4：3 个 bin 副本 + core）。
2. 三个 bin 的 `--help` smoke 与改前逐字一致：`quay-native` / `quay-github` 打印各自 usage 并 exit 1；
   `quay-backlog` 在未设 `QUAY_BACKLOG_TASKS_DIR` 时打印同一条 resolveTasksDir 错误并 exit 1（改前改后同形）。
3. 直接相关测试 28 项全绿：`packages/quay/test/flags.test.mjs`、`packages/quay-github/test/cli.test.mjs`、
   `packages/quay-backlog/test/mcp-server.test.mjs`、`packages/quay-native/test/cli-adr.test.mjs`、
   `packages/quay-native/test/document-cli.test.mjs`。
4. `packages/quay-native/scripts/build-dist.mjs` bundle 重建成功，产物 `--help` 输出同一 usage。

## Touches
- `packages/quay-backlog/bin/quay-backlog.ts`
- `packages/quay-github/bin/quay-github.ts`
- `packages/quay-native/bin/quay-native.ts`
- `tasks/gap-routine-architecture-analysis-dup-parseflags-three-bins.md`

## Blocker

**2026-10-20T07:58:03.966Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: __PERFILE__ duration_ms=1734 packages/quay-github/test/task-check-passthrough.test.mjs passed=false end_ms=1792482938734 cpu_ms=2017.821 mem_peak_kb=72796
- run_id：wk-prod-anchor
- session_id：9a774e46-3a67-41ac-95ad-9fe08f8ec4c1
