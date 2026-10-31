---
id: gap-codex-plugin-surface-not-installable
title: .codex-plugin/ 非合法 codex 插件 manifest：mcpServers 应指向 .mcp.json + 补
  interface/author + dist 自包含
status: ready
labels:
  - gap
  - codex
parent: null
children: []
extra:
  schema: execution
---
## Proposal

2026-10-31 实测：用 `codex plugin marketplace add` + `codex plugin add` 把 quay 装到 codex **user scope** 时，必须**手动适配** manifest——ship 的 `.codex-plugin/plugin.json`（AC-931 产物）不是 codex 插件的合法格式，装不进去。

codex 插件格式（0.165.0，实测自 openai-curated marketplace 的 `.codex-plugin/plugin.json`）：
- `mcpServers` 字段是**路径字符串**（`"./.mcp.json"`），指向插件根下**单独的 `.mcp.json`**；我们 ship 的是**内联对象**（`mcpServers.quay.command/args`）。
- 还要求 `author` + `interface`（displayName / shortDescription / longDescription / developerName / category / capabilities / websiteURL…）；我们缺这两块。

另外：本次手动装的 `.mcp.json` 里 `args[0]` 指向 **claude 插件缓存**（`~/.claude/plugins/cache/quay/quay/0.27.0/vendor/quay/dist/quay.js`）——不自包含，claude 缓存一清 codex 插件就断。

本任务把 `.codex-plugin/` 发布面适配成**可安装的 codex 插件包**：① manifest 改成 codex 合法格式（mcpServers→路径 + interface/author）；② 补 `.mcp.json`（quay stdio MCP）；③ dist 自包含（打包进插件包，不依赖 claude 缓存）。前驱：`gap-codex-plugin-publish-surface-plugin-json-mcp-dist`（AC-931，done）建了内联格式；本任务是其后继缺口。现有测试 `plugin/test/codex-plugin-surface.test.mjs` 断言的是旧内联格式（`server.command==="node"`），须一并改。

⚠️ 布局由实现者定：`.mcp.json` 在 codex 插件里是 `.codex-plugin/` 的**兄弟**（插件根下）；若 repo 里 `.codex-plugin/` 就是插件根，则 `.mcp.json` 与 dist 的落点按 codex 插件包约定排布。merge-candidate：`task-granularity-advice.ts` 返回 `peers: []`。

## Acceptance Criteria

- [x] AC1 manifest 格式（按位置，能取假）：`node -e 'const m=require("./.codex-plugin/plugin.json"); const ok = typeof m.mcpServers==="string" && m.mcpServers==="./.mcp.json" && m.author && m.interface?.displayName && m.interface?.shortDescription && m.interface?.category && Array.isArray(m.interface?.capabilities); if(!ok){console.log(JSON.stringify(m,null,2));process.exit(1)} console.log("PASS");'` ⇒ exit 0（贴输出；mcpServers 是路径字符串而非对象）。
- [x] AC2 `.mcp.json` 存在且自包含指向：codex 插件包里存在 `.mcp.json`（与 `.codex-plugin/` 同层的兄弟），声明 `mcpServers.quay` 为 stdio（`command:"node"`、`args:[<dist>, "mcp"]`），且 `args[0]` 是**插件包内的相对 dist 路径**（⛔ 非 `~/.claude/plugins/cache/...` 绝对路径）。贴 `.mcp.json` 全文 + `grep -c 'plugins/cache' <mcp.json>` == 0。
- [x] AC3 dist 自包含（能取假）：组装出的 codex 插件包内含 quay dist（`vendor/quay/dist/quay.js` 或等价），安装后**不依赖 claude 插件缓存**——把 claude 插件缓存目录临时改名后，`codex exec --dangerously-bypass-approvals-and-sandbox` 从某 quay 项目调 `task_list` 仍成功返回任务（贴运行记录与恢复后的改名还原）。
- [x] AC4 安装验证：`codex plugin marketplace add <组装出的插件包路径>` + `codex plugin add quay@<marketplace>` 成功；`codex mcp list`（中立目录 /tmp）显示 quay；`codex exec` 从某 quay 项目调 `task_list` 返回该项目的任务（贴 `codex plugin list`、`codex mcp list`、最终 task_list 报告）。
- [x] AC5 测试更新（正反向）：`plugin/test/codex-plugin-surface.test.mjs` 改为断言新格式——mcpServers 是路径字符串、`.mcp.json` 存在且自包含、interface/author 完整；反向：把 mcpServers 改回内联对象 ⇒ 测试红（贴测试名与两次运行）。
- [x] AC6 范围门绿：`bash scripts/test.sh --for-task gap-codex-plugin-surface-not-installable --allow-thin` 绿。

