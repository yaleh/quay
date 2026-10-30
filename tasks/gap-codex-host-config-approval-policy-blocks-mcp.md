---
id: gap-codex-host-config-approval-policy-blocks-mcp
title: Codex 默认 approval_policy 拦截 quay MCP：init 落盘 .codex/config.toml 补
  approval_policy + spawn-verify
status: todo
labels:
  - gap
  - codex
parent: null
children: []
extra:
  schema: execution
---
## Proposal

端到端验证（2026-10-30，claudecodeui 交互式 Codex + 本仓非交互 `codex exec`）发现：quay MCP 通路本身正确（released 0.27.0 插件 + `.codex/config.toml` + codex app-server 均接得上），但 Codex 默认审批策略把 MCP 工具调用静默拦掉：

- 交互式（claudecodeui "Default Mode"）：调 `task_list (quay)` → "the Quay task_list MCP call requires approval, but this session's approval policy is `never`" → 调用被 skip；切到 "Bypass Permissions" 后同一调用成功返回 50 任务（1272 总数）。
- 非交互 `codex exec`（默认）：同样 `approval: never`；带 `--dangerously-bypass-approvals-and-sandbox` 才成功。

根因：`packages/quay/src/init.ts` 的 `generateCodexConfigToml()` 生成的 `[mcp_servers.quay]` 节只含 `command/args/cwd`，不写 `approval_policy`，于是 Codex 对 MCP 的默认审批策略（`never`）生效，静默 skip（硬规则 3b：这里"默认策略"恰好与"永不批准"同形）。

修复：生成节补 `approval_policy = "on-request"`（已验证 codex-cli 0.165.0 `--strict-config` 接受该键），使交互式会话弹出审批而非静默 skip；并补 spawn-verify 证明"带该 config 时 codex 能实际完成 `task_list` 调用"（非仅 initialize 握手）。

`gap-quay-init-codex-host-trio-laydown`（AC-932，done）的后继缺口：三件套已落盘，但落盘的 config 缺审批策略。不同机制、独立验收，另立任务。merge-candidate：`task-granularity-advice.ts` 返回 `peers: []`。

## Acceptance Criteria

- [ ] AC1 生成面（按位置，能取假）：`node --no-warnings --experimental-strip-types --input-type=module -e 'import { generateCodexConfigToml } from "./packages/quay/src/init.ts"; const s=generateCodexConfigToml("/tmp/x","/tmp/plugin"); if(!/approval_policy\s*=\s*"on-request"/.test(s)){console.log(s);process.exit(1);}console.log("PASS");'` ⇒ exit 0，且该行位于 `[mcp_servers.quay]` 节内（贴生成全文）。
- [ ] AC2 spawn-verify（非仅 initialize）：扩展 dev-tree 的 `plugin/scripts/codex-stage1-spawn-verify.sh`（或同族脚本），对落盘 config 跑真实 `codex exec` 完成 quay MCP `task_list` 调用（非交互唯一可自动化路径用 `--dangerously-bypass-approvals-and-sandbox`），exit 0 且输出含非空任务列表（贴运行记录）。
- [ ] AC3 反向（能取假）：把生成节里的 `approval_policy` 行删掉或改为 `"never"` 后，AC1 判定命令 exit 非 0（贴 `echo $?` 与 stderr）。
- [ ] AC4 测试：`packages/quay/test/init.test.mjs`（或等效）新增断言——生成的 config 含 `approval_policy = "on-request"`，且删行/改 never 后断言失败（正向+反向都钉住）。
- [ ] AC5 范围门绿：`bash scripts/test.sh --for-task gap-codex-host-config-approval-policy-blocks-mcp --allow-thin` 绿。

## Definition of Done

`generateCodexConfigToml()` 生成的 `.codex/config.toml` 在 `[mcp_servers.quay]` 节含 `approval_policy = "on-request"`；spawn-verify 证明带该 config 时 codex 能实际完成 `task_list` 调用；删行/改 never 后判定失败（能取假）；`init.test.mjs` 覆盖正反向；`--for-task` 范围门绿。

## ADR-007 dark-axis record

该轴仍暗,理由:init 生成 config 增一行 approval_policy + spawn-verify 扩展,无包/依赖结构变化,L_D/L_G 无可测结构量。

## Touches

- packages/quay/src/init.ts
- packages/quay/test/init.test.mjs
- plugin/scripts/codex-stage1-spawn-verify.sh
- tasks/gap-codex-host-config-approval-policy-blocks-mcp.md
