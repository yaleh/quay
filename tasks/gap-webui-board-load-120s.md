---
id: gap-webui-board-load-120s
title: "/board 加载 120s——readBoardLanding 无缓存 + 硬超时 120s（超时后渲染错误态），每次请求冷跑子进程"
status: todo
labels:
  - gap
  - defect
  - webui
  - performance
parent: null
children: []
extra:
  schema: execution
---

**type:** finding

## Finding

`/board` 加载 120.4s（dashboard 23.4s / manager 20.3s）。根因：每次请求都冷跑 `node --experimental-strip-types <script> --json` 子进程；`readBoardLanding`（observation.ts:483）调 `task-status-drift-check.ts` 无缓存、`timeout: 120_000` 硬编码（:518），超时后渲染错误态（等 2 分钟换来「没读到数据」）。

**方向（不细化实现）**：① 补短 TTL 缓存（复用 `readPoolMetrics` 已有的 30s TTL 模式）；② timeout 降到秒级 + fail-open 渲染；③ 探针脚本预编译 `.js` 跳过每次 strip-types 开销（产品 dist 路径已这么做）；④（激进，需产品定）骨架先出 + 异步补数据。

## Acceptance Criteria

- [ ] AC1: `/board` 冷加载从 ~120s 降到个位数秒（TTL 缓存 + 秒级 timeout + fail-open）。
- [ ] AC2: 负控制——缓存命中时不再冷跑子进程（可观测：第二次请求快）。
- [ ] AC3: 超时渲染「读取超时」而非空等到硬顶（fail-open）。

## Definition of Done

- [ ] `/board` 冷加载实测耗时达标（真实输出，非估算）。
