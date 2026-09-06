---
id: AC-165
title: 撤 root .mcp.json 的 quay 条目（AC164 满足后才做）
status: draft
kind: criterion
goal: GOAL-003
origin: |
  人 2026-09-02 裁定②「本项目自己使用的扩展应当与产品交付的是同一个」。正本
  SPEC-plugin-lifecycle-single-bundle-2026-09-02.md §4（先撤后接 = 断掉 3 天 178 次生产流量）。
---

**判据（能取假）**：撤 root `.mcp.json` 的 quay 条目 + `.claude/settings.local.json` 的
`enabledMcpjsonServers:["quay"]`；permission allowlist 同步改插件前缀名。

**取假**：在 AC164（承接生产流量）满足之前执行 ⇒ 断流。


