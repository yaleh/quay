---
id: gap-codex-plugin-mcp-json-nested-in-wrong-level
title: codex 插件：.mcp.json/vendor 提到插件根兄弟 + args 绝对化（不依赖会话 cwd），钉住 shipped
  artifact 直接装后 mcp list 出现 quay
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

**Bug B（相对路径，更深）**：就算把 `.mcp.json` 提到插件根，其 `args[0]="vendor/quay/dist/quay.js"` 仍是**相对路径且无 `cwd`**。codex 用**会话 cwd** 解析 args（`codex mcp list` 显示该 server `Cwd: -`）⇒ 从 meta-cc 跑时找 `meta-cc/vendor/quay/dist/quay.js`（不存在）⇒ ENOENT ⇒ `initialize response: connection closed` ⇒ 工具不暴露。实测 2026-10-31：`cd meta-cc && node vendor/quay/dist/quay.js --version` ENOENT。之前「从 quay 仓 task_list 通过」走的是 quay 仓**项目级** `.codex/config.toml` 的 `[mcp_servers.quay]`（`cwd=/data/home/yale/work/quay` 钉住），不是 user-scope 插件——meta-cc 没有自己的 quay project-config，就暴露了 Bug B。

修法：① `.mcp.json`/`vendor` 提到插件根（Bug A）；② `args[0]` **绝对化**（或 `cwd` 钉到稳定位置 / 自定位 wrapper），保证与「在哪个项目里跑」无关（Bug B）；dist 仍自包含（不依赖 claude 缓存）。前驱 `gap-codex-plugin-surface-not-installable`（done）的 AC4 当时过的是另一种布局且没测过「无自己 quay config 的项目」。merge-candidate：`peers: []`。

## Acceptance Criteria

- [ ] AC1 布局（按位置）：repo 根存在 `.mcp.json`（`.codex-plugin/` 的兄弟），`.codex-plugin/` 内只有 `plugin.json`（无 `.mcp.json`、无 `vendor/`）。贴 `find .codex-plugin/` 与 `cat .mcp.json`。
- [ ] AC2 组装：`publish-dist-branch.sh` 组装出的 artifact 里 `.mcp.json` 在 artifact **根**、`.codex-plugin/` 内只有 `plugin.json`；`grep -c 'plugins/cache' <artifact>/.mcp.json` == 0（自包含）。
- [ ] AC3 **args 不依赖会话 cwd**（钉住 Bug B）：`.mcp.json` 的 quay server `args[0]` 是**绝对路径**（或 `cwd` 钉到稳定位置 / 自定位 wrapper）；从 meta-cc（一个**没有自己 quay project-config 的 quay 项目**）`cd <project> && node <args[0]> --version`（或等价启动）exit 0，且该 dist 在**任意 cwd** 下可达。贴 `codex mcp list` 的 `Cwd`/`Args` 列与直接启动输出。
- [ ] AC4 **shipped artifact 直接装**（钉住）：从组装出的 artifact 组 codex marketplace → `codex plugin marketplace add` + `codex plugin add quay@<mkt>` 成功，且 `codex mcp list`（中立目录 /tmp）出现 quay。
- [ ] AC5 功能（无自有 quay config 的项目）：装后从 meta-cc（或等价项目）`codex exec --dangerously-bypass-approvals-and-sandbox` 调 `task_list` 返回该项目的任务（贴最终报告——这是「user scope 全局可用」的真判定）。
- [ ] AC6 反向（能取假，两臂）：① 把 `.mcp.json` 放回 `.codex-plugin/` 内 ⇒ `codex mcp list` 无 quay；② 把 `args[0]` 改回相对路径（去掉 cwd/绝对化）⇒ 从 meta-cc 调 task_list `connection closed`（贴两臂运行记录；还原后复绿）。
- [ ] AC7 测试+范围门：`plugin/test/codex-plugin-surface.test.mjs` 断言新布局 + `args[0]` 绝对/cwd 钉住；反向两臂各打红一次；`bash scripts/test.sh --for-task gap-codex-plugin-mcp-json-nested-in-wrong-level --allow-thin` 绿。

## Definition of Done

`.mcp.json` 在 repo/artifact 根、`args[0]` 绝对化/cwd 钉住（不依赖会话 cwd）、dist 自包含；从 shipped artifact 直接 `codex plugin add` 后 `codex mcp list`（中立目录）出现 quay，且从 meta-cc（无自有 quay config）`task_list` 功能通过；两个反向臂（位置回退 / args 相对化）各打红一次；测试正反向更新；范围门绿。

## ADR-007 dark-axis record

该轴仍暗,理由:布局搬移 + args 绝对化/自定位 wrapper,无包/依赖结构变化,L_D/L_G 无可测结构量。

## Touches

- .mcp.json
- .codex-plugin/.mcp.json
- .codex-plugin/plugin.json
- plugin/scripts/publish-dist-branch.sh
- plugin/test/codex-plugin-surface.test.mjs
- plugin/test/publish-dist-branch-closure-gate.test.mjs
- tasks/gap-codex-plugin-mcp-json-nested-in-wrong-level.md
