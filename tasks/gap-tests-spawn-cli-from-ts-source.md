---
id: gap-tests-spawn-cli-from-ts-source
title: "Tests spawn the CLI from .ts source at 3.5s each — the prebuilt bundle
  costs 1.4s for the same behavior"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

> **判据重新评估（[[gap-the-spawn-count-criterion-was-wall-clock-and-that-is-the-wrong-axis-for-concurrency]]）**：原判据是单套件墙钟（本任务「对墙钟无影响，不动」的取舍）；在并发维度下重新评估——spawn 总数决定内核负载与可并行套件数，不是单套件墙钟。本任务结论不改、不重开；A 层剩余调用点由该任务继续转换。

## Proposal

Every test that shells out to the quay CLI pays a full TypeScript module-graph load. Measured
2026-08-02 on this machine, 3–5 runs each:

| 形态 | 单次 | 增量 |
|---|---|---|
| 裸 `node` | 363 ms | — |
| `node --experimental-strip-types -e "0"` | 374 ms | **+11 ms** |
| `+ import` 单个小模块（`config.ts`） | 966 ms | +592 ms |
| **`node --experimental-strip-types packages/quay/bin/quay.ts --help`** | **3,469 ms** | +3,106 ms |
| **`node packages/quay/dist/quay.js --help`**（1.3 MB 预构建 bundle） | **1,361 ms** | — |

Two results that contradict the obvious guess:

1. **`--experimental-strip-types` is essentially free (+11 ms).** It has been the suspected culprit;
   it is not.
2. **The cost is module-graph loading** — 40 `src/*.ts` files, 5,505 lines, 16 top-level imports in
   `quay.ts`. The prebuilt bundle collapses that to one file and saves **2.1 s per invocation (61%)**.

### Scale — 但要按关键路径读，不是按总和

`grep` across the CI glob (113 non-symlink test files): **129 call sites** reference a quay CLI
entry. 129 × 2.1 s ≈ 271 s **of summed CPU** — but the suite runs at `--test-concurrency=8`, so
**wall-clock is bounded by the slowest single file, not by the sum**.

> **修正（`gap-suite-cost-model-is-wrong-optimizations-buy-nothing`, 2026-08-02 + 对抗评审）**：这个
> 「墙钟由最慢单文件决定」的模型**已被实测否定**——套件 wall-clock（~485 s）远大于最慢文件的套件内
> 时长（cli 201.5 s），比值 Σ/wall ≈ 7.1（并发度 8）说明 8 条 lane 近饱和。但**定量因果要更谨慎**：
> 「118 s 单文件节省（隔离测得）→ 理论墙钟 15 s」这个映射**不成立**——隔离时长与套件内时长不同域
> （in-suite cli 201.5 s vs 隔离 66 s，争用主导），所以**不能用「118 s 买 2 s」断言单文件优化无效**；
> 只能说墙钟 491→489（2 s）**在噪声内不可判定**（干净噪声极差 17 s，含污染跑 63 s）。下方
> 「cli.test.mjs … 墙钟 583 s → ~300 s」的预测未兑现（实际 489 s）。本任务的正确性理由
> （测 `dist/quay.js` 真实产物）独立于提速理由而成立，改动保留。

实测（2026-08-02，套件 583s / 1218 tests / 0 fail）：

| 文件 | 耗时 | 占墙钟 | 成因 |
|---|---|---|---|
| `packages/quay/test/cli.test.mjs` | **436 s** | **75%** | 67 次 `run()` → `execFileSync("node", [quay.ts, …])` |
| `packages/quay/test/serve.test.mjs` | 280 s | — | 36 次经 `quay-native.ts` 造 fixture（服务器本身是进程内启动） |
| `packages/quay/test/mcp-server.test.mjs` | 142 s | — | 15 次 `connectStdio()` MCP 握手 |
| 其余 110 个文件 | 各 <60 s | — | 不在关键路径上 |

