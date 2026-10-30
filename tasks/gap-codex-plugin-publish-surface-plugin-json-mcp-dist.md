---
id: gap-codex-plugin-publish-surface-plugin-json-mcp-dist
title: Codex 插件发布面：.codex-plugin/plugin.json 声明 quay MCP、args 指向安装后 dist（quay.js
  mcp）而非 dev-tree source
status: todo
labels:
  - gap
  - codex
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-931
---
## Proposal

AC-931 的判据逐字（`goals/AC-931-*.md` 的 criterion）：

```sh
if [ ! -f .codex-plugin/plugin.json ]; then echo "FAIL: .codex-plugin/plugin.json absent" >&2; exit 1; fi
if ! grep -q quay .codex-plugin/plugin.json; then echo "FAIL: no quay MCP declaration" >&2; exit 1; fi
if grep -q "packages/quay/bin/quay.ts" .codex-plugin/plugin.json; then echo "FAIL: dev-tree source path present" >&2; exit 1; fi
```

现状：仓库根没有 `.codex-plugin/plugin.json`（`ls` 确认不存在），而现有唯一 Codex 宿主面 `.codex/config.toml` 的 `[mcp_servers.quay]` 指向 dev-tree source `packages/quay/bin/quay.ts`——这正是 AC-931 在发布面上禁止的形态（stage-1 config.toml 那条路归 AC-927 / 已完成任务 `gap-codex-mcp-cwd-any-root-spawn-verify`，与本发布面是不同机制）。

交付：新建仓库根 `.codex-plugin/plugin.json`（与 `.claude-plugin/marketplace.json` 同层的 Codex 插件发布面），声明 `mcpServers.quay`，args 指向安装后 dist（`quay.js mcp`），⛔ 不指向 dev-tree source。正向让判据 exit 0；反向用一个机械测试把三类回归（改成 source 路径 / 删掉声明 / 删掉文件）钉成「exit 非 0 且 stderr 带成因」。

Claude Code 侧的同构先例是 `plugin/.mcp.json`——它用 `{"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/vendor/quay/dist/quay.js","mcp"]}` 指向 bundle 出的 `vendor/quay/dist/quay.js`，而非 `bin/quay.ts`。Codex 插件清单的 `mcpServers` 相对路径按插件安装目录解析；具体落点（`quay.js` / `dist/quay.js` / 插件根内 vendored 路径）由实现者按 Codex 清单 schema 决定，但必须同时满足：含 `quay` 与 `mcp`、不含 `packages/quay/bin/quay.ts`。

## Plan

1. 建 `.codex-plugin/plugin.json`：合法 JSON、Codex 插件清单 schema（`name`/`version`/`description` + `mcpServers.quay`，`command:"node"`、`args` 指向安装后 dist `quay.js mcp`），⛔ 不出现 `packages/quay/bin/quay.ts`。
2. 正向核验：从仓库根逐字复跑 AC-931 criterion（或 `node packages/quay/bin/quay.js goal gate AC-931 --dry-run --json`）⇒ exit 0 / verdict pass；贴 plugin.json 全文与 gate 输出。
3. 新建测试 `plugin/test/codex-plugin-surface.test.mjs`，机械覆盖两臂：
   - 正向：`.codex-plugin/plugin.json` 存在、合法 JSON、声明 `mcpServers.quay`、args 含 `quay.js` 与 `mcp`、且不含 `packages/quay/bin/quay.ts`（按位置断言，⛔ 不按注释/字符串巧合）。
   - 反向（三个负控制，各自 LOUD）：在临时目录放一份副本，(a) 注入 source 路径 / (b) 删掉 quay 声明 / (c) 删掉文件，逐字运行 criterion 的 shell（criterion 取 `node packages/quay/bin/quay.js goal show AC-931 --json` 的 `.criterion` 字段逐字落盘，⛔ 不在测试里重写一份判据）⇒ 每种 exit 非 0 且 stderr 分别带 `dev-tree source path present` / `no quay MCP declaration` / `absent`。
4. 范围门：`bash scripts/test.sh --for-task <本任务 id> --allow-thin` 绿；全量 suite 留给 fan-in 机械阶段（本 worker 不跑全量）。

## Acceptance Criteria

- [ ] AC1 正向判据绿（能取假）：仓库根 `node packages/quay/bin/quay.js goal gate AC-931 --dry-run --json` ⇒ `verdict:"pass"` / exit 0；贴 `.codex-plugin/plugin.json` 全文与 gate 输出。
- [ ] AC2 发布面指向 dist 非 source（按位置）：`grep -c 'packages/quay/bin/quay.ts' .codex-plugin/plugin.json` = 0，且 `grep -q '"quay"'` / `grep -q 'quay.js'` / `grep -q 'mcp'` 三条都命中；贴三条 grep 的 `-c` 计数与命中行。
- [ ] AC3 反向—source 路径（能取假）：把临时副本的 args 改成 `packages/quay/bin/quay.ts`，逐字运行 criterion shell ⇒ exit 非 0 且 stderr 含 `dev-tree source path present`；贴输出与 `EXIT=`。
- [ ] AC4 反向—删掉声明（能取假）：把临时副本里 quay 声明删掉 ⇒ exit 非 0 且 stderr 含 `no quay MCP declaration`；贴输出与 `EXIT=`。
- [ ] AC5 反向—删掉文件（能取假）：无 `.codex-plugin/plugin.json` 的临时目录 ⇒ exit 非 0 且 stderr 含 `absent`；贴输出与 `EXIT=`。
- [ ] AC6 测试绿：新测试 `plugin/test/codex-plugin-surface.test.mjs` 经 `bash scripts/test.sh --for-task <本任务 id> --allow-thin` 绿（贴 pass/fail 计数）；测试从 `quay goal show AC-931 --json` 取 criterion 逐字，⛔ 不复制第二份判据。
- [ ] AC7 同层无 source 泄漏：`grep -rn 'packages/quay/bin/quay.ts' .codex-plugin/` 计数 = 0（贴计数）。

## Definition of Done

仓库根存在 `.codex-plugin/plugin.json`，声明 `mcpServers.quay` 且 args 指向安装后 dist（`quay.js mcp`）——⛔ 不是 dev-tree source `packages/quay/bin/quay.ts`；正向判据 `quay goal gate AC-931` 在真实文件上 exit 0，且一个机械测试把三个反向回归（source 路径 / 删声明 / 删文件）钉成「exit 非 0 且 stderr 带成因」。本条只闭合 AC-931 的发布面文件；AC-932（quay init 落盘三件套）与 AC-933（spawn-verify ship 决策）是 sibling AC，各自另有任务，不在本条范围。

## Touches

- .codex-plugin/plugin.json (new)
- plugin/test/codex-plugin-surface.test.mjs (new)
- tasks/gap-codex-plugin-publish-surface-plugin-json-mcp-dist.md
