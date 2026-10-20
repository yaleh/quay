---
id: gap-architecture-analysis-probe-not-wired-into-driver-routine-or-init
title: architecture-analysis probe（唯一真正调 archguard 的机件）未接进任何通用 driver
  routine，quay init 也不 scaffold
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-probe-routine-resolves-probe-spec-under-project-root-not-plugin-root
---
## Proposal

**接线缺口（2026-10-20 核实）。** `plugin/probes/architecture-analysis.md`（PRIMARY=archguard,
fallback=git-lens, output_routing cycle/god-package/duplication → milestone-candidate）目前只被
`plugin/scripts/external-dogfooding-check.ts` 的例程引用（`every(10)`、仅针对 /home/yale/work/archguard
这个外来目标）；没有通用 driver routine 调度它，`packages/quay/src/init.ts` 也不把它写进默认
`loop.routines:`。下游项目装了 quay+archguard 后没有任何 driver 会主动跑浅层架构分析（实测：driver 的
architecture-review / arch-discovery 例程都不碰 archguard）。修法方向：让某个 standing routine 默认调度
该 probe，或 `quay init` 脚手架默认写 `loop.routines:` 里带 architecture-analysis（fallback git-lens，
保证没有 archguard 的主机也安全）。

前置依赖 `gap-probe-routine-resolves-probe-spec-under-project-root-not-plugin-root`：即使本条把例程声明
出来，那个 pluginRoot bug 也会在第三方宿主上把它 skip 掉，故本条以它为前置、先落地（depends_on 已声明）。

## AC

- [x] AC1（装配判定）：`architecture-analysis` probe 在 quay 自己的 dev 工作区被某个 standing routine
      默认装配，quality-gate-driver 装配行（stderr）打印 `architecture-analysis`；负控制：改前装配行不含它。
- [x] AC2（脚手架判定）：`quay init` 在全新临时 workspace 生成的 `.quay/config.yml` 的 `loop.routines:` 含
      `architecture-analysis`（fallback git-lens）；无 archguard 的主机上该例程报 legible not-evaluated
      而非 spawn 错误。
- [x] AC3（回归）：`plugin/test/quality-gate-driver.test.mjs` 与 `packages/quay/test/init.test.mjs` 绿，
      `scripts/test.sh --for-task <this task>` 绿。

## Evidence (2026-10-20)

**AC1 — 装配行，同一条 dev 工作区 root（`.quay/config.yml` 里 architecture-analysis 声明形如 `every(10)`），
改前/改后只换 driver 代码（改前 = develop 的 `quality-gate-driver.ts`）：**

- 改前装配行：`quality-gate-driver: probe 轨道已装配 2 条例程（semantic-dedup-scan, freshness-refresh；规格根 .../quay/plugin）`
  —— 不含 architecture-analysis（它只出现在跳过行：`routine "architecture-analysis" (every(10)) 未被 probe 轨道驱动 — trigger kind 'every' …`）。
- 改后装配行：`quality-gate-driver: probe 轨道已装配 3 条例程（semantic-dedup-scan, freshness-refresh, architecture-analysis；规格根 <worktree>/plugin；默认装配: architecture-analysis (interval:1440m)）`
  —— **装配行点名** `architecture-analysis`，并区分「配置声明的」与「默认装配的」。
- 跳过行同时给出接管说明：`… 未被 probe 轨道驱动 — trigger kind 'every' …（默认装配接管：interval:1440m）`。
- 证据原文：`.quay/ac-arch-probe/before.stderr`、`.quay/ac-arch-probe/after.stderr`（worktree 内）。

**AC2 — 全新临时 workspace（`quay init --root <tmp> --test-command "node --test"`, exit 0）：**

- 生成的 `.quay/config.yml` 第 152–159 行：
  `routines:` / `- name: "architecture-analysis"` / `trigger: "interval:1440m"` / `probe: "architecture-analysis"`，
  且第 156 行注释 `primary instrument: archguard; fallback: git-lens (plugin/probes/architecture-analysis.md)`。
  `quay config validate --root <tmp>` → `Config valid.`（exit 0）。
- 无 archguard 的主机（本机 `command -v archguard` = exit 1；该 workspace 的 `.claude/settings.json` 只登记
  `quay@quay`）：driver `--once` 产出
  `{"name":"architecture-analysis","state":"not-evaluated","value":{"fired":false,"probe":"architecture-analysis","instrument":"archguard","fallback":"git-lens","instrumentAvailable":false},"reason":"instrument 'archguard' unavailable on this host (no archguard CLI on PATH (ARCHGUARD_RUNNER_CLI unset/unresolvable) and no archguard MCP/plugin in .claude/settings.json / .claude/settings.local.json) — probe not spawned; fallback declared: 'git-lens'"}`
  ⇒ **legible not-evaluated、零 spawn**（`.quay/ac-arch-probe/fresh-round.jsonl`，spawn log 不存在）。
- 正控制（同一条例程、机制不变量）：`ARCHGUARD_RUNNER_CLI` 指向存在的文件 ⇒ 该例程真的 spawn 探针并记
  `verified`（`plugin/test/quality-gate-driver.test.mjs` 的 AC1/AC2 用例两臂都断言，含「恰一次 spawn」）。

**AC3 — 回归：**

- `node --test plugin/test/quality-gate-driver.test.mjs` → 79 pass / 0 fail。
- `node --test packages/quay/test/init.test.mjs` → 89 pass / 0 fail。
- `node --test plugin/test/probe-routine.test.mjs` → 31 pass / 0 fail。
- `npx tsc --noEmit` → exit 0。
- `bash scripts/test.sh --for-task gap-architecture-analysis-probe-not-wired-into-driver-routine-or-init --allow-thin`
  → exit 0（289 pass / 0 fail；scoped static checks 全 PASS）。
- `anti-drift-touches-check --merge-target develop` → `ANTI-DRIFT OK — 8 actual file(s), all within declared Touches`。

## DoD

quay 自己与一个无 archguard 的第三方宿主上，均有一个 driver routine 主动调度 architecture-analysis 并
产生可读的装配/运行记录（或 legible not-evaluated）；init 脚手架写出的默认 loop.routines 含该 probe。
AC1-AC3 勾齐并贴证据。

## Touches

- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/probe-routine.ts
- plugin/scripts/archguard-runner.ts
- packages/quay/src/init.ts
- plugin/probes/architecture-analysis.md
- plugin/test/quality-gate-driver.test.mjs
- plugin/test/probe-routine.test.mjs
- packages/quay/test/init.test.mjs
- tasks/gap-architecture-analysis-probe-not-wired-into-driver-routine-or-init.md