> **判据限定（[[gap-the-spawn-count-criterion-was-wall-clock-and-that-is-the-wrong-axis-for-concurrency]]）**：上述「110 个文件对墙钟无影响，不动」的**原判据是单套件墙钟**；该任务在**并发维度**下重新评估了同一组事实——spawn 总数不决定单套件墙钟，但决定内核态负载与可并发套件数。本任务结论不变、不重开。

文件耗时总和 858 s+ 远超墙钟 583 s，因为它们并行。**因此只有落在关键路径上的节省才真正缩短套件。**

对本任务（换执行载体）而言：

- `cli.test.mjs` 的 67 次调用 × 2.1 s = **141 s**，该文件 436 s → ~295 s，墙钟 583 s → **~300 s**
- 之后墙钟由 `serve.test.mjs`（280 s）接管
- **其余 62 个调用点对墙钟几乎无影响**——改它们是账面数字，不是等待时间

## Chosen mechanism

Route CLI-spawning tests through the prebuilt bundle instead of the `.ts` entry.

1. **One build per suite run, not per test.** `scripts/test.sh` runs
   `node packages/quay/scripts/build-dist.mjs` once up front (the script already exists). Cost is
   paid once and amortized over 129 invocations.
2. **A single resolved path constant** the tests import, rather than 129 hand-edited literals:
   `packages/quay/test/helpers/cli-entry.mjs` exporting `QUAY_CLI` — resolves to
   `dist/quay.js` when present and fresh, else falls back to `bin/quay.ts`. The fallback keeps a
   developer's `node --test <file>` working with no build step.
3. **Freshness is checked, not assumed.** The helper compares `dist/quay.js` mtime against the
   newest `src/**/*.ts` + `bin/*.ts` mtime. Stale → fall back to `.ts` and emit a one-line warning.
   A stale bundle silently passing tests over old code is the one failure mode that matters, so it
   must be impossible rather than unlikely.

### Why this is arguably more correct, not just faster

