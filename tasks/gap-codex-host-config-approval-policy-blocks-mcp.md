---
id: gap-codex-host-config-approval-policy-blocks-mcp
title: Codex 默认审批策略拦截 quay MCP：init 落盘 .codex/config.toml 补
  default_tools_approval_mode + spawn-verify
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

端到端验证（2026-10-30，claudecodeui 交互式 Codex + 本仓非交互 `codex exec`）发现：quay MCP 通路本身正确（released 0.27.0 插件 + `.codex/config.toml` + codex app-server 均接得上），但 Codex 默认审批策略把 MCP 工具调用静默拦掉：

- 交互式（claudecodeui "Default Mode"）：调 `task_list (quay)` → "the Quay task_list MCP call requires approval, but this session's approval policy is `never`" → 调用被 skip；切到 "Bypass Permissions" 后同一调用成功。
- 非交互 `codex exec`（默认）：同样 `approval: never`；带 `--dangerously-bypass-approvals-and-sandbox` 才成功。

**根因键的更正（本任务执行中实测 codex-cli 0.165.0，否决最初假设的 `approval_policy`）**：最初假设的修复键 `approval_policy` 是**顶层 profile 键**，不是 MCP-server 键。把它放进 `[mcp_servers.quay]` 节，codex 直接 warn `mcp_servers.quay.approval_policy is ignored`，且实测 `task_list` 仍被拒（"requires approval, but approval policy is never"）。正确的 MCP-server 级键是 `default_tools_approval_mode`（枚举 `auto`/`prompt`/`writes`/`approve`）；取值 `"approve"` 让 quay MCP 工具在 `approval: never` 下仍自动放行。实测对照（同一受信目录、均无 bypass）：

- `approval_policy = "on-request"` → `mcp: quay/task_list (failed)`："requires approval, but approval policy is never"。
- `default_tools_approval_mode = "approve"` → `mcp: quay/task_list (completed)`，返回非空任务列表。

修复：`packages/quay/src/init.ts` 的 `generateCodexConfigToml()` 在 `[mcp_servers.quay]` 节补 `default_tools_approval_mode = "approve"`；spawn-verify 增 `--codex-exec` 证明 codex 能实际完成 `task_list`（非仅 initialize 握手）。

`gap-quay-init-codex-host-trio-laydown`（AC-932，done）的后继缺口：三件套已落盘，但落盘的 config 缺审批策略。不同机制、独立验收，另立任务。merge-candidate：`task-granularity-advice.ts` 返回 `peers: []`。

## Acceptance Criteria

- [x] AC1 生成面（按位置，能取假）：`node --no-warnings --experimental-strip-types --input-type=module -e 'import { generateCodexConfigToml } from "./packages/quay/src/init.ts"; const s=generateCodexConfigToml("/tmp/x","/tmp/plugin"); const sec=(s.match(/\[mcp_servers\.quay\]([\s\S]*?)(?=\n\[|$)/)||[])[1]||""; const body=sec.split("\n").filter(l=>!/^\s*#/.test(l)).join("\n"); if(!/default_tools_approval_mode\s*=\s*"approve"/.test(body)){console.log(s);process.exit(1);}console.log("PASS");'` ⇒ exit 0，且该行位于 `[mcp_servers.quay]` 节内（非注释行）。
- [x] AC2 spawn-verify（非仅 initialize）：扩展 `plugin/scripts/codex-stage1-spawn-verify.sh` 增 `--codex-exec`，对 `quay init` 落盘 config 跑真实 `codex exec` 完成 quay MCP `task_list` 调用（非交互唯一可自动化路径用 `--dangerously-bypass-approvals-and-sandbox`——codex 拒绝加载不受信临时目录的项目 config，trust 提示无法非交互应答），exit 0 且输出含非空任务列表（probe id）。
- [x] AC3 反向（能取假）：把生成节里的 `default_tools_approval_mode` 行删掉或改为 `"prompt"` 后，AC1 判定命令 exit 非 0。
- [x] AC4 测试：`packages/quay/test/init.test.mjs` 新增断言——生成的 `[mcp_servers.quay]` 节（去注释行）含 `default_tools_approval_mode = "approve"`，且删行/改 prompt 后断言失败（正向+反向，按位置判定）。
- [x] AC5 范围门绿：`bash scripts/test.sh --for-task gap-codex-host-config-approval-policy-blocks-mcp --allow-thin` 绿。

## Definition of Done

`generateCodexConfigToml()` 生成的 `.codex/config.toml` 在 `[mcp_servers.quay]` 节含 `default_tools_approval_mode = "approve"`（非注释行）；spawn-verify `--codex-exec` 证明带该 config 时 codex 能实际完成 `task_list` 调用；删行/改 prompt 后判定失败（能取假）；`init.test.mjs` 覆盖正反向；`--for-task` 范围门绿。

## ADR-007 dark-axis record

该轴仍暗,理由:init 生成 config 增一行 default_tools_approval_mode + spawn-verify 增 --codex-exec,无包/依赖结构变化,L_D/L_G 无可测结构量。

## Touches

- packages/quay/src/init.ts
- packages/quay/test/init.test.mjs
- plugin/scripts/codex-stage1-spawn-verify.sh
- plugin/sh-census-baseline.json
- tasks/gap-codex-host-config-approval-policy-blocks-mcp.md