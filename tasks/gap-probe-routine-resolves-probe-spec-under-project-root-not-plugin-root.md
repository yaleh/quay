---
id: gap-probe-routine-resolves-probe-spec-under-project-root-not-plugin-root
title: probe 轨道把 probe spec 解析到项目根而非插件根，第三方宿主声明的 probe 例程被 fail-closed 跳过
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**机制（2026-10-20 核实，quay dev 工作区自身任务）。** `plugin/scripts/quality-gate-driver.ts:2713-2714`
写死 `probeRoutinesFromConfig(rootDir, { pluginRoot: path.join(rootDir, "plugin"), ... })`——probe 轨道把
probe spec 的解析根钉在**项目根下的 `plugin/probes/`**，而不是插件自身安装根。第三方宿主（没有 vendored
`plugin/probes/`）上，`loop.routines:` 里声明的任何 `probe:`（含 `architecture-analysis`）都会被
`readProbeSpec` 抛 `PROBE-SPEC FAIL-CLOSED: probe spec not found at <root>/plugin/probes/<name>.md`，
例程被 skip、driver 从不跑。这是「kernel 资源按项目根解析」缺陷族
（`gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root`，done）的新 callsite：
`gap-plugin-root-resolution-remaining-callsites-round2`（done）的 grep 用 `path.join(root, "plugin"`
（`root,` 字面）漏掉了这里的 `rootDir,` 变体。canonical 解析已存在：`plugin/scripts/routine-scheduler.ts:22`
用 `${CLAUDE_PLUGIN_ROOT}/probes/<name>.md`。修法方向：probe 轨道解析 spec 时回退到插件根
（`CLAUDE_PLUGIN_ROOT` / 插件缓存根）；`<root>/plugin/probes` 缺失时不得把已声明的例程硬 fail-closed 掉。

## AC

- [ ] AC1（位置判定，双向控制）：`grep -n 'pluginRoot: path.join(rootDir, "plugin")' plugin/scripts/quality-gate-driver.ts`
      改后命中 0 处；负控制用同一 grep 对改前 develop 副本命中该 callsite（证明谓词可判，非恒零）。
- [ ] AC2（双向负控制）：无 `plugin/probes/` 的第三方项目根 + 独立插件根上，`loop.routines:` 声明的 `probe:`
      （含 `architecture-analysis`）改后按插件根 `probes/<name>.md` 解析成功、例程进入例程表；改前同一夹具
      报 `PROBE-SPEC FAIL-CLOSED: probe spec not found at <root>/plugin/probes/<name>.md`。反向：本仓库
      （有 `plugin/`）场景行为不变（回归）。
- [ ] AC3（单一解析根）：probe spec 解析与 `routine-scheduler.ts` 的 canonical 解析同根
      （`CLAUDE_PLUGIN_ROOT` / 插件缓存根），不另造第二套；`scripts/test.sh --for-task <this task>` 绿。

## DoD

在真实第三方宿主（非 fixture）上，`loop.routines:` 声明的 probe 例程在 quality-gate-driver 一轮里被装配并
运行（或如实报 legible not-evaluated，而非 PROBE-SPEC FAIL-CLOSED skip）；本仓库上该轨道行为不变。
AC1-AC3 勾齐并贴证据。

## Touches

- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/probe-routine.ts
- plugin/scripts/read-probe-spec.ts
- plugin/test/probe-spec-wiring.test.mjs
- tasks/gap-probe-routine-resolves-probe-spec-under-project-root-not-plugin-root.md