---
id: gap-dashboard-goal-card-provider-backed
title: dashboard 增 goal-card —— 走 Provider ABI 渲染 active GOAL 的达成度与三态陈旧标记
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

正本：`orchestration/SPEC-goal-mechanism-2026-09-06.md` §7 的 G8 期 + `goals/AC-179-web-card-and-cli.md`（判据正本）。GOAL-001 的最后一期。

**当前实测（立案当轮取的读数，非引用旧结论）**：`packages/quay/src/serve-dashboard.ts` 全文 `goal` 命中 **0**；四个运行中的 `quay.ts serve` 实例 `/dashboard` 的 `goal-card` 命中全为 0，而同一条 curl+grep 管线抓 `task-card` 得 2 —— **零是真阴性，不是管线坏了**。

**范围已比 AC-179 原文收窄（两处已随前期落地，勿重做）**：
- `quay goal` 子命令**已接线**（`packages/quay/bin/quay.ts:181` → `packages/quay/src/cli/goal.ts`，随 G5/AC-176 落地）；
- `/goal` 与 `/goal/<id>` 页面**已存在**（`packages/quay/src/serve-goal.ts`，经 `serve-handlers.ts:16` 注册）。

⇒ **本期只剩 dashboard 卡片一件事。**

**实现路线（照现成形态，不发明新形态）**：
- `renderGoalCard` 照 `renderMgrCard`（`serve-dashboard.ts:519`）/ `renderTaskCard`（`:542`）写，**样式内联**（现有卡片都是内联 `style="..."`，`serve-render.ts` 无 card 样式，故不动它）；
- 插入 `renderDashboardPage`（`:694`）的 grid；数据在 `handleDashboard`（`:790`）装配；`handleDashboardCards`（`:839`）同步以支持自刷新；
- **数据一律经 Provider ABI**：`ProviderClient.goalList()`（`provider-client.ts:45`），**不直连 `goal-store.ts`** —— 该 ABI 已带优雅降级契约（`:164` 起：`goalList` 在 isError 时降级为 `[]`，使 goal-less provider（github stub / backlog）也能干净渲染）。

**卡片内容**（取自 AC-179）：每条 active GOAL 的 `AC 达成 x/y`、`fresh|stale|NOT-EVALUATED` 三态标记、`activeCount / cap`。三态不可坍缩成二态——一条尚未挂 AC 的 GOAL 无从计算 `lastProgressAt`，判 fresh 会**把从未被评估的对象记成健康**（硬规则 3b）。

## AC

- [ ] **AC-179 正本判据**：遍历所有运行中的 `quay.ts serve` 实例，任一 `/dashboard` 响应含 `goal-card` ⇒ 退出码 0（判据读**运行中的服务**而非源码——硬规则 4 推论三：grep 源码只证明「能产出」，不证明「已产出」）
- [ ] 负控制（证明上一条的管线本身是通的）：同一条 curl+grep 管线抓 `task-card` 命中非零
- [ ] 卡片走 ABI 而非直连：`packages/quay/src/serve-dashboard.ts` 中对 `goal-store` 的直接 import 数为 0，且 goal 数据来自 `ProviderClient.goalList`
- [ ] 优雅降级可取假：令 `goalList` 返回 `[]`（goal-less provider）时 `/dashboard` 仍返回 200 且页面不抛，卡片显示空态而非消失
- [ ] 卡片内容三要素齐备：渲染结果含 `AC 达成 x/y`、`fresh`/`stale`/`NOT-EVALUATED` 之一的标记、`activeCount / cap`
- [ ] scoped 门 `bash scripts/test.sh --for-task gap-dashboard-goal-card-provider-backed --allow-thin` 退出码 0

## DoD

在**真实运行中的 `quay serve` 实例**上验证过 `/dashboard` 含 `goal-card` 并渲染出真实 GOAL 数据（当前 live 数据为 GOAL-001 与 GOAL-002/003），而不是仅有单测通过或仅源码可见——判据地址从宿主进程派生、不写死字面量（硬规则 4 推论二）。反例判据：若把 fixture / 注入 seam 关掉后上述 AC 仍能通过，它才是测量。三态标记须能在 live 数据上真的取到至少一个非 `fresh` 的值，或明确记录当前三态分布，避免「标记恒为 fresh」这种与合格同形的空转。

## Touches

- packages/quay/src/serve-dashboard.ts
- packages/quay/test/gap-dashboard-goal-card-provider-backed.test.mjs（new）
- tasks/gap-dashboard-goal-card-provider-backed.md
