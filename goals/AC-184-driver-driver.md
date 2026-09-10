---
id: AC-184
title: 常驻 driver 进程不得早于其执行的 driver 源码最近一次提交——把「陈旧写者」变成机械读数
status: retired
kind: criterion
goal: GOAL-001
criterion: >-
  last=$(git log -1 --format=%ct -- plugin/scripts/driver-filters.ts); for kind
  in promotion worker; do
    pids=$(pgrep -f "scripts/${kind}-driver.ts")
    [ -n "$pids" ] || { echo "no ${kind} driver running"; exit 1; }
    for p in $pids; do
      [ "$(stat -c %Y "/proc/$p" 2>/dev/null)" -ge "$last" ] || { echo "${kind} driver (pid $p) predates driver-filters.ts last change"; exit 1; }
    done
  done
expect: promotion 与 worker 两个写 sync 事件的常驻 driver 都在 driver-filters.ts
  最近一次改动之后启动——不再有陈旧进程写旧格式 not-ff 记录污染 syncHealth 读数
origin: >-
  【退役 2026-09-09——类别错误：活性判据写成目标判据（同 AC-181 / AC-186 一类）】


  原判据：promotion/worker 两个常驻 driver 进程的启动时刻不得早于 plugin/scripts/driver-filters.ts
  最近一次提交（「陈旧写者」进程判据）。


  【错在哪】「常驻 driver 进程是否早于源码最近一次提交」是活性量——进程可被
  kill/respawn、源码会推进，该量随时可回退（源码一改进程即「陈旧」）。与 AC-181 已退役的「meta-driver
  必须留新鲜轮次」同类别：把会回退的量写成目标判据。


  【为什么照原样激活危险】goal-driver.ts 只做 active→achieved 单向 flip，无反向翻转。一旦翻成 achieved
  即永久锁死——日后进程再次陈旧，记录仍永久声称一件已不成立的事（硬规则 4：结构上不可能变假的量不是测量）。


  【监控面去向，不缺观测】两层：

  1. 机制：driver-runtime.ts source-refresh（:822-828）——supervisor 逐轮对照「被监视源码最新
  mtime」vs「driver 进程启动时刻」，源码推进即 SIGTERM driver 触发 respawn，陈旧写者自愈；

  2. 读数：`quay driver status --kind promotion|worker --json` 的
  `supervisor_stale`（stale/fresh/not-evaluated 三态，supervisor 启动时刻 vs 被监视源码 mtime
  的直接量）与 `alive`/`driver_alive`。

  ⇒ 本条与之冗余，退役不留观测缺口。
---
