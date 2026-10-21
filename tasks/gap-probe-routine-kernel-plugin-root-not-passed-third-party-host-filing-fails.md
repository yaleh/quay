---
id: gap-probe-routine-kernel-plugin-root-not-passed-third-party-host-filing-fails
title: probe 立案在第三方宿主上失败——probeRoutinesFromConfig 未把 kernelPluginRoot 传进
  RoutineSpec，fileRoutineTask 的 resolveTaskCliEntry 落到 null、vendored bundle
  分支永远走不到；且 filed=0 时 fact 仍标 verified
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

现场证据（plantuml-js 用 quay 0.22.0 跑 architecture-analysis 探针）：探针成功（exit 0，1 条 confirmed finding），routine-file-gate 判 accepted，但立案失败——filing-round.errors = "task store CLI unresolved (no packages/quay-native and no vendored bundle) — nothing filed"，tasks/ 下无新文件，fact 写 "0 filed as task(s)" 而 state 仍是 verified。

根因（已按源码核实）：resolveTaskCliEntry(root, kernelPluginRoot)（plugin/scripts/routine-file-gate.ts:1395）的第二分支（vendored bundle `<kernelPluginRoot>/vendor/quay-native/dist/quay-native.js`）要求 kernelPluginRoot 非空；但 probeRoutinesFromConfig（plugin/scripts/quality-gate-driver.ts:2986）构造 opts 时传了 pluginRoot、**没传 kernelPluginRoot**，ProbeRoutineOptions.kernelPluginRoot 是可选项、无缺省（probe-routine.ts:958）。于是 fileRoutineTask(opts.root, opts.kernelPluginRoot ?? null, …)（probe-routine.ts:1227）落到 null，第二分支永远走不到；第三方宿主无 packages/quay-native，第一分支也不存在 ⇒ 永不立案。dev tree 有 packages/quay-native 走第一分支，掩盖了缺陷。次要缺陷：filed=0 且 errors 非空时 fact state 仍 verified，失败被藏在 filing-round.errors 里，读 quality-round 的人误以为正常（硬规则 3b）。

## Plan

1. quality-gate-driver.ts 的 probeRoutinesFromConfig 与 buildDefaultProbeRoutines 两处，构造 opts 时加 `kernelPluginRoot: resolveKernelPluginRoot()`（import 自 driver-runtime.ts，或已有导出）。
2. 修 fact state：filed=0 且 filing errors 非空时，state 取独立值（如 "filing-failed" 或 "not-evaluated"），不与 verified 同形。
3. 回归测试（plugin/test/probe-routine.test.mjs 或 routine-file-gate.test.mjs）：无 packages/quay-native 的工作区 + 安装形态插件根（kernelPluginRoot 指向含 vendor/quay-native/dist/quay-native.js 的目录）+ accepted finding → fileRoutineTask 返回 ok、任务文件真的落到 tasks/。

## Acceptance Criteria

- [x] probeRoutinesFromConfig / buildDefaultProbeRoutines 传 kernelPluginRoot，且 fileRoutineTask 在无 packages/quay-native 的宿主上经第二分支解析到 vendored bundle（可 grep 核对 resolveTaskCliEntry 的第二分支被走到）。
- [x] filed=0 且 errors 非空时，fact state 不是 "verified"（独立取值，可 grep 核对）。
- [x] 回归测试覆盖「无 packages/quay-native + 安装形态插件根 + accepted finding ⇒ 任务文件落到 tasks/」，可运行、可复核。

## Definition of Done

- 三条 AC 全绿；改动经 scripts/test.sh 相关泳道通过，合并进 develop。
- 只改 quay 代码/测试，不改 plantuml-js / 任何外部工作区。

## Touches

- tasks/gap-probe-routine-kernel-plugin-root-not-passed-third-party-host-filing-fails.md
- plugin/scripts/quality-gate-driver.ts
- plugin/scripts/probe-routine.ts
- plugin/scripts/routine-file-gate.ts
- plugin/test/probe-routine.test.mjs
- plugin/test/routine-file-gate.test.mjs