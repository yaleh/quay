---
id: gap-cli-import-command-migration-into-src
title: cli-import 后续期——逐命令实现搬迁进 src/（run() 壳已就位）
status: ready
labels:
  - gap
  - performance
  - product
parent: null
children: []
extra:
  schema: execution
---

**type:** execution

## Proposal

**实证（任务 gap-cli-import-refactor-run-shell-architecture :77）**：run()/shell 架构已就位
（`bin/quay.ts` 导出 `run(argv, ctx)`，原 1194 行 main() 整体为 dispatch 体未逐行改写），但
**命令实现仍在 bin/quay.ts 的 dispatch 体内**——`packages/quay/src/` 未改。任务体明写
「架构已就位，逐命令搬迁为后续任务」。

**后续期 = 逐条把命令实现（每个 verb 的 handler）从 bin/quay.ts 的 dispatch 体搬到
`packages/quay/src/` 对应模块**，bin/quay.ts 只剩薄壳（argv→run→exit）。目的：
① 命令逻辑可 import 直测（AC2 的零派生测试扩展到全部命令，不止 4 个纯函数）；
② 减少 bin/quay.ts 单文件体积（当前 1194 行 dispatch 体）；
③ 每搬一条命令，其行为都有 golden-replay 等价证据（AC4 手法复用）。

**为什么逐条**：整批搬迁 = 大 diff + 高冲突风险（vhs 侧 49 双改文件含 bin/quay.ts）。
逐条 = 每次一个小 diff，可独立 scoped 验证，冲突面小。**顺序**：按调用频率 / 测试覆盖缺口。

## Plan

1. 枚举 bin/quay.ts dispatch 体内的命令 handler（parseVerbless 已有 4 纯函数 export 为先例）。
2. 逐条搬到 `packages/quay/src/<command>.ts`，bin/quay.ts 只留 import + dispatch 跳转。
3. 每条搬迁配 golden-replay 等价证据（复用 cli.test.mjs block26 手法）。
4. 逐条 scoped 绿 → 全量绿 → fan-in。

## AC

- [x] AC1: ≥N 条命令 handler 从 bin/quay.ts 搬进 src/（dispatch 体显著缩小）
- [x] AC2: 搬迁命令的测试可从 import 直调（零派生），扩展零覆盖缺口
- [x] AC3: 每条搬迁有 golden-replay 等价证据（无行为漂移）
- [x] AC4: 既有测试全绿；`--for-task` scoped 门绿
- [ ] AC5: 全量套件绿 + 无回归

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 搬迁清单 + 每条的 golden-replay 证据贴出（见 Evidence）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿——外层 verification-round 验证

## Touches

- packages/quay/bin/quay.ts（薄壳化：dispatch 体缩减）
- packages/quay/src/cli/（新搬迁命令模块——具体子目录，非整 packages/quay/src/）
- packages/quay/test/cli.test.mjs（import 直调扩展 + golden-replay）
- tasks/gap-cli-import-command-migration-into-src.md（自身）

## Evidence

（gap-cli-import-command-migration-into-src 执行于 worktree `quay-worktrees/gap-cli-import-command-migration-into-src`，
task/gap-cli-import-command-migration-into-src 分支；仅提交到分支，未 merge / push / 改 status。）

### 搬迁清单（bin/quay.ts dispatch 体 → packages/quay/src/cli/<command>.ts，共 17 个 verb 族）

| src/cli 模块 | 迁入的 verb handler |
|---|---|
| `adr.ts` | `quay adr list/show/view/new/accept/deprecate/reject/supersede` |
| `task-list.ts` | `quay task list` |
| `task-view.ts` | `quay task view` |
| `task-create.ts` | `quay task create` |
| `task-edit.ts` | `quay task edit` |
| `task-check.ts` | `quay task check` |
| `action.ts` | `quay action list/run` |
| `serve.ts` | `quay serve` |
| `mcp.ts` | `quay mcp` |
| `init.ts` | `quay init` |
| `config.ts` | `quay config validate/check`（含 unknown-subcommand 分支） |
| `gate.ts` | `quay gate <id>` + `quay gate --list` |
| `gate-log.ts` | `quay gate-log` |
| `lifecycle.ts` | `quay complete/adjudicate/promote/retreat` |
| `run.ts` | `quay run`（QENG-4 driver） |
| `migrate.ts` | `quay migrate`（DIR-039） |
| `manager.ts` | `quay manager start/adopt/arm` |

