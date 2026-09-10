---
id: AC-233
title: 下游 CLI 底线自洽——同一宿主上 driver 可跑而 CLI 拒跑的不一致必须被报出，⛔ 不让人自己去撞（退出条件①）
status: draft
kind: criterion
goal: GOAL-015
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/downstream-cli-floor-consistency.test.mjs
expect: 双向：正向——hermetic 单测证明「driver 可跑而 CLI 拒跑」这类同宿主不一致会被判出并以**可区分取值**报出（如
  floor-inconsistent），⛔ 不是静默让人去撞；反向——本仓库场景（宿主满足底线）不得误报不一致。⛔ 本 AC 不裁定 Node
  底线该取多少（GOAL-015 非目标），只要求底线自洽且该不一致可见。立条时该测试文件不存在 ⇒ exit 1。
origin: >-
  GOAL-015 的机器判据之一。立条依据见 GOAL-015 的 origin（人 2026-09-10 令「应当优先更新 goal；必要时可创建新
  goal」后设立；实测缺口：orangevps Node 18.19.1 上 shipped CLI 拒跑而同机 driver dist
  照跑；`merge_target` 全仓零消费者而 `fork_baseline` 有）。


  本条判据在立条当轮已从仓库根干跑取真实读数：exit 1（可评估、非 spawn 失败），符合硬规则
  4c。判据只引用不会自行回退的量——代码状态、append-only 载体的历史事实、机械枚举计数；⛔ 不含进程存活与远程主机当前可达性。
---