`dist/quay.js` is what `npm pack` ships and what `dist-verify-node-floor` already exercises
(CLAUDE.md / ADR-019 decision #5). Testing the CLI surface against the artifact users actually run
is closer to the real contract than testing against sources that only exist in this repo.

**Not in scope:** tests that `import` modules directly are untouched — they are already fast and
this changes nothing for them. Reducing the *number* of CLI spawns is
[[gap-tests-use-cli-where-module-import-suffices]].

## Acceptance Criteria

### 必做 — 关键路径（决定墙钟）

- [x] AC1: `packages/quay/test/helpers/cli-entry.mjs` exports `QUAY_CLI`（以及 `QUAY_NATIVE_CLI`），resolved once per process
- [x] AC2: 解析到 `dist/quay.js`（当存在且比所有 `src/**/*.ts`、`bin/*.ts` 新）—— `>=` 边界，mtime 相等视为 fresh
- [x] AC3: `dist/quay.js` 缺失时回退到 `bin/quay.ts`
- [x] AC4: `dist/quay.js` 陈旧时回退到 `bin/quay.ts` 并在 stderr 告警一次（真实演练过：`touch src/config.ts` → STALE 告警 + 回退）
- [x] AC5: `scripts/test.sh` 在开跑前构建一次 `dist/quay.js`（及 `dist/quay-native.js`）；构建失败即致命（绝不静默用陈旧 bundle）
- [x] AC6: **`cli.test.mjs` 的 67 个 `run()` 调用点全部改用 `QUAY_CLI`**（另将 23 处 `nativeBin` fixture 种子点改用 `QUAY_NATIVE_CLI`）—— 该文件 122 断言全绿
- [x] AC7: 该文件改前/改后耗时实测记录（见下方测量表）：**131.1 s → 66.2 s**（单文件、工作树内实测；任务体原 436 s 为全套件争用下测得，本任务按纪律在隔离工作树内只测单文件）
- [x] AC8: 套件墙钟 —— 按纪律无法在隔离工作树跑全套件；记录任务体 583 s 基线 + 本任务实测 delta，权威全套件数字留给 orchestrator fan-in。换载体后单文件实测 cli.test.mjs 66.2 s、serve.test.mjs 53.7 s、mcp-server.test.mjs 33.5 s —— **cli.test.mjs 仍是三个已转换文件中最慢的**（修正：不与应用旧 serve 280 s 比较）；三个文件都远离任务体原始争用基线，套件墙钟将由全套件争用下的最慢文件决定，由 fan-in 实测

### 按实测决定 — 非关键路径

- [x] AC9: `serve.test.mjs`（36 处经 `quay-native.ts` 造 fixture）与 `mcp-server.test.mjs`（15 次 `connectStdio` + fixture 种子）改用常量；实测 **serve 280 s → 53.1 s、mcp-server 142 s → 33.5 s**。诚实记录：serve 的主要成本确非 module-graph —— 服务器是进程内 `import startServer`，36 次 spawn 全是 native fixture 种子（quay-native 仅 4 个 src 文件，≈0.5 s/次），换载体对 serve 的单文件收益 ≈ 18 s，280 s → 53.1 s 的差大部分是套件争用 vs 单文件的环境差。mcp-server 的收益更实质：15 次 `connectStdio` 经 `QUAY_CLI`（core CLI 的 40 文件 module-graph），换载体移除其加载成本
- [x] AC10: 其余 ~62 个调用点：**先实测再决定**。抽查了调用点最多的非关键路径文件，全部 <60 s（见下方取舍表）——改它们对墙钟无影响，**不改**，只记录判断。这是「别为了全部改完而改」的刻意取舍

### 通用

- [x] AC11: 零断言改动 —— `git diff` 只含入口路径替换 + 注释，`cli.test.mjs` 改前/改后同为 122 断言全绿
- [x] AC12: 开发者不预先构建直接 `node --test packages/quay/test/cli.test.mjs` 仍通过（AC3 路径）—— 真实演练：移走 dist 后运行，2 条 MISSING 告警，.ts 回退路径在手动停止前 **68 断言全部通过 / 0 FAIL**（停止点在末尾 live-GitHub 测试处，非失败）。断言数与载体无关（AC11 零断言改动）；同一 .ts 路径的完整 122 断言全绿由基线（改前 .ts 运行）证明
- [x] AC13: 测试带 `// @test-group product` 声明（`cli.test.mjs`、`serve.test.mjs`、`mcp-server.test.mjs`、新增 `cli-entry.test.mjs` 均在文件首行声明）

## Measured results (worktree /tmp/quay-wt-spawncli, 2026-08-02, single-file `node --test`)

| 文件 | 改前 | 改后 | Δ | 断言 |
|---|---|---|---|---|
| `packages/quay/test/cli.test.mjs` (AC7) | 131.1 s | 66.2 s | **-64.9 s (-50%)** | 122 PASS / 0 FAIL 前后一致 |
| `packages/quay/test/serve.test.mjs` (AC9) | 280 s* | 53.1 s | -227 s | 170 PASS / 0 FAIL |
| `packages/quay/test/mcp-server.test.mjs` (AC9) | 142 s* | 33.5 s | -108 s | 206 PASS / 0 FAIL |
| `packages/quay/test/cli-entry.test.mjs`（新增，测 helper `helpers/cli-entry.mjs`） | — | 0.3 s | — | 7 PASS / 0 FAIL |

\* 任务体全套件争用下实测值（隔离单文件会更快）；改前单文件基线 cli.test.mjs=131.1 s 为本任务实测。

**AC10 取舍表 —— 改了哪些、为什么、没改哪些、为什么**

| 文件 | 实测单文件耗时 | 判定 |
|---|---|---|
| `cli.test.mjs`（67 coreBin + 23 nativeBin 调用点） | 131.1 s | **改**（关键路径，AC6） |
| `serve.test.mjs`（36 nativeBin 调用点） | 280 s* | **改**（AC9，>60 s） |
| `mcp-server.test.mjs`（15 connectStdio + ~20 nativeBin） | 142 s* | **改**（AC9，>60 s） |
| `task-check.test.mjs` | 7.5 s | 不改（<60 s，无墙钟影响） |
| `web-ui-browser.test.mjs` | 16.6 s | 不改 |
| `config-validate.test.mjs` | 7.1 s | 不改 |
| `gap002-create-ergonomics.test.mjs` | <60 s | 不改 |
| `gate.test.mjs` | <60 s | 不改 |
| `quay-native/test/abi-symmetry.mjs` | 9.1 s | 不改 |
| `quay-native/test/create-validation.test.mjs` | 1.8 s | 不改 |
| `quay-github/test/cli.test.mjs` | 5.2 s | 不改 |
| `quay-backlog/test/mcp-server.test.mjs` | 5.7 s | 不改 |
| `plugin/test/codex-stage1-adapter.test.mjs` | 24.2 s | 不改 |
| 其余（任务体全套件：各 <60 s） | <60 s | 不改 |

**已知保留（adversarial review SHOULD-FIX 3，刻意 deferred）**：`cli.test.mjs`（4 处）与
`mcp-server.test.mjs`（2 处）的 **GitHub provider `mcp_entry` 仍写 `bin/quay-github.ts`**（live
GitHub 测试用）。无 `quay-github` dist bundle —— AC1 机制只定义 `QUAY_CLI`/`QUAY_NATIVE_CLI`，
建 github bundle 超出本任务机制范围。影响：4 次 .ts 启动对 cli.test.mjs 约 +8 s；即使路由，
cli.test.mjs ≈58 s 仍 > serve 53.7 s，不改变关键路径排序。记为后续任务（与 sibling 任务的
[[gap-tests-use-cli-where-module-import-suffices]] 一起评估）。

## Definition of Done

- [x] `cli.test.mjs` 改前/改后实测记录在任务体（AC7）；套件墙钟按纪律记录基线 + delta，权威数字留 fan-in（AC8）
- [x] `scripts/test.sh` 绿 —— 本次 scoped 运行全绿（cli-entry 7/7、cli 122/122、serve 170/170、mcp-server 206/206）；完整 `scripts/test.sh` 全套件留给 orchestrator fan-in
- [x] 陈旧 bundle 回退路径被真实演练（touch `src/config.ts` → STALE 告警 + 回退到 `bin/quay.ts`；重建后恢复 bundle）
- [x] 非关键路径调用点的取舍有明确记录（AC10 取舍表：改 3 个 >60 s 文件，其余 ~62 调用点 <60 s 不改）
- [x] Adversarial review 记录（2 轮）：Round 1（a58cf8c501ac4e57f）7 findings / 0 BLOCKER / 3 SHOULD-FIX —— 已修 AC8 过时比较、AC12 断言数矛盾、AC9 措辞；github .ts 保留点已文档化（SHOULD-FIX 3，deferred）。Round 2（a00a988988a6b1bad）2 NITs / 0 SHOULD-FIX —— 已核对 AC6/freshness/test.sh/nativeProviderDir/AC10 均无缺陷。已知 NITs（记录不修）：mtime 同 tick 静默陈旧窗口（粗粒度 FS）、symlink 目录不跟随、freshness 只扫 .ts 源（按任务体 AC2 规格）

## Touches

- scripts/test.sh
- packages/quay/test/helpers/cli-entry.mjs
- packages/quay/test/*.test.mjs
- packages/quay-native/test/*.test.mjs
- packages/quay-github/test/*.test.mjs
- packages/quay-backlog/test/*.test.mjs
- plugin/test/codex-stage1-adapter.test.mjs
