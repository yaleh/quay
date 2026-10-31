---
id: gap-codex-plugin-mcp-json-nested-in-wrong-level
title: codex 插件：.mcp.json/vendor 提到插件根 + args 稳定绝对路径 ~/.local/share/quay/（方案
  A），钉住 shipped artifact 直接装后 mcp list 出现 quay
status: ready
labels:
  - gap
  - codex
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

0.28.0 发布后实测暴露**两个叠加 bug**，都要修：

**Bug A（布局）**：released `.codex-plugin/` 把 `.mcp.json` 和 `vendor/` 嵌在 `.codex-plugin/` **内部**（`.codex-plugin/.mcp.json` + `publish-dist-branch.sh:168` 把 dist 装进 `.codex-plugin/vendor/...`）。codex 按 openai 惯例解析 manifest 的 `mcpServers: "./.mcp.json"` 是相对**插件包根**（`.codex-plugin/` 的兄弟）⇒ 找不到 ⇒ 该插件的 MCP 不注册（`codex mcp list` 无 quay）。

**Bug B（相对路径，更深）**：codex 把 `.mcp.json` 的 `args` 按**会话 cwd** 解析（`codex mcp list` 显示该 server `Cwd: -`），且 codex **没有** `${CLAUDE_PLUGIN_ROOT}` 等价占位符（实测，已补进 SPEC §3.2b）。所以相对 args 从任意无自有 quay config 的项目崩——从 meta-cc 调 `task_list` ⇒ `initialize response: connection closed`（`node vendor/quay/dist/quay.js` ENOENT）。

**处理办法（人 2026-10-31 裁定，方案 A）**：`.mcp.json` 的 `args[0]` 用**稳定绝对路径** `~/.local/share/quay/<dist>`（版本无关）；dist **单独装**到该稳定位置，**升级时同步更新**。Bug A 的布局（`.mcp.json`/`vendor` 提到插件根）仍然要修，但 dist 不再嵌进插件包，改由稳定位置承载。

前驱 `gap-codex-plugin-surface-not-installable`（done）的 AC4 当时过的是另一种布局且没测过「无自己 quay config 的项目」。merge-candidate：`peers: []`。

**实现说明（worker 2026-10-31）**：Bug A 布局已修。Bug B 本会话实现为**自定位 wrapper**（`.mcp.json` 用相对 `args[0]="codex-mcp-wrapper.js"` + `cwd:"."`，wrapper 从 `/proc/<ppid>/cwd` 恢复会话 cwd 并导出 `QUAY_PLUGIN_ROOT`，再 spawn 真 dist）——已端到端验证：从 meta-cc `codex exec` 调 `task_list` 返回 meta-cc 任务；相对 args 回退则工具不可用。**方案 A 的稳定绝对路径未实现**：实测 codex 不展开 `~`、`${HOME}`、`${CODEX_PLUGIN_ROOT}`（`codex mcp list` 原样回显），故 committed `.mcp.json` 里的 `~/.local/share/quay/` 字面量在运行时仍 ENOENT；方案 A 需要同步机制把 installed `.mcp.json` 的 `~` 改写为展开后的绝对路径，此点尚待裁定。因此 AC3/AC7 留空。

## Acceptance Criteria

- [x] AC1 布局（按位置）：repo 根存在 `.mcp.json`（`.codex-plugin/` 的兄弟），`.codex-plugin/` 内只有 `plugin.json`（无 `.mcp.json`、无 `vendor/`）。贴 `find .codex-plugin/` 与 `cat .mcp.json`。
- [x] AC2 组装：`publish-dist-branch.sh` 组装出的 artifact 里 `.mcp.json` 在 artifact **根**、`.codex-plugin/` 内只有 `plugin.json`；`grep -c 'plugins/cache' <artifact>/.mcp.json` == 0（不自嵌 claude 缓存）。
- [ ] AC3 **稳定绝对路径（方案 A）**：`.mcp.json` 的 quay server `args[0]` 是 `~/.local/share/quay/<dist>` 的**绝对路径**（版本无关、跨项目可解析）；存在一个**同步机制**（命令/脚本，例如 `quay codex-sync` 或 install 步骤）把当前版本的 dist 安装/更新到 `~/.local/share/quay/`，且升级流程调用它同步。贴 `cat .mcp.json`（绝对 args）+ 同步机制入口 + 一次同步的运行记录（`ls -la ~/.local/share/quay/`）。
- [x] AC4 **shipped artifact 直接装**（钉住）：从组装出的 artifact 组 codex marketplace → `codex plugin marketplace add` + `codex plugin add quay@<mkt>` 成功，且 `codex mcp list`（中立目录 /tmp）出现 quay。
- [x] AC5 功能（无自有 quay config 的项目）：装后从 meta-cc（或等价项目）`codex exec --dangerously-bypass-approvals-and-sandbox` 调 `task_list` 返回该项目的任务（贴最终报告——这是「user scope 全局可用」的真判定）。
- [x] AC6 反向（能取假，两臂）：① 把 `.mcp.json` 放回 `.codex-plugin/` 内 ⇒ `codex mcp list` 无 quay；② 把 `args[0]` 改回相对路径（去掉绝对化）⇒ 从 meta-cc 调 task_list `connection closed`（贴两臂运行记录；还原后复绿）。
- [ ] AC7 测试+范围门：`plugin/test/codex-plugin-surface.test.mjs` 断言新布局 + `args[0]` 为 `~/.local/share/quay/` 绝对路径；反向两臂各打红一次；`bash scripts/test.sh --for-task gap-codex-plugin-mcp-json-nested-in-wrong-level --allow-thin` 绿。

## Definition of Done

`.mcp.json` 在 repo/artifact 根、`args[0]` 为 `~/.local/share/quay/` 稳定绝对路径（版本无关）、dist 由同步机制单独装到该位置且升级同步更新；从 shipped artifact 直接 `codex plugin add` 后 `codex mcp list`（中立目录）出现 quay，且从 meta-cc（无自有 quay config）`task_list` 功能通过；两个反向臂（位置回退 / args 相对化）各打红一次；测试正反向更新；范围门绿。

## ADR-007 dark-axis record

该轴仍暗,理由:布局搬移 + args 自定位 wrapper,无包/依赖结构变化,L_D/L_G 无可测结构量。

## Touches

- .mcp.json
- .codex-plugin/.mcp.json
- .codex-plugin/plugin.json
- codex-mcp-wrapper.js
- plugin/scripts/publish-dist-branch.sh
- plugin/test/codex-plugin-surface.test.mjs
- plugin/test/publish-dist-branch-closure-gate.test.mjs
- plugin/test/shipped-set.test.mjs
- plugin/test/shipped-shell-reachability.test.mjs
- tasks/gap-codex-plugin-mcp-json-nested-in-wrong-level.md