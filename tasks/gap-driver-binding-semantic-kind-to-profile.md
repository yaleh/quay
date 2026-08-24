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

- [ ] AC1（能取假，语义 kind 调用）：调用点只传语义 kind（不硬编码 profile 字段）；（⛔ 调用点仍硬编码 profile ⇒ 假）。
- [ ] AC2（能取假，policy 解析）：`launchArgv` 由 policy 解析 kind → profile（复用 L2 的 policy 模块）；（⛔ 绕过 policy 直接拼 argv ⇒ 假）。

## Definition of Done

driver 消费 policy 落地；AC1-2 全勾；调用点不硬编码 profile；web 侧只读（无编辑 driver 配置入口）。

## Touches

- plugin/scripts/worker-driver.ts（launchArgv 消费 policy）
- plugin/scripts/profile-policy.ts（消费 policy，同 L2）
- plugin/test/worker-driver.test.mjs（对应测试）
- tasks/gap-driver-binding-semantic-kind-to-profile.md（自身）