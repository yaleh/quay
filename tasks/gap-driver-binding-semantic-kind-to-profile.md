---
id: gap-driver-binding-semantic-kind-to-profile
title: driver 绑定（L3：调用点只说语义 kind，policy 解析成 profile；web 侧只读）
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra:
  depends_on:
    - gap-profile-policy-when-which-profile
---
**type:** execution

## Proposal

人要求「先做 driver 会话设置（配置文件），web 设置以后再说」。L3 = driver 消费 policy：调用点只说语义 kind，由 policy 解析成 profile。**好消息**：`launchArgv`（`worker-driver.ts:613`）已是唯一构造点（AC140-1 成果）⇒ L1/L2 接在它下面即可，⛔ 不需要重构三个调用点——比看起来小。

⛔ **明确不做**：web 端编辑 driver 配置。`SPEC-unified-driver-architecture-2026-08-23.md:259-266` 已裁定「声明式配置（git 版本化·人写）⟷ 运行时控制态（gitignored·机器写）」硬分界，web 可编辑 = 机器改人的源文件，撞该裁定。web 侧只读。

## Plan

`worker-driver.ts:launchArgv` 改消费 policy（语义 kind → profile）；调用点只传语义 kind，不硬编码 profile 字段。

## Acceptance Criteria

- [x] AC1（能取假，语义 kind 调用）：调用点只传语义 kind（不硬编码 profile 字段）；（⛔ 调用点仍硬编码 profile ⇒ 假）。
- [x] AC2（能取假，policy 解析）：`launchArgv` 由 policy 解析 kind → profile（复用 L2 的 policy 模块）；（⛔ 绕过 policy 直接拼 argv ⇒ 假）。

## Definition of Done

driver 消费 policy 落地；AC1-2 全勾；调用点不硬编码 profile；web 侧只读（无编辑 driver 配置入口）。

## Touches

- plugin/scripts/driver-runtime.ts（launchArgv 定义处——改消费 policy）
- plugin/scripts/profile-policy.ts（ProfilesConfig 补 flag-only 字段 + 被 launchArgv 消费）
- plugin/scripts/worker-driver.ts（注释：launchArgv 不再走 quay-launch.sh）
- plugin/scripts/promotion-driver.ts（注释：buildFixWorkerArgv 走 policy）
- plugin/test/worker-driver.test.mjs（AC140-1/1b/3 改测 policy 解析）
- plugin/test/promotion-driver.test.mjs（buildFixWorkerArgv 改测 policy 解析）
- plugin/test/driver-cli.test.mjs（KERNEL_DEPS 补 profile-policy.ts + temp root 铺 node_modules 符号链接，kernel 首带 yaml 依赖）
- tasks/gap-driver-binding-semantic-kind-to-profile.md（自身）