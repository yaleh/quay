---
id: ADR-029
title: "AXIS 文档 vs 代码：一条被文档指导的行为，在真实项目上验证是否为真？"
status: proposed
date: 2026-08-06
tags:
  - axis
applies-to:
  - CLAUDE.md
  - plugin/loop/
---

## 这根轴问什么

**挑一条文档指导的行为，去一个真实项目上验证它。**

## 为什么怀疑这里有东西

文档是照着亲代（quay）写的；子代进入不同生态位（不同测试框架、不同语言、不同主机）
后，同一条指导可能直接是错的——**而亲代永远撞不到**。

## 已撞到的同型实例

- `--test-concurrency` 对 vitest 是错的，真实参数是 `--maxWorkers`（archguard 发现）；
- `full-suite-runner` 判红匹配裸 `✖`，而 vitest 里 `✖` 可以是测试自己的 console 输出
  ⇒ 全绿套件被判红（archguard 发现，quay 跑 `node:test` 永远撞不到）；
- `verify-delivery-surface` 查 quay 自家布局（`plugin/loop/`、`plugin/scripts/`），
  而消费方 laid 布局是 `orchestration/` + `docs/analysis/` ⇒ 对任何消费方假阴性。

## 状态

开放。**部署多样性本身是发现机制**，不只是验证手段——应刻意让子代进入不同生态位。
