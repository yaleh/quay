---
id: gap-launch-script-worker-cap-broken
title: promotion-driver-launch.sh --cap worker 路径 broken（supervisor 自重启传 --concurrency 而非 --cap）+ worker 并发缺省设 2
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**来源**：outer 按 manager 建议现场开 worker 并发（`quay driver restart --kind worker --cap 2`）撞到本 bug，worker-driver 停摆 2-3 分钟。

**bug（实测）**：`promotion-driver-launch.sh:354` `extra_args+=( "${KIND_CAP_FLAG[$KIND]}" "$CAP" )` 把 `--cap 2` 映射成驱动的 `--concurrency 2`，但 `:358` 把这行 extra_args 传给**supervisor 自重启**（`__supervise` 模式），而 `__supervise` 的 arg 解析只认 `--cap`（:154）不认 `--concurrency` ⇒ `unknown argument: --concurrency` ⇒ 旧 supervisor 被杀、新 supervisor 起不来 = driver 停摆。`:278`（supervisor 循环内把 `--concurrency` 传给**驱动**）是对的，错的是 `:354` 把驱动的旗标用在了【supervisor 自重启】上——自重启应传 `--cap`。

**并发缺省（manager 建议）**：worker 常驻并发现实际=1（`resolveConcurrency(undefined,0)` 兜底 `Math.max(1,0)`），不是设计意图、是没人配。建议 worker 缺省设 2（fake-completion 与 exit-4 两条零 Touches 重叠却因 cap=1 排队）。suite 侧 `QUAY_MAX_CONCURRENT_SUITES=1` 仍串行，并发 2 收益在实现阶段。

**env 法已一次生效（⛔ 修正误报）**：`QUAY_MAX_TASK_SUBAGENTS=2` 已设进当前 driver（1819958）的 environ（`/proc/1819958/environ` 两行 `QUAY_MAX_TASK_SUBAGENTS=2` 实测在），并发现在=2。本条 AC2 是把「一次生效」变「持久缺省」——否则下次不带 env 重启又回 1。

## Plan

1. 修 `:354`：supervisor 自重启用 `--cap`（launch script 自己的旗标），⛔ 不用 `KIND_CAP_FLAG`（驱动的旗标）。
2. worker 并发缺省设 2：worker 分支 export `QUAY_MAX_TASK_SUBAGENTS=2`（或在无显式 --cap 时默认 CAP=2），⛔ 不写字面量到别处（定义点已在 worker-driver.ts:132）。

## Acceptance Criteria

- [ ] AC1：`quay driver restart --kind worker --cap 2` 成功（⛔ 不再 `unknown argument: --concurrency`），且驱动 argv/env 有 `--concurrency 2` 或 `QUAY_MAX_TASK_SUBAGENTS=2`。
- [ ] AC2：worker 无显式 --cap 时并发缺省=2（`resolveConcurrency` 读到 2，⛔ 仍兜底 1 ⇒ 假）。

## Definition of Done

- [ ] --cap worker 路径修复 + worker 并发缺省 2 + restart 实测成功；AC1-2 全勾；land 到 develop。

## Retires

- 无

## Touches

- plugin/scripts/promotion-driver-launch.sh（:354 修 + worker 并发缺省）
- plugin/test/promotion-driver-launch.test.mjs（test）
- tasks/gap-launch-script-worker-cap-broken.md（自身）
