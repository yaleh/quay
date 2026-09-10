---
id: gap-ac204-quay-init-forbidden-prefixes-mcp-commands-hooks-enable-declared
title: quay-init 禁复制面漏 mcp/commands/hooks 且闭集断言未在安装物+第三方项目形态跑过——补
  FORBIDDEN_PREFIXES 三项 + 成对落账（AC-204）
status: done
labels:
  - gap
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-204
---
## Proposal

AC-204（GOAL-009）判据 exit 1：`goals/AC-204-*.md` criterion 读 `plugin/scripts/quay-init-closure-assertion.ts` 的 `FORBIDDEN_PREFIXES`，要求含 `.mcp.json` / `.claude/commands/` / `.claude/hooks/` 三项，并要求载体 `.quay/productization-verification.jsonl` 存在 `ac="GOAL-009-AC-204"` 记录（`host≠本机 ∧ project_root∉本仓库 ∧ forbidden_count=0 ∧ enable_declared=true`）。实测（2026-09-09 干跑）exit 1，报 `forbidden-list missing: ['.claude/commands/', '.claude/hooks/', '.mcp.json']`；生产载体 `grep -c '"ac":"GOAL-009-AC-204"'` = 0。

**根因（读代码，非猜测）**：① `quay-init-closure-assertion.ts:40` `FORBIDDEN_PREFIXES` 只有 `.claude/skills/` `.claude/workflows/` `.claude/agents/` `plugin/scripts/` 四项，漏了 mcp/commands/hooks 三类 Claude Code 扩展面——「quay-init 只写启用不写实现」的契约只守了技能/workflow/agent 面，mcp 面裸奔（GOAL-009 背景③）。② 该断言只在**开发树 laydown**（`runLaydownPaths` 从 `<root>/plugin/scripts/quay-init.sh` 铺设）上跑，从未在**安装物 + 第三方项目**真实形态跑过 ⇒ 生产载体无记录命中。③ 「禁列为空」单独成立可被「什么都不铺的 init」满足 ⇒ 必须与「启用声明存在」（`enable_declared=true`）**成对判定**（GOAL-009 风险③）。

**修法**：
1. `FORBIDDEN_PREFIXES` 补 `.mcp.json`（文件，精确匹配）与 `.claude/commands/` `.claude/hooks/`（目录，前缀匹配）；`assertClosure` 的匹配器现为 `rel === p.slice(0,-1) || rel.startsWith(p)`，对无尾斜杠的文件前缀 `p.slice(0,-1)` 会误切成 `.mcp.jso`——须按文件/目录两态区分，否则 mcp.json 副本的 `forbiddenCopies` 计数错误。
2. 接线到 `plugin/scripts/verify-deliver-coldstart.sh`（step ② 已在干净第三方项目 `$ROOT` 里用【安装包里 shipped 的】quay-init 铺设——正是 AC-204 要的真实形态）：枚举 `$ROOT` 落地路径、算 `forbidden_count`；读 `$ROOT/.claude/settings.json` 判 `enable_declared`（`enabledPlugins` 非空 ∧ `permissions.allow` 含 `mcp__plugin_quay_quay__*`）。两者皆可读才 append（缺输入不写、不冒充合格——硬规则 3b）。
3. 追加 `ac="GOAL-009-AC-204"` 记录 `{ts, ac, host, project_root, forbidden_count, enable_declared}` 到载体；`host` 取 `--host B|C`、`project_root` 取 `readlink -f "$ROOT"`。
4. 生产复跑（host B/C + 第三方项目）使 criterion exit 1 → exit 0。

**为什么是必须修的缺陷**：AC-204 是 GOAL-009 交付面契约（只写启用不写实现）；本任务只到「禁复制面补全 + 成对落账」这一层，driver 真活（AC-203）与端到端（AC-207）是上/下游，另有 task。

## Acceptance Criteria

- [x] AC1 负控制复现：跑 AC-204 criterion 干跑，贴出 exit 1 + `forbidden-list missing: ['.claude/commands/', '.claude/hooks/', '.mcp.json']` 输出（改前现状，位置判定）。
- [x] AC2 常量补全：`FORBIDDEN_PREFIXES` 含 `.mcp.json` `.claude/commands/` `.claude/hooks/`（位置判定 `grep -cE '"(\.mcp\.json|\.claude/commands/|\.claude/hooks/)"' plugin/scripts/quay-init-closure-assertion.ts` = 3），且 `assertClosure([".mcp.json",".claude/commands/x.md",".claude/hooks/h.sh"])` ⇒ `forbiddenCopies` 含三者（文件/目录两态匹配正确）。
- [x] AC3 测试钉：`plugin/test/quay-init-laydown-closure.test.mjs` 新增断言——`.mcp.json`/`.claude/commands/x`/`.claude/hooks/x` 均 forbidden；`.claude/settings.json` 仍是闭集成员、非 forbidden（区分 enable 面与实现面）。
- [x] AC4 接线：`verify-deliver-coldstart.sh` step ② 后枚举 `$ROOT` 落地路径算 `forbidden_count`，读 `$ROOT/.claude/settings.json` 判 `enable_declared`；两者皆可读才 append，缺任一生效读数不写（硬规则 3b，缺值≠合格）。
- [x] AC5 载体落账：`--ac89` 追加面 append `ac="GOAL-009-AC-204"` 记录，`{ts, ac, host, project_root, forbidden_count, enable_declared}` 五字段逐字满足 criterion 过滤（`forbidden_count=0 ∧ enable_declared=true`）。
- [x] AC6 负控制（判据能取假）：写一条 `ac="GOAL-009-AC-204"` 但 `forbidden_count=1`（或 `enable_declared=false`）的记录 ⇒ criterion 仍 exit 1；验证后移除该记录、不污染生产载体。
- [ ] AC7 生产复跑：AC-204 criterion 干跑从 exit 1 → exit 0（贴干跑输出，host 为 B/C 之一、project_root 为第三方项目、forbidden_count=0 ∧ enable_declared=true）（待外部）

## Definition of Done

AC1–AC7 全绿；`scripts/test.sh`（含 `quay-init-laydown-closure.test.mjs` / `verify-deliver-coldstart.test.mjs`）全绿；`bash plugin/scripts/verify-deliver-coldstart.sh --selfcheck` exit 0。AC-204 criterion 从 exit 1 → exit 0，宿主为 B/C 之一、项目为第三方项目。⛔ 本任务只到「禁复制面补全 + 成对落账」这一层；driver 真活（AC-203）与端到端（AC-207）是上/下游，另有 task。

## Touches

- plugin/scripts/quay-init-closure-assertion.ts
- plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/quay-init-laydown-closure.test.mjs
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac204-quay-init-forbidden-prefixes-mcp-commands-hooks-enable-declared.md
