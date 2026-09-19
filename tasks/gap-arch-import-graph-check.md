---
id: gap-arch-import-graph-check
title: 架构棘轮：按语句位置解析 import 的模块依赖图检查器（值级环 / 类型级环 / 产品层→方法学层反向边），三个量只降不升
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**建一个按【语句位置】解析 import/export 的模块依赖图检查器 `plugin/scripts/import-graph-check.ts`，把三个结构量变成「只降不升」的棘轮，并接入套件静态层。**

来源：`orchestration/SPEC-architecture-consolidation-ts-and-shell-2026-09-19.md`（下称 SPEC；⚠️ 该文件此刻位于分支 `worktree-spec-architecture-refactor`，可能尚未在 develop 上——**本任务体自足，不依赖读到它**）§2 P1 / §5 Phase 0a。人 2026-09-19 已裁定共享原语落点为 `packages/quay/src/kernel/`。

**为什么需要它（实测，非印象）**：archguard 对 `plugin/scripts` 只当成单个 `(root)` 包，`detect_cycles` 返回 `[]`，而对同一批文件自写的 import 图算出 3 个文件级环（1 个值级、2 个类型级）。⇒ archguard 的「0 环」只能读作「未评估」。此外 `packages/quay` 与 `quay-native` 反向 import `plugin/scripts`（5 条边），没有任何检查在盯。

**要量的三个量（每个都是「会回升」的量，故必须做成棘轮）**：
1. `valueSccs`：只用【值导入】边（`import x from`、`export … from`、动态 `import()`；`import type`/`export type` 不算）构成的强连通分量（大小≥2）。**当前基线 = 1**：`plugin/scripts/ready-pool-check.ts:238` 值导入 `judgePoolCandidate`（自 `strategic-doc-staleness-check.ts`），后者 `:55` 值导入 `stripCodeSpans`（自 ready-pool-check）。
2. `typeSccs`：把类型边也算进去才成立、但仅用值边不成立的 SCC。**当前基线 = 2**：①`gate/registry.ts` 值导入 `gate/factories/{document-contract,goal}.ts`，而 11 个工厂 `import type { GateFn } from "../registry.ts"`（SCC 大小 11）；②`full-suite-runner.ts` 值导入 `runner-state-write.ts`/`runner-red-parse.ts` 等，后两者 `import type` 回指它（SCC 大小 5）。
3. `reverseEdges`：`packages/**` 下的文件 import `plugin/**` 或 `experiments/**` 的边（列出 `{from,to,line}`）。**当前基线 = 5**：`packages/quay/src/serve.ts:36/38/42`（→ `driver-shared`、`write-json-atomic`、`worktree-process-reaper`）、`packages/quay/src/server-state.ts:38`（→ `write-json-atomic`）、`packages/quay-native/src/store.ts:42`（→ `shape-sections`）。

⚠️ 上面三个基线来自一个**正则**脚本（未做注释/字符串掩码）。**本任务落地时必须以检查器的真实读数为准**：若与上述数字有差异，逐条对账（哪一条是正则误判、哪一条是新发现），把对账写进任务 notes，**不得调整检查器去凑这三个数**。

**第四条规则（kernel 边界，条件性）**：若目录 `packages/quay/src/kernel/` 存在，其下文件不得 import `packages/quay/src/kernel/` 之外的任何模块（也不得 import `plugin/`、`experiments/`）。目录不存在时输出 `kernelChecked:false`——**不得**返回与「已检查且合格」同形的值（硬规则 3b）。

**设计约束（每条都对应一次已发生的错误）**：
- **按位置判定**（硬规则 2）：只认真实的 import/export 语句，注释与字符串里出现 `from "…plugin/…"` 不算。可复用仓库已有的 `buildNonCodeMask`（`plugin/scripts` 中 13 处依赖它）而不是新造。
- **数据源用 `git ls-files '*.ts'`**，不用 `find`——一次 `find` 曾因扫进 `.claude/worktrees/*`（4806 个副本）而把计数污染 10 倍以上。排除 `*.test.*`、`/test/` 目录、`node_modules`、`dist`、`archive/`。
- **符号链接按 realpath 去重**：`experiments/quay-perpetual-stream/scripts/` 有 22 个指向 `plugin/scripts/` 的符号链接，同一文件只算一个节点，相对 import 从 realpath 解析。
- **读不懂输入要说出来**（硬规则 3b）：输出 `evaluated:true|false`；解析失败/git 不可用/无文件 ⇒ `evaluated:false` + exit 2，**不得** exit 0。
- **诚实自报未覆盖面**：输出里带 `notAnalyzed:{mjs:N,js:N}`（tracked 的非测试 .mjs/.js 数），本检查器只分析 TS。
- **棘轮形态照 `plugin/scripts/quay-init-closure-ratchet.ts` 与 `test-framework-policy-check.ts`**：基线是数据文件 `plugin/import-graph-baseline.json`（`{valueSccs,typeSccs,reverseEdges}`）；读数 > 基线 ⇒ exit 1；同时基线文件在工作树里的值相对 git HEAD 里的值只许降不许升（防止「调高基线」绕过）；bootstrap（HEAD 尚无该文件）时以当前为基线并注明。

