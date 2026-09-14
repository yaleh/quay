---
id: AC-165
title: 撤 root .mcp.json 的 quay 条目（AC164 满足后才做）
status: achieved
kind: criterion
goal: GOAL-003
criterion: >-
  python3 - <<'P'

  import json,sys

  if 'quay' in (json.load(open('.mcp.json')).get('mcpServers') or {}):
  sys.stderr.write("AC-165 fail - .mcp.json mcpServers still has a quay key\n");
  sys.exit(1)

  if 'quay' in
  (json.load(open('.claude/settings.local.json')).get('enabledMcpjsonServers')
  or []): sys.stderr.write("AC-165 fail - .claude/settings.local.json
  enabledMcpjsonServers still contains quay\n"); sys.exit(1)

  sys.exit(0)

  P
expect: exit 0（root .mcp.json 的 mcpServers 无 quay 键 ∧
  .claude/settings.local.json 的 enabledMcpjsonServers 不含 quay）
origin: |
  人 2026-09-02 裁定②「本项目自己使用的扩展应当与产品交付的是同一个」。正本
  SPEC-plugin-lifecycle-single-bundle-2026-09-02.md §4（先撤后接 = 断掉 3 天 178 次生产流量）。
---

**判据（能取假）**：撤 root `.mcp.json` 的 quay 条目 + `.claude/settings.local.json` 的
`enabledMcpjsonServers:["quay"]`；permission allowlist 同步改插件前缀名。

**取假**：在 AC164（承接生产流量）满足之前执行 ⇒ 断流。


