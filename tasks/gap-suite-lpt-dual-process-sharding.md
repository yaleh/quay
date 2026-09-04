---
id: gap-suite-lpt-dual-process-sharding
title: LPT 重排交付无效（node --test 无视 argv 顺序，A/B 证伪）⇒ 改双进程分片：最长 K 文件独立子进程 + 其余文件另一子进程
status: superseded
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**superseded（人 2026-08-24 裁定取消）**：dual-process 分片方案被取消——现有测试分相/分桶已复杂，不增加维度。LPT 有更优交付：`node:test` 的 `run({files, concurrency, isolation:'process'})` API **保序**（绕过 CLI 的 glob→sort 路径），改用 `run({files})` 即可，无需双进程固定 heavy/light 边界。见 `gap-m-bucket-long-tail-lpt-scheduling`（已撤销 supersede 重写为 run({files}) 交付）。