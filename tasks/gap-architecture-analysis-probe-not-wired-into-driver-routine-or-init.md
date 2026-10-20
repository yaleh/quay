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

- [ ] AC1（装配判定）：`architecture-analysis` probe 在 quay 自己的 dev 工作区被某个 standing routine
      默认装配，quality-gate-driver 装配行（stderr）打印 `architecture-analysis`；负控制：改前装配行不含它。
- [ ] AC2（脚手架判定）：`quay init` 在全新临时 workspace 生成的 `.quay/config.yml` 的 `loop.routines:` 含
      `architecture-analysis`（fallback git-lens）；无 archguard 的主机上该例程报 legible not-evaluated
      而非 spawn 错误。
- [ ] AC3（回归）：`plugin/test/quality-gate-driver.test.mjs` 与 `packages/quay/test/init.test.mjs` 绿，
      `scripts/test.sh --for-task <this task>` 绿。

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