**CLI**：`node --experimental-strip-types plugin/scripts/import-graph-check.ts [<root>] [--json] [--selftest] [--baseline <file>]`；exit 0 = 全部不超基线；1 = 有超出；2 = 用法/环境错误。`--json` 输出至少含 `{evaluated, files, edges, valueSccs:[{files:[…]}], typeSccs:[…], reverseEdges:[…], kernelChecked, notAnalyzed}`。

**新增检查器的四件套义务（缺一不可，各自在套件不同位置报红）**：①`plugin/scripts/capability-catalog.sh` 六张表（QUESTION/CADENCE/INVALIDATION/LAST_REAFFIRMED/MATCHING/CONSUMER）各补一行，键=basename；②登记进 `plugin/scripts/runner-static-gate.ts` 的 `run_static_checks`，带 `# @static-tier` 与 `# @static-object`；③新增 `plugin/scripts/checker-mutation-cases/import-graph-check.sh`；④把 `run_static_checks` 上的 `# @checker-count <N>` 加 1。新测试文件用 `node:test` 并在文件顶部声明 `// @test-group <name>`。

## Touches

- plugin/scripts/import-graph-check.ts (new)
- plugin/import-graph-baseline.json (new)
- plugin/test/import-graph-check.test.mjs (new)
- plugin/scripts/capability-catalog.sh
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/checker-mutation-cases/import-graph-check.sh (new)
- tasks/gap-arch-import-graph-check.md

## AC

- [ ] AC1（自检能取假）`node --experimental-strip-types plugin/scripts/import-graph-check.ts --selftest` exit 0，且输出逐行枚举 ≥6 个具名注入用例及其预期判定：值环 A↔B ⇒ 超基线 FAIL；A 值导入 B 而 B 仅 `import type` 回指 A ⇒ PASS 且 `typeSccs`+1；`packages/x.ts → plugin/y.ts` ⇒ `reverseEdges`+1 且超基线 FAIL；仅在注释/字符串字面量里出现的 `from "../plugin/…"` ⇒ **不计数**；kernel 目录存在且其文件 import 了 kernel 之外 ⇒ FAIL；空输入/非 git 目录 ⇒ `evaluated:false` 且 exit 2（不是 0）。
- [ ] AC2（真样本，零计数的配套）在真实仓库根跑 `node --experimental-strip-types plugin/scripts/import-graph-check.ts --json`：`evaluated===true`，且 `valueSccs` 中恰有一个 SCC 同时含 `plugin/scripts/ready-pool-check.ts` 与 `plugin/scripts/strategic-doc-staleness-check.ts`；`typeSccs` 至少含一个含 `packages/quay/src/gate/registry.ts` 的 SCC 与一个含 `plugin/scripts/full-suite-runner.ts` 的 SCC。**读数为 0 视为检查器失效，不是「无环」。**
- [ ] AC3（反向边真样本）同一次 `--json` 的 `reverseEdges` 至少包含 `packages/quay/src/serve.ts`、`packages/quay/src/server-state.ts`、`packages/quay-native/src/store.ts` 三个 `from` 文件，且指向 `plugin/scripts/write-json-atomic.ts` 与 `plugin/scripts/shape-sections.ts`；若总数 ≠5，任务 notes 里有逐条对账。
- [ ] AC4（去重与污染）同一次 `--json` 中每个节点路径唯一，且不含 `.claude/worktrees/`；`experiments/quay-perpetual-stream/scripts/` 下指向 `plugin/scripts/` 的符号链接不作为独立节点出现。
- [ ] AC5（棘轮）`plugin/import-graph-baseline.json` 存在且三个值等于 AC2/AC3 的真实读数；`--selftest` 含一条用例：把基线里任一值调高相对「HEAD 基线」⇒ exit 1。
- [ ] AC6（四件套）`bash plugin/scripts/capability-catalog.sh --entry-surface` exit 0；`node --experimental-strip-types plugin/scripts/checker-count-drift-check.ts` exit 0；`bash plugin/scripts/checker-mutation-check.sh --check` exit 0；`grep -n "import-graph-check" plugin/scripts/runner-static-gate.ts` 命中 `run_static_checks` 内的调用行（位置命中，非注释）。
- [ ] AC7（生产载体，非 fixture）经套件静态层**真实执行**：在任务 worktree 内用 `scripts/test.sh` 的 scoped/静态入口（见其头注释）跑一次，产出里能看到 `import-graph-check` 被执行且判定 PASS（不是仅被登记）；关掉 `--selftest` 的注入 seam 后该结论仍成立。把该次命令与输出关键行贴进 notes。

## DoD

真实落地标准（DIR-026 Reading A）：检查器已经**通过套件静态层在真实仓库上跑过一次**并输出真实基线；**负控制已实做并留证**——在任务 worktree 临时加一条 `packages/quay/src/` → `plugin/scripts/` 的 import（以及一个人造值环），套件静态层变红，撤销后转绿，两次输出贴进 notes。fixture 全绿而未在真实树上跑过 ⇒ 不算完成（硬规则 4 推论三）。落地后 `bash plugin/scripts/capability-catalog.sh --summary` 的脚本数自报值比落地前 +1，且 UNCLASSIFIED=0。不修改任何 `packages/**` 生产代码——本任务只观测，纠正在 Phase 2/3 的其它任务里做。
