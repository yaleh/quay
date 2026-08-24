---
id: gap-m-bucket-long-tail-lpt-scheduling
title: M bucket 测试长尾：最后 5% 文件吃掉总时长 27%+（最慢 5% 串行和占 55%）——scripts/test.sh 未按已知耗时
  LPT 排序，长测试排尾部等 lane
status: superseded
labels:
  - gap
parent: null
children: []
extra: {}
---
**superseded（2026-08-24 10:2xZ，manager A/B 实验证伪 + outer 独立复核）**：LPT 重排**计算正确但交付无效**——`node --test` 无视 argv 顺序。独立复核（outer 实跑）：`node --test z-long.test.mjs a-short.test.mjs` 与 `a-short.test.mjs z-long.test.mjs` 两种相反顺序 → 起跑顺序完全相同（a-short 先、z-long 后），即 node --test 按自己的内部发现/排序（字母序），完全无视调用方文件顺序（v24.19.0）。

**后果**：`scripts/test.sh:1377-1380` 把 `suite-lpt-order.ts` 重排结果喂给 `node --test "${files[@]}"`，而后者不看这个参数 ⇒ AC1（生产验证 span 下降）结构上不可通过，跑多少轮 M bucket 结果都一样。

**重定范围 →** `gap-suite-lpt-dual-process-sharding`（双进程分片：最长 K 文件独立子进程，不再依赖 node 尊重顺序）。