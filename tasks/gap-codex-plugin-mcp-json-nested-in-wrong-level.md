---
id: gap-codex-plugin-mcp-json-nested-in-wrong-level
title: codex 插件布局：.mcp.json/vendor 应提到 .codex-plugin/ 的插件根兄弟，AC4 钉住 shipped
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

0.28.0 发布后实测：直接用 released 0.28.0 的 `.codex-plugin/` 装 codex 插件（`codex plugin marketplace add` + `codex plugin add quay`）→ `codex mcp list`（中立目录）**没有 quay**。根因是 `gap-codex-plugin-surface-not-installable` ship 的布局错了：`.mcp.json` 和 `vendor/` 被嵌进 `.codex-plugin/` **内部**（`.codex-plugin/.mcp.json` + `publish-dist-branch.sh:168` 把 dist 装进 `.codex-plugin/vendor/quay/dist/quay.js`）。

而 codex 按 openai 惯例解析 manifest 的 `mcpServers: "./.mcp.json"` 是相对**插件包根**（`.codex-plugin/` 的**兄弟**），不是 `.codex-plugin/` 内部 ⇒ 它找 `<插件根>/.mcp.json`，找不到 ⇒ 该插件的 MCP 不注册。我把 marketplace 布局手工改成 `{.codex-plugin/plugin.json, .mcp.json, vendor/quay/dist/quay.js}` 后，`codex mcp list` 立即出现 quay、task_list 通过——证明根因就是布局。

正确布局：`.mcp.json` 与 `vendor/` 是 `.codex-plugin/` 的**兄弟**（插件包根），且 dist 复用 artifact 根已有的 `vendor/quay/dist/quay.js`（claude 插件 dist），⛔ 不再在 `.codex-plugin/` 内多打一份。

前驱 `gap-codex-plugin-surface-not-installable`（done）的 AC4 当时过的是另一种布局（证据里 `installedPath …/quay/local`，与真实 `…/quay/0.28.0` 不同），ship 出来的布局没被真实装过一次。本任务修布局并让 AC3 钉住「从 shipped artifact 直接装 + `codex mcp list` 出现 quay」。merge-candidate：`peers: []`。

## Acceptance Criteria

- [x] AC1 布局（按位置）：repo 根存在 `.mcp.json`（`.codex-plugin/` 的兄弟），且 `.codex-plugin/` 内**不再有** `.mcp.json` 与 `vendor/`（`ls .codex-plugin/` 只有 `plugin.json`）。贴 `find .codex-plugin/` 与 `cat .mcp.json`。
- [x] AC2 组装：`publish-dist-branch.sh` 组装出的 artifact 里 `.mcp.json` 在 artifact **根**（`.codex-plugin/` 兄弟），`.codex-plugin/` 内只有 `plugin.json`；`.mcp.json` 的 `args[0]="vendor/quay/dist/quay.js"` 解析到 artifact 根已有的 dist（⛔ 不再 `.codex-plugin/vendor/...` 多打一份）。贴组装产物 `find` 结果 + `grep -c 'plugins/cache' <artifact>/.mcp.json` == 0。
- [x] AC3 **shipped artifact 直接装**（钉住）：从组装出的 artifact 组 codex marketplace → `codex plugin marketplace add <pkg>` + `codex plugin add quay@<mkt>` 成功，且 **`codex mcp list`（中立目录 /tmp）出现 quay**（贴 `codex plugin list` 与 `codex mcp list --json`）。
- [x] AC4 功能：装后 `codex exec --dangerously-bypass-approvals-and-sandbox` 从某 quay 项目调 `task_list` 返回该项目任务（贴最终报告）。
- [x] AC5 反向（能取假）：临时把 `.mcp.json` 放回 `.codex-plugin/` 内再装 ⇒ `codex mcp list` **无** quay（贴运行记录；还原后复绿）。
- [x] AC6 测试+范围门：`plugin/test/codex-plugin-surface.test.mjs` 断言新布局（`.mcp.json` 在 `.codex-plugin/` 外、`validateCodexPackage` 更新），反向把 `.mcp.json` 移回内层 ⇒ 测试红；`bash scripts/test.sh --for-task gap-codex-plugin-mcp-json-nested-in-wrong-level --allow-thin` 绿。

## Definition of Done

`.mcp.json` 在 repo/artifact 根（`.codex-plugin/` 兄弟）、dist 复用 artifact 根 vendor（不再嵌套多打）；从 shipped artifact 直接 `codex plugin add` 后 `codex mcp list` 出现 quay 且 `task_list` 功能通过；`.mcp.json` 移回内层时 mcp list 无 quay（能取假）；测试正反向更新；范围门绿。

## ADR-007 dark-axis record

该轴仍暗,理由:布局搬移（.mcp.json/vendor 提级）+ 组装脚本一行改动,无包/依赖结构变化,L_D/L_G 无可测结构量。

## Touches

- .mcp.json
- .codex-plugin/.mcp.json
- .codex-plugin/plugin.json
- plugin/scripts/publish-dist-branch.sh
- plugin/test/codex-plugin-surface.test.mjs
- plugin/test/publish-dist-branch-closure-gate.test.mjs
- plugin/test/shipped-set.test.mjs
- plugin/test/shipped-shell-reachability.test.mjs
- tasks/gap-codex-plugin-mcp-json-nested-in-wrong-level.md