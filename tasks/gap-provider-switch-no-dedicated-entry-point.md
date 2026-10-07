---
id: gap-provider-switch-no-dedicated-entry-point
title: Provider 切换（如 native→github）没有任何专用入口，只能手改 .quay/config.yml
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: plan
---
## Proposal

**这是一个真实的能力缺口（缺失的入口），不是重复/重叠需要合并的问题——请不要把本任务误归类为「合并两个实现」类任务。**

先前的审计 grep 了全库对 `mcp_entry`/`tasks_dir` 的**赋值**（非读取）位置，发现唯一的写入点是 `packages/quay/src/init.ts`（新装写入，约 819-834 行；以及一个给 native provider 用的 `migrate_stale_mcp_entry` 升级路径，约 2365-2397 行）。没有任何 skill、CLI 命令、或 MCP 工具可以用来切换「哪个 provider 是 enabled」——`init.ts` 只会写出一段注释掉的 `# github:` 配置块,人必须手动取消注释并手动把 `enabled:true`/`native.enabled:false` 翻过来，切换前后都没有对目标 provider 配置完整性的校验。

## Plan

新增一个最小的 `quay provider switch <name>` CLI 命令（或等价 skill），功能：
1. 校验目标 provider 的必需配置字段是否齐全（例如 github provider 需要的 token/repo 等字段）
2. 翻转 `.quay/config.yml` 里的 `enabled` 状态（目标 provider enabled:true，原 provider enabled:false）
3. 告知用户 `quay init` 的 reconcile 步骤（现已是自动/状态驱动的，`--reconcile`/`--force` 已随 GOAL-029/AC-330 移除，2026-10-07）会在下一次 `quay init` 运行时自动识别新启用的 provider

本任务范围明确限定为新增这一个独立单元的能力，不与上面的收敛/清理类任务（stripHeadings 合并、ready-check 算法合并等）捆绑。

## Acceptance Criteria

- [x] 新增 `quay provider switch <name>` CLI 命令（或等价 skill 文档+脚本）
- [x] 执行前校验目标 provider 在 `.quay/config.yml` 中的必需字段齐全，缺失时给出明确错误而不是静默切换
- [x] 执行后 `.quay/config.yml` 的 `enabled` 状态正确翻转（目标 provider true，原 provider false），其余字段不被破坏
- [x] 命令输出提示用户下一次 `quay init` 会自动 reconcile 新启用的 provider
- [x] 新增测试覆盖：成功切换、目标 provider 配置不完整时拒绝切换、切换后 config.yml 内容正确

## Definition of Done

全部 AC 勾选；`quay provider switch` 命令真实可用；测试全绿；无需手改 `.quay/config.yml` 即可完成 provider 切换。

## Touches

- packages/quay/src/init.ts
- packages/quay/bin/quay.ts
- packages/quay/src/cli/provider.ts
- packages/quay/src/cli/help.ts
- packages/quay/test/cli.test.mjs
- tasks/gap-provider-switch-no-dedicated-entry-point.md