共享支撑层：`packages/quay/src/cli/shared.ts`（原 bin/quay.ts 的模块级 helpers 逐字搬入：
`withProvider`/`printJson`/`pinAcceptanceEnv`/`resolveAcceptanceEnvFile`/`resolveBody`/`readAll`/
`parseFlags`/`parseVerbless`/`resolveJsonFlag`/`resolvePageSize`/`relativeTimeCli`/`stripHeadings`/
`withGuardedErrors`/`connectNamedProvider`/`fsSyncExists`/`GUARDED_ERROR_PATTERN`/`BOOLEAN_FLAGS`）、
`help.ts`（`printHelp` 原样搬入）、`context.ts`（`CliCtx`——dispatch 传给每个 handler 的 per-invocation 上下文）。

`bin/quay.ts` 1929 行 → 240 行（-87.6%）：保留 run() 壳、pre-dispatch（--version/--help/--format-json
normalization）、逐 verb 路由到 src/cli handler、底部 entrypoint-guarded 薄壳、六个纯 helper 的
re-export（`parseFlags/parseVerbless/resolveJsonFlag/resolvePageSize/relativeTimeCli/stripHeadings`，
cli.test.mjs block27 继续从 `../bin/quay.ts` import）。

### Golden-replay 等价证据（AC3，复用 cli.test.mjs block26 的 spawn-vs-import byte-comparison）

block26 pairs 扩展 10 条搬迁命令（全部只读，避免改状态导致二次观察漂移）：
`task view CLI-1`、`task view CLI-1 --json`、`task check CLI-1`、`task check CLI-1 --json`、
`action list CLI-1 --json`、`adr list`、`gate --list`、`config validate --json`、
`gate-log CLI-1`、`gate-log CLI-1 --json`。全部 status/stdout/stderr 逐字节一致（实跑输出见下）。
变更型命令（create/edit/complete/promote/retreat/run/migrate/init/serve/mcp）由既有串行
command-behavior blocks 经 runImport（import 直调同一批 src/cli handler）覆盖 + 逐字搬迁保证。

```
PASS: golden-replay "task view CLI-1": spawn vs run() byte-identical (status 0/0, stdout 419/419B, stderr 179/179B)
PASS: golden-replay "task view CLI-1 --json": spawn vs run() byte-identical (status 0/0, stdout 604/604B, stderr 179/179B)
PASS: golden-replay "task check CLI-1": spawn vs run() byte-identical (status 0/0, stdout 74/74B, stderr 179/179B)
PASS: golden-replay "task check CLI-1 --json": spawn vs run() byte-identical (status 0/0, stdout 206/206B, stderr 179/179B)
PASS: golden-replay "action list CLI-1 --json": spawn vs run() byte-identical (status 0/0, stdout 234/234B, stderr 179/179B)
PASS: golden-replay "adr list": spawn vs run() byte-identical (status 0/0, stdout 4420/4420B, stderr 179/179B)
PASS: golden-replay "gate --list": spawn vs run() byte-identical (status 0/0, stdout 40/40B, stderr 0/0B)
PASS: golden-replay "config validate --json": spawn vs run() byte-identical (status 0/0, stdout 3/3B, stderr 0/0B)
PASS: golden-replay "gate-log CLI-1": spawn vs run() byte-identical (status 0/0, stdout 0/0B, stderr 179/179B)
PASS: golden-replay "gate-log CLI-1 --json": spawn vs run() byte-identical (status 0/0, stdout 3/3B, stderr 179/179B)
```

### Scoped 门结果（AC4）

`scripts/test.sh --for-task gap-cli-import-command-migration-into-src --allow-thin`：
**79/79 pass, 0 fail**（含 cli.test.mjs、cli-adr.test.mjs、adr-gate.test.mjs、adr-store.test.mjs、
build-dist.test.mjs、mcp-adr.test.mjs、npm-pack-e2e.test.mjs、plugin-packaging.test.mjs）。
scoped 静态检查（test-framework-policy / test-isolation / tmp-leak-pairing / test-impl-census /
task-contract / superseded-capability / tick-core-static）通过。

AC5（全量套件绿）留待外层 verification-round 验证——本任务只跑 scoped 门，未跑全量。
