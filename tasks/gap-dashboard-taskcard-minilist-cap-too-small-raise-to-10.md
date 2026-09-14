---
id: gap-dashboard-taskcard-minilist-cap-too-small-raise-to-10
title: dashboard 首页任务台账速览的 ready/todo/needs-human mini-list 上限从 3 调到 10
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

人裁定（2026-09-14）：`packages/quay/src/serve-dashboard.ts` 的 `renderTaskCard` 函数（`:855`）
里 `const MINI_LIST_N = 3;` 把 `ready`/`todo`/`needs-human` 三个非终态状态各自的"最近更新"预览列表都
截断在 3 条。对于任务量本来就小的项目（如第三方项目 quay-fleet，这三个状态合计常年在个位数），这个
上限经常导致本该完整可见的少量任务被静默截断——预览列表下面**没有** `+N 更多` 这类提示（对照同一个
文件里 `renderLiveCard` 的 `live.inFlight.slice(0, 3)` 那处截断，已由 `gap-dashboard-livecard-minilist-overflow-indicator`
补上了 `+N 更多` 徽标，`renderTaskCard` 的这三个 mini-list 没有对应处理）。

**人本次的裁定范围明确**：只把 `MINI_LIST_N` 从 `3` 调到 `10`，**不**引入自适应阈值逻辑，**不**新增
"+N 更多"提示——那个不一致本身是真的（已经记录在案，值得单独关注），但本任务的范围就是这一个常量调整，
不在本任务里顺带处理。

**去重记录**：搜索过 `MINI_LIST_N`（0 命中）、`mini-list`（2 命中，均为 `renderLiveCard` 的
`liveMiniList` 机制——`gap-dashboard-live-swimlane-fixed-lane-gantt-timeline`、
`gap-dashboard-livecard-minilist-overflow-indicator`，两者都不涉及 `renderTaskCard`）、
`dashboard ready todo cap`（0 命中）。本任务是不同函数（`renderTaskCard` vs `renderLiveCard`）的
不同常量，不是重复。

## Plan

1. `packages/quay/src/serve-dashboard.ts` 的 `MINI_LIST_N` 常量值由 `3` 改为 `10`。
2. 不修改 `miniList()` 函数的其余逻辑（排序方式、过滤条件、渲染结构均不变）。
3. 不新增溢出提示——`ready`/`todo`/`needs-human` 三个状态各自的条目数一旦超过 10 仍然静默截断，
   这条已知的不一致本任务不处理（记在本 Proposal 里供以后单独立案参考，不是本任务遗漏）。

## Acceptance Criteria

- [x] AC1 构造一个含 12 条 `status: ready` 任务的合成任务集，`renderTaskCard` 的输出里 `ready` 这个
      mini-list 必须包含 **10** 条（不是 3 条）——直接断言渲染出的行数。
- [x] AC2 构造一个含 5 条 `status: todo` 任务的合成任务集（真实小项目场景），`todo` 的 mini-list 必须
      包含全部 **5** 条（验证"真实数量小于新上限时应完整展示"这个人裁定的实际诉求）。
- [x] AC3 负控制：`done`/`superseded` 这两个终态状态的渲染路径不受影响——它们本来就只显示计数、没有
      mini-list，本任务不得意外给它们也加上一个 mini-list。
- [x] AC4 全量 `scripts/test.sh` 绿。

## Definition of Done

- 四条 AC 全部满足。
- ⛔ 不得引入自适应阈值或"+N 更多"提示——本任务范围明确限定为改一个常量值，人已裁定范围，不得扩大。
- 任务体保留人本次的原始裁定措辞（"只调常量，不做自适应，不加提示"）以及那个"+N 更多不一致"作为
  已知、暂不处理的观察项，供以后单独立案参考。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/serve-dashboard.test.mjs
- tasks/gap-dashboard-taskcard-minilist-cap-too-small-raise-to-10.md
