---
id: AC-179
title: G8 dashboard 卡片在运行中的 Web 上真实渲染
status: achieved
kind: criterion
goal: GOAL-001
criterion: >-
  root=$(git rev-parse --show-toplevel)

  for p in $(pgrep -f 'quay.ts serve'); do
    [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$root" ] || continue
    a=$(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | grep -oE -- '--host [^ ]+ --port [0-9]+' | awk '{print $2":"$4}')
    [ -n "$a" ] || continue
    curl -sf --max-time 10 "http://$a/dashboard" | grep -q 'id="goal-card"' && exit 0
  done

  exit 1
expect: exit 0（仅遍历 cwd = 仓库根的生产 serve 实例；按位置认元素 id="goal-card"，不认标题/提交主题里的字符串提及）
origin: |
  人 2026-09-06 需求⑥「在 quay web 为 goal 实现相应的页面和 dashboard 卡片」。
  判据读【运行中的服务】而非源码，依据硬规则 4 推论三：
  grep 源码只证明"能产出"，不证明"已产出"。
evidence:
  at: 2026-09-06T22:24:20.022Z
  verdict: pass
  reading: acceptance passed (exit 0)
---

**判据（能取假）**：从**运行中的 `quay serve` 进程**派生地址，`GET /dashboard` 的响应含 `goal-card`。

**取假**：今天必假（`serve-dashboard.ts` 全文 `grep -n goal` = 0 命中；
现有卡片只有 `live-card`/`tests-card`/`sys-card`/`mgr-card`/`task-card`/`fanIn`/`commits`）。

**⊢ 地址从宿主进程派生，不写死字面量**（硬规则 4 推论二：
一个恰好等于当前机器/端口的字面值不是配置，是会静默失效的常量）。
`addr` 取不到时 `test -n` 即判假——**不会因为服务没起而伪装成通过**。

**卡片内容**：每条 active GOAL 的 `AC 达成 x/y`、`fresh|stale|NOT-EVALUATED` 标记、
`activeCount / cap`。

**改动面**：`serve-dashboard.ts` 新增 `renderGoalCard`（照 `renderTaskCard` `:542` /
`renderMgrCard` `:519`）+ `renderDashboardPage`（`:694-746`）的 grid 插入 + `handleDashboard`（`:790-828`）
数据装配；可选 `/dashboard/cards`（`:839-870`）自刷新。

**同期一并落地（不在本条判据内，属 DoD）**：`quay goal` 子命令
（`bin/quay.ts:178-206` 加一行 dynamic import + `src/cli/goal.ts`，照 `cli/adr.ts`）；
`/goal` 页面已存在（`serve-goal.ts`，含三态空态与站点导航 `serve-render.ts:702-712`），
本期只需随 `AC-176` 改走 provider client。
