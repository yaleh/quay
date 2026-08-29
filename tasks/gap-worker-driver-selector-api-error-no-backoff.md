---
id: gap-worker-driver-selector-api-error-no-backoff
title: worker-driver selector API 错误/fallback 失败无退避——54 次 <60s 快速重派烧派发预算
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

worker-driver 对 selector API 错误 / fallback 失败**无退避**——17:22–17:56 两任务 54 次「worker exited with code 1」全部 <60s 快速重派，纯烧派发预算（subagent spawn 预算 / 会话累计）。

**根因（两层）**：
1. selector API 400：litellm 侧模型无 fallback group，并行 tool_use/tool_result 配对不齐即 400 一击即死。**这一层的模型名根因已由 a7a507eab 修**（deepseek-v4-pro → deepseek-v4-pro-anthropic 配 fallback）。
2. **无退避（本条修的对象，⛔ 不修模型名）**：driver 遇到 worker 快速死亡（<60s）时无退避地立即重派，54 次烧掉大量派发预算。即便模型名已修，未来任何 selector API / fallback 瞬态错误都会以同样的快速重试烧预算。

**与 400 修复的分工**：a7a507eab = 治「为什么会 400」（模型名）；本条 = 治「出错时为什么无退避疯狂重试」（重试策略）。两条独立，后者是防御性机制缺口。

## Plan

1. worker 快速死亡（<N 秒，N 实现方定）时，driver 对该任务加指数退避（而非立即重派），退避上限可配置。
2. 退避状态按 task 记（⛔ 不全局——一个任务退避不该拖垮别的任务）。
3. 退避到上限后转 markNeedsHuman（复用现有重试上限机制），⛔ 不无限退避。

## Acceptance Criteria

- [x] AC1（能取假，退避生效）：worker <60s 连续死亡 ≥M 次后，driver 对该任务退避（不立即重派），重派间隔随次数增长；（⛔ 仍 <60s 立即重派 ⇒ 假）。
- [x] AC2（能取假，不全局）：一个任务退避时，其它任务照常派发（退避按 task 记）；（⛔ 退避拖垮全局 ⇒ 假）。
- [x] AC3（能取假，有上限）：退避到上限转 markNeedsHuman，不无限退避；（⛔ 无限退避 ⇒ 假）。

## Definition of Done

driver selector 错误/快速死亡退避落地；AC1-AC3 全勾；54 次级快速重派不再发生；退避按 task、有上限。

## Touches

- plugin/scripts/worker-driver.ts（selector 错误/快速死亡退避 + markNeedsHuman 兜底）
- plugin/test/worker-driver.test.mjs（退避 + 按 task 隔离 + 上限负控制）
- tasks/gap-worker-driver-selector-api-error-no-backoff.md（自身）

## Needs-Human

**执行 2026-08-28T18:24:45.124Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