## Definition of Done

`.codex-plugin/plugin.json` 是 codex 合法 manifest（`mcpServers` → 路径字符串 + interface/author）；插件包含 `.mcp.json` + 自包含 dist（不依赖 claude 缓存）；`codex plugin add` 安装成功、`codex exec` task_list 功能通过；测试正反向更新；`--for-task` 范围门绿。

## Evidence

- AC1：判据逐字 `node -e '…'` ⇒ `PASS` exit 0（`mcpServers` 是 `"./.mcp.json"` 路径字符串而非对象；`author` 存在；`interface.displayName/shortDescription/category` 齐；`capabilities` 为数组）。
- AC2：`.codex-plugin/.mcp.json` 全文 `{"mcpServers":{"quay":{"command":"node","args":["vendor/quay/dist/quay.js","mcp"]}}}`；`grep -c 'plugins/cache' .codex-plugin/.mcp.json` == 0。布局采用「`.codex-plugin/` 即插件包根」（`plugin.json` + `.mcp.json` 同级 + `vendor/quay/dist/quay.js` 打包进包内），实测 codex 0.165.0 接受并安装。
- AC3：组装插件包（`plugins/quay/{plugin.json,.mcp.json,vendor/quay/dist/quay.js}`）；`mv ~/.claude/plugins/cache ~/.claude/plugins/cache.bak` 后 `codex exec --dangerously-bypass-approvals-and-sandbox -C <本任务 worktree>` 调 `task_list` 仍 `mcp: quay/task_list (completed)`、返回首个任务 id `ARCH-M103-001`；随后 `mv cache.bak cache` 还原（ls 确认 cache 已还原）。
- AC4：`codex plugin marketplace add /tmp/codex-quay-gap-pkg-<ts>` ⇒ `Added marketplace \`quay-gap-test\``；`codex plugin add quay@quay-gap-test` ⇒ installed（`installedPath: ~/.codex/plugins/cache/quay-gap-test/quay/local`）；`codex mcp list`（/tmp）显示 `quay  node  vendor/quay/dist/quay.js mcp  enabled`；`codex exec` task_list ⇒ `ARCH-M103-001`。验证后已 `codex plugin remove quay@quay-gap-test` + `codex plugin marketplace remove quay-gap-test` 还原环境。
- AC5：测试重写为 `validateCodexPackage`（新格式断言：mcpServers 路径字符串 + `.mcp.json` 存在且自包含 + interface/author 完整）+ 内联 mcpServers 反向控制。正向 `node --test plugin/test/codex-plugin-surface.test.mjs` ⇒ tests 6 / pass 6 / fail 0；把真实 manifest 临时改回内联对象 ⇒ tests 6 / pass 5 / fail 1（红在 `the codex package carries the installable manifest + self-contained .mcp.json (position)`），恢复后 pass 6。
- AC6：`bash scripts/test.sh --for-task gap-codex-plugin-surface-not-installable --allow-thin` ⇒ EXIT=0 绿（含 codex 测试 6/6、`embeddedInterpreterLines=6575 ≤ 6575`）。

## ADR-007 dark-axis record

该轴仍暗,理由:manifest 格式适配 + 新增 .mcp.json + dist 打包进插件,无包/依赖结构变化,L_D/L_G 无可测结构量。

## Touches

- .codex-plugin/plugin.json
- .codex-plugin/.mcp.json
- plugin/scripts/publish-dist-branch.sh
- plugin/test/codex-plugin-surface.test.mjs
- tasks/gap-codex-plugin-surface-not-installable.md