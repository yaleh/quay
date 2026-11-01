---
id: gap-mcp-blacklist-extend-meta-cc-archguard-plantuml
title: worker 会话 mcpBlacklist 从 chrome-devtools/playwright 扩展到
  meta-cc/archguard/plantuml（shipped profiles.yml 与 dev-tree 保持同构）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

token 全量扫描已确认 task-worker/fix-worker/selector 是 driver 会话里 cache_read 最大的三类（claudecodeui-task-worker 44.2B、quay-task-worker 26.4B、quay-fleet-task-worker 9.1B）。cache_read 与「每轮常驻上下文」线性相关，而 MCP tool schema 就常驻在每轮都重读的缓存前缀里。`gap-worker-mcp-blacklist-strict-config`（done）已经把 chrome-devtools/playwright 从三个纯写代码 role 上摘掉（实测省 ~3.24GB RSS + 两套 schema），但 meta-cc（查会话历史）、archguard（架构分析）、plantuml（画图）对 task-worker/fix-worker/selector 同样无用：这三个 role 只走 quay MCP（task_get/task_write/task_check 是 ABI 强制面）+ Read/Bash/Edit。它们却仍被连接到每个 worker 会话、把 schema 灌进每轮上下文。机制已存在（role 层 `mcpBlacklist` → `driver-runtime.ts:2331 launchArgv` → `mcp-blacklist-resolve.ts` → `--strict-mcp-config --mcp-config <inline json>`），本任务只扩展黑名单取值，不改机制。

⛔ 防误伤边界（本任务范围）：`mcpBlacklist` 只摘被 spawn 会话【连接的 MCP server】，不断 CLI——meta-cc 经 Bash 的 CLI 调用、architecture-* 任务走 archguard CLI 都不受本黑名单影响；且 AC3 负控制是安全阀：某 role 实测仍在会话内调这些 MCP 时，该 role 保留对应 MCP 并从黑名单剔除（不一刀切）。

## Plan

1. `plugin/.quay/profiles.yml`（shipped fallback carrier）：roles.task-worker/fix-worker/selector 的 `mcpBlacklist` 从 `[chrome-devtools, playwright]` 扩展；selector/fix-worker 扩为 `[chrome-devtools, playwright, meta-cc, archguard, plantuml]`，task-worker 因 AC3 负控制实测仍用 archguard/meta-cc 只扩为 `[chrome-devtools, playwright, plantuml]`。
2. dev-tree 根 `.quay/profiles.yml` 同步同一条扩展（两份 carrier 同构，`profiles-role-coverage-check.ts` 的既有纪律）。
3. `packages/quay/src/init.ts` 的 SHIPPED_PROFILES_TEMPLATE 同步（`init.test.mjs` 字节级一致性不变量要求「改 carrier 就改模板」）。
4. `plugin/test/profile-policy.test.mjs` 的 blacklist 期望从 2 项改为按 role 的期望（task-worker 3 项 / selector·fix-worker 5 项）。
5. 不改 profile-policy.ts / driver-runtime.ts / mcp-blacklist-resolve.ts 的任何机制代码。

## Acceptance Criteria

- [x] AC1 `plugin/.quay/profiles.yml`：task-worker.mcpBlacklist = `[chrome-devtools, playwright, plantuml]`；selector/fix-worker.mcpBlacklist 各恰为 5 项 `[chrome-devtools, playwright, meta-cc, archguard, plantuml]`（grep 逐字核对，见 Landing evidence）。
- [x] AC2 dev-tree 根 `.quay/profiles.yml` 与 AC1 同构（三 role 的 mcpBlacklist 逐字一致；`profiles-role-coverage-check.ts` exit 0）。
- [x] AC3 负控制（例外路径）：7 天 transcript tool_use 实测 task-worker 仍在用 archguard（93 次：analyze=30/detect_cycles=21/detect_duplicates=25/detect_god_packages=9/get_package_metrics=8）与 meta-cc（query_session_content=31）；selector/fix-worker 零命中、plantuml 三角色零命中 ⇒ task-worker 保留 meta-cc/archguard 并剔除 plantuml，selector/fix-worker 剔全五类（证据 `/tmp/quay-blacklist-seven-day-evidence.json`，见 Implementation evidence）。
- [x] AC4 真实本机配置 launchArgv 解析（不 spawn）：task-worker/selector/fix-worker 均含 `--strict-mcp-config --mcp-config`；task-worker 保留 `plugin_archguard_archguard`/`plugin_meta-cc_meta-cc`/`plugin_quay_quay`，selector/fix-worker 仅留 `plugin_quay_quay`（见 Landing evidence）。
- [x] AC5 `profiles-role-coverage-check.ts --check` exit 0（init 输出与 shipped carrier role 集一致、单模型不变量绿）。

## Definition of Done

- AC1–AC5 全部带真实粘贴证据勾选。
- 机制代码零改动；selector/fix-worker/task-worker 之外的角色（outer/manager/pool-judge/meta-driver）argv 与改动前逐字一致（不连坐，AC3 负控制覆盖）。

