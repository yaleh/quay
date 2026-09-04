---
id: ADR-030
title: "AXIS 字段/标签 vs 消费者：这个字段谁在读？"
status: proposed
date: 2026-08-06
tags:
  - axis
applies-to:
  - tasks/
  - plugin/scripts/
---

## 这根轴问什么

**挑一个字段/标签，问谁在读它。**

## 为什么怀疑这里有东西

字段被写入的地方总是显眼的；**被读取的地方可以一个都没有**，而写入照常进行。
退化器官不会自己消失——它会继续消耗代谢直到有机制清除它。

## 已撞到的同型实例

- `human-steered` 标签 166 个任务在用，**消费者全在已退休管线**，`plugin/` 命中 0；
- `ready.sort()` 的字母序被当排名消费；
- `.quay/loop-driver.jsonl` 有写入方（cold-start SKILL、tick 文档的 printf）
  和读取方（`loop-driver-check.sh`），但读取方只验"有没有行"，不验行是否仍然为真；
- `experiments/` 下 46 个测试在默认套件 glob 里，32 个无人引用，
  **15 个连被测实现都已删除**。

## 状态

开放。
