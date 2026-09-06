---
id: AC-184
title: 常驻 driver 进程不得早于其执行的 driver 源码最近一次提交——把「陈旧写者」变成机械读数
status: draft
kind: criterion
goal: GOAL-001
criterion: >-
  for kind in promotion worker; do
    pid=$(pgrep -f "scripts/${kind}-driver.ts" | sort -n | head -1)
    [ -n "$pid" ] || { echo "no ${kind} driver running"; exit 1; }
    start=$(stat -c %Y "/proc/$pid")
    last=$(git log -1 --format=%ct -- plugin/scripts/driver-filters.ts)
    [ "$start" -ge "$last" ] || { echo "${kind} driver (pid $pid) predates driver-filters.ts last change"; exit 1; }
  done
expect: promotion 与 worker 两个写 sync 事件的常驻 driver 都在 driver-filters.ts
  最近一次改动之后启动——不再有陈旧进程写旧格式 not-ff 记录污染 syncHealth 读数
origin: criteria 中 AC-183 verdict=fail（sync 载体 tail-200 里存在缺 benign 的 not-ff
  事件）；drivers.promotion 报 running=true 且 staleSecs=27（载体新鲜）却仍在写旧格式——现有 drivers
  读数只测载体新鲜度、不测进程对代码的新鲜度，故 promotion 进程早于 benign 修复 commit 55805b257(12:43:59Z)
  启动(01:47:50Z) 也未能在读数中暴露
evidence:
  at: 2026-09-06T23:56:10.773Z
  verdict: fail
  reading: acceptance failed (exit 1)
---
