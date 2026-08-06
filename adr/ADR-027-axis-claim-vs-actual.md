---
id: ADR-027
title: "AXIS 声称 vs 实际：产品文档/脚本自述的能力，实测是否成立？"
status: proposed
date: 2026-08-06
tags:
  - axis
applies-to:
  - README.md
  - plugin/scripts/
---

## 这根轴问什么

**挑一条产品对自己的声称，真跑一遍看它成不成立。**

## 为什么怀疑这里有东西

声称写在文档/注释里，不在任何检查的对象里——它可以永远不为真而无人发现。

## 已撞到的同型实例

- `sync-vendor.sh` 自述 "fully self-contained"，而产物启动即 ENOENT；
- README "Option C" 声称 plugin marketplace 安装路径，实测 `origin/dist-plugin`
  落后 master **3755 个提交**（构建于 07-26，11 天前）；
- release 声称交付面含 agent 面，实测 `package.json` 的 `files` 不含 `plugin/`
  （AC16 的核心缺口）。

## 状态

开放。
