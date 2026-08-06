---
id: ADR-031
title: "AXIS 繁殖视角：这条改动/机制能完整传给下一个主机、下一个项目吗？不能的话缺的是哪一段遗传物质？"
status: proposed
date: 2026-08-06
tags:
  - axis
applies-to:
  - plugin/
  - packages/quay/package.json
---

## 这根轴问什么

**这条改动/机制，能不能完整地传给下一个主机、下一个项目？**
不能的话，**缺的是哪一段"遗传物质"**？

## 为什么怀疑这里有东西

判据从"功能是否正确"变成"**能不能把自己完整地传下去**"。
遗传丢失是**有层次的**：每修好一层，下一层才暴露——上一层的失败掩盖了下一层。

## 已撞到的同型实例

- 三层链：dist 不随 clone → `package.json` ENOENT → `mcp_entry` 路径形态错；
- release 的 `files` 不含 `plugin/` ⇒ 装到的是任务板 CLI，不是那个会自己演进的机制；
- `periodic-push-backup.sh` **不在铺设集里**——目标项目磁盘上根本不会出现它；
- 系统 crontab 行不随包走（不在铺设集/bundle/升级通道），
  与 `CronCreate` 会话作用域**同一失败形态**：一个不能传给下一代的周期锚点；
- 共享 tick 文档若把工作分支名写成字面量 `develop`，archguard（只有 `master`）
  下次从升级通道拉取即断链——**分支名是策略，不是机制**。

## 状态

开放。人 2026-08-05 给出，"将越来越重要"。
