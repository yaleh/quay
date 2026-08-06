---
id: ADR-026
title: "AXIS 采用者视角：一台全新机器装 quay，第一步撞到什么？"
status: proposed
date: 2026-08-06
tags:
  - axis
applies-to:
  - plugin/scripts/quay-init.sh
  - plugin/skills/cold-start/SKILL.md
---

## 这根轴问什么

**一个从零开始的采用者，按文档走第一步，会撞到什么？**

## 为什么怀疑这里有东西

亲代环境（quay 自己的开发树）结构性地看不见这一类问题：路径可解析、vendor 已就位、
开发树在场。**只有真的从零环境走一遍才会逐层剥出**，且每修一层才暴露下一层。

## 已撞到的同型实例

- `vendor/*/dist/*.js` 被 `.gitignore` 的 `dist/` 规则挡住 ⇒ 运行时不随 clone；
- `vendor/<pkg>/package.json` 不在铺设映射 ⇒ 产物启动即 ENOENT；
- `mcp_entry` 写的是开发树路径 `./bin/*.ts` ⇒ 安装态指向不存在的文件；
- `quay-init --loop` 对 test-command / tmux-session 无普适默认，缺一个即 fail-closed
  （管理者 2026-08-06 实测：连跑三次才凑齐必需参数）。

## 状态

开放。B 机（orangevps）是当前的试验场；AC16 收口后应从 release 产物重跑本轴。
