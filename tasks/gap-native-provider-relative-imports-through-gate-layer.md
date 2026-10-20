---
id: gap-native-provider-relative-imports-through-gate-layer
title: native provider 经 gate/ 层路径（relative import）触 Core —— 分层实测 +
  判断（ARCH-M93-004 清零的是 package-specifier 形式，本 finding 针对 relative 形式）
status: todo
labels:
  - gap
  - architecture
parent: null
children: []
extra:
  schema: execution
---
## Finding

实测（fresh archguard scope b4f87b21 @ HEAD 75198f775，2026-10-21，逐行核对源码）：quay-native（三个 provider 中唯一有运行时 `quay` 依赖的）以 relative 形式 import Core 深层：`../../quay/src/gate/shared/acceptance-runner.ts`（mcp-server.ts:26）、`../../quay/src/gate/gate-event-store.ts`（mcp-server.ts:32）、`../../quay/src/kernel/gate-run-options.ts`（mcp-server.ts:29）、`../../quay/src/kernel/task-transition.ts`（store.ts:40）、`../../quay/src/kernel/shape-sections.ts`（store.ts:75）、`../../quay/src/kernel/task-shape-artifacts.ts`（store.ts:89）。分类（FACT）：kernel/* 是设计上的共享叶（允许双向到达）；gate/shared/acceptance-runner.ts 与 gate/gate-event-store.ts 的 gate/ 侧是 `export * from "../../core/…"` 的转发 shim（gate/shared/acceptance-runner.ts:1 头注释）。注意：ARCH-M93-004（done）曾把 package-specifier 形式的 `"quay/src/…` 清零，但本 finding 针对的是尚未被它覆盖的 relative 形式。判断（JUDGMENT）：无代码复制，但 native 作为 provider 经由 `gate/` 层路径 import，绕过了「provider 只依赖 ABI 表面（core/types.ts + provider-client）」的分层意图——这是一个活的 layering 问题，不是已关闭事实。本 finding 只记录实测与判断，不实现改动、不开 goal。

## Acceptance Criteria

- [ ] 「native → Core 的 relative import 清单」与当前源码逐条一致（可 `grep -rn '\.\./\.\./quay/src/' packages/quay-native/src/` 核对），且每条标出落在 kernel（合法共享叶）/ gate-side shim（转发）/ ABI 表面三类中的哪一类。
- [ ] 判断标注 FACT / JUDGMENT，且「是否违反分层」明确是 JUDGMENT，附「若『provider 只依赖 ABI 表面』不是本仓库的分层意图，则本判断不成立」的反事实对照。

## Definition of Done

- 两条 AC 全绿；finding 落地为 done，其测量读数可被 `grep -rn '\.\./\.\./quay/src/' packages/quay-native/src/` 独立复核。
- 不开 goal、不写实现；若判断为「确属 layering 违规」，后续是否立案另行决定。

## Touches

- tasks/gap-native-provider-relative-imports-through-gate-layer.md
- packages/quay-native/src/mcp-server.ts
- packages/quay-native/src/store.ts
- packages/quay/src/gate/shared/acceptance-runner.ts