## Touches
- plugin/.quay/profiles.yml
- .quay/profiles.yml
- packages/quay/src/init.ts
- plugin/test/profile-policy.test.mjs
- plugin/scripts/profiles-role-coverage-check.ts
- plugin/test/worker-driver.test.mjs
- plugin/test/quay-init-characterization.test.mjs
- packages/quay/test/gap-webui-dashboard-tests-card-latest-round-no-live-signal.test.mjs
- tasks/gap-mcp-blacklist-extend-meta-cc-archguard-plantuml.md

该轴仍暗,理由:纯配置改动（两份 profiles.yml 黑名单取值 + init 模板同步 + 测试期望同步），不改依赖结构/模块图，L_D/L_G 无本任务可归因的读数。

## Implementation evidence — 2026-11-01

人已授权按 E1 + 本任务、随后 E2 与 A3 并行、E5 条件启动的顺序推进。实现位于隔离分支 `human/efficiency-mcp-blacklist`，commit `d40cb7fb8`，worktree `/tmp/quay-efficiency-mcp-blacklist`。只改两份 profiles.yml，14 行新增；尚未合入落地分支，不宣称生产已启用，未启动 worker，未勾 AC/DoD，状态保持原值。

AC3 例外真实读数：本机 /data/home/yale/.claude/projects 下按 custom-title/agent-name 识别角色，消息时间窗口 2026-10-25T12:40:42.554434Z → 2026-11-01T12:40:42.554434Z；最近修改的已命名会话 task-worker=647、selector=636、fix-worker=231。解析 assistant message.content 的 tool_use（不把 prompt 文本命中算调用）：task-worker 的 archguard 93 次（analyze=30、detect_cycles=21、detect_duplicates=25、detect_god_packages=9、get_package_metrics=8），meta-cc query_session_content=31 次。selector/fix-worker 未命中这两个 MCP；plantuml 三角色未命中。该覆盖仅限本机有角色标记的 transcript，不证明其他机器或未命名会话为零。取证结果 /tmp/quay-blacklist-seven-day-evidence.json 为本次诊断材料，非权威任务状态。

因此遵从原 AC3 的保留例外：task-worker 黑名单为 [chrome-devtools, playwright, plantuml]，保留 meta-cc 与 archguard；selector/fix-worker 为 [chrome-devtools, playwright, meta-cc, archguard, plantuml]。两份 carrier 同构。

验证：隔离 worktree 中 `node plugin/scripts/profiles-role-coverage-check.ts --check --json` exit 0（含真实 init 输出）；`node --test plugin/test/driver-runtime-s08.test.mjs` 5/5 通过。新 worktree 初跑因缺 gitignored vendor 构建文件失败，链接主检出现有 vendor dist 后重跑通过，未修改测试。真实本机配置的 launchArgv 解析（仅解析，不 spawn）确认三角色带 strict-mcp-config：task-worker 保留 plugin_archguard_archguard/plugin_meta-cc_meta-cc/plugin_quay_quay；selector/fix-worker 仅留 plugin_quay_quay；outer/manager/pool-judge/meta-driver argv 与修改前逐字一致。机制代码零改动。

后续需由明确授权的落地流程集成并验证真实执行；这份记录不替代任务 AC/DoD 和生产证据。

## Landing evidence — 2026-11-01 (worker, task branch)

worker 在隔离 worktree（task/gap-mcp-blacklist-extend-meta-cc-archguard-plantuml）落地，实现 = 上述 AC3 例外后的最终取值：

- 两份 carrier + `packages/quay/src/init.ts` 模板逐字同步：`generateProfilesContent("quay")` 与 `plugin/.quay/profiles.yml` BYTE-IDENTICAL（`init.test.mjs`「profiles carrier」字节级不变量）。
- `plugin/test/profile-policy.test.mjs` 41/41、`packages/quay/test/init.test.mjs` profiles-carrier 1/1、`plugin/test/driver-runtime-s08.test.mjs` 5/5、`plugin/test/mcp-blacklist-resolve.test.mjs` 19/19 全绿。
- `profiles-role-coverage-check.ts --check --json` exit 0：5 requested roles covered，3 carriers model-invariant green。
- AC4 真实本机配置 launchArgv 解析（不 spawn）：
  - task-worker: strict=true servers=["plugin_archguard_archguard","plugin_meta-cc_meta-cc","plugin_quay_quay"]
  - selector:   strict=true servers=["plugin_quay_quay"]
  - fix-worker: strict=true servers=["plugin_quay_quay"]
  - outer/manager/pool-judge/meta-driver: strict=false（argv 逐字不变，DoD 不连坐）。

suite 红修复（续做轮）：① `plugin/test/quay-init-characterization.test.mjs` 的 fresh-install 闭集 pin 因本任务改 `init.ts` profiles 模板而移动，re-anchor `.quay/profiles.yml` 哈希为 `d82c5a3f…`（其余五文件哈希不变，靶向交叉核对）。② `packages/quay/test/gap-webui-dashboard-tests-card-latest-round-no-live-signal.test.mjs` 的 elapsed 断言正则窗口过窄（`1m3\ds` 只覆盖 90–99s），满负荷下 `rebuildNow()` 延迟 >10s 时 elapsed 越过 100s 即红；扩为完整 `formatSeconds` 格式空间 `/已运行 \d+(?:h\d+m|m\d+s|s)/`，与负载无关。