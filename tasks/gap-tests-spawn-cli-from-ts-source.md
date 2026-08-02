---
id: gap-tests-spawn-cli-from-ts-source
title: "Tests spawn the CLI from .ts source at 3.5s each — the prebuilt bundle
  costs 1.4s for the same behavior"
status: todo
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

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

实测（2026-08-02，套件 583s / 1218 tests / 0 fail）：

| 文件 | 耗时 | 占墙钟 | 成因 |
|---|---|---|---|
| `packages/quay/test/cli.test.mjs` | **436 s** | **75%** | 67 次 `run()` → `execFileSync("node", [quay.ts, …])` |
| `packages/quay/test/serve.test.mjs` | 280 s | — | 36 次经 `quay-native.ts` 造 fixture（服务器本身是进程内启动） |
| `packages/quay/test/mcp-server.test.mjs` | 142 s | — | 15 次 `connectStdio()` MCP 握手 |
| 其余 110 个文件 | 各 <60 s | — | 不在关键路径上 |

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

- [ ] AC1: `packages/quay/test/helpers/cli-entry.mjs` exports `QUAY_CLI`（以及 `QUAY_NATIVE_CLI`），resolved once per process
- [ ] AC2: 解析到 `dist/quay.js`（当存在且比所有 `src/**/*.ts`、`bin/*.ts` 新）
- [ ] AC3: `dist/quay.js` 缺失时回退到 `bin/quay.ts`
- [ ] AC4: `dist/quay.js` 陈旧时回退到 `bin/quay.ts` 并在 stderr 告警一次
- [ ] AC5: `scripts/test.sh` 在开跑前构建一次 `dist/quay.js`；构建失败即致命（绝不静默用陈旧 bundle）
- [ ] AC6: **`cli.test.mjs` 的 67 个调用点全部改用 `QUAY_CLI`** —— 这是唯一决定墙钟的文件
- [ ] AC7: 该文件改前/改后耗时实测记录；**目标 436 s → ≤320 s**
- [ ] AC8: 套件墙钟改前/改后实测记录；**目标 583 s → ≤380 s**

### 按实测决定 — 非关键路径

- [ ] AC9: `serve.test.mjs`（36 处经 `quay-native.ts`）与 `mcp-server.test.mjs` 改用常量；**但注意这两个的主要成本不是 strip-types**（见 [[gap-tests-use-cli-where-module-import-suffices]] 的成因分析），换载体只解决其中一部分
- [ ] AC10: 其余 ~62 个调用点：**逐个改的收益需先实测证明**。若某文件耗时 <60 s，改它对墙钟无影响——记录这个判断，不要为了「全部改完」而改

### 通用

- [ ] AC11: 零断言改动 —— `git diff` 只含入口路径替换
- [ ] AC12: 开发者不预先构建直接 `node --test packages/quay/test/cli.test.mjs` 仍通过（AC3 路径）
- [ ] AC13: 测试带 `// @test-group product` 声明

## Definition of Done

- [ ] `cli.test.mjs` 与套件墙钟的改前/改后实测都记录在任务体（AC7/AC8 是本任务的交付物本身）
- [ ] `scripts/test.sh` 绿
- [ ] 陈旧 bundle 回退路径被真实演练（touch 一个 `src/*.ts`，确认回退 + 告警）
- [ ] 非关键路径调用点的取舍有明确记录 —— 改了哪些、为什么、没改哪些、为什么

## Touches

- scripts/test.sh
- packages/quay/test/helpers/cli-entry.mjs
- packages/quay/test/*.test.mjs
- packages/quay-native/test/*.test.mjs
- packages/quay-github/test/*.test.mjs
- packages/quay-backlog/test/*.test.mjs
- plugin/test/codex-stage1-adapter.test.mjs